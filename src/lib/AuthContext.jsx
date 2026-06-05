 

import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';

const AuthContext = createContext();
const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";
const monthNames = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];

function monthIndex(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return 0;
  const numeric = Number(normalized);
  if (numeric >= 1 && numeric <= 12) return numeric;
  return monthNames.findIndex((month) => month.startsWith(normalized.slice(0, 3))) + 1;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    if (useLocalBackend) {
      let cancelled = false;
      (async () => {
        setIsLoadingPublicSettings(false);
        setAppPublicSettings({ id: "local", public_settings: {} });

        if (!base44.auth.hasToken()) {
          setUser(null);
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
          return;
        }

        const cachedUser = base44.auth.getCachedUser();
        if (cachedUser) {
          setUser(cachedUser);
          setIsAuthenticated(true);
          setIsLoadingAuth(false);
        } else {
          setIsLoadingAuth(true);
        }

        try {
          const currentUser = await base44.auth.me();
          if (cancelled) return;
          setUser(currentUser);
          setIsAuthenticated(true);
          setAuthError(null);
        } catch (error) {
          if (cancelled) return;
          if (error?.status === 401 || error?.status === 403) {
            setUser(null);
            setIsAuthenticated(false);
            base44.auth.logout(false);
          } else if (!cachedUser) {
            setUser(null);
            setIsAuthenticated(false);
          }
        } finally {
          if (!cancelled) setIsLoadingAuth(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      // Now check if the user is authenticated
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      
      // If user auth fails, it might be an expired token
      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    
    if (shouldRedirect) {
      if (useLocalBackend) {
        base44.auth.logout();
        return;
      }

      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      if (useLocalBackend) {
        base44.auth.logout();
        return;
      }
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    if (useLocalBackend) {
      base44.auth.redirectToLogin();
      return;
    }
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  };

  const login = async ({ email, password }) => {
    if (!useLocalBackend) throw new Error("Login local não disponível neste modo");
    const u = await base44.auth.login({ email, password });
    setUser(u);
    setIsAuthenticated(true);
    return u;
  };

  const updateProfile = async ({ email, currentPassword, newPassword, startYear, startMonth }) => {
    if (!useLocalBackend) throw new Error("Atualização de perfil só disponível no backend local");
    const payload = { email, currentPassword, newPassword };
    if (
      (typeof startYear !== "undefined" && startYear !== null) ||
      (typeof startMonth !== "undefined" && startMonth !== null)
    ) {
      payload.profile = {
        start_year: Number(startYear) || undefined,
        start_month: Number(startMonth) || undefined
      };
    }
    const u = await base44.auth.updateProfile(payload);
    setUser(u);
    return u;
  };

  const register = async ({ email, password, file, onProgress }) => {
    if (!useLocalBackend) throw new Error("Registo local não disponível neste modo");
    if (!file) throw new Error("É necessário anexar um timesheet (Excel)");
    if (typeof onProgress === "function") onProgress("A fazer upload do ficheiro...");

    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    if (typeof onProgress === "function") onProgress("A ler os dados do timesheet...");
    const rawResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: "object",
        properties: {
          rows: { type: "array", items: { type: "object" } }
        }
      }
    });

    if (rawResult?.status === "error") {
      throw new Error(rawResult.details || "Não foi possível ler o ficheiro Excel");
    }

    const rawRows = rawResult.output?.rows || rawResult.output || [];
    const meta = rawResult.output?.meta || {};
    const extracted = { ...(meta || {}), daily_records: rawRows };

    const dailyRecords = extracted.daily_records || [];
    if (!Array.isArray(dailyRecords) || dailyRecords.length === 0) {
      throw new Error("Não foram encontrados registos diários no ficheiro.");
    }

    if (typeof onProgress === "function") onProgress("A criar conta...");
    const u = await base44.auth.register({
      email,
      password,
      profile: {
        employee_name: extracted.employee_name || "",
        employee_number: extracted.employee_number || "",
        department: extracted.department || extracted.observations || "",
        start_year: Number(extracted.year) || new Date().getFullYear(),
        start_month: monthIndex(extracted.month) || 1
      }
    });
    setUser(u);
    setIsAuthenticated(true);

    if (Array.isArray(rawResult.output?.projects) && rawResult.output.projects.length > 0) {
      await base44.reference.mergeProjects(rawResult.output.projects);
    }

    if (typeof onProgress === "function") onProgress(`A guardar ${dailyRecords.length} registos...`);

    const timesheet = await base44.entities.Timesheet.create({
      employee_name: extracted.employee_name || "Desconhecido",
      employee_number: String(extracted.employee_number || ""),
      month: extracted.month || "",
      year: extracted.year || new Date().getFullYear(),
      department: extracted.department || extracted.observations || "",
      source_filename: file?.name || "",
      source_file_url: file_url || "",
      total_compensation_hours: extracted.total_compensation_hours ?? 0,
      total_descanso_compensatorio_hours: extracted.total_descanso_compensatorio_hours ?? 0
    });

    const toCreate = dailyRecords.map((r) => ({
      timesheet_id: timesheet.id,
      employee_name: extracted.employee_name || "Desconhecido",
      employee_number: String(extracted.employee_number || ""),
      month: extracted.month || "",
      year: extracted.year || new Date().getFullYear(),
      date: r.date,
      normal_hours: r.normal_hours || 0,
      extra_hours: r.extra_hours || 0,
      travel_hours: r.travel_hours || 0,
      absence_hours: r.absence_hours || 0,
      day_type: r.day_type || "",
      absence_type: r.absence_type || "",
      project_number: r.project_number || "",
      project_client: r.project_client || "",
      project_description: r.project_description || "",
      compensated: false,
      period_start: r.period_start || "",
      period_end: r.period_end || "",
      pause_hours: r.pause_hours || 0,
      status: "normal",
      observations: extracted.department || ""
    }));

    await base44.entities.TimesheetRecord.bulkCreate(toCreate);

    try {
      localStorage.setItem("atm.selectedTimesheetId", timesheet.id);
    } catch {
      // ignore
    }

    return { user: u, timesheet };
  };

  return React.createElement(
    AuthContext.Provider,
    {
      value: {
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAppState,
        login,
        register,
        updateProfile
      }
    },
    children
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
