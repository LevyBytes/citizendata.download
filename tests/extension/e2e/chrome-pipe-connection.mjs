// The connection to Chrome over its debugging pipe: commands out, replies and events in, each message a JSON text
// ended by a zero byte.
import { STARTUP_LOG_CHARACTERS } from "../../support/chromegpustartevidence.mjs";
import { diagnoseBrowser } from "./chromepipediagnosis.mjs";

export class ChromePipeConnection {
  constructor(child) {
    this.child = child;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.targets = new Map();
    this.stderr = "";
    this.closed = false;
    // The exit code, or null when the program could not be started at all.
    this.exited = new Promise((resolve) => {
      child.once("exit", (exitCode) => resolve(exitCode));
      child.once("error", () => resolve(null));
    });
    child.stderr.setEncoding("utf8");
    // The end of the browser's standard error, as much as a failed start keeps (tests/support/chromegpustartevidence.mjs).
    child.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-STARTUP_LOG_CHARACTERS); });
    let buffered = Buffer.alloc(0);
    child.stdio[4].on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (let end = buffered.indexOf(0); end >= 0; end = buffered.indexOf(0)) {
        const message = JSON.parse(buffered.subarray(0, end).toString("utf8"));
        buffered = buffered.subarray(end + 1);
        this.#dispatch(message);
      }
    });
    child.on("exit", (exitCode) => {
      this.closed = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(Object.assign(new Error(`Chrome exited with ${exitCode} before answering ${request.method}.\n${this.stderr}`), { exitCode }));
      }
      this.pending.clear();
    });
  }

  #dispatch(message) {
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
      return;
    }
    if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") this.targets.set(message.params.targetInfo.targetId, message.params.targetInfo);
    if (message.method === "Target.targetDestroyed") this.targets.delete(message.params.targetId);
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`Chrome is closed; ${method} was not sent.`));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome did not answer ${method} within ${timeoutMs} ms.\n${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  // Calls the handler for every protocol event until the returned function is called.
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // What the browser can still tell about a command it left unanswered (chromepipediagnosis.mjs).
  diagnose() {
    return diagnoseBrowser(this);
  }

  kill() {
    if (!this.closed) this.child.kill();
    return this.exited;
  }

  async close() {
    if (this.closed) return;
    const exited = new Promise((resolve) => this.child.once("exit", resolve));
    try {
      await this.send("Browser.close", {}, undefined, 5000);
    } catch {
      this.child.kill();
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (!this.closed) this.child.kill();
  }
}
