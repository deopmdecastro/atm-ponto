import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import HistoryTable from "../components/dashboard/HistoryTable";
import { buildHourBankHistory } from "../lib/parseTimesheet";

export default function TimesheetDetailPage() {
  const { timesheetId, employeeName, year, month } = useParams();
  const [records, setRecords] = useState([]);
  const [timesheet, setTimesheet] = useState(null);
  const [loading, setLoading] = useState(true);

  const legacyKey = useMemo(() => {
    if (!employeeName || !year || !month) return null;
    return {
      employeeName: decodeURIComponent(employeeName),
      year: String(year),
      month: decodeURIComponent(month)
    };
  }, [employeeName, year, month]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timesheetId, employeeName, year, month]);

  async function loadData() {
    setLoading(true);

    if (timesheetId) {
      if (typeof base44.entities?.Timesheet?.get === "function") {
        const ts = await base44.entities.Timesheet.get(timesheetId);
        setTimesheet(ts);
      }
      const data = await base44.entities.TimesheetRecord.list("-date", 5000, { timesheet_id: timesheetId });
      setRecords(data);
      setLoading(false);
      return;
    }

    // Backwards compatibility for old routes: /historico/:employeeName/:year/:month
    const data = await base44.entities.TimesheetRecord.list("-date", 5000);
    const filtered = legacyKey
      ? data.filter(
          (r) =>
            r.employee_name === legacyKey.employeeName && String(r.year) === legacyKey.year && r.month === legacyKey.month
        )
      : [];
    setTimesheet(
      legacyKey
        ? { employee_name: legacyKey.employeeName, month: legacyKey.month, year: Number(legacyKey.year) }
        : null
    );
    setRecords(filtered);
    setLoading(false);
  }

  async function handleToggleCompensate(row) {
    const record = records.find((r) => r.date === row.date);
    if (!record) return;
    const nextComp = !record.compensated;

    // Enforce main rule: whenever compensated hours are enjoyed, decrement from available bank.
    // Prevent marking as "compensated" if there isn't enough available hours.
    if (nextComp) {
      const delta = Number(record?.normal_hours || 0);
      const totalPool = Number(timesheet?.total_compensation_hours || 0);
      if (Number.isFinite(delta) && delta > 0 && Number.isFinite(totalPool) && totalPool > 0) {
        const usedFromRecords = records.reduce(
          (acc, r) => acc + (r?.compensated ? Number(r?.normal_hours || 0) : 0),
          0
        );
        const rawManualUsed = Number(timesheet?.total_descanso_compensatorio_hours || 0);
        const effectiveManualUsed = Number(usedFromRecords || 0) === 0 && rawManualUsed === totalPool ? 0 : rawManualUsed;
        const availableNow = Math.max(0, totalPool - (Number(usedFromRecords || 0) + Number(effectiveManualUsed || 0)));

        if (delta > availableNow) {
          toast({
            variant: "destructive",
            title: "Sem horas disponíveis",
            description: `Tentaste gozar ${delta.toFixed(1)}h, mas só tens ${availableNow.toFixed(1)}h disponíveis.`
          });
          return;
        }
      }
    }

    await base44.entities.TimesheetRecord.update(record.id, { compensated: nextComp });
    await loadData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const sorted = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
  const rawTotalComp = Number(timesheet?.total_compensation_hours || 0);
  const rawManualUsed = Number(timesheet?.total_descanso_compensatorio_hours || 0);
  const recordsUsed = sorted.reduce((acc, r) => acc + (r?.compensated ? Number(r?.normal_hours || 0) : 0), 0);
  // Backwards compatibility: old imports set manualUsed == total (it was actually the pool, not "used").
  const effectiveManualUsed = recordsUsed === 0 && rawManualUsed === rawTotalComp ? 0 : rawManualUsed;
  const effectiveTotalUsed = Math.max(0, Number(recordsUsed || 0) + Math.max(0, Number(effectiveManualUsed || 0)));

  const history = buildHourBankHistory(sorted, {
    compensationTotalHours: timesheet?.total_compensation_hours,
    compensationUsedHours: effectiveTotalUsed
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild>
          <Link to="/historico">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {timesheet?.month} {timesheet?.year}
          </h2>
          <p className="text-sm text-muted-foreground">{timesheet?.employee_name || ""}</p>
        </div>
      </div>
      <HistoryTable history={history} onToggleCompensate={handleToggleCompensate} />
    </div>
  );
}
