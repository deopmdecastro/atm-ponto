/**
 * Browser-side parser for ATM "Folha de Imputação" Excel templates.
 *
 * Mirrors backend/src/timesheetExtract.js (the canonical implementation) but
 * runs entirely in the browser via SheetJS — no fs / fflate / Node APIs.
 *
 * Includes the floating-point fix: Excel values like 0.9999999999999991
 * (≈ 1.0 with imprecision) are snapped to integers BEFORE the < 1
 * "fraction-of-day" multiplier kicks in, so a 1-hour cell is read as 1h,
 * not 23.99h.
 */

import * as XLSX from "xlsx";

const EPS = 1e-6;

function truncate2(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n * 100) / 100;
}

function normalizeHeaderCell(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeSheetName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s_-]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function excelSerialToISO(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  if (serial < 20000 || serial > 90000) return null;
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseDateCell(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToISO(value);
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pt = s.match(/(\d{1,2})[/.\- ]+(\d{1,2})[/.\- ]+(\d{2,4})/);
  if (pt) {
    const day = pt[1].padStart(2, "0");
    const month = pt[2].padStart(2, "0");
    const year = pt[3].length === 2 ? `20${pt[3]}` : pt[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function parseHoursCell(value) {
  if (value == null || value === "") return 0;
  if (value instanceof Date) {
    const h = value.getUTCHours();
    const m = value.getUTCMinutes();
    const s = value.getUTCSeconds();
    return truncate2(h + m / 60 + s / 3600);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.round(value);
    const normalized = Math.abs(value - rounded) <= EPS ? rounded : value;
    if (normalized > 0 && normalized < 1) return truncate2(normalized * 24);
    return truncate2(normalized);
  }
  const s = String(value).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return truncate2(h + m / 60);
  }
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? truncate2(n) : 0;
}

export function formatTimeCell(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const s = String(value).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;
  return s;
}

function findColIndex(headerRow, keywords) {
  const normalized = (headerRow || []).map(normalizeHeaderCell);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < normalized.length; i++) {
    let score = 0;
    for (const k of keywords) if (normalized[i].includes(k)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore > 0 ? best : -1;
}

function detectDateColumn(matrix) {
  let bestCol = 0;
  let bestCount = -1;
  const sampleStart = Math.min(30, Math.max(0, matrix.length - 1));
  const sampleEnd = Math.min(matrix.length, sampleStart + 120);
  const colCount = Math.max(0, ...matrix.map((r) => (r ? r.length : 0)));
  for (let c = 0; c < colCount; c++) {
    let count = 0;
    for (let r = sampleStart; r < sampleEnd; r++) {
      if (parseDateCell(matrix[r]?.[c])) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestCol = c;
    }
  }
  return bestCol;
}

function detectStartRow(matrix, dateCol) {
  const threshold = 5;
  let consecutive = 0;
  for (let r = 0; r < matrix.length; r++) {
    if (parseDateCell(matrix[r]?.[dateCol])) consecutive++;
    else consecutive = 0;
    if (consecutive >= threshold) return Math.max(0, r - (threshold - 1));
  }
  return Math.min(37, Math.max(0, matrix.length - 1));
}

function pickBestHeaderRow(matrix, startRow) {
  const patterns = ["data", "entrada", "saida", "pausa", "normal", "extra", "viagem", "ausencia", "feriado", "cliente", "projeto", "descricao"];
  let bestIdx = Math.max(0, startRow - 1);
  let bestScore = -1;
  for (let r = Math.max(0, startRow - 15); r < startRow; r++) {
    const cells = (matrix[r] || []).map(normalizeHeaderCell).join(" ");
    let score = 0;
    for (const p of patterns) if (cells.includes(p)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return bestIdx;
}

function extractDailyRecords(matrix) {
  const dateCol = detectDateColumn(matrix);
  const startRow = detectStartRow(matrix, dateCol);
  const headerRowIdx = pickBestHeaderRow(matrix, startRow);
  const headerRow = matrix[headerRowIdx] || [];
  const headerRow2 = matrix[headerRowIdx + 1] || [];

  const cols = {
    date: dateCol,
    period_start: findColIndex(headerRow, ["entrada", "inicio", "inici", "start"]),
    period_end: findColIndex(headerRow, ["saida", "fim", "end"]),
    pause_hours: findColIndex(headerRow, ["pausa", "almoco", "intervalo", "pause"]),
    normal_hours: findColIndex(headerRow, ["normal", "normais", "hn"]),
    extra_hours: findColIndex(headerRow, ["extra", "extraord", "he"]),
    travel_hours: findColIndex(headerRow, ["viagem", "desloc", "travel"]),
    absence_hours: findColIndex(headerRow, ["ausencia", "falta", "absence"]),
    day_type: findColIndex(headerRow, ["tipo", "dia", "day"]),
    absence_type: findColIndex(headerRow, ["motivo", "justif", "ausencia"]),
    project_number: findColIndex(headerRow, ["projeto", "project"]),
    project_client: findColIndex(headerRow, ["cliente", "client"]),
    project_description: findColIndex(headerRow, ["descricao", "description"]),
    extra1_start: -1,
    extra1_end: -1,
    extra2_start: -1,
    extra2_end: -1,
    extra_motivo: -1
  };

  const h1 = (i) => normalizeHeaderCell(headerRow?.[i]);
  const h2 = (i) => normalizeHeaderCell(headerRow2?.[i]);

  if (cols.normal_hours < 0 && h1(dateCol + 1).includes("total")) cols.normal_hours = dateCol + 1;
  if (cols.extra_hours < 0 && h1(dateCol + 5).includes("total") && h1(dateCol + 6).includes("suplement")) {
    cols.extra_hours = dateCol + 5;
  }
  if (cols.period_start < 0 && h2(dateCol + 2) === "de") cols.period_start = dateCol + 2;
  if (cols.period_end < 0 && h2(dateCol + 3) === "a") cols.period_end = dateCol + 3;
  if (cols.pause_hours < 0 && h2(dateCol + 4).includes("pausa")) cols.pause_hours = dateCol + 4;
  if (cols.extra1_start < 0 && h2(dateCol + 6).includes("1") && h2(dateCol + 6).includes("de")) cols.extra1_start = dateCol + 6;
  if (cols.extra1_end < 0 && h2(dateCol + 7).includes("1") && h2(dateCol + 7).includes("a")) cols.extra1_end = dateCol + 7;
  if (cols.extra2_start < 0 && h2(dateCol + 8).includes("2") && h2(dateCol + 8).includes("de")) cols.extra2_start = dateCol + 8;
  if (cols.extra2_end < 0 && h2(dateCol + 9).includes("2") && h2(dateCol + 9).includes("a")) cols.extra2_end = dateCol + 9;
  if (cols.extra_motivo < 0 && h1(dateCol + 10).includes("motivo")) cols.extra_motivo = dateCol + 10;

  if (cols.travel_hours >= 0 && h1(cols.travel_hours).includes("viagem")) {
    for (let i = cols.travel_hours; i < Math.min(cols.travel_hours + 12, headerRow.length); i++) {
      if (h1(i) === "total") {
        cols.travel_hours = i;
        break;
      }
    }
  }

  if (cols.day_type < 0 || h1(cols.day_type) === "dia") {
    const patterns = ["dia util", "dia útil", "desc", "feriado"];
    const colCount = Math.max(0, ...matrix.map((r) => (r ? r.length : 0)));
    let bestCol = -1;
    let bestScore = 0;
    for (let c = 0; c < colCount; c++) {
      let score = 0;
      for (let r = startRow; r < Math.min(matrix.length, startRow + 120); r++) {
        const v = matrix[r]?.[c];
        if (!v) continue;
        const s = String(v).toLowerCase();
        if (patterns.some((p) => s.includes(p))) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCol = c;
      }
    }
    if (bestScore >= 3) cols.day_type = bestCol;
  }

  const records = [];
  let emptyStreak = 0;
  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const dateISO = parseDateCell(row[cols.date]);
    if (!dateISO) {
      const anyContent = row.some((v) => v != null && String(v).trim() !== "");
      if (!anyContent) emptyStreak++;
      else emptyStreak = 0;
      if (emptyStreak >= 10) break;
      continue;
    }
    emptyStreak = 0;

    const text = (v) => {
      if (v == null || v === "") return "";
      if (typeof v === "number" && v === 0) return "";
      return String(v).trim();
    };

    records.push({
      date: dateISO,
      normal_hours: cols.normal_hours >= 0 ? parseHoursCell(row[cols.normal_hours]) : 0,
      extra_hours: cols.extra_hours >= 0 ? parseHoursCell(row[cols.extra_hours]) : 0,
      travel_hours: cols.travel_hours >= 0 ? parseHoursCell(row[cols.travel_hours]) : 0,
      absence_hours: cols.absence_hours >= 0 ? parseHoursCell(row[cols.absence_hours]) : 0,
      day_type: cols.day_type >= 0 ? text(row[cols.day_type]) : "",
      absence_type: cols.absence_type >= 0 ? text(row[cols.absence_type]) : "",
      period_start: cols.period_start >= 0 ? formatTimeCell(row[cols.period_start]) : "",
      period_end: cols.period_end >= 0 ? formatTimeCell(row[cols.period_end]) : "",
      pause_hours: cols.pause_hours >= 0 ? parseHoursCell(row[cols.pause_hours]) : 0,
      extra1_start: cols.extra1_start >= 0 ? formatTimeCell(row[cols.extra1_start]) : "",
      extra1_end: cols.extra1_end >= 0 ? formatTimeCell(row[cols.extra1_end]) : "",
      extra2_start: cols.extra2_start >= 0 ? formatTimeCell(row[cols.extra2_start]) : "",
      extra2_end: cols.extra2_end >= 0 ? formatTimeCell(row[cols.extra2_end]) : "",
      extra_motivo: cols.extra_motivo >= 0 ? text(row[cols.extra_motivo]) : "",
      project_number: cols.project_number >= 0 ? text(row[cols.project_number]) : "",
      project_client: cols.project_client >= 0 ? text(row[cols.project_client]) : "",
      project_description: cols.project_description >= 0 ? text(row[cols.project_description]) : ""
    });
  }

  return records;
}

function extractMeta(matrix) {
  const meta = {
    employee_name: "",
    employee_number: "",
    month: "",
    year: null,
    department: "",
    cct: "",
    horario: "",
    direcao: "",
    funcao: "",
    centro_custo: "",
    email_remetente: "",
    email_nivel1: "",
    email_nivel2: ""
  };

  function nextNonEmpty(row, idx) {
    for (let i = idx + 1; i < Math.min(row.length, idx + 12); i++) {
      const v = row[i];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  for (let r = 0; r < Math.min(matrix.length, 30); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      const key = normalizeHeaderCell(row[c]);
      if (key === "nº:" || key === "no:" || key === "n:" || key === "nº") {
        const v = nextNonEmpty(row, c);
        if (v) meta.employee_number = v;
      }
      if (key === "nome:" || key === "nome") {
        const v = nextNonEmpty(row, c);
        if (v) meta.employee_name = v;
      }
      if (key === "funcao:" || key === "funcao" || key === "função:") {
        const v = nextNonEmpty(row, c);
        if (v) meta.funcao = v;
      }
      if (key === "cct") {
        const v = nextNonEmpty(row, c);
        if (v) meta.cct = v;
      }
      if (key === "horario" || key === "horário") {
        const v = nextNonEmpty(row, c);
        if (v) meta.horario = v;
      }
      if (key.includes("direcao atm") || key.includes("direção atm")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.direcao = v;
      }
      if (key.includes("departamento")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.department = v;
      }
      if (key.includes("centro de custo")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.centro_custo = v;
      }
      if (key.includes("remetente")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.email_remetente = v;
      }
      if (key.includes("nivel 1") || key.includes("nível 1")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.email_nivel1 = v;
      }
      if (key.includes("nivel 2") || key.includes("nível 2")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.email_nivel2 = v;
      }
    }
  }

  const monthNames = ["jan", "janeiro", "fev", "fevereiro", "mar", "março", "marco", "abr", "abril", "mai", "maio", "jun", "junho", "jul", "julho", "ago", "agosto", "set", "setembro", "out", "outubro", "nov", "novembro", "dez", "dezembro"];
  let best = null;
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] ?? "").trim();
      const year = Number(v);
      if (Number.isInteger(year) && year >= 2020 && year <= 2100) {
        const prev = String(row[c - 1] ?? "").trim();
        const prevNorm = normalizeHeaderCell(prev);
        if (prev && prev.length <= 10 && /[A-Za-zÀ-ÿ]/.test(prev) && prevNorm !== "ano" && prevNorm !== "mes" && monthNames.includes(prevNorm)) {
          best = { month: prev, year };
        }
      }
    }
  }
  if (best) {
    meta.month = best.month;
    meta.year = best.year;
  }
  return meta;
}

function extractProjects(wb) {
  const projects = [];
  for (const sheetName of wb.SheetNames || []) {
    const normalized = normalizeSheetName(sheetName);
    if (!normalized.includes("projet")) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const headerIndex = rows.findIndex((row) =>
      (row || []).some((cell) => normalizeHeaderCell(cell).includes("projeto"))
    );
    if (headerIndex < 0) continue;
    const header = rows[headerIndex] || [];
    const codeCol = findColIndex(header, ["projeto", "project", "numero"]);
    const descCol = findColIndex(header, ["descricao", "description"]);
    const clientCol = findColIndex(header, ["cliente", "client"]);
    if (codeCol < 0) continue;
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const code = String(row[codeCol] ?? "").trim();
      const description = descCol >= 0 ? String(row[descCol] ?? "").trim() : "";
      const client = clientCol >= 0 ? String(row[clientCol] ?? "").trim() : "";
      if (!code && !description) continue;
      projects.push({ code, description, client });
    }
  }
  const seen = new Map();
  for (const p of projects) {
    const key = (p.code || p.description || p.client).toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

/**
 * Read an ATM TimeSheet .xlsx File/Blob in the browser and return:
 *   { meta, records, projects, sheetName }
 */
export async function readTimesheetFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const preferred = "TimeSheet";
  const sheetName =
    wb.Sheets[preferred] != null
      ? preferred
      : wb.SheetNames.find((n) => normalizeSheetName(n).includes("timesheet")) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Nenhuma aba TimeSheet encontrada no ficheiro Excel.");
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const records = extractDailyRecords(matrix);
  const meta = extractMeta(matrix);
  const projects = extractProjects(wb);
  return { meta, records, projects, sheetName };
}

/* ------------------------------------------------------------------ */
/* Calendar helpers                                                   */
/* ------------------------------------------------------------------ */

export const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export function monthIndex(name) {
  const n = String(name || "").trim().toLowerCase();
  const map = {
    jan: 1, janeiro: 1,
    fev: 2, fevereiro: 2,
    mar: 3, março: 3, marco: 3,
    abr: 4, abril: 4,
    mai: 5, maio: 5,
    jun: 6, junho: 6,
    jul: 7, julho: 7,
    ago: 8, agosto: 8,
    set: 9, setembro: 9,
    out: 10, outubro: 10,
    nov: 11, novembro: 11,
    dez: 12, dezembro: 12
  };
  return map[n] || map[n.slice(0, 3)] || 0;
}

const WEEKDAY_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function daysInMonth(year, monthOneBased) {
  return new Date(year, monthOneBased, 0).getDate();
}

export function buildMonthGrid(monthName, year) {
  const mi = monthIndex(monthName);
  if (!mi || !year) return [];
  const total = daysInMonth(year, mi);
  const out = [];
  for (let day = 1; day <= total; day++) {
    const iso = `${year}-${String(mi).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dt = new Date(Date.UTC(year, mi - 1, day));
    const dow = dt.getUTCDay();
    let defaultDayType = "Dia Útil";
    if (dow === 6) defaultDayType = "Desc.Comp";
    else if (dow === 0) defaultDayType = "Desc. Obrig";
    out.push({
      date: iso,
      day,
      weekday: WEEKDAY_PT[dow],
      isWeekend: dow === 0 || dow === 6,
      normal_hours: 0,
      extra_hours: 0,
      travel_hours: 0,
      absence_hours: 0,
      day_type: defaultDayType,
      absence_type: "",
      period_start: "",
      period_end: "",
      pause_hours: 0,
      extra1_start: "",
      extra1_end: "",
      extra2_start: "",
      extra2_end: "",
      extra_motivo: "",
      project_number: "",
      project_client: "",
      project_description: ""
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Per-row computations                                               */
/* ------------------------------------------------------------------ */

function parseHHMM(text) {
  const m = String(text || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h + min / 60;
}

export function recomputeRow(row) {
  const start = parseHHMM(row.period_start);
  const end = parseHHMM(row.period_end);
  const pause = parseHHMM(row.pause_hours) ?? Number(row.pause_hours || 0);
  let normal = 0;
  if (start != null && end != null && end > start) {
    normal = end - start - (Number.isFinite(pause) ? pause : 0);
    if (normal < 0) normal = 0;
  }

  let extra = 0;
  const e1s = parseHHMM(row.extra1_start);
  const e1e = parseHHMM(row.extra1_end);
  const e2s = parseHHMM(row.extra2_start);
  const e2e = parseHHMM(row.extra2_end);
  if (e1s != null && e1e != null && e1e > e1s) extra += e1e - e1s;
  if (e2s != null && e2e != null && e2e > e2s) extra += e2e - e2s;

  return {
    ...row,
    normal_hours: truncate2(normal),
    extra_hours: truncate2(extra),
    pause_hours: Number.isFinite(pause) ? truncate2(pause) : 0,
    extra_motivo: extra > 0 && !String(row.extra_motivo || "").trim() ? "Motivo Simples" : row.extra_motivo
  };
}

export function validateRow(row) {
  const errors = [];
  const warnings = [];
  const dayType = String(row.day_type || "").trim();
  const start = parseHHMM(row.period_start);
  const end = parseHHMM(row.period_end);

  if (row.period_start && start == null) errors.push("Hora de entrada inválida (HH:MM)");
  if (row.period_end && end == null) errors.push("Hora de saída inválida (HH:MM)");
  if (start != null && end != null && end <= start) errors.push("Saída tem de ser depois da entrada");

  const e1s = parseHHMM(row.extra1_start);
  const e1e = parseHHMM(row.extra1_end);
  const e2s = parseHHMM(row.extra2_start);
  const e2e = parseHHMM(row.extra2_end);
  if ((row.extra1_start || row.extra1_end) && (e1s == null || e1e == null || e1e <= e1s)) errors.push("1º período extraordinário inválido");
  if ((row.extra2_start || row.extra2_end) && (e2s == null || e2e == null || e2e <= e2s)) errors.push("2º período extraordinário inválido");

  if (start != null && end != null) {
    if (e1s != null && e1e != null && e1s < end && e1e > start) errors.push("1º HE sobrepõe horário normal");
    if (e2s != null && e2e != null && e2s < end && e2e > start) errors.push("2º HE sobrepõe horário normal");
  }
  if (e1s != null && e1e != null && e2s != null && e2e != null && e1s < e2e && e2s < e1e) errors.push("1º e 2º HE sobrepõem-se");

  if ((dayType === "Desc. Obrig" || dayType === "Feriado") && Number(row.normal_hours || 0) > 0) {
    warnings.push("Trabalho registado em dia de descanso/feriado");
  }

  if (Number(row.extra_hours || 0) > 0 && !dayType) {
    errors.push("Trabalho Suplementar sem indicação do Tipo de Dia");
  }

  if (Number(row.normal_hours || 0) > 12) warnings.push("Mais de 12h normais — verificar");

  if (Number(row.normal_hours || 0) > 0 && !String(row.project_number || "").trim()) {
    warnings.push("Sem nº de projeto");
  }

  return { errors, warnings };
}

/* ------------------------------------------------------------------ */
/* Export to Excel                                                    */
/* ------------------------------------------------------------------ */

export function exportTimesheetToExcel({ meta, rows, projects = [] }) {
  const header = [
    "Dia", "Data", "Total Normais", "Entrada", "Saída", "Pausa",
    "Total Extras", "1º HE Início", "1º HE Fim", "2º HE Início", "2º HE Fim", "Motivo TS",
    "Tipo de Dia", "Tipo Ausência",
    "Nº Projeto", "Cliente", "Descrição Projeto"
  ];
  const body = rows.map((r) => [
    r.day, r.date, r.normal_hours, r.period_start, r.period_end, r.pause_hours,
    r.extra_hours, r.extra1_start, r.extra1_end, r.extra2_start, r.extra2_end, r.extra_motivo,
    r.day_type, r.absence_type,
    r.project_number, r.project_client, r.project_description
  ]);
  const totalNormal = rows.reduce((a, r) => a + Number(r.normal_hours || 0), 0);
  const totalExtra = rows.reduce((a, r) => a + Number(r.extra_hours || 0), 0);
  const footer = ["TOTAL", "", totalNormal, "", "", "", totalExtra, "", "", "", "", "", "", "", "", "", ""];

  const sheetMeta = [
    ["FOLHA DE IMPUTAÇÃO — Versão Web ATM Ponto"],
    [],
    ["Colaborador", meta.employee_name || ""],
    ["Nº", meta.employee_number || ""],
    ["Função", meta.funcao || ""],
    ["Departamento", meta.department || ""],
    ["Direção", meta.direcao || ""],
    ["Centro de Custo", meta.centro_custo || ""],
    ["CCT", meta.cct || ""],
    ["Horário", meta.horario || ""],
    ["Mês", meta.month || ""],
    ["Ano", meta.year || ""],
    []
  ];

  const ws = XLSX.utils.aoa_to_sheet([...sheetMeta, header, ...body, footer]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 18 },
    { wch: 14 }, { wch: 18 },
    { wch: 16 }, { wch: 30 }, { wch: 40 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TimeSheet");

  if (projects.length > 0) {
    const pHeader = ["PROJETO", "Descrição", "Cliente"];
    const pBody = projects.map((p) => [p.code || "", p.description || "", p.client || ""]);
    const pws = XLSX.utils.aoa_to_sheet([pHeader, ...pBody]);
    pws["!cols"] = [{ wch: 18 }, { wch: 60 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, pws, "Nº Projetos");
  }

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
