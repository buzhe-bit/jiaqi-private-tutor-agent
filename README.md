# 哲学学习私教

一个可直接发给学员的移动端 H5 试验品。它把学生的“看过”转化成“理解、能串联、能表达、记得住”。

当前 V2 用 9 道跨中国哲学、西方哲学和马克思主义哲学的真题种子启动自由序列。新增题干来自佳琦的飞书真题语料；旧 AI 答案没有进入产品，未人工复核的讲解会明确标为“AI 综合解释，不是唯一标准答案”。

## 学员看到的流程

1. 直接回答整道题，“不知道”也是有效的真实起点。
2. AI 判断当前是缺知识、缺推理连接，还是只差表达。
3. 真不会时，学生自己选择提示、带例子的讲解或一种可行作答。
4. 学生用自己的话复述关键关系，再把它写回原答案。
5. 对照一开始的答案和改进后的表达；体验反馈可选。
6. 系统把卡点、掌握状态和下次复习时间写入个人学习档案。
7. 下一题在新题、关系题和到期复习题之间选择；三题是基础量，不是上限。

时间只记录，不是闸门。题目、讲解和学生回答都保留在同一页对话中，学生不需要安装 Skill 或注册账号。

## 系统结构

```text
学员私有邀请链接
  -> 移动端 H5
     -> 今日训练 / 答题历史 / 我的
  -> Node 评阅状态机
     -> CloudBase AI HTTP API
     -> CloudBase 数据库
        -> coach_sessions（完整训练证据）
        -> learner_mastery（结构化卡点与复习状态）
        -> question_bank（真题种子与复习变式）
     -> 飞书多维表格（可选的教师侧镜像）
```

`coach_sessions` 保存初答、对话、干预和最终表达；`learner_mastery` 只提取后续出题需要的主题、概念关系、卡点、掌握状态与 `reviewAt`，不复制整段聊天；`question_bank` 保存题目和到期复习变式。学生可跨设备恢复训练，浏览器本机仍保留一份副本。飞书只作教师侧镜像，写入失败不阻塞训练，本轮没有修改飞书表结构。

当前不是完整 RAG：精确原句、出处或争议解释仍需资料核实。AI 负责诊断、教学、整理表达和生成复习变式，不能把未核实内容包装成权威答案。

核心边界位于 [`skills/philosophy-answer-coach/SKILL.md`](./skills/philosophy-answer-coach/SKILL.md)，服务端会将这份 Skill 及其评估规则加入模型提示。

## 本地运行

需要 Node.js 20 或更高版本。项目无运行时第三方依赖。

```bash
cp .env.example .env
set -a
source .env
set +a
npm start
```

打开 `http://localhost:8787/?invite=demo`。默认是可离线跑通的 `mock + memory` 模式，页面会明确显示“演示模式：回答为固定样例”。`/api/health` 的 `coachMode` 为 `demo` 时只验收流程，为 `real` 时才验收回答质量。

## 切换到真实试用

将环境变量改为：

```dotenv
COACH_PROVIDER=cloudbase
RECORD_PROVIDER=cloudbase
MIRROR_PROVIDER=feishu
CLOUDBASE_DATABASE_COLLECTION=coach_sessions
CLOUDBASE_MASTERY_COLLECTION=learner_mastery
CLOUDBASE_QUESTION_COLLECTION=question_bank
```

并填入 `.env.example` 列出的 CloudBase 环境 ID、服务端 API Key；需要教师侧镜像时再填飞书 Base 参数。密钥只放在部署环境变量中，不进入前端、Git 或多维表格。
生产环境还必须配置随机的 `SESSION_SIGNING_SECRET`，用来防止学员端伪造会话记录编号。
飞书初始表结构已固定在 [`ops/feishu-base-fields.json`](./ops/feishu-base-fields.json)。

生成私有学员链接：

```bash
npm run invites -- https://你的正式域名
```

将输出的 `INVITE_CODES_JSON` 配到服务端，然后每名学员只发与编号对应的一条链接。

CloudBase 可用根目录 [`Dockerfile`](./Dockerfile) 部署为云托管服务，并将 `/api/health` 用作健康检查。

灰度版本使用 CloudBase URL 参数规则定向进入，例如 `?invite=学员码&preview=knowledge-chat-v2`；未带 `preview` 的旧链接继续命中稳定版本。灰度确认前不切换默认流量。

## 验证

```bash
npm test
npm run test:coverage
python3 -m unittest discover -s tests/philosophy_answer_coach -p 'test_*.py'
npm audit --audit-level=moderate
```

首轮发放方法、行为验收和停止条件见 [`docs/pilot-runbook.md`](./docs/pilot-runbook.md)。
