import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Building, Hash, KeyRound, Mail, Shield, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PasswordInput from "@/components/PasswordInput";

function profileValue(user, key, fallback = "-") {
  const value = String(user?.profile?.[key] || "").trim();
  return value || fallback;
}

export default function EmployeesPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const data = await base44.users.listRegistered(500);
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function openPasswordReset(user) {
    setResetTarget(user);
    setNewPassword("");
    setConfirmPassword("");
    setError("");
  }

  async function handlePasswordReset() {
    if (newPassword.length < 10) {
      setError("A nova senha deve ter pelo menos 10 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await base44.users.resetPassword(resetTarget.id, newPassword);
      setResetTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Colaboradores</h2>
        <p className="text-sm text-muted-foreground">{users.length} conta(s) criada(s) na plataforma</p>
      </div>

      {error && !resetTarget && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {users.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-secondary">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Sem contas criadas</p>
            <p className="mt-1 text-sm text-muted-foreground">Os colaboradores aparecerão depois de criarem uma conta.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Nome</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Equipe</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Número</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Email</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold uppercase text-muted-foreground">Perfil</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="transition-colors hover:bg-secondary/30">
                    <td className="px-4 py-3 font-semibold text-foreground">{profileValue(user, "employee_name", user.email)}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <Building className="h-4 w-4 flex-none" />
                        {profileValue(user, "department")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <Hash className="h-4 w-4 flex-none" />
                        {profileValue(user, "employee_number")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <Mail className="h-4 w-4 flex-none" />
                        {user.email}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                        <Shield className="h-3 w-3" />
                        {user.role === "admin" ? "Admin" : "Utilizador"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => openPasswordReset(user)}>
                        <KeyRound className="h-4 w-4" />
                        Repor senha
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Repor senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Defina uma nova senha para <strong className="text-foreground">{resetTarget?.email}</strong>. Todas as sessões atuais serão terminadas.
            </p>
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="admin-new-password">Nova senha</Label>
              <PasswordInput
                id="admin-new-password"
                autoComplete="new-password"
                minLength={10}
                maxLength={256}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Mínimo de 10 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-confirm-password">Confirmar nova senha</Label>
              <PasswordInput
                id="admin-confirm-password"
                autoComplete="new-password"
                minLength={10}
                maxLength={256}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repita a nova senha"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancelar</Button>
            <Button onClick={handlePasswordReset} disabled={saving || !newPassword || !confirmPassword}>
              {saving ? "A repor..." : "Repor senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
