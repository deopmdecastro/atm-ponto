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
  LayoutGrid,
  Loader2,
  Plane,
  Save,
  Table as TableIcon,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  validateRow
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
      return { dot: "bg-violet-500" };
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
      className={`h-10 w-full rounded-md border border-border bg-card px-2 text-center text-sm font-medium tabular-nums text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-muted disabled:text-muted-foreground ${className || ""}`}
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
          className={`h-10 w-full justify-between px-2 text-xs font-normal ${className || ""}`}
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
          className="h-10 w-full justify-between px-2 font-mono text-[11px] font-normal"
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
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[11px] font-medium text-muted-foreground">{hint}</p>}
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
    <div className="space-y-3 bg-muted/40 px-5 py-4 border-t border-border">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entrada</Label>
          <TimeInput value={row.period_start} onChange={(v) => onPatch(index, { period_start: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Saída</Label>
          <TimeInput value={row.period_end} onChange={(v) => onPatch(index, { period_end: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pausa (hh:mm)</Label>
          <TimeInput value={row.pause_hours ? formatHHMMFromHours(row.pause_hours) : ""} onChange={(v) => onPatch(index, { pause_hours: parseHHMMOrNumber(v) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo de Dia</Label>
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

      {/* Travel hours */}
      <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-700">✈️ Horas de Viagem</p>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-cyan-700">1º Período de</Label>
            <TimeInput value={row.travel1_start} onChange={(v) => onPatch(index, { travel1_start: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-cyan-700">1º Período a</Label>
            <TimeInput value={row.travel1_end} onChange={(v) => onPatch(index, { travel1_end: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-cyan-700">2º Período de</Label>
            <TimeInput value={row.travel2_start} onChange={(v) => onPatch(index, { travel2_start: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[9px] font-semibold uppercase text-cyan-700">2º Período a</Label>
            <TimeInput value={row.travel2_end} onChange={(v) => onPatch(index, { travel2_end: v })} />
          </div>
        </div>
      </div>

      {/* Project */}
      <div className="space-y-1">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nº Projeto</Label>
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
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ausência</Label>
        <ComboBox value={row.absence_type || ""} onChange={(v) => onPatch(index, { absence_type: v }, { skipRecompute: true })} options={ABSENCE_TYPES} placeholder="Sem ausência" />
      </div>

      {/* Checkboxes */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <input type="checkbox" checked={!!row.subsidio_almoco} onChange={(e) => onPatch(index, { subsidio_almoco: e.target.checked }, { skipRecompute: true })} className="h-3.5 w-3.5 rounded border-border accent-emerald-600" />
          S.Alim.
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <input type="checkbox" checked={!!row.prevencao} onChange={(e) => onPatch(index, { prevencao: e.target.checked }, { skipRecompute: true })} className="h-3.5 w-3.5 rounded border-border accent-amber-600" />
          Prevenção
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
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
        <div className="text-[11px] font-medium text-muted-foreground">
          Calculado: <span className="font-bold text-foreground">{formatHours(row.normal_hours)}h</span> normais
          {Number(row.extra_hours || 0) > 0 && (
            <span> · <span className="font-bold text-amber-700">{formatHours(row.extra_hours)}h</span> extras</span>
          )}
          {Number(row.travel_hours || 0) > 0 && (
            <span> · <span className="font-bold text-cyan-700">{formatHours(row.travel_hours)}h</span> viagem</span>
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

const WEEKDAY_PT_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function CalendarMonthView({ rows, validation, onDayClick }) {
  if (!rows.length) return null;
  const leadingBlanks = WEEKDAY_PT_SHORT.indexOf(rows[0].weekday);
  const cells = [
    ...Array.from({ length: Math.max(leadingBlanks, 0) }, () => null),
    ...rows,
  ];

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAY_PT_SHORT.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((row, i) => {
          if (!row) return <div key={`blank-${i}`} />;
          const idx = rows.indexOf(row);
          const v = validation.perRow[idx];
          const accent = dayTypeAccent(row.day_type);
          const hasHours = Number(row.normal_hours || 0) > 0;
          const hasExtra = Number(row.extra_hours || 0) > 0;
          const hasTravel = Number(row.travel_hours || 0) > 0;
          return (
            <button
              type="button"
              key={row.date}
              onClick={() => onDayClick(idx)}
              className={`group relative flex min-h-[88px] flex-col items-start gap-1 rounded-lg border p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                row.isWeekend ? "bg-amber-50/40 border-amber-100" : "bg-card border-border"
              } ${v.errors.length > 0 ? "!border-red-300 !bg-red-50/50" : ""}`}
            >
              <div className="flex w-full items-center justify-between">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  hasHours ? "bg-emerald-100 text-emerald-800" : "text-muted-foreground"
                }`}>
                  {row.day}
                </span>
                <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
              </div>
              <p className="text-[10px] font-medium text-muted-foreground truncate w-full">{row.day_type}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1">
                {hasHours && (
                  <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
                    {formatHours(row.normal_hours)}h
                  </span>
                )}
                {hasExtra && (
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold tabular-nums text-amber-800">
                    +{formatHours(row.extra_hours)}h
                  </span>
                )}
                {hasTravel && (
                  <span className="rounded bg-cyan-100 px-1 py-0.5 text-[10px] font-bold tabular-nums text-cyan-800">
                    ✈ {formatHours(row.travel_hours)}h
                  </span>
                )}
              </div>
              {v.errors.length > 0 && <AlertCircle className="absolute right-1.5 top-1.5 h-3 w-3 text-red-500" />}
              {v.errors.length === 0 && v.warnings.length > 0 && <TriangleAlert className="absolute right-1.5 top-1.5 h-3 w-3 text-amber-500" />}
            </button>
          );
        })}
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
  const [viewMode, setViewMode] = useState("table"); // "table" | "calendar"
  const [calendarDayIdx, setCalendarDayIdx] = useState(null);
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [fillAllConfig, setFillAllConfig] = useState({
    period_start: "08:00",
    period_end: "17:00",
    pause_hours: "01:00",
    project_number: "",
    project_client: "",
    project_description: "",
    overwrite: false,
  });

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
    // Sort by most recent first so the most complete/recent profile wins
    const sorted = [...previousTimesheets].sort((a, b) =>
      new Date(b.created_date || 0) - new Date(a.created_date || 0)
    );
    sorted.forEach((ts) => {
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
          cct: clean(ts.cct),
          horario: clean(ts.horario),
          email_remetente: clean(ts.email_remetente),
          email_nivel1: clean(ts.email_nivel1),
          email_nivel2: clean(ts.email_nivel2),
          // Most recent project from this employee's timesheets
          default_project_number: clean(ts.default_project_number),
          default_project_client: clean(ts.default_project_client),
          default_project_description: clean(ts.default_project_description),
        });
      } else {
        // Merge: fill in any empty fields from older timesheets
        const existing = map.get(key);
        const merged = { ...existing };
        for (const k of Object.keys(merged)) {
          if (!merged[k] && ts[k]) merged[k] = clean(ts[k]);
        }
        map.set(key, merged);
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

  // Auto-fill employee data from previous timesheets
  useEffect(() => {
    if (meta.employee_name) return; // already set (e.g. from uploaded file)
    try {
      // 1) Try to restore from the last selected timesheet
      const lastTsId = localStorage.getItem("atm.selectedTimesheetId");
      if (lastTsId && previousTimesheets.length > 0) {
        const ts = previousTimesheets.find((t) => t.id === lastTsId);
        if (ts && clean(ts.employee_name)) {
          setMeta((m) => ({
            ...m,
            employee_name:        clean(ts.employee_name)        || m.employee_name,
            employee_number:      clean(ts.employee_number)      || m.employee_number,
            department:           clean(ts.department)           || m.department,
            funcao:               clean(ts.funcao)               || m.funcao,
            direcao:              clean(ts.direcao)              || m.direcao,
            centro_custo:         clean(ts.centro_custo)         || m.centro_custo,
            cct:                  clean(ts.cct)                  || m.cct,
            horario:              clean(ts.horario)              || m.horario,
            email_remetente:      clean(ts.email_remetente)      || m.email_remetente,
            email_nivel1:         clean(ts.email_nivel1)         || m.email_nivel1,
            email_nivel2:         clean(ts.email_nivel2)         || m.email_nivel2,
          }));
          return;
        }
      }
      // 2) If only one employee exists in history, auto-select them
      if (previousEmployees.length === 1) {
        const emp = previousEmployees[0];
        setMeta((m) => ({
          ...m,
          employee_name:        emp.employee_name        || m.employee_name,
          employee_number:      emp.employee_number      || m.employee_number,
          department:           emp.department           || m.department,
          funcao:               emp.funcao               || m.funcao,
          direcao:              emp.direcao              || m.direcao,
          centro_custo:         emp.centro_custo         || m.centro_custo,
          cct:                  emp.cct                  || m.cct,
          horario:              emp.horario              || m.horario,
          email_remetente:      emp.email_remetente      || m.email_remetente,
          email_nivel1:         emp.email_nivel1         || m.email_nivel1,
          email_nivel2:         emp.email_nivel2         || m.email_nivel2,
        }));
      }
    } catch { /* ignore */ }
  }, [previousTimesheets, previousEmployees]);

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

  function applyFillAll(cfg) {
    setRows((prev) => {
      return prev.map((slot) => {
        // Skip weekends, public holidays, Desc.Obrig, Desc.Comp
        const skipType = ["Desc. Obrig", "Desc.Comp", "Feriado"].includes(slot.day_type);
        if (slot.isWeekend || skipType) return slot;
        // Skip rows that already have hours unless overwrite is set
        if (!cfg.overwrite && slot.period_start) return slot;
        return recomputeRow({
          ...slot,
          period_start:        cfg.period_start,
          period_end:          cfg.period_end,
          pause_hours:         cfg.pause_hours,
          project_number:      cfg.project_number      || slot.project_number,
          project_client:      cfg.project_client      || slot.project_client,
          project_description: cfg.project_description || slot.project_description,
        });
      });
    });
    toast({ title: "Preenchimento automático", description: "Horário e projeto aplicados a todos os dias úteis." });
  }

  /** Derive the most-used project in current rows, to pre-populate the modal */
  const mostUsedProject = useMemo(() => {
    const count = new Map();
    rows.forEach((r) => {
      if (!r.project_number) return;
      const key = r.project_number;
      count.set(key, (count.get(key) || { n: 0, row: r }));
      count.get(key).n++;
      count.get(key).row = r;
    });
    let best = null;
    count.forEach((v) => { if (!best || v.n > best.n) best = v; });
    return best?.row ?? null;
  }, [rows]);


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
      // Gera o Excel, descarrega-o localmente para o utilizador e também o
      // envia para o servidor (mesma rota usada no Upload), para que o
      // Histórico consiga sempre oferecer o download do ficheiro original,
      // mesmo quando a folha foi criada diretamente no site (sem upload prévio).
      const safeName = clean(meta.employee_name).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_").slice(0, 60) || "Colaborador";
      const safeMonth = clean(meta.month) || "Mes";
      const filename = safeName + "_TimeSheet_" + safeMonth + "_" + (meta.year || "") + ".xlsx";

      let uploadedFileUrl = "";
      let excelBlob = null;
      try {
        excelBlob = exportTimesheetToExcel({ meta, rows, projects: allProjects });
      } catch (e) { /* non-critical: se falhar a geração, seguimos sem o ficheiro */ }

      if (excelBlob) {
        // Download local imediato (comportamento já existente)
        try {
          const url2 = URL.createObjectURL(excelBlob);
          const a2 = document.createElement("a"); a2.href = url2; a2.download = filename;
          document.body.appendChild(a2); a2.click(); a2.remove();
          URL.revokeObjectURL(url2);
        } catch (e) { /* non-critical */ }

        // Envio para o servidor, para o Histórico poder oferecer o download depois
        try {
          const excelFile = new File([excelBlob], filename, {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          });
          const { file_url } = await base44.integrations.Core.UploadFile({ file: excelFile });
          uploadedFileUrl = file_url || "";
        } catch (e) {
          // Não bloqueia o guardar da folha — apenas o download original ficará indisponível.
          console.error("Falha ao guardar o Excel original no servidor:", e);
          toast({
            variant: "destructive",
            title: "Aviso: ficheiro original não guardado no servidor",
            description: "A folha foi guardada e o Excel foi descarregado para o seu computador, mas não foi possível enviá-lo ao servidor — o botão 'Baixar' no Histórico não estará disponível para esta folha."
          });
        }
      }

      const timesheetPayload = {
        employee_name:        meta.employee_name,
        employee_number:      meta.employee_number      || "",
        month:                meta.month,
        year:                 Number(meta.year) || new Date().getFullYear(),
        department:           meta.department           || "",
        funcao:               meta.funcao               || "",
        direcao:              meta.direcao              || "",
        centro_custo:         meta.centro_custo         || "",
        cct:                  meta.cct                  || "",
        horario:              meta.horario              || "",
        email_remetente:      meta.email_remetente      || "",
        email_nivel1:         meta.email_nivel1         || "",
        email_nivel2:         meta.email_nivel2         || "",
        // Store the most-used project as the default for future auto-fill
        default_project_number:      mostUsedProject?.project_number      || "",
        default_project_client:      mostUsedProject?.project_client      || "",
        default_project_description: mostUsedProject?.project_description || "",
        source_filename:      sourceFile?.name || filename,
        source_file_url:      uploadedFileUrl,
        total_compensation_hours:            totals.extra,
        total_descanso_compensatorio_hours:  0
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
          <Button type="button" variant="outline" size="sm" className="gap-1.5 h-9 text-xs font-medium border-border hover:bg-muted/40 hover:border-border" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Carregar Excel
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-1.5 h-9 text-xs font-medium border-border hover:bg-muted/40 hover:border-border" onClick={handleExport} disabled={!hasGrid || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar Excel
          </Button>
          <Button type="button" size="sm" className="gap-1.5 h-9 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={!canSave || saving}>
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
          className="cursor-pointer rounded-xl border-2 border-dashed border-border bg-card p-10 text-center transition-all hover:border-red-300 hover:bg-red-50/30"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            {parsing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />}
          </div>
          <p className="mt-4 text-sm font-bold text-foreground">
            Arraste o Excel aqui ou clique para selecionar
          </p>
          <p className="mt-1 text-[11px] font-medium text-muted-foreground">
            O ficheiro é lido localmente no browser — os dados só são gravados quando carregar em "Guardar & Exportar".
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground">
            <span>ou</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Select value={meta.month} onValueChange={(v) => setMeta((m) => ({ ...m, month: v }))}>
              <SelectTrigger className="w-[160px] bg-card" onClick={(e) => e.stopPropagation()}>
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
              className="w-[110px] bg-card"
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
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <UserSquare2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Identificação do Colaborador</h3>
              <p className="text-[11px] text-muted-foreground">Dados para a folha de imputação</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nº Colaborador</Label>
              <Input value={meta.employee_number} onChange={(e) => setMeta((m) => ({ ...m, employee_number: e.target.value }))} placeholder="63001366" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nome</Label>
              <div className="flex gap-1.5">
                <Input value={meta.employee_name} onChange={(e) => setMeta((m) => ({ ...m, employee_name: e.target.value }))} placeholder="Nome do colaborador" className="flex-1 bg-muted/40 border-border focus:bg-card" />
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
                                    employee_name:   emp.employee_name,
                                    employee_number: emp.employee_number,
                                    department:      emp.department,
                                    funcao:          emp.funcao,
                                    direcao:         emp.direcao,
                                    centro_custo:    emp.centro_custo,
                                    cct:             emp.cct,
                                    horario:         emp.horario,
                                    email_remetente: emp.email_remetente,
                                    email_nivel1:    emp.email_nivel1,
                                    email_nivel2:    emp.email_nivel2,
                                  }));
                                }}
                                className="flex flex-col items-start py-2"
                              >
                                <span className="text-sm font-semibold">{emp.employee_name}</span>
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  Nº {emp.employee_number} · {emp.funcao || emp.department}
                                </span>
                                {emp.cct && <span className="text-[10px] text-muted-foreground">CCT: {emp.cct} · {emp.horario}</span>}
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
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Função</Label>
              <Input value={meta.funcao} onChange={(e) => setMeta((m) => ({ ...m, funcao: e.target.value }))} placeholder="Assistente de Manutenção" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Departamento</Label>
              <Input value={meta.department} onChange={(e) => setMeta((m) => ({ ...m, department: e.target.value }))} placeholder="Equipas Móveis Serviços Norte" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Direção / ACE</Label>
              <Input value={meta.direcao} onChange={(e) => setMeta((m) => ({ ...m, direcao: e.target.value }))} placeholder="Serviços" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Centro de Custo</Label>
              <Input value={meta.centro_custo} onChange={(e) => setMeta((m) => ({ ...m, centro_custo: e.target.value }))} placeholder="003SER04" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mês</Label>
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
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ano</Label>
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

      {/* ── Preencher todos modal ─────────────────────────────────────── */}
      <Dialog open={fillAllOpen} onOpenChange={setFillAllOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDown className="h-4 w-4 text-blue-500" />
              Preencher todos os dias úteis
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Aplica o horário e projeto a todos os dias úteis. Fins-de-semana, feriados e Desc.Obrig são ignorados.
            </p>
            {/* Horário */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Horário</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Entrada</Label>
                  <Input value={fillAllConfig.period_start} onChange={(e) => setFillAllConfig(c => ({ ...c, period_start: e.target.value }))} placeholder="08:00" className="h-9 text-center font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Saída</Label>
                  <Input value={fillAllConfig.period_end} onChange={(e) => setFillAllConfig(c => ({ ...c, period_end: e.target.value }))} placeholder="17:00" className="h-9 text-center font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Pausa</Label>
                  <Input value={fillAllConfig.pause_hours} onChange={(e) => setFillAllConfig(c => ({ ...c, pause_hours: e.target.value }))} placeholder="01:00" className="h-9 text-center font-mono" />
                </div>
              </div>
            </div>
            {/* Projeto */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Projeto (opcional)</p>
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Nº Projeto</Label>
                  <ProjectComboBox
                    value={fillAllConfig.project_number}
                    onChange={(code, info) => setFillAllConfig(c => ({
                      ...c,
                      project_number:      code,
                      project_client:      info?.client      || c.project_client,
                      project_description: info?.description || c.project_description,
                    }))}
                    projects={allProjects}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Cliente</Label>
                    <Input value={fillAllConfig.project_client} onChange={(e) => setFillAllConfig(c => ({ ...c, project_client: e.target.value }))} placeholder="(automático)" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Descrição</Label>
                    <Input value={fillAllConfig.project_description} onChange={(e) => setFillAllConfig(c => ({ ...c, project_description: e.target.value }))} placeholder="(automático)" className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            </div>
            {/* Overwrite toggle */}
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={fillAllConfig.overwrite} onChange={(e) => setFillAllConfig(c => ({ ...c, overwrite: e.target.checked }))} className="h-3.5 w-3.5 rounded border-border accent-blue-600" />
              Sobrescrever dias já preenchidos
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFillAllOpen(false)}>Cancelar</Button>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => { applyFillAll(fillAllConfig); setFillAllOpen(false); }}>
              <ArrowDown className="h-4 w-4 mr-1.5" />
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={() => resolveReplaceConfirmation(true)}>
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between bg-muted/40">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Registos diários — {meta.month} {meta.year}</h3>
                <p className="text-[11px] text-muted-foreground">{rows.length} dia(s) · {allProjects.length} projeto(s) no catálogo</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5 mr-1">
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    viewMode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                  Tabela
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("calendar")}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    viewMode === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Calendário
                </button>
              </div>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 h-8 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => {
                  // Pre-populate with most used project or first row's data
                  const src = mostUsedProject || rows.find(r => r.project_number);
                  const firstFilled = rows.find(r => r.period_start);
                  setFillAllConfig(prev => ({
                    ...prev,
                    period_start:        firstFilled?.period_start        || "08:00",
                    period_end:          firstFilled?.period_end          || "17:00",
                    pause_hours:         firstFilled?.pause_hours ? String(Math.floor(firstFilled.pause_hours)).padStart(2,"0") + ":00" : "01:00",
                    project_number:      src?.project_number      || prev.project_number,
                    project_client:      src?.project_client       || prev.project_client,
                    project_description: src?.project_description  || prev.project_description,
                  }));
                  setFillAllOpen(true);
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
          <Button type="button" variant="ghost" size="sm" className="gap-2 h-8 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-50" onClick={clearMonth}>
            <Eraser className="h-3.5 w-3.5" />
            Limpar mês
          </Button>
            </div>
          </div>

          {viewMode === "table" && (
            <>
            <div className="divide-y divide-border md:hidden">
            {rows.map((row, idx) => {
              const v = validation.perRow[idx];
              const accent = dayTypeAccent(row.day_type);
              return (
                <details key={row.date} className="group" open={activeRowIdx === idx} onToggle={(e) => e.target.open && setActiveRowIdx(idx)}>
                  <summary className="flex cursor-pointer items-center gap-3 px-5 py-3.5 hover:bg-secondary/30">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${accent.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-foreground">
                        {row.weekday} {String(row.day).padStart(2, "0")}/{row.date.slice(5, 7)}
                      </p>
                      <p className="truncate text-[11px] font-medium text-muted-foreground">{row.day_type}{row.project_client ? ` · ${row.project_client}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-foreground">{formatHours(row.normal_hours)}h</p>
                      {Number(row.extra_hours || 0) > 0 && (
                        <p className="text-[11px] font-medium tabular-nums text-amber-600">+{formatHours(row.extra_hours)}h extra</p>
                      )}
                      {Number(row.travel_hours || 0) > 0 && (
                        <p className="text-[11px] font-medium tabular-nums text-cyan-600">+{formatHours(row.travel_hours)}h viagem</p>
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
            {/* ── ATM-style table with grouped headers ── */}
            <div className="overflow-auto rounded-lg border border-slate-300 bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 260px)" }}>
              <table className="border-collapse text-[11px]" style={{ minWidth: "max-content" }}>

                {/* ══════════ THEAD — 4 rows ══════════ */}
                <thead className="sticky top-0 z-20 text-center font-semibold text-slate-700 bg-slate-100">

                  {/* Row 1 — group labels */}
                  <tr>
                    <th rowSpan={4} className="sticky left-0 z-30 bg-slate-100 border border-slate-300 px-2 py-1 align-middle min-w-[100px] text-left">
                      <span className="flex items-center gap-1.5"><CalendarIcon className="h-3 w-3 text-red-500" />Dia</span>
                    </th>
                    <th colSpan={4} className="border border-slate-300 px-2 py-1 bg-slate-200 text-slate-700">NORMAIS</th>
                    <th colSpan={11} className="border border-slate-300 px-2 py-1 bg-amber-50 text-amber-800">EXTRAORDINÁRIAS</th>
                    <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-slate-200 text-slate-700">AUSÊNCIAS / PRESENÇAS</th>
                    <th rowSpan={3} className="border border-slate-300 px-2 py-1 align-middle min-w-[90px] bg-slate-100">TIPO DIA</th>
                    <th colSpan={5} className="border border-slate-300 px-2 py-1 bg-slate-200 text-slate-700">SUBSÍDIOS</th>
                    <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-red-50 text-red-800">IMPUTAÇÃO</th>
                    <th rowSpan={4} className="border border-slate-300 px-2 py-1 align-middle min-w-[120px] bg-slate-100">OBSERVAÇÕES</th>
                    <th rowSpan={4} className="border border-slate-300 px-1 py-1 align-middle w-[90px] bg-slate-100">AÇÕES</th>
                  </tr>

                  {/* Row 2 — subgroup labels */}
                  <tr>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[62px] bg-emerald-50 text-emerald-800">Total</th>
                    <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-slate-100">PERÍODO</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[62px] bg-amber-50 text-amber-800">Total Extra</th>
                    <th colSpan={5} className="border border-slate-300 px-2 py-1 bg-amber-50 text-amber-700">Suplementares</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[62px] bg-cyan-50 text-cyan-800">Total Viagem</th>
                    <th colSpan={4} className="border border-slate-300 px-2 py-1 bg-cyan-50 text-cyan-700">HORAS DE VIAGEM</th>
                    <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-slate-100">Horas de Ausência/Presença</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[52px] bg-slate-100">S.Alim.</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[52px] bg-slate-100">Prev.</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[52px] bg-slate-100">Desl.</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[90px] bg-slate-100">Local</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[100px] bg-slate-100">Motivo Desl.</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[100px] bg-red-50 text-red-700">Nº Projeto</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[200px] bg-red-50 text-red-700">Cliente de Projeto</th>
                    <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[200px] bg-red-50 text-red-700">Descrição de Projeto</th>
                  </tr>

                  {/* Row 3 — detail column labels */}
                  <tr>
                    <th className="border border-slate-300 px-1 py-1 w-[68px] bg-slate-50">de</th>
                    <th className="border border-slate-300 px-1 py-1 w-[68px] bg-slate-50">a</th>
                    <th className="border border-slate-300 px-1 py-1 w-[60px] bg-slate-50">Pausa</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">1º HE de</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">1º HE a</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">2º HE de</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">2º HE a</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[100px] bg-amber-50">Motivo TS</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Ida Início</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Ida Fim</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Volta Início</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Volta Fim</th>
                    <th className="border border-slate-300 px-1 py-1 min-w-[140px] bg-slate-50">Tipo de Ausência/Presença</th>
                    <th className="border border-slate-300 px-1 py-1 w-[60px] bg-slate-50">de</th>
                    <th className="border border-slate-300 px-1 py-1 w-[60px] bg-slate-50">a</th>
                  </tr>

                  {/* Row 4 — column numbers */}
                  <tr className="text-slate-400 font-normal text-[10px]">
                    {["(2)","(3)","(4)","(5)","(6)","(7)","(8)","(9)","(10)","(11)","(12)","(13)","(14)","(15)","(16)","(18)","(19)","(20)","(21)","(22)","(23)","(24)","(25)","(26)","(27)","(28)","(29)"].map((n, i) => (
                      <th key={i} className="border border-slate-300 px-1 py-0.5 bg-slate-50">{n}</th>
                    ))}
                  </tr>
                </thead>

                {/* ══════════ TBODY ══════════ */}
                <tbody>
                  {rows.map((row, idx) => {
                    const v = validation.perRow[idx];
                    const hasError = v.errors.length > 0;
                    const hasWarn  = v.warnings.length > 0;
                    const isWknd   = row.isWeekend;
                    const isFeriado = row.day_type === "Feriado";
                    const isDescObrig = row.day_type === "Desc. Obrig" || row.day_type === "Desc.Obrig";
                    const hasHours  = Number(row.normal_hours  || 0) > 0;
                    const hasExtra  = Number(row.extra_hours   || 0) > 0;
                    const hasTravel = Number(row.travel_hours  || 0) > 0;

                    const rowBg = hasError   ? "bg-red-50"
                                : isFeriado  ? "bg-blue-50/40"
                                : isWknd     ? "bg-amber-50/30"
                                : isDescObrig ? "bg-slate-50/60"
                                : idx % 2 === 0 ? "bg-white" : "bg-slate-50/40";

                    // Sticky column needs a fully opaque background — any alpha here
                    // lets the non-sticky cells scrolling underneath show through as
                    // a "ghost" (e.g. the hh:mm placeholder bleeding behind the date).
                    const solidBg = hasError    ? "bg-red-50"
                                : isFeriado      ? "bg-blue-50"
                                : isWknd         ? "bg-amber-50"
                                : isDescObrig    ? "bg-slate-50"
                                : idx % 2 === 0  ? "bg-white" : "bg-slate-50";

                    const td = (extra = "") => `border border-slate-200 px-1 py-1 align-middle ${extra}`;
                    const ti = (val, onChange) => <TimeInput value={val} onChange={onChange} />;

                    return (
                      <tr key={row.date} className={`group hover:bg-sky-50/60 transition-colors ${rowBg}`}>

                        {/* (1) Dia — sticky */}
                        <td className={`sticky left-0 z-10 border border-slate-200 px-2 py-1.5 align-middle min-w-[100px] ${solidBg}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isWknd || isFeriado ? "bg-red-400" : isDescObrig ? "bg-orange-400" : "bg-emerald-400"}`} />
                            <div>
                              <div className={`font-bold text-[11px] ${isWknd ? "text-red-600" : "text-blue-700"}`}>
                                {row.weekday} {String(row.day).padStart(2,"0")}/{row.date.slice(5,7)}
                              </div>
                              <div className="text-[9px] text-slate-400">{row.date.slice(0,4)}</div>
                            </div>
                            {hasError && <AlertCircle className="h-3 w-3 text-red-500 ml-auto flex-shrink-0" />}
                            {!hasError && hasWarn && <TriangleAlert className="h-3 w-3 text-amber-500 ml-auto flex-shrink-0" />}
                          </div>
                        </td>

                        {/* (2) Total Normais */}
                        <td className={td("text-center w-[62px] bg-emerald-50/40")}>
                          <span className={`font-bold tabular-nums ${hasHours ? "text-emerald-700" : "text-slate-300"}`}>
                            {hasHours ? formatHours(row.normal_hours) : "—"}
                          </span>
                        </td>
                        {/* (3-5) Entrada/Saída/Pausa */}
                        <td className={td("w-[68px]")}>{ti(row.period_start, v => patchRow(idx, { period_start: v }))}</td>
                        <td className={td("w-[68px]")}>{ti(row.period_end, v => patchRow(idx, { period_end: v }))}</td>
                        <td className={td("w-[60px]")}>{ti(row.pause_hours ? formatHHMMFromHours(row.pause_hours) : "", v => patchRow(idx, { pause_hours: parseHHMMOrNumber(v) }))}</td>

                        {/* (6) Total Extra */}
                        <td className={td("text-center w-[62px] bg-amber-50/60")}>
                          <span className={`font-bold tabular-nums ${hasExtra ? "underline text-amber-700" : "text-slate-300"}`}>
                            {hasExtra ? formatHours(row.extra_hours) : "—"}
                          </span>
                        </td>
                        {/* (7-10) HE períodos */}
                        <td className={td("min-w-[80px] bg-amber-50/20")}>{ti(row.extra1_start, v => patchRow(idx, { extra1_start: v }))}</td>
                        <td className={td("min-w-[80px] bg-amber-50/20")}>{ti(row.extra1_end,   v => patchRow(idx, { extra1_end:   v }))}</td>
                        <td className={td("min-w-[80px] bg-amber-50/20")}>{ti(row.extra2_start, v => patchRow(idx, { extra2_start: v }))}</td>
                        <td className={td("min-w-[80px] bg-amber-50/20")}>{ti(row.extra2_end,   v => patchRow(idx, { extra2_end:   v }))}</td>
                        {/* (11) Motivo TS */}
                        <td className={td("min-w-[100px] bg-amber-50/20")}>
                          <input value={row.extra_motivo || ""} onChange={e => patchRow(idx, { extra_motivo: e.target.value }, { skipRecompute: true })} placeholder="—" className="w-full bg-transparent text-[11px] italic text-blue-600 placeholder:text-slate-300 outline-none focus:bg-white focus:ring-1 focus:ring-amber-300 rounded px-1 py-0.5" />
                        </td>
                        {/* (12) Total Viagem */}
                        <td className={td("text-center w-[62px] bg-cyan-50/40")}>
                          <span className={`font-bold tabular-nums ${hasTravel ? "text-cyan-700" : "text-slate-300"}`}>
                            {hasTravel ? formatHours(row.travel_hours) : "—"}
                          </span>
                        </td>
                        {/* (13-16) Viagem */}
                        <td className={td("min-w-[80px] bg-cyan-50/20")}>{ti(row.travel1_start, v => patchRow(idx, { travel1_start: v }))}</td>
                        <td className={td("min-w-[80px] bg-cyan-50/20")}>{ti(row.travel1_end,   v => patchRow(idx, { travel1_end:   v }))}</td>
                        <td className={td("min-w-[80px] bg-cyan-50/20")}>{ti(row.travel2_start, v => patchRow(idx, { travel2_start: v }))}</td>
                        <td className={td("min-w-[80px] bg-cyan-50/20")}>{ti(row.travel2_end,   v => patchRow(idx, { travel2_end:   v }))}</td>
                        {/* (18) Tipo Ausência */}
                        <td className={td("min-w-[140px]")}>
                          <ComboBox value={row.absence_type || ""} onChange={v => patchRow(idx, { absence_type: v }, { skipRecompute: true })} options={ABSENCE_TYPES} placeholder="— Nenhuma —" />
                        </td>
                        {/* (19-20) Ausência de/a */}
                        <td className={td("w-[60px]")}>{ti(row.absence_start || "", v => patchRow(idx, { absence_start: v }, { skipRecompute: true }))}</td>
                        <td className={td("w-[60px]")}>{ti(row.absence_end   || "", v => patchRow(idx, { absence_end:   v }, { skipRecompute: true }))}</td>
                        {/* (21) Tipo Dia */}
                        <td className={td("min-w-[90px]")}>
                          <ComboBox value={row.day_type || "Dia Útil"} onChange={v => patchRow(idx, { day_type: v }, { skipRecompute: true })} options={DAY_TYPES.map(d => ({ value: d, label: d }))} placeholder="Dia Útil" />
                        </td>
                        {/* (22-24) Subsídios */}
                        <td className={td("text-center w-[52px]")}>
                          <input type="checkbox" checked={!!row.subsidio_almoco} onChange={e => patchRow(idx, { subsidio_almoco: e.target.checked }, { skipRecompute: true })} className="h-4 w-4 rounded border-gray-300 cursor-pointer accent-emerald-600" />
                        </td>
                        <td className={td("text-center w-[52px]")}>
                          <input type="checkbox" checked={!!row.prevencao} onChange={e => patchRow(idx, { prevencao: e.target.checked }, { skipRecompute: true })} className="h-4 w-4 rounded border-gray-300 cursor-pointer accent-amber-600" />
                        </td>
                        <td className={td("text-center w-[52px]")}>
                          <input type="checkbox" checked={!!row.deslocado} onChange={e => patchRow(idx, { deslocado: e.target.checked }, { skipRecompute: true })} className="h-4 w-4 rounded border-gray-300 cursor-pointer accent-purple-600" />
                        </td>
                        {/* (25-26) Local / Motivo Deslocação */}
                        <td className={td("min-w-[90px]")}>
                          <input value={row.local_deslocacao || ""} onChange={e => patchRow(idx, { local_deslocacao: e.target.value }, { skipRecompute: true })} placeholder="—" className="w-full bg-transparent text-[11px] text-slate-600 placeholder:text-slate-300 outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                        </td>
                        <td className={td("min-w-[100px]")}>
                          <input value={row.motivo_deslocacao || ""} onChange={e => patchRow(idx, { motivo_deslocacao: e.target.value }, { skipRecompute: true })} placeholder="—" className="w-full bg-transparent text-[11px] text-slate-600 placeholder:text-slate-300 outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                        </td>
                        {/* (27) Nº Projeto */}
                        <td className={td("min-w-[100px] bg-red-50/20")}>
                          <ProjectComboBox value={row.project_number || ""} onChange={(code, info) => patchRow(idx, { project_number: code, project_client: info?.client || "", project_description: info?.description || "" })} projects={allProjects} />
                        </td>
                        {/* (28) Cliente */}
                        <td className={td("min-w-[200px] bg-red-50/20")}>
                          <input value={row.project_client || ""} onChange={e => patchRow(idx, { project_client: e.target.value }, { skipRecompute: true })} placeholder="Cliente" className="w-full bg-transparent text-[11px] text-slate-700 font-medium placeholder:text-slate-300 outline-none focus:bg-white focus:ring-1 focus:ring-red-200 rounded px-1 py-0.5" />
                        </td>
                        {/* (29) Descrição */}
                        <td className={td("min-w-[200px] bg-red-50/20")}>
                          <input value={row.project_description || ""} onChange={e => patchRow(idx, { project_description: e.target.value }, { skipRecompute: true })} placeholder="Descrição" className="w-full bg-transparent text-[11px] text-slate-600 placeholder:text-slate-300 outline-none focus:bg-white focus:ring-1 focus:ring-red-200 rounded px-1 py-0.5" />
                        </td>
                        {/* (30) Observações */}
                        <td className={td("min-w-[120px]")}>
                          <input value={row.observacoes || ""} onChange={e => patchRow(idx, { observacoes: e.target.value }, { skipRecompute: true })} placeholder="..." className="w-full bg-transparent text-[11px] text-slate-500 placeholder:text-slate-300 outline-none focus:bg-white focus:ring-1 focus:ring-blue-200 rounded px-1 py-0.5" />
                        </td>
                        {/* Ações */}
                        <td className="border border-slate-200 px-1 py-1 text-center align-middle w-[90px]">
                          <div className="flex items-center justify-center gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity">
                            <button type="button" disabled={idx === 0} onClick={() => copyPreviousRow(idx)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-20" title="Copiar anterior">
                              <Copy className="h-3.5 w-3.5 text-gray-400" />
                            </button>
                            <button type="button" onClick={() => fillDownFromRow(idx)} className="p-1 rounded hover:bg-blue-50" title="Preencher abaixo">
                              <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
                            </button>
                            <button type="button" onClick={() => clearRow(idx)} className="p-1 rounded hover:bg-red-50" title="Limpar">
                              <Eraser className="h-3.5 w-3.5 text-gray-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* ══════════ TFOOT ══════════ */}
                <tfoot>
                  <tr className="sticky bottom-0 z-20 bg-slate-100 border-t-2 border-slate-300 font-bold text-[11px]">
                    <td className="sticky left-0 z-30 bg-slate-100 border border-slate-300 px-2 py-1.5 text-slate-700">
                      <span className="flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5 text-red-500" />TOTAL</span>
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-emerald-700 tabular-nums">{formatHours(totals.normal)}</td>
                    <td className="border border-slate-300" colSpan={3} />
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-amber-700 tabular-nums">{formatHours(totals.extra)}</td>
                    <td className="border border-slate-300" colSpan={5} />
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-cyan-700 tabular-nums">{formatHours(totals.travel ?? 0)}</td>
                    <td className="border border-slate-300" colSpan={19} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
            </>
          )}

          {viewMode === "calendar" && (
            <CalendarMonthView
              rows={rows}
              validation={validation}
              onDayClick={(idx) => setCalendarDayIdx(idx)}
            />
          )}
        </div>
      )}

      {/* ── Calendar day editor modal ─────────────────────────────────── */}
      <Dialog open={calendarDayIdx !== null} onOpenChange={(open) => !open && setCalendarDayIdx(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          {calendarDayIdx !== null && rows[calendarDayIdx] && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${dayTypeAccent(rows[calendarDayIdx].day_type).dot}`} />
                  {rows[calendarDayIdx].weekday} {String(rows[calendarDayIdx].day).padStart(2, "0")}/{rows[calendarDayIdx].date.slice(5, 7)}/{rows[calendarDayIdx].date.slice(0, 4)}
                </DialogTitle>
              </DialogHeader>
              <RowEditor
                row={rows[calendarDayIdx]}
                index={calendarDayIdx}
                onPatch={patchRow}
                onClear={() => clearRow(calendarDayIdx)}
                onCopyPrev={() => copyPreviousRow(calendarDayIdx)}
                onFillDown={() => fillDownFromRow(calendarDayIdx)}
                canCopyPrev={calendarDayIdx > 0}
                canFillDown={calendarDayIdx < rows.length - 1}
                projectCodes={allProjects}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCalendarDayIdx(null)}>Fechar</Button>
                <Button
                  type="button"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  disabled={calendarDayIdx >= rows.length - 1}
                  onClick={() => setCalendarDayIdx((i) => Math.min(i + 1, rows.length - 1))}
                >
                  Dia seguinte
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
