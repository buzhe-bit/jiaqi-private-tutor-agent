import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";


function read(path) {
  return readFileSync(path, "utf8");
}


test("project opens from the repository root with a test app id", () => {
  const project = JSON.parse(read("project.config.json"));
  assert.equal(project.miniprogramRoot, "miniprogram/");
  assert.equal(project.appid, "wxfa3953c780a246d8");
});


test("app exposes three tabs and a separate training page", () => {
  const config = JSON.parse(read("miniprogram/app.json"));
  assert.equal(config.tabBar.list.length, 3);
  assert.deepEqual(config.tabBar.list.map((item) => item.text), ["今日训练", "答题历史", "我的"]);
  for (const item of config.tabBar.list) {
    assert.ok(item.iconPath);
    assert.ok(item.selectedIconPath);
  }
  assert.ok(config.pages.includes("pages/training/training"));
  assert.equal(config.tabBar.list.some((item) => item.pagePath === "pages/training/training"), false);
});


test("today page distinguishes local demo and offers a recommended question", () => {
  const template = read("miniprogram/pages/today/today.wxml");
  assert.match(template, /本地演示/);
  assert.match(template, /开始这道题|继续这道题/);
  assert.match(template, /三题是基础量/);
  assert.match(template, /用户隐私保护指引/);
  assert.match(template, /同意并继续/);
  assert.match(template, /disabled="\{\{!privacyAccepted\}\}"/);
});


test("history and profile expose student-facing learning records", () => {
  const history = read("miniprogram/pages/history/history.wxml");
  const profile = read("miniprogram/pages/profile/profile.wxml");
  assert.match(history, /我的最终表达/);
  assert.match(history, /一种可行作答/);
  assert.match(profile, /待复习/);
  assert.match(profile, /最近卡点/);
  assert.doesNotMatch(profile, /diagnosis|learnerNeed|issueType/);
});


test("global styles protect narrow screens from horizontal overflow", () => {
  const styles = read("miniprogram/app.wxss");
  assert.match(styles, /box-sizing:\s*border-box/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /max-width:\s*100%/);
  assert.match(styles, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
});


test("training page uses a native movable tutor and a bottom question sheet", () => {
  const template = read("miniprogram/pages/training/training.wxml");
  const behavior = read("miniprogram/pages/training/training.js");
  const styles = read("miniprogram/pages/training/training.wxss");
  assert.match(template, /<movable-area/);
  assert.match(template, /<movable-view/);
  assert.match(template, /bindchange="onCoachMove"/);
  assert.match(template, /class="coach-sheet/);
  assert.match(styles, /\.coach-movable-area/);
  assert.match(styles, /\.coach-sheet/);
  assert.match(behavior, /coach-position/);
  assert.match(behavior, /scrollToLatestFeedback/);
  assert.match(template, /latest-feedback/);
  assert.doesNotMatch(template, /feedback-end/);
});


test("tutor and review content supports partial copy", () => {
  const template = read("miniprogram/pages/training/training.wxml");
  for (const content of [
    "{{item.studentEvidence}}",
    "{{item.missingPoint}}",
    "{{item.focus}}",
    "{{item.knowledgeConnection}}",
    "{{expressionNote.answerHook}}",
    "{{expressionNote.finalExpression}}",
    "{{expressionNote.possibleAnswer}}"
  ]) {
    assert.match(template, new RegExp(`user-select="true"[^>]*>${content.replace(/[{}]/g, "\\$&")}</text>`));
  }
  assert.match(template, /class="message-paragraph" user-select="true"/);
  assert.match(template, /class="message-paragraph teaching-paragraph [^"]*" user-select="true"/);
});


test("training typography keeps long tutor answers readable", () => {
  const template = read("miniprogram/pages/training/training.wxml");
  const styles = read("miniprogram/pages/training/training.wxss");
  assert.match(template, /message-paragraph/);
  assert.match(styles, /line-height:\s*1\.7/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(styles, /white-space:\s*nowrap/);
});
