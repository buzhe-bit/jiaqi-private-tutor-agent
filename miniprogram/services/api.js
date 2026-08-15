function studentSafeError(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const statusCode = Number(source.statusCode || source.status || 0) || null;
  const message = source.error
    || source.message
    || source.errMsg
    || "这次服务没有接上。不是你答错了，内容已经保留，可以原地重试。";
  const timeout = source.code === "REQUEST_TIMEOUT" || /timeout|超时/i.test(String(source.errMsg || source.message || ""));
  const error = Object.assign(new Error(message), {
    code: timeout ? "REQUEST_TIMEOUT" : (source.code || "SERVICE_UNAVAILABLE"),
    retryable: source.retryable !== false,
    preserved: true
  });
  if (statusCode) {
    error.statusCode = statusCode;
    error.status = statusCode;
  }
  return error;
}

function publicUrl(baseUrl, path) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const suffix = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  return `${base}${suffix}`;
}

function requestWithWx(wxApi, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };
    try {
      const requestTask = wxApi.request({
        ...options,
        success(response) { finish(resolve, response); },
        fail(error) { finish(reject, error); }
      });
      // A small thenable bridge keeps unit-test doubles convenient while the
      // native wx.request callback contract remains the primary path.
      if (requestTask && typeof requestTask.then === "function") {
        requestTask.then(
          (response) => finish(resolve, response),
          (error) => finish(reject, error)
        );
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}

function responseData(response) {
  const status = Number(response?.statusCode || 200);
  if (status >= 200 && status < 300) return response?.data;
  const data = response?.data && typeof response.data === "object"
    ? { ...response.data }
    : { error: response?.data };
  throw studentSafeError({ ...data, statusCode: status });
}

function createApi({ wxApi, config, demoAdapter }) {
  async function request(method, path, data) {
    if (config.mode === "local-demo") {
      if (!demoAdapter) throw studentSafeError({ code: "DEMO_NOT_READY" });
      return demoAdapter.request(method, path, data || {});
    }

    if (config.transport === "public" || config.transport === "wx-request") {
      if (!wxApi?.request || !String(config.publicBaseUrl || "").trim()) {
        throw studentSafeError({
          code: "PUBLIC_API_NOT_READY",
          error: "公网私教服务还没有配置好，当前不能使用真实私教。"
        });
      }
      try {
        const response = await requestWithWx(wxApi, {
          url: publicUrl(config.publicBaseUrl, path),
          method,
          timeout: Number(config.requestTimeout || 15000),
          header: { "content-type": "application/json" },
          data: data || {}
        });
        return responseData(response);
      } catch (error) {
        if (error?.preserved) throw error;
        throw studentSafeError(error);
      }
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
      return responseData(response);
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
