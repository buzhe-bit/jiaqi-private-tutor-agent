import { createCloudBaseRecorder, createMirroredRecorder } from "./cloudbase-recorder.mjs";
import { createFeishuBaseRecorder } from "./feishu-base-recorder.mjs";
import { createMemoryRecorder } from "./memory-recorder.mjs";


export function createRecorder(config) {
  if (config.recordProvider === "cloudbase") {
    const primary = createCloudBaseRecorder({
      envId: config.cloudbaseEnvId,
      apiKey: config.cloudbaseApiKey,
      collectionName: config.cloudbaseDatabaseCollection
    });
    return config.mirrorProvider === "feishu"
      ? createMirroredRecorder(primary, createFeishuBaseRecorder(config.feishu))
      : primary;
  }
  if (config.recordProvider === "feishu") {
    return createFeishuBaseRecorder(config.feishu);
  }
  return createMemoryRecorder();
}
