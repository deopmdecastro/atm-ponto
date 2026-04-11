import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, pool } from "./db.js";
import { asyncHandler, httpError } from "./http.js";
import multer from "multer";
import { extractRowsFromPrompt, extractTimesheetDailyRecords } from "./timesheetExtract.js";
import { loadEnv } from "./loadEnv.js";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = (() => {
  const envDir = process.env.UPLOADS_DIR;
  if (!envDir) return path.resolve(__dirname, "..", "uploads");
  return path.isAbsolute(envDir) ? envDir : path.resolve(process.cwd(), envDir);
})();
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({ dest: uploadsDir });

const app = express();
app.set("trust proxy", 1);

const corsOriginEnv = String(process.env.CORS_ORIGIN || "").trim();
const corsOrigins =
  corsOriginEnv && corsOriginEnv !== "*"
    ? corsOriginEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

app.use(
  corsOrigins
    ? cors({
        origin(origin, cb) {
          if (!origin) return cb(null, true);
          if (corsOrigins.includes(origin)) return cb(null, true);
          return cb(new Error(`CORS blocked for origin: ${origin}`));
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
      })
    : cors()
);
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(uploadsDir));

let dbReady = false;
let dbInitInFlight = null;
let dbLastError = null;

async function ensureDbReady() {
  if (dbReady) return true;
  if (dbInitInFlight) return dbInitInFlight;

  dbInitInFlight = (async () => {
    try {
      await initDb();
      dbReady = true;
      dbLastError = null;
      return true;
    } catch (e) {
      dbReady = false;
      dbLastError = e?.message || String(e);
      // eslint-disable-next-line no-console
      console.error("[db] init failed", dbLastError);
      return false;
    } finally {
      dbInitInFlight = null;
    }
  })();

  return dbInitInFlight;
}

try {
  await ensureDbReady();
} catch (e) {
  // ignore; ensureDbReady already logged
}

if (typeof setInterval === "function") {
  const t = setInterval(() => {
    if (!dbReady) ensureDbReady();
  }, 15000);
  if (typeof t?.unref === "function") t.unref();
}

app.get("/", (req, res) => {
  res.type("text/plain").send(
    "ATM API is running.\n\nTry:\n- GET /health\n- GET /api/employees\n- GET /api/timesheet-records\n"
  );
});

app.get("/health", (req, res) =>
  res.json({
    ok: true,
    dbReady,
    dbError: dbReady ? null : dbLastError || null
  })
);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function derivePasswordHash({ password, saltB64, iterations = 100000 }) {
  const pwd = String(password || "");
  const salt = Buffer.from(String(saltB64 || ""), "base64");
  const hash = await new Promise((resolve, reject) => {
    crypto.pbkdf2(pwd, salt, iterations, 32, "sha256", (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  return Buffer.from(hash).toString("base64");
}

function genToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    profile: row.profile || {},
    created_date: row.created_date
  };
}

async function createSession(userId) {
  const token = genToken();
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days
  const id = randomUUID();
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
    [id, userId, hash, expiresAt.toISOString()]
  );
  return { token, tokenHash: hash, sessionId: id, expiresAt: expiresAt.toISOString() };
}

async function authRequired(req, res, next) {
  if (req.method === "OPTIONS") return next();
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next(httpError(401, "Missing Authorization header"));

  const hash = tokenHash(token);
  const { rows } = await pool.query(
    `
    SELECT s.id AS session_id, s.token_hash, u.*
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
    LIMIT 1
    `,
    [hash]
  );

  const row = rows[0];
  if (!row) return next(httpError(401, "Invalid or expired token"));

  req.user = sanitizeUser(row);
  req.session = { id: row.session_id, tokenHash: row.token_hash };

  // Best-effort last_used update
  pool.query(`UPDATE user_sessions SET last_used = now() WHERE id = $1`, [row.session_id]).catch(() => {});

  return next();
}

app.use(
  "/api",
  asyncHandler(async (req, res, next) => {
    const ready = await ensureDbReady();
    if (ready) return next();
    res.status(503).json({
      error:
        "Database not available. Configure DATABASE_URL (Render) / PGSSLMODE=require, or start Postgres locally (docker compose up -d db) and restart the backend.",
      status: 503,
      details: dbLastError ? `DB init error: ${dbLastError}` : undefined
    });
  })
);

app.use(
  "/api",
  asyncHandler(async (req, res, next) => {
    await authRequired(req, res, next);
  })
);

app.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({
        error: "Database not available",
        status: 503,
        details: dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    const data = req.body || {};
    const email = normalizeEmail(data.email);
    const password = String(data.password || "");
    if (!email) throw httpError(400, "Email é obrigatório");
    if (!password || password.length < 6) throw httpError(400, "Senha deve ter pelo menos 6 caracteres");

    const { rows: existing } = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (existing[0]) throw httpError(409, "Já existe uma conta com este email");

    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    const isFirstUser = Number(countRows?.[0]?.n || 0) === 0;

    const salt = crypto.randomBytes(16).toString("base64");
    const iterations = 100000;
    const hash = await derivePasswordHash({ password, saltB64: salt, iterations });

    const id = randomUUID();
    const role = isFirstUser ? "admin" : "user";
    const profile = data.profile && typeof data.profile === "object" ? data.profile : {};

    const { rows } = await pool.query(
      `
      INSERT INTO users (id, email, role, password_salt, password_iterations, password_hash, profile)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *;
      `,
      [id, email, role, salt, iterations, hash, profile]
    );

    const user = sanitizeUser(rows[0]);
    const session = await createSession(user.id);

    res.status(201).json({ token: session.token, user });
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({
        error: "Database not available",
        status: 503,
        details: dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    const data = req.body || {};
    const email = normalizeEmail(data.email);
    const password = String(data.password || "");
    if (!email) throw httpError(400, "Email é obrigatório");
    if (!password) throw httpError(400, "Senha é obrigatória");

    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
    const userRow = rows[0];
    if (!userRow) throw httpError(401, "Credenciais inválidas");

    const expected = String(userRow.password_hash || "");
    const derived = await derivePasswordHash({
      password,
      saltB64: userRow.password_salt,
      iterations: Number(userRow.password_iterations || 100000)
    });
    if (derived !== expected) throw httpError(401, "Credenciais inválidas");

    const user = sanitizeUser(userRow);
    const session = await createSession(user.id);
    res.json({ token: session.token, user });
  })
);

app.get(
  "/auth/me",
  asyncHandler(async (req, res, next) => {
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({
        error: "Database not available",
        status: 503,
        details: dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    return authRequired(req, res, () => res.json(req.user));
  })
);

app.post(
  "/auth/logout",
  asyncHandler(async (req, res, next) => {
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({ error: "Database not available", status: 503 });
      return;
    }
    return authRequired(req, res, async () => {
      const hash = req.session?.tokenHash;
      if (hash) await pool.query(`DELETE FROM user_sessions WHERE token_hash = $1`, [hash]);
      res.json({ ok: true });
    });
  })
);

function parseOrder(order, fallbackColumn) {
  if (!order || typeof order !== "string") return { column: fallbackColumn, dir: "DESC" };
  const dir = order.startsWith("-") ? "DESC" : "ASC";
  const key = order.replace(/^-/, "");
  const map = {
    created_date: "created_date",
    date: "date",
    full_name: "full_name"
  };
  return { column: map[key] || fallbackColumn, dir };
}

app.get(
  "/api/employees",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 200) || 200, 1000);
    const { column, dir } = parseOrder(req.query.order, "created_date");
    const { rows } = await pool.query(
      `SELECT * FROM employees ORDER BY ${column} ${dir} LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

app.post(
  "/api/employees",
  asyncHandler(async (req, res) => {
    const data = req.body || {};
    if (!data.full_name || !data.email) throw httpError(400, "full_name and email are required");
    const id = randomUUID();
    const { rows } = await pool.query(
      `
      INSERT INTO employees
        (id, full_name, employee_number, email, department, function, company, active)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *;
      `,
      [
        id,
        data.full_name,
        data.employee_number || "",
        data.email,
        data.department || "",
        data.function || "",
        data.company || "",
        data.active !== false
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/api/employees/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = req.body || {};
    const { rows } = await pool.query(
      `
      UPDATE employees SET
        full_name = COALESCE($2, full_name),
        employee_number = COALESCE($3, employee_number),
        email = COALESCE($4, email),
        department = COALESCE($5, department),
        function = COALESCE($6, function),
        company = COALESCE($7, company),
        active = COALESCE($8, active)
      WHERE id = $1
      RETURNING *;
      `,
      [
        id,
        data.full_name ?? null,
        data.employee_number ?? null,
        data.email ?? null,
        data.department ?? null,
        data.function ?? null,
        data.company ?? null,
        typeof data.active === "boolean" ? data.active : null
      ]
    );
    if (!rows[0]) throw httpError(404, "employee not found");
    res.json(rows[0]);
  })
);

app.delete(
  "/api/employees/:id",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM employees WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw httpError(404, "employee not found");
    res.json({ ok: true });
  })
);

app.get(
  "/api/timesheet-records",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 500) || 500, 5000);
    const { column, dir } = parseOrder(req.query.order, "date");
    const timesheetId = req.query.timesheet_id ? String(req.query.timesheet_id) : null;
    const where = timesheetId ? `WHERE timesheet_id = $2` : "";
    const params = timesheetId ? [limit, timesheetId] : [limit];
    const { rows } = await pool.query(
      `SELECT * FROM timesheet_records ${where} ORDER BY ${column} ${dir} LIMIT $1`,
      params
    );
    res.json(
      rows.map((r) => ({
        ...r,
        date: r.date ? r.date.toISOString().slice(0, 10) : r.date
      }))
    );
  })
);

app.post(
  "/api/timesheet-records",
  asyncHandler(async (req, res) => {
    const data = req.body || {};
    if (!data.employee_name || !data.date) throw httpError(400, "employee_name and date are required");
    const id = randomUUID();
    const { rows } = await pool.query(
      `
      INSERT INTO timesheet_records
        (id, timesheet_id, employee_name, employee_number, month, year, date, normal_hours, extra_hours, travel_hours, absence_hours,
         day_type, absence_type, project_number, project_client, project_description, compensated, period_start, period_end,
         pause_hours, status, observations)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
         $12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22)
      RETURNING *;
      `,
      [
        id,
        data.timesheet_id || null,
        data.employee_name,
        data.employee_number || "",
        data.month || "",
        data.year ? Number(data.year) : null,
        data.date,
        Number(data.normal_hours || 0),
        Number(data.extra_hours || 0),
        Number(data.travel_hours || 0),
        Number(data.absence_hours || 0),
        data.day_type || "",
        data.absence_type || "",
        data.project_number || "",
        data.project_client || "",
        data.project_description || "",
        Boolean(data.compensated),
        data.period_start || "",
        data.period_end || "",
        Number(data.pause_hours || 0),
        data.status || "normal",
        data.observations || ""
      ]
    );
    const row = rows[0];
    res.status(201).json({ ...row, date: row.date.toISOString().slice(0, 10) });
  })
);

app.post(
  "/api/timesheet-records/bulk",
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body) ? req.body : req.body?.items;
    if (!Array.isArray(items)) throw httpError(400, "Expected an array (or {items: []})");

    const created = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of items) {
        if (!item?.employee_name || !item?.date) throw httpError(400, "Each item needs employee_name and date");
        const id = randomUUID();
        const { rows } = await client.query(
          `
          INSERT INTO timesheet_records
            (id, timesheet_id, employee_name, employee_number, month, year, date, normal_hours, extra_hours, travel_hours, absence_hours,
             day_type, absence_type, project_number, project_client, project_description, compensated, period_start, period_end,
             pause_hours, status, observations)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             $12,$13,$14,$15,$16,$17,$18,$19,
             $20,$21,$22)
          RETURNING *;
          `,
          [
            id,
            item.timesheet_id || null,
            item.employee_name,
            item.employee_number || "",
            item.month || "",
            item.year ? Number(item.year) : null,
            item.date,
            Number(item.normal_hours || 0),
            Number(item.extra_hours || 0),
            Number(item.travel_hours || 0),
            Number(item.absence_hours || 0),
            item.day_type || "",
            item.absence_type || "",
            item.project_number || "",
            item.project_client || "",
            item.project_description || "",
            Boolean(item.compensated),
            item.period_start || "",
            item.period_end || "",
            Number(item.pause_hours || 0),
            item.status || "normal",
            item.observations || ""
          ]
        );
        created.push(rows[0]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.status(201).json(
      created.map((r) => ({
        ...r,
        date: r.date ? r.date.toISOString().slice(0, 10) : r.date
      }))
    );
  })
);

app.get(
  "/api/timesheets",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50) || 50, 500);
    const { rows } = await pool.query(
      `
      SELECT
        t.*,
        COUNT(r.id)::int AS record_count,
        COALESCE(SUM(r.normal_hours), 0)::float AS total_normal_hours,
        COALESCE(SUM(r.extra_hours), 0)::float AS total_extra_hours,
        COALESCE(SUM(r.travel_hours), 0)::float AS total_travel_hours,
        COALESCE(SUM(r.absence_hours), 0)::float AS total_absence_hours,
        COALESCE(SUM(CASE WHEN r.normal_hours > 0 THEN 1 ELSE 0 END), 0)::int AS worked_days,
        MIN(r.date) AS period_start,
        MAX(r.date) AS period_end
      FROM timesheets t
      LEFT JOIN timesheet_records r ON r.timesheet_id = t.id
      GROUP BY t.id
      ORDER BY t.created_date DESC
      LIMIT $1
      `,
      [limit]
    );
    res.json(
      rows.map((r) => ({
        ...r,
        period_start: r.period_start ? r.period_start.toISOString().slice(0, 10) : null,
        period_end: r.period_end ? r.period_end.toISOString().slice(0, 10) : null
      }))
    );
  })
);

app.post(
  "/api/timesheets",
  asyncHandler(async (req, res) => {
    const data = req.body || {};
    const employeeName = String(data.employee_name || "");
    const employeeNumber = String(data.employee_number || "");
    const month = String(data.month || "");
    const year = data.year != null && data.year !== "" ? Number(data.year) : null;
    const replace = Boolean(data.replace);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (month && year != null && (employeeNumber || employeeName)) {
        const { rows: existing } = await client.query(
          `
          SELECT id
          FROM timesheets
          WHERE year = $1
            AND month = $2
            AND (
              employee_number = $3
              OR ($3 = '' AND employee_name = $4)
            )
          `,
          [year, month, employeeNumber, employeeName]
        );

        const existingIds = existing.map((r) => r.id).filter(Boolean);
        if (existingIds.length > 0 && !replace) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: "Timesheet already exists",
            existing_timesheet_ids: existingIds
          });
          return;
        }

        if (existingIds.length > 0 && replace) {
          await client.query(`DELETE FROM timesheets WHERE id = ANY($1::uuid[])`, [existingIds]);
        }
      }

      const id = randomUUID();
      const { rows } = await client.query(
        `
        INSERT INTO timesheets
          (
            id,
            employee_name,
            employee_number,
            month,
            year,
            department,
            source_filename,
            total_compensation_hours,
            total_descanso_compensatorio_hours
          )
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *;
        `,
        [
          id,
          employeeName,
          employeeNumber,
          month,
          year,
          data.department || "",
          data.source_filename || "",
          data.total_compensation_hours != null ? Number(data.total_compensation_hours) : 0,
          data.total_descanso_compensatorio_hours != null
            ? Number(data.total_descanso_compensatorio_hours)
            : 0
        ]
      );

      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

app.get(
  "/api/timesheets/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM timesheets WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, "timesheet not found");
    res.json(rows[0]);
  })
);

app.put(
  "/api/timesheets/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = req.body || {};
    const { rows } = await pool.query(
      `
      UPDATE timesheets SET
        employee_name = COALESCE($2, employee_name),
        employee_number = COALESCE($3, employee_number),
        month = COALESCE($4, month),
        year = COALESCE($5, year),
        department = COALESCE($6, department),
        source_filename = COALESCE($7, source_filename),
        total_compensation_hours = COALESCE($8, total_compensation_hours),
        total_descanso_compensatorio_hours = COALESCE($9, total_descanso_compensatorio_hours)
      WHERE id = $1
      RETURNING *;
      `,
      [
        id,
        data.employee_name ?? null,
        data.employee_number ?? null,
        data.month ?? null,
        data.year != null ? Number(data.year) : null,
        data.department ?? null,
        data.source_filename ?? null,
        data.total_compensation_hours != null ? Number(data.total_compensation_hours) : null,
        data.total_descanso_compensatorio_hours != null
          ? Number(data.total_descanso_compensatorio_hours)
          : null
      ]
    );
    if (!rows[0]) throw httpError(404, "timesheet not found");
    res.json(rows[0]);
  })
);

app.delete(
  "/api/timesheets/:id",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM timesheets WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw httpError(404, "timesheet not found");
    res.json({ ok: true });
  })
);

app.put(
  "/api/timesheet-records/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = req.body || {};
    const { rows } = await pool.query(
      `
      UPDATE timesheet_records SET
        employee_name = COALESCE($2, employee_name),
        employee_number = COALESCE($3, employee_number),
        month = COALESCE($4, month),
        year = COALESCE($5, year),
        date = COALESCE($6, date),
        normal_hours = COALESCE($7, normal_hours),
        extra_hours = COALESCE($8, extra_hours),
        travel_hours = COALESCE($9, travel_hours),
        absence_hours = COALESCE($10, absence_hours),
        day_type = COALESCE($11, day_type),
        absence_type = COALESCE($12, absence_type),
        project_number = COALESCE($13, project_number),
        project_client = COALESCE($14, project_client),
        project_description = COALESCE($15, project_description),
        compensated = COALESCE($16, compensated),
        period_start = COALESCE($17, period_start),
        period_end = COALESCE($18, period_end),
        pause_hours = COALESCE($19, pause_hours),
        status = COALESCE($20, status),
        observations = COALESCE($21, observations)
      WHERE id = $1
      RETURNING *;
      `,
      [
        id,
        data.employee_name ?? null,
        data.employee_number ?? null,
        data.month ?? null,
        data.year != null ? Number(data.year) : null,
        data.date ?? null,
        data.normal_hours != null ? Number(data.normal_hours) : null,
        data.extra_hours != null ? Number(data.extra_hours) : null,
        data.travel_hours != null ? Number(data.travel_hours) : null,
        data.absence_hours != null ? Number(data.absence_hours) : null,
        data.day_type ?? null,
        data.absence_type ?? null,
        data.project_number ?? null,
        data.project_client ?? null,
        data.project_description ?? null,
        typeof data.compensated === "boolean" ? data.compensated : null,
        data.period_start ?? null,
        data.period_end ?? null,
        data.pause_hours != null ? Number(data.pause_hours) : null,
        data.status ?? null,
        data.observations ?? null
      ]
    );
    if (!rows[0]) throw httpError(404, "timesheet record not found");
    const row = rows[0];
    res.json({ ...row, date: row.date ? row.date.toISOString().slice(0, 10) : row.date });
  })
);

app.delete(
  "/api/timesheet-records/:id",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM timesheet_records WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw httpError(404, "timesheet record not found");
    res.json({ ok: true });
  })
);

app.post(
  "/integrations/Core/UploadFile",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, "No file uploaded");
    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ file_url: fileUrl });
  })
);

app.post(
  "/integrations/Core/ExtractDataFromUploadedFile",
  asyncHandler(async (req, res) => {
    const { file_url: fileUrl } = req.body || {};
    if (!fileUrl || typeof fileUrl !== "string") throw httpError(400, "file_url is required");

    let filename = null;
    try {
      const u = new URL(fileUrl, "http://localhost");
      filename = path.basename(u.pathname || "");
    } catch {
      filename = path.basename(String(fileUrl));
    }

    if (!filename) throw httpError(400, "Invalid file_url");
    const filePath = path.resolve(uploadsDir, filename);
    if (!filePath.startsWith(uploadsDir)) throw httpError(400, "Invalid file_url");

    if (!fs.existsSync(filePath)) {
      res.json({ status: "error", details: "Uploaded file not found (maybe the container was rebuilt or storage was cleared)." });
      return;
    }

    try {
      const { records, sheet, meta } = await extractTimesheetDailyRecords({ filePath, sheetName: "TimeSheet" });
      res.json({
        status: "ok",
        output: {
          sheet,
          rows: records,
          meta: meta || {}
        }
      });
    } catch (e) {
      res.json({ status: "error", details: e?.message || String(e) });
    }
  })
);

app.post(
  "/integrations/Core/InvokeLLM",
  asyncHandler(async (req, res) => {
    const { prompt } = req.body || {};
    const rows = extractRowsFromPrompt(prompt);
    const dailyRecords = rows
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        date: typeof r.date === "string" ? r.date : "",
        normal_hours: Number(r.normal_hours || 0),
        extra_hours: Number(r.extra_hours || 0),
        travel_hours: Number(r.travel_hours || 0),
        absence_hours: Number(r.absence_hours || 0),
        day_type: String(r.day_type || ""),
        absence_type: String(r.absence_type || ""),
        period_start: String(r.period_start || ""),
        period_end: String(r.period_end || ""),
        pause_hours: Number(r.pause_hours || 0),
        project_number: String(r.project_number || ""),
        project_client: String(r.project_client || ""),
        project_description: String(r.project_description || "")
      }))
      .filter((r) => r.date);

    res.json({
      employee_name: "",
      employee_number: "",
      month: "",
      year: new Date().getFullYear(),
      department: "",
      daily_records: dailyRecords
    });
  })
);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error",
    status,
    extra: err.extra
  });
});

const port = Number(process.env.PORT || 3001);
const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
});

server.on("error", (e) => {
  if (e?.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(`[api] port ${port} already in use. Set PORT=<free_port> or stop the other process.`);
    process.exit(1);
  }
  throw e;
});
