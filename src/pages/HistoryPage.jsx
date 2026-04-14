import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { Link, useNavigate } from "react-router-dom";
import { Calendar, Clock, Eye, Trash2, Upload, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function fmtDate(iso) {
  const s = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s || "-";
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("timesheets"); // timesheets | compensation
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteEnjoymentTarget, setDeleteEnjoymentTarget] = useState(null);

  const timesheetsQuery = useQuery({
    queryKey: ["timesheets"],
    queryFn: async () => {
      const hasTimesheets = typeof base44.entities?.Timesheet?.list === "function";
      if (hasTimesheets) return base44.entities.Timesheet.list(200);

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
      return Object.values(map);
    },
    staleTime: 60_000
  });

  const enjoymentsQuery = useQuery({
    queryKey: ["compensation-enjoyments"],
    queryFn: async () => {
      const fn = base44.entities?.CompensationEnjoyment?.list;
      if (typeof fn !== "function") return [];
      return fn("-enjoy_date", 2000);
    },
    staleTime: 30_000
  });

  const timesheets = Array.isArray(timesheetsQuery.data) ? timesheetsQuery.data : [];
  const enjoyments = Array.isArray(enjoymentsQuery.data) ? enjoymentsQuery.data : [];

  const timesheetCountLabel = useMemo(() => {
    const n = timesheets.length;
    return `${n} timesheet(s) importado(s)`;
  }, [timesheets.length]);

  const deleteTimesheet = useMutation({
    mutationFn: async (ts) => {
      if (!ts) return;
      if (typeof base44.entities?.Timesheet?.delete === "function") {
        await base44.entities.Timesheet.delete(ts.id);
        return;
      }
      if (Array.isArray(ts._records)) {
        for (const r of ts._records) {
          await base44.entities.TimesheetRecord.delete(r.id);
        }
      }
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["timesheets"] });
      await queryClient.invalidateQueries({ queryKey: ["timesheet-records", "all"] });
    }
  });

  const deleteEnjoyment = useMutation({
    mutationFn: async (e) => {
      if (!e?.id) return;
      const fn = base44.entities?.CompensationEnjoyment?.delete;
      if (typeof fn !== "function") throw new Error("Esta funcionalidade não está disponível.");
      await fn(e.id);
    },
    onSuccess: async () => {
      setDeleteEnjoymentTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["compensation-enjoyments"] });
    }
  });

  function handleView(ts) {
    if (typeof base44.entities?.Timesheet?.get === "function") {
      navigate(`/historico/${encodeURIComponent(ts.id)}`);
    } else {
      localStorage.setItem("atm.selectedTimesheetId", "all");
      navigate(`/`);
    }
  }

  const loading = timesheetsQuery.isLoading || enjoymentsQuery.isLoading;
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const errorMessage = timesheetsQuery.error?.message || enjoymentsQuery.error?.message || null;
  if (errorMessage) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="border border-red-200 bg-red-50 rounded-xl p-4 text-sm text-red-700">{errorMessage}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Histórico</h2>
          <p className="text-sm text-muted-foreground">{tab === "timesheets" ? timesheetCountLabel : `${enjoyments.length} registo(s)`}</p>
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link to="/upload">
            <Upload className="h-4 w-4 mr-2" />
            Novo Upload
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="timesheets" className="flex-1 sm:flex-none">
            Time Sheet
          </TabsTrigger>
          <TabsTrigger value="compensation" className="flex-1 sm:flex-none">
            Horas de Compensação
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timesheets">
          {timesheets.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
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
          ) : (
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
                          <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">{days} dias</span>
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
          )}

          <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar Time Sheet</AlertDialogTitle>
                <AlertDialogDescription>
                  Tens a certeza que queres apagar o time sheet de{" "}
                  <strong>{deleteTarget?.employee_name || "Desconhecido"}</strong> referente a{" "}
                  <strong>
                    {deleteTarget?.month} {deleteTarget?.year}
                  </strong>
                  ? Esta ação é irreversível e remove todos os {deleteTarget?.record_count} registos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteTimesheet.isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  disabled={deleteTimesheet.isPending}
                  onClick={() => deleteTimesheet.mutate(deleteTarget)}
                >
                  Apagar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="compensation">
          {enjoyments.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center">
                <Wallet className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Sem registos de gozo</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Registe horas gozadas no cartão “Horas Compensadas” da Dashboard.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link to="/">Ir para a Dashboard</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {enjoyments.map((e) => (
                <div key={e.id} className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Wallet className="h-6 w-6 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{fmtDate(e.enjoy_date)}</span>
                        <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                          {Number(e.hours || 0).toFixed(1)}h
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Criado em{" "}
                        <span className="font-medium text-foreground">
                          {e.created_date ? format(new Date(e.created_date), "dd/MM/yyyy HH:mm") : "-"}
                        </span>
                      </p>
                      {e.reason ? <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{e.reason}</p> : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      onClick={() => setDeleteEnjoymentTarget(e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <AlertDialog open={!!deleteEnjoymentTarget} onOpenChange={() => setDeleteEnjoymentTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar registo</AlertDialogTitle>
                <AlertDialogDescription>
                  Tens a certeza que queres apagar este registo de gozo de{" "}
                  <strong>{Number(deleteEnjoymentTarget?.hours || 0).toFixed(1)}h</strong> em{" "}
                  <strong>{fmtDate(deleteEnjoymentTarget?.enjoy_date)}</strong>?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteEnjoyment.isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  disabled={deleteEnjoyment.isPending}
                  onClick={() => deleteEnjoyment.mutate(deleteEnjoymentTarget)}
                >
                  Apagar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
