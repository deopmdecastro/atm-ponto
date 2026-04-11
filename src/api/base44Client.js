import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";

function createFetchClient(baseUrl) {
  function buildUrl(path) {
    if (!baseUrl) return path;
    return `${baseUrl}${path}`;
  }

  async function request(method, path, body) {
    const res = await fetch(buildUrl(path), {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        // ignore
      }
      const err = new Error(payload?.error || `Request failed: ${res.status}`);
      err.status = res.status;
      err.data = payload;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function uploadFile(path, file) {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(buildUrl(path), {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        // ignore
      }
      const err = new Error(payload?.error || `Request failed: ${res.status}`);
      err.status = res.status;
      err.data = payload;
      throw err;
    }
    return res.json();
  }

  const entities = {
    Employee: {
      list: (order = "-created_date", limit = 200) =>
        request("GET", `/api/employees?order=${encodeURIComponent(order)}&limit=${encodeURIComponent(limit)}`),
      create: (data) => request("POST", "/api/employees", data),
      update: (id, data) => request("PUT", `/api/employees/${encodeURIComponent(id)}`, data),
      delete: (id) => request("DELETE", `/api/employees/${encodeURIComponent(id)}`)
    },
    Timesheet: {
      list: (limit = 50) => request("GET", `/api/timesheets?limit=${encodeURIComponent(limit)}`),
      create: (data) => request("POST", "/api/timesheets", data),
      get: (id) => request("GET", `/api/timesheets/${encodeURIComponent(id)}`),
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
        return request("GET", `/api/timesheet-records?${qs.toString()}`);
      },
      create: (data) => request("POST", "/api/timesheet-records", data),
      bulkCreate: (items) => request("POST", "/api/timesheet-records/bulk", items),
      update: (id, data) => request("PUT", `/api/timesheet-records/${encodeURIComponent(id)}`, data),
      delete: (id) => request("DELETE", `/api/timesheet-records/${encodeURIComponent(id)}`)
    }
  };

  return {
    entities,
    users: {
      inviteUser: async () => ({ ok: true })
    },
    auth: {
      me: async () => ({ id: "local", email: "local@localhost", role: "admin" }),
      logout: async () => ({ ok: true }),
      redirectToLogin: async () => ({ ok: true })
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

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";
const localBackendUrl = import.meta.env.VITE_LOCAL_BACKEND_URL || "http://localhost:3001";

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
