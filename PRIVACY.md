# Privacy Policy — CiteBeat

_Last updated: 2026-04-21_

**CiteBeat**（"本扩展"）是一个浏览器扩展，用于定时获取用户本人的公开学术引用数据并在浏览器本地展示。本扩展遵循"最小化数据处理"原则。

## 1. 我们收集的数据

**本扩展不会向任何第三方服务器发送或上传任何用户数据。** 以下数据仅保存在用户本地浏览器中（通过 `chrome.storage.local` API）：

- 用户在选项页填写的 Google Scholar user id 与 / 或 Semantic Scholar author id
- 用户选择的数据源和刷新间隔
- 抓取得到的公开引用数据快照（每篇论文的标题、引用数、链接）
- 上次刷新时间、上次错误信息、基线快照

所有上述数据只存在于用户自己的浏览器本地。卸载扩展时，Chrome 会自动清除这些数据。

## 2. 我们访问的网站

本扩展仅会向以下两个域名发起网络请求，且仅为获取用户本人选择跟踪的公开学术页面：

- `https://scholar.google.com/` — 读取用户公开的 Google Scholar 个人主页 HTML
- `https://api.semanticscholar.org/` — 调用官方 Semantic Scholar Graph API

除用户明确配置的作者 ID 外，本扩展不会向上述网站发送任何额外识别信息。

## 3. 我们不做的事

- 不收集任何 Cookie、登录凭据或浏览历史
- 不使用任何分析、追踪或广告 SDK
- 不向扩展作者或任何第三方传输用户数据
- 不访问用户访问的其他任何网页

## 4. 权限解释

| 权限 | 用途 |
|---|---|
| `alarms` | 周期性触发刷新任务 |
| `storage` | 在浏览器本地保存用户配置和引用快照 |
| `host_permissions: scholar.google.com` | 抓取用户本人的公开 Google Scholar 个人页 |
| `host_permissions: api.semanticscholar.org` | 调用官方 Semantic Scholar API |

## 5. 数据安全

本扩展不在本地或远程持久化任何敏感数据。用户的作者 ID 属于公开信息（可在对应网站上直接搜索到），并非身份凭据。

## 6. 变更

如本隐私政策有变更，将通过本文件更新"Last updated"日期，并在扩展的新版本发布说明中注明。

## 7. 联系方式

如有任何疑问，请通过扩展仓库的 Issues 页面提出：_（此处填入仓库地址）_。
