 

import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Pencil, Trash2, Users, Mail, Building, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const EMPTY = { full_name: "", employee_number: "", email: "", department: "", function: "", company: "", active: true };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const data = await base44.entities.Employee.list("-created_date", 200);
    setEmployees(data);
    setLoading(false);
  }

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(emp) {
    setEditTarget(emp);
    setForm({ ...emp });
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    if (editTarget) {
      await base44.entities.Employee.update(editTarget.id, form);
    } else {
      await base44.entities.Employee.create(form);
      // Invite user to the app
      if (form.email) {
        setInviting(true);
        await base44.users.inviteUser(form.email, "user");
        setInviting(false);
      }
    }
    setSaving(false);
    setDialogOpen(false);
    await loadData();
  }

  async function handleDelete(emp) {
    await base44.entities.Employee.delete(emp.id);
    setDeleteTarget(null);
    await loadData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Colaboradores</h2>
          <p className="text-sm text-muted-foreground">{employees.length} colaborador(es) registado(s)</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Novo Colaborador
        </Button>
      </div>

      {employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Sem colaboradores</p>
            <p className="text-sm text-muted-foreground mt-1">Adicione colaboradores para gerir as suas horas</p>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Adicionar Colaborador</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {employees.map(emp => (
            <div key={emp.id} className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-bold text-lg">
                    {emp.full_name?.charAt(0)?.toUpperCase() || "?"}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{emp.full_name}</span>
                    {emp.active === false && (
                      <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">Inativo</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {emp.email && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" /> {emp.email}
                      </span>
                    )}
                    {emp.employee_number && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Hash className="h-3 w-3" /> {emp.employee_number}
                      </span>
                    )}
                    {emp.department && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building className="h-3 w-3" /> {emp.department}
                      </span>
                    )}
                    {emp.function && (
                      <span className="text-xs text-muted-foreground">{emp.function}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => openEdit(emp)}>
                  <Pencil className="h-4 w-4 mr-1" /> Editar
                </Button>
                <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200" onClick={() => setDeleteTarget(emp)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Editar Colaborador" : "Novo Colaborador"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome Completo *</Label>
              <Input className="mt-1" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Ex: João Silva" />
            </div>
            <div>
              <Label>Email *</Label>
              <Input className="mt-1" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="joao.silva@empresa.com" />
              {!editTarget && <p className="text-xs text-muted-foreground mt-1">Será enviado convite de acesso para este email.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nº Pessoal</Label>
                <Input className="mt-1" value={form.employee_number} onChange={e => setForm(f => ({ ...f, employee_number: e.target.value }))} placeholder="Ex: 63001234" />
              </div>
              <div>
                <Label>Empresa</Label>
                <Input className="mt-1" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Ex: ATM" />
              </div>
            </div>
            <div>
              <Label>Direção / Departamento</Label>
              <Input className="mt-1" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Ex: Serviços" />
            </div>
            <div>
              <Label>Função</Label>
              <Input className="mt-1" value={form.function} onChange={e => setForm(f => ({ ...f, function: e.target.value }))} placeholder="Ex: Técnico AVAC" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name || !form.email}>
              {saving || inviting ? (inviting ? "A enviar convite..." : "A guardar...") : (editTarget ? "Guardar" : "Criar e Convidar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Colaborador</AlertDialogTitle>
            <AlertDialogDescription>
              Tens a certeza que queres remover <strong>{deleteTarget?.full_name}</strong>? Esta ação não apaga os seus timesheets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => handleDelete(deleteTarget)}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}