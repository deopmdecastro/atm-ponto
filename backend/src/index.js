import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, prisma, query } from "./db.js";
import { asyncHandler, httpError } from "./http.js";
import multer from "multer";
import { extractRowsFromPrompt, extractTimesheetDailyRecords } from "./timesheetExtract.js";
import { loadEnv } from "./loadEnv.js";
import { generateCompensationSummaryXlsx } from "./reports/compensationSummaryXlsx.js";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = (() => {
  const envDir = process.env.UPLOADS_DIR;
  if (!envDir) return path.resolve(__dirname, "..", "uploads");
  return path.isAbsolute(envDir) ? envDir : path.resolve(process.cwd(), envDir);
})();
fs.mkdirSync(uploadsDir, { recursive: true });

const isProduction = process.env.NODE_ENV === "production";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 256;
const PASSWORD_ITERATIONS = 310000;
const DUMMY_PASSWORD_SALT = crypto.randomBytes(16).toString("base64");
const registrationEnabled = process.env.REGISTRATION_ENABLED !== "false";

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if (extension !== ".xlsx" && extension !== ".xls") {
      cb(httpError(400, "Apenas arquivos Excel .xlsx ou .xls são permitidos"));
      return;
    }
    cb(null, true);
  }
});

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

const corsOriginEnv = String(process.env.CORS_ORIGIN || "").trim();
const allowInsecureCors = process.env.ALLOW_INSECURE_CORS === "true";
const corsOrigins = corsOriginEnv
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter((origin) => origin && origin !== "*");
const allowAllCors = !isProduction && (!corsOriginEnv || corsOriginEnv === "*");

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowAllCors || allowInsecureCors) return cb(null, true);
      if (corsOrigins.includes(String(origin).replace(/\/+$/, ""))) return cb(null, true);
      return cb(httpError(403, "Origin não permitida"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
  })
);
app.use(express.json({ limit: "1mb", strict: true }));

function createRateLimit({ windowMs, max, message }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 10000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: message, status: 429 });
      return;
    }
    next();
  };
}

const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas de login. Tente novamente mais tarde."
});
const registerRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Muitas tentativas de criação de conta. Tente novamente mais tarde."
});
const integrationRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Muitas operações de arquivo. Tente novamente mais tarde."
});
const uploadRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Limite de uploads atingido. Tente novamente mais tarde."
});

app.use("/auth", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

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
  res.status(dbReady ? 200 : 503).json({
    ok: dbReady,
    dbReady,
    dbError: !isProduction && !dbReady ? dbLastError || null : undefined
  })
);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password, label = "Senha") {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw httpError(400, `${label} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw httpError(400, `${label} deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`);
  }
}

function sanitizeProfile(input) {
  const profile = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const clean = {};
  for (const key of ["employee_name", "employee_number", "department"]) {
    if (profile[key] != null) clean[key] = String(profile[key]).trim().slice(0, 200);
  }
  if (profile.start_year != null) {
    const year = Number(profile.start_year);
    if (Number.isInteger(year) && year >= 2000 && year <= 2200) clean.start_year = year;
  }
  if (profile.start_month != null) {
    const month = Number(profile.start_month);
    if (Number.isInteger(month) && month >= 1 && month <= 12) clean.start_month = month;
  }
  return clean;
}

async function derivePasswordHash({ password, saltB64, iterations = PASSWORD_ITERATIONS }) {
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

function secureHashEquals(left, right) {
  const a = Buffer.from(String(left || ""), "base64");
  const b = Buffer.from(String(right || ""), "base64");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
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
  await query(prisma, `DELETE FROM user_sessions WHERE expires_at <= now()`);
  await query(
    prisma,
    `
    DELETE FROM user_sessions
    WHERE user_id = $1
      AND id NOT IN (
        SELECT id FROM user_sessions
        WHERE user_id = $1
        ORDER BY created_date DESC
        LIMIT 4
      )
    `,
    [userId]
  );

  const token = genToken();
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days
  const id = randomUUID();
  await query(prisma, `INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`, [
    id,
    userId,
    hash,
    expiresAt.toISOString()
  ]);
  return { token, tokenHash: hash, sessionId: id, expiresAt: expiresAt.toISOString() };
}

async function authRequired(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Missing Authorization header");

  const hash = tokenHash(token);
  const rows = await query(
    prisma,
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
  if (!row) throw httpError(401, "Invalid or expired token");

  req.user = sanitizeUser(row);
  req.session = { id: row.session_id, tokenHash: row.token_hash };

  // Best-effort last_used update
  query(prisma, `UPDATE user_sessions SET last_used = now() WHERE id = $1`, [row.session_id]).catch(() => {});

  return req.user;
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
      details: !isProduction && dbLastError ? `DB init error: ${dbLastError}` : undefined
    });
  })
);

app.use(
  "/api",
  asyncHandler(async (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    await authRequired(req);
    return next();
  })
);

app.post(
  "/auth/register",
  registerRateLimit,
  asyncHandler(async (req, res) => {
    if (!registrationEnabled) throw httpError(403, "Criação de novas contas desativada");
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({
        error: "Database not available",
        status: 503,
        details: !isProduction && dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    const data = req.body || {};
    const email = normalizeEmail(data.email);
    const password = String(data.password || "");
    if (!validateEmail(email)) throw httpError(400, "Email inválido");
    validatePassword(password);

    const user = await prisma.$transaction(async (tx) => {
      await query(tx, `SELECT pg_advisory_xact_lock(hashtext('atm-first-user-registration'))`);

      const existing = await query(tx, `SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
      if (existing[0]) throw httpError(409, "Já existe uma conta com este email");

      const countRows = await query(tx, `SELECT COUNT(*)::int AS n FROM users`);
      const role = Number(countRows?.[0]?.n || 0) === 0 ? "admin" : "user";
      const salt = crypto.randomBytes(16).toString("base64");
      const iterations = PASSWORD_ITERATIONS;
      const hash = await derivePasswordHash({ password, saltB64: salt, iterations });

      const rows = await query(
        tx,
        `
        INSERT INTO users (id, email, role, password_salt, password_iterations, password_hash, profile)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *;
        `,
        [randomUUID(), email, role, salt, iterations, hash, sanitizeProfile(data.profile)]
      );
      return sanitizeUser(rows[0]);
    });

    const session = await createSession(user.id);

    res.status(201).json({ token: session.token, user });
  })
);

app.post(
  "/auth/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({
        error: "Database not available",
        status: 503,
        details: !isProduction && dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    const data = req.body || {};
    const email = normalizeEmail(data.email);
    const password = String(data.password || "");
    if (!validateEmail(email) || !password || password.length > PASSWORD_MAX_LENGTH) {
      throw httpError(401, "Credenciais inválidas");
    }

    const rows = await query(prisma, `SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
    const userRow = rows[0] || null;
    const expected = String(userRow?.password_hash || "");
    const derived = await derivePasswordHash({
      password,
      saltB64: userRow?.password_salt || DUMMY_PASSWORD_SALT,
      iterations: Number(userRow?.password_iterations || PASSWORD_ITERATIONS)
    });
    if (!userRow || !secureHashEquals(derived, expected)) throw httpError(401, "Credenciais inválidas");

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
        details: !isProduction && dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    await authRequired(req);
    res.json(req.user);
  })
);

app.put(
  "/auth/me",
  asyncHandler(async (req, res, next) => {
    const ready = await ensureDbReady();
    if (!ready) {
      res.status(503).json({
        error: "Database not available",
        status: 503,
        details: !isProduction && dbLastError ? `DB init error: ${dbLastError}` : undefined
      });
      return;
    }
    await authRequired(req);

    const data = req.body || {};
    const email = normalizeEmail(data.email || req.user.email);
    const profileUpdate = data.profile && typeof data.profile === "object" ? sanitizeProfile(data.profile) : null;
    const profile = profileUpdate ? { ...(req.user.profile || {}), ...profileUpdate } : req.user.profile || {};
    const newPassword = data.new_password ? String(data.new_password || "") : "";
    const currentPassword = data.current_password ? String(data.current_password || "") : "";

    const updateFields = [];
    const params = [];

    if ((email !== req.user.email || newPassword) && !currentPassword) {
      throw httpError(400, "Senha atual é necessária para alterar email ou senha");
    }

    if (currentPassword) {
      if (currentPassword.length > PASSWORD_MAX_LENGTH) throw httpError(401, "Senha atual incorreta");
      const rows = await query(prisma, `SELECT password_hash, password_salt, password_iterations FROM users WHERE id = $1 LIMIT 1`, [req.user.id]);
      const userRow = rows[0];
      if (!userRow) throw httpError(401, "Credenciais inválidas");
      const derived = await derivePasswordHash({
        password: currentPassword,
        saltB64: userRow.password_salt,
        iterations: Number(userRow.password_iterations || 100000)
      });
      if (!secureHashEquals(derived, String(userRow.password_hash || ""))) {
        throw httpError(401, "Senha atual incorreta");
      }
    }

    if (email !== req.user.email) {
      if (!validateEmail(email)) throw httpError(400, "Email inválido");
      const existing = await query(prisma, `SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
      if (existing[0] && existing[0].id !== req.user.id) {
        throw httpError(409, "Já existe uma conta com este email");
      }
      updateFields.push(`email = $${params.length + 1}`);
      params.push(email);
    }

    if (newPassword) {
      validatePassword(newPassword, "Nova senha");
      const salt = crypto.randomBytes(16).toString("base64");
      const iterations = PASSWORD_ITERATIONS;
      const hash = await derivePasswordHash({ password: newPassword, saltB64: salt, iterations });
      updateFields.push(`password_salt = $${params.length + 1}`);
      params.push(salt);
      updateFields.push(`password_iterations = $${params.length + 1}`);
      params.push(iterations);
      updateFields.push(`password_hash = $${params.length + 1}`);
      params.push(hash);
    }

    if (profileUpdate) {
      updateFields.push(`profile = $${params.length + 1}`);
      params.push(profile);
    }

    if (updateFields.length === 0) {
      return res.json(req.user);
    }

    const rows = await query(
      prisma,
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, req.user.id]
    );

    const user = sanitizeUser(rows[0]);
    if (newPassword) {
      await query(prisma, `DELETE FROM user_sessions WHERE user_id = $1 AND token_hash <> $2`, [
        req.user.id,
        req.session.tokenHash
      ]);
    }
    res.json(user);
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
    await authRequired(req);
    const hash = req.session?.tokenHash;
    if (hash) await query(prisma, `DELETE FROM user_sessions WHERE token_hash = $1`, [hash]);
    res.json({ ok: true });
  })
);

function parseOrder(order, fallbackColumn) {
  if (!order || typeof order !== "string") return { column: fallbackColumn, dir: "DESC" };
  const dir = order.startsWith("-") ? "DESC" : "ASC";
  const key = order.replace(/^-/, "");
  const map = {
    created_date: "created_date",
    date: "date",
    full_name: "full_name",
    enjoy_date: "enjoy_date"
  };
  return { column: map[key] || fallbackColumn, dir };
}

function requireAdmin(req) {
  if (req.user?.role !== "admin") throw httpError(403, "Admin access required");
}

async function getReference(key) {
  const rows = await query(prisma, `SELECT value FROM reference_store WHERE key = $1 LIMIT 1`, [key]);
  return rows?.[0]?.value ?? null;
}

async function setReference(key, value) {
  const json = value && typeof value === "object" ? value : {};
  const rows = await query(
    prisma,
    `
    INSERT INTO reference_store (key, value)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (key)
    DO UPDATE SET
      value = EXCLUDED.value,
      updated_date = now()
    RETURNING value;
    `,
    [key, JSON.stringify(json)]
  );
  return rows?.[0]?.value ?? null;
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeHolidays(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const date = String(item.date ?? "").trim();
      const label = String(item.label ?? "").trim();
      if (!date) return null;
      return { date, label: label || "Feriado" };
    })
    .filter(Boolean);
}

function normalizeInstructions(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const line = Number(item.line);
      const column = String(item.column ?? "").trim();
      const howToFill = String(item.howToFill ?? "").trim();
      const notes = String(item.notes ?? "").trim();
      return {
        line: Number.isFinite(line) ? line : null,
        column,
        howToFill,
        notes
      };
    })
    .filter((item) => item && (item.line != null || item.column || item.howToFill || item.notes));
}

function normalizeProjects(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const code = String(item.code ?? "").trim();
      const description = String(item.description ?? "").trim();
      const client = String(item.client ?? "").trim();
      if (!code && !description && !client) return null;
      return { code, description, client };
    })
    .filter(Boolean);
}

function mergeProjects(existing = [], incoming = []) {
  const merged = new Map();
  for (const item of [...normalizeProjects(existing, []), ...normalizeProjects(incoming, [])]) {
    const key = String(item.code || item.description || "").trim().toLowerCase();
    if (!key) continue;
    const current = merged.get(key) || { code: "", description: "", client: "" };
    merged.set(key, {
      code: current.code || item.code,
      description: current.description || item.description,
      client: current.client || item.client
    });
  }
  return Array.from(merged.values()).sort((a, b) =>
    String(a.code || a.description).localeCompare(String(b.code || b.description), "pt", {
      numeric: true,
      sensitivity: "base"
    })
  );
}

app.get(
  "/api/reference/timesheet-config",
  asyncHandler(async (req, res) => {
    const existing = await getReference("timesheet_config");
    res.json(existing || { instructions: [], projects: [], options: {} });
  })
);

app.put(
  "/api/reference/timesheet-config",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const existing = (await getReference("timesheet_config")) || {};
    const existingOptions = existing?.options && typeof existing.options === "object" ? existing.options : {};

    const instructions = normalizeInstructions(body.instructions, existing.instructions || []);
    const projects = normalizeProjects(body.projects, existing.projects || []);
    const optionsBody = body?.options && typeof body.options === "object" ? body.options : {};
    const options = {
      dayTypes: normalizeStringArray(optionsBody.dayTypes, normalizeStringArray(existingOptions.dayTypes, [])),
      overtimeReasons: normalizeStringArray(
        optionsBody.overtimeReasons,
        normalizeStringArray(existingOptions.overtimeReasons, [])
      ),
      absenceTypes: normalizeStringArray(optionsBody.absenceTypes, normalizeStringArray(existingOptions.absenceTypes, [])),
      holidays: normalizeHolidays(optionsBody.holidays, normalizeHolidays(existingOptions.holidays, []))
    };

    const saved = await setReference("timesheet_config", { instructions, projects, options });
    res.json(saved);
  })
);

app.post(
  "/api/reference/projects/merge",
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incoming = normalizeProjects(body.projects, []);
    const existing = (await getReference("timesheet_config")) || {};
    const existingOptions = existing?.options && typeof existing.options === "object" ? existing.options : {};
    const projects = mergeProjects(existing.projects || [], incoming);
    const saved = await setReference("timesheet_config", {
      instructions: normalizeInstructions(existing.instructions || [], []),
      projects,
      options: existingOptions
    });
    res.json(saved);
  })
);

app.post(
  "/api/reference/projects/sync",
  asyncHandler(async (req, res) => {
    const timesheets = await query(
      prisma,
      `SELECT DISTINCT source_file_url FROM timesheets WHERE user_id = $1 AND COALESCE(source_file_url, '') <> ''`,
      [req.user.id]
    );
    const extractedProjects = [];

    for (const timesheet of timesheets) {
      try {
        const { filePath } = resolveUploadedFile(timesheet.source_file_url);
        if (!fs.existsSync(filePath)) continue;
        const result = await extractTimesheetDailyRecords({ filePath, sheetName: "TimeSheet" });
        if (Array.isArray(result.projects)) extractedProjects.push(...result.projects);
      } catch (error) {
        console.warn("[projects] catalog sync skipped file", error?.message || String(error));
      }
    }

    const existing = (await getReference("timesheet_config")) || {};
    const saved = await setReference("timesheet_config", {
      instructions: normalizeInstructions(existing.instructions || [], []),
      projects: mergeProjects(existing.projects || [], extractedProjects),
      options: existing?.options && typeof existing.options === "object" ? existing.options : {}
    });
    res.json(saved);
  })
);

async function ensureTimesheetOwned({ timesheetId, userId, client = prisma }) {
  if (!timesheetId) return true;
  const rows = await query(client, `SELECT id FROM timesheets WHERE id = $1 AND user_id = $2 LIMIT 1`, [
    timesheetId,
    userId
  ]);
  if (!rows[0]) throw httpError(403, "Timesheet not found (or not owned by current user)");
  return true;
}

function resolveUploadedFile(fileUrl) {
  let filename = "";
  try {
    const parsed = new URL(String(fileUrl || ""), "http://localhost");
    filename = path.basename(parsed.pathname || "");
  } catch {
    filename = path.basename(String(fileUrl || ""));
  }

  if (!/^[a-f0-9]{32}$/i.test(filename)) throw httpError(400, "Referência de arquivo inválida");

  const filePath = path.resolve(uploadsDir, filename);
  const relative = path.relative(path.resolve(uploadsDir), filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw httpError(400, "Referência de arquivo inválida");
  }
  return { filename, filePath };
}

function validateUploadedFileUrl(fileUrl) {
  const value = String(fileUrl || "").trim();
  if (value) resolveUploadedFile(value);
  return value;
}

app.get(
  "/api/employees",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const limit = Math.min(Number(req.query.limit || 200) || 200, 1000);
    const { column, dir } = parseOrder(req.query.order, "created_date");
    const rows = await query(prisma, `SELECT * FROM employees ORDER BY ${column} ${dir} LIMIT $1`, [limit]);
    res.json(rows);
  })
);

app.post(
  "/api/employees",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const data = req.body || {};
    if (!data.full_name || !data.email) throw httpError(400, "full_name and email are required");
    const id = randomUUID();
    const rows = await query(
      prisma,
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
    requireAdmin(req);
    const data = req.body || {};
    const rows = await query(
      prisma,
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
    requireAdmin(req);
    const rows = await query(prisma, `DELETE FROM employees WHERE id = $1 RETURNING 1`, [req.params.id]);
    if (!rows.length) throw httpError(404, "employee not found");
    res.json({ ok: true });
  })
);

app.get(
  "/api/timesheet-records",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 500) || 500, 5000);
    const { column, dir } = parseOrder(req.query.order, "date");
    const timesheetId = req.query.timesheet_id ? String(req.query.timesheet_id) : null;
    const date = req.query.date ? String(req.query.date) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const clauses = [`user_id = $2`];
    const params = [limit, req.user.id];
    let idx = 3;

    if (timesheetId) {
      clauses.push(`timesheet_id = $${idx++}`);
      params.push(timesheetId);
    }
    if (date) {
      clauses.push(`date = $${idx++}`);
      params.push(date);
    } else {
      if (from) {
        clauses.push(`date >= $${idx++}`);
        params.push(from);
      }
      if (to) {
        clauses.push(`date <= $${idx++}`);
        params.push(to);
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query(prisma, `SELECT * FROM timesheet_records ${where} ORDER BY ${column} ${dir} LIMIT $1`, params);
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
    await ensureTimesheetOwned({ timesheetId: data.timesheet_id || null, userId: req.user.id });
    const id = randomUUID();
    const rows = await query(
      prisma,
      `
      INSERT INTO timesheet_records
        (id, user_id, timesheet_id, employee_name, employee_number, month, year, date, normal_hours, extra_hours, travel_hours, absence_hours,
         day_type, absence_type, project_number, project_client, project_description, compensated, period_start, period_end,
         pause_hours, status, observations)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,$18,$19,$20,
         $21,$22,$23)
      RETURNING *;
      `,
      [
        id,
        req.user.id,
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

    const created = await prisma.$transaction(async (tx) => {
      const uniqueTimesheetIds = [
        ...new Set(
          items
            .map((i) => i?.timesheet_id)
            .filter(Boolean)
            .map((v) => String(v))
        )
      ];
      for (const tsId of uniqueTimesheetIds) {
        await ensureTimesheetOwned({ timesheetId: tsId, userId: req.user.id, client: tx });
      }

      const results = [];
      for (const item of items) {
        if (!item?.employee_name || !item?.date) throw httpError(400, "Each item needs employee_name and date");
        const id = randomUUID();
        const rows = await query(
          tx,
          `
          INSERT INTO timesheet_records
            (id, user_id, timesheet_id, employee_name, employee_number, month, year, date, normal_hours, extra_hours, travel_hours, absence_hours,
             day_type, absence_type, project_number, project_client, project_description, compensated, period_start, period_end,
             pause_hours, status, observations)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             $13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23)
          RETURNING *;
          `,
          [
            id,
            req.user.id,
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
        results.push(rows[0]);
      }
      return results;
    });

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
    const rows = await query(
      prisma,
      `
      SELECT
        t.*,
        COUNT(r.id)::int AS record_count,
        COALESCE(SUM(r.normal_hours), 0)::float AS total_normal_hours,
        COALESCE(SUM(r.extra_hours), 0)::float AS total_extra_hours,
        COALESCE(SUM(r.travel_hours), 0)::float AS total_travel_hours,
        COALESCE(SUM(r.absence_hours), 0)::float AS total_absence_hours,
        COALESCE(SUM(CASE WHEN r.normal_hours > 0 THEN 1 ELSE 0 END), 0)::int AS worked_days,
        COALESCE(SUM(CASE WHEN r.compensated THEN r.normal_hours ELSE 0 END), 0)::float AS total_compensated_hours,
        MIN(r.date) AS period_start,
        MAX(r.date) AS period_end
      FROM timesheets t
      LEFT JOIN timesheet_records r ON r.timesheet_id = t.id
      WHERE t.user_id = $2
      GROUP BY t.id
      ORDER BY t.created_date DESC
      LIMIT $1
      `,
      [limit, req.user.id]
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
    const employeeName = String(data.employee_name || "").trim();
    const employeeNumber = String(data.employee_number || "").trim();
    const month = String(data.month || "").trim();
    const year = data.year != null && data.year !== "" ? Number(data.year) : null;
    const replace = Boolean(data.replace);
    const sourceFileUrl = validateUploadedFileUrl(data.source_file_url);

    const created = await prisma.$transaction(async (tx) => {
      if (month && year != null && (employeeNumber || employeeName)) {
        const existing = await query(
          tx,
          `
          SELECT id
          FROM timesheets
          WHERE user_id = $5
            AND year = $1
            AND lower(regexp_replace(btrim(month), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim($2), '\\s+', ' ', 'g'))
            AND (
              regexp_replace(btrim(COALESCE(employee_number, '')), '\\s+', '', 'g') =
                regexp_replace(btrim($3), '\\s+', '', 'g')
              OR (
                regexp_replace(btrim($3), '\\s+', '', 'g') = ''
                AND lower(regexp_replace(btrim(COALESCE(employee_name, '')), '\\s+', ' ', 'g')) =
                  lower(regexp_replace(btrim($4), '\\s+', ' ', 'g'))
              )
            )
          `,
          [year, month, employeeNumber, employeeName, req.user.id]
        );

        const existingIds = existing.map((r) => r.id).filter(Boolean);
        if (existingIds.length > 0 && !replace) {
          return { conflict: existingIds };
        }

        if (existingIds.length > 0 && replace) {
          await query(tx, `DELETE FROM timesheets WHERE id = ANY($1::uuid[])`, [existingIds]);
        }
      }

      const id = randomUUID();
      const rows = await query(
        tx,
        `
        INSERT INTO timesheets
          (
            id,
            user_id,
            employee_name,
            employee_number,
            month,
            year,
            department,
            source_filename,
            source_file_url,
            total_compensation_hours,
            total_descanso_compensatorio_hours
          )
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *;
        `,
        [
          id,
          req.user.id,
          employeeName,
          employeeNumber,
          month,
          year,
          data.department || "",
          data.source_filename || "",
          sourceFileUrl,
          data.total_compensation_hours != null ? Number(data.total_compensation_hours) : 0,
          data.total_descanso_compensatorio_hours != null
            ? Number(data.total_descanso_compensatorio_hours)
            : 0
        ]
      );
      return rows[0];
    });

    if (created && created.conflict) {
      res.status(409).json({
        error: "Timesheet already exists",
        existing_timesheet_ids: created.conflict
      });
      return;
    }

    res.status(201).json(created);
  })
);

app.get(
  "/api/timesheets/:id",
  asyncHandler(async (req, res) => {
    const rows = await query(prisma, `SELECT * FROM timesheets WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id
    ]);
    if (!rows[0]) throw httpError(404, "timesheet not found");
    res.json(rows[0]);
  })
);

app.get(
  "/api/timesheets/:id/download-original",
  asyncHandler(async (req, res) => {
    const rows = await query(
      prisma,
      `SELECT source_file_url, source_filename, employee_name, month, year FROM timesheets WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    const timesheet = rows[0];
    if (!timesheet) throw httpError(404, "Timesheet não encontrado.");

    const fileUrl = String(timesheet.source_file_url || "").trim();
    if (!fileUrl) {
      throw httpError(
        404,
        "O arquivo original não está disponível para este timesheet. Isso pode acontecer se ele foi importado antes do suporte ao salvamento do arquivo original ou se o arquivo foi removido do armazenamento do servidor."
      );
    }

    const { filename, filePath } = resolveUploadedFile(fileUrl);
    if (!fs.existsSync(filePath)) {
      throw httpError(
        404,
        "O arquivo original não foi encontrado no servidor. Ele pode ter sido excluído do diretório de uploads ou o armazenamento local foi limpo."
      );
    }

    const safeName = (value, fallback) =>
      String(value || fallback || "")
        .trim()
        .replace(/[\/\\?%*:|"<>]/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || fallback;

    const employeePart = safeName(timesheet.employee_name, "Nome_Sobrenome");
    const monthPart = safeName(timesheet.month, "mes");
    const yearPart = safeName(timesheet.year, String(new Date().getFullYear()));
    const extension = path.extname(filename) || ".xlsx";
    const downloadName = `${employeePart}_ATM_TimeSheet_${monthPart}_${yearPart}${extension}`;

    res.download(filePath, downloadName);
  })
);

app.put(
  "/api/timesheets/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = req.body || {};
    const sourceFileUrl = data.source_file_url == null ? null : validateUploadedFileUrl(data.source_file_url);
    const rows = await query(
      prisma,
      `
      UPDATE timesheets SET
        employee_name = COALESCE($2, employee_name),
        employee_number = COALESCE($3, employee_number),
        month = COALESCE($4, month),
        year = COALESCE($5, year),
        department = COALESCE($6, department),
        source_filename = COALESCE($7, source_filename),
        source_file_url = COALESCE($8, source_file_url),
        total_compensation_hours = COALESCE($9, total_compensation_hours),
        total_descanso_compensatorio_hours = COALESCE($10, total_descanso_compensatorio_hours)
      WHERE id = $1 AND user_id = $11
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
        sourceFileUrl,
        data.total_compensation_hours != null ? Number(data.total_compensation_hours) : null,
        data.total_descanso_compensatorio_hours != null
          ? Number(data.total_descanso_compensatorio_hours)
          : null,
        req.user.id
      ]
    );
    if (!rows[0]) throw httpError(404, "timesheet not found");
    res.json(rows[0]);
  })
);

app.delete(
  "/api/timesheets/:id",
  asyncHandler(async (req, res) => {
    const rows = await query(prisma, `DELETE FROM timesheets WHERE id = $1 AND user_id = $2 RETURNING 1`, [
      req.params.id,
      req.user.id
    ]);
    if (!rows.length) throw httpError(404, "timesheet not found");
    res.json({ ok: true });
  })
);

app.get(
  "/api/compensation-enjoyments",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 200) || 200, 2000);
    const { column, dir } = parseOrder(req.query.order, "enjoy_date");
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const clauses = [`user_id = $2`];
    const params = [limit, req.user.id];
    let idx = 3;
    if (from) {
      clauses.push(`enjoy_date >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      clauses.push(`enjoy_date <= $${idx++}`);
      params.push(to);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query(prisma, `SELECT * FROM compensation_enjoyments ${where} ORDER BY ${column} ${dir} LIMIT $1`, params);
    res.json(
      rows.map((r) => ({
        ...r,
        enjoy_date: r.enjoy_date ? r.enjoy_date.toISOString().slice(0, 10) : r.enjoy_date
      }))
    );
  })
);

app.post(
  "/api/compensation-enjoyments",
  asyncHandler(async (req, res) => {
    const data = req.body || {};
    const enjoyDate = String(data.enjoy_date || "").trim();
    const hours = Number(data.hours);
    const reason = data.reason != null ? String(data.reason) : null;

    if (!enjoyDate) throw httpError(400, "enjoy_date is required");
    if (!Number.isFinite(hours) || hours <= 0) throw httpError(400, "hours must be a positive number");

    const id = randomUUID();
    const rows = await query(
      prisma,
      `
      INSERT INTO compensation_enjoyments (id, user_id, enjoy_date, hours, reason)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *;
      `,
      [id, req.user.id, enjoyDate, hours, reason]
    );
    const row = rows[0];
    res.status(201).json({
      ...row,
      enjoy_date: row.enjoy_date ? row.enjoy_date.toISOString().slice(0, 10) : row.enjoy_date
    });
  })
);

app.delete(
  "/api/compensation-enjoyments/:id",
  asyncHandler(async (req, res) => {
    const rows = await query(prisma, `DELETE FROM compensation_enjoyments WHERE id = $1 AND user_id = $2 RETURNING 1`, [
      req.params.id,
      req.user.id
    ]);
    if (!rows.length) throw httpError(404, "compensation enjoyment not found");
    res.json({ ok: true });
  })
);

app.get(
  "/api/reports/compensation-summary.xlsx",
  asyncHandler(async (req, res) => {
    const buffer = await generateCompensationSummaryXlsx({ userId: req.user.id });
      res.setHeader(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("x-atm-report-template", "ATM-Resumo-Horas-Template.xlsx");
      res.setHeader("content-disposition", `attachment; filename="ATM-Resumo-Horas.xlsx"`);
      res.send(buffer);
    })
);

app.put(
  "/api/timesheet-records/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = req.body || {};
    if (data.timesheet_id != null) {
      await ensureTimesheetOwned({ timesheetId: data.timesheet_id, userId: req.user.id });
    }
    const rows = await query(
      prisma,
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
      WHERE id = $1 AND user_id = $22
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
        data.observations ?? null,
        req.user.id
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
    const rows = await query(prisma, `DELETE FROM timesheet_records WHERE id = $1 AND user_id = $2 RETURNING 1`, [
      req.params.id,
      req.user.id
    ]);
    if (!rows.length) throw httpError(404, "timesheet record not found");
    res.json({ ok: true });
  })
);

app.post(
  "/integrations/Core/UploadFile",
  uploadRateLimit,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, "No file uploaded");
    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ file_url: fileUrl });
  })
);

app.post(
  "/integrations/Core/ExtractDataFromUploadedFile",
  integrationRateLimit,
  asyncHandler(async (req, res) => {
    const { file_url: fileUrl } = req.body || {};
    if (!fileUrl || typeof fileUrl !== "string") throw httpError(400, "file_url is required");

    const { filePath } = resolveUploadedFile(fileUrl);

    if (!fs.existsSync(filePath)) {
      res.json({ status: "error", details: "Uploaded file not found (maybe the container was rebuilt or storage was cleared)." });
      return;
    }

    try {
      const { records, sheet, meta, projects } = await extractTimesheetDailyRecords({ filePath, sheetName: "TimeSheet" });
      if (!Array.isArray(records) || records.length === 0) {
        res.json({
          status: "error",
          details:
            `Não foram encontradas linhas diárias na folha "${sheet || "?"}". ` +
            `Confirme se o ficheiro é o template ATM e se a aba correta (TimeSheet/Time Sheet) existe.`
        });
        return;
      }
      res.json({
        status: "ok",
        output: {
          sheet,
          rows: records,
          meta: meta || {},
          projects: Array.isArray(projects) ? projects : []
        }
      });
    } catch (e) {
      res.json({
        status: "error",
        details: isProduction ? "Não foi possível processar o arquivo enviado." : e?.message || String(e)
      });
    }
  })
);

app.post(
  "/integrations/Core/InvokeLLM",
  integrationRateLimit,
  asyncHandler(async (req, res, next) => {
    await authRequired(req);
    next();
  }),
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
  const status = err instanceof multer.MulterError ? (err.code === "LIMIT_FILE_SIZE" ? 413 : 400) : err.status || 500;
  // eslint-disable-next-line no-console
  console.error("[api] error", err);
  res.status(status).json({
    error: status >= 500 && isProduction ? "Internal Server Error" : err.message || "Internal Server Error",
    status,
    extra: status < 500 || !isProduction ? err.extra : undefined
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
