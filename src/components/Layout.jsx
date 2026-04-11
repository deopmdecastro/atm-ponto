 

import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Upload, Clock, AlertTriangle, Users, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Upload" },
  { to: "/historico", icon: Clock, label: "Histórico" },
  { to: "/alertas", icon: AlertTriangle, label: "Alertas" },
  { to: "/colaboradores", icon: Users, label: "Colaboradores" },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const visibleNavItems = isAdmin ? navItems : navItems.filter((i) => i.to !== "/colaboradores");

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Clock className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">ATM Ponto</h1>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground leading-none">Controle de Horas</p>
            </div>
          </div>
          {useLocalBackend && (
            <div className="sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sair"
                onClick={() => {
                  logout(false);
                  navigate("/login", { replace: true });
                }}
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          )}
          <div className="hidden sm:flex items-center gap-3">
            <nav className="flex items-center gap-1">
              {visibleNavItems.map(item => {
                const active = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            {useLocalBackend && (
              <div className="flex items-center gap-3 pl-2 border-l border-border">
                {user?.email && <span className="hidden lg:inline text-sm text-muted-foreground">{user.email}</span>}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    logout(false);
                    navigate("/login", { replace: true });
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="flex justify-around py-2">
          {visibleNavItems.map(item => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 sm:pb-8">
        <Outlet />
      </main>
    </div>
  );
}
