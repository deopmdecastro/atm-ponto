const USERS_KEY = "atm.auth.users.v1";
const SESSION_KEY = "atm.auth.session.v1";

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function base64Encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64DecodeToBytes(b64) {
  const binary = atob(String(b64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function derivePasswordHash({ password, saltB64, iterations = 100000 }) {
  if (!window.crypto?.subtle) throw new Error("WebCrypto not available");
  const enc = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const salt = base64DecodeToBytes(saltB64);
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    passwordKey,
    256
  );
  return base64Encode(new Uint8Array(bits));
}

function loadUsers() {
  const raw = localStorage.getItem(USERS_KEY);
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getCurrentSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  const session = safeJsonParse(raw, null);
  if (!session || typeof session !== "object") return null;
  if (!session.userId) return null;
  return session;
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getUserById(id) {
  const users = loadUsers();
  return users.find((u) => u && u.id === id) || null;
}

export async function loginLocal(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("Email é obrigatório");
  if (!password) throw new Error("Senha é obrigatória");

  const users = loadUsers();
  const user = users.find((u) => normalizeEmail(u.email) === normalizedEmail);
  if (!user) throw new Error("Credenciais inválidas");
  if (!user.password_salt || !user.password_hash) throw new Error("Conta inválida (sem senha)");

  const hash = await derivePasswordHash({ password, saltB64: user.password_salt, iterations: user.password_iterations || 100000 });
  if (hash !== user.password_hash) throw new Error("Credenciais inválidas");

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId: user.id,
      createdAt: new Date().toISOString()
    })
  );
  return { ...user, password_hash: undefined, password_salt: undefined };
}

export async function registerLocal({ email, password, profile }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("Email é obrigatório");
  if (!password || String(password).length < 6) throw new Error("Senha deve ter pelo menos 6 caracteres");
  if (!profile || typeof profile !== "object") throw new Error("Perfil inválido");

  const users = loadUsers();
  if (users.some((u) => normalizeEmail(u.email) === normalizedEmail)) {
    throw new Error("Já existe uma conta com este email");
  }

  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = base64Encode(saltBytes);
  const iterations = 100000;
  const hash = await derivePasswordHash({ password, saltB64, iterations });

  const user = {
    id: window.crypto.randomUUID(),
    email: normalizedEmail,
    role: "user",
    createdAt: new Date().toISOString(),
    password_salt: saltB64,
    password_iterations: iterations,
    password_hash: hash,
    profile: {
      employee_name: String(profile.employee_name || ""),
      employee_number: String(profile.employee_number || ""),
      department: String(profile.department || "")
    }
  };

  saveUsers([...users, user]);

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId: user.id,
      createdAt: new Date().toISOString()
    })
  );

  return { ...user, password_hash: undefined, password_salt: undefined };
}

