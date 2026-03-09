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
  // Verificar se já há histórico para exibir o botão flutuante
  checkAndShowFloatBtn();
}

// ============ API Calls ============

const API_BASE = window.APP_CONFIG?.API_URL || '';

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

  // Colaborador
  elements.colaboradorName.addEventListener("input", (e) => {
    state.colaborador = e.target.value.trim();
  });

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
  } else {
    elements.startDateGroup.style.display = "none";
    elements.endDateGroup.style.display = "none";
    elements.singleDateGroup.style.display = "block";
    if (elements.stateSelectGroup) elements.stateSelectGroup.style.display = "none";
    elements.generateDaysBtn.style.display = "none";
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
        { entry: "", exit: "", description: "" },
        { entry: "", exit: "", description: "" },
      ],
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
        <span class="dup-record-total">⏱️ ${rec.total_horas.toFixed(2)}h</span>
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
          { entry: "", exit: "", description: "" },
          { entry: "", exit: "", description: "" },
        ],
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

      // Intervalos com descrição
      const intervalsHtml = day.intervals.map((interval, intervalIndex) => `
        <div class="interval-block">
          <div class="interval-times">
            <input type="time" class="time-input" value="${interval.entry}"
                   onchange="updateIntervalTime(${index}, ${intervalIndex}, 'entry', this.value)"
                   placeholder="08:00" title="Entrada ${intervalIndex + 1}">
            <input type="time" class="time-input" value="${interval.exit}"
                   onchange="updateIntervalTime(${index}, ${intervalIndex}, 'exit', this.value)"
                   placeholder="12:00" title="Saída ${intervalIndex + 1}">
          </div>
          <textarea class="interval-description"
                    rows="2"
                    placeholder="Descreva as atividades deste período..."
                    onchange="updateIntervalDescription(${index}, ${intervalIndex}, this.value)"
                    title="Descrição do intervalo ${intervalIndex + 1}">${interval.description || ""}</textarea>
        </div>
      `).join('');

      const actionsHtml = `
        <div class="day-actions">
          <button type="button" class="btn-add-interval" onclick="addInterval(${index})" title="Adicionar intervalo">➕</button>
          ${day.intervals.length > 2 ? `
          <button type="button" class="btn-remove-interval" onclick="removeLastInterval(${index})" title="Remover último intervalo">➖</button>
          ` : ''}
        </div>
      `;

      return `
        <div class="day-row workday with-description" data-index="${index}" data-intervals="${day.intervals.length}">
          <div class="day-info">
            <span class="day-date">${day.dateDisplay}</span>
            <span class="day-name">${day.dayName}</span>
          </div>
          <div class="day-intervals-wrapper">
            ${intervalsHtml}
          </div>
          <div class="day-footer-row">
            <span class="day-total" id="total-${index}">${formatTotalHours(day.totalHours)}</span>
            ${actionsHtml}
          </div>
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

function updateIntervalDescription(dayIndex, intervalIndex, value) {
  state.days[dayIndex].intervals[intervalIndex].description = value;
}

function addInterval(dayIndex) {
  state.days[dayIndex].intervals.push({ entry: "", exit: "", description: "" });
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
  if (state.days[dayIndex].intervals.length > 2) {
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
window.updateIntervalDescription = updateIntervalDescription;
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

  for (const line of lines) {
    const dateMatch = line.match(dateRegex);
    if (dateMatch) {
      if (currentDay && currentDay.intervals.length > 0) result.push(currentDay);
      currentDay = { date: dateMatch[1], intervals: [] };
      currentEntry = null;
      expectingTime = null;
      continue;
    }
    if (!currentDay) continue;

    const lowerLine = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (lowerLine === 'entrada') { expectingTime = 'entry'; continue; }
    if (lowerLine === 'saida') { expectingTime = 'exit'; continue; }

    if (timeRegex.test(line) && expectingTime) {
      if (expectingTime === 'entry') {
        currentEntry = { entry: line, exit: '', description: '' };
      } else if (expectingTime === 'exit' && currentEntry) {
        currentEntry.exit = line;
        currentDay.intervals.push({ ...currentEntry });
        currentEntry = null;
      }
      expectingTime = null;
    }
  }
  if (currentDay && currentDay.intervals.length > 0) result.push(currentDay);
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
      day.intervals.push({ entry: '', exit: '', description: '' });
    }
    for (let i = 0; i < parsed.intervals.length; i++) {
      day.intervals[i].entry = parsed.intervals[i].entry;
      day.intervals[i].exit = parsed.intervals[i].exit;
      // Mantém a descrição existente ao colar
    }
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

  // Validar colaborador
  const colaborador = elements.colaboradorName.value.trim();
  if (!colaborador) {
    showToast("Por favor, informe seu nome antes de analisar", "error");
    elements.colaboradorName.focus();
    return;
  }
  state.colaborador = colaborador;

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
        worked_time: workedTime, redmine_value: redmineValue, day_type: "",
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
  showToast(`Análise concluída, ${colaborador}!`, "success");
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
          <td><strong>${day.redmine_value}</strong></td>
          <td>${day.day_type || "—"}</td>
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
        description: iv.description || "",
      })),
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

  showLoading(true);
  try {
    await apiCall("/api/salvar-apontamento", "POST", {
      colaborador,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      total_horas: totalHoras,
      dias,
    });

    showToast("✅ Apontamento salvo no histórico!", "success");

    // Esconder bloco de confirmação após salvar
    if (elements.saveConfirmation) {
      elements.saveConfirmation.style.opacity = "0";
      setTimeout(() => { elements.saveConfirmation.style.display = "none"; }, 400);
    }

    // Carregar e mostrar o histórico
    await loadHistory();
    elements.historySection.style.display = "block";
    elements.historySection.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Erro ao salvar:", error);
    showToast(`Erro ao salvar: ${error.message}`, "error");
  } finally {
    showLoading(false);
  }
}

// ============ Histórico ============

async function loadHistory() {
  const colaborador = elements.filterColaborador?.value?.trim() || "";
  const mes = elements.filterMes?.value || "";

  let endpoint = "/api/historico";
  const params = [];
  if (colaborador) params.push(`colaborador=${encodeURIComponent(colaborador)}`);
  if (mes) params.push(`mes=${encodeURIComponent(mes)}`);
  if (params.length > 0) endpoint += "?" + params.join("&");

  try {
    const response = await apiCall(endpoint);
    const data = await response.json();
    renderHistoryCards(data.registros || []);
    elements.historySection.style.display = "block";
    // Ocultar botão flutuante quando o histórico está visível
    const floatBtn = document.getElementById("float-history-btn");
    if (floatBtn) floatBtn.style.display = "none";
  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
    if (elements.historyList) {
      elements.historyList.innerHTML = `<p class="history-empty">Erro ao carregar o histórico. Tente novamente.</p>`;
    }
  }
}

function renderHistoryCards(records) {
  if (!elements.historyList) return;

  if (records.length === 0) {
    elements.historyList.innerHTML = `
      <div class="history-empty">
        <span>📭</span>
        <p>Nenhum registro encontrado.</p>
      </div>
    `;
    return;
  }

  elements.historyList.innerHTML = records
    .map(
      (rec) => `
        <div class="history-card" data-id="${rec.id}">
          <div class="history-card-main">
            <div class="history-card-person">
              <span class="history-person-icon">👤</span>
              <strong>${rec.colaborador}</strong>
            </div>
            <div class="history-card-period">
              <span class="history-period-label">📅 Período:</span>
              <span>${rec.periodo_inicio} → ${rec.periodo_fim}</span>
            </div>
            <div class="history-card-total">
              <span class="history-total-label">⏱️ Total Horas:</span>
              <strong class="history-total-value">${rec.total_horas.toFixed(2)}h</strong>
            </div>
            <div class="history-card-date">
              <span class="history-date-label">🕐 Salvo em:</span>
              <span class="history-date-value">${rec.criado_em}</span>
            </div>
          </div>
          <div class="history-card-actions">
            <button
              class="btn-view-detail"
              onclick="viewHistoryDetail(${rec.id})"
              title="Ver detalhes das atividades"
            >👁️</button>
            <button
              class="btn-delete-history"
              onclick="deleteHistoryRecord(${rec.id})"
              title="Excluir este registro"
            >🗑️</button>
          </div>
        </div>
      `,
    )
    .join("");
}

async function deleteHistoryRecord(id) {
  if (!confirm("Deseja realmente excluir este registro do histórico?")) return;

  try {
    await apiCall(`/api/historico/${id}`, "DELETE");
    showToast("Registro excluído!", "success");
    await loadHistory();
  } catch (error) {
    console.error("Erro ao excluir:", error);
    showToast(`Erro ao excluir: ${error.message}`, "error");
  }
}

window.deleteHistoryRecord = deleteHistoryRecord;

// ============ Detalhe do Histórico ============

async function viewHistoryDetail(id) {
  const modal = document.getElementById("history-detail-modal");
  const metaEl = document.getElementById("history-detail-meta");
  const bodyEl = document.getElementById("history-detail-body");

  // Mostrar loading no modal
  bodyEl.innerHTML = `<div class="detail-loading"><div class="spinner" style="width:32px;height:32px;border-width:3px"></div><p>Carregando...</p></div>`;
  modal.style.display = "flex";

  try {
    const response = await apiCall(`/api/historico/${id}`);
    const data = await response.json();

    // Metadados
    metaEl.innerHTML = `
      <span class="detail-meta-item">👤 <strong>${data.colaborador}</strong></span>
      <span class="detail-meta-sep">•</span>
      <span class="detail-meta-item">📅 ${data.periodo_inicio} → ${data.periodo_fim}</span>
      <span class="detail-meta-sep">•</span>
      <span class="detail-meta-item">⏱️ <strong>${data.total_horas.toFixed(2)}h</strong></span>
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

          const descHtml = iv.description
            ? `<p class="detail-interval-desc">${iv.description}</p>`
            : `<p class="detail-interval-desc detail-no-desc">Sem descrição informada</p>`;

          return `
            <div class="detail-interval">
              <div class="detail-interval-header">
                <span class="detail-interval-badge">Intervalo ${idx + 1}</span>
                ${timeRange}
              </div>
              ${descHtml}
            </div>
          `;
        }).join("");

      const totalHorasDay = day.total_hours > 0
        ? `<span class="detail-day-total">${day.total_hours.toFixed(2)}h</span>`
        : ``;

      return `
        <div class="detail-day-card">
          <div class="detail-day-header">
            <div class="detail-day-info">
              <strong class="detail-day-date">${day.date}</strong>
              <span class="detail-day-name">${day.day_name}</span>
            </div>
            ${totalHorasDay}
          </div>
          <div class="detail-intervals">
            ${intervalsHtml || `<p class="detail-no-desc">Nenhum intervalo preenchido</p>`}
          </div>
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
  try {
    const response = await apiCall("/api/historico");
    const data = await response.json();
    const floatBtn = document.getElementById("float-history-btn");
    if (floatBtn && data.registros && data.registros.length > 0) {
      floatBtn.style.display = "flex";
    }
  } catch (error) {
    // Silencioso — sem aviso ao usuário
    console.warn("Não foi possível verificar histórico na inicialização:", error);
  }
}
