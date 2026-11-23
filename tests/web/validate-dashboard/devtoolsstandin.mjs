// A DevTools endpoint as Chrome serves it, on this machine, for the start tests (devtoolsstarthandshake.test.mjs):
// /json/list with one page target, /json/version with the browser's socket, and both sockets. With `pageAnswers`
// false the page socket opens and never answers, as the page of a Chrome without a renderer does; the browser socket
// answers SystemInfo.getProcessInfo with `processTypes`. `received` lists the commands each socket was sent.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// One client frame from the start of `buffer`, unmasked, or null until it is all there.
function readFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const masked = (buffer[1] & 0x80) !== 0;
  const start = offset + (masked ? 4 : 0);
  if (buffer.length < start + length) return null;
  const payload = Buffer.from(buffer.subarray(start, start + length));
  if (masked) for (let index = 0; index < payload.length; index += 1) payload[index] ^= buffer[offset + (index % 4)];
  return { opcode: buffer[0] & 0x0f, text: payload.toString("utf8"), length: start + length };
}

function textFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([head, payload]);
}

export async function devtoolsStandIn({ pageAnswers = true, processTypes = ["browser", "renderer"] } = {}) {
  const received = [];
  const sockets = new Set();
  const json = (response, value) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
  const server = createServer((request, response) => {
    const { port } = server.address();
    if (request.url === "/json/list") return json(response, [{ type: "page", url: "about:blank", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/stand-in` }]);
    if (request.url === "/json/version") return json(response, { Browser: "StandIn/1.0", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/stand-in` });
    return response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket) => {
    const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}${GUID}`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const page = request.url.includes("/page/");
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (let frame = readFrame(buffered); frame; frame = readFrame(buffered)) {
        buffered = buffered.subarray(frame.length);
        if (frame.opcode === 8) return socket.end();
        if (frame.opcode !== 1) continue;
        const message = JSON.parse(frame.text);
        received.push([page ? "page" : "browser", message.method]);
        if (page && !pageAnswers) continue;
        const result = message.method === "SystemInfo.getProcessInfo" ? { processInfo: processTypes.map((type, id) => ({ type, id, cpuTime: 0 })) } : { result: { type: "number", value: 1 } };
        socket.write(textFrame(JSON.stringify({ id: message.id, result })));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    received,
    // Writes the DevToolsActivePort file Chrome writes into its profile folder.
    writePortFile: (file) => writeFileSync(file, `${port}\n/devtools/browser/stand-in\n`),
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      server.close(resolve);
    })
  };
}
