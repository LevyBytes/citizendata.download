// The globals one worker instance runs with, besides `chrome`.
export function workerSandbox(world, instance, chrome, never) {
  const { clock, harness, recordingConsole, tracked, VirtualDate } = world;
  // The browser's gzip streams, with each read and write counted as real work the virtual clock waits for.
  const trackedStream = (Real) => class {
    constructor(format) {
      const real = new Real(format);
      const reader = real.readable.getReader();
      const writer = real.writable.getWriter();
      this.readable = { getReader: () => ({ read: () => tracked(() => reader.read()) }) };
      this.writable = { getWriter: () => ({ write: (chunk) => tracked(() => writer.write(chunk)), close: () => tracked(() => writer.close()) }) };
    }
  };
  const sandbox = {
    chrome,
    console: recordingConsole,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    CompressionStream: trackedStream(CompressionStream),
    DecompressionStream: trackedStream(DecompressionStream),
    btoa,
    atob,
    AbortController,
    Date: VirtualDate,
    crypto: {
      randomUUID: () => globalThis.crypto.randomUUID(),
      getRandomValues: (array) => globalThis.crypto.getRandomValues(array),
      subtle: { digest: (algorithm, data) => tracked(() => globalThis.crypto.subtle.digest(algorithm, data)) }
    },
    setTimeout: (callback, delay) => clock.setTimeout(instance, () => { if (instance.alive) callback(); }, delay),
    clearTimeout: (id) => clock.clearTimeout(id),
    fetch: (url, init) => instance.alive
      ? harness.rsi.fetch(url, init).then((response) => instance.alive ? {
          ok: response.ok,
          status: response.status,
          url: response.url,
          headers: response.headers,
          text: () => response.text(),
          json: async () => instance.local(JSON.parse(await response.text()))
        } : never())
      : never()
  };
  return sandbox;
}
