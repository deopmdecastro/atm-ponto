import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { formatHours } from "@/lib/formatHours";
import { cn } from "@/lib/utils";

// Same UTC-safe weekday helper used in HistoryTable — never derive the
// weekday from a local-timezone Date/moment parse of a plain "YYYY-MM-DD"
// string, since that can silently shift the displayed day.
const WEEKDAY_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_TYPES = ["Dia Útil", "Desc.Comp", "Desc. Obrig", "Feriado"];

function splitISODate(date) {
  const s = String(date || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function weekdayPt(date) {
  const parts = splitISODate(date);
  if (!parts) return "";
  const dow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return WEEKDAY_PT[dow];
}

function formatDDMM(date) {
  const parts = splitISODate(date);
  if (!parts) return "";
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}`;
}

const EDITABLE_NUMBER_FIELDS = ["normal_hours", "extra_hours", "travel_hours", "absence_hours", "pause_hours"];

export default function TimesheetEditPage() {
  const { timesheetId } = useParams();
  const navigate = useNavigate();
  const [timesheet, setTimesheet] = useState(null);
  const [records, setRecords] = useState([]);
  const [edits, setEdits] = useState({}); // recordId -> { field: value }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [timesheetId]);

  async function loadData() {
    setLoading(true);
    try {
      if (typeof base44.entities?.Timesheet?.get === "function") {
        const ts = await base44.entities.Timesheet.get(timesheetId);
        setTimesheet(ts);
      }
      const data = await base44.entities.TimesheetRecord.list("date", 5000, { timesheet_id: timesheetId });
      setRecords(Array.isArray(data) ? data : []);
      setEdits({});
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao carregar timesheet",
        description: error?.message || "Não foi possível carregar os dados para edição."
      });
    } finally {
      setLoading(false);
    }
  }

  const sorted = useMemo(() => [...records].sort((a, b) => String(a.date).localeCompare(String(b.date))), [records]);

  const dirtyCount = Object.keys(edits).length;

  function fieldValue(row, field) {
    if (edits[row.id] && field in edits[row.id]) return edits[row.id][field];
    return row[field];
  }

  function setField(row, field, value) {
    setEdits((prev) => {
      const current = { ...(prev[row.id] || {}) };
      const original = row[field];
      const normalizedOriginal = EDITABLE_NUMBER_FIELDS.includes(field) ? Number(original || 0) : String(original ?? "");
      const normalizedValue = EDITABLE_NUMBER_FIELDS.includes(field) ? Number(value || 0) : value;

      if (normalizedValue === normalizedOriginal) {
        delete current[field];
      } else {
        current[field] = normalizedValue;
      }

      const next = { ...prev };
      if (Object.keys(current).length === 0) {
        delete next[row.id];
      } else {
        next[row.id] = current;
      }
      return next;
    });
  }

  async function handleSaveAll() {
    if (dirtyCount === 0) return;
    setSaving(true);
    let failed = 0;
    try {
      for (const [recordId, changes] of Object.entries(edits)) {
        try {
          await base44.entities.TimesheetRecord.update(recordId, changes);
        } catch (err) {
          failed += 1;
          console.error(err);
        }
      }
      if (failed === 0) {
        toast({ title: "Alterações guardadas", description: "O timesheet foi atualizado com sucesso." });
      } else {
        toast({
          variant: "destructive",
          title: "Algumas alterações falharam",
          description: `${failed} de ${dirtyCount} dia(s) não foram guardados. Tenta novamente.`
        });
      }
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full px-4 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigate(`/historico`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Editar — {timesheet?.month} {timesheet?.year}
            </h2>
            <p className="text-sm text-muted-foreground">{timesheet?.employee_name || ""}</p>
          </div>
        </div>
        <Button onClick={handleSaveAll} disabled={dirtyCount === 0 || saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "A guardar..." : dirtyCount > 0 ? `Guardar ${dirtyCount} alteração(ões)` : "Guardar alterações"}
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center gap-2">
          <p className="font-semibold text-foreground">Sem registos para editar</p>
          <p className="text-sm text-muted-foreground">Este timesheet não tem dias associados.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="max-h-[75vh] overflow-auto">
            <table className="border-collapse text-xs w-full">
              <thead className="sticky top-0 z-10 bg-secondary/60 text-left text-muted-foreground">
                <tr>
                  <th className="border border-border px-2 py-2 min-w-[90px]">Dia</th>
                  <th className="border border-border px-2 py-2 w-[90px]">Tipo Dia</th>
                  <th className="border border-border px-2 py-2 w-[80px]">Normais</th>
                  <th className="border border-border px-2 py-2 w-[80px]">Extra</th>
                  <th className="border border-border px-2 py-2 w-[80px]">Viagem</th>
                  <th className="border border-border px-2 py-2 w-[80px]">Ausência</th>
                  <th className="border border-border px-2 py-2 w-[70px]">Entrada</th>
                  <th className="border border-border px-2 py-2 w-[70px]">Saída</th>
                  <th className="border border-border px-2 py-2 min-w-[140px]">Tipo Ausência</th>
                  <th className="border border-border px-2 py-2 min-w-[100px]">Nº Projeto</th>
                  <th className="border border-border px-2 py-2 min-w-[160px]">Cliente</th>
                  <th className="border border-border px-2 py-2 min-w-[160px]">Observações</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, idx) => {
                  const isDirty = !!edits[row.id];
                  const isWknd = fieldValue(row, "day_type") === "Desc.Comp" || fieldValue(row, "day_type") === "Desc. Obrig";
                  const rowBg = isDirty
                    ? "bg-amber-50/60"
                    : isWknd
                      ? "bg-muted/40"
                      : idx % 2 === 0
                        ? "bg-card"
                        : "bg-muted/10";

                  const inputCell = (field, opts = {}) => (
                    <td className="border border-border px-1 py-1">
                      <Input
                        type={opts.type || "text"}
                        step={opts.step}
                        className="h-7 text-xs px-1.5"
                        value={fieldValue(row, field) ?? ""}
                        onChange={(e) => setField(row, field, e.target.value)}
                      />
                    </td>
                  );

                  return (
                    <tr key={row.id} className={cn("transition-colors", rowBg)}>
                      <td className="border border-border px-2 py-1.5 whitespace-nowrap font-semibold text-foreground">
                        {weekdayPt(row.date)} {formatDDMM(row.date)}
                      </td>
                      <td className="border border-border px-1 py-1">
                        <Select
                          value={fieldValue(row, "day_type") || "Dia Útil"}
                          onValueChange={(v) => setField(row, "day_type", v)}
                        >
                          <SelectTrigger className="h-7 text-xs px-1.5">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DAY_TYPES.map((dt) => (
                              <SelectItem key={dt} value={dt}>
                                {dt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {inputCell("normal_hours", { type: "number", step: "0.01" })}
                      {inputCell("extra_hours", { type: "number", step: "0.01" })}
                      {inputCell("travel_hours", { type: "number", step: "0.01" })}
                      {inputCell("absence_hours", { type: "number", step: "0.01" })}
                      {inputCell("period_start")}
                      {inputCell("period_end")}
                      {inputCell("absence_type")}
                      {inputCell("project_number")}
                      {inputCell("project_client")}
                      {inputCell("observations")}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border bg-secondary/30">
            Linhas destacadas a laranja têm alterações por guardar
            {dirtyCount > 0 ? ` (${dirtyCount})` : ""}. Total de horas normais no mês:{" "}
            <span className="font-semibold text-foreground">
              {formatHours(sorted.reduce((acc, r) => acc + Number(fieldValue(r, "normal_hours") || 0), 0))}h
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
