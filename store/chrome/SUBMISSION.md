# Chrome Web Store 提交材料 · CiteBeat

控制台：https://chrome.google.com/webstore/devconsole

> 注册费 $5 一次性，已缴。审核周期通常 1-3 天；含通配 host 权限时可能延长到 1-2 周。

---

## 0. 提交前必办

| 项 | 状态 | 说明 |
|---|---|---|
| 扩展包 | 就绪 | `dist/citebeat-0.3.4.zip`（18 文件，无冗余） |
| 隐私政策 URL | 就绪 | https://sci-m-wang.github.io/CiteBeat/privacy/ |
| 128×128 图标 | 就绪 | 已在包内 |
| 截图 ×3 | 就绪 | `store/screenshot-{1,2,3}-*.png`，1280×800，已对齐 v0.3.x 界面 |
| 小宣传图 440×280 | 可选 | `store/promo-small-440x280.png` |

---

## 1. 截图生成流程

截图是**用真实 UI 渲染**的，不是手绘稿：

```bash
node scripts/render_ui.mjs            # 无头 Chrome 渲染真实 popup/options → docs/
python scripts/make_store_screenshots.py   # 合成 1280×800 商店图 → store/
```

`render_ui.mjs` 给真实的 `popup.js` / `options.js` 注入 `chrome.*` 桩，
让它们跑真实的渲染逻辑、套真实的 CSS，只把数据换成预置样例。
所以截图里的布局、控件、文案都与实际运行一致，改了 UI 重跑即可刷新。

预置数据刻意让数字自洽：列表 `+5 / +3`，被合并条目 `-3`，徽章 `+5`。
截图中不含任何真实 Token。

---

## 2. Store listing

### Name（≤ 45 字符）
```
CiteBeat · Citation Tracker
```

### Summary / 简短说明（≤ 132 字符）
```
Track citation growth of your papers via Google Scholar or Semantic Scholar, with per-paper baselines.
```

### Detailed description
```
CiteBeat tracks how your academic papers accumulate citations over time,
using Google Scholar or Semantic Scholar as the data source.

WHAT IT DOES
• Shows your total citation count on the toolbar badge
• Records a per-paper baseline so you can see exactly which papers gained
  citations in the current period, not just the total
• Separately lists papers whose counts dropped or were merged away, so the
  numbers always reconcile
• Draws a citation trend chart from locally stored snapshots
• Generates a shareable PNG summary card
• Statistics periods can be manual, weekly, monthly, or every N days

OPTIONAL: PUBLISH TO YOUR OWN HOMEPAGE
Disabled by default. If you turn it on, CiteBeat can send a JSON snapshot
of your own public metrics to a destination YOU configure:
• A custom endpoint you run, or
• Your own GitHub Pages repository, committed via the GitHub Contents API

There is no built-in server. Nothing is ever sent unless you enable the
feature, enter a destination, and approve the browser's permission prompt
for that specific domain. A "Preview snapshot" button renders the exact
JSON locally so you can inspect it without sending anything.

PRIVACY
• All data stays in chrome.storage.local by default
• The developer receives nothing and operates no server
• No analytics, tracking, or advertising SDKs
• Optional access tokens are stored under their own local key and are
  excluded from exported backups

Open source: https://github.com/sci-m-wang/CiteBeat
Privacy policy: https://sci-m-wang.github.io/CiteBeat/privacy/
```

### Category
`Productivity`

### Language
`English`（zh_CN 通过包内 `_locales` 自动生效）

---

## 3. Privacy practices

### Single purpose（单一用途）
```
CiteBeat tracks and displays the citation metrics of the user's own
academic publications, retrieved from public Google Scholar or Semantic
Scholar profiles, and optionally republishes those same metrics to a
destination the user configures.
```

### 权限说明（逐条填）

**`storage`**
```
Stores the user's author ID, extension settings, the citation snapshot,
the per-paper baseline used to compute growth, and the local citation
history that powers the trend chart. All of it stays on the device.
```

**`alarms`**
```
Schedules the periodic background refresh of citation data at the interval
the user configures, and the periodic check for the optional reporting
feature.
```

**Host: `https://scholar.google.com/*`**
```
Fetches the public Google Scholar profile page of the author ID the user
entered, in order to read the total citation count, h-index, i10-index,
and the per-paper citation list. No credentials are sent; requests use
credentials: 'omit'.
```

**Host: `https://api.semanticscholar.org/*`**
```
Calls the official public Semantic Scholar Graph API for the author ID the
user entered, to read citation counts and paper metadata. This is an
alternative data source the user can select instead of Google Scholar.
```

**Optional hosts: `https://*/*`, `http://*/*`** ← 审核重点
```
These are OPTIONAL host permissions, not granted at install time. They
back a feature that is DISABLED BY DEFAULT.

The feature lets a researcher publish their own public citation metrics to
their own personal homepage, so the numbers can be rendered on their own
website. There are two delivery modes, both entirely user-configured:

  1. Custom endpoint - POST the JSON to an http(s) URL the user types in.
  2. GitHub Pages - a static site cannot receive a POST, so the extension
     instead commits the JSON into the user's OWN repository through the
     official GitHub Contents API (https://api.github.com).

The destination domain is chosen by the user and cannot be known at
packaging time, which is why the optional permission must be declared as a
pattern rather than a fixed host. This follows the documented Chrome
guidance for user-configured destinations: declare the broad pattern under
optional_host_permissions and request the narrow, specific origin at
runtime via chrome.permissions.request from a user gesture.

At runtime the extension never requests the wildcard. It computes the exact
origin from the user's input (for example https://example.com/* or
https://api.github.com/*) and requests only that origin, from a click in
the options page.

Nothing is transmitted unless ALL of the following hold:
  1. The user enables reporting in the options page
  2. The user supplies a destination (endpoint URL, or repo + file path)
  3. The user approves the browser permission prompt for that exact origin

The extension contains no hardcoded endpoint and never contacts any
developer-operated or third-party server. The payload contains only the
user's own public scholarly data: author ID, public profile URL, total
citations, h-index, i10-index, paper titles with citation counts, the
period delta, and the citation trend.

Reviewers can verify the exact payload without any server or repository by
clicking "Preview snapshot" in the options page, which renders the JSON
locally and sends nothing.

Relevant source: background.js, functions buildSnapshot(),
deliverGeneric(), deliverGitHub(), resolveEndpointTarget();
options/options.js, function ensureOriginPermission().
```

### Remote code
```
No, I am not using remote code
```
（所有代码都在包内，无 eval、无外部 script 标签）

### Data usage 勾选

这里有个判断题，说明一下再决定：

Chrome 问的是「collect **or transmit**」。默认情况下扩展什么都不发；但用户开启上报后，确实会向**用户自己指定的目标**发送论文数据，以及把 Token 作为请求头发出。

- 严格看，这是用户指示的传输，接收方是用户自己，开发者拿不到任何东西
- 但表单问的是「是否传输」，不是「开发者是否接收」

**建议按保守口径勾选**——少报被打回的代价，远大于多报。多报不会有惩罚。

勾：
- ☑ **Website content** — 从 Scholar 页面读取的论文标题与引用数，在用户启用上报后会发往用户自选目标
- ☑ **Authentication information** — 可选的 Bearer / GitHub token，仅作为请求头发往用户自己的目标

不勾：PII、健康、财务、位置、个人通信、网页浏览记录、用户活动。

三项认证全部勾「是」：
- ☑ 不出售数据给第三方
- ☑ 不用于与单一用途无关的目的
- ☑ 不用于判断信用状况或放贷

---

## 4. Distribution

- **Visibility**: Public
- **Regions**: All regions
- **Pricing**: Free

---

## 5. 提交后

- 状态 `Pending review`
- 含通配 host 权限时人工审核概率高，可能被追问，按上面第 3 节的说明回复即可
- 通过后补 README 徽章：
  ```markdown
  [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/<EXT_ID>)](https://chrome.google.com/webstore/detail/<EXT_ID>)
  ```

---

## 6. 若审核受阻的退路

如果审核员坚持不接受通配 optional host，有一个不牺牲功能完整性的做法：

**Chrome 版只保留 GitHub Pages 模式**，把 optional host 收窄成固定的
`https://api.github.com/*`。这样权限范围具体明确，审核几乎不会有异议。
自定义节点模式保留在 Edge 版和 GitHub Release 的自建版本里。

需要时告诉我，改动很小：manifest 换一行，options 隐藏模式选择器。
