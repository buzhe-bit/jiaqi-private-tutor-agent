import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";


const require = createRequire(import.meta.url);
const config = require("../miniprogram/config.js");


test("小程序发布配置通过可见的 cloud1 云函数访问真实私教且不携带客户端密钥", () => {
  const project = JSON.parse(readFileSync("project.config.json", "utf8"));

  assert.equal(project.appid, "wxfa3953c780a246d8");
  assert.equal(config.mode, "cloudbase");
  assert.equal(config.transport, "cloud-function");
  assert.equal(config.cloudbaseEnv, "cloud1-d9gvu4fxq696d96be");
  assert.equal(config.proxyFunction, "philosophyApiProxy");
  assert.equal(config.inviteCode, "");
  assert.deepEqual(Object.keys(config).sort(), [
    "cloudbaseEnv",
    "inviteCode",
    "mode",
    "proxyFunction",
    "transport"
  ]);
  assert.equal(Object.keys(config).some((key) => /api.?key|secret/i.test(key)), false);
});
