import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";
import { createHttpServer } from "../src/server.mjs";


test("HTTP server serves the mobile app and API with security headers", async (t) => {
  const app = createApp({
    config: { invites: new Map([["demo", { participantCode: "DEMO", cohort: "demo" }]]) },
    coach: createMockCoach(),
    recorder: createMemoryRecorder()
  });
  const server = createHttpServer({ app });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const page = await fetch(`http://127.0.0.1:${port}/?invite=demo`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /哲学论述陪练/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);

  const clientScript = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  assert.match(clientScript, /sessionToken:\s*state\.sessionToken/);

  const plum = await fetch(`http://127.0.0.1:${port}/assets/plum-progress-final.png`);
  assert.equal(plum.status, 200);
  assert.equal(plum.headers.get("content-type"), "image/png");

  const helpIcon = await fetch(`http://127.0.0.1:${port}/assets/icons/book-open.svg`);
  assert.equal(helpIcon.status, 200);
  assert.equal(helpIcon.headers.get("content-type"), "image/svg+xml");

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.deepEqual(await health.json(), {
    ok: true,
    product: "philosophy-answer-coach",
    coachMode: "demo",
    storageMode: "memory"
  });

  const missing = await fetch(`http://127.0.0.1:${port}/not-a-real-file.js`);
  assert.equal(missing.status, 404);
});

test("client does not advertise a personal material upload before RAG exists", async () => {
  const script = await readClientScript();

  assert.doesNotMatch(script, /function materialEditor|function materialText|function materialState/);
  assert.doesNotMatch(script, /type:\s*"file"|带上你正在用的资料|本题需要参考教材/);
  assert.doesNotMatch(functionBody(script, "renderToday"), /materialEditor|参考教材|上传/);
  assert.doesNotMatch(functionBody(script, "attemptComposer"), /materialEditor|补充自己的资料/);
  assert.match(functionBody(script, "startQuestionRequest"), /sourceExcerpt:\s*""/);
});

test("client uses one conversation screen with the question kept at the top", async () => {
  const script = await readClientScript();

  const body = functionBody(script, "renderConversation");
  assert.match(body, /questionCard\(/);
  assert.match(body, /conversationLog\(/);
  assert.doesNotMatch(script, /renderInterpretation|renderRepair|renderReflection/);
});

test("client keeps three icon teaching choices and merges explanation with example", async () => {
  const script = await readClientScript();

  for (const label of ["给我一个提示", "讲明白（解释＋例子）", "看一种可行作答", "我来用自己的话说说"]) {
    assert.match(script, new RegExp(label));
  }
  const controls = functionBody(script, "helpControls");
  assert.match(controls, /\["hint",\s*"explain",\s*"reference"\]/);
  assert.doesNotMatch(controls, /filter\(\(key\)\s*=>\s*allowed\.has\(key\)\)/);
  assert.doesNotMatch(controls, /allowed\.has\("restate"\)/);
  assert.doesNotMatch(controls, /button\("给我讲明白"/);
  assert.match(script, /action:\s*"submit_attempt"/);
  assert.match(script, /action:\s*"request_reference"/);
  assert.match(script, /先暂停，稍后继续/);
  assert.match(script, /继续这次陪练/);
});


test("specific questions use one floating coach instead of a second inline composer", async () => {
  const [script, styles] = await Promise.all([
    readClientScript(),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  const body = functionBody(script, "followupComposer");
  assert.match(body, /问私教/);
  assert.match(body, /发送给私教/);
  assert.match(body, /手机键盘的语音输入/);
  assert.match(body, /比较两位哲学家/);
  assert.match(body, /补时代背景/);
  assert.match(body, /这和当前题有什么关系/);
  assert.match(body, /followup-prompts/);
  assert.match(body, /coach-fab/);
  assert.match(body, /coach-popover/);
  assert.match(body, /aria-expanded/);
  assert.doesNotMatch(body, /我还是没听懂，换种讲法/);
  assert.match(styles, /\.coach-fab/);
  assert.match(styles, /\.coach-popover textarea[\s\S]*min-height/);
});

test("client shows four explicit learning steps and an inline request receipt", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readClientScript(),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  for (const label of ["初次作答", "弄懂关系", "用自己的话说", "改进答案"]) {
    assert.match(html, new RegExp(label));
  }
  assert.equal((html.match(/data-progress-step=/g) || []).length, 4);
  assert.match(functionBody(script, "setProgress"), /is-complete/);
  assert.match(functionBody(script, "setProgress"), /is-current/);
  assert.match(functionBody(script, "setProgress"), /is-pending/);
  assert.match(script, /function requestStatusCopy\(/);
  assert.match(script, /function requestStatusNode\(/);
  assert.match(functionBody(script, "withBusy"), /requestAnimationFrame/);
  assert.match(styles, /@keyframes request-loading/);

  const requestStatusCopy = clientFunction(script, "requestStatusCopy");
  assert.deepEqual(
    { ...requestStatusCopy({ phase: "loading", saved: true }, "teaching") },
    {
      title: "你的回答已经保存",
      detail: "私教正在判断你卡在哪里……",
      loading: true
    }
  );
  assert.deepEqual(
    { ...requestStatusCopy({ phase: "done" }, "restate") },
    {
      title: "本轮反馈已经生成",
      detail: "下一步：用自己的话说清这道题的关键关系。",
      loading: false
    }
  );
});


test("client anchors pending answers and new feedback without artificial page height", async () => {
  const [script, styles] = await Promise.all([
    readClientScript(),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(functionBody(script, "applyStepResult"), /scrollTarget\s*=\s*"latest-feedback"/);
  assert.match(functionBody(script, "runStep"), /scrollTarget\s*=\s*"pending-student"/);
  assert.match(functionBody(script, "conversationLog"), /message-latest/);
  const render = functionBody(script, "render");
  assert.match(render, /\.message-pending/);
  assert.match(render, /\.message-latest\s+\.feedback-conclusion/);
  assert.match(render, /block:\s*"start"/);
  assert.match(render, /behavior:\s*"auto"/);
  assert.doesNotMatch(render, /minHeight|loadingHeight|behavior:\s*"smooth"/);
  assert.match(styles, /\.feedback-conclusion[\s\S]*scroll-margin-(?:top|block)/);
});

test("teaching icons use routed image assets instead of CSS mask URLs", async () => {
  const [script, styles] = await Promise.all([
    readClientScript(),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(functionBody(script, "button"), /node\("img"/);
  assert.match(functionBody(script, "button"), /withPreviewRoute\(`\/assets\/icons\/\$\{icon\}\.svg`\)/);
  assert.doesNotMatch(styles, /mask-image:\s*url\("\/assets\/icons\//);
});

test("client never exposes evaluator labels or sends a struggling student to reflection", async () => {
  const script = await readClientScript();

  assert.doesNotMatch(script, /材料堆积|我的整体阅读|理解证据|事实依据状态|我现在确实做不到|state\.stage\s*=\s*"reflection"/);
});

test("client tells students failures are not their fault and preserves a retry", async () => {
  const script = await readClientScript();

  assert.match(script, /不是你答错了/);
  assert.match(script, /答案已保留/);
  assert.match(script, /原地重试/);
  assert.match(script, /lastRequest/);
});

test("profile reports the configured cloud storage instead of claiming a fixed backend", async () => {
  const script = await readClientScript();

  assert.match(functionBody(script, "initialState"), /storageMode:\s*"unknown"/);
  assert.match(functionBody(script, "renderProfile"), /cloudbase\+feishu/);
  assert.match(script, /state\.storageMode\s*=\s*result\.storageMode/);
});

test("client renders structured feedback instead of one undifferentiated block", async () => {
  const script = await readClientScript();

  assert.match(script, /function splitTeaching\(/);
  assert.match(functionBody(script, "coachBubble"), /splitTeaching\(item\.message\)/);
  assert.match(functionBody(script, "coachBubble"), /feedback-paragraph/);
  assert.match(script, /你已经说对的/);
  assert.match(script, /现在只补这一点/);
  assert.match(script, /给你讲清楚/);
  assert.match(script, /studentEvidence/);
  assert.match(script, /missingPoint/);
  assert.match(script, /这次补上的关键点/);
  assert.match(script, /complete:\s*result\.nextStage\s*===\s*"complete"/);
  assert.match(script, /completedPoint\s*=\s*item\.complete/);
  assert.match(script, /request\.action\s*===\s*"submit_attempt"\s*\?\s*"diagnosis"/);
  assert.match(functionBody(script, "coachBubble"), /我确实看了你的回答/);
  assert.match(functionBody(script, "coachBubble"), /open:\s*item\.kind\s*===\s*"diagnosis"/);

  const splitTeaching = clientFunction(script, "splitTeaching");
  assert.deepEqual(
    [...splitTeaching("理论理性限制知识边界，为自由留下可能。实践理性从道德法则出发，使自由成为必须预设的条件。")],
    [
      "理论理性限制知识边界，为自由留下可能。",
      "实践理性从道德法则出发，使自由成为必须预设的条件。"
    ]
  );

  assert.deepEqual(
    [...splitTeaching("先说结论：你已经抓住现象与物自体的区分。这里还要修正一点。康德并不是直接回答经验论与唯理论谁对。区分的作用是重新划定知识边界。这样也为自由留下位置。最后把这一关系写回原答案。")],
    [
      "先说结论：你已经抓住现象与物自体的区分。",
      "这里还要修正一点。康德并不是直接回答经验论与唯理论谁对。",
      "区分的作用是重新划定知识边界。这样也为自由留下位置。",
      "最后把这一关系写回原答案。"
    ]
  );
});


test("completion shows and copies only the four student-facing review layers", async () => {
  const script = await readClientScript();

  assert.match(script, /function formatExpressionNote\(/);
  assert.match(script, /async function copyText\(/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /copy-fallback/);
  assert.match(script, /expressionNote\s*=\s*result\.expressionNote/);
  for (const label of [
    "复制整份复习稿",
    "复制我的最终表达",
    "复制一种可行作答",
    "答题抓手",
    "答题思路",
    "一种可行作答",
  ]) {
    assert.match(script, new RegExp(label));
  }
  const noteView = functionBody(script, "expressionNoteView");
  const completion = functionBody(script, "completeComposer");
  for (const internalLabel of ["我的最初表达", "我已经说清楚的部分", "AI 补充的关键关系", "本轮建立的知识联系", "下次无提示复习题"]) {
    assert.doesNotMatch(noteView, new RegExp(internalLabel));
  }
  assert.doesNotMatch(completion, /compare-grid|一开始你写的|现在你能说的/);

  const formatExpressionNote = clientFunction(script, "formatExpressionNote");
  const text = formatExpressionNote({
    question: "题目",
    answerHook: "抓手",
    initialExpression: "初答",
    studentEvidence: "学生会的",
    aiSupplement: "AI 补充",
    answerStructure: ["第一步", "第二步", "第三步"],
    finalExpression: "终答",
    possibleAnswer: "可行作答",
    nextRecallQuestion: "复习题"
  });
  assert.match(text, /我的最终表达\n终答/);
  assert.match(text, /1\. 第一步\n2\. 第二步\n3\. 第三步/);
  for (const internalText of ["初答", "学生会的", "AI 补充", "复习题"]) {
    assert.equal(text.includes(internalText), false);
  }
  assert.equal(text.includes("undefined"), false);
});


test("completion keeps a next-question exit after the long review note", async () => {
  const script = await readClientScript();
  const completion = functionBody(script, "completeComposer");

  assert.match(completion, /本题已经保存，接下来/);
  assert.match(completion, /保存完成，继续下一题/);
  assert.equal(completion.indexOf("expressionNoteView") < completion.indexOf("保存完成，继续下一题"), true);
});


test("opening profile refreshes cloud mastery instead of showing stale zeros", async () => {
  const script = await readClientScript();
  const switcher = functionBody(script, "switchView");

  assert.match(switcher, /view\s*===\s*"profile"/);
  assert.match(switcher, /syncLearnerData\(\)/);
});


test("dashboard shows the real recommendation error instead of a vague empty state", async () => {
  const script = await readClientScript();
  const dashboard = functionBody(script, "renderToday");
  const emptyState = dashboard.indexOf('className: "empty-state"');
  const visibleError = dashboard.indexOf("errorNode()", emptyState);
  const retry = dashboard.indexOf("重新获取推荐", emptyState);

  assert.notEqual(emptyState, -1);
  assert.equal(visibleError > emptyState, true);
  assert.equal(retry > visibleError, true);
});


test("production verifier checks the real coach and learning dependencies before E2E", async () => {
  const script = await readFile(new URL("../scripts/verify-production.mjs", import.meta.url), "utf8");

  assert.match(script, /\/api\/health/);
  assert.match(script, /coachMode\s*!==\s*"real"/);
  assert.match(script, /\/api\/practice\/next/);
  assert.match(script, /\/api\/learner\/sync/);
});


async function readClientScript() {
  return readFile(new URL("../public/app.js", import.meta.url), "utf8");
}


function functionBody(script, functionName) {
  const start = script.indexOf(`function ${functionName}(`);
  const relativeNext = script.slice(start + 1).search(/\n(?:async )?function /);
  const next = relativeNext < 0 ? -1 : start + 1 + relativeNext;
  return script.slice(start, next < 0 ? script.length : next);
}


function clientFunction(script, functionName) {
  return vm.runInNewContext(`(${functionBody(script, functionName)})`);
}
