import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  if (typeof serial !== "number") return null;
  if (!Number.isFinite(serial)) return null;
  if (serial < 20000 || serial > 90000) return null;
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseDateCell(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToISO(value);
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pt = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (pt) {
    const day = pt[1].padStart(2, "0");
    const month = pt[2].padStart(2, "0");
    const year = pt[3].length === 2 ? `20${pt[3]}` : pt[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseHoursCell(value) {
  if (value == null || value === "") return 0;
  if (value instanceof Date) {
    const h = value.getUTCHours();
    const m = value.getUTCMinutes();
    const s = value.getUTCSeconds();
    return Number((h + m / 60 + s / 3600).toFixed(2));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    if (value > 0 && value < 1) return Number((value * 24).toFixed(2));
    return Number(value.toFixed(2));
  }
  const s = String(value).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return Number((h + m / 60).toFixed(2));
  }
  const n = Number(String(s).replace(",", "."));
  if (Number.isFinite(n)) return Number(n.toFixed(2));
  return 0;
}

function formatTimeCell(value) {
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

function pickBestHeaderRow(matrix, startRow) {
  const patterns = [
    "data",
    "entrada",
    "saida",
    "pausa",
    "normal",
    "extra",
    "viagem",
    "ausencia",
    "feriado",
    "cliente",
    "projeto",
    "descricao"
  ];
  let bestIdx = Math.max(0, startRow - 1);
  let bestScore = -1;
  for (let r = Math.max(0, startRow - 15); r < startRow; r++) {
    const row = matrix[r] || [];
    const cells = row.map(normalizeHeaderCell).join(" ");
    let score = 0;
    for (const p of patterns) if (cells.includes(p)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return bestIdx;
}

function findColIndex(headerRow, keywords) {
  const normalized = (headerRow || []).map(normalizeHeaderCell);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < normalized.length; i++) {
    const cell = normalized[i];
    let score = 0;
    for (const k of keywords) if (cell.includes(k)) score++;
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
      const iso = parseDateCell(matrix[r]?.[c]);
      if (iso) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestCol = c;
    }
  }
  return bestCol;
}

function detectStartRow(matrix, dateCol) {
  // Some templates include "Inicio/Fim" dates near the top. Require a longer
  // streak of dates to avoid locking onto those.
  const threshold = 5;
  let consecutive = 0;
  for (let r = 0; r < matrix.length; r++) {
    const iso = parseDateCell(matrix[r]?.[dateCol]);
    if (iso) consecutive++;
    else consecutive = 0;
    if (consecutive >= threshold) return Math.max(0, r - (threshold - 1));
  }
  return Math.min(37, Math.max(0, matrix.length - 1));
}

function matrixToDailyRecords(matrix) {
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
    project_number: findColIndex(headerRow, ["projeto", "project", "nº", "no"]),
    project_client: findColIndex(headerRow, ["cliente", "client"]),
    project_description: findColIndex(headerRow, ["descricao", "description"])
  };

  // Fallback for the common ATM template where:
  // Dia/date is in `dateCol`, "Total" (normal hours) is in `dateCol+1`,
  // period is in dateCol+2..dateCol+4, extra total in dateCol+5, and day_type is far right.
  const h1 = (i) => normalizeHeaderCell(headerRow?.[i]);
  const h2 = (i) => normalizeHeaderCell(headerRow2?.[i]);

  if (cols.normal_hours < 0 && h1(dateCol + 1).includes("total")) cols.normal_hours = dateCol + 1;
  if (cols.extra_hours < 0 && h1(dateCol + 5).includes("total") && h1(dateCol + 6).includes("suplement")) {
    cols.extra_hours = dateCol + 5;
  }
  if (cols.period_start < 0 && h2(dateCol + 2) === "de") cols.period_start = dateCol + 2;
  if (cols.period_end < 0 && h2(dateCol + 3) === "a") cols.period_end = dateCol + 3;
  if (cols.pause_hours < 0 && h2(dateCol + 4).includes("pausa")) cols.pause_hours = dateCol + 4;

  // Travel: prefer the "Total" column after the "Horas de Viagem" group header.
  if (cols.travel_hours >= 0 && h1(cols.travel_hours).includes("viagem")) {
    for (let i = cols.travel_hours; i < Math.min(cols.travel_hours + 12, headerRow.length); i++) {
      if (h1(i) === "total") {
        cols.travel_hours = i;
        break;
      }
    }
  }

  // Day type: detect by actual values (Dia Útil / Desc / Feriado) in the data rows.
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

    const readTextCell = (v) => {
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
      day_type: cols.day_type >= 0 ? readTextCell(row[cols.day_type]) : "",
      absence_type: cols.absence_type >= 0 ? readTextCell(row[cols.absence_type]) : "",
      period_start: cols.period_start >= 0 ? formatTimeCell(row[cols.period_start]) : "",
      period_end: cols.period_end >= 0 ? formatTimeCell(row[cols.period_end]) : "",
      pause_hours: cols.pause_hours >= 0 ? parseHoursCell(row[cols.pause_hours]) : 0,
      project_number: cols.project_number >= 0 ? readTextCell(row[cols.project_number]) : "",
      project_client: cols.project_client >= 0 ? readTextCell(row[cols.project_client]) : "",
      project_description: cols.project_description >= 0 ? readTextCell(row[cols.project_description]) : ""
    });
  }

  return records;
}

function extractMetaFromTimeSheetMatrix(matrix) {
  const meta = {
    employee_name: "",
    employee_number: "",
    month: "",
    year: null,
    department: "",
    total_compensation_hours: 0,
    total_descanso_compensatorio_hours: 0
  };

  function readCellHours(row1Based, colLetter) {
    const rowIdx = Math.max(0, Number(row1Based) - 1);
    const colIdx = String(colLetter || "")
      .trim()
      .toUpperCase()
      .split("")
      .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    if (rowIdx < 0 || colIdx < 0) return 0;
    const v = matrix?.[rowIdx]?.[colIdx];
    return parseHoursCell(v);
  }

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
      if (key.includes("departamento")) {
        const v = nextNonEmpty(row, c);
        if (v) meta.department = v;
      }
    }
  }

  // Fallback for common encoding issues (e.g. "Nº" showing as "NÂº").
  if (!meta.employee_number) {
    for (let r = 0; r < Math.min(matrix.length, 30); r++) {
      const row = matrix[r] || [];
      for (let c = 0; c < row.length; c++) {
        const key = normalizeHeaderCell(row[c])
          .replace(/\s+/g, "")
          .replace(/[º°]/g, "o")
          .replace(/[^a-z0-9:]/g, "");
        const short = key.length <= 4;
        const isEmployeeNumberKey =
          short && (key === "n" || key === "n:" || key === "no" || key === "no:" || key === "nao" || key === "nao:");
        if (!isEmployeeNumberKey) continue;
        const v = nextNonEmpty(row, c);
        if (v) {
          meta.employee_number = v;
          break;
        }
      }
      if (meta.employee_number) break;
    }
  }

  // Often appears as "... | Mar | 2026" in row ~12
  let best = null;
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] ?? "").trim();
      const year = Number(v);
      if (Number.isInteger(year) && year >= 2020 && year <= 2100) {
        const prev = String(row[c - 1] ?? "").trim();
        const prevNorm = normalizeHeaderCell(prev);
        if (prev && prev.length <= 10 && /[A-Za-zÀ-ÿ]/.test(prev) && prevNorm !== "ano" && prevNorm !== "mes") {
          best = { month: prev, year };
        }
      }
    }
  }

  if (!best) {
    const monthNames = [
      "janeiro",
      "fevereiro",
      "marco",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
      "jan",
      "fev",
      "mar",
      "abr",
      "mai",
      "jun",
      "jul",
      "ago",
      "set",
      "out",
      "nov",
      "dez"
    ];

    for (let r = 0; r < Math.min(matrix.length, 30); r++) {
      const row = matrix[r] || [];
      for (let c = 0; c < row.length; c++) {
        const raw = String(row[c] ?? "").trim();
        if (!raw) continue;
        const norm = normalizeHeaderCell(raw);
        if (!monthNames.includes(norm)) continue;

        for (let d = -2; d <= 2; d++) {
          if (d === 0) continue;
          const year = Number(String(row[c + d] ?? "").trim());
          if (Number.isInteger(year) && year >= 2020 && year <= 2100) {
            best = { month: raw, year };
            break;
          }
        }
        if (best) break;
      }
      if (best) break;
    }
  }

  if (best) {
    meta.month = best.month;
    meta.year = best.year;
  }

  // Totals (ATM template): L75 = total horas de compensação.
  // This value is treated as the total pool of "horas compensadas" for the period.
  const totalComp = readCellHours(75, "L");
  meta.total_compensation_hours = totalComp;
  meta.total_descanso_compensatorio_hours = 0;
  return meta;
}

async function readWithXlsx(filePath, sheetName) {
  const mod = await import("xlsx");
  const xlsx = mod?.default || mod;
  if (!xlsx?.readFile || !xlsx?.utils?.sheet_to_json) {
    throw new Error("xlsx module loaded but missing expected exports");
  }

  const wb = xlsx.readFile(filePath, { cellDates: true });
  const preferredNorm = normalizeSheetName(sheetName);
  const sheetNames = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  const byExact = sheetName && wb.Sheets[sheetName] ? sheetName : null;
  const byNormalized =
    !byExact && preferredNorm ? sheetNames.find((n) => normalizeSheetName(n) === preferredNorm) || null : null;
  const byTimesheet =
    !byExact && !byNormalized ? sheetNames.find((n) => normalizeSheetName(n).includes("timesheet")) || null : null;
  const chosenSheet = byExact || byNormalized || byTimesheet || sheetNames?.[0] || null;
  if (!chosenSheet) return { sheet: null, matrix: [] };
  const ws = wb.Sheets[chosenSheet];
  const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const meta = normalizeSheetName(chosenSheet).includes("timesheet") ? extractMetaFromTimeSheetMatrix(matrix) : null;
  return { sheet: chosenSheet, matrix, meta };
}

async function readWithExcelCom(filePath, preferredSheetName) {
  if (process.platform !== "win32") {
    throw new Error("Excel COM extractor is only available on Windows.");
  }

  const script = `
$ErrorActionPreference = 'Stop'
$path = ${JSON.stringify(filePath)}
$preferred = ${JSON.stringify(preferredSheetName || "TimeSheet")}
$excel = New-Object -ComObject Excel.Application
$excel.DisplayAlerts = $false
$excel.Visible = $false
try {
  $wb = $excel.Workbooks.Open($path, 0, $true)
  try {
    $ws = $null
    foreach ($w in $wb.Worksheets) { if ($w.Name -eq $preferred) { $ws = $w; break } }
    if (-not $ws) { $ws = $wb.Worksheets.Item(1) }
    $range = $ws.UsedRange
    $v = $range.Value2
    $rows = @()
    if ($null -ne $v) {
      if ($v -isnot [System.Array]) {
        $rows = @(@($v))
      } else {
        $rowCount = $v.GetLength(0)
        $colCount = $v.GetLength(1)
        for ($r = 1; $r -le $rowCount; $r++) {
          $row = @()
          for ($c = 1; $c -le $colCount; $c++) { $row += $v[$r,$c] }
          $rows += ,$row
        }
      }
    }
    @{ sheet = $ws.Name; matrix = $rows } | ConvertTo-Json -Depth 6 -Compress
  } finally {
    $wb.Close($false) | Out-Null
  }
} finally {
  $excel.Quit() | Out-Null
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    { maxBuffer: 80 * 1024 * 1024 }
  );

  const payload = JSON.parse(String(stdout || "").trim() || "{}");
  return { sheet: payload.sheet || null, matrix: payload.matrix || [] };
}

export async function extractTimesheetDailyRecords({ filePath, sheetName = "TimeSheet" }) {
  let matrixPayload = null;
  try {
    matrixPayload = await readWithXlsx(filePath, sheetName);
    return {
      sheet: matrixPayload.sheet,
      records: matrixToDailyRecords(matrixPayload.matrix),
      meta: matrixPayload.meta || null
    };
  } catch {
    // ignore and try COM
  }

  if (process.platform !== "win32") {
    throw new Error(
      "Excel extraction failed. Install the `xlsx` dependency (required on Linux/macOS) or run on Windows with Microsoft Excel installed."
    );
  }

  matrixPayload = await readWithExcelCom(filePath, sheetName);
  return {
    sheet: matrixPayload.sheet,
    records: matrixToDailyRecords(matrixPayload.matrix),
    meta: matrixPayload.sheet === "TimeSheet" ? extractMetaFromTimeSheetMatrix(matrixPayload.matrix) : null
  };
}

export function extractRowsFromPrompt(prompt) {
  const text = String(prompt || "");
  const startMarker = "Dados brutos:";
  const idx = text.indexOf(startMarker);
  const slice = idx >= 0 ? text.slice(idx + startMarker.length) : text;
  const start = slice.indexOf("[");
  const end = slice.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) return [];
  const jsonText = slice.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
