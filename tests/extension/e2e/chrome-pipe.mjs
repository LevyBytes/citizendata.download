// A small Chrome DevTools Protocol client over --remote-debugging-pipe.
//
// Chrome only accepts the Extensions.loadUnpacked command on the pipe transport, so the extension end-to-end check
// cannot use the debugging port that the dashboard suites use. No automation package is needed: Chrome reads commands
// on file descriptor 3 and writes replies on file descriptor 4, each message a JSON text ended by a zero byte.
import { spawn } from "node:child_process";
import { ChromePipeConnection } from "./chrome-pipe-connection.mjs";
import { ChromeSession } from "./chrome-session.mjs";

export class ChromePipe extends ChromePipeConnection {
  static async launch({ executable, profile, headless = true, extraArguments = [] }) {
    const browserArguments = [
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-gpu",
      ...(headless ? ["--headless=new"] : []),
      ...extraArguments,
      "about:blank"
    ];
    const child = spawn(executable, browserArguments, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
    const pipe = new ChromePipe(child);
    await pipe.send("Target.setDiscoverTargets", { discover: true });
    return pipe;
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return new ChromeSession(this, sessionId, targetId);
  }

  async newPage(url = "about:blank") {
    const { targetId } = await this.send("Target.createTarget", { url });
    const session = await this.attach(targetId);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    return session;
  }

  async waitForTarget(predicate, timeoutMs = 15000, description = "a matching target") {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = [...this.targets.values()].find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${description}. Targets: ${[...this.targets.values()].map((target) => `${target.type} ${target.url}`).join(" | ")}`);
  }
}
