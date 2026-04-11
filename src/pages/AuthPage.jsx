import { useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { FileSpreadsheet, Lock, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function AuthPage() {
  const { isAuthenticated, login, register } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const canSubmitLogin = useMemo(() => {
    return status !== "loading" && email.trim() && password;
  }, [status, email, password]);

  const canSubmitRegister = useMemo(() => {
    return status !== "loading" && email.trim() && password && password2 && file;
  }, [status, email, password, password2, file]);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setProgress("");
    try {
      setStatus("loading");
      await login({ email, password });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setProgress("");
    if (password !== password2) {
      setError("As senhas não coincidem");
      return;
    }
    try {
      setStatus("loading");
      await register({
        email,
        password,
        file,
        onProgress: (msg) => setProgress(String(msg || ""))
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  function handlePickFile(f) {
    if (!f) return;
    if (!(f.name.endsWith(".xlsx") || f.name.endsWith(".xls"))) {
      setError("Por favor selecione um arquivo Excel (.xlsx ou .xls)");
      return;
    }
    setFile(f);
    setError("");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <FileSpreadsheet className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ATM Ponto</h1>
            <p className="text-sm text-muted-foreground">Entre para continuar</p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {progress && (
          <Alert>
            <AlertTitle>A processar</AlertTitle>
            <AlertDescription>{progress}</AlertDescription>
          </Alert>
        )}

        <Card className="border-border/60 bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle>Acesso</CardTitle>
            <CardDescription>Login ou criação de conta com base no seu timesheet.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="login" className="gap-2">
                  <Lock className="h-4 w-4" /> Entrar
                </TabsTrigger>
                <TabsTrigger value="register" className="gap-2">
                  <UserPlus className="h-4 w-4" /> Criar conta
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-6">
                <form className="space-y-4" onSubmit={handleLogin}>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Senha</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={!canSubmitLogin}>
                    Entrar
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register" className="mt-6">
                <form className="space-y-4" onSubmit={handleRegister}>
                  <div className="space-y-2">
                    <Label htmlFor="email2">Email</Label>
                    <Input
                      id="email2"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="passwordNew">Senha</Label>
                      <Input
                        id="passwordNew"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="mín. 6"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="passwordNew2">Confirmar</Label>
                      <Input
                        id="passwordNew2"
                        type="password"
                        autoComplete="new-password"
                        value={password2}
                        onChange={(e) => setPassword2(e.target.value)}
                        placeholder="repita"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Timesheet (Excel)</Label>
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handlePickFile(e.dataTransfer?.files?.[0]);
                      }}
                      className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer hover:border-primary/50 hover:bg-accent/30 ${
                        file ? "border-primary bg-accent/20" : "border-border"
                      }`}
                      onClick={() => document.getElementById("auth-file-input").click()}
                    >
                      <input
                        id="auth-file-input"
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        onChange={(e) => handlePickFile(e.target.files?.[0])}
                      />
                      {file ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                            <FileSpreadsheet className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{file.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {(file.size / 1024).toFixed(1)} KB • pronto para importar
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">Arraste o arquivo aqui</p>
                          <p className="text-xs text-muted-foreground">ou clique para selecionar • .xlsx ou .xls</p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O nome, número e departamento serão extraídos do timesheet.
                    </p>
                  </div>

                  <Button type="submit" className="w-full" disabled={!canSubmitRegister}>
                    Criar conta e importar
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

