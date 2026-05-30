// 房间名：书房（Study）—— 余震·DROP 地震逃生科普游戏的支线探索房间
// =============================================================================
// 这个文件是干什么的？
//   它造出游戏里的一间"书房"——高书架、书桌、办公椅、台灯、电脑、成摞的书。
//   一进门你会看到：原本温馨的读书角，被地震揉碎了——整面高书架朝你倒下来，
//   压在书桌上；椅子翻倒在地；书撒了满地。墙上挂着一块歪掉的警示牌，
//   告诉你：高书架地震时会倒下压人，要么固定在墙上，要么躲避时离它远点。
//
// 怎么用？（集成方式）
//   这是一个【自包含函数】：你把它整段拷进 game_v3.html，然后在初始化场景时调一次：
//       buildStudyRoom(scene, THREE, ox, oz);
//   - scene = game_v3 的全局 THREE.Scene
//   - THREE = 已 import 的 three 模块（本函数不自己 import，靠外面传进来，零外部依赖）
//   - ox,oz = 房间在"游戏世界"里的放置原点。房间内部所有东西先以(0,0)为中心摆好，
//             最后统一 +ox/+oz 平移过去（其实是挂在一个 Group 上整体平移，更省心）。
//
//   ★关键★：本函数只负责"长出可见的家具/墙体/灯光"，它【不碰】game_v3 的
//   grounds[]（玩家能踩的地）和 walls[]（玩家会撞的墙）这两个碰撞数组。
//   它把"地板材质/墙材质/天花板材质"通过 return 交还给集成处，由集成处用
//   game_v3 自己的 ground()/wallB() 去登记真正的碰撞体（见文件末尾"集成说明"）。
//   这样做的好处：碰撞逻辑归 game_v3 统一管，本房间只管好看，职责清晰不打架。
//
// 操作注意事项（5 条铁律，违反必翻车）：
//   1) 零外部文件、零 addons：只用传进来的 THREE，纹理全用 <canvas> 现画，绝不加图片/模型。
//   2) 绝不加 AmbientLight/Hemisphere/Directional 等全局光——会照亮整栋楼毁掉暗灰氛围。
//      本房间只用【有位置的 PointLight】（暖橙 0xffd9a0）照亮局部。
//   3) 材质 map 必须拆包：makeConcrete() 返回 {map,normalMap} 打包对象，
//      绝不能 {map: 那个对象}，否则下一行 .repeat.set() 会抛 TypeError 整段崩黑屏。
//   4) 家具全是装饰、不进碰撞数组、靠墙摆、门洞留空——玩家能穿过不被卡死。
//   5) 你（写代码的人/agent）看不到渲染，专注几何正确+比例真实+能亮，视觉由主 agent CDP 把关。
// =============================================================================

function buildStudyRoom(scene, THREE, ox, oz) {
  // 房间整体挂在一个 Group 上。
  // 把 Group 想象成一个"大托盘"——所有家具先摆在托盘上（以托盘中心 0,0 为原点），
  // 最后把整个托盘搬到世界坐标 (ox, oz) 即可，不用每件家具都手动 +ox/+oz，省心又不易错。
  const room = new THREE.Group();
  room.position.set(ox, 0, oz);
  scene.add(room);

  // 房间尺寸（米）：宽(东西 x) RW × 深(南北 z) RD × 层高 H。
  // 取 6×6 的小开间，符合"书房"的体量；门洞默认开在房间南墙正中（朝向主走廊那一侧）。
  const RW = 6, RD = 6, H = 3;
  const DOOR_W = 1.4;          // 门洞净宽（和 game_v3 走廊门洞一致，别改窄了卡人）
  const DOOR_H = 2.2;          // 门洞净高
  const WT = 0.3;              // 墙厚

  // ---------------------------------------------------------------------------
  // 0) 程序化纹理工厂（从 skill references/textures.md 整段拷进来，当局部函数用）
  //    放在函数内部 = 局部作用域，不污染全局、不和别的房间函数重名打架。
  // ---------------------------------------------------------------------------

  // 开一张正方形离屏 canvas（画纹理的画板）
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点（落灰/颗粒感）。amount=密度，lo/hi=明度扰动范围
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 由灰度图反推法线图：相邻像素的明暗差=坡度=表面朝向。
  // 作用：让裂纹/木纹/颗粒在灯光下有真实凹凸，而不是一张平贴纸。strength 越大凹凸越强。
  function normalFromCanvas(srcCanvas,strength){const S=srcCanvas.width;const sctx=srcCanvas.getContext('2d');const src=sctx.getImageData(0,0,S,S).data;const{canvas,ctx}=makeCanvas(S);const out=ctx.createImageData(S,S);const o=out.data;const lum=(x,y)=>{x=(x+S)%S;y=(y+S)%S;const i=(y*S+x)*4;return(src[i]+src[i+1]+src[i+2])/3/255;};for(let y=0;y<S;y++){for(let x=0;x<S;x++){const dx=(lum(x-1,y)-lum(x+1,y))*strength;const dy=(lum(x,y-1)-lum(x,y+1))*strength;const len=Math.sqrt(dx*dx+dy*dy+1);const i=(y*S+x)*4;o[i]=(dx/len*0.5+0.5)*255;o[i+1]=(dy/len*0.5+0.5)*255;o[i+2]=(1/len*0.5+0.5)*255;o[i+3]=255;}}ctx.putImageData(out,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;}

  // 递归裂纹（地震墙裂的灵魂细节）——主干裂缝中途随机分叉，像真的裂纹一样蔓延
  function drawCracks(ctx,S,count){for(let k=0;k<count;k++){let x=Math.random()*S,y=Math.random()*S*0.5;let angle=Math.PI/2+(Math.random()-0.5);let w=2.2;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);const steps=30+Math.floor(Math.random()*30);for(let i=0;i<steps;i++){angle+=(Math.random()-0.5)*0.6;x+=Math.cos(angle)*(6+Math.random()*8);y+=Math.sin(angle)*(6+Math.random()*8);ctx.lineTo(x,y);if(Math.random()<0.15){let bx=x,by=y,ba=angle+(Math.random()-0.5)*1.6;ctx.lineWidth=w*0.5;for(let j=0;j<8;j++){ba+=(Math.random()-0.5)*0.6;bx+=Math.cos(ba)*5;by+=Math.sin(ba)*5;ctx.lineTo(bx,by);}ctx.moveTo(x,y);ctx.lineWidth=w;}}ctx.stroke();}}

  // 墙面纹理（灰白裂纹水渍，SCP 破败底色）
  function wallTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#d3d2cc';ctx.fillRect(0,0,S,S);for(let i=0;i<40;i++){ctx.fillStyle=`rgba(120,118,110,${0.04+Math.random()*0.08})`;const r=30+Math.random()*90;ctx.beginPath();ctx.arc(Math.random()*S,Math.random()*S,r,0,Math.PI*2);ctx.fill();}for(let i=0;i<14;i++){const x=Math.random()*S;const y=S*0.6+Math.random()*S*0.4;const g=ctx.createRadialGradient(x,y,2,x,y,40+Math.random()*50);g.addColorStop(0,'rgba(60,58,52,0.22)');g.addColorStop(1,'rgba(60,58,52,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}ctx.strokeStyle='rgba(40,38,34,0.55)';drawCracks(ctx,S,3);sprinkleNoise(ctx,S,0.5,-16,16);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // 地板纹理（脏旧木条纹 + 积灰）
  function floorTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#b4afa5';ctx.fillRect(0,0,S,S);for(let i=0;i<S;i+=64){ctx.fillStyle=i%128===0?'rgba(110,104,94,0.18)':'rgba(150,145,135,0.12)';ctx.fillRect(0,i,S,60);ctx.fillStyle='rgba(60,56,50,0.5)';ctx.fillRect(0,i+60,S,3);}for(let i=0;i<30;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*60);g.addColorStop(0,'rgba(205,203,196,0.35)');g.addColorStop(1,'rgba(205,203,196,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.55,-20,20);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // 木纹纹理（家具：书架/书桌/椅子）。base = 木色，本房间用暖木 #857769
  function woodTexture(base){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.strokeStyle='rgba(70,58,46,0.3)';ctx.lineWidth=1.5;for(let i=0;i<24;i++){ctx.beginPath();let y=Math.random()*S;ctx.moveTo(0,y);for(let x=0;x<=S;x+=16){y+=(Math.random()-0.5)*8;ctx.lineTo(x,y);}ctx.stroke();}for(let i=0;i<10;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,25+Math.random()*40);g.addColorStop(0,'rgba(200,196,186,0.28)');g.addColorStop(1,'rgba(200,196,186,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.35,-12,12);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // ---------------------------------------------------------------------------
  // 1) 共享材质（★材质 map 全部拆包写法★）
  //    一处建好、多处复用：省内存、风格统一。
  // ---------------------------------------------------------------------------
  const wallTex = wallTexture();
  const wallNormal = normalFromCanvas(wallTex.image, 2.0);
  const floorTex = floorTexture();
  floorTex.repeat.set(3, 3);                 // 地板纹理重复 3×3，否则一张图拉满 6 米地板会糊
  const floorNormal = normalFromCanvas(floorTex.image, 2.5);
  floorNormal.repeat.set(3, 3);

  // 墙材质（交还给集成处当真正的墙）
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, normalMap: wallNormal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, metalness: 0.0, color: 0xffffff });
  // 地板材质（交还给集成处当真正能踩的地）
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, normalMap: floorNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, metalness: 0.0 });
  // 天花板材质（纯色即可，玩家不太会盯着看）
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xdeded8, roughness: 1 });

  // 家具用木材质：暖木书架/书桌（深）+ 桌腿椅腿（更深一档做层次）
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture('#857769'), roughness: 0.8, metalness: 0.05 });
  const woodDark = new THREE.MeshStandardMaterial({ map: woodTexture('#6d6253'), roughness: 0.82, metalness: 0.05 });
  // 金属（台灯杆/椅子滚轮支架/书架金属脚）
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.7 });
  // 电脑黑屏 / 键盘
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.25, metalness: 0.3 });
  const plasticDark = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.1 });
  // 椅子座垫布料
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.95, metalness: 0 });

  // ---------------------------------------------------------------------------
  // 局部 box 助手：造一个长方体并挂到 room 这个托盘上。
  //   注意：因为整件家具都挂在 room（已平移到 ox,oz），所以这里用的全是
  //   "房间自己原点(0,0)"的本地坐标，最后由 room.position 一次性平移到世界。
  // ---------------------------------------------------------------------------
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    room.add(m);
    return m;
  }
  // 造一件家具（Group）并挂到 room 上，返回 Group 方便整体旋转表现"被震歪"
  function group() { const g = new THREE.Group(); room.add(g); return g; }

  // ---------------------------------------------------------------------------
  // 2) 房间外壳：地板可见层 + 天花板 + 四面墙（南墙留门洞）
  //    说明：这里画的墙/地是"可见外壳"。真正能踩、能撞的碰撞体由集成处用
  //    game_v3 的 ground()/wallB() 在同位置登记（见末尾集成说明），二者重叠不冲突。
  //    地板顶面 y=0（和 game_v3 二楼地面齐平）；地板盒高 0.3、中心 y=-0.15。
  // ---------------------------------------------------------------------------
  const half = RD / 2;        // 房间半深（南墙 z=+half，北墙 z=-half）
  const halfW = RW / 2;       // 房间半宽（西墙 x=-halfW，东墙 x=+halfW）

  box(RW, 0.3, RD, floorMat, 0, -0.15, 0);                 // 地板可见层
  box(RW, 0.2, RD, ceilMat, 0, H - 0.1, 0);                // 天花板（略低于层高顶，藏住接缝）

  // 北墙（房间最里面那面，整面无门）
  box(RW, H, WT, wallMat, 0, H / 2, -half);
  // 东墙
  box(WT, H, RD, wallMat, halfW, H / 2, 0);
  // 西墙
  box(WT, H, RD, wallMat, -halfW, H / 2, 0);
  // 南墙——开门洞：拆成"门左段 + 门右段 + 门楣"。门洞在南墙正中(x=0)。
  // 门左段宽 = (房间宽 - 门洞宽) / 2，中心落在左半区中点。
  const sideW = (RW - DOOR_W) / 2;                          // 单侧墙段宽 = (6-1.4)/2 = 2.3
  box(sideW, H, WT, wallMat, -(DOOR_W / 2 + sideW / 2), H / 2, half);   // 门左段
  box(sideW, H, WT, wallMat, (DOOR_W / 2 + sideW / 2), H / 2, half);    // 门右段
  box(DOOR_W, H - DOOR_H, WT, wallMat, 0, DOOR_H + (H - DOOR_H) / 2, half); // 门楣(门洞上方那条)

  // ---------------------------------------------------------------------------
  // 3) 家具（多 box/cylinder 拼，绝不一个大方块糊弄；全部靠墙摆，门洞与走道留空）
  //    布局速记（房间 6×6，门在南墙 z=+3 正中，玩家从南边进）：
  //      - 倒下的高书架：靠西墙(x=-2.5)，朝东南大角度倾倒，压在书桌上 → 全场视觉主角
  //      - 书桌：靠西墙偏北，被倒下的书架压住
  //      - 办公椅：翻倒在书桌前的地上
  //      - 第二个书架（直立但歪）：靠北墙
  //      - 台灯：在书桌上（带暖 PointLight）
  //      - 电脑：书桌上（黑屏+键盘）
  //      - 成摞的书 / 散落的书：地上、书架上、桌上
  // ---------------------------------------------------------------------------

  // —— 工具：造一个"塞满彩色书脊"的书架（一格格层板，每格塞一排小 box 当书）——
  // 书架 = 外框（左右侧板 + 顶底板 + 背板） + 若干层板 + 每层一排立着的小书。
  // 把它做成一个 Group 返回，方便整体旋转表现"倒下"。
  function makeBookshelf(w, h, d, shelves) {
    const g = new THREE.Group();
    const t = 0.05;                                        // 板材厚度
    // 外框：左右侧板
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), woodMat); left.position.set(-w / 2, h / 2, 0); g.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), woodMat); right.position.set(w / 2, h / 2, 0); g.add(right);
    // 顶板 / 底板
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), woodMat); top.position.set(0, h - t / 2, 0); g.add(top);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), woodMat); bot.position.set(0, t / 2, 0); g.add(bot);
    // 背板（薄板，避免从背后看穿）
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), woodDark); back.position.set(0, h / 2, -d / 2 + t / 2); g.add(back);
    // 各层层板 + 每层塞满彩色书脊
    const bookColors = [0x8c4a3a, 0x3f5a6e, 0x6e6b3f, 0x7a3f5a, 0x46604a, 0x5a5160, 0x9a6a3a, 0x40504e];
    for (let s = 1; s < shelves; s++) {
      const sy = (h / shelves) * s;                        // 第 s 层层板的高度
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), woodMat); shelf.position.set(0, sy, 0); g.add(shelf);
    }
    // 在每一格里塞一排立着的书（沿 x 方向排开，书脊朝外 +z）
    const cellH = h / shelves;
    for (let s = 0; s < shelves; s++) {
      const baseY = s * cellH + t;                         // 这一格底面
      let bx = -w / 2 + 0.08;                              // 从左往右排书
      while (bx < w / 2 - 0.08) {
        const bw = 0.03 + Math.random() * 0.04;            // 书的厚度
        const bh = cellH * (0.62 + Math.random() * 0.28);  // 书高（略低于格高）
        const col = bookColors[Math.floor(Math.random() * bookColors.length)];
        const bm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0 });
        const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d * 0.78), bm);
        // 有的书略歪、略矮（被翻动过），制造杂乱真实感
        book.position.set(bx + bw / 2, baseY + bh / 2, 0.01);
        book.rotation.z = (Math.random() - 0.5) * 0.12;
        book.castShadow = true;
        g.add(book);
        bx += bw + 0.008;
        if (Math.random() < 0.12) bx += 0.06;              // 偶尔留个空隙（书被抽走了）
      }
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // —— 3a) 倒下的高书架（全场主角，呼应科普）——
  // 高 2.3m 的大书架，原本靠西墙立着，地震时朝东南方向整个倾倒，砸在书桌上。
  // 倾倒靠 rotation.z（绕前后轴翻）实现：书架顶部往 +x（东）方向倒。
  const fallen = makeBookshelf(1.6, 2.3, 0.32, 5);
  // 先把书架"脚"放到靠西墙、偏北的位置，再绕底部边缘翻倒。
  // 为了让旋转看起来是"绕底脚翻"，把整个 Group 平移使旋转中心接近底部一角。
  fallen.position.set(-1.7, 0, -1.4);
  fallen.rotation.z = 1.15;        // 约 66°，大角度倾倒（顶部砸向东边的书桌）
  fallen.rotation.y = 0.12;        // 顺带歪一点，更自然
  room.add(fallen);

  // —— 3b) 第二个书架（还立着，但被震得明显歪斜，靠北墙）——
  const standing = makeBookshelf(1.4, 2.1, 0.3, 5);
  standing.position.set(1.4, 0, -half + 0.22);   // 靠北墙
  standing.rotation.z = -0.06;                   // 微微后仰，随时要倒的不安感
  standing.rotation.y = -0.04;
  room.add(standing);

  // —— 3c) 书桌（被倒下的书架压住）：台面 + 4 条腿 + 一块侧挡板 ——
  const desk = group();
  const deskTopY = 0.74;                          // 标准书桌台面高
  // 台面
  const dtop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.7), woodDark);
  dtop.position.set(0, deskTopY, 0); desk.add(dtop);
  // 4 条腿
  for (const sx of [-0.68, 0.68]) for (const sz of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, deskTopY, 0.06), woodDark);
    leg.position.set(sx, deskTopY / 2, sz); desk.add(leg);
  }
  // 侧挡板（书桌一侧的封板，更像真书桌）
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, deskTopY * 0.7, 0.6), woodDark);
  panel.position.set(-0.7, deskTopY * 0.45, 0); desk.add(panel);
  // 书桌摆在倒下书架顶部砸下来的落点附近：靠西墙偏北，被压住所以也歪了一点
  desk.position.set(-0.9, 0, -1.3);
  desk.rotation.z = 0.04;                         // 被书架压得微塌
  desk.rotation.y = 0.05;
  desk.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // —— 3d) 电脑（黑屏显示器 + 键盘），摆在书桌台面上 ——
  // 显示器：屏面板 + 黑屏 + 底座立柱 + 底盘
  const monitor = group();
  const mScreen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), plasticDark);
  mScreen.position.set(0, 0.18, 0);
  const mPanel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.012), screenMat);
  mPanel.position.set(0, 0.18, 0.022);
  const mStem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), plasticDark);
  mStem.position.set(0, 0.06, 0);
  const mBase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.16), plasticDark);
  mBase.position.set(0, 0.01, 0);
  monitor.add(mScreen, mPanel, mStem, mBase);
  // 显示器被震得歪倒在桌面靠里位置
  monitor.position.set(-1.05, deskTopY + 0.03, -1.45);
  monitor.rotation.z = 0.22; monitor.rotation.y = 0.18;
  monitor.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  // 键盘（扁 box，掉到桌沿，歪着）
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.15), screenMat);
  kb.position.set(-0.7, deskTopY + 0.04, -1.05);
  kb.rotation.y = 0.4; kb.rotation.z = 0.05; kb.castShadow = true; room.add(kb);

  // —— 3e) 台灯（底座 + 杆 + 锥形灯罩 + 暖 PointLight）摆在书桌上 ——
  // 灯杆/灯罩用 Cylinder/Cone 拼，灯罩里塞一盏暖光，做成"书桌焦点暖光"。
  const lamp = group();
  const lBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.03, 20), metalMat);
  lBase.position.set(0, 0.015, 0);
  const lPole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 12), metalMat);
  lPole.position.set(0, 0.23, 0);
  // 锥形灯罩（开口朝下，扣在杆顶）。ConeGeometry 默认尖朝上，这里翻过来当灯罩。
  const lShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.16, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide, emissive: 0x3a2a10, emissiveIntensity: 0.5 })
  );
  lShade.rotation.x = Math.PI;                    // 翻转：开口朝下
  lShade.position.set(0.06, 0.45, 0);             // 灯头歪向一侧（地震后没指向桌面）
  lShade.rotation.z = 0.5;
  lamp.add(lBase, lPole, lShade);
  lamp.position.set(-0.55, deskTopY + 0.03, -1.55);
  lamp.rotation.z = 0.06;                         // 灯也被震斜
  lamp.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  // 台灯的暖光（有位置的 PointLight，照亮书桌焦点）——这是本房间两盏灯之一
  const lampLight = new THREE.PointLight(0xffd9a0, 6, 4.5, 2.0);
  lampLight.position.set(ox - 0.5, deskTopY + 0.5, oz - 1.55);   // ★ PointLight 不在 Group 里，直接给世界坐标，记得 +ox/+oz
  scene.add(lampLight);

  // —— 3f) 办公椅（翻倒在地）：座垫 + 靠背 + 中柱 + 五星脚 + 滚轮 ——
  // 整把椅子做成 Group，然后整体翻倒（rotation 大角度）躺在书桌前的地上。
  const chair = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.44), seatMat); seat.position.set(0, 0.5, 0); chair.add(seat);
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.07), seatMat); backrest.position.set(0, 0.78, -0.2); chair.add(backrest);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 12), metalMat); stem.position.set(0, 0.28, 0); chair.add(stem);
  // 五星脚（5 条向外辐射的脚 + 末端滚轮）
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const legL = 0.26;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, legL), metalMat);
    leg.position.set(Math.cos(a) * legL / 2, 0.08, Math.sin(a) * legL / 2);
    leg.rotation.y = -a; chair.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12), plasticDark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(Math.cos(a) * legL, 0.04, Math.sin(a) * legL); chair.add(wheel);
  }
  chair.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // 整把椅子翻倒：绕 x 轴转近 90°，躺在书桌东侧前方的地上
  chair.position.set(0.3, 0.25, -0.2);
  chair.rotation.x = -1.45;                        // 仰面朝天翻倒
  chair.rotation.z = 0.4;
  room.add(chair);

  // —— 3g) 成摞的书（几摞立在地上/桌上）+ 散落一地的单本书 ——
  const bookColors = [0x8c4a3a, 0x3f5a6e, 0x6e6b3f, 0x7a3f5a, 0x46604a, 0x5a5160, 0x9a6a3a];
  // 桌上一摞书（被震得歪倒）
  function makeStack(x, y, z, n, lean) {
    const g = new THREE.Group();
    let cy = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.24 + Math.random() * 0.06, d = 0.18 + Math.random() * 0.05, h = 0.035 + Math.random() * 0.02;
      const col = bookColors[Math.floor(Math.random() * bookColors.length)];
      const bm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm);
      b.position.set((Math.random() - 0.5) * 0.05, cy + h / 2, (Math.random() - 0.5) * 0.05);
      b.rotation.y = (Math.random() - 0.5) * 0.4;
      b.castShadow = true; g.add(b); cy += h;
    }
    g.position.set(x, y, z); g.rotation.z = lean; room.add(g); return g;
  }
  makeStack(-0.4, deskTopY + 0.03, -1.15, 4, 0.18);   // 桌上一摞，明显歪倒
  makeStack(2.0, 0, -2.3, 5, 0.06);                   // 北墙角地上一摞
  makeStack(-2.2, 0, 1.6, 3, -0.1);                   // 西南角地上一摞

  // 散落一地的单本书（撒一批，随机位置/角度/颜色），避开门洞走道(z>1.6 且 |x|<1.0)
  for (let i = 0; i < 26; i++) {
    let x, z, tries = 0;
    do {
      x = (Math.random() - 0.5) * (RW - 1.0);
      z = (Math.random() - 0.5) * (RD - 1.0);
      tries++;
    } while (z > 1.5 && Math.abs(x) < 1.0 && tries < 8);  // 别撒在门洞正前方走道上
    const w = 0.22 + Math.random() * 0.08, d = 0.16 + Math.random() * 0.05, h = 0.03 + Math.random() * 0.02;
    const col = bookColors[Math.floor(Math.random() * bookColors.length)];
    const bm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.88 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm);
    b.position.set(x, h / 2 + 0.005, z);
    b.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);  // 有的翻开/侧立
    b.castShadow = true; b.receiveShadow = true; room.add(b);
  }

  // 从倒下书架上"洒出来"的书（堆在书架倒下的方向 = 东侧地面）
  for (let i = 0; i < 14; i++) {
    const w = 0.22 + Math.random() * 0.07, d = 0.16 + Math.random() * 0.05, h = 0.03 + Math.random() * 0.02;
    const col = bookColors[Math.floor(Math.random() * bookColors.length)];
    const bm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.88 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm);
    b.position.set(-0.5 + Math.random() * 1.6, h / 2 + 0.005, -2.0 + Math.random() * 1.6);
    b.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.7);
    b.castShadow = true; room.add(b);
  }

  // —— 3h) 撒一层灰白小碎块（墙皮/天花板掉落，"地震后狼藉"的地面层）——
  for (let i = 0; i < 30; i++) {
    const s = 0.04 + Math.random() * 0.1;
    const shade = 0.6 + Math.random() * 0.28;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * (0.4 + Math.random() * 0.5), s * (0.6 + Math.random() * 0.7)),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(shade, shade, shade * 0.97), roughness: 0.95 })
    );
    m.position.set((Math.random() - 0.5) * (RW - 0.8), s * 0.4 + 0.005, (Math.random() - 0.5) * (RD - 0.8));
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = true; m.receiveShadow = true; room.add(m);
  }

  // ---------------------------------------------------------------------------
  // 4) 🔴 科普埋点（房间的灵魂）：墙上挂一块歪掉的警示牌，把救命知识做成实物
  //    内容：高大书架/柜地震时会倒下压人——要固定在墙上，或躲避时远离它。
  //    呼应游戏"被压死"主题：玩家眼前就是一座倒下的书架。
  //    做法：用 canvas 现画一张警示牌纹理（黄底黑字 + 红框），贴到一块薄板上，挂北墙、歪着。
  // ---------------------------------------------------------------------------
  function warningSignTexture() {
    const S = 512; const { canvas, ctx } = makeCanvas(S);
    ctx.fillStyle = '#d9b43a'; ctx.fillRect(0, 0, S, S);              // 警示黄底
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 18; ctx.strokeRect(20, 20, S - 40, S - 40);  // 黑框
    // 顶部红色警告条
    ctx.fillStyle = '#a83232'; ctx.fillRect(40, 40, S - 80, 90);
    ctx.fillStyle = '#f5ecd0'; ctx.font = 'bold 60px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('地震警示', S / 2, 105);
    // 画一个"书架倒下压住小人"的简笔警示图标
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 10;
    ctx.strokeRect(150, 180, 90, 150);                                // 直立书架轮廓
    ctx.beginPath(); ctx.moveTo(245, 175); ctx.lineTo(390, 250); ctx.lineTo(360, 300); ctx.lineTo(220, 230); ctx.closePath(); ctx.stroke(); // 倒下的书架
    ctx.beginPath(); ctx.arc(335, 320, 18, 0, Math.PI * 2); ctx.stroke();  // 被压的小人头
    // 正文（分两行）
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 40px sans-serif';
    ctx.fillText('高书架会倒下压人', S / 2, 400);
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('请固定于墙 · 躲避时远离', S / 2, 450);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  const signMat = new THREE.MeshStandardMaterial({ map: warningSignTexture(), roughness: 0.6, metalness: 0.1, emissive: 0x2a2410, emissiveIntensity: 0.35 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.03), signMat);
  sign.position.set(-2.5, 1.7, -half + 0.18);    // 挂在北墙偏西，倒下书架原来的位置上方（暗示"这本该固定在墙上"）
  sign.rotation.z = -0.18;                        // 被震歪
  sign.castShadow = true; room.add(sign);

  // —— 警示牌专属补光（让黄牌子在暗灰里看得清，是本房间第二盏 PointLight）——
  const signLight = new THREE.PointLight(0xffd9a0, 3.5, 5, 2);
  signLight.position.set(ox - 2.2, 2.1, oz - half + 0.7);   // ★ +ox/+oz 到世界坐标
  scene.add(signLight);

  // ---------------------------------------------------------------------------
  // 5) 把"地板/墙/天花板材质"交还给集成处。
  //    集成处会用 game_v3 的 ground()/wallB() 在同样位置登记真正的碰撞体，
  //    传入这些材质 → 玩家踩到/撞到的就是本房间的暖木破败质感，视觉与碰撞统一。
  // ---------------------------------------------------------------------------
  return { floorMat, wallMat, ceilMat };
}

// =============================================================================
// 【集成说明 / 接在哪、坐标怎么传】（给主 agent 集成进 game_v3.html 时看）
//
// 房间尺寸：6(宽 x) × 6(深 z) × 3(高)，门洞开在【南墙正中】(房间本地 z=+3, x=0)，
// 净宽 1.4、净高 2.2。房间是【死胡同支线】，玩家进去探索完原路返回。
//
// 建议接入点：开在【客厅北墙】或【某段走廊的北墙】（往 -z 方向延伸的空地，
// 避免和已有几何/别的并行房间重叠）。举例：在客厅北墙 z=-4、x 取某个位置 X 开门，
// 房间往北延伸占 z∈[-10,-4]，则房间原点 oz = -4 - 3 = -7（门洞贴着客厅北墙），
// ox = X（门洞中心的世界 x）。调用：
//
//     const sm = buildStudyRoom(scene, THREE, X, -7);
//
// 然后用 game_v3 自己的 helper 登记【碰撞体】（这函数本身不碰 grounds[]/walls[]）：
//   1) 地板（玩家能踩，顶面 y=0）：
//        ground(6, 0.3, 6, X, -0.15, -7, sm.floorMat);
//   2) 三面实墙进 walls[]（北/东/西，南墙只留门洞两侧墙段）：
//        wallB(6,   3, 0.3, X,        1.5, -10,   sm.wallMat);  // 北墙 (z=-7-3)
//        wallB(0.3, 3, 6,   X+3,      1.5, -7,    sm.wallMat);  // 东墙
//        wallB(0.3, 3, 6,   X-3,      1.5, -7,    sm.wallMat);  // 西墙
//        wallB(2.3, 3, 0.3, X-1.85,   1.5, -4,    sm.wallMat);  // 南墙门左段
//        wallB(2.3, 3, 0.3, X+1.85,   1.5, -4,    sm.wallMat);  // 南墙门右段
//      （门洞在 z=-4、x=X 处宽 1.4，和客厅北墙那段开的门洞精确对齐、地面无缝，否则掉地板）
//   3) 客厅北墙原本那一整段，要拆出同位置门洞（门左/门右/门楣），让玩家能走进来。
//
// ⚠️ 坐标对齐铁律：门洞处房间地板必须和客厅地板齐平、无缝；改完跑 window.__walk()
//    确认主逃生路仍 reachedExit:true，再 CDP 截图验收暗灰+暖灯氛围、比例、有没有穿模。
// =============================================================================
