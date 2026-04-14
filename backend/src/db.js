import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || "atm"}:${process.env.POSTGRES_PASSWORD || "atm"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "atm"}`;

const pgSslMode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
const sslRequired =
  pgSslMode === "require" ||
  String(process.env.DATABASE_SSL || "").trim().toLowerCase() === "true" ||
  (Boolean(process.env.RENDER) && pgSslMode !== "disable");

export const pool = new Pool({
  connectionString,
  ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {})
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      email text NOT NULL UNIQUE,
      role text NOT NULL DEFAULT 'user',
      password_salt text NOT NULL,
      password_iterations integer NOT NULL DEFAULT 100000,
      password_hash text NOT NULL,
      profile jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      last_used timestamptz
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheets (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
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
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compensation_enjoyments (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enjoy_date date NOT NULL,
      hours double precision NOT NULL,
      reason text
    );
  `);

  // Backfill/migrations for older databases
  await pool.query(`ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS timesheet_id uuid;`);
  await pool.query(`ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS user_id uuid;`);
  await pool.query(`ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS user_id uuid;`);
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
        SELECT 1 FROM pg_constraint WHERE conname = 'timesheets_user_id_fkey'
      ) THEN
        ALTER TABLE timesheets
          ADD CONSTRAINT timesheets_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'timesheet_records_user_id_fkey'
      ) THEN
        ALTER TABLE timesheet_records
          ADD CONSTRAINT timesheet_records_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

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

  // Best-effort backfill of user_id from employee_number -> users.profile.employee_number
  await pool.query(`
    UPDATE timesheets t
    SET user_id = u.id
    FROM users u
    WHERE t.user_id IS NULL
      AND regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g') <> ''
      AND regexp_replace(btrim(COALESCE(u.profile->>'employee_number', '')), '\\s+', '', 'g') =
          regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g');
  `);

  await pool.query(`
    WITH counts AS (SELECT COUNT(*)::int AS n FROM users),
    one_user AS (SELECT id FROM users ORDER BY created_date ASC LIMIT 1)
    UPDATE timesheets
    SET user_id = (SELECT id FROM one_user)
    WHERE user_id IS NULL AND (SELECT n FROM counts) = 1;
  `);

  await pool.query(`
    UPDATE timesheet_records r
    SET user_id = t.user_id
    FROM timesheets t
    WHERE r.user_id IS NULL
      AND r.timesheet_id = t.id
      AND t.user_id IS NOT NULL;
  `);

  await pool.query(`
    UPDATE timesheet_records r
    SET user_id = u.id
    FROM users u
    WHERE r.user_id IS NULL
      AND regexp_replace(btrim(COALESCE(r.employee_number, '')), '\\s+', '', 'g') <> ''
      AND regexp_replace(btrim(COALESCE(u.profile->>'employee_number', '')), '\\s+', '', 'g') =
          regexp_replace(btrim(COALESCE(r.employee_number, '')), '\\s+', '', 'g');
  `);

  await pool.query(`
    WITH counts AS (SELECT COUNT(*)::int AS n FROM users),
    one_user AS (SELECT id FROM users ORDER BY created_date ASC LIMIT 1)
    UPDATE timesheet_records
    SET user_id = (SELECT id FROM one_user)
    WHERE user_id IS NULL AND (SELECT n FROM counts) = 1;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_timesheet_records_timesheet_id ON timesheet_records(timesheet_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_timesheet_records_user_id ON timesheet_records(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_timesheets_user_id ON timesheets(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_compensation_enjoyments_user_id ON compensation_enjoyments(user_id);`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_compensation_enjoyments_enjoy_date ON compensation_enjoyments(enjoy_date DESC);`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_timesheets_created_date ON timesheets(created_date DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);`);
}
