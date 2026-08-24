# 小程序发布前行为验收

初始记录日期：2026-08-14；线上补充核验：2026-08-24

分支：`codex/wechat-miniprogram-mvp`

范围：教学行为分型、自由追问卡点入队、下一题创建、超时重试；安全隔离、身份校验和本地并发作为配套验收记录。

## 当前状态

- 小程序 AppID：`wxfa3953c780a246d8`。
- `miniprogram/config.js` 当前使用 `cloudbase` 模式，环境为 `first-001sijiao-d1fad71w28f4562b`，服务为 `philosophy-coach`。
- 行为验收 10/10 通过。
- 安全与身份校验配套测试 19/19 通过；其中本地内存模式下 20 个不同 session 并发完成且未发生跨学习者写入。
- 2026-08-24 已确认真实 CloudBase / DeepSeek 主链路：`health=200` 且 `coachMode=real`；`learner/sync=200`；`practice/next=200`；复用 `attempt` 会话提交“我不知道”后 `session/step=200` 并进入 `teaching`，反馈为非空多段真实模型讲解。
- 全量测试 `276/276` 通过；微信开发者工具在合法域名校验开启时成功拉取题目并进入训练页。
- 2026-08-24 微信开发者工具已生成开发版预览二维码，二维码可见且标明有效期；仍需佳琦扫码确认真机打开。该二维码不是普通学员体验版入口，微信后台体验版状态仍未由工具确认。

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

1. 真实 CloudBase / DeepSeek 主链路已完成一次端到端核验；本地并发通过不代表线上容量或稳定性已经验证。
2. 20 并发不同 session 只覆盖本地内存模式下的隔离与并发逻辑，不代表线上可承载的并发量。
3. 开发版预览二维码已由微信开发者工具生成，但仍需佳琦扫码确认真机打开；该二维码不是普通学员体验版入口，微信后台体验版状态仍未由工具确认，在此之前不宣称小程序已经完成线上发布验收。

## 验证命令

- 行为验收：`node --test test/release-readiness.test.mjs` → 10 通过、0 失败。
- 安全与本地并发：`node --test test/security-load-release.test.mjs` → 13 通过、0 失败；其中包含 20 个不同 session 并发场景。
- 微信身份：`node --test test/wechat-identity.test.mjs` → 6 通过、0 失败。

本次文档修订仅更新状态记录，未修改生产代码、测试或配置。
