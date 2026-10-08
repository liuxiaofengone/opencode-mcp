# Contributing

Fork the repository, create a focused branch, install with `npm ci --ignore-scripts`, and run `npm test` before opening a pull request.

- Keep stdout reserved for MCP protocol messages. Diagnostics belong on stderr.
- Keep executable invocation free of shell interpolation, and preserve cancellation/timeout cleanup.
- Add regression coverage for behavior changes, using the fake CLI where possible.
- Do not add provider keys, session databases, local credentials, business files or private paths.
- Keep Chinese and English usage documentation consistent.
- `npm run test:live -- provider/model` is optional, uses your configured provider, and can incur charges. Never run it in automated CI.

The implementation is split into `server.mjs` (MCP/schema/lifecycle), `src/runner.mjs` (execution/permissions/process handling), and `src/events.mjs` (bounded event parsing).

Report reproducible bugs in Issues with Node/OpenCode/OS versions and a redacted minimal example. Review task results independently; Git context is not proof that an agent fulfilled its instructions.
