# 哲学论述陪练

一个可直接发给学员的移动端 H5 试验品。它不先给范文，而是让学生从真实初答出发，每轮只修一个最关键的问题。

当前 MVP 只做一道题：

> 在康德哲学中，自由“构成了纯粹的，甚至思辨理性体系的整个建筑的拱顶石”。试从理论理性和实践理性两个层次说明之。

## 学员看到的流程

1. 用自己的话审题。
2. 提交当前最好的独立答案，可选粘贴自己的教材或讲义片段。
3. AI 引用学生原句，只指出一个首要问题。
4. 学生先完成单点修复，再亲自重写。
5. 对照前后答案，说明自己改了什么。

时间只记录，不是闸门。页面每次只呈现一个当前任务，学生不需要安装 Skill 或注册账号。

## 系统结构

```text
学员私有邀请链接
  -> 移动端 H5
  -> Node 评阅状态机
     -> CloudBase AI HTTP API
     -> 飞书多维表格（试用记录）
```

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

打开 `http://localhost:8787/?invite=demo`。默认是可离线跑通的 `mock + memory` 模式。

## 切换到真实试用

将环境变量改为：

```dotenv
COACH_PROVIDER=cloudbase
RECORD_PROVIDER=feishu
```

并填入 `.env.example` 列出的 CloudBase 环境 ID、服务端 API Key，以及飞书 Base 参数。密钥只放在部署环境变量中，不进入前端、Git 或多维表格。
生产环境还必须配置随机的 `SESSION_SIGNING_SECRET`，用来防止学员端伪造飞书记录编号。
飞书初始表结构已固定在 [`ops/feishu-base-fields.json`](./ops/feishu-base-fields.json)。

生成 6 条私有学员链接：

```bash
npm run invites -- https://你的正式域名
```

将输出的 `INVITE_CODES_JSON` 配到服务端，然后每名学员只发与编号对应的一条链接。

CloudBase 可用根目录 [`Dockerfile`](./Dockerfile) 部署为云托管服务，并将 `/api/health` 用作健康检查。

## 验证

```bash
npm test
npm run test:coverage
python3 -m unittest discover -s tests/philosophy_answer_coach -p 'test_*.py'
npm audit --audit-level=moderate
```

首轮发放方法、六人分组和停止条件见 [`docs/pilot-runbook.md`](./docs/pilot-runbook.md)。
