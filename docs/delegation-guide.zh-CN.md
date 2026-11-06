# OpenCode MCP 调用规则与快速指南

日期：2026-11-06。基于 OpenCode V2 CLI 2.2.5 核验，适用于本桥接器 0.4.0 的 `opencode-v2` MCP。

此文件可供业务项目合并到 `AGENTS.md` 与开发 Quickstart。合并时 OpenCode 专门约束应覆盖通用条款中允许省略模型的例外，保留项目的执行者顺序、写入所有权、暂停和验收规则。

## 可并入 AGENTS.md 的约束

1. **每次明确模型**：每次 `opencode_execute` 必须传入完整 `model`，来源为用户本次指定或该任务已明确授权的 ID。格式为 `provider/model`，可带 `#variant`，模型部分可以含 `/`。没有明确 ID 时先询问，不从默认值、最近选择、模型显示名或免费模型清单中猜测。错误后不得自行切换模型。
2. **核对实际能力**：CLI 更新或连接异常后核对当前版本、`run --help` 与 MCP 的真实 schema。使用 `opencode models` 可查当前项目的模型目录；目录中存在不等于鉴权、地区、额度及推理成功。不要每个正常任务都重装或跑模型探针。
3. **范围与权限**：只读分析显式 `readOnly:true`；实现任务显式 `readOnly:false`。仅对已有授权的工具动作设置 `autoApprove:true`；`--auto` 不会覆盖显式 deny。只读是 OpenCode 权限配置，不是 OS 沙箱。项目对 computer-use/browser-use 等能力的限制须传给执行者，不能通过委派扩大授权。
4. **固定执行身份**：传入已存在的绝对 `cwd`，记录仓库、分支、完整基线 SHA、已有修改、允许文件、禁止资源、验证和交接要求。涉及 SSH 或云端时额外记录远端身份与进程证据；本机 Git 信息不证明远端无改动。每轮只允许一个执行者拥有重叠文件的写入权。
5. **限定任务与超时**：当前 MCP 只有同步 `opencode_execute`，不是可持久跟踪的异步 job 服务。任务 `timeoutMs` 应低于宿主工具超时并留出清理余量；宿主超时不等于任务失败或已停止，不重复派发或自动接管未知执行。
6. **模型证据**：记录本次输入 `model` 与结果 `requestedModel`、`sessionID`、`ok`、`exitCode` 和错误。`requestedModel` 仅是 CLI 请求意图。出现地区／鉴权／模型不可用等错误或需要严格验收时，按该 `sessionID` 核对实际 assistant 消息的 provider/model；不能把错误直接归因于原本想用的模型，更不能把模型自述当作证据。
7. **交付与停止**：`ok:true` 不是业务完成证明，须独立检查真实 diff、未跟踪文件和验证结果。取消、超时及断连会请求清理本任务的本机进程树；不能据此证明 SSH/CNB 的远端进程终止。执行未确认终止前不换写入者。用户暂停时仅停止、回读和取证，不恢复业务或自动回退。
8. **新会话与归档边界**：当前桥接器每次新建会话，拒绝 `sessionId`/`continueSession`。这是桥接设计限制；CLI 2.2.5 本身支持 `--session`、`--continue`、`--fork`，不可声称 CLI 不支持续接。当前 MCP 没有 close/archive 工具；该版 `session --help` 列出 list/delete/export/import，不能把 delete 当成归档或为了收尾删除证据。

## 工具调用示例

`model` 必须替换为本次已明确授权的真实 ID，不能照抄占位符执行。

```json
{
  "cwd": "/absolute/path/to/task-worktree",
  "model": "authorized-provider/authorized-model#authorized-variant",
  "readOnly": true,
  "autoApprove": false,
  "standalone": true,
  "timeoutMs": 120000,
  "task": "只读核查指定目录，跳过凭据、依赖和构建产物；不得使用 UI 自动化。按范围报告实际发现、证据和未验证项，不修改文件。"
}
```

实现任务须另列允许修改文件、验证命令和明确授权，不能只将 `readOnly` 改成 false 后下发空泛任务。

## 故障判定顺序

| 边界 | 观察 | 结论范围 |
| --- | --- | --- |
| Schema / runner | 缺少 model 被拒绝，未启动 CLI | 参数问题；先明确模型，不重试默认值 |
| CLI | 原生可执行文件／版本／参数失败 | 启动或版本兼容问题；核对当版 help |
| 模型路由 | 实际 assistant provider/model 与预期不同 | 模型选择问题；先核对参数、配置与会话记录 |
| 提供商 | 确认实际模型后仍返回地区／401／429 等 | 该路由的可用性或鉴权问题；不自动换模型 |
| 代理工具 | 明确权限拒绝／依赖或执行环境缺失 | 任务权限或环境问题；模型通了不等于工具可用 |
| 宿主等待 | tools/call 超时但无终局证据 | 结果未知；先核对本轮执行与实际改动 |

## 升级与验收

- 从本仓库 `main` 获取 0.4.0 源码；历史 `v0.3.0` 不含模型必填修复。已有本地修改时先保留它们，再按自己的 Git 工作流更新；不要用强制重置覆盖。
- 现有聊天可能持有旧 MCP 进程和旧工具 Schema。重新连接 MCP 或新开 Codex 对话后，确认 `listTools` 的 `required` 包含 `model`，不要只凭文件已修改断言已热更新。
- 自动测试使用假 CLI；静态 CLI 检查不发模型请求。真实 smoke 必须先给出本次明确模型与允许发送的测试文本，另行验证推理、读写权限和任务交付。

参考：[V2 CLI](https://opencode.ai/v2/docs/cli/)、[模型选择](https://opencode.ai/v2/docs/models/)、[当前配置 Schema](https://opencode.ai/config.json)、[V2 2.2.5 发布](https://github.com/anomalyco/opencode/releases/tag/v2.2.5)。

## 模型地区错误的归因

如果调用没有指定模型，CLI 的默认选择可能与用户预期不同，最终由另一模型返回地区或鉴权错误。此时应先核对该次 assistant 消息保存的 provider/model，不能仅凭错误正文判断预期模型不可用。0.4.0 的双层必填校验消除桥接器省略 `--model` 的路径；它不证明上游代理服务的最终模型身份，也不会自动读取会话数据库验证执行。
