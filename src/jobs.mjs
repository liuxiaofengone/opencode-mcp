import { randomUUID } from "node:crypto";

export function createJobManager({ run, maxActive = 4, maxRetained = 50,
  redactError = (value) => String(value) } = {}) {
  if (typeof run !== "function") throw new TypeError("run is required");
  if (typeof redactError !== "function") throw new TypeError("redactError must be a function");
  const jobs = new Map();

  function publicJob(job) {
    if (!job) return null;
    const now = Date.now();
    const liveProgress = job.result ? job.progress : { ...job.progress,
      elapsedMs: now - Date.parse(job.startedAt),
      lastEventAgeMs: job.progress.lastEventAt === null ? null : now - job.progress.lastEventAt };
    return { ok: true, jobId: job.jobId, state: job.state, startedAt: job.startedAt,
      updatedAt: job.updatedAt, requestedModel: job.requestedModel, cwd: job.cwd,
      progress: liveProgress, ...(job.result ? { result: job.result } : {}) };
  }
  function prune() {
    const terminal = [...jobs.values()].filter((job) => job.result)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    while (terminal.length > maxRetained) jobs.delete(terminal.shift().jobId);
  }
  function start(input) {
    const activeCount = [...jobs.values()].filter((job) => !job.result).length;
    if (activeCount >= maxActive) {
      return { ok: false, errorCode: "JOB_LIMIT_REACHED",
        error: `OpenCode async job limit reached (${maxActive})` };
    }
    const now = new Date().toISOString();
    const controller = new AbortController();
    const job = { jobId: randomUUID(), state: "running", startedAt: now, updatedAt: now,
      requestedModel: input.model, cwd: input.cwd, progress: { phase: "starting",
        eventCount: 0, completedToolCount: 0, lastEventType: null, lastEventAt: null,
        elapsedMs: 0, lastEventAgeMs: null }, controller, result: null };
    jobs.set(job.jobId, job);
    job.promise = Promise.resolve().then(() => run(input, { signal: controller.signal,
      onProgress(progress) {
        job.progress = { phase: progress.lastEventType ? "receiving_events" : "waiting_for_first_event", ...progress };
        job.updatedAt = new Date().toISOString();
      },
    })).then((result) => {
      job.result = result;
      job.state = result.cancelled ? "cancelled" : result.ok ? "completed" : "failed";
      job.progress = { ...(result.progress ?? job.progress), phase: job.state };
      job.updatedAt = new Date().toISOString();
      prune();
    }, (error) => {
      job.result = { ok: false, error: redactError(error?.message ?? error), errorCode: "JOB_RUNNER_ERROR" };
      job.state = "failed";
      job.progress = { ...job.progress, phase: "failed" };
      job.updatedAt = new Date().toISOString();
      prune();
    });
    return publicJob(job);
  }
  function status(jobId) {
    const job = jobs.get(jobId);
    return job ? publicJob(job) : { ok: false, errorCode: "JOB_NOT_FOUND", error: "OpenCode job not found", jobId };
  }
  function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job) return { ok: false, errorCode: "JOB_NOT_FOUND", error: "OpenCode job not found", jobId };
    if (!job.result) {
      job.state = "cancelling";
      job.progress = { ...job.progress, phase: "cancelling" };
      job.updatedAt = new Date().toISOString();
      job.controller.abort();
    }
    return publicJob(job);
  }
  async function cancelAll() {
    const active = [...jobs.values()].filter((job) => !job.result);
    for (const job of active) job.controller.abort();
    await Promise.allSettled(active.map((job) => job.promise));
  }
  return { start, status, cancel, cancelAll };
}
