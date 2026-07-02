import { formatHours, truncateDecimal } from "./formatHours";


/**
 * Parse the ATM timesheet Excel data extracted via ExtractDataFromUploadedFile
 * The Excel has a specific structure: rows 37+ contain daily data (0-indexed from the raw sheet)
 */

export function parseTimesheetFromRaw(rawRows) {
  // rawRows is the array from ExtractDataFromUploadedFile
  // Each row should have: date, normal_hours, extra_hours, travel_hours, absence_hours, day_type, etc.
  const records = [];
  
  for (const row of rawRows) {
    if (!row.date) continue;
    
    records.push({
      date: row.date,
      normal_hours: parseFloat(row.normal_hours) || 0,
      extra_hours: parseFloat(row.extra_hours) || 0,
      travel_hours: parseFloat(row.travel_hours) || 0,
      absence_hours: parseFloat(row.absence_hours) || 0,
      day_type: row.day_type || '',
      absence_type: row.absence_type || '',
      project_number: row.project_number || '',
      project_client: row.project_client || '',
      project_description: row.project_description || '',
      period_start: row.period_start || '',
      period_end: row.period_end || '',
      pause_hours: parseFloat(row.pause_hours) || 0,
      observations: row.observations || '',
    });
  }
  
  return records;
}

/**
 * Calculate summary statistics from timesheet records
 */
export function calculateSummary(records, options = {}) {
  let totalWorkedDays = 0;
  let totalNormalHours = 0;
  let totalExtraHours = 0;
  let computedCompensatedHours = 0;
  let totalAbsenceHours = 0;
  let totalTravelHours = 0;
  const absenceDates = new Set();
  const alerts = [];

  for (const r of records) {
    if (r.normal_hours > 0) totalWorkedDays++;
    totalNormalHours += r.normal_hours;
    totalExtraHours += r.extra_hours;
    totalAbsenceHours += r.absence_hours;
    totalTravelHours += r.travel_hours;
    if (Number(r.absence_hours || 0) > 0 && r.date) {
      absenceDates.add(String(r.date).slice(0, 10));
    }
    
    if (r.compensated) {
      computedCompensatedHours += r.normal_hours;
    }
    
    // Alerts
    if (r.normal_hours > 12) {
      alerts.push({ type: 'warning', date: r.date, message: `Horas excessivas: ${r.normal_hours}h` });
    }
    if (r.day_type === 'Desc. Obrig' && r.normal_hours > 0) {
      alerts.push({ type: 'error', date: r.date, message: 'Trabalho em dia de descanso obrigatório' });
    }
    if (r.day_type === 'Feriado' && r.normal_hours > 0) {
      alerts.push({ type: 'warning', date: r.date, message: 'Trabalho em feriado' });
    }
  }

  const compensationTotalHours =
    typeof options?.compensationTotalHours === "number" && Number.isFinite(options.compensationTotalHours)
      ? options.compensationTotalHours
      : null;

  const compensationUsedOverride =
    typeof options?.compensationUsedHours === "number" && Number.isFinite(options.compensationUsedHours)
      ? options.compensationUsedHours
      : null;

  const totalCompensatedHours = compensationUsedOverride != null ? compensationUsedOverride : computedCompensatedHours;

  const totalPool = compensationTotalHours != null ? compensationTotalHours : totalExtraHours;
  const rawBank = totalPool - totalCompensatedHours;
  // rawBank can be negative when the employee used more hours than available (debt)
  const hourBank = Math.max(0, rawBank);
  const debtHours = rawBank < 0 ? Math.abs(rawBank) : 0;
  const totalCompensationHours = hourBank + totalCompensatedHours;
  const totalAbsenceDays = absenceDates.size;
  
  if (debtHours > 0) {
    alerts.push({
      type: "warning",
      date: "-",
      message: `Tem ${formatHours(debtHours)}h em dívida (horas antecipadas pela empresa que ainda não acumulou).`
    });
  }

  return {
    totalWorkedDays,
    totalNormalHours,
    totalExtraHours,
    totalCompensatedHours,
    totalCompensationHours,
    compensationUsedHours: totalCompensatedHours,
    compensationAvailableHours: hourBank,
    compensationDebtHours: debtHours,
    totalCompensationDays: totalCompensationHours / 8,
    compensationUsedDays: totalCompensatedHours / 8,
    compensationAvailableDays: hourBank / 8,
    compensationDebtDays: debtHours / 8,
    totalAbsenceHours,
    totalAbsenceDays,
    totalTravelHours,
    hourBank,
    debtHours,
    alerts,
  };
}

/**
 * Build hour bank history (running balance)
 */
export function buildHourBankHistory(records, options = {}) {
  const compensationTotalHours =
    typeof options?.compensationTotalHours === "number" && Number.isFinite(options.compensationTotalHours)
      ? options.compensationTotalHours
      : null;
  const compensationUsedOverride =
    typeof options?.compensationUsedHours === "number" && Number.isFinite(options.compensationUsedHours)
      ? options.compensationUsedHours
      : null;

  // If we have a compensation total, build the chart off compensation consumption only
  // (no dependency on hours extra).
  if (compensationTotalHours != null) {
    let used = 0;
    let computedUsed = 0;

    const history = records.map((r) => {
      const deltaUsed = r.compensated ? Number(r.normal_hours || 0) : 0;
      used += deltaUsed;
      computedUsed += deltaUsed;
      const available = Math.max(0, compensationTotalHours - used);

      return {
        ...r,
        bankBalance: truncateDecimal(available),
        bankStatus: deltaUsed > 0 ? "Gozado" : "Normal"
      };
    });

    if (compensationUsedOverride != null && history.length > 0) {
      const extraUsed = compensationUsedOverride - computedUsed;
      if (Number.isFinite(extraUsed) && extraUsed !== 0) {
        const last = history[history.length - 1];
        history[history.length - 1] = {
          ...last,
          bankBalance: truncateDecimal(Math.max(0, last.bankBalance - extraUsed))
        };
      }
    }

    return history;
  }

  // Fallback: legacy bank-of-hours logic (extras - compensated).
  let balance = 0;
  let computedCompensatedHours = 0;

  const history = records.map((r) => {
    balance += r.extra_hours;
    if (r.compensated) {
      balance -= r.normal_hours;
      computedCompensatedHours += r.normal_hours;
    }

    return {
      ...r,
      bankBalance: truncateDecimal(balance),
      bankStatus: r.extra_hours > 0 ? "Disponível" : r.compensated ? "Gozado" : "Normal"
    };
  });

  if (compensationUsedOverride != null && history.length > 0) {
    const delta = compensationUsedOverride - computedCompensatedHours;
    const last = history[history.length - 1];
    history[history.length - 1] = {
      ...last,
      bankBalance: truncateDecimal(last.bankBalance - delta)
    };
  }

  return history;
}
