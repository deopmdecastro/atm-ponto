import { useEffect, useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Upload, Clock, AlertTriangle, Users, Settings, LogOut,
  FolderKanban, Menu, X, PenLine, User, Bell
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { useAlertCount } from "@/hooks/useAlertCount";
import atmIcon from "@/img/atm_icon.png";

const useLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Upload" },
  { to: "/preencher", icon: PenLine, label: "Preencher" },
  { to: "/historico", icon: Clock, label: "Hist\u00f3rico" },
  { to: "/projetos", icon: FolderKanban, label: "Projetos" },
  { to: "/alertas", icon: AlertTriangle, label: "Alertas" },
  { to: "/settings", icon: Settings, label: "Conta" },
  { to: "/colaboradores", icon: Users, label: "Colaboradores" },
];

const mobileMainItems = ["/", "/preencher", "/historico", "/alertas"];

function isActive(path, to) {
  if (to === "/") return path === "/";
  return path.startsWith(to);
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isAdmin = user?.role === "admin";
  const visibleNavItems = isAdmin ? navItems : navItems.filter((i) => i.to !== "/colaboradores");
  const mobileVisible = visibleNavItems.filter((i) => mobileMainItems.includes(i.to));
  const mobileMore = visibleNavItems.filter((i) => !mobileMainItems.includes(i.to));
  const alertCount = useAlertCount({ user, refreshKey: location.pathname });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    setMobileMenuOpen(false);
    logout(false);
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      {/* ── Desktop top bar ── */}
      <header
        className={`sticky top-0 z-50 hidden sm:block transition-shadow duration-200 ${
          scrolled ? "shadow-sm" : ""
        } bg-white border-b border-gray-100`}
      >
        <div className="max-w-[1440px] mx-auto flex items-center h-14 px-6 gap-6">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 mr-2">
            <img src={atmIcon} alt="ATM Ponto" className="h-8 w-8 object-contain" draggable={false} />
            <div className="hidden lg:block leading-tight">
              <span className="text-sm font-bold tracking-tight text-gray-900">ATM Ponto</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.15em] text-red-600">Controle de Horas</span>
            </div>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-0.5 flex-1 justify-center">
            {visibleNavItems.map((item) => {
              const active = isActive(location.pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`relative flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-medium transition-all ${
                    active
                      ? "bg-red-50 text-red-700"
                      : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden xl:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {useLocalBackend && (
              <>
                <div className="hidden lg:flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-full pl-3 pr-1 py-1">
                  <User className="h-3.5 w-3.5" />
                  <span className="max-w-[180px] truncate">{user?.email || ""}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50"
                  onClick={handleLogout}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sair
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile top bar ── */}
      <header className="sticky top-0 z-50 sm:hidden bg-white border-b border-gray-100">
        <div className="flex items-center justify-between h-14 px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={atmIcon} alt="ATM Ponto" className="h-7 w-7 object-contain" draggable={false} />
            <div className="leading-tight">
              <span className="text-sm font-bold tracking-tight text-gray-900">ATM Ponto</span>
              <span className="block text-[8px] font-semibold uppercase tracking-[0.12em] text-red-600">Controle de Horas</span>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            {alertCount > 0 && (
              <Link to="/alertas" className="relative p-2 text-gray-500">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-gray-600"
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
              onClick={() => setMobileMenuOpen((o) => !o)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <>
            <div className="fixed inset-0 top-14 z-40 bg-black/20" onClick={() => setMobileMenuOpen(false)} />
            <div className="absolute left-0 right-0 top-14 z-50 bg-white border-b border-gray-100 shadow-lg animate-in slide-in-from-top-2 duration-200">
              <div className="p-3 space-y-1">
                {mobileMore.map((item) => {
                  const active = isActive(location.pathname, item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-3 px-3 h-11 rounded-lg text-sm font-medium transition-colors ${
                        active ? "bg-red-50 text-red-700" : "text-gray-600 hover:bg-gray-50"
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
                    className="flex items-center gap-3 w-full px-3 h-11 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-4 w-4" />
                    Sair
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </header>

      {/* ── Mobile bottom nav ── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-100 safe-area-inset-bottom">
        <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
          {mobileVisible.map((item) => {
            const active = isActive(location.pathname, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full text-[10px] font-medium transition-colors ${
                  active ? "text-red-600" : "text-gray-400"
                }`}
              >
                <span className="relative">
                  <item.icon className={`h-5 w-5 ${active ? "text-red-600" : "text-gray-400"}`} />
                  {item.to === "/alertas" && alertCount > 0 && (
                    <span className="absolute -top-1.5 -right-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                      {alertCount > 99 ? "99+" : alertCount}
                    </span>
                  )}
                </span>
                {item.label}
                {active && <span className="absolute bottom-0 w-8 h-0.5 bg-red-600 rounded-full" />}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Content ── */}
      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8">
        <Outlet />
      </main>

      {/* ── Footer ── */}
      <footer className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pb-20 sm:pb-5">
        <p className="text-center text-[11px] text-gray-400">
          Desenvolvido por{" "}
          <a
            href="https://pt.linkedin.com/in/deogracia-manuel-de-castro-6a4a8a296"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-red-600 hover:text-red-700"
          >
            Deogracia Castro
          </a>
        </p>
      </footer>
    </div>
  );
}
