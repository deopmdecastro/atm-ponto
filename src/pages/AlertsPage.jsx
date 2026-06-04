 

import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import AlertsList from "../components/dashboard/AlertsList";
import { calculateSummary } from "../lib/parseTimesheet";

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

export default function AlertsPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const selected = localStorage.getItem("atm.selectedTimesheetId");
    const [recordsData, timesheetData] = await Promise.all([
      selected && selected !== "all"
        ? base44.entities.TimesheetRecord.list("-date", 5000, { timesheet_id: selected })
        : base44.entities.TimesheetRecord.list("-date", 5000),
      base44.entities.Timesheet.list(500)
    ]);
    setRecords(recordsData);
    setTimesheets(Array.isArray(timesheetData) ? timesheetData : []);
    setLoading(false);
  }

  const missingMonthAlerts = useMemo(() => {
    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYear = lastMonthDate.getFullYear();
    const lastMonth = lastMonthDate.getMonth() + 1;
    const profileStartYear = Number(user?.profile?.start_year || 0);
    const startYear = profileStartYear >= 2000 && profileStartYear <= lastYear ? profileStartYear : lastYear;
    const profileStartMonth = Number(user?.profile?.start_month || 1);
    const startMonth = profileStartMonth >= 1 && profileStartMonth <= 12 ? profileStartMonth : 1;

    const existingKeys = new Set(
      timesheets
        .map((ts) => {
          const year = Number(ts?.year || 0);
          const month = monthIndex(ts?.month);
          return year && month ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` : "";
        })
        .filter(Boolean)
    );
    const missingKeys = [];

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

    for (let year = startYear; year <= lastYear; year++) {
      const monthStart = year === startYear ? startMonth : 1;
      const monthLimit = year === lastYear ? lastMonth : 12;
      for (let month = monthStart; month <= monthLimit; month++) {
        const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
        if (!existingKeys.has(key)) missingKeys.push(key);
      }
    }

    if (missingKeys.length === 0) return [];

    const preview = missingKeys.slice(0, 4).map((key) => {
      const [year, month] = key.split("-");
      return `${monthNames[Number(month) - 1]} ${year}`;
    });

    const message =
      missingKeys.length <= 4
        ? `Faltam os Timesheets de: ${preview.join(", ")}.`
        : `Faltam ${missingKeys.length} meses de Timesheet desde ${monthNames[startMonth - 1]} ${startYear}: ${preview.join(", ")} e mais ${missingKeys.length - 4}.`;

    return [
      {
        type: "warning",
        date: "-",
        message
      }
    ];
  }, [timesheets, user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-muted-foreground mb-4">Sem dados. Importe uma folha de ponto primeiro.</p>
        <Button asChild>
          <Link to="/upload"><Upload className="h-4 w-4 mr-2" />Importar</Link>
        </Button>
      </div>
    );
  }

  const sorted = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
  const summary = calculateSummary(sorted);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Alertas</h2>
        <p className="text-sm text-muted-foreground">Inconsistências e avisos identificados nos registros</p>
      </div>
      <AlertsList alerts={[...summary.alerts, ...missingMonthAlerts]} />
    </div>
  );
}
