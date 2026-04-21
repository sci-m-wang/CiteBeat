# Edge Add-ons 提交材料 · CiteBeat v0.1.0

控制台：https://partner.microsoft.com/dashboard/microsoftedge

Edge Add-ons 商店**免费**，不收注册费。审核周期通常 1-7 天。

---

## 1. 账号准备

首次使用需要"Microsoft 合作伙伴中心"账号：
1. 用 Microsoft 账号登录 https://partner.microsoft.com/dashboard/microsoftedge
2. 同意 Edge 扩展开发者协议
3. 个人发布者选"个人 / Individual"即可，不需要公司资料

---

## 2. 上传扩展包

- 扩展包：`dist/citebeat-0.1.0.zip`（如无，运行 `./pack.sh` 生成）

上传后进入条目编辑页，按左侧菜单逐项填。

---

## 3. Availability（发布范围）

- **Markets**: All markets
- **Visibility**: Public
- **Age group**: Not age-restricted

---

## 4. Properties（属性）

- **Category**: Productivity
- **支持的语言**: Chinese (Simplified)（可后续加英文）
- **Privacy policy URL**: `https://sci-m-wang.github.io/CiteBeat/privacy/`
- **Website**: `https://github.com/sci-m-wang/CiteBeat`
- **Support contact**: GitHub Issues `https://github.com/sci-m-wang/CiteBeat/issues`
- **是否收集数据 (Data collection)**: **No**

---

## 5. Store listing（商店条目 · 中文简体）

### 显示名称
```
CiteBeat · 引用追踪
```

### 简短说明（≤ 200 字符）
```
听见你引用的节拍。Chrome / Edge 扩展，通过 Google Scholar 或 Semantic Scholar 自动追踪学术论文的引用增长，按论文粒度记录基线，实时提示新增引用。
```

### 详细说明（Long description）
```
CiteBeat 是一个轻量级浏览器扩展，用于自动追踪你在 Google Scholar 或
Semantic Scholar 上的论文引用变化。

核心功能
━━━━━━━━━━━━━━━
• 徽章实时显示作者总引用数
• 按论文粒度记录引用基线，本周期新增一目了然
• 双数据源可切换：Google Scholar / Semantic Scholar
• 可配置刷新间隔（15 分钟起），避免过频抓取
• 手动刷新 / 一键重置基线
• 新引用到来时桌面通知提醒

使用场景
━━━━━━━━━━━━━━━
• 学术工作者日常关注自己论文被引用情况
• 研究生答辩 / 申请季监控数据变化
• 实验室维护多篇论文的引用动态

隐私与许可
━━━━━━━━━━━━━━━
• 所有数据本地存储（浏览器 storage），不上传任何服务器
• 仅访问 scholar.google.com 和 api.semanticscholar.org
• 不收集任何用户识别信息
• MIT 开源协议，源码公开于 GitHub

开源地址：https://github.com/sci-m-wang/CiteBeat
```

### 搜索关键词（Search terms，最多 7 个）
```
谷歌学术, Google Scholar, Semantic Scholar, 引用, 学术, citations, scholar
```

---

## 6. Store logos and images（图片资源）

| 字段 | 要求 | 使用文件 |
|---|---|---|
| Store logo | **300×300 PNG** | `store/edge/logo-300.png` |
| Promotional tile（大宣传图，可选但强烈建议填） | **920×680 PNG** | `store/edge/promo-tile-920x680.png` |
| Small promotional tile（可选） | **440×280 PNG** | `store/edge/promo-tile-440x280.png` |
| Screenshot 1 | **1280×800 PNG**（至少 1 张，最多 10 张） | `store/screenshot-1-popup.png` |
| Screenshot 2 | 同上 | `store/screenshot-2-options.png` |
| Screenshot 3 | 同上 | `store/screenshot-3-hero.png` |

> Edge 允许的 screenshot 尺寸：1280×800、640×400、2560×1600、1920×1080。
> CiteBeat 的截图已按 1280×800 制作，直接可用。

---

## 7. Properties 里的"权限说明"

Edge 条目后台有"权限使用说明"（justification）文本框，逐项填：

| 权限 | 说明 |
|---|---|
| `storage` | 在浏览器本地保存引用基线与用户设置 |
| `alarms` | 定时触发后台引用数据刷新 |
| `notifications` | 检测到引用增长时向用户弹出系统通知 |
| Host: `https://scholar.google.com/*` | 抓取用户 Google Scholar 作者主页的公开引用数据 |
| Host: `https://api.semanticscholar.org/*` | 调用 Semantic Scholar 官方公开 Graph API |

---

## 8. Publisher display name

填 `sci-m-wang` 或 `KinaMind`，两者均可。出现在商店条目的"作者"字段。

---

## 9. Notes to certification team（给审核员的备注）

```
This extension requires a user-provided Google Scholar author ID or
Semantic Scholar author ID to function. On first install, the options
page opens automatically.

For testing:
  Google Scholar ID example: a valid public profile, e.g. "JicYPdAAAAAJ"
  Semantic Scholar ID example: "1741101"

The extension:
  - Does NOT collect or transmit any user data
  - Stores baselines in chrome.storage.local only
  - Accesses only scholar.google.com (public author pages) and
    api.semanticscholar.org (official public API)

Source code and privacy policy:
  https://github.com/sci-m-wang/CiteBeat
  https://sci-m-wang.github.io/CiteBeat/privacy/
```

---

## 10. 提交

填完所有必填项后，右上角 **Publish**（Edge 用 Publish，不是 Submit）。

- 状态变为 **In review**
- 审核通过：自动上架，邮件通知，条目状态变 **In the store**
- 审核失败：邮件给出具体原因；改完重新 Publish 即可

上架后扩展 URL 类似：
```
https://microsoftedge.microsoft.com/addons/detail/<generated-id>
```

---

## 11. 上架后要做的事

1. README 顶部加 Edge Add-ons 徽章：
   ```markdown
   [![Edge Add-ons](https://img.shields.io/badge/Edge%20Add--ons-available-brightgreen)](<商店 URL>)
   ```
2. GitHub Release 描述里加上商店链接
3. 仓库 About 部分的"Homepage"可以改成商店 URL
