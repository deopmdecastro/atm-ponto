 

import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import SummaryCards from "../components/dashboard/SummaryCards";
import HourBankChart from "../components/dashboard/HourBankChart";
import EmployeeInfo from "../components/dashboard/EmployeeInfo";
import HourBankSummary from "../components/dashboard/HourBankSummary";
import AlertsList from "../components/dashboard/AlertsList";
import { calculateSummary, buildHourBankHistory } from "../lib/parseTimesheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Dashboard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeInfo, setEmployeeInfo] = useState(null);
  const [timesheets, setTimesheets] = useState([]);
  const [selectedTimesheetId, setSelectedTimesheetId] = useState("all");

  function buildAllEmployeeInfo(ts) {
    const list = Array.isArray(ts) ? ts : [];
    if (list.length === 0) return { name: "Todos os timesheets", number: "", department: "", period: "" };

    const uniq = (values) => [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
    const names = uniq(list.map((t) => t?.employee_name));
    const numbers = uniq(list.map((t) => t?.employee_number));
    const departments = uniq(list.map((t) => t?.department));

    const sorted = list
      .slice()
      .sort((a, b) => {
        const ay = Number(a?.year || 0);
        const by = Number(b?.year || 0);
        if (ay !== by) return ay - by;
        return monthIndex(a?.month) - monthIndex(b?.month);
      })
      .filter((t) => t?.month && t?.year);

    const firstLabel = sorted.length > 0 ? `${sorted[0].month} ${sorted[0].year}`.trim() : "";
    const lastLabel =
      sorted.length > 0 ? `${sorted[sorted.length - 1].month} ${sorted[sorted.length - 1].year}`.trim() : "";
    const period = firstLabel && lastLabel ? (firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`) : "";

    return {
      name: names.length === 1 ? names[0] : names.length > 1 ? `Vários colaboradores (${names.length})` : "Todos os timesheets",
      number: numbers.length === 1 ? numbers[0] : numbers.length > 1 ? `${numbers.length} colaboradores` : "",
      department: departments.length === 1 ? departments[0] : "",
      period
    };
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const hasTimesheets = typeof base44.entities?.Timesheet?.list === "function";
    if (!hasTimesheets) {
      const data = await base44.entities.TimesheetRecord.list("-date", 5000);
      setRecords(data);
      if (data.length > 0) {
        setEmployeeInfo({
          name: data[0].employee_name,
          number: data[0].employee_number,
          department: data[0].observations || "",
          period: `${data[0].month || ""}/${data[0].year || ""}`
        });
      }
      setLoading(false);
      return;
    }

    const ts = await base44.entities.Timesheet.list(100);
    setTimesheets(ts);

    const saved = localStorage.getItem("atm.selectedTimesheetId");
    const defaultId = saved || "all";
    setSelectedTimesheetId(defaultId);

    const data =
      defaultId === "all"
        ? await base44.entities.TimesheetRecord.list("-date", 5000)
        : await base44.entities.TimesheetRecord.list("-date", 5000, { timesheet_id: defaultId });

    setRecords(data);

    if (defaultId === "all") {
      setEmployeeInfo(buildAllEmployeeInfo(ts));
    } else {
      const meta = ts.find((t) => t.id === defaultId);
      setEmployeeInfo({
        name: meta?.employee_name || "Desconhecido",
        number: meta?.employee_number || "",
        department: meta?.department || "",
        period: `${meta?.month || ""}/${meta?.year || ""}`
      });
    }
    setLoading(false);
  }

  async function handleTimesheetChange(id) {
    setSelectedTimesheetId(id);
    localStorage.setItem("atm.selectedTimesheetId", id);

    setLoading(true);
    const data =
      id === "all"
        ? await base44.entities.TimesheetRecord.list("-date", 5000)
        : await base44.entities.TimesheetRecord.list("-date", 5000, { timesheet_id: id });

    setRecords(data);

    if (id === "all") {
      setEmployeeInfo(buildAllEmployeeInfo(timesheets));
    } else {
      const meta = timesheets.find((t) => t.id === id);
      setEmployeeInfo({
        name: meta?.employee_name || "Desconhecido",
        number: meta?.employee_number || "",
        department: meta?.department || "",
        period: `${meta?.month || ""}/${meta?.year || ""}`
      });
    }

    setLoading(false);
  }

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
        <div className="h-20 w-20 rounded-3xl bg-accent flex items-center justify-center mb-6">
          <FileSpreadsheet className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Sem dados importados</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          Faça upload da sua folha de ponto Excel para visualizar o dashboard completo com resumo, gráficos e histórico.
        </p>
        <Button asChild size="lg" className="gap-2">
          <Link to="/upload">
            <Upload className="h-4 w-4" />
            Importar Folha de Ponto
          </Link>
        </Button>
      </div>
    );
  }

  const sortedRecords = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
  const selectedMeta =
    selectedTimesheetId !== "all" ? timesheets.find((t) => t.id === selectedTimesheetId) : null;

  const usedByTimesheetId = new Map();
  for (const r of sortedRecords) {
    const tsId = r?.timesheet_id;
    if (!tsId) continue;
    if (!r?.compensated) continue;
    const delta = Number(r.normal_hours || 0);
    if (!Number.isFinite(delta) || delta <= 0) continue;
    usedByTimesheetId.set(tsId, (usedByTimesheetId.get(tsId) || 0) + delta);
  }

  function normalizeTimesheetManualUsed(ts, usedFromRecords) {
    const total = Number(ts?.total_compensation_hours || 0);
    const manualUsed = Number(ts?.total_descanso_compensatorio_hours || 0);
    const recordsUsed = Number(usedFromRecords || 0);
    // Backwards compatibility: old imports set manualUsed == total (it was actually the pool, not "used").
    const effectiveManualUsed = recordsUsed === 0 && manualUsed === total ? 0 : manualUsed;
    return Math.max(0, effectiveManualUsed);
  }

  function normalizeTimesheetUsed(ts, usedFromRecords) {
    const recordsUsed = Number(usedFromRecords || 0);
    const manualUsed = normalizeTimesheetManualUsed(ts, recordsUsed);
    return Math.max(0, recordsUsed + manualUsed);
  }

  const scopeTimesheets = selectedMeta ? [selectedMeta] : timesheets;
  const compensationTotalHours = scopeTimesheets.reduce((acc, ts) => acc + Number(ts?.total_compensation_hours || 0), 0);
  const compensationUsedHours = scopeTimesheets.reduce(
    (acc, ts) => acc + normalizeTimesheetUsed(ts, usedByTimesheetId.get(ts?.id) || 0),
    0
  );

  const summary = calculateSummary(sortedRecords, {
    compensationTotalHours,
    compensationUsedHours
  });

  const dailyHistory = buildHourBankHistory(sortedRecords, {
    compensationTotalHours: selectedMeta ? Number(selectedMeta?.total_compensation_hours || 0) : null,
    compensationUsedHours: selectedMeta
      ? normalizeTimesheetUsed(selectedMeta, usedByTimesheetId.get(selectedMeta?.id) || 0)
      : null
  });

  function toDayLabel(iso) {
    const s = String(iso || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
    return s;
  }

  function monthIndex(name) {
    const m = String(name || "").trim().toLowerCase();
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
    const key = m.slice(0, 3);
    return map[m] || map[key] || 0;
  }

  const chartData = selectedMeta
    ? dailyHistory.map((h) => ({ label: toDayLabel(h.date), saldo: h.bankBalance }))
    : [...timesheets]
        .slice()
        .sort((a, b) => {
          const ay = Number(a?.year || 0);
          const by = Number(b?.year || 0);
          if (ay !== by) return ay - by;
          return monthIndex(a?.month) - monthIndex(b?.month);
        })
        .reduce((acc, ts) => {
          const last = acc.length > 0 ? acc[acc.length - 1] : null;
          const prevTotal = last ? last._total : 0;
          const prevUsed = last ? last._used : 0;
          const total = prevTotal + Number(ts?.total_compensation_hours || 0);
          const used = prevUsed + normalizeTimesheetUsed(ts, usedByTimesheetId.get(ts?.id) || 0);
          const available = Math.max(0, total - used);
          acc.push({
            label: `${ts.month} ${ts.year}`.trim(),
            saldo: Number(available.toFixed(2)),
            _total: total,
            _used: used
          });
          return acc;
        }, [])
        .map(({ label, saldo }) => ({ label, saldo }));

  async function handleEnjoyHours(hours) {
    if (!selectedMeta?.id) throw new Error("Selecione um timesheet para gozar horas.");
    if (typeof base44.entities?.Timesheet?.update !== "function") {
      throw new Error("Atualização de timesheet não está disponível.");
    }
    const recordsUsed = Number(usedByTimesheetId.get(selectedMeta?.id) || 0);
    const currentEnjoyed = normalizeTimesheetManualUsed(selectedMeta, recordsUsed);
    const nextEnjoyed = Math.max(0, currentEnjoyed + Number(hours || 0));
    await base44.entities.Timesheet.update(selectedMeta.id, {
      total_descanso_compensatorio_hours: nextEnjoyed
    });
    await loadData();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Visão geral do controle de horas</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {timesheets.length > 0 && (
            <Select value={selectedTimesheetId} onValueChange={handleTimesheetChange}>
              <SelectTrigger className="w-full bg-card/80 backdrop-blur border-border/60 sm:w-[320px] sm:max-w-[55vw]">
                <SelectValue placeholder="Filtrar timesheet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos (total)</SelectItem>
                {timesheets.map((ts) => (
                  <SelectItem key={ts.id} value={ts.id}>
                    {ts.month} {ts.year} • {ts.employee_name || "Desconhecido"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button asChild variant="outline" size="sm" className="w-full gap-2 sm:w-auto">
            <Link to="/upload">
              <Upload className="h-4 w-4" />
              Novo Upload
            </Link>
          </Button>
        </div>
      </div>

      <EmployeeInfo info={employeeInfo} />
      <SummaryCards summary={summary} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <HourBankChart data={chartData} />
          </div>
          <div>
          <HourBankSummary
            summary={summary}
            history={sortedRecords}
            timesheetId={selectedMeta?.id || null}
            onEnjoyHours={handleEnjoyHours}
          />
          </div>
        </div>
      {summary.alerts.length > 0 && <AlertsList alerts={summary.alerts} />}
    </div>
  );
}
