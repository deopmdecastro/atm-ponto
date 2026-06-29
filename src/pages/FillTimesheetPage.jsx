/* eslint-disable react/no-unescaped-entities */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  ClipboardList,
  Clock,
  Download,
  Eraser,
  FileSpreadsheet,
  Loader2,
  Plane,
  Save,
  TriangleAlert,
  Upload,
  UserSquare2,
  X
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
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
import { queryClientInstance } from "@/lib/query-client";
import { formatHours } from "@/lib/formatHours";
import {
  MONTH_NAMES_PT,
  buildMonthGrid,
  exportTimesheetToExcel,
  readTimesheetFile,
  recomputeRow,
  validateRow
} from "@/lib/parseTimesheetClient";

const DAY_TYPES = ["Dia Útil", "Desc.Comp", "Desc. Obrig", "Feriado"];

const EMPTY_META = {
  employee_name: "",
  employee_number: "",
  funcao: "",
  department: "",
  direcao: "",
  centro_custo: "",
  cct: "",
  horario: "",
  month: "",
  year: new Date().getFullYear(),
  email_remetente: "",
  email_nivel1: "",
  email_nivel2: ""
};

function clean(v) {
  return String(v ?? "").trim();
}

function dayTypeAccent(type) {
  switch (clean(type)) {
    case "Desc. Obrig":
      return { dot: "bg-red-500" };
    case "Desc.Comp":
      return { dot: "bg-amber-500" };
    case "Feriado":
      return { dot: "bg-purple-500" };
    default:
      return { dot: "bg-emerald-500" };
  }
}

function normalizeHHMM(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;
  const compact = s.match(/^(\d{1,2})(\d{2})$/);
  if (compact) return `${compact[1].padStart(2, "0")}:${compact[2]}`;
  const onlyH = s.match(/^(\d{1,2})$/);
  if (onlyH) return `${onlyH[1].padStart(2, "0")}:00`;
  return s;
}

function TimeInput({ value, onChange, disabled, className, ...rest }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="hh:mm"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onChange(normalizeHHMM(e.target.value))}
      disabled={disabled}
      className={`h-9 w-full rounded-md border border-border bg-white px-2 text-center text-sm font-medium tabular-nums text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-muted disabled:text-muted-foreground ${className || ""}`}
      {...rest}
    />
  );
}

function SummaryCard({ icon: Icon, label, value, accent, hint }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}1A` }}
        >
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
        <span className="text-2xl font-bold tabular-nums text-foreground">{value}</span>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function formatHHMMFromHours(h) {
  const v = Number(h || 0);
  if (!Number.isFinite(v) || v <= 0) return "";
  const hh = Math.floor(v);
  const mm = Math.round((v - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function parseHHMMOrNumber(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h + m / 60;
  }
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function RowEditor({ row, index, onPatch, onClear, onCopyPrev, canCopyPrev, projectCodes }) {
  return (
    <div className="space-y-3 bg-secondary/20 px-5 py-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrada</Label>
          <TimeInput value={row.period_start} onChange={(v) => onPatch(index, { period_start: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Saída</Label>
          <TimeInput value={row.period_end} onChange={(v) => onPatch(index, { period_end: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Pausa (hh:mm)</Label>
          <TimeInput value={row.pause_hours ? formatHHMMFromHours(row.pause_hours) : ""} onChange={(v) => onPatch(index, { pause_hours: parseHHMMOrNumber(v) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Tipo de Dia</Label>
          <Select value={row.day_type || "Dia Útil"} onValueChange={(v) => onPatch(index, { day_type: v }, { skipRecompute: true })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAY_TYPES.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-700">Horas Extraordinárias</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-amber-700/70">1º Período de</Label>
            <TimeInput value={row.extra1_start} onChange={(v) => onPatch(index, { extra1_start: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-amber-700/70">1º Período a</Label>
            <TimeInput value={row.extra1_end} onChange={(v) => onPatch(index, { extra1_end: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-amber-700/70">2º Período de</Label>
            <TimeInput value={row.extra2_start} onChange={(v) => onPatch(index, { extra2_start: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-amber-700/70">2º Período a</Label>
            <TimeInput value={row.extra2_end} onChange={(v) => onPatch(index, { extra2_end: v })} />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Nº Projeto</Label>
        <input
          list="project-codes-mobile"
          value={row.project_number || ""}
          onChange={(e) => onPatch(index, { project_number: e.target.value })}
          placeholder="Ex.: 260042-001"
          className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm font-medium tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        <datalist id="project-codes-mobile">
          {projectCodes.map((p) => (
            <option key={p.code} value={p.code}>{p.client || ""} {p.description ? `— ${p.description}` : ""}</option>
          ))}
        </datalist>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</Label>
          <Input value={row.project_client || ""} onChange={(e) => onPatch(index, { project_client: e.target.value }, { skipRecompute: true })} placeholder="(auto)" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Descrição</Label>
          <Input value={row.project_description || ""} onChange={(e) => onPatch(index, { project_description: e.target.value }, { skipRecompute: true })} placeholder="(auto)" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="text-[11px] text-muted-foreground">
          Calculado: <span className="font-semibold text-foreground">{formatHours(row.normal_hours)}h</span> normais
          {Number(row.extra_hours || 0) > 0 && (
            <span> · <span className="font-semibold text-amber-700">{formatHours(row.extra_hours)}h</span> extras</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!canCopyPrev} onClick={onCopyPrev}>
            Copiar dia anterior
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={onClear}>
            <Eraser className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function FillTimesheetPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const confirmResolveRef = useRef(null);

  const [meta, setMeta] = useState(EMPTY_META);
  const [rows, setRows] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importedProjects, setImportedProjects] = useState([]);
  const [sourceFile, setSourceFile] = useState(null);
  const [parseError, setParseError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState({ period: "", employeeLabel: "" });
  const [activeRowIdx, setActiveRowIdx] = useState(null);

  const projectsQuery = useQuery({
    queryKey: ["timesheet-config"],
    queryFn: () => base44.reference.getTimesheetConfig()
  });

  const catalogProjects = useMemo(() => {
    const list = Array.isArray(projectsQuery.data?.projects) ? projectsQuery.data.projects : [];
    return list.map((p) => ({
      code: clean(p.code),
      description: clean(p.description),
      client: clean(p.client)
    }));
  }, [projectsQuery.data]);

  const allProjects = useMemo(() => {
    const map = new Map();
    [...catalogProjects, ...importedProjects].forEach((p) => {
      const key = (clean(p.code) || clean(p.description) || clean(p.client)).toLowerCase();
      if (!key) return;
      const existing = map.get(key) || {};
      map.set(key, {
        code: existing.code || clean(p.code),
        description: existing.description || clean(p.description),
        client: existing.client || clean(p.client)
      });
    });
    return Array.from(map.values()).sort((a, b) => clean(a.code).localeCompare(clean(b.code), "pt", { numeric: true }));
  }, [catalogProjects, importedProjects]);

  const projectByCode = useMemo(() => {
    const map = new Map();
    allProjects.forEach((p) => {
      if (p.code) map.set(p.code, p);
    });
    return map;
  }, [allProjects]);

  useEffect(() => {
    if (!meta.month || !meta.year) return;
    if (rows.length > 0) return;
    const grid = buildMonthGrid(meta.month, Number(meta.year));
    setRows(grid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.month, meta.year]);

  function requestReplaceConfirmation({ period, employeeLabel }) {
    setConfirmInfo({ period, employeeLabel });
    setConfirmOpen(true);
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
    });
  }

  function resolveReplaceConfirmation(ok) {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmOpen(false);
    if (typeof resolve === "function") resolve(Boolean(ok));
  }

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setParseError("O ficheiro tem de ser um Excel (.xlsx ou .xls).");
      return;
    }
    setParseError("");
    setParsing(true);
    setSourceFile(file);
    try {
      const { meta: importedMeta, records, projects } = await readTimesheetFile(file);
      if (!records.length) {
        setParseError("Não foi possível encontrar registos diários no ficheiro.");
        setParsing(false);
        return;
      }

      const firstDate = records.find((r) => r.date)?.date || "";
      const dateMonth = firstDate.slice(5, 7);
      const dateYear = firstDate.slice(0, 4);
      const finalMonth = importedMeta.month || (dateMonth ? MONTH_NAMES_PT[Number(dateMonth) - 1] : "");
      const finalYear = importedMeta.year || (dateYear ? Number(dateYear) : new Date().getFullYear());

      const newMeta = { ...EMPTY_META, ...importedMeta, month: finalMonth, year: finalYear };
      setMeta(newMeta);

      const grid = buildMonthGrid(finalMonth, finalYear);
      const byDate = new Map(records.map((r) => [r.date, r]));
      const merged = grid.map((slot) => {
        const r = byDate.get(slot.date);
        if (!r) return slot;
        return recomputeRow({
          ...slot,
          ...r,
          day: slot.day,
          weekday: slot.weekday,
          isWeekend: slot.isWeekend,
          day_type: clean(r.day_type) || slot.day_type
        });
      });
      setRows(merged);
      setImportedProjects(projects || []);

      toast({
        title: "Folha de ponto carregada",
        description: `${records.length} registos lidos · ${(projects || []).length} projetos no catálogo.`
      });
    } catch (e) {
      console.error(e);
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  function patchRow(index, patch, options = {}) {
    setRows((prev) => {
      const next = [...prev];
      const merged = { ...next[index], ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "project_number")) {
        const code = clean(patch.project_number);
        if (code && projectByCode.has(code)) {
          const p = projectByCode.get(code);
          if (p.client && !merged.project_client) merged.project_client = p.client;
          if (p.description && !merged.project_description) merged.project_description = p.description;
        }
      }
      next[index] = options.skipRecompute ? merged : recomputeRow(merged);
      return next;
    });
  }

  function clearRow(index) {
    setRows((prev) => {
      const next = [...prev];
      const slot = next[index];
      next[index] = {
        ...slot,
        normal_hours: 0,
        extra_hours: 0,
        travel_hours: 0,
        absence_hours: 0,
        period_start: "",
        period_end: "",
        pause_hours: 0,
        extra1_start: "",
        extra1_end: "",
        extra2_start: "",
        extra2_end: "",
        extra_motivo: "",
        absence_type: "",
        project_number: "",
        project_client: "",
        project_description: ""
      };
      return next;
    });
  }

  function copyPreviousRow(index) {
    if (index <= 0) return;
    setRows((prev) => {
      const next = [...prev];
      const src = next[index - 1];
      const slot = next[index];
      next[index] = recomputeRow({
        ...slot,
        period_start: src.period_start,
        period_end: src.period_end,
        pause_hours: src.pause_hours,
        project_number: src.project_number,
        project_client: src.project_client,
        project_description: src.project_description,
        day_type: slot.day_type || src.day_type
      });
      return next;
    });
  }

  function clearMonth() {
    setRows((prev) =>
      prev.map((slot) => ({
        ...slot,
        normal_hours: 0,
        extra_hours: 0,
        travel_hours: 0,
        absence_hours: 0,
        period_start: "",
        period_end: "",
        pause_hours: 0,
        extra1_start: "",
        extra1_end: "",
        extra2_start: "",
        extra2_end: "",
        extra_motivo: "",
        absence_type: "",
        project_number: "",
        project_client: "",
        project_description: ""
      }))
    );
  }

  const totals = useMemo(() => {
    let normal = 0, extra = 0, travel = 0, absence = 0, worked = 0;
    rows.forEach((r) => {
      normal += Number(r.normal_hours || 0);
      extra += Number(r.extra_hours || 0);
      travel += Number(r.travel_hours || 0);
      absence += Number(r.absence_hours || 0);
      if (Number(r.normal_hours || 0) > 0) worked++;
    });
    return { normal, extra, travel, absence, worked };
  }, [rows]);

  const validation = useMemo(() => {
    const items = rows.map((r) => validateRow(r));
    const errors = items.flatMap((v, idx) => v.errors.map((e) => ({ idx, msg: e, type: "error" })));
    const warnings = items.flatMap((v, idx) => v.warnings.map((e) => ({ idx, msg: e, type: "warning" })));
    return { errors, warnings, perRow: items };
  }, [rows]);

  const canSave = rows.length > 0 && validation.errors.length === 0 && meta.month && meta.year && meta.employee_name;

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      const tsRes = await (async () => {
        try {
          return await base44.entities.Timesheet.create(payload.timesheetPayload);
        } catch (err) {
          if (err && err.status === 409) {
            const period = `${payload.timesheetPayload.month} ${payload.timesheetPayload.year}`.trim();
            const employeeLabel = payload.timesheetPayload.employee_number
              ? `${payload.timesheetPayload.employee_name} (Nº ${payload.timesheetPayload.employee_number})`
              : payload.timesheetPayload.employee_name;
            const ok = await requestReplaceConfirmation({ period, employeeLabel });
            if (!ok) throw new Error("Substituição cancelada pelo utilizador.");
            return base44.entities.Timesheet.create({ ...payload.timesheetPayload, replace: true });
          }
          throw err;
        }
      })();

      const tsId = tsRes?.id;
      const recordsToCreate = payload.records.map((r) => ({
        ...(tsId ? { timesheet_id: tsId } : {}),
        ...r
      }));
      await base44.entities.TimesheetRecord.bulkCreate(recordsToCreate);

      if (importedProjects.length > 0) {
        try {
          await base44.reference.mergeProjects(importedProjects);
        } catch {
          /* non-fatal */
        }
      }
      return tsRes;
    },
    onSuccess: async (ts) => {
      await Promise.all([
        queryClientInstance.invalidateQueries({ queryKey: ["timesheets"] }),
        queryClientInstance.invalidateQueries({ queryKey: ["timesheet-records", "all"] }),
        queryClientInstance.invalidateQueries({ queryKey: ["timesheet-config"] }),
        queryClientInstance.invalidateQueries({ queryKey: ["projects"] })
      ]);
      if (ts?.id) {
        try { localStorage.setItem("atm.selectedTimesheetId", ts.id); } catch { /* ignore */ }
      }
      toast({ title: "Folha de ponto guardada", description: `${rows.length} registos salvos com sucesso.` });
      setTimeout(() => navigate("/"), 1000);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast({ variant: "destructive", title: "Falha ao guardar", description: message });
    }
  });

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const timesheetPayload = {
        employee_name: meta.employee_name,
        employee_number: meta.employee_number || "",
        month: meta.month,
        year: Number(meta.year) || new Date().getFullYear(),
        department: meta.department || "",
        source_filename: sourceFile?.name || `${meta.month}-${meta.year}-preenchido.xlsx`,
        source_file_url: "",
        total_compensation_hours: totals.extra,
        total_descanso_compensatorio_hours: 0
      };

      const records = rows.map((r) => ({
        employee_name: meta.employee_name,
        employee_number: meta.employee_number || "",
        month: meta.month,
        year: Number(meta.year) || new Date().getFullYear(),
        date: r.date,
        normal_hours: Number(r.normal_hours || 0),
        extra_hours: Number(r.extra_hours || 0),
        travel_hours: Number(r.travel_hours || 0),
        absence_hours: Number(r.absence_hours || 0),
        day_type: r.day_type || "",
        absence_type: r.absence_type || "",
        project_number: r.project_number || "",
        project_client: r.project_client || "",
        project_description: r.project_description || "",
        compensated: false,
        period_start: r.period_start || "",
        period_end: r.period_end || "",
        pause_hours: Number(r.pause_hours || 0),
        status: "normal",
        observations: meta.department || ""
      }));

      await saveMutation.mutateAsync({ timesheetPayload, records });
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    setExporting(true);
    try {
      const blob = exportTimesheetToExcel({ meta, rows, projects: allProjects });
      const safeName = clean(meta.employee_name)
        .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
        .replace(/\s+/g, "_")
        .slice(0, 60) || "Colaborador";
      const safeMonth = clean(meta.month) || "Mes";
      const filename = `${safeName}_TimeSheet_${safeMonth}_${meta.year || ""}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const hasGrid = rows.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Preencher Folha de Ponto</h2>
          <p className="text-sm text-muted-foreground">
            Faça upload de um time sheet para auto-preenchimento ou comece do zero — editável, com cálculo automático.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Carregar Excel
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={!hasGrid || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar Excel
          </Button>
          <Button type="button" size="sm" className="gap-2" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar Folha
          </Button>
        </div>
      </div>

      {parseError && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{parseError}</p>
          <button type="button" className="ml-auto rounded-md p-1 text-red-500 hover:bg-red-100" onClick={() => setParseError("")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!hasGrid && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="cursor-pointer rounded-2xl border-2 border-dashed border-border bg-card p-10 text-center transition-all hover:border-primary/50 hover:bg-accent/30"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            {parsing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />}
          </div>
          <p className="mt-4 text-sm font-semibold text-foreground">
            Arraste o Excel aqui ou clique para selecionar
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            O ficheiro é lido localmente no browser — os dados só são gravados quando carregar em "Guardar Folha".
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>ou</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Select value={meta.month} onValueChange={(v) => setMeta((m) => ({ ...m, month: v }))}>
              <SelectTrigger className="w-[160px] bg-white" onClick={(e) => e.stopPropagation()}>
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES_PT.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={2020}
              max={2100}
              value={meta.year || ""}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setMeta((m) => ({ ...m, year: Number(e.target.value) || m.year }))}
              className="w-[110px] bg-white"
              placeholder="Ano"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                if (!meta.month || !meta.year) {
                  setParseError("Selecione mês e ano para começar do zero.");
                  return;
                }
                setRows(buildMonthGrid(meta.month, Number(meta.year)));
              }}
            >
              Começar do zero
            </Button>
          </div>
        </div>
      )}

      {hasGrid && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserSquare2 className="h-4 w-4 text-primary" />
            Identificação
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nº Colaborador</Label>
              <Input value={meta.employee_number} onChange={(e) => setMeta((m) => ({ ...m, employee_number: e.target.value }))} placeholder="63001366" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome</Label>
              <Input value={meta.employee_name} onChange={(e) => setMeta((m) => ({ ...m, employee_name: e.target.value }))} placeholder="Nome do colaborador" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Função</Label>
              <Input value={meta.funcao} onChange={(e) => setMeta((m) => ({ ...m, funcao: e.target.value }))} placeholder="Assistente de Manutenção" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Departamento</Label>
              <Input value={meta.department} onChange={(e) => setMeta((m) => ({ ...m, department: e.target.value }))} placeholder="Equipas Móveis Serviços Norte" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Direção / ACE</Label>
              <Input value={meta.direcao} onChange={(e) => setMeta((m) => ({ ...m, direcao: e.target.value }))} placeholder="Serviços" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Centro de Custo</Label>
              <Input value={meta.centro_custo} onChange={(e) => setMeta((m) => ({ ...m, centro_custo: e.target.value }))} placeholder="003SER04" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Mês</Label>
              <Select value={meta.month} onValueChange={(v) => setMeta((m) => ({ ...m, month: v }))}>
                <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES_PT.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Ano</Label>
              <Input
                type="number"
                min={2020}
                max={2100}
                value={meta.year || ""}
                onChange={(e) => setMeta((m) => ({ ...m, year: Number(e.target.value) || m.year }))}
              />
            </div>
          </div>
        </div>
      )}

      {hasGrid && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard icon={Clock} label="Total Normais" value={formatHours(totals.normal)} accent="#16A34A" hint={`${totals.worked} dia(s) trabalhado(s)`} />
          <SummaryCard icon={ClipboardList} label="Total Extras" value={formatHours(totals.extra)} accent="#F5A623" hint="Horas suplementares" />
          <SummaryCard icon={Plane} label="Total Viagem" value={formatHours(totals.travel)} accent="#4ECDC4" />
          <SummaryCard icon={CalendarIcon} label="Total Ausências" value={formatHours(totals.absence)} accent="#B8A9E8" />
        </div>
      )}

      {hasGrid && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-2">
          {validation.errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-red-700">{validation.errors.length} erro(s) impedem o envio</p>
                  <ul className="space-y-0.5 text-xs text-red-700/90">
                    {validation.errors.slice(0, 6).map((e, i) => (
                      <li key={i}>Dia {rows[e.idx]?.day}: {e.msg}</li>
                    ))}
                    {validation.errors.length > 6 && <li>…e mais {validation.errors.length - 6}.</li>}
                  </ul>
                </div>
              </div>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-amber-700">{validation.warnings.length} aviso(s)</p>
                  <ul className="space-y-0.5 text-xs text-amber-700/90">
                    {validation.warnings.slice(0, 6).map((e, i) => (
                      <li key={i}>Dia {rows[e.idx]?.day}: {e.msg}</li>
                    ))}
                    {validation.warnings.length > 6 && <li>…e mais {validation.warnings.length - 6}.</li>}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {hasGrid && (
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                Registos diários — {meta.month} {meta.year}
              </h3>
              <p className="text-xs text-muted-foreground">{rows.length} dia(s) · {allProjects.length} projeto(s) no catálogo</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={clearMonth}>
                <Eraser className="h-4 w-4" />
                Limpar mês
              </Button>
            </div>
          </div>

          <div className="divide-y divide-border md:hidden">
            {rows.map((row, idx) => {
              const v = validation.perRow[idx];
              const accent = dayTypeAccent(row.day_type);
              return (
                <details key={row.date} className="group" open={activeRowIdx === idx} onToggle={(e) => e.target.open && setActiveRowIdx(idx)}>
                  <summary className="flex cursor-pointer items-center gap-3 px-5 py-3.5 hover:bg-secondary/30">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${accent.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {row.weekday} {String(row.day).padStart(2, "0")}/{row.date.slice(5, 7)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{row.day_type}{row.project_client ? ` · ${row.project_client}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-foreground">{formatHours(row.normal_hours)}h</p>
                      {Number(row.extra_hours || 0) > 0 && (
                        <p className="text-[11px] font-medium tabular-nums text-amber-600">+{formatHours(row.extra_hours)}h extra</p>
                      )}
                    </div>
                    {v.errors.length > 0 && <AlertCircle className="h-4 w-4 text-red-500" />}
                    {v.errors.length === 0 && v.warnings.length > 0 && <TriangleAlert className="h-4 w-4 text-amber-500" />}
                  </summary>
                  <RowEditor
                    row={row}
                    index={idx}
                    onPatch={patchRow}
                    onClear={() => clearRow(idx)}
                    onCopyPrev={() => copyPreviousRow(idx)}
                    canCopyPrev={idx > 0}
                    projectCodes={allProjects}
                  />
                </details>
              );
            })}
          </div>

          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="sticky left-0 z-10 w-[110px] bg-secondary/40 px-3 py-2 text-left">Dia</th>
                    <th className="w-[70px] px-2 py-2 text-center">Normais</th>
                    <th className="w-[90px] px-2 py-2 text-center">Entrada</th>
                    <th className="w-[90px] px-2 py-2 text-center">Saída</th>
                    <th className="w-[80px] px-2 py-2 text-center">Pausa</th>
                    <th className="w-[70px] px-2 py-2 text-center">Extras</th>
                    <th className="w-[90px] px-2 py-2 text-center">1º HE de</th>
                    <th className="w-[90px] px-2 py-2 text-center">1º HE a</th>
                    <th className="w-[90px] px-2 py-2 text-center">2º HE de</th>
                    <th className="w-[90px] px-2 py-2 text-center">2º HE a</th>
                    <th className="w-[130px] px-2 py-2 text-left">Tipo Dia</th>
                    <th className="min-w-[150px] px-2 py-2 text-left">Nº Projeto</th>
                    <th className="min-w-[160px] px-2 py-2 text-left">Cliente</th>
                    <th className="min-w-[200px] px-2 py-2 text-left">Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const v = validation.perRow[idx];
                    const hasError = v.errors.length > 0;
                    const hasWarn = v.warnings.length > 0;
                    const accent = dayTypeAccent(row.day_type);
                    const isWeekend = row.isWeekend;
                    return (
                      <tr
                        key={row.date}
                        className={`border-b border-border transition-colors hover:bg-secondary/30 ${isWeekend ? "bg-amber-50/30" : ""} ${hasError ? "bg-red-50/50" : ""}`}
                      >
                        <td className="sticky left-0 z-10 bg-card px-3 py-2 text-left">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${accent.dot}`} />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {row.weekday} {String(row.day).padStart(2, "0")}/{row.date.slice(5, 7)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{row.date}</p>
                            </div>
                            {hasError && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
                            {!hasError && hasWarn && <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="inline-flex h-9 w-full items-center justify-center rounded-md bg-secondary/60 text-sm font-semibold tabular-nums text-foreground">
                            {formatHours(row.normal_hours)}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.period_start} onChange={(v) => patchRow(idx, { period_start: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.period_end} onChange={(v) => patchRow(idx, { period_end: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.pause_hours ? formatHHMMFromHours(row.pause_hours) : ""} onChange={(v) => patchRow(idx, { pause_hours: parseHHMMOrNumber(v) })} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-flex h-9 w-full items-center justify-center rounded-md text-sm font-semibold tabular-nums ${Number(row.extra_hours || 0) > 0 ? "bg-amber-100 text-amber-700" : "bg-secondary/60 text-muted-foreground"}`}>
                            {formatHours(row.extra_hours)}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.extra1_start} onChange={(v) => patchRow(idx, { extra1_start: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.extra1_end} onChange={(v) => patchRow(idx, { extra1_end: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.extra2_start} onChange={(v) => patchRow(idx, { extra2_start: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <TimeInput value={row.extra2_end} onChange={(v) => patchRow(idx, { extra2_end: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <Select value={row.day_type || "Dia Útil"} onValueChange={(v) => patchRow(idx, { day_type: v }, { skipRecompute: true })}>
                            <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DAY_TYPES.map((d) => (
                                <SelectItem key={d} value={d}>{d}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            list="project-codes"
                            value={row.project_number || ""}
                            onChange={(e) => patchRow(idx, { project_number: e.target.value })}
                            placeholder="Ex.: 260042-001"
                            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm font-medium tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.project_client || ""}
                            onChange={(e) => patchRow(idx, { project_client: e.target.value }, { skipRecompute: true })}
                            placeholder="(auto)"
                            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.project_description || ""}
                            onChange={(e) => patchRow(idx, { project_description: e.target.value }, { skipRecompute: true })}
                            placeholder="(auto)"
                            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-secondary/50 text-sm font-semibold">
                    <td className="sticky left-0 z-10 bg-secondary/70 px-3 py-2 text-foreground">TOTAL</td>
                    <td className="px-2 py-2 text-center tabular-nums text-foreground">{formatHours(totals.normal)}</td>
                    <td colSpan={3} />
                    <td className="px-2 py-2 text-center tabular-nums text-amber-700">{formatHours(totals.extra)}</td>
                    <td colSpan={8} />
                  </tr>
                </tfoot>
              </table>

              <datalist id="project-codes">
                {allProjects.map((p) => (
                  <option key={p.code} value={p.code}>{p.client || ""} {p.description ? `— ${p.description}` : ""}</option>
                ))}
              </datalist>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && confirmOpen) resolveReplaceConfirmation(false);
          else setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir folha de ponto?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe uma folha de ponto guardada de <strong>{confirmInfo.period}</strong> para{" "}
              <strong>{confirmInfo.employeeLabel}</strong>.
              <br />
              <br />
              Pretende substituir? Isto irá apagar o registo anterior desse mês.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveReplaceConfirmation(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => resolveReplaceConfirmation(true)}>
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
