import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, FolderKanban } from "lucide-react";

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

function monthIndex(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return 0;
  const numeric = Number(normalized);
  if (numeric >= 1 && numeric <= 12) return numeric;
  return monthNames.findIndex((month) => month.toLowerCase().startsWith(normalized.slice(0, 3))) + 1;
}

function periodKey(record) {
  const year = Number(record?.year || 0);
  const month = monthIndex(record?.month);
  if (!year || !month) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function formatPeriod(key) {
  const [year, month] = String(key || "").split("-");
  const name = monthNames[Number(month) - 1] || month;
  return year && month ? `${name} ${year}` : "";
}

function getProjectKey(record) {
  const number = String(record?.project_number || "").trim();
  const client = String(record?.project_client || "").trim();
  const description = String(record?.project_description || "").trim();
  return number || client || description;
}

function inferCatalogProjectParts(description) {
  const text = String(description || "").trim();
  if (!text) return { client: "", description: "" };

  const dashParts = text.split(/\s+[—–]\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length > 1) {
    return {
      client: dashParts[dashParts.length - 1],
      description: dashParts.slice(0, -1).join(" — ")
    };
  }

  const hyphenParts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (hyphenParts.length > 1 && hyphenParts[0].length <= 60) {
    return {
      client: hyphenParts[0],
      description: hyphenParts.slice(1).join(" - ")
    };
  }

  return { client: text, description: text };
}

export default function ProjectsPage() {
  const [search, setSearch] = useState("");

  const recordsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => base44.entities.TimesheetRecord.list("-date", 5000)
  });

  const configQuery = useQuery({
    queryKey: ["timesheet-config"],
    queryFn: () => base44.reference.getTimesheetConfig()
  });

  const projects = useMemo(() => {
    const records = Array.isArray(recordsQuery.data) ? recordsQuery.data : [];
    const configProjects = Array.isArray(configQuery.data?.projects) ? configQuery.data.projects : [];
    const byProject = new Map();

    configProjects.forEach((project) => {
      const code = String(project?.code || "").trim();
      const description = String(project?.description || "").trim();
      const inferred = inferCatalogProjectParts(description);
      const key = code || description;
      if (!key) return;
      byProject.set(key, {
        key,
        project_number: code,
        project_client: inferred.client,
        project_description: inferred.description || description,
        record_count: 0,
        worked: false,
        periods: new Set(),
        last_period: ""
      });
    });

    records.forEach((record) => {
      const key = getProjectKey(record);
      if (!key) return;

      const projectNumber = String(record?.project_number || "").trim();
      const projectClient = String(record?.project_client || "").trim();
      const projectDescription = String(record?.project_description || "").trim();
      const current = byProject.get(key) || {
        key,
        project_number: projectNumber,
        project_client: projectClient,
        project_description: projectDescription,
        record_count: 0,
        worked: false,
        periods: new Set(),
        last_period: ""
      };

      current.project_number = current.project_number || projectNumber;
      current.project_client = current.project_client || projectClient;
      current.project_description = current.project_description || projectDescription;
      current.record_count += 1;
      current.worked = true;

      const period = periodKey(record);
      if (period) {
        current.periods.add(period);
        if (!current.last_period || period > current.last_period) current.last_period = period;
      }

      byProject.set(key, current);
    });

    return Array.from(byProject.values())
      .map((project) => ({
        ...project,
        period_count: project.periods.size,
        period_list: Array.from(project.periods).sort()
      }))
      .sort((a, b) => {
        if (a.worked !== b.worked) return a.worked ? -1 : 1;
        const numberSort = String(a.project_number || "").localeCompare(String(b.project_number || ""), "pt", {
          numeric: true,
          sensitivity: "base"
        });
        if (numberSort !== 0) return numberSort;
        return String(a.project_client || a.project_description || "").localeCompare(
          String(b.project_client || b.project_description || ""),
          "pt",
          { sensitivity: "base" }
        );
      });
  }, [configQuery.data, recordsQuery.data]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;

    return projects.filter((project) => {
      const searchable = [
        project.project_number,
        project.project_client,
        project.project_description,
        project.worked ? "trabalhado" : "catalogo catálogo",
        formatPeriod(project.last_period),
        ...project.period_list.map(formatPeriod)
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(term);
    });
  }, [projects, search]);

  if (recordsQuery.isLoading || configQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (recordsQuery.isError || configQuery.isError) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-xl p-4 text-sm text-red-700">
        {recordsQuery.error?.message || configQuery.error?.message || "Não foi possível carregar os projetos."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Projetos</h2>
          <p className="text-sm text-muted-foreground">
            {filteredProjects.length} de {projects.length} projeto(s) encontrados no catálogo
          </p>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar projeto"
            className="pl-9"
          />
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center">
            <FolderKanban className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Sem projetos</p>
            <p className="text-sm text-muted-foreground mt-1">Importe um timesheet com lista de projetos no selet para preencher esta lista.</p>
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Número</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente / Nome</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descrição</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meses</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Registos</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Último mês</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProjects.map((project) => (
                  <tr key={project.key} className={`hover:bg-secondary/30 transition-colors ${project.worked ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3 font-semibold text-foreground tabular-nums">
                      {project.project_number || "-"}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {project.worked ? <Badge>Trabalhado</Badge> : <Badge variant="outline">Catálogo</Badge>}
                    </td>
                    <td className="px-3 py-3 text-foreground min-w-[180px]">
                      {project.project_client || "-"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground min-w-[260px] max-w-[460px] break-words">
                      {project.project_description || "-"}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Badge variant="secondary">{project.period_count}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      {project.record_count}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                      {formatPeriod(project.last_period) || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredProjects.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nenhum projeto corresponde à pesquisa.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
