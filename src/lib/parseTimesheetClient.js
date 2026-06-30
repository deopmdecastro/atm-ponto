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

/**
 * Parses Excel's formatted display text for a date cell, e.g. "Mon 01/ 06/ 2026"
 * or "Monday, June 01, 2026", extracting day/month/year. Falls back to using
 * meta's year when the text only contains day/month.
 */
function parseFormattedDateText(text, meta) {
  if (!text) return null;
  const s = String(text).trim();
  // Pattern: dd/ mm/ yyyy or dd/mm/yyyy (with optional spaces)
  const m1 = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
  if (m1) {
    const day = m1[1].padStart(2, "0");
    const month = m1[2].padStart(2, "0");
    const year = m1[3];
    return `${year}-${month}-${day}`;
  }
  // Pattern: yyyy-mm-dd
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
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

/** Interprets cells like "1", "X", "x", true, 1 as checked; everything else as unchecked. */
export function isTruthyCell(value) {
  if (value == null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const s = String(value).trim().toLowerCase();
  return s === "1" || s === "x" || s === "true" || s === "sim" || s === "yes";
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

function extractDailyRecords(matrix, ws, meta) {
  const dateCol = detectDateColumn(matrix);
  const startRow = detectStartRow(matrix, dateCol);
  const headerRowIdx = pickBestHeaderRow(matrix, startRow);
  const headerRow = matrix[headerRowIdx] || [];
  const headerRow2 = matrix[headerRowIdx + 1] || [];

  // Resolve a reliable "expected first day" using the month/year metadata
  // (those come from hardcoded header cells, not formulas, so they're
  // trustworthy even when per-row date formulas have a stale cached value
  // — which happens often in the ATM template after it's been duplicated
  // for a new month without a full recalculation).
  const expectedFirstDate = (() => {
    if (!meta?.year || !meta?.month) return null;
    const mIdx = monthIndex(meta.month);
    if (!mIdx) return null;
    return new Date(Date.UTC(meta.year, mIdx - 1, 1)); // mIdx is 1-based, Date.UTC needs 0-based
  })();

  /**
   * Resolve the ISO date for a data row, preferring:
   *   1) the worksheet's formatted display text (.w) when the cell is a
   *      formula — Excel/LibreOffice always renders .w correctly from the
   *      live formula inputs, even when the cached .v is stale;
   *   2) the literal cached value otherwise;
   *   3) a reconstructed date from meta.year/meta.month + row offset, as a
   *      last-resort fallback when both of the above fail or disagree
   *      wildly with the expected month.
   */
  function resolveRowDate(rowIdx, rawValue, dayOffset) {
    let iso = null;
    const addr = ws ? XLSX.utils.encode_cell({ r: rowIdx, c: dateCol }) : null;
    const cell = addr && ws ? ws[addr] : null;
    if (cell && cell.f && cell.w) {
      // Formula cell — trust the formatted text over the (possibly stale) value
      iso = parseFormattedDateText(cell.w, meta);
    }
    if (!iso) iso = parseDateCell(rawValue);

    // Sanity-check against the expected month: if we know the month/year
    // and the resolved date falls outside a generous +/-2 day window of
    // where this row should land, reconstruct it directly instead.
    if (expectedFirstDate) {
      const expected = new Date(expectedFirstDate);
      expected.setUTCDate(expected.getUTCDate() + dayOffset);
      const expectedISO = expected.toISOString().slice(0, 10);
      if (!iso) {
        iso = expectedISO;
      } else {
        const diffDays = Math.abs((new Date(iso + "T00:00:00Z") - new Date(expectedISO + "T00:00:00Z")) / 86400000);
        if (diffDays > 2) iso = expectedISO;
      }
    }
    return iso;
  }

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
    absence_type: findColIndex(headerRow, ["tipo de ausencia", "ausencia presenca", "tipo ausencia"]),
    project_number: findColIndex(headerRow, ["projeto", "project"]),
    project_client: findColIndex(headerRow, ["cliente", "client"]),
    project_description: findColIndex(headerRow, ["descricao", "description"]),
    subsidio_almoco: findColIndex(headerRow, ["s.alim", "salim", "subsidio alim", "subalim"]),
    prevencao: findColIndex(headerRow, ["prevencao", "sub. prevenc", "subprevenc"]),
    deslocado: findColIndex(headerRow, ["sub. desloc", "subdesloc", "deslocacao"]),
    local_deslocacao: findColIndex(headerRow, ["local"]),
    motivo_deslocacao: findColIndex(headerRow, ["motivo deslocacao", "motivo desloc"]),
    observacoes: findColIndex(headerRow, ["observacoes", "observacao", "obs"]),
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
  // absence_type is in sub-header row (row2): "Tipo de Ausência/Presença"
  if (cols.absence_type < 0) {
    for (let i = 0; i < headerRow2.length; i++) {
      const h = normalizeHeaderCell(headerRow2[i]);
      if (h.includes("tipo") && (h.includes("ausencia") || h.includes("presenca") || h.includes("ausência"))) {
        cols.absence_type = i;
        break;
      }
    }
  }
  // Fallback: col 18 relative to date col (fixed ATM layout)
  if (cols.absence_type < 0 && h2(dateCol + 17).includes("ausencia")) cols.absence_type = dateCol + 17;

  if (cols.travel_hours >= 0 && h1(cols.travel_hours).includes("viagem")) {
    for (let i = cols.travel_hours; i < Math.min(cols.travel_hours + 12, headerRow.length); i++) {
      if (h1(i) === "total") {
        cols.travel_hours = i;
        break;
      }
    }
  }

  // Detect travel time columns (ida inicio/fim, volta inicio/fim)
  const travelCols = { travel1_start: -1, travel1_end: -1, travel2_start: -1, travel2_end: -1 };
  for (let c = 0; c < headerRow.length; c++) {
    const h1v = h1(c);
    const h2v = h2(c);
    if (h2v.includes("ida") && (h2v.includes("inicio") || h2v.includes("início"))) travelCols.travel1_start = c;
    if (h2v.includes("ida") && h2v.includes("fim")) travelCols.travel1_end = c;
    if (h2v.includes("volta") && (h2v.includes("inicio") || h2v.includes("início"))) travelCols.travel2_start = c;
    if (h2v.includes("volta") && h2v.includes("fim")) travelCols.travel2_end = c;
  }
  // Fallback: look for "Ida (Inicio)" etc patterns
  if (travelCols.travel1_start < 0) {
    for (let c = 0; c < headerRow.length; c++) {
      const h1v = h1(c);
      if (h1v.includes("ida") && h1v.includes("inicio")) travelCols.travel1_start = c;
      if (h1v.includes("ida") && h1v.includes("fim")) travelCols.travel1_end = c;
      if (h1v.includes("volta") && h1v.includes("inicio")) travelCols.travel2_start = c;
      if (h1v.includes("volta") && h1v.includes("fim")) travelCols.travel2_end = c;
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

  // Fixed-offset fallbacks for subsidies / deslocação / observações, relative
  // to the day_type column, matching the ATM template's fixed layout:
  // [day_type] [S.Alim] [Sub.Prevenção] [Sub.Deslocação] [Local] [Motivo Desloc] [Nº Projeto] [Cliente] [Descrição] [Observações]
  if (cols.day_type >= 0) {
    if (cols.subsidio_almoco < 0 && h1(cols.day_type + 1).includes("s.alim")) cols.subsidio_almoco = cols.day_type + 1;
    if (cols.prevencao < 0 && h1(cols.day_type + 2).includes("prevenc")) cols.prevencao = cols.day_type + 2;
    if (cols.deslocado < 0 && h1(cols.day_type + 3).includes("desloc")) cols.deslocado = cols.day_type + 3;
    if (cols.local_deslocacao < 0 && h1(cols.day_type + 4) === "local") cols.local_deslocacao = cols.day_type + 4;
    if (cols.motivo_deslocacao < 0 && h1(cols.day_type + 5).includes("motivo")) cols.motivo_deslocacao = cols.day_type + 5;
    if (cols.project_number < 0 && h1(cols.day_type + 6).includes("projeto")) cols.project_number = cols.day_type + 6;
    if (cols.project_client < 0 && h1(cols.day_type + 7).includes("cliente")) cols.project_client = cols.day_type + 7;
    if (cols.project_description < 0 && h1(cols.day_type + 8).includes("descri")) cols.project_description = cols.day_type + 8;
    if (cols.observacoes < 0 && h1(cols.day_type + 9).includes("observa")) cols.observacoes = cols.day_type + 9;
  }
  // Last-resort fallback if header text didn't match but the project columns were found
  if (cols.subsidio_almoco < 0 && cols.project_number >= 0) cols.subsidio_almoco = cols.project_number - 6;
  if (cols.prevencao < 0 && cols.project_number >= 0) cols.prevencao = cols.project_number - 5;
  if (cols.deslocado < 0 && cols.project_number >= 0) cols.deslocado = cols.project_number - 4;
  if (cols.local_deslocacao < 0 && cols.project_number >= 0) cols.local_deslocacao = cols.project_number - 3;
  if (cols.motivo_deslocacao < 0 && cols.project_number >= 0) cols.motivo_deslocacao = cols.project_number - 2;
  if (cols.observacoes < 0 && cols.project_description >= 0) cols.observacoes = cols.project_description + 1;

  const records = [];
  let emptyStreak = 0;
  let dayOffset = 0;
  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const rawDateVal = row[cols.date];
    const hasAnyContent = row.some((v) => v != null && String(v).trim() !== "");
    const quickCheck = parseDateCell(rawDateVal);
    if (!quickCheck && !hasAnyContent) {
      emptyStreak++;
      if (emptyStreak >= 10) break;
      continue;
    }
    if (!quickCheck) { emptyStreak = 0; continue; }
    emptyStreak = 0;

    const dateISO = resolveRowDate(r, rawDateVal, dayOffset);
    dayOffset++;
    if (!dateISO) continue;

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
      travel1_start: travelCols.travel1_start >= 0 ? formatTimeCell(row[travelCols.travel1_start]) : "",
      travel1_end: travelCols.travel1_end >= 0 ? formatTimeCell(row[travelCols.travel1_end]) : "",
      travel2_start: travelCols.travel2_start >= 0 ? formatTimeCell(row[travelCols.travel2_start]) : "",
      travel2_end: travelCols.travel2_end >= 0 ? formatTimeCell(row[travelCols.travel2_end]) : "",
      project_number: cols.project_number >= 0 ? text(row[cols.project_number]) : "",
      project_client: cols.project_client >= 0 ? text(row[cols.project_client]) : "",
      project_description: cols.project_description >= 0 ? text(row[cols.project_description]) : "",
      subsidio_almoco: cols.subsidio_almoco >= 0 ? isTruthyCell(row[cols.subsidio_almoco]) : false,
      prevencao: cols.prevencao >= 0 ? isTruthyCell(row[cols.prevencao]) : false,
      deslocado: cols.deslocado >= 0 ? isTruthyCell(row[cols.deslocado]) : false,
      local_deslocacao: cols.local_deslocacao >= 0 ? text(row[cols.local_deslocacao]) : "",
      motivo_deslocacao: cols.motivo_deslocacao >= 0 ? text(row[cols.motivo_deslocacao]) : "",
      observacoes: cols.observacoes >= 0 ? text(row[cols.observacoes]) : ""
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
  const meta = extractMeta(matrix);
  const records = extractDailyRecords(matrix, ws, meta);
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
      travel1_start: "",
      travel1_end: "",
      travel2_start: "",
      travel2_end: "",
      project_number: "",
      project_client: "",
      project_description: "",
      subsidio_almoco: false,
      prevencao: false,
      deslocado: false,
      local_deslocacao: "",
      motivo_deslocacao: "",
      observacoes: "",
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

  let travel = 0;
  const t1s = parseHHMM(row.travel1_start);
  const t1e = parseHHMM(row.travel1_end);
  const t2s = parseHHMM(row.travel2_start);
  const t2e = parseHHMM(row.travel2_end);
  if (t1s != null && t1e != null && t1e > t1s) travel += t1e - t1s;
  if (t2s != null && t2e != null && t2e > t2s) travel += t2e - t2s;

  // If recalculation produced zero but the row already has a parsed value
  // (e.g. from an Excel file that stores totals but not entry/exit times),
  // keep the existing value so imported data is not wiped out.
  const parsedNormal = Number(row.normal_hours || 0);
  const parsedExtra = Number(row.extra_hours || 0);
  const parsedTravel = Number(row.travel_hours || 0);

  const finalNormal = normal > 0 ? truncate2(normal) : truncate2(parsedNormal);
  const finalExtra = extra > 0 ? truncate2(extra) : truncate2(parsedExtra);
  const finalTravel = travel > 0 ? truncate2(travel) : truncate2(parsedTravel);

  return {
    ...row,
    normal_hours: finalNormal,
    extra_hours: finalExtra,
    travel_hours: finalTravel,
    pause_hours: Number.isFinite(pause) ? truncate2(pause) : 0,
    extra_motivo: finalExtra > 0 && !String(row.extra_motivo || "").trim() ? "Motivo Simples" : row.extra_motivo
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
  // ── Colours (ATM brand) ──────────────────────────────────────────────
  const RED       = "FFC0392B"; // ATM vermelho
  const RED_LIGHT = "FFFDECEA"; // fundo vermelho suave
  const GRAY_HDR  = "FF2C3E50"; // cabeçalho cinza escuro
  const GRAY_MID  = "FF5D6D7E"; // cabeçalho grupo intermédio
  const GRAY_SUB  = "FF85929E"; // subgrupo
  const GRAY_COL  = "FFAEB6BF"; // cabeçalho coluna
  const GRAY_LIGHT= "FFF2F3F4"; // linha par
  const WKND_BG   = "FFFFF9E7"; // fim-de-semana
  const BLUE_TOTAL= "FF1A5276"; // linha total
  const WHITE     = "FFFFFFFF";
  const BORDER_C  = "FFBDC3C7";

  const font  = (sz = 9, bold = false, color = "FF000000", name = "Arial") =>
    ({ name, sz, bold, color: { rgb: color } });
  const fill  = (rgb) => ({ type: "pattern", pattern: "solid", fgColor: { rgb } });
  const align = (h = "center", v = "center", wrap = false) =>
    ({ horizontal: h, vertical: v, wrapText: wrap });
  const thin  = { style: "thin", color: { rgb: BORDER_C } };
  const med   = { style: "medium", color: { rgb: "FF7F8C8D" } };
  const allBorders  = (s = thin) => ({ top: s, bottom: s, left: s, right: s });
  const fmtTime = (v) => {  // "08:00" → Excel fraction
    if (!v || typeof v !== "string") return null;
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (Number(m[1]) + Number(m[2]) / 60) / 24;
  };
  const fmtHours = (h) => {
    const n = Number(h || 0);
    if (!n) return 0;
    const hh = Math.floor(n), mm = Math.round((n - hh) * 60);
    return (hh + mm / 60) / 24;  // store as Excel time fraction
  };

  // ── Workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  const ws = {};

  // Helper: set cell
  function setCell(row, col, value, styleObj) {
    const ref = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = { v: value ?? "", s: styleObj };
    if (typeof value === "number") cell.t = "n";
    else if (value instanceof Date) cell.t = "d";
    else cell.t = "s";
    if (styleObj?.numFmt) cell.z = styleObj.numFmt;
    ws[ref] = cell;
  }

  function mergeRange(r1, c1, r2, c2) {
    if (!ws["!merges"]) ws["!merges"] = [];
    ws["!merges"].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  }

  // ── Column layout (matches ATM original exactly) ─────────────────────
  // Col index (0-based):
  // 0=A(vazio) 1=B(Data) 2=C(TotNorm) 3=D(Entrada) 4=E(Saída) 5=F(Pausa)
  // 6=G(TotExtra) 7=H(HE1de) 8=I(HE1a) 9=J(HE2de) 10=K(HE2a) 11=L(MotivoTS)
  // 12=M(TotViagem) 13=N(IdaIn) 14=O(IdaFim) 15=P(VoltaIn) 16=Q(VoltaFim)
  // 17=R(TotAusencia) 18=S(TipoAusencia) 19=T(AusDe) 20=U(AusA)
  // 21=V(TipoDia) 22=W(SAlim) 23=X(Prev) 24=Y(Desl) 25=Z(Local) 26=AA(MotivDesl)
  // 27=AB(NºProj) 28=AC(Cliente) 29=AD(Descricao) 30=AE(Obs)

  const COL_WIDTHS = [
    2,    // A vazio
    20,   // B Data
    9,    // C Total Normais
    9,    // D Entrada
    9,    // E Saída
    9,    // F Pausa
    9,    // G Total Extras
    12,   // H HE1 início
    12,   // I HE1 fim
    12,   // J HE2 início
    12,   // K HE2 fim
    18,   // L Motivo TS
    9,    // M Total Viagem
    12,   // N Ida Início
    12,   // O Ida Fim
    12,   // P Volta Início
    12,   // Q Volta Fim
    9,    // R Total Ausência
    30,   // S Tipo Ausência/Presença
    9,    // T Aus. de
    9,    // U Aus. a
    16,   // V Tipo de Dia
    10,   // W S.Alim.
    10,   // X Prevenção
    10,   // Y Deslocado
    22,   // Z Local Deslocação
    22,   // AA Motivo Deslocação
    16,   // AB Nº Projeto
    30,   // AC Cliente
    42,   // AD Descrição Projeto
    40,   // AE Observações
  ];
  ws["!cols"] = COL_WIDTHS.map((w) => ({ wch: w }));

  // ── Header section (rows 0-12) ────────────────────────────────────────
  // Row 0-1: top brand bar
  const brandStyle = { font: font(14, true, WHITE), fill: fill(RED), alignment: align("center"), border: allBorders() };
  const brandStyle2 = { font: font(10, false, WHITE), fill: fill(RED), alignment: align("center") };
  mergeRange(0, 0, 1, 30);
  setCell(0, 0, "FOLHA  DE  IMPUTAÇÃO", brandStyle);
  mergeRange(2, 0, 2, 23);
  setCell(2, 0, `Prazo limite de envio para Recursos Humanos: DIA 5 de CADA MÊS`, { font: font(8, false, GRAY_HDR), alignment: align("center") });
  mergeRange(2, 24, 2, 27);
  setCell(2, 24, meta.month || "", { font: font(11, true, RED), alignment: align("center") });
  mergeRange(2, 28, 2, 30);
  setCell(2, 28, meta.year || "", { font: font(11, true, RED), alignment: align("center") });
  mergeRange(3, 0, 3, 30);
  setCell(3, 0, "VERSÃO: 05.26 | DRH", { font: font(8, false, GRAY_SUB), alignment: align("right") });

  // Row 5-11: employee info block
  const labelStyle = { font: font(9, true, GRAY_HDR), fill: fill(GRAY_LIGHT), alignment: align("right", "center"), border: allBorders() };
  const valueStyle = { font: font(9, false, "FF000000"), border: allBorders(), alignment: align("left", "center") };

  const infoRows = [
    [5,  "Nº:",          meta.employee_number || "",  2, 3,  "Nome:",       meta.employee_name || "",    4, 15,  "Função:",   meta.funcao || "",      16, 30],
    [6,  "CCT:",         meta.cct || "",              2, 3,  "Horário:",    meta.horario || "",          4, 8,   "Direção ATM / ACE:", meta.direcao || "", 9, 15],
    [7,  "Departamento:",meta.department || "",       2, 10, "Centro de Custo:", meta.centro_custo || "", 11, 20, "","","",    21, 30],
    [8,  "E-mail Rem.:", meta.email_remetente || "",  2, 10, "E-mail Nível 1:", meta.email_nivel1 || "", 11, 20, "E-mail Nível 2:", meta.email_nivel2 || "", 21, 30],
  ];
  for (const [r, lbl1, v1, c1s, c1e, lbl2, v2, c2s, c2e, lbl3, v3, c3s, c3e] of infoRows) {
    setCell(r, 1, lbl1, labelStyle);
    mergeRange(r, c1s, r, c1e); setCell(r, c1s, v1, valueStyle);
    if (lbl2) { setCell(r, c2s - 1, lbl2, labelStyle); mergeRange(r, c2s, r, c2e); setCell(r, c2s, v2, valueStyle); }
    if (lbl3) { setCell(r, c3s - 1, lbl3, labelStyle); mergeRange(r, c3s, r, c3e); setCell(r, c3s, v3, valueStyle); }
  }

  // ── Data headers (rows 12-14) ─────────────────────────────────────────
  // Row 12: group labels
  const grpStyle = (rgb) => ({ font: font(9, true, WHITE), fill: fill(rgb), alignment: align("center", "center", true), border: allBorders(med) });

  const groups = [
    [2,  5,  "NORMAIS",              GRAY_HDR],
    [6,  11, "EXTRAORDINÁRIAS",      GRAY_MID],
    [12, 16, "HORAS DE VIAGEM",      GRAY_MID],
    [17, 20, "AUSÊNCIAS/PRESENÇAS",  GRAY_HDR],
    [21, 21, "TIPO DIA",             GRAY_HDR],
    [22, 24, "SUBSÍDIOS",            GRAY_HDR],
    [25, 26, "DESLOCAÇÃO",           GRAY_MID],
    [27, 29, "IMPUTAÇÃO",            RED],
    [30, 30, "OBS",                  GRAY_HDR],
  ];
  for (const [cs, ce, label, rgb] of groups) {
    mergeRange(12, cs, 12, ce);
    setCell(12, cs, label, grpStyle(rgb));
  }
  setCell(12, 1, "", grpStyle(GRAY_HDR)); // Data col header

  // Row 13: subgroup labels
  const subStyle = (rgb) => ({ font: font(8, true, WHITE), fill: fill(rgb), alignment: align("center", "center", true), border: allBorders() });
  const subs = [
    [1,  1,  "Data",                 GRAY_HDR],
    [2,  2,  "Total",                GRAY_HDR],
    [3,  5,  "PERÍODO",              GRAY_SUB],
    [6,  6,  "Total",                GRAY_MID],
    [7,  11, "Suplementares",        GRAY_SUB],
    [12, 12, "Total",                GRAY_MID],
    [13, 16, "Trajeto",              GRAY_SUB],
    [17, 17, "Total",                GRAY_HDR],
    [18, 20, "Tipo / Período",       GRAY_SUB],
    [21, 21, "",                     GRAY_HDR],
    [22, 22, "S.Alim.",              GRAY_HDR],
    [23, 23, "Prev.",                GRAY_HDR],
    [24, 24, "Desl.",                GRAY_HDR],
    [25, 25, "Local",                GRAY_MID],
    [26, 26, "Motivo",               GRAY_MID],
    [27, 27, "Nº Projeto",           RED],
    [28, 28, "Cliente",              RED],
    [29, 29, "Descrição",            RED],
    [30, 30, "Observações",          GRAY_HDR],
  ];
  for (const [cs, ce, label, rgb] of subs) {
    mergeRange(13, cs, 13, ce);
    setCell(13, cs, label, subStyle(rgb));
  }

  // Row 14: detail column headers
  const colHdr = (label, rgb = GRAY_COL) => ({ font: font(7.5, true, WHITE), fill: fill(rgb), alignment: align("center", "center", true), border: allBorders() });
  const detailCols = [
    [3, "de", GRAY_SUB], [4, "a", GRAY_SUB], [5, "Pausa", GRAY_SUB],
    [7, "1º HE\nde", GRAY_SUB], [8, "1º HE\na", GRAY_SUB],
    [9, "2º HE\nde", GRAY_SUB], [10, "2º HE\na", GRAY_SUB],
    [11, "Motivo TS", GRAY_SUB],
    [13, "Ida\nInício", GRAY_SUB], [14, "Ida\nFim", GRAY_SUB],
    [15, "Volta\nInício", GRAY_SUB], [16, "Volta\nFim", GRAY_SUB],
    [18, "Tipo Ausência", GRAY_SUB], [19, "de", GRAY_SUB], [20, "a", GRAY_SUB],
  ];
  for (const [c, lbl, rgb] of detailCols) {
    setCell(14, c, lbl, colHdr(lbl, rgb));
  }
  // Empty cells for merged columns in row 14
  for (const c of [1, 2, 6, 12, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
    setCell(14, c, "", colHdr("", GRAY_COL));
  }

  // ── Data rows ─────────────────────────────────────────────────────────
  const WEEKDAY_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const timeStyle = (bg) => ({ font: font(9, false, "FF000000"), fill: fill(bg), alignment: align("center"), border: allBorders(), numFmt: "h:mm" });
  const numStyle  = (bg) => ({ font: font(9, true,  "FF1A5276"), fill: fill(bg), alignment: align("center"), border: allBorders(), numFmt: "h:mm" });
  const txtStyle  = (bg) => ({ font: font(9, false, "FF000000"), fill: fill(bg), alignment: align("center", "center", true), border: allBorders() });
  const ckStyle   = (bg) => ({ font: font(9, false, RED),        fill: fill(bg), alignment: align("center"), border: allBorders() });
  const dayStyle  = (bg, bold = false) => ({ font: font(9, bold, bold ? WHITE : GRAY_HDR), fill: fill(bg), alignment: align("left"), border: allBorders() });

  let excelRow = 15;
  for (const r of rows) {
    const date = new Date(r.date + "T00:00:00");
    const wd   = date.getDay(); // 0=sun..6=sat
    const isWknd = wd === 0 || wd === 6;
    const isFeriado = r.day_type === "Feriado";
    const dayBg = isFeriado ? "FFDFE6FF" : isWknd ? WKND_BG : (excelRow % 2 === 0 ? WHITE : GRAY_LIGHT);
    const dateLbl = `${WEEKDAY_PT[wd]} ${String(r.day).padStart(2, "0")}/${r.date.slice(5, 7)}`;

    // Col B: Data
    setCell(excelRow, 1, dateLbl, dayStyle(isWknd || isFeriado ? dayBg : dayBg, isWknd));

    // Col C: Total Normais
    const nh = fmtHours(r.normal_hours);
    setCell(excelRow, 2, nh || 0, { ...numStyle(dayBg), v: nh, numFmt: "h:mm" });

    // Col D,E,F: Entrada, Saída, Pausa
    setCell(excelRow, 3,  fmtTime(r.period_start)  ?? "", { ...timeStyle(dayBg) });
    setCell(excelRow, 4,  fmtTime(r.period_end)     ?? "", { ...timeStyle(dayBg) });
    setCell(excelRow, 5,  fmtHours(r.pause_hours)   || "", { ...timeStyle(dayBg) });

    // Col G: Total Extra
    const eh = fmtHours(r.extra_hours);
    setCell(excelRow, 6, eh || 0, { ...numStyle("FFFFF9E7"), v: eh, numFmt: "h:mm" });

    // Col H-K: HE períodos
    setCell(excelRow, 7,  fmtTime(r.extra1_start)   ?? "", { ...timeStyle("FFFFF9E7") });
    setCell(excelRow, 8,  fmtTime(r.extra1_end)      ?? "", { ...timeStyle("FFFFF9E7") });
    setCell(excelRow, 9,  fmtTime(r.extra2_start)   ?? "", { ...timeStyle("FFFFF9E7") });
    setCell(excelRow, 10, fmtTime(r.extra2_end)      ?? "", { ...timeStyle("FFFFF9E7") });

    // Col L: Motivo TS
    setCell(excelRow, 11, r.extra_motivo || (r.extra_hours > 0 ? "Motivo Simples" : ""), { ...txtStyle("FFFFF9E7") });

    // Col M: Total Viagem
    const th = fmtHours(r.travel_hours);
    setCell(excelRow, 12, th || 0, { ...numStyle("FFF0F9FF"), v: th, numFmt: "h:mm" });

    // Col N-Q: Viagem trajetos
    setCell(excelRow, 13, fmtTime(r.travel1_start)  ?? "", { ...timeStyle("FFF0F9FF") });
    setCell(excelRow, 14, fmtTime(r.travel1_end)     ?? "", { ...timeStyle("FFF0F9FF") });
    setCell(excelRow, 15, fmtTime(r.travel2_start)  ?? "", { ...timeStyle("FFF0F9FF") });
    setCell(excelRow, 16, fmtTime(r.travel2_end)     ?? "", { ...timeStyle("FFF0F9FF") });

    // Col R: Total Ausência (horas)
    const ah = fmtHours(r.absence_hours);
    setCell(excelRow, 17, ah || 0, { ...numStyle(dayBg), v: ah, numFmt: "h:mm" });

    // Col S: Tipo Ausência
    setCell(excelRow, 18, r.absence_type || "", { ...txtStyle(dayBg), alignment: align("left", "center", true) });

    // Col T, U: ausência de/a (hora início/fim da ausência parcial — deixar vazio)
    setCell(excelRow, 19, "", { ...timeStyle(dayBg) });
    setCell(excelRow, 20, "", { ...timeStyle(dayBg) });

    // Col V: Tipo de Dia
    const dtBg = r.day_type === "Desc. Obrig" ? "FFFDECEA"
               : r.day_type === "Desc.Comp"   ? "FFFFF9E7"
               : r.day_type === "Feriado"      ? "FFDFE6FF"
               : dayBg;
    setCell(excelRow, 21, r.day_type || "Dia Útil", { ...txtStyle(dtBg) });

    // Col W,X,Y: S.Alim, Prev, Desl
    setCell(excelRow, 22, r.subsidio_almoco ? "1" : "", { ...ckStyle(dayBg) });
    setCell(excelRow, 23, r.prevencao       ? "X" : "", { ...ckStyle(dayBg) });
    setCell(excelRow, 24, r.deslocado       ? "X" : "", { ...ckStyle(dayBg) });

    // Col Z, AA: Local, Motivo Deslocação
    setCell(excelRow, 25, r.local_deslocacao  || "", { ...txtStyle(dayBg), alignment: align("left") });
    setCell(excelRow, 26, r.motivo_deslocacao || "", { ...txtStyle(dayBg), alignment: align("left") });

    // Col AB, AC, AD: Nº Projeto, Cliente, Descrição
    setCell(excelRow, 27, r.project_number      || "", { ...txtStyle(dayBg), font: font(9, true,  RED), alignment: align("center") });
    setCell(excelRow, 28, r.project_client       || "", { ...txtStyle(dayBg), alignment: align("left") });
    setCell(excelRow, 29, r.project_description  || "", { ...txtStyle(dayBg), alignment: align("left") });

    // Col AE: Observações
    setCell(excelRow, 30, r.observacoes || "", { ...txtStyle(dayBg), alignment: align("left") });

    excelRow++;
  }

  // ── TOTAL row ────────────────────────────────────────────────────────
  const totNorm  = rows.reduce((a, r) => a + Number(r.normal_hours  || 0), 0);
  const totExtra = rows.reduce((a, r) => a + Number(r.extra_hours   || 0), 0);
  const totTravel= rows.reduce((a, r) => a + Number(r.travel_hours  || 0), 0);
  const totStyle = (c) => ({ font: font(9, true, WHITE), fill: fill(c), alignment: align("center"), border: allBorders(med), numFmt: "h:mm" });
  const totTxt   = { font: font(10, true, WHITE), fill: fill(BLUE_TOTAL), alignment: align("center"), border: allBorders(med) };

  mergeRange(excelRow, 1, excelRow, 2);
  setCell(excelRow, 1, "TOTAL", totTxt);
  setCell(excelRow, 2,  fmtHours(totNorm),   totStyle(BLUE_TOTAL));
  for (const c of [3, 4, 5]) setCell(excelRow, c, "", totStyle(BLUE_TOTAL));
  setCell(excelRow, 6,  fmtHours(totExtra),  totStyle(BLUE_TOTAL));
  for (const c of [7, 8, 9, 10, 11]) setCell(excelRow, c, "", totStyle(BLUE_TOTAL));
  setCell(excelRow, 12, fmtHours(totTravel), totStyle(BLUE_TOTAL));
  for (let c = 13; c <= 30; c++) setCell(excelRow, c, "", totStyle(BLUE_TOTAL));

  // ── Summary section ───────────────────────────────────────────────────
  const sumRow = excelRow + 2;
  const smLbl = { font: font(8, true, WHITE), fill: fill(GRAY_MID), alignment: align("right"), border: allBorders() };
  const smVal = { font: font(9, true, "FF1A5276"), alignment: align("center"), border: allBorders() };
  const sumData = [
    ["Horas Normais Totais",  fmtHours(totNorm),  "h:mm"],
    ["Horas Extra Totais",    fmtHours(totExtra), "h:mm"],
    ["Horas Viagem Totais",   fmtHours(totTravel),"h:mm"],
    ["Dias Trabalhados",      rows.filter(r => Number(r.normal_hours) > 0).length, "0"],
    ["Dias de Férias",        rows.filter(r => r.absence_type?.includes("Férias")).length, "0"],
  ];
  for (let i = 0; i < sumData.length; i++) {
    const [lbl, val, fmt] = sumData[i];
    setCell(sumRow + i, 1, lbl, smLbl);
    setCell(sumRow + i, 2, val, { ...smVal, numFmt: fmt });
  }

  // ── Signature block ───────────────────────────────────────────────────
  const sigRow = sumRow + sumData.length + 2;
  const sigLbl = { font: font(9, true, WHITE), fill: fill(GRAY_HDR), alignment: align("center"), border: allBorders() };
  const sigFields = [
    [1, 6, "Técnico (Colaborador)"],
    [10, 15, "Encarregado"],
    [17, 22, "Gestor de Contrato"],
    [24, 28, "Direção"],
  ];
  for (const [cs, ce, lbl] of sigFields) {
    mergeRange(sigRow, cs, sigRow, ce);
    setCell(sigRow, cs, lbl, sigLbl);
    mergeRange(sigRow + 3, cs, sigRow + 3, ce);
    setCell(sigRow + 3, cs, "___ / ___", { font: font(8, false, GRAY_SUB), alignment: align("center"), border: allBorders() });
  }

  // ── Sheet range ──────────────────────────────────────────────────────
  const lastRow = sigRow + 4;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: 30 } });

  // Row heights
  const ROW_HEIGHTS = {};
  for (let r = 0; r <= 4; r++) ROW_HEIGHTS[r] = 16;
  for (let r = 5; r <= 11; r++) ROW_HEIGHTS[r] = 18;
  ROW_HEIGHTS[12] = 24; ROW_HEIGHTS[13] = 22; ROW_HEIGHTS[14] = 28;
  for (let r = 15; r < excelRow; r++) ROW_HEIGHTS[r] = 22;
  ROW_HEIGHTS[excelRow] = 22;
  ws["!rows"] = Array.from({ length: lastRow + 1 }, (_, i) => ROW_HEIGHTS[i] ? { hpt: ROW_HEIGHTS[i] } : {});

  XLSX.utils.book_append_sheet(wb, ws, "TimeSheet");

  // ── Projects sheet ────────────────────────────────────────────────────
  if (projects.length > 0) {
    const pws = {};
    const pH  = (c, lbl) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      pws[ref] = { v: lbl, t: "s", s: { font: font(9, true, WHITE), fill: fill(RED), alignment: align("center"), border: allBorders() } };
    };
    pH(0, "Nº Projeto"); pH(1, "Cliente"); pH(2, "Descrição");
    projects.forEach((p, i) => {
      const r = i + 1;
      const bg = r % 2 === 0 ? GRAY_LIGHT : WHITE;
      const base = { font: font(9), fill: fill(bg), border: allBorders(), alignment: align("left") };
      [[0, p.code], [1, p.client], [2, p.description]].forEach(([c, v]) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        pws[ref] = { v: v || "", t: "s", s: base };
      });
    });
    pws["!ref"]  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: projects.length, c: 2 } });
    pws["!cols"] = [{ wch: 16 }, { wch: 30 }, { wch: 55 }];
    XLSX.utils.book_append_sheet(wb, pws, "Nº Projetos");
  }

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ------------------------------------------------------------------ */
/* Fill existing Excel template with edited rows                       */
/* ------------------------------------------------------------------ */

/**
 * Takes an original ATM Excel template (ArrayBuffer) and fills it with 
 * the edited row data. Returns a Blob ready for download.
 * This preserves the original template's layout, formulas, and styling.
 */
export async function fillTimesheetTemplate(originalFile, { rows, meta }) {
  const buf = await originalFile.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });

  // Find the TimeSheet sheet
  const preferred = "TimeSheet";
  const sheetName =
    wb.Sheets[preferred] != null
      ? preferred
      : wb.SheetNames.find((n) => normalizeSheetName(n).includes("timesheet")) || wb.SheetNames[0];

  if (!wb.Sheets[sheetName]) {
    throw new Error("Aba TimeSheet n\u00e3o encontrada no template.");
  }

  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find the data rows (same logic as extractDailyRecords)
  const dateCol = (() => {
    let bestCol = 0, bestCount = -1;
    const sampleStart = Math.min(30, Math.max(0, matrix.length - 1));
    const sampleEnd = Math.min(matrix.length, sampleStart + 120);
    const colCount = Math.max(0, ...matrix.map((r) => (r ? r.length : 0)));
    for (let c = 0; c < colCount; c++) {
      let count = 0;
      for (let r = sampleStart; r < sampleEnd; r++) {
        if (parseDateCell(matrix[r]?.[c])) count++;
      }
      if (count > bestCount) { bestCount = count; bestCol = c; }
    }
    return bestCol;
  })();

  const startRow = (() => {
    let consecutive = 0;
    for (let r = 0; r < matrix.length; r++) {
      if (parseDateCell(matrix[r]?.[dateCol])) consecutive++;
      else consecutive = 0;
      if (consecutive >= 5) return Math.max(0, r - (consecutive - 1));
    }
    return Math.min(37, Math.max(0, matrix.length - 1));
  })();

  // Map edited rows by date
  const rowByDate = new Map(rows.map((r) => [r.date, r]));

  // Column mapping (same indices as extraction)
  const headerRowIdx = (() => {
    const patterns = ["data", "entrada", "saida", "pausa", "normal", "extra", "viagem", "ausencia", "feriado", "cliente", "projeto", "descricao"];
    let bestIdx = Math.max(0, startRow - 1), bestScore = -1;
    for (let r = Math.max(0, startRow - 15); r < startRow; r++) {
      const cells = (matrix[r] || []).map(normalizeHeaderCell).join(" ");
      let score = 0;
      for (const p of patterns) if (cells.includes(p)) score++;
      if (score > bestScore) { bestScore = score; bestIdx = r; }
    }
    return bestIdx;
  })();

  const headerRow = matrix[headerRowIdx] || [];
  const h1 = (i) => normalizeHeaderCell(headerRow?.[i]);

  function findCol(keywords) {
    const normalized = (headerRow || []).map(normalizeHeaderCell);
    let best = -1, bestScore = -1;
    for (let i = 0; i < normalized.length; i++) {
      let score = 0;
      for (const k of keywords) if (normalized[i].includes(k)) score++;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore > 0 ? best : -1;
  }

  const cols = {
    normal_hours: findCol(["normal", "normais", "hn"]),
    extra_hours: findCol(["total", "extra"]),
    period_start: findCol(["entrada", "inicio", "inici"]),
    period_end: findCol(["saida", "fim"]),
    pause_hours: findCol(["pausa", "almoco"]),
    extra1_start: findCol(["suplementares"]),
    day_type: dateCol + 7, // approximate
    project_number: findCol(["projeto", "project"]),
    project_client: findCol(["cliente", "client"]),
    project_description: findCol(["descricao", "description"]),
  };

  // Also try to find via column header row 2
  const headerRow2 = matrix[headerRowIdx + 1] || [];
  const h2 = (i) => normalizeHeaderCell(headerRow2?.[i]);

  if (cols.extra1_start < 0 && h2(dateCol + 6)?.includes("1") && h2(dateCol + 6).includes("de")) cols.extra1_start = dateCol + 6;
  if (cols.extra_hours < 0 && h1(dateCol + 5)?.includes("total")) cols.extra_hours = dateCol + 5;

  // Write data back
  for (let r = startRow; r < matrix.length; r++) {
    const dateISO = parseDateCell(matrix[r]?.[dateCol]);
    if (!dateISO) continue;

    const edited = rowByDate.get(dateISO);
    if (!edited) continue;

    const cell = (cIdx) => matrix[r][cIdx];

    // Hours column 2 (Total Normais)
    if (cols.normal_hours >= 0 && typeof edited.normal_hours === "number") {
      // Write as a number directly (not time fraction)
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.normal_hours });
      if (ws[cellRef]) {
        ws[cellRef].v = edited.normal_hours;
        ws[cellRef].t = "n";
      }
    }

    // Period start (col 3)
    if (cols.period_start >= 0 && edited.period_start) {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.period_start });
      if (ws[cellRef]) {
        const [hh, mm] = edited.period_start.split(":").map(Number);
        ws[cellRef].v = (hh + mm / 60) / 24;
        ws[cellRef].t = "n";
        ws[cellRef].z = "h:mm";
      }
    }

    // Period end (col 4)
    if (cols.period_end >= 0 && edited.period_end) {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.period_end });
      if (ws[cellRef]) {
        const [hh, mm] = edited.period_end.split(":").map(Number);
        ws[cellRef].v = (hh + mm / 60) / 24;
        ws[cellRef].t = "n";
        ws[cellRef].z = "h:mm";
      }
    }

    // Pause (col 5)
    if (cols.pause_hours >= 0 && edited.pause_hours > 0) {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.pause_hours });
      if (ws[cellRef]) {
        ws[cellRef].v = edited.pause_hours / 24;
        ws[cellRef].t = "n";
        ws[cellRef].z = "h:mm";
      }
    }

    // Extra hours
    if (cols.extra_hours >= 0 && typeof edited.extra_hours === "number") {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.extra_hours });
      if (ws[cellRef]) {
        ws[cellRef].v = edited.extra_hours;
        ws[cellRef].t = "n";
      }
    }

    // Extra 1 start/end
    if (cols.extra1_start >= 0 && edited.extra1_start) {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.extra1_start });
      if (ws[cellRef]) {
        const [hh, mm] = edited.extra1_start.split(":").map(Number);
        ws[cellRef].v = (hh + mm / 60) / 24;
        ws[cellRef].t = "n";
      }
    }

    // Project number
    if (cols.project_number >= 0 && edited.project_number) {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.project_number });
      if (ws[cellRef]) {
        ws[cellRef].v = edited.project_number;
        ws[cellRef].t = "s";
      }
    }

    // Day type
    if (cols.day_type >= 0 && edited.day_type) {
      const cellRef = XLSX.utils.encode_cell({ r, c: cols.day_type });
      if (ws[cellRef]) {
        ws[cellRef].v = edited.day_type;
        ws[cellRef].t = "s";
      }
    }
  }

  // Also write project clients/descriptions in the columns just after project number
  if (cols.project_number >= 0) {
    for (let r = startRow; r < matrix.length; r++) {
      const dateISO = parseDateCell(matrix[r]?.[dateCol]);
      if (!dateISO) continue;
      const edited = rowByDate.get(dateISO);
      if (!edited) continue;

      if (edited.project_client && cols.project_number + 1 < (matrix[r]?.length || 0)) {
        const cellRef = XLSX.utils.encode_cell({ r, c: cols.project_number + 1 });
        if (ws[cellRef]) { ws[cellRef].v = edited.project_client; ws[cellRef].t = "s"; }
      }
      if (edited.project_description && cols.project_number + 2 < (matrix[r]?.length || 0)) {
        const cellRef = XLSX.utils.encode_cell({ r, c: cols.project_number + 2 });
        if (ws[cellRef]) { ws[cellRef].v = edited.project_description; ws[cellRef].t = "s"; }
      }
    }
  }

  // Write back the workbook
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
