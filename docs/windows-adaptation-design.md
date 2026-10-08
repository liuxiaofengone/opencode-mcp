# Compatibility and execution design

The bridge retains the upstream stdio MCP `opencode_execute` interface and uses the OpenCode 2 CLI instead of the OpenCode 1 SDK/server protocol.

- Resolve `OPENCODE_BIN` or a native executable from the Windows npm installation, `.opencode/bin`, or PATH.
- Validate cwd before execution and set both cwd and PWD. Do not launch through a shell.
- Default to `--standalone` and a temporary inline JSON reader agent; deny writes, shell, subagents, external directories and network tools.
- Override legacy and native inline permission forms so the dedicated reader's restrictions remain authoritative.
- Create a new session for every call. OpenCode 2.0.22 saved sessions can override the current location and evaluate saved permissions after agent rules.
- Parse bounded UTF-8/NDJSON events across byte boundaries; report structured provider errors even when exit code is zero.
- Cancel the owned process tree when the client cancels, disconnects or reaches a timeout.
- Retain a compact response and Git context without presenting step-finish metadata as an answer.

Live verification was performed on Windows with OpenCode 2.0.22 using a generated temporary fixture and an explicitly selected configured model. The reader could read the fixture and did not expose an edit tool. These OpenCode permissions are not an OS sandbox and do not make untrusted plugins safe.

Relevant OpenCode 2.0.22 source: [session-target.ts](https://github.com/anomalyco/opencode/blob/v2.0.22/packages/cli/src/session-target.ts), [config migration](https://github.com/anomalyco/opencode/blob/v2.0.22/packages/core/src/v1/config/migrate.ts), and [standalone service](https://github.com/anomalyco/opencode/blob/v2.0.22/packages/cli/src/services/standalone.ts).
