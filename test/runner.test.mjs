import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/cli.mjs", import.meta.url));
const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp 中文 空格-"));
test.after(() => rm(cwd, { recursive: true, force: true }));
async function runner() {
  const module = await import("../src/runner.mjs").catch(() => null);
  assert.ok(module?.runOpenCode, "Missing portable OpenCode runner");
  return module;
}
async function run(task, extra = {}, options = {}) {
  return (await runner()).runOpenCode({ cwd, task, timeoutMs: 3000, ...extra }, {
    executable: process.execPath, prefixArgs: [fixture], ...options,
  });
}

test("reads fragmented results from an actual child process", async () => {
  const result = await run("fragmented");
  assert.equal(result.ok, true);
  assert.equal(result.text, "你好，结果完整");
  assert.equal(result.sessionID, "ses_fixture");
});
test("a provider error with exit code zero is a failed task", async () => {
  const result = await run("provider-error");
  assert.equal(result.ok, false);
  assert.match(result.error, /Model unavailable/);
});
test("exit code zero without a final answer is a failed task", async () => {
  const result = await run("quiet");
  assert.equal(result.ok, false);
  assert.match(result.error, /no final text/i);
});
test("enforces a read-only JSON agent and synchronizes a Unicode cwd", async () => {
  const result = await run("inspect-environment");
  const report = JSON.parse(result.text);
  assert.equal(report.pwd, cwd);
  assert.ok(report.args.includes("--standalone"));
  assert.ok(!report.args.includes("--auto"));
  const agentIndex = report.args.indexOf("--agent");
  const permissions = report.config.agent[report.args[agentIndex + 1]].permission;
  assert.equal(permissions["*"], "deny");
  assert.equal(permissions.read, "allow");
  assert.equal(permissions.edit, "deny");
  assert.equal(permissions.bash, "deny");
  assert.equal(permissions.external_directory, "deny");
});
test("write mode uses the CLI default agent and only explicitly requested auto approval", async () => {
  const result = await run("inspect-environment", { readOnly: false, autoApprove: true });
  const report = JSON.parse(result.text);
  assert.ok(report.args.includes("--auto"));
  assert.ok(!report.args.includes("--agent"));
});
test("rejects relative or missing working directories before spawning", async () => {
  assert.match((await run("quiet", { cwd: "relative" })).error, /absolute/);
  assert.match((await run("quiet", { cwd: path.join(cwd, "missing") })).error, /directory/i);
});
test("read-only mode cannot reuse a background server with different permissions", async () => {
  const result = await run("quiet", { standalone: false });
  assert.equal(result.ok, false);
  assert.match(result.error, /standalone/i);
});
test("reports spawn failures rather than throwing or hanging", async () => {
  const result = await run("quiet", {}, { executable: path.join(cwd, "missing.exe") });
  assert.equal(result.ok, false);
  assert.match(result.error, /spawn|executable/i);
});
test("terminates a timed-out task", async () => {
  const result = await run("delay", { timeoutMs: 150 });
  assert.equal(result.ok, false);
  assert.equal(result.killedByTimeout, true);
});
test("cancels a task when its owner disconnects", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    const result = await run("delay", {}, { signal: controller.signal });
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
  } finally { clearTimeout(timer); }
});
test("does not return printed server credentials", async () => {
  const result = await run("stderr-secret");
  assert.ok(!result.stderrTail.includes("EXAMPLE_SECRET"));
});
test("terminates descendants of a timed-out task", async () => {
  const pidFile = path.join(cwd, "descendant.pid");
  const result = await run("delay-tree", { timeoutMs: 1200 }, { env: { ...process.env, TEST_CHILD_PID_FILE: pidFile } });
  const pid = Number(await readFile(pidFile, "utf8"));
  assert.ok(pid > 0);
  try {
    assert.equal(result.killedByTimeout, true);
    // POSIX reaping can happen shortly after the parent closes its pipes.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === "ESRCH") break; throw error; }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { try { process.kill(pid); } catch {} }
});
test("read-only permissions override native inline permissions", async () => {
  const result = await run("inspect-environment", {}, { env: { ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: { "codex-mcp-reader": { permissions: [{ action: "*", resource: "*", effect: "allow" }] } } }),
  } });
  const config = JSON.parse(result.text).config;
  assert.equal(config.permissions, undefined);
  assert.equal(config.agents, undefined);
  assert.equal(config.permission.edit, "deny");
});
test("rejects tasks that would be interpreted as CLI options", async () => {
  assert.equal((await run("--help")).ok, false);
});
test("rejects old sessions before they can override the selected project or permissions", async () => {
  for (const extra of [{ sessionId: "ses_other_project" }, { continueSession: true },
    { readOnly: false, sessionId: "ses_other_project" }, { readOnly: false, continueSession: true }]) {
    const result = await run("inspect-environment", extra);
    assert.equal(result.ok, false);
    assert.match(result.error, /session continuation/i);
  }
});
test("discovers this Node executable through PATH without a shell", async () => {
  const { resolveOpenCodeExecutable } = await runner();
  assert.equal(await resolveOpenCodeExecutable({ PATH: path.dirname(process.execPath) }, {
    commandName: path.basename(process.execPath),
  }), process.execPath);
});
