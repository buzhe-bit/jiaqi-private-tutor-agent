import { randomUUID } from "node:crypto";


export function createMemoryRecorder() {
  const records = new Map();
  return {
    records,
    async create(session) {
      const recordId = randomUUID();
      records.set(recordId, structuredClone(session));
      return recordId;
    },
    async update(recordId, session) {
      if (!recordId) throw new Error("缺少记录编号");
      records.set(recordId, structuredClone(session));
    }
  };
}
