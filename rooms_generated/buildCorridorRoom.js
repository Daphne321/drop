// 楼道楼梯间 —— 余震·DROP 支线探索房间。零外部文件、零 addons、零全局光。
// =============================================================================
// 这个文件是干什么的：
//   给地震逃生游戏 game_v3.html 造一间「楼道/楼梯间」支线房间。玩家从主逃生路
//   旁的一道门走进来，看到信箱墙、电表箱、堆放的自行车、灭火器、应急灯、半堵通道
//   的杂物，以及地震震下来的天花板碎块。整个房间用「水泥裸墙 + 冷调应急灯」的破败
//   氛围，把一条救命常识焊进场景：逃生通道堆杂物 = 地震时会堵死你的逃生路。
//
// 怎么用（集成）：
//   在 game_v3.html 的某面墙上开一个门洞，然后调一次：
//     const corr = buildCorridorRoom(scene, THREE, OX, OZ);
//   其中 (OX,OZ) 是这间房在世界坐标里的「房间中心」放置点。本函数内部所有家具
//   都先按「房间自己以 (0,0) 为中心」摆好，最后统一 +ox/+oz 平移过去——所以你只
//   要把房间中心对准门洞外的空地即可。
//   返回 {floorMat, wallMat, ceilMat}：把它们传给 game_v3 的 ground()/wallB()，
//   让玩家踩的地、撞的墙和房间本身是同一套水泥质感（视觉连续）。
//
// ⚠️ 操作注意事项（5 条铁律，违反必翻车）：
//   1) 零外部文件：所有质感用 <canvas> 现画，几何全程序化 box/cylinder 拼，不引
//      任何图片/模型/CDN/addons。
//   2) 绝不加全局光（AmbientLight/HemisphereLight/DirectionalLight）——会照亮整栋
//      楼毁掉暗灰氛围。只用「有位置的 PointLight」照亮局部。
//   3) 材质 map 必拆包：makeConcrete() 返回的是 {map,normalMap} 打包对象，必须写
//      map: cc.map, normalMap: cc.normalMap，绝不能 map: cc（否则 .repeat.set() 崩黑屏）。
//   4) 家具靠墙摆、留门洞和走道、全部用「装饰 mesh」（不进碰撞数组），玩家能穿过。
//   5) 我（subagent）看不到渲染，只保证几何正确+比例真实+能亮，视觉由主 agent 用
//      CDP 截图把关。
//
// 房间尺寸约定：宽 RW=7（沿 x），深 RD=8（沿 z），层高 RH=3，地板顶面 y=0（和
//   game_v3 二楼地面齐平）。建议接在「走廊/客厅某面墙」上，房间往墙外侧延伸。
// =============================================================================
function buildCorridorRoom(scene, THREE, ox, oz){

  // ===========================================================================
  // 0) 房间尺寸常量
  //    把房间想象成一个长方形盒子，我们先在「以盒子中心为原点」的小坐标系里建模，
  //    最后所有东西统一 +ox/+oz 搬到世界里去。这样建模时只用关心相对位置，省心。
  // ===========================================================================
  const RW = 7, RD = 8, RH = 3;     // 房间 宽(x) / 深(z) / 高
  const DOOR_W = 1.5;               // 门洞宽度（开在南墙正中 z=+RD/2，朝主逃生路）

  // ===========================================================================
  // 1) 程序化纹理工厂（整段从 skill 的 references/textures.md 拷进来当局部函数）
  //    放在函数内部 = 局部作用域，不会和 game_v3 全局的同名函数打架。
  // ---------------------------------------------------------------------------
  //    类比：这些函数就像「现场调漆师傅」——不进货现成贴图（守 8MB），而是当场
  //    用画笔在一张小画布上画出水泥/金属的质感，画完交给 Three.js 当材质。
  // ===========================================================================

  // 开一张正方形离屏画布（画纹理用的草稿纸）
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点：模拟落灰/颗粒感。amount=密度，lo/hi=明暗扰动范围
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 混凝土纹理（裸墙/楼板/碎块用，自带法线图）。
  // ★ 返回 {map, normalMap} 打包对象，用的时候必须拆包！★
  // 原理：先画一张带斑驳明暗+随机裂纹的灰图当颜色贴图，再由这张图的明暗坡度反推
  //      一张法线图——这样光照打上去时裂纹和颗粒会有真实的凹凸感，而不是平贴纸。
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

  // ===========================================================================
  // 2) 共享材质
  //    地/墙/顶都用混凝土（楼道就是裸水泥），各画一份独立纹理避免 repeat 互相干扰。
  //    ★ 这里就是铁律 3 的现场：写 map: cc.map 而不是 map: cc ★
  // ===========================================================================
  const ccFloor = makeConcrete(512,'#a8a8a4');
  ccFloor.map.repeat.set(2,2); ccFloor.normalMap.repeat.set(2,2);  // 地砖拉小一点，避免一张图糊满整地
  const floorMat = new THREE.MeshStandardMaterial({map:ccFloor.map, normalMap:ccFloor.normalMap, normalScale:new THREE.Vector2(0.9,0.9), roughness:0.92, metalness:0.0});

  const ccWall = makeConcrete(512,'#b6b6b2');
  const wallMat = new THREE.MeshStandardMaterial({map:ccWall.map, normalMap:ccWall.normalMap, normalScale:new THREE.Vector2(0.85,0.85), roughness:0.95, metalness:0.0, color:0xffffff});

  const ceilMat = new THREE.MeshStandardMaterial({color:0xbfbfba, roughness:1.0, metalness:0.0});

  // 纯材质（不用纹理，省内存）：金属/暗色/红色等
  const metalMat   = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7});  // 不锈钢信箱门/电表箱
  const darkMetal  = new THREE.MeshStandardMaterial({color:0x52565a, roughness:0.55, metalness:0.6});  // 深色铁件/自行车架
  const rubberMat  = new THREE.MeshStandardMaterial({color:0x161719, roughness:0.92, metalness:0.05}); // 轮胎橡胶
  const redMat     = new THREE.MeshStandardMaterial({color:0xb22a22, roughness:0.5,  metalness:0.25}); // 灭火器红
  const plasticDark= new THREE.MeshStandardMaterial({color:0x2a2c30, roughness:0.7,  metalness:0.1});  // 应急灯外壳/塑料
  const cardboard  = new THREE.MeshStandardMaterial({color:0x8a7656, roughness:0.95, metalness:0.0});  // 纸箱杂物
  const debrisMat  = new THREE.MeshStandardMaterial({color:0x9a9893, roughness:0.97, metalness:0.0});  // 掉落水泥碎块
  const glassMat   = new THREE.MeshStandardMaterial({color:0x9cc2df, roughness:0.1,  metalness:0.1, transparent:true, opacity:0.45}); // 应急灯灯罩

  // ===========================================================================
  // 3) 通用拼装 helper
  //    box()  = 造一个带阴影的 box mesh（先不入场景，留给家具组拼装）
  //    cyl()  = 造一个带阴影的圆柱 mesh（轮子/灭火器/灯罩用）
  //    place()= 把一组（Group）家具整体平移到「房间局部坐标 + 世界原点」，再入场景
  //    add()  = 把单个 mesh 按「局部坐标 +ox/+oz」直接入场景（散件用）
  //    —— 全部走 deco 语义：只 scene.add，绝不进 grounds/walls，玩家穿得过去（铁律4）。
  // ===========================================================================
  function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  function cyl(rt,rb,h,mat,seg){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||16),mat);m.castShadow=true;m.receiveShadow=true;return m;}
  function place(g,x,y,z){g.position.set(x+ox,y,z+oz);scene.add(g);return g;}
  function add(mesh,x,y,z){mesh.position.set(x+ox,y,z+oz);scene.add(mesh);return mesh;}

  // ===========================================================================
  // 4) 房间外壳：地板 / 天花板 / 四面墙（南墙留门洞）
  //    注意：外壳的「能踩的地、能撞的墙」最终由集成处用 game_v3 的 ground()/wallB()
  //    配合本函数返回的材质来添加（那样才会进碰撞数组）。这里画的外壳是「视觉本体」
  //    用 deco 语义铺上去，让房间从内部看是完整封闭的——避免和集成处碰撞体重复，
  //    我只铺天花板 + 装饰性内壁皮，地板/墙的碰撞交给集成处（见文件末尾集成说明）。
  //
  //    为简化集成、保证房间「单独看也完整」，这里仍把地板和四面墙都画出来（视觉用），
  //    集成时主 agent 决定是复用还是叠加碰撞体。
  // ===========================================================================

  // 地板（顶面 y=0：盒高 0.3，中心 y=-0.15）
  add(box(RW,0.3,RD,floorMat, 0,-0.15,0), 0,0,0);
  // 天花板（贴在 RH 高度）
  add(box(RW,0.2,RD,ceilMat, 0,RH+0.1,0), 0,0,0);

  // 四面墙（墙厚 0.3，中心高 RH/2）。南墙(z=+RD/2)开门洞通向主逃生路。
  // 北墙（z=-RD/2，整面）
  add(box(RW,RH,0.3,wallMat, 0,RH/2,-RD/2), 0,0,0);
  // 东墙（x=+RW/2，整面）
  add(box(0.3,RH,RD,wallMat, RW/2,RH/2,0), 0,0,0);
  // 西墙（x=-RW/2，整面）
  add(box(0.3,RH,RD,wallMat, -RW/2,RH/2,0), 0,0,0);
  // 南墙拆成门左段 + 门右段 + 门楣，中间留 DOOR_W 宽门洞（门洞在 x=0 正中）
  const sideW = (RW-DOOR_W)/2;                              // 门两侧各一段墙的宽度
  add(box(sideW,RH,0.3,wallMat, -(DOOR_W/2+sideW/2),RH/2,RD/2), 0,0,0);  // 门左段
  add(box(sideW,RH,0.3,wallMat,  (DOOR_W/2+sideW/2),RH/2,RD/2), 0,0,0);  // 门右段
  add(box(DOOR_W,RH-2.2,0.3,wallMat, 0,RH-(RH-2.2)/2,RD/2), 0,0,0);      // 门楣（门洞上方过梁）

  // ===========================================================================
  // 5) 家具与破败细节（全部靠墙/靠角，门洞处(z=+RD/2 附近、x≈0)和中央走道留空）
  //    建模技法：多 box/cylinder 拼结构件、加 .rotation 表现地震歪斜、撒随机散落物。
  // ===========================================================================

  // ---- 5.1 信箱墙：一排排小金属门（贴西墙内侧 x=-RW/2+0.07） ----------------
  // 类比：就是单元楼门口那一面「格子柜」，每户一个带小门的格子。
  function buildMailboxes(){
    const g=new THREE.Group();
    const COLS=4, ROWS=5;                  // 4 列 5 行 = 20 个信箱格
    const cellW=0.32, cellH=0.26, gap=0.02;
    const totalW=COLS*(cellW+gap), totalH=ROWS*(cellH+gap);
    // 背板（整面铁箱体）
    g.add(box(totalW+0.06, totalH+0.06, 0.18, metalMat, 0,0,0));
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
      const px=-totalW/2+cellW/2+c*(cellW+gap);
      const py= totalH/2-cellH/2-r*(cellH+gap);
      // 每个小门：略凸出于背板，地震后有的歪开
      const door=box(cellW,cellH,0.04, metalMat, px,py,0.10);
      if(Math.random()<0.25){door.rotation.y=(Math.random()-0.5)*0.8;}  // 1/4 的门被震开/撬开歪着
      g.add(door);
      // 投信口（细黑缝）
      g.add(box(cellW*0.6,0.015,0.05, plasticDark, px,py+cellH*0.25,0.12));
      // 小门把手/锁孔
      g.add(box(0.03,0.03,0.05, darkMetal, px+cellW*0.3,py,0.12));
    }
    return g;
  }
  const mb=buildMailboxes();
  mb.rotation.y=Math.PI/2;                 // 转 90° 让门朝向房间内（贴西墙）
  place(mb, -RW/2+0.16, 1.5, -1.6);        // 西墙偏北处，离地 1.5m（人视线高度）

  // ---- 5.2 电表箱：信箱墙旁边的灰色铁箱（贴西墙） -------------------------
  function buildMeterBox(){
    const g=new THREE.Group();
    g.add(box(0.55,0.7,0.22, metalMat, 0,0,0));                       // 箱体
    g.add(box(0.5,0.62,0.04, darkMetal, 0,0,0.12));                   // 箱门
    // 几个圆形电表表盘（小白圆 + 黑边）
    for(let i=0;i<3;i++){const dial=cyl(0.06,0.06,0.03, new THREE.MeshStandardMaterial({color:0xe8e6df,roughness:0.6}),16);dial.rotation.x=Math.PI/2;dial.position.set(-0.13+i*0.13,0.12,0.15);g.add(dial);}
    // 一束垂下的旧电线（地震晃松了）
    const wireMat=new THREE.MeshStandardMaterial({color:0x222226,roughness:0.6});
    let wy=-0.3,wa=0;for(let i=0;i<6;i++){wa+=0.3;const seg=box(0.015,0.12,0.015,wireMat,0.18,wy,0.16);seg.rotation.z=wa*0.4;g.add(seg);wy-=0.1;}
    return g;
  }
  const meter=buildMeterBox();
  meter.rotation.y=Math.PI/2;              // 门朝房间内
  meter.rotation.z=0.04;                   // 轻微歪斜（地震晃松）
  place(meter, -RW/2+0.22, 1.45, 1.0);

  // ---- 5.3 堆放的自行车：2 辆斜靠东墙（堵了半边通道，呼应科普） -----------
  // 自行车 = 两个圆轮(cylinder侧放) + 车架(几根斜 box) + 车把 + 车座。
  function buildBike(){
    const g=new THREE.Group();
    const R=0.34;                                            // 轮半径
    function wheel(x){
      const w=new THREE.Group();
      const tire=cyl(R,R,0.05, rubberMat,24); tire.rotation.x=Math.PI/2; w.add(tire);      // 外胎
      const rim =cyl(R*0.62,R*0.62,0.052, metalMat,24); rim.rotation.x=Math.PI/2; w.add(rim); // 钢圈（细一圈）
      // 几根辐条
      for(let i=0;i<6;i++){const sp=box(0.012,R*1.2,0.012, metalMat,0,0,0);sp.rotation.z=i*Math.PI/6;w.add(sp);}
      w.position.set(x,R,0);
      return w;
    }
    g.add(wheel(-0.55));                                     // 后轮
    g.add(wheel( 0.55));                                     // 前轮
    // 车架（菱形几根斜杆）
    const frame=darkMetal;
    const downTube=box(0.05,0.7,0.05,frame, -0.05,R+0.28,0); downTube.rotation.z=0.5; g.add(downTube);   // 斜下管
    const topTube =box(0.05,0.62,0.05,frame, -0.05,R+0.42,0); topTube.rotation.z=Math.PI/2-0.15; g.add(topTube); // 上管
    const seatTube=box(0.05,0.5,0.05,frame, -0.35,R+0.32,0); seatTube.rotation.z=0.25; g.add(seatTube); // 座管
    g.add(box(0.04,0.42,0.04,frame, 0.55,R+0.18,0));         // 前叉
    // 车座
    const saddle=box(0.22,0.06,0.1, plasticDark, -0.45,R+0.56,0); g.add(saddle);
    // 车把（横 box）
    const bar=box(0.04,0.04,0.42, darkMetal, 0.55,R+0.4,0); g.add(bar);
    g.add(box(0.04,0.18,0.04, darkMetal, 0.55,R+0.5,0));     // 把立
    // 脚踏（中间）
    g.add(box(0.14,0.04,0.06, plasticDark, -0.02,R-0.05,0.12));
    return g;
  }
  const bike1=buildBike();
  bike1.rotation.y=-0.25; bike1.rotation.z=0.20;             // 歪斜靠东墙（被震倒一点）
  place(bike1, RW/2-0.7, 0, -1.2);
  const bike2=buildBike();
  bike2.rotation.y=0.15; bike2.rotation.z=-0.32;             // 第二辆压着第一辆倒得更狠
  place(bike2, RW/2-0.95, 0, 0.2);

  // ---- 5.4 灭火器：红色 cylinder + 黑头 + 压力表（挂在东墙近门处，正确的安全细节） -
  function buildExtinguisher(){
    const g=new THREE.Group();
    const body=cyl(0.1,0.11,0.5, redMat,20); body.position.y=0; g.add(body);                 // 红瓶身
    const top =cyl(0.06,0.1,0.12, plasticDark,16); top.position.y=0.3; g.add(top);            // 黑色阀头
    g.add(box(0.16,0.04,0.04, darkMetal, 0,0.34,0.02));                                       // 压把
    const gauge=cyl(0.04,0.04,0.03, new THREE.MeshStandardMaterial({color:0x2c6e3a,roughness:0.5}),12); gauge.rotation.x=Math.PI/2; gauge.position.set(0.1,0.28,0.06); g.add(gauge); // 压力表（绿区=正常）
    // 喷管（黑色细 box 弯垂）
    const hose=box(0.025,0.3,0.025, plasticDark, 0.12,0.05,0.05); hose.rotation.z=0.4; g.add(hose);
    // 墙上挂架
    g.add(box(0.18,0.06,0.08, darkMetal, 0,0.12,-0.12));
    return g;
  }
  const ext=buildExtinguisher();
  place(ext, RW/2-0.32, 0.95, 2.4);        // 东墙近门处，离地约 1m（挂墙高度），方便取用=对的细节

  // ---- 5.5 应急灯：墙上的双头冷光灯（贴门楣上方，正确的安全细节 + 唯一冷光源） ----
  function buildEmergencyLight(){
    const g=new THREE.Group();
    g.add(box(0.4,0.16,0.12, plasticDark, 0,0,0));                                  // 灯体外壳
    g.add(box(0.36,0.04,0.02, redMat, 0,-0.06,0.06));                               // 红色标识条
    // 两个灯头（半透灯罩，会被一盏小 PointLight 从内部点亮）
    for(const sx of[-0.1,0.1]){const lamp=cyl(0.05,0.05,0.06, glassMat,12); lamp.rotation.x=Math.PI/2; lamp.position.set(sx,0,0.09); g.add(lamp);}
    return g;
  }
  const el=buildEmergencyLight();
  el.rotation.z=0.05;                      // 轻微歪（地震晃过）
  place(el, 0, RH-0.45, RD/2-0.25);        // 贴南墙门楣上方，灯朝房间内

  // ---- 5.6 堆放的杂物：纸箱 + 旧物，半堵走道（科普视觉核心：通道被占） -------
  function buildClutter(){
    const g=new THREE.Group();
    // 三个歪斜叠放的纸箱（地震后塌歪）
    const sizes=[[0.6,0.5,0.5],[0.5,0.45,0.55],[0.45,0.4,0.45]];
    const offs =[[0,0.25,0],[0.05,0.72,0.08],[-0.08,1.1,-0.05]];
    for(let i=0;i<3;i++){const b=box(sizes[i][0],sizes[i][1],sizes[i][2],cardboard, offs[i][0],offs[i][1],offs[i][2]); b.rotation.y=(Math.random()-0.5)*0.5; b.rotation.z=(Math.random()-0.5)*0.18; g.add(b);
      // 纸箱上的封口胶带（深色细条）
      g.add(box(sizes[i][0]*0.9,0.02,0.04, plasticDark, offs[i][0],offs[i][1]+sizes[i][1]/2,offs[i][2]));}
    // 一卷倒地的旧地毯（横 cylinder）
    const roll=cyl(0.12,0.12,0.7, new THREE.MeshStandardMaterial({color:0x6b5f52,roughness:0.95}),14); roll.rotation.z=Math.PI/2; roll.rotation.y=0.4; roll.position.set(0.5,0.12,0.5); g.add(roll);
    // 一把翻倒的旧椅子
    const chair=new THREE.Group();
    chair.add(box(0.34,0.04,0.34, darkMetal,0,0,0));
    for(const sx of[-0.14,0.14])for(const sz of[-0.14,0.14])chair.add(box(0.03,0.34,0.03,darkMetal,sx,-0.17,sz));
    chair.add(box(0.34,0.3,0.03,darkMetal,0,0.15,-0.15));
    chair.rotation.set(Math.PI/2,0.3,0.2); chair.position.set(-0.4,0.18,0.4); g.add(chair);
    return g;
  }
  const clutter=buildClutter();
  place(clutter, -1.2, 0, RD/2-1.8);       // 堆在南墙门洞内侧偏左 = 半堵逃生通道（科普靶子）

  // ---- 5.7 掉落的天花板碎块：从天花板缺口塌下来的大水泥板 + 钢筋 -------------
  // 在天花板偏北处「开一个洞」（一块更暗的凹陷板），下方地面落一摊大碎块。
  add(box(1.4,0.05,1.2, debrisMat, -1.0,RH-0.06,-1.5), 0,0,0);  // 天花板缺口边缘（露出的暗层）
  // 几根从缺口斜垂下来的钢筋
  for(let i=0;i<4;i++){const rebar=box(0.03,0.6+Math.random()*0.4,0.03, darkMetal, -1.3+i*0.25,RH-0.55,-1.5+(Math.random()-0.5)*0.6); rebar.rotation.set((Math.random()-0.5)*0.6,0,(Math.random()-0.5)*0.8); add(rebar,0,0,0);}
  // 地上一摊塌落的大碎块（几块大的）
  const bigChunks=[[0.5,0.18,0.4],[0.4,0.22,0.5],[0.35,0.15,0.3],[0.45,0.2,0.35]];
  for(let i=0;i<bigChunks.length;i++){const ch=box(bigChunks[i][0],bigChunks[i][1],bigChunks[i][2], debrisMat, -1.4+i*0.4,bigChunks[i][1]/2,-1.6+(Math.random()-0.5)*0.8); ch.rotation.set(Math.random()*0.6,Math.random()*3,Math.random()*0.6); add(ch,0,0,0);}

  // ---- 5.8 散落小碎块：撒一批小石屑（地震狼藉的地面层，避开门洞中央） --------
  const debrisGrp=new THREE.Group();
  for(let i=0;i<55;i++){
    const s=0.04+Math.random()*0.12;
    const shade=0.55+Math.random()*0.28;
    const m=new THREE.Mesh(new THREE.BoxGeometry(s,s*(0.4+Math.random()*0.6),s*(0.6+Math.random()*0.8)), new THREE.MeshStandardMaterial({color:new THREE.Color(shade,shade,shade*0.97),roughness:0.96}));
    // 撒满地面，但躲开「门洞中央那条进出通道」(x∈[-0.7,0.7] 且 z>1.5 留空)，免得太堵
    let px,pz; do{px=(Math.random()-0.5)*(RW-0.8); pz=(Math.random()-0.5)*(RD-0.8);}while(Math.abs(px)<0.7 && pz>1.5);
    m.position.set(px+ox, s*0.4, pz+oz);
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    m.castShadow=m.receiveShadow=true;
    debrisGrp.add(m);
  }
  scene.add(debrisGrp);

  // ---- 5.9 墙面掉灰泥露出的暗斑（贴北墙，破败感） --------------------------
  const patchMat=new THREE.MeshStandardMaterial({color:0x6f6a62,roughness:1});
  add(box(0.8,1.0,0.02,patchMat, 1.4,1.7,-RD/2+0.16), 0,0,0);
  add(box(0.5,0.6,0.02,patchMat, -0.4,2.0,-RD/2+0.16), 0,0,0);

  // ===========================================================================
  // 6) 灯光（铁律 2：只用有位置的 PointLight，绝不加全局光）
  //    楼道氛围 = 暖灯当主光给焦点 + 应急灯位置一抹冷光点缀（冷暖对比，更有"末日感"）。
  //    主基调仍是暖橙（和全屋统一），别让冷光占主导，否则破坏暗灰暖焦点氛围。
  // ===========================================================================
  // 主暖灯（吸顶，照亮房间中部）—— 暖橙 0xffd9a0
  const lamp1=new THREE.PointLight(0xffd9a0, 3.0, 9, 2);
  lamp1.position.set(0+ox, RH-0.35, 0.5+oz);
  scene.add(lamp1);
  // 次暖灯（偏北角，给信箱墙/碎块区一点焦点光，弱一点）
  const lamp2=new THREE.PointLight(0xffd9a0, 1.8, 7, 2);
  lamp2.position.set(-RW/2+1.2+ox, RH-0.5, -1.5+oz);
  scene.add(lamp2);
  // 应急灯位置的一抹冷光（很弱，只为点亮门口区域 + 冷暖对比，不破坏暖主调）
  const emLight=new THREE.PointLight(0xbcd2e0, 1.1, 4.5, 2);
  emLight.position.set(0+ox, RH-0.5, RD/2-0.35+oz);
  scene.add(emLight);

  // ===========================================================================
  // 7) 返回房间外壳材质，供集成处的 ground()/wallB() 复用（玩家踩的地/撞的墙=同质感）
  // ===========================================================================
  return {floorMat, wallMat, ceilMat};
}
