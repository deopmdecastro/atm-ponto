import { Banknote, Landmark, MinusCircle, Receipt, UtensilsCrossed, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/formatCurrency";

const cards = [
  { key: "baseSalary", label: "Vencimento Base", icon: Banknote },
  { key: "mealSubsidy", label: "Subsídio Refeição", icon: UtensilsCrossed },
  { key: "extraHoursAmount", label: "Horas Extra", icon: Receipt },
  { key: "grossTotal", label: "Total Ilíquido", icon: Landmark },
  { key: "totalDeductions", label: "Descontos (IRS + SS)", icon: MinusCircle, negative: true },
  { key: "netTotal", label: "Total Líquido", icon: Wallet, highlight: true }
];

export default function SalaryCards({ summary }) {
  if (!summary) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Salário (estimado)</h3>
        <p className="text-xs text-muted-foreground">Valores aproximados, calculados a partir do timesheet</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((card) => (
          <div
            key={card.key}
            className={`group relative rounded-xl border p-5 hover:shadow-lg transition-all duration-300 min-w-0 ${
              card.highlight
                ? "bg-primary/5 border-primary/30 hover:border-primary/50"
                : "bg-card border-border hover:border-primary/20"
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                  card.highlight ? "bg-primary/15" : "bg-accent"
                }`}
              >
                <card.icon className={`h-4 w-4 ${card.highlight ? "text-primary" : "text-accent-foreground"}`} />
              </div>
            </div>
            <p
              className={`text-2xl font-bold tracking-tight break-words ${
                card.negative ? "text-red-600" : card.highlight ? "text-primary" : "text-foreground"
              }`}
            >
              {card.negative ? "-" : ""}
              {formatCurrency(summary[card.key])}
            </p>
            <p className="text-xs text-muted-foreground mt-1 font-medium break-words">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
