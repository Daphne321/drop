// 儿童房 KidsRoom —— 「余震·DROP」地震逃生游戏的支线探索房间。
// 设计灵魂:这是全游戏唯一一间「明快色」房间(粉/黄/蓝),但被全局神秘暗灰氛围一压,
//          就成了「被废弃的童真」——彩色玩具散落满地、小床被震得移位、矮柜倒地。
//          玩家走进来,会本能地心头一紧:这里曾住着一个孩子。这是全游戏的情感冲击点。
//
// 自包含约定(五条铁律):
//   1. 零外部文件 / 零 addons —— 只用传进来的 THREE(import * as THREE),几何全程序化拼,纹理全 canvas 现画。
//   2. 绝不加全局光(AmbientLight/HemisphereLight/DirectionalLight) —— 只用「有位置的」PointLight(0xffd9a0),
//      否则整栋楼会被照亮,毁掉暗灰氛围。
//   3. 材质 map 必拆包 —— 纹理工厂返回的若是 {map,normalMap} 对象,要写 map:tex.map 而不是 map:tex,
//      否则下一行 .repeat.set() 会因为 map 不是真 Texture 而抛 TypeError 崩黑屏。
//   4. 家具全是装饰(deco,不进碰撞数组),靠墙摆,留出门洞和走道,不挡逃生路。
//   5. 看不到渲染 —— 这里只保证几何正确 + 比例真实 + 能亮,视觉好坏由主 agent 用 CDP 截图把关。
//
// 入参:
//   scene —— game_v3 的主场景(所有物体最终 add 进它)
//   THREE —— Three.js 模块对象(由外部传入,不在本文件 import)
//   ox,oz —— 房间在游戏世界里的「放置原点」。房间内部所有物体先按自己的局部原点(0,0)摆好,
//           再统一挂进一个 root Group、把 root 平移到 (ox,0,oz)。这样改放置位置只改一处,绝不会算错坐标。
//
// 返回:{ root, floorMat, wallMat, ceilMat }
//   root     —— 房间总容器(想整体删除/移动这间房,操作它一个即可)
//   floorMat/wallMat/ceilMat —— 房间的地/墙/天花板材质,供集成处的 ground()/wallB() 复用
//                              (玩家踩的地、撞的墙 = 房间质感本身,视觉才统一)。
function buildKidsRoom(scene, THREE, ox, oz) {
  // ============================================================
  // 〇、root 容器 —— 「整间房子打包搬家」的纸箱
  //   把这间房所有物体都塞进 root,最后只把 root 挪到世界坐标 (ox,0,oz)。
  //   类比:与其把 50 件家具一件件搬到新家(每件都要重算坐标,极易算错),
  //        不如把它们全装进一个大纸箱,搬纸箱时家具的相对位置原封不动。
  // ============================================================
  const root = new THREE.Group();
  root.position.set(ox, 0, oz);
  scene.add(root);

  // 房间尺寸:宽 RW(沿 x)× 深 RD(沿 z)× 层高 RH。
  // 局部原点 (0,0) 设在房间地面正中心,所以四面墙在 ±RW/2、±RD/2 处。
  const RW = 7, RD = 7, RH = 3;

  // ============================================================
  // 一、程序化纹理工厂(从 skill 的 textures.md 整段拷进来,放函数内部当局部函数,
  //     避免与 game_v3 里别的房间函数全局命名冲突)。8MB 红线下零图片,全靠 canvas 现画。
  // ============================================================

  // 开一张正方形离屏 canvas(画纹理的「画布」)
  function makeCanvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return { canvas: c, ctx: c.getContext('2d') }; }

  // 撒细噪点(落灰/颗粒感)。amount=密度, lo/hi=明度扰动范围。
  function sprinkleNoise(ctx, size, amount, lo, hi) { const img = ctx.getImageData(0, 0, size, size); const d = img.data; for (let i = 0; i < d.length; i += 4) { if (Math.random() < amount) { const v = lo + Math.random() * (hi - lo); d[i] = Math.min(255, d[i] + v); d[i + 1] = Math.min(255, d[i + 1] + v); d[i + 2] = Math.min(255, d[i + 2] + v); } } ctx.putImageData(img, 0, 0); }

  // 由灰度图反推法线图:相邻像素明暗差=坡度=表面朝向。让裂纹/颗粒在光照下有真实凹凸,不是平贴纸。
  // strength 越大凹凸越强(墙 2.0, 地 2.5 是验证过的好值)。
  function normalFromCanvas(srcCanvas, strength) { const S = srcCanvas.width; const sctx = srcCanvas.getContext('2d'); const src = sctx.getImageData(0, 0, S, S).data; const { canvas, ctx } = makeCanvas(S); const out = ctx.createImageData(S, S); const o = out.data; const lum = (x, y) => { x = (x + S) % S; y = (y + S) % S; const i = (y * S + x) * 4; return (src[i] + src[i + 1] + src[i + 2]) / 3 / 255; }; for (let y = 0; y < S; y++) { for (let x = 0; x < S; x++) { const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength; const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength; const len = Math.sqrt(dx * dx + dy * dy + 1); const i = (y * S + x) * 4; o[i] = (dx / len * 0.5 + 0.5) * 255; o[i + 1] = (dy / len * 0.5 + 0.5) * 255; o[i + 2] = (1 / len * 0.5 + 0.5) * 255; o[i + 3] = 255; } } ctx.putImageData(out, 0, 0); const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex; }

  // 递归裂纹(地震墙裂的灵魂细节)
  function drawCracks(ctx, S, count) { for (let k = 0; k < count; k++) { let x = Math.random() * S, y = Math.random() * S * 0.5; let angle = Math.PI / 2 + (Math.random() - 0.5); let w = 2.2; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); const steps = 30 + Math.floor(Math.random() * 30); for (let i = 0; i < steps; i++) { angle += (Math.random() - 0.5) * 0.6; x += Math.cos(angle) * (6 + Math.random() * 8); y += Math.sin(angle) * (6 + Math.random() * 8); ctx.lineTo(x, y); if (Math.random() < 0.15) { let bx = x, by = y, ba = angle + (Math.random() - 0.5) * 1.6; ctx.lineWidth = w * 0.5; for (let j = 0; j < 8; j++) { ba += (Math.random() - 0.5) * 0.6; bx += Math.cos(ba) * 5; by += Math.sin(ba) * 5; ctx.lineTo(bx, by); } ctx.moveTo(x, y); ctx.lineWidth = w; } } ctx.stroke(); } }

  // 墙面(灰白裂纹水渍,破败底色)—— 儿童房的墙底色仍是暗灰,靠贴画/家具点彩色,反差才出得来。
  function wallTexture() { const S = 512; const { canvas, ctx } = makeCanvas(S); ctx.fillStyle = '#d3d2cc'; ctx.fillRect(0, 0, S, S); for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(120,118,110,${0.04 + Math.random() * 0.08})`; const r = 30 + Math.random() * 90; ctx.beginPath(); ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); ctx.fill(); } for (let i = 0; i < 14; i++) { const x = Math.random() * S; const y = S * 0.6 + Math.random() * S * 0.4; const g = ctx.createRadialGradient(x, y, 2, x, y, 40 + Math.random() * 50); g.addColorStop(0, 'rgba(60,58,52,0.22)'); g.addColorStop(1, 'rgba(60,58,52,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); } ctx.strokeStyle = 'rgba(40,38,34,0.55)'; drawCracks(ctx, S, 3); sprinkleNoise(ctx, S, 0.5, -16, 16); const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; return tex; }

  // 地板(脏旧木条纹 + 积灰)
  function floorTexture() { const S = 512; const { canvas, ctx } = makeCanvas(S); ctx.fillStyle = '#b4afa5'; ctx.fillRect(0, 0, S, S); for (let i = 0; i < S; i += 64) { ctx.fillStyle = i % 128 === 0 ? 'rgba(110,104,94,0.18)' : 'rgba(150,145,135,0.12)'; ctx.fillRect(0, i, S, 60); ctx.fillStyle = 'rgba(60,56,50,0.5)'; ctx.fillRect(0, i + 60, S, 3); } for (let i = 0; i < 30; i++) { const x = Math.random() * S, y = Math.random() * S; const g = ctx.createRadialGradient(x, y, 2, x, y, 30 + Math.random() * 60); g.addColorStop(0, 'rgba(205,203,196,0.35)'); g.addColorStop(1, 'rgba(205,203,196,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); } sprinkleNoise(ctx, S, 0.55, -20, 20); const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; return tex; }

  // 木纹(矮书架/玩具箱/床架等木家具)。base 是底色,深木 '#857769' / 浅木 '#a39788'。
  function woodTexture(base) { const S = 256; const { canvas, ctx } = makeCanvas(S); ctx.fillStyle = base; ctx.fillRect(0, 0, S, S); ctx.strokeStyle = 'rgba(70,58,46,0.3)'; ctx.lineWidth = 1.5; for (let i = 0; i < 24; i++) { ctx.beginPath(); let y = Math.random() * S; ctx.moveTo(0, y); for (let x = 0; x <= S; x += 16) { y += (Math.random() - 0.5) * 8; ctx.lineTo(x, y); } ctx.stroke(); } for (let i = 0; i < 10; i++) { const x = Math.random() * S, y = Math.random() * S; const g = ctx.createRadialGradient(x, y, 1, x, y, 25 + Math.random() * 40); g.addColorStop(0, 'rgba(200,196,186,0.28)'); g.addColorStop(1, 'rgba(200,196,186,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); } sprinkleNoise(ctx, S, 0.35, -12, 12); const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; return tex; }

  // 布料(床垫/小被子/地毯/毛绒)。base 底色,dusty=是否撒积灰。
  function fabricTexture(base, dusty) { const S = 256; const { canvas, ctx } = makeCanvas(S); ctx.fillStyle = base; ctx.fillRect(0, 0, S, S); ctx.globalAlpha = 0.06; for (let i = 0; i < S; i += 3) { ctx.fillStyle = i % 6 === 0 ? '#000' : '#fff'; ctx.fillRect(0, i, S, 1); ctx.fillRect(i, 0, 1, S); } ctx.globalAlpha = 1; if (dusty) { for (let i = 0; i < 18; i++) { const x = Math.random() * S, y = Math.random() * S; const g = ctx.createRadialGradient(x, y, 1, x, y, 20 + Math.random() * 40); g.addColorStop(0, 'rgba(210,208,200,0.3)'); g.addColorStop(1, 'rgba(210,208,200,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); } } sprinkleNoise(ctx, S, 0.4, -14, 14); const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; return tex; }

  // ============================================================
  // 二、共享材质(★map 必拆包★:纹理工厂返回真 Texture 的直接用,需要 .repeat 的先存变量再设)
  //   设计思路:墙/地/天花板用「暗灰破败」材质 → 房间整体压抑;
  //            玩具/贴画/床被用「明快纯色」材质(粉/黄/蓝) → 在暗灰里跳出来,反差揪心。
  // ============================================================
  const wallTex = wallTexture(); const wallNormal = normalFromCanvas(wallTex.image, 2.0);
  const floorTex = floorTexture(); const floorNormal = normalFromCanvas(floorTex.image, 2.5);
  floorTex.repeat.set(2, 2); floorNormal.repeat.set(2, 2);   // 儿童房较小,地纹重复 2×2 即够,不糊
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, normalMap: wallNormal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, metalness: 0.0, color: 0xffffff });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, normalMap: floorNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, metalness: 0.0 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xdeded8, roughness: 1 });

  // 木家具材质
  const woodLight = new THREE.MeshStandardMaterial({ map: woodTexture('#a39788'), roughness: 0.82, metalness: 0.04 });
  const woodDark = new THREE.MeshStandardMaterial({ map: woodTexture('#857769'), roughness: 0.8, metalness: 0.05 });

  // 明快纯色材质(儿童房的灵魂:粉/黄/蓝/绿)。roughness 高一点显得是哑光涂装/塑料玩具,不反光过头。
  const matPink = new THREE.MeshStandardMaterial({ color: 0xe88aa8, roughness: 0.7 });   // 粉:小被子/熊
  const matYellow = new THREE.MeshStandardMaterial({ color: 0xe8c84a, roughness: 0.7 }); // 黄:积木/玩具箱
  const matBlue = new THREE.MeshStandardMaterial({ color: 0x5a9fd8, roughness: 0.7 });   // 蓝:积木/书包
  const matGreen = new THREE.MeshStandardMaterial({ color: 0x6fb86f, roughness: 0.7 });  // 绿:积木点缀
  const matRed = new THREE.MeshStandardMaterial({ color: 0xd85a52, roughness: 0.7 });    // 红:皮球/积木
  const matOrange = new THREE.MeshStandardMaterial({ color: 0xe09a4a, roughness: 0.72 });// 橙:积木/玩具
  const matBearBody = new THREE.MeshStandardMaterial({ map: fabricTexture('#c9925e', true), roughness: 0.95 }); // 棕黄毛绒熊
  const matMattress = new THREE.MeshStandardMaterial({ map: fabricTexture('#dcd6c8', true), roughness: 0.96 }); // 床垫(米白布,沾灰)
  const matQuilt = new THREE.MeshStandardMaterial({ map: fabricTexture('#d87a96', true), roughness: 0.95 });    // 粉色小被子
  const matRug = new THREE.MeshStandardMaterial({ map: fabricTexture('#6f8aa8', true), roughness: 0.98 });      // 蓝灰小地毯
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.7 });        // 床架金属/拉链
  const cardboardMat = new THREE.MeshStandardMaterial({ color: 0xb89a72, roughness: 0.95 });                   // 纸箱/旧纸板

  // 不同色的积木材质池(撒积木时随机抽一个),让满地积木五彩斑斓。
  const blockMats = [matPink, matYellow, matBlue, matGreen, matRed, matOrange];

  // ============================================================
  // 三、小工具:box() 建带阴影的盒子并自动 add 进 root(局部坐标);cyl() 同理建圆柱。
  //   注意:这里 add 进的是 root(局部坐标系),整体平移交给最外层 root.position,
  //        所以函数内所有坐标都按「房间自己 (0,0) 中心」写,完全不用管 ox/oz。
  // ============================================================
  function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; }
  function cyl(rt, rb, h, mat, x, y, z, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; }
  // 把一个自建 Group 摆到位置并加进 root(给「整件家具」用,家具内部各零件用局部坐标拼好)
  function place(g, x, y, z) { g.position.set(x, y, z); g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); root.add(g); return g; }

  // ============================================================
  // 四、房间外壳:地板 + 四面墙 + 天花板。
  //   ⚠️ 这里建的外壳只是「视觉」,真正进碰撞数组(walls/grounds)的工作在集成处用 ground()/wallB() 做
  //      (见文件末「集成说明」)。本函数自包含,所以也画一份视觉外壳,但它们不参与射线检测——
  //      集成时 ground()/wallB() 会在同位置叠一份带碰撞的,材质就用本函数返回的 floorMat/wallMat。
  //   门洞:假设支线门开在「南墙」(+z 那面)正中,所以南墙拆成「门左段 + 门右段 + 门楣」,留 1.4 宽门洞。
  // ============================================================
  const DOOR_W = 1.4;            // 门洞宽
  const DOOR_H = 2.2;            // 门洞高
  const sideW = (RW - DOOR_W) / 2; // 门两侧墙段各自的宽度

  // 地板(顶面 y=0:盒高 0.3,中心 y=-0.15,顶面正好 0,与游戏二楼地面齐平)
  box(RW, 0.3, RD, floorMat, 0, -0.15, 0);
  // 天花板(顶面贴层高 RH)
  box(RW, 0.2, RD, ceilMat, 0, RH - 0.1, 0);
  // 北墙(-z 那面,完整一面)
  box(RW, RH, 0.3, wallMat, 0, RH / 2, -RD / 2);
  // 东墙(+x 那面)
  box(0.3, RH, RD, wallMat, RW / 2, RH / 2, 0);
  // 西墙(-x 那面)
  box(0.3, RH, RD, wallMat, -RW / 2, RH / 2, 0);
  // 南墙(+z 那面)= 门左段 + 门右段 + 门楣,中间留门洞
  box(sideW, RH, 0.3, wallMat, -(DOOR_W / 2 + sideW / 2), RH / 2, RD / 2);  // 门左段
  box(sideW, RH, 0.3, wallMat, (DOOR_W / 2 + sideW / 2), RH / 2, RD / 2);   // 门右段
  box(DOOR_W, RH - DOOR_H, 0.3, wallMat, 0, DOOR_H + (RH - DOOR_H) / 2, RD / 2); // 门楣(门洞上方那条)

  // ============================================================
  // 五、家具(多 box/cylinder 拼,绝不一个大方块糊弄;靠墙摆,门洞与正中走道留空)。
  //   全部用 .rotation 加歪斜表现「被地震震过」。
  // ============================================================

  // —— 5.1 小床(矮床架 + 床垫 + 歪掉的小被子)——
  //   被地震震得整体移位 + 微微转了个角度(rotation.y),床头偏离原本贴的墙。
  //   靠北墙摆。床头朝西(-x),床身沿 x 方向。
  function buildBed() {
    const g = new THREE.Group();
    // 床架:底板 + 四条矮腿 + 围栏(儿童床有防摔围栏,这是它和成人床的区别)
    g.add(boxL(1.7, 0.18, 0.95, woodLight, 0, 0.28, 0));        // 床底板
    for (const sx of [-0.78, 0.78]) for (const sz of [-0.4, 0.4]) g.add(boxL(0.1, 0.28, 0.1, woodDark, sx, 0.14, sz)); // 四条矮腿
    g.add(boxL(1.7, 0.5, 0.08, woodLight, 0, 0.6, -0.44));      // 床头挡板(北侧)
    g.add(boxL(1.7, 0.3, 0.08, woodLight, 0, 0.5, 0.44));       // 床尾挡板
    // 床垫(沾灰米白布)
    const mat = boxL(1.6, 0.16, 0.85, matMattress, 0, 0.45, 0);
    g.add(mat);
    // 小被子(粉色)——被掀到一边、皱成一团,所以歪着放、压在床尾
    const quilt = boxL(0.9, 0.12, 0.8, matQuilt, 0.3, 0.55, 0.05);
    quilt.rotation.set(0.05, 0.4, 0.08);
    g.add(quilt);
    // 一个小枕头(黄)歪在床头
    const pillow = boxL(0.45, 0.12, 0.32, matYellow, -0.5, 0.56, -0.1);
    pillow.rotation.z = 0.15;
    g.add(pillow);
    return g;
  }
  // boxL:建一个不 add 进 root 的局部 box(给「家具组」内部拼装用,最后整组由 place 平移加入)
  function boxL(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
  function cylL(rt, rb, h, mat, x, y, z, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }

  const bed = buildBed();
  // 靠北墙,但被震得偏离墙、转了 0.12 弧度(约 7°),床脚翘起一点点(rotation.x)——「移位」感。
  place(bed, -1.4, 0, -RD / 2 + 0.85, 0);
  bed.rotation.y = 0.12;

  // —— 5.2 玩具箱(黄色木箱,盖子被掀开歪在一旁,玩具倾倒而出)——
  //   靠东墙。盖子用 rotation.x 掀开 + 一些积木「正从箱口涌出」的姿态暗示地震把它震翻。
  function buildToyBox() {
    const g = new THREE.Group();
    g.add(boxL(0.9, 0.6, 0.6, matYellow, 0, 0.3, 0));          // 箱体
    g.add(boxL(0.84, 0.12, 0.54, matBlue, 0, 0.66, 0));        // 箱内一层蓝色衬里(从掀开的盖子能看到)
    const lid = boxL(0.92, 0.06, 0.62, woodLight, 0, 0.72, -0.36); // 盖子
    lid.rotation.x = -1.1; // 掀开约 63°
    g.add(lid);
    return g;
  }
  place(buildToyBox(), RW / 2 - 0.55, 0, -1.6, 0);

  // —— 5.3 矮书架(倒地!)——
  //   这是房间最重的家具,也是科普核心:高家具地震时会倒下压人。
  //   它被震得整个朝前(+z)扑倒在地,书本和绘本散落。rotation.x≈-1.55(几乎平躺)。
  function buildShelf() {
    const g = new THREE.Group();
    // 立着时的结构:两块侧板 + 三层隔板 + 背板。建好后整组旋转放倒。
    g.add(boxL(0.06, 1.1, 0.32, woodDark, -0.55, 0.55, 0));    // 左侧板
    g.add(boxL(0.06, 1.1, 0.32, woodDark, 0.55, 0.55, 0));     // 右侧板
    g.add(boxL(1.16, 0.05, 0.32, woodDark, 0, 0.02, 0));       // 底隔板
    g.add(boxL(1.16, 0.05, 0.32, woodDark, 0, 0.55, 0));       // 中隔板
    g.add(boxL(1.16, 0.05, 0.32, woodDark, 0, 1.08, 0));       // 顶隔板
    g.add(boxL(1.16, 1.1, 0.03, woodLight, 0, 0.55, -0.15));   // 背板
    // 几本彩色绘本卡在隔板上(放倒后它们会随书架一起躺平,部分歪出来)
    const bookColors = [matPink, matBlue, matYellow, matGreen, matRed];
    for (let i = 0; i < 6; i++) {
      const bk = boxL(0.04 + Math.random() * 0.03, 0.22, 0.26, bookColors[i % bookColors.length], -0.4 + i * 0.16, 0.18, 0.02);
      bk.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(bk);
    }
    return g;
  }
  const shelf = buildShelf();
  // 靠西墙原位,被震倒:绕 x 轴前倾近 90° 拍在地上(rotation.x≈-1.5),书架顶端朝向房间中心。
  place(shelf, -RW / 2 + 0.9, 0.1, 1.0, 0);
  shelf.rotation.set(-1.5, 0.2, 0.05);

  // —— 5.4 矮柜(也倒了,小)——配合科普「高/重家具会倒」,再来一个倒下的矮柜增强说服力。
  function buildCabinet() {
    const g = new THREE.Group();
    g.add(boxL(0.7, 0.7, 0.4, woodLight, 0, 0.35, 0));         // 柜体
    g.add(boxL(0.32, 0.5, 0.02, matBlue, -0.17, 0.35, 0.21));  // 左抽屉面(蓝)
    g.add(boxL(0.32, 0.5, 0.02, matPink, 0.17, 0.35, 0.21));   // 右抽屉面(粉)
    g.add(cylL(0.025, 0.025, 0.04, metalMat, -0.17, 0.35, 0.24)); // 左拉手
    g.add(cylL(0.025, 0.025, 0.04, metalMat, 0.17, 0.35, 0.24));  // 右拉手
    return g;
  }
  const cab = buildCabinet();
  place(cab, RW / 2 - 0.7, 0.35, 1.7, 0);
  cab.rotation.set(1.45, 0.3, 0); // 朝后倒(-z 反向),柜门朝下趴地

  // —— 5.5 毛绒玩具熊(球 + box 拼,坐在床边地上)——情感锚点:被遗落的小熊。
  //   头=球,身=圆角靠 box 近似,四肢=小 box,耳朵=两个小球。歪倒在地、一只手臂伸着。
  function buildBear() {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), matBearBody);
    head.position.set(0, 0.5, 0.02); g.add(head);
    g.add(boxL(0.26, 0.34, 0.2, matBearBody, 0, 0.26, 0));     // 身体
    // 耳朵
    for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), matBearBody); ear.position.set(ex, 0.61, 0.02); g.add(ear); }
    // 鼻子(深色小球)
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), woodDark); nose.position.set(0, 0.48, 0.16); g.add(nose);
    // 四肢
    g.add(boxL(0.09, 0.22, 0.09, matBearBody, -0.18, 0.3, 0.02)); // 左臂(伸着)
    g.add(boxL(0.09, 0.2, 0.09, matBearBody, 0.16, 0.28, 0.04));  // 右臂
    g.add(boxL(0.1, 0.18, 0.1, matBearBody, -0.08, 0.07, 0.05));  // 左腿
    g.add(boxL(0.1, 0.18, 0.1, matBearBody, 0.08, 0.07, 0.05));   // 右腿
    return g;
  }
  const bear = buildBear();
  // 摔倒在床边地上:整体放倒(rotation.x 让它躺平),朝向门口——像在「等人回来」,揪心。
  place(bear, -0.4, 0.12, -1.0, 0);
  bear.rotation.set(-1.3, 0.6, 0.2);

  // —— 5.6 书包(蓝色,带肩带,歪靠在墙角)——
  function buildBackpack() {
    const g = new THREE.Group();
    g.add(boxL(0.34, 0.42, 0.18, matBlue, 0, 0.21, 0));        // 包主体
    g.add(boxL(0.3, 0.18, 0.06, matBlue, 0, 0.12, 0.1));       // 前袋
    // 两条肩带(深色细 box)
    for (const sx of [-0.1, 0.1]) { const strap = boxL(0.05, 0.4, 0.03, woodDark, sx, 0.25, -0.1); strap.rotation.x = 0.2; g.add(strap); }
    g.add(cylL(0.015, 0.015, 0.1, metalMat, 0, 0.45, -0.05));  // 顶部提环
    return g;
  }
  const bag = buildBackpack();
  place(bag, RW / 2 - 0.4, 0, 2.6, 0);
  bag.rotation.set(0.3, -0.4, 0.5); // 歪倒靠墙角

  // —— 5.7 皮球(红色)滚到了房间中央偏边 ——
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14), matRed);
  ball.position.set(0.8, 0.16, 0.3); ball.castShadow = true; root.add(ball);

  // ============================================================
  // 六、墙贴画(彩色薄 box 贴在墙上)——明快色的主要来源之一,在暗灰墙上跳出来。
  //   贴在北墙内侧(z=-RD/2+0.16,薄薄一层浮在墙面前),被震得有的歪、有的快掉下来。
  // ============================================================
  function decal(w, h, mat, x, y, rotZ) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), mat);
    m.position.set(x, y, -RD / 2 + 0.17); m.rotation.z = rotZ || 0; m.castShadow = m.receiveShadow = true; root.add(m); return m;
  }
  decal(0.5, 0.5, matYellow, -2.0, 1.9, 0.08);   // 黄色太阳贴画(歪)
  decal(0.4, 0.6, matBlue, -1.2, 1.7, -0.15);    // 蓝色贴画(歪另一边)
  decal(0.6, 0.4, matPink, 1.6, 2.0, 0.05);      // 粉色贴画
  decal(0.45, 0.3, matGreen, 0.6, 1.5, 0.4);     // 绿色贴画(快掉下来,几乎横了)
  // 一张贴画已经掉到地上(平躺)
  const fallen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.4), matOrange);
  fallen.position.set(-2.4, 0.02, -2.0); fallen.rotation.set(0, 0.7, 0); fallen.receiveShadow = true; root.add(fallen);

  // ============================================================
  // 七、散落积木 + 碎物(地震后狼藉的地面层)。
  //   ① 一大堆彩色积木(小 box,随机色/位置/旋转)散满地——童真被打碎的视觉核心。
  //   ② 一层灰白小碎块(掉落的墙皮/灰泥)压在彩色之上,把明快色「压暗」,反差揪心。
  //   注意避开门洞(+z 那面正中)和正中走道,别让玩家走进来就一脚踩在「视觉障碍」上(虽然不碰撞,但视觉别堵门)。
  // ============================================================
  // 判断某点是否落在门洞前的走道区(留空,不撒东西):门洞中心在 (0, +RD/2),走道宽约 DOOR_W。
  function inDoorway(x, z) { return Math.abs(x) < DOOR_W / 2 + 0.3 && z > RD / 2 - 1.6; }

  // ① 彩色积木(40 块):多数是 cube,少数是长条/圆柱(积木形状多样)。
  const blocks = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    let x, z, tries = 0;
    do { x = (Math.random() - 0.5) * (RW - 1.2); z = (Math.random() - 0.5) * (RD - 1.2); tries++; } while (inDoorway(x, z) && tries < 8);
    const mat = blockMats[Math.floor(Math.random() * blockMats.length)];
    const r = Math.random();
    let m;
    if (r < 0.7) {           // 立方积木
      const s = 0.1 + Math.random() * 0.06;
      m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
    } else if (r < 0.88) {   // 长条积木
      m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.24), mat);
    } else {                 // 圆柱积木
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), mat);
    }
    m.position.set(x, 0.06 + Math.random() * 0.03, z);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = m.receiveShadow = true;
    blocks.add(m);
  }
  root.add(blocks);

  // ② 灰白碎块(35 块墙皮/灰泥,压在彩色之上,把童真「蒙上灰」)
  const debris = new THREE.Group();
  for (let i = 0; i < 35; i++) {
    let x, z, tries = 0;
    do { x = (Math.random() - 0.5) * (RW - 0.8); z = (Math.random() - 0.5) * (RD - 0.8); tries++; } while (inDoorway(x, z) && tries < 8);
    const s = 0.04 + Math.random() * 0.12;
    const shade = 0.6 + Math.random() * 0.28;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * (0.4 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.8)),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(shade, shade, shade * 0.97), roughness: 0.95 })
    );
    m.position.set(x, s * 0.4, z);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = m.receiveShadow = true;
    debris.add(m);
  }
  root.add(debris);

  // 小地毯(蓝灰,被踢歪到床和门之间)——盖住部分散落,给画面一点「分层」。
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2, 3, 3), matRug);
  rug.rotation.set(-Math.PI / 2, 0, 0.5); rug.position.set(0.5, 0.012, 0.6); rug.receiveShadow = true; root.add(rug);

  // 墙上掉灰泥露出的暗斑(贴北墙)——破败质感,和别的房间统一。
  const patchMat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 1 });
  box(0.7, 0.9, 0.02, patchMat, 2.2, 1.7, -RD / 2 + 0.16);
  box(0.4, 0.5, 0.02, patchMat, -2.8, 2.1, -RD / 2 + 0.16);

  // ============================================================
  // 八、科普埋点(把救命知识焊进场景实物,不是只堆字)。
  //   ① 一块小小的「安全角落」指示牌立在结实矮柜倒地处旁的墙角 —— 但讽刺的是柜子已经倒了。
  //      牌面用纯色 box 近似(看不清字也能靠造型 + 主 agent 后续可在集成处叠 CanvasTexture 文字)。
  //   ② 真正的安全角:床(矮、结实、贴墙)是地震时孩子可躲的「结实家具旁」——
  //      在床与墙的夹角处留一小块「干净空地」(不撒碎块),暗示「这里本可以救命」。
  //   情感+科普合一:护住孩子头颈、躲到结实矮家具旁、远离会倒的高书架/矮柜。
  // ============================================================
  // 安全提示牌:黄底(警示色)薄板 + 立杆,立在床边墙角(那个本应是安全角的位置)。
  const signMat = new THREE.MeshStandardMaterial({ color: 0xe8c84a, roughness: 0.6, emissive: 0x3a3210, emissiveIntensity: 0.4 });
  const signPanel = box(0.34, 0.26, 0.02, signMat, -RW / 2 + 0.45, 1.2, -RD / 2 + 0.5);
  signPanel.rotation.y = 0.5; // 朝向房间中心
  // 牌上画一个简化的「护头蹲下」图标(深色小 box 拼小人:头+身+举起的手臂)
  const iconMat = new THREE.MeshStandardMaterial({ color: 0x2a2820, roughness: 0.8 });
  const icon = new THREE.Group();
  icon.add(boxL(0.05, 0.05, 0.005, iconMat, 0, 0.04, 0));     // 头
  icon.add(boxL(0.06, 0.07, 0.005, iconMat, 0, -0.02, 0));    // 蜷起的身体
  icon.add(boxL(0.07, 0.02, 0.005, iconMat, 0, 0.06, 0));     // 护在头顶的手臂(横在头上方)
  icon.position.set(-RW / 2 + 0.45 + Math.sin(0.5) * 0.015, 1.2, -RD / 2 + 0.5 + Math.cos(0.5) * 0.015);
  icon.rotation.y = 0.5;
  icon.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  root.add(icon);

  // ============================================================
  // 九、照明:1~2 盏暖橙 PointLight(0xffd9a0),只照亮本房间局部。
  //   ⚠️ 绝不加全局光(Ambient/Hemisphere/Directional),否则整栋楼变亮,毁掉暗灰氛围。
  //   设计:一盏主吸顶暖灯居中偏高,把彩色玩具/贴画微微照亮(但环境仍暗),
  //        让「明快被压在暗里」的反差成立——这是本房间的情感美术核心。
  //   PointLight 参数:(颜色, 强度, 作用半径, 衰减指数)。半径设到刚好罩住房间不外溢。
  // ============================================================
  const lamp1 = new THREE.PointLight(0xffd9a0, 3.4, 9, 2);
  lamp1.position.set(0, RH - 0.4, -0.3); root.add(lamp1);            // 主吸顶暖灯(偏房间中心)
  const lamp2 = new THREE.PointLight(0xffe2b0, 2.0, 6, 2);
  lamp2.position.set(-1.0, 1.4, -2.0); root.add(lamp2);             // 床头一盏更暖更弱的小夜灯,聚焦小床/小熊(情感焦点)

  // 飘浮灰尘(地震后空气里的尘埃,200 点,房间小所以少一些)——强化「被遗弃」的静默感。
  const COUNT = 200; const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) { pos[i * 3] = (Math.random() - 0.5) * RW; pos[i * 3 + 1] = Math.random() * RH; pos[i * 3 + 2] = (Math.random() - 0.5) * RD; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe8ebee, size: 0.022, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true }));
  root.add(dust);

  // 返回材质给集成处复用(ground/wallB 用同一套质感,踩的地/撞的墙才和这间房视觉统一)。
  return { root, floorMat, wallMat, ceilMat };
}
