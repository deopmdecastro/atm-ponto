import { Hash, Building2, CalendarRange } from "lucide-react";

export default function EmployeeInfo({ info }) {
  if (!info) return null;

  const items = [
    { label: "NÂº", value: info.number, icon: Hash },
    { label: "Departamento", value: info.department, icon: Building2 },
    { label: "PerÃ­odo", value: info.period, icon: CalendarRange }
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">InformaÃ§Ãµes</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3 bg-accent/50 rounded-lg p-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <item.icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-sm font-semibold text-foreground truncate">{item.value || "â€”"}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

