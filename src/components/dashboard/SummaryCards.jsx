 

import { CalendarDays, Clock, TrendingUp, TrendingDown, Briefcase, Plane } from "lucide-react";

const cards = [
  { key: "totalWorkedDays", label: "Dias Trabalhados", icon: CalendarDays, suffix: " dias", color: "text-foreground" },
  { key: "totalNormalHours", label: "Horas Normais", icon: Clock, suffix: "h", color: "text-foreground" },
  { key: "totalExtraHours", label: "Horas Extras", icon: TrendingUp, suffix: "h", color: "text-accent-foreground" },
  { key: "totalCompensationHours", label: "Horas Compensadas", icon: TrendingDown, suffix: "h", color: "text-muted-foreground" },
  { key: "hourBank", label: "Disponível (Comp.)", icon: Briefcase, suffix: "h", color: "text-primary" },
  { key: "totalTravelHours", label: "Horas de Viagem", icon: Plane, suffix: "h", color: "text-muted-foreground" },
];

export default function SummaryCards({ summary }) {
  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map(card => (
        <div
          key={card.key}
          className="group relative bg-card rounded-xl border border-border p-5 hover:shadow-lg hover:border-primary/20 transition-all duration-300"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
              <card.icon className="h-4 w-4 text-accent-foreground" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground">
            {typeof summary[card.key] === 'number' 
              ? (Number.isInteger(summary[card.key]) ? summary[card.key] : summary[card.key].toFixed(1))
              : summary[card.key]}
            <span className="text-sm font-normal text-muted-foreground">{card.suffix}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1 font-medium">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
