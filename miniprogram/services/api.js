function studentSafeError(value = {}) {
  const message = value.error || value.message || "这次服务没有接上。不是你答错了，内容已经保留，可以原地重试。";
  return Object.assign(new Error(message), {
    code: value.code || "SERVICE_UNAVAILABLE",
    retryable: value.retryable !== false,
    preserved: true
  });
}

function createApi({ wxApi, config, demoAdapter }) {
  async function request(method, path, data) {
    if (config.mode === "local-demo") {
      if (!demoAdapter) throw studentSafeError({ code: "DEMO_NOT_READY" });
      return demoAdapter.request(method, path, data || {});
    }

    if (!wxApi?.cloud?.callContainer) {
      throw studentSafeError({
        code: "CLOUDBASE_NOT_READY",
        error: "小程序还没有关联 CloudBase 环境，当前不能使用真实私教。"
      });
    }

    try {
      const response = await wxApi.cloud.callContainer({
        config: { env: config.cloudbaseEnv },
        path,
        method,
        header: {
          "X-WX-SERVICE": config.cloudbaseService,
          "content-type": "application/json"
        },
        data: data || {}
      });
      const status = Number(response.statusCode || 200);
      if (status < 200 || status >= 300) throw studentSafeError(response.data || {});
      return response.data;
    } catch (error) {
      if (error?.preserved) throw error;
      throw studentSafeError(error);
    }
  }

  return {
    get(path) {
      return request("GET", path);
    },
    post(path, body) {
      return request("POST", path, body);
    }
  };
}

module.exports = { createApi, studentSafeError };
