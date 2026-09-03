const https = require("https");

const BASE_URL = "https://philosophy-coach-4202431-1454163072.ap-shanghai.run.tcloudbase.com";
const ROUTES = new Set([
  "GET /api/health",
  "POST /api/events",
  "POST /api/learner/sync",
  "POST /api/practice/next",
  "POST /api/session/start",
  "POST /api/session/step"
]);

function forward({ method, path, data }) {
  return new Promise((resolve, reject) => {
    const body = method === "POST" ? JSON.stringify(data || {}) : "";
    const request = https.request(`${BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let parsed;
        try { parsed = text ? JSON.parse(text) : {}; }
        catch { parsed = { error: "私教服务返回异常，请稍后重试。", code: "UPSTREAM_INVALID_RESPONSE" }; }
        resolve({ statusCode: response.statusCode || 502, data: parsed });
      });
    });
    request.setTimeout(55000, () => request.destroy(new Error("upstream timeout")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function createHandler(requestUpstream = forward) {
  return async function main(event = {}) {
    const method = String(event.method || "GET").toUpperCase();
    const path = String(event.path || "");
    if (!ROUTES.has(`${method} ${path}`)) {
      return { statusCode: 404, data: { error: "接口不存在", code: "ROUTE_NOT_ALLOWED" } };
    }
    try {
      return await requestUpstream({ method, path, data: event.data || {} });
    } catch {
      return {
        statusCode: 503,
        data: { error: "私教服务暂时没有接上，不是你答错了，请原地重试。", code: "PROXY_UPSTREAM_ERROR", retryable: true }
      };
    }
  };
}

exports.createHandler = createHandler;
exports.main = createHandler();
