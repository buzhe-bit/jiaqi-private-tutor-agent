import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { buildCoachMessages } from "../src/coach/prompt.mjs";
import { createSessionCodec } from "../src/session-token.mjs";

const require = createRequire(import.meta.url);
const { splitParagraphs } = require("../miniprogram/utils/format.js");

const root = new URL("../", import.meta.url);


test("1. 回答只按空行分语义段，不在句子中间硬切", () => {
  const long = "这是一段超过五十二个字的完整解释，它需要在手机上自然换行，但不应该被前端擅自拆成多个没有语义层级的短块。";
  assert.deepEqual(splitParagraphs(`${long}\n\n第二个观点。`), [long, "第二个观点。"]);
});


test("2. 标点空段和伪项目符号不再显示", () => {
  assert.deepEqual(splitParagraphs("• 儒家从亲亲推展仁爱。\n\n。\n\n· 墨家主张兼爱。"), [
    "儒家从亲亲推展仁爱。",
    "墨家主张兼爱。"
  ]);
});


test("3. 返回和收起按钮在微信弹性布局中保持内容宽度", async () => {
  const css = await readFile(new URL("miniprogram/pages/training/training.wxss", root), "utf8");
  assert.match(css, /\.back-link[^}]*width:\s*auto/);
  assert.match(css, /\.coach-close[^}]*flex:\s*none/);
  assert.match(css, /\.coach-heading\s*>\s*view[^}]*min-width:\s*0/);
});


test("4. 回答反馈有选中、保存、失败和吐槽入口", async () => {
  const template = await readFile(new URL("miniprogram/pages/training/training.wxml", root), "utf8");
  for (const text of ["✓ 已经记下", "没有保存成功", "我想吐槽", "提交反馈"]) assert.match(template, new RegExp(text));
});


test("5. 反馈记录带上触发动作，可区分讲明白和参考作答", async () => {
  const source = await readFile(new URL("miniprogram/pages/training/training.js", root), "utf8");
  assert.match(source, /action:\s*this\.state\.request\?\.action/);
  assert.match(source, /feedbackStatus:\s*saved\s*\?\s*"saved"\s*:\s*"error"/);
});


test("6. 提示只给一个线索，不生成完整答案", () => {
  const system = buildCoachMessages({ action: "request_hint", question: { text: "测试题" } })[0].content;
  assert.match(system, /60—120/);
  assert.match(system, /不给参考答案/);
});


test("7. 讲明白与可行作答有明确不同的长度和产物", () => {
  const explain = buildCoachMessages({ action: "request_explanation", question: { text: "测试题" } })[0].content;
  const reference = buildCoachMessages({ action: "request_reference", question: { text: "测试题" } })[0].content;
  assert.match(explain, /250‑450/);
  assert.match(explain, /不生成整篇考场答案/);
  assert.match(reference, /450‑700/);
  assert.match(reference, /可直接阅读和复制/);
});


test("8. 多轮反馈只增加新信息，不因语音错字或日常词汇卡住学生", () => {
  const system = buildCoachMessages({
    action: "submit_restate",
    snapshot: { intervention: "【首次诊断】已经讲过关键关系", repairResponse: "上一次复述" },
    input: "天下大同只是我的口语说法",
    question: { text: "测试题" }
  })[0].content;
  assert.match(system, /先说学生这次新增了什么/);
  assert.match(system, /同音字/);
  assert.match(system, /天下大同/);
});


test("9. AI 失败前已把学生本轮输入和阶段写入会话记录", async () => {
  const updates = [];
  const secret = "pending-save-test";
  const app = createApp({
    config: { invites: new Map(), sessionSigningSecret: secret },
    coach: { async evaluate() { throw new Error("AI timeout"); } },
    recorder: { async update(id, session) { updates.push([id, structuredClone(session)]); } }
  });
  const sessionToken = createSessionCodec(secret).sign({
    sessionId: "s1", recordId: "s1", questionId: "kant-freedom-keystone",
    participantCode: "P01", cohort: "pilot", startedAt: "2026-09-03T00:00:00.000Z", stage: "attempt"
  });
  const response = await app.handle(new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionToken, stage: "attempt", action: "submit_attempt", input: "这是我的第一次回答" })
  }));
  assert.equal(response.status, 500);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].snapshot.initialAnswer, "这是我的第一次回答");
  assert.equal(updates[0][1].messages[0].action, "submit_attempt");
  assert.equal(updates[0][1].messages[0].stage, "attempt");
});


test("10. 老师可以阅读一题完整对话并下载 Markdown", async () => {
  const session = {
    sessionId: "s1", participantCode: "P01", question: "康德为什么区分现象与物自体？",
    stage: "teaching", updatedAt: "2026-09-03T01:00:00.000Z",
    messages: [
      { role: "student", message: "我的第一次回答", stage: "attempt", action: "submit_attempt" },
      { role: "coach", message: "私教的反馈", stage: "attempt", action: "submit_attempt" }
    ]
  };
  const app = createApp({
    config: { invites: new Map(), sessionSigningSecret: "detail", adminAccessToken: "teacher" },
    coach: { async evaluate() {} },
    recorder: { async get(id) { return id === "s1" ? session : null; } }
  });
  const authorization = `Basic ${Buffer.from("admin:teacher").toString("base64")}`;
  const html = await (await app.handle(new Request("http://local.test/pilot/session?id=s1", { headers: { authorization } }))).text();
  const markdown = await (await app.handle(new Request("http://local.test/pilot/session?id=s1&format=md", { headers: { authorization } }))).text();
  assert.match(html, /下载 Markdown/);
  assert.match(html, /我的第一次回答/);
  assert.match(markdown, /## 学生/);
  assert.match(markdown, /## 私教/);
});
