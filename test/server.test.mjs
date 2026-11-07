import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForPid(filename) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const content = await readFile(filename, "utf8").catch(() => "");
    if (Number(content) > 0) return Number(content);
    await sleep(30);
  }
  throw new Error("Fake CLI did not start its descendant");
}
async function waitForExit(pid) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    await sleep(30);
  }
  throw new Error("MCP cancellation left a live descendant");
}
function payload(response) {
  return JSON.parse(response.content[0].text);
}
async function waitForJob(client, jobId) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const response = await client.callTool({ name: "opencode_status", arguments: { jobId } });
    const status = payload(response);
    if (["completed", "failed", "cancelled"].includes(status.state)) return status;
    await sleep(30);
  }
  throw new Error("Async OpenCode job did not finish");
}

test("MCP exposes a safe default without requiring the author's custom agent", async () => {
  const client = new Client({ name: "opencode-mcp-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((item) => item.name === "opencode_execute");
    assert.ok(tool);
    assert.equal(tool.inputSchema.properties.readOnly?.default, true);
    assert.equal(tool.inputSchema.properties.autoApprove?.default, false);
    assert.notEqual(tool.inputSchema.properties.agent?.default, "claude-worker");
    const failure = await client.callTool({ name: "opencode_execute", arguments: {
      task: "Read and summarize this project", cwd: "relative-directory", model: "fixture/test-model",
    } });
    assert.equal(failure.isError, true);
    assert.match(failure.content[0].text, /absolute/);
  } finally {
    await client.close();
  }
});

test("MCP can start an OpenCode job and poll its final result", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-async-"));
  const fixtureUrl = new URL("./fixtures/cli.mjs", import.meta.url);
  await writeFile(path.join(cwd, "run"), `import(${JSON.stringify(fixtureUrl.href)});\n`);
  const client = new Client({ name: "mcp-async-test", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe",
      env: { ...process.env, OPENCODE_BIN: process.execPath },
    }));
    const started = payload(await client.callTool({ name: "opencode_start", arguments: {
      cwd, task: "fragmented", model: "fixture/test-model", timeoutMs: 5000,
    } }));
    assert.equal(started.state, "running");
    assert.match(started.jobId, /^[0-9a-f-]{36}$/);
    const completed = await waitForJob(client, started.jobId);
    assert.equal(completed.state, "completed");
    assert.equal(completed.result.ok, true);
    assert.equal(completed.result.text, "你好，结果完整");
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("MCP cancellation ends an async job's descendant process", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-async-cancel-"));
  const pidFile = path.join(cwd, "descendant.pid");
  const fixtureUrl = new URL("./fixtures/cli.mjs", import.meta.url);
  await writeFile(path.join(cwd, "run"), `import(${JSON.stringify(fixtureUrl.href)});\n`);
  const client = new Client({ name: "mcp-async-cancel-test", version: "1.0.0" });
  let pid;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe",
      env: { ...process.env, OPENCODE_BIN: process.execPath, TEST_CHILD_PID_FILE: pidFile },
    }));
    const started = payload(await client.callTool({ name: "opencode_start", arguments: {
      cwd, task: "delay-tree", model: "fixture/test-model", timeoutMs: 20000,
    } }));
    pid = await waitForPid(pidFile);
    const cancelled = payload(await client.callTool({ name: "opencode_cancel", arguments: { jobId: started.jobId } }));
    assert.equal(cancelled.state, "cancelling");
    const completed = await waitForJob(client, started.jobId);
    assert.equal(completed.state, "cancelled");
    assert.equal(completed.result.cancelled, true);
    await waitForExit(pid);
  } finally {
    await client.close();
    if (pid) { try { process.kill(pid); } catch {} }
    await rm(cwd, { recursive: true, force: true });
  }
});

test("MCP disconnect ends an async job's descendant process", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-async-disconnect-"));
  const pidFile = path.join(cwd, "descendant.pid");
  const fixtureUrl = new URL("./fixtures/cli.mjs", import.meta.url);
  await writeFile(path.join(cwd, "run"), `import(${JSON.stringify(fixtureUrl.href)});\n`);
  const client = new Client({ name: "mcp-async-disconnect-test", version: "1.0.0" });
  let pid;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe",
      env: { ...process.env, OPENCODE_BIN: process.execPath, TEST_CHILD_PID_FILE: pidFile },
    }));
    const started = payload(await client.callTool({ name: "opencode_start", arguments: {
      cwd, task: "delay-tree", model: "fixture/test-model", timeoutMs: 20000,
    } }));
    assert.equal(started.state, "running");
    pid = await waitForPid(pidFile);
    await client.close();
    await waitForExit(pid);
  } finally {
    await client.close();
    if (pid) { try { process.kill(pid); } catch {} }
    await rm(cwd, { recursive: true, force: true });
  }
});

test("MCP status keeps advancing silence age while a job has no new events", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-async-progress-"));
  const fixtureUrl = new URL("./fixtures/cli.mjs", import.meta.url);
  await writeFile(path.join(cwd, "run"), `import(${JSON.stringify(fixtureUrl.href)});\n`);
  const client = new Client({ name: "mcp-async-progress-test", version: "1.0.0" });
  let jobId;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe",
      env: { ...process.env, OPENCODE_BIN: process.execPath },
    }));
    const started = payload(await client.callTool({ name: "opencode_start", arguments: {
      cwd, task: "progress-delay", model: "fixture/test-model", timeoutMs: 20000,
    } }));
    jobId = started.jobId;
    await sleep(200);
    const first = payload(await client.callTool({ name: "opencode_status", arguments: { jobId } }));
    await sleep(150);
    const second = payload(await client.callTool({ name: "opencode_status", arguments: { jobId } }));
    assert.equal(second.state, "running");
    assert.ok(second.progress.elapsedMs > first.progress.elapsedMs);
    assert.ok(second.progress.lastEventAgeMs > first.progress.lastEventAgeMs);
  } finally {
    if (jobId) {
      await client.callTool({ name: "opencode_cancel", arguments: { jobId } }).catch(() => {});
      await waitForJob(client, jobId).catch(() => {});
    }
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

for (const mode of ["abort", "disconnect"]) {
  test(`MCP ${mode} ends the task's descendant process`, async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-protocol-"));
    const pidFile = path.join(cwd, "descendant.pid");
    const fixtureUrl = new URL("./fixtures/cli.mjs", import.meta.url);
    // Node acts as the native CLI: "node run ..." executes this owned loader.
    await writeFile(path.join(cwd, "run"), `import(${JSON.stringify(fixtureUrl.href)});\n`);
    const client = new Client({ name: "mcp-lifecycle-test", version: "1.0.0" });
    const controller = new AbortController();
    let pid, request;
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe",
        env: { ...process.env, OPENCODE_BIN: process.execPath, TEST_CHILD_PID_FILE: pidFile },
      }));
      request = client.callTool({ name: "opencode_execute", arguments: {
        cwd, task: "delay-tree", model: "fixture/test-model", timeoutMs: 20000,
      } }, undefined, { signal: controller.signal, timeout: 25000 }).catch((error) => error);
      pid = await waitForPid(pidFile);
      if (mode === "abort") controller.abort();
      else await client.close();
      await waitForExit(pid);
    } finally {
      controller.abort();
      await client.close();
      if (pid) { try { process.kill(pid); } catch {} }
      if (request) await request;
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

// A real MCP call with a fake CLI makes accidental model calls impossible.
test("MCP rejects missing model without starting any CLI process", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-model-"));
  const marker = path.join(cwd, "started");
  await writeFile(path.join(cwd, "run"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started"); process.stdout.write(JSON.stringify({type:"text",part:{text:"unexpected default model"}})+"\\n");`);
  const client = new Client({ name: "mcp-model-guard-test", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe",
      env: { ...process.env, OPENCODE_BIN: process.execPath },
    }));
    const response = await client.callTool({ name: "opencode_execute", arguments: {
      cwd, task: "Read this fixture and return one sentence",
    } });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /model/i);
    assert.equal(await readFile(marker).then(() => true, () => false), false);
  } finally { await client.close(); await rm(cwd, { recursive: true, force: true }); }
});
