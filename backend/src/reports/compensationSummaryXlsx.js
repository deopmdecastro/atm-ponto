import { pool } from "../db.js";

function monthIndex(name) {
  const m = String(name || "").trim().toLowerCase();
  const map = {
    jan: 1,
    janeiro: 1,
    fev: 2,
    fevereiro: 2,
    mar: 3,
    "março": 3,
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
  const key = m.slice(0, 3);
  return map[m] || map[key] || 0;
}

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTimesheetManualUsed(ts, usedFromRecords) {
  const total = safeNumber(ts?.total_compensation_hours);
  const manualUsed = safeNumber(ts?.total_descanso_compensatorio_hours);
  const recordsUsed = safeNumber(usedFromRecords);
  const effectiveManualUsed = recordsUsed === 0 && manualUsed === total ? 0 : manualUsed;
  return Math.max(0, effectiveManualUsed);
}

function hexColor(rgbHex) {
  const s = String(rgbHex || "").replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(s)) return s;
  return "000000";
}

function applyHeaderStyle(ws, addr, { fillRgb, fontRgb }) {
  const cell = ws[addr];
  if (!cell) return;
  cell.s = {
    font: { bold: true, color: { rgb: hexColor(fontRgb) } },
    fill: { patternType: "solid", fgColor: { rgb: hexColor(fillRgb) } },
    alignment: { vertical: "center", horizontal: "center", wrapText: true }
  };
}

function applyKeyStyle(ws, addr, { fillRgb, fontRgb }) {
  const cell = ws[addr];
  if (!cell) return;
  cell.s = {
    font: { bold: true, color: { rgb: hexColor(fontRgb) } },
    fill: { patternType: "solid", fgColor: { rgb: hexColor(fillRgb) } },
    alignment: { vertical: "center", horizontal: "left" }
  };
}

function applyNumberStyle(ws, addr) {
  const cell = ws[addr];
  if (!cell) return;
  cell.z = "0.00";
}

function monthKey({ year, month }) {
  const y = Number(year || 0);
  const mi = monthIndex(month);
  if (!y || !mi) return "";
  return `${String(y).padStart(4, "0")}-${String(mi).padStart(2, "0")}`;
}

export async function generateCompensationSummaryXlsx({ userId }) {
  const mod = await import("xlsx");
  const xlsx = mod?.default || mod;
  if (!xlsx?.utils?.aoa_to_sheet || !xlsx?.write) {
    throw new Error("xlsx module loaded but missing expected exports");
  }

  const { rows: timesheets } = await pool.query(
    `
    SELECT *
    FROM timesheets
    WHERE user_id = $1
    ORDER BY created_date ASC
    `,
    [userId]
  );

  const { rows: recordAgg } = await pool.query(
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

  const { rows: enjoyments } = await pool.query(
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
  for (const e of enjoyments) {
    const iso = e?.enjoy_date ? String(e.enjoy_date).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const key = iso.slice(0, 7);
    enjoymentsByMonthKey.set(key, (enjoymentsByMonthKey.get(key) || 0) + safeNumber(e.hours));
  }

  const rowsByMonth = timesheets
    .map((ts) => {
      const tsId = String(ts?.id || "");
      const agg = aggByTimesheetId.get(tsId) || { normal: 0, extra: 0, travel: 0, absence: 0, usedFromRecords: 0 };
      const manualUsed = normalizeTimesheetManualUsed(ts, agg.usedFromRecords);
      const enjoyed = enjoymentsByMonthKey.get(monthKey(ts)) || 0;
      const totalComp = safeNumber(ts?.total_compensation_hours);
      const totalUsed = Math.max(0, agg.usedFromRecords + manualUsed + enjoyed);
      const available = Math.max(0, totalComp - totalUsed);

      return {
        month: String(ts?.month || "").trim(),
        year: ts?.year != null ? Number(ts.year) : null,
        employee_name: ts?.employee_name || "",
        employee_number: ts?.employee_number || "",
        department: ts?.department || "",
        normal: agg.normal,
        extra: agg.extra,
        travel: agg.travel,
        absence: agg.absence,
        totalComp,
        usedFromRecords: agg.usedFromRecords,
        usedManual: manualUsed,
        usedEnjoyed: enjoyed,
        totalUsed,
        available
      };
    })
    .sort((a, b) => {
      const ay = Number(a?.year || 0);
      const by = Number(b?.year || 0);
      if (ay !== by) return ay - by;
      return monthIndex(a?.month) - monthIndex(b?.month);
    });

  const totals = rowsByMonth.reduce(
    (acc, r) => {
      acc.normal += safeNumber(r.normal);
      acc.extra += safeNumber(r.extra);
      acc.travel += safeNumber(r.travel);
      acc.absence += safeNumber(r.absence);
      acc.totalComp += safeNumber(r.totalComp);
      acc.usedFromRecords += safeNumber(r.usedFromRecords);
      acc.usedManual += safeNumber(r.usedManual);
      acc.usedEnjoyed += safeNumber(r.usedEnjoyed);
      return acc;
    },
    { normal: 0, extra: 0, travel: 0, absence: 0, totalComp: 0, usedFromRecords: 0, usedManual: 0, usedEnjoyed: 0 }
  );
  totals.totalUsed = Math.max(0, totals.usedFromRecords + totals.usedManual + totals.usedEnjoyed);
  totals.available = Math.max(0, totals.totalComp - totals.totalUsed);

  const first = rowsByMonth[0] || null;
  const employeeName = first?.employee_name || "Colaborador";
  const employeeNumber = first?.employee_number || "";
  const department = first?.department || "";
  const periodStart =
    rowsByMonth.length > 0 ? `${rowsByMonth[0].month} ${rowsByMonth[0].year || ""}`.trim() : "";
  const periodEnd =
    rowsByMonth.length > 0 ? `${rowsByMonth[rowsByMonth.length - 1].month} ${rowsByMonth[rowsByMonth.length - 1].year || ""}`.trim() : "";
  const period = periodStart && periodEnd ? (periodStart === periodEnd ? periodStart : `${periodStart} - ${periodEnd}`) : "";
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  // ATM theme (based on CSS vars: --primary: hsl(0 78% 52%), --accent: hsl(0 65% 96%))
  const ATM_PRIMARY = "D61F3C";
  const ATM_ACCENT = "FDECEF";
  const WHITE = "FFFFFF";
  const DARK = "111111";

  const wb = xlsx.utils.book_new();

  const resumoAoa = [
    ["ATM - Resumo de Horas"],
    [""],
    ["Colaborador", employeeName],
    ["Nº", employeeNumber],
    ["Departamento", department],
    ["Período", period],
    ["Gerado em", generatedAt],
    [""],
    ["Totais (todos os meses)", ""],
    ["Horas normais", totals.normal],
    ["Horas extra", totals.extra],
    ["Horas viagem", totals.travel],
    ["Horas ausência", totals.absence],
    [""],
    ["Banco de horas (compensação)", ""],
    ["Compensadas (total)", totals.totalComp],
    ["Gozadas (registos)", totals.usedFromRecords],
    ["Gozadas (manuais)", totals.usedManual],
    ["Gozadas (lançadas)", totals.usedEnjoyed],
    ["Gozadas (total)", totals.totalUsed],
    ["Disponíveis", totals.available]
  ];

  const wsResumo = xlsx.utils.aoa_to_sheet(resumoAoa);
  wsResumo["!cols"] = [{ wch: 28 }, { wch: 45 }];

  // Merge title
  wsResumo["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  applyHeaderStyle(wsResumo, "A1", { fillRgb: ATM_PRIMARY, fontRgb: WHITE });
  applyHeaderStyle(wsResumo, "B1", { fillRgb: ATM_PRIMARY, fontRgb: WHITE });

  // Section headers (merge across both columns)
  wsResumo["!merges"].push({ s: { r: 8, c: 0 }, e: { r: 8, c: 1 } });
  wsResumo["!merges"].push({ s: { r: 14, c: 0 }, e: { r: 14, c: 1 } });
  applyHeaderStyle(wsResumo, "A9", { fillRgb: ATM_PRIMARY, fontRgb: WHITE });
  applyHeaderStyle(wsResumo, "B9", { fillRgb: ATM_PRIMARY, fontRgb: WHITE });
  applyHeaderStyle(wsResumo, "A15", { fillRgb: ATM_PRIMARY, fontRgb: WHITE });
  applyHeaderStyle(wsResumo, "B15", { fillRgb: ATM_PRIMARY, fontRgb: WHITE });

  // Key column style
  for (let r = 2; r < resumoAoa.length; r++) {
    const addr = `A${r + 1}`;
    if (resumoAoa[r]?.[0]) applyKeyStyle(wsResumo, addr, { fillRgb: ATM_ACCENT, fontRgb: DARK });
  }

  // Number formatting
  for (const rowIndex of [9, 10, 11, 12, 15, 16, 17, 18, 19, 20]) {
    applyNumberStyle(wsResumo, `B${rowIndex + 1}`);
  }

  xlsx.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const header = [
    "Mês",
    "Ano",
    "Normais (h)",
    "Extra (h)",
    "Viagem (h)",
    "Ausência (h)",
    "Compensadas (total)",
    "Gozadas (registos)",
    "Gozadas (manuais)",
    "Gozadas (lançadas)",
    "Gozadas (total)",
    "Disponíveis"
  ];

  const mesesAoa = [
    header,
    ...rowsByMonth.map((r) => [
      r.month,
      r.year,
      Number(r.normal.toFixed(2)),
      Number(r.extra.toFixed(2)),
      Number(r.travel.toFixed(2)),
      Number(r.absence.toFixed(2)),
      Number(r.totalComp.toFixed(2)),
      Number(r.usedFromRecords.toFixed(2)),
      Number(r.usedManual.toFixed(2)),
      Number(r.usedEnjoyed.toFixed(2)),
      Number(r.totalUsed.toFixed(2)),
      Number(r.available.toFixed(2))
    ])
  ];

  const wsMeses = xlsx.utils.aoa_to_sheet(mesesAoa);
  wsMeses["!cols"] = [
    { wch: 14 },
    { wch: 6 },
    { wch: 12 },
    { wch: 10 },
    { wch: 11 },
    { wch: 11 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 }
  ];

  // Style header row (row 1)
  for (let c = 0; c < header.length; c++) {
    const addr = xlsx.utils.encode_cell({ r: 0, c });
    applyHeaderStyle(wsMeses, addr, { fillRgb: ATM_PRIMARY, fontRgb: WHITE });
  }

  // Number format columns C..L
  for (let r = 1; r < mesesAoa.length; r++) {
    for (let c = 2; c < header.length; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      applyNumberStyle(wsMeses, addr);
    }
  }

  xlsx.utils.book_append_sheet(wb, wsMeses, "Por Mês");

  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  return Buffer.from(buf);
}
