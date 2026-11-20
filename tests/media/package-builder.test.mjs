import assert from "node:assert/strict";
import test from "node:test";
import { baseAccountDocument } from "../fixtures/account-document.mjs";
import { accountSchema, into, load, materializedInto, offlineSchema, policy, successfulMaterialization } from "./package-builder-in-a-sandbox.mjs";

test("media package is deterministic, schema-valid, and supplies the offline map", async () => {
  const context = await load();
  const accountDocument = await context.CitizenDataAccountDocument.stampIntegrity(into(context, baseAccountDocument()));
  const options = {
    accountDocument,
    materialized: materializedInto(context, successfulMaterialization()),
    policy: into(context, policy),
    accountSchema: into(context, accountSchema),
    offlineSchema: into(context, offlineSchema),
    generatedAt: "2026-11-17T20:00:00.000Z",
    startedAt: "2026-11-17T19:59:00.000Z",
    endedAt: "2026-11-17T20:00:00.000Z",
    packageId: "00000000-0000-4000-8000-000000000099",
    version: "0.1.0"
  };
  const first = await context.CitizenDataMediaPackage.buildArchive(options);
  const second = await context.CitizenDataMediaPackage.buildArchive(options);
  assert.deepEqual(Buffer.from(first.archive), Buffer.from(second.archive));
  assert.equal(first.manifest.materializationReceipt.status, "complete");
  assert.equal(first.manifest.materializationReceipt.promoted, true);
  assert.equal(await context.CitizenDataAccountDocument.verifyIntegrity(first.manifest), true);
  const bytes = Buffer.from(first.archive);
  assert.equal(bytes.includes(Buffer.from("scripts/offline-media.js")), true);
  assert.equal(bytes.includes(Buffer.from("CITIZENDATA_OFFLINE_MEDIA")), true);
  assert.equal(bytes.includes(Buffer.from(`"${"c".repeat(64)}"`)), true);
  assert.equal(bytes.includes(Buffer.from(`"${"d".repeat(64)}"`)), true);
  assert.equal(first.fileName, "citizendata-media-account-2026-11-17-200000-000Z.zip");
});

test("tampered account data and duplicate media paths fail closed", async () => {
  const context = await load();
  const accountDocument = await context.CitizenDataAccountDocument.stampIntegrity(into(context, baseAccountDocument()));
  const tampered = into(context, accountDocument);
  tampered.account.handle = "Changed";
  await assert.rejects(context.CitizenDataMediaPackage.buildArchive({
    accountDocument: tampered, materialized: materializedInto(context, successfulMaterialization()), policy: into(context, policy),
    accountSchema: into(context, accountSchema), offlineSchema: into(context, offlineSchema)
  }), /integrity/iu);
  const duplicateHost = successfulMaterialization();
  duplicateHost.files.push({ ...duplicateHost.files[0] });
  await assert.rejects(
    context.CitizenDataMediaPackage.buildArchive({ accountDocument, materialized: materializedInto(context, duplicateHost), policy: into(context, policy), accountSchema: into(context, accountSchema), offlineSchema: into(context, offlineSchema) }),
    /duplicate/iu
  );
});

test("failed assets create an explicit partial unpromoted receipt", async () => {
  const context = await load();
  const accountDocument = await context.CitizenDataAccountDocument.stampIntegrity(into(context, baseAccountDocument()));
  const partialHost = successfulMaterialization();
  partialHost.assets = [{
    ...partialHost.assets[0], finalUrl: null, status: "failed", relativePath: null, displayFileName: null, mediaType: null, byteLength: null, pixelWidth: null,
    pixelHeight: null, contentHash: null, fetchedAt: null, errorCode: "HTTP_404"
  }];
  partialHost.files = [];
  partialHost.totalBytes = 0;
  const result = await context.CitizenDataMediaPackage.buildArchive({
    accountDocument, materialized: materializedInto(context, partialHost), policy: into(context, policy), accountSchema: into(context, accountSchema),
    offlineSchema: into(context, offlineSchema), generatedAt: "2026-11-17T20:00:00.000Z"
  });
  assert.equal(result.manifest.materializationReceipt.status, "partial");
  assert.equal(result.manifest.materializationReceipt.promoted, false);
  assert.equal(result.manifest.summary.failed, 1);
});

test("offline map rejects one canonical image key resolving to conflicting files", async () => {
  const context = await load();
  const first = successfulMaterialization().assets[0];
  const second = {
    ...first,
    assetId: "e".repeat(64),
    sourceImageKeys: [first.sourceImageKeys[0]],
    relativePath: `media/ee/${"e".repeat(64)}.png`
  };
  assert.throws(() => context.CitizenDataMediaPackage.mediaMapScript([first, second]), /Conflicting offline-media path/u);
});
