// The answers the RSI adapter's sandbox gives its fetch: a scripted answer read as a fetch Response, with its status,
// headers, content type and body, and a streamed body whose reads and cancel the test can see.

// A scripted answer as a Response. `streams` collects the state of each streamed body given as {stream: {chunkBytes,
// chunks}}. A request that never answers throws: a network failure (TypeError) or the extension's own time-out
// (AbortError).
export function answerOf(response, url, streams) {
  if (response?.kind === "throw") {
    throw response.name === "AbortError" ? Object.assign(new Error("The operation was aborted."), { name: "AbortError" }) : new TypeError("Failed to fetch");
  }
  const isHtml = response?.kind === "html";
  const isHttpError = response?.kind === "http-error";
  const body = isHtml || isHttpError ? response.body : response;
  const status = isHttpError ? response.status : response?.kind === "json" ? response.status ?? 200 : 200;
  const headers = Object.fromEntries(Object.entries(response?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]));
  const contentType = response?.contentType ?? (isHtml ? "text/html; charset=UTF-8" : "application/json");
  const jsonBody = response?.kind === "json" ? response.body : body;
  const result = {
    ok: status >= 200 && status < 300,
    status,
    url: response?.finalUrl ?? url,
    headers: { get(name) { return name.toLowerCase() === "content-type" ? contentType : headers[name.toLowerCase()] ?? null; } },
    async json() { return jsonBody; },
    async text() { return typeof jsonBody === "string" ? jsonBody : isHtml || isHttpError ? String(body) : JSON.stringify(jsonBody); },
    clone() { return response?.stream ? { ...result, body: streamOf(response.stream, streams) } : { ...result }; }
  };
  return result;
}

// A streamed body of `chunks` chunks of `chunkBytes` bytes each; its state, how much was read and whether it was
// cancelled, is added to `streams`.
function streamOf({ chunkBytes, chunks }, streams) {
  const state = { chunksRead: 0, cancelled: false };
  streams.push(state);
  return {
    getReader() {
      return {
        async read() {
          if (state.cancelled || state.chunksRead >= chunks) return { done: true, value: undefined };
          state.chunksRead += 1;
          return { done: false, value: new Uint8Array(chunkBytes).fill(state.chunksRead % 256) };
        },
        async cancel() { state.cancelled = true; }
      };
    }
  };
}
