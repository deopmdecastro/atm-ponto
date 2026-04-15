 

import { User, Hash, Building, Calendar } from "lucide-react";

export default function EmployeeInfo({ info }) {
  if (!info) return null;

  const items = [
    { icon: User, label: "Nome do colaborador", value: info.name || "Colaborador" },
    { icon: Hash, label: "Nº Pessoal", value: info.number },
    { icon: Building, label: "Direção", value: info.department },
    { icon: Calendar, label: "Período", value: info.period },
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <User className="h-7 w-7 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Informações do colaborador</p>
            <p className="text-sm text-muted-foreground">Dados principais do upload e período</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {items.map(item => (
            item.value && (
              <div key={item.label} className="flex items-start gap-2 min-w-0">
                <item.icon className="mt-1 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground break-words max-w-full">{item.value}</p>
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}