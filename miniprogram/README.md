# 哲学论述陪练小程序

## 当前怎么预览

1. 安装微信开发者工具。
2. 导入仓库根目录：`/Users/xiaoshushenxia/Documents/New project/01-项目/私教智能体`。
3. `project.config.json` 已使用 `touristappid`，没有正式小程序 AppID 也可以检查页面和完整训练流程。

当前 `config.js` 使用 `local-demo`：回答为固定行为样例，只用来验证交互、排版、草稿恢复和学习闭环，不代表 DeepSeek 的真实回答质量。

## 什么时候接真实 AI

取得小程序 AppID 并关联现有 CloudBase 环境后：

1. 在 `config.js` 填入 CloudBase 环境和服务名；
2. 将 `mode` 改成 `cloudbase`；
3. 由小程序调用现有 `/api/*` 接口，DeepSeek 密钥仍只放在服务端。

网页端是稳定主线，小程序位于 `codex/wechat-miniprogram-mvp` 独立分支；未确认前不合并、不部署。
