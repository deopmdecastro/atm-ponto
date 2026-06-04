import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";

const TOKEN_KEY = "atm.auth.token.v1";

function normalizeBaseUrl(value) {
  let s = String(value || "").trim();
  if (!s) return "";

  // Common deployment misconfigurations (e.g. "=https:/host" copied into env var).
  if (s.startsWith("=")) s = s.slice(1).trim();
  s = s.replace(/^https:\/(?!\/)/i, "https://");
  s = s.replace(/^http:\/(?!\/)/i, "http://");

  // Remove trailing slash to avoid double-slash joins.
  s = s.replace(/\/+$/, "");
  return s;
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setToken(token) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, String(token));
  } catch {
    // ignore
  }
}

async function createHttpError(res) {
  let payload = null;
  let text = "";
  try {
    text = await res.text();
    if (text) payload = JSON.parse(text);
  } catch {
    // ignore
  }

  const message =
    payload?.error ||
    payload?.message ||
    (text && !text.trim().startsWith("<") ? text.trim() : "") ||
    `Request failed: ${res.status}`;
  const err = new Error(message);
  err.status = res.status;
  err.data = payload;
  err.responseText = text;
  throw err;
}

function createFetchClient(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (baseUrl && !normalizedBaseUrl) {
    // eslint-disable-next-line no-console
    console.warn("[api] Invalid VITE_LOCAL_BACKEND_URL, falling back to relative paths:", baseUrl);
  }

  function buildUrl(path) {
    if (!normalizedBaseUrl) return path;
    return `${normalizedBaseUrl}${path}`;
  }

  async function request(method, path, body) {
    const token = getToken();
    const res = await fetch(buildUrl(path), {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      await createHttpError(res);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function uploadFile(path, file) {
    const formData = new FormData();
    formData.append("file", file);

    const token = getToken();
    const res = await fetch(buildUrl(path), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: formData
    });
    if (!res.ok) {
      await createHttpError(res);
    }
    return res.json();
  }

  function parseFilenameFromContentDisposition(header) {
    if (!header) return "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
    return match ? decodeURIComponent(match[1].replace(/\+/, " ")) : "";
  }

  async function download(path) {
    const token = getToken();
    const res = await fetch(buildUrl(path), {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : undefined
    });
    if (!res.ok) {
      await createHttpError(res);
    }
    return res.blob();
  }

  async function downloadWithFilename(path) {
    const token = getToken();
    const res = await fetch(buildUrl(path), {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : undefined
    });
    if (!res.ok) {
      await createHttpError(res);
    }

    const blob = await res.blob();
    return {
      blob,
      filename: parseFilenameFromContentDisposition(res.headers.get("content-disposition"))
    };
  }

  const entities = {
    Timesheet: {
      list: (limit = 50) => request("GET", `/api/timesheets?limit=${encodeURIComponent(limit)}`),
      create: (data) => request("POST", "/api/timesheets", data),
      get: (id) => request("GET", `/api/timesheets/${encodeURIComponent(id)}`),
      downloadOriginal: (id) => downloadWithFilename(`/api/timesheets/${encodeURIComponent(id)}/download-original`),
      update: (id, data) => request("PUT", `/api/timesheets/${encodeURIComponent(id)}`, data),
      delete: (id) => request("DELETE", `/api/timesheets/${encodeURIComponent(id)}`)
    },
    TimesheetRecord: {
      list: (order = "-date", limit = 500, filters = {}) => {
        const qs = new URLSearchParams({
          order,
          limit: String(limit)
        });
        if (filters?.timesheet_id) qs.set("timesheet_id", String(filters.timesheet_id));
        if (filters?.date) qs.set("date", String(filters.date));
        if (filters?.from) qs.set("from", String(filters.from));
        if (filters?.to) qs.set("to", String(filters.to));
        return request("GET", `/api/timesheet-records?${qs.toString()}`);
      },
      create: (data) => request("POST", "/api/timesheet-records", data),
      bulkCreate: (items) => request("POST", "/api/timesheet-records/bulk", items),
      update: (id, data) => request("PUT", `/api/timesheet-records/${encodeURIComponent(id)}`, data),
      delete: (id) => request("DELETE", `/api/timesheet-records/${encodeURIComponent(id)}`)
    },
    CompensationEnjoyment: {
      list: (order = "-enjoy_date", limit = 200, filters = {}) => {
        const qs = new URLSearchParams({
          order,
          limit: String(limit)
        });
        if (filters?.from) qs.set("from", String(filters.from));
        if (filters?.to) qs.set("to", String(filters.to));
        return request("GET", `/api/compensation-enjoyments?${qs.toString()}`);
      },
      create: (data) => request("POST", "/api/compensation-enjoyments", data),
      delete: (id) => request("DELETE", `/api/compensation-enjoyments/${encodeURIComponent(id)}`)
    }
  };

  return {
    entities,
    reference: {
      getTimesheetConfig: async () => {
        try {
          return await request("GET", "/api/reference/timesheet-config");
        } catch (err) {
          if (err?.status === 401 || err?.status === 404) {
            // Local backend is either not running, requires auth, or is an older build without this endpoint.
            // Return a safe default so the UI can still render.
            return { instructions: [], projects: [], options: {} };
          }
          throw err;
        }
      },
      updateTimesheetConfig: async (data) => {
        try {
          return await request("PUT", "/api/reference/timesheet-config", data);
        } catch (err) {
          if (err?.status === 404) {
            throw new Error(
              "Endpoint /api/reference/timesheet-config não existe no backend local. Atualize/reinicie o backend local."
            );
          }
          if (err?.status === 401 || err?.status === 403) {
            throw new Error("Sem permissões para atualizar a configuração. Faça login como admin no backend local.");
          }
          throw err;
        }
      },
      mergeProjects: async (projects) => {
        try {
          return await request("POST", "/api/reference/projects/merge", { projects });
        } catch (err) {
          if (err?.status === 404) return null;
          throw err;
        }
      },
      syncProjects: async () => {
        try {
          return await request("POST", "/api/reference/projects/sync");
        } catch (err) {
          if (err?.status === 404) return null;
          throw err;
        }
      }
    },
    users: {
      listRegistered: (limit = 200) => request("GET", `/api/admin/users?limit=${encodeURIComponent(limit)}`),
      resetPassword: (id, newPassword) =>
        request("POST", `/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
          new_password: newPassword
        })
    },
    reports: {
      downloadCompensationSummaryXlsx: () => download("/api/reports/compensation-summary.xlsx")
    },
    auth: {
      login: async ({ email, password }) => {
        const payload = await request("POST", "/auth/login", { email, password });
        if (payload?.token) setToken(payload.token);
        return payload?.user || null;
      },
      register: async ({ email, password, profile }) => {
        const payload = await request("POST", "/auth/register", { email, password, profile });
        if (payload?.token) setToken(payload.token);
        return payload?.user || null;
      },
      me: async () => request("GET", "/auth/me"),
      updateProfile: async ({ email, currentPassword, newPassword, profile }) => {
        const payload = await request("PUT", "/auth/me", {
          email,
          current_password: currentPassword,
          new_password: newPassword,
          profile
        });
        return payload || null;
      },
      logout: async () => {
        try {
          await request("POST", "/auth/logout");
        } finally {
          setToken("");
        }
        return { ok: true };
      },
      redirectToLogin: async () => {
        window.location.href = "/login";
        return { ok: true };
      }
    },
    integrations: {
      Core: {
        UploadFile: async ({ file }) => uploadFile("/integrations/Core/UploadFile", file),
        ExtractDataFromUploadedFile: async (params) =>
          request("POST", "/integrations/Core/ExtractDataFromUploadedFile", params),
        InvokeLLM: async (params) => request("POST", "/integrations/Core/InvokeLLM", params)
      }
    }
  };
}

function ensureReference(client) {
  if (client.reference) return;
  client.reference = {
    getTimesheetConfig: async () => ({ instructions: [], projects: [], options: {} }),
    mergeProjects: async () => null,
    syncProjects: async () => null,
    updateTimesheetConfig: async () => {
      throw new Error("Configuração indisponível neste modo (use o backend local).");
    }
  };
}

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";
// In dev, prefer same-origin requests and let Vite's proxy forward to the backend.
// This avoids hard-coding ports and sidesteps CORS issues.
const localBackendUrl = import.meta.env.DEV ? "" : normalizeBaseUrl(import.meta.env.VITE_LOCAL_BACKEND_URL);

export const base44 = useLocalBackend
  ? createFetchClient(localBackendUrl)
  : createClient({
      appId: appParams.appId,
      token: appParams.token,
      functionsVersion: appParams.functionsVersion,
      serverUrl: "",
      requiresAuth: false,
      appBaseUrl: appParams.appBaseUrl
    });

ensureReference(base44);

// Reports only exist on the local backend implementation. Provide a safe no-op for Base44-hosted mode.
if (!base44.reports) {
  base44.reports = {
    downloadCompensationSummaryXlsx: async () => {
      throw new Error("Relatório Excel indisponível neste modo (use o backend local).");
    }
  };
}
