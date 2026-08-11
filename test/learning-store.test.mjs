import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudBaseLearningStore,
  createMemoryLearningStore
} from "../src/records/learning-store.mjs";


test("memory learning store isolates learners and filters due mastery", async () => {
  const store = createMemoryLearningStore();
  await store.upsertMastery({
    masteryId: "P01:philosophy:a",
    participantCode: "P01",
    reviewAt: "2026-08-11T00:00:00.000Z",
    masteryStatus: "unstable"
  });
  await store.upsertMastery({
    masteryId: "P01:philosophy:b",
    participantCode: "P01",
    reviewAt: "2026-08-20T00:00:00.000Z",
    masteryStatus: "developing"
  });
  await store.upsertMastery({
    masteryId: "P02:philosophy:a",
    participantCode: "P02",
    reviewAt: "2026-08-10T00:00:00.000Z",
    masteryStatus: "unstable"
  });

  const due = await store.listMasteryByParticipant("P01", {
    dueBefore: "2026-08-12T00:00:00.000Z"
  });
  assert.deepEqual(due.map((item) => item.masteryId), ["P01:philosophy:a"]);
  assert.equal((await store.getMastery("P01:philosophy:a")).masteryStatus, "unstable");
});


test("memory learning store upserts question seeds without duplicates", async () => {
  const store = createMemoryLearningStore();
  await store.upsertQuestion({ questionId: "q1", stem: "第一版", questionKind: "new" });
  await store.upsertQuestion({ questionId: "q1", stem: "第二版", questionKind: "relation" });

  assert.equal((await store.getQuestion("q1")).stem, "第二版");
  assert.deepEqual((await store.listQuestions()).map((item) => item.questionId), ["q1"]);
});


test("CloudBase learning store writes the two configured collections", async () => {
  const calls = [];
  const documents = new Map();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const parsed = new URL(url);
    const collection = decodeURIComponent(parsed.pathname.split("/collections/")[1].split("/")[0]);
    const docId = parsed.pathname.endsWith("/documents")
      ? ""
      : decodeURIComponent(parsed.pathname.split("/").at(-1));
    const key = `${collection}:${docId}`;
    if (options.method === "PATCH") {
      const body = JSON.parse(options.body);
      documents.set(key, { ...body.data, _id: docId });
      return Response.json({ updated: 1 });
    }
    if (!docId) {
      const query = JSON.parse(parsed.searchParams.get("query") || "{}");
      const list = [...documents.entries()]
        .filter(([entryKey, item]) => entryKey.startsWith(`${collection}:`)
          && Object.entries(query).every(([field, value]) => item[field] === value))
        .map(([, item]) => item);
      return Response.json({ list });
    }
    const value = documents.get(key);
    return value ? Response.json(value) : Response.json({ code: "DOCUMENT_NOT_FOUND" }, { status: 404 });
  };
  const store = createCloudBaseLearningStore({
    envId: "env-demo",
    apiKey: "server-key",
    masteryCollectionName: "learner_mastery",
    questionCollectionName: "question_bank",
    fetchImpl
  });

  await store.upsertMastery({
    masteryId: "P01:philosophy:a",
    participantCode: "P01",
    reviewAt: "2026-08-11T00:00:00.000Z"
  });
  await store.upsertQuestion({ questionId: "q1", stem: "题目", questionKind: "new" });

  assert.equal((await store.listMasteryByParticipant("P01")).length, 1);
  assert.equal((await store.listQuestions()).length, 1);
  assert.equal(calls.some((call) => call.url.includes("/collections/learner_mastery/")), true);
  assert.equal(calls.some((call) => call.url.includes("/collections/question_bank/")), true);
});
