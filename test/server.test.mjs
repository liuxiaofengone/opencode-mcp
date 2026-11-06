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
