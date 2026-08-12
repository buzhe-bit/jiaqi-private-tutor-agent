import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";


function read(path) {
  return readFileSync(path, "utf8");
}


test("project opens from the repository root with a test app id", () => {
  const project = JSON.parse(read("project.config.json"));
  assert.equal(project.miniprogramRoot, "miniprogram/");
  assert.equal(project.appid, "touristappid");
});


test("app exposes three tabs and a separate training page", () => {
  const config = JSON.parse(read("miniprogram/app.json"));
  assert.equal(config.tabBar.list.length, 3);
  assert.deepEqual(config.tabBar.list.map((item) => item.text), ["今日", "记录", "我的"]);
  assert.ok(config.pages.includes("pages/training/training"));
  assert.equal(config.tabBar.list.some((item) => item.pagePath === "pages/training/training"), false);
});


test("today page distinguishes local demo and offers a recommended question", () => {
  const template = read("miniprogram/pages/today/today.wxml");
  assert.match(template, /本地演示/);
  assert.match(template, /开始这道题|继续这道题/);
  assert.match(template, /三题是基础量/);
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
});
