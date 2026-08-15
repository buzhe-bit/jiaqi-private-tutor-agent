import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";


const require = createRequire(import.meta.url);
const config = require("../miniprogram/config.js");


test("小程序发布配置指向真实 CloudBase 服务且不携带客户端密钥", () => {
  const project = JSON.parse(readFileSync("project.config.json", "utf8"));

  assert.equal(project.appid, "wxfa3953c780a246d8");
  assert.equal(config.mode, "cloudbase");
  assert.equal(config.transport, "public");
  assert.equal(config.publicBaseUrl, "https://philosophy-coach-4202431-1454163072.ap-shanghai.run.tcloudbase.com");
  assert.equal(config.cloudbaseEnv, "first-001sijiao-d1fad71w28f4562b");
  assert.equal(config.cloudbaseService, "philosophy-coach");
  assert.equal(config.inviteCode, "");
  assert.deepEqual(Object.keys(config).sort(), [
    "cloudbaseEnv",
    "cloudbaseService",
    "inviteCode",
    "mode",
    "publicBaseUrl",
    "transport"
  ]);
  assert.equal(Object.keys(config).some((key) => /api.?key|secret/i.test(key)), false);
});
