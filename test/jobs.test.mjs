import test from "node:test";
import assert from "node:assert/strict";
import { createJobManager } from "../src/jobs.mjs";

test("job manager rejects work above its active limit and permits work after completion", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const manager = createJobManager({ maxActive: 1, run: () => held });
  const first = manager.start({ cwd: "C:/project", model: "fixture/model" });
  assert.equal(first.state, "running");
  const rejected = manager.start({ cwd: "C:/project", model: "fixture/model" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "JOB_LIMIT_REACHED");
  release({ ok: true, text: "done" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status(first.jobId).state, "completed");
  assert.equal(manager.start({ cwd: "C:/project", model: "fixture/model" }).state, "running");
});

test("job manager returns a bounded not-found result for unknown IDs", () => {
  const manager = createJobManager({ run: async () => ({ ok: true }) });
  const status = manager.status("00000000-0000-4000-8000-000000000000");
  assert.deepEqual(status, { ok: false, errorCode: "JOB_NOT_FOUND",
    error: "OpenCode job not found", jobId: "00000000-0000-4000-8000-000000000000" });
});

test("failed jobs expose a failed terminal progress phase without runner progress", async () => {
  const manager = createJobManager({ run: async () => ({ ok: false, error: "invalid input" }) });
  const started = manager.start({ cwd: "C:/project", model: "fixture/model" });
  await new Promise((resolve) => setImmediate(resolve));
  const failed = manager.status(started.jobId);
  assert.equal(failed.state, "failed");
  assert.equal(failed.progress.phase, "failed");
});

test("cancelAll waits until every active runner reaches a terminal result", async () => {
  let aborted = false;
  const manager = createJobManager({ run: (_input, { signal }) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      setTimeout(() => { aborted = true; resolve({ ok: false, cancelled: true }); }, 20);
    }, { once: true });
  }) });
  const started = manager.start({ cwd: "C:/project", model: "fixture/model" });
  await new Promise((resolve) => setImmediate(resolve));
  await manager.cancelAll();
  assert.equal(aborted, true);
  assert.equal(manager.status(started.jobId).state, "cancelled");
});

test("cancelling jobs expose a matching progress phase", () => {
  const manager = createJobManager({ run: () => new Promise(() => {}) });
  const started = manager.start({ cwd: "C:/project", model: "fixture/model" });
  const cancelling = manager.cancel(started.jobId);
  assert.equal(cancelling.state, "cancelling");
  assert.equal(cancelling.progress.phase, "cancelling");
});

test("unexpected runner failures are sanitized before exposure", async () => {
  const manager = createJobManager({
    run: async () => { throw new Error("Bearer EXAMPLE_SECRET"); },
    redactError: (value) => String(value).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]"),
  });
  const started = manager.start({ cwd: "C:/project", model: "fixture/model" });
  await new Promise((resolve) => setImmediate(resolve));
  const failed = manager.status(started.jobId);
  assert.equal(failed.state, "failed");
  assert.equal(failed.result.error, "Bearer [REDACTED]");
  assert.ok(!JSON.stringify(failed).includes("EXAMPLE_SECRET"));
});

test("job manager prunes the oldest terminal results", async () => {
  const manager = createJobManager({ maxRetained: 2, run: async () => ({ ok: true }) });
  const first = manager.start({ cwd: "C:/project", model: "fixture/model" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = manager.start({ cwd: "C:/project", model: "fixture/model" });
  await new Promise((resolve) => setImmediate(resolve));
  const third = manager.start({ cwd: "C:/project", model: "fixture/model" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status(first.jobId).errorCode, "JOB_NOT_FOUND");
  assert.equal(manager.status(second.jobId).state, "completed");
  assert.equal(manager.status(third.jobId).state, "completed");
});
