/**
 * Sistema de Apontamento de Horas - Frontend JavaScript
 * Lógica de interação, chamadas à API e renderização
 */

// ============ Estado Global ============

const state = {
    selectionType: 'period',
    exceptions: [],
    results: null,
    states: [],
    days: [],  // Lista de dias gerados
    holidays: {}  // Feriados detectados
};


// ============ Elementos DOM ============

const elements = {
    // Toggle
    btnPeriod: document.getElementById('btn-period'),
    btnSingle: document.getElementById('btn-single'),
    
    // Date inputs
    startDateGroup: document.getElementById('start-date-group'),
    endDateGroup: document.getElementById('end-date-group'),
    singleDateGroup: document.getElementById('single-date-group'),
    startDate: document.getElementById('start-date'),
    endDate: document.getElementById('end-date'),
    singleDate: document.getElementById('single-date'),
    
    // Form
    form: document.getElementById('hours-form'),
    stateSelect: document.getElementById('state-select'),
    generateDaysBtn: document.getElementById('generate-days-btn'),
    
    // Days list
    daysListSection: document.getElementById('days-list-section'),
    daysList: document.getElementById('days-list'),
    exceptionsSection: document.getElementById('exceptions-section'),
    analyzeBtn: document.getElementById('analyze-btn'),
    
    // Exceptions
    exceptionDate: document.getElementById('exception-date'),
    exceptionType: document.getElementById('exception-type'),
    addExceptionBtn: document.getElementById('add-exception'),
    exceptionsList: document.getElementById('exceptions-list'),
    
    // Results
    resultsSection: document.getElementById('results-section'),
    summaryCards: document.getElementById('summary-cards'),
    resultsBody: document.getElementById('results-body'),
    exportBtn: document.getElementById('export-btn'),
    
    // UI
    loading: document.getElementById('loading'),
    toast: document.getElementById('toast')
};


// ============ Inicialização ============

document.addEventListener('DOMContentLoaded', () => {
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

const API_BASE = '';

async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    if (data) {
        options.body = JSON.stringify(data);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Erro na requisição');
    }
    
    return response;
}

async function loadStates() {
    try {
        const response = await apiCall('/api/states');
        state.states = await response.json();
        
        // Popular select
        state.states.forEach(s => {
            const option = document.createElement('option');
            option.value = s.code;
            option.textContent = `${s.code} - ${s.name}`;
            elements.stateSelect.appendChild(option);
        });
        
        // Selecionar SP por padrão
        elements.stateSelect.value = 'SP';
    } catch (error) {
        console.error('Erro ao carregar estados:', error);
        showToast('Erro ao carregar estados', 'error');
    }
}


// ============ Event Listeners ============

function setupEventListeners() {
    // Toggle de tipo de seleção
    elements.btnPeriod.addEventListener('click', () => toggleSelectionType('period'));
    elements.btnSingle.addEventListener('click', () => toggleSelectionType('single'));
    
    // Gerar lista de dias
    elements.generateDaysBtn.addEventListener('click', generateDaysList);
    
    // Exceções
    elements.addExceptionBtn.addEventListener('click', addException);
    
    // Submit do formulário
    elements.form.addEventListener('submit', handleSubmit);
    
    // Exportar
    elements.exportBtn.addEventListener('click', handleExport);
}


// ============ Toggle Selection Type ============

function toggleSelectionType(type) {
    state.selectionType = type;
    
    // Toggle buttons
    elements.btnPeriod.classList.toggle('active', type === 'period');
    elements.btnSingle.classList.toggle('active', type === 'single');
    
    // Toggle date inputs
    if (type === 'period') {
        elements.startDateGroup.style.display = 'block';
        elements.endDateGroup.style.display = 'block';
        elements.singleDateGroup.style.display = 'none';
    } else {
        elements.startDateGroup.style.display = 'none';
        elements.endDateGroup.style.display = 'none';
        elements.singleDateGroup.style.display = 'block';
    }
    
    // Esconder lista de dias ao mudar tipo
    elements.daysListSection.style.display = 'none';
    elements.exceptionsSection.style.display = 'none';
    elements.analyzeBtn.style.display = 'none';
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
    return date.toISOString().split('T')[0];
}

function formatDateForAPI(dateStr) {
    // Converte yyyy-mm-dd para dd/mm/yyyy
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

function formatDateFromAPI(dateStr) {
    // Converte dd/mm/yyyy para yyyy-mm-dd
    if (!dateStr) return '';
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month}-${day}`;
}

function getDayOfWeekName(dateStr) {
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, month - 1, day);
    return days[date.getDay()];
}

function isWeekend(dateStr) {
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, month - 1, day);
    return date.getDay() === 0 || date.getDay() === 6;
}


// ============ Generate Days List ============

async function generateDaysList() {
    // Validar datas
    let startDate, endDate;
    
    if (state.selectionType === 'period') {
        startDate = elements.startDate.value;
        endDate = elements.endDate.value;
        
        if (!startDate || !endDate) {
            showToast('Preencha as datas inicial e final', 'error');
            return;
        }
        
        if (new Date(endDate) < new Date(startDate)) {
            showToast('Data final deve ser maior que a inicial', 'error');
            return;
        }
    } else {
        startDate = elements.singleDate.value;
        endDate = startDate;
        
        if (!startDate) {
            showToast('Selecione a data', 'error');
            return;
        }
    }
    
    const stateUF = elements.stateSelect.value;
    if (!stateUF) {
        showToast('Selecione o estado', 'error');
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
                entry1: '',
                exit1: '',
                entry2: '',
                exit2: '',
                totalHours: 0,
                status: 'pending'  // pending, ok, divergent
            };
            
            days.push(dayInfo);
            current.setDate(current.getDate() + 1);
        }
        
        state.days = days;
        renderDaysList();
        
        // Mostrar seções
        elements.daysListSection.style.display = 'block';
        elements.exceptionsSection.style.display = 'block';
        elements.analyzeBtn.style.display = 'flex';
        
        showToast(`${days.length} dia(s) gerado(s)`, 'success');
        
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao gerar lista de dias', 'error');
    } finally {
        showLoading(false);
    }
}

function renderDaysList() {
    elements.daysList.innerHTML = state.days.map((day, index) => {
        const isNonWorkday = day.isWeekend || day.isHoliday || isException(day.dateDisplay);
        const rowClass = day.isWeekend ? 'weekend' : (day.isHoliday ? 'holiday' : '');
        
        if (isNonWorkday) {
            const reason = day.isWeekend ? 'Final de Semana' : 
                          (day.isHoliday ? `Feriado: ${day.holidayName}` : 
                           getExceptionType(day.dateDisplay));
            
            return `
                <div class="day-row ${rowClass}" data-index="${index}">
                    <span class="day-date">${day.dateDisplay}</span>
                    <span class="day-name">${day.dayName}</span>
                    <span class="day-type-badge">📅 ${reason}</span>
                </div>
            `;
        }
        
        return `
            <div class="day-row" data-index="${index}">
                <span class="day-date">${day.dateDisplay}</span>
                <span class="day-name">${day.dayName}</span>
                <input type="time" class="time-input" data-field="entry1" value="${day.entry1}" 
                       onchange="updateDayTime(${index}, 'entry1', this.value)" placeholder="08:00">
                <input type="time" class="time-input" data-field="exit1" value="${day.exit1}" 
                       onchange="updateDayTime(${index}, 'exit1', this.value)" placeholder="12:00">
                <input type="time" class="time-input" data-field="entry2" value="${day.entry2}" 
                       onchange="updateDayTime(${index}, 'entry2', this.value)" placeholder="13:00">
                <input type="time" class="time-input" data-field="exit2" value="${day.exit2}" 
                       onchange="updateDayTime(${index}, 'exit2', this.value)" placeholder="17:00">
                <span class="day-total" id="total-${index}">${formatTotalHours(day.totalHours)}</span>
            </div>
        `;
    }).join('');
}

function updateDayTime(index, field, value) {
    state.days[index][field] = value;
    calculateDayTotal(index);
}

function calculateDayTotal(index) {
    const day = state.days[index];
    let totalMinutes = 0;
    
    // Calcular período 1 (manhã)
    if (day.entry1 && day.exit1) {
        const start1 = timeToMinutes(day.entry1);
        const end1 = timeToMinutes(day.exit1);
        if (end1 > start1) {
            totalMinutes += end1 - start1;
        }
    }
    
    // Calcular período 2 (tarde)
    if (day.entry2 && day.exit2) {
        const start2 = timeToMinutes(day.entry2);
        const end2 = timeToMinutes(day.exit2);
        if (end2 > start2) {
            totalMinutes += end2 - start2;
        }
    }
    
    day.totalHours = totalMinutes / 60;
    
    // Atualizar display
    const totalElement = document.getElementById(`total-${index}`);
    if (totalElement) {
        totalElement.textContent = formatTotalHours(day.totalHours);
    }
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatTotalHours(hours) {
    if (hours === 0) return '--:--';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function hoursToRedmine(hours) {
    return hours.toFixed(2);
}

// Expor funções para uso global
window.updateDayTime = updateDayTime;


// ============ Exceções ============

function isException(dateDisplay) {
    return state.exceptions.some(e => e.date === dateDisplay);
}

function getExceptionType(dateDisplay) {
    const typeNames = {
        'ferias': 'Férias',
        'atestado': 'Atestado',
        'afastamento': 'Afastamento',
        'banco': 'Banco de Horas',
        'feriado_manual': 'Feriado Manual'
    };
    const exc = state.exceptions.find(e => e.date === dateDisplay);
    return exc ? typeNames[exc.type] : '';
}

function addException() {
    const date = elements.exceptionDate.value;
    const type = elements.exceptionType.value;
    
    if (!date) {
        showToast('Selecione uma data', 'error');
        return;
    }
    
    const dateDisplay = formatDateForAPI(date);
    
    // Verificar se já existe
    if (state.exceptions.some(e => e.date === dateDisplay)) {
        showToast('Esta data já foi adicionada', 'error');
        return;
    }
    
    state.exceptions.push({
        date: dateDisplay,
        type: type
    });
    
    // Renderizar lista
    renderExceptions();
    
    // Re-renderizar dias se já gerados
    if (state.days.length > 0) {
        renderDaysList();
    }
    
    // Limpar input
    elements.exceptionDate.value = '';
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
        'ferias': 'Férias',
        'atestado': 'Atestado',
        'afastamento': 'Afastamento',
        'banco': 'Banco de Horas',
        'feriado_manual': 'Feriado Manual'
    };
    
    elements.exceptionsList.innerHTML = state.exceptions.map((exc, index) => `
        <li>
            <span>${exc.date} - ${typeNames[exc.type]}</span>
            <button class="remove-exception" onclick="removeException(${index})">✕</button>
        </li>
    `).join('');
}

// Expor função para uso global (onclick)
window.removeException = removeException;


// ============ Submit Form ============

async function handleSubmit(e) {
    e.preventDefault();
    
    if (state.days.length === 0) {
        showToast('Gere a lista de dias primeiro', 'error');
        return;
    }
    
    // Processar dados
    const results = [];
    let totalWorkedHours = 0;
    let workdaysCount = 0;
    let ignoredCount = 0;
    
    const daysOfWeek = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    
    for (const day of state.days) {
        const isNonWorkday = day.isWeekend || day.isHoliday || isException(day.dateDisplay);
        
        if (isNonWorkday) {
            const reason = day.isWeekend ? 'Final de Semana' : 
                          (day.isHoliday ? `Feriado (${day.holidayName})` : 
                           getExceptionType(day.dateDisplay));
            
            results.push({
                date: day.dateDisplay,
                day_of_week: day.dayName,
                worked_time: '----',
                redmine_value: '----',
                day_type: reason,
                status: 'ignorado',
                status_description: reason,
                css_class: 'status-ignored',
                is_ignored: true
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
                day_type: '',
                status: day.status,
                status_description: day.status === 'ok' ? '✔ Confere' : 
                                   (day.status === 'divergent' ? '✘ Divergente' : '⏳ Pendente'),
                css_class: day.status === 'ok' ? 'status-ok' : 
                          (day.status === 'divergent' ? 'status-divergent' : ''),
                is_ignored: false
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
            total_worked_display: `${totalWorkedHours.toFixed(2)}h`
        }
    };
    
    // Renderizar resultados
    renderResults(state.results);
    
    // Mostrar seção de resultados
    elements.resultsSection.style.display = 'block';
    elements.resultsSection.scrollIntoView({ behavior: 'smooth' });
    
    showToast('Análise concluída!', 'success');
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
    elements.resultsBody.innerHTML = days.map((day, index) => `
        <tr class="${day.css_class}" data-index="${index}">
            <td>${day.date}</td>
            <td>${day.day_of_week}</td>
            <td>${day.worked_time}</td>
            <td><strong>${day.redmine_value}</strong></td>
            <td>${day.day_type || '—'}</td>
            <td>
                ${!day.is_ignored ? `
                    <div class="status-selector">
                        <button onclick="setStatus(${index}, 'ok')" 
                                class="${day.status === 'ok' ? 'active-ok' : ''}" 
                                title="Confere">✔</button>
                        <button onclick="setStatus(${index}, 'divergent')" 
                                class="${day.status === 'divergent' ? 'active-divergent' : ''}" 
                                title="Divergente">✘</button>
                        <button onclick="setStatus(${index}, 'pending')" 
                                class="${day.status === 'pending' ? 'active-pending' : ''}" 
                                title="Pendente">⏳</button>
                    </div>
                ` : `<span class="status-badge">📅 Ignorado</span>`}
            </td>
        </tr>
    `).join('');
}

function setStatus(index, status) {
    if (!state.results) return;
    
    // Atualizar no estado original de dias
    const resultDay = state.results.days[index];
    if (resultDay.is_ignored) return;
    
    // Encontrar o dia correspondente em state.days
    const originalDay = state.days.find(d => d.dateDisplay === resultDay.date);
    if (originalDay) {
        originalDay.status = status;
    }
    
    resultDay.status = status;
    resultDay.status_description = status === 'ok' ? '✔ Confere' : 
                                  (status === 'divergent' ? '✘ Divergente' : '⏳ Pendente');
    resultDay.css_class = status === 'ok' ? 'status-ok' : 
                         (status === 'divergent' ? 'status-divergent' : '');
    
    // Re-renderizar tabela
    renderTable(state.results.days);
}

// Expor função para uso global
window.setStatus = setStatus;


// ============ Export ============

async function handleExport() {
    if (!state.results || !state.results.days.length) {
        showToast('Nenhum dado para exportar', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/export', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ days: state.results.days })
        });
        
        if (!response.ok) {
            throw new Error('Erro ao exportar');
        }
        
        // Download do arquivo
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'apontamento_resultado.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showToast('Arquivo exportado com sucesso!', 'success');
        
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao exportar arquivo', 'error');
    } finally {
        showLoading(false);
    }
}


// ============ UI Helpers ============

function showLoading(show) {
    elements.loading.style.display = show ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}
