# Changelog

## 0.5.0 — 2026-11-07

- Add `opencode_start`, `opencode_status` and `opencode_cancel` for long tasks that must outlive one MCP request timeout.
- Keep asynchronous work in one new OpenCode session and reject duplicate background work above four active jobs.
- Retain at most 50 terminal job results in the MCP process and cancel owned process trees when the bridge disconnects.
- Report event count, completed tool count, last event type, elapsed time and silence age on synchronous and asynchronous results.
- Recheck CLI flags and session export syntax against OpenCode V2 2.2.6.

## 0.4.0 — 2026-11-06

**Breaking change:** `model` is now required on every call. Existing clients must pass an explicitly authorized model ID and reload their MCP connection. The `v0.3.0` tag retains its original behavior.

- Require an explicitly authorized `model` on every MCP call; reject missing or malformed IDs before launching the CLI instead of using implicit catalog defaults.
- Accept current V2 `provider/model#variant` syntax, including multi-segment model paths, and return `requestedModel` without claiming independent verification.
- Add regression checks for the no-model/no-spawn boundary and exact model forwarding. Recheck CLI flags and reader-config parsing against OpenCode V2 2.2.5.

## 0.3.0 — 2026-10-08

- Discover native OpenCode executables on Windows and through PATH; support `OPENCODE_BIN`.
- Synchronize cwd/PWD and launch without a shell.
- Default to a private standalone server with read/search permissions.
- Forward an explicit configured `provider/model` through `--model`.
- Buffer UTF-8/NDJSON across chunks and consume final lines without a newline.
- Treat provider errors, nonzero exits, overflow, cancellation, timeout and missing text as failures.
- Terminate the owned process tree on timeout, MCP cancellation or disconnect.
- Redact common printed credentials from returned text.
- Add regression tests, cross-platform CI, Chinese/English documentation and source-install instructions.
- Preserve upstream attribution and MIT license.

### Changes from upstream 0.2.0

- `readOnly=true`, `standalone=true` and `autoApprove=false` are the defaults.
- Write tasks require `readOnly=false`; automatic approval additionally requires `autoApprove=true`.
- A project-specific `claude-worker` agent is no longer required.
- Session continuation is rejected to prevent saved directories/permissions from overriding the current task.
- Supported Node.js baseline is 22+.

The upstream npm package is not a distribution of this fork. Install this version from GitHub source.
