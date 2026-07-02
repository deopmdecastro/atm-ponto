import { Banknote, Landmark, Percent, Receipt, ShieldMinus, UtensilsCrossed, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/formatCurrency";

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0%";
  return `${number.toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export default function SalaryCards({ summary }) {
  if (!summary) return null;

  const taxableIncome = Number(summary.totalTaxableIncome || 0);
  const irsAmount = Number(summary.irsAmount || 0);
  const ssAmount = Number(summary.ssAmount || 0);
  // Effective rate = amount actually withheld over the taxable base for the period.
  // Falls back to the configured rate (single-month view) when there's no taxable base yet.
  const irsPercent = taxableIncome > 0 ? (irsAmount / taxableIncome) * 100 : Number(summary.config?.irs_rate_percent || 0);
  const ssPercent = taxableIncome > 0 ? (ssAmount / taxableIncome) * 100 : Number(summary.config?.ss_rate_percent || 0);

  const cards = [
    { key: "baseSalary", label: "Vencimento Base", icon: Banknote, value: summary.baseSalary },
    { key: "mealSubsidy", label: "Subsídio Refeição", icon: UtensilsCrossed, value: summary.mealSubsidy },
    { key: "extraHoursAmount", label: "Horas Extra", icon: Receipt, value: summary.extraHoursAmount },
    {
      key: "grossTotal",
      label: "Total Bruto",
      sublabel: "Total Ilíquido",
      icon: Landmark,
      value: summary.grossTotal,
      tone: "blue"
    },
    {
      key: "irsAmount",
      label: "IRS",
      sublabel:
        Number(summary.extraHoursAmount || 0) > 0 && summary.overtimeIrsRatePercent !== undefined
          ? `${formatPercent(irsPercent)} retido · horas extra a ${formatPercent(summary.overtimeIrsRatePercent)}`
          : `${formatPercent(irsPercent)} retido`,
      icon: Percent,
      value: irsAmount,
      negative: true
    },
    {
      key: "ssAmount",
      label: "Segurança Social (NISS)",
      sublabel: `${formatPercent(ssPercent)} retido`,
      icon: ShieldMinus,
      value: ssAmount,
      negative: true
    },
    {
      key: "netTotal",
      label: "Total Líquido",
      sublabel: "Valor a receber",
      icon: Wallet,
      value: summary.netTotal,
      tone: "primary"
    }
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Salário (estimado)</h3>
        <p className="text-xs text-muted-foreground">Valores aproximados, calculados a partir do timesheet</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
        {cards.map((card) => (
          <div
            key={card.key}
            className={`group relative rounded-xl border p-5 hover:shadow-lg transition-all duration-300 min-w-0 ${
              card.tone === "primary"
                ? "bg-primary/5 border-primary/30 hover:border-primary/50"
                : card.tone === "blue"
                  ? "bg-blue-50 border-blue-200 hover:border-blue-300"
                  : "bg-card border-border hover:border-primary/20"
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                  card.tone === "primary" ? "bg-primary/15" : card.tone === "blue" ? "bg-blue-100" : "bg-accent"
                }`}
              >
                <card.icon
                  className={`h-4 w-4 ${
                    card.tone === "primary"
                      ? "text-primary"
                      : card.tone === "blue"
                        ? "text-blue-600"
                        : "text-accent-foreground"
                  }`}
                />
              </div>
            </div>
            <p
              className={`text-2xl font-bold tracking-tight break-words ${
                card.negative ? "text-red-600" : card.tone === "primary" ? "text-primary" : card.tone === "blue" ? "text-blue-700" : "text-foreground"
              }`}
            >
              {card.negative ? "-" : ""}
              {formatCurrency(card.value)}
            </p>
            <p className="text-xs text-muted-foreground mt-1 font-medium break-words">{card.label}</p>
            {card.sublabel && (
              <p
                className={`text-[11px] mt-0.5 font-medium break-words ${
                  card.negative ? "text-red-500/80" : card.tone === "blue" ? "text-blue-500" : "text-muted-foreground/70"
                }`}
              >
                {card.sublabel}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
