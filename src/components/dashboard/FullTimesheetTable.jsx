 

import { Calendar as CalendarIcon, CheckSquare, ClipboardList, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/formatHours";

const STATUS_STYLES = {
  Disponível: "bg-primary text-primary-foreground border-transparent",
  Gozado: "bg-secondary text-secondary-foreground border-transparent",
  Normal: "border-slate-300 text-slate-500"
};

function txt(value) {
  const v = value == null ? "" : String(value).trim();
  return v ? v : <span className="text-slate-300">—</span>;
}

function hrs(value) {
  const n = Number(value || 0);
  return n > 0 ? formatHours(n) : "—";
}

function Check({ checked }) {
  return checked ? (
    <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto" />
  ) : (
    <Square className="h-4 w-4 text-slate-200 mx-auto" />
  );
}

/**
 * Read-only mirror of the "Preencher" full 30-column table, used to view a
 * saved timesheet's daily records exactly the way they were filled in —
 * same grouped header (Normais / Extraordinárias / Ausências / Tipo Dia /
 * Subsídios / Imputação / Observações), same column numbering.
 *
 * Note: extra1/2, travel1/2, absence de/a, subsidio_almoco, prevencao,
 * deslocado, local/motivo deslocação only exist in the database for
 * timesheets saved from Preencher after this feature was added, or
 * re-saved since. Older / imported-only records will show "—" for those.
 */
export default function FullTimesheetTable({ records, onToggleCompensate }) {
  if (!records || records.length === 0) return null;

  const rows = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));

  const totals = rows.reduce(
    (acc, r) => ({
      normal: acc.normal + Number(r.normal_hours || 0),
      extra: acc.extra + Number(r.extra_hours || 0),
      travel: acc.travel + Number(r.travel_hours || 0),
      absence: acc.absence + Number(r.absence_hours || 0)
    }),
    { normal: 0, extra: 0, travel: 0, absence: 0 }
  );

  const WEEKDAY_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden">
      <div className="max-h-[75vh] overflow-auto">
        <table className="border-collapse text-[11px] w-full">
          <thead className="sticky top-0 z-20 text-center font-semibold text-slate-700 bg-slate-100">
            {/* Row 1 — group labels */}
            <tr>
              <th rowSpan={4} className="sticky left-0 z-30 bg-slate-100 border border-slate-300 px-2 py-1 align-middle min-w-[100px] text-left">
                <span className="flex items-center gap-1.5"><CalendarIcon className="h-3 w-3 text-red-500" />Dia</span>
              </th>
              <th colSpan={4} className="border border-slate-300 px-2 py-1 bg-slate-200 text-slate-700">NORMAIS</th>
              <th colSpan={11} className="border border-slate-300 px-2 py-1 bg-amber-50 text-amber-800">EXTRAORDINÁRIAS</th>
              <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-slate-200 text-slate-700">AUSÊNCIAS / PRESENÇAS</th>
              <th rowSpan={3} className="border border-slate-300 px-2 py-1 align-middle min-w-[90px] bg-slate-100">TIPO DIA</th>
              <th colSpan={5} className="border border-slate-300 px-2 py-1 bg-slate-200 text-slate-700">SUBSÍDIOS</th>
              <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-red-50 text-red-800">IMPUTAÇÃO</th>
              <th rowSpan={4} className="border border-slate-300 px-2 py-1 align-middle min-w-[120px] bg-slate-100">OBSERVAÇÕES</th>
              <th rowSpan={4} className="border border-slate-300 px-1 py-1 align-middle w-[90px] bg-slate-100">BANCO DE HORAS</th>
            </tr>

            {/* Row 2 — subgroup labels */}
            <tr>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[62px] bg-emerald-50 text-emerald-800">Total</th>
              <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-slate-100">PERÍODO</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[62px] bg-amber-50 text-amber-800">Total Extra</th>
              <th colSpan={5} className="border border-slate-300 px-2 py-1 bg-amber-50 text-amber-700">Suplementares</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[62px] bg-cyan-50 text-cyan-800">Total Viagem</th>
              <th colSpan={4} className="border border-slate-300 px-2 py-1 bg-cyan-50 text-cyan-700">HORAS DE VIAGEM</th>
              <th colSpan={3} className="border border-slate-300 px-2 py-1 bg-slate-100">Horas de Ausência/Presença</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[52px] bg-slate-100">S.Alim.</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[52px] bg-slate-100">Prev.</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle w-[52px] bg-slate-100">Desl.</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[90px] bg-slate-100">Local</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[100px] bg-slate-100">Motivo Desl.</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[100px] bg-red-50 text-red-700">Nº Projeto</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[200px] bg-red-50 text-red-700">Cliente de Projeto</th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle min-w-[200px] bg-red-50 text-red-700">Descrição de Projeto</th>
            </tr>

            {/* Row 3 — detail column labels */}
            <tr>
              <th className="border border-slate-300 px-1 py-1 w-[68px] bg-slate-50">de</th>
              <th className="border border-slate-300 px-1 py-1 w-[68px] bg-slate-50">a</th>
              <th className="border border-slate-300 px-1 py-1 w-[60px] bg-slate-50">Pausa</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">1º HE de</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">1º HE a</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">2º HE de</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-amber-50">2º HE a</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[100px] bg-amber-50">Motivo TS</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Ida Início</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Ida Fim</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Volta Início</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[80px] bg-cyan-50">Volta Fim</th>
              <th className="border border-slate-300 px-1 py-1 min-w-[140px] bg-slate-50">Tipo de Ausência/Presença</th>
              <th className="border border-slate-300 px-1 py-1 w-[60px] bg-slate-50">de</th>
              <th className="border border-slate-300 px-1 py-1 w-[60px] bg-slate-50">a</th>
            </tr>

            {/* Row 4 — column numbers (matches the original Excel numbering) */}
            <tr className="text-slate-400 font-normal text-[10px]">
              {["(2)","(3)","(4)","(5)","(6)","(7)","(8)","(9)","(10)","(11)","(12)","(13)","(14)","(15)","(16)","(18)","(19)","(20)","(21)","(22)","(23)","(24)","(25)","(26)","(27)","(28)","(29)"].map((n, i) => (
                <th key={i} className="border border-slate-300 px-1 py-0.5 bg-slate-50">{n}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, idx) => {
              const isWknd = row.day_type === "Desc.Comp" || row.day_type === "Desc. Obrig";
              const isFeriado = row.day_type === "Feriado";
              const hasHours = Number(row.normal_hours || 0) > 0;
              const hasExtra = Number(row.extra_hours || 0) > 0;
              const hasTravel = Number(row.travel_hours || 0) > 0;
              const d = new Date(row.date + "T00:00:00");
              const weekday = WEEKDAY_PT[d.getDay()];
              const dayNum = String(d.getDate()).padStart(2, "0");
              const monthNum = String(d.getMonth() + 1).padStart(2, "0");

              const rowBg = isFeriado ? "bg-blue-50/40"
                          : isWknd ? "bg-amber-50/30"
                          : idx % 2 === 0 ? "bg-white" : "bg-slate-50/40";

              // Sticky column needs a fully opaque background — see fix in Preencher.
              const solidBg = isFeriado ? "bg-blue-50"
                            : isWknd ? "bg-amber-50"
                            : idx % 2 === 0 ? "bg-white" : "bg-slate-50";

              const td = (extra = "") => `border border-slate-200 px-1.5 py-1.5 align-middle ${extra}`;

              return (
                <tr key={row.id || row.date} className={`hover:bg-sky-50/60 transition-colors ${rowBg}`}>
                  {/* (1) Dia — sticky */}
                  <td className={`sticky left-0 z-10 border border-slate-200 px-2 py-1.5 align-middle min-w-[100px] ${solidBg}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isWknd || isFeriado ? "bg-red-400" : "bg-emerald-400"}`} />
                      <div>
                        <div className={`font-bold text-[11px] ${isWknd ? "text-red-600" : "text-blue-700"}`}>
                          {weekday} {dayNum}/{monthNum}
                        </div>
                        <div className="text-[9px] text-slate-400">{row.date.slice(0, 4)}</div>
                      </div>
                    </div>
                  </td>

                  {/* (2) Total Normais */}
                  <td className={td("text-center w-[62px] bg-emerald-50/40")}>
                    <span className={`font-bold tabular-nums ${hasHours ? "text-emerald-700" : "text-slate-300"}`}>{hrs(row.normal_hours)}</span>
                  </td>
                  {/* (3-5) Entrada/Saída/Pausa */}
                  <td className={td("w-[68px] text-center")}>{txt(row.period_start)}</td>
                  <td className={td("w-[68px] text-center")}>{txt(row.period_end)}</td>
                  <td className={td("w-[60px] text-center")}>{row.pause_hours ? hrs(row.pause_hours) : <span className="text-slate-300">—</span>}</td>

                  {/* (6) Total Extra */}
                  <td className={td("text-center w-[62px] bg-amber-50/60")}>
                    <span className={`font-bold tabular-nums ${hasExtra ? "underline text-amber-700" : "text-slate-300"}`}>{hrs(row.extra_hours)}</span>
                  </td>
                  {/* (7-10) HE períodos */}
                  <td className={td("min-w-[80px] bg-amber-50/20 text-center")}>{txt(row.extra1_start)}</td>
                  <td className={td("min-w-[80px] bg-amber-50/20 text-center")}>{txt(row.extra1_end)}</td>
                  <td className={td("min-w-[80px] bg-amber-50/20 text-center")}>{txt(row.extra2_start)}</td>
                  <td className={td("min-w-[80px] bg-amber-50/20 text-center")}>{txt(row.extra2_end)}</td>
                  {/* (11) Motivo TS */}
                  <td className={td("min-w-[100px] bg-amber-50/20 italic text-blue-600")}>{txt(row.extra_motivo)}</td>

                  {/* (12) Total Viagem */}
                  <td className={td("text-center w-[62px] bg-cyan-50/40")}>
                    <span className={`font-bold tabular-nums ${hasTravel ? "text-cyan-700" : "text-slate-300"}`}>{hrs(row.travel_hours)}</span>
                  </td>
                  {/* (13-16) Viagem */}
                  <td className={td("min-w-[80px] bg-cyan-50/20 text-center")}>{txt(row.travel1_start)}</td>
                  <td className={td("min-w-[80px] bg-cyan-50/20 text-center")}>{txt(row.travel1_end)}</td>
                  <td className={td("min-w-[80px] bg-cyan-50/20 text-center")}>{txt(row.travel2_start)}</td>
                  <td className={td("min-w-[80px] bg-cyan-50/20 text-center")}>{txt(row.travel2_end)}</td>

                  {/* (18) Tipo Ausência */}
                  <td className={td("min-w-[140px]")}>{txt(row.absence_type)}</td>
                  {/* (19-20) Ausência de/a */}
                  <td className={td("w-[60px] text-center")}>{txt(row.absence_start)}</td>
                  <td className={td("w-[60px] text-center")}>{txt(row.absence_end)}</td>

                  {/* (21) Tipo Dia */}
                  <td className={td("min-w-[90px]")}>{txt(row.day_type)}</td>

                  {/* (22-24) Subsídios */}
                  <td className={td("text-center w-[52px]")}><Check checked={!!row.subsidio_almoco} /></td>
                  <td className={td("text-center w-[52px]")}><Check checked={!!row.prevencao} /></td>
                  <td className={td("text-center w-[52px]")}><Check checked={!!row.deslocado} /></td>

                  {/* (25-26) Local / Motivo Deslocação */}
                  <td className={td("min-w-[90px] text-slate-600")}>{txt(row.local_deslocacao)}</td>
                  <td className={td("min-w-[100px] text-slate-600")}>{txt(row.motivo_deslocacao)}</td>

                  {/* (27) Nº Projeto */}
                  <td className={td("min-w-[100px] bg-red-50/20")}>{txt(row.project_number)}</td>
                  {/* (28) Cliente */}
                  <td className={td("min-w-[200px] bg-red-50/20 font-medium text-slate-700")}>{txt(row.project_client)}</td>
                  {/* (29) Descrição */}
                  <td className={td("min-w-[200px] bg-red-50/20 text-slate-600")}>{txt(row.project_description)}</td>

                  {/* (30) Observações */}
                  <td className={td("min-w-[120px] text-slate-500")}>{txt(row.observations)}</td>

                  {/* Banco de Horas — toggle de compensação (substitui a coluna Ações do Preencher, que só faz sentido a editar) */}
                  <td className="border border-slate-200 px-1 py-1 text-center align-middle w-[90px]">
                    <Badge
                      variant="outline"
                      className={cn("cursor-pointer text-[10px] whitespace-nowrap", STATUS_STYLES[row.compensated ? "Gozado" : "Disponível"])}
                      onClick={() => onToggleCompensate && onToggleCompensate(row)}
                    >
                      {row.compensated ? "Gozado" : "Disponível"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="sticky bottom-0 z-20 bg-slate-100 border-t-2 border-slate-300 font-bold text-[11px]">
              <td className="sticky left-0 z-30 bg-slate-100 border border-slate-300 px-2 py-1.5 text-slate-700">
                <span className="flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5 text-red-500" />TOTAL</span>
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-center text-emerald-700 tabular-nums">{formatHours(totals.normal)}</td>
              <td className="border border-slate-300" colSpan={3} />
              <td className="border border-slate-300 px-2 py-1.5 text-center text-amber-700 tabular-nums">{formatHours(totals.extra)}</td>
              <td className="border border-slate-300" colSpan={5} />
              <td className="border border-slate-300 px-2 py-1.5 text-center text-cyan-700 tabular-nums">{formatHours(totals.travel)}</td>
              <td className="border border-slate-300" colSpan={4} />
              <td className="border border-slate-300 px-2 py-1.5 text-center text-slate-600 tabular-nums" title="Total de ausências">{formatHours(totals.absence)}</td>
              <td className="border border-slate-300" colSpan={13} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
