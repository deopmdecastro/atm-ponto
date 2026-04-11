import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function HourBankChart({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-sm font-semibold text-foreground mb-1">Evolução das Horas Compensadas</h3>
      <p className="text-xs text-muted-foreground mb-6">Saldo disponível ao longo do mês</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorSaldo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(0, 78%, 52%)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="hsl(0, 78%, 52%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(0, 0%, 42%)" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(0, 0%, 42%)" }} />
            <Tooltip
              contentStyle={{
                background: "hsl(0, 0%, 100%)",
                border: "1px solid hsl(0, 0%, 90%)",
                borderRadius: "8px",
                fontSize: "12px"
              }}
              formatter={(value) => [`${value}h`, "Saldo disponível"]}
            />
            <Area
              type="monotone"
              dataKey="saldo"
              stroke="hsl(0, 78%, 52%)"
              strokeWidth={2}
              fill="url(#colorSaldo)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
