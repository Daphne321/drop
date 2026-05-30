// 电梯厅 —— 余震·DROP 支线探索房间。零外部文件、零 addons、零全局光。
// =============================================================================
// 这个文件是干什么的：
//   给地震逃生游戏 game_v3.html 造一间「电梯厅」支线房间。玩家从主逃生路旁的一道
//   门走进来，正对面是一对关着的、被震得变形错位的电梯双开金属门；门旁有楼层按钮
//   面板（会微微发光的数字 box）、头顶一排楼层指示灯（大多被震灭、剩一两个红着）、
//   墙上一块醒目的红底白字「地震时禁止乘梯」警示牌、一条等候长椅、墙角一个红色消防
//   栓。整个房间用「冷调金属 + 一抹应急灯红光 + 暖灯焦点」的破败氛围，把这条最重要
//   的救命常识焊进场景：地震时绝对不能坐电梯——会停电困人、钢缆可能断、人可能坠入井道。
//
// 怎么用（集成）：
//   在 game_v3.html 的某面墙上开一个门洞，然后调一次：
//     const ev = buildElevatorHall(scene, THREE, OX, OZ);
//   其中 (OX,OZ) 是这间房在世界坐标里的「房间中心」放置点。本函数内部所有家具都先
//   按「房间自己以 (0,0) 为中心」摆好，最后统一 +ox/+oz 平移过去——所以你只要把房间
//   中心对准门洞外的空地即可。
//   返回 {floorMat, wallMat, ceilMat}：把它们传给 game_v3 的 ground()/wallB()，让玩家
//   踩的地、撞的墙和房间本身是同一套质感（视觉连续）。
//
// ⚠️ 操作注意事项（5 条铁律，违反必翻车）：
//   1) 零外部文件：所有质感用 <canvas> 现画，几何全程序化 box/cylinder 拼，不引任何
//      图片/模型/CDN/addons。
//   2) 绝不加全局光（AmbientLight/HemisphereLight/DirectionalLight）——会照亮整栋楼
//      毁掉暗灰氛围。只用「有位置的 PointLight」照亮局部。
//   3) 材质 map 必拆包：makeConcrete() 返回 {map,normalMap} 打包对象，必须写
//      map: cc.map, normalMap: cc.normalMap，绝不能 map: cc（否则 .repeat.set() 崩黑屏）。
//   4) 家具靠墙摆、留门洞和走道、全部用「装饰 mesh」（不进碰撞数组），玩家能穿过。
//   5) 我（subagent）看不到渲染，只保证几何正确+比例真实+能亮，视觉由主 agent 用 CDP
//      截图把关。
//
// 房间尺寸约定：宽 RW=7（沿 x），深 RD=8（沿 z），层高 RH=3，地板顶面 y=0（和 game_v3
//   二楼地面齐平）。门洞默认开在南墙正中（z=+RD/2，朝主逃生路），电梯门做在北墙正中
//   （z=-RD/2），玩家进门一眼就正对电梯——视线焦点直接给到「危险物」。
// =============================================================================
function buildElevatorHall(scene, THREE, ox, oz){

  // ===========================================================================
  // 0) 房间尺寸常量
  //    把房间想象成一个长方形盒子，我们先在「以盒子中心为原点」的小坐标系里建模，
  //    最后所有东西统一 +ox/+oz 搬到世界里去。这样建模时只用关心相对位置，省心。
  // ===========================================================================
  const RW = 7, RD = 8, RH = 3;     // 房间 宽(x) / 深(z) / 高
  const DOOR_W = 1.5;               // 进出门洞宽度（开在南墙正中 z=+RD/2，朝主逃生路）

  // ===========================================================================
  // 1) 程序化纹理工厂（整段从 skill 的 references/textures.md 拷进来当局部函数）
  //    放在函数内部 = 局部作用域，不会和 game_v3 全局的同名函数打架。
  // ---------------------------------------------------------------------------
  //    类比：这些函数就像「现场调漆师傅」——不进货现成贴图（守 8MB），而是当场用画笔
  //    在一张小画布上画出水泥/金属的质感，画完交给 Three.js 当材质。
  // ===========================================================================

  // 开一张正方形离屏画布（画纹理用的草稿纸）
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点：模拟落灰/颗粒感。amount=密度，lo/hi=明暗扰动范围
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 混凝土纹理（地/墙/碎块用，自带法线图）。
  // ★ 返回 {map, normalMap} 打包对象，用的时候必须拆包！★
  // 原理：先画一张带斑驳明暗+随机裂纹的灰图当颜色贴图，再由这张图的明暗坡度反推一张
  //      法线图——这样光照打上去时裂纹和颗粒会有真实的凹凸感，而不是平贴纸。
  function makeConcrete(size=512,base='#b3b3b0'){
    const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');
    g.fillStyle=base;g.fillRect(0,0,size,size);
    // 大块柔和明暗斑（水泥浇筑的不均匀）
    for(let i=0;i<90;i++){const x=Math.random()*size,y=Math.random()*size,r=40+Math.random()*140;const a=(Math.random()-0.5)*0.16;const grad=g.createRadialGradient(x,y,0,x,y,r);const v=a>0?255:0;grad.addColorStop(0,`rgba(${v},${v},${v},${Math.abs(a)})`);grad.addColorStop(1,`rgba(${v},${v},${v},0)`);g.fillStyle=grad;g.beginPath();g.arc(x,y,r,0,7);g.fill();}
    // 像素级噪点（粗糙颗粒）
    const img=g.getImageData(0,0,size,size),d=img.data;for(let i=0;i<d.length;i+=4){const n=(Math.random()-0.5)*36;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}g.putImageData(img,0,0);
    // 几条折线裂纹（地震开裂的灵魂）
    g.strokeStyle='rgba(20,20,18,0.5)';for(let i=0;i<8;i++){g.lineWidth=0.6+Math.random()*1.2;g.beginPath();let x=Math.random()*size,y=Math.random()*size;g.moveTo(x,y);for(let s=0;s<8;s++){x+=(Math.random()-0.5)*70;y+=(Math.random()-0.5)*70;g.lineTo(x,y);}g.stroke();}
    const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;
    // —— 由灰度反推法线图 ——
    const nc=document.createElement('canvas');nc.width=nc.height=size;const ng=nc.getContext('2d');const srcData=g.getImageData(0,0,size,size).data;const out=ng.createImageData(size,size),od=out.data;
    const lum=(x,y)=>{const i=((y&(size-1))*size+(x&(size-1)))*4;return(srcData[i]+srcData[i+1]+srcData[i+2])/765;};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=(lum(x-1,y)-lum(x+1,y))*2.2;const dy=(lum(x,y-1)-lum(x,y+1))*2.2;const len=Math.hypot(dx,dy,1);const i=(y*size+x)*4;od[i]=((dx/len)*0.5+0.5)*255;od[i+1]=((dy/len)*0.5+0.5)*255;od[i+2]=(1/len)*255;od[i+3]=255;}
    ng.putImageData(out,0,0);const normal=new THREE.CanvasTexture(nc);normal.wrapS=normal.wrapT=THREE.RepeatWrapping;
    return{map:tex,normalMap:normal};
  }

  // 拉丝不锈钢纹理（电梯门专用）。
  // 原理：在浅灰底上画一排排细竖纹（拉丝纹理）+ 几道纵向高光/暗影条，模拟电梯门那种
  //      冷冰冰的金属拉丝面。比纯色材质有质感得多。
  function brushedMetalTexture(base='#a9aeb2'){
    const S=256;const{canvas,ctx}=makeCanvas(S);
    ctx.fillStyle=base;ctx.fillRect(0,0,S,S);
    // 竖向拉丝细纹（一根根淡明暗线）
    for(let x=0;x<S;x++){const v=(Math.random()-0.5)*22;ctx.strokeStyle=`rgba(${128+v},${130+v},${134+v},0.5)`;ctx.beginPath();ctx.moveTo(x+0.5,0);ctx.lineTo(x+0.5,S);ctx.stroke();}
    // 几道宽的纵向高光/暗带（金属面反光不均）
    for(let i=0;i<6;i++){const x=Math.random()*S;const w=8+Math.random()*30;const bright=Math.random()<0.5;ctx.fillStyle=bright?'rgba(220,224,228,0.18)':'rgba(60,64,68,0.18)';ctx.fillRect(x,0,w,S);}
    sprinkleNoise(ctx,S,0.15,-8,8);
    const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;
  }

  // 警示牌纹理（科普核心！红底白字「地震时禁止乘梯」，必须醒目可读）。
  // 设计思路：这块牌子是整间房的灵魂，玩家一抬头就要被这行字砸到脑子里。所以用最强
  //   对比——警示红底 + 粗白字 + 顶部一个三角感叹号警告符 + 底部一行小字讲为什么。
  //   text/sub 都画成居中、字号占满，保证从几米外也读得清。
  function signTexture(){
    const W=512,Hh=320;const c=document.createElement('canvas');c.width=W;c.height=Hh;const g=c.getContext('2d');
    // 警示红底
    g.fillStyle='#c0241c';g.fillRect(0,0,W,Hh);
    // 白色粗边框（牌子的轮廓，让它从墙上跳出来）
    g.strokeStyle='#ffffff';g.lineWidth=10;g.strokeRect(12,12,W-24,Hh-24);
    // 顶部：黄黑警告三角 + 感叹号（国际通用「危险」符号）
    g.fillStyle='#ffd400';g.beginPath();g.moveTo(W/2,34);g.lineTo(W/2-34,96);g.lineTo(W/2+34,96);g.closePath();g.fill();
    g.fillStyle='#1a1a1a';g.font='bold 50px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('!',W/2,72);
    // 主标题：地震时禁止乘梯（粗白字，占满中段）
    g.fillStyle='#ffffff';g.font='bold 58px sans-serif';g.textAlign='center';g.textBaseline='middle';
    g.fillText('地震时',W/2,150);
    g.fillText('禁止乘梯',W/2,212);
    // 底部小字：讲清楚为什么（停电困人 / 钢缆危险）——把科普一句话写在牌子上
    g.font='bold 24px sans-serif';g.fillStyle='#ffe6e2';
    g.fillText('停电困人 · 坠落危险 · 请走楼梯',W/2,278);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
  }

  // ===========================================================================
  // 2) 共享材质
  //    地/墙/顶用混凝土（电梯厅就是裸水泥+金属包边），各画一份独立纹理避免 repeat 互相
  //    干扰。★ 这里就是铁律 3 的现场：写 map: cc.map 而不是 map: cc ★
  // ===========================================================================
  const ccFloor = makeConcrete(512,'#9a9c9e');                 // 地面偏冷灰（冷调金属厅）
  ccFloor.map.repeat.set(2,2); ccFloor.normalMap.repeat.set(2,2);
  const floorMat = new THREE.MeshStandardMaterial({map:ccFloor.map, normalMap:ccFloor.normalMap, normalScale:new THREE.Vector2(0.9,0.9), roughness:0.9, metalness:0.05});

  const ccWall = makeConcrete(512,'#aeb0b2');                  // 墙面冷灰
  const wallMat = new THREE.MeshStandardMaterial({map:ccWall.map, normalMap:ccWall.normalMap, normalScale:new THREE.Vector2(0.85,0.85), roughness:0.95, metalness:0.0, color:0xffffff});

  const ceilMat = new THREE.MeshStandardMaterial({color:0xb2b4b6, roughness:1.0, metalness:0.0});

  // 拉丝不锈钢（电梯门）
  const doorTex = brushedMetalTexture('#a9aeb2');
  const doorMetalMat = new THREE.MeshStandardMaterial({map:doorTex, roughness:0.4, metalness:0.75, color:0xffffff});

  // 纯材质（不用纹理）：各种金属/塑料/发光件
  const metalMat   = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7});  // 不锈钢门框/按钮板
  const darkMetal  = new THREE.MeshStandardMaterial({color:0x52565a, roughness:0.55, metalness:0.6});  // 深色铁件/长椅腿
  const chromeMat  = new THREE.MeshStandardMaterial({color:0xc8ccd0, roughness:0.2,  metalness:0.9});  // 亮面金属包边
  const plasticDark= new THREE.MeshStandardMaterial({color:0x2a2c30, roughness:0.7,  metalness:0.1});  // 塑料外壳/按钮缝
  const redMat     = new THREE.MeshStandardMaterial({color:0xb22a22, roughness:0.5,  metalness:0.25}); // 消防栓红
  const woodSeat   = new THREE.MeshStandardMaterial({color:0x6b5a45, roughness:0.85, metalness:0.05}); // 长椅木座
  const debrisMat  = new THREE.MeshStandardMaterial({color:0x9a9893, roughness:0.97, metalness:0.0});  // 掉落水泥碎块
  const glassDark  = new THREE.MeshStandardMaterial({color:0x141518, roughness:0.3,  metalness:0.4});  // 灭掉的指示灯/暗玻璃

  // —— 自发光材质（铁律 2：不能加全局光，所以「会亮的小物件」靠 emissive 自己发光）——
  // emissive = 材质自带的光，不依赖外部灯也能在暗处亮起来，正好用来做「按钮数字 / 还
  //   亮着的指示灯」这种细小光点。emissiveIntensity 控制亮度。
  const btnGlowMat = new THREE.MeshStandardMaterial({color:0xffe6a0, emissive:0xffc864, emissiveIntensity:1.3, roughness:0.4}); // 楼层按钮数字（暖黄发光）
  const litRedMat  = new THREE.MeshStandardMaterial({color:0xff5a40, emissive:0xff3018, emissiveIntensity:1.5, roughness:0.4}); // 还亮着的红色指示灯
  const signMat    = new THREE.MeshStandardMaterial({map:signTexture(), roughness:0.8, color:0xffffff, emissive:0xff2a1a, emissiveIntensity:0.35}); // 警示牌（红底自带微光，暗处也读得清）

  // ===========================================================================
  // 3) 通用拼装 helper
  //    box()  = 造一个带阴影的 box mesh（先不入场景，留给家具组拼装）
  //    cyl()  = 造一个带阴影的圆柱 mesh（消防栓/指示灯/长椅圆腿用）
  //    place()= 把一组（Group）家具整体平移到「房间局部坐标 + 世界原点」，再入场景
  //    add()  = 把单个 mesh 按「局部坐标 +ox/+oz」直接入场景（散件用）
  //    —— 全部走 deco 语义：只 scene.add，绝不进 grounds/walls，玩家穿得过去（铁律4）。
  // ===========================================================================
  function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  function cyl(rt,rb,h,mat,seg){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||16),mat);m.castShadow=true;m.receiveShadow=true;return m;}
  function place(g,x,y,z){g.position.set(x+ox,y,z+oz);scene.add(g);return g;}
  function add(mesh,x,y,z){mesh.position.set(x+ox,y,z+oz);scene.add(mesh);return mesh;}

  // ===========================================================================
  // 4) 房间外壳：地板 / 天花板 / 四面墙（南墙留门洞，北墙留电梯门凹槽视觉）
  //    这里画的外壳是「视觉本体」（用 deco 语义铺上去，让房间从内部看是完整封闭的）；
  //    集成处再用 game_v3 的 ground()/wallB() 配合返回的材质添加「能踩的地、能撞的墙」。
  // ===========================================================================

  // 地板（顶面 y=0：盒高 0.3，中心 y=-0.15）
  add(box(RW,0.3,RD,floorMat, 0,-0.15,0), 0,0,0);
  // 天花板（贴在 RH 高度）
  add(box(RW,0.2,RD,ceilMat, 0,RH+0.1,0), 0,0,0);

  // 四面墙（墙厚 0.3，中心高 RH/2）。北墙(z=-RD/2)是电梯门所在的整面墙；南墙开进出门洞。
  // 北墙（z=-RD/2，整面）—— 电梯门做在它前面贴着
  add(box(RW,RH,0.3,wallMat, 0,RH/2,-RD/2), 0,0,0);
  // 东墙（x=+RW/2，整面）
  add(box(0.3,RH,RD,wallMat, RW/2,RH/2,0), 0,0,0);
  // 西墙（x=-RW/2，整面）
  add(box(0.3,RH,RD,wallMat, -RW/2,RH/2,0), 0,0,0);
  // 南墙拆成门左段 + 门右段 + 门楣，中间留 DOOR_W 宽门洞（门洞在 x=0 正中）
  const sideW = (RW-DOOR_W)/2;                                          // 门两侧各一段墙的宽度
  add(box(sideW,RH,0.3,wallMat, -(DOOR_W/2+sideW/2),RH/2,RD/2), 0,0,0); // 门左段
  add(box(sideW,RH,0.3,wallMat,  (DOOR_W/2+sideW/2),RH/2,RD/2), 0,0,0); // 门右段
  add(box(DOOR_W,RH-2.2,0.3,wallMat, 0,RH-(RH-2.2)/2,RD/2), 0,0,0);     // 门楣（门洞上方过梁）

  // ===========================================================================
  // 5) 主体：电梯（北墙正中）—— 这是房间的视觉与科普焦点
  //    电梯 = 不锈钢门框（井字包边）+ 一对关着的双开门（中缝）+ 上方楼层指示灯排。
  //    破败设计：两扇门被震得「错位 + 内陷 + 中缝裂开一道黑缝」，让人一看就知道这电梯
  //    完蛋了——视觉上替「禁止乘梯」这条科普做铺垫。
  // ===========================================================================
  function buildElevator(){
    const g=new THREE.Group();
    const DW=1.6, DH=2.3;                       // 单侧门洞总宽(两扇合起) / 门高
    const frameT=0.16;                          // 门框包边厚度

    // —— 不锈钢门框（井字形：左竖框 + 右竖框 + 上横框）——
    g.add(box(frameT, DH+frameT*2, 0.12, chromeMat, -DW/2-frameT/2, DH/2, 0));   // 左竖框
    g.add(box(frameT, DH+frameT*2, 0.12, chromeMat,  DW/2+frameT/2, DH/2, 0));   // 右竖框
    g.add(box(DW+frameT*2, frameT, 0.12, chromeMat, 0, DH+frameT/2, 0));         // 上横框
    // 门框底坎（地面那条金属槽）
    g.add(box(DW+frameT*2, 0.05, 0.14, darkMetal, 0, 0.025, 0));

    // —— 一对双开门（关着，中间一道竖缝）——
    // 左门：被震得向内陷 + 轻微歪，门面比框低一点凹进去 = 错位感
    const leftDoor=box(DW/2-0.02, DH, 0.06, doorMetalMat, -DW/4-0.01, DH/2, -0.02);
    leftDoor.rotation.z=0.025;                  // 微微倾斜（变形）
    g.add(leftDoor);
    // 右门：被卡住没完全合上，向外凸一点 + 反向歪 => 两扇门错位
    const rightDoor=box(DW/2-0.02, DH, 0.06, doorMetalMat, DW/4+0.05, DH/2, 0.03);
    rightDoor.rotation.z=-0.04;                 // 反向倾斜，和左门错开
    g.add(rightDoor);
    // 中缝（一道发黑的深缝，门没合严，露出漆黑的井道——暗示「门后是空的，掉下去就完了」）
    g.add(box(0.09, DH-0.1, 0.02, new THREE.MeshBasicMaterial({color:0x050507}), 0.02, DH/2, 0.05));
    // 门上的横向拉丝接缝装饰条（两条，电梯门常见）
    g.add(box(DW, 0.02, 0.065, darkMetal, 0, DH*0.62, 0.04));
    g.add(box(DW, 0.02, 0.065, darkMetal, 0, DH*0.34, 0.04));

    // —— 楼层指示灯排（门框上方一排小数字灯，大多被震灭，剩一两个红着）——
    // 这是「楼层指示灯」：横排 6 个小灯，模拟电梯停在哪层。地震后多数灭掉(暗玻璃)，
    // 只剩一两个红着的——既是破败，也是「电梯还在乱动/卡死」的不祥信号。
    const litIdx = 1;                           // 第几个灯还红着（其余灭）
    for(let i=0;i<6;i++){
      const lit = (i===litIdx);
      const lamp=box(0.13,0.16,0.04, lit?litRedMat:glassDark, -DW/2+0.18+i*((DW-0.36)/5), DH+frameT+0.16, 0.04);
      g.add(lamp);
      g.add(box(0.15,0.18,0.03, plasticDark, -DW/2+0.18+i*((DW-0.36)/5), DH+frameT+0.16, 0.02)); // 灯位黑框
    }
    // 指示灯排底板（细长黑条）
    g.add(box(DW+0.1,0.24,0.03, plasticDark, 0, DH+frameT+0.16, 0.005));

    return g;
  }
  const elevator=buildElevator();
  // 贴北墙正中、紧贴墙面内侧（z = -RD/2 + 0.2，门朝 +z 房间内）
  place(elevator, 0, 0, -RD/2+0.2);

  // —— 第二部井道开口（破败重灾区）：电梯旁边一个「门没了、只剩漆黑井道」的洞 ——
  // 设计思路：光一部变形门还不够吓人。再在它东侧做一个「门整个被震掉、露出深不见底的
  //   黑井道」的开口——这是「人坠入井道」科普点最直接的视觉化。井道口加黄黑警戒条。
  function buildShaftHole(){
    const g=new THREE.Group();
    const HW=1.0, HH=2.1;                        // 洞宽 / 洞高
    // 漆黑井道（一个朝里凹的黑盒子，深一点制造「无底洞」感）
    g.add(box(HW, HH, 0.6, new THREE.MeshBasicMaterial({color:0x040406}), 0, HH/2, -0.3));
    // 残破门框（只剩半截，歪着）
    const stub=box(0.12, HH, 0.1, darkMetal, -HW/2-0.06, HH/2, 0.05); stub.rotation.z=0.08; g.add(stub);
    g.add(box(HW+0.2, 0.12, 0.1, darkMetal, 0, HH+0.06, 0.02));        // 上框（歪）
    // 一扇被震脱、半挂在洞口的门板（大角度歪斜，快掉下去）
    const hangDoor=box(HW*0.8, HH*0.85, 0.05, doorMetalMat, 0.2, HH*0.45, 0.18);
    hangDoor.rotation.set(0.12, 0.0, -0.22);     // 向外+向下歪，岌岌可危
    g.add(hangDoor);
    // 井道口的黄黑警戒条（地面那条，警示「别靠近」）
    for(let i=0;i<5;i++){const stripe=box(0.16,0.02,0.5, i%2?new THREE.MeshStandardMaterial({color:0x1a1a1a,roughness:0.8}):new THREE.MeshStandardMaterial({color:0xffce1f,roughness:0.7}), -HW/2+0.08+i*0.18,0.012,0.4); g.add(stripe);}
    return g;
  }
  const shaft=buildShaftHole();
  place(shaft, 1.95, 0, -RD/2+0.32);             // 电梯东侧紧挨着

  // ===========================================================================
  // 6) 楼层按钮面板（电梯门右侧墙上）—— 微微自发光的数字 box
  //    设计思路：就是电梯门口那块「上/下呼梯 + 楼层数字」的金属按钮板。地震后面板裂开，
  //    部分按钮还亮着暖黄光（emissive 自发光），部分灭了。裂纹用一道黑缝表现。
  // ===========================================================================
  function buildButtonPanel(){
    const g=new THREE.Group();
    // 金属底板
    g.add(box(0.42,0.95,0.05, metalMat, 0,0,0));
    // 裂痕：一道斜黑缝（面板被震裂）
    const crack=box(0.46,0.012,0.06, new THREE.MeshBasicMaterial({color:0x0a0a0c}), 0,0.1,0.03); crack.rotation.z=0.5; g.add(crack);
    // 上行/下行三角按钮（圆 box，一个还亮）
    const up=cyl(0.06,0.06,0.03, btnGlowMat,18); up.rotation.x=Math.PI/2; up.position.set(0,0.34,0.04); g.add(up);
    const dn=cyl(0.06,0.06,0.03, glassDark,18);  dn.rotation.x=Math.PI/2; dn.position.set(0,0.18,0.04); g.add(dn);  // 下行灭了
    // 楼层数字小灯（2 列 ×4 行的小方按钮，随机几个亮、几个灭）
    for(let r=0;r<4;r++)for(let cN=0;cN<2;cN++){
      const onB=Math.random()<0.45;             // 不到一半还亮（多数灭=断电感）
      const b=box(0.1,0.1,0.03, onB?btnGlowMat:glassDark, -0.08+cN*0.16, -0.05-r*0.16, 0.04);
      g.add(b);
      g.add(box(0.13,0.13,0.02, plasticDark, -0.08+cN*0.16, -0.05-r*0.16, 0.02)); // 按钮黑框
    }
    return g;
  }
  const panel=buildButtonPanel();
  panel.rotation.z=0.02;                          // 面板轻微歪斜
  // 摆在电梯门右框(右缘≈0.96)和东侧井道口(左缘≈1.45)之间的墙面空档，x=1.2 居中不打架，贴北墙
  place(panel, 1.2, 1.35, -RD/2+0.35);

  // ===========================================================================
  // 7) 墙上「地震时禁止乘梯」红色警示牌（西墙，醒目大牌子）—— 科普核心
  //    挂在西墙人视线高度，正对玩家进门后的左手边，配一盏弱灯专门照它（确保可读）。
  // ===========================================================================
  function buildWarningSign(){
    const g=new THREE.Group();
    // 牌面（宽 1.5 高 0.94，比例 512:320，和纹理一致）
    g.add(box(1.5,0.94,0.04, signMat, 0,0,0.03));
    // 金属边框（让牌子从墙上立体跳出）
    g.add(box(1.58,1.02,0.04, chromeMat, 0,0,0));
    // 两颗固定螺栓（细节）
    g.add(cyl(0.03,0.03,0.06, darkMetal,10).translateX(-0.68).translateY(0.4));
    return g;
  }
  const sign=buildWarningSign();
  sign.rotation.y=Math.PI/2;                      // 转 90° 让牌面朝向房间内（贴西墙）
  sign.rotation.z=0.015;                          // 极轻微歪（地震晃过，但仍清晰可读）
  place(sign, -RW/2+0.08, 1.75, -1.4);            // 西墙偏北，离地 1.75m（抬头正对）

  // ===========================================================================
  // 8) 等候长椅（东墙，靠墙摆，不挡道）
  //    长椅 = 木座面 + 靠背 + 4 条金属腿。地震后被推歪、一头翘起。
  // ===========================================================================
  function buildBench(){
    const g=new THREE.Group();
    const L=1.8, seatH=0.45;
    g.add(box(L,0.08,0.42, woodSeat, 0,seatH,0));               // 座面
    g.add(box(L,0.35,0.06, woodSeat, 0,seatH+0.21,-0.18));      // 靠背
    // 4 条金属腿
    for(const sx of[-L/2+0.12,L/2-0.12])for(const sz of[-0.16,0.16]){
      g.add(box(0.05,seatH,0.05, darkMetal, sx,seatH/2,sz));
    }
    return g;
  }
  const bench=buildBench();
  bench.rotation.y=-Math.PI/2;                    // 靠背贴东墙（座面朝房间内）
  bench.rotation.z=0.05;                          // 轻微歪（被震推）
  place(bench, RW/2-0.45, 0, 1.2);

  // ===========================================================================
  // 9) 消防栓（西南墙角，红色 box）—— 楼层标配的安全设施
  //    消防栓 = 红色铁箱 + 玻璃门 + 内部盘卷的水带（cylinder）+ 顶部红警示灯。
  // ===========================================================================
  function buildHydrant(){
    const g=new THREE.Group();
    g.add(box(0.5,0.7,0.22, redMat, 0,0,0));                            // 红箱体
    g.add(box(0.42,0.6,0.03, new THREE.MeshStandardMaterial({color:0x6a2018,roughness:0.5,metalness:0.3}), 0,0,0.11)); // 箱门(暗红)
    g.add(box(0.36,0.5,0.01, new THREE.MeshStandardMaterial({color:0x9cc2df,roughness:0.1,metalness:0.1,transparent:true,opacity:0.4}), 0,0,0.13)); // 玻璃观察窗
    // 内部盘卷的水带（一圈红色 cylinder）
    const hose=cyl(0.13,0.13,0.16, new THREE.MeshStandardMaterial({color:0x8a1c14,roughness:0.8}),18); hose.rotation.x=Math.PI/2; hose.position.set(0,0,0.05); g.add(hose);
    g.add(cyl(0.05,0.05,0.18, glassDark,14).translateZ(0.05)); // 中间黑芯
    // 白色「消火栓」标牌（小白 box）
    g.add(box(0.3,0.1,0.02, new THREE.MeshStandardMaterial({color:0xf0f0ec,roughness:0.7}), 0,0.42,0.11));
    // 顶部红警示灯（自发光）
    const top=cyl(0.05,0.05,0.06, litRedMat,12); top.position.set(0,0.42,0); g.add(top);
    return g;
  }
  const hydrant=buildHydrant();
  place(hydrant, -RW/2+0.35, 0.7, 2.6);           // 西南角，离地 0.7m（挂墙高度）

  // ===========================================================================
  // 10) 地震破败：掉落的天花板碎块 + 散落小石屑 + 墙面掉灰暗斑
  //     设计思路：电梯厅是水泥+金属硬装，地震后顶板会塌、瓷砖会掉。在天花板偏中处开个
  //     缺口，下方落一摊大碎块，再撒一批小石屑铺地，给足「这地方刚被震过」的狼藉感。
  // ===========================================================================
  // 天花板缺口（一块更暗的凹陷板，露出楼层结构层）
  add(box(1.3,0.05,1.1, debrisMat, -1.2,RH-0.06,1.0), 0,0,0);
  // 几根从缺口斜垂下的钢筋
  for(let i=0;i<4;i++){const rebar=box(0.03,0.5+Math.random()*0.4,0.03, darkMetal, -1.5+i*0.22,RH-0.5,1.0+(Math.random()-0.5)*0.6); rebar.rotation.set((Math.random()-0.5)*0.6,0,(Math.random()-0.5)*0.8); add(rebar,0,0,0);}
  // 地上一摊塌落的大碎块
  const bigChunks=[[0.5,0.18,0.4],[0.4,0.22,0.5],[0.35,0.15,0.3],[0.45,0.2,0.35]];
  for(let i=0;i<bigChunks.length;i++){const ch=box(bigChunks[i][0],bigChunks[i][1],bigChunks[i][2], debrisMat, -1.6+i*0.4,bigChunks[i][1]/2,1.0+(Math.random()-0.5)*0.7); ch.rotation.set(Math.random()*0.6,Math.random()*3,Math.random()*0.6); add(ch,0,0,0);}

  // 散落小石屑（地震狼藉的地面层，避开门洞中央那条进出通道）
  const debrisGrp=new THREE.Group();
  for(let i=0;i<50;i++){
    const s=0.04+Math.random()*0.12;
    const shade=0.5+Math.random()*0.3;
    const m=new THREE.Mesh(new THREE.BoxGeometry(s,s*(0.4+Math.random()*0.6),s*(0.6+Math.random()*0.8)), new THREE.MeshStandardMaterial({color:new THREE.Color(shade,shade,shade*0.98),roughness:0.96}));
    // 撒满地面，但躲开「门洞中央那条进出通道」(x∈[-0.7,0.7] 且 z>1.8 留空)，免得太堵
    let px,pz; do{px=(Math.random()-0.5)*(RW-0.8); pz=(Math.random()-0.5)*(RD-0.8);}while(Math.abs(px)<0.7 && pz>1.8);
    m.position.set(px+ox, s*0.4, pz+oz);
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    m.castShadow=m.receiveShadow=true;
    debrisGrp.add(m);
  }
  scene.add(debrisGrp);

  // 墙面掉灰泥露出的暗斑（贴东墙，破败感）
  const patchMat=new THREE.MeshStandardMaterial({color:0x70726f,roughness:1});
  add(box(0.02,1.0,0.8,patchMat, RW/2-0.16,1.8,-1.0), 0,0,0);
  add(box(0.02,0.5,0.5,patchMat, RW/2-0.16,1.2,1.8), 0,0,0);

  // ===========================================================================
  // 11) 灯光（铁律 2：只用有位置的 PointLight，绝不加全局光）
  //     电梯厅氛围 = 冷调金属底色 + 暖灯当主光给焦点 + 应急灯一抹红光（不祥+冷暖对比）。
  //     主基调仍是暖橙（和全屋统一），别让红/冷光占主导。
  // ===========================================================================
  // 主暖灯（吸顶，照亮房间中部 + 电梯门）—— 暖橙 0xffd9a0
  const lamp1=new THREE.PointLight(0xffd9a0, 3.0, 9, 2);
  lamp1.position.set(0+ox, RH-0.35, 0.3+oz);
  scene.add(lamp1);
  // 次暖灯（专门照西墙的警示牌，确保「禁止乘梯」那行字看得清——科普可读性关键）
  const lamp2=new THREE.PointLight(0xffd9a0, 1.9, 6, 2);
  lamp2.position.set(-RW/2+1.3+ox, 1.9, -1.4+oz);
  scene.add(lamp2);
  // 应急灯红光（贴电梯上方，很弱，制造「停电应急/危险」的不祥气氛 + 冷暖对比）
  const emRed=new THREE.PointLight(0xff5038, 1.0, 4.5, 2);
  emRed.position.set(0+ox, RH-0.4, -RD/2+0.7+oz);
  scene.add(emRed);

  // ===========================================================================
  // 12) 返回房间外壳材质，供集成处的 ground()/wallB() 复用（玩家踩的地/撞的墙=同质感）
  // ===========================================================================
  return {floorMat, wallMat, ceilMat};
}
