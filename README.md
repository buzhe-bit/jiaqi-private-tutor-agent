# 哲学论述陪练

一个可直接发给学员的移动端 H5 试验品。它先要求学生真实作答；会的帮助表达，不会的就在同一页讲明白。

当前 MVP 用三道历年真题验证连续训练：康德自由、现象与物自体、黑格尔辩证法。题目来自佳琦的飞书真题资料；其中旧 AI 答案只作参考，不视为权威答案。

## 学员看到的流程

1. 直接回答整道题，“不知道”也是有效的真实起点。
2. AI 判断当前是缺知识、缺推理连接，还是只差表达。
3. 真不会时，学生自己选择提示、带例子的讲解或一种可行作答。
4. 学生用自己的话复述关键关系，再把它写回原答案。
5. 对照一开始的答案和改进后的表达；体验反馈可选。
6. 回到今日题单继续下一题，或在答题历史中回看、复制以前的表达笔记。

时间只记录，不是闸门。题目、讲解和学生回答都保留在同一页对话中，学生不需要安装 Skill 或注册账号。

## 系统结构

```text
学员私有邀请链接
  -> 移动端 H5
     -> 今日三题 / 答题历史 / 我的
  -> Node 评阅状态机
     -> CloudBase AI HTTP API
     -> CloudBase 数据库（学员会话主记录）
     -> 飞书多维表格（可选的教师侧镜像）
```

每次会话按匿名邀请码写入 `coach_sessions`，学生可在手机与电脑间恢复未完成训练，并合并已经完成的表达笔记。浏览器本机仍保留一份副本；飞书只作教师侧试用观察，写入失败不会阻塞学生训练。本轮没有新增飞书表结构。

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
```

并填入 `.env.example` 列出的 CloudBase 环境 ID、服务端 API Key；需要教师侧镜像时再填飞书 Base 参数。密钥只放在部署环境变量中，不进入前端、Git 或多维表格。
生产环境还必须配置随机的 `SESSION_SIGNING_SECRET`，用来防止学员端伪造会话记录编号。
飞书初始表结构已固定在 [`ops/feishu-base-fields.json`](./ops/feishu-base-fields.json)。

生成 6 条私有学员链接：

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

首轮发放方法、六人分组和停止条件见 [`docs/pilot-runbook.md`](./docs/pilot-runbook.md)。
