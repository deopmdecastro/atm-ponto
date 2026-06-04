import { useMemo, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";

export default function SettingsPage() {
  const { user, updateProfile } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [startYear, setStartYear] = useState(user?.profile?.start_year ? String(user.profile.start_year) : String(new Date().getFullYear()));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const canSubmit = useMemo(() => {
    return status !== "loading" && email.trim() && startYear.trim();
  }, [status, email, startYear]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");

    if (newPassword && newPassword !== confirmPassword) {
      setError("A nova senha e a confirmação não coincidem.");
      return;
    }

    if ((newPassword || email !== user?.email) && !currentPassword) {
      setError("Informe a senha atual para alterar email ou senha.");
      return;
    }

    try {
      setStatus("loading");
      await updateProfile({
        email,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
        startYear: Number(startYear) || undefined
      });
      toast({
        title: "Configurações salvas",
        description: "Sua conta foi atualizada com sucesso."
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Conta</h2>
        <p className="text-sm text-muted-foreground">Atualize email, senha e ano de início do controle do timesheet.</p>
      </div>

      <Card className="border-border/60 bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle>Configurações da conta</CardTitle>
          <CardDescription>Use sua senha atual para alterar email ou senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleSave}>
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-email">Email</Label>
                <Input
                  id="settings-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-start-year">Ano de início</Label>
                <Input
                  id="settings-start-year"
                  type="number"
                  min="2000"
                  max="2100"
                  value={startYear}
                  onChange={(e) => setStartYear(e.target.value)}
                  placeholder="2024"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-current-password">Senha atual</Label>
              <Input
                id="settings-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Digite sua senha atual"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-new-password">Nova senha</Label>
                <Input
                  id="settings-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nova senha"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-confirm-password">Confirmar nova senha</Label>
                <Input
                  id="settings-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirme a nova senha"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                O ano de início define desde quando o sistema verifica meses que faltam ser carregados.
              </p>
              <Button type="submit" disabled={!canSubmit}>
                {status === "loading" ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
