// The dashboard hands the extension a finished run's images before the Images ZIP is downloaded, and a cancel until
// then stops the hand-over (CitizenDataExtensionMedia.keep): before any image is read, between batches, or as a
// delayed batch returns. The images the extension took in before the cancel stay kept, and the error says how many.
import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionMedia, connected, image, plain } from "./kept-images-loaded-with-fixture-images.mjs";

// Nine images in batches of four. `onRead(index, controller)` runs as each image is read and `onSend(controller,
// send)` stands for each request; either may cancel.
async function handOver({ cancelFirst = false, onRead = () => {}, onSend = (_controller, send) => send() } = {}) {
  const { harness, request, sent } = await connected();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  const items = await Promise.all(Array.from({ length: 9 }, (_, index) => image(index + 1)));
  const kept = await ExtensionMedia.index(request);
  kept.limits.filesPerRequest = 4;
  sent.length = 0;
  const controller = new AbortController();
  if (cancelFirst) controller.abort();
  const reads = [];
  const readFile = async (asset) => {
    reads.push(asset.assetId);
    onRead(reads.length, controller);
    return items.find((item) => item.asset.assetId === asset.assetId).bytes;
  };
  const send = (type, payload) => onSend(controller, () => request(type, payload));
  let error = null;
  const outcome = await ExtensionMedia.keep({ assets: items.map((item) => item.asset), readFile, kept, request: send, signal: controller.signal }).catch((thrown) => { error = thrown; });
  const count = plain(await harness.popup.request("GET_BUILD_HISTORY")).images.count;
  return { outcome, error, reads: reads.length, sent: sent.length, count };
}

test("a cancel before the hand-over reads no image and asks the extension nothing", async () => {
  const { error, reads, sent, count } = await handOver({ cancelFirst: true });
  assert.deepEqual([error?.name, error?.kept, reads, sent, count], ["AbortError", 0, 0, 0, 0]);
});

test("a cancel between batches sends no further batch, and the first batch stays kept", async () => {
  const { error, reads, sent, count } = await handOver({ onRead: (index, controller) => { if (index === 6) controller.abort(); } });
  assert.deepEqual([error?.name, error?.kept, reads, sent, count], ["AbortError", 4, 6, 1, 4]);
});

test("a cancel while a batch is delayed stops the hand-over once the extension answers, and that batch is counted", async () => {
  const { error, reads, sent, count } = await handOver({
    onSend: async (controller, send) => {
      const answer = send();
      controller.abort();
      return answer;
    }
  });
  assert.deepEqual([error?.name, error?.kept, reads, sent, count], ["AbortError", 4, 5, 1, 4]);
});

test("with no cancel every image is handed over", async () => {
  const { outcome, error, sent, count } = await handOver();
  assert.deepEqual([error, outcome, sent, count], [null, { stored: 9, refused: 0, already: 0 }, 3, 9]);
});
