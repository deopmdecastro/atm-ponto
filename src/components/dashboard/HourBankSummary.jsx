import { useMemo, useState } from "react";
import { Wallet, ArrowUp, ArrowDown, Calendar, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function HourBankSummary({ summary, history, timesheetId, onEnjoyHours }) {
  if (!summary) return null;

  const compensatedDays = history ? history.filter((h) => h.compensated).length : 0;
  const [open, setOpen] = useState(false);
  const [enjoy, setEnjoy] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const available = Number(summary.compensationAvailableHours ?? summary.hourBank ?? 0);
  const used = Number(summary.compensationUsedHours ?? summary.totalCompensatedHours ?? 0);
  const total = Number(summary.totalCompensationHours ?? available + used);

  const parsedEnjoy = useMemo(() => {
    const v = Number(String(enjoy).replace(",", "."));
    return Number.isFinite(v) ? v : NaN;
  }, [enjoy]);

  const canEnjoy =
    Boolean(timesheetId) &&
    typeof onEnjoyHours === "function" &&
    !saving &&
    Number.isFinite(parsedEnjoy) &&
    parsedEnjoy > 0 &&
    parsedEnjoy <= available;

  return (
    <div className="bg-card rounded-xl border border-border p-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Horas Compensadas</h3>
          <p className="text-xs text-muted-foreground break-words leading-snug">
            Total de horas compensadas, quantas já gozou, e quantas estão disponíveis.
          </p>
        </div>

        {timesheetId && typeof onEnjoyHours === "function" && (
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) {
                setError("");
                setEnjoy("1");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2 whitespace-nowrap">
                <MinusCircle className="h-4 w-4" />
                Gozar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gozar horas compensadas</DialogTitle>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="enjoy-hours">Horas a gozar</Label>
                <Input
                  id="enjoy-hours"
                  inputMode="decimal"
                  value={enjoy}
                  onChange={(e) => setEnjoy(e.target.value)}
                  placeholder="Ex: 1.5"
                />
                <p className="text-xs text-muted-foreground">
                  Disponível agora: <span className="font-medium text-foreground tabular-nums">{available.toFixed(1)}h</span>
                </p>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                  Cancelar
                </Button>
                <Button
                  onClick={async () => {
                    setError("");
                    if (!Number.isFinite(parsedEnjoy) || parsedEnjoy <= 0) {
                      setError("Indique um número de horas válido.");
                      return;
                    }
                    if (parsedEnjoy > available) {
                      setError("Não tens horas suficientes disponíveis.");
                      return;
                    }
                    try {
                      setSaving(true);
                      await onEnjoyHours(parsedEnjoy);
                      setOpen(false);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={!canEnjoy}
                >
                  Confirmar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between gap-4 bg-accent/50 rounded-lg p-4 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Disponível</p>
              <p className="text-sm text-muted-foreground">Horas que ainda pode gozar</p>
            </div>
          </div>
          <p className="text-xl font-bold text-primary tabular-nums whitespace-nowrap">{available.toFixed(1)}h</p>
        </div>

        <div className="flex items-center justify-between gap-4 bg-green-50 rounded-lg p-4 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
            <ArrowUp className="h-5 w-5 text-green-600" />
          </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-sm text-muted-foreground">Disponíveis + gozadas</p>
            </div>
          </div>
          <p className="text-xl font-bold text-green-700 tabular-nums whitespace-nowrap">{total.toFixed(1)}h</p>
        </div>

        {used > 0 && (
          <div className="flex items-center justify-between gap-4 bg-blue-50 rounded-lg p-4 min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <ArrowDown className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Gozadas</p>
                <p className="text-sm text-muted-foreground">Horas já consumidas</p>
              </div>
            </div>
            <p className="text-xl font-bold text-blue-700 tabular-nums whitespace-nowrap">{used.toFixed(1)}h</p>
          </div>
        )}
      </div>

      {compensatedDays > 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>{compensatedDays} dia(s) compensado(s)</span>
        </div>
      )}
    </div>
  );
}
