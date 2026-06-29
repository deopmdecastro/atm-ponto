import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import AlertsList from "@/components/dashboard/AlertsList";
import EmployeeInfo from "@/components/dashboard/EmployeeInfo";
import HourBankChart from "@/components/dashboard/HourBankChart";
import HourBankSummary from "@/components/dashboard/HourBankSummary";
import SummaryCards from "@/components/dashboard/SummaryCards";
import { useAuth } from "@/lib/AuthContext";
import { truncateDecimal } from "@/lib/formatHours";
import { buildHourBankHistory, calculateSummary } from "@/lib/parseTimesheet";

const FILTER_KEY = "atm.dashboard.filterMode.v1";
const MONTH_KEY = "atm.dashboard.monthTimesheetId.v1";

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

function normalizeTimesheetManualUsed(ts, usedFromRecords) {
  const total = Number(ts?.total_compensation_hours || 0);
  const manualUsed = Number(ts?.total_descanso_compensatorio_hours || 0);
  const recordsUsed = Number(usedFromRecords || 0);
  const effectiveManualUsed = recordsUsed === 0 && manualUsed === total ? 0 : manualUsed;
  return Math.max(0, effectiveManualUsed);
}

function normalizeTimesheetUsed(ts, usedFromRecords) {
  const recordsUsed = Number(usedFromRecords || 0);
  const manualUsed = normalizeTimesheetManualUsed(ts, recordsUsed);
  return Math.max(0, recordsUsed + manualUsed);
}

function timesheetMonthKey(ts) {
  const y = Number(ts?.year || 0);
  const m = monthIndex(ts?.month);
  if (!y || !m) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filterMode, setFilterMode] = useState("all");
  const [monthTimesheetId, setMonthTimesheetId] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    try {
      const mode = localStorage.getItem(FILTER_KEY);
      const tsId = localStorage.getItem(MONTH_KEY);
      if (mode === "all" || mode === "month") setFilterMode(mode);
      if (tsId) setMonthTimesheetId(tsId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, filterMode);
      if (monthTimesheetId) {
        localStorage.setItem(MONTH_KEY, monthTimesheetId);
      }
    } catch {
      // ignore
    }
  }, [filterMode, monthTimesheetId]);

  const timesheetsQuery = useQuery({
    queryKey: ["timesheets"],
    queryFn: () => base44.entities.Timesheet.list(200),
    staleTime: 60_000
  });

  const allRecordsQuery = useQuery({
    queryKey: ["timesheet-records", "all"],
    queryFn: () => base44.entities.TimesheetRecord.list("-date", 5000),
    staleTime: 30_000
  });

  const enjoymentsQuery = useQuery({
    queryKey: ["compensation-enjoyments"],
    queryFn: () => base44.entities.CompensationEnjoyment.list("-enjoy_date", 2000),
    staleTime: 30_000
  });

  const timesheets = Array.isArray(timesheetsQuery.data) ? timesheetsQuery.data : [];
  const allRecords = Array.isArray(allRecordsQuery.data) ? allRecordsQuery.data : [];
  const enjoyments = Array.isArray(enjoymentsQuery.data) ? enjoymentsQuery.data : [];

  const enjoyedByMonthKey = useMemo(() => {
    const map = new Map();
    for (const e of enjoyments) {
      const iso = String(e?.enjoy_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const key = iso.slice(0, 7);
      const hours = Number(e?.hours || 0);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      map.set(key, (map.get(key) || 0) + hours);
    }
    return map;
  }, [enjoyments]);

  const createEnjoyment = useMutation({
    mutationFn: (payload) => base44.entities.CompensationEnjoyment.create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["compensation-enjoyments"] });
    }
  });

  useEffect(() => {
    if (monthTimesheetId && timesheets.some((t) => t.id === monthTimesheetId)) return;
    if (timesheets.length === 0) return;
    setMonthTimesheetId(timesheets[0].id);
  }, [monthTimesheetId, timesheets]);

  const selectedMeta = useMemo(() => {
    return timesheets.find((t) => t.id === monthTimesheetId) || null;
  }, [timesheets, monthTimesheetId]);

  const filteredRecords = useMemo(() => {
    if (filterMode === "all") return allRecords;
    if (!monthTimesheetId) return [];
    return allRecords.filter((r) => String(r?.timesheet_id || "") === String(monthTimesheetId));
  }, [allRecords, filterMode, monthTimesheetId]);

  const loading = timesheetsQuery.isLoading || allRecordsQuery.isLoading || enjoymentsQuery.isLoading;
  const sortedAllRecords = [...allRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
  const sortedFilteredRecords = [...filteredRecords].sort((a, b) => new Date(a.date) - new Date(b.date));

  const usedByTimesheetId = new Map();
  for (const r of sortedAllRecords) {
    const tsId = r?.timesheet_id;
    if (!tsId) continue;
    if (!r?.compensated) continue;
    const delta = Number(r.normal_hours || 0);
    if (!Number.isFinite(delta) || delta <= 0) continue;
    usedByTimesheetId.set(tsId, (usedByTimesheetId.get(tsId) || 0) + delta);
  }

  const compensationTotalHours = timesheets.reduce((acc, ts) => acc + Number(ts?.total_compensation_hours || 0), 0);
  const compensatedFromRecords = sortedAllRecords.reduce(
    (acc, r) => acc + (r?.compensated ? Number(r?.normal_hours || 0) : 0),
    0
  );
  const manualUsedTotal = timesheets.reduce(
    (acc, ts) => acc + normalizeTimesheetManualUsed(ts, usedByTimesheetId.get(ts?.id) || 0),
    0
  );
  const enjoyedTotal = enjoyments.reduce((acc, e) => acc + Number(e?.hours || 0), 0);

  const selectedMonthKey = selectedMeta ? timesheetMonthKey(selectedMeta) : "";
  const selectedCompensationTotalHours =
    filterMode === "month" && selectedMeta ? Number(selectedMeta?.total_compensation_hours || 0) : compensationTotalHours;
  const selectedCompensatedFromRecords =
    filterMode === "month"
      ? Number(usedByTimesheetId.get(monthTimesheetId) || 0)
      : compensatedFromRecords;
  const selectedManualUsed =
    filterMode === "month" && selectedMeta
      ? normalizeTimesheetManualUsed(selectedMeta, selectedCompensatedFromRecords)
      : manualUsedTotal;
  const selectedEnjoyedHours =
    filterMode === "month" ? Number(enjoyedByMonthKey.get(selectedMonthKey) || 0) : enjoyedTotal;
  const selectedCompensationUsedHours = Math.max(
    0,
    selectedCompensatedFromRecords + selectedManualUsed + selectedEnjoyedHours
  );

  const summary = calculateSummary(sortedFilteredRecords, {
    compensationTotalHours: selectedCompensationTotalHours,
    compensationUsedHours: selectedCompensationUsedHours
  });

  const dueTimesheetAlerts = (() => {
    const now = new Date();
    const day = now.getDate();
    if (day < 1 || day > 5) return [];

    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expectedYear = previousMonthDate.getFullYear();
    const expectedMonth = previousMonthDate.getMonth() + 1;

    const hasPreviousMonthTimesheet = timesheets.some((ts) => {
      const tsYear = Number(ts?.year || 0);
      const tsMonth = monthIndex(ts?.month);
      return tsYear === expectedYear && tsMonth === expectedMonth;
    });

    if (hasPreviousMonthTimesheet) return [];

    const previousMonthName = monthNames[expectedMonth - 1] || "mês anterior";
    let message = "";
    let type = "warning";

    if (day === 1) {
      message = `Hoje é dia 1: importa o Time Sheet de ${previousMonthName} ${expectedYear} até dia 5.`;
    } else if (day === 5) {
      type = "error";
      message = `Hoje é dia 5: último dia para importar o Time Sheet de ${previousMonthName} ${expectedYear}.`;
    } else {
      const daysLeft = 5 - day;
      message = `Faltam ${daysLeft} dia(s) para importar o Time Sheet de ${previousMonthName} ${expectedYear}.`;
    }

    return [
      {
        type,
        date: "-",
        message
      }
    ];
  })();

  const missingMonthAlerts = useMemo(() => {
    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYear = lastMonthDate.getFullYear();
    const lastMonth = lastMonthDate.getMonth() + 1;
    const profileStartYear = Number(user?.profile?.start_year || 0);
    const startYear = profileStartYear >= 2000 && profileStartYear <= lastYear ? profileStartYear : lastYear;
    const profileStartMonth = Number(user?.profile?.start_month || 1);
    const startMonth = profileStartMonth >= 1 && profileStartMonth <= 12 ? profileStartMonth : 1;

    const existingKeys = new Set(timesheets.map(timesheetMonthKey).filter(Boolean));
    const missingKeys = [];

    for (let year = startYear; year <= lastYear; year++) {
      const monthStart = year === startYear ? startMonth : 1;
      const monthLimit = year === lastYear ? lastMonth : 12;
      for (let month = monthStart; month <= monthLimit; month++) {
        const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
        if (!existingKeys.has(key)) {
          missingKeys.push(key);
        }
      }
    }

    if (missingKeys.length === 0) return [];

    const formatKey = (key) => {
      const [year, month] = String(key).split("-");
      const monthName = monthNames[Number(month) - 1] || month;
      return `${monthName} ${year}`;
    };

    const preview = missingKeys.slice(0, 4).map(formatKey).join(", ");
    const message =
      missingKeys.length <= 4
        ? `Faltam os Timesheets de: ${preview}.` 
        : `Faltam ${missingKeys.length} meses de Timesheet desde ${monthNames[startMonth - 1]} ${startYear}: ${preview} e mais ${missingKeys.length - 4}.`;

    return [
      {
        type: "warning",
        date: "-",
        message
      }
    ];
  }, [timesheets, user]);

  const dailyHistory = buildHourBankHistory(sortedFilteredRecords, {
    compensationTotalHours: selectedCompensationTotalHours,
    compensationUsedHours: selectedCompensationUsedHours
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (timesheetsQuery.isError || allRecordsQuery.isError || enjoymentsQuery.isError) {
    const message =
      timesheetsQuery.error?.message ||
      allRecordsQuery.error?.message ||
      enjoymentsQuery.error?.message ||
      "Erro ao carregar dados";
    return (
      <div className="max-w-2xl mx-auto">
        <div className="border border-red-200 bg-red-50/80 rounded-xl p-4 text-sm text-red-700">{message}</div>
      </div>
    );
  }

  if (allRecords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="h-20 w-20 rounded-3xl bg-accent flex items-center justify-center mb-6">
          <FileSpreadsheet className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Sem dados importados</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          Faça upload da sua folha de ponto Excel para visualizar o dashboard completo com resumo, gráficos e histórico.
        </p>
        <Button asChild size="lg" className="gap-2 bg-red-600 hover:bg-red-700 text-white">
          <Link to="/upload">
            <Upload className="h-4 w-4" />
            Importar Folha de Ponto
          </Link>
        </Button>
      </div>
    );
  }

  function toDayLabel(iso) {
    const s = String(iso || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
    return s;
  }

  const chartData =
    filterMode === "all"
      ? [...timesheets]
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
            const enjoyedThisMonth = enjoyedByMonthKey.get(timesheetMonthKey(ts)) || 0;
            const used =
              prevUsed +
              normalizeTimesheetUsed(ts, usedByTimesheetId.get(ts?.id) || 0) +
              Number(enjoyedThisMonth || 0);
            const available = Math.max(0, total - used);
            acc.push({
              label: `${ts.month} ${ts.year}`.trim(),
              saldo: truncateDecimal(available),
              _total: total,
              _used: used
            });
            return acc;
          }, [])
          .map(({ label, saldo }) => ({ label, saldo }))
      : dailyHistory.map((h) => ({ label: toDayLabel(h.date), saldo: h.bankBalance }));

  const employeeInfo = (() => {
    if (filterMode === "month" && selectedMeta) {
      return {
        name: selectedMeta?.employee_name || "Desconhecido",
        number: selectedMeta?.employee_number || "",
        department: selectedMeta?.department || "",
        period: `${selectedMeta?.month || ""} ${selectedMeta?.year || ""}`.trim()
      };
    }

    const first = timesheets[0] || null;
    const sorted = [...timesheets]
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
      name: first?.employee_name || "Colaborador",
      number: first?.employee_number || "",
      department: first?.department || "",
      period
    };
  })();

  async function handleDownloadExcel() {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await base44.reports.downloadCompensationSummaryXlsx();
      const url = URL.createObjectURL(blob);
      const safeName = String(employeeInfo?.name || "ATM")
        .trim()
        .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
        .replace(/\s+/g, " ")
        .slice(0, 60);
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `ATM-Resumo-Horas-${safeName || "Colaborador"}-${stamp}.xlsx`;

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Falha ao baixar Excel",
        description: e?.message || "Tente novamente."
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-gray-900">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Visão geral do controle de horas</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Select value={filterMode} onValueChange={setFilterMode}>
            <SelectTrigger className="w-full bg-card/80 backdrop-blur border-border/60 sm:w-[160px]">
              <SelectValue placeholder="Filtro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="month">Mês</SelectItem>
            </SelectContent>
          </Select>

          {filterMode === "month" && timesheets.length > 0 && (
            <Select value={monthTimesheetId} onValueChange={setMonthTimesheetId}>
              <SelectTrigger className="w-full bg-card/80 backdrop-blur border-border/60 sm:w-[220px] sm:max-w-[55vw]">
                <SelectValue placeholder="Selecione o mês" />
              </SelectTrigger>
              <SelectContent>
                {timesheets.map((ts) => (
                  <SelectItem key={ts.id} value={ts.id}>
                    {ts.month} {ts.year}
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

          <Button
            type="button"
            variant="default"
            size="sm"
            className="w-full gap-2 sm:w-auto"
            onClick={handleDownloadExcel}
            disabled={downloading}
          >
            <Download className="h-4 w-4" />
            {downloading ? "Gerando..." : "Baixar Excel"}
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
            history={sortedFilteredRecords}
            filterMode={filterMode}
            onCreateEnjoyment={async ({ enjoy_date, hours, reason }) => {
              await createEnjoyment.mutateAsync({ enjoy_date, hours, reason });
            }}
          />
        </div>
      </div>

      {summary.alerts.length > 0 || dueTimesheetAlerts.length > 0 || missingMonthAlerts.length > 0 ? (
        <AlertsList alerts={[...summary.alerts, ...dueTimesheetAlerts, ...missingMonthAlerts]} />
      ) : null}
    </div>
  );
}
