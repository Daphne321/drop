// 餐厅支线房间 —— 余震·DROP 地震逃生科普游戏
// =====================================================================
// 这个文件只干一件事：导出/定义一个自包含函数 buildDiningRoom，
// 把"一间被地震震过的破败餐厅"凭空用代码画出来塞进游戏世界里。
//
// 【怎么理解这个函数】
//   想象你是个布景师，导演给你一块空地(原点 0,0)和一个世界坐标(ox,oz)，
//   你要在原点上把餐桌、椅子、碗柜、吊灯一件件搭好，最后整体抬起来挪到
//   导演指定的世界位置去。这就是 ox/oz 平移的意义——先就地装修，再整体搬家。
//
// 【五条铁律自检——这个文件全部遵守】
//   1. 零外部文件/零 addons：只用 THREE 基础几何 + canvas 现画纹理，没有任何图片/模型/CDN。
//   2. 绝不加全局光(Ambient/Hemisphere/Directional)：只用有坐标的 PointLight，
//      不然整栋楼会被照亮，毁掉"神秘暗灰"氛围。
//   3. 材质 map 必拆包：纹理工厂返回的对象不能整包当 map 传(会崩黑屏)，
//      本文件所有纹理都是直接返回单张 Texture，赋值时就是一张图，安全。
//   4. 家具全用装饰(不进碰撞数组)、靠墙摆、留门洞和走道：本函数只往 scene.add，
//      绝不碰 grounds[]/walls[]，玩家能自由穿过家具不被卡死。
//   5. 看不到渲染：专注几何正确+比例真实+能亮，视觉由主 agent CDP 把关。
//
// 【科普灵魂——本房间要焊进玩家脑子的救命知识】
//   破除"地震躲餐桌底下=黄金三角"这个害死人的伪知识。
//   现代正解(USGS/FEMA 趴下-掩护-抓牢 Drop-Cover-Hold On)：
//   不是钻进桌肚里，而是躲到结实桌子【旁边】贴地伏低、用桌子挡住坠落物、
//   并用手抓住一条桌腿(桌子被震得移动时人能跟着移动，始终保持遮挡)。
//   头顶的吊灯才是真威胁——本房间故意让吊灯歪斜将坠，配一块对比警示牌，
//   玩家走进来抬头看见摇摇欲坠的吊灯，立刻就懂"头顶有东西=危险"。
// =====================================================================

function buildDiningRoom(scene, THREE, ox, oz){

  // ===================================================================
  // 第 0 步：程序化纹理工厂
  // -------------------------------------------------------------------
  // 8MB 离线红线下不能用任何图片，所有质感都靠在内存里现画一张 canvas，
  // 再把它当贴图喂给材质。下面这几个小工厂从 skill 的 textures.md 整段拷来，
  // 放在函数内部当"私人工具"，避免和别的房间函数撞名字。
  // 类比：canvas 就像一张草稿纸，我们用 2D 画笔在上面涂出木纹/裂纹，
  //       再把这张纸糊到 3D 方块表面，方块立刻就有了"木头质感"。
  // ===================================================================

  // 开一张正方形离屏画布(只在内存里，不显示)
  function makeCanvas(size){
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  // 撒细噪点：模拟落灰/颗粒感。amount=密度，lo/hi=明暗扰动范围。
  // 原理：随机挑像素，把它的 RGB 三个通道整体加减一个随机值，让表面不死板。
  function sprinkleNoise(ctx, size, amount, lo, hi){
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for(let i = 0; i < d.length; i += 4){
      if(Math.random() < amount){
        const v = lo + Math.random() * (hi - lo);
        d[i]   = Math.min(255, d[i]   + v);
        d[i+1] = Math.min(255, d[i+1] + v);
        d[i+2] = Math.min(255, d[i+2] + v);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // 由灰度图反推法线图：相邻像素的明暗差就是表面坡度，坡度决定光照朝向。
  // 作用：让裂纹/木纹在灯光下有真实凹凸，而不是一张平贴纸。
  // strength 越大凹凸越强(墙 2.0、地 2.5 是验证过的好值)。
  function normalFromCanvas(srcCanvas, strength){
    const S = srcCanvas.width;
    const sctx = srcCanvas.getContext('2d');
    const src = sctx.getImageData(0, 0, S, S).data;
    const { canvas, ctx } = makeCanvas(S);
    const out = ctx.createImageData(S, S);
    const o = out.data;
    const lum = (x, y) => { x = (x+S)%S; y = (y+S)%S; const i = (y*S+x)*4; return (src[i]+src[i+1]+src[i+2])/3/255; };
    for(let y = 0; y < S; y++){
      for(let x = 0; x < S; x++){
        const dx = (lum(x-1,y) - lum(x+1,y)) * strength;
        const dy = (lum(x,y-1) - lum(x,y+1)) * strength;
        const len = Math.sqrt(dx*dx + dy*dy + 1);
        const i = (y*S+x)*4;
        o[i]   = (dx/len*0.5+0.5)*255;
        o[i+1] = (dy/len*0.5+0.5)*255;
        o[i+2] = (1/len*0.5+0.5)*255;
        o[i+3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // 递归裂纹：地震墙裂的灵魂细节。主干随机游走，沿途偶尔分叉出小裂缝。
  function drawCracks(ctx, S, count){
    for(let k = 0; k < count; k++){
      let x = Math.random()*S, y = Math.random()*S*0.5;
      let angle = Math.PI/2 + (Math.random()-0.5);
      let w = 2.2;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 30 + Math.floor(Math.random()*30);
      for(let i = 0; i < steps; i++){
        angle += (Math.random()-0.5)*0.6;
        x += Math.cos(angle)*(6+Math.random()*8);
        y += Math.sin(angle)*(6+Math.random()*8);
        ctx.lineTo(x, y);
        if(Math.random() < 0.15){
          let bx = x, by = y, ba = angle + (Math.random()-0.5)*1.6;
          ctx.lineWidth = w*0.5;
          for(let j = 0; j < 8; j++){ ba += (Math.random()-0.5)*0.6; bx += Math.cos(ba)*5; by += Math.sin(ba)*5; ctx.lineTo(bx, by); }
          ctx.moveTo(x, y);
          ctx.lineWidth = w;
        }
      }
      ctx.stroke();
    }
  }

  // 墙面纹理：灰白底 + 水渍 + 裂纹 + 落灰，破败底色。
  function wallTexture(){
    const S = 512;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = '#d3d2cc'; ctx.fillRect(0, 0, S, S);
    for(let i = 0; i < 40; i++){ ctx.fillStyle = `rgba(120,118,110,${0.04+Math.random()*0.08})`; const r = 30+Math.random()*90; ctx.beginPath(); ctx.arc(Math.random()*S, Math.random()*S, r, 0, Math.PI*2); ctx.fill(); }
    for(let i = 0; i < 14; i++){ const x = Math.random()*S; const y = S*0.6+Math.random()*S*0.4; const g = ctx.createRadialGradient(x,y,2,x,y,40+Math.random()*50); g.addColorStop(0,'rgba(60,58,52,0.22)'); g.addColorStop(1,'rgba(60,58,52,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,S,S); }
    ctx.strokeStyle = 'rgba(40,38,34,0.55)'; drawCracks(ctx, S, 3);
    sprinkleNoise(ctx, S, 0.5, -16, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 地板纹理：脏旧木条纹 + 积灰。
  function floorTexture(){
    const S = 512;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = '#b4afa5'; ctx.fillRect(0, 0, S, S);
    for(let i = 0; i < S; i += 64){ ctx.fillStyle = i%128===0 ? 'rgba(110,104,94,0.18)' : 'rgba(150,145,135,0.12)'; ctx.fillRect(0,i,S,60); ctx.fillStyle='rgba(60,56,50,0.5)'; ctx.fillRect(0,i+60,S,3); }
    for(let i = 0; i < 30; i++){ const x = Math.random()*S, y = Math.random()*S; const g = ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*60); g.addColorStop(0,'rgba(205,203,196,0.35)'); g.addColorStop(1,'rgba(205,203,196,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,S,S); }
    sprinkleNoise(ctx, S, 0.55, -20, 20);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 木纹纹理：餐桌/椅/碗柜用，base 决定深浅。
  function woodTexture(base){
    const S = 256;
    const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(70,58,46,0.3)'; ctx.lineWidth = 1.5;
    for(let i = 0; i < 24; i++){ ctx.beginPath(); let y = Math.random()*S; ctx.moveTo(0, y); for(let x = 0; x <= S; x += 16){ y += (Math.random()-0.5)*8; ctx.lineTo(x, y); } ctx.stroke(); }
    for(let i = 0; i < 10; i++){ const x = Math.random()*S, y = Math.random()*S; const g = ctx.createRadialGradient(x,y,1,x,y,25+Math.random()*40); g.addColorStop(0,'rgba(200,196,186,0.28)'); g.addColorStop(1,'rgba(200,196,186,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,S,S); }
    sprinkleNoise(ctx, S, 0.35, -12, 12);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ===================================================================
  // 第 1 步：共享材质
  // -------------------------------------------------------------------
  // 纹理画好后，把它包进 MeshStandardMaterial(支持光照/粗糙度的标准材质)。
  // ★拆包提醒★：本文件的纹理工厂都直接返回"一张 Texture"，所以 map: 那张图
  // 是安全的；唯一要小心的是法线图必须单独生成、单独传(下面墙/地各做了一份)。
  // 复用材质能省显存——10 把椅子共用一份木头材质，而不是各做一份。
  // ===================================================================

  const wTex = wallTexture();
  const wNorm = normalFromCanvas(wTex.image, 2.0);
  const wallMat = new THREE.MeshStandardMaterial({ map: wTex, normalMap: wNorm, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, color: 0xffffff });

  const fTex = floorTexture();
  fTex.repeat.set(3, 3);                       // 地板大，纹理铺 3x3 防糊
  const fNorm = normalFromCanvas(fTex.image, 2.5);
  fNorm.repeat.set(3, 3);
  const floorMat = new THREE.MeshStandardMaterial({ map: fTex, normalMap: fNorm, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.9, color: 0xffffff });

  // 天花板：纯灰白哑光，比墙暗一点压住氛围
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xb8b6ae, roughness: 1.0 });

  // 暖木餐桌/椅(深一点，显得用旧了)
  const woodDark = new THREE.MeshStandardMaterial({ map: woodTexture('#857769'), roughness: 0.7, metalness: 0.05, color: 0xffffff });
  // 浅木碗柜(和餐桌拉开层次)
  const woodLight = new THREE.MeshStandardMaterial({ map: woodTexture('#a39788'), roughness: 0.72, metalness: 0.05, color: 0xffffff });
  // 不锈钢/金属(吊灯链、餐具、把手)
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.7 });
  // 暖黄铜灯罩(吊灯壳)
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb8915a, roughness: 0.4, metalness: 0.6 });
  // 瓷白(碗碟)
  const porcelainMat = new THREE.MeshStandardMaterial({ color: 0xeae6dc, roughness: 0.5, metalness: 0.05 });
  // 散落碎瓷/碎块(灰白)
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0xc8c4ba, roughness: 0.95 });
  // 灯泡自发光(吊灯里那颗，给点暖光"看起来在亮")
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffd9a0, emissiveIntensity: 1.4, roughness: 0.3 });

  // ===================================================================
  // 第 2 步：建房间外壳(地板/墙/天花板/门洞)
  // -------------------------------------------------------------------
  // 房间尺寸定为 宽(沿 x)8 × 深(沿 z)7 × 层高 H=3，与 game_v3 二楼一致。
  // 注意：本函数只负责"装修"——把外壳和家具 add 到 scene 当装饰，
  //       真正让玩家能踩/能撞的 grounds[]/walls[] 由集成处用游戏自带的
  //       ground()/wallB() 沿着同样的坐标补一遍(见文件末尾集成说明)。
  //       这样职责清晰：房间函数管"长什么样"，集成处管"能不能踩能不能撞"。
  //
  // 坐标约定：房间以自己的原点(0,0)为几何中心来摆，最后统一 +ox/+oz。
  //   x ∈ [-RW/2, RW/2]、z ∈ [-RD/2, RD/2]，地板顶面 y=0(和二楼齐平)。
  //   门洞默认开在 -z 这面墙(假设玩家从这一侧的走廊走进来)，宽 1.4。
  // ===================================================================

  const RW = 8, RD = 7, H = 3;                 // 房间宽/深/层高
  const t = 0.3;                               // 墙厚
  const grp = [];                              // 收集本房间所有 mesh，便于统一平移

  // 小工具：造一个盒子并平移到世界坐标(自动 +ox/+oz)，加进 scene。
  // 这是本房间的"装饰版 deco"——castShadow 让家具有阴影，更有体积感。
  function box(w, h, d, x, y, z, mat, rot){
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x + ox, y, z + oz);
    if(rot) m.rotation.set(rot[0]||0, rot[1]||0, rot[2]||0);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    grp.push(m);
    return m;
  }

  // 小工具：造一个圆柱(灯链/桌腿圆段/碗碟)。
  function cyl(rTop, rBot, h, x, y, z, mat, rot){
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 14), mat);
    m.position.set(x + ox, y, z + oz);
    if(rot) m.rotation.set(rot[0]||0, rot[1]||0, rot[2]||0);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    grp.push(m);
    return m;
  }

  // ---- 地板(顶面 y=0，盒中心 y=-0.15) ----
  box(RW, 0.3, RD, 0, -0.15, 0, floorMat);

  // ---- 天花板(底面 y=H) ----
  box(RW, 0.2, RD, 0, H + 0.1, 0, ceilMat);

  // ---- 四面墙(门洞开在 -z 这面) ----
  // 东墙(+x)、西墙(-x)、北墙(+z 整面)
  box(t, H, RD, RW/2, H/2, 0, wallMat);        // 东墙
  box(t, H, RD, -RW/2, H/2, 0, wallMat);       // 西墙
  box(RW, H, t, 0, H/2, RD/2, wallMat);        // 北墙(+z 整面，无门)
  // 南墙(-z)留门洞：拆成左段 + 右段 + 门楣。门洞中心 x=0、宽 1.4。
  const doorW = 1.4;
  const segW = (RW - doorW) / 2;               // 每侧墙段宽
  box(segW, H, t, -(doorW/2 + segW/2), H/2, -RD/2, wallMat);  // 门左段
  box(segW, H, t,  (doorW/2 + segW/2), H/2, -RD/2, wallMat);  // 门右段
  box(doorW, H - 2.1, t, 0, H - (H-2.1)/2, -RD/2, wallMat);   // 门楣(门洞上方)

  // ===================================================================
  // 第 3 步：核心家具——结实的木餐桌(科普主角)
  // -------------------------------------------------------------------
  // 这张桌子是科普的"正确答案道具"：它结实、矮、四条粗腿。
  // 玩家学到的不是"钻进桌肚"，而是"躲到它【旁边】贴地、抓住一条桌腿"。
  // 所以我们把桌子做得敦实可信，并在它旁边留出一块"安全伏地区"(地上一块
  // 浅色垫示意 + 旁边的警示牌解释正确动作)。
  //
  // 餐桌摆在房间中央偏北，桌面高 0.75(站着到大腿)，桌面 1.7×1.0。
  // ===================================================================

  const tx = 0.3, tz = 0.6;                    // 桌子中心(略偏房间中央偏北)
  const topY = 0.75;                           // 桌面顶高
  // 桌面(厚板)
  box(1.7, 0.08, 1.0, tx, topY, tz, woodDark);
  // 桌面下横撑(让桌子显得有结构、结实)
  box(1.5, 0.06, 0.06, tx, topY - 0.12, tz - 0.42, woodDark);
  box(1.5, 0.06, 0.06, tx, topY - 0.12, tz + 0.42, woodDark);
  // 四条粗桌腿(0.09 见方，敦实)。腿中心 y = (topY-0.04)/2 ≈ 0.355，腿高到桌面下
  const legH = topY - 0.08;
  const lx = 0.74, lz = 0.4;                    // 腿相对桌心的偏移
  box(0.09, legH, 0.09, tx - lx, legH/2, tz - lz, woodDark);
  box(0.09, legH, 0.09, tx + lx, legH/2, tz - lz, woodDark);
  box(0.09, legH, 0.09, tx - lx, legH/2, tz + lz, woodDark);
  box(0.09, legH, 0.09, tx + lx, legH/2, tz + lz, woodDark);

  // 桌上散落的餐具(地震甩出来的)：几只歪掉的碗碟 + 一只滚到桌边将掉的碗
  cyl(0.13, 0.10, 0.06, tx - 0.4, topY + 0.05, tz - 0.2, porcelainMat);        // 一只碗
  box(0.22, 0.015, 0.22, tx + 0.2, topY + 0.04, tz + 0.15, porcelainMat, [0, 0.5, 0]);  // 一只盘(略转)
  cyl(0.11, 0.085, 0.05, tx + 0.62, topY + 0.04, tz - 0.3, porcelainMat, [0.25, 0, 0.18]); // 滚到桌边、歪着将掉的碗

  // ===================================================================
  // 第 4 步：4 把餐椅(一把翻倒)——地震破败感
  // -------------------------------------------------------------------
  // 用一个小函数批量造椅子：座面 + 4 腿 + 靠背。
  // 正常椅子 upright=true 站立摆桌边；翻倒的椅子整体绕 z 轴转 90° 躺地上。
  // ===================================================================

  function chair(cx, cz, faceRot, knocked){
    const seatY = 0.45;                        // 座面高
    const sw = 0.4, sd = 0.4;                  // 座面尺寸
    // 用一个临时数组装这把椅子的部件，最后整体处理"翻倒"姿态
    const parts = [];
    const add = (w,h,d,px,py,pz,mat) => parts.push({ w,h,d,px,py,pz,mat });
    // 座面
    add(sw, 0.05, sd, 0, seatY, 0, woodDark);
    // 4 腿
    const lh = seatY - 0.025, lo = 0.16;
    add(0.05, lh, 0.05, -lo, lh/2, -lo, woodDark);
    add(0.05, lh, 0.05,  lo, lh/2, -lo, woodDark);
    add(0.05, lh, 0.05, -lo, lh/2,  lo, woodDark);
    add(0.05, lh, 0.05,  lo, lh/2,  lo, woodDark);
    // 靠背(座面后方竖起)
    add(sw, 0.42, 0.05, 0, seatY + 0.23, -sd/2 + 0.02, woodDark);

    if(knocked){
      // 翻倒：整把椅子绕世界 x 方向"放倒"——简单处理为每个部件绕椅子中心转。
      // 这里用近似：把椅子整体抬到躺姿——座面贴地、靠背朝外平放。
      // 为了实现简单且不引入 Group 旋转复杂度，直接给一组"躺地坐标"。
      // 座面贴地略抬
      box(sw, 0.05, sd, cx, 0.06, cz, woodDark, [Math.PI/2, faceRot, 0]);
      // 靠背平摊在地
      box(sw, 0.42, 0.05, cx + Math.sin(faceRot)*0.28, 0.04, cz + Math.cos(faceRot)*0.28, woodDark, [Math.PI/2, faceRot, 0]);
      // 朝天的两条腿
      box(0.05, lh, 0.05, cx - 0.16, 0.22, cz - 0.16, woodDark, [Math.PI/2, faceRot, 0]);
      box(0.05, lh, 0.05, cx + 0.16, 0.22, cz + 0.16, woodDark, [Math.PI/2, faceRot, 0]);
    } else {
      // 正常站立：把每个部件按 faceRot 旋转后放到 (cx,cz)
      parts.forEach(p => {
        const rx = p.px * Math.cos(faceRot) - p.pz * Math.sin(faceRot);
        const rz = p.px * Math.sin(faceRot) + p.pz * Math.cos(faceRot);
        box(p.w, p.h, p.d, cx + rx, p.py, cz + rz, p.mat, [0, faceRot, 0]);
      });
    }
  }

  // 桌子四边各一把，朝向桌心。其中靠门那把翻倒(被逃跑的人撞翻)。
  chair(tx,        tz - 0.95, 0,          false);  // 北侧椅(背朝北、面朝桌)
  chair(tx,        tz + 0.95, Math.PI,    false);  // 南侧椅
  chair(tx - 1.25, tz,        Math.PI/2,  false);  // 西侧椅
  chair(tx + 1.25, tz + 0.2,  -Math.PI/2, true);   // 东侧椅——翻倒在地

  // ===================================================================
  // 第 5 步：碗柜(靠北墙)——里头碗碟散落
  // -------------------------------------------------------------------
  // 碗柜 = 柜体大 box + 中间隔板 + 柜门(一扇被震得歪开) + 柜里几只碗碟小 box。
  // 靠北墙(+z)摆，玻璃门那种就用半透；这里做实木门 + 露出内格的碗。
  // ===================================================================

  const cbx = -2.4, cbz = RD/2 - 0.32;         // 碗柜中心(靠北墙、偏西)
  const cbW = 1.4, cbH = 1.9, cbD = 0.45;
  // 柜体(背板贴墙)
  box(cbW, cbH, cbD, cbx, cbH/2, cbz, woodLight);
  // 柜顶压一道线脚(显精致)
  box(cbW + 0.1, 0.08, cbD + 0.06, cbx, cbH + 0.04, cbz, woodLight);
  // 中间一道横隔板把柜子分上下两格(露在前面)
  box(cbW - 0.1, 0.04, cbD - 0.06, cbx, cbH*0.55, cbz - 0.02, woodLight);
  // 上格里两只碗碟(小 box/cyl)
  cyl(0.1, 0.08, 0.05, cbx - 0.35, cbH*0.55 + 0.08, cbz - 0.05, porcelainMat);
  box(0.18, 0.02, 0.18, cbx + 0.1, cbH*0.55 + 0.05, cbz - 0.05, porcelainMat);
  cyl(0.09, 0.07, 0.04, cbx + 0.4, cbH*0.55 + 0.07, cbz - 0.05, porcelainMat);
  // 下格里一摞盘子(叠几片薄 box)
  for(let i = 0; i < 4; i++){
    box(0.2, 0.018, 0.2, cbx - 0.3, 0.45 + i*0.025, cbz - 0.05, porcelainMat, [0, 0, (Math.random()-0.5)*0.08]);
  }
  // 柜门：一扇关着、一扇被震得歪开(绕 y 轴外开)
  box(cbW/2 - 0.04, cbH*0.45, 0.04, cbx - cbW/4, cbH*0.27, cbz + cbD/2 + 0.01, woodLight);  // 左下门(关)
  // 右上门歪开——以门铰链(右边缘)为支点向外转开约 40°
  const door = box(cbW/2 - 0.04, cbH*0.4, 0.04, cbx + cbW/4 + 0.12, cbH*0.72, cbz + cbD/2 + 0.18, woodLight, [0, -0.7, 0]);
  // 门把手(金属小 box)
  box(0.03, 0.12, 0.03, cbx - cbW/2 + 0.12, cbH*0.27, cbz + cbD/2 + 0.03, metalMat);

  // ===================================================================
  // 第 6 步：★头顶吊灯——本房间真正的威胁 + 科普焦点★
  // -------------------------------------------------------------------
  // 吊灯挂在餐桌正上方，地震把它震得歪斜、链子半断、摇摇欲坠。
  // 结构：天花板挂点 → 一段歪斜的链子(cylinder) → 灯盘 → box 灯罩 + 灯泡。
  // 给整盏灯一个明显的 rotation 倾斜，玩家抬头一看就知道"这玩意要掉下来"。
  // 这正是要焊进脑子的知识：地震时头顶的吊灯/吊柜/吊扇才是真威胁。
  // 灯里放一颗自发光灯泡 + 一盏暖 PointLight，既照亮房间又把视线吸到威胁上。
  // ===================================================================

  const lampX = tx, lampZ = tz;                // 吊灯在餐桌正上方
  const tilt = 0.32;                           // 整盏灯歪斜角度(rad)，约 18°
  // 链子：从天花板(y≈H)斜挂下来到灯盘(y≈2.0)。用细 cylinder 表示，给倾斜。
  cyl(0.015, 0.015, 0.95, lampX + 0.12, 2.55, lampZ, metalMat, [tilt, 0, tilt*0.6]);
  // 灯盘(吊灯顶上那个吸顶盘，也歪了)
  cyl(0.13, 0.13, 0.05, lampX + 0.22, 2.08, lampZ + 0.05, brassMat, [tilt, 0, tilt*0.6]);
  // box 灯罩(梯形感用扁 box 近似，倾斜)
  box(0.5, 0.28, 0.5, lampX + 0.28, 1.92, lampZ + 0.07, brassMat, [tilt, 0, tilt*0.6]);
  // 灯罩下沿一圈(略大)显得有罩口
  box(0.56, 0.04, 0.56, lampX + 0.3, 1.78, lampZ + 0.08, brassMat, [tilt, 0, tilt*0.6]);
  // 灯泡(自发光，藏在罩下)
  cyl(0.07, 0.07, 0.12, lampX + 0.31, 1.82, lampZ + 0.08, bulbMat, [tilt, 0, tilt*0.6]);
  // 半断垂下的另一截链子(强化"将坠"的危险感)
  cyl(0.012, 0.012, 0.4, lampX - 0.15, 2.4, lampZ - 0.1, metalMat, [0.6, 0, -0.3]);

  // ===================================================================
  // 第 7 步：科普警示牌(把对比知识直接写进场景)
  // -------------------------------------------------------------------
  // 一块立在桌旁的牌子，用 canvas 画上对比文字：
  //   ✗ 钻桌肚里(伪"黄金三角")   ✓ 躲桌【旁】伏地抓桌腿、护头颈
  //   并提醒：当心头顶吊灯！
  // 这是"破除伪知识"的点睛——玩家走进来抬头看见歪吊灯、低头看见警示牌，
  // 知识就在这一抬一低之间焊进脑子。
  // ===================================================================

  function signTexture(){
    const S = 512;
    const { canvas, ctx } = makeCanvas(S);
    // 牌底(暖黄警示色 + 旧化)
    ctx.fillStyle = '#e8d9a8'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(120,100,60,0.12)'; for(let i=0;i<20;i++){ctx.beginPath();ctx.arc(Math.random()*S,Math.random()*S,20+Math.random()*40,0,7);ctx.fill();}
    // 边框
    ctx.strokeStyle = '#9a7b2e'; ctx.lineWidth = 14; ctx.strokeRect(18, 18, S-36, S-36);
    ctx.textAlign = 'center';
    // 标题
    ctx.fillStyle = '#7a2a1a'; ctx.font = 'bold 52px sans-serif';
    ctx.fillText('地震·餐厅避险', S/2, 80);
    // 错误项(红)
    ctx.fillStyle = '#b3261e'; ctx.font = 'bold 40px sans-serif';
    ctx.fillText('✗ 钻进桌肚里', S/2, 175);
    ctx.fillStyle = '#7a2a1a'; ctx.font = '26px sans-serif';
    ctx.fillText('"黄金三角"是误传', S/2, 215);
    ctx.fillText('桌肚塌陷会困住你', S/2, 248);
    // 正确项(绿)
    ctx.fillStyle = '#1b6b34'; ctx.font = 'bold 40px sans-serif';
    ctx.fillText('✓ 躲到结实桌【旁】', S/2, 330);
    ctx.fillStyle = '#22402a'; ctx.font = '26px sans-serif';
    ctx.fillText('伏地·遮挡·抓住桌腿', S/2, 370);
    ctx.fillText('护住头颈，随桌移动', S/2, 403);
    // 头顶警示(醒目)
    ctx.fillStyle = '#b3261e'; ctx.font = 'bold 34px sans-serif';
    ctx.fillText('⚠ 当心头顶吊灯!', S/2, 470);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.85, color: 0xffffff, emissive: 0x2a2418, emissiveIntensity: 0.25 });
  // 牌子立在西墙边、面朝房间内(法线朝 +x)，略歪表示被震斜了
  const signBoard = box(0.05, 0.7, 0.7, -RW/2 + 0.2, 1.3, -1.6, signMat, [0, Math.PI/2, 0.06]);
  // 牌子的支柱(细木杆)
  box(0.05, 1.0, 0.05, -RW/2 + 0.22, 0.5, -1.6, woodDark);

  // 地上的"安全伏地区"示意：桌子西侧一块浅色垫(暗示正确躲避位置)
  box(1.0, 0.02, 0.7, tx - 1.1, 0.01, tz, new THREE.MeshStandardMaterial({ color: 0x6b8f6b, roughness: 1.0, transparent: true, opacity: 0.55 }));

  // ===================================================================
  // 第 8 步：地震散落物(地面狼藉层)
  // -------------------------------------------------------------------
  // 撒一批随机小 box/碎瓷：摔碎的碗碟碎片、从碗柜震出来的盘子、天花板掉的灰块。
  // 集中撒在桌子周围和碗柜前，强化"刚被震过"的真实感。
  // 全部贴地、随机旋转，灰白/瓷白混杂。
  // ===================================================================

  const scatterCenters = [ [tx, tz], [cbx, cbz - 0.6], [0, -1.5], [tx + 1.0, tz - 1.0] ];
  for(let i = 0; i < 38; i++){
    const c = scatterCenters[i % scatterCenters.length];
    const px = c[0] + (Math.random() - 0.5) * 2.2;
    const pz = c[1] + (Math.random() - 0.5) * 2.0;
    const s = 0.04 + Math.random() * 0.12;
    const mat = Math.random() < 0.5 ? debrisMat : porcelainMat;
    box(s, s * (0.3 + Math.random() * 0.6), s, px, s * 0.3, pz, mat,
        [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI]);
  }
  // 桌底/旁边几片大一点的碎碗(让"桌旁"区域有真实坠物残骸，呼应科普)
  cyl(0.12, 0.1, 0.05, tx + 0.6, 0.04, tz + 0.5, porcelainMat, [0.9, 0, 1.4]);   // 摔成两半的半只碗
  box(0.18, 0.02, 0.1, tx + 0.75, 0.02, tz + 0.55, porcelainMat, [0.2, 1.0, 0.3]);

  // ===================================================================
  // 第 9 步：照明——1~2 盏暖 PointLight(0xffd9a0)
  // -------------------------------------------------------------------
  // 铁律 2：只用有坐标的 PointLight，绝不加全局光。
  // 主灯放在吊灯灯泡处(让"亮的吊灯"自洽地把房间照暖)，副灯补碗柜一角，
  // 让暗灰房间里有一团温暖焦点(被毁的温馨=最揪心的氛围)。
  // 参数对齐 game_v3 的 warmLamp 风格：暖橙、强度 3 左右、衰减距离 ~9。
  // ===================================================================

  // 主灯：吊灯位置(略低于灯泡，从灯罩往下照餐桌)
  const lamp1 = new THREE.PointLight(0xffd9a0, 3.4, 9, 2);
  lamp1.position.set(lampX + 0.3 + ox, 1.75, lampZ + 0.08 + oz);
  lamp1.castShadow = true;
  scene.add(lamp1);

  // 副灯：碗柜上方一角，微弱暖光勾出柜子轮廓
  const lamp2 = new THREE.PointLight(0xffd9a0, 1.6, 6, 2);
  lamp2.position.set(cbx + ox, 2.2, cbz - 0.5 + oz);
  scene.add(lamp2);

  // ===================================================================
  // 返回房间外壳材质，供集成处的 ground()/wallB() 复用，
  // 让玩家踩的地、撞的墙拥有和这间餐厅一致的质感。
  // ===================================================================
  return { floorMat, wallMat, ceilMat };
}

// 若在模块环境下使用，导出函数(纯 <script> 引入时下面这行会被忽略)
if (typeof module !== 'undefined' && module.exports) { module.exports = buildDiningRoom; }
