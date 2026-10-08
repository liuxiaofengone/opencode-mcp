#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runOpenCode } from "./src/runner.mjs";

const server = new McpServer({ name: "opencode-v2-mcp", version: "0.3.0" });
const active = new Set();
const cancelAll = () => { for (const controller of active) controller.abort(); };
server.registerTool("opencode_execute", {
  description: "Run a bounded task in a new session with local OpenCode 2. Defaults to isolated read-only project analysis. Returns text, session ID, exit status and Git context; reports model failures as errors.",
  inputSchema: {
    task: z.string().min(10).describe("Task, scope and expected output. Start with ordinary text, not a CLI option."),
    cwd: z.string().describe("Existing absolute project directory."),
    readOnly: z.boolean().default(true).describe("Allow file reading/search only. Denies edit, shell, external directories and network tools."),
    autoApprove: z.boolean().default(false).describe("Approve tools that are not explicitly denied. Enable only for tasks whose tool actions are authorized."),
    agent: z.string().min(1).optional().describe("Optional OpenCode agent in write mode. Read-only mode always uses an isolated reader agent."),
    model: z.string().min(1).optional().describe("Configured provider/model, e.g. your-provider/your-model. Omitting uses OpenCode's configured default."),
    standalone: z.boolean().default(true).describe("Start a private OpenCode server. Required in read-only mode."),
    timeoutMs: z.number().int().min(1000).max(3600000).default(900000).describe("Task timeout. Keep below the MCP client's tool timeout."),
    sessionId: z.string().min(1).optional().describe("Unsupported: omit this field. Old sessions can override the selected project and current permissions."),
    continueSession: z.boolean().default(false).describe("Must remain false. This bridge creates a new session for each task."),
  },
}, async (input, extra) => {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  extra.signal.addEventListener("abort", cancel, { once: true });
  if (extra.signal.aborted) cancel();
  active.add(controller);
  try {
    const result = await runOpenCode(input, { signal: controller.signal });
    return { isError: !result.ok, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(error.message) }) }] };
  } finally { active.delete(controller); extra.signal.removeEventListener("abort", cancel); }
});

server.server.onclose = cancelAll;
process.on("SIGINT", cancelAll);
process.on("SIGTERM", cancelAll);
process.stdin.on("end", cancelAll);
await server.connect(new StdioServerTransport());
