# 余震 · DROP — 第一人称地震逃生游戏

> 黑客松项目。你在**二层单元楼**里醒来，地震突袭——边逃边躲砸下来的天花板，下楼、冲出单元门求生。用代入和恐惧把救命知识焊进脑子。

---

## 🔴 当前主力文件 = `game_v3.html`（最新最完整，别动旧的）

游戏迭代过很多版，**现在在做的、最完整的是 `game_v3.html`**（连续二层单元楼 + 真实下楼 + 地震玩法）。其它 `index.html`/`game.html`/`game_v2.html` 是旧版，别在上面继续开发。

## 🎮 想玩最新版？

### 在线玩（最简单，push 后 1~2 分钟生效）
👉 **https://starsky618.github.io/drop/game_v3.html**
（注意网址结尾是 `/game_v3.html`！直接打开 `starsky618.github.io/drop/` 是旧 demo）
⚠️ 用**电脑 Chrome + 戴耳机**，键鼠操作。

### 怎么操作
- **W / A / S / D** = 走动　·　**鼠标** = 转头环顾　·　**ESC** = 松开鼠标
- 流程：卧室醒来 → 地震袭来 → 往前逃，**躲开地上红圈预警处砸下来的东西** → 下楼梯 → 走到**绿色单元门 = 逃出来了**
- 被砸中 = 你死了（看死因 → 再来一次）

---

## 🛠 想一起开发？（Windows 新手照做，全程点鼠标）

游戏全部代码就在 **`game_v3.html`** 一个文件里（外加同目录的 `three.module.js` 是 3D 引擎，别删）。

### 第 1 步：装 VS Code
👉 https://code.visualstudio.com/ 下载 Windows 版，双击安装一路下一步。

### 第 2 步：把项目弄到电脑
- 打开 👉 https://github.com/Starsky618/drop → 绿色 **`< > Code`** → **`Download ZIP`**，解压到桌面。
- 要正式协作：右上角 **`Fork`** 一份到自己账号，再 Download ZIP。

### 第 3 步：VS Code 打开运行
1. VS Code →「文件」→「打开文件夹」→ 选解压出的 `drop` 文件夹
2. 左边扩展图标（四个方块）→ 搜 **`Live Server`** → Install
3. 右键 **`game_v3.html`** → **`Open with Live Server`** → 浏览器自动打开
4. 改代码 → Ctrl+S 保存 → 浏览器自动刷新，边改边看

> ⚠️ **别直接双击 html**（会白屏！）必须用 Live Server。这是网页游戏的技术限制。
> ⚠️ `three.module.js` 必须和 `game_v3.html` 在**同一个文件夹**，别移走（游戏靠它画 3D）。

---

## 📁 文件结构
```
game_v3.html          ★主力★ 游戏本体(要改改这个) — 连续二层单元楼+地震玩法
three.module.js       3D 引擎(Three.js 本地版,合规离线用,别删)
docs/_scenes/modules.js   7个资产/场景函数(床/衣柜/碎块/楼梯/客厅/室外/死亡演示)
test_*.html           各资产的独立测试页(改某个资产可单独看)
stairtest.html        射线下楼+墙碰撞 核心技术验证页
CLAUDE.md             ★给 AI 助手看★ 当前进度/架构/技术坑/剩余/交付红线 — 用 AI 接着开发先读它
CHANGELOG.md          里程碑时间线
docs/01,02            研究报告 + 设计文档(铁律/地震正解表/分工)
index.html / game.html / game_v2.html   旧版,别动
```

## 🤖 用 AI（Claude/Codex 等）接着开发？
**先让它读 `CLAUDE.md`** —— 里面有当前真实进度、game_v3 架构、踩过的技术坑（yaw 朝向/连续地板验证/agent 视觉需人验收）、剩余工作、交付红线（8MB 离线、Three.js 已本地化、提交三件套截止 5.31 中午）。

## 当前进度
**连续二层单元楼版 game_v3 完整可玩**：卧室醒来→地震→边逃边躲坠落物→下楼→单元门通关，SCP 暖灰氛围+精细家具+音频。剩余与交付清单见 `CLAUDE.md`。
