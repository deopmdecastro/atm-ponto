 

import { useRef, useState, useCallback } from "react";
=======
import { useCallback, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | uploading | extracting | saving | done | error
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState({ period: "", employeeLabel: "" });
  const confirmResolveRef = useRef(null);
  const navigate = useNavigate();
  const confirmResolveRef = useRef(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState({ period: "", employeeLabel: "" });

  function confirmReplace({ period, employeeLabel }) {
    setConfirmInfo({ period: String(period || ""), employeeLabel: String(employeeLabel || "") });
    setConfirmOpen(true);
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
    });
  }

  function closeConfirm(choice) {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmOpen(false);
    if (typeof resolve === "function") resolve(Boolean(choice));
  }

  function requestReplaceConfirmation({ period, employeeLabel }) {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmInfo({ period, employeeLabel });
      setConfirmOpen(true);
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
      setStatus("uploading");
      setProgress("A fazer upload do ficheiro...");

      // 1. Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      setStatus("extracting");
      setProgress("A ler as linhas da folha de ponto...");

    // 2. Extract raw rows from TimeSheet tab
    const rawResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            description: "All rows from the TimeSheet sheet as raw key-value pairs",
            items: { type: "object" }
          }
        }
      }
    });

    if (rawResult.status === "error") {
      setStatus("error");
      setError(`Não foi possível ler o ficheiro Excel. Verifica se o ficheiro não está corrompido e tenta novamente. Detalhe técnico: ${rawResult.details}`);
      return;
    }

    setProgress("A interpretar os dados da folha de ponto ATM...");

    const rawRows = rawResult.output?.rows || rawResult.output || [];

    const extracted = useLocalBackend
      ? {
          ...(rawResult.output?.meta || {}),
          daily_records: rawRows
        }
      : await base44.integrations.Core.InvokeLLM({
      prompt: `Tens os dados brutos de uma folha de imputação ATM exportada de Excel. Os dados são linhas/colunas com chaves genéricas (col_0, col_1, Mês, Abr, etc).

Dados brutos:
${JSON.stringify(rawRows).substring(0, 60000)}

A folha tem:
- Linha com "Inicio" -> data de início do período
- Linha com "Fim" -> data de fim do período  
- Nome do colaborador (campo "Nome" ou similar nos primeiros rows)
- Número pessoal (campo "Nº" ou similar)
- Mês e Ano do período
- Linhas diárias com datas e horas a partir de uma certa linha

Extrai:
1. Dados do colaborador (nome, número, mês, ano, direção/departamento)
2. Para cada dia do mês (mesmo fins de semana/feriados sem horas):
   - date: YYYY-MM-DD
   - normal_hours: horas normais (número, 0 se nenhuma)
   - extra_hours: horas extraordinárias (número, 0 se nenhuma)
   - travel_hours: horas de viagem (número, 0 se nenhuma)
   - absence_hours: horas de ausência (número, 0 se nenhuma)
   - day_type: "Dia Útil", "Desc.Comp", "Desc. Obrig", ou "Feriado"
   - absence_type: motivo ausência ou ""
   - period_start: hora entrada HH:MM ou ""
   - period_end: hora saída HH:MM ou ""
   - pause_hours: pausa/almoço (número)
   - project_number: nº projeto ou ""
   - project_client: cliente ou ""
   - project_description: descrição ou ""

Ignora linhas de totais/cabeçalhos sem data. Devolve só o JSON.`,
      response_json_schema: {
        type: "object",
        properties: {
          employee_name: { type: "string" },
          employee_number: { type: "string" },
          month: { type: "string" },
          year: { type: "number" },
          department: { type: "string" },
          daily_records: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                normal_hours: { type: "number" },
                extra_hours: { type: "number" },
                travel_hours: { type: "number" },
                absence_hours: { type: "number" },
                day_type: { type: "string" },
                absence_type: { type: "string" },
                period_start: { type: "string" },
                period_end: { type: "string" },
                pause_hours: { type: "number" },
                project_number: { type: "string" },
                project_client: { type: "string" },
                project_description: { type: "string" },
              }
            }
          }
        }
      }
    });

    const dailyRecords = extracted.daily_records || [];
    if (dailyRecords.length === 0) {
      setStatus("error");
      setError("Não foram encontrados registos diários no ficheiro. Verifica se o ficheiro é uma Folha de Imputação ATM válida com a aba 'TimeSheet' preenchida.");
      return;
    }

    setStatus("saving");
    setProgress(`A guardar ${dailyRecords.length} registos...`);

    const canCreateTimesheet = typeof base44.entities?.Timesheet?.create === "function";

    // 3. Create a new timesheet (do not delete older imports)
    const timesheetPayload = {
      employee_name: extracted.employee_name || "Desconhecido",
      employee_number: String(extracted.employee_number || ""),
      month: extracted.month || "",
      year: extracted.year || new Date().getFullYear(),
      department: extracted.department || extracted.observations || "",
      source_filename: file?.name || "",
      total_compensation_hours: extracted.total_compensation_hours ?? 0,
      total_descanso_compensatorio_hours: extracted.total_descanso_compensatorio_hours ?? 0
    };

    let timesheet = null;
    if (canCreateTimesheet) {
      try {
        timesheet = await base44.entities.Timesheet.create(timesheetPayload);
      } catch (err) {
        if (err && typeof err === "object" && err.status === 409) {
          const period = `${timesheetPayload.month} ${timesheetPayload.year}`.trim();
          const employeeLabel = timesheetPayload.employee_number
            ? `${timesheetPayload.employee_name} (Nº ${timesheetPayload.employee_number})`
            : timesheetPayload.employee_name;

<<<<<<< HEAD
          const ok = await confirmReplace({ period, employeeLabel });
=======
          const ok = await requestReplaceConfirmation({ period, employeeLabel }); /*
            `Já existe um timesheet importado de ${period} para ${employeeLabel}.\n\nPretende substituir? Isto irá apagar o import anterior desse mês.`
          */
>>>>>>> minhas-edicoes

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

    // 4. Create new records
    const toCreate = dailyRecords.map(r => ({
      ...(timesheet ? { timesheet_id: timesheet.id } : {}),
      employee_name: extracted.employee_name || "Desconhecido",
      employee_number: String(extracted.employee_number || ""),
      month: extracted.month || "",
      year: extracted.year || new Date().getFullYear(),
      date: r.date,
      normal_hours: r.normal_hours || 0,
      extra_hours: r.extra_hours || 0,
      travel_hours: r.travel_hours || 0,
      absence_hours: r.absence_hours || 0,
      day_type: r.day_type || "",
      absence_type: r.absence_type || "",
      project_number: r.project_number || "",
      project_client: r.project_client || "",
      project_description: r.project_description || "",
      compensated: false,
      period_start: r.period_start || "",
      period_end: r.period_end || "",
      pause_hours: r.pause_hours || 0,
      status: "normal",
      observations: extracted.department || "",
    }));

    await base44.entities.TimesheetRecord.bulkCreate(toCreate);
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
      setError(
        `Falha ao processar o upload no ambiente local. (${message})\n\n` +
          `Isto acontece porque as integrações (UploadFile/ExtractDataFromUploadedFile/InvokeLLM) não estão implementadas no backend local.\n` +
          `Opções: (1) configurar o Base44 cloud e definir VITE_USE_LOCAL_BACKEND=false, ou (2) implementar estas integrações no backend.`
      );
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
            <div>
              <p className="font-semibold text-foreground">{file.name}</p>
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

<<<<<<< HEAD
    <AlertDialog open={confirmOpen} onOpenChange={(open) => (open ? setConfirmOpen(true) : closeConfirm(false))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Substituir Timesheet?</AlertDialogTitle>
          <AlertDialogDescription>
            Já existe um timesheet importado de <strong>{confirmInfo.period}</strong> para{" "}
=======
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(v) => {
        if (!v && confirmOpen) resolveReplaceConfirmation(false);
        else setConfirmOpen(v);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Substituir Time Sheet?</AlertDialogTitle>
          <AlertDialogDescription>
            Já existe um time sheet importado de <strong>{confirmInfo.period}</strong> para{" "}
>>>>>>> minhas-edicoes
            <strong>{confirmInfo.employeeLabel}</strong>.
            <br />
            <br />
            Pretende substituir? Isto irá apagar o import anterior desse mês.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
<<<<<<< HEAD
          <AlertDialogCancel onClick={() => closeConfirm(false)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => closeConfirm(true)}>
=======
          <AlertDialogCancel onClick={() => resolveReplaceConfirmation(false)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => resolveReplaceConfirmation(true)}>
>>>>>>> minhas-edicoes
            Substituir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
<<<<<<< HEAD
=======
    </>
>>>>>>> minhas-edicoes
  );
}
