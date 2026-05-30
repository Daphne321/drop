---
name: drop-room-builder
description: 给「余震·DROP」地震逃生游戏(game_v3.html，Three.js 纯前端连续空间)从零程序化建造新的支线探索房间(厨房/卫生间/阳台/书房/储藏室/儿童房等)并集成进游戏。当用户要给 DROP 游戏「加房间」「建一个厨房/卫生间/阳台」「丰富 mini 世界/探索度」「批量造几个房间」，或在这个项目里扩展可探索空间时，务必用本 skill——它把 8MB 离线红线下程序化建房间的完整流程和所有踩过的坑(材质 map 拆包崩溃/全局光污染暗灰氛围/家具挡逃生路/agent 盲建视觉必翻车)固化好了，不用它每个新房间都会重踩一遍。
---

# DROP 房间建造器

把「给 DROP 游戏建一个新房间」固化成可复制、可并行的流水线。**每个房间 = 一个自包含的 `buildXxxRoom(scene, THREE, ox, oz)` 函数 + 一小段集成代码**：程序化生成几何与纹理、零外部文件、守住 8MB 离线红线。

主力文件是项目根的 `game_v3.html`（开发改它，发布前复制成 `index.html`）。新房间默认做成**支线探索房间**：主逃生路旁开一道门，玩家可选走进去探索，不进也能通关——这样每个房间相对独立，最适合并行批量造。

## 什么时候用 / 不用
- **用**：给 DROP 加任何可走进去的房间（厨房/卫生间/阳台/书房/儿童房/储藏室/车库/楼道…），尤其要批量造多个形成 mini 世界。
- **不用**：改玩法逻辑、改主逃生路线、做"切场景"的独立过场（死亡黑盒/通关结局那类相机瞬切的，模式不同，参考 game_v3 里 `buildDeathScene`/`buildExterior` 的写法即可，不归本 skill）。

## 🔴 五条不可妥协铁律（先记死，违反必翻车）

这五条是从真实事故里提炼的，每条都有血泪：

1. **8MB 离线红线 + 零外部依赖**：禁任何图片/模型/音频/HDR 文件，禁 CDN，禁 `three/addons`（OrbitControls/EffectComposer/Bloom/GLTFLoader 全禁——game_v3 只 `import * as THREE from 'three'`，本地只有 `three.module.js` 一个文件）。所有质感用 `<canvas>` 现画纹理，所有几何程序化拼。**违反 = 离线打包跑不起来 = 比赛直接挂。**

2. **绝不加全局光**：禁 `AmbientLight`/`HemisphereLight`/`DirectionalLight`——它们没位置、是全局的，会把整栋楼都照亮，毁掉 Tim 极满意的"神秘暗灰"氛围。房间照明只用**有位置的 `PointLight`**（暖橙 `0xffd9a0` 当吸顶灯/台灯），照亮局部。

3. **材质 map 必须拆包**：程序化纹理工厂常返回 `{map, normalMap}` 打包对象。**绝不能把整个对象当 map 传**（`new MeshStandardMaterial({map: 那个对象})`）——下一行 `.repeat.set()` 会因为 map 不是真 Texture 抛 TypeError，整段脚本崩 → "UI 在但 3D 一片黑"。正确：`map: tex.map, normalMap: tex.normalMap`。

4. **不挡逃生路 + 留进出口**：支线房间靠墙摆家具，门洞处不放东西。家具一律用**装饰（不进碰撞数组）**，玩家能穿过去不被卡死。集成后必须 `window.__walk()` 验证主路径仍 `reachedExit:true`。

5. **视觉只能主 agent 用 CDP 验收**：subagent/盲写代码看不到渲染，极容易把画面堆黑或比例失调。**subagent 只负责"机械产出几何/材质代码"，好不好一律主 agent 开 CDP 截图把关**。这是铁律，不是建议。

## SOP 七步

> 走流水线时按需读对应 reference：纹理代码看 `references/textures.md`，坐标系/集成点看 `references/integration.md`，某种房间放什么家具看 `references/room-catalog.md`。

1. **定房间 + 查家具清单**：确定要建什么房间（厨房/卫生间/阳台…），去 `references/room-catalog.md` 查这种房间该有哪些家具、什么破败细节、什么色调。

2. **定接入点**：决定支线门开在现有空间的哪面墙（卧室/客厅/走廊的某段墙），房间往哪个方向延伸（留出 game_v3 现有几何之外的空地，避免和别的房间重叠）。坐标规则见 `references/integration.md`。

3. **写 `buildXxxRoom(scene, THREE, ox, oz)` 自包含函数**：
   - 纹理工厂从 `references/textures.md` 直接拷（别每个房间重写——这是这次发现的重复劳动）。
   - 房间外壳（地板/四面墙/天花板/门洞）+ 家具（多 box 拼，按 catalog）+ 地震破败细节 + 1~2 盏暖 `PointLight`。
   - 所有物体坐标先按"房间自己原点"摆，再 `+ox/+oz` 平移到世界位置（或挂一个 Group 整体平移）。
   - 模板见下方「房间函数骨架」。

4. **集成进 game_v3**：
   - 房间地板加进 `grounds[]`（玩家能踩）、墙加进 `walls[]`（能撞）、门洞两侧留墙、门洞和接入点的走廊对齐无缝（接缝错位玩家会掉出地板）。
   - 家具用 `deco()`（纯装饰不碰撞），别进 `walls[]`/`grounds[]`。
   - 具体 helper（`ground`/`wallB`/`deco`/`warmLamp`）和坐标对齐见 `references/integration.md`。

5. **`__walk()` 验连续**：跑 `window.__walk()`（game_v3 内置调试钩子，正式交付前会删），确认主逃生路 `reachedExit:true`、没 `卡墙`/`掉地板` 日志。新房间是支线，不应影响主路径连续性。

6. **CDP 截图验收**（铁律 5）：开浏览器进房间截几个角度，主 agent 亲眼看——比例对不对、太黑没有、家具穿模没、暗灰氛围在不在。翻车就调，别信"应该没问题"。CDP 操作流程见 `references/integration.md` 末尾。

7. **8MB + 报错复检**：`grep` 确认没引入外部 URL/addons，CDP `eval` 确认无 JS 报错、canvas 正常。

## 房间函数骨架（照这个填）

```javascript
// buildKitchenRoom —— 厨房支线房间。零外部文件、零 addons、零全局光。
// 入参 ox,oz = 房间在世界里的放置原点(房间自己以 0,0 为中心建，最后 +ox/+oz 平移)。
// 返回 {floorMat, wallMat, ceilMat} 给集成处的 ground/wallB 复用(玩家踩的地、撞的墙=房间质感本身)。
function buildKitchenRoom(scene, THREE, ox, oz){
  // 1) 程序化纹理工厂(从 references/textures.md 拷，按房间需要选墙/地/木/瓷砖/金属)
  // 2) 共享材质(★拆包★: map: tex.map, normalMap: tex.normalMap)
  // 3) 家具(多 box 拼，按 references/room-catalog.md 的厨房清单，全部 +ox/+oz)
  // 4) 地震破败细节(散落物/裂纹斑/掉落碎块)
  // 5) 1~2 盏暖 PointLight(0xffd9a0)照亮房间，position 记得 +ox/+oz
  return {floorMat, wallMat, ceilMat};
}
```

## 批量并行（这是 skill 的杀手锏）

支线房间彼此独立，**可以一次派多个 subagent 各建一个房间**，主 agent 只做接入点决策 + CDP 统一验收：

- 给每个 subagent 的 prompt 里写明：① 加载本 skill ② 建哪个房间(附 room-catalog 对应条目) ③ 五条铁律 ④ **只产出 `buildXxxRoom` 函数代码 + 集成说明，不要改 game_v3.html**(多 agent 并行改同一文件会冲突)。
- subagent 回来后主 agent 逐个粘进 game_v3、开门洞接入、`__walk` + CDP 验收。
- 注意 subagent 输出代码里的 `<` `>` `&` 可能被转义成 `&lt;`/`&gt;`/`&amp;`，粘进去前还原。

## 踩坑速查（这次真踩过的）

| 坑 | 症状 | 解法 |
|---|---|---|
| 材质 map 没拆包 | UI 在但 3D 一片黑(TypeError) | `map: tex.map` 不是 `map: tex` |
| 加了全局光 | 整栋楼变亮、暗灰氛围毁了 | 只用有位置的 PointLight |
| 整包搬"自带房子"的资产 | 地图原点凭空多间房、几何打架 | 用 game_v3 骨架+换材质，或 Group 整体平移到空地 |
| 家具摆在通道上 | 玩家被卡死/穿模 | 靠墙摆 + 用 deco 不碰撞 + __walk 验 |
| UI 覆盖层挡 3D | 看不到房间只看到半透黑 | 覆盖层用底部渐变、别全屏不透明 |
| subagent 盲调视觉 | 堆黑/比例失调 | subagent 只出几何，主 agent CDP 验 |
| 接缝错位 | 玩家掉出地板 | 门洞和走廊坐标精确对齐 + __walk |

## references
- `references/textures.md` —— 可直接复用的程序化纹理工厂(墙/地/木纹/布料/瓷砖/混凝土 + 法线图生成)。建房间先拷这个，别重写。
- `references/integration.md` —— game_v3 坐标系、`ground`/`wallB`/`deco`/`warmLamp` helper、支线门洞怎么接、yaw/EYE/H 等关键常量和坑、CDP 验收命令。
- `references/room-catalog.md` —— 每种房间的家具清单 + 程序化建模要点 + 色调建议(厨房/卫生间/阳台/书房/儿童房/储藏室…)。
