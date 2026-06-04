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

// Trunca para 2 casas decimais SEM arredondar.
// Ex: 1.239 -> 1.23 (não 1.24)
function truncate2(value) {
  const number = safeNumber(value);
  return Math.trunc(number * 100) / 100;
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

function formatDate(value, includeTime = false) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const formattedDate = `${byType.day}/${byType.month}/${byType.year}`;
  return includeTime ? `${formattedDate} ${byType.hour}:${byType.minute}` : formattedDate;
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
    B18: values.totalUsed,
    B19: values.available
  };

  for (const [address, value] of Object.entries(stringCells)) {
    nextXml = replaceCell(nextXml, address, makeStringCell(address, getCellStyle(xml, address, "5"), value));
  }
  for (const [address, value] of Object.entries(numberCells)) {

    nextXml = replaceCell(
      nextXml,
      address,
      makeNumberCell(address, getCellStyle(xml, address, "7"), truncate2(value))
    );

  }
  const summaryRows = [
    `<row r="18" spans="1:2" ht="15" customHeight="1" x14ac:dyDescent="0.2">${makeStringCell(
      "A18",
      getCellStyle(xml, "A21", "4"),
      "Gozadas (total)"
    )}${makeNumberCell("B18", getCellStyle(xml, "B21", "7"), truncate2(values.totalUsed))}</row>`,
    `<row r="19" spans="1:2" ht="15" customHeight="1" x14ac:dyDescent="0.2">${makeStringCell(
      "A19",
      getCellStyle(xml, "A22", "4"),
      "Disponíveis"
    )}${makeNumberCell("B19", getCellStyle(xml, "B22", "8"), truncate2(values.available))}</row>`
  ].join("");
  nextXml = nextXml.replace(
    /<row\b[^>]*\br="18"[^>]*>[\s\S]*?<\/row>[\s\S]*?<row\b[^>]*\br="22"[^>]*>[\s\S]*?<\/row>/,
    summaryRows
  );
  nextXml = updateSheetRange(nextXml, "A1:B19");
  nextXml = updateIgnoredErrorsRange(nextXml, "A1:B19");
  return nextXml;
}

function patchPorMesXml(xml, rowsByMonth) {
  const headerRow = xml.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/)?.[0];
  if (!headerRow) throw new Error("Template Excel inválido: aba Por Mês sem cabeçalho.");

  const stringStyle = getCellStyle(xml, "A2", "10");
  const yearStyle = getCellStyle(xml, "B2", "10");
  const numberStyle = getCellStyle(xml, "C2", "11");
  const headerStyle = getCellStyle(xml, "A1", "9");
  const simplifiedHeaderRow = `<row r="1" spans="1:9" ht="26.1" customHeight="1" x14ac:dyDescent="0.2">${[
    "Mês",
    "Ano",
    "Horas normais",
    "Horas extra",
    "Horas viagem",
    "Horas ausência",
    "Compensadas (total)",
    "Gozadas (total)",
    "Disponíveis"
  ]
    .map((value, index) => makeStringCell(`${columnName(index)}1`, headerStyle, value))
    .join("")}</row>`;
  const dataRows = rowsByMonth.map((row, index) => {
    const rowNumber = index + 2;
    const values = [
      row.month,
      row.year,
      truncate2(row.normal),
      truncate2(row.extra),
      truncate2(row.travel),
      truncate2(row.absence),
      truncate2(row.totalComp),
      truncate2(row.totalUsed),
      truncate2(row.available)
    ];

    const cells = values
      .map((value, colIndex) => {
        const address = cellAddress(rowNumber - 1, colIndex);
        if (colIndex === 0) return makeStringCell(address, stringStyle, value);
        if (colIndex === 1) return makeNumberCell(address, yearStyle, value);
        return makeNumberCell(address, numberStyle, value);
      })
      .join("");
    return `<row r="${rowNumber}" spans="1:9" x14ac:dyDescent="0.2">${cells}</row>`;
  });

  const lastRow = Math.max(1, rowsByMonth.length + 1);
  let nextXml = xml.replace(
    /<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData>${simplifiedHeaderRow}${dataRows.join("")}</sheetData>`
  );
  nextXml = updateSheetRange(nextXml, `A1:I${lastRow}`);
  nextXml = updateIgnoredErrorsRange(nextXml, `A1:I${lastRow}`);
  return nextXml;
}

function makeHorasGozadasXml(enjoyments) {
  const rows = enjoyments.map((row, index) => {
    const rowNumber = index + 4;
    return `<row r="${rowNumber}" spans="1:4" x14ac:dyDescent="0.2">${makeStringCell(
      `A${rowNumber}`,
      "10",
      formatDate(row.created_date, true)
    )}${makeStringCell(`B${rowNumber}`, "10", formatDate(row.enjoy_date))}${makeNumberCell(
      `C${rowNumber}`,
      "11",
      truncate2(row.hours)
    )}${makeStringCell(`D${rowNumber}`, "10", row.reason || "")}</row>`;
  });
  const totalRowNumber = enjoyments.length === 0 ? 5 : enjoyments.length + 4;
  const totalHours = enjoyments.reduce((total, row) => total + safeNumber(row.hours), 0);
  const emptyRow =
    enjoyments.length === 0
      ? `<row r="4" spans="1:4" x14ac:dyDescent="0.2">${makeStringCell("A4", "10", "Sem horas gozadas registadas.")}</row>`
      : "";
  const totalRow = `<row r="${totalRowNumber}" spans="1:4" ht="20" customHeight="1" x14ac:dyDescent="0.2">${makeStringCell(
    `A${totalRowNumber}`,
    "9",
    "Total"
  )}${makeStringCell(`B${totalRowNumber}`, "9", "")}${makeNumberCell(
    `C${totalRowNumber}`,
    "9",
    truncate2(totalHours)
  )}${makeStringCell(`D${totalRowNumber}`, "9", "")}</row>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">
<dimension ref="A1:D${totalRowNumber}"/>
<sheetViews><sheetView workbookViewId="0"><selection activeCell="A4" sqref="A4:D4"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.2"/>
<cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="55" customWidth="1"/></cols>
<sheetData>
<row r="1" spans="1:4" ht="32.1" customHeight="1" x14ac:dyDescent="0.45">${makeStringCell("A1", "12", "ATM Ponto")}</row>
<row r="2" spans="1:4" ht="20.1" customHeight="1" x14ac:dyDescent="0.2">${makeStringCell("A2", "13", "Horas Gozadas")}</row>
<row r="3" spans="1:4" ht="26.1" customHeight="1" x14ac:dyDescent="0.2">${["Criado em", "Data gozada", "Horas", "Motivo"]
    .map((value, index) => makeStringCell(`${columnName(index)}3`, "9", value))
    .join("")}</row>
${rows.join("")}${emptyRow}${totalRow}
</sheetData>
<mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A2:D2"/></mergeCells>
<pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/>
<ignoredErrors><ignoredError sqref="A1:D${totalRowNumber}" numberStoredAsText="1"/></ignoredErrors>
</worksheet>`;
}

function addHorasGozadasSheet(archive, enjoyments) {
  archive["xl/worksheets/sheet3.xml"] = strToU8(makeHorasGozadasXml(enjoyments));

  const workbookXml = strFromU8(archive["xl/workbook.xml"]).replace(
    "</sheets>",
    '<sheet name="Horas Gozadas" sheetId="3" r:id="rId6"/></sheets>'
  );
  archive["xl/workbook.xml"] = strToU8(workbookXml);

  const relationshipsXml = strFromU8(archive["xl/_rels/workbook.xml.rels"]).replace(
    "</Relationships>",
    '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'
  );
  archive["xl/_rels/workbook.xml.rels"] = strToU8(relationshipsXml);

  const contentTypesXml = strFromU8(archive["[Content_Types].xml"]).replace(
    "</Types>",
    '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  );
  archive["[Content_Types].xml"] = strToU8(contentTypesXml);

  const appPropertiesXml = strFromU8(archive["docProps/app.xml"])
    .replace("<vt:i4>2</vt:i4>", "<vt:i4>3</vt:i4>")
    .replace(
      '<TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Resumo</vt:lpstr><vt:lpstr>Por Mês</vt:lpstr></vt:vector></TitlesOfParts>',
      '<TitlesOfParts><vt:vector size="3" baseType="lpstr"><vt:lpstr>Resumo</vt:lpstr><vt:lpstr>Por Mês</vt:lpstr><vt:lpstr>Horas Gozadas</vt:lpstr></vt:vector></TitlesOfParts>'
    );
  archive["docProps/app.xml"] = strToU8(appPropertiesXml);
}

function patchTemplateWorkbook({ templateFile, rowsByMonth, summaryValues, enjoyments }) {
  const archive = unzipSync(fs.readFileSync(templateFile));
  archive["xl/worksheets/sheet1.xml"] = strToU8(
    patchResumoXml(strFromU8(archive["xl/worksheets/sheet1.xml"]), summaryValues)
  );
  archive["xl/worksheets/sheet2.xml"] = strToU8(
    patchPorMesXml(strFromU8(archive["xl/worksheets/sheet2.xml"]), rowsByMonth)
  );
  addHorasGozadasSheet(archive, enjoyments);
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
    SELECT created_date, enjoy_date, hours, reason
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
    enjoyments,
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
