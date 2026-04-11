import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || "atm"}:${process.env.POSTGRES_PASSWORD || "atm"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "atm"}`;

export const pool = new Pool({ connectionString });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheets (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      employee_name text,
      employee_number text,
      month text,
      year integer,
      department text,
      source_filename text,
      total_compensation_hours double precision NOT NULL DEFAULT 0,
      total_descanso_compensatorio_hours double precision NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      full_name text NOT NULL,
      employee_number text,
      email text NOT NULL,
      department text,
      function text,
      company text,
      active boolean NOT NULL DEFAULT true
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheet_records (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      timesheet_id uuid,
      employee_name text NOT NULL,
      employee_number text,
      month text,
      year integer,
      date date NOT NULL,
      normal_hours double precision,
      extra_hours double precision,
      travel_hours double precision,
      absence_hours double precision,
      day_type text,
      absence_type text,
      project_number text,
      project_client text,
      project_description text,
      compensated boolean NOT NULL DEFAULT false,
      period_start text,
      period_end text,
      pause_hours double precision,
      status text,
      observations text
    );
  `);

  // Backfill/migrations for older databases
  await pool.query(`ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS timesheet_id uuid;`);
  await pool.query(
    `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS total_compensation_hours double precision NOT NULL DEFAULT 0;`
  );
  await pool.query(
    `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS total_descanso_compensatorio_hours double precision NOT NULL DEFAULT 0;`
  );

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'timesheet_records_timesheet_id_fkey'
      ) THEN
        ALTER TABLE timesheet_records
          ADD CONSTRAINT timesheet_records_timesheet_id_fkey
          FOREIGN KEY (timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_timesheet_records_timesheet_id ON timesheet_records(timesheet_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_timesheets_created_date ON timesheets(created_date DESC);`);
}
