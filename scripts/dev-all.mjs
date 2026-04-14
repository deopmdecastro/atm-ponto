import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function prefixStream(stream, prefix) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) process.stdout.write(`${prefix}${line}\n`);
      else process.stdout.write("\n");
    }
  });
  stream.on("end", () => {
    if (buffer.length) process.stdout.write(`${prefix}${buffer}\n`);
  });
}

function run(name, cwd, args) {
  const child = spawn(npmCmd, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true
  });

  prefixStream(child.stdout, `[${name}] `);
  prefixStream(child.stderr, `[${name}] `);

  return child;
}

const children = new Set();
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }

  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const backend = run("backend", backendDir, ["run", "dev:watch"]);
children.add(backend);
backend.on("exit", (code) => shutdown(code ?? 0));

const frontend = run("frontend", rootDir, ["run", "dev"]);
children.add(frontend);
frontend.on("exit", (code) => shutdown(code ?? 0));

