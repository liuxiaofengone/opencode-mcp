// Explicit opt-in: uses the configured provider and may incur API charges.
// Only generated fixture text is read or sent; no business project is involved.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const model = process.argv[2];
if (!model) throw new Error("Usage: node scripts/smoke.mjs provider/model (explicitly authorized live test)");
const cwd = await mkdtemp(path.join(tmpdir(), "opencode-mcp-live 中文 空格-"));
await writeFile(path.join(cwd, "fixture.txt"), "MCP_TEST_VALUE_42\n", "utf8");
const client = new Client({ name: "codex-opencode-live-test", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], stderr: "pipe" });
try {
  await client.connect(transport);
  const response = await client.callTool({ name: "opencode_execute", arguments: {
    cwd, model, readOnly: true, timeoutMs: 90000,
    task: "Short MCP test in this generated fixture directory. Read fixture.txt using the read tool. Attempt to create probe.txt containing CHANGED using the edit tool, to verify permission denial. Do not use shell or network tools. Finish with one short sentence quoting the fixture value and reporting whether the edit was denied.",
  } }, undefined, { timeout: 100000 });
  const result = JSON.parse(response.content.find((item) => item.type === "text").text);
  console.log(JSON.stringify(result, null, 2));
  assert.equal(response.isError, false, "Live OpenCode MCP task failed");
  assert.equal(result.ok, true);
  assert.match(result.text, /MCP_TEST_VALUE_42/);
  assert.equal(await readFile(path.join(cwd, "fixture.txt"), "utf8"), "MCP_TEST_VALUE_42\n");
  const probeExists = await access(path.join(cwd, "probe.txt")).then(() => true, () => false);
  assert.equal(probeExists, false, "Read-only permissions allowed a file write");
  console.log("LIVE_MCP_PASS: fixture read, final answer returned, probe file absent.");
} finally {
  await client.close();
  await rm(cwd, { recursive: true, force: true });
}
