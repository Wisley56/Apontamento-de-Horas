/**
 * Núcleo de cálculo de horas — funções puras, sem DOM.
 *
 * Toda a aritmética é feita em MINUTOS INTEIROS. Conversões para HH:MM,
 * horas decimais ou segundos (formato da API do Businessmap) acontecem
 * apenas na borda, nas funções de formatação.
 */

export const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_EXPECTED_MINUTES = 8 * 60;
export const LONG_DAY_MINUTES = 12 * 60;

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ============ Tempo ============

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** "8:05" | "08:05" | "08:05:00" | "24:00" → minutos; inválido/vazio → null. */
export function parseTime(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const m = str.match(TIME_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Duração "HH:MM" (pode passar de 24h, ex. saldo de HE) → minutos; inválido → null. */
export function parseDuration(value) {
  if (value == null) return null;
  const str = String(value).trim();
  const m = str.match(/^(-)?(\d{1,3}):(\d{2})$/);
  if (!m || Number(m[3]) > 59) return null;
  const total = Number(m[2]) * 60 + Number(m[3]);
  return m[1] ? -total : total;
}

/** minutos → "HH:MM" (com sinal quando negativo). Nunca gera ":60". */
export function minutesToHHMM(minutes) {
  const total = Math.round(Number(minutes) || 0);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** minutos → horas decimais em texto, ex. 497 → "8.28". */
export function minutesToDecimal(minutes, digits = 2) {
  return ((Number(minutes) || 0) / 60).toFixed(digits);
}

/** minutos → segundos (unidade do campo `time` da API do Businessmap). */
export function minutesToSeconds(minutes) {
  return Math.round(Number(minutes) || 0) * 60;
}

// ============ Cálculo do dia ============

/**
 * Calcula um dia a partir das batidas.
 *
 * @param {object} day
 * @param {{entry:string, exit:string}[]} day.intervals
 * @param {string|null} [day.overtime]  HE informada pelo ponto (HH:MM) ou null
 * @param {string|null} [day.absence]   Ausências informadas pelo ponto (HH:MM) ou null
 * @param {number} [day.expectedMinutes] Jornada esperada
 * @returns {{
 *   workedMinutes:number,
 *   formulaMinutes:number|null,
 *   divergenceMinutes:number,
 *   warnings:{code:string, message:string}[]
 * }}
 */
export function computeDay({ intervals = [], overtime = null, absence = null, expectedMinutes = DEFAULT_EXPECTED_MINUTES } = {}) {
  const warnings = [];
  const segments = [];

  intervals.forEach((interval, i) => {
    const label = `Intervalo ${i + 1}`;
    const rawEntry = (interval?.entry || "").trim();
    const rawExit = (interval?.exit || "").trim();
    if (!rawEntry && !rawExit) return;

    const start = parseTime(rawEntry);
    const end = parseTime(rawExit);

    if ((rawEntry && start === null) || (rawExit && end === null)) {
      warnings.push({ code: "invalid_time", message: `${label}: horário inválido.` });
      return;
    }
    if (start === null || end === null) {
      warnings.push({
        code: "unpaired",
        message: `${label}: ${start === null ? "falta a entrada" : "falta a saída"}. O intervalo não foi somado.`,
      });
      return;
    }
    if (end === start) {
      warnings.push({ code: "zero_interval", message: `${label}: entrada e saída iguais.` });
      return;
    }
    if (end < start) {
      warnings.push({ code: "overnight", message: `${label}: saída antes da entrada. Considerado como virada da meia-noite.` });
      segments.push([start, end + MINUTES_PER_DAY]);
      return;
    }
    segments.push([start, end]);
  });

  // União dos segmentos: intervalos sobrepostos não são contados duas vezes.
  segments.sort((a, b) => a[0] - b[0]);
  let workedMinutes = 0;
  let curStart = null;
  let curEnd = null;
  let overlapped = false;
  for (const [s, e] of segments) {
    if (curEnd === null) {
      [curStart, curEnd] = [s, e];
    } else if (s < curEnd) {
      overlapped = true;
      curEnd = Math.max(curEnd, e);
    } else {
      workedMinutes += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  if (curEnd !== null) workedMinutes += curEnd - curStart;

  if (overlapped) {
    warnings.push({ code: "overlap", message: "Há intervalos sobrepostos. O tempo em comum foi contado uma vez só." });
  }
  if (segments.length === 0 && !warnings.length) {
    warnings.push({ code: "no_punches", message: "Nenhuma batida informada." });
  }
  if (workedMinutes > LONG_DAY_MINUTES) {
    warnings.push({ code: "long_day", message: `Jornada acima de ${LONG_DAY_MINUTES / 60}h. Confira as batidas.` });
  }

  // Fórmula do ponto: só existe quando o ponto informou HE/Ausências.
  const he = parseDuration(overtime);
  const aus = parseDuration(absence);
  const hasPontoData = he !== null || aus !== null;
  const formulaMinutes = hasPontoData ? Math.max(0, expectedMinutes + (he || 0) - (aus || 0)) : null;
  const divergenceMinutes = formulaMinutes === null || segments.length === 0 ? 0 : workedMinutes - formulaMinutes;

  return { workedMinutes, formulaMinutes, divergenceMinutes, warnings };
}

/**
 * Total oficial do dia. Padrão: soma das marcações.
 * Com source === "ponto" e fórmula disponível, usa jornada + HE − AUS.
 */
export function chooseDayTotal(computed, source = "marcacoes") {
  if (source === "ponto" && computed.formulaMinutes !== null) return computed.formulaMinutes;
  return computed.workedMinutes;
}

// ============ Divisão entre atividades ============

/**
 * Divide `total` minutos proporcionalmente aos pesos (ex. percentuais),
 * pelo método do maior resto: a soma do resultado é SEMPRE igual a `total`.
 */
export function splitMinutes(total, weights) {
  const t = Math.round(total);
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (!w.length || sum === 0 || t <= 0) return w.map(() => 0);

  const raw = w.map((x) => (t * x) / sum);
  const result = raw.map(Math.floor);
  let remainder = t - result.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    result[order[k].i] += 1;
  }
  return result;
}

/** Valida uma divisão em minutos: retorna o quanto falta (positivo) ou sobra (negativo). */
export function allocationRemaining(total, minutesList) {
  return Math.round(total) - minutesList.reduce((a, b) => a + (Math.round(Number(b) || 0)), 0);
}

// ============ Datas (sempre em horário local) ============

const pad2 = (n) => String(n).padStart(2, "0");

/** Date → "YYYY-MM-DD" usando o fuso local (nunca UTC). */
export function toISODateLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "YYYY-MM-DD" → Date à meia-noite local; inválido → null. */
export function parseISODateLocal(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

export function isoToBr(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

export function brToIso(br) {
  const [d, m, y] = String(br).split("/");
  return `${y}-${m}-${d}`;
}

/** Lista de datas ISO de start até end (inclusive). */
export function eachDay(startIso, endIso, maxDays = 400) {
  const start = parseISODateLocal(startIso);
  const end = parseISODateLocal(endIso);
  if (!start || !end || end < start) return [];
  const days = [];
  const cur = new Date(start);
  while (cur <= end && days.length < maxDays) {
    days.push(toISODateLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function weekdayIndex(iso) {
  return parseISODateLocal(iso)?.getDay() ?? -1;
}

export function isWeekendIso(iso) {
  const d = weekdayIndex(iso);
  return d === 0 || d === 6;
}

/** Anos distintos cobertos pelo intervalo (para buscar feriados de cada ano). */
export function yearsInRange(startIso, endIso) {
  const a = Number(String(startIso).slice(0, 4));
  const b = Number(String(endIso).slice(0, 4));
  const years = [];
  for (let y = a; y <= b; y++) years.push(y);
  return years;
}

// ============ Parser do texto colado do ponto ============

const DATE_RE = /(\d{2}\/\d{2}\/\d{4})/;
const TIME_GLOBAL_RE = /\b(\d{1,2}:\d{2})(?::\d{2})?\b/g;

function normalizeText(line) {
  return line.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function timesIn(line) {
  return [...line.matchAll(TIME_GLOBAL_RE)].map((m) => m[1].padStart(5, "0"));
}

function pushPunch(day, kind, time) {
  if (kind === "entry") {
    day.intervals.push({ entry: time, exit: "" });
  } else {
    const open = day.intervals[day.intervals.length - 1];
    if (open && open.entry && !open.exit) open.exit = time;
    else day.intervals.push({ entry: "", exit: time });
  }
}

/** Batida sem rótulo: alterna entrada/saída conforme o último intervalo. */
function pushAlternating(day, time) {
  const last = day.intervals[day.intervals.length - 1];
  pushPunch(day, last && last.entry && !last.exit ? "exit" : "entry", time);
}

/**
 * Interpreta o texto copiado do sistema de ponto.
 *
 * Formatos aceitos (podem estar misturados):
 *  - rótulos em linhas separadas:  "Entrada" / "08:00" / "Saída" / "12:00"
 *  - rótulo e horário na mesma linha: "Entrada 08:00", "Saída: 12:00"
 *  - várias batidas na mesma linha:   "08:00 12:00 13:00 17:00" ou separadas por TAB
 *  - batidas na própria linha da data: "01/10/2025 Qua 08:00 12:00 13:00 17:00"
 *  - "Horas extras 00:30" / "Ausências 00:15" (mesma linha ou na seguinte)
 *
 * @returns {{days:{date:string, intervals:{entry:string,exit:string}[], overtime:string|null, absence:string|null}[], warnings:string[]}}
 */
export function parseTimesheet(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const days = [];
  const warnings = [];
  let day = null;
  let expecting = null; // "entry" | "exit" | "overtime" | "absence"

  const finish = () => {
    if (!day) return;
    const hasData = day.intervals.length > 0 || day.overtime !== null || day.absence !== null;
    if (hasData) days.push(day);
    day = null;
  };

  for (const line of lines) {
    const dateMatch = line.match(DATE_RE);
    if (dateMatch && dateMatch.index <= 3) {
      finish();
      day = { date: dateMatch[1], intervals: [], overtime: null, absence: null };
      expecting = null;
      const rest = line.slice(dateMatch.index + dateMatch[1].length);
      const times = timesIn(rest);
      if (times.length >= 2) times.forEach((t) => pushAlternating(day, t));
      continue;
    }
    if (!day) continue;

    const norm = normalizeText(line);
    const times = timesIn(line);

    if (/horas?\s*extras?/.test(norm)) {
      if (times.length) { day.overtime = times[0]; expecting = null; } else expecting = "overtime";
      continue;
    }
    if (/ausencias?/.test(norm)) {
      if (times.length) { day.absence = times[0]; expecting = null; } else expecting = "absence";
      continue;
    }
    if (/^entrada\b/.test(norm)) {
      if (times.length) { pushPunch(day, "entry", times[0]); expecting = null; } else expecting = "entry";
      continue;
    }
    if (/^saida\b/.test(norm)) {
      if (times.length) { pushPunch(day, "exit", times[0]); expecting = null; } else expecting = "exit";
      continue;
    }

    if (times.length && /^[\d:\s\t|;,-]+$/.test(line)) {
      if (expecting === "overtime") day.overtime = times[0];
      else if (expecting === "absence") day.absence = times[0];
      else if (expecting === "entry" || expecting === "exit") {
        pushPunch(day, expecting, times[0]);
        times.slice(1).forEach((t) => pushAlternating(day, t));
      } else times.forEach((t) => pushAlternating(day, t));
      expecting = null;
      continue;
    }

    if (times.length) {
      warnings.push(`${day.date}: linha não reconhecida ignorada: "${line.slice(0, 60)}"`);
    }
  }
  finish();

  for (const d of days) {
    const unpaired = d.intervals.filter((i) => !i.entry || !i.exit).length;
    if (unpaired) warnings.push(`${d.date}: ${unpaired} batida(s) sem par.`);
  }
  return { days, warnings };
}
