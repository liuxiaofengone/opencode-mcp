import { spawn, execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { StringDecoder } from "node:string_decoder";
import { createEventParser } from "./events.mjs";

const execFileAsync = promisify(execFile);
const READER_AGENT = "codex-mcp-reader";
const READ_PERMISSIONS = Object.freeze({
  "*": "deny", read: "allow", glob: "allow", grep: "allow", list: "allow",
  edit: "deny", write: "deny", patch: "deny", bash: "deny", shell: "deny",
  task: "deny", external_directory: "deny", webfetch: "deny", websearch: "deny",
});

async function fileExists(candidate) {
  try { return (await stat(candidate)).isFile(); } catch { return false; }
}
function envValue(env, name) {
  const key = Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase());
  return key ? env[key] : undefined;
}
export async function resolveOpenCodeExecutable(env = process.env, { commandName = "opencode" } = {}) {
  const explicit = env.OPENCODE_BIN;
  if (explicit) {
    if (!path.isAbsolute(explicit) || !await fileExists(explicit)) {
      throw new Error("OPENCODE_BIN must point to an existing absolute executable path");
    }
    if (/\.(cmd|bat|ps1)$/i.test(explicit)) throw new Error("OPENCODE_BIN must point to the native executable, not a shell wrapper");
    return explicit;
  }
  const candidates = [];
  if (commandName === "opencode") {
    if (process.platform === "win32") {
      const appData = envValue(env, "APPDATA");
      if (appData) candidates.push(path.join(appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"));
    }
    candidates.push(path.join(envValue(env, "USERPROFILE") || env.HOME || homedir(), ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode"));
  }
  const names = process.platform === "win32" && !path.extname(commandName) ? [commandName + ".exe", commandName] : [commandName];
  for (const directory of (envValue(env, "PATH") || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(directory.replace(/^"|"$/g, ""), name));
  }
  for (const candidate of candidates) if (path.isAbsolute(candidate) && await fileExists(candidate)) return candidate;
  throw new Error("OpenCode executable not found. Set OPENCODE_BIN to the native OpenCode 2 executable path.");
}

export function redact(value) {
  return String(value ?? "")
    .replace(/(server password\s*[:=]?\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|authorization|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[REDACTED]");
}

async function git(cwd, args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true, timeout: 5000, maxBuffer: 1_000_000 });
    return stdout.trim().slice(0, 12000);
  } catch { return null; }
}

function childEnvironment(env, input) {
  const childEnv = { ...env, PWD: input.cwd };
  if (!input.readOnly) return childEnv;
  let config = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try { config = JSON.parse(env.OPENCODE_CONFIG_CONTENT); }
    catch { throw new Error("OPENCODE_CONFIG_CONTENT must be valid JSON for read-only execution"); }
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("OPENCODE_CONFIG_CONTENT must be a JSON object");
  }
  // Override legacy AND native permission forms: native fields otherwise take
  // precedence over migrated legacy configuration in OpenCode 2.
  delete config.permissions;
  delete config.agents;
  childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config,
    permission: READ_PERMISSIONS,
    agent: { ...config.agent, [READER_AGENT]: {
      mode: "primary", description: "Read project files and summarize without changing files or running commands.",
      prompt: "You are a project reader. Read files with the permitted read, glob and grep tools. Summarize your findings. All write, shell, external-directory and network tools are denied.",
      permission: READ_PERMISSIONS,
    } },
  });
  return childEnv;
}

async function terminateTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try { await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }); }
    catch { child.kill(); }
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1000);
    timer.unref();
  }
}

export async function runOpenCode(input, options = {}) {
  const settings = { readOnly: true, autoApprove: false, standalone: true, timeoutMs: 900000, ...input };
  let executable, env;
  try {
    if (typeof settings.cwd !== "string" || !path.isAbsolute(settings.cwd)) throw new Error("cwd must be an absolute directory path");
    if (!await stat(settings.cwd).then((s) => s.isDirectory()).catch(() => false)) throw new Error("cwd directory does not exist");
    if (typeof settings.task !== "string" || !settings.task.trim() || settings.task.startsWith("-")) throw new Error("task must be nonempty and must not start with a CLI option");
    if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs <= 0 || settings.timeoutMs > 3600000) throw new Error("timeoutMs must be an integer between 1 and 3600000");
    // OpenCode resumes at the saved session location, and saved permission
    // rules outrank agent rules. A new session keeps cwd and reader permissions
    // authoritative for this bounded invocation.
    if (settings.sessionId || settings.continueSession) throw new Error("Session continuation is unsupported: start a new task so cwd and current permissions control the execution");
    if (settings.readOnly && !settings.standalone) throw new Error("Read-only execution requires standalone=true to apply isolated permissions");
    env = childEnvironment(options.env ?? process.env, settings);
    executable = options.executable ?? await resolveOpenCodeExecutable(env);
    if (!path.isAbsolute(executable) || !await fileExists(executable) || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error("OpenCode executable must be an existing absolute native executable path");
  } catch (error) { return { ok: false, error: redact(error.message), cwd: settings.cwd }; }
  if (options.signal?.aborted) return { ok: false, cancelled: true, error: "OpenCode task cancelled", cwd: settings.cwd };
  const args = [...(options.prefixArgs ?? []), "run", "--format", "json"];
  if (settings.standalone) args.push("--standalone");
  if (settings.autoApprove) args.push("--auto");
  const agent = settings.readOnly ? READER_AGENT : settings.agent;
  if (agent) args.push("--agent", agent);
  if (settings.model) args.push("--model", settings.model);
  args.push(settings.task);

  return new Promise((resolve) => {
    const parser = createEventParser();
    const stderrDecoder = new StringDecoder("utf8");
    let stderr = "", spawnError = null, killedByTimeout = false, cancelled = false;
    let timer;
    const child = spawn(executable, args, { cwd: settings.cwd, env,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false,
      detached: process.platform !== "win32" });
    const abort = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      cancelled = true;
      void terminateTree(child);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      killedByTimeout = true;
      void terminateTree(child);
    }, settings.timeoutMs);
    timer.unref();
    // Handle an abort between the initial check and listener registration.
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk) => parser.write(chunk));
    child.stderr.on("data", (chunk) => { stderr = (stderr + stderrDecoder.write(chunk)).slice(-8000); });
    child.on("error", (error) => { spawnError = error; });
    child.on("close", async (exitCode, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      parser.end();
      stderr += stderrDecoder.end();
      const result = parser.result();
      let error = null;
      if (spawnError) error = `Failed to spawn OpenCode: ${spawnError.message}`;
      else if (killedByTimeout) error = "OpenCode task exceeded timeout";
      else if (cancelled) error = "OpenCode task cancelled";
      else if (result.errors.length) error = result.errors.join("\n");
      else if (exitCode !== 0) error = `OpenCode exited with code ${exitCode}${signal ? ` (${signal})` : ""}`;
      else if (result.stdoutOverflow) error = "OpenCode output exceeded the event line limit; result is incomplete";
      else if (!result.text) error = "OpenCode completed with no final text";
      const [diffStat, statusShort] = await Promise.all([
        git(settings.cwd, ["diff", "--stat"]), git(settings.cwd, ["status", "--short"]),
      ]);
      resolve({ ok: !error, ...(error ? { error: redact(error) } : {}),
        killedByTimeout, cancelled, exitCode, signal,
        sessionID: result.sessionID, cwd: settings.cwd, readOnly: settings.readOnly,
        stdoutOverflow: result.stdoutOverflow, textOverflow: result.textOverflow,
        text: redact(result.text), stepFinish: result.stepFinish, diffStat, statusShort,
        stderrTail: redact(stderr).slice(-4000) });
    });
  });
}
