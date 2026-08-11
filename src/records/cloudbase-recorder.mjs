const DEFAULT_COLLECTION = "coach_sessions";


function fromEjson(value) {
  if (Array.isArray(value)) return value.map(fromEjson);
  if (!value || typeof value !== "object") return value;
  if ("$numberInt" in value || "$numberLong" in value) {
    return Number(value.$numberInt ?? value.$numberLong);
  }
  if ("$oid" in value) return value.$oid;
  if ("$date" in value) {
    const milliseconds = value.$date?.$numberLong ?? value.$date;
    return new Date(Number(milliseconds)).toISOString();
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromEjson(item)]));
}


export function createCloudBaseCollection({
  envId,
  apiKey,
  collectionName = DEFAULT_COLLECTION,
  fetchImpl = fetch
}) {
  if (!envId || !apiKey) throw new Error("CloudBase 数据库缺少环境 ID 或服务端 API Key");
  const baseUrl = `https://${envId}.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)`;
  const collectionUrl = `${baseUrl}/collections/${encodeURIComponent(collectionName)}/documents`;

  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...options.headers
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(data.message || "CloudBase 数据库暂时不可用"), {
        code: data.code || "CLOUDBASE_DATABASE_ERROR",
        status: response.status
      });
    }
    return fromEjson(data);
  }

  async function upsert(recordId, data, replaceMode = true) {
    await request(`${collectionUrl}/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      body: JSON.stringify({ data, replaceMode, upsert: true })
    });
  }

  return {
    upsert,
    async get(recordId) {
      try {
        return await request(`${collectionUrl}/${encodeURIComponent(recordId)}`);
      } catch (error) {
        if (error.code === "DOCUMENT_NOT_FOUND") return null;
        throw error;
      }
    },
    async list(query = {}, order = [], limit = 100) {
      const params = new URLSearchParams({
        query: JSON.stringify(query),
        limit: String(Math.min(limit, 100))
      });
      if (order.length) params.set("order", JSON.stringify(order));
      const result = await request(`${collectionUrl}?${params}`);
      return Array.isArray(result.list) ? result.list : [];
    }
  };
}


export function createCloudBaseRecorder(options) {
  const collection = createCloudBaseCollection(options);

  return {
    async create(session) {
      await collection.upsert(session.sessionId, session);
      return session.sessionId;
    },
    async update(recordId, session) {
      await collection.upsert(recordId, session);
    },
    get: collection.get,
    async linkMirror(recordId, mirrorRecordId) {
      await collection.upsert(recordId, { mirrorRecordId }, false);
    },
    async listByParticipant(participantCode, limit = 30) {
      return collection.list(
        { participantCode },
        [{ field: "updatedAt", direction: "desc" }],
        limit
      );
    }
  };
}


export function createMirroredRecorder(primary, mirror, logger = console) {
  async function warnOnce(operation, error) {
    logger.warn(`飞书镜像${operation}失败，CloudBase 主记录已保留：${error.code || error.message}`);
  }

  return {
    async create(session) {
      const recordId = await primary.create(session);
      try {
        const mirrorRecordId = await mirror.create(session);
        await primary.linkMirror?.(recordId, mirrorRecordId);
      } catch (error) {
        await warnOnce("创建", error);
      }
      return recordId;
    },
    async update(recordId, session) {
      await primary.update(recordId, session);
      const stored = await primary.get?.(recordId);
      if (!stored?.mirrorRecordId) return;
      try {
        await mirror.update(stored.mirrorRecordId, session);
      } catch (error) {
        await warnOnce("更新", error);
      }
    },
    listByParticipant(participantCode, limit) {
      return primary.listByParticipant(participantCode, limit);
    },
    get(recordId) {
      return primary.get?.(recordId);
    }
  };
}
