import { StringDecoder } from "node:string_decoder";

export function createEventParser({ maxLineChars = 1_000_000, maxTextChars = 12_000 } = {}) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let skipping = false;
  let text = "";
  let textOverflow = false;
  let stdoutOverflow = false;
  let sessionID = null;
  let stepFinish = null;
  const errors = [];

  function line(value) {
    let event;
    try { event = JSON.parse(value.trim()); } catch { return; }
    if (!event || typeof event !== "object") return;
    if (typeof event.sessionID === "string") sessionID = event.sessionID;
    if (event.type === "text" && typeof event.part?.text === "string") {
      const separator = text ? "\n" : "";
      const addition = separator + event.part.text;
      const room = Math.max(0, maxTextChars - text.length);
      text += addition.slice(0, room);
      if (addition.length > room) textOverflow = true;
    }
    if (event.type === "step_finish") stepFinish = event.part ?? null;
    if (event.type === "error" && errors.length < 20) {
      const error = event.error;
      const message = typeof error === "string" ? error
        : error?.message ?? error?.data?.message ?? event.message ?? "OpenCode error event";
      errors.push(String(message).slice(0, 4000));
    }
  }
  function consume(value) {
    for (const part of value.split(/(?<=\n)/)) {
      const complete = part.endsWith("\n");
      if (!skipping) {
        if (pending.length + part.length > maxLineChars) {
          stdoutOverflow = true;
          pending = "";
          skipping = true;
        } else pending += part;
      }
      if (complete) {
        if (!skipping) line(pending);
        pending = "";
        skipping = false;
      }
    }
  }
  return {
    write(chunk) { consume(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))); },
    end() { consume(decoder.end()); if (pending && !skipping) line(pending); pending = ""; return this.result(); },
    result() {
      return { text: text.trim() + (textOverflow ? "\n...[text truncated]" : ""),
        sessionID, stepFinish, errors: [...errors], stdoutOverflow, textOverflow };
    },
  };
}
