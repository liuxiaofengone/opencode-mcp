# OpenCode 2 MCP

[English](README.en.md) · [MIT License](LICENSE) · [更新记录](CHANGELOG.md)

让 Codex 或其他支持 MCP 的客户端调用本机 OpenCode 2，执行项目分析与有明确范围的开发任务。服务使用 stdio，提供一个工具：`opencode_execute`。

本仓库是 [yuriisamohvalov-creator/opencode-mcp](https://github.com/yuriisamohvalov-creator/opencode-mcp) 的公开 fork，保留上游 MIT 版权和提交历史。适配内容包括 Windows 原生程序发现、默认只读权限、输出解析、错误识别及任务清理，详见 [NOTICE](NOTICE.md)。

## 功能

- 默认只读，允许文件读取和搜索，拒绝编辑、Shell、子代理、外部目录和网络工具。
- 默认启动独立 OpenCode 服务器，每次使用新会话，向子进程同步 `cwd` 与 `PWD`。
- 通过 `model` 参数显式选择已配置的 `provider/model`，不绑定某一家模型服务。
- 使用原生可执行文件，不通过 Shell 拼接任务文本，支持含中文和空格的目录。
- 完整解析 UTF-8/NDJSON 分片和没有末尾换行的事件；模型报错和无文本结果会作为失败返回。
- 超时、MCP 取消或断开时结束本次启动的进程树；Windows 使用 `taskkill /T /F`。

## 环境要求

- Node.js 22 或更新版本。
- 本机已安装 OpenCode **2.x**，并已配置可用的模型服务。已对 **2.2.5** 核对实际 CLI 参数和只读代理配置解析；早期 **2.0.22** 曾验证真实模型调用。静态兼容检查不替代你所选模型的短测试。
- 一个支持 stdio MCP 的客户端，例如 Codex。

自动测试使用假 CLI，不需要 OpenCode、模型密钥或网络。跨系统测试由 GitHub Actions 执行，结果见仓库 Actions 页面。

## 从源码安装

Windows PowerShell：

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

Linux/macOS：

```sh
git clone https://github.com/liuxiaofengone/opencode-mcp.git
cd opencode-mcp
git checkout main
npm ci --ignore-scripts
npm test
codex mcp add opencode-v2 -- "$(command -v node)" "$PWD/server.mjs"
```

本 fork 当前通过 GitHub 源码分发。npm 上的 `opencode2-mcp` 是上游包，不能据此安装本 fork 的适配版本。

## 配置客户端

在自己的 Codex `config.toml` 中，为对应服务器补充超时。以下路径只是示例，请改为实际绝对路径：

```toml
[mcp_servers.opencode-v2]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\tool\opencode-mcp\server.mjs']
startup_timeout_sec = 10
tool_timeout_sec = 960
```

默认任务超时为 900 秒，客户端超时需要额外留出清理时间。使用更长的 `timeoutMs` 时同步增大客户端超时。配置完成后重新加载 MCP 连接，必要时重启客户端。[Codex MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

其他 MCP 客户端可使用下列结构，并按其文档配置工具超时：

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

程序会查找 Windows npm 的 `@opencode/cli/bin/opencode.exe`、用户目录中的 `.opencode/bin` 以及 `PATH`。如果没有找到，在 MCP 配置中设置 `OPENCODE_BIN`，指向**原生可执行文件的绝对路径**：

```toml
[mcp_servers.opencode-v2.env]
OPENCODE_BIN = 'C:\path\to\opencode.exe'
```

Windows npm 安装位置通常可用 `Join-Path $env:APPDATA 'npm\node_modules\@opencode\cli\bin\opencode.exe'` 定位。不同安装方式可能不同；本桥接器拒绝 `.cmd`、`.bat`、`.ps1` 包装脚本。TOML 中的路径不会自动展开环境变量。

## 只读项目分析

在 Codex 对话中，可以说：

> 请通过 OpenCode，使用我已配置的 `provider/model` 模型，只读分析当前项目的目录结构和主要入口。跳过依赖、构建产物和敏感配置。

对应工具参数示例：

```json
{
  "task": "只读分析项目的主要目录、技术栈和入口文件。跳过依赖、构建产物及敏感文件，用中文总结。",
  "cwd": "C:\\projects\\example-app",
  "model": "your-provider/your-model",
  "readOnly": true,
  "timeoutMs": 120000
}
```

`cwd` 必须是存在的绝对目录。`model` 必须是 OpenCode 中真实已配置、可用的完整 ID。模型不可用时返回错误，不保证自动替换为其他模型。

## 模型选择与核验

`main` 中的 0.4.0 起要求模型必填；历史标签 `v0.3.0` 不含此校验。每次必须显式传入用户已指定或规则已授权的完整 `provider/model`（可附 `#variant`），原样转换为 CLI 的 `--model`。缺失或格式错误时在启动 CLI 前拒绝，不使用全局默认值、最近模型或免费模型兜底。不确定模型时先询问，不猜测、不自动切换。[OpenCode 模型说明](https://opencode.ai/v2/docs/models/)。

结果中的 `requestedModel` 表明希望使用的模型，不是实际执行证明。要核验执行记录，应根据返回的 `sessionID` 查看 OpenCode 会话及 assistant 消息保存的 provider/model；桥接器当前不会自动读取会话数据库，也不会把请求模型宣称为已核验的实际模型。模型显示名称是标签，可能不同于请求 ID。地区／鉴权等错误须先核对实际模型再归因。

完整的项目调用约束、故障分层和升级步骤见 [委派调用指南](docs/delegation-guide.zh-CN.md)。

## 修改任务

需要编辑或执行命令时，显式设置 `readOnly=false`，并明确任务允许的文件与命令：

```json
{
  "task": "仅修复指定模块的问题，运行已授权的相关测试，最后报告修改与验证结果。",
  "cwd": "/absolute/path/to/example-app",
  "model": "your-provider/your-model",
  "readOnly": false,
  "autoApprove": true,
  "timeoutMs": 300000
}
```

`autoApprove` 默认 `false`；设为 `true` 会添加 `--auto`，允许尚未被 OpenCode 明确拒绝的工具操作。只读模式的显式拒绝仍然有效。修改模式使用 OpenCode 的默认 agent，也可传入已配置的 `agent`。非交互 CLI 无法替用户回答权限提示；请事先确定允许的范围。

## 参数与返回值

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `task` | 必填 | 至少 10 个字符，不能以 `-` 开头 |
| `cwd` | 必填 | 存在的绝对目录 |
| `model` | 必填 | 本次明确授权的完整 `provider/model` ID，可附 `#variant` |
| `readOnly` | `true` | 文件读取/搜索权限 |
| `autoApprove` | `false` | 自动允许未被明确拒绝的操作 |
| `standalone` | `true` | 独立服务器；只读模式必需 |
| `agent` | 未指定 | 修改模式的 agent；只读模式使用专用 reader |
| `timeoutMs` | `900000` | 1000～3600000 毫秒，低于客户端超时 |
| `sessionId` | 未指定 | 暂不支持；传入会报错 |
| `continueSession` | `false` | 必须为 `false` |

OpenCode 2.0.22 的旧会话位置和权限可能覆盖本次目录与 agent。为使本次范围明确，桥接器每次创建新会话，拒绝续接参数。

MCP 返回 JSON，包含 `ok`、`error`、`requestedModel`、`text`、`sessionID`、`exitCode`、`readOnly`、`killedByTimeout`、`cancelled`、`diffStat`、`statusShort` 和 `stderrTail`。模型错误、非零退出、超时、取消、事件行溢出或无文本时返回 `isError=true`。

每条事件最大 100 万字符，文本最多 12000 字符，错误输出保留末尾 4000 字符；截断状态会标记。Git 信息包含任务执行前已有的改动，不代表全部由本次任务产生。`ok=true` 表示进程和输出检查成功，任务质量仍需调用者核验。

## 权限与数据

只读模式通过临时 `OPENCODE_CONFIG_CONTENT` 设置 OpenCode 权限，不修改登录配置。它不是操作系统沙箱；OpenCode 仍会写入自己的日志、会话数据库与可能的快照。使用者负责管理本机插件及不可信配置。

被读取的文件可能发送给所选模型服务。此工具不会自动识别所有密钥文件；任务应排除 `.env`、私钥、凭据及不需要的业务数据。输出中的常见服务器密码和 Bearer 凭据会脱敏，但不保证覆盖所有敏感内容。模型授权和费用由使用者自行管理。

## 测试与贡献

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run
```

真实模型测试是显式选项，可能产生费用。它只读取自动生成的临时 fixture 文件：

```sh
npm run test:live -- your-provider/your-model
```

自动 CI 不运行真实模型测试。贡献前阅读 [CONTRIBUTING](CONTRIBUTING.md)，安全问题按 [SECURITY](SECURITY.md) 处理。

## 常见问题

- 找不到程序：设置 `OPENCODE_BIN`，确认原生执行文件存在。
- `Model unavailable`：检查 OpenCode 配置中的 provider/model，名称不能只用显示标签。
- 网关拒绝请求：检查该网关对 OpenCode 版本与账户的要求；本桥接器不绕过服务限制。
- 提前超时：提高 MCP 客户端超时，确保大于 `timeoutMs` 并留出清理时间。
- 工具不可见：核对 `node`、`server.mjs` 绝对路径和依赖，重新加载 MCP 连接。
- 旧接口名称：本仓库的工具为 `opencode_execute`，不提供旧桥接器的 `opencode.run`。
