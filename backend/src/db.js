import { Pool, types } from "pg";

// Postgres `date` columns (OID 1082) are parsed by node-postgres into JS Date
// objects using `new Date(year, month-1, day)` — i.e. LOCAL server time. When
// that Date is later serialized with `.toISOString()` it gets re-expressed in
// UTC, which silently shifts the calendar date backwards (or, in some edge
// timezones, forwards) whenever the server's timezone offset isn't exactly 0.
// This is what caused the weekday shown for a given day (e.g. "18 Abril") to
// be wrong depending on where/when the backend process runs.
//
// Since our `date` columns never carry time-of-day information anyway, we
// disable that conversion entirely and always work with the raw "YYYY-MM-DD"
// string Postgres returns. This makes date handling 100% timezone-independent.
types.setTypeParser(1082, (value) => value);

let pool = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Load environment variables before importing db.js or ensure DATABASE_URL is configured.");
  }
  pool = new Pool({ connectionString: url });
  return pool;
}

const prisma = {
  async $connect() {
    const client = await getPool().connect();
    client.release();
  },

  async $transaction(work) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const tx = {
        query: async (sql, params = []) => {
          const result = await client.query(sql, params);
          return result.rows;
        }
      };
      const value = await work(tx);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  query: async (sql, params = []) => {
    const result = await getPool().query(sql, params);
    return result.rows;
  }
};

function escapePostgresValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (Array.isArray(value)) {
    return `ARRAY[${value.map(escapePostgresValue).join(", ")}]`;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function formatQuery(sql, params = []) {
  return sql.replace(/\$(\d+)/g, (_, index) => {
    const paramIndex = Number(index) - 1;
    if (paramIndex < 0 || paramIndex >= params.length) return _;
    return escapePostgresValue(params[paramIndex]);
  });
}

export async function query(client, sql, params = []) {
  const formattedSql = formatQuery(sql, params);
  let result;
  if (!client || typeof client.query !== "function") {
    result = await prisma.query(formattedSql);
  } else {
    result = await client.query(formattedSql);
  }
  if (result && typeof result.rows !== "undefined") {
    return result.rows;
  }
  return result;
}

export async function initDb() {
  await prisma.$connect();

  await query(prisma, `
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

  await query(prisma, `
    CREATE TABLE IF NOT EXISTS user_sessions (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      last_used timestamptz
    );
  `);

  await query(prisma, `
    CREATE TABLE IF NOT EXISTS timesheets (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      employee_name text,
      employee_number text,
      month text,
      year integer,
      department text,
      funcao text,
      direcao text,
      centro_custo text,
      cct text,
      horario text,
      email_remetente text,
      email_nivel1 text,
      email_nivel2 text,
      source_filename text,
      source_file_url text,
      total_compensation_hours double precision NOT NULL DEFAULT 0,
      total_descanso_compensatorio_hours double precision NOT NULL DEFAULT 0
    );
  `);

  await query(prisma, `
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

  await query(prisma, `
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

  await query(prisma, `
    CREATE TABLE IF NOT EXISTS compensation_enjoyments (
      id uuid PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enjoy_date date NOT NULL,
      hours double precision NOT NULL,
      reason text
    );
  `);

  await query(prisma, `
    CREATE TABLE IF NOT EXISTS reference_store (
      key text PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      updated_date timestamptz NOT NULL DEFAULT now(),
      value jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  // Backfill/migrations for older databases
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS timesheet_id uuid;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS user_id uuid;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS user_id uuid;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS source_filename text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS source_file_url text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS total_compensation_hours double precision NOT NULL DEFAULT 0;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS total_descanso_compensatorio_hours double precision NOT NULL DEFAULT 0;`);
  // Employee profile columns added to timesheets
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS funcao text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS direcao text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS centro_custo text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS cct text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS horario text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS email_remetente text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS email_nivel1 text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS email_nivel2 text;`);
  // Default project stored on timesheet for "Preencher todos" quick-fill
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS default_project_number text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS default_project_client text;`);
  await query(prisma, `ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS default_project_description text;`);
  // Full "Preencher" model fields — previously only kept in the browser and
  // baked into the exported Excel, never persisted. Needed so the Histórico
  // detail view can show the exact same table as Preencher with real data.
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS extra1_start text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS extra1_end text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS extra2_start text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS extra2_end text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS extra_motivo text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS travel1_start text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS travel1_end text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS travel2_start text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS travel2_end text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS absence_start text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS absence_end text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS subsidio_almoco boolean NOT NULL DEFAULT false;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS prevencao boolean NOT NULL DEFAULT false;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS deslocado boolean NOT NULL DEFAULT false;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS local_deslocacao text;`);
  await query(prisma, `ALTER TABLE timesheet_records ADD COLUMN IF NOT EXISTS motivo_deslocacao text;`);

  await query(prisma, `
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

  await query(prisma, `
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

  await query(prisma, `
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
  await query(prisma, `
    UPDATE timesheets t
    SET user_id = u.id
    FROM users u
    WHERE t.user_id IS NULL
      AND regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g') <> ''
      AND regexp_replace(btrim(COALESCE(u.profile->>'employee_number', '')), '\\s+', '', 'g') =
          regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g');
  `);

  await query(prisma, `
    WITH counts AS (SELECT COUNT(*)::int AS n FROM users),
    one_user AS (SELECT id FROM users ORDER BY created_date ASC LIMIT 1)
    UPDATE timesheets
    SET user_id = (SELECT id FROM one_user)
    WHERE user_id IS NULL AND (SELECT n FROM counts) = 1;
  `);

  await query(prisma, `
    UPDATE timesheet_records r
    SET user_id = t.user_id
    FROM timesheets t
    WHERE r.user_id IS NULL
      AND r.timesheet_id = t.id
      AND t.user_id IS NOT NULL;
  `);

  await query(prisma, `
    UPDATE timesheet_records r
    SET user_id = u.id
    FROM users u
    WHERE r.user_id IS NULL
      AND regexp_replace(btrim(COALESCE(r.employee_number, '')), '\\s+', '', 'g') <> ''
      AND regexp_replace(btrim(COALESCE(u.profile->>'employee_number', '')), '\\s+', '', 'g') =
          regexp_replace(btrim(COALESCE(r.employee_number, '')), '\\s+', '', 'g');
  `);

  await query(prisma, `
    WITH counts AS (SELECT COUNT(*)::int AS n FROM users),
    one_user AS (SELECT id FROM users ORDER BY created_date ASC LIMIT 1)
    UPDATE timesheet_records
    SET user_id = (SELECT id FROM one_user)
    WHERE user_id IS NULL AND (SELECT n FROM counts) = 1;
  `);

  // Best-effort backfill for legacy imports created before `timesheet_id` was
  // persisted on each daily record. This restores edit/history joins by linking
  // rows to the matching month/year/employee timesheet of the same user.
  await query(prisma, `
    WITH ranked_matches AS (
      SELECT
        r.id AS record_id,
        t.id AS timesheet_id,
        ROW_NUMBER() OVER (
          PARTITION BY r.id
          ORDER BY t.created_date DESC, t.id DESC
        ) AS rn
      FROM timesheet_records r
      JOIN timesheets t
        ON t.user_id = r.user_id
       AND t.year = r.year
       AND lower(regexp_replace(btrim(COALESCE(t.month, '')), '\\s+', ' ', 'g')) =
           lower(regexp_replace(btrim(COALESCE(r.month, '')), '\\s+', ' ', 'g'))
       AND (
         regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g') <> ''
         AND regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g') =
             regexp_replace(btrim(COALESCE(r.employee_number, '')), '\\s+', '', 'g')
         OR (
           regexp_replace(btrim(COALESCE(t.employee_number, '')), '\\s+', '', 'g') = ''
           AND regexp_replace(btrim(COALESCE(r.employee_number, '')), '\\s+', '', 'g') = ''
           AND lower(regexp_replace(btrim(COALESCE(t.employee_name, '')), '\\s+', ' ', 'g')) =
               lower(regexp_replace(btrim(COALESCE(r.employee_name, '')), '\\s+', ' ', 'g'))
         )
       )
      WHERE r.timesheet_id IS NULL
        AND r.user_id IS NOT NULL
    )
    UPDATE timesheet_records r
    SET timesheet_id = m.timesheet_id
    FROM ranked_matches m
    WHERE r.id = m.record_id
      AND m.rn = 1;
  `);

  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_timesheet_records_timesheet_id ON timesheet_records(timesheet_id);`);
  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_timesheet_records_user_id ON timesheet_records(user_id);`);
  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_timesheets_user_id ON timesheets(user_id);`);
  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_compensation_enjoyments_user_id ON compensation_enjoyments(user_id);`);
  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_compensation_enjoyments_enjoy_date ON compensation_enjoyments(enjoy_date DESC);`);
  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_timesheets_created_date ON timesheets(created_date DESC);`);
  await query(prisma, `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);`);

  // Seed default reference data (if missing).
  await query(
    prisma,
    `
    INSERT INTO reference_store (key, value)
    VALUES (
      'timesheet_config',
      $1::jsonb
    )
    ON CONFLICT (key) DO NOTHING;
    `,
    [
      JSON.stringify({
        instructions: [
          {
            line: 13,
            column: "1",
            howToFill: "Dia do mês (preenchido automaticamente; ajuste apenas se necessário acrescentar linhas).",
            notes: ""
          }
        ],
        projects: [],
        options: {
          dayTypes: ["Dia Útil", "Desc.Comp", "Desc. Obrig", "Feriado"],
          overtimeReasons: ["Motivo Simples"],
          absenceTypes: ["Ausência"],
          holidays: []
        }
      })
    ]
  );
}

export { prisma };
