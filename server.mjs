#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runOpenCode, MODEL_ID_PATTERN, redact } from "./src/runner.mjs";
import { createJobManager } from "./src/jobs.mjs";

const server = new McpServer({ name: "opencode-v2-mcp", version: "0.5.0" });
const active = new Set();
const jobs = createJobManager({ run: runOpenCode, redactError: redact });
const cancelAll = () => { for (const controller of active) controller.abort(); void jobs.cancelAll(); };
const executionInputSchema = {
  task: z.string().min(10).describe("Task, scope and expected output. Start with ordinary text, not a CLI option."),
  cwd: z.string().describe("Existing absolute project directory."),
  readOnly: z.boolean().default(true).describe("Allow file reading/search only. Denies edit, shell, external directories and network tools."),
  autoApprove: z.boolean().default(false).describe("Approve tools that are not explicitly denied. Enable only for tasks whose tool actions are authorized."),
  agent: z.string().min(1).optional().describe("Optional OpenCode agent in write mode. Read-only mode always uses an isolated reader agent."),
  model: z.string().regex(MODEL_ID_PATTERN, "Use a complete provider/model ID without whitespace").describe("REQUIRED for each delegation: configured provider/model, optionally #variant. Use an explicitly authorized ID; ask if unspecified. No automatic model selection or fallback."),
  standalone: z.boolean().default(true).describe("Start a private OpenCode server. Required in read-only mode."),
  timeoutMs: z.number().int().min(1000).max(3600000).default(900000).describe("OpenCode process timeout, independent of the MCP request timeout."),
  sessionId: z.string().min(1).optional().describe("Unsupported: omit this field. Old sessions can override the selected project and current permissions."),
  continueSession: z.boolean().default(false).describe("Must remain false. This bridge creates a new session for each task."),
};
server.registerTool("opencode_execute", {
  description: "Run a bounded task in a new session with local OpenCode 2. An explicit provider/model is REQUIRED for every task; never infer a model or rely on CLI defaults. Defaults to isolated read-only project analysis. Returns the requested model (not independently verified), text, session ID, exit status and Git context; reports model failures as errors.",
  inputSchema: executionInputSchema,
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
server.registerTool("opencode_start", {
  description: "Start an OpenCode task in the background and immediately return a job ID. Poll opencode_status; do not start a duplicate task while the job is running.",
  inputSchema: executionInputSchema,
}, async (input) => {
  const result = jobs.start(input);
  return { isError: !result.ok, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
server.registerTool("opencode_status", {
  description: "Read the progress or terminal result of an OpenCode background job.",
  inputSchema: { jobId: z.string().uuid() },
}, async ({ jobId }) => {
  const result = jobs.status(jobId);
  return { isError: !result.ok, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
server.registerTool("opencode_cancel", {
  description: "Cancel one OpenCode background job and its owned local process tree. Poll status until the job reaches cancelled.",
  inputSchema: { jobId: z.string().uuid() },
}, async ({ jobId }) => {
  const result = jobs.cancel(jobId);
  return { isError: !result.ok, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.server.onclose = cancelAll;
process.on("SIGINT", cancelAll);
process.on("SIGTERM", cancelAll);
process.stdin.on("end", cancelAll);
await server.connect(new StdioServerTransport());
