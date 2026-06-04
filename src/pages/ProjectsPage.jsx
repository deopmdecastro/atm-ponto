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
  return (
    String(record?.project_number || "").trim() ||
    String(record?.project_client || "").trim() ||
    String(record?.project_description || "").trim()
  );
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

function ProjectsTable({ projects, emptyMessage, showActivity }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Número</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Cliente / Nome</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Descrição</th>
              {showActivity && (
                <>
                  <th className="px-3 py-3 text-center text-xs font-semibold uppercase text-muted-foreground">Meses</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Registos</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Último mês</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {projects.map((project) => (
              <tr key={project.key} className="transition-colors hover:bg-secondary/30">
                <td className="px-4 py-3 font-semibold tabular-nums text-foreground">{project.project_number || "-"}</td>
                <td className="min-w-[180px] px-3 py-3 text-foreground">{project.project_client || "-"}</td>
                <td className="min-w-[260px] max-w-[460px] break-words px-3 py-3 text-muted-foreground">
                  {project.project_description || "-"}
                </td>
                {showActivity && (
                  <>
                    <td className="px-3 py-3 text-center">
                      <Badge variant="secondary">{project.period_count}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{project.record_count}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                      {formatPeriod(project.last_period) || "-"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {projects.length === 0 && <div className="px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>}
    </div>
  );
}

export default function ProjectsPage() {
  const [search, setSearch] = useState("");

  const recordsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => base44.entities.TimesheetRecord.list("-date", 5000)
  });

  const configQuery = useQuery({
    queryKey: ["timesheet-config"],
    queryFn: async () => {
      const synced = await base44.reference.syncProjects();
      return synced || base44.reference.getTimesheetConfig();
    }
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
      .sort((a, b) =>
        String(a.project_number || a.project_client || a.project_description).localeCompare(
          String(b.project_number || b.project_client || b.project_description),
          "pt",
          { numeric: true, sensitivity: "base" }
        )
      );
  }, [configQuery.data, recordsQuery.data]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((project) =>
      [
        project.project_number,
        project.project_client,
        project.project_description,
        formatPeriod(project.last_period),
        ...project.period_list.map(formatPeriod)
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [projects, search]);

  const workedProjects = filteredProjects.filter((project) => project.worked);

  if (recordsQuery.isLoading || configQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  if (recordsQuery.isError || configQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {recordsQuery.error?.message || configQuery.error?.message || "Não foi possível carregar os projetos."}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Projetos</h2>
          <p className="text-sm text-muted-foreground">
            {workedProjects.length} trabalhado(s) e {filteredProjects.length} disponível(is)
          </p>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar projeto" className="pl-9" />
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-secondary">
            <FolderKanban className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Sem projetos</p>
            <p className="mt-1 text-sm text-muted-foreground">Importe um timesheet para preencher o catálogo.</p>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Projetos trabalhados</h3>
              <p className="text-sm text-muted-foreground">{workedProjects.length} projeto(s) com horas registadas</p>
            </div>
            <ProjectsTable projects={workedProjects} emptyMessage="Nenhum projeto trabalhado corresponde à pesquisa." showActivity />
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Todos os projetos disponíveis</h3>
              <p className="text-sm text-muted-foreground">
                {filteredProjects.length} projeto(s) encontrados nos catálogos dos timesheets importados
              </p>
            </div>
            <ProjectsTable projects={filteredProjects} emptyMessage="Nenhum projeto disponível corresponde à pesquisa." showActivity={false} />
          </section>
        </>
      )}
    </div>
  );
}
