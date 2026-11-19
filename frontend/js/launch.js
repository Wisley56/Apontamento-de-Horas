/**
 * Fluxo de lançamento no Businessmap:
 *   1. modo      → "Tudo em uma atividade" ou "Dividir entre atividades"
 *   2. escolha   → seletor de cards (Meus cards / Por quadro / Recentes) + divisão
 *   3. revisão   → lançamentos por dia, categoria, aviso de horas já lançadas
 *   4. envio     → createMany (transação única: tudo ou nada)
 */

import { bm, ApiError } from "./api.js";
import { minutesToHHMM, minutesToDecimal, parseDuration, splitMinutes, allocationRemaining, isoToBr, WEEKDAYS_SHORT, weekdayIndex } from "./hours.js";
import { esc, icon, $, openDialog, closeDialog, storage, toast, normalizeLabel } from "./ui.js";

const RECENT_KEY = "bm_recent_cards";
const MAX_RESULTS = 60;

let L = null;          // estado do fluxo atual
let ctx = null;        // callbacks fornecidos pelo app
let dialog, content, footer, subtitle;

/**
 * @param {{iso:string, minutes:number, tipo:string}[]} days  dias a lançar (minutos pendentes de cada um)
 * @param {{ otherPending: () => {iso:string, minutes:number, tipo:string}[], onLaunched: (created:any[], items:any[]) => void }} context
 */
export function openLaunch(days, context) {
  dialog = $("#launch-dialog");
  content = $("#launch-content");
  footer = $("#launch-footer");
  subtitle = $("#launch-subtitle");
  ctx = context;

  L = {
    days: days.filter((d) => d.minutes > 0),
    screen: "mode",
    mode: null,
    unit: days.length > 1 ? "percent" : "hours",
    allocations: [],
    applyToOthers: false,
    comment: "",
    tab: "mine",
    boardId: storage.get("bm_last_board", null),
    query: "",
    boards: [],
    cards: [],
    cardsLoading: false,
    cardsError: "",
    openCard: null,    // card aberto na tela de subtarefas
    subtasks: {},      // card_id → { loading, items, error }
    categories: {},    // board_id → { loading, items, error } (categorias de tempo do quadro)
    review: null,
    sending: false,
    error: "",
  };

  if (!L.days.length) {
    toast("Não há horas pendentes para lançar nesses dias.", "info");
    return;
  }

  if (!dialog.dataset.bound) bind();
  render();
  openDialog(dialog);
}

// ---------- utilidades ----------

const totalMinutes = () => L.days.reduce((a, d) => a + d.minutes, 0);
const dayLabel = (iso) => `${isoToBr(iso).slice(0, 5)} ${WEEKDAYS_SHORT[weekdayIndex(iso)]}`;
const boardName = (id) => L.boards.find((b) => b.board_id === id)?.name || "";
const allocKey = (a) => `${a.card.card_id}:${a.subtask?.subtask_id || ""}`;

function cardLabel(card) {
  const id = card.custom_id ? `${card.custom_id}` : `#${card.card_id}`;
  return `${id} · ${card.title || "(sem título)"}`;
}

function getRecent() {
  const list = storage.get(RECENT_KEY, []);
  return Array.isArray(list) ? list : [];
}

function pushRecent(cards) {
  const seen = new Set();
  const merged = [...cards, ...getRecent()].filter((c) => {
    if (!c?.card_id || seen.has(c.card_id)) return false;
    seen.add(c.card_id);
    return true;
  });
  storage.set(RECENT_KEY, merged.slice(0, 8).map(({ card_id, custom_id, title, board_id, unfinished_subtask_count }) => ({ card_id, custom_id, title, board_id, unfinished_subtask_count })));
}

function filteredCards() {
  const q = normalizeLabel(L.query);
  const list = L.tab === "recent" ? getRecent() : L.cards;
  if (!q) return list.slice(0, MAX_RESULTS);
  return list
    .filter((c) => normalizeLabel(`${c.card_id} ${c.custom_id || ""} ${c.title || ""}`).includes(q))
    .slice(0, MAX_RESULTS);
}

/** Restante da divisão: minutos (unidade horas) ou pontos percentuais. */
function remaining() {
  if (L.mode === "single") return L.allocations.length ? 0 : 1;
  if (L.unit === "hours") return allocationRemaining(L.days[0].minutes, L.allocations.map((a) => a.value));
  const sum = L.allocations.reduce((s, a) => s + (Number(a.value) || 0), 0);
  return Math.round((100 - sum) * 100) / 100;
}

/** Texto e estilo do indicador da divisão. */
function restInfo() {
  const rest = remaining();
  const label = L.unit === "hours" ? minutesToHHMM(Math.abs(rest)) : `${Math.abs(rest).toLocaleString("pt-BR")}%`;
  if (rest > 0) return { cls: "is-left", text: `Faltam ${label}` };
  if (rest < 0) return { cls: "is-over", text: `Passou ${label}` };
  if (L.allocations.some((a) => !(Number(a.value) > 0))) return { cls: "is-left", text: "Há atividade sem tempo. Ajuste ou remova." };
  return { cls: "is-ok", text: "Divisão completa" };
}

function canReview() {
  if (!L.allocations.length) return false;
  if (L.mode === "single") return true;
  if (L.allocations.some((a) => !(Number(a.value) > 0))) return false;
  return remaining() === 0;
}

// ---------- carregamento de dados ----------

async function loadCards({ refresh = false } = {}) {
  L.cardsLoading = true;
  L.cardsError = "";
  render();
  try {
    if (!L.boards.length) L.boards = await bm.boards();
    if (L.tab === "mine") L.cards = await bm.myCards({ refresh });
    else if (L.tab === "board" && L.boardId) L.cards = await bm.boardCards(L.boardId, { refresh });
    else L.cards = [];
  } catch (e) {
    L.cardsError = e.message;
    L.cards = [];
  } finally {
    L.cardsLoading = false;
    render();
  }
}

async function openCard(card) {
  L.openCard = card;
  L.subQuery = "";
  render();
  content.querySelector(".picker")?.scrollIntoView({ block: "nearest" });
  if (L.subtasks[card.card_id] && !L.subtasks[card.card_id].error) return;
  L.subtasks[card.card_id] = { loading: true, items: [] };
  render();
  try {
    const items = await bm.subtasks(card.card_id);
    L.subtasks[card.card_id] = { loading: false, items: items.filter((s) => !s.finished) };
  } catch (e) {
    L.subtasks[card.card_id] = { loading: false, items: [], error: e.message };
  }
  if (L.openCard?.card_id === card.card_id) render();
}

function closeCard() {
  L.openCard = null;
  render();
}

function isPicked(card, subtask = null) {
  const key = `${card.card_id}:${subtask?.subtask_id || ""}`;
  return L.allocations.some((a) => allocKey(a) === key);
}

// ---------- categorias de tempo (por quadro) ----------

const LAST_CATEGORY_KEY = "bm_last_category"; // { board_id: category_id }

function categoriesOf(boardId) {
  return L.categories[boardId] || { loading: true, items: [] };
}

async function ensureCategories(boardId) {
  if (!boardId || (L.categories[boardId] && !L.categories[boardId].error)) return;
  L.categories[boardId] = { loading: true, items: [] };
  try {
    L.categories[boardId] = { loading: false, items: await bm.categories(boardId) };
  } catch (e) {
    L.categories[boardId] = { loading: false, items: [], error: e.message };
  }
  // Preenche o padrão das atividades deste quadro que ainda não têm categoria.
  for (const a of L.allocations) {
    if (a.card.board_id === boardId && a.category_id === undefined) a.category_id = defaultCategory(boardId);
  }
  if (L.screen === "pick") render();
}

/** Padrão: última categoria usada no quadro; senão, a que tem o mesmo nome do Tipo do dia. */
function defaultCategory(boardId) {
  const cats = L.categories[boardId]?.items;
  if (!cats) return undefined; // ainda carregando
  const last = (storage.get(LAST_CATEGORY_KEY, {}) || {})[boardId];
  if (last && cats.some((c) => c.category_id === last)) return last;
  const tipo = L.days[0]?.tipo;
  const match = tipo ? cats.find((c) => normalizeLabel(c.label) === normalizeLabel(tipo)) : null;
  return match ? match.category_id : null;
}

function rememberCategory(boardId, categoryId) {
  const map = storage.get(LAST_CATEGORY_KEY, {}) || {};
  if (categoryId) map[boardId] = categoryId;
  else delete map[boardId];
  storage.set(LAST_CATEGORY_KEY, map);
}

function categorySelect(a, i) {
  const st = categoriesOf(a.card.board_id);
  const id = `alloc-cat-${i}`;
  if (st.loading) return `<span class="cat-state muted small"><span class="spinner spinner-sm"></span> Categorias…</span>`;
  if (st.error) return `<span class="cat-state is-error small">Categorias indisponíveis</span>`;
  if (!st.items.length) return `<span class="cat-state muted small">Quadro sem categorias de tempo</span>`;
  return `
    <label class="cat-field" for="${id}">
      <span class="cat-label">Categoria</span>
      <select id="${id}" class="select-sm" data-act="alloc-cat" data-i="${i}">
        <option value="">Nenhuma</option>
        ${st.items.map((c) => `<option value="${c.category_id}" ${c.category_id === a.category_id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}
      </select>
    </label>`;
}

// ---------- seleção ----------

function findCard(id) {
  return L.cards.find((c) => c.card_id === id) || getRecent().find((c) => c.card_id === id);
}

function pick(card, subtask = null) {
  const alloc = { card, subtask, value: 0, category_id: defaultCategory(card.board_id) };
  ensureCategories(card.board_id);
  if (L.mode === "single") {
    // Mantém a categoria já escolhida se continuar no mesmo quadro.
    const prev = L.allocations[0];
    if (prev && prev.card.board_id === card.board_id && prev.category_id !== undefined) alloc.category_id = prev.category_id;
    L.allocations = [{ ...alloc, value: 100 }];
  } else {
    const existing = L.allocations.findIndex((a) => allocKey(a) === allocKey(alloc));
    if (existing >= 0) {
      // Clicar de novo em um item já escolhido remove-o da divisão.
      L.allocations.splice(existing, 1);
      render();
      return;
    }
    const rest = remaining();
    L.allocations.push(alloc);
    if (rest > 0) alloc.value = rest;
    else return distributeEvenly(); // sem tempo sobrando: reparte igualmente entre todas
  }
  render();
}

function distributeEvenly() {
  const n = L.allocations.length;
  if (!n) return;
  if (L.unit === "hours") {
    splitMinutes(L.days[0].minutes, L.allocations.map(() => 1)).forEach((m, i) => (L.allocations[i].value = m));
  } else {
    const base = Math.floor((100 / n) * 100) / 100;
    L.allocations.forEach((a, i) => (a.value = i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base));
  }
  render();
}

function setUnit(unit) {
  if (unit === L.unit) return;
  const total = L.days[0].minutes;
  if (unit === "percent") {
    L.allocations.forEach((a) => (a.value = Math.round(((Number(a.value) || 0) / total) * 10000) / 100));
  } else {
    const mins = splitMinutes(total, L.allocations.map((a) => Number(a.value) || 0));
    L.allocations.forEach((a, i) => (a.value = mins[i]));
  }
  L.unit = unit;
  render();
}

// ---------- revisão ----------

async function buildReview() {
  const days = [...L.days];
  if (L.applyToOthers && ctx.otherPending) {
    const known = new Set(days.map((d) => d.iso));
    for (const d of ctx.otherPending()) if (!known.has(d.iso) && d.minutes > 0) days.push(d);
    days.sort((a, b) => a.iso.localeCompare(b.iso));
  }

  const weights = L.allocations.map((a) => (L.mode === "single" ? 1 : Number(a.value) || 0));
  const items = [];
  for (const day of days) {
    let minutesList;
    if (L.mode === "single") minutesList = [day.minutes];
    // Em horas, o dia de origem usa exatamente o informado; os demais dias ("aplicar aos
    // outros") recebem a mesma proporção, sempre fechando no total de cada dia.
    else if (L.unit === "hours" && day.iso === L.days[0].iso) minutesList = L.allocations.map((a) => Number(a.value));
    else minutesList = splitMinutes(day.minutes, weights);

    L.allocations.forEach((a, idx) => {
      const minutes = minutesList[idx] || 0;
      if (minutes <= 0) return;
      const category = a.category_id
        ? categoriesOf(a.card.board_id).items.find((c) => c.category_id === a.category_id) || null
        : null;
      items.push({ iso: day.iso, tipo: day.tipo || "", card: a.card, subtask: a.subtask, minutes, category });
    });
  }

  // Tipo (Melhoria/Correção/Suporte) só vai no comentário quando não há categoria escolhida.
  for (const it of items) {
    const prefix = it.tipo && !it.category ? `[${it.tipo}] ` : "";
    it.comment = `${prefix}${L.comment.trim()}`.trim();
  }

  // Horas que já existem no Businessmap nesses dias (evita lançamento em dobro).
  let existing = {};
  let existingError = "";
  try {
    const isos = days.map((d) => d.iso);
    const entries = await bm.loggedTime(isos[0], isos[isos.length - 1]);
    for (const e of entries) existing[e.date] = (existing[e.date] || 0) + (e.minutes || 0);
  } catch (e) {
    existingError = e.message;
    existing = {};
  }

  return { days, items, existing, existingError };
}

async function goReview() {
  L.screen = "review";
  L.review = null;
  L.error = "";
  render();
  try {
    L.review = await buildReview();
  } catch (e) {
    L.error = e.message;
  }
  render();
}

async function send() {
  if (!L.review || L.sending) return;
  L.sending = true;
  L.error = "";
  render();
  const payload = L.review.items.map((it) => ({
    card_id: it.card.card_id,
    subtask_id: it.subtask?.subtask_id || null,
    category_id: it.category?.category_id || null,
    date: it.iso,
    minutes: it.minutes,
    comment: it.comment,
  }));
  try {
    const result = await bm.createBatch(payload);
    pushRecent(L.allocations.map((a) => a.card));
    ctx.onLaunched?.(result.created || [], L.review.items);
    L.screen = "done";
    L.result = result;
  } catch (e) {
    L.error = e instanceof ApiError ? e.message : "Falha ao enviar os lançamentos.";
  } finally {
    L.sending = false;
    render();
  }
}

// ---------- renderização ----------

function render() {
  subtitle.textContent =
    L.days.length === 1
      ? `${isoToBr(L.days[0].iso)} · ${minutesToHHMM(L.days[0].minutes)} a lançar`
      : `${L.days.length} dias · ${minutesToHHMM(totalMinutes())} a lançar`;

  // No passo de escolha, só a lista rola (cabeçalho, divisão e comentário ficam visíveis).
  const listScreen = L.screen === "pick";
  const listEl = content.querySelector(".pick-list");
  const keepScroll = listScreen && listEl ? { key: L.openCard?.card_id ?? "cards", top: listEl.scrollTop } : null;
  content.classList.toggle("launch-pick", listScreen);
  dialog.classList.toggle("dialog-tall", listScreen);

  if (L.screen === "mode") renderMode();
  else if (L.screen === "pick") {
    renderPick();
    const next = content.querySelector(".pick-list");
    if (next && keepScroll && keepScroll.key === (L.openCard?.card_id ?? "cards")) next.scrollTop = keepScroll.top;
  }
  else if (L.screen === "review") renderReview();
  else renderDone();
}

function renderMode() {
  content.innerHTML = `
    <p class="lead">Como você quer lançar ${L.days.length === 1 ? "essas horas" : "as horas desses dias"}?</p>
    <div class="choice-grid">
      <button type="button" class="choice" data-act="mode" data-mode="single">
        ${icon("target", "choice-icon")}
        <strong>Tudo em uma atividade</strong>
        <span>${minutesToHHMM(totalMinutes())} em um único card${L.days.length > 1 ? ", em cada dia" : ""}.</span>
      </button>
      <button type="button" class="choice" data-act="mode" data-mode="split">
        ${icon("split", "choice-icon")}
        <strong>Dividir entre atividades</strong>
        <span>Distribua o tempo entre cards ${L.days.length > 1 ? "por percentual" : "em horas ou percentual"}.</span>
      </button>
    </div>
    ${L.days.length > 1 ? `<ul class="day-pills">${L.days.map((d) => `<li>${esc(dayLabel(d.iso))} <strong>${minutesToHHMM(d.minutes)}</strong></li>`).join("")}</ul>` : ""}
  `;
  footer.innerHTML = `<button type="button" class="btn btn-secondary" data-close>Cancelar</button>`;
}

function renderAllocations() {
  if (L.mode === "single") {
    const a = L.allocations[0];
    return `
      <div class="selected-box ${a ? "" : "is-empty"}">
        <span class="muted small">Atividade escolhida</span>
        ${a ? `<div class="selected-card"><strong>${esc(cardLabel(a.card))}</strong>${a.subtask ? `<span class="muted">Subtarefa: ${esc(a.subtask.description)}</span>` : ""}${boardName(a.card.board_id) ? `<span class="muted small">${esc(boardName(a.card.board_id))}</span>` : ""}</div>
        <div class="alloc-controls">${categorySelect(a, 0)}</div>` : `<span>Escolha um card na lista abaixo.</span>`}
      </div>`;
  }

  const single = L.days.length === 1;
  const total = L.days[0].minutes;
  const { cls: restClass, text: restText } = restInfo();

  return `
    <div class="split-box">
      <div class="split-head">
        <span class="muted small">Divisão ${single ? `de ${minutesToHHMM(total)}` : "aplicada a cada dia"}</span>
        ${single ? `
        <div class="segmented" role="group" aria-label="Unidade da divisão">
          <button type="button" class="${L.unit === "hours" ? "is-active" : ""}" data-act="unit" data-unit="hours">Horas</button>
          <button type="button" class="${L.unit === "percent" ? "is-active" : ""}" data-act="unit" data-unit="percent">%</button>
        </div>` : ""}
      </div>
      ${L.allocations.length ? `
      <ul class="alloc-list">
        ${L.allocations.map((a, i) => `
          <li class="alloc">
            <div class="alloc-card">
              <strong>${esc(cardLabel(a.card))}</strong>
              ${a.subtask ? `<span class="muted small">Subtarefa: ${esc(a.subtask.description)}</span>` : ""}
            </div>
            <div class="alloc-controls">
            ${categorySelect(a, i)}
            <div class="alloc-value">
              ${L.unit === "hours"
                ? `<input type="text" inputmode="numeric" class="input-sm" value="${minutesToHHMM(a.value)}" data-act="alloc-hours" data-i="${i}" aria-label="Horas para ${esc(a.card.title)}" placeholder="00:00" />`
                : `<input type="number" class="input-sm" min="0" max="100" step="0.01" value="${a.value}" data-act="alloc-pct" data-i="${i}" aria-label="Percentual para ${esc(a.card.title)}" /><span class="unit">%</span>`}
              ${L.unit === "percent" && single ? `<span class="muted small">${minutesToHHMM(splitMinutes(total, L.allocations.map((x) => Number(x.value) || 0))[i] || 0)}</span>` : ""}
            </div>
            </div>
            <button type="button" class="btn-icon" data-act="alloc-remove" data-i="${i}" aria-label="Remover">${icon("trash")}</button>
          </li>`).join("")}
      </ul>
      <div class="split-foot">
        <span class="rest ${restClass}">${restText}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="even">Dividir igualmente</button>
      </div>` : `<p class="muted">Adicione duas ou mais atividades da lista abaixo.</p>`}
    </div>`;
}

function renderPicker() {
  const cards = filteredCards();
  const tabs = [
    ["mine", "Meus cards"],
    ["board", "Por quadro"],
    ["recent", "Recentes"],
  ];
  let list;
  if (L.cardsLoading && L.tab !== "recent") list = `<div class="list-state"><span class="spinner spinner-sm"></span> Carregando cards…</div>`;
  else if (L.cardsError && L.tab !== "recent") list = `<div class="list-state is-error">${esc(L.cardsError)} <button type="button" class="btn btn-ghost btn-sm" data-act="reload">Tentar de novo</button></div>`;
  else if (L.tab === "board" && !L.boardId) list = `<div class="list-state">Selecione um quadro.</div>`;
  else if (!cards.length) list = `<div class="list-state">${L.query ? "Nenhum card encontrado para a busca." : L.tab === "recent" ? "Você ainda não lançou horas por aqui." : "Nenhum card ativo encontrado."}</div>`;
  else {
    list = `<ul class="pick-list" role="list">${cards.map((c) => {
      const hasSubs = c.unfinished_subtask_count > 0;
      const pickedHere = L.allocations.filter((a) => a.card.card_id === c.card_id);
      const selected = pickedHere.length > 0;
      const meta = `${esc(c.custom_id || `#${c.card_id}`)}${boardName(c.board_id) && L.tab !== "board" ? ` · ${esc(boardName(c.board_id))}` : ""}`;
      return `
      <li>
        <button type="button" class="pick-item ${selected ? "is-selected" : ""}" data-act="${hasSubs ? "open-card" : "pick"}" data-id="${c.card_id}" aria-pressed="${hasSubs ? "false" : selected}">
          ${hasSubs ? `<span class="pick-mark pick-mark-folder" aria-hidden="true">${icon("list")}</span>` : `<span class="pick-mark ${L.mode === "split" ? "is-check" : "is-radio"}" aria-hidden="true">${selected ? icon("check") : ""}</span>`}
          <span class="pick-text">
            <span class="pick-title" title="${esc(c.title || "")}">${esc(c.title || "(sem título)")}</span>
            <span class="pick-meta">${meta}${selected && hasSubs ? ` · <strong class="pick-selected">${pickedHere.length} selecionada(s)</strong>` : ""}</span>
          </span>
          ${hasSubs ? `<span class="pick-aside">${c.unfinished_subtask_count} subtarefa${c.unfinished_subtask_count > 1 ? "s" : ""} ${icon("chevron-right")}</span>` : ""}
        </button>
      </li>`;
    }).join("")}</ul>`;
  }

  if (L.openCard) return renderCardDetail();

  return `
    <div class="picker">
      <div class="tabs" role="tablist">
        ${tabs.map(([k, label]) => `<button type="button" role="tab" class="tab ${L.tab === k ? "is-active" : ""}" aria-selected="${L.tab === k}" data-act="tab" data-tab="${k}">${label}</button>`).join("")}
        <button type="button" class="btn-icon tab-refresh" data-act="reload" aria-label="Atualizar lista" title="Atualizar lista">${icon("refresh")}</button>
      </div>
      <div class="picker-filters">
        ${L.tab === "board" ? `
          <select data-act="board" aria-label="Quadro">
            <option value="">Selecione o quadro…</option>
            ${L.boards.map((b) => `<option value="${b.board_id}" ${b.board_id === L.boardId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
          </select>` : ""}
        <div class="search">
          ${icon("search")}
          <input type="search" placeholder="Buscar por título ou ID" value="${esc(L.query)}" data-act="query" aria-label="Buscar card" />
        </div>
      </div>
      ${list}
    </div>`;
}

/** Segundo nível do seletor: o card aberto, com "Card inteiro" + subtarefas abertas. */
function renderCardDetail() {
  const card = L.openCard;
  const subs = L.subtasks[card.card_id] || { loading: true, items: [] };
  const q = normalizeLabel(L.subQuery);
  const items = q ? subs.items.filter((s) => normalizeLabel(s.description).includes(q)) : subs.items;
  const mark = (picked) => `<span class="pick-mark ${L.mode === "split" ? "is-check" : "is-radio"}" aria-hidden="true">${picked ? icon("check") : ""}</span>`;
  const back = L.tab === "board" && boardName(L.boardId) ? boardName(L.boardId) : { mine: "Meus cards", recent: "Recentes" }[L.tab] || "cards";

  let list;
  if (subs.loading) list = `<div class="list-state"><span class="spinner spinner-sm"></span> Carregando subtarefas…</div>`;
  else if (subs.error) list = `<div class="list-state is-error">${esc(subs.error)} <button type="button" class="btn btn-ghost btn-sm" data-act="open-card" data-id="${card.card_id}">Tentar de novo</button></div>`;
  else {
    const wholePicked = isPicked(card);
    list = `
      <ul class="pick-list" role="list">
        <li>
          <button type="button" class="pick-item pick-item-whole ${wholePicked ? "is-selected" : ""}" data-act="pick-card-only" data-id="${card.card_id}" aria-pressed="${wholePicked}">
            ${mark(wholePicked)}
            <span class="pick-text">
              <span class="pick-title">Card inteiro</span>
              <span class="pick-meta">Lançar no card, sem vincular a uma subtarefa</span>
            </span>
          </button>
        </li>
        ${items.length ? `<li class="pick-group" aria-hidden="true">Subtarefas abertas (${subs.items.length})${L.mode === "split" ? " · marque uma ou mais" : ""}</li>` : ""}
        ${items.map((s) => {
          const picked = isPicked(card, s);
          return `
          <li>
            <button type="button" class="pick-item ${picked ? "is-selected" : ""}" data-act="pick-sub" data-id="${card.card_id}" data-sub="${s.subtask_id}" aria-pressed="${picked}">
              ${mark(picked)}
              <span class="pick-text"><span class="pick-title pick-title-wrap">${esc(s.description)}</span></span>
            </button>
          </li>`;
        }).join("")}
        ${!subs.items.length ? `<li class="list-state">Nenhuma subtarefa aberta neste card.</li>` : !items.length ? `<li class="list-state">Nenhuma subtarefa encontrada para a busca.</li>` : ""}
      </ul>`;
  }

  return `
    <div class="picker">
      <div class="drill-head">
        <button type="button" class="btn btn-ghost btn-sm drill-back" data-act="close-card">${icon("chevron-left")} ${esc(back)}</button>
        <div class="drill-card">
          <span class="pick-meta">${esc(card.custom_id || `#${card.card_id}`)}${boardName(card.board_id) ? ` · ${esc(boardName(card.board_id))}` : ""}</span>
          <strong>${esc(card.title || "(sem título)")}</strong>
        </div>
      </div>
      ${subs.items.length > 6 ? `
      <div class="search">
        ${icon("search")}
        <input type="search" placeholder="Buscar subtarefa" value="${esc(L.subQuery)}" data-act="subquery" aria-label="Buscar subtarefa" />
      </div>` : ""}
      ${list}
    </div>`;
}

function renderPick() {
  const others = ctx.otherPending ? ctx.otherPending().filter((d) => !L.days.some((x) => x.iso === d.iso)) : [];
  content.innerHTML = `
    ${renderAllocations()}
    ${renderPicker()}
    <div class="field">
      <label for="launch-comment">Comentário <span class="muted">(opcional)</span></label>
      <input type="text" id="launch-comment" maxlength="500" value="${esc(L.comment)}" data-act="comment" placeholder="Ex.: Ajustes na tela de cadastro" />
    </div>
    ${L.days.length === 1 && others.length ? `
    <label class="check">
      <input type="checkbox" data-act="apply-others" ${L.applyToOthers ? "checked" : ""} />
      <span>Aplicar ${L.mode === "split" ? "a mesma divisão (proporcional)" : "a mesma atividade"} aos outros ${others.length} dia(s) pendente(s)</span>
    </label>` : ""}
  `;
  footer.innerHTML = `
    <button type="button" class="btn btn-secondary" data-act="back">Voltar</button>
    <button type="button" class="btn btn-primary" data-act="review" ${canReview() ? "" : "disabled"}>Revisar lançamentos</button>`;
}

function renderReview() {
  if (!L.review) {
    content.innerHTML = L.error
      ? `<div class="alert alert-error">${icon("alert")} ${esc(L.error)}</div>`
      : `<div class="list-state"><span class="spinner spinner-sm"></span> Preparando a revisão…</div>`;
    footer.innerHTML = `<button type="button" class="btn btn-secondary" data-act="back">Voltar</button>`;
    return;
  }

  const { items, existing, existingError, days } = L.review;
  const total = items.reduce((a, i) => a + i.minutes, 0);
  const dupDays = days.filter((d) => existing[d.iso] > 0);

  const byDay = days.map((d) => ({ day: d, rows: items.filter((i) => i.iso === d.iso) }));

  content.innerHTML = `
    ${existingError ? `<div class="alert alert-warn">${icon("alert")} Não foi possível verificar lançamentos existentes: ${esc(existingError)}</div>` : ""}
    ${dupDays.length ? `<div class="alert alert-warn">${icon("alert")}<div><strong>Atenção: já existem horas lançadas no Businessmap em ${dupDays.length} dia(s).</strong><br>${dupDays.map((d) => `${esc(isoToBr(d.iso))}: ${minutesToHHMM(existing[d.iso])}`).join(" · ")}<br>Confira para não lançar em dobro.</div></div>` : ""}
    <div class="review-list">
      ${byDay.map(({ day, rows }) => `
        <section class="review-day">
          <header><strong>${esc(dayLabel(day.iso))}</strong><span>${minutesToHHMM(rows.reduce((a, r) => a + r.minutes, 0))}</span></header>
          <ul>
            ${rows.map((r) => `
              <li>
                <div>
                  <span class="review-card">${esc(cardLabel(r.card))}</span>
                  ${r.subtask ? `<span class="muted small">Subtarefa: ${esc(r.subtask.description)}</span>` : ""}
                  <span class="muted small">${r.category ? `Categoria: ${esc(r.category.label)}` : r.tipo ? `Tipo no comentário: ${esc(r.tipo)}` : "Sem categoria"}${r.comment ? ` · "${esc(r.comment)}"` : ""}</span>
                </div>
                <span class="review-time">${minutesToHHMM(r.minutes)}<small>${minutesToDecimal(r.minutes)} h</small></span>
              </li>`).join("")}
          </ul>
        </section>`).join("")}
    </div>
    ${L.error ? `<div class="alert alert-error">${icon("alert")} ${esc(L.error)}<br><span class="small">Nenhum lançamento foi salvo. Corrija e tente de novo.</span></div>` : ""}
  `;
  footer.innerHTML = `
    <button type="button" class="btn btn-secondary" data-act="back" ${L.sending ? "disabled" : ""}>Voltar</button>
    <button type="button" class="btn btn-primary" data-act="send" ${L.sending || !items.length ? "disabled" : ""}>
      ${L.sending ? `<span class="spinner spinner-sm"></span> Enviando…` : `${icon("send")} Lançar ${items.length} registro(s) · ${minutesToHHMM(total)}`}
    </button>`;
}

function renderDone() {
  const count = L.result?.count ?? 0;
  content.innerHTML = `
    <div class="done">
      <span class="done-icon">${icon("check")}</span>
      <h3>${count} lançamento(s) registrado(s) no Businessmap</h3>
      <p class="muted">Os dias foram marcados como lançados.</p>
    </div>`;
  footer.innerHTML = `<button type="button" class="btn btn-primary" data-close>Concluir</button>`;
}

// ---------- eventos ----------

function bind() {
  dialog.dataset.bound = "1";

  dialog.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT" || el.tagName === "SELECT") return;
    const act = el.dataset.act;

    if (act === "mode") {
      L.mode = el.dataset.mode;
      L.allocations = [];
      L.screen = "pick";
      render();
      if (!L.cards.length) loadCards();
    } else if (act === "tab") {
      L.tab = el.dataset.tab;
      L.query = "";
      L.openCard = null;
      if (L.tab === "recent") render();
      else loadCards();
    } else if (act === "reload") {
      L.openCard = null;
      L.subtasks = {};
      loadCards({ refresh: true });
    } else if (act === "pick") {
      const card = findCard(Number(el.dataset.id));
      if (card) pick(card);
    } else if (act === "open-card") {
      const card = findCard(Number(el.dataset.id));
      if (card) {
        if (L.subtasks[card.card_id]?.error) delete L.subtasks[card.card_id];
        openCard(card);
      }
    } else if (act === "close-card") {
      closeCard();
    } else if (act === "pick-card-only") {
      if (L.openCard) pick(L.openCard);
    } else if (act === "pick-sub") {
      const card = L.openCard;
      const sub = L.subtasks[card?.card_id]?.items.find((s) => s.subtask_id === Number(el.dataset.sub));
      if (card && sub) pick(card, sub);
    } else if (act === "alloc-remove") {
      L.allocations.splice(Number(el.dataset.i), 1);
      render();
    } else if (act === "unit") {
      setUnit(el.dataset.unit);
    } else if (act === "even") {
      distributeEvenly();
    } else if (act === "back") {
      L.screen = L.screen === "review" ? "pick" : "mode";
      L.error = "";
      render();
    } else if (act === "review") {
      if (canReview()) goReview();
    } else if (act === "send") {
      send();
    }
  });

  dialog.addEventListener("input", (e) => {
    const el = e.target;
    const act = el.dataset.act;
    if (act === "query" || act === "subquery") {
      L[act === "query" ? "query" : "subQuery"] = el.value;
      const pos = el.selectionStart;
      render();
      const input = content.querySelector(`[data-act="${act}"]`);
      input?.focus();
      input?.setSelectionRange(pos, pos);
    } else if (act === "comment") {
      L.comment = el.value;
    } else if (act === "alloc-pct") {
      L.allocations[Number(el.dataset.i)].value = Number(el.value);
      refreshSplitStatus();
    }
  });

  dialog.addEventListener("change", (e) => {
    const el = e.target;
    const act = el.dataset.act;
    if (act === "board") {
      L.boardId = Number(el.value) || null;
      L.openCard = null;
      L.query = "";
      storage.set("bm_last_board", L.boardId);
      loadCards();
    } else if (act === "alloc-hours") {
      const m = parseDuration(el.value.includes(":") ? el.value : `${el.value}:00`);
      L.allocations[Number(el.dataset.i)].value = m !== null && m >= 0 ? m : 0;
      render();
    } else if (act === "alloc-pct") {
      render();
    } else if (act === "alloc-cat") {
      const a = L.allocations[Number(el.dataset.i)];
      if (a) {
        a.category_id = Number(el.value) || null;
        rememberCategory(a.card.board_id, a.category_id);
      }
    } else if (act === "apply-others") {
      L.applyToOthers = el.checked;
    }
  });

  dialog.addEventListener("close", () => {
    if (L?.screen === "done") ctx?.onClosed?.();
  });
}

/** Atualiza o contador "restante" e o botão sem re-renderizar os inputs (mantém o foco). */
function refreshSplitStatus() {
  const restEl = content.querySelector(".rest");
  const btn = footer.querySelector('[data-act="review"]');
  if (btn) btn.disabled = !canReview();
  if (!restEl) return;
  const { cls, text } = restInfo();
  restEl.className = `rest ${cls}`;
  restEl.textContent = text;
}

export function closeLaunch() {
  if (dialog) closeDialog(dialog);
}
