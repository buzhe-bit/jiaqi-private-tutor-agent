# 通用哲学学习私教 V2 实施计划

> **执行要求：** 按 `superpowers:test-driven-development` 逐项实现；每个核心行为先写失败测试，再写最小代码。执行本计划时使用 `superpowers:executing-plans`，不另建应用、不安装依赖。

**目标：** 在不破坏现有单题陪练的前提下，形成“结构化卡点 → 个人掌握状态 → 延迟复习 → 自由下一题”的最小长期学习闭环。

**架构：** `coach_sessions` 继续保存完整训练证据；新增轻量 `learner_mastery` 与 `question_bank` 存储接口。诊断和调度核心写成无副作用纯函数，CloudBase 只负责持久化；前端只增加推荐题、题型标签、今日完成数与继续下一题。

**技术栈：** Node.js 20、原生 Web API、CloudBase Database HTTP API、原生浏览器 JavaScript、`node:test`。不新增包。

**全局约束：** 保持现有 API 与四阶段体验兼容；不修改飞书表结构；不部署线上；以 10 条行为样例为主验收，并回归当前 91 条 Node 测试与 9 条 Skill 契约测试。

---

## Task 1：锁定 10 条长期行为契约

**文件：**
- 新建：`test/fixtures/learning-loop-scenarios.json`
- 新建：`test/learning-loop-behaviors.test.mjs`
- 修改：`test/adapters.test.mjs`

**步骤：**

1. 写入 10 条固定样例：完全不会、概念误解、关系断裂、表达散乱、不同但合理、本轮初步掌握、三天后不稳定、七天后稳定、自由序列、服务/依据失败。
2. 为每条样例声明 `expectedIssueType`、`expectedMasteryStatus`、`expectedReviewAfterDays`、`expectedVisibleBehavior`。
3. 先写契约测试，验证夹具数量、枚举合法性和每条样例都包含学生输入、数据库变化与下一题预期。
4. 在 `test/adapters.test.mjs` 增加模型诊断字段缺失、非法枚举和低置信度不得稳定三个失败测试。
5. 运行：`node --test test/learning-loop-behaviors.test.mjs test/adapters.test.mjs`，确认新测试先失败在诊断契约上。

## Task 2：扩展诊断契约，移除字数放行

**文件：**
- 修改：`src/coach/response-contract.mjs`
- 修改：`src/coach/prompt.mjs`
- 修改：`src/coach/providers.mjs`
- 修改：`src/app.mjs`
- 测试：`test/adapters.test.mjs`
- 测试：`test/coaching-flow-v2.test.mjs`

**步骤：**

1. 在 `normalizeCoachResponse` 中新增内部 `diagnosis`，只接受六类 `issueType`、三类 `masteryStatus`、三类依据状态和三档置信度。
2. 保留 `studentFacingFeedback` 的当前字段，不把内部诊断枚举透传给学生。
3. 更新真实模型提示词：诊断必须引用学生证据；合理但不同的解释不能因措辞不同判错；精确出处不足时返回 `unverified`。
4. 给 mock provider 的代表性分支补齐结构化诊断，使自动化测试稳定。
5. 删除 `hasObservableRewrite` 与“20 字且不同即可强制 CLOSE_LOOP”的覆盖逻辑；只有模型确认存在真实改善、无核心误解且诊断完整时完成。
6. 把 `diagnosis`、`masteryKey`、`masterySyncStatus`、`reviewContext` 写入 `sessionRecord`，学生同步接口不返回内部诊断全文。
7. 运行：`node --test test/adapters.test.mjs test/coaching-flow-v2.test.mjs test/api.test.mjs`。

## Task 3：实现个人掌握状态纯函数

**文件：**
- 新建：`src/learning/mastery.mjs`
- 新建：`test/mastery.test.mjs`

**步骤：**

1. 先测试 `masteryIdFor`：同一学生与同一知识关系得到稳定 ID，不同学生不混档。
2. 先测试 `nextReviewAt`：未掌握/误解/延迟失败为 1 天，初步掌握为 3 天，三天稳定为 7 天，七天稳定为 14 天。
3. 先测试 `applyMasteryEvent`：以 `sessionId` 幂等；`recentEvents` 最多 10 条；重复提交不增加 `attemptCount`。
4. 实现 `buildMasteryEvent({ session, diagnosis, now })`，只提取初答、证据、干预、改进表达和延迟结果，不复制整段聊天。
5. 低置信度诊断不能把状态提升到 `stable`；服务失败不生成事件。
6. 运行：`node --test test/mastery.test.mjs`。

## Task 4：复用 CloudBase HTTP 层，增加学习档案存储

**文件：**
- 修改：`src/records/cloudbase-recorder.mjs`
- 新建：`src/records/learning-store.mjs`
- 修改：`src/records/index.mjs`
- 修改：`src/config.mjs`
- 修改：`.env.example`
- 新建：`test/learning-store.test.mjs`

**步骤：**

1. 从现有 recorder 提取并导出最小 `createCloudBaseCollection`，提供 `get`、`upsert`、`list(query, order, limit)`；原 `createCloudBaseRecorder` 改为复用它，确保旧测试不变。
2. 实现 `createMemoryLearningStore` 与 `createCloudBaseLearningStore`，接口固定为：`getMastery`、`listMasteryByParticipant`、`upsertMastery`、`listQuestions`、`upsertQuestion`。
3. 默认集合名为 `learner_mastery` 与 `question_bank`；只增加环境变量名，不执行远程建表或部署。
4. 用内存 store 测试幂等更新、学生隔离、到期筛选和题目缓存；用 fake fetch 测试 CloudBase 请求路径。
5. 运行：`node --test test/cloudbase-recorder.test.mjs test/learning-store.test.mjs`。

## Task 5：在完成会话后同步掌握档案

**文件：**
- 修改：`src/app.mjs`
- 修改：`src/server.mjs`
- 修改：`src/records/index.mjs`
- 新建：`test/mastery-sync.test.mjs`

**步骤：**

1. 给 `createApp` 注入可选 `learningStore`，给 `startServer` 注入 `createLearningStore(config)`；memory 模式也可完整运行。
2. 学生完成本轮时先把 `coach_sessions.masterySyncStatus` 写为 `pending`，再幂等更新掌握档案，成功后改为 `complete`。
3. 掌握档案写入失败不得阻塞完成页；完整答案仍在会话中，状态保持 `pending`。
4. `/api/learner/sync` 和下一题请求会重试该学生最近的 pending 会话；同一 `sessionId` 不重复累计。
5. 测试完整成功、掌握写入失败、重试成功、重复请求四条链路。
6. 运行：`node --test test/mastery-sync.test.mjs test/api.test.mjs`。

## Task 6：把现有题目变成题库种子，并生成复习变式

**文件：**
- 修改：`src/questions.mjs`
- 新建：`src/learning/review-question.mjs`
- 新建：`test/question-bank.test.mjs`

**步骤：**

1. 给现有题目增加 `subject`、`topic`、`concepts`、`knowledgeRelations`、`questionKind`、`origin`、`sourceStatus`、`sourceLabel`、`reviewStatus`。
2. 导出 `questionSeeds()`，服务启动/首次使用时按 `questionId` 幂等写入 `question_bank`。
3. 先实现无模型依赖的复习变式：根据原题 `nextRecallQuestion` 与旧卡点生成 `review-*` 题，保存 `parentQuestionId` 和 `reviewContext`。
4. 给真实 coach 增加可选 `generateReviewQuestion`；调用失败或结果不合法时退回确定性变式，不出现空白题单。
5. AI 生成题标记 `origin: ai_variant`、`reviewStatus: unreviewed`、`sourceStatus: ai_synthesized`，不能显示为历年真题。
6. 运行：`node --test test/question-bank.test.mjs test/continuous-learning.test.mjs`。

## Task 7：实现带约束的自由序列选择器

**文件：**
- 新建：`src/learning/practice-selector.mjs`
- 新建：`test/practice-selector.test.mjs`

**步骤：**

1. 先写确定性测试并注入 `random`：到期不稳定题权重最高；稳定题降权；最近同题排除。
2. 实现硬约束：有到期复习时前三题至少一道复习；同类最多连续两道；同题短期不重复；无复习时由新题/关系题补位。
3. 返回 `{ question, questionKind, reason, todayCompleted, baseTargetReached }`；第三题后 `baseTargetReached: true`，但仍返回下一题。
4. 候选不足时从题库中选择最久未见题，不返回 `null`；只有题库完全为空才报可解释错误。
5. 运行：`node --test test/practice-selector.test.mjs`。

## Task 8：接入 `/api/practice/next` 与前端最小改造

**文件：**
- 修改：`src/app.mjs`
- 修改：`public/app.js`
- 修改：`public/styles.css`
- 修改：`test/api.test.mjs`
- 修改：`test/continuous-learning.test.mjs`

**步骤：**

1. 新增 `POST /api/practice/next`：校验邀请码，读取最近会话、掌握档案和题库，重试 pending 同步后调用 selector。
2. 今日页由固定三题清单改为“当前推荐题＋标签＋推荐原因＋今日完成数”；保留历史、恢复未完成会话和原四阶段训练。
3. “继续下一题”始终请求服务端推荐，不再使用数组下标；第三题后显示“今日基础训练完成，还可以继续”，不显示每日上限。
4. “我的”页仅增加待复习数与最近卡点自然语言摘要，不增加日历或知识地图。
5. 请求失败时保留完成页和上一题表达笔记，提供原地重试。
6. 运行：`node --test test/api.test.mjs test/continuous-learning.test.mjs test/server.test.mjs`。

## Task 9：完整验收与本地预览

**文件：**
- 修改：`README.md`
- 修改：`docs/pilot-runbook.md`
- 可选新增：`design-qa/learning-coach-v2/`

**步骤：**

1. 运行长期行为样例：`node --test test/learning-loop-behaviors.test.mjs test/mastery.test.mjs test/mastery-sync.test.mjs test/practice-selector.test.mjs`。
2. 运行完整回归：`npm test`。
3. 运行 Skill 契约：`python3 -m unittest discover -s tests/philosophy_answer_coach -p 'test_*.py'`。
4. 运行覆盖率：`npm run test:coverage`；覆盖率只作辅助，10 条行为样例必须全部通过。
5. 在 `390×844` 与 `700×570` 验证：推荐题可见、三题后可继续、历史可返回、加载不跳动、完成页保留“我的最终表达”和“一种可行作答”。
6. 更新 README 和试用手册，明确 CloudBase 三个集合的关系、个人档案位置、当前不包含完整 RAG。
7. 不部署、不创建远程集合；本地预览和数据结构确认后再由佳琦决定灰度发布。

