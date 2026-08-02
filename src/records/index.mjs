import { createFeishuBaseRecorder } from "./feishu-base-recorder.mjs";
import { createMemoryRecorder } from "./memory-recorder.mjs";


export function createRecorder(config) {
  if (config.recordProvider === "feishu") {
    return createFeishuBaseRecorder(config.feishu);
  }
  return createMemoryRecorder();
}
