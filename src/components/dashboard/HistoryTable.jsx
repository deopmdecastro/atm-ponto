 

import { useState } from "react";
import moment from "moment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 15;

export default function HistoryTable({ history, onToggleCompensate }) {
  const [page, setPage] = useState(0);
  
  if (!history || history.length === 0) return null;

  const totalPages = Math.ceil(history.length / PAGE_SIZE);
  const paged = history.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const dayTypeColors = {
    "Dia Útil": "bg-green-50 text-green-700 border-green-200",
    "Desc.Comp": "bg-amber-50 text-amber-700 border-amber-200",
    "Desc. Obrig": "bg-blue-50 text-blue-700 border-blue-200",
    "Feriado": "bg-purple-50 text-purple-700 border-purple-200",
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Histórico Detalhado</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Registo diário de horas trabalhadas</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Normais</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Extras</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ausência</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Saldo</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Projeto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paged.map((row, i) => {
              const dateStr = moment(row.date).format("DD/MM/YYYY");
              const weekday = moment(row.date).format("ddd");
              const isWeekend = row.day_type === "Desc.Comp" || row.day_type === "Desc. Obrig";

              return (
                <tr
                  key={i}
                  className={`hover:bg-secondary/30 transition-colors ${isWeekend ? "bg-muted/30" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{dateStr}</div>
                    <div className="text-xs text-muted-foreground capitalize">{weekday}</div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${dayTypeColors[row.day_type] || "bg-secondary text-secondary-foreground border-border"}`}>
                      {row.day_type || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">
                    {row.normal_hours > 0 ? `${row.normal_hours}h` : '-'}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-accent-foreground">
                    {row.extra_hours > 0 ? `${row.extra_hours}h` : '-'}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">
                    {row.absence_hours > 0 ? `${row.absence_hours}h` : '-'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`font-bold tabular-nums ${row.bankBalance < 0 ? "text-destructive" : row.bankBalance > 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {row.bankBalance}h
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Badge
                      variant={row.bankStatus === "Disponível" ? "default" : row.bankStatus === "Gozado" ? "secondary" : "outline"}
                      className="text-[10px] cursor-pointer"
                      onClick={() => onToggleCompensate && onToggleCompensate(row)}
                    >
                      {row.bankStatus}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-left text-xs text-muted-foreground max-w-[200px] truncate">
                    {row.project_number || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Página {page + 1} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}