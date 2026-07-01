 

import { useMemo, useState } from "react";
import moment from "moment";
import "moment/locale/pt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Plane,
  CircleAlert,
  FolderKanban,
  MessageSquareText,
  Wallet,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/formatHours";

moment.locale("pt");

const PAGE_SIZE = 15;

const DAY_TYPE_STYLES = {
  "Dia Útil": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Desc.Comp": "bg-amber-50 text-amber-700 border-amber-200",
  "Desc. Obrig": "bg-sky-50 text-sky-700 border-sky-200",
  Feriado: "bg-violet-50 text-violet-700 border-violet-200",
};

// Same color mapping already used elsewhere in the app (calendar view of
// "Preencher") so the day-type colour language stays consistent everywhere.
function dayDotColor(dayType) {
  switch (dayType) {
    case "Desc. Obrig":
      return "bg-red-500";
    case "Desc.Comp":
      return "bg-amber-500";
    case "Feriado":
      return "bg-violet-500";
    default:
      return "bg-emerald-500";
  }
}

/**
 * Date badge: coloured status dot + weekday/date on top, year below.
 */
function DateBadge({ date, dayType, className }) {
  const m = moment(date);
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", dayDotColor(dayType))} />
      <div className="leading-tight">
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[13px] font-bold capitalize text-foreground">{m.format("ddd")}</span>
          <span className="text-xs font-semibold text-muted-foreground">{m.format("DD/MM")}</span>
        </div>
        <div className="text-[11px] text-muted-foreground/70">{m.format("YYYY")}</div>
      </div>
    </div>
  );
}

const STATUS_STYLES = {
  Disponível: "bg-primary text-primary-foreground border-transparent",
  Gozado: "bg-secondary text-secondary-foreground border-transparent",
  Normal: "border-border text-muted-foreground",
};

function fmtHours(value) {
  const n = Number(value || 0);
  return n > 0 ? `${formatHours(n)}h` : "—";
}

function fmtTime(value) {
  return value && String(value).trim() ? value : "—";
}

function fmtText(value) {
  return value && String(value).trim() ? value : "—";
}

/**
 * Full detail card used on small screens. Mirrors every field shown on the
 * desktop table, grouped into the same sections, but stacked for readability.
 */
function DayCard({ row, onToggleCompensate }) {
  const isRestDay = row.day_type === "Desc.Comp" || row.day_type === "Desc. Obrig";
  const hasProject = row.project_number || row.project_client || row.project_description;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-sm transition-colors",
        isRestDay && "bg-muted/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <DateBadge date={row.date} dayType={row.day_type} />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge
            className={cn("cursor-pointer text-[10px]", STATUS_STYLES[row.bankStatus] || "")}
            variant="outline"
            onClick={() => onToggleCompensate && onToggleCompensate(row)}
          >
            {row.bankStatus || "-"}
          </Badge>
          <span
            className={cn(
              "inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium",
              DAY_TYPE_STYLES[row.day_type] || "border-border bg-secondary text-secondary-foreground"
            )}
          >
            {fmtText(row.day_type)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3 w-3" /> Normais
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-foreground">{fmtHours(row.normal_hours)}</p>
          {(row.period_start || row.period_end) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {fmtTime(row.period_start)} – {fmtTime(row.period_end)}
              {Number(row.pause_hours) > 0 && ` · pausa ${fmtHours(row.pause_hours)}`}
            </p>
          )}
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3 w-3" /> Extraordinárias
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-accent-foreground">{fmtHours(row.extra_hours)}</p>
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Plane className="h-3 w-3" /> Viagem
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-foreground">{fmtHours(row.travel_hours)}</p>
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Wallet className="h-3 w-3" /> Saldo banco
          </p>
          <p
            className={cn(
              "mt-1 text-sm font-bold tabular-nums",
              row.bankBalance < 0 ? "text-destructive" : row.bankBalance > 0 ? "text-primary" : "text-muted-foreground"
            )}
          >
            {formatHours(row.bankBalance)}h
          </p>
        </div>
      </div>

      {(Number(row.absence_hours) > 0 || row.absence_type) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="text-[11px] leading-snug">
            <span className="font-semibold">Ausência {fmtHours(row.absence_hours)}</span>
            {row.absence_type ? ` · ${row.absence_type}` : ""}
          </div>
        </div>
      )}

      {hasProject && (
        <div className="mt-3 flex items-start gap-2 border-t border-border pt-3">
          <FolderKanban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="text-[11px] leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">{fmtText(row.project_number)}</p>
            <p>{fmtText(row.project_client)}</p>
            {row.project_description && <p className="text-muted-foreground/80">{row.project_description}</p>}
          </div>
        </div>
      )}

      {row.observations && (
        <div className="mt-3 flex items-start gap-2 border-t border-border pt-3">
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-snug text-muted-foreground">{row.observations}</p>
        </div>
      )}
    </div>
  );
}

export default function HistoryTable({ history, onToggleCompensate }) {
  const [page, setPage] = useState(0);

  const totals = useMemo(() => {
    if (!history || history.length === 0) return null;
    return history.reduce(
      (acc, r) => ({
        normal_hours: acc.normal_hours + Number(r.normal_hours || 0),
        extra_hours: acc.extra_hours + Number(r.extra_hours || 0),
        travel_hours: acc.travel_hours + Number(r.travel_hours || 0),
        absence_hours: acc.absence_hours + Number(r.absence_hours || 0),
        pause_hours: acc.pause_hours + Number(r.pause_hours || 0),
      }),
      { normal_hours: 0, extra_hours: 0, travel_hours: 0, absence_hours: 0, pause_hours: 0 }
    );
  }, [history]);

  if (!history || history.length === 0) return null;

  const totalPages = Math.ceil(history.length / PAGE_SIZE);
  const paged = history.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const headCell = "px-3 py-2 border border-border align-middle whitespace-nowrap";
  const groupHeadCell = headCell + " bg-secondary/60 text-secondary-foreground font-semibold";
  const subHeadCell = headCell + " bg-secondary/30 text-muted-foreground font-medium";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border p-6">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Histórico Detalhado</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Registo diário completo de horas, ausências, viagens e imputação
            </p>
          </div>
        </div>
        {totals && (
          <div className="hidden sm:flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Normais</p>
              <p className="text-sm font-bold tabular-nums text-foreground">{formatHours(totals.normal_hours)}h</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Extras</p>
              <p className="text-sm font-bold tabular-nums text-accent-foreground">{formatHours(totals.extra_hours)}h</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ausências</p>
              <p className="text-sm font-bold tabular-nums text-foreground">{formatHours(totals.absence_hours)}h</p>
            </div>
          </div>
        )}
      </div>

      {/* ---------- Desktop / tablet: full table ---------- */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead>
            <tr>
              <th rowSpan={2} className={cn(groupHeadCell, "sticky left-0 z-20 text-left min-w-[120px]")}>
                Dia
              </th>
              <th colSpan={4} className={groupHeadCell}>
                Normais
              </th>
              <th rowSpan={2} className={groupHeadCell}>
                Extras
              </th>
              <th rowSpan={2} className={groupHeadCell}>
                Viagem
              </th>
              <th colSpan={2} className={groupHeadCell}>
                Ausência / Presença
              </th>
              <th rowSpan={2} className={groupHeadCell}>
                Tipo de Dia
              </th>
              <th colSpan={3} className={groupHeadCell}>
                Imputação
              </th>
              <th rowSpan={2} className={groupHeadCell}>
                Observações
              </th>
              <th colSpan={2} className={groupHeadCell}>
                Banco de Horas
              </th>
            </tr>
            <tr>
              <th className={subHeadCell}>Total</th>
              <th className={subHeadCell}>De</th>
              <th className={subHeadCell}>Até</th>
              <th className={subHeadCell}>Pausa</th>
              <th className={cn(subHeadCell, "text-left min-w-[140px]")}>Tipo</th>
              <th className={subHeadCell}>Horas</th>
              <th className={cn(subHeadCell, "text-left min-w-[90px]")}>Nº Projeto</th>
              <th className={cn(subHeadCell, "text-left min-w-[180px]")}>Cliente</th>
              <th className={cn(subHeadCell, "text-left min-w-[200px]")}>Descrição</th>
              <th className={subHeadCell}>Saldo</th>
              <th className={subHeadCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => {
              const isRestDay = row.day_type === "Desc.Comp" || row.day_type === "Desc. Obrig";
              const cell = "px-3 py-2 border border-border align-middle";

              return (
                <tr
                  key={i}
                  className={cn("transition-colors hover:bg-secondary/20", isRestDay && "bg-muted/30")}
                >
                  <td className={cn(cell, "sticky left-0 z-10 bg-card text-left")}>
                    <DateBadge date={row.date} dayType={row.day_type} />
                  </td>

                  <td className={cn(cell, "text-right tabular-nums font-semibold text-foreground")}>
                    {fmtHours(row.normal_hours)}
                  </td>
                  <td className={cn(cell, "text-center tabular-nums text-muted-foreground")}>
                    {fmtTime(row.period_start)}
                  </td>
                  <td className={cn(cell, "text-center tabular-nums text-muted-foreground")}>
                    {fmtTime(row.period_end)}
                  </td>
                  <td className={cn(cell, "text-center tabular-nums text-muted-foreground")}>
                    {row.pause_hours ? fmtHours(row.pause_hours) : "—"}
                  </td>

                  <td className={cn(cell, "text-right tabular-nums font-semibold text-accent-foreground")}>
                    {fmtHours(row.extra_hours)}
                  </td>

                  <td className={cn(cell, "text-right tabular-nums font-semibold text-foreground")}>
                    {fmtHours(row.travel_hours)}
                  </td>

                  <td className={cn(cell, "text-left text-muted-foreground max-w-[160px] truncate")} title={row.absence_type || ""}>
                    {fmtText(row.absence_type)}
                  </td>
                  <td className={cn(cell, "text-right tabular-nums text-muted-foreground")}>
                    {row.absence_hours ? fmtHours(row.absence_hours) : "—"}
                  </td>

                  <td className={cn(cell, "text-center")}>
                    <span
                      className={cn(
                        "inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
                        DAY_TYPE_STYLES[row.day_type] || "border-border bg-secondary text-secondary-foreground"
                      )}
                    >
                      {fmtText(row.day_type)}
                    </span>
                  </td>

                  <td className={cn(cell, "text-left text-muted-foreground")}>{fmtText(row.project_number)}</td>
                  <td className={cn(cell, "text-left text-muted-foreground max-w-[180px] truncate")} title={row.project_client || ""}>
                    {fmtText(row.project_client)}
                  </td>
                  <td className={cn(cell, "text-left text-muted-foreground max-w-[200px] truncate")} title={row.project_description || ""}>
                    {fmtText(row.project_description)}
                  </td>

                  <td className={cn(cell, "text-left text-muted-foreground max-w-[180px] truncate")} title={row.observations || ""}>
                    {fmtText(row.observations)}
                  </td>

                  <td className={cn(cell, "text-right")}>
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        row.bankBalance < 0
                          ? "text-destructive"
                          : row.bankBalance > 0
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    >
                      {formatHours(row.bankBalance)}h
                    </span>
                  </td>
                  <td className={cn(cell, "text-center")}>
                    <Badge
                      variant="outline"
                      className={cn("cursor-pointer text-[10px] whitespace-nowrap", STATUS_STYLES[row.bankStatus] || "")}
                      onClick={() => onToggleCompensate && onToggleCompensate(row)}
                    >
                      {row.bankStatus}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="bg-secondary/40 font-bold">
                <td className="sticky left-0 z-10 bg-secondary/40 px-3 py-2.5 border border-border text-left">
                  TOTAL
                </td>
                <td className="px-3 py-2.5 border border-border text-right tabular-nums">
                  {formatHours(totals.normal_hours)}h
                </td>
                <td className="px-3 py-2.5 border border-border" />
                <td className="px-3 py-2.5 border border-border" />
                <td className="px-3 py-2.5 border border-border text-right tabular-nums font-normal text-muted-foreground">
                  {totals.pause_hours ? `${formatHours(totals.pause_hours)}h` : ""}
                </td>
                <td className="px-3 py-2.5 border border-border text-right tabular-nums text-accent-foreground">
                  {formatHours(totals.extra_hours)}h
                </td>
                <td className="px-3 py-2.5 border border-border text-right tabular-nums">
                  {formatHours(totals.travel_hours)}h
                </td>
                <td className="px-3 py-2.5 border border-border" />
                <td className="px-3 py-2.5 border border-border text-right tabular-nums">
                  {formatHours(totals.absence_hours)}h
                </td>
                <td className="px-3 py-2.5 border border-border" colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ---------- Mobile: stacked cards ---------- */}
      <div className="md:hidden space-y-3 p-4">
        {totals && (
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-secondary/30 p-3 text-center">
            <div>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Normais</p>
              <p className="text-xs font-bold tabular-nums">{formatHours(totals.normal_hours)}h</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Extras</p>
              <p className="text-xs font-bold tabular-nums text-accent-foreground">{formatHours(totals.extra_hours)}h</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Ausências</p>
              <p className="text-xs font-bold tabular-nums">{formatHours(totals.absence_hours)}h</p>
            </div>
          </div>
        )}
        {paged.map((row, i) => (
          <DayCard key={i} row={row} onToggleCompensate={onToggleCompensate} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Página {page + 1} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
