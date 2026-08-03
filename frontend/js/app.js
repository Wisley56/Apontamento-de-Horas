/**
 * Sistema de Apontamento de Horas - Frontend JavaScript
 * Lógica de interação, chamadas à API e renderização
 * v2.0 — Persistência, descrição de intervalos e histórico
 */

// ============ Estado Global ============

const state = {
  selectionType: "period",
  exceptions: [],
  results: null,
  states: [],
  days: [],      // Lista de dias gerados
  holidays: {},  // Feriados detectados
  colaborador: "", // Nome do colaborador
  historyRecords: [], // Histórico mesclado (local + servidor) da última carga
};

// ============ Elementos DOM ============

const elements = {
  // Colaborador
  colaboradorName: document.getElementById("colaborador-name"),

  // Toggle
  btnPeriod: document.getElementById("btn-period"),
  btnSingle: document.getElementById("btn-single"),

  // Date inputs
  startDateGroup: document.getElementById("start-date-group"),
  endDateGroup: document.getElementById("end-date-group"),
  singleDateGroup: document.getElementById("single-date-group"),
  startDate: document.getElementById("start-date"),
  endDate: document.getElementById("end-date"),
  singleDate: document.getElementById("single-date"),

  // Form
  form: document.getElementById("hours-form"),
  stateSelect: document.getElementById("state-select"),
  stateSelectGroup: document.getElementById("state-select-group"),
  generateDaysBtn: document.getElementById("generate-days-btn"),

  // Days list
  daysListSection: document.getElementById("days-list-section"),
  daysList: document.getElementById("days-list"),
  exceptionsSection: document.getElementById("exceptions-section"),
  analyzeBtn: document.getElementById("analyze-btn"),
  pasteHoursBtn: document.getElementById("paste-hours-btn"),

  // Exceptions
  exceptionDate: document.getElementById("exception-date"),
  exceptionType: document.getElementById("exception-type"),
  addExceptionBtn: document.getElementById("add-exception"),
  exceptionsList: document.getElementById("exceptions-list"),

  // Results
  resultsSection: document.getElementById("results-section"),
  summaryCards: document.getElementById("summary-cards"),
  resultsBody: document.getElementById("results-body"),
  exportBtn: document.getElementById("export-btn"),

  // Save confirmation
  saveConfirmation: document.getElementById("save-confirmation"),
  saveHistoryBtn: document.getElementById("save-history-btn"),

  // History
  historySection: document.getElementById("history-section"),
  historyList: document.getElementById("history-list"),
  refreshHistoryBtn: document.getElementById("refresh-history-btn"),
  clearHistoryBtn: document.getElementById("clear-history-btn"),
  filterColaborador: document.getElementById("filter-colaborador"),
  filterMes: document.getElementById("filter-mes"),
  filterHistoryBtn: document.getElementById("filter-history-btn"),
  clearFilterBtn: document.getElementById("clear-filter-btn"),

  // UI
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast"),
};

// ============ Inicialização ============

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

async function initializeApp() {
  await loadStates();
  setupEventListeners();
  setDefaultDates();
  restoreColaboradorName();
  // Verificar se já há histórico para exibir o botão flutuante
  checkAndShowFloatBtn();
  // Iniciar ping anti-sono para o Render
  setupAntiSleepPing();
}

function restoreColaboradorName() {
  try {
    const saved = localStorage.getItem(LS_COLAB_KEY);
    if (saved && elements.colaboradorName) {
      elements.colaboradorName.value = saved;
      state.colaborador = saved;
    }
  } catch { /* localStorage indisponível */ }
}

// ============ API Calls ============

const API_BASE = window.APP_CONFIG?.API_URL || '';

// ============ Persistência Local (localStorage) ============
// O histórico é salvo primeiro no navegador (nunca se perde) e sincronizado
// com o servidor em segundo plano. Se o servidor gratuito do Render reiniciar
// e perder o banco, os registros locais são reenviados automaticamente.

const LS_HISTORY_KEY = "apnt_history_v1";
const LS_COLAB_KEY = "apnt_colaborador";

const ACTIVITY_TYPES = ["Melhoria", "Correção", "Suporte"];

function generateUUID() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getLocalHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_HISTORY_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function setLocalHistory(records) {
  try {
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn("Não foi possível salvar o histórico no navegador:", e);
  }
}

function upsertLocalRecord(record) {
  const records = getLocalHistory();
  const idx = records.findIndex((r) => r.uuid === record.uuid);
  if (idx >= 0) records[idx] = { ...records[idx], ...record };
  else records.unshift(record);
  setLocalHistory(records);
}

function removeLocalRecord(uuid) {
  setLocalHistory(getLocalHistory().filter((r) => r.uuid !== uuid));
}

// Lápides de exclusão: uuids excluídos aqui que ainda precisam ser removidos
// do servidor (evita que registros excluídos "ressuscitem" na sincronização).
const LS_DELETED_KEY = "apnt_deleted_uuids_v1";

function getDeletedUuids() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_DELETED_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function addDeletedUuid(uuid) {
  const deleted = getDeletedUuids();
  if (!deleted.includes(uuid)) {
    deleted.push(uuid);
    try { localStorage.setItem(LS_DELETED_KEY, JSON.stringify(deleted)); } catch { /* ignore */ }
  }
}

function clearDeletedUuid(uuid) {
  try {
    localStorage.setItem(LS_DELETED_KEY, JSON.stringify(getDeletedUuids().filter((u) => u !== uuid)));
  } catch { /* ignore */ }
}

function clearLocalHistory() {
  try {
    localStorage.removeItem(LS_HISTORY_KEY);
  } catch (e) {
    console.warn("Não foi possível limpar o histórico do navegador:", e);
  }
}

/**
 * Assinatura de conteúdo de um registro. Usada para reconhecer no servidor
 * registros salvos por uma versão que ainda não devolve o uuid — sem isso o
 * navegador reenviava o mesmo apontamento a cada carga do histórico.
 */
function recordFingerprint(rec) {
  return [
    (rec.colaborador || "").trim().toLowerCase(),
    rec.periodo_inicio || "",
    rec.periodo_fim || "",
    rec.criado_em || "",
  ].join("|");
}

function parseCreatedAt(str) {
  if (!str) return 0;
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return 0;
  return new Date(m[3], m[2] - 1, m[1], m[4], m[5]).getTime();
}

function parseBrDate(str) {
  if (!str) return null;
  const [day, month, year] = str.split("/");
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function periodsOverlap(inicioA, fimA, inicioB, fimB) {
  const a1 = parseBrDate(inicioA), a2 = parseBrDate(fimA);
  const b1 = parseBrDate(inicioB), b2 = parseBrDate(fimB);
  if (!a1 || !a2 || !b1 || !b2) return false;
  return !(a2 < b1 || a1 > b2);
}

function normalizeTipo(tipo) {
  return (tipo || "")
    .toLowerCase()
    .normalize("NFD") // remove acentos: Correção -> correcao
    .replace(/[̀-ͯ]/g, "");
}

async function apiCall(endpoint, method = "GET", data = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (data) {
    options.body = JSON.stringify(data);
  }
  const response = await fetch(`${API_BASE}${endpoint}`, options);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail || errorBody?.message || `Erro HTTP ${response.status}`;
    throw new Error(detail);
  }
  return response;
}

async function loadStates() {
  try {
    const response = await apiCall("/api/states");
    state.states = await response.json();
    state.states.forEach((s) => {
      const option = document.createElement("option");
      option.value = s.code;
      option.textContent = `${s.code} - ${s.name}`;
      elements.stateSelect.appendChild(option);
    });
    elements.stateSelect.value = "GO";
  } catch (error) {
    console.error("Erro ao carregar estados:", error);
    showToast("Erro ao carregar estados", "error");
  }
}

// ============ Event Listeners ============

function setupEventListeners() {
  // Toggle de tipo de seleção
  elements.btnPeriod.addEventListener("click", () => toggleSelectionType("period"));
  elements.btnSingle.addEventListener("click", () => toggleSelectionType("single"));

  // Gerar lista de dias
  elements.generateDaysBtn.addEventListener("click", generateDaysList);

  // Exceções
  elements.addExceptionBtn.addEventListener("click", addException);

  // Auto-gerar dias quando selecionar data (modo dia específico)
  elements.singleDate.addEventListener("change", handleSingleDateChange);
  elements.singleDate.addEventListener("keypress", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleSingleDateChange(); }
  });

  // Submit do formulário
  elements.form.addEventListener("submit", handleSubmit);

  // Exportar
  elements.exportBtn.addEventListener("click", handleExport);

  // Colar horários via Ctrl+V
  document.addEventListener("paste", handlePasteEvent);
  if (elements.pasteHoursBtn) {
    elements.pasteHoursBtn.addEventListener("click", handlePasteButtonClick);
  }

  // Colaborador (lembrado entre visitas)
  elements.colaboradorName.addEventListener("input", (e) => {
    state.colaborador = e.target.value.trim();
    try { localStorage.setItem(LS_COLAB_KEY, state.colaborador); } catch { /* ignore */ }
  });

  // Definir tipo de atividade para todos os dias
  const setAllTypeSelect = document.getElementById("set-all-type");
  if (setAllTypeSelect) {
    setAllTypeSelect.addEventListener("change", (e) => {
      if (e.target.value) setAllDayTypes(e.target.value);
    });
  }

  // Backup / Restauração do histórico
  const exportBackupBtn = document.getElementById("export-backup-btn");
  const importBackupBtn = document.getElementById("import-backup-btn");
  const importBackupInput = document.getElementById("import-backup-input");
  if (exportBackupBtn) exportBackupBtn.addEventListener("click", exportBackup);
  if (importBackupBtn && importBackupInput) {
    importBackupBtn.addEventListener("click", () => importBackupInput.click());
    importBackupInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importBackup(file);
      e.target.value = "";
    });
  }

  // Salvar no histórico
  if (elements.saveHistoryBtn) {
    elements.saveHistoryBtn.addEventListener("click", () => showSaveConfirmModal());
  }

  // Histórico - filtros e refresh
  if (elements.filterHistoryBtn) {
    elements.filterHistoryBtn.addEventListener("click", () => loadHistory());
  }
  if (elements.clearFilterBtn) {
    elements.clearFilterBtn.addEventListener("click", () => {
      elements.filterColaborador.value = "";
      elements.filterMes.value = "";
      loadHistory();
    });
  }
  if (elements.refreshHistoryBtn) {
    elements.refreshHistoryBtn.addEventListener("click", () => loadHistory());
  }
  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener("click", clearAllHistory);
  }

  // Filtro em tempo real ao digitar colaborador (com debounce)
  let debounceTimer;
  if (elements.filterColaborador) {
    elements.filterColaborador.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadHistory(), 600);
    });
  }

  // Modal de detalhes do histórico
  const closeDetailBtn = document.getElementById("close-detail-btn");
  const closeDetailBtn2 = document.getElementById("close-detail-btn-2");
  const detailModal = document.getElementById("history-detail-modal");
  if (closeDetailBtn) closeDetailBtn.addEventListener("click", () => { detailModal.style.display = "none"; });
  if (closeDetailBtn2) closeDetailBtn2.addEventListener("click", () => { detailModal.style.display = "none"; });
  if (detailModal) {
    detailModal.addEventListener("click", (e) => {
      if (e.target === detailModal) detailModal.style.display = "none";
    });
  }

  // Botão flutuante de histórico
  const floatBtn = document.getElementById("float-history-btn");
  if (floatBtn) {
    floatBtn.addEventListener("click", () => {
      elements.historySection.style.display = "block";
      loadHistory();
      elements.historySection.scrollIntoView({ behavior: "smooth" });
      floatBtn.style.display = "none";
    });
  }

  // Modal de aviso de duplicata
  const dupModal = document.getElementById("duplicate-modal");
  const dupCancelBtn = document.getElementById("dup-modal-cancel");
  if (dupCancelBtn) {
    dupCancelBtn.addEventListener("click", () => { dupModal.style.display = "none"; });
  }
  if (dupModal) {
    dupModal.addEventListener("click", (e) => {
      if (e.target === dupModal) dupModal.style.display = "none";
    });
  }
}

// ============ Toggle Selection Type ============

function toggleSelectionType(type) {
  state.selectionType = type;
  elements.btnPeriod.classList.toggle("active", type === "period");
  elements.btnSingle.classList.toggle("active", type === "single");

  if (type === "period") {
    elements.startDateGroup.style.display = "block";
    elements.endDateGroup.style.display = "block";
    elements.singleDateGroup.style.display = "none";
    if (elements.stateSelectGroup) elements.stateSelectGroup.style.display = "block";
    elements.generateDaysBtn.style.display = "flex";
    // Restaurar required nos campos visíveis de período
    elements.startDate.setAttribute("required", "");
    elements.endDate.setAttribute("required", "");
    elements.stateSelect.setAttribute("required", "");
  } else {
    elements.startDateGroup.style.display = "none";
    elements.endDateGroup.style.display = "none";
    elements.singleDateGroup.style.display = "block";
    if (elements.stateSelectGroup) elements.stateSelectGroup.style.display = "none";
    elements.generateDaysBtn.style.display = "none";
    // Remover required dos campos ocultos para não bloquear o submit
    elements.startDate.removeAttribute("required");
    elements.endDate.removeAttribute("required");
    elements.stateSelect.removeAttribute("required");
    setTimeout(() => { if (elements.singleDate.value) handleSingleDateChange(); }, 100);
  }

  elements.daysListSection.style.display = "none";
  elements.exceptionsSection.style.display = "none";
  elements.analyzeBtn.style.display = "none";
}

// ============ Auto-gerar Dia Específico ============

async function handleSingleDateChange() {
  const dateValue = elements.singleDate.value;
  if (!dateValue) return;

  const stateUF = "GO";
  const year = new Date(dateValue).getFullYear();
  showLoading(true);

  try {
    const response = await apiCall(`/api/holidays/${year}/${stateUF}`);
    const data = await response.json();
    const holidaysData = data.holidays || {};
    const dateAPI = formatDateForAPI(dateValue);
    const isHoliday = !!holidaysData[dateAPI];
    const holidayName = holidaysData[dateAPI] || null;
    const isWeekendDay = isWeekend(dateValue);

    if (isHoliday) {
      showLoading(false);
      const confirmed = await showHolidayConfirmModal(dateAPI, holidayName);
      if (!confirmed) { showToast("Lançamento cancelado", "info"); return; }
      showLoading(true);
    }
    if (isWeekendDay) {
      showLoading(false);
      const dayName = getDayOfWeekName(dateValue);
      const confirmed = await showWeekendConfirmModal(dateAPI, dayName);
      if (!confirmed) { showToast("Lançamento cancelado", "info"); return; }
      showLoading(true);
    }

    const dayInfo = {
      date: dateValue,
      dateDisplay: dateAPI,
      dayName: getDayOfWeekName(dateValue),
      isWeekend: isWeekendDay,
      isHoliday,
      holidayName,
      intervals: [
        { entry: "", exit: "" },
      ],
      overtime: "00:00",
      absence: "00:00",
      totalHours: 0,
      status: "pending",
    };

    state.days = [dayInfo];
    state.holidays = holidaysData;
    renderDaysList();

    elements.daysListSection.style.display = "block";
    elements.exceptionsSection.style.display = "block";
    elements.analyzeBtn.style.display = "flex";
    showToast("Dia gerado com sucesso!", "success");
  } catch (error) {
    console.error("Erro:", error);
    showToast("Erro ao gerar dia", "error");
  } finally {
    showLoading(false);
  }
}

// ============ Modais de Confirmação ============

function showHolidayConfirmModal(dateStr, holidayName) {
  return new Promise((resolve) => {
    const modal = document.getElementById("holiday-confirm-modal");
    const titleEl = document.getElementById("holiday-modal-title");
    const messageEl = document.getElementById("holiday-modal-message");
    const confirmBtn = document.getElementById("holiday-modal-confirm");
    const cancelBtn = document.getElementById("holiday-modal-cancel");

    if (!modal) { resolve(confirm(`A data ${dateStr} é feriado (${holidayName}).\n\nDeseja realmente lançar horas neste dia?`)); return; }

    titleEl.textContent = "🎉 Feriado Detectado";
    messageEl.innerHTML = `
      <p>A data <strong>${dateStr}</strong> é um feriado:</p>
      <p class="holiday-name">📅 ${holidayName}</p>
      <p>Deseja realmente lançar horas neste dia?</p>
    `;
    modal.style.display = "flex";

    const cleanup = () => {
      confirmBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
    };
    const handleConfirm = () => { modal.style.display = "none"; cleanup(); resolve(true); };
    const handleCancel = () => { modal.style.display = "none"; cleanup(); resolve(false); };

    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
  });
}

function showWeekendConfirmModal(dateStr, dayName) {
  return new Promise((resolve) => {
    const modal = document.getElementById("holiday-confirm-modal");
    const titleEl = document.getElementById("holiday-modal-title");
    const messageEl = document.getElementById("holiday-modal-message");
    const confirmBtn = document.getElementById("holiday-modal-confirm");
    const cancelBtn = document.getElementById("holiday-modal-cancel");

    if (!modal) { resolve(confirm(`A data ${dateStr} é ${dayName} (final de semana).\n\nDeseja realmente lançar horas neste dia?`)); return; }

    titleEl.textContent = "🗓️ Final de Semana";
    messageEl.innerHTML = `
      <p>A data <strong>${dateStr}</strong> é <strong>${dayName}</strong> (final de semana).</p>
      <p>Deseja realmente lançar horas neste dia?</p>
    `;
    modal.style.display = "flex";

    const cleanup = () => {
      confirmBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
    };
    const handleConfirm = () => { modal.style.display = "none"; cleanup(); resolve(true); };
    const handleCancel = () => { modal.style.display = "none"; cleanup(); resolve(false); };

    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
  });
}

function showSaveConfirmModal() {
  // Verificar duplicatas ANTES de mostrar o modal de confirmação
  checkDuplicateAndSave();
}

async function checkDuplicateAndSave() {
  // Garantir que o colaborador está sempre atualizado a partir do campo de input
  const colaborador = elements.colaboradorName.value.trim() || state.colaborador;

  if (!colaborador) {
    showToast("Informe seu nome antes de salvar", "error");
    elements.colaboradorName.focus();
    return;
  }

  // Sincronizar state com o valor atual do input
  state.colaborador = colaborador;

  const periodoInicio = state.days[0]?.dateDisplay || "";
  const periodoFim = state.days[state.days.length - 1]?.dateDisplay || "";

  if (!periodoInicio || !periodoFim) {
    showToast("Nenhum período carregado. Gere a lista de dias primeiro.", "error");
    return;
  }

  // Verificação local primeiro (funciona mesmo com o servidor dormindo)
  const localConflicts = getLocalHistory().filter(
    (r) =>
      r.colaborador?.toLowerCase() === colaborador.toLowerCase() &&
      periodsOverlap(periodoInicio, periodoFim, r.periodo_inicio, r.periodo_fim)
  );
  if (localConflicts.length > 0) {
    showDuplicateWarningModal(colaborador, localConflicts);
    return;
  }

  showLoading(true);
  try {
    const params = new URLSearchParams({ colaborador, periodo_inicio: periodoInicio, periodo_fim: periodoFim });
    const response = await apiCall(`/api/verificar-duplicata?${params}`);
    const data = await response.json();
    showLoading(false);

    if (data.duplicata && data.registros.length > 0) {
      // Mostrar modal de aviso de duplicata
      showDuplicateWarningModal(colaborador, data.registros);
    } else {
      // Sem duplicata — mostrar modal de confirmação normal
      showNormalSaveModal(colaborador, periodoInicio, periodoFim);
    }
  } catch (error) {
    showLoading(false);
    console.error("Erro ao verificar duplicata:", error);
    // Em caso de erro na verificação, deixar salvar normalmente
    showNormalSaveModal(colaborador, periodoInicio, periodoFim);
  }
}

function showDuplicateWarningModal(colaborador, conflitos) {
  const modal = document.getElementById("duplicate-modal");
  const dupNameEl = document.getElementById("dup-colaborador-name");
  const dupListEl = document.getElementById("dup-records-list");
  const confirmBtn = document.getElementById("dup-modal-confirm");
  const cancelBtn = document.getElementById("dup-modal-cancel");

  if (dupNameEl) dupNameEl.textContent = colaborador;

  if (dupListEl) {
    dupListEl.innerHTML = conflitos.map(rec => `
      <div class="dup-record-item">
        <span class="dup-record-period">📅 ${rec.periodo_inicio} → ${rec.periodo_fim}</span>
        <span class="dup-record-total">⏱️ ${(rec.total_horas || 0).toFixed(2)}h</span>
        <span class="dup-record-date">🕐 Salvo: ${rec.criado_em}</span>
      </div>
    `).join("");
  }

  modal.style.display = "flex";

  // Remover listeners anteriores clonando o botão
  const newConfirm = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  document.getElementById("dup-modal-cancel").addEventListener("click", () => {
    modal.style.display = "none";
  });
  document.getElementById("dup-modal-confirm").addEventListener("click", () => {
    modal.style.display = "none";
    // Salvar mesmo com duplicata
    saveToHistory();
  });
}

function showNormalSaveModal(colaborador, periodoInicio, periodoFim) {
  return new Promise((resolve) => {
    const modal = document.getElementById("save-confirm-modal");
    const confirmBtn = document.getElementById("save-modal-confirm");
    const cancelBtn = document.getElementById("save-modal-cancel");
    const infoEl = document.getElementById("save-modal-info");

    if (infoEl) {
      infoEl.innerHTML = `
        <strong>Colaborador:</strong> ${colaborador}<br>
        <strong>Período:</strong> ${periodoInicio} → ${periodoFim}
      `;
    }

    modal.style.display = "flex";

    const cleanup = () => {
      confirmBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
    };
    const handleConfirm = () => { modal.style.display = "none"; cleanup(); resolve(true); saveToHistory(); };
    const handleCancel = () => { modal.style.display = "none"; cleanup(); resolve(false); };

    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
  });
}

// ============ Helpers ============

function setDefaultDates() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  elements.startDate.value = formatDateForInput(firstDay);
  elements.endDate.value = formatDateForInput(today);
  elements.singleDate.value = formatDateForInput(today);
}

function formatDateForInput(date) {
  return date.toISOString().split("T")[0];
}

function formatDateForAPI(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateFromAPI(dateStr) {
  if (!dateStr) return "";
  const [day, month, year] = dateStr.split("/");
  return `${year}-${month}-${day}`;
}

function getDayOfWeekName(dateStr) {
  const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const [year, month, day] = dateStr.split("-");
  const date = new Date(year, month - 1, day);
  return days[date.getDay()];
}

function isWeekend(dateStr) {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(year, month - 1, day);
  return date.getDay() === 0 || date.getDay() === 6;
}

// ============ Generate Days List ============

async function generateDaysList() {
  let startDate, endDate;

  if (state.selectionType === "period") {
    startDate = elements.startDate.value;
    endDate = elements.endDate.value;
    if (!startDate || !endDate) { showToast("Preencha as datas inicial e final", "error"); return; }
    if (new Date(endDate) < new Date(startDate)) { showToast("Data final deve ser maior que a inicial", "error"); return; }
  } else {
    startDate = elements.singleDate.value;
    endDate = startDate;
    if (!startDate) { showToast("Selecione a data", "error"); return; }
  }

  const stateUF = elements.stateSelect.value;
  if (!stateUF) { showToast("Selecione o estado", "error"); return; }

  showLoading(true);
  try {
    const year = new Date(startDate).getFullYear();
    const response = await apiCall(`/api/holidays/${year}/${stateUF}`);
    const data = await response.json();
    state.holidays = data.holidays || {};

    const days = [];
    let current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = formatDateForInput(current);
      const dateAPI = formatDateForAPI(dateStr);
      days.push({
        date: dateStr,
        dateDisplay: dateAPI,
        dayName: getDayOfWeekName(dateStr),
        isWeekend: isWeekend(dateStr),
        isHoliday: !!state.holidays[dateAPI],
        holidayName: state.holidays[dateAPI] || null,
        intervals: [
          { entry: "", exit: "" },
        ],
        overtime: "00:00",
        absence: "00:00",
        totalHours: 0,
        status: "pending",
      });
      current.setDate(current.getDate() + 1);
    }

    state.days = days;
    renderDaysList();

    elements.daysListSection.style.display = "block";
    elements.exceptionsSection.style.display = "block";
    elements.analyzeBtn.style.display = "flex";
    showToast(`${days.length} dia(s) gerado(s)`, "success");
  } catch (error) {
    console.error("Erro:", error);
    showToast("Erro ao gerar lista de dias", "error");
  } finally {
    showLoading(false);
  }
}

// ============ Render Days List (com descrição por intervalo) ============

function renderDaysList() {
  elements.daysList.innerHTML = state.days
    .map((day, index) => {
      const isNonWorkday = day.isWeekend || day.isHoliday || isException(day.dateDisplay);
      const rowClass = day.isWeekend ? "weekend" : day.isHoliday ? "holiday" : "";

      if (isNonWorkday) {
        const reason = day.isWeekend
          ? "Final de Semana"
          : day.isHoliday
          ? `Feriado: ${day.holidayName}`
          : getExceptionType(day.dateDisplay);

        return `
          <div class="day-row non-workday ${rowClass}" data-index="${index}">
            <span class="day-date">${day.dateDisplay}</span>
            <span class="day-name">${day.dayName}</span>
            <span class="day-type-badge">📅 ${reason}</span>
          </div>
        `;
      }

      // Intervalos sem wrapper e sem espaços para alinhar com o grid
      const intervalsHtml = day.intervals.map((interval, intervalIndex) => 
        `<input type="time" class="time-input" value="${interval.entry}" onchange="updateIntervalTime(${index}, ${intervalIndex}, 'entry', this.value)" placeholder="08:00" title="Entrada ${intervalIndex + 1}"><input type="time" class="time-input" value="${interval.exit}" onchange="updateIntervalTime(${index}, ${intervalIndex}, 'exit', this.value)" placeholder="12:00" title="Saída ${intervalIndex + 1}">`
      ).join('');

      // Espaços vazios se houver apenas 1 intervalo, para manter o Total na coluna correta
      const placeholders = day.intervals.length === 1 ? '<span></span><span></span>' : '';

      const actionsHtml = `
        <div class="day-actions">
          <button type="button" class="btn-add-interval" onclick="addInterval(${index})" title="Adicionar intervalo">➕</button>
          ${day.intervals.length > 1 ? `
          <button type="button" class="btn-remove-interval" onclick="removeLastInterval(${index})" title="Remover último intervalo">➖</button>
          ` : ''}
        </div>
      `;

      // Informações de balanço (HE/Ausências) para o alerta
      const hasBalance = day.overtime !== "00:00" || day.absence !== "00:00";
      const balanceHtml = hasBalance ? `
        <div class="day-balance-info">
          <div class="balance-item"><span class="label">HE:</span><span class="value overtime">${day.overtime}</span></div>
          <div class="balance-item"><span class="label">AUS:</span><span class="value absence">${day.absence}</span></div>
        </div>
      ` : '<div></div>';

      // Ícone de alerta se houver divergência (calculado no calculateDayTotal)
      const divergenceAlert = day.hasDivergence ? `
        <span class="divergence-alert" title="Atenção: O cálculo do Redmine (8h + HE - Ausências) divergiu das marcações e foi priorizado.">!</span>
      ` : '';

      return `
        <div class="day-row workday ${day.hasDivergence ? 'divergent-row' : ''}" data-index="${index}" data-intervals="${day.intervals.length}">
          <span class="day-date">${day.dateDisplay}</span>
          <span class="day-name">${day.dayName}</span>
          ${intervalsHtml}${placeholders}
          ${balanceHtml}
          <span class="day-total" id="total-${index}">
            ${formatTotalHours(day.totalHours)}${divergenceAlert}
          </span>
          ${actionsHtml}
        </div>
      `;
    })
    .join("");
}

// ============ Interval Functions ============

function updateIntervalTime(dayIndex, intervalIndex, field, value) {
  state.days[dayIndex].intervals[intervalIndex][field] = value;
  calculateDayTotal(dayIndex);
}

function addInterval(dayIndex) {
  state.days[dayIndex].intervals.push({ entry: "", exit: "" });
  renderDaysList();
}

function removeInterval(dayIndex, intervalIndex) {
  if (state.days[dayIndex].intervals.length > 1) {
    state.days[dayIndex].intervals.splice(intervalIndex, 1);
    calculateDayTotal(dayIndex);
    renderDaysList();
  }
}

function removeLastInterval(dayIndex) {
  if (state.days[dayIndex].intervals.length > 1) {
    state.days[dayIndex].intervals.pop();
    calculateDayTotal(dayIndex);
    renderDaysList();
  }
}

function calculateDayTotal(dayIndex) {
  const day = state.days[dayIndex];
  let totalMinutes = 0;

  for (const interval of day.intervals) {
    if (interval.entry && interval.exit) {
      const start = timeToMinutes(interval.entry);
      const end = timeToMinutes(interval.exit);
      if (end > start) totalMinutes += end - start;
    }
  }

  day.totalHours = totalMinutes / 60;
  
  // NOVA LÓGICA: Cálculo Redmine (8h + HE - Ausências)
  const baseMinutes = 8 * 60;
  const heMinutes = timeToMinutes(day.overtime || "00:00");
  const absMinutes = timeToMinutes(day.absence || "00:00");
  const redmineTotalHours = (baseMinutes + heMinutes - absMinutes) / 60;

  // Comparação e priorização
  // Usamos uma tolerância pequena para lidar com arredondamentos de float se necessário
  const diff = Math.abs(day.totalHours - redmineTotalHours);
  if ((day.overtime !== "00:00" || day.absence !== "00:00") && diff > 0.001) {
    day.totalHours = redmineTotalHours;
    day.hasDivergence = true;
  } else {
    day.hasDivergence = false;
  }

  const totalElement = document.getElementById(`total-${dayIndex}`);
  if (totalElement) totalElement.textContent = formatTotalHours(day.totalHours);
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function formatTotalHours(hours) {
  if (hours === 0) return "--:--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function hoursToRedmine(hours) {
  return hours.toFixed(2);
}

// Expor funções para uso global (onclick inline no HTML)
window.updateIntervalTime = updateIntervalTime;
window.addInterval = addInterval;
window.removeInterval = removeInterval;
window.removeLastInterval = removeLastInterval;

// ============ Paste Feature ============

function parsePastedTimesheet(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})\s/;
  const timeRegex = /^\d{2}:\d{2}$/;
  const result = [];
  let currentDay = null;
  let expectingTime = null;
  let currentEntry = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(dateRegex);
    
    if (dateMatch) {
      if (currentDay && (currentDay.intervals.length > 0 || currentDay.overtime !== "00:00" || currentDay.absence !== "00:00")) {
        result.push(currentDay);
      }
      currentDay = { 
        date: dateMatch[1], 
        intervals: [],
        overtime: "00:00",
        absence: "00:00"
      };
      currentEntry = null;
      expectingTime = null;
      continue;
    }

    if (!currentDay) continue;

    const lowerLine = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Detecção de HE e Ausências
    if (lowerLine.includes('horas extras')) {
      const val = line.match(/(\d{2}:\d{2})/) ? line.match(/(\d{2}:\d{2})/)[1] : (lines[i+1] && lines[i+1].match(/(\d{2}:\d{2})/) ? lines[i+1].match(/(\d{2}:\d{2})/)[1] : null);
      if (val) currentDay.overtime = val;
      continue;
    }
    
    if (lowerLine.includes('ausencias')) {
      const val = line.match(/(\d{2}:\d{2})/) ? line.match(/(\d{2}:\d{2})/)[1] : (lines[i+1] && lines[i+1].match(/(\d{2}:\d{2})/) ? lines[i+1].match(/(\d{2}:\d{2})/)[1] : null);
      if (val) currentDay.absence = val;
      continue;
    }

    if (lowerLine === 'entrada') { expectingTime = 'entry'; continue; }
    if (lowerLine === 'saida') { expectingTime = 'exit'; continue; }

    if (timeRegex.test(line) && expectingTime) {
      if (expectingTime === 'entry') {
        currentEntry = { entry: line, exit: '' };
      } else if (expectingTime === 'exit' && currentEntry) {
        currentEntry.exit = line;
        currentDay.intervals.push({ ...currentEntry });
        currentEntry = null;
      }
      expectingTime = null;
    }
  }
  if (currentDay && (currentDay.intervals.length > 0 || currentDay.overtime !== "00:00" || currentDay.absence !== "00:00")) {
    result.push(currentDay);
  }
  return result;
}

function applyPastedData(parsedDays) {
  let filledCount = 0;
  const filledIndices = [];

  for (const parsed of parsedDays) {
    const dayIndex = state.days.findIndex(d => d.dateDisplay === parsed.date);
    if (dayIndex === -1) continue;
    const day = state.days[dayIndex];
    if (day.isWeekend || day.isHoliday || isException(day.dateDisplay)) continue;

    while (day.intervals.length < parsed.intervals.length) {
      day.intervals.push({ entry: '', exit: '' });
    }
    for (let i = 0; i < parsed.intervals.length; i++) {
      day.intervals[i].entry = parsed.intervals[i].entry;
      day.intervals[i].exit = parsed.intervals[i].exit;
    }
    day.overtime = parsed.overtime || "00:00";
    day.absence = parsed.absence || "00:00";
    calculateDayTotal(dayIndex);
    filledCount++;
    filledIndices.push(dayIndex);
  }

  if (filledCount > 0) {
    renderDaysList();
    highlightPastedRows(filledIndices);
    showToast(`✅ ${filledCount} dia(s) preenchido(s) com sucesso!`, 'success');
  } else {
    showToast('⚠️ Nenhum dia correspondente encontrado.', 'error');
  }
  return filledCount;
}

function highlightPastedRows(indices) {
  setTimeout(() => {
    for (const idx of indices) {
      const row = document.querySelector(`.day-row[data-index="${idx}"]`);
      if (row) {
        row.classList.add('paste-row-highlight');
        const inputs = row.querySelectorAll('input[type="time"]');
        inputs.forEach(input => { if (input.value) input.classList.add('paste-filled'); });
        setTimeout(() => {
          row.classList.remove('paste-row-highlight');
          inputs.forEach(input => input.classList.remove('paste-filled'));
        }, 1600);
      }
    }
  }, 50);
}

function handlePasteEvent(e) {
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (['input', 'textarea', 'select'].includes(activeTag)) return;
  if (state.days.length === 0 || elements.daysListSection.style.display === 'none') return;

  const text = e.clipboardData?.getData('text/plain');
  if (!text) return;

  const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(text);
  const hasEntry = /entrada/i.test(text);
  if (!hasDate || !hasEntry) return;

  e.preventDefault();
  const parsed = parsePastedTimesheet(text);
  if (parsed.length === 0) { showToast('⚠️ Não foi possível reconhecer horários.', 'error'); return; }
  applyPastedData(parsed);
}

async function handlePasteButtonClick() {
  if (state.days.length === 0) { showToast('Gere a lista de dias primeiro.', 'error'); return; }
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { showToast('Área de transferência vazia.', 'error'); return; }
    const parsed = parsePastedTimesheet(text);
    if (parsed.length === 0) { showToast('⚠️ Não foi possível reconhecer horários.', 'error'); return; }
    applyPastedData(parsed);
  } catch (error) {
    console.error('Erro ao acessar clipboard:', error);
    showToast('Não foi possível acessar a área de transferência. Use Ctrl+V.', 'error');
  }
}

// ============ Exceções ============

function isException(dateDisplay) { return state.exceptions.some((e) => e.date === dateDisplay); }

function getExceptionType(dateDisplay) {
  const typeNames = { ferias: "Férias", atestado: "Atestado", afastamento: "Afastamento", banco: "Banco de Horas", feriado_manual: "Feriado Manual" };
  const exc = state.exceptions.find((e) => e.date === dateDisplay);
  return exc ? typeNames[exc.type] : "";
}

function addException() {
  const date = elements.exceptionDate.value;
  const type = elements.exceptionType.value;
  if (!date) { showToast("Selecione uma data", "error"); return; }
  const dateDisplay = formatDateForAPI(date);
  if (state.exceptions.some((e) => e.date === dateDisplay)) { showToast("Esta data já foi adicionada", "error"); return; }
  state.exceptions.push({ date: dateDisplay, type });
  renderExceptions();
  if (state.days.length > 0) renderDaysList();
  elements.exceptionDate.value = "";
}

function removeException(index) {
  state.exceptions.splice(index, 1);
  renderExceptions();
  if (state.days.length > 0) renderDaysList();
}

function renderExceptions() {
  const typeNames = { ferias: "Férias", atestado: "Atestado", afastamento: "Afastamento", banco: "Banco de Horas", feriado_manual: "Feriado Manual" };
  elements.exceptionsList.innerHTML = state.exceptions
    .map((exc, index) => `
      <li>
        <span>${exc.date} - ${typeNames[exc.type]}</span>
        <button class="remove-exception" onclick="removeException(${index})">✕</button>
      </li>
    `)
    .join("");
}

window.removeException = removeException;

// ============ Submit Form ============

async function handleSubmit(e) {
  e.preventDefault();
  // Impedir que o navegador bloqueie o submit por validação nativa do campo nome
  // (o nome é opcional para análise — obrigatório apenas ao salvar no histórico)
  e.stopImmediatePropagation();

  state.colaborador = elements.colaboradorName.value.trim();

  if (state.days.length === 0) { showToast("Gere a lista de dias primeiro", "error"); return; }

  const results = [];
  let totalWorkedHours = 0;
  let workdaysCount = 0;
  let ignoredCount = 0;

  for (const day of state.days) {
    const isNonWorkday = day.isWeekend || day.isHoliday || isException(day.dateDisplay);

    if (isNonWorkday) {
      const reason = day.isWeekend
        ? "Final de Semana"
        : day.isHoliday
        ? `Feriado (${day.holidayName})`
        : getExceptionType(day.dateDisplay);

      results.push({
        date: day.dateDisplay, day_of_week: day.dayName,
        worked_time: "----", redmine_value: "----", day_type: reason,
        status: "ignorado", status_description: reason,
        css_class: "status-ignored", is_ignored: true,
      });
      ignoredCount++;
    } else {
      const workedTime = formatTotalHours(day.totalHours);
      const redmineValue = hoursToRedmine(day.totalHours);
      totalWorkedHours += day.totalHours;
      workdaysCount++;

      results.push({
        date: day.dateDisplay, day_of_week: day.dayName,
        worked_time: workedTime, redmine_value: redmineValue, day_type: day.activityType || "",
        status: day.status,
        status_description: day.status === "ok" ? "✔ Confere" : day.status === "divergent" ? "✘ Divergente" : "⏳ Pendente",
        css_class: day.status === "ok" ? "status-ok" : day.status === "divergent" ? "status-divergent" : "",
        is_ignored: false,
      });
    }
  }

  state.results = {
    days: results,
    summary: {
      total_days: state.days.length,
      workdays_analyzed: workdaysCount,
      days_ignored: ignoredCount,
      total_worked_hours: totalWorkedHours,
      total_worked_display: `${totalWorkedHours.toFixed(2)}h`,
    },
  };

  renderResults(state.results);
  elements.resultsSection.style.display = "block";

  // Mostrar confirmação de salvamento
  if (elements.saveConfirmation) {
    elements.saveConfirmation.style.display = "block";
    elements.saveConfirmation.classList.add("animate-in");
  }

  elements.resultsSection.scrollIntoView({ behavior: "smooth" });
  showToast(state.colaborador ? `Análise concluída, ${state.colaborador}!` : "Análise concluída!", "success");
}

// ============ Render Results ============

function renderResults(data) {
  renderSummary(data.summary);
  renderTable(data.days);
}

function renderSummary(summary) {
  elements.summaryCards.innerHTML = `
    <div class="summary-card">
      <div class="value">${summary.total_days}</div>
      <div class="label">Total de Dias</div>
    </div>
    <div class="summary-card">
      <div class="value">${summary.workdays_analyzed}</div>
      <div class="label">Dias Úteis</div>
    </div>
    <div class="summary-card ignored">
      <div class="value">${summary.days_ignored}</div>
      <div class="label">Ignorados</div>
    </div>
    <div class="summary-card">
      <div class="value">${summary.total_worked_display}</div>
      <div class="label">Total Horas</div>
    </div>
  `;
}

function renderTable(days) {
  elements.resultsBody.innerHTML = days
    .map(
      (day, index) => `
        <tr class="${day.css_class}" data-index="${index}">
          <td>${day.date}</td>
          <td>${day.day_of_week}</td>
          <td>${day.worked_time}</td>
          <td>
            ${!day.is_ignored
              ? `<span class="redmine-value-cell">
                  <strong>${day.redmine_value}</strong>
                  <button type="button" class="btn-copy-value" onclick="copyRedmineValue(${index})" title="Copiar valor para lançar no Redmine">📋</button>
                </span>`
              : `<strong>${day.redmine_value}</strong>`
            }
          </td>
          <td>
            ${!day.is_ignored
              ? `<select class="tipo-select ${day.day_type ? 'tipo-' + normalizeTipo(day.day_type) : ''}" onchange="setDayType(${index}, this.value)" title="Tipo de atividade no Redmine">
                  <option value="">Selecionar…</option>
                  ${ACTIVITY_TYPES.map((t) => `<option value="${t}" ${day.day_type === t ? "selected" : ""}>${t}</option>`).join("")}
                </select>`
              : `${day.day_type || "—"}`
            }
          </td>
          <td>
            ${!day.is_ignored
              ? `<div class="status-selector">
                  <button onclick="setStatus(${index}, 'ok')" class="${day.status === 'ok' ? 'active-ok' : ''}" title="Confere">✔</button>
                  <button onclick="setStatus(${index}, 'divergent')" class="${day.status === 'divergent' ? 'active-divergent' : ''}" title="Divergente">✘</button>
                  <button onclick="setStatus(${index}, 'pending')" class="${day.status === 'pending' ? 'active-pending' : ''}" title="Pendente">⏳</button>
                </div>`
              : `<span class="status-badge">📅 Ignorado</span>`
            }
          </td>
        </tr>
      `,
    )
    .join("");
}

function setDayType(index, tipo) {
  if (!state.results) return;
  const resultDay = state.results.days[index];
  if (resultDay.is_ignored) return;

  resultDay.day_type = tipo;
  const originalDay = state.days.find((d) => d.dateDisplay === resultDay.date);
  if (originalDay) originalDay.activityType = tipo;

  // Atualizar diretamente a célula do tipo na linha correspondente para feedback imediato
  updateTipoCellInDOM(index, tipo);
}

function setAllDayTypes(tipo) {
  if (!state.results) return;
  let count = 0;
  state.results.days.forEach((resultDay, idx) => {
    if (resultDay.is_ignored) return;
    resultDay.day_type = tipo;
    const originalDay = state.days.find((d) => d.dateDisplay === resultDay.date);
    if (originalDay) originalDay.activityType = tipo;
    count++;
    // Atualizar cada dropdown individual na tabela
    updateTipoCellInDOM(idx, tipo);
  });
  showToast(`🏷️ Tipo "${tipo}" aplicado a ${count} dia(s)`, "success");
}

/**
 * Atualiza diretamente o dropdown de tipo na linha da tabela de resultados,
 * sem re-renderizar toda a tabela (garante feedback visual imediato).
 */
function updateTipoCellInDOM(index, tipo) {
  const row = elements.resultsBody.querySelector(`tr[data-index="${index}"]`);
  if (!row) return;
  const select = row.querySelector('select.tipo-select');
  if (select) {
    select.value = tipo;
    // Atualizar classes CSS de estilo do dropdown
    select.className = `tipo-select ${tipo ? 'tipo-' + normalizeTipo(tipo) : ''}`;
  }
}

async function copyRedmineValue(index) {
  if (!state.results) return;
  const value = state.results.days[index]?.redmine_value;
  if (!value || value === "----") return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(`📋 "${value}" copiado!`, "success");
  } catch {
    showToast("Não foi possível copiar. Selecione e copie manualmente.", "error");
  }
}

window.setDayType = setDayType;
window.copyRedmineValue = copyRedmineValue;

function setStatus(index, status) {
  if (!state.results) return;
  const resultDay = state.results.days[index];
  if (resultDay.is_ignored) return;

  const originalDay = state.days.find((d) => d.dateDisplay === resultDay.date);
  if (originalDay) originalDay.status = status;

  resultDay.status = status;
  resultDay.status_description = status === "ok" ? "✔ Confere" : status === "divergent" ? "✘ Divergente" : "⏳ Pendente";
  resultDay.css_class = status === "ok" ? "status-ok" : status === "divergent" ? "status-divergent" : "";
  renderTable(state.results.days);
}

window.setStatus = setStatus;

// ============ Salvar no Histórico ============

async function saveToHistory() {
  // Sempre reler o colaborador do campo de input para garantir valor atual
  const colaborador = elements.colaboradorName.value.trim() || state.colaborador;
  if (!colaborador) { showToast("Informe seu nome antes de salvar", "error"); elements.colaboradorName.focus(); return; }

  if (state.days.length === 0) { showToast("Nenhum apontamento para salvar. Gere a lista de dias primeiro.", "error"); return; }

  const dias = state.days.map((day) => {
    const isNonWorkday = day.isWeekend || day.isHoliday || isException(day.dateDisplay);
    return {
      date: day.dateDisplay,
      day_name: day.dayName,
      intervals: day.intervals.map((iv) => ({
        entry: iv.entry || "",
        exit: iv.exit || "",
      })),
      overtime: day.overtime || "00:00",
      absence: day.absence || "00:00",
      activity_type: day.activityType || "",
      total_hours: day.totalHours || 0,
      is_ignored: isNonWorkday,
      ignore_reason: isNonWorkday
        ? day.isWeekend ? "Final de Semana"
        : day.isHoliday ? `Feriado (${day.holidayName})`
        : getExceptionType(day.dateDisplay)
        : "",
    };
  });

  const totalHoras = state.results?.summary?.total_worked_hours || 0;
  const periodoInicio = state.days[0]?.dateDisplay || "";
  const periodoFim = state.days[state.days.length - 1]?.dateDisplay || "";

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const criadoEm = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const record = {
    uuid: generateUUID(),
    colaborador,
    periodo_inicio: periodoInicio,
    periodo_fim: periodoFim,
    total_horas: totalHoras,
    criado_em: criadoEm,
    dias,
    synced: false,
    server_id: null,
  };

  // 1) Salvar no navegador primeiro — garantido mesmo se o servidor estiver fora
  upsertLocalRecord(record);

  // 2) Sincronizar com o servidor (best-effort)
  showLoading(true);
  try {
    const response = await apiCall("/api/salvar-apontamento", "POST", {
      uuid: record.uuid,
      colaborador,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      total_horas: totalHoras,
      criado_em: criadoEm,
      dias,
    });
    const data = await response.json();
    record.synced = true;
    record.server_id = data.id;
    upsertLocalRecord(record);
    showToast("✅ Apontamento salvo e sincronizado!", "success");
  } catch (error) {
    console.warn("Servidor indisponível, registro guardado localmente:", error);
    showToast("💾 Salvo no navegador! Será sincronizado quando o servidor acordar.", "success");
  } finally {
    showLoading(false);
  }

  // Esconder bloco de confirmação após salvar
  if (elements.saveConfirmation) {
    elements.saveConfirmation.style.opacity = "0";
    setTimeout(() => { elements.saveConfirmation.style.display = "none"; }, 400);
  }

  // Carregar e mostrar o histórico
  await loadHistory();
  elements.historySection.style.display = "block";
  elements.historySection.scrollIntoView({ behavior: "smooth" });
}

// ============ Histórico ============

// Impede que cargas simultâneas do histórico se empilhem (cada uma disparava
// uma sincronização, o que podia gerar registros duplicados no servidor).
let historyLoading = false;

async function loadHistory() {
  if (historyLoading) return;
  historyLoading = true;

  try {
    const colaborador = elements.filterColaborador?.value?.trim() || "";
    const mes = elements.filterMes?.value || "";
    const applyFilters = (records) =>
      records.filter((rec) => matchesHistoryFilters(rec, colaborador, mes));

    const render = (localRecords, serverRecords, serverOk) => {
      const filtered = applyFilters(mergeHistory(localRecords, serverRecords));
      state.historyRecords = filtered;
      renderHistoryCards(filtered, serverOk);
    };

    // Buscar do servidor (best-effort — o histórico local funciona offline)
    let serverRecords = [];
    let serverOk = false;
    try {
      const response = await apiCall("/api/historico");
      const data = await response.json();
      serverRecords = data.registros || [];
      serverOk = true;
    } catch (error) {
      console.warn("Servidor indisponível — exibindo histórico local:", error);
    }

    render(getLocalHistory(), serverRecords, serverOk);

    elements.historySection.style.display = "block";
    // Ocultar botão flutuante quando o histórico está visível
    const floatBtn = document.getElementById("float-history-btn");
    if (floatBtn) floatBtn.style.display = "none";

    // Reenviar registros locais que o servidor perdeu.
    // Re-renderiza a partir do estado local — NUNCA chama loadHistory() de novo
    // (a recursão criava um novo registro no servidor a cada volta).
    if (serverOk) {
      const resynced = await syncLocalToServer(getLocalHistory(), serverRecords);
      if (resynced > 0) render(getLocalHistory(), serverRecords, true);
    }
  } finally {
    historyLoading = false;
  }
}

function mergeHistory(localRecords, serverRecords) {
  const merged = localRecords.map((r) => ({ ...r }));
  const byUuid = new Map(merged.map((r) => [r.uuid, r]));
  const byFingerprint = new Map(merged.map((r) => [recordFingerprint(r), r]));
  const deleted = new Set(getDeletedUuids());

  for (const s of serverRecords) {
    if (s.uuid && deleted.has(s.uuid)) continue; // excluído aqui, pendente no servidor
    // Casar por uuid ou, se o servidor não o devolver, pelo conteúdo
    const local = (s.uuid && byUuid.get(s.uuid)) || byFingerprint.get(recordFingerprint(s));
    if (local) {
      local.synced = true;
      local.server_id = s.id;
    } else {
      // Registro que existe apenas no servidor (ex.: salvo em outro navegador)
      merged.push({
        uuid: s.uuid || `srv-${s.id}`,
        server_id: s.id,
        colaborador: s.colaborador,
        periodo_inicio: s.periodo_inicio,
        periodo_fim: s.periodo_fim,
        total_horas: s.total_horas,
        criado_em: s.criado_em,
        synced: true,
        serverOnly: true,
      });
    }
  }

  merged.sort((a, b) => parseCreatedAt(b.criado_em) - parseCreatedAt(a.criado_em));
  return merged;
}

function matchesHistoryFilters(rec, colaborador, mes) {
  if (colaborador && !(rec.colaborador || "").toLowerCase().includes(colaborador.toLowerCase())) {
    return false;
  }
  if (mes) {
    const [year, month] = mes.split("-");
    const suffix = `/${month}/${year}`;
    const inicio = rec.periodo_inicio || "";
    const fim = rec.periodo_fim || "";
    if (!inicio.endsWith(suffix) && !fim.endsWith(suffix)) return false;
  }
  return true;
}

// Guardas contra reenvio em loop: uma sincronização por vez e, no máximo, uma
// tentativa de envio por registro em cada sessão. Se o servidor não reconhecer
// o registro (ex.: versão antiga que não devolve o uuid), o pior caso passa a
// ser uma tentativa inútil — e não uma cadeia infinita de novos registros.
let syncRunning = false;
const syncAttempted = new Set();

/**
 * Reenvia ao servidor os registros que existem apenas no navegador.
 * É assim que o histórico "renasce" depois que o Render free tier reinicia.
 * Retorna quantos registros foram reenviados.
 */
async function syncLocalToServer(localRecords, serverRecords) {
  if (syncRunning) return 0;
  syncRunning = true;

  const serverUuids = new Set(serverRecords.map((r) => r.uuid).filter(Boolean));
  const serverFingerprints = new Set(serverRecords.map(recordFingerprint));
  let resynced = 0;

  try {
    // Concluir exclusões pendentes no servidor
    for (const deletedUuid of getDeletedUuids()) {
      const serverRec = serverRecords.find((r) => r.uuid === deletedUuid);
      if (!serverRec) {
        clearDeletedUuid(deletedUuid); // já não existe no servidor
        continue;
      }
      try {
        await apiCall(`/api/historico/${serverRec.id}`, "DELETE");
        clearDeletedUuid(deletedUuid);
      } catch {
        break; // servidor fora — tenta na próxima
      }
    }

    for (const rec of localRecords) {
      const alreadyOnServer =
        serverUuids.has(rec.uuid) || serverFingerprints.has(recordFingerprint(rec));

      if (alreadyOnServer) {
        if (!rec.synced) {
          rec.synced = true;
          upsertLocalRecord(rec);
        }
        continue;
      }
      if (!rec.dias) continue;   // sem detalhes não há o que reenviar
      if (!rec.uuid) continue;   // sem uuid o servidor não consegue evitar duplicata
      if (syncAttempted.has(rec.uuid)) continue; // já tentado nesta sessão

      syncAttempted.add(rec.uuid);
      try {
        const response = await apiCall("/api/salvar-apontamento", "POST", {
          uuid: rec.uuid,
          colaborador: rec.colaborador,
          periodo_inicio: rec.periodo_inicio,
          periodo_fim: rec.periodo_fim,
          total_horas: rec.total_horas || 0,
          criado_em: rec.criado_em,
          dias: rec.dias,
        });
        const data = await response.json();
        rec.synced = true;
        rec.server_id = data.id;
        upsertLocalRecord(rec);
        resynced++;
      } catch (error) {
        console.warn("Falha ao re-sincronizar registro:", rec.uuid, error);
        syncAttempted.delete(rec.uuid); // falha de rede pode ser tentada de novo
        break; // servidor provavelmente fora — tenta de novo na próxima carga
      }
    }
  } finally {
    syncRunning = false;
  }

  if (resynced > 0) {
    console.info(`[Sync] ${resynced} registro(s) re-sincronizado(s) com o servidor.`);
  }
  return resynced;
}

function renderHistoryCards(records, serverOk = true) {
  if (!elements.historyList) return;

  if (records.length === 0) {
    elements.historyList.innerHTML = `
      <div class="history-empty">
        <span>📭</span>
        <p>Nenhum registro encontrado.</p>
        ${!serverOk ? `<p class="history-offline-note">⚠️ Servidor indisponível no momento — exibindo apenas o histórico deste navegador.</p>` : ""}
      </div>
    `;
    return;
  }

  const offlineNote = !serverOk
    ? `<p class="history-offline-note">⚠️ Servidor indisponível — exibindo o histórico salvo neste navegador. A sincronização será retomada automaticamente.</p>`
    : "";

  elements.historyList.innerHTML = offlineNote + records
    .map((rec) => {
      const syncBadge = rec.synced
        ? `<span class="sync-badge synced" title="Sincronizado com o servidor">☁️ Sincronizado</span>`
        : `<span class="sync-badge local" title="Salvo apenas neste navegador — será sincronizado automaticamente quando o servidor estiver disponível">💾 Local</span>`;

      return `
        <div class="history-card" data-uuid="${rec.uuid}">
          <div class="history-card-main">
            <div class="history-card-person">
              <span class="history-person-icon">👤</span>
              <div class="history-person-info">
                <strong>${rec.colaborador}</strong>
                ${syncBadge}
              </div>
            </div>
            <div class="history-card-period">
              <span class="history-period-label">📅 Período:</span>
              <span>${rec.periodo_inicio} → ${rec.periodo_fim}</span>
            </div>
            <div class="history-card-total">
              <span class="history-total-label">⏱️ Total Horas:</span>
              <strong class="history-total-value">${(rec.total_horas || 0).toFixed(2)}h</strong>
            </div>
            <div class="history-card-date">
              <span class="history-date-label">🕐 Salvo em:</span>
              <span class="history-date-value">${rec.criado_em}</span>
            </div>
          </div>
          <div class="history-card-actions">
            <button
              class="btn-view-detail"
              onclick="viewHistoryDetail('${rec.uuid}')"
              title="Ver detalhes das atividades"
            >👁️</button>
            <button
              class="btn-delete-history"
              onclick="deleteHistoryRecord('${rec.uuid}')"
              title="Excluir este registro"
            >🗑️</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function deleteHistoryRecord(uuid) {
  if (!confirm("Deseja realmente excluir este registro do histórico?")) return;

  const rec = (state.historyRecords || []).find((r) => r.uuid === uuid);

  // Remover do navegador e marcar lápide (impede "ressurreição" na sincronização)
  removeLocalRecord(uuid);
  addDeletedUuid(uuid);

  // Remover do servidor (best-effort; se falhar, a lápide tenta de novo depois)
  if (rec?.server_id) {
    try {
      await apiCall(`/api/historico/${rec.server_id}`, "DELETE");
      clearDeletedUuid(uuid);
    } catch (error) {
      console.warn("Servidor indisponível — exclusão será repetida na próxima sincronização:", error);
    }
  } else {
    clearDeletedUuid(uuid); // nunca chegou ao servidor
  }

  showToast("Registro excluído!", "success");
  await loadHistory();
}

window.deleteHistoryRecord = deleteHistoryRecord;

/**
 * Apaga TODOS os registros do histórico — no navegador e no servidor.
 * Registros que não puderam ser removidos do servidor ficam marcados como
 * excluídos (lápides) e serão apagados na próxima sincronização.
 */
async function clearAllHistory() {
  const total = (state.historyRecords || []).length;
  const localTotal = getLocalHistory().length;

  if (total === 0 && localTotal === 0) {
    showToast("O histórico já está vazio.", "info");
    return;
  }

  const msg =
    `Apagar TODO o histórico (${Math.max(total, localTotal)} registro(s))?\n\n` +
    `Esta ação remove os registros deste navegador e do servidor e NÃO pode ser desfeita.\n` +
    `Dica: use "⬇️ Backup" antes, se quiser guardar uma cópia.`;
  if (!confirm(msg)) return;

  // Lápides antes de limpar o local, para que nada "ressuscite" na sincronização
  for (const rec of state.historyRecords || []) {
    if (rec.uuid) addDeletedUuid(rec.uuid);
  }

  const serverIds = (state.historyRecords || [])
    .map((r) => r.server_id)
    .filter((id) => id != null);

  clearLocalHistory();
  state.historyRecords = [];
  syncAttempted.clear();
  renderHistoryCards([], true);

  showLoading(true);
  let serverCleared = false;
  try {
    await apiCall("/api/historico", "DELETE");
    serverCleared = true;
  } catch (error) {
    console.warn("Limpeza em lote indisponível, removendo registro por registro:", error);
    // Fallback: apagar um a um (servidor sem o endpoint de limpeza total)
    try {
      for (const id of serverIds) {
        await apiCall(`/api/historico/${id}`, "DELETE");
      }
      serverCleared = true;
    } catch (err) {
      console.warn("Servidor indisponível — exclusões pendentes serão repetidas:", err);
    }
  } finally {
    showLoading(false);
  }

  if (serverCleared) {
    try { localStorage.removeItem(LS_DELETED_KEY); } catch { /* ignore */ }
    showToast("🗑️ Histórico apagado por completo!", "success");
  } else {
    showToast("🗑️ Histórico apagado neste navegador. O servidor será limpo na próxima sincronização.", "success");
  }

  await loadHistory();
}

// ============ Detalhe do Histórico ============

async function viewHistoryDetail(uuid) {
  const modal = document.getElementById("history-detail-modal");
  const metaEl = document.getElementById("history-detail-meta");
  const bodyEl = document.getElementById("history-detail-body");

  // Mostrar loading no modal
  bodyEl.innerHTML = `<div class="detail-loading"><div class="spinner" style="width:32px;height:32px;border-width:3px"></div><p>Carregando...</p></div>`;
  modal.style.display = "flex";

  try {
    const rec = (state.historyRecords || []).find((r) => r.uuid === uuid);
    let data;

    if (rec?.dias) {
      // Registro completo disponível no navegador — sem depender do servidor
      data = rec;
    } else if (rec?.server_id) {
      const response = await apiCall(`/api/historico/${rec.server_id}`);
      data = await response.json();
    } else {
      throw new Error("Registro não encontrado");
    }

    // Metadados
    metaEl.innerHTML = `
      <span class="detail-meta-item">👤 <strong>${data.colaborador}</strong></span>
      <span class="detail-meta-sep">•</span>
      <span class="detail-meta-item">📅 ${data.periodo_inicio} → ${data.periodo_fim}</span>
      <span class="detail-meta-sep">•</span>
      <span class="detail-meta-item">⏱️ <strong>${(data.total_horas || 0).toFixed(2)}h</strong></span>
    `;

    // Dias com atividades
    const diasUteis = (data.dias || []).filter(d => !d.is_ignored);
    const diasIgnorados = (data.dias || []).filter(d => d.is_ignored);

    if (diasUteis.length === 0) {
      bodyEl.innerHTML = `<p class="detail-empty">Nenhum dia útil registrado neste apontamento.</p>`;
      return;
    }

    const diasHtml = diasUteis.map(day => {
      const intervalsHtml = day.intervals
        .filter(iv => iv.entry || iv.exit)
        .map((iv, idx) => {
          const timeRange = (iv.entry && iv.exit)
            ? `<span class="detail-interval-time">${iv.entry} → ${iv.exit}</span>`
            : `<span class="detail-interval-time detail-interval-incomplete">(incompleto)</span>`;

          return `
            <div class="detail-interval">
              <div class="detail-interval-header">
                <span class="detail-interval-badge">Intervalo ${idx + 1}</span>
                ${timeRange}
              </div>
            </div>
          `;
        }).join("");

      const totalHorasDay = day.total_hours > 0
        ? `<span class="detail-day-total">${day.total_hours.toFixed(2)}h (${formatTotalHours(day.total_hours)})</span>`
        : ``;

      const balanceHtml = (day.overtime && day.overtime !== "00:00") || (day.absence && day.absence !== "00:00") ? `
        <div class="detail-balance" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color); font-size: 0.8rem; display: flex; gap: 15px;">
          <span><strong>Horas Extras:</strong> ${day.overtime || "00:00"}</span>
          <span><strong>Ausências:</strong> ${day.absence || "00:00"}</span>
        </div>
      ` : '';

      const tipoBadge = day.activity_type
        ? `<span class="detail-tipo-badge tipo-${normalizeTipo(day.activity_type)}">${day.activity_type}</span>`
        : "";

      return `
        <div class="detail-day-card">
          <div class="detail-day-header">
            <div class="detail-day-info">
              <strong class="detail-day-date">${day.date}</strong>
              <span class="detail-day-name">${day.day_name}</span>
              ${tipoBadge}
            </div>
            ${totalHorasDay}
          </div>
          <div class="detail-intervals">
            ${intervalsHtml || `<p class="detail-no-desc">Nenhum intervalo preenchido</p>`}
          </div>
          ${balanceHtml}
        </div>
      `;
    }).join("");

    // Dias ignorados resumidos
    const ignoradosHtml = diasIgnorados.length > 0
      ? `<details class="detail-ignored-section">
           <summary>📅 Dias não úteis (${diasIgnorados.length})</summary>
           <div class="detail-ignored-list">
             ${diasIgnorados.map(d => `<span class="detail-ignored-badge">${d.date} — ${d.ignore_reason || d.day_name}</span>`).join("")}
           </div>
         </details>`
      : "";

    bodyEl.innerHTML = `
      <div class="table-legend">
        <span class="legend-item"><span class="legend-badge">HE</span> Horas Extras</span>
        <span class="legend-item"><span class="legend-badge">AUS</span> Ausências</span>
        <span class="legend-item"><span class="legend-badge alert">!</span> Divergência</span>
      </div>
      <div class="detail-days-list">${diasHtml}</div>
      ${ignoradosHtml}
    `;

  } catch (error) {
    console.error("Erro ao buscar detalhes:", error);
    bodyEl.innerHTML = `<p class="detail-empty" style="color: var(--status-divergent)">Erro ao carregar detalhes: ${error.message}</p>`;
  }
}

window.viewHistoryDetail = viewHistoryDetail;

// ============ Export ============

async function handleExport() {
  if (!state.results || !state.results.days.length) { showToast("Nenhum dado para exportar", "error"); return; }
  showLoading(true);
  try {
    const response = await fetch(`${API_BASE}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: state.results.days }),
    });
    if (!response.ok) throw new Error("Erro ao exportar");
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apontamento_resultado.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    showToast("Arquivo exportado com sucesso!", "success");
  } catch (error) {
    console.error("Erro:", error);
    showToast("Erro ao exportar arquivo", "error");
  } finally {
    showLoading(false);
  }
}

// ============ UI Helpers ============

function showLoading(show) {
  elements.loading.style.display = show ? "flex" : "none";
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type} show`;
  setTimeout(() => { elements.toast.classList.remove("show"); }, 3000);
}

// ============ Float History Button ============

/**
 * Verifica silenciosamente se há registros no histórico.
 * Se sim, exibe o botão flutuante discreto.
 */
async function checkAndShowFloatBtn() {
  const floatBtn = document.getElementById("float-history-btn");
  if (!floatBtn) return;

  // Histórico local aparece na hora, sem esperar o servidor acordar
  if (getLocalHistory().length > 0) {
    floatBtn.style.display = "flex";
    return;
  }

  try {
    const response = await apiCall("/api/historico");
    const data = await response.json();
    if (data.registros && data.registros.length > 0) {
      floatBtn.style.display = "flex";
    }
  } catch (error) {
    // Silencioso — sem aviso ao usuário
    console.warn("Não foi possível verificar histórico na inicialização:", error);
  }
}

// ============ Backup / Restauração ============

function exportBackup() {
  const records = getLocalHistory();
  if (records.length === 0) {
    showToast("Nenhum registro local para exportar.", "error");
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `apontamentos_backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;

  const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);

  showToast(`⬇️ Backup com ${records.length} registro(s) baixado!`, "success");
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("Formato inválido");

      const existing = getLocalHistory();
      const existingUuids = new Set(existing.map((r) => r.uuid));
      let added = 0;

      for (const rec of imported) {
        if (!rec.uuid || !rec.colaborador || !rec.periodo_inicio) continue;
        if (existingUuids.has(rec.uuid)) continue;
        existing.push({ ...rec, synced: false, server_id: null });
        added++;
      }

      setLocalHistory(existing);
      showToast(added > 0
        ? `⬆️ ${added} registro(s) restaurado(s) com sucesso!`
        : "Todos os registros do backup já existem.", "success");
      loadHistory();
    } catch (error) {
      console.error("Erro ao importar backup:", error);
      showToast("Arquivo de backup inválido.", "error");
    }
  };
  reader.readAsText(file);
}

/**
 * Mantém a aplicação ativa no Render fazendo um ping periódico.
 */
function setupAntiSleepPing() {
  const TEN_MINUTES = 10 * 60 * 1000;
  
  // Ping imediato e depois a cada 10 minutos
  const ping = async () => {
    try {
      console.log(`[Anti-Sleep] Pingando API em ${new Date().toLocaleTimeString()}...`);
      await fetch(`${API_BASE}/api/health`).catch(() => {});
    } catch (error) {
      console.warn("[Anti-Sleep] Falha no ping:", error);
    }
  };

  ping();
  setInterval(ping, TEN_MINUTES);
}
