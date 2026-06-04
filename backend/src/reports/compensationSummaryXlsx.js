import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { prisma, query } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_FILENAMES = ["ATM-Resumo-Horas-Template.xlsx", "ATM-Resumo-Horas-Modelo.xlsx"];
const LOCAL_TEMPLATE_FILES = TEMPLATE_FILENAMES.map((fileName) => path.join(__dirname, fileName));
const ABSOLUTE_TEMPLATE_FILES = TEMPLATE_FILENAMES.map((fileName) =>
  path.resolve("C:\\Users\\Deogracia de Castro\\Documents\\Projetos\\atm", fileName)
);

function resolveTemplateFile() {
  for (const filePath of [...LOCAL_TEMPLATE_FILES, ...ABSOLUTE_TEMPLATE_FILES]) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return "";
}

function monthIndex(name) {
  const value = String(name || "").trim().toLowerCase();
  const map = {
    jan: 1,
    janeiro: 1,
    fev: 2,
    fevereiro: 2,
    mar: 3,
    março: 3,
    marco: 3,
    abr: 4,
    abril: 4,
    mai: 5,
    maio: 5,
    jun: 6,
    junho: 6,
    jul: 7,
    julho: 7,
    ago: 8,
    agosto: 8,
    set: 9,
    setembro: 9,
    out: 10,
    outubro: 10,
    nov: 11,
    novembro: 11,
    dez: 12,
    dezembro: 12
  };
  return map[value] || map[value.slice(0, 3)] || 0;
}

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeTimesheetManualUsed(timesheet, usedFromRecords) {
  const total = safeNumber(timesheet?.total_compensation_hours);
  const manualUsed = safeNumber(timesheet?.total_descanso_compensatorio_hours);
  const recordsUsed = safeNumber(usedFromRecords);
  return Math.max(0, recordsUsed === 0 && manualUsed === total ? 0 : manualUsed);
}

function monthKey({ year, month }) {
  const yearNumber = Number(year || 0);
  const monthNumber = monthIndex(month);
  if (!yearNumber || !monthNumber) return "";
  return `${String(yearNumber).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function cellAddress(rowIndex, colIndex) {
  return `${columnName(colIndex)}${rowIndex + 1}`;
}

function getCellStyle(xml, address, fallback = "0") {
  const match = xml.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>`));
  return match?.[0]?.match(/\bs="([^"]+)"/)?.[1] || fallback;
}

function makeStringCell(address, style, value) {
  const preserve = /^\s|\s$/.test(String(value ?? "")) ? ' xml:space="preserve"' : "";
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t${preserve}>${xmlEscape(value)}</t></is></c>`;
}

function makeNumberCell(address, style, value) {
  const number = Number(value || 0);
  return `<c r="${address}" s="${style}"><v>${Number.isFinite(number) ? number : 0}</v></c>`;
}

function replaceCell(xml, address, cellXml) {
  const pattern = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?:/>|>[\\s\\S]*?<\\/c>)`);
  return xml.replace(pattern, cellXml);
}

function updateSheetRange(xml, ref) {
  return xml.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="${ref}"/>`);
}

function updateIgnoredErrorsRange(xml, ref) {
  return xml.replace(/<ignoredError sqref="[^"]+"/, `<ignoredError sqref="${ref}"`);
}

function patchResumoXml(xml, values) {
  let nextXml = xml;
  const stringCells = {
    B4: values.employeeName,
    B5: values.employeeNumber,
    B6: values.department,
    B7: values.period,
    B8: values.generatedAt
  };
  const numberCells = {
    B11: values.normal,
    B12: values.extra,
    B13: values.travel,
    B14: values.absence,
    B17: values.totalComp,
    B18: values.usedFromRecords,
    B19: values.usedManual,
    B20: values.usedEnjoyed,
    B21: values.totalUsed,
    B22: values.available
  };

  for (const [address, value] of Object.entries(stringCells)) {
    nextXml = replaceCell(nextXml, address, makeStringCell(address, getCellStyle(xml, address, "5"), value));
  }
  for (const [address, value] of Object.entries(numberCells)) {
    nextXml = replaceCell(
      nextXml,
      address,
      makeNumberCell(address, getCellStyle(xml, address, "7"), Number(safeNumber(value).toFixed(2)))
    );
  }
  return nextXml;
}

function patchPorMesXml(xml, rowsByMonth) {
  const headerRow = xml.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/)?.[0];
  if (!headerRow) throw new Error("Template Excel inválido: aba Por Mês sem cabeçalho.");

  const stringStyle = getCellStyle(xml, "A2", "10");
  const yearStyle = getCellStyle(xml, "B2", "10");
  const numberStyle = getCellStyle(xml, "C2", "11");
  const dataRows = rowsByMonth.map((row, index) => {
    const rowNumber = index + 2;
    const values = [
      row.month,
      row.year,
      Number(row.normal.toFixed(2)),
      Number(row.extra.toFixed(2)),
      Number(row.travel.toFixed(2)),
      Number(row.absence.toFixed(2)),
      Number(row.totalComp.toFixed(2)),
      Number(row.usedFromRecords.toFixed(2)),
      Number(row.usedManual.toFixed(2)),
      Number(row.usedEnjoyed.toFixed(2)),
      Number(row.totalUsed.toFixed(2)),
      Number(row.available.toFixed(2))
    ];
    const cells = values
      .map((value, colIndex) => {
        const address = cellAddress(rowNumber - 1, colIndex);
        if (colIndex === 0) return makeStringCell(address, stringStyle, value);
        if (colIndex === 1) return makeNumberCell(address, yearStyle, value);
        return makeNumberCell(address, numberStyle, value);
      })
      .join("");
    return `<row r="${rowNumber}" spans="1:12" x14ac:dyDescent="0.2">${cells}</row>`;
  });

  const lastRow = Math.max(1, rowsByMonth.length + 1);
  let nextXml = xml.replace(
    /<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData>${headerRow}${dataRows.join("")}</sheetData>`
  );
  nextXml = updateSheetRange(nextXml, `A1:L${lastRow}`);
  nextXml = updateIgnoredErrorsRange(nextXml, `A1:L${lastRow}`);
  return nextXml;
}

function patchTemplateWorkbook({ templateFile, rowsByMonth, summaryValues }) {
  const archive = unzipSync(fs.readFileSync(templateFile));
  archive["xl/worksheets/sheet1.xml"] = strToU8(
    patchResumoXml(strFromU8(archive["xl/worksheets/sheet1.xml"]), summaryValues)
  );
  archive["xl/worksheets/sheet2.xml"] = strToU8(
    patchPorMesXml(strFromU8(archive["xl/worksheets/sheet2.xml"]), rowsByMonth)
  );
  return Buffer.from(zipSync(archive, { level: 6 }));
}

export async function generateCompensationSummaryXlsx({ userId }) {
  const templateFile = resolveTemplateFile();
  if (!templateFile) {
    throw new Error(
      `Template Excel não encontrado. Procurado em: ${[...LOCAL_TEMPLATE_FILES, ...ABSOLUTE_TEMPLATE_FILES].join(", ")}`
    );
  }

  const timesheets = await query(
    prisma,
    `
    SELECT *
    FROM timesheets
    WHERE user_id = $1
    ORDER BY created_date ASC
    `,
    [userId]
  );

  const recordAgg = await query(
    prisma,
    `
    SELECT
      timesheet_id,
      COALESCE(SUM(normal_hours), 0)::float AS total_normal_hours,
      COALESCE(SUM(extra_hours), 0)::float AS total_extra_hours,
      COALESCE(SUM(travel_hours), 0)::float AS total_travel_hours,
      COALESCE(SUM(absence_hours), 0)::float AS total_absence_hours,
      COALESCE(SUM(CASE WHEN compensated THEN normal_hours ELSE 0 END), 0)::float AS used_from_records
    FROM timesheet_records
    WHERE user_id = $1
    GROUP BY timesheet_id
    `,
    [userId]
  );

  const enjoyments = await query(
    prisma,
    `
    SELECT enjoy_date, hours
    FROM compensation_enjoyments
    WHERE user_id = $1
    ORDER BY enjoy_date ASC
    `,
    [userId]
  );

  const aggByTimesheetId = new Map();
  for (const row of recordAgg) {
    aggByTimesheetId.set(String(row.timesheet_id || ""), {
      normal: safeNumber(row.total_normal_hours),
      extra: safeNumber(row.total_extra_hours),
      travel: safeNumber(row.total_travel_hours),
      absence: safeNumber(row.total_absence_hours),
      usedFromRecords: safeNumber(row.used_from_records)
    });
  }

  const enjoymentsByMonthKey = new Map();
  for (const row of enjoyments) {
    const iso = row?.enjoy_date ? String(row.enjoy_date).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const key = iso.slice(0, 7);
    enjoymentsByMonthKey.set(key, (enjoymentsByMonthKey.get(key) || 0) + safeNumber(row.hours));
  }

  const rowsByMonth = timesheets
    .map((timesheet) => {
      const agg = aggByTimesheetId.get(String(timesheet?.id || "")) || {
        normal: 0,
        extra: 0,
        travel: 0,
        absence: 0,
        usedFromRecords: 0
      };
      const usedManual = normalizeTimesheetManualUsed(timesheet, agg.usedFromRecords);
      const usedEnjoyed = enjoymentsByMonthKey.get(monthKey(timesheet)) || 0;
      const totalComp = safeNumber(timesheet?.total_compensation_hours);
      const totalUsed = Math.max(0, agg.usedFromRecords + usedManual + usedEnjoyed);

      return {
        month: String(timesheet?.month || "").trim(),
        year: timesheet?.year != null ? Number(timesheet.year) : null,
        employee_name: timesheet?.employee_name || "",
        employee_number: timesheet?.employee_number || "",
        department: timesheet?.department || "",
        normal: agg.normal,
        extra: agg.extra,
        travel: agg.travel,
        absence: agg.absence,
        totalComp,
        usedFromRecords: agg.usedFromRecords,
        usedManual,
        usedEnjoyed,
        totalUsed,
        available: Math.max(0, totalComp - totalUsed)
      };
    })
    .sort((a, b) => {
      if (Number(a.year || 0) !== Number(b.year || 0)) return Number(a.year || 0) - Number(b.year || 0);
      return monthIndex(a.month) - monthIndex(b.month);
    });

  const totals = rowsByMonth.reduce(
    (acc, row) => {
      acc.normal += safeNumber(row.normal);
      acc.extra += safeNumber(row.extra);
      acc.travel += safeNumber(row.travel);
      acc.absence += safeNumber(row.absence);
      acc.totalComp += safeNumber(row.totalComp);
      acc.usedFromRecords += safeNumber(row.usedFromRecords);
      acc.usedManual += safeNumber(row.usedManual);
      acc.usedEnjoyed += safeNumber(row.usedEnjoyed);
      return acc;
    },
    { normal: 0, extra: 0, travel: 0, absence: 0, totalComp: 0, usedFromRecords: 0, usedManual: 0, usedEnjoyed: 0 }
  );
  totals.totalUsed = Math.max(0, totals.usedFromRecords + totals.usedManual + totals.usedEnjoyed);
  totals.available = Math.max(0, totals.totalComp - totals.totalUsed);

  const first = rowsByMonth[0] || null;
  const periodStart =
    rowsByMonth.length > 0 ? `${rowsByMonth[0].month} ${rowsByMonth[0].year || ""}`.trim() : "";
  const periodEnd =
    rowsByMonth.length > 0
      ? `${rowsByMonth[rowsByMonth.length - 1].month} ${rowsByMonth[rowsByMonth.length - 1].year || ""}`.trim()
      : "";

  return patchTemplateWorkbook({
    templateFile,
    rowsByMonth,
    summaryValues: {
      employeeName: first?.employee_name || "Colaborador",
      employeeNumber: first?.employee_number || "",
      department: first?.department || "",
      period: periodStart && periodEnd ? (periodStart === periodEnd ? periodStart : `${periodStart} - ${periodEnd}`) : "",
      generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      normal: totals.normal,
      extra: totals.extra,
      travel: totals.travel,
      absence: totals.absence,
      totalComp: totals.totalComp,
      usedFromRecords: totals.usedFromRecords,
      usedManual: totals.usedManual,
      usedEnjoyed: totals.usedEnjoyed,
      totalUsed: totals.totalUsed,
      available: totals.available
    }
  });
}
