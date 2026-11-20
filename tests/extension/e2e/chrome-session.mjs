// One attached target of the browser, a page or a worker, addressed through the pipe by its session.
export class ChromeSession {
  constructor(pipe, sessionId, targetId) {
    this.pipe = pipe;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params = {}, timeoutMs = 30000) {
    return this.pipe.send(method, params, this.sessionId, timeoutMs);
  }

  async evaluate(expression, timeoutMs = 30000) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (response.exceptionDetails) throw new Error(`Evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
    return response.result.value;
  }

  async waitFor(expression, timeoutMs = 15000, description = expression) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for: ${description}${lastError ? ` (${lastError.message})` : ""}`);
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
  }

  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  }

  async close() {
    await this.pipe.send("Target.closeTarget", { targetId: this.targetId }).catch(() => {});
  }
}
