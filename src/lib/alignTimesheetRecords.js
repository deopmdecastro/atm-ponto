import { buildMonthGrid } from "@/lib/parseTimesheetClient";

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function sortForAlignment(records) {
  return [...records].sort((a, b) => {
    const ad = dateKey(a?.date);
    const bd = dateKey(b?.date);
    if (ad !== bd) return ad.localeCompare(bd);

    const ac = String(a?.created_date || "");
    const bc = String(b?.created_date || "");
    if (ac !== bc) return ac.localeCompare(bc);

    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

/**
 * Legacy imports created before the date parser fix may carry stale Excel
 * formula cache dates (for example 2022 instead of 2026), while still having
 * one row per calendar day in the correct order. When most record dates do not
 * belong to the selected month, realign them to the expected month grid so the
 * UI can preload/edit/display those rows correctly even before a DB backfill.
 */
export function alignRecordsToMonthGrid(records, month, year) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const safeYear = Number(year || 0);
  if (!list.length || !month || !safeYear) return list;

  const grid = buildMonthGrid(month, safeYear);
  if (!Array.isArray(grid) || grid.length === 0) return list;
  if (list.length !== grid.length) return list;

  const expectedDates = grid.map((row) => row.date);
  const expectedSet = new Set(expectedDates);
  const directMatches = list.reduce((acc, record) => acc + (expectedSet.has(dateKey(record?.date)) ? 1 : 0), 0);

  if (directMatches === list.length) return list;
  if (directMatches >= Math.ceil(list.length * 0.6)) return list;

  const sorted = sortForAlignment(list);
  return sorted.map((record, index) => ({
    ...record,
    date: expectedDates[index]
  }));
}
