 

import { AlertTriangle, AlertCircle, Info } from "lucide-react";

export default function AlertsList({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <div className="h-12 w-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
          <Info className="h-6 w-6 text-green-600" />
        </div>
        <p className="text-sm font-medium text-foreground">Sem alertas</p>
        <p className="text-xs text-muted-foreground mt-1">Tudo em ordem com os registros</p>
      </div>
    );
  }

  const iconMap = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colorMap = {
    error: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };

  const iconColorMap = {
    error: "text-red-500",
    warning: "text-amber-500",
    info: "text-blue-500",
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Alertas</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{alerts.length} alerta(s) encontrado(s)</p>
      </div>
      <div className="divide-y divide-border">
        {alerts.map((alert, i) => {
          const Icon = iconMap[alert.type] || Info;
          return (
            <div key={i} className={`flex items-start gap-3 px-6 py-4 ${colorMap[alert.type] || ""}`}>
              <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${iconColorMap[alert.type]}`} />
              <div>
                <p className="text-sm font-medium break-words">{alert.message}</p>
                {alert.date && alert.date !== '-' && (
                  <p className="text-xs opacity-70 mt-0.5">Data: {alert.date}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}