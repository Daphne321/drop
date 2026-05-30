# game_v3 集成参考（坐标系 / helper / 支线门洞 / 坑 / CDP 验收）

建好 `buildXxxRoom` 函数后，靠这份把它接进 game_v3.html 的连续空间。**断言任何坐标/常量前先去 game_v3.html grep 核实**（行号会变，别凭这份的数字硬写）。

## 关键常量（game_v3 顶部定义，grep 确认）

```
EYE = 1.6      // 眼高(玩家相机离地高度)
H   = 3        // 层高
F1  = -3.3     // 一楼地面 y(二楼地面 y=0)
CW  = 2        // 走廊半宽(走廊 z∈[-2,2])
```

- **二楼地面顶面 y=0**，一楼 y=-3.3。房间地板用 `ground(...)` 时，地板盒中心 y 取 `-0.15`（盒高 0.3，顶面正好 0）。
- **坐标轴**：游戏是**连续东西轴**——卧室 x[-13,-5] → 走廊 x[-5,0] → 客厅 x[0,9] → 走廊 x[9,15] → 楼梯 x[15,20] 下楼 → 一楼 x[20,29] → 单元门 x=29。全程主通道 z∈[-2,2]。

## ⚠️ yaw 朝向反直觉（踩过多次）

此相机系统 **yaw=0 朝 -z，yaw=Math.PI 朝 +z，yaw=-Math.PI/2 朝东(+x)**。设支线房间的进入朝向、或调试相机时务必验证，别搞反导致"背对房间/困在墙里"。

## helper 函数（game_v3 已有，直接调）

```javascript
ground(w,h,d,x,y,z,m)   // 加地板/台阶: 进 grounds[](玩家踩)，m=材质(默认 mFloor)
wallB(w,h,d,x,y,z,m)    // 加墙: 进 walls[](玩家撞)，m=材质(默认 mWall)
deco(w,h,d,x,y,z,m)     // 加装饰: 不进任何碰撞数组(不挡不踩)，家具/散落物全用它
warmLamp(x,y,z)         // 加一盏暖橙 PointLight(0xffd9a0)，房间照明用
```

- `grounds[]` / `walls[]` 是全局数组，射线检测靠它们。家具**绝不进**这俩（用 deco）。
- 材质：`mFloor`/`mWall`/`mStep`/`mExit` 是全局共享材质。新房间想要独立质感，给 `ground`/`wallB` 传你 `buildXxxRoom` 返回的 `floorMat`/`wallMat`/`ceilMat`。

## 支线房间怎么接（核心：开门洞 + 无缝拼地板）

支线房间挂在**现有空间某面墙外侧**。三步：

**① 在现有墙上开门洞**：把那段完整墙拆成「门左段 + 门右段 + 门楣」，中间留 1.3~1.5 宽门洞。例：在客厅北墙(z=-4, x[0,9])正中开门通往北侧厨房：
```javascript
// 原本: wallB(9,H,0.3,4.5,H/2,-4,LR.wallMat);  // 一整面北墙
// 改成留门洞(门在 x=4.5, 宽1.4):
wallB(3.3,H,0.3,1.85,H/2,-4,wallMat);   // 门左段 x[0,3.3]... 实际按门洞位置算两侧长度
wallB(3.3,H,0.3,7.15,H/2,-4,wallMat);   // 门右段
wallB(1.4,H-2.2,0.3,4.5,H-(H-2.2)/2,-4,wallMat);  // 门楣(门洞上方那条)
```

**② 房间建在墙外侧**：厨房在客厅北边，房间占 z[-12,-4]（往 -z 延伸），x 居中对齐门洞。`buildKitchenRoom(scene,THREE, 4.5, -8)` 把房间原点放门洞正北。

**③ 地板无缝拼接 + 进 grounds/walls**：房间地板顶面也 y=0，和门洞处的客厅地板齐平；门洞地面要连续（别留缝，否则玩家走进门掉出地板)。房间四面墙(除门洞那面)进 `walls[]`，地板进 `grounds[]`。

**支线可以是死胡同**：玩家进去探索完原路返回，不需要第二个出口——这正是支线探索的设计（丰富探索度，不影响主逃生路）。

## 集成后必做的两个验证

1. **`window.__walk()`**：game_v3 内置（开发钩子，交付前删）。从卧室模拟直走到单元门，返回 `{reachedExit, logs}`。加了支线房间后**主路径必须仍 `reachedExit:true`**、logs 无 `卡墙`/`掉地板`——支线是岔路，不该破坏主线连续性。
2. **走进支线验证**：支线在岔路上，`__walk` 只走主线验不到。让 Tim 前台真走进去，或临时加个 `window.__view(x,z,yaw)` 钩子把相机瞬移到支线房间 CDP 截图（验收完删钩子）。

## CDP 视觉验收（铁律：必须主 agent 亲眼看）

用 web-access skill 连本地 Chrome：

```bash
# 1. 启 proxy(localhost:3456)
node ~/.claude/skills/web-access/scripts/check-deps.mjs
# 2. 开后台 tab(本地 http server 默认 8137，没起就 python3 -m http.server 8137)
curl -s "http://localhost:3456/new?url=http://localhost:8137/game_v3.html"   # 返回 targetId
# 3. 查报错/状态
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'JSON.stringify({canvas:!!document.querySelector("canvas")})'
# 4. 瞬移相机到房间 + 截图(配合临时 __view 钩子)
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'window.__view(x,z,yaw)'
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/room.png"       # 然后 Read 这张图
# 5. 验收完关 tab
curl -s "http://localhost:3456/close?target=ID"
```

- **后台标签 rAF 被节流**：截图前 `sleep 1.5~2` 让它渲染一帧。
- **临时调试钩子**（`__view`/`__walk`）正式交付前一律删。
- 看什么：比例对不对、太黑没有(暗灰≠纯黑，要能看清家具)、家具穿模没、暗灰+暖灯焦点氛围在不在、地震破败感够不够。

## 集成踩坑

- **接缝错位 = 掉地板**：门洞处房间地板和现有地板必须精确对齐、无缝。改完必 `__walk`。
- **`$=getElementById` 不能配 CSS 选择器**（`$('#x .y')`→null→崩），用 `document.querySelector`。
- **后台 rAF 节流**：依赖走动/时间的动态逻辑 CDP 后台跑不动，用钩子瞬移或让 Tim 前台真玩。
