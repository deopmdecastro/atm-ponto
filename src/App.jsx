 

import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from './components/Layout';

const Dashboard = lazy(() => import("./pages/Dashboard"));
const UploadPage = lazy(() => import("./pages/UploadPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage"));
const TimesheetDetailPage = lazy(() => import("./pages/TimesheetDetailPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated, user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (useLocalBackend && !isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/historico" element={<HistoryPage />} />
          <Route path="/alertas" element={<AlertsPage />} />
          <Route path="/colaboradores" element={isAdmin ? <EmployeesPage /> : <Navigate to="/" replace />} />
          <Route path="/historico/:timesheetId" element={<TimesheetDetailPage />} />
          <Route path="/historico/:employeeName/:year/:month" element={<TimesheetDetailPage />} />
          <Route path="*" element={<PageNotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
