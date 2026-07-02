

import { useCallback, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClientInstance } from "@/lib/query-client";
import { MONTH_NAMES_PT, monthIndex, readTimesheetFile } from "@/lib/parseTimesheetClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeMonthLabel(value) {
  const idx = monthIndex(value);
  return idx > 0 ? MONTH_NAMES_PT[idx - 1] : clean(value);
}

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | uploading | extracting | saving | done | error
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState({ period: "", employeeLabel: "" });
  const confirmResolveRef = useRef(null);
  const navigate = useNavigate();

  function requestReplaceConfirmation({ period, employeeLabel }) {
    setConfirmInfo({ period: String(period || ""), employeeLabel: String(employeeLabel || "") });
    setConfirmOpen(true);
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
    });
  }

  function resolveReplaceConfirmation(ok) {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmOpen(false);
    if (typeof resolve === "function") resolve(Boolean(ok));
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
      setFile(f);
      setError("");
    } else {
      setError("Por favor selecione um arquivo Excel (.xlsx ou .xls)");
    }
  }, []);

  async function handleUpload() {
    if (!file) return;

    try {
      setStatus("extracting");
      setProgress("A ler o ficheiro Excel...");

      const { meta: importedMeta, records: parsedRecords, projects } = await readTimesheetFile(file);
      const dailyRecords = Array.isArray(parsedRecords) ? parsedRecords : [];

      if (dailyRecords.length === 0) {
        setStatus("error");
        setError("Não foram encontrados registos diários no ficheiro. Verifica se o ficheiro é uma Folha de Imputação ATM válida com a aba 'TimeSheet' preenchida.");
        return;
      }

      const firstDate = dailyRecords.find((r) => r?.date)?.date || "";
      const dateMonth = firstDate.slice(5, 7);
      const dateYear = firstDate.slice(0, 4);
      const parsedMonth = normalizeMonthLabel(importedMeta?.month);
      const finalMonth = parsedMonth || (dateMonth ? MONTH_NAMES_PT[Number(dateMonth) - 1] : "");
      const finalYear = Number(importedMeta?.year) || (dateYear ? Number(dateYear) : new Date().getFullYear());
      const employeeName = clean(importedMeta?.employee_name) || "Desconhecido";
      const employeeNumber = clean(importedMeta?.employee_number);

      let fileUrl = "";
      try {
        setStatus("uploading");
        setProgress("A guardar o ficheiro original no servidor...");
        const uploadResult = await base44.integrations.Core.UploadFile({ file });
        fileUrl = String(uploadResult?.file_url || "");
      } catch {
        // Non-fatal: a importação continua mesmo sem guardar o ficheiro original.
      }

      setStatus("saving");
      setProgress(`A guardar ${dailyRecords.length} registos...`);

      const totalCompensationHours = dailyRecords.reduce((acc, row) => acc + Number(row?.extra_hours || 0), 0);
      const timesheetPayload = {
        employee_name: employeeName,
        employee_number: employeeNumber,
        month: finalMonth,
        year: finalYear,
        department: clean(importedMeta?.department),
        funcao: clean(importedMeta?.funcao),
        direcao: clean(importedMeta?.direcao),
        centro_custo: clean(importedMeta?.centro_custo),
        cct: clean(importedMeta?.cct),
        horario: clean(importedMeta?.horario),
        email_remetente: clean(importedMeta?.email_remetente),
        email_nivel1: clean(importedMeta?.email_nivel1),
        email_nivel2: clean(importedMeta?.email_nivel2),
        source_filename: file?.name || "",
        source_file_url: fileUrl,
        total_compensation_hours: totalCompensationHours,
        total_descanso_compensatorio_hours: 0
      };

      let timesheet = null;
      if (typeof base44.entities?.Timesheet?.create === "function") {
        try {
          timesheet = await base44.entities.Timesheet.create(timesheetPayload);
        } catch (err) {
          if (err && typeof err === "object" && err.status === 409) {
            const period = `${timesheetPayload.month} ${timesheetPayload.year}`.trim();
            const employeeLabel = timesheetPayload.employee_number
              ? `${timesheetPayload.employee_name} (Nº ${timesheetPayload.employee_number})`
              : timesheetPayload.employee_name;

            const ok = await requestReplaceConfirmation({ period, employeeLabel });
            if (!ok) {
              setStatus("idle");
              setProgress("");
              return;
            }

            timesheet = await base44.entities.Timesheet.create({ ...timesheetPayload, replace: true });
          } else {
            throw err;
          }
        }
      }

      const toCreate = dailyRecords.map((r) => ({
        ...(timesheet ? { timesheet_id: timesheet.id } : {}),
        employee_name: employeeName,
        employee_number: employeeNumber,
        month: finalMonth,
        year: finalYear,
        date: r.date,
        normal_hours: Number(r.normal_hours || 0),
        extra_hours: Number(r.extra_hours || 0),
        travel_hours: Number(r.travel_hours || 0),
        absence_hours: Number(r.absence_hours || 0),
        day_type: r.day_type || "",
        absence_type: r.absence_type || "",
        project_number: r.project_number || "",
        project_client: r.project_client || "",
        project_description: r.project_description || "",
        compensated: false,
        period_start: r.period_start || "",
        period_end: r.period_end || "",
        pause_hours: Number(r.pause_hours || 0),
        status: "normal",
        observations: r.observacoes || r.observations || "",
        extra1_start: r.extra1_start || "",
        extra1_end: r.extra1_end || "",
        extra2_start: r.extra2_start || "",
        extra2_end: r.extra2_end || "",
        extra_motivo: r.extra_motivo || "",
        travel1_start: r.travel1_start || "",
        travel1_end: r.travel1_end || "",
        travel2_start: r.travel2_start || "",
        travel2_end: r.travel2_end || "",
        absence_start: r.absence_start || "",
        absence_end: r.absence_end || "",
        subsidio_almoco: Boolean(r.subsidio_almoco),
        prevencao: Boolean(r.prevencao),
        deslocado: Boolean(r.deslocado),
        local_deslocacao: r.local_deslocacao || "",
        motivo_deslocacao: r.motivo_deslocacao || ""
      }));

      await base44.entities.TimesheetRecord.bulkCreate(toCreate);

      setProgress("A atualizar o catálogo de projetos...");
      if (Array.isArray(projects) && projects.length > 0) {
        await base44.reference.mergeProjects(projects);
      } else {
        await base44.reference.syncProjects();
      }

      await Promise.all([
        queryClientInstance.invalidateQueries({ queryKey: ["timesheet-config"] }),
        queryClientInstance.invalidateQueries({ queryKey: ["projects"] }),
        queryClientInstance.invalidateQueries({ queryKey: ["timesheets"] }),
        queryClientInstance.invalidateQueries({ queryKey: ["timesheet-records", "all"] })
      ]);

      if (timesheet?.id) {
        try {
          localStorage.setItem("atm.selectedTimesheetId", timesheet.id);
        } catch {
          // ignore
        }
      }

      setStatus("done");
      setProgress(`${toCreate.length} registos importados com sucesso!`);
      setTimeout(() => navigate("/"), 2000);
    } catch (e) {
      setStatus("error");
      const message = e instanceof Error ? e.message : String(e);
      setError(`Falha ao importar a folha de ponto. ${message}`);
    }
  }

  return (
    <>
      <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Importar Folha de Ponto</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Faça upload do arquivo Excel (.xlsx) com a folha de imputação
        </p>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer hover:border-primary/50 hover:bg-accent/30 ${
          file ? "border-primary bg-accent/20" : "border-border"
        }`}
        onClick={() => document.getElementById("file-input").click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => handleDrop(e)}
        />
        {file ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <FileSpreadsheet className="h-8 w-8 text-primary" />
            </div>
            <div className="max-w-full">
              <p className="font-semibold text-foreground max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {(file.size / 1024).toFixed(1)} KB • Pronto para importar
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Arraste o arquivo aqui</p>
              <p className="text-xs text-muted-foreground mt-1">ou clique para selecionar • .xlsx ou .xls</p>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Progress */}
      {status !== "idle" && status !== "error" && (
        <div className="flex items-center gap-3 bg-accent rounded-xl p-4">
          {status === "done" ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          ) : (
            <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
          )}
          <p className="text-sm font-medium text-foreground">{progress}</p>
        </div>
      )}

      {/* Upload button */}
      <Button
        size="lg"
        className="w-full gap-2"
        disabled={!file || (status !== "idle" && status !== "error")}
        onClick={handleUpload}
      >
        {status === "idle" || status === "error" ? (
          <>
            <Upload className="h-4 w-4" />
            Importar Dados
          </>
        ) : status === "done" ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Importado com sucesso!
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processando...
          </>
        )}
      </Button>
    </div>

    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        if (!open && confirmOpen) resolveReplaceConfirmation(false);
        else setConfirmOpen(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Substituir folha de ponto?</AlertDialogTitle>
          <AlertDialogDescription>
            Já existe uma folha de ponto importada de <strong>{confirmInfo.period}</strong> para{" "}
            <strong>{confirmInfo.employeeLabel}</strong>.
            <br />
            <br />
            Pretende substituir? Isto irá apagar o import anterior desse mês.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveReplaceConfirmation(false)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => resolveReplaceConfirmation(true)}>
            Substituir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
);
}
