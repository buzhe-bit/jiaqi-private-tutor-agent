import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createApi } = require("../miniprogram/services/api.js");

test("mini program sends real tutor requests through the cloud1 proxy", async () => {
  const calls = [];
  const api = createApi({
    wxApi: {
      cloud: {
        async callFunction(options) {
          calls.push(options);
          return { result: { statusCode: 200, data: { participantCode: "P10" } } };
        }
      }
    },
    config: {
      mode: "cloudbase",
      transport: "cloud-function",
      proxyFunction: "philosophyApiProxy"
    }
  });

  assert.deepEqual(await api.post("/api/learner/sync", { inviteCode: "trial-10" }), {
    participantCode: "P10"
  });
  assert.deepEqual(calls, [{
    name: "philosophyApiProxy",
    data: {
      method: "POST",
      path: "/api/learner/sync",
      data: { inviteCode: "trial-10" }
    }
  }]);
});

test("cloud1 proxy preserves invalid invite errors and rejects unknown routes", async () => {
  const calls = [];
  const { createHandler } = require("../cloudfunctions/philosophyApiProxy/index.js");
  const main = createHandler(async (request) => {
    calls.push(request);
    return {
      statusCode: 401,
      data: { error: "试用码无效", code: "INVITE_INVALID", retryable: false }
    };
  });

  assert.deepEqual(await main({
    method: "POST",
    path: "/api/learner/sync",
    data: { inviteCode: "bad" }
  }), {
    statusCode: 401,
    data: { error: "试用码无效", code: "INVITE_INVALID", retryable: false }
  });
  assert.equal(calls.length, 1);

  const blocked = await main({ method: "POST", path: "/admin/delete", data: {} });
  assert.equal(blocked.statusCode, 404);
  assert.equal(calls.length, 1);
});
