# OpenCode 2 MCP

[中文](README.md) · [MIT License](LICENSE) · [Changelog](CHANGELOG.md)

A stdio MCP bridge that lets Codex and other MCP clients run bounded tasks through a local OpenCode 2 installation. It supports synchronous execution and pollable background jobs.

This is a public fork of [yuriisamohvalov-creator/opencode-mcp](https://github.com/yuriisamohvalov-creator/opencode-mcp). It preserves the upstream MIT license and history, adding native Windows executable discovery, read-only defaults, robust event parsing, error handling and process cleanup. See [NOTICE.md](NOTICE.md).

## Requirements

- Node.js 22 or newer.
- An installed OpenCode **2.x** CLI and a configured, available model. CLI flags, session export syntax and reader-config parsing were checked against **2.2.6**; earlier live calls were verified on **2.0.22**. Static compatibility checks do not replace a smoke test with your selected model.
- An MCP client with stdio support, such as Codex.

Automated tests use a fake CLI and require no model credentials, OpenCode installation or network. GitHub Actions runs a Windows/Linux/macOS matrix on Node 22 and 24; check Actions for current results.

## Install from source

PowerShell:

```powershell
git clone https://github.com/liuxiaofengone/opencode-mcp.git C:\tool\opencode-mcp
Set-Location C:\tool\opencode-mcp
git checkout main
npm ci --ignore-scripts
npm test
$nodeExe = (Get-Command node).Source
$serverScript = (Resolve-Path .\server.mjs).Path
codex mcp add opencode-v2 -- $nodeExe $serverScript
```

Linux/macOS:

```sh
git clone https://github.com/liuxiaofengone/opencode-mcp.git
cd opencode-mcp
git checkout main
npm ci --ignore-scripts
npm test
codex mcp add opencode-v2 -- "$(command -v node)" "$PWD/server.mjs"
```

This fork is distributed through GitHub source. The npm `opencode2-mcp` package belongs to the upstream project and does not install this fork's changes.

## MCP configuration

Add timeout settings to the corresponding server in your Codex `config.toml`. Replace example paths with your actual absolute paths:

```toml
[mcp_servers.opencode-v2]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\tool\opencode-mcp\server.mjs']
startup_timeout_sec = 10
tool_timeout_sec = 960
```

The OpenCode process timeout defaults to 900 seconds. Use synchronous `opencode_execute` for short tasks. Use the asynchronous tools for long tasks so one MCP request timeout does not become the task deadline. Reload the MCP connection or restart the client after configuration. [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Other clients can use a standard configuration like:

```json
{
  "mcpServers": {
    "opencode-v2": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\tool\\opencode-mcp\\server.mjs"]
    }
  }
}
```

The bridge searches the Windows npm `@opencode/cli/bin/opencode.exe` location, the user's `.opencode/bin`, and `PATH`. If discovery fails, configure an absolute **native executable** path:

```toml
[mcp_servers.opencode-v2.env]
OPENCODE_BIN = 'C:\path\to\opencode.exe'
```

For a Windows npm installation, try `Join-Path $env:APPDATA 'npm\node_modules\@opencode\cli\bin\opencode.exe'`. Installation methods differ. `.cmd`, `.bat` and `.ps1` wrappers are rejected; TOML paths do not expand environment variables. Tasks are passed as arguments without a shell.

## Read-only analysis and model selection

```json
{
  "task": "Read the main directories and entry files. Summarize the architecture; skip dependencies, generated output and sensitive files.",
  "cwd": "/absolute/path/to/example-app",
  "model": "your-provider/your-model",
  "readOnly": true,
  "timeoutMs": 120000
}
```

`cwd` must exist and be absolute. Both process cwd and `PWD` are set. A private standalone server uses a temporary reader agent that permits read/search and denies edits, shell, subagents, external directories, network and other tools.

Version 0.4.0 on `main` requires explicit model selection; the historical `v0.3.0` tag does not enforce this. Every call now requires a complete, explicitly authorized `provider/model` ID, optionally with `#variant`. It is forwarded unchanged as `--model`. Missing or malformed values are rejected before CLI startup. Global defaults, recent choices and free-model fallbacks are not used by the bridge. Ask for the intended ID if it has not been authorized; never guess or switch after an error. [OpenCode model documentation](https://opencode.ai/v2/docs/models/).

The returned `requestedModel` identifies intent, not verified execution. With OpenCode 2.2.6, run `opencode session export --sanitize <sessionID>` and inspect the assistant message's `providerID`, model `id` and `variant`. This bridge does not automatically query the session database or claim a requested model was independently verified. A model's display label may differ from its request ID. Check the actual model before attributing region or authorization errors to the intended provider.

See the [delegation guide (Chinese)](docs/delegation-guide.zh-CN.md) for consuming-project rules, failure triage and upgrade checks.

## Write tasks

Set `readOnly=false` explicitly for authorized edits and command execution:

```json
{
  "task": "Fix only the specified module, run the authorized tests, and report the changes and verification results.",
  "cwd": "/absolute/path/to/example-app",
  "model": "your-provider/your-model",
  "readOnly": false,
  "autoApprove": true,
  "timeoutMs": 300000
}
```

`autoApprove` defaults to `false`. When enabled it adds `--auto`, allowing actions not explicitly denied by OpenCode. Explicit read-only denials remain effective. Write mode uses the configured default agent unless `agent` is supplied. A noninteractive CLI cannot answer permission prompts; define the allowed task scope before execution.

## Parameters and result

Use `opencode_execute` for short work. For work that may exceed the host's single-call timeout, call `opencode_start`, poll `opencode_status` until a terminal state, and call `opencode_cancel` only when the task must stop. The server permits four active background jobs and retains up to 50 terminal results. Jobs are in-memory and disappear when the MCP process restarts; disconnecting cancels active jobs. Do not start duplicate work while a job's state is unknown.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `task` | Required | At least 10 characters; cannot start with `-` |
| `cwd` | Required | Existing absolute directory |
| `model` | Required | Explicitly authorized `provider/model`, optionally `#variant` |
| `readOnly` | `true` | Read/search permissions |
| `autoApprove` | `false` | Approve actions not explicitly denied |
| `standalone` | `true` | Private server; required in read-only mode |
| `agent` | Unspecified | Write-mode agent; read mode uses a dedicated reader |
| `timeoutMs` | `900000` | OpenCode process deadline, 1000–3600000 ms |
| `sessionId` | Unspecified | Unsupported; supplying it returns an error |
| `continueSession` | `false` | Must remain `false` |

Each call creates a new session. OpenCode 2.0.22 can resume with a previous session's directory and permissions, overriding the requested scope, so continuation is rejected.

The JSON report includes `ok`, `error`, `requestedModel`, `text`, `sessionID`, `exitCode`, `readOnly`, timeout/cancellation flags, Git context, `stderrTail` and `progress`. Progress reports event count, completed tool count, last event type, elapsed time and silence age. Provider errors, nonzero exits, timeout, cancellation, event overflow or no text yield MCP `isError=true`. UTF-8/NDJSON is buffered across chunks and final lines need no trailing newline.

Limits: one million characters per event line, 12000 response-text characters, and a 4000-character stderr tail. Truncation is marked. Git status includes pre-existing changes. `ok=true` confirms process/output checks, not task quality; callers must review results independently. Timeout and cancellation terminate the owned process tree, using `taskkill /T /F` on Windows.

## Permissions and data

Read-only settings are temporary `OPENCODE_CONFIG_CONTENT` permissions, not an OS sandbox. OpenCode still writes its logs, session database and possible snapshots. Users manage local plugins and untrusted configuration.

Files read by OpenCode may be sent to the selected model provider. The tool does not automatically detect every secret; explicitly exclude credentials, private keys and unnecessary business data. Common server passwords and Bearer credentials are redacted from returned text, but redaction is not exhaustive. Users manage provider authorization and costs.

## Tests and contributions

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run
```

A live test is opt-in and may incur API costs. It reads only a generated temporary fixture:

```sh
npm run test:live -- your-provider/your-model
```

CI never runs the live test. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [compatibility notes](docs/windows-adaptation-design.md).
