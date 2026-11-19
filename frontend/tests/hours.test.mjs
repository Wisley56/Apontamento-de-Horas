import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTime, parseDuration, minutesToHHMM, minutesToDecimal, minutesToSeconds,
  computeDay, chooseDayTotal, splitMinutes, allocationRemaining,
  toISODateLocal, parseISODateLocal, eachDay, isoToBr, brToIso, isWeekendIso, yearsInRange,
  parseTimesheet,
} from "../js/hours.js";

// ---------- tempo ----------

test("parseTime aceita formatos comuns e rejeita inválidos", () => {
  assert.equal(parseTime("08:05"), 485);
  assert.equal(parseTime("8:05"), 485);
  assert.equal(parseTime("08:05:59"), 485);
  assert.equal(parseTime("24:00"), 1440);
  assert.equal(parseTime("24:01"), null);
  assert.equal(parseTime("12:60"), null);
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("abc"), null);
});

test("parseDuration aceita sinal e mais de 24h", () => {
  assert.equal(parseDuration("00:30"), 30);
  assert.equal(parseDuration("-01:15"), -75);
  assert.equal(parseDuration("40:00"), 2400);
  assert.equal(parseDuration(null), null);
});

test("minutesToHHMM nunca gera :60", () => {
  assert.equal(minutesToHHMM(479.6), "08:00");
  assert.equal(minutesToHHMM(497), "08:17");
  assert.equal(minutesToHHMM(-75), "-01:15");
  assert.equal(minutesToHHMM(0), "00:00");
});

test("conversões decimal e segundos", () => {
  assert.equal(minutesToDecimal(497), "8.28");
  assert.equal(minutesToDecimal(497, 4), "8.2833");
  assert.equal(minutesToSeconds(17), 1020);
  assert.equal(minutesToSeconds(497), 29820);
});

// ---------- dia ----------

test("computeDay soma intervalos normais", () => {
  const r = computeDay({ intervals: [{ entry: "08:00", exit: "12:00" }, { entry: "13:00", exit: "17:17" }] });
  assert.equal(r.workedMinutes, 497);
  assert.equal(r.formulaMinutes, null);
  assert.deepEqual(r.warnings, []);
});

test("computeDay sinaliza batida sem par em vez de descartar em silêncio", () => {
  const r = computeDay({ intervals: [{ entry: "08:00", exit: "12:00" }, { entry: "13:00", exit: "" }] });
  assert.equal(r.workedMinutes, 240);
  assert.ok(r.warnings.some((w) => w.code === "unpaired"));
});

test("computeDay trata virada da meia-noite", () => {
  const r = computeDay({ intervals: [{ entry: "22:00", exit: "02:00" }] });
  assert.equal(r.workedMinutes, 240);
  assert.ok(r.warnings.some((w) => w.code === "overnight"));
});

test("computeDay não conta sobreposição duas vezes", () => {
  const r = computeDay({ intervals: [{ entry: "08:00", exit: "12:00" }, { entry: "11:00", exit: "13:00" }] });
  assert.equal(r.workedMinutes, 300);
  assert.ok(r.warnings.some((w) => w.code === "overlap"));
});

test("computeDay sem batidas", () => {
  const r = computeDay({ intervals: [{ entry: "", exit: "" }] });
  assert.equal(r.workedMinutes, 0);
  assert.ok(r.warnings.some((w) => w.code === "no_punches"));
});

test("divergência com a fórmula do ponto; marcações prevalecem por padrão", () => {
  const r = computeDay({
    intervals: [{ entry: "08:00", exit: "12:00" }, { entry: "13:00", exit: "17:12" }],
    overtime: "00:00", absence: "00:00", expectedMinutes: 480,
  });
  assert.equal(r.workedMinutes, 492);
  assert.equal(r.formulaMinutes, 480);
  assert.equal(r.divergenceMinutes, 12);
  assert.equal(chooseDayTotal(r), 492);
  assert.equal(chooseDayTotal(r, "ponto"), 480);
});

test("fórmula respeita jornada configurável e HE/AUS", () => {
  const r = computeDay({ intervals: [{ entry: "08:00", exit: "14:30" }], overtime: "00:30", absence: "00:00", expectedMinutes: 360 });
  assert.equal(r.formulaMinutes, 390);
  assert.equal(r.divergenceMinutes, 0);
});

// ---------- divisão ----------

test("splitMinutes fecha sempre no total (3 x 33,33%)", () => {
  const parts = splitMinutes(497, [33.33, 33.33, 33.34]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 497);
  for (const p of parts) assert.ok(p >= 165 && p <= 167);
});

test("splitMinutes com pesos iguais distribui o resto", () => {
  assert.deepEqual(splitMinutes(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(splitMinutes(480, [50, 50]), [240, 240]);
  assert.deepEqual(splitMinutes(0, [50, 50]), [0, 0]);
});

test("allocationRemaining", () => {
  assert.equal(allocationRemaining(480, [240, 200]), 40);
  assert.equal(allocationRemaining(480, [240, 240]), 0);
  assert.equal(allocationRemaining(480, [300, 240]), -60);
});

// ---------- datas ----------

test("datas em horário local, sem erro de um dia", () => {
  assert.equal(toISODateLocal(new Date(2025, 0, 31)), "2025-01-31");
  assert.equal(parseISODateLocal("2025-02-30"), null);
  assert.equal(parseISODateLocal("2025-03-01").getDate(), 1);
  assert.equal(isoToBr("2025-10-01"), "01/10/2025");
  assert.equal(brToIso("01/10/2025"), "2025-10-01");
});

test("eachDay atravessa virada de mês e ano", () => {
  const days = eachDay("2025-12-30", "2026-01-02");
  assert.deepEqual(days, ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  assert.deepEqual(yearsInRange("2025-12-30", "2026-01-02"), [2025, 2026]);
  assert.deepEqual(eachDay("2025-01-02", "2025-01-01"), []);
});

test("isWeekendIso", () => {
  assert.equal(isWeekendIso("2025-11-22"), true);  // sábado
  assert.equal(isWeekendIso("2025-11-24"), false); // segunda
});

// ---------- parser ----------

const FORMATO_ROTULOS = `
01/10/2025 Qua
Entrada
08:00
Saída
12:00
Entrada
13:00
Saída
17:17
Horas extras
00:17
Ausências
00:00
02/10/2025 Qui
Entrada
08:10
Saída
12:00
`;

test("parser: rótulos em linhas separadas (formato atual)", () => {
  const { days, warnings } = parseTimesheet(FORMATO_ROTULOS);
  assert.equal(days.length, 2);
  assert.deepEqual(days[0].intervals, [{ entry: "08:00", exit: "12:00" }, { entry: "13:00", exit: "17:17" }]);
  assert.equal(days[0].overtime, "00:17");
  assert.equal(days[0].absence, "00:00");
  assert.equal(days[1].overtime, null);
  assert.deepEqual(warnings, []);
});

test("parser: rótulo e horário na mesma linha, com acentos e caixa variados", () => {
  const { days } = parseTimesheet("03/10/2025\nENTRADA 08:00\nsaida: 12:00\nEntrada 13:00\nSAÍDA 17:00\nHoras Extras: 00:00\nAusencias 00:00");
  assert.deepEqual(days[0].intervals, [{ entry: "08:00", exit: "12:00" }, { entry: "13:00", exit: "17:00" }]);
  assert.equal(days[0].absence, "00:00");
});

test("parser: várias batidas numa linha e na linha da data", () => {
  const { days } = parseTimesheet("06/10/2025 Seg\t08:00\t12:00\t13:00\t17:00\n07/10/2025\n7:55 12:00 13:00 17:05");
  assert.deepEqual(days[0].intervals, [{ entry: "08:00", exit: "12:00" }, { entry: "13:00", exit: "17:00" }]);
  assert.deepEqual(days[1].intervals, [{ entry: "07:55", exit: "12:00" }, { entry: "13:00", exit: "17:05" }]);
});

test("parser: batida ímpar gera aviso", () => {
  const { days, warnings } = parseTimesheet("08/10/2025\n08:00 12:00 13:00");
  assert.equal(days[0].intervals.length, 2);
  assert.ok(warnings.some((w) => w.includes("sem par")));
});

test("parser: texto sem datas retorna vazio", () => {
  assert.deepEqual(parseTimesheet("qualquer coisa 08:00").days, []);
});
