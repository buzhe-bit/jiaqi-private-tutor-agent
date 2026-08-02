# 私教智能体

状态：进行中。

这是私教智能体的独立产品仓库。稳定主线为 `main`，新的产品假设、原型或实现从 `codex/<experiment-name>` 分支开始，验证后再合并回 `main`。

为避免影响已有工作，本仓库没有搬动或复制原咨询资料。可用资料登记在 [`references.json`](./references.json)；从现在开始产生的新产品文档和代码保存在本目录。

常用命令：

```bash
git switch -c codex/<experiment-name>
git add <files>
git commit -m "feat: describe experiment"
git switch main
git merge --no-ff codex/<experiment-name>
```

