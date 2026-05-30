// 储藏室 / 杂物间 —— 余震·DROP 支线探索房间(最压抑的房间:昏暗+单灯泡)
// 自包含函数:程序化几何 + canvas 纹理 + 暖 PointLight,零外部文件、零 addons、零全局光。
//
// ┌─ 这个文件是干什么的 ────────────────────────────────────────────────┐
// │ 给游戏「捏」出一间堆满杂物的储藏室:纸箱堆、金属货架、旧家电、工具、    │
// │ 行李箱、一只孤零零的裸灯泡。所有东西都用小方块/圆柱拼出来,贴上用      │
// │ <canvas> 现画的"破旧纹理"——因为比赛要求 8MB 离线,不能用任何图片/模型。  │
// │ 把它想象成"用乐高积木 + 自己画的贴纸"搭一个房间,搭好后整体搬到游戏    │
// │ 世界里 (ox,oz) 这个位置。                                              │
// └────────────────────────────────────────────────────────────────────┘
//
// 操作注意事项(改这个文件的坑):
//   1. 绝不能加 AmbientLight/HemisphereLight/DirectionalLight——这种"全局光"
//      没有位置,会把整栋楼都照亮,毁掉游戏精心调的"神秘暗灰"氛围。只用
//      有位置的 PointLight(暖橙 0xffd9a0)照亮房间局部。
//   2. 纹理工厂返回的"打包对象"(如 {map,normalMap})必须拆开来传给材质,
//      绝不能整包当 map 传,否则下一行 .repeat.set() 会崩黑屏。
//   3. 家具全是"纯装饰"——本函数只往 scene 里 add,不往任何碰撞数组里塞,
//      玩家能穿过去不被卡死。墙也由集成处决定是否进碰撞,本函数只负责画。
//
// 输入 / 输出:
//   入参 scene  = Three.js 场景(往里 add 物体)
//   入参 THREE  = Three.js 模块(用它的几何/材质/向量类)
//   入参 ox,oz  = 房间在游戏世界里的"落脚点"。房间内部所有东西先按"房间自己
//                以 (0,0) 为原点"摆好,最后统统挂到一个 Group 上,再把 Group
//                整体平移到 (ox,oz)——这样集成时只改 ox/oz 就能把房间搬到任意空地。
//   返回 {floorMat, wallMat, ceilMat} = 房间的地/墙/顶材质。集成处给 game_v3 的
//                ground()/wallB() 传这几个材质,玩家踩的地、撞的墙就用上房间质感。
//
// 房间布局约定(房间自己的本地坐标系,原点在地板正中):
//   房间尺寸 RW(宽,沿 x) × RD(深,沿 z) = 5 × 5,层高 RH = 3。
//   地板顶面 y=0(和游戏二楼地面齐平),天花板 y=RH。
//   门洞开在"靠近主路"的那面墙——这里约定开在 +z 面(z=+RD/2)正中,宽 1.4。
//   集成时把门洞那面对着走廊即可(详见文件末尾"集成建议")。

function buildStorageRoom(scene, THREE, ox, oz) {

  // ===================================================================
  // 0) 房间整体挂在一个 Group 上。
  //    把 Group 想象成一个"托盘"——所有家具先摆在托盘上(本地坐标),
  //    最后把整个托盘端到世界里 (ox,oz) 的位置。好处:函数内全程用
  //    简单的本地坐标(原点在房间中心)思考,不用每个物体都手动 +ox/+oz,
  //    既不易错,又能整体平移/复用。
  // ===================================================================
  const room = new THREE.Group();
  room.position.set(ox, 0, oz);
  scene.add(room);

  // 房间尺寸常量(本地坐标)。RW=东西宽, RD=南北深, RH=层高。
  const RW = 5, RD = 5, RH = 3;
  const HW = RW / 2, HD = RD / 2;   // 半宽/半深,墙就摆在 ±HW / ±HD 上
  const DOORW = 1.4;                // 门洞宽度(留给玩家进出,门洞处不放任何东西)

  // 小工具:把一个 mesh 加进房间托盘(统一入口,castShadow/receiveShadow 一起设)。
  // 因为本房间所有物体都是"纯装饰"(不参与碰撞),所以这里只管显示和投影,
  // 不碰任何 grounds[]/walls[] 碰撞数组——玩家能自由穿过家具。
  function add(mesh, shadow = true) {
    if (shadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
    room.add(mesh);
    return mesh;
  }
  // 快捷:造一个 box 装饰并加进房间。w/h/d=尺寸, x/y/z=本地坐标, mat=材质。
  function box(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return add(m);
  }
  // 快捷:造一个圆柱装饰(用于灯泡线/桶/卷起的地毯/工具把手等)。
  function cyl(rTop, rBot, h, x, y, z, mat, seg = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
    m.position.set(x, y, z);
    return add(m);
  }

  // ===================================================================
  // 1) 程序化纹理工厂
  //    8MB 离线红线下不能用任何图片,所有质感都用 <canvas> 现画。
  //    这些函数从 skill 的 references/textures.md 整段拷进来,放在函数内部
  //    当"局部小工具",避免和别的房间的同名函数全局冲突。
  // ===================================================================

  // 开一张正方形离屏 canvas(画纹理用的"画布")
  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  // 撒细噪点(落灰/颗粒感)。amount=密度, lo/hi=明度扰动范围。
  // 储藏室是落灰最重的房间,所以噪点用得比别处密一点。
  function sprinkleNoise(ctx, size, amount, lo, hi) {
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.random() < amount) {
        const v = lo + Math.random() * (hi - lo);
        d[i] = Math.min(255, d[i] + v);
        d[i + 1] = Math.min(255, d[i + 1] + v);
        d[i + 2] = Math.min(255, d[i + 2] + v);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // 由灰度图反推法线图:相邻像素的明暗差 = 坡度 = 表面朝向。
  // 作用:让裂纹/颗粒在光照下有真实凹凸,而不是一张平贴纸。
  // 可以类比"用海拔高度图推出每个坡面朝哪边",光打上去就有立体阴影。
  function normalFromCanvas(srcCanvas, strength) {
    const S = srcCanvas.width;
    const sctx = srcCanvas.getContext('2d');
    const src = sctx.getImageData(0, 0, S, S).data;
    const { canvas, ctx } = makeCanvas(S);
    const out = ctx.createImageData(S, S);
    const o = out.data;
    const lum = (x, y) => {
      x = (x + S) % S; y = (y + S) % S;
      const i = (y * S + x) * 4;
      return (src[i] + src[i + 1] + src[i + 2]) / 3 / 255;
    };
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
        const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength;
        const len = Math.sqrt(dx * dx + dy * dy + 1);
        const i = (y * S + x) * 4;
        o[i] = (dx / len * 0.5 + 0.5) * 255;
        o[i + 1] = (dy / len * 0.5 + 0.5) * 255;
        o[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        o[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // 递归裂纹(地震墙裂的灵魂细节):从一点出发随机游走画线,偶尔分叉。
  function drawCracks(ctx, S, count) {
    for (let k = 0; k < count; k++) {
      let x = Math.random() * S, y = Math.random() * S * 0.5;
      let angle = Math.PI / 2 + (Math.random() - 0.5);
      let w = 2.2;
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y);
      const steps = 30 + Math.floor(Math.random() * 30);
      for (let i = 0; i < steps; i++) {
        angle += (Math.random() - 0.5) * 0.6;
        x += Math.cos(angle) * (6 + Math.random() * 8);
        y += Math.sin(angle) * (6 + Math.random() * 8);
        ctx.lineTo(x, y);
        if (Math.random() < 0.15) {
          let bx = x, by = y, ba = angle + (Math.random() - 0.5) * 1.6;
          ctx.lineWidth = w * 0.5;
          for (let j = 0; j < 8; j++) {
            ba += (Math.random() - 0.5) * 0.6;
            bx += Math.cos(ba) * 5; by += Math.sin(ba) * 5;
            ctx.lineTo(bx, by);
          }
          ctx.moveTo(x, y); ctx.lineWidth = w;
        }
      }
      ctx.stroke();
    }
  }

  // 墙面纹理(灰白裂纹水渍,破败底色)——储藏室的墙
  function wallTexture() {
    const S = 512;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = '#c9c8c1'; ctx.fillRect(0, 0, S, S);   // 比标准墙再压暗一点(储藏室更脏)
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(110,108,100,${0.05 + Math.random() * 0.09})`;
      const r = 30 + Math.random() * 90;
      ctx.beginPath(); ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); ctx.fill();
    }
    // 水渍(从下往上渗,偏下半区)
    for (let i = 0; i < 16; i++) {
      const x = Math.random() * S; const y = S * 0.6 + Math.random() * S * 0.4;
      const g = ctx.createRadialGradient(x, y, 2, x, y, 40 + Math.random() * 50);
      g.addColorStop(0, 'rgba(55,52,46,0.24)'); g.addColorStop(1, 'rgba(55,52,46,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }
    ctx.strokeStyle = 'rgba(38,36,32,0.55)';
    drawCracks(ctx, S, 4);   // 储藏室墙裂多一道
    sprinkleNoise(ctx, S, 0.55, -18, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 地板纹理(脏旧水泥/木混 + 重积灰)——储藏室地面常年不打扫
  function floorTexture() {
    const S = 512;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = '#a39e94'; ctx.fillRect(0, 0, S, S);   // 比客厅地板更灰更脏
    // 隐约的旧地砖分块(浅缝)
    for (let i = 0; i < S; i += 128) {
      ctx.fillStyle = 'rgba(70,66,60,0.28)';
      ctx.fillRect(i, 0, 2, S); ctx.fillRect(0, i, S, 2);
    }
    // 大片积灰/污渍亮斑
    for (let i = 0; i < 34; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const g = ctx.createRadialGradient(x, y, 2, x, y, 30 + Math.random() * 70);
      g.addColorStop(0, 'rgba(196,193,185,0.34)'); g.addColorStop(1, 'rgba(196,193,185,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }
    sprinkleNoise(ctx, S, 0.6, -22, 18);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 木纹(纸箱、行李箱木把手、旧家具)。base=底色。
  function woodTexture(base) {
    const S = 256;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(70,58,46,0.3)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      ctx.beginPath(); let y = Math.random() * S; ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) { y += (Math.random() - 0.5) * 8; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const g = ctx.createRadialGradient(x, y, 1, x, y, 25 + Math.random() * 40);
      g.addColorStop(0, 'rgba(200,196,186,0.28)'); g.addColorStop(1, 'rgba(200,196,186,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }
    sprinkleNoise(ctx, S, 0.35, -12, 12);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 瓦楞纸箱纹理:牛皮纸底色 + 横向瓦楞线 + 胶带 + 落灰。储藏室主角是纸箱,
  // 单独给它一张专属纹理,比纯色 box 真实得多。
  function cardboardTexture() {
    const S = 256;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = '#b8956a'; ctx.fillRect(0, 0, S, S);    // 牛皮纸黄褐
    // 瓦楞横纹(浅明暗交替)
    for (let y = 0; y < S; y += 6) {
      ctx.fillStyle = (y / 6) % 2 === 0 ? 'rgba(150,118,80,0.18)' : 'rgba(210,180,140,0.14)';
      ctx.fillRect(0, y, S, 3);
    }
    // 一道封箱胶带(米色半透明竖条)
    ctx.fillStyle = 'rgba(205,196,170,0.55)';
    ctx.fillRect(S * 0.42, 0, S * 0.16, S);
    // 旧水渍/磨损暗斑
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const g = ctx.createRadialGradient(x, y, 1, x, y, 18 + Math.random() * 30);
      g.addColorStop(0, 'rgba(90,68,44,0.22)'); g.addColorStop(1, 'rgba(90,68,44,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }
    sprinkleNoise(ctx, S, 0.4, -14, 10);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ===================================================================
  // 2) 共享材质
  //    ★铁律 3:纹理工厂里凡是"打包返回"的对象都要拆包后再传★
  //    这里 wallTexture/floorTexture 返回的是"单张 Texture"(可以直接传),
  //    但 normalFromCanvas 单独生成法线图,我们手动拆开 map/normalMap 两个字段。
  // ===================================================================

  // 墙:贴图 + 法线图(让裂纹凹凸)。color 留白 0xffffff 让贴图原色出来。
  const wt = wallTexture();
  const wn = normalFromCanvas(wt.image, 2.0);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wt, normalMap: wn,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.96, color: 0xffffff
  });

  // 地板:贴图重复 3×3(否则一张图拉满 5 米地板会糊)+ 法线。
  const ft = floorTexture();
  ft.repeat.set(2, 2);
  const fn = normalFromCanvas(ft.image, 2.2);
  fn.repeat.set(2, 2);
  const floorMat = new THREE.MeshStandardMaterial({
    map: ft, normalMap: fn,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.98, color: 0xffffff
  });

  // 天花板:用墙的贴图但压暗(储藏室顶上常年阴影,几乎看不清)。
  const ceilMat = new THREE.MeshStandardMaterial({
    map: wt, roughness: 1.0, color: 0x8f8d86
  });

  // 纸箱木箱材质(纸箱用瓦楞纹,旧木箱/行李箱用木纹)
  const cardboardMat = new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.95, color: 0xffffff });
  const woodDarkMat = new THREE.MeshStandardMaterial({ map: woodTexture('#7a6c5c'), roughness: 0.9, color: 0xffffff });
  const woodLightMat = new THREE.MeshStandardMaterial({ map: woodTexture('#9a8d7c'), roughness: 0.9, color: 0xffffff });

  // 金属材质(货架立柱/层板/工具/旧家电外壳)——不锈钢偏冷灰,锈旧偏暗红褐。
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x8b9094, roughness: 0.5, metalness: 0.7 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x6e5a48, roughness: 0.85, metalness: 0.4 });
  const applianceMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.6, metalness: 0.2 }); // 旧家电米白漆面
  const darkPlasticMat = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.7, metalness: 0.15 });
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x3f4a52, roughness: 0.9, metalness: 0.05 });   // 防尘布/旧帆布
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0xb7b3aa, roughness: 0.98 });                  // 散落灰白碎物
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 0.7, metalness: 0.1 });  // 旧行李箱皮面

  // ===================================================================
  // 3) 房间外壳:地板 + 四面墙(其中一面留门洞) + 天花板
  //    墙都靠在房间边界 ±HW / ±HD 上。门洞开在 +z 面正中(对着主路那侧)。
  //    注意:外壳的"墙"在本函数里也是纯装饰(只画不碰撞),集成时由 game_v3
  //    用 wallB() 在世界坐标补一份"碰撞墙",或直接把这些位置抄进 walls[]。
  //    这样设计的好处:本函数能独立预览,集成时再决定碰撞,职责分明。
  // ===================================================================
  const WT = 0.2;   // 墙厚

  // 地板:盒子中心 y=-0.15,盒高 0.3,顶面正好 y=0(和游戏二楼地面齐平)。
  box(RW, 0.3, RD, 0, -0.15, 0, floorMat);
  // 天花板:中心 y=RH,薄盒。
  box(RW, 0.2, RD, 0, RH, 0, ceilMat);

  // 西墙(-x 面,整面)
  box(WT, RH, RD, -HW, RH / 2, 0, wallMat);
  // 东墙(+x 面,整面)
  box(WT, RH, RD, HW, RH / 2, 0, wallMat);
  // 北墙(-z 面,整面,房间最里侧,杂物靠它堆)
  box(RW, RH, WT, 0, RH / 2, -HD, wallMat);

  // 南墙(+z 面)留门洞:拆成"门左段 + 门右段 + 门楣"。
  // 门洞在 x=0 居中,宽 DOORW=1.4。两侧各剩 (RW-DOORW)/2 = 1.8 宽。
  const sideW = (RW - DOORW) / 2;             // 单侧墙段宽 = 1.8
  const leftCx = -(DOORW / 2 + sideW / 2);    // 左段中心 x = -(0.7+0.9) = -1.6
  const rightCx = (DOORW / 2 + sideW / 2);    // 右段中心 x = +1.6
  box(sideW, RH, WT, leftCx, RH / 2, HD, wallMat);   // 门左段
  box(sideW, RH, WT, rightCx, RH / 2, HD, wallMat);  // 门右段
  const lintelH = RH - 2.2;                           // 门楣高 0.8(门洞通高 2.2)
  box(DOORW, lintelH, WT, 0, RH - lintelH / 2, HD, wallMat);  // 门楣(门洞上方横条)

  // ===================================================================
  // 4) 家具:全部靠墙摆,门洞(+z 正中)和一条从门口往里的窄走道留空。
  //    布局心法(俯视,门在南/下方 +z):
  //      ┌─────────────────────────┐ 北(-z,最里)
  //      │ 货架(沿北墙,部分歪倒)    │
  //      │左:纸箱堆(靠西墙)        │ 旧家电(东北角)
  //      │     [窄走道] 旧行李箱     │
  //      │工具堆       防尘布盖物    │
  //      └────────门洞────────────┘ 南(+z,玩家进来)
  //    走道:x∈[-0.6,0.6] 这条竖带尽量空,让玩家从门进来能走两步(虽是死胡同)。
  // ===================================================================

  // ---- 4.1 金属货架(沿北墙,这是储藏室的标志物) ----
  // 货架 = 4 根立柱(cylinder)+ 几层层板(扁 box)+ 层板上塞的杂物。
  // 做两组:一组立着(西北),一组「歪倒」压向地面(东北)——地震倒塌的直接证据,
  // 也正是科普埋点(高货架地震会倒塌砸人)。
  function buildShelf(cx, cz, shelfW, shelfD, levels, lean) {
    // lean = 整组货架的倾倒角度(绕 x 轴往前栽)。0=立着, 0.5 弧度≈29°=快倒了。
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.x = lean;
    room.add(g);
    const postR = 0.04, postH = 2.0;
    const hsw = shelfW / 2, hsd = shelfD / 2;
    // 4 根立柱
    [[-hsw, -hsd], [hsw, -hsd], [-hsw, hsd], [hsw, hsd]].forEach(([px, pz]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, postH, 8), metalMat);
      p.position.set(px, postH / 2, pz); p.castShadow = true; g.add(p);
    });
    // 层板 + 层板上的杂物
    for (let lv = 0; lv < levels; lv++) {
      const ly = 0.1 + lv * (postH - 0.2) / (levels - 1);   // 各层均匀分布
      const plate = new THREE.Mesh(new THREE.BoxGeometry(shelfW + 0.05, 0.04, shelfD + 0.05), metalMat);
      plate.position.set(0, ly, 0); plate.castShadow = plate.receiveShadow = true; g.add(plate);
      // 每层塞 2~3 件杂物(小纸箱/罐子/工具盒),随机位置和歪斜
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const w = 0.25 + Math.random() * 0.35;
        const h = 0.18 + Math.random() * 0.22;
        const d = 0.25 + Math.random() * 0.3;
        const mat = Math.random() < 0.6 ? cardboardMat : (Math.random() < 0.5 ? rustMat : darkPlasticMat);
        const it = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        it.position.set((Math.random() - 0.5) * (shelfW - w), ly + 0.02 + h / 2, (Math.random() - 0.5) * (shelfD - d));
        it.rotation.y = (Math.random() - 0.5) * 0.4;
        it.castShadow = it.receiveShadow = true; g.add(it);
      }
    }
    return g;
  }
  // 立着的货架(西北角,靠北墙):中心 x=-1.4, z=-1.9
  buildShelf(-1.4, -HD + 0.45, 1.5, 0.55, 4, 0);
  // 歪倒的货架(东北→往门口栽):整组前倾 0.42 弧度(约 24°),已经在塌的状态。
  buildShelf(1.3, -HD + 0.7, 1.4, 0.55, 4, 0.42);

  // ---- 4.2 纸箱堆(靠西墙,堆叠歪斜) ----
  // 一摞箱子越堆越歪,最上面那只已经滑落到地上——堆高杂物地震倒塌的写照。
  function boxStack(baseX, baseZ) {
    let y = 0;
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const w = 0.55 - i * 0.04;
      const h = 0.4 - i * 0.03;
      const d = 0.5 - i * 0.04;
      // 越往上偏移越大、歪斜越明显(失稳前兆)
      const offX = (Math.random() - 0.5) * 0.12 * (i + 1);
      const offZ = (Math.random() - 0.5) * 0.12 * (i + 1);
      const b = box(w, h, d, baseX + offX, y + h / 2, baseZ + offZ, cardboardMat);
      b.rotation.y = (Math.random() - 0.5) * 0.18 * (i + 1);
      y += h - 0.01;
    }
    // 最上面那只"已经掉到地上"的箱子(倒在堆旁,翻了个面)
    const fallen = box(0.45, 0.34, 0.42, baseX + 0.55, 0.17, baseZ + 0.35, cardboardMat);
    fallen.rotation.set(Math.PI / 2.3, 0.5, 0.2);
  }
  boxStack(-HW + 0.5, 0.3);          // 西墙偏南
  boxStack(-HW + 0.55, -0.9);        // 西墙偏北,第二摞

  // ---- 4.3 旧家电(东北角,box 拼) ----
  // 一台报废的旧冰箱/洗衣机(高 box + 米白漆面 + 一道门缝 + 暗色把手),
  // 上面还压着一只纸箱(更显堆叠杂乱)。
  const fridge = box(0.7, 1.5, 0.65, HW - 0.5, 0.75, -HD + 0.45, applianceMat);
  fridge.rotation.y = -0.12;
  // 门缝(凹深色细条)
  box(0.04, 1.35, 0.04, HW - 0.5 - 0.33, 0.75, -HD + 0.45 + 0.32, darkPlasticMat);
  // 把手(竖向暗条)
  box(0.05, 0.5, 0.05, HW - 0.5 - 0.28, 1.0, -HD + 0.45 + 0.35, darkPlasticMat);
  // 冰箱顶上压的纸箱
  const onFridge = box(0.5, 0.4, 0.45, HW - 0.5, 1.5 + 0.2, -HD + 0.45, cardboardMat);
  onFridge.rotation.y = 0.3;

  // 一台矮旧家电(像旧 CRT 电视/微波炉,放在歪货架旁地上)
  const oldTV = box(0.55, 0.42, 0.5, 1.6, 0.21, -0.2, darkPlasticMat);
  oldTV.rotation.y = 0.4;
  box(0.38, 0.28, 0.02, 1.6 + 0.05, 0.24, -0.2 + 0.26, applianceMat); // 屏面/面板

  // ---- 4.4 旧行李箱(靠东墙,皮面 + 金属扣 + 把手) ----
  const suitcase = box(0.62, 0.24, 0.44, HW - 0.4, 0.12, 0.9, leatherMat);
  suitcase.rotation.y = -0.25;
  // 两个金属扣
  box(0.08, 0.06, 0.03, HW - 0.4 - 0.15, 0.24, 0.9 + 0.23, metalMat);
  box(0.08, 0.06, 0.03, HW - 0.4 + 0.15, 0.24, 0.9 + 0.23, metalMat);
  // 上面叠的第二个小箱
  const suitcase2 = box(0.5, 0.2, 0.36, HW - 0.45, 0.24 + 0.1, 0.95, woodLightMat);
  suitcase2.rotation.y = 0.15;

  // ---- 4.5 工具(靠西墙南段,工具箱 + 散落工具) ----
  // 红色工具箱(box)+ 几把"工具"(细长 box/cylinder 当锤柄、扳手)散在旁边。
  const toolboxMat = new THREE.MeshStandardMaterial({ color: 0x7a2f28, roughness: 0.7, metalness: 0.25 }); // 暗红工具箱
  const toolbox = box(0.5, 0.26, 0.3, -HW + 0.45, 0.13, 1.5, toolboxMat);
  toolbox.rotation.y = 0.2;
  box(0.5, 0.06, 0.3, -HW + 0.45, 0.29, 1.5, darkPlasticMat); // 工具箱上盖把手区
  // 散落工具:锤(柄 cylinder + 头 box)
  const hammerHandle = cyl(0.02, 0.02, 0.28, -HW + 0.9, 0.03, 1.7, woodLightMat, 8);
  hammerHandle.rotation.set(Math.PI / 2, 0, 0.6);
  box(0.06, 0.05, 0.12, -HW + 0.78, 0.04, 1.62, metalMat);  // 锤头
  // 扳手(细长金属 box,歪在地上)
  const wrench = box(0.04, 0.02, 0.26, -HW + 1.0, 0.02, 1.2, metalMat);
  wrench.rotation.y = 1.1;

  // ---- 4.6 防尘布盖着的一堆杂物(东南角,帆布 box + 露出的角) ----
  // 一块大帆布(扁 box)盖在一堆东西上,布面有起伏(再叠两小块表现褶皱)。
  const tarp = box(1.0, 0.7, 0.9, HW - 0.65, 0.35, 1.7, tarpMat);
  tarp.rotation.y = 0.1;
  box(0.8, 0.18, 0.7, HW - 0.6, 0.78, 1.65, tarpMat).rotation.y = -0.15; // 顶上鼓起的褶皱
  // 布角掀开,露出里面一只木箱角
  box(0.3, 0.3, 0.28, HW - 1.0, 0.15, 2.0, woodDarkMat).rotation.y = 0.5;

  // ---- 4.7 卷起靠墙的旧地毯(西墙北段,竖立的圆柱) ----
  const carpet = cyl(0.16, 0.16, 1.6, -HW + 0.35, 0.8, -1.7, tarpMat, 12);
  carpet.rotation.set(0.06, 0, 0.05);   // 微微歪靠墙

  // ---- 4.8 地面散落小碎物(地震后狼藉的地面层) ----
  // 循环撒一批灰白小 box,随机位置 + 随机旋转,集中在已倒货架/纸箱堆周围,
  // 但避开门口走道(z 靠 +HD、x 靠中线的区域)以免挡路。
  for (let i = 0; i < 26; i++) {
    const s = 0.04 + Math.random() * 0.13;
    // 随机落点:整个房间内,但偏向里侧(-z),给门口留通道
    let px = (Math.random() - 0.5) * (RW - 0.6);
    let pz = -HD + 0.5 + Math.random() * (RD - 1.6);   // z∈[-2,+1.5]附近,不堆到门口最外
    // 若太靠近正门口走道中线,推到一边
    if (Math.abs(px) < 0.5 && pz > 0.6) px += (px >= 0 ? 0.8 : -0.8);
    const mat = Math.random() < 0.5 ? debrisMat : (Math.random() < 0.5 ? cardboardMat : rustMat);
    const c = box(s, s * (0.5 + Math.random()), s, px, s / 2, pz, mat);
    c.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }

  // ---- 4.9 天花板掉落的混凝土碎块(地震痕迹,落在货架/纸箱上) ----
  for (let i = 0; i < 5; i++) {
    const s = 0.12 + Math.random() * 0.18;
    const px = -HW + 0.4 + Math.random() * (RW - 0.8);
    const pz = -HD + 0.4 + Math.random() * (RD - 1.4);
    const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), debrisMat);
    chunk.position.set(px, s, pz);
    chunk.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    add(chunk);
  }
  // 天花板上对应的破洞暗斑(深色薄 box 贴在天花板下方)
  box(0.9, 0.02, 0.8, 0.3, RH - 0.11, -1.2, darkPlasticMat);

  // ===================================================================
  // 5) 照明:一只孤零零的裸灯泡(储藏室的灵魂——单灯泡=最压抑)
  //    灯泡 = 一段下垂的电线(细 cylinder) + 灯头(小 cylinder) + 发光小球。
  //    真正"照亮房间"靠灯泡位置上的一盏暖橙 PointLight。
  //    ★铁律 2:只用有位置的 PointLight,绝不加全局光。★
  //    储藏室刻意调暗:灯泡偏房间里侧、强度比客厅吸顶灯低,角落几乎黑——
  //    这种"看不清角落里堆了什么"的不安,正是最压抑房间要的效果。
  // ===================================================================
  const bulbX = -0.3, bulbZ = -0.6, bulbY = RH - 0.55;   // 灯泡略偏里侧、上方
  // 下垂电线(从天花板垂到灯头)
  cyl(0.008, 0.008, 0.45, bulbX, RH - 0.225, bulbZ, darkPlasticMat, 6);
  // 灯头(黑色小圆柱)
  cyl(0.04, 0.05, 0.08, bulbX, bulbY + 0.06, bulbZ, darkPlasticMat, 8);
  // 发光灯泡:用一个自发光小球,让玩家"看见光源本身"(MeshStandardMaterial 的
  // emissive 让它自己发暖光,不依赖被别的光照亮)。
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe6b0, emissive: 0xffcaa0, emissiveIntensity: 1.4, roughness: 0.3
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), bulbMat);
  bulb.position.set(bulbX, bulbY, bulbZ);
  room.add(bulb);   // 灯泡本身不投影(它是光源)

  // 主光源:暖橙 PointLight,挂在灯泡处。参数(颜色, 强度, 衰减距离, 衰减指数)。
  // 强度 2.6 比客厅吸顶灯(3.2)低一截,距离 7 也偏短——刻意让房间昏暗、角落暗下去。
  const lamp = new THREE.PointLight(0xffd9a0, 2.6, 7, 2);
  lamp.position.set(ox + bulbX, bulbY, oz + bulbZ);   // ★PointLight 直接加到 scene,要用世界坐标(+ox/+oz)★
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  scene.add(lamp);

  // 第二盏极弱的补光(放门口附近上方),让玩家从门进来时不至于一脚踏进纯黑、
  // 看不见地面绊倒——但强度很低(1.1)、距离短(4.5),只把门口走道勾出轮廓。
  const fill = new THREE.PointLight(0xffd9a0, 1.1, 4.5, 2);
  fill.position.set(ox + 0, RH - 0.5, oz + (HD - 0.8));
  scene.add(fill);

  // ===================================================================
  // 6) 科普埋点:墙上一块警示牌(直接把救命知识写进场景实物)
  //    内容:"杂物勿堆高 · 通道莫占用 —— 地震时倒塌砸人、堵死逃生路"。
  //    用 canvas 画一块带文字的金属警示牌(黄底黑字,工地警示风格),
  //    贴在门口右侧墙上、灯泡能照到的地方,让玩家进门一抬头就看见。
  //    这样"探索本身在教救命常识",而不是只堆家具。
  // ===================================================================
  function signTexture() {
    const S = 256;
    const { canvas, ctx } = makeCanvas(S);
    // 黄黑警示底(上半黄、带黑斜纹边)
    ctx.fillStyle = '#d9b23a'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#1c1c1c';
    for (let x = -S; x < S; x += 28) {   // 顶部斜纹警示条
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 14, 0); ctx.lineTo(x + 14 + 30, 30); ctx.lineTo(x + 30, 30); ctx.closePath(); ctx.fill();
    }
    // 文字(中文警示)
    ctx.fillStyle = '#1c1c1c';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('警 告', S / 2, 78);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('杂物勿堆高', S / 2, 120);
    ctx.fillText('通道勿占用', S / 2, 150);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#3a2a10';
    ctx.fillText('地震倒塌砸人', S / 2, 188);
    ctx.fillText('并堵死逃生路', S / 2, 210);
    // 做旧:落灰 + 一道污渍
    sprinkleNoise(ctx, S, 0.25, -20, 8);
    const g = ctx.createRadialGradient(S * 0.7, S * 0.8, 4, S * 0.7, S * 0.8, 70);
    g.addColorStop(0, 'rgba(40,35,20,0.3)'); g.addColorStop(1, 'rgba(40,35,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.7, metalness: 0.2 });
  // 警示牌贴在门口右段墙内侧(z 略小于 HD,朝向房间内 -z),高度齐视线 1.5。
  // 略微歪一点(地震晃过)。
  const sign = box(0.6, 0.6, 0.03, rightCx, 1.55, HD - WT / 2 - 0.02, signMat);
  sign.rotation.set(0, Math.PI, 0.06);   // 朝向 -z(房间内),轻微倾斜
  // 牌子四角的固定螺丝(小金属点),增加真实感
  [[-0.25, 0.25], [0.25, 0.25], [-0.25, -0.25], [0.25, -0.25]].forEach(([dx, dy]) => {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), metalMat);
    screw.position.set(rightCx + dx, 1.55 + dy, HD - WT / 2 - 0.04);
    screw.rotation.x = Math.PI / 2;
    room.add(screw);
  });

  // 返回房间的地/墙/顶材质,供集成处给 game_v3 的 ground()/wallB() 复用质感。
  return { floorMat, wallMat, ceilMat };
}
