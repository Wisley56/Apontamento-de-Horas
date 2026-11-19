/**
 * Apontamento de Horas v3 — orquestração da interface.
 *
 * Passo 1: período e UF  →  Passo 2: batidas (colar/editar)  →  Passo 3: resultado e lançamento
 */

import {
  computeDay, chooseDayTotal, minutesToHHMM, minutesToDecimal, parseTime, parseTimesheet,
  eachDay, toISODateLocal, parseISODateLocal, isoToBr, brToIso, isWeekendIso, yearsInRange,
  WEEKDAYS, WEEKDAYS_SHORT, weekdayIndex, DEFAULT_EXPECTED_MINUTES,
} from "./hours.js";
import { api, bm, getApiKey, setApiKey, clearApiKey, getBmUser, API_BASE } from "./api.js";
import { openLaunch } from "./launch.js";
import { initConference, showConference, resetConference } from "./conference.js";
import {
  esc, icon, $, $$, storage, toast, withLoading, openDialog, setupDialogs, confirmDialog,
  applyTheme, downloadBlob,
} from "./ui.js";

const SETTINGS_KEY = "apnt_settings_v3";
const DRAFT_KEY = "apnt_draft_v3";
const MAX_PERIOD_DAYS = 93;

const DAY_KINDS = {
  ferias: "Férias",
  atestado: "Atestado",
  afastamento: "Afastamento",
  banco: "Banco de horas",
  feriado_manual: "Feriado manual",
};
const TIPOS = ["Melhoria", "Correção", "Suporte"];
const FALLBACK_UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

// ============ Estado ============

const settings = { uf: "GO", journey: "08:00", theme: "auto", ...storage.get(SETTINGS_KEY, {}) };

const state = {
  step: 1,
  view: "apontar",
  start: "",
  end: "",
  uf: settings.uf,
  days: [],
};

function saveSettings() {
  storage.set(SETTINGS_KEY, settings);
}

let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    storage.set(DRAFT_KEY, { start: state.start, end: state.end, uf: state.uf, days: state.days, step: state.step });
  }, 300);
}

function expectedMinutes() {
  return parseTime(settings.journey) ?? DEFAULT_EXPECTED_MINUTES;
}

// ============ Regras do dia ============

function newDay(iso, holidays) {
  return {
    iso,
    holiday: holidays[isoToBr(iso)] || null,
    weekend: isWeekendIso(iso),
    override: null, // null | "work" | chave de DAY_KINDS
    intervals: [{ entry: "", exit: "" }],
    overtime: null,
    absence: null,
    source: "marcacoes",
    tipo: "",
    launched: [],
  };
}

/** Situação do dia: útil ou não, com o motivo. */
function dayStatus(day) {
  if (day.override === "work") return { workday: true, label: day.holiday ? `Trabalhado (feriado: ${day.holiday})` : day.weekend ? "Trabalhado (fim de semana)" : "Dia útil" };
  if (day.override && DAY_KINDS[day.override]) return { workday: false, label: DAY_KINDS[day.override] };
  if (day.holiday) return { workday: false, label: `Feriado: ${day.holiday}` };
  if (day.weekend) return { workday: false, label: "Fim de semana" };
  return { workday: true, label: "Dia útil" };
}

function dayCalc(day) {
  return computeDay({ intervals: day.intervals, overtime: day.overtime, absence: day.absence, expectedMinutes: expectedMinutes() });
}

function dayTotal(day) {
  if (!dayStatus(day).workday) return 0;
  return chooseDayTotal(dayCalc(day), day.source);
}

const launchedMinutes = (day) => day.launched.reduce((a, l) => a + (l.minutes || 0), 0);
const pendingMinutes = (day) => Math.max(0, dayTotal(day) - launchedMinutes(day));

function launchState(day) {
  const total = dayTotal(day);
  const done = launchedMinutes(day);
  if (total === 0) return "empty";
  if (done === 0) return "pending";
  return done >= total ? "done" : "partial";
}

const shortDate = (iso) => isoToBr(iso).slice(0, 5);
const weekdayShort = (iso) => WEEKDAYS_SHORT[weekdayIndex(iso)];

// ============ Inicialização ============

document.addEventListener("DOMContentLoaded", init);

async function init() {
  applyTheme(settings.theme);
  setupDialogs();
  bindGlobal();
  bindPeriod();
  bindHours();
  bindResult();
  bindSettings();
  initConference({ workedMinutes, onChanged: syncLaunched, needKey: openSettings });
  updateConnectionBadge();
  keepServerAwake();

  await loadStates();

  const draft = storage.get(DRAFT_KEY, null);
  if (draft?.days?.length && draft.start && draft.end) {
    state.start = draft.start;
    state.end = draft.end;
    state.uf = draft.uf || settings.uf;
    state.days = draft.days.map((d) => ({ ...newDay(d.iso, {}), ...d }));
    $("#start-date").value = state.start;
    $("#end-date").value = state.end;
    $("#uf-select").value = state.uf;
    goTo(Math.min(draft.step || 2, 3), { silent: true });
  } else {
    setRange("month");
    goTo(1, { silent: true });
  }
}

async function loadStates() {
  const select = $("#uf-select");
  let states = FALLBACK_UFS.map((code) => ({ code, name: code }));
  try {
    states = await api.states();
  } catch {
    /* servidor pode estar acordando; usa a lista local */
  }
  select.innerHTML = states.map((s) => `<option value="${esc(s.code)}">${esc(s.code === s.name ? s.code : `${s.code} — ${s.name}`)}</option>`).join("");
  select.value = state.uf || "GO";
}

function keepServerAwake() {
  const ping = () => api.health().catch(() => {});
  ping();
  setInterval(ping, 10 * 60 * 1000);
}

// ============ Navegação ============

function goTo(step, { silent = false } = {}) {
  if (step > 1 && !state.days.length) {
    if (!silent) toast("Defina o período primeiro.", "info");
    step = 1;
  }
  state.step = step;
  if (state.view !== "apontar") return;
  [1, 2, 3].forEach((n) => ($(`#step-${n}`).hidden = n !== step));
  $$(".step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    btn.classList.toggle("is-active", n === step);
    btn.classList.toggle("is-done", n < step);
    btn.setAttribute("aria-current", n === step ? "step" : "false");
    btn.disabled = n > 1 && !state.days.length;
  });
  if (step === 2) renderDays();
  if (step === 3) renderResult();
  saveDraft();
  if (!silent) window.scrollTo({ top: 0, behavior: "smooth" });
}

function setView(view) {
  state.view = view;
  const conf = view === "conferencia";
  $$(".view-tab").forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle("is-active", on);
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  $(".stepper").hidden = conf;
  $("#view-conf").hidden = !conf;
  if (conf) {
    [1, 2, 3].forEach((n) => ($(`#step-${n}`).hidden = true));
    showConference();
  } else {
    goTo(state.step, { silent: true });
  }
  window.scrollTo({ top: 0 });
}

function bindGlobal() {
  $$(".view-tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));

  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) goTo(Number(go.dataset.goto));
    const step = e.target.closest(".step");
    if (step && !step.disabled) goTo(Number(step.dataset.step));
  });

  $("#theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    settings.theme = current === "dark" ? "light" : "dark";
    applyTheme(settings.theme);
    saveSettings();
    $("#pref-theme").value = settings.theme;
  });

  // Ctrl+V em qualquer lugar do passo 2 (fora de campos) aplica os horários.
  document.addEventListener("paste", (e) => {
    if (state.view !== "apontar" || state.step !== 2) return;
    const tag = document.activeElement?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    $("#paste-input").value = text;
    applyPaste(text);
  });
}

// ============ Passo 1: período ============

function setRange(kind) {
  const today = new Date();
  const d = (y, m, day) => toISODateLocal(new Date(y, m, day));
  const y = today.getFullYear();
  const m = today.getMonth();
  let start, end;
  switch (kind) {
    case "today": start = end = toISODateLocal(today); break;
    case "yesterday": start = end = d(y, m, today.getDate() - 1); break;
    case "week": {
      const offset = (today.getDay() + 6) % 7; // segunda-feira
      start = d(y, m, today.getDate() - offset);
      end = toISODateLocal(today);
      break;
    }
    case "last-month": start = d(y, m - 1, 1); end = d(y, m, 0); break;
    default: start = d(y, m, 1); end = toISODateLocal(today);
  }
  $("#start-date").value = start;
  $("#end-date").value = end;
  $$(".chip[data-range]").forEach((c) => c.classList.toggle("is-active", c.dataset.range === kind));
}

function bindPeriod() {
  $$(".chip[data-range]").forEach((chip) => chip.addEventListener("click", () => setRange(chip.dataset.range)));
  ["#start-date", "#end-date"].forEach((sel) =>
    $(sel).addEventListener("input", () => $$(".chip[data-range]").forEach((c) => c.classList.remove("is-active"))),
  );
  $("#period-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await buildPeriod($("#start-date").value, $("#end-date").value, $("#uf-select").value);
  });
}

async function fetchHolidays(start, end, uf) {
  const result = {};
  for (const year of yearsInRange(start, end)) {
    try {
      Object.assign(result, (await api.holidays(year, uf)).holidays || {});
    } catch {
      toast(`Não foi possível carregar os feriados de ${year}. Confira os dias manualmente.`, "warn", 5000);
    }
  }
  return result;
}

async function buildPeriod(start, end, uf) {
  if (!parseISODateLocal(start) || !parseISODateLocal(end)) return toast("Informe as datas inicial e final.", "error");
  if (end < start) return toast("A data final deve ser igual ou posterior à inicial.", "error");
  const isos = eachDay(start, end);
  if (isos.length > MAX_PERIOD_DAYS) return toast(`Escolha um período de até ${MAX_PERIOD_DAYS} dias.`, "error");

  const holidays = await withLoading("Carregando feriados…", () => fetchHolidays(start, end, uf));
  const previous = new Map(state.days.map((d) => [d.iso, d]));
  state.days = isos.map((iso) => {
    const fresh = newDay(iso, holidays);
    const old = previous.get(iso);
    return old ? { ...old, holiday: fresh.holiday, weekend: fresh.weekend } : fresh;
  });
  state.start = start;
  state.end = end;
  state.uf = uf;
  settings.uf = uf;
  saveSettings();
  $("#paste-feedback").innerHTML = "";
  goTo(2);
}

// ============ Passo 2: horários ============

function bindHours() {
  const textarea = $("#paste-input");
  textarea.addEventListener("paste", () => setTimeout(() => applyPaste(textarea.value), 0));
  textarea.addEventListener("change", () => textarea.value.trim() && applyPaste(textarea.value));

  $("#paste-clipboard").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast("A área de transferência está vazia.", "info");
      textarea.value = text;
      applyPaste(text);
    } catch {
      toast("O navegador não liberou a área de transferência. Clique no campo e use Ctrl+V.", "warn", 5000);
      textarea.focus();
    }
  });

  $("#clear-punches").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Limpar batidas",
      message: "<p>Apagar todas as batidas do período? Os lançamentos já feitos no Businessmap não são afetados.</p>",
      confirmLabel: "Limpar",
      danger: true,
    });
    if (!ok) return;
    state.days.forEach((d) => Object.assign(d, { intervals: [{ entry: "", exit: "" }], overtime: null, absence: null, source: "marcacoes" }));
    $("#paste-input").value = "";
    $("#paste-feedback").innerHTML = "";
    renderDays();
    saveDraft();
  });

  const list = $("#days-list");

  list.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches("[data-punch]")) return;
    const day = state.days[Number(el.dataset.i)];
    day.intervals[Number(el.dataset.j)][el.dataset.punch] = el.value;
    updateDayMeta(Number(el.dataset.i));
    saveDraft();
  });

  list.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-act='kind']")) {
      const day = state.days[Number(el.dataset.i)];
      day.override = el.value === "auto" ? null : el.value;
      rerenderDay(Number(el.dataset.i));
      saveDraft();
    }
  });

  list.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT") return;
    const i = Number(el.dataset.i);
    const day = state.days[i];
    switch (el.dataset.act) {
      case "add-interval":
        day.intervals.push({ entry: "", exit: "" });
        rerenderDay(i);
        $(`#day-${i} .pair:last-child input`)?.focus();
        break;
      case "remove-interval":
        if (day.intervals.length > 1) day.intervals.pop();
        else day.intervals = [{ entry: "", exit: "" }];
        rerenderDay(i);
        break;
      case "force-work":
        day.override = "work";
        rerenderDay(i);
        break;
      case "source":
        day.source = el.dataset.source;
        updateDayMeta(i);
        break;
      default:
        return;
    }
    saveDraft();
  });
}

function applyPaste(text) {
  const feedback = $("#paste-feedback");
  const { days: parsed, warnings } = parseTimesheet(text);
  if (!parsed.length) {
    feedback.innerHTML = `<div class="alert alert-warn">${icon("alert")} Não reconheci batidas nesse texto. Copie o espelho de ponto incluindo as datas (dd/mm/aaaa).</div>`;
    return;
  }

  const byIso = new Map(state.days.map((d, i) => [d.iso, i]));
  let filled = 0;
  const outside = [];
  const forced = [];

  for (const p of parsed) {
    const iso = brToIso(p.date);
    const idx = byIso.get(iso);
    if (idx === undefined) {
      outside.push(iso);
      continue;
    }
    const day = state.days[idx];
    day.intervals = p.intervals.length ? p.intervals.map((x) => ({ ...x })) : [{ entry: "", exit: "" }];
    day.overtime = p.overtime;
    day.absence = p.absence;
    day.source = "marcacoes";
    const hasPunches = p.intervals.some((x) => x.entry || x.exit);
    if (hasPunches && !dayStatus(day).workday && !day.override) {
      day.override = "work";
      forced.push(iso);
    }
    filled++;
  }

  const parts = [];
  if (filled) parts.push(`<div class="alert alert-ok">${icon("check")} ${filled} dia(s) preenchido(s) a partir do texto colado.</div>`);
  if (forced.length) parts.push(`<div class="alert alert-info">${icon("alert")} Havia batidas em fim de semana/feriado (${forced.map(shortDate).join(", ")}); esses dias foram marcados como trabalhados.</div>`);
  if (outside.length) {
    outside.sort();
    const first = [...parsed.map((p) => brToIso(p.date)), state.start].sort()[0];
    const last = [...parsed.map((p) => brToIso(p.date)), state.end].sort().slice(-1)[0];
    parts.push(`<div class="alert alert-warn">${icon("alert")}<div>${outside.length} dia(s) do texto estão fora do período (${outside.slice(0, 5).map(shortDate).join(", ")}${outside.length > 5 ? "…" : ""}).
      <button type="button" class="btn btn-ghost btn-sm" id="expand-period" data-start="${first}" data-end="${last}">Ajustar período para ${isoToBr(first)} – ${isoToBr(last)}</button></div></div>`);
  }
  if (warnings.length) {
    parts.push(`<details class="alert alert-warn"><summary>${icon("alert")} ${warnings.length} aviso(s) na leitura</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>`);
  }
  feedback.innerHTML = parts.join("");

  $("#expand-period")?.addEventListener("click", async (e) => {
    const { start, end } = e.currentTarget.dataset;
    $("#start-date").value = start;
    $("#end-date").value = end;
    await buildPeriod(start, end, state.uf);
    applyPaste(text);
  });

  renderDays();
  saveDraft();
  if (filled) toast(`${filled} dia(s) preenchido(s).`, "success");
}

function kindSelect(day, i) {
  const st = dayStatus({ ...day, override: null });
  const options = [
    ["auto", `Automático (${st.workday ? "dia útil" : st.label.toLowerCase()})`],
    ["work", "Dia trabalhado"],
    ...Object.entries(DAY_KINDS),
  ];
  const current = day.override || "auto";
  return `
    <label class="sr-only" for="kind-${i}">Situação do dia ${isoToBr(day.iso)}</label>
    <select id="kind-${i}" class="select-sm" data-act="kind" data-i="${i}">
      ${options.map(([v, l]) => `<option value="${v}" ${v === current ? "selected" : ""}>${esc(l)}</option>`).join("")}
    </select>`;
}

function dayMetaHtml(day, i) {
  const st = dayStatus(day);
  if (!st.workday) return "";
  const calc = dayCalc(day);
  const total = chooseDayTotal(calc, day.source);
  const warn = calc.warnings.filter((w) => w.code !== "no_punches");
  const diverge = calc.formulaMinutes !== null && calc.divergenceMinutes !== 0;

  return `
    <div class="day-total ${total ? "" : "is-empty"}">${total ? minutesToHHMM(total) : "--:--"}</div>
    ${warn.length ? `<ul class="day-warnings">${warn.map((w) => `<li>${icon("alert")} ${esc(w.message)}</li>`).join("")}</ul>` : ""}
    ${diverge ? `
      <div class="diverge" role="group" aria-label="Valor oficial do dia">
        <span class="diverge-text">${icon("alert")} As batidas (${minutesToHHMM(calc.workedMinutes)}) diferem do ponto (${minutesToHHMM(calc.formulaMinutes)} = jornada ${settings.journey} ${day.overtime ? `+ HE ${esc(day.overtime)}` : ""} ${day.absence ? `− AUS ${esc(day.absence)}` : ""}).</span>
        <div class="segmented segmented-sm">
          <button type="button" class="${day.source === "marcacoes" ? "is-active" : ""}" data-act="source" data-source="marcacoes" data-i="${i}">Usar batidas</button>
          <button type="button" class="${day.source === "ponto" ? "is-active" : ""}" data-act="source" data-source="ponto" data-i="${i}">Usar ponto</button>
        </div>
      </div>` : ""}
    ${day.overtime || day.absence ? `<div class="day-balance muted small">${day.overtime ? `HE ${esc(day.overtime)}` : ""}${day.overtime && day.absence ? " · " : ""}${day.absence ? `AUS ${esc(day.absence)}` : ""}</div>` : ""}
  `;
}

function dayHtml(day, i) {
  const st = dayStatus(day);
  const dateCol = `
    <div class="day-date">
      <strong>${shortDate(day.iso)}</strong>
      <span>${weekdayShort(day.iso)}</span>
    </div>`;

  if (!st.workday) {
    return `
      <article class="day is-off" id="day-${i}">
        ${dateCol}
        <div class="day-body">
          <span class="badge">${esc(st.label)}</span>
          ${day.weekend || day.holiday ? `<button type="button" class="btn btn-ghost btn-sm" data-act="force-work" data-i="${i}">Trabalhei neste dia</button>` : ""}
        </div>
        <div class="day-side">${kindSelect(day, i)}</div>
      </article>`;
  }

  const pairs = day.intervals.map((iv, j) => `
    <div class="pair">
      <input type="time" class="time" value="${esc(iv.entry)}" data-punch="entry" data-i="${i}" data-j="${j}" aria-label="Entrada ${j + 1} de ${isoToBr(day.iso)}" />
      <span class="pair-sep" aria-hidden="true">–</span>
      <input type="time" class="time" value="${esc(iv.exit)}" data-punch="exit" data-i="${i}" data-j="${j}" aria-label="Saída ${j + 1} de ${isoToBr(day.iso)}" />
    </div>`).join("");

  return `
    <article class="day" id="day-${i}">
      ${dateCol}
      <div class="day-body">
        <div class="pairs">${pairs}
          <div class="pair-actions">
            <button type="button" class="btn-icon btn-icon-sm" data-act="add-interval" data-i="${i}" aria-label="Adicionar intervalo" title="Adicionar intervalo">${icon("plus")}</button>
            <button type="button" class="btn-icon btn-icon-sm" data-act="remove-interval" data-i="${i}" aria-label="Remover último intervalo" title="Remover último intervalo">${icon("minus")}</button>
          </div>
        </div>
        ${day.override === "work" && (day.weekend || day.holiday) ? `<span class="badge badge-info">${esc(st.label)}</span>` : ""}
      </div>
      <div class="day-side">
        <div class="day-meta" id="day-meta-${i}">${dayMetaHtml(day, i)}</div>
        ${kindSelect(day, i)}
      </div>
    </article>`;
}

function renderDays() {
  const s = parseISODateLocal(state.start);
  $("#period-label").textContent = s
    ? `${isoToBr(state.start)} a ${isoToBr(state.end)} · ${state.uf} · ${state.days.filter((d) => dayStatus(d).workday).length} dia(s) útil(eis)`
    : "";
  $("#days-list").innerHTML = state.days.map(dayHtml).join("");
  updatePeriodTotal();
}

function rerenderDay(i) {
  const el = $(`#day-${i}`);
  if (el) el.outerHTML = dayHtml(state.days[i], i);
  updatePeriodTotal();
}

function updateDayMeta(i) {
  const el = $(`#day-meta-${i}`);
  if (el) el.innerHTML = dayMetaHtml(state.days[i], i);
  updatePeriodTotal();
}

function updatePeriodTotal() {
  const total = state.days.reduce((a, d) => a + dayTotal(d), 0);
  $("#period-total").textContent = minutesToHHMM(total);
}

// ============ Passo 3: resultado ============

function bindResult() {
  $("#result-list").addEventListener("click", (e) => {
    const el = e.target.closest("[data-act='launch-day']");
    if (el) startLaunch([Number(el.dataset.i)]);
  });

  $("#result-list").addEventListener("change", (e) => {
    const el = e.target;
    if (!el.matches("[data-act='tipo']")) return;
    state.days[Number(el.dataset.i)].tipo = el.value;
    saveDraft();
  });

  $("#tipo-all").addEventListener("change", (e) => {
    const tipo = e.target.value;
    state.days.forEach((d) => { if (dayStatus(d).workday) d.tipo = tipo; });
    renderResult();
    saveDraft();
  });

  $("#launch-pending").addEventListener("click", () => {
    const idx = state.days.map((d, i) => (dayStatus(d).workday && pendingMinutes(d) > 0 ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return toast("Não há dias com horas pendentes.", "info");
    startLaunch(idx);
  });

  $("#export-btn").addEventListener("click", exportExcel);
}

function renderResult() {
  const work = state.days.filter((d) => dayStatus(d).workday);
  const total = work.reduce((a, d) => a + dayTotal(d), 0);
  const launched = work.reduce((a, d) => a + Math.min(launchedMinutes(d), dayTotal(d)), 0);
  const pendingDays = work.filter((d) => pendingMinutes(d) > 0).length;

  $("#summary").innerHTML = `
    <div class="stat"><span class="stat-label">Dias úteis</span><strong class="stat-value">${work.length}</strong></div>
    <div class="stat"><span class="stat-label">Total trabalhado</span><strong class="stat-value">${minutesToHHMM(total)}</strong><span class="stat-sub">${minutesToDecimal(total)} h</span></div>
    <div class="stat"><span class="stat-label">Lançado</span><strong class="stat-value">${minutesToHHMM(launched)}</strong><span class="stat-sub">${total ? Math.round((launched / total) * 100) : 0}% do total</span></div>
    <div class="stat"><span class="stat-label">Dias pendentes</span><strong class="stat-value">${pendingDays}</strong></div>
  `;

  $("#launch-pending").disabled = pendingDays === 0;

  $("#result-list").innerHTML = state.days.map((day, i) => {
    const st = dayStatus(day);
    const dateCol = `<div class="day-date"><strong>${shortDate(day.iso)}</strong><span>${weekdayShort(day.iso)}</span></div>`;
    if (!st.workday) {
      return `<article class="result-row is-off">${dateCol}<span class="muted">${esc(st.label)}</span></article>`;
    }
    const total = dayTotal(day);
    const ls = launchState(day);
    const statusChip = {
      empty: `<span class="status status-empty">Sem horas</span>`,
      pending: `<span class="status status-pending">Pendente</span>`,
      partial: `<span class="status status-partial">Parcial · falta ${minutesToHHMM(pendingMinutes(day))}</span>`,
      done: `<span class="status status-done">${icon("check")} Lançado</span>`,
    }[ls];

    return `
      <article class="result-row is-${ls}">
        ${dateCol}
        <button type="button" class="hours-btn" data-act="launch-day" data-i="${i}" ${total ? "" : "disabled"} aria-label="Lançar ${minutesToHHMM(pendingMinutes(day) || total)} de ${isoToBr(day.iso)} no Businessmap">
          <strong>${total ? minutesToHHMM(total) : "--:--"}</strong>
          <span>${total ? `${minutesToDecimal(total)} h` : ""}</span>
          ${total && ls !== "done" ? `<span class="hours-cta">${icon("send")} Lançar</span>` : ""}
        </button>
        <div class="result-info">
          ${statusChip}
          ${day.launched.length ? `<ul class="launched">${day.launched.map((l) => `<li><span>${esc(l.label)}</span><span>${minutesToHHMM(l.minutes)}</span></li>`).join("")}</ul>` : ""}
        </div>
        <div class="result-tipo">
          <label class="sr-only" for="tipo-${i}">Tipo de atividade em ${isoToBr(day.iso)}</label>
          <select id="tipo-${i}" class="select-sm" data-act="tipo" data-i="${i}">
            <option value="">Tipo…</option>
            ${TIPOS.map((t) => `<option ${day.tipo === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
      </article>`;
  }).join("");
}

async function startLaunch(indexes) {
  if (!getApiKey()) {
    toast("Configure sua API Key do Businessmap para lançar as horas.", "info", 5000);
    openSettings();
    return;
  }

  const toLaunch = indexes
    .map((i) => state.days[i])
    .map((d) => ({ iso: d.iso, minutes: pendingMinutes(d), tipo: d.tipo }))
    .filter((d) => d.minutes > 0);

  if (!toLaunch.length) {
    // Dia já lançado: permite lançar de novo o total (o diálogo avisa sobre duplicidade).
    const d = state.days[indexes[0]];
    const ok = await confirmDialog({
      title: "Dia já lançado",
      message: `<p>As horas de <strong>${isoToBr(d.iso)}</strong> já foram lançadas por aqui. Deseja lançar novamente?</p>`,
      confirmLabel: "Lançar novamente",
    });
    if (!ok) return;
    toLaunch.push({ iso: d.iso, minutes: dayTotal(d), tipo: d.tipo });
  }

  const selected = new Set(toLaunch.map((d) => d.iso));
  openLaunch(toLaunch, {
    otherPending: () =>
      state.days
        .filter((d) => dayStatus(d).workday && !selected.has(d.iso) && pendingMinutes(d) > 0)
        .map((d) => ({ iso: d.iso, minutes: pendingMinutes(d), tipo: d.tipo })),
    onLaunched: (created, items) => {
      items.forEach((it, k) => {
        const day = state.days.find((d) => d.iso === it.iso);
        if (!day) return;
        const id = it.card.custom_id || `#${it.card.card_id}`;
        day.launched.push({
          card_id: it.card.card_id,
          subtask_id: it.subtask?.subtask_id || null,
          logged_time_id: created[k]?.logged_time_id || null,
          minutes: it.minutes,
          label: `${id} · ${it.card.title || ""}${it.subtask ? ` › ${it.subtask.description}` : ""}`,
        });
      });
      saveDraft();
      renderResult();
      toast("Horas lançadas no Businessmap.", "success");
    },
  });
}

// ============ Conferência ↔ Apontar ============

/** Total trabalhado do dia, se ele estiver no período em apuração. */
function workedMinutes(iso) {
  const day = state.days.find((d) => d.iso === iso);
  if (!day || !dayStatus(day).workday) return null;
  return dayTotal(day) || null;
}

/** Mantém `day.launched` coerente com edições feitas na Conferência. */
function syncLaunched(change) {
  const { type, oldId, entry } = change;
  if (type === "update") {
    // Tempo e/ou data podem ter mudado: tira do dia antigo e põe no dia novo.
    let item = null;
    state.days.forEach((d) => {
      const found = d.launched.find((l) => l.logged_time_id === oldId);
      if (found) item = found;
      d.launched = d.launched.filter((l) => l.logged_time_id !== oldId);
    });
    if (item) {
      item.minutes = entry.minutes;
      state.days.find((d) => d.iso === entry.date)?.launched.push(item);
    }
    saveDraft();
    return;
  }
  if (type !== "create") {
    state.days.forEach((d) => {
      d.launched = d.launched.filter((l) => l.logged_time_id !== oldId);
    });
  }
  if (type === "recreate" || type === "create") {
    const day = state.days.find((d) => d.iso === entry.date);
    if (day) {
      day.launched.push({
        card_id: entry.card_id,
        subtask_id: entry.subtask_id || null,
        logged_time_id: entry.logged_time_id,
        minutes: entry.minutes,
        label: `${entry.custom_id || `#${entry.card_id}`} · ${entry.card_title || ""}${entry.subtask_id ? ` › ${entry.subtask_description || entry.subtask_id}` : ""}`,
      });
    }
  }
  saveDraft();
}

async function exportExcel() {
  const days = state.days.map((d) => {
    const st = dayStatus(d);
    const total = dayTotal(d);
    const punches = d.intervals.filter((x) => x.entry || x.exit).map((x) => `${x.entry || "?"}–${x.exit || "?"}`).join("  ");
    return {
      date: isoToBr(d.iso),
      day_of_week: WEEKDAYS[weekdayIndex(d.iso)],
      punches: st.workday ? punches : "",
      total_hhmm: st.workday ? minutesToHHMM(total) : "",
      total_decimal: st.workday ? minutesToDecimal(total) : "",
      tipo: st.workday ? d.tipo : "",
      cards: d.launched.map((l) => `${l.label} (${minutesToHHMM(l.minutes)})`).join("\n"),
      status: !st.workday ? st.label : { empty: "Sem horas", pending: "Pendente", partial: "Parcial", done: "Lançado" }[launchState(d)],
      ignored: !st.workday,
    };
  });
  const total = state.days.reduce((a, d) => a + dayTotal(d), 0);
  try {
    const response = await withLoading("Gerando planilha…", () =>
      api.exportExcel({ days, summary: { total_hhmm: minutesToHHMM(total), total_decimal: minutesToDecimal(total) } }),
    );
    downloadBlob(await response.blob(), `apontamento_${state.start}_${state.end}.xlsx`);
    toast("Planilha exportada.", "success");
  } catch (e) {
    toast(e.message || "Erro ao exportar.", "error");
  }
}

// ============ Configurações ============

function openSettings() {
  $("#api-key").value = getApiKey();
  $("#api-key").type = "password";
  $("#pref-journey").value = settings.journey;
  $("#pref-theme").value = settings.theme;
  renderConnStatus();
  openDialog($("#settings-dialog"));
}

function renderConnStatus(message, kind) {
  const el = $("#conn-status");
  if (message) {
    el.className = `conn-status is-${kind}`;
    el.textContent = message;
    return;
  }
  const user = getBmUser();
  if (user && getApiKey()) {
    el.className = "conn-status is-ok";
    el.innerHTML = `${icon("check")} Conectado como <strong>${esc(user.realname || user.username)}</strong>${user.email ? ` (${esc(user.email)})` : ""}`;
  } else if (getApiKey()) {
    el.className = "conn-status is-info";
    el.textContent = "Chave salva, conexão ainda não testada.";
  } else {
    el.className = "conn-status";
    el.textContent = "Nenhuma chave configurada.";
  }
}

function updateConnectionBadge() {
  const on = !!(getApiKey() && getBmUser());
  $("#conn-dot").classList.toggle("is-on", on);
  $("#settings-open").title = on ? `Businessmap: ${getBmUser().realname || getBmUser().username}` : "Configurar conexão com o Businessmap";
}

function bindSettings() {
  $("#settings-open").addEventListener("click", openSettings);

  $("#api-key-toggle").addEventListener("click", () => {
    const input = $("#api-key");
    input.type = input.type === "password" ? "text" : "password";
  });

  $("#api-key-save").addEventListener("click", async () => {
    const key = $("#api-key").value.trim();
    if (!key) return renderConnStatus("Cole a API Key antes de salvar.", "error");
    clearApiKey();
    resetConference();
    setApiKey(key);
    renderConnStatus("Testando conexão…", "info");
    try {
      await bm.me();
      renderConnStatus();
      if (state.view === "conferencia") showConference();
      toast("Conexão com o Businessmap funcionando.", "success");
    } catch (e) {
      renderConnStatus(e.message, "error");
    }
    updateConnectionBadge();
  });

  $("#api-key-remove").addEventListener("click", () => {
    clearApiKey();
    resetConference();
    $("#api-key").value = "";
    renderConnStatus();
    updateConnectionBadge();
    toast("Chave removida deste navegador.", "info");
  });

  $("#pref-journey").addEventListener("change", (e) => {
    if (parseTime(e.target.value) === null) return;
    settings.journey = e.target.value;
    saveSettings();
    if (state.step === 2) renderDays();
    if (state.step === 3) renderResult();
  });

  $("#pref-theme").addEventListener("change", (e) => {
    settings.theme = e.target.value;
    applyTheme(settings.theme);
    saveSettings();
  });
}

// Disponível para depuração no console.
window.__apontamento = { state, settings, API_BASE };
