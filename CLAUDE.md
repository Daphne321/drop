# 余震·DROP — 项目 CLAUDE.md（AI session 上手指南）

> 这份文件给**接手本项目的 AI session**（尤其 compact 之后的自己）。读完你就知道：当前做到哪、用哪个文件、技术坑在哪、还剩什么、交付红线是什么。
> 通用协作规则在全局 `~/.claude/CLAUDE.md`，这里只写**本项目特定**的。

## 一句话
第一人称地震逃生科普游戏。玩家在二层单元楼里**醒来→地震→边逃边躲坠落物→被砸死就重来→逃出单元门通关**。用代入+恐惧把救命知识焊进脑子。黑客松项目，**8MB 纯前端离线**。

## 🔴 当前主力文件 = `game_v3.html`（这是最新最完整版，别再动旧文件）
游戏经历多次演进，**只有 game_v3.html 是当前在做的版本**：
| 文件 | 是什么 | 状态 |
|---|---|---|
| **`game_v3.html`** | **★当前主力★ 连续二层单元楼 + 地震玩法** | 完整可玩，Tim 说"非常完美" |
| `game_v2.html` | 独立场景切换版（被 v3 取代） | 废弃参考 |
| `game.html` | "用脚走到某处按E抉择"版 | 废弃参考 |
| `index.html` | 最早的 v1 抉择版（GitHub Pages 上线的是它） | 旧，待最后用 v3 替换 |
| `stairtest.html` | 射线地面跟随+墙碰撞 的核心技术验证 | 已验证通过 |
| `docs/_scenes/modules.js` | agent 生成的 7 个资产/场景函数（床/衣柜/碎块/楼梯/客厅/室外/死亡演示） | 已集成部分 |
| `test_*.html` | agent 并行产出的资产 test（已验收） | 资产源 |

## game_v3 架构（当前真实状态）
- **连续空间**（不是独立场景切换！）：卧室 → 走廊1 → 客厅(穿过) → 走廊2 → 楼梯**真实下楼**(二楼y=0→一楼y=-3.3) → 一楼 → 绿色单元门=通关。全程一个 scene，地板无缝拼接。
- **第一人称移动核心技术**：① **射线地面跟随**——每帧从玩家头顶向下 Raycaster，命中 `grounds[]`(地板/台阶)，玩家 y=命中点y+EYE(1.6)，走楼梯y自动降；② **墙碰撞**——移动前朝移动方向射线检测 `walls[]`，撞墙不穿（迷宫前提）。`grounds[]` 和 `walls[]` 两个数组分别装地面和墙。
- **地震玩法（块2）**：醒来字幕→地震(镜头轻晃shake=0.22+WebAudio地鸣轰鸣)→逃生路上随机坠落物(红圈预警→坠落→砸中判定 die)→死亡(死因+重来按钮，回卧室重开)→逃到单元门 win。状态机 phase: wake/quake/dead/won。
- **美术**：程序化 Canvas 纹理(零文件守8MB) + PBR + 阴影 + 后处理(bloom+暗角+色差+颗粒)。**光影是"神秘暗灰"**——低 ambient(0.42)+冷雾+暖色 PointLight 焦点(各房间一盏 warmLamp)，Tim 极满意这个氛围，别调成惨白。

## ⚠️ 技术坑（都是真实踩过的，证据级）
- **yaw 朝向反直觉**：此相机系统 **yaw=0 朝 -z，yaw=Math.PI 朝 +z**。多次把初始朝向搞反导致"困在房间/背对楼梯"。设 spawn 朝向务必验证。
- **连续地板要无缝拼接**：L 形迷宫接缝错位会导致玩家"掉出地板"。改布局后**必须用 `window.__walk()` 钩子模拟直走验证 `reachedExit:true`**（它从卧室往东模拟走到单元门，报卡墙/掉地板的x坐标）。
- **`$=getElementById` 不能配 CSS 选择器**（`$('#x .y')`→null→崩），用 `document.querySelector`。犯过两次。
- **agent 盲写视觉必翻车**：agent 看不到渲染，容易"堆 bloom+暗角把画面做成纯黑"。**视觉必须主 agent 用 CDP 截图验收**，agent 只做几何/代码。
- **死亡演示等场景函数曾因 TypeError 整段崩**（材质 map 拆包错误），表现是"UI在但3D一片黑"。
- **后台标签页 rAF 被节流**：依赖走动/时间的动态逻辑 CDP 后台跑不动 → 用 `__walk()`/`__g()` 钩子模拟，或让 Tim 前台真玩验证。

## 不可妥协约束
- **8MB 离线红线 + 禁外部 CDN**：几何全程序化、纹理用 Canvas 生成、音效 WebAudio 合成，零图片/模型/音频文件。
- **地震逃生知识照 `docs/02` §5 正解表**（USGS/FEMA/CDC 核实），教错会害人。
- **历史回正铁律**：曾跑偏成"躲红方块反应游戏"（废弃在 docs/_archive/）。吸引力靠代入+逃生紧张+死亡震撼，不是高频反应。

## 📋 剩余工作（截止 2026-05-31 中午 12:00）
> ⚠️ **git ground truth 纠正**（本节最初凭印象写错了，用 git 核实后改正）：以下 4 项 **commit 显示已做**（在 game_v3.html 里）——客厅精细家具(68d201b 橙沙发/电视柜/置物架/茶几/散落碎纸/暖灯,参考图17)、楼梯黑铁栏杆(69edef9)、室外单元楼外景结局(56d2007 图20风格6层公寓楼+草地+蓝天)、Three.js本地文件(b3e69ab)。
> **但 commit 声明不可全信**：b3e69ab 声称"本地化合规就绪"，实际 importmap 还是 CDN（假的），已由本 session 真修复成 `./three.module.js` 并 CDP 验证跑通。**下个 session 务必先 CDP 完整跑一遍 game_v3，核实这 4 项的真实质量。**

真正剩余：
1. **死亡演示黑盒聚光**：现在死亡是黑屏文字，modules.js 有 buildDeathScene（黑盒聚光人被楼板压）可换（待确认是否已做）。
2. **迷宫拐弯**（可选，再拉长+迷宫感，用对齐连续地板 __walk 验证）+ **#hud 清理**（和地震 #obj 重叠）。
3. **最终打包提交**：game_v3.html → 复制为根目录 `index.html`、打包 zip（**必须含 `three.module.js`**）、录 Demo 视频、写飞书文档、上传抖音互动空间过审拿二维码。

## 🚨 交付硬约束（决定能不能拿分，别埋头堆内容忘了这个）
- **Three.js 已本地化 ✅**（`game_v3.html` importmap 指向 `./three.module.js`，本 session 真修复 + CDP 验证 canvas/THREE/err=none 跑通）。⚠️ 教训：b3e69ab 曾声称"本地化合规就绪+打包演练通过"但 importmap 实际还是 CDN（声明骗人）——**打包前务必再 grep 一次 importmap 确认是本地、并真的离线测一次**。game_v3 只用 `import * as THREE from 'three'`（无 addons），所以本地化只需 three.module.js 一个文件。
- 提交三件套（截止 5.31 12:00）：① 飞书项目文档 ② Demo 演示视频 ③ 抖音虚拟创作平台**互动空间二维码**(需完成发布审核，扫码体验)。海报 5.30 17:30 截止。
- 入口必须 `index.html` 在根目录、相对路径、整体 zip <8MB、数据用 localStorage、纯离线运行。
- 评分：官方文档**没公布评分维度**（之前对话用的那张"创新/技术/完整度/展示"表是上一次黑客松的，别当这次圣旨）。这次是评委扫码体验+提问+现场投票+选手互投(每人3票)。

## 怎么跑 / 验证
- 本地：项目根已起 `python3 -m http.server 8137`（若没起，重起）。开 `http://localhost:8137/game_v3.html`。
- CDP 自验证（web-access skill）：`node ~/.claude/skills/web-access/scripts/check-deps.mjs` 启 proxy(localhost:3456)，`/new`开tab、`/eval`、`/screenshot`、`/close`。game_v3 内置 `window.__walk()`(模拟走到出口验证连续)、`window.__g()`(读状态)。**这些调试钩子正式交付前删。**

## 文档地图
| 文件 | 内容 |
|---|---|
| `README.md` | 队友：怎么跑/玩（含 GitHub Pages 在线版，但那是旧 index.html） |
| `docs/01-研究报告-…` | 恐怖机制/脑科学/地震知识/引擎选型（带来源） |
| `docs/02-游戏设计文档.md` | 设计铁律/正解表/分工/v1·v2 揭示分层 |
| `CHANGELOG.md` | 里程碑时间线 |
| `/Users/macbookair/Desktop/handover.md` | 四人团队会议纪要（场景/分工/玩法共识） |
