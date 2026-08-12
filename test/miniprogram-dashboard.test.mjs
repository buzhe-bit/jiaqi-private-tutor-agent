import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { selectActiveSession, todayCard } = require("../miniprogram/core/dashboard.js");


test("a completed local session is never resumed as active", () => {
  const completed = { sessionId: "done", stage: "complete", question: "旧题" };
  assert.equal(selectActiveSession([], completed), null);
});


test("the today card shows the exact resumable session instead of another recommendation", () => {
  const active = { sessionId: "active", stage: "teaching", question: "正在做的题", questionKind: "review" };
  const recommendation = { questionId: "next", question: "下一道推荐题", questionKind: "new" };
  const card = todayCard(recommendation, active);

  assert.equal(card.question, "正在做的题");
  assert.equal(card.questionKind, "review");
  assert.equal(card.active, true);
});
