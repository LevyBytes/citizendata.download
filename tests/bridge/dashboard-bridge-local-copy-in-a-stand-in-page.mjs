import { harness } from "./dashboard-bridge-in-a-stand-in-page.mjs";

export const LOCAL_PATH = "/C:/Users/someone/Downloads/citizendata/docs/index.html";
export const settle = () => new Promise((resolve) => setImmediate(resolve));
export const readyPosts = (fixture) => fixture.posts.filter((entry) => entry.message.type === "BRIDGE_READY");

export function localHarness(hello, options = {}) {
  // Chrome reports the origin of a file page as the string "null".
  return harness({ ...options, hello, location: { origin: "null", pathname: LOCAL_PATH } });
}
