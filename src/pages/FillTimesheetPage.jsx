/* eslint-disable react/no-unescaped-entities */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  Calendar as CalendarIcon,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  Copy,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { queryClientInstance } from "@/lib/query-client";
import { formatHours } from "@/lib/formatHours";
import {
  MONTH_NAMES_PT,
  buildMonthGrid,
  exportTimesheetToExcel,
  readTimesheetFile,
  recomputeRow,
  validateRow,
  fillTimesheetTemplate
} from "@/lib/parseTimesheetClient";

const DAY_TYPES = ["Dia Útil", "Desc.Comp", "Desc. Obrig", "Feriado"];

const ABSENCE_TYPES = [
  { value: "", label: "— Nenhuma —" },
  { value: "1110 Férias (dia)", label: "1110 Férias (dia)" },
  { value: "1120 Folga Descan. Compensatório (dia)", label: "1120 Folga Desc. Comp. (dia)" },
  { value: "1120H Folga Descan. Compensatório (hora)", label: "1120H Folga Desc. Comp. (hora)" },
  { value: "1121 Folga Descan. Obrigatório (dia)", label: "1121 Folga Desc. Obrig. (dia)" },
  { value: "1121H Folga Descan. Obrigatório (hora)", label: "1121H Folga Desc. Obrig. (hora)" },
  { value: "1130 Tolerância de Ponto", label: "1130 Tolerância de Ponto" },
  { value: "1140 Dispensa Comparência Serviço", label: "1140 Dispensa Comparência" },
  { value: "1170 Insp.Médica-Serv.Medicina", label: "1170 Insp. Médica" },
  { value: "2111 Delegado Sindical", label: "2111 Delegado Sindical" },
  { value: "2120 Trabalhador Estudante", label: "2120 Trab. Estudante" },
  { value: "2131 Consulta Médica-Acid.Trb. (dia)", label: "2131 Consulta Médica Acid. (dia)" },
  { value: "2131H Consulta Médica-Acid.Trb. (hora)", label: "2131H Consulta Médica Acid. (hora)" },
  { value: "2150 Nojo (Cônj+1ºG L.Rect)", label: "2150 Nojo (Cônj+1ºG)" },
  { value: "2151 Nojo (L.Recta+2ºG L.Colat.)", label: "2151 Nojo (2ºG)" },
  { value: "2155 Licença de Casamento", label: "2155 Licença Casamento" },
  { value: "2170 Acid. Trabalho (1º dia) (dia)", label: "2170 Acid. Trabalho (dia)" },
  { value: "2190 Ausência Justif. Remunerada (dia)", label: "2190 Ausência Justif. Rem. (dia)" },
  { value: "2190H Ausência Justif. Remunerada (hora)", label: "2190H Ausência Justif. Rem. (hora)" },
  { value: "2230 Consulta Médica NR (dia)", label: "2230 Consulta Médica NR (dia)" },
  { value: "2230H Consulta Médica NR (hora)", label: "2230H Consulta Médica NR (hora)" },
  { value: "2240 Ass. Inad. Família NR (dia)", label: "2240 Ass. Inad. Família (dia)" },
  { value: "2290 Ausência Justificada NR (dia)", label: "2290 Ausência Justif. NR (dia)" },
  { value: "2292 Ausência Injustificada (dia)", label: "2292 Ausência Injustificada (dia)" },
  { value: "Baixa Doença", label: "Baixa Doença" },
  { value: "Baixa Acid. Trabalho", label: "Baixa Acid. Trabalho" },
  { value: "Baixa Assist. Família", label: "Baixa Assist. Família" },
  { value: "Licença Maternidade", label: "Licença Maternidade" },
  { value: "Licença Paternidade", label: "Licença Paternidade" },
];

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
  email_nivel2: "",
  empresa: "6300",
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

/* ------------------------------------------------------------------ */
/* ComboBox — searchable select                                        */
/* ------------------------------------------------------------------ */

function ComboBox({ value, onChange, options, placeholder, className, emptyText, disabled }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={`h-8 w-full justify-between px-2 text-xs font-normal ${className || ""}`}
        >
          <span className={`truncate ${!selected?.label ? "text-muted-foreground" : ""}`}>
            {selected?.label || placeholder || "Selecionar..."}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Procurar..." />
          <CommandList>
            <CommandEmpty>{emptyText || "Nenhum resultado."}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.label || opt.value}
                  onSelect={() => {
                    onChange(opt.value === value ? "" : opt.value);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-3.5 w-3.5 ${opt.value === value ? "opacity-100" : "opacity-0"}`} />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Project ComboBox — searchable project selector                       */
/* ------------------------------------------------------------------ */

function ProjectComboBox({ value, onChange, projects, disabled }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(() => {
    return projects.map((p) => ({
      value: p.code,
      label: `${p.code} — ${p.client || ""}${p.description ? ` · ${p.description}` : ""}`.trim(),
      client: p.client,
      description: p.description
    }));
  }, [projects]);

  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 50);
    const s = search.toLowerCase();
    return options.filter(
      (o) => o.value.toLowerCase().includes(s) || o.label.toLowerCase().includes(s)
    ).slice(0, 50);
  }, [options, search]);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-8 w-full justify-between px-2 font-mono text-[11px] font-normal"
        >
          <span className={`truncate ${!selected?.value ? "text-muted-foreground" : ""}`}>
            {selected?.value || "Projeto..."}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Procurar projeto..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Nenhum projeto encontrado.</CommandEmpty>
            <CommandGroup>
              {filtered.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  onSelect={() => {
                    onChange(opt.value, { client: opt.client, description: opt.description });
                    setOpen(false);
                    setSearch("");
                  }}
                  className="flex flex-col items-start py-1.5"
                >
                  <span className="text-[11px] font-mono font-semibold">{opt.value}</span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-full">
                    {opt.client}{opt.description ? ` · ${opt.description}` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      {hint && <p className="mt-1 text-[11px] font-medium text-gray-600">{hint}</p>}
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

function RowEditor({ row, index, onPatch, onClear, onCopyPrev, onFillDown, canCopyPrev, canFillDown, projectCodes }) {
  const dayTypeOpts = DAY_TYPES.map((d) => ({ value: d, label: d }));
  const accent = dayTypeAccent(row.day_type);
  return (
    <div className="space-y-3 bg-gray-50/80 px-5 py-4 border-t border-gray-100">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Entrada</Label>
          <TimeInput value={row.period_start} onChange={(v) => onPatch(index, { period_start: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Saída</Label>
          <TimeInput value={row.period_end} onChange={(v) => onPatch(index, { period_end: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Pausa (hh:mm)</Label>
          <TimeInput value={row.pause_hours ? formatHHMMFromHours(row.pause_hours) : ""} onChange={(v) => onPatch(index, { pause_hours: parseHHMMOrNumber(v) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tipo de Dia</Label>
          <ComboBox value={row.day_type || "Dia Útil"} onChange={(v) => onPatch(index, { day_type: v }, { skipRecompute: true })} options={dayTypeOpts} placeholder="Dia Útil" />
        </div>
      </div>

      {/* Extra hours */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-600">⚡ Horas Extra</p>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-amber-600">1º Período de</Label>
            <TimeInput value={row.extra1_start} onChange={(v) => onPatch(index, { extra1_start: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-amber-600">1º Período a</Label>
            <TimeInput value={row.extra1_end} onChange={(v) => onPatch(index, { extra1_end: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-amber-600">2º Período de</Label>
            <TimeInput value={row.extra2_start} onChange={(v) => onPatch(index, { extra2_start: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-amber-600">2º Período a</Label>
            <TimeInput value={row.extra2_end} onChange={(v) => onPatch(index, { extra2_end: v })} />
          </div>
        </div>
      </div>

      {/* Project */}
      <div className="space-y-1">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Nº Projeto</Label>
        <ProjectComboBox
          value={row.project_number || ""}
          onChange={(code, info) => onPatch(index, { project_number: code, project_client: info?.client || "", project_description: info?.description || "" })}
          projects={projectCodes}
        />
      </div>

      {/* Client & Description */}
      <div className="grid grid-cols-1 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-[8px] uppercase text-muted-foreground">Cliente</Label>
          <Input value={row.project_client || ""} onChange={(e) => onPatch(index, { project_client: e.target.value }, { skipRecompute: true })} placeholder="(auto)" className="h-8 text-xs" />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[8px] uppercase text-muted-foreground">Descrição</Label>
          <Input value={row.project_description || ""} onChange={(e) => onPatch(index, { project_description: e.target.value }, { skipRecompute: true })} placeholder="(auto)" className="h-8 text-xs" />
        </div>
      </div>

      {/* Absence */}
      <div className="space-y-1">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Ausência</Label>
        <ComboBox value={row.absence_type || ""} onChange={(v) => onPatch(index, { absence_type: v }, { skipRecompute: true })} options={ABSENCE_TYPES} placeholder="Sem ausência" />
      </div>

      {/* Checkboxes */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
          <input type="checkbox" checked={!!row.subsidio_almoco} onChange={(e) => onPatch(index, { subsidio_almoco: e.target.checked }, { skipRecompute: true })} className="h-3.5 w-3.5 rounded border-border accent-emerald-600" />
          S.Alim.
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
          <input type="checkbox" checked={!!row.prevencao} onChange={(e) => onPatch(index, { prevencao: e.target.checked }, { skipRecompute: true })} className="h-3.5 w-3.5 rounded border-border accent-amber-600" />
          Prevenção
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
          <input type="checkbox" checked={!!row.deslocado} onChange={(e) => onPatch(index, { deslocado: e.target.checked }, { skipRecompute: true })} className="h-3.5 w-3.5 rounded border-border accent-purple-600" />
          Deslocado
        </label>
      </div>

      {/* Observations */}
      <div className="space-y-0.5">
        <Label className="text-[8px] uppercase text-muted-foreground">Observações</Label>
        <Input value={row.observacoes || ""} onChange={(e) => onPatch(index, { observacoes: e.target.value }, { skipRecompute: true })} placeholder="..." className="h-8 text-xs" />
      </div>

      {/* Calculated + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="text-[11px] font-medium text-gray-600">
          Calculado: <span className="font-bold text-gray-900">{formatHours(row.normal_hours)}h</span> normais
          {Number(row.extra_hours || 0) > 0 && (
            <span> · <span className="font-bold text-amber-700">{formatHours(row.extra_hours)}h</span> extras</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={!canCopyPrev} onClick={onCopyPrev} className="text-[11px] h-8 font-medium">📋 Copiar anterior</Button>
          {canFillDown && <Button type="button" variant="ghost" size="sm" onClick={onFillDown} className="text-[11px] h-8 font-medium"><ArrowDown className="mr-1 h-3.5 w-3.5" />Preencher abaixo</Button>}
          <Button type="button" variant="ghost" size="sm" className="text-[11px] h-8 font-medium text-red-600 hover:bg-red-50" onClick={onClear}><Eraser className="mr-1 h-3.5 w-3.5" />Limpar</Button>
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

  const previousTimesheetsQuery = useQuery({
    queryKey: ["timesheets"],
    queryFn: () => base44.entities.Timesheet.list(200),
    staleTime: 60_000
  });

  const catalogProjects = useMemo(() => {
    const list = Array.isArray(projectsQuery.data?.projects) ? projectsQuery.data.projects : [];
    return list.map((p) => ({
      code: clean(p.code),
      description: clean(p.description),
      client: clean(p.client)
    }));
  }, [projectsQuery.data]);

  const previousTimesheets = useMemo(() => {
    return Array.isArray(previousTimesheetsQuery.data) ? previousTimesheetsQuery.data : [];
  }, [previousTimesheetsQuery.data]);

  const previousEmployees = useMemo(() => {
    const map = new Map();
    previousTimesheets.forEach((ts) => {
      const name = clean(ts.employee_name);
      if (!name) return;
      const key = name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          employee_name: name,
          employee_number: clean(ts.employee_number),
          department: clean(ts.department),
          funcao: clean(ts.funcao),
          direcao: clean(ts.direcao),
          centro_custo: clean(ts.centro_custo),
        });
      }
    });
    return Array.from(map.values());
  }, [previousTimesheets]);

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

  // Auto-fill employee data from last selected timesheet
  useEffect(() => {
    try {
      const lastTsId = localStorage.getItem("atm.selectedTimesheetId");
      if (lastTsId && previousTimesheets.length > 0 && !meta.employee_name) {
        const ts = previousTimesheets.find((t) => t.id === lastTsId);
        if (ts) {
          setMeta((m) => ({
            ...m,
            employee_name: clean(ts.employee_name) || m.employee_name,
            employee_number: clean(ts.employee_number) || m.employee_number,
            department: clean(ts.department) || m.department,
            funcao: clean(ts.funcao) || m.funcao,
            direcao: clean(ts.direcao) || m.direcao,
            centro_custo: clean(ts.centro_custo) || m.centro_custo,
          }));
        }
      }
    } catch { /* ignore */ }
  }, [previousTimesheets]);

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
        title: "Template carregado",
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

  function fillDownFromRow(index) {
    setRows((prev) => {
      const next = [...prev];
      const src = next[index];
      for (let i = index + 1; i < next.length; i++) {
        const slot = next[i];
        if (!slot.isWeekend && !slot.period_start) {
          next[i] = recomputeRow({
            ...slot,
            project_number: src.project_number,
            project_client: src.project_client,
            project_description: src.project_description,
            period_start: src.period_start,
            period_end: src.period_end,
            pause_hours: src.pause_hours,
            day_type: slot.isWeekend ? slot.day_type : src.day_type,
          });
        }
      }
      return next;
    });
    toast({ title: "Preenchimento automático", description: "Horário e projeto copiados para os dias úteis seguintes." });
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
      toast({ title: "Folha de ponto guardada", description: `Excel exportado e ${rows.length} registos salvos no histórico.` });
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
          <Button type="button" variant="outline" size="sm" className="gap-1.5 h-9 text-xs font-medium border-gray-200 hover:bg-gray-50 hover:border-gray-300" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Carregar Excel
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-1.5 h-9 text-xs font-medium border-gray-200 hover:bg-gray-50 hover:border-gray-300" onClick={handleExport} disabled={!hasGrid || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar Excel
          </Button>
          <Button type="button" size="sm" className="gap-1.5 h-9 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar & Exportar
          </Button>
        </div>
      </div>

      {parseError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50/90 p-4">
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
          className="cursor-pointer rounded-xl border-2 border-dashed border-gray-200 bg-white p-10 text-center transition-all hover:border-red-300 hover:bg-red-50/30"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            {parsing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />}
          </div>
          <p className="mt-4 text-sm font-bold text-gray-900">
            Arraste o Excel aqui ou clique para selecionar
          </p>
          <p className="mt-1 text-[11px] font-medium text-gray-600">
            O ficheiro é lido localmente no browser — os dados só são gravados quando carregar em "Guardar & Exportar".
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-medium text-gray-600">
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
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
              <UserSquare2 className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Identificação do Colaborador</h3>
              <p className="text-[11px] text-gray-500">Dados para a folha de imputação</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Nº Colaborador</Label>
              <Input value={meta.employee_number} onChange={(e) => setMeta((m) => ({ ...m, employee_number: e.target.value }))} placeholder="63001366" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Nome</Label>
              <div className="flex gap-1.5">
                <Input value={meta.employee_name} onChange={(e) => setMeta((m) => ({ ...m, employee_name: e.target.value }))} placeholder="Nome do colaborador" className="flex-1 bg-gray-50 border-gray-200 focus:bg-white" />
                {previousEmployees.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" title="Carregar do histórico">
                        <UserSquare2 className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[360px] p-0" align="end">
                      <Command>
                        <CommandInput placeholder="Procurar colaborador..." />
                        <CommandList>
                          <CommandEmpty>Nenhum colaborador no histórico.</CommandEmpty>
                          <CommandGroup heading="Colaboradores anteriores">
                            {previousEmployees.map((emp) => (
                              <CommandItem
                                key={emp.employee_name}
                                value={emp.employee_name}
                                onSelect={() => {
                                  setMeta((m) => ({
                                    ...m,
                                    employee_name: emp.employee_name,
                                    employee_number: emp.employee_number,
                                    department: emp.department,
                                    funcao: emp.funcao,
                                    direcao: emp.direcao,
                                    centro_custo: emp.centro_custo,
                                  }));
                                }}
                                className="flex flex-col items-start py-2"
                              >
                                <span className="text-sm font-semibold">{emp.employee_name}</span>
                                <span className="text-[11px] font-medium text-gray-600">
                                  Nº {emp.employee_number} · {emp.department}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Função</Label>
              <Input value={meta.funcao} onChange={(e) => setMeta((m) => ({ ...m, funcao: e.target.value }))} placeholder="Assistente de Manutenção" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Departamento</Label>
              <Input value={meta.department} onChange={(e) => setMeta((m) => ({ ...m, department: e.target.value }))} placeholder="Equipas Móveis Serviços Norte" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Direção / ACE</Label>
              <Input value={meta.direcao} onChange={(e) => setMeta((m) => ({ ...m, direcao: e.target.value }))} placeholder="Serviços" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Centro de Custo</Label>
              <Input value={meta.centro_custo} onChange={(e) => setMeta((m) => ({ ...m, centro_custo: e.target.value }))} placeholder="003SER04" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Mês</Label>
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
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Ano</Label>
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
      {hasGrid && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-1">
          <SummaryCard icon={Clock} label="Total Normais" value={formatHours(totals.normal)} accent="#16A34A" hint={`${totals.worked} dia(s) trabalhado(s)`} />
          <SummaryCard icon={ClipboardList} label="Total Extras" value={formatHours(totals.extra)} accent="#F5A623" hint="Horas suplementares" />
          <SummaryCard icon={Plane} label="Total Viagem" value={formatHours(totals.travel)} accent="#4ECDC4" />
          <SummaryCard icon={CalendarIcon} label="Total Ausências" value={formatHours(totals.absence)} accent="#B8A9E8" />
        </div>
      )}

      {hasGrid && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-2">
          {validation.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/80 px-4 py-3">
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
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-amber-700">{validation.warnings.length} aviso(s)</p>
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
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-gray-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                <FileSpreadsheet className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Registos diários — {meta.month} {meta.year}</h3>
                <p className="text-[11px] text-gray-500">{rows.length} dia(s) · {allProjects.length} projeto(s) no catálogo</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 h-8 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => {
                  if (rows.length > 0 && rows[0].period_start) {
                    fillDownFromRow(0);
                  } else {
                    toast({ title: "Sem dados", description: "Preencha o primeiro dia primeiro." });
                  }
                }}>
                <ArrowDown className="h-3.5 w-3.5" />
                Preencher todos
              </Button>
<Button type="button" variant="ghost" size="sm" className="gap-1.5 h-8 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => {
            setRows((prev) => prev.map((r) => r.isWeekend ? r : { ...r, subsidio_almoco: true }));
            toast({ title: "S.Alim.", description: "Subsídio de almoço ativado para todos os dias úteis." });
          }}>
            <Check className="h-3.5 w-3.5" />
            S.Alim. todos
          </Button>
          <Button type="button" variant="ghost" size="sm" className="gap-2 h-8 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50" onClick={clearMonth}>
            <Eraser className="h-3.5 w-3.5" />
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
                      <p className="text-sm font-bold text-gray-900">
                        {row.weekday} {String(row.day).padStart(2, "0")}/{row.date.slice(5, 7)}
                      </p>
                      <p className="truncate text-[11px] font-medium text-gray-600">{row.day_type}{row.project_client ? ` · ${row.project_client}` : ""}</p>
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
                    onFillDown={() => fillDownFromRow(idx)}
                    canCopyPrev={idx > 0}
                    canFillDown={idx < rows.length - 1}
                    projectCodes={allProjects}
                  />
                </details>
              );
            })}
          </div>

          <div className="hidden md:block">
            {/* Excel-style table */}
            <div className="overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 250px)" }}>
              <table className="w-full border-collapse">
                {/* ── Header ── */}
                <thead className="sticky top-0 z-20">
                  <tr className="bg-gradient-to-b from-gray-50 to-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b-2 border-gray-200">
                    <th className="sticky left-0 z-30 bg-gradient-to-b from-gray-50 to-gray-100 px-3 py-2.5 text-left w-[120px] border-r border-gray-200">
                      <span className="flex items-center gap-2">
                        <CalendarIcon className="h-3.5 w-3.5 text-red-500" />
                        Dia
                      </span>
                    </th>
                    <th className="px-2 py-2.5 text-center w-[70px] border-r border-gray-100">Horas</th>
                    <th className="px-2 py-2.5 text-center w-[75px] border-r border-gray-100">Entrada</th>
                    <th className="px-2 py-2.5 text-center w-[75px] border-r border-gray-100">Saída</th>
                    <th className="px-2 py-2.5 text-center w-[65px] border-r border-gray-200">Pausa</th>
                    <th className="px-2 py-2.5 text-center w-[70px] bg-amber-50/60 text-amber-700 border-r border-gray-200">Extra</th>
                    <th className="px-2 py-2.5 text-center w-[170px] border-r border-gray-200">Tipo Dia</th>
                    <th className="px-2 py-2.5 text-left w-[170px] border-r border-gray-200">Ausência</th>
                    <th className="px-2 py-2.5 text-center w-[65px] bg-cyan-50/60 text-cyan-700 border-r border-gray-200">Viagem</th>
                    <th className="px-2 py-2.5 text-left w-[155px] border-r border-gray-100">Nº Projeto</th>
                    <th className="px-2 py-2.5 text-left w-[180px] border-r border-gray-200">Cliente / Descrição</th>
                    <th className="px-2 py-2.5 text-center w-[48px] border-r border-gray-100">S.Al</th>
                    <th className="px-2 py-2.5 text-center w-[48px] border-r border-gray-100">Prev</th>
                    <th className="px-2 py-2.5 text-center w-[48px] border-r border-gray-200">Desl</th>
                    <th className="px-2 py-2.5 text-left w-[130px] border-r border-gray-200">Observações</th>
                    <th className="px-2 py-2.5 text-center w-[120px]">Ações</th>
                  </tr>
                </thead>

                {/* ── Body ── */}
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, idx) => {
                    const v = validation.perRow[idx];
                    const hasError = v.errors.length > 0;
                    const hasWarn = v.warnings.length > 0;
                    const accent = dayTypeAccent(row.day_type);
                    const isWeekend = row.isWeekend;
                    const dayTypeOpts = DAY_TYPES.map((d) => ({ value: d, label: d }));
                    const rowBg = isWeekend ? "bg-amber-50/40" : (idx % 2 === 0 ? "bg-white" : "bg-gray-50/30");
                    const hasHours = Number(row.normal_hours || 0) > 0;
                    const hasExtra = Number(row.extra_hours || 0) > 0;
                    const hasTravel = Number(row.travel_hours || 0) > 0;

                    return (
                      <tr
                        key={row.date}
                        className={`group transition-all duration-75 hover:bg-blue-50/50 ${rowBg} ${hasError ? "!bg-red-50/60" : ""} ${hasHours ? "" : ""}`}
                      >
                        {/* Day */}
                        <td className={`sticky left-0 z-10 px-3 py-2 border-r border-gray-200 ${rowBg} ${hasError ? "!bg-red-50/60" : ""}`}>
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${accent.dot} ring-2 ring-offset-1 ${accent.dot === "bg-red-500" ? "ring-red-200" : accent.dot === "bg-amber-500" ? "ring-amber-200" : accent.dot === "bg-purple-500" ? "ring-purple-200" : "ring-emerald-200"}`} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-gray-800">{row.weekday}</span>
                                <span className="text-[11px] font-mono font-semibold text-gray-500">{String(row.day).padStart(2, "0")}/{row.date.slice(5, 7)}</span>
                              </div>
                              <span className="text-[9px] text-gray-400">{row.date.slice(0, 4)}</span>
                            </div>
                            {hasError && <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 ml-auto" />}
                            {!hasError && hasWarn && <TriangleAlert className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 ml-auto" />}
                          </div>
                        </td>

                        {/* Hours (normal) */}
                        <td className="px-2 py-2 text-center border-r border-gray-100">
                          <span className={`inline-flex items-center justify-center min-w-[44px] h-7 px-2 rounded-md text-xs font-bold tabular-nums transition-colors ${
                            hasHours ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200" : "text-gray-300"
                          }`}>
                            {hasHours ? formatHours(row.normal_hours) : "—"}
                          </span>
                        </td>

                        {/* Entry */}
                        <td className="px-1.5 py-2 border-r border-gray-100">
                          <TimeInput value={row.period_start} onChange={(v) => patchRow(idx, { period_start: v })} />
                        </td>

                        {/* Exit */}
                        <td className="px-1.5 py-2 border-r border-gray-100">
                          <TimeInput value={row.period_end} onChange={(v) => patchRow(idx, { period_end: v })} />
                        </td>

                        {/* Pause */}
                        <td className="px-1.5 py-2 border-r border-gray-200">
                          <TimeInput value={row.pause_hours ? formatHHMMFromHours(row.pause_hours) : ""} onChange={(v) => patchRow(idx, { pause_hours: parseHHMMOrNumber(v) })} />
                        </td>

                        {/* Extra hours */}
                        <td className="px-2 py-2 text-center border-r border-gray-200 bg-amber-50/20">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`inline-flex items-center justify-center min-w-[44px] h-7 px-2 rounded-md text-xs font-bold tabular-nums transition-colors ${
                              hasExtra ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200" : "text-gray-300"
                            }`}>
                              {hasExtra ? formatHours(row.extra_hours) : "—"}
                            </span>
                            {hasExtra && (
                              <div className="flex items-center gap-0.5">
                                <TimeInput value={row.extra1_start} onChange={(v) => patchRow(idx, { extra1_start: v })} className="!h-5 !w-[46px] !text-[9px] !border-amber-200 !rounded-sm" />
                                <span className="text-[9px] text-gray-400">—</span>
                                <TimeInput value={row.extra1_end} onChange={(v) => patchRow(idx, { extra1_end: v })} className="!h-5 !w-[46px] !text-[9px] !border-amber-200 !rounded-sm" />
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Day type */}
                        <td className="px-1.5 py-2 border-r border-gray-200">
                          <ComboBox
                            value={row.day_type || "Dia Útil"}
                            onChange={(v) => patchRow(idx, { day_type: v }, { skipRecompute: true })}
                            options={dayTypeOpts}
                            placeholder="Dia Útil"
                          />
                        </td>

                        {/* Absence type */}
                        <td className="px-1.5 py-2 border-r border-gray-200">
                          <ComboBox
                            value={row.absence_type || ""}
                            onChange={(v) => patchRow(idx, { absence_type: v }, { skipRecompute: true })}
                            options={ABSENCE_TYPES}
                            placeholder="—"
                          />
                        </td>

                        {/* Travel hours */}
                        <td className="px-2 py-2 text-center border-r border-gray-200 bg-cyan-50/20">
                          <span className={`inline-flex items-center justify-center min-w-[44px] h-7 px-2 rounded-md text-xs font-bold tabular-nums transition-colors ${
                            hasTravel ? "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200" : "text-gray-300"
                          }`}>
                            {hasTravel ? formatHours(row.travel_hours) : "—"}
                          </span>
                        </td>

                        {/* Project number */}
                        <td className="px-1.5 py-2 border-r border-gray-100">
                          <ProjectComboBox
                            value={row.project_number || ""}
                            onChange={(code, info) => patchRow(idx, { project_number: code, project_client: info?.client || "", project_description: info?.description || "" })}
                            projects={allProjects}
                          />
                        </td>

                        {/* Client + Description merged */}
                        <td className="px-1.5 py-2 border-r border-gray-200">
                          <div className="flex flex-col gap-0.5">
                            <input
                              value={row.project_client || ""}
                              onChange={(e) => patchRow(idx, { project_client: e.target.value }, { skipRecompute: true })}
                              placeholder="Cliente"
                              className="h-6 w-full rounded border border-gray-200 bg-transparent px-1.5 text-[10px] font-medium text-gray-700 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                            />
                            <input
                              value={row.project_description || ""}
                              onChange={(e) => patchRow(idx, { project_description: e.target.value }, { skipRecompute: true })}
                              placeholder="Descrição"
                              className="h-6 w-full rounded border border-gray-200 bg-transparent px-1.5 text-[10px] text-gray-500 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                            />
                          </div>
                        </td>

                        {/* Subsidio almoco */}
                        <td className="px-1 py-2 text-center border-r border-gray-100">
                          <input type="checkbox" checked={!!row.subsidio_almoco} onChange={(e) => patchRow(idx, { subsidio_almoco: e.target.checked }, { skipRecompute: true })} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
                        </td>

                        {/* Prevencao */}
                        <td className="px-1 py-2 text-center border-r border-gray-100">
                          <input type="checkbox" checked={!!row.prevencao} onChange={(e) => patchRow(idx, { prevencao: e.target.checked }, { skipRecompute: true })} className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer" />
                        </td>

                        {/* Deslocado */}
                        <td className="px-1 py-2 text-center border-r border-gray-200">
                          <input type="checkbox" checked={!!row.deslocado} onChange={(e) => patchRow(idx, { deslocado: e.target.checked }, { skipRecompute: true })} className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                        </td>

                        {/* Observations */}
                        <td className="px-1.5 py-2 border-r border-gray-200">
                          <input
                            value={row.observacoes || ""}
                            onChange={(e) => patchRow(idx, { observacoes: e.target.value }, { skipRecompute: true })}
                            placeholder="..."
                            className="h-6 w-full rounded border border-gray-200 bg-transparent px-1.5 text-[10px] text-gray-500 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                          />
                        </td>

                        {/* Actions */}
                        <td className="px-1 py-2">
                          <div className="flex items-center justify-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                            <button type="button" disabled={idx === 0} onClick={() => copyPreviousRow(idx)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-20" title="Copiar anterior">
                              <Copy className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                            </button>
                            <button type="button" onClick={() => fillDownFromRow(idx)} className="p-1 rounded hover:bg-blue-50" title="Preencher abaixo">
                              <ArrowDown className="h-3.5 w-3.5 text-blue-400 hover:text-blue-600" />
                            </button>
                            <button type="button" onClick={() => clearRow(idx)} className="p-1 rounded hover:bg-red-50" title="Limpar">
                              <Eraser className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* ── Footer ── */}
                <tfoot>
                  <tr className="sticky bottom-0 z-20 bg-gradient-to-b from-gray-100 to-gray-200 border-t-2 border-gray-300 text-xs font-bold">
                    <td className="sticky left-0 z-30 bg-gradient-to-b from-gray-100 to-gray-200 px-3 py-2.5 text-gray-700 border-r border-gray-200">
                      <span className="flex items-center gap-2">
                        <ClipboardList className="h-3.5 w-3.5 text-red-500" />
                        TOTAL
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-emerald-700 border-r border-gray-100">{formatHours(totals.normal)}</td>
                    <td className="border-r border-gray-100" colSpan={3} />
                    <td className="px-2 py-2.5 text-center tabular-nums text-amber-700 border-r border-gray-200">{formatHours(totals.extra)}</td>
                    <td className="border-r border-gray-200" colSpan={9} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
