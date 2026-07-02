import { AlertTriangle, Briefcase, CalendarDays, CalendarX, Clock, Plane, TrendingDown, TrendingUp } from "lucide-react";
import { formatHours } from "@/lib/formatHours";

const cards = [
  { key: "totalWorkedDays", label: "Dias Trabalhados", icon: CalendarDays, suffix: " dias" },
  { key: "totalNormalHours", label: "Horas Normais", icon: Clock, suffix: "h" },
  { key: "totalExtraHours", label: "Horas Extras", icon: TrendingUp, suffix: "h" },
  {
    key: "totalCompensationHours",
    label: "Horas Compensadas",
    icon: TrendingDown,
    suffix: "h",
    daysKey: "totalCompensationDays"
  },
  {
    key: "hourBank",
    label: "Disponivel (Comp.)",
    icon: Briefcase,
    suffix: "h",
    daysKey: "compensationAvailableDays"
  },
  { key: "totalTravelHours", label: "Horas de Viagem", icon: Plane, suffix: "h" },
  { key: "totalAbsenceDays", label: "Faltas", icon: CalendarX, suffix: " dias" }
];

function formatDays(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

export default function SummaryCards({ summary }) {
  if (!summary) return null;

  const debtHours = Number(summary.compensationDebtHours ?? summary.debtHours ?? 0);
  const debtDays = Number(summary.compensationDebtDays ?? debtHours / 8);
  const isInDebt = debtHours > 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-4">
      {cards.map((card) => (
        <div
          key={card.key}
          className="group relative bg-card rounded-xl border border-border p-5 hover:shadow-lg hover:border-primary/20 transition-all duration-300 min-w-0"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
              <card.icon className="h-4 w-4 text-accent-foreground" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground break-words">
            {typeof summary[card.key] === "number"
              ? card.suffix === "h"
                ? formatHours(summary[card.key])
                : summary[card.key]
              : summary[card.key]}
            <span className="text-sm font-normal text-muted-foreground">{card.suffix}</span>
          </p>
          {card.daysKey ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">{formatDays(summary[card.daysKey])} dias</p>
          ) : null}
          <p className="text-xs text-muted-foreground mt-1 font-medium break-words">{card.label}</p>
        </div>
      ))}

      <div
        className={`group relative rounded-xl border p-5 hover:shadow-lg transition-all duration-300 min-w-0 ${
          isInDebt
            ? "bg-orange-50 border-orange-200 hover:border-orange-300"
            : "bg-card border-border hover:border-primary/20"
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${isInDebt ? "bg-orange-100" : "bg-accent"}`}>
            <AlertTriangle className={`h-4 w-4 ${isInDebt ? "text-orange-500" : "text-accent-foreground"}`} />
          </div>
        </div>
        <p className={`text-2xl font-bold tracking-tight break-words ${isInDebt ? "text-orange-600" : "text-foreground"}`}>
          {isInDebt ? "-" : ""}
          {formatHours(debtHours)}
          <span className={`text-sm font-normal ${isInDebt ? "text-orange-400" : "text-muted-foreground"}`}>h</span>
        </p>
        <p className={`mt-1 text-xs font-medium ${isInDebt ? "text-orange-400" : "text-muted-foreground"}`}>
          {formatDays(debtDays)} dias
        </p>
        <p className={`text-xs mt-1 font-medium break-words ${isInDebt ? "text-orange-600" : "text-muted-foreground"}`}>
          Horas Compensatórias a Dever
        </p>
      </div>
    </div>
  );
}
