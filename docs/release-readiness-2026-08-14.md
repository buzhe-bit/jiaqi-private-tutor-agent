# 小程序发布前行为验收

日期：2026-08-14

分支：`codex/wechat-miniprogram-mvp`

范围：教学行为分型、自由追问卡点入队、下一题创建、超时重试；安全隔离、身份校验和本地并发作为配套验收记录。

## 当前状态

- 小程序 AppID：`wxfa3953c780a246d8`。
- `miniprogram/config.js` 当前使用 `cloudbase` 模式，环境为 `first-001sijiao-d1fad71w28f4562b`，服务为 `philosophy-coach`。
- 行为验收 10/10 通过。
- 安全与身份校验配套测试 19/19 通过；其中本地内存模式下 20 个不同 session 并发完成且未发生跨学习者写入。
- 真实 CloudBase / DeepSeek 端到端链路尚未确认；本地并发通过不代表线上容量或稳定性已经验证。
- Mac 锁屏或微信开发者工具服务端口关闭时，新的预览二维码尚未重新生成。

## 验收结果

新增测试文件：[test/release-readiness.test.mjs](../test/release-readiness.test.mjs)，共 10 条验收：10 条通过。

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| 完全不会进入教学，不继续催答 | 通过 | `nextStage=teaching`，保存 `initialAnswer`，诊断为 `knowledge_missing` |
| 概念误解（把实践理性说成引入上帝） | 通过 | 诊断为 `concept_misunderstanding`，教学回到道德法则/自由关系 |
| 两层概念并列、关系断裂 | 通过 | 诊断为 `relation_broken`，只指出缺失的中轴关系 |
| 关键关系正确但表达散乱 | 通过 | 进入 `revision`，诊断为 `expression_scattered` |
| 首次提取前禁止参考作答 | 通过 | 未提交初答时返回不可重试的 `REQUEST_ERROR`，保留当前会话 |
| 首次提取后请求参考作答 | 通过 | 返回“一种可行作答”，阶段仍为 `teaching` |
| 连续表示没听懂更换讲法 | 通过 | 阶段保持 `teaching`，新讲法与上一轮不同，追问写入干预记录 |
| 自由追问形成卡点并进入到期复习队列 | 通过 | `followupQuestions` 持久化，`practice/next` 返回追问复习题 |
| 完成后下一题可创建新的初始会话 | 通过 | 推荐题与首题不同，新会话回到 `attempt` |
| 超时重试不丢草稿 | 通过 | 重试 payload 保留原输入、阶段、快照，成功后才清空草稿 |

## 已知边界与发布前置

1. 本记录确认的是本地可重复的业务行为；真实 CloudBase / DeepSeek 请求、云端数据持久化和线上容量仍需单独做端到端验收。
2. 20 并发不同 session 只覆盖本地内存模式下的隔离与并发逻辑，不代表线上可承载的并发量。
3. 在真实端到端链路和有效预览二维码确认前，不宣称小程序已经完成线上发布验收。

## 验证命令

- 行为验收：`node --test test/release-readiness.test.mjs` → 10 通过、0 失败。
- 安全与本地并发：`node --test test/security-load-release.test.mjs` → 13 通过、0 失败；其中包含 20 个不同 session 并发场景。
- 微信身份：`node --test test/wechat-identity.test.mjs` → 6 通过、0 失败。

本次文档修订仅更新状态记录，未修改生产代码、测试或配置。
