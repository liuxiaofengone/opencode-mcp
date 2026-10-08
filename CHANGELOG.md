# Changelog

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
