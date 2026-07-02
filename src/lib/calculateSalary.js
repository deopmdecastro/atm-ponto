import { truncateDecimal } from "./formatHours";

export const DEFAULT_SALARY_CONFIG = {
  defaults: {
    base_salary: 1000,
    meal_subsidy_daily: 10.46,
    extra_hour_rate: 11.25,
    irs_rate_percent: 3.5,
    ss_rate_percent: 11
  },
  months: {}
};

const monthAbbrevIndex = {
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

export function monthNameToIndex(name) {
  const m = String(name || "").trim().toLowerCase();
  const key = m.slice(0, 3);
  return monthAbbrevIndex[m] || monthAbbrevIndex[key] || 0;
}

/**
 * Builds the "YYYY-M" key used to store/read month-specific salary overrides.
 * Accepts either a Timesheet-like object ({year, month}) or explicit (year, month) args.
 */
export function salaryMonthKey(yearOrTimesheet, monthMaybe) {
  if (yearOrTimesheet && typeof yearOrTimesheet === "object") {
    const y = Number(yearOrTimesheet.year || 0);
    const m = monthNameToIndex(yearOrTimesheet.month);
    if (!y || !m) return "";
    return `${y}-${m}`;
  }
  const y = Number(yearOrTimesheet || 0);
  const m = Number(monthMaybe || 0);
  if (!y || !m) return "";
  return `${y}-${m}`;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Merges the global defaults with any override stored for a specific month.
 */
export function resolveMonthSalaryConfig(config, monthKey) {
  const defaults = { ...DEFAULT_SALARY_CONFIG.defaults, ...(config?.defaults || {}) };
  const override = (config?.months && config.months[monthKey]) || {};

  return {
    base_salary: toNumber(override.base_salary, defaults.base_salary),
    meal_subsidy_daily: toNumber(override.meal_subsidy_daily, defaults.meal_subsidy_daily),
    extra_hour_rate: toNumber(override.extra_hour_rate, defaults.extra_hour_rate),
    irs_rate_percent: toNumber(override.irs_rate_percent, defaults.irs_rate_percent),
    ss_rate_percent: toNumber(override.ss_rate_percent, defaults.ss_rate_percent),
    vacation_subsidy_amount: toNumber(override.vacation_subsidy_amount, 0),
    christmas_subsidy_amount: toNumber(override.christmas_subsidy_amount, 0)
  };
}

/**
 * Computes an estimated payslip breakdown for a single month, based on the
 * timesheet records of that month and the salary configuration.
 *
 * This is an approximation ("mais ou menos") of the real payroll calculation:
 * - Base salary comes straight from config (it does not derive from hours).
 * - Meal subsidy = worked days (days with normal_hours > 0) x daily rate.
 * - Extra hours amount = sum(extra_hours) x hourly rate.
 * - IRS/SS are applied as flat percentages over (base + extra hours amount),
 *   mirroring the "Incidência" columns seen on the real payslips.
 * - Subsídio de férias / Natal are manual entries (config) since they are not
 *   derivable from a timesheet.
 */
export function calculateSalaryForRecords(records, config, monthKey) {
  const cfg = resolveMonthSalaryConfig(config, monthKey);
  const list = Array.isArray(records) ? records : [];

  const workedDates = new Set();
  let extraHours = 0;
  for (const r of list) {
    if (toNumber(r?.normal_hours) > 0 && r?.date) {
      workedDates.add(String(r.date).slice(0, 10));
    }
    extraHours += toNumber(r?.extra_hours);
  }

  const workedDays = workedDates.size;
  const baseSalary = cfg.base_salary;
  const mealSubsidy = truncateDecimal(workedDays * cfg.meal_subsidy_daily);
  const extraHoursAmount = truncateDecimal(extraHours * cfg.extra_hour_rate);
  const vacationSubsidyAmount = truncateDecimal(cfg.vacation_subsidy_amount);
  const christmasSubsidyAmount = truncateDecimal(cfg.christmas_subsidy_amount);

  const taxableIncome = baseSalary + extraHoursAmount;
  const irsAmount = truncateDecimal((taxableIncome * cfg.irs_rate_percent) / 100);
  const ssAmount = truncateDecimal((taxableIncome * cfg.ss_rate_percent) / 100);

  const extraTaxableIncome = vacationSubsidyAmount + christmasSubsidyAmount;
  const irsExtraAmount = truncateDecimal((extraTaxableIncome * cfg.irs_rate_percent) / 100);
  const ssExtraAmount = truncateDecimal((extraTaxableIncome * cfg.ss_rate_percent) / 100);

  const grossTotal = truncateDecimal(baseSalary + extraHoursAmount + mealSubsidy + vacationSubsidyAmount + christmasSubsidyAmount);
  const totalDeductions = truncateDecimal(irsAmount + ssAmount + irsExtraAmount + ssExtraAmount);
  const netTotal = truncateDecimal(grossTotal - totalDeductions);

  return {
    workedDays,
    extraHours: truncateDecimal(extraHours),
    baseSalary,
    mealSubsidy,
    extraHoursAmount,
    vacationSubsidyAmount,
    christmasSubsidyAmount,
    irsAmount: truncateDecimal(irsAmount + irsExtraAmount),
    ssAmount: truncateDecimal(ssAmount + ssExtraAmount),
    grossTotal,
    totalDeductions,
    netTotal,
    config: cfg
  };
}

/**
 * Aggregates the salary estimate across a list of timesheets (one entry per month).
 * `recordsByTimesheetId` should be a Map<timesheetId, records[]>.
 */
export function aggregateSalary(timesheets, recordsByTimesheetId, config) {
  const list = Array.isArray(timesheets) ? timesheets : [];
  const byMonth = list
    .map((ts) => {
      const monthKey = salaryMonthKey(ts);
      const records = recordsByTimesheetId?.get(ts.id) || [];
      const breakdown = calculateSalaryForRecords(records, config, monthKey);
      return {
        timesheetId: ts.id,
        monthKey,
        label: `${ts.month || ""} ${ts.year || ""}`.trim(),
        year: Number(ts.year || 0),
        monthIndex: monthNameToIndex(ts.month),
        ...breakdown
      };
    })
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.monthIndex - b.monthIndex));

  const totals = byMonth.reduce(
    (acc, m) => ({
      workedDays: acc.workedDays + m.workedDays,
      extraHours: truncateDecimal(acc.extraHours + m.extraHours),
      baseSalary: truncateDecimal(acc.baseSalary + m.baseSalary),
      mealSubsidy: truncateDecimal(acc.mealSubsidy + m.mealSubsidy),
      extraHoursAmount: truncateDecimal(acc.extraHoursAmount + m.extraHoursAmount),
      vacationSubsidyAmount: truncateDecimal(acc.vacationSubsidyAmount + m.vacationSubsidyAmount),
      christmasSubsidyAmount: truncateDecimal(acc.christmasSubsidyAmount + m.christmasSubsidyAmount),
      irsAmount: truncateDecimal(acc.irsAmount + m.irsAmount),
      ssAmount: truncateDecimal(acc.ssAmount + m.ssAmount),
      grossTotal: truncateDecimal(acc.grossTotal + m.grossTotal),
      totalDeductions: truncateDecimal(acc.totalDeductions + m.totalDeductions),
      netTotal: truncateDecimal(acc.netTotal + m.netTotal)
    }),
    {
      workedDays: 0,
      extraHours: 0,
      baseSalary: 0,
      mealSubsidy: 0,
      extraHoursAmount: 0,
      vacationSubsidyAmount: 0,
      christmasSubsidyAmount: 0,
      irsAmount: 0,
      ssAmount: 0,
      grossTotal: 0,
      totalDeductions: 0,
      netTotal: 0
    }
  );

  return { totals, byMonth };
}
