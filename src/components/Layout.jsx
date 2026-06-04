 

import { useEffect, useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Upload, Clock, AlertTriangle, Users, Settings, LogOut, FolderKanban, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { useAlertCount } from "@/hooks/useAlertCount";
import atmIcon from "@/img/atm_icon.png";

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Upload" },
  { to: "/historico", icon: Clock, label: "Histórico" },
  { to: "/projetos", icon: FolderKanban, label: "Projetos" },
  { to: "/alertas", icon: AlertTriangle, label: "Alertas" },
  { to: "/settings", icon: Settings, label: "Conta" },
  { to: "/colaboradores", icon: Users, label: "Colaboradores" },
];

const mobileNavItems = navItems.filter((item) => ["/", "/upload", "/historico", "/alertas"].includes(item.to));

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const visibleNavItems = isAdmin ? navItems : navItems.filter((i) => i.to !== "/colaboradores");
  const mobileMenuItems = visibleNavItems.filter((item) => !mobileNavItems.some((mobileItem) => mobileItem.to === item.to));
  const alertCount = useAlertCount({ user, refreshKey: location.pathname });

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    setMobileMenuOpen(false);
    logout(false);
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="w-full px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16 gap-4">
          <div className="flex items-center gap-3 flex-none min-w-[190px]">
            <img src={atmIcon} alt="ATM Ponto" className="h-9 w-9 object-contain flex-none" draggable={false} />
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight whitespace-nowrap">ATM Ponto</h1>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground leading-none whitespace-nowrap">Controle de Horas</p>
            </div>
          </div>
          <div className="relative sm:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            {mobileMenuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Fechar menu"
                  className="fixed inset-0 top-16 z-40 cursor-default bg-black/10"
                  onClick={() => setMobileMenuOpen(false)}
                />
                <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-md border border-border bg-card shadow-lg">
                  {mobileMenuItems.map((item) => {
                    const active = location.pathname === item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`flex h-11 items-center gap-3 px-4 text-sm font-medium ${
                          active ? "bg-secondary text-primary" : "text-foreground hover:bg-secondary"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                  {useLocalBackend && (
                    <button
                      type="button"
                      className="flex h-11 w-full items-center gap-3 border-t border-border px-4 text-sm font-medium text-red-600 hover:bg-red-50"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4" />
                      Sair
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="hidden sm:flex items-center justify-end gap-3 min-w-0 flex-1">
            <nav className="flex items-center justify-end gap-1 min-w-0">
              {visibleNavItems.map(item => {
                const active = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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
              <div className="flex items-center gap-3 pl-2 border-l border-border min-w-0 flex-none">
                {user?.email && <span className="hidden lg:inline max-w-[220px] truncate text-sm text-muted-foreground">{user.email}</span>}
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
          {mobileNavItems.map(item => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5 text-xs font-medium transition-all ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span className="relative">
                  <item.icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
                  {item.to === "/alertas" && alertCount > 0 && (
                    <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
                      {alertCount > 99 ? "99+" : alertCount}
                    </span>
                  )}
                </span>
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
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 sm:pb-6">
        <p className="text-center text-xs text-muted-foreground">
          Designed by:{" "}
          <a
            href="https://pt.linkedin.com/in/deogracia-manuel-de-castro-6a4a8a296"
            target="_blank"
            rel="noreferrer"
            className="font-bold text-primary hover:underline"
          >
            Deogracia Castro
          </a>
        </p>
      </footer>
    </div>
  );
}
