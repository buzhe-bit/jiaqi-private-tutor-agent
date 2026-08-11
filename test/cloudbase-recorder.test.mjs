import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudBaseRecorder,
  createMirroredRecorder
} from "../src/records/cloudbase-recorder.mjs";


function fakeCloudBaseApi() {
  const documents = new Map();
  const calls = [];
  return {
    documents,
    calls,
    async fetchImpl(url, options = {}) {
      calls.push({ url: String(url), options });
      const parsed = new URL(url);
      const docId = decodeURIComponent(parsed.pathname.split("/").at(-1));
      if (options.method === "PATCH") {
        const body = JSON.parse(options.body);
        const next = body.replaceMode
          ? body.data
          : { ...documents.get(docId), ...body.data };
        documents.set(docId, { ...next, _id: docId });
        return Response.json({ updated: 1, matched: 1 });
      }
      if (parsed.pathname.endsWith("/documents")) {
        const query = JSON.parse(parsed.searchParams.get("query") || "{}");
        const list = [...documents.values()]
          .filter((item) => item.participantCode === query.participantCode)
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return Response.json({ offset: 0, limit: 30, list });
      }
      const value = documents.get(docId);
      return value
        ? Response.json(value)
        : Response.json({ code: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    }
  };
}


test("CloudBase recorder persists and lists learner sessions by stable participant code", async () => {
  const { fetchImpl, documents, calls } = fakeCloudBaseApi();
  const recorder = createCloudBaseRecorder({
    envId: "env-demo",
    apiKey: "server-key",
    collectionName: "coach_sessions",
    fetchImpl
  });

  const recordId = await recorder.create({
    sessionId: "session-1",
    participantCode: "P01",
    stage: "attempt",
    updatedAt: "2026-08-08T01:00:00.000Z"
  });
  await recorder.update(recordId, {
    sessionId: "session-1",
    participantCode: "P01",
    stage: "complete",
    updatedAt: "2026-08-08T02:00:00.000Z"
  });

  assert.equal(recordId, "session-1");
  assert.equal(documents.get("session-1").stage, "complete");
  assert.deepEqual(
    (await recorder.listByParticipant("P01")).map((item) => item.sessionId),
    ["session-1"]
  );
  assert.equal(calls.every((call) => call.options.headers.Authorization === "Bearer server-key"), true);
});


test("Feishu mirror failure never blocks the CloudBase product record", async () => {
  const { fetchImpl, documents } = fakeCloudBaseApi();
  const primary = createCloudBaseRecorder({
    envId: "env-demo",
    apiKey: "server-key",
    collectionName: "coach_sessions",
    fetchImpl
  });
  const warnings = [];
  const mirror = {
    async create() { throw new Error("Feishu unavailable"); },
    async update() { throw new Error("Feishu unavailable"); }
  };
  const recorder = createMirroredRecorder(primary, mirror, {
    warn(message) { warnings.push(message); }
  });

  const recordId = await recorder.create({
    sessionId: "session-2",
    participantCode: "P02",
    stage: "attempt",
    updatedAt: "2026-08-08T01:00:00.000Z"
  });
  await recorder.update(recordId, {
    sessionId: "session-2",
    participantCode: "P02",
    stage: "teaching",
    updatedAt: "2026-08-08T01:10:00.000Z"
  });

  assert.equal(documents.get("session-2").stage, "teaching");
  assert.equal(warnings.length, 1);
});
