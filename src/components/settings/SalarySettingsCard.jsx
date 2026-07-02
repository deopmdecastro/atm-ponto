import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { DEFAULT_SALARY_CONFIG, salaryMonthKey } from "@/lib/calculateSalary";

const DEFAULT_FIELDS = [
  { key: "base_salary", label: "Vencimento Base (€)", step: "0.01" },
  { key: "meal_subsidy_daily", label: "Subsídio Refeição / dia (€)", step: "0.01" },
  { key: "extra_hour_rate", label: "Valor Hora Extra (€)", step: "0.01" },
  { key: "irs_rate_percent", label: "Taxa IRS (%)", step: "0.01" },
  { key: "ss_rate_percent", label: "Taxa Seg. Social (%)", step: "0.01" }
];

const MONTH_FIELDS = [
  { key: "base_salary", label: "Venc. Base (€)" },
  { key: "irs_rate_percent", label: "Taxa IRS (%)" },
  { key: "vacation_subsidy_amount", label: "Subs. Férias (€)" },
  { key: "christmas_subsidy_amount", label: "Subs. Natal (€)" }
];

function toInputValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

export default function SalarySettingsCard() {
  const queryClient = useQueryClient();
  const [defaults, setDefaults] = useState(DEFAULT_SALARY_CONFIG.defaults);
  const [months, setMonths] = useState({});
  const [hydrated, setHydrated] = useState(false);

  const timesheetsQuery = useQuery({
    queryKey: ["timesheets"],
    queryFn: () => base44.entities.Timesheet.list(200),
    staleTime: 60_000
  });

  const salaryConfigQuery = useQuery({
    queryKey: ["salary-config"],
    queryFn: () => base44.reference.getSalaryConfig(),
    staleTime: 60_000
  });

  const timesheets = Array.isArray(timesheetsQuery.data) ? timesheetsQuery.data : [];

  const sortedTimesheets = useMemo(() => {
    return [...timesheets].sort((a, b) => {
      const ay = Number(a?.year || 0);
      const by = Number(b?.year || 0);
      if (ay !== by) return by - ay;
      return String(b?.month || "").localeCompare(String(a?.month || ""));
    });
  }, [timesheets]);

  useEffect(() => {
    if (hydrated) return;
    if (!salaryConfigQuery.data) return;
    setDefaults({ ...DEFAULT_SALARY_CONFIG.defaults, ...(salaryConfigQuery.data.defaults || {}) });
    setMonths(salaryConfigQuery.data.months || {});
    setHydrated(true);
  }, [salaryConfigQuery.data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: (payload) => base44.reference.updateSalaryConfig(payload),
    onSuccess: async (saved) => {
      queryClient.setQueryData(["salary-config"], saved);
      await queryClient.invalidateQueries({ queryKey: ["salary-config"] });
      toast({ title: "Configuração de salário salva", description: "Os valores foram atualizados." });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Falha ao salvar salário",
        description: err?.message || "Tente novamente."
      });
    }
  });

  function updateDefault(key, value) {
    setDefaults((prev) => ({ ...prev, [key]: value }));
  }

  function updateMonth(monthKey, field, value) {
    setMonths((prev) => {
      const next = { ...prev };
      const entry = { ...(next[monthKey] || {}) };
      if (value === "") {
        delete entry[field];
      } else {
        entry[field] = value;
      }
      next[monthKey] = entry;
      return next;
    });
  }

  function handleSave() {
    const cleanDefaults = {};
    for (const field of DEFAULT_FIELDS) {
      const raw = defaults[field.key];
      const num = Number(raw);
      cleanDefaults[field.key] = Number.isFinite(num) ? num : DEFAULT_SALARY_CONFIG.defaults[field.key];
    }

    const cleanMonths = {};
    for (const [key, entry] of Object.entries(months)) {
      const cleanEntry = {};
      for (const field of MONTH_FIELDS) {
        const raw = entry?.[field.key];
        if (raw === undefined || raw === null || raw === "") continue;
        const num = Number(raw);
        if (Number.isFinite(num)) cleanEntry[field.key] = num;
      }
      if (Object.keys(cleanEntry).length > 0) cleanMonths[key] = cleanEntry;
    }

    saveMutation.mutate({ defaults: cleanDefaults, months: cleanMonths });
  }

  const loading = timesheetsQuery.isLoading || salaryConfigQuery.isLoading;

  return (
    <Card className="border-border/60 bg-card/80 backdrop-blur">
      <CardHeader>
        <CardTitle>Salário</CardTitle>
        <CardDescription>
          Valores usados para estimar o salário no dashboard (vencimento base, subsídios e descontos). Deixe um campo em
          branco num mês específico para usar o valor padrão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-foreground mb-3">Valores padrão</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {DEFAULT_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={`salary-default-${field.key}`}>{field.label}</Label>
                    <Input
                      id={`salary-default-${field.key}`}
                      type="number"
                      step={field.step}
                      value={toInputValue(defaults[field.key])}
                      onChange={(e) => updateDefault(field.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {sortedTimesheets.length > 0 ? (
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Ajustes por mês</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Use para refletir aumentos de vencimento, subsídio de férias/Natal recebido nesse mês, ou uma taxa de
                  IRS diferente (a taxa de IRS muda ao longo do ano conforme o rendimento acumulado).
                </p>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-left">
                        <th className="p-2 font-medium text-muted-foreground">Mês</th>
                        {MONTH_FIELDS.map((field) => (
                          <th key={field.key} className="p-2 font-medium text-muted-foreground">
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTimesheets.map((ts) => {
                        const key = salaryMonthKey(ts);
                        if (!key) return null;
                        const entry = months[key] || {};
                        return (
                          <tr key={ts.id} className="border-t border-border/60">
                            <td className="p-2 whitespace-nowrap font-medium text-foreground">
                              {ts.month} {ts.year}
                            </td>
                            {MONTH_FIELDS.map((field) => (
                              <td key={field.key} className="p-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="h-8 w-28"
                                  placeholder="—"
                                  value={toInputValue(entry[field.key])}
                                  onChange={(e) => updateMonth(key, field.key, e.target.value)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando..." : "Salvar salário"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
