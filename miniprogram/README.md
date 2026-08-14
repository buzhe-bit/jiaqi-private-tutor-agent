# 哲学论述陪练小程序

## 当前怎么预览

1. 安装微信开发者工具。
2. 导入仓库根目录：`/Users/xiaoshushenxia/Documents/New project/01-项目/私教智能体`。
3. `project.config.json` 已配置正式小程序 AppID：`wxfa3953c780a246d8`。

当前 `config.js` 使用 `cloudbase`：请求经由 CloudBase 云托管服务访问现有 `/api/*` 接口。行为验收已通过，但真实 CloudBase / DeepSeek 端到端链路尚未确认，因此不能把当前预览当作线上容量或回答质量的证明。

## 当前发布前状态

- AppID、CloudBase 环境和服务名已写入配置。
- 安全与身份校验已通过，本地内存模式下 20 个不同 session 并发也已通过；这不代表线上容量已经验证。
- Mac 锁屏或微信开发者工具服务端口关闭时，新的预览二维码不会重新生成；恢复开发者工具服务后再生成二维码。
- 真实 CloudBase / DeepSeek E2E 尚未确认，确认前不要把小程序标记为已完成线上发布。

DeepSeek 密钥仍只放在服务端，不进入小程序前端。

网页端是稳定主线，小程序位于 `codex/wechat-miniprogram-mvp` 独立分支；真实端到端链路和预览二维码未确认前不合并、不部署。
