 

import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import AlertsList from "../components/dashboard/AlertsList";
import { calculateSummary } from "../lib/parseTimesheet";

export default function AlertsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const selected = localStorage.getItem("atm.selectedTimesheetId");
    const data =
      selected && selected !== "all"
        ? await base44.entities.TimesheetRecord.list("-date", 5000, { timesheet_id: selected })
        : await base44.entities.TimesheetRecord.list("-date", 5000);
    setRecords(data);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-muted-foreground mb-4">Sem dados. Importe uma folha de ponto primeiro.</p>
        <Button asChild>
          <Link to="/upload"><Upload className="h-4 w-4 mr-2" />Importar</Link>
        </Button>
      </div>
    );
  }

  const sorted = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
  const summary = calculateSummary(sorted);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Alertas</h2>
        <p className="text-sm text-muted-foreground">Inconsistências e avisos identificados nos registros</p>
      </div>
      <AlertsList alerts={summary.alerts} />
    </div>
  );
}
