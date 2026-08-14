import { randomUUID } from "node:crypto";


export function createMemoryRecorder() {
  const records = new Map();
  return {
    enforceSessionState: true,
    records,
    async create(session) {
      const recordId = randomUUID();
      records.set(recordId, structuredClone(session));
      return recordId;
    },
    async update(recordId, session) {
      if (!recordId) throw new Error("缺少记录编号");
      records.set(recordId, structuredClone(session));
    },
    async get(recordId) {
      return records.has(recordId) ? structuredClone(records.get(recordId)) : null;
    },
    async listByParticipant(participantCode, limit = 30) {
      return [...records.entries()]
        .filter(([, record]) => record.participantCode === participantCode)
        .sort((a, b) => String(b[1].updatedAt || "").localeCompare(String(a[1].updatedAt || "")))
        .slice(0, limit)
        .map(([recordId, record]) => ({ ...structuredClone(record), _id: recordId }));
    }
  };
}
