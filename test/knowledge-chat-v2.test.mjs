import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { buildExpressionNote } from "../src/coach/expression-note.mjs";
import { buildCoachMessages } from "../src/coach/prompt.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { actionAllowedFor, nextStageFor } from "../src/coach/state-machine.mjs";
import { createSessionCodec } from "../src/session-token.mjs";


const SECRET = "knowledge-chat-v2-test-secret";


function sessionToken(stage) {
  return createSessionCodec(SECRET).sign({
    sessionId: "session-knowledge-chat",
    recordId: "record-knowledge-chat",
    questionId: "kant-freedom-keystone",
    participantCode: "P01",
    cohort: "pilot",
    startedAt: "2026-08-08T00:00:00.000Z",
    stage
  });
}


function stepRequest(stage, snapshot, input) {
  return new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: sessionToken(stage),
      stage,
      action: "ask_followup",
      snapshot,
      messages: [],
      input
    })
  });
}


test("follow-up stays in restatement and revision without losing drafts", () => {
  assert.equal(actionAllowedFor("restate", "ask_followup"), true);
  assert.equal(actionAllowedFor("revision", "ask_followup"), true);
  assert.equal(nextStageFor("restate", "TEACH"), "restate");
  assert.equal(nextStageFor("revision", "TEACH"), "revision");
});


test("a specific knowledge question is answered directly and connected to the current task", async () => {
  const result = await createMockCoach().evaluate({
    action: "ask_followup",
    snapshot: {
      initialAnswer: "我知道辩证法和矛盾有关，但说不清黑格尔。",
      repairResponse: "我的复述草稿"
    },
    input: "马克思跟黑格尔的辩证法有啥区别呢？",
    question: {
      id: "hegel-dialectic",
      guide: {
        keyTerms: ["辩证法", "矛盾", "扬弃"],
        focus: "说明概念如何因内在矛盾而运动。",
        answerHook: "辩证法是概念从自身矛盾出发的运动。",
        answerStructure: ["内在矛盾", "否定", "扬弃"],
        possibleAnswer: "一种可行作答。",
        nextRecallQuestion: "辩证运动从哪里开始？"
      }
    }
  });

  const answer = `${result.message}\n${result.teaching}`;
  assert.match(answer, /黑格尔/);
  assert.match(answer, /概念|精神/);
  assert.match(answer, /马克思/);
  assert.match(answer, /现实社会关系|实践|物质条件/);
  assert.match(answer, /当前|这道题|你的回答/);
  assert.doesNotMatch(answer, /换成两个问题|反向检查/);
  assert.match(result.knowledgeConnection, /黑格尔.*→.*马克思|黑格尔.*马克思/);
});


test("a genuine not-understood message still changes the explanation", async () => {
  const result = await createMockCoach().evaluate({
    action: "ask_followup",
    snapshot: { initialAnswer: "不知道", intervention: "【request_explanation】已经讲过" },
    input: "我还是没懂，请换个讲法"
  });

  assert.match(`${result.message}\n${result.teaching}`, /换|问题|反例|类比/);
});


for (const stage of ["restate", "revision"]) {
  test(`API keeps ${stage} draft and records at most eight knowledge connections`, async () => {
    const updates = [];
    const app = createApp({
      config: {
        coachProvider: "cloudbase",
        invites: new Map(),
        sessionSigningSecret: SECRET
      },
      coach: {
        async evaluate() {
          return {
            gate: "TEACH",
            learnerNeed: "knowledge_gap",
            message: "先直接回答：两者的出发点不同。",
            studentEvidence: "你已经抓到辩证法与矛盾运动有关。",
            missingPoint: "需要区分概念运动与现实社会关系中的矛盾。",
            focus: "把这一区别接回当前题目。",
            teaching: "黑格尔强调概念或精神的自我运动；马克思转向现实社会关系、实践与物质条件。",
            knowledgeConnection: "黑格尔的概念自我运动 → 马克思转向现实社会关系与实践中的矛盾运动",
            nextActions: ["restate"],
            sourceStatus: "有材料支持"
          };
        }
      },
      recorder: {
        async create() { return "unused"; },
        async update(_id, session) { updates.push(session); }
      }
    });
    const snapshot = {
      initialAnswer: "初答",
      repairResponse: "复述草稿不能丢",
      rewrittenAnswer: "改写草稿不能丢",
      knowledgeConnections: Array.from({ length: 8 }, (_, index) => `联系${index + 1}`)
    };
    const response = await app.handle(stepRequest(stage, snapshot, "马克思与黑格尔有什么区别？"));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.nextStage, stage);
    assert.equal(body.snapshot.repairResponse, "复述草稿不能丢");
    assert.equal(body.snapshot.rewrittenAnswer, "改写草稿不能丢");
    assert.equal(body.snapshot.knowledgeConnections.length, 8);
    assert.equal(body.snapshot.knowledgeConnections.at(-1), body.feedback.knowledgeConnection);
    assert.equal(updates.at(-1).stage, stage);
  });
}


test("the real-model prompt distinguishes knowledge questions from reteaching", () => {
  const combined = buildCoachMessages({
    action: "ask_followup",
    snapshot: { initialAnswer: "我的初答", repairResponse: "我的复述草稿" },
    input: "马克思跟黑格尔的辩证法有什么区别？"
  }).map((message) => message.content).join("\n");

  assert.match(combined, /相关知识网络/);
  assert.match(combined, /先直接回答/);
  assert.match(combined, /时代背景|回应对象|哲学家比较/);
  assert.match(combined, /当前题目/);
  assert.match(combined, /knowledgeConnection/);
  assert.match(combined, /无关问题/);
  assert.match(combined, /message 严格只写一句/);
  assert.match(combined, /每段最多两句/);
});


test("expression note includes the session knowledge connections", () => {
  const note = buildExpressionNote({
    question: "黑格尔辩证法题",
    snapshot: {
      initialAnswer: "初答",
      repairResponse: "复述",
      rewrittenAnswer: "改写",
      knowledgeConnections: [
        "黑格尔的概念自我运动 → 马克思转向现实社会关系与实践中的矛盾运动"
      ]
    },
    feedback: { studentEvidence: "会的部分", missingPoint: "已补上" }
  });

  assert.deepEqual(note.knowledgeConnections, [
    "黑格尔的概念自我运动 → 马克思转向现实社会关系与实践中的矛盾运动"
  ]);
});


test("client exposes demo mode and uses learning-chat hierarchy in all three stages", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(script, /演示模式：回答为固定样例/);
  assert.match(script, /还有具体问题？继续问私教，不影响当前草稿/);
  assert.match(script, /查看上一轮讲解/);
  assert.match(script, /比较两位哲学家/);
  assert.match(script, /补时代背景/);
  assert.match(script, /这和当前题有什么关系/);
  assert.doesNotMatch(script, /state\.stage\s*=\s*"teaching"/);
  assert.match(styles, /\.message-student[\s\S]*align-self:\s*flex-end/);
  assert.match(styles, /\.message-coach[\s\S]*align-self:\s*flex-start/);
  assert.match(styles, /\.message-reference[\s\S]*max-width:\s*100%/);
  assert.match(script, /pendingStudent/);
});
