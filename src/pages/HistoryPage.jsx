import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Link, useNavigate } from "react-router-dom";
import { Upload, Eye, Trash2, Calendar, User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

export default function HistoryPage() {
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const hasTimesheets = typeof base44.entities?.Timesheet?.list === "function";
    if (!hasTimesheets) {
      // Fallback: group by employee/month/year (legacy behavior)
      const records = await base44.entities.TimesheetRecord.list("-date", 5000);
      const map = {};
      for (const r of records) {
        const key = `${r.employee_name}__${r.month}__${r.year}`;
        if (!map[key]) {
          map[key] = {
            id: key,
            employee_name: r.employee_name,
            employee_number: r.employee_number,
            month: r.month,
            year: r.year,
            record_count: 0,
            total_normal_hours: 0,
            total_extra_hours: 0,
            worked_days: 0,
            _records: []
          };
        }
        map[key]._records.push(r);
        map[key].record_count += 1;
        map[key].total_normal_hours += Number(r.normal_hours || 0);
        map[key].total_extra_hours += Number(r.extra_hours || 0);
        if (Number(r.normal_hours || 0) > 0) map[key].worked_days += 1;
      }
      setTimesheets(Object.values(map));
      setLoading(false);
      return;
    }

    const data = await base44.entities.Timesheet.list(200);
    setTimesheets(data);
    setLoading(false);
  }

  async function handleDelete(ts) {
    if (typeof base44.entities?.Timesheet?.delete === "function") {
      await base44.entities.Timesheet.delete(ts.id);
    } else if (Array.isArray(ts._records)) {
      for (const r of ts._records) {
        await base44.entities.TimesheetRecord.delete(r.id);
      }
    }
    setDeleteTarget(null);
    await loadData();
  }

  function handleView(ts) {
    if (typeof base44.entities?.Timesheet?.get === "function") {
      navigate(`/historico/${encodeURIComponent(ts.id)}`);
    } else {
      // legacy: no detail view, just keep user in history
      localStorage.setItem("atm.selectedTimesheetId", "all");
      navigate(`/`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (timesheets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Sem timesheets importados</p>
          <p className="text-sm text-muted-foreground mt-1">Faça upload de uma folha de ponto para começar</p>
        </div>
        <Button asChild>
          <Link to="/upload">
            <Upload className="h-4 w-4 mr-2" />
            Importar Folha
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Histórico de Timesheets</h2>
          <p className="text-sm text-muted-foreground">{timesheets.length} timesheet(s) importado(s)</p>
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link to="/upload">
            <Upload className="h-4 w-4 mr-2" />
            Novo Upload
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        {timesheets.map((ts) => {
          const totalNormal = Number(ts.total_normal_hours || 0);
          const totalExtra = Number(ts.total_extra_hours || 0);
          const workDays = Number(ts.worked_days || 0);
          const days = Number(ts.record_count || 0);

          return (
            <div
              key={ts.id}
              className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">
                      {ts.month} {ts.year}
                    </span>
                    <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                      {days} dias
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <User className="h-3 w-3" />
                    <span className="truncate">{ts.employee_name || "Desconhecido"}</span>
                    {ts.employee_number && <span>• Nº {ts.employee_number}</span>}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground">{totalNormal.toFixed(1)}h</span> normais
                    </span>
                    <span>
                      <span className="font-medium text-primary">{totalExtra.toFixed(1)}h</span> extra
                    </span>
                    <span>
                      <span className="font-medium text-foreground">{workDays}</span> dias trabalhados
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleView(ts)}>
                  <Eye className="h-4 w-4 mr-1" /> Ver
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                  onClick={() => setDeleteTarget(ts)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar Timesheet</AlertDialogTitle>
            <AlertDialogDescription>
              Tens a certeza que queres apagar o timesheet de{" "}
              <strong>{deleteTarget?.employee_name || "Desconhecido"}</strong> referente a{" "}
              <strong>
                {deleteTarget?.month} {deleteTarget?.year}
              </strong>
              ? Esta ação é irreversível e remove todos os {deleteTarget?.record_count} registos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => handleDelete(deleteTarget)}>
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
