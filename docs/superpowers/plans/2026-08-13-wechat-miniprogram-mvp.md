# 微信小程序 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可导入微信开发者工具、无正式 AppID 也能在本地完整跑通哲学私教闭环的原生小程序。

**Architecture:** 新增 `miniprogram/` 原生前端，页面只管理展示和草稿，业务判断继续由现有服务端状态机负责。`services/api.js` 在 `local-demo` 下调用确定性演示适配器，在 `cloudbase` 下调用 `wx.cloud.callContainer`；两种模式返回相同契约。

**Tech Stack:** 微信原生小程序 JavaScript/WXML/WXSS、Node.js 内置测试、现有 Node + CloudBase + DeepSeek 后端；无新增 npm 依赖。

## Global Constraints

- 本轮不修改线上服务、CloudBase 集合、飞书表结构、权限或付费资源。
- 本地演示必须明确标记为固定样例，不得声称调用 DeepSeek。
- DeepSeek API Key 只留在服务端，不能进入小程序代码或配置。
- 暂不实现语音、OCR、教材上传、RAG、支付、订阅消息和复杂登录。
- 保留四步进度、逐步展开梅花、三类帮助动作、浮动私教和表达笔记。
- 先验证约 `390×844`，再检查 `700×570`；不得横向溢出或遮挡主操作。

---

## File Map

```text
project.config.json                         微信开发者工具入口，使用测试 AppID
project.private.config.json.example         正式 AppID 的本地配置说明
miniprogram/app.*                           全局启动、模式初始化、公共视觉变量
miniprogram/config.js                       local-demo/cloudbase 唯一配置点
miniprogram/services/api.js                 统一 API 和错误标准化
miniprogram/services/demo-adapter.js        本地确定性完整学习闭环
miniprogram/core/session.js                 训练状态、阶段动作、草稿保护
miniprogram/utils/storage.js                学员设置、当前会话、历史记录
miniprogram/utils/format.js                 文本分段、阶段和题型文案
miniprogram/pages/today/*                   今日推荐和继续下一题
miniprogram/pages/training/*                四阶段训练、帮助和浮动私教
miniprogram/pages/history/*                 答题历史与表达笔记详情
miniprogram/pages/profile/*                 个人学习档案
miniprogram/assets/*                        复用梅花与帮助图标
test/miniprogram-*.test.mjs                 适配器、状态和行为样例测试
```

### Task 1: 统一请求契约与本地演示适配器

**Files:**
- Create: `miniprogram/config.js`
- Create: `miniprogram/services/api.js`
- Create: `miniprogram/services/demo-adapter.js`
- Create: `test/miniprogram-api.test.mjs`

**Interfaces:**
- Produces: `createApi({ wxApi, config, demoAdapter })`，包含 `get(path)` 与 `post(path, body)`。
- Produces: `createDemoAdapter()`，包含 `request(method, path, body)` 和 `reset()`。
- Error shape: `{ code, message, retryable, preserved }`。

- [ ] **Step 1: 写失败测试**

```js
test("local demo exposes health, recommendation and session start", async () => {
  const api = createApi({ config: { mode: "local-demo" }, demoAdapter: createDemoAdapter() });
  assert.equal((await api.get("/api/health")).coachMode, "demo");
  const next = await api.post("/api/practice/next", { inviteCode: "demo" });
  const session = await api.post("/api/session/start", { inviteCode: "demo", questionId: next.questionId });
  assert.equal(session.stage, "attempt");
});
```

- [ ] **Step 2: 运行测试并确认缺少模块而失败**

Run: `node --test test/miniprogram-api.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现最小双模式适配器**

`api.js` 在 `local-demo` 直接调用适配器；在 `cloudbase` 调用：

```js
wx.cloud.callContainer({
  config: { env: config.cloudbaseEnv },
  path,
  method,
  header: { "X-WX-SERVICE": config.cloudbaseService, "content-type": "application/json" },
  data
});
```

演示适配器覆盖健康检查、题目推荐、同步、开始、步骤和完成接口，并使用显式 `coachMode: "demo"`。

- [ ] **Step 4: 验证适配器测试通过**

Run: `node --test test/miniprogram-api.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add miniprogram/config.js miniprogram/services test/miniprogram-api.test.mjs
git commit -m "feat: add mini program api adapters"
```

### Task 2: 训练状态与本地数据保护

**Files:**
- Create: `miniprogram/core/session.js`
- Create: `miniprogram/utils/storage.js`
- Create: `miniprogram/utils/format.js`
- Create: `test/miniprogram-session.test.mjs`

**Interfaces:**
- Produces: `createTrainingState(session)`。
- Produces: `beginRequest(state, request)`、`applyStepResult(state, result, request)`、`failRequest(state, error)`。
- Produces: `archiveSession(storage, entry)`、`readHistory(storage)`、`saveDraft(storage, draft)`。

- [ ] **Step 1: 写失败测试覆盖草稿与阶段**

```js
test("a failed request preserves draft and stage", () => {
  const before = beginRequest(createTrainingState({ stage: "restate" }), { input: "我的复述" });
  const after = failRequest(before, { message: "超时", retryable: true });
  assert.equal(after.stage, "restate");
  assert.equal(after.draft, "我的复述");
  assert.equal(after.error.retryable, true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test test/miniprogram-session.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现纯函数状态转换与存储封装**

状态只含 `stage / draft / messages / feedback / snapshot / expressionNote / request / error`；请求失败只更新 `error`，成功后才清空对应草稿。历史最多保存 100 条并按完成时间倒序。

- [ ] **Step 4: 验证测试通过**

Run: `node --test test/miniprogram-session.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add miniprogram/core miniprogram/utils test/miniprogram-session.test.mjs
git commit -m "feat: protect mini program learning state"
```

### Task 3: 小程序外壳、今日训练和个人档案

**Files:**
- Create: `project.config.json`
- Create: `project.private.config.json.example`
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/pages/today/*`
- Create: `miniprogram/pages/profile/*`
- Create: `miniprogram/pages/history/*`
- Create: `test/miniprogram-pages.test.mjs`

**Interfaces:**
- Today consumes `/api/practice/next` and `/api/learner/sync`。
- Profile consumes sync response `{ sessions, mastery, profile }`，缺字段时使用 0 和空数组。
- History consumes local/cloud merged entries，按 `sessionId` 去重。

- [ ] **Step 1: 写静态契约测试**

```js
test("app exposes three tabs and a separate training page", () => {
  const config = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.equal(config.tabBar.list.length, 3);
  assert.ok(config.pages.includes("pages/training/training"));
});
```

- [ ] **Step 2: 运行并确认文件不存在而失败**

Run: `node --test test/miniprogram-pages.test.mjs`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: 实现小程序入口与三个信息页**

`project.config.json` 指向 `miniprogramRoot: "miniprogram/"` 并使用 `touristappid`。Today 明确显示运行模式、当前推荐和未完成恢复；History 展示题目与最终表达；Profile 展示完成数、待复习、需再练和最近卡点。

- [ ] **Step 4: 验证页面契约**

Run: `node --test test/miniprogram-pages.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add project.config.json project.private.config.json.example miniprogram/app.* miniprogram/pages test/miniprogram-pages.test.mjs
git commit -m "feat: add mini program learning dashboard"
```

### Task 4: 四阶段训练页与浮动私教

**Files:**
- Create: `miniprogram/pages/training/training.js`
- Create: `miniprogram/pages/training/training.json`
- Create: `miniprogram/pages/training/training.wxml`
- Create: `miniprogram/pages/training/training.wxss`
- Copy: `public/assets/plum-progress-final.png` → `miniprogram/assets/plum-progress.png`
- Copy/convert: `public/assets/icons/*` → `miniprogram/assets/icons/*`
- Create: `test/miniprogram-behaviors.test.mjs`

**Interfaces:**
- Main actions: `submit_attempt / submit_restate / submit_revision`。
- Help actions: `request_hint / request_explanation / request_reference`。
- Follow-up action: `ask_followup`，不得改变 `stage` 或清空主草稿。

- [ ] **Step 1: 写 10 条行为测试**

从设计文档第 8 节建立数据驱动测试，重点断言：`不知道`进入 teaching、追问不推进阶段、失败保留草稿、完成可继续下一题和历史归档。

- [ ] **Step 2: 运行并确认训练页尚未满足契约**

Run: `node --test test/miniprogram-behaviors.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 实现训练页最小闭环**

页面固定显示题目与四步进度；消息左右分层；每种阶段只显示一个主任务。点击提交先显示“回答已保存，私教正在回复”，成功显示下一步，失败原地重试。浮动私教用抽屉层打开，不与主输入同时占据页面。

- [ ] **Step 4: 验证行为样例通过**

Run: `node --test test/miniprogram-behaviors.test.mjs`
Expected: 10 tests PASS.

- [ ] **Step 5: 提交**

```bash
git add miniprogram/pages/training miniprogram/assets test/miniprogram-behaviors.test.mjs
git commit -m "feat: add mini program coaching flow"
```

### Task 5: 完整验证与使用说明

**Files:**
- Modify: `README.md`
- Create: `docs/miniprogram-local-preview.md`
- Create: `scripts/verify-miniprogram.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces command: `npm run verify:miniprogram`。
- Produces导入入口: 仓库根目录的 `project.config.json`。

- [ ] **Step 1: 增加结构验证脚本**

脚本检查必需页面、模式文案、无 DeepSeek 密钥、API 路径齐全，并运行小程序聚焦测试。

- [ ] **Step 2: 运行全部测试和安全检查**

Run:

```bash
npm run verify:miniprogram
npm test
npm run test:coverage
python3 -m unittest discover -s tests/philosophy_answer_coach -p 'test_*.py'
npm audit --audit-level=moderate
```

Expected: 所有行为样例和现有回归测试通过；无中高危依赖问题。

- [ ] **Step 3: 检查双尺寸布局**

若本机微信开发者工具不可用，使用 WXML/WXSS 静态边界检查并在交付中明确“尚未真机/开发者工具渲染”；有工具时分别截取约 `390×844` 和 `700×570`。

- [ ] **Step 4: 补充导入和后续 AppID 联调说明**

说明：导入仓库根目录、当前 `local-demo`、如何在私有配置补 AppID、如何切换 `cloudbase`，以及切换前必须完成环境关联。

- [ ] **Step 5: 最终提交**

```bash
git add README.md docs/miniprogram-local-preview.md scripts/verify-miniprogram.mjs package.json
git commit -m "docs: add mini program local preview guide"
```
