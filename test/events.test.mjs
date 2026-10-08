import test from "node:test";
import assert from "node:assert/strict";

async function parser() {
  const module = await import("../src/events.mjs").catch(() => null);
  assert.ok(module?.createEventParser, "Missing NDJSON event parser");
  return module.createEventParser();
}

test("preserves split UTF-8 bytes and a final JSON line without newline", async () => {
  const stream = await parser();
  const bytes = Buffer.from(JSON.stringify({ type: "text", sessionID: "ses_test", part: { text: "中文结果" } }));
  for (const byte of bytes) stream.write(Buffer.from([byte]));
  const result = stream.end();
  assert.equal(result.text, "中文结果");
  assert.equal(result.sessionID, "ses_test");
});

test("extracts provider errors even if ordinary log lines surround events", async () => {
  const stream = await parser();
  stream.write(Buffer.from('log line\n{"type":"error","error":{"type":"provider.no-route","message":"Model unavailable"}}\n'));
  assert.deepEqual(stream.end().errors, ["Model unavailable"]);
});

test("bounds oversized lines and reports overflow instead of silently losing results", async () => {
  const module = await import("../src/events.mjs").catch(() => null);
  assert.ok(module?.createEventParser, "Missing NDJSON event parser");
  const stream = module.createEventParser({ maxLineChars: 32 });
  stream.write(Buffer.from("x".repeat(80) + '\n{"type":"text","part":{"text":"OK"}}\n'));
  const result = stream.end();
  assert.equal(result.stdoutOverflow, true);
});
