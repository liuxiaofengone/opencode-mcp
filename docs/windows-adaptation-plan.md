# Validation guide

Run `npm ci --ignore-scripts` and `npm test` with Node.js 22 or newer. Tests use generated temporary directories and a fake CLI; they do not call a model provider.

Coverage includes UTF-8 byte fragmentation, missing final newlines, error events, bounded output, Unicode cwd, read-only permissions, opt-in auto approval, invalid paths, spawn failures, missing text, timeout/cancellation, descendant process cleanup, unsupported session continuation and MCP tool registration/error responses.

GitHub Actions runs the suite on Windows, Linux and macOS with Node 22 and 24. CI status is reported by Actions; a matrix definition alone is not evidence of a successful run.

Before publishing changes:

1. Run `npm test`, JavaScript syntax checks and `git diff --check`.
2. Run `npm pack --dry-run` and verify the executable modules are included.
3. Inspect the staged files for secrets, personal paths and unrelated project content.
4. Preserve upstream license/attribution and review behavior changes independently.

A live test is separate and explicitly opt-in: `npm run test:live -- provider/model`. It reads a generated fixture, checks that a probe write did not occur, and removes that temporary directory. Provider credentials remain local; CI must not run this test.
