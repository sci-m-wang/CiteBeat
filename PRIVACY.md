---
title: CiteBeat 隐私政策
permalink: /privacy/
---

# Privacy Policy — CiteBeat

_Last updated: 2026-11-06_

**CiteBeat**（"本扩展"）是一个浏览器扩展，用于定时获取用户本人的公开学术引用数据并在浏览器本地展示。本扩展遵循"最小化数据处理"原则。

## 1. 我们收集的数据

**本扩展作者不运营任何服务器，也不会收集用户数据。** 以下数据默认仅保存在用户本地浏览器中（通过 `chrome.storage.local` API）：

- 用户在选项页填写的 Google Scholar user id 与 / 或 Semantic Scholar author id
- 用户选择的数据源和刷新间隔
- 抓取得到的公开引用数据快照（每篇论文的标题、引用数、链接）
- 总引用数、h-index、i10-index 等公开指标
- 上次刷新时间、上次错误信息、基线快照、本地历史记录

所有上述数据只存在于用户自己的浏览器本地。卸载扩展时，Chrome 会自动清除这些数据。

## 2. 可选的自定义节点上报

本扩展提供一项**默认关闭**的可选功能：把引用快照同步到**用户自己配置的位置**（例如用户的个人主页后端，或用户自己的 GitHub Pages 仓库），用于在自己的网站上展示引用数据。

支持两种方式，均由用户主动选择和配置：

1. **自定义节点** — 向用户填写的 http(s) 地址 POST `citation.snapshot` JSON。
2. **GitHub Pages** — 静态主页无法接收 POST，因此改为调用 GitHub 官方 Contents API（`https://api.github.com`），把该 JSON 作为一次提交写入用户自己指定的仓库、分支和文件路径。

共同的约束：

- 该功能默认关闭。不配置就永远不会发送任何数据。
- 目标完全由用户填写。**扩展不内置、不预置、也不会连接任何作者或第三方的服务器。**
- 首次发送前，浏览器会弹出授权提示，用户必须显式授权对应域名后才能发送。
- 发送内容为 `citation.snapshot` JSON，仅包含用户本人的公开学术数据：作者 ID、公开主页地址、总引用数、h-index、i10-index、论文标题与引用数、周期增量、引用趋势。
- 用户可选填凭据用于鉴权：自定义节点使用 Bearer Token，GitHub 模式使用用户自己创建的 personal access token。两者各自单独保存在本地，**都不会写入导出的备份文件**，也不会包含在上报内容中（仅作为请求头发送到用户自己指定的目标）。
- GitHub 模式建议使用 fine-grained token，只授权目标仓库、只勾选 `Contents: Read and write`。
- 用户可随时关闭该功能、清除凭据，或在浏览器扩展设置中撤销已授权的域名。

上报数据的接收方是用户自己指定的位置，其数据处理方式由用户自行负责。写入 GitHub 仓库的内容会进入该仓库的提交历史，若仓库为公开仓库则该数据公开可见 —— 这与用户主页本身公开展示引用数据的意图一致。

## 3. 我们访问的网站

本扩展默认仅会向以下两个域名发起网络请求，且仅为获取用户本人选择跟踪的公开学术页面：

- `https://scholar.google.com/` — 读取用户公开的 Google Scholar 个人主页 HTML。请求会携带浏览器里本来就有的 `scholar.google.com` cookie，与用户自己打开该页面时完全相同；否则 Scholar 会把扩展当作匿名机器人而要求人机验证。扩展代码读取不到这些 cookie，也不会存储、记录或转发它们
- `https://api.semanticscholar.org/` — 调用官方 Semantic Scholar Graph API（请求不携带 cookie）

此外，**仅当用户主动启用上报功能并授权后**，扩展才会向用户自己配置的目标发起请求 —— 自定义节点模式是用户填写的那一个域名，GitHub Pages 模式是 `https://api.github.com`。这类上报请求**不携带任何 cookie**。扩展声明的 `optional_host_permissions` 为通配形式，是因为无法预知用户会使用哪个自建域名；实际授权范围始终由用户在浏览器授权弹窗中逐个确认。

除用户明确配置的作者 ID 外，本扩展自身不会向上述网站发送任何额外信息。对 `scholar.google.com` 的请求，浏览器会照常附带该站点已有的 cookie，这与用户直接访问该页面一致。

## 4. 我们不做的事

- 不读取、不存储、不收集任何 Cookie、登录凭据或浏览历史（对 Google Scholar 的请求由浏览器自动附带该站点已有的 cookie，扩展无法读取，更不会转发给任何其他方）
- 不使用任何分析、追踪或广告 SDK
- 不向扩展作者或任何第三方传输用户数据
- 不访问用户访问的其他任何网页
- 不在未经用户配置和授权的情况下发起任何外部上报

## 5. 权限解释

| 权限 | 用途 |
|---|---|
| `alarms` | 周期性触发刷新任务与可选的上报检查 |
| `storage` | 在浏览器本地保存用户配置和引用快照 |
| `host_permissions: scholar.google.com` | 抓取用户本人的公开 Google Scholar 个人页 |
| `host_permissions: api.semanticscholar.org` | 调用官方 Semantic Scholar API |
| `optional_host_permissions` | 仅在用户启用上报并显式授权后，向用户自填的节点地址或 `api.github.com` 发送快照 |

## 6. 数据安全

用户的作者 ID 属于公开信息（可在对应网站上直接搜索到），并非身份凭据。可选的 Bearer Token 与 GitHub personal access token 仅保存在浏览器本地存储中，不参与备份导出，也不会发送给用户指定目标以外的任何地址。

## 7. 变更

如本隐私政策有变更，将通过本文件更新"Last updated"日期，并在扩展的新版本发布说明中注明。

## 8. 联系方式

如有任何疑问，请通过扩展仓库的 Issues 页面提出：https://github.com/sci-m-wang/CiteBeat/issues
