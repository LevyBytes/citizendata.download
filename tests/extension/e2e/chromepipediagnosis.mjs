// What a browser that left a command unanswered can still tell, asked over its debugging pipe (chrome-pipe-connection.mjs):
// whether it answers a browser command, its targets, and its processes. Each question is given five seconds, and an
// unanswered question is reported as such.
export async function diagnoseBrowser(connection) {
  const ask = (method) => connection.send(method, {}, undefined, 5000).then((result) => result, (error) => ({ unanswered: error.message.split("\n")[0] }));
  const version = await ask("Browser.getVersion");
  const targets = await ask("Target.getTargets");
  const processes = await ask("SystemInfo.getProcessInfo");
  return {
    browser: version.product ?? version,
    targets: Array.isArray(targets.targetInfos) ? targets.targetInfos.map((target) => `${target.type} ${target.url} attached:${target.attached}`) : targets,
    processes: Array.isArray(processes.processInfo) ? processes.processInfo.map((process) => process.type) : processes
  };
}
