import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { calculateSummary } from "@/lib/parseTimesheet";

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

function monthIndex(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const names = monthNames.map((month) => month.toLowerCase());
  const numeric = Number(normalized);
  if (numeric >= 1 && numeric <= 12) return numeric;
  return names.findIndex((month) => month.startsWith(normalized.slice(0, 3))) + 1;
}

export function useAlertCount({ user, refreshKey }) {
  const [records, setRecords] = useState([]);
  const [timesheets, setTimesheets] = useState([]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const selected = localStorage.getItem("atm.selectedTimesheetId");
        const [recordsData, timesheetData] = await Promise.all([
          selected && selected !== "all"
            ? base44.entities.TimesheetRecord.list("-date", 5000, { timesheet_id: selected })
            : base44.entities.TimesheetRecord.list("-date", 5000),
          base44.entities.Timesheet.list(500)
        ]);
        if (!active) return;
        setRecords(Array.isArray(recordsData) ? recordsData : []);
        setTimesheets(Array.isArray(timesheetData) ? timesheetData : []);
      } catch {
        if (!active) return;
        setRecords([]);
        setTimesheets([]);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return useMemo(() => {
    if (records.length === 0) return 0;

    const summary = calculateSummary([...records].sort((a, b) => new Date(a.date) - new Date(b.date)));
    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYear = lastMonthDate.getFullYear();
    const lastMonth = lastMonthDate.getMonth() + 1;
    const profileStartYear = Number(user?.profile?.start_year || 0);
    const startYear = profileStartYear >= 2000 && profileStartYear <= lastYear ? profileStartYear : lastYear;
    const profileStartMonth = Number(user?.profile?.start_month || 1);
    const startMonth = profileStartMonth >= 1 && profileStartMonth <= 12 ? profileStartMonth : 1;
    const existing = new Set(
      timesheets
        .map((timesheet) => {
          const year = Number(timesheet?.year || 0);
          const month = monthIndex(timesheet?.month);
          return year && month ? `${year}-${month}` : "";
        })
        .filter(Boolean)
    );

    let hasMissingMonth = false;
    for (let year = startYear; year <= lastYear && !hasMissingMonth; year += 1) {
      const first = year === startYear ? startMonth : 1;
      const last = year === lastYear ? lastMonth : 12;
      for (let month = first; month <= last; month += 1) {
        if (!existing.has(`${year}-${month}`)) {
          hasMissingMonth = true;
          break;
        }
      }
    }

    return summary.alerts.length + (hasMissingMonth ? 1 : 0);
  }, [records, timesheets, user]);
}
