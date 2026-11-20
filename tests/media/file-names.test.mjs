import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..", "..");
const { api: MediaFileNames } = await loadClassicScript(path.join(repositoryRoot, "docs", "scripts", "media-file-names.js"), "CitizenDataMediaFileNames");
const firstKey = "48b39228b05c2d94f7f9a6359e256943af70ecb31d20676914765cf08f641de2";
const secondKey = "7d7ca77a0ffbba902012ccd52089ad56070fce33b8cb621995634382f4523b9e";

test("generic subscriber thumbnails use the adjacent title and a stable collision suffix", () => {
  const name = MediaFileNames.deriveDisplayFileName({
    title: "Package - Weekend Warrior - LTI",
    role: "thumbnail",
    imageKey: firstKey,
    sourceUrl: "https://example.invalid/media/subscribers_vault_thumbnail?size=large",
    mediaType: "image/jpeg"
  });
  assert.equal(name, "package-weekend-warrior-lti--thumbnail--48b39228b05c.jpg");
});

test("same-titled distinct images retain distinct aliases", () => {
  const input = { title: "The Lamp", role: "thumbnail", sourceUrl: "https://example.invalid/subscribers_vault_thumbnail", mediaType: "image/png" };
  assert.notEqual(
    MediaFileNames.deriveDisplayFileName({ ...input, imageKey: firstKey }),
    MediaFileNames.deriveDisplayFileName({ ...input, imageKey: secondKey })
  );
});

test("unsafe titles and URL extensions cannot escape or select the output type", () => {
  const name = MediaFileNames.deriveDisplayFileName({
    title: "../CON\\Package. ",
    role: "hero/image",
    imageKey: firstKey,
    sourceUrl: "https://example.invalid/subscribers_vault_thumbnail.exe",
    mediaType: "image/webp"
  });
  assert.equal(name, "con-package--hero-image--48b39228b05c.webp");
  assert.doesNotMatch(name, /[\\/]|\.\./u);
});

test("source basename remains available as provenance", () => {
  assert.equal(MediaFileNames.sourceBasename("https://example.invalid/path/subscribers_vault_thumbnail?width=165"), "subscribers_vault_thumbnail");
});
