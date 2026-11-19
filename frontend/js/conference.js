/**
 * Conferência: lista os lançamentos do usuário no Businessmap (dia, quadro, card,
 * subtarefa, categoria), com filtros, comparação com as horas trabalhadas e edição.
 *
 * Edição (PATCH /loggedTime/{id}): tempo, comentário, data e categoria.
 * Exceções em que o lançamento é recriado (novo cadastrado, antigo excluído, nessa ordem):
 *  - remover a categoria (a API não aceita category_id nulo);
 *  - o Businessmap recusar a mudança de data/categoria — o usuário confirma antes.
 */

import { bm, getApiKey } from "./api.js";
import { minutesToHHMM, minutesToDecimal, parseDuration, isoToBr, WEEKDAYS_SHORT, weekdayIndex, toISODateLocal } from "./hours.js";
import { esc, icon, $, $$, toast, openDialog, closeDialog, confirmDialog, normalizeLabel } from "./ui.js";

const C = {
  from: "",
  to: "",
  entries: [],
  loaded: false,
  loading: false,
  error: "",
  board: "",
  category: "",
  q: "",
  group: "day",
};

let hooks = {};
let editing = null; // lançamento aberto no diálogo

/**
 * @param {{ workedMinutes?: (iso:string) => number|null, onChanged?: (change:object) => void, needKey?: () => void }} h
 */
export function initConference(h = {}) {
  hooks = h;
  setRange("month");
  bind();
}

export function showConference() {
  if (!C.loaded && !C.loading && getApiKey()) load();
  render();
}

/** Chamado quando a chave muda (outra conta → outra lista). */
export function resetConference() {
  C.entries = [];
  C.loaded = false;
  C.error = "";
}

// ---------- período ----------

function setRange(kind) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = (yy, mm, dd) => toISODateLocal(new Date(yy, mm, dd));
  let from;
  let to = toISODateLocal(today);
  if (kind === "today") from = to;
  else if (kind === "week") from = d(y, m, today.getDate() - ((today.getDay() + 6) % 7));
  else if (kind === "last-month") { from = d(y, m - 1, 1); to = d(y, m, 0); }
  else from = d(y, m, 1);
  C.from = from;
  C.to = to;
  $("#conf-from").value = from;
  $("#conf-to").value = to;
  $$("[data-conf-range]").forEach((c) => c.classList.toggle("is-active", c.dataset.confRange === kind));
}

async function load() {
  if (!getApiKey()) {
    hooks.needKey?.();
    render();
    return;
  }
  if (!C.from || !C.to || C.to < C.from) {
    toast("Informe um período válido.", "error");
    return;
  }
  C.loading = true;
  C.error = "";
  render();
  try {
    C.entries = await bm.conference(C.from, C.to);
    C.loaded = true;
  } catch (e) {
    C.error = e.message;
    C.entries = [];
  } finally {
    C.loading = false;
    fillFilters();
    render();
  }
}

// ---------- filtros ----------

function fillFilters() {
  const boards = new Map();
  const cats = new Map();
  let hasNoCategory = false;
  for (const e of C.entries) {
    if (e.board_id) boards.set(e.board_id, e.board_name || `Quadro ${e.board_id}`);
    if (e.category_id) cats.set(e.category_id, e.category_label || `Categoria ${e.category_id}`);
    else hasNoCategory = true;
  }
  const sortByLabel = (a, b) => a[1].localeCompare(b[1], "pt-BR");

  const boardSel = $("#conf-board");
  boardSel.innerHTML = `<option value="">Todos os quadros</option>${[...boards].sort(sortByLabel).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("")}`;
  if (![...boards.keys()].map(String).includes(C.board)) C.board = "";
  boardSel.value = C.board;

  const catSel = $("#conf-category");
  catSel.innerHTML = `<option value="">Todas as categorias</option>${[...cats].sort(sortByLabel).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("")}${hasNoCategory ? `<option value="none">Sem categoria</option>` : ""}`;
  if (C.category && C.category !== "none" && !cats.has(Number(C.category))) C.category = "";
  catSel.value = C.category;

  $("#conf-filters").hidden = !C.entries.length;
}

function filtered() {
  const q = normalizeLabel(C.q);
  return C.entries.filter((e) => {
    if (C.board && String(e.board_id) !== C.board) return false;
    if (C.category === "none" && e.category_id) return false;
    if (C.category && C.category !== "none" && String(e.category_id) !== C.category) return false;
    if (q) {
      const hay = normalizeLabel(`${e.card_id} ${e.custom_id || ""} ${e.card_title} ${e.subtask_description || ""} ${e.comment || ""} ${e.board_name || ""}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------- renderização ----------

const dayLabel = (iso) => `${isoToBr(iso)} · ${WEEKDAYS_SHORT[weekdayIndex(iso)]}`;
const cardRef = (e) => e.custom_id || `#${e.card_id}`;
const sum = (list) => list.reduce((a, e) => a + (e.minutes || 0), 0);

function render() {
  const list = $("#conf-list");
  const summary = $("#conf-summary");

  if (!getApiKey()) {
    summary.innerHTML = "";
    list.innerHTML = `<div class="empty-state">${icon("settings")}<p>Configure sua API Key do Businessmap para conferir os lançamentos.</p><button type="button" class="btn btn-primary" data-conf-act="settings">Abrir configurações</button></div>`;
    return;
  }
  if (C.loading) {
    summary.innerHTML = "";
    list.innerHTML = `<div class="list-state"><span class="spinner spinner-sm"></span> Buscando lançamentos no Businessmap…</div>`;
    return;
  }
  if (C.error) {
    summary.innerHTML = "";
    list.innerHTML = `<div class="alert alert-error">${icon("alert")} <div>${esc(C.error)} <button type="button" class="btn btn-ghost btn-sm" data-conf-act="reload">Tentar de novo</button></div></div>`;
    return;
  }
  if (!C.loaded) {
    summary.innerHTML = "";
    list.innerHTML = `<div class="list-state">Escolha o período e clique em “Buscar lançamentos”.</div>`;
    return;
  }

  const items = filtered();
  const days = new Set(items.map((e) => e.date));
  const cards = new Set(items.map((e) => e.card_id));
  const total = sum(items);
  summary.innerHTML = `
    <div class="stat"><span class="stat-label">Lançamentos</span><strong class="stat-value">${items.length}</strong>${items.length !== C.entries.length ? `<span class="stat-sub">de ${C.entries.length} no período</span>` : ""}</div>
    <div class="stat"><span class="stat-label">Total lançado</span><strong class="stat-value">${minutesToHHMM(total)}</strong><span class="stat-sub">${minutesToDecimal(total)} h</span></div>
    <div class="stat"><span class="stat-label">Dias com lançamento</span><strong class="stat-value">${days.size}</strong></div>
    <div class="stat"><span class="stat-label">Cards</span><strong class="stat-value">${cards.size}</strong></div>`;

  if (!items.length) {
    list.innerHTML = `<div class="list-state">${C.entries.length ? "Nenhum lançamento corresponde aos filtros." : `Nenhum lançamento seu entre ${isoToBr(C.from)} e ${isoToBr(C.to)}.`}</div>`;
    return;
  }

  list.innerHTML = C.group === "card" ? renderByCard(items) : renderByDay(items);
}

function entryHtml(e, context) {
  const lead = context === "card"
    ? `<span class="entry-path">${esc(dayLabel(e.date))}</span>`
    : `<span class="entry-path">${esc(e.board_name || "Quadro")} <span aria-hidden="true">›</span> ${esc(cardRef(e))}</span>`;
  return `
    <article class="entry">
      <div class="entry-main">
        ${lead}
        ${context === "card" ? "" : `<strong class="entry-title">${esc(e.card_title)}</strong>`}
        ${e.subtask_id ? `<span class="entry-sub">Subtarefa: ${esc(e.subtask_description || `#${e.subtask_id}`)}</span>` : ""}
        <div class="entry-tags">
          ${e.category_id ? `<span class="tag">${esc(e.category_label || `Categoria ${e.category_id}`)}</span>` : `<span class="tag tag-muted">Sem categoria</span>`}
          ${e.comment ? `<span class="entry-comment" title="${esc(e.comment)}">“${esc(e.comment)}”</span>` : ""}
        </div>
      </div>
      <div class="entry-side">
        <span class="entry-time">${minutesToHHMM(e.minutes)}<small>${minutesToDecimal(e.minutes)} h</small></span>
        <button type="button" class="btn btn-secondary btn-sm" data-conf-act="edit" data-id="${e.logged_time_id}" aria-label="Editar lançamento de ${esc(isoToBr(e.date))} em ${esc(e.card_title)}">${icon("edit")} Editar</button>
      </div>
    </article>`;
}

function renderByDay(items) {
  const byDay = new Map();
  for (const e of items) {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }
  return [...byDay.keys()].sort().reverse().map((iso) => {
    const rows = byDay.get(iso);
    const total = sum(rows);
    const worked = hooks.workedMinutes?.(iso);
    let compare = "";
    if (worked != null && !C.board && !C.category && !C.q) {
      const diff = total - worked;
      compare = diff === 0
        ? `<span class="status status-done">${icon("check")} Confere com o trabalhado</span>`
        : `<span class="status status-partial">Trabalhado ${minutesToHHMM(worked)} · ${diff > 0 ? "lançado a mais" : "falta lançar"} ${minutesToHHMM(Math.abs(diff))}</span>`;
    }
    return `
      <section class="conf-group">
        <header class="conf-group-head">
          <div><strong>${esc(dayLabel(iso))}</strong>${compare}</div>
          <span class="conf-group-total">${minutesToHHMM(total)}</span>
        </header>
        ${rows.map((e) => entryHtml(e, "day")).join("")}
      </section>`;
  }).join("");
}

function renderByCard(items) {
  const byCard = new Map();
  for (const e of items) {
    if (!byCard.has(e.card_id)) byCard.set(e.card_id, []);
    byCard.get(e.card_id).push(e);
  }
  return [...byCard.values()]
    .sort((a, b) => sum(b) - sum(a))
    .map((rows) => {
      const e = rows[0];
      rows.sort((a, b) => b.date.localeCompare(a.date));
      return `
        <section class="conf-group">
          <header class="conf-group-head">
            <div>
              <span class="entry-path">${esc(e.board_name || "Quadro")} <span aria-hidden="true">›</span> ${esc(cardRef(e))}</span>
              <strong>${esc(e.card_title)}</strong>
            </div>
            <span class="conf-group-total">${minutesToHHMM(sum(rows))}</span>
          </header>
          ${rows.map((r) => entryHtml(r, "card")).join("")}
        </section>`;
    }).join("");
}

// ---------- edição ----------

/** "2026-11-05 10:00:00" → "05/11/2026 às 10:00" */
function formatLoggedAt(value) {
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${isoToBr(m[1])} às ${m[2]}` : String(value);
}

async function openEditor(entry) {
  editing = entry;
  const dialog = $("#entry-dialog");
  $("#entry-info").innerHTML = `
    <span class="entry-path">${esc(entry.board_name || "Quadro")} › ${esc(cardRef(entry))}</span>
    <strong>${esc(entry.card_title)}</strong>
    ${entry.subtask_id ? `<span class="entry-sub">Subtarefa: ${esc(entry.subtask_description || `#${entry.subtask_id}`)}</span>` : ""}
    ${entry.logged_at ? `<span class="muted small">Registrado em ${esc(formatLoggedAt(entry.logged_at))}</span>` : ""}`;
  $("#entry-time").value = minutesToHHMM(entry.minutes);
  $("#entry-date").value = entry.date;
  $("#entry-comment").value = entry.comment || "";
  $("#entry-error").hidden = true;

  const sel = $("#entry-category");
  const current = entry.category_id
    ? `<option value="${entry.category_id}" selected>${esc(entry.category_label || `Categoria ${entry.category_id}`)}</option>`
    : "";
  sel.innerHTML = `<option value="">Nenhuma</option>${current}`;
  sel.value = entry.category_id ? String(entry.category_id) : "";
  updateNote();
  openDialog(dialog);

  if (entry.board_id) {
    try {
      const cats = await bm.categories(entry.board_id);
      if (editing !== entry) return;
      const options = [...cats];
      if (entry.category_id && !options.some((c) => c.category_id === entry.category_id)) {
        options.push({ category_id: entry.category_id, label: entry.category_label || `Categoria ${entry.category_id}` });
      }
      const chosen = sel.value;
      sel.innerHTML = `<option value="">Nenhuma</option>${options.map((c) => `<option value="${c.category_id}">${esc(c.label)}</option>`).join("")}`;
      sel.value = chosen;
    } catch {
      /* mantém só a categoria atual */
    }
  }
}

/** "1:30" | "01:30" | "1h30" | "1h" | "45m" | "1,5" | "2" (horas) → minutos; inválido → null. */
export function parseEditTime(value) {
  const s = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes(":")) return parseDuration(s);
  let m = s.match(/^(\d{1,2})h(?:(\d{1,2})m?)?$/);
  if (m) return Number(m[2] || 0) > 59 ? null : Number(m[1]) * 60 + Number(m[2] || 0);
  m = s.match(/^(\d{1,4})m(in)?$/);
  if (m) return Number(m[1]);
  m = s.match(/^\d{1,2}(?:[.,]\d{1,4})?$/);
  if (m) return Math.round(Number(s.replace(",", ".")) * 60);
  return null;
}

function formValues() {
  const minutes = parseEditTime($("#entry-time").value);
  return {
    minutes,
    date: $("#entry-date").value,
    category_id: Number($("#entry-category").value) || null,
    comment: $("#entry-comment").value.trim(),
  };
}

/** A API não aceita category_id nulo no PATCH: remover a categoria exige recriar. */
function needsRecreate(v) {
  return !!editing.category_id && !v.category_id;
}

function categoryLabel(id) {
  if (!id) return null;
  return [...$("#entry-category").options].find((o) => Number(o.value) === id)?.textContent || `Categoria ${id}`;
}

function updateNote() {
  if (!editing) return;
  const note = $("#entry-note");
  const recreate = needsRecreate(formValues());
  note.hidden = !recreate;
  note.innerHTML = recreate
    ? `${icon("alert")} <div>O Businessmap não permite remover a categoria de um lançamento. Ao salvar, um <strong>novo lançamento</strong> sem categoria será cadastrado e o atual será <strong>excluído</strong>.</div>`
    : "";
  $("#entry-save").textContent = recreate ? "Recriar lançamento" : "Salvar";
}

function showError(message) {
  const el = $("#entry-error");
  el.innerHTML = `${icon("alert")} <div>${esc(message)}</div>`;
  el.hidden = false;
}

function changedFields(v, entry) {
  const patch = {};
  if (v.minutes !== entry.minutes) patch.minutes = v.minutes;
  if (v.comment !== (entry.comment || "")) patch.comment = v.comment;
  if (v.date !== entry.date) patch.date = v.date;
  if (v.category_id && v.category_id !== entry.category_id) patch.category_id = v.category_id;
  return patch;
}

/** Cria um novo lançamento com os dados do formulário e exclui o antigo. */
async function recreate(entry, v) {
  const result = await bm.recreateEntry(entry.logged_time_id, {
    card_id: entry.card_id,
    subtask_id: entry.subtask_id || null,
    category_id: v.category_id,
    date: v.date,
    minutes: v.minutes,
    comment: v.comment,
  });
  const created = {
    ...entry,
    logged_time_id: result.created.logged_time_id,
    date: v.date,
    minutes: v.minutes,
    comment: v.comment,
    category_id: v.category_id,
    category_label: categoryLabel(v.category_id),
    logged_at: null,
  };
  if (result.deleted) C.entries = C.entries.filter((e) => e.logged_time_id !== entry.logged_time_id);
  if (created.date >= C.from && created.date <= C.to) C.entries.push(created);
  hooks.onChanged?.({ type: result.deleted ? "recreate" : "create", oldId: entry.logged_time_id, entry: created });
  toast(result.deleted ? "Lançamento recriado." : result.warning, result.deleted ? "success" : "warn", result.deleted ? 3500 : 8000);
}

async function save() {
  const v = formValues();
  if (v.minutes === null || v.minutes <= 0 || v.minutes > 24 * 60) return showError("Informe um tempo válido entre 00:01 e 24:00 (ex.: 01:30, 1h30, 45m).");
  if (!v.date) return showError("Informe a data.");

  const btn = $("#entry-save");
  btn.disabled = true;
  $("#entry-error").hidden = true;
  const entry = editing;
  try {
    if (needsRecreate(v)) {
      await recreate(entry, v);
    } else {
      const patch = changedFields(v, entry);
      if (Object.keys(patch).length) {
        try {
          await bm.updateEntry(entry.logged_time_id, patch);
        } catch (e) {
          // Se o Businessmap recusar a mudança de data/categoria, oferece recriar.
          const structural = "date" in patch || "category_id" in patch;
          if (!structural || [0, 401, 429].includes(e.status) || e.status >= 500) throw e;
          closeDialog($("#entry-dialog"));
          const ok = await confirmDialog({
            title: "Businessmap recusou a alteração",
            message: `<p>${esc(e.message)}</p><p>Posso <strong>cadastrar um novo lançamento</strong> com estes dados e <strong>excluir o atual</strong>. Deseja fazer isso?</p>`,
            confirmLabel: "Recriar lançamento",
          });
          if (!ok) {
            openEditor(entry);
            return;
          }
          await recreate(entry, v);
          fillFilters();
          render();
          return;
        }
        const moved = "date" in patch;
        Object.assign(entry, {
          minutes: v.minutes,
          comment: v.comment,
          date: v.date,
          ...("category_id" in patch ? { category_id: v.category_id, category_label: categoryLabel(v.category_id) } : {}),
        });
        if (moved && (entry.date < C.from || entry.date > C.to)) {
          C.entries = C.entries.filter((e) => e !== entry);
        }
        hooks.onChanged?.({ type: "update", oldId: entry.logged_time_id, entry });
        toast(moved && (entry.date < C.from || entry.date > C.to)
          ? `Lançamento atualizado e movido para ${isoToBr(entry.date)} (fora do período exibido).`
          : "Lançamento atualizado.", "success", 4500);
      }
    }
    C.entries.sort((a, b) => a.date.localeCompare(b.date));
    closeDialog($("#entry-dialog"));
    fillFilters();
    render();
  } catch (e) {
    if (!$("#entry-dialog").open) openEditor(entry).then(() => showError(e.message || "Não foi possível salvar."));
    else showError(e.message || "Não foi possível salvar.");
  } finally {
    btn.disabled = false;
  }
}
async function remove(entry) {
  const ok = await confirmDialog({
    title: "Excluir lançamento",
    message: `<p>Excluir <strong>${minutesToHHMM(entry.minutes)}</strong> de <strong>${esc(isoToBr(entry.date))}</strong> em <strong>${esc(entry.card_title)}</strong>${entry.subtask_id ? ` (subtarefa: ${esc(entry.subtask_description || entry.subtask_id)})` : ""}?</p><p class="muted">Essa ação não pode ser desfeita no Businessmap.</p>`,
    confirmLabel: "Excluir",
    danger: true,
  });
  if (!ok) {
    openEditor(entry);
    return;
  }
  try {
    await bm.deleteEntry(entry.logged_time_id);
    C.entries = C.entries.filter((e) => e.logged_time_id !== entry.logged_time_id);
    hooks.onChanged?.({ type: "delete", oldId: entry.logged_time_id });
    toast("Lançamento excluído.", "success");
    fillFilters();
    render();
  } catch (e) {
    toast(e.message || "Não foi possível excluir.", "error", 6000);
  }
}

// ---------- eventos ----------

function bind() {
  $$("[data-conf-range]").forEach((chip) =>
    chip.addEventListener("click", () => {
      setRange(chip.dataset.confRange);
      load();
    }),
  );

  ["#conf-from", "#conf-to"].forEach((sel) =>
    $(sel).addEventListener("input", () => $$("[data-conf-range]").forEach((c) => c.classList.remove("is-active"))),
  );

  $("#conf-form").addEventListener("submit", (e) => {
    e.preventDefault();
    C.from = $("#conf-from").value;
    C.to = $("#conf-to").value;
    load();
  });

  $("#conf-board").addEventListener("change", (e) => { C.board = e.target.value; render(); });
  $("#conf-category").addEventListener("change", (e) => { C.category = e.target.value; render(); });
  $("#conf-q").addEventListener("input", (e) => { C.q = e.target.value; render(); });

  $$("[data-conf-group]").forEach((btn) =>
    btn.addEventListener("click", () => {
      C.group = btn.dataset.confGroup;
      $$("[data-conf-group]").forEach((b) => b.classList.toggle("is-active", b === btn));
      render();
    }),
  );

  $("#conf-list").addEventListener("click", (e) => {
    const el = e.target.closest("[data-conf-act]");
    if (!el) return;
    if (el.dataset.confAct === "edit") {
      const entry = C.entries.find((x) => x.logged_time_id === Number(el.dataset.id));
      if (entry) openEditor(entry);
    } else if (el.dataset.confAct === "reload") load();
    else if (el.dataset.confAct === "settings") hooks.needKey?.();
  });

  const form = $("#entry-form");
  form.addEventListener("input", updateNote);
  form.addEventListener("change", updateNote);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
  $("#entry-delete").addEventListener("click", () => {
    const entry = editing;
    if (!entry) return;
    closeDialog($("#entry-dialog"));
    remove(entry);
  });
}
