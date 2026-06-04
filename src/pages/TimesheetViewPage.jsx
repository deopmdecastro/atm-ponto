import { useParams } from 'react-router-dom';

export default function TimesheetViewPage() {
  const { timesheetId } = useParams();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-3xl font-bold">Visualizar Timesheet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          ID do Timesheet: {timesheetId}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-muted-foreground">
          Conteúdo do timesheet será exibido aqui.
        </p>
      </div>
    </div>
  );
}
