/**
 * Sistema de Apontamento de Horas - Frontend JavaScript
 * Lógica de interação, chamadas à API e renderização
 */

// ============ Estado Global ============

const state = {
  selectionType: "period",
  exceptions: [],
  results: null,
  states: [],
  days: [], // Lista de dias gerados
  holidays: {}, // Feriados detectados
};

// ============ Elementos DOM ============

const elements = {
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

  // UI
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast"),
};

// ============ Inicialização ============

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

async function initializeApp() {
  // Carregar estados
  await loadStates();

  // Event listeners
  setupEventListeners();

  // Definir datas padrão (mês atual)
  setDefaultDates();
}

// ============ API Calls ============

// Configuração da API - busca do arquivo config.js ou usa fallback para desenvolvimento local
const API_BASE = window.APP_CONFIG?.API_URL || '';

async function apiCall(endpoint, method = "GET", data = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Erro na requisição");
  }

  return response;
}

async function loadStates() {
  try {
    const response = await apiCall("/api/states");
    state.states = await response.json();

    // Popular select
    state.states.forEach((s) => {
      const option = document.createElement("option");
      option.value = s.code;
      option.textContent = `${s.code} - ${s.name}`;
      elements.stateSelect.appendChild(option);
    });

    // Selecionar GO por padrão
    elements.stateSelect.value = "GO";
  } catch (error) {
    console.error("Erro ao carregar estados:", error);
    showToast("Erro ao carregar estados", "error");
  }
}

// ============ Event Listeners ============

function setupEventListeners() {
  // Toggle de tipo de seleção
  elements.btnPeriod.addEventListener("click", () =>
    toggleSelectionType("period"),
  );
  elements.btnSingle.addEventListener("click", () =>
    toggleSelectionType("single"),
  );

  // Gerar lista de dias
  elements.generateDaysBtn.addEventListener("click", generateDaysList);

  // Exceções
  elements.addExceptionBtn.addEventListener("click", addException);

  // Auto-gerar dias quando selecionar data (modo dia específico)
  elements.singleDate.addEventListener("change", handleSingleDateChange);

  // Suporte a Enter para gerar dia rapidamente
  elements.singleDate.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSingleDateChange();
    }
  });

  // Submit do formulário
  elements.form.addEventListener("submit", handleSubmit);

  // Exportar
  elements.exportBtn.addEventListener("click", handleExport);
}

// ============ Toggle Selection Type ============

function toggleSelectionType(type) {
  state.selectionType = type;

  // Toggle buttons
  elements.btnPeriod.classList.toggle("active", type === "period");
  elements.btnSingle.classList.toggle("active", type === "single");

  // Toggle date inputs e seletor de estado
  if (type === "period") {
    elements.startDateGroup.style.display = "block";
    elements.endDateGroup.style.display = "block";
    elements.singleDateGroup.style.display = "none";
    // Mostrar seletor de estado para período
    if (elements.stateSelectGroup) {
      elements.stateSelectGroup.style.display = "block";
    }
    elements.generateDaysBtn.style.display = "flex";
  } else {
    elements.startDateGroup.style.display = "none";
    elements.endDateGroup.style.display = "none";
    elements.singleDateGroup.style.display = "block";
    // Ocultar seletor de estado para dia específico (desnecessário)
    if (elements.stateSelectGroup) {
      elements.stateSelectGroup.style.display = "none";
    }
    // Ocultar botão gerar dias (será automático)
    elements.generateDaysBtn.style.display = "none";
    
    // Auto-gerar o dia atual ao clicar em Dia Específico
    // Delay pequeno para garantir que o campo de data está visível
    setTimeout(() => {
      if (elements.singleDate.value) {
        handleSingleDateChange();
      }
    }, 100);
  }

  // Esconder lista de dias ao mudar tipo
  elements.daysListSection.style.display = "none";
  elements.exceptionsSection.style.display = "none";
  elements.analyzeBtn.style.display = "none";
}

// ============ Auto-gerar Dia Específico ============

async function handleSingleDateChange() {
  const dateValue = elements.singleDate.value;
  if (!dateValue) return;

  // Usar estado GO por padrão para dia específico
  const stateUF = "GO";
  const year = new Date(dateValue).getFullYear();

  showLoading(true);

  try {
    // Buscar feriados para verificar se é feriado nacional
    const response = await apiCall(`/api/holidays/${year}/${stateUF}`);
    const data = await response.json();
    const holidaysData = data.holidays || {};

    const dateAPI = formatDateForAPI(dateValue);
    const isHoliday = holidaysData[dateAPI] ? true : false;
    const holidayName = holidaysData[dateAPI] || null;

    // Verificar se é final de semana
    const isWeekendDay = isWeekend(dateValue);

    // Se for feriado nacional, mostrar modal de confirmação
    if (isHoliday) {
      showLoading(false);
      const confirmed = await showHolidayConfirmModal(dateAPI, holidayName);
      if (!confirmed) {
        // Usuário cancelou, limpar a data
        showToast("Lançamento cancelado", "info");
        return;
      }
      showLoading(true);
    }

    // Se for final de semana, também confirmar
    if (isWeekendDay) {
      showLoading(false);
      const dayName = getDayOfWeekName(dateValue);
      const confirmed = await showWeekendConfirmModal(dateAPI, dayName);
      if (!confirmed) {
        showToast("Lançamento cancelado", "info");
        return;
      }
      showLoading(true);
    }

    // Gerar o dia
    const dayInfo = {
      date: dateValue,
      dateDisplay: dateAPI,
      dayName: getDayOfWeekName(dateValue),
      isWeekend: isWeekendDay,
      isHoliday: isHoliday,
      holidayName: holidayName,
      intervals: [{ entry: "", exit: "" }, { entry: "", exit: "" }],
      totalHours: 0,
      status: "pending",
    };

    state.days = [dayInfo];
    state.holidays = holidaysData;
    renderDaysList();

    // Mostrar seções
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

// Modal de confirmação para feriados
function showHolidayConfirmModal(dateStr, holidayName) {
  return new Promise((resolve) => {
    const modal = document.getElementById("holiday-confirm-modal");
    const titleEl = document.getElementById("holiday-modal-title");
    const messageEl = document.getElementById("holiday-modal-message");
    const confirmBtn = document.getElementById("holiday-modal-confirm");
    const cancelBtn = document.getElementById("holiday-modal-cancel");

    if (!modal) {
      // Fallback para confirm nativo se modal não existir
      const confirmed = confirm(
        `A data ${dateStr} é feriado (${holidayName}).\n\nDeseja realmente lançar horas neste dia?`
      );
      resolve(confirmed);
      return;
    }

    titleEl.textContent = "🎉 Feriado Detectado";
    messageEl.innerHTML = `
      <p>A data <strong>${dateStr}</strong> é um feriado:</p>
      <p class="holiday-name">📅 ${holidayName}</p>
      <p>Deseja realmente lançar horas neste dia?</p>
    `;

    modal.style.display = "flex";

    const handleConfirm = () => {
      modal.style.display = "none";
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      modal.style.display = "none";
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      confirmBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
    };

    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
  });
}

// Modal de confirmação para finais de semana
function showWeekendConfirmModal(dateStr, dayName) {
  return new Promise((resolve) => {
    const modal = document.getElementById("holiday-confirm-modal");
    const titleEl = document.getElementById("holiday-modal-title");
    const messageEl = document.getElementById("holiday-modal-message");
    const confirmBtn = document.getElementById("holiday-modal-confirm");
    const cancelBtn = document.getElementById("holiday-modal-cancel");

    if (!modal) {
      // Fallback para confirm nativo se modal não existir
      const confirmed = confirm(
        `A data ${dateStr} é ${dayName} (final de semana).\n\nDeseja realmente lançar horas neste dia?`
      );
      resolve(confirmed);
      return;
    }

    titleEl.textContent = "🗓️ Final de Semana";
    messageEl.innerHTML = `
      <p>A data <strong>${dateStr}</strong> é <strong>${dayName}</strong> (final de semana).</p>
      <p>Deseja realmente lançar horas neste dia?</p>
    `;

    modal.style.display = "flex";

    const handleConfirm = () => {
      modal.style.display = "none";
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      modal.style.display = "none";
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      confirmBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
    };

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
  // Converte yyyy-mm-dd para dd/mm/yyyy
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateFromAPI(dateStr) {
  // Converte dd/mm/yyyy para yyyy-mm-dd
  if (!dateStr) return "";
  const [day, month, year] = dateStr.split("/");
  return `${year}-${month}-${day}`;
}

function getDayOfWeekName(dateStr) {
  const days = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
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
  // Validar datas
  let startDate, endDate;

  if (state.selectionType === "period") {
    startDate = elements.startDate.value;
    endDate = elements.endDate.value;

    if (!startDate || !endDate) {
      showToast("Preencha as datas inicial e final", "error");
      return;
    }

    if (new Date(endDate) < new Date(startDate)) {
      showToast("Data final deve ser maior que a inicial", "error");
      return;
    }
  } else {
    startDate = elements.singleDate.value;
    endDate = startDate;

    if (!startDate) {
      showToast("Selecione a data", "error");
      return;
    }
  }

  const stateUF = elements.stateSelect.value;
  if (!stateUF) {
    showToast("Selecione o estado", "error");
    return;
  }

  showLoading(true);

  try {
    // Buscar feriados do ano
    const year = new Date(startDate).getFullYear();
    const response = await apiCall(`/api/holidays/${year}/${stateUF}`);
    const data = await response.json();
    state.holidays = data.holidays || {};

    // Gerar lista de dias
    const days = [];
    let current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = formatDateForInput(current);
      const dateAPI = formatDateForAPI(dateStr);

      const dayInfo = {
        date: dateStr,
        dateDisplay: dateAPI,
        dayName: getDayOfWeekName(dateStr),
        isWeekend: isWeekend(dateStr),
        isHoliday: state.holidays[dateAPI] ? true : false,
        holidayName: state.holidays[dateAPI] || null,
        intervals: [{ entry: "", exit: "" }, { entry: "", exit: "" }], // 2 intervalos por padrão
        totalHours: 0,
        status: "pending", // pending, ok, divergent
      };

      days.push(dayInfo);
      current.setDate(current.getDate() + 1);
    }

    state.days = days;
    renderDaysList();

    // Mostrar seções
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

function renderDaysList() {
  elements.daysList.innerHTML = state.days
    .map((day, index) => {
      const isNonWorkday =
        day.isWeekend || day.isHoliday || isException(day.dateDisplay);
      const rowClass = day.isWeekend
        ? "weekend"
        : day.isHoliday
          ? "holiday"
          : "";

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

      // Renderizar inputs de intervalos numerados
      const intervalsHtml = day.intervals.map((interval, intervalIndex) => `
        <input type="time" class="time-input" value="${interval.entry}" 
               onchange="updateIntervalTime(${index}, ${intervalIndex}, 'entry', this.value)" 
               placeholder="08:00" title="Entrada ${intervalIndex + 1}">
        <input type="time" class="time-input" value="${interval.exit}" 
               onchange="updateIntervalTime(${index}, ${intervalIndex}, 'exit', this.value)" 
               placeholder="12:00" title="Saída ${intervalIndex + 1}">
      `).join('');

      // Renderizar botões de adicionar/remover intervalo
      const actionsHtml = `
        <div class="day-actions">
          <button type="button" class="btn-add-interval" onclick="addInterval(${index})" title="Adicionar intervalo">
            ➕
          </button>
          ${day.intervals.length > 2 ? `
            <button type="button" class="btn-remove-interval" onclick="removeLastInterval(${index})" title="Remover último intervalo">
              ➖
            </button>
          ` : ''}
        </div>
      `;

      return `
            <div class="day-row workday" data-index="${index}" data-intervals="${day.intervals.length}">
                <span class="day-date">${day.dateDisplay}</span>
                <span class="day-name">${day.dayName}</span>
                ${intervalsHtml}
                <span class="day-total" id="total-${index}">${formatTotalHours(day.totalHours)}</span>
                ${actionsHtml}
            </div>
        `;
    })
    .join("");
}

// Atualizar tempo de um intervalo específico
function updateIntervalTime(dayIndex, intervalIndex, field, value) {
  state.days[dayIndex].intervals[intervalIndex][field] = value;
  calculateDayTotal(dayIndex);
}

// Adicionar novo intervalo a um dia
function addInterval(dayIndex) {
  state.days[dayIndex].intervals.push({ entry: "", exit: "" });
  renderDaysList();
}

// Remover intervalo de um dia
function removeInterval(dayIndex, intervalIndex) {
  if (state.days[dayIndex].intervals.length > 1) {
    state.days[dayIndex].intervals.splice(intervalIndex, 1);
    calculateDayTotal(dayIndex);
    renderDaysList();
  }
}

// Remover último intervalo de um dia (mantém mínimo de 2)
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

  // Calcular todos os intervalos
  for (const interval of day.intervals) {
    if (interval.entry && interval.exit) {
      const start = timeToMinutes(interval.entry);
      const end = timeToMinutes(interval.exit);
      if (end > start) {
        totalMinutes += end - start;
      }
    }
  }

  day.totalHours = totalMinutes / 60;

  // Atualizar display
  const totalElement = document.getElementById(`total-${dayIndex}`);
  if (totalElement) {
    totalElement.textContent = formatTotalHours(day.totalHours);
  }
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

// Expor funções para uso global
window.updateIntervalTime = updateIntervalTime;
window.addInterval = addInterval;
window.removeInterval = removeInterval;
window.removeLastInterval = removeLastInterval;

// ============ Exceções ============

function isException(dateDisplay) {
  return state.exceptions.some((e) => e.date === dateDisplay);
}

function getExceptionType(dateDisplay) {
  const typeNames = {
    ferias: "Férias",
    atestado: "Atestado",
    afastamento: "Afastamento",
    banco: "Banco de Horas",
    feriado_manual: "Feriado Manual",
  };
  const exc = state.exceptions.find((e) => e.date === dateDisplay);
  return exc ? typeNames[exc.type] : "";
}

function addException() {
  const date = elements.exceptionDate.value;
  const type = elements.exceptionType.value;

  if (!date) {
    showToast("Selecione uma data", "error");
    return;
  }

  const dateDisplay = formatDateForAPI(date);

  // Verificar se já existe
  if (state.exceptions.some((e) => e.date === dateDisplay)) {
    showToast("Esta data já foi adicionada", "error");
    return;
  }

  state.exceptions.push({
    date: dateDisplay,
    type: type,
  });

  // Renderizar lista
  renderExceptions();

  // Re-renderizar dias se já gerados
  if (state.days.length > 0) {
    renderDaysList();
  }

  // Limpar input
  elements.exceptionDate.value = "";
}

function removeException(index) {
  state.exceptions.splice(index, 1);
  renderExceptions();

  // Re-renderizar dias se já gerados
  if (state.days.length > 0) {
    renderDaysList();
  }
}

function renderExceptions() {
  const typeNames = {
    ferias: "Férias",
    atestado: "Atestado",
    afastamento: "Afastamento",
    banco: "Banco de Horas",
    feriado_manual: "Feriado Manual",
  };

  elements.exceptionsList.innerHTML = state.exceptions
    .map(
      (exc, index) => `
        <li>
            <span>${exc.date} - ${typeNames[exc.type]}</span>
            <button class="remove-exception" onclick="removeException(${index})">✕</button>
        </li>
    `,
    )
    .join("");
}

// Expor função para uso global (onclick)
window.removeException = removeException;

// ============ Submit Form ============

async function handleSubmit(e) {
  e.preventDefault();

  if (state.days.length === 0) {
    showToast("Gere a lista de dias primeiro", "error");
    return;
  }

  // Processar dados
  const results = [];
  let totalWorkedHours = 0;
  let workdaysCount = 0;
  let ignoredCount = 0;

  const daysOfWeek = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];

  for (const day of state.days) {
    const isNonWorkday =
      day.isWeekend || day.isHoliday || isException(day.dateDisplay);

    if (isNonWorkday) {
      const reason = day.isWeekend
        ? "Final de Semana"
        : day.isHoliday
          ? `Feriado (${day.holidayName})`
          : getExceptionType(day.dateDisplay);

      results.push({
        date: day.dateDisplay,
        day_of_week: day.dayName,
        worked_time: "----",
        redmine_value: "----",
        day_type: reason,
        status: "ignorado",
        status_description: reason,
        css_class: "status-ignored",
        is_ignored: true,
      });
      ignoredCount++;
    } else {
      // Dia útil
      const workedTime = formatTotalHours(day.totalHours);
      const redmineValue = hoursToRedmine(day.totalHours);

      totalWorkedHours += day.totalHours;
      workdaysCount++;

      results.push({
        date: day.dateDisplay,
        day_of_week: day.dayName,
        worked_time: workedTime,
        redmine_value: redmineValue,
        day_type: "",
        status: day.status,
        status_description:
          day.status === "ok"
            ? "✔ Confere"
            : day.status === "divergent"
              ? "✘ Divergente"
              : "⏳ Pendente",
        css_class:
          day.status === "ok"
            ? "status-ok"
            : day.status === "divergent"
              ? "status-divergent"
              : "",
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

  // Renderizar resultados
  renderResults(state.results);

  // Mostrar seção de resultados
  elements.resultsSection.style.display = "block";
  elements.resultsSection.scrollIntoView({ behavior: "smooth" });

  showToast("Análise concluída!", "success");
}

// ============ Render Results ============

function renderResults(data) {
  // Summary cards
  renderSummary(data.summary);

  // Table
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
                ${
                  !day.is_ignored
                    ? `
                    <div class="status-selector">
                        <button onclick="setStatus(${index}, 'ok')" 
                                class="${day.status === "ok" ? "active-ok" : ""}" 
                                title="Confere">✔</button>
                        <button onclick="setStatus(${index}, 'divergent')" 
                                class="${day.status === "divergent" ? "active-divergent" : ""}" 
                                title="Divergente">✘</button>
                        <button onclick="setStatus(${index}, 'pending')" 
                                class="${day.status === "pending" ? "active-pending" : ""}" 
                                title="Pendente">⏳</button>
                    </div>
                `
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

  // Atualizar no estado original de dias
  const resultDay = state.results.days[index];
  if (resultDay.is_ignored) return;

  // Encontrar o dia correspondente em state.days
  const originalDay = state.days.find((d) => d.dateDisplay === resultDay.date);
  if (originalDay) {
    originalDay.status = status;
  }

  resultDay.status = status;
  resultDay.status_description =
    status === "ok"
      ? "✔ Confere"
      : status === "divergent"
        ? "✘ Divergente"
        : "⏳ Pendente";
  resultDay.css_class =
    status === "ok"
      ? "status-ok"
      : status === "divergent"
        ? "status-divergent"
        : "";

  // Re-renderizar tabela
  renderTable(state.results.days);
}

// Expor função para uso global
window.setStatus = setStatus;

// ============ Export ============

async function handleExport() {
  if (!state.results || !state.results.days.length) {
    showToast("Nenhum dado para exportar", "error");
    return;
  }

  showLoading(true);

  try {
    const response = await fetch(`${API_BASE}/api/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ days: state.results.days }),
    });

    if (!response.ok) {
      throw new Error("Erro ao exportar");
    }

    // Download do arquivo
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

  setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3000);
}
