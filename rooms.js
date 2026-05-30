// 余震·DROP 支线房间库 —— 10 个程序化房间,由 drop-room-builder skill 批量生成。
// 每个 build<房间>(scene, THREE, ox, oz):root Group 自带视觉外壳+家具+暖灯,返回 {floorMat,wallMat,ceilMat}。
// 碰撞(grounds/walls)和门洞由 game_v3 集成代码加。THREE 由参数传入,本文件不 import。

// 房间名：厨房（Kitchen）—— 余震·DROP 地震逃生科普游戏的支线探索房间
// =============================================================================
// 这个文件是干什么的？
//   它是一台"造厨房的机器"。你给它一个场景(scene)、Three.js 本体(THREE)、以及
//   厨房要摆在世界里的哪个位置(ox,oz 两个坐标)，它就把一整间破败的地震后厨房
//   连墙带柜带散落的锅碗瓢盆，全部"程序化"地拼出来塞进场景里。
//
// 为什么叫"程序化"？
//   因为整个游戏要守 8MB 离线红线 + 禁外部 CDN —— 不能用任何图片/模型/音频文件。
//   所以这里所有的木纹、瓷砖、不锈钢质感，都是用一张看不见的画布(canvas)现画出来的，
//   所有家具都是用一堆小盒子(box)和圆柱(cylinder)拼出来的。零外部文件。
//
// 怎么用 / 接到游戏里？（给集成的主 agent 看）
//   1) 把整个函数粘进 game_v3.html（和 buildLivingRoom 做邻居）。
//   2) 调用：const KIT = buildKitchenRoom(scene, THREE, ox, oz);
//      返回的 {floorMat, wallMat, ceilMat} 给集成处的 ground()/wallB() 复用，
//      让"玩家踩的地、撞的墙"用的就是厨房自己的质感。
//   3) 在接入点的墙上开门洞 + 把厨房四面墙(除门洞那面)加进 walls[]、地板加进 grounds[]。
//      —— 这两步由集成代码做，本函数只负责"画好家具和装饰"，不碰碰撞数组。
//
// 坐标怎么平移？（关键，别搞错）
//   本函数所有物体都先按"厨房自己的原点(0,0)为房间中心"摆好，然后整体塞进一个
//   root Group，最后 root.position.set(ox,0,oz) 一次性平移到世界位置。
//   好处：房间内部坐标永远干净（以 0,0 为中心），不用每件家具都手写 +ox/+oz，不会漏。
//
// 五条铁律自检（本函数严格遵守）：
//   ① 零外部文件/零 addons：只用传入的 THREE，纹理全 canvas 现画，几何全程序化。
//   ② 绝不加全局光：只用 2 盏有位置的暖 PointLight(0xffd9a0)，不碰 Ambient/Hemi/Directional。
//   ③ 材质 map 必拆包：本房间用的纹理工厂都返回真 Texture（不是 {map,normalMap} 打包对象），
//      赋值时直接 map:tex 即可；唯独"裸墙法线"是单独算的，已正确拆开赋给 normalMap。
//   ④ 不挡逃生路：全部家具靠墙摆，门洞处(房间南侧正中)留空，且全是装饰不进碰撞。
//   ⑤ 视觉由主 agent CDP 把关：本函数只保证几何正确/比例真实/能亮，不堆黑。
// =============================================================================

export function buildKitchenRoom(scene, THREE, ox, oz){
  // ===========================================================================
  // 〇、root 容器：整个厨房的"托盘"
  //   想象成一个大托盘，先把所有东西摆在托盘上(以托盘中心为原点)，
  //   最后端起整个托盘走到世界里的 (ox,oz) 位置放下。这样内部坐标永远以 0 为中心。
  // ===========================================================================
  const root = new THREE.Group();
  root.position.set(ox, 0, oz);
  scene.add(root);

  // 厨房尺寸：宽(东西)5，深(南北)4，层高3。门洞开在南墙(z=+RD/2)正中，朝主路那侧。
  const RW = 5, RD = 4, RH = 3;

  // ===========================================================================
  // 一、程序化纹理工厂（从 skill references/textures.md 整段拷进来，自包含）
  //   放在函数内部当局部函数，避免和 game_v3 里 buildLivingRoom 的同名函数冲突。
  //   每个工厂 = "现画一张正方形贴图"。下面按"通用工具 → 各材质"组织。
  // ===========================================================================

  // 开一张正方形离屏 canvas（看不见的画板，画完当贴图用）
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点(落灰/颗粒感)。amount=密度，lo/hi=每个点的明暗扰动范围。
  // 类比：像往墙上随机弹一层细沙，让纯色不那么"塑料假"。
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 由灰度图反推法线图：相邻像素的明暗差 = 表面坡度 = 朝向。
  // 作用：让瓷砖缝/裂纹在灯光下有真实的凹凸阴影，而不是一张平贴纸。
  // strength 越大凹凸越强（墙 2.0 是验证过的好值）。
  function normalFromCanvas(srcCanvas,strength){const S=srcCanvas.width;const sctx=srcCanvas.getContext('2d');const src=sctx.getImageData(0,0,S,S).data;const{canvas,ctx}=makeCanvas(S);const out=ctx.createImageData(S,S);const o=out.data;const lum=(x,y)=>{x=(x+S)%S;y=(y+S)%S;const i=(y*S+x)*4;return(src[i]+src[i+1]+src[i+2])/3/255;};for(let y=0;y<S;y++){for(let x=0;x<S;x++){const dx=(lum(x-1,y)-lum(x+1,y))*strength;const dy=(lum(x,y-1)-lum(x,y+1))*strength;const len=Math.sqrt(dx*dx+dy*dy+1);const i=(y*S+x)*4;o[i]=(dx/len*0.5+0.5)*255;o[i+1]=(dy/len*0.5+0.5)*255;o[i+2]=(1/len*0.5+0.5)*255;o[i+3]=255;}}ctx.putImageData(out,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;}

  // 递归裂纹（地震破败的灵魂细节）：一条主裂缝随机抖动前进，偶尔分叉出小裂缝。
  function drawCracks(ctx,S,count){for(let k=0;k<count;k++){let x=Math.random()*S,y=Math.random()*S*0.5;let angle=Math.PI/2+(Math.random()-0.5);let w=2.2;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);const steps=30+Math.floor(Math.random()*30);for(let i=0;i<steps;i++){angle+=(Math.random()-0.5)*0.6;x+=Math.cos(angle)*(6+Math.random()*8);y+=Math.sin(angle)*(6+Math.random()*8);ctx.lineTo(x,y);if(Math.random()<0.15){let bx=x,by=y,ba=angle+(Math.random()-0.5)*1.6;ctx.lineWidth=w*0.5;for(let j=0;j<8;j++){ba+=(Math.random()-0.5)*0.6;bx+=Math.cos(ba)*5;by+=Math.sin(ba)*5;ctx.lineTo(bx,by);}ctx.moveTo(x,y);ctx.lineWidth=w;}}ctx.stroke();}}

  // —— 瓷砖纹理（厨房墙地专用）——
  // 画法：先铺缝隙底色 → 一格格画浅色瓷砖(四周留缝) → 偏下方撒霉斑 → 随机几片暗砖(掉了/裂了)。
  // 返回真 Texture（不是打包对象），所以下面赋值直接 map:tex 即可。
  function tileTexture(base='#e8e6e0',gap='#9a968c',cell=64){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=gap;ctx.fillRect(0,0,S,S);
    for(let y=0;y<S;y+=cell)for(let x=0;x<S;x+=cell){ctx.fillStyle=base;ctx.fillRect(x+1.5,y+1.5,cell-3,cell-3);}
    for(let i=0;i<10;i++){const x=Math.random()*S,y=S*0.55+Math.random()*S*0.45;const g=ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*40);g.addColorStop(0,'rgba(70,80,70,0.18)');g.addColorStop(1,'rgba(70,80,70,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}
    ctx.fillStyle='rgba(60,58,52,0.5)';for(let k=0;k<3;k++){const gx=Math.floor(Math.random()*S/cell)*cell;const gy=Math.floor(Math.random()*S/cell)*cell;ctx.fillRect(gx+1.5,gy+1.5,cell-3,cell-3);}
    sprinkleNoise(ctx,S,0.3,-10,10);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // —— 木纹（橱柜、餐边柜）——
  // 画法：底色 → 横向画一堆轻微抖动的木理线 → 几团高光斑 → 撒噪点。
  function woodTexture(base){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.strokeStyle='rgba(70,58,46,0.3)';ctx.lineWidth=1.5;for(let i=0;i<24;i++){ctx.beginPath();let y=Math.random()*S;ctx.moveTo(0,y);for(let x=0;x<=S;x+=16){y+=(Math.random()-0.5)*8;ctx.lineTo(x,y);}ctx.stroke();}for(let i=0;i<10;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,25+Math.random()*40);g.addColorStop(0,'rgba(200,196,186,0.28)');g.addColorStop(1,'rgba(200,196,186,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.35,-12,12);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // ===========================================================================
  // 二、共享材质（★材质 map 拆包铁律★）
  //   tileTexture/woodTexture 都返回"真 Texture"，所以可以直接 map:tex。
  //   只有"墙的法线图"是另算的——已正确赋给 normalMap，没有把打包对象整个塞进 map。
  // ===========================================================================
  const wallTex   = tileTexture('#e8e6e0','#9a968c');                 // 厨房暖白瓷砖墙
  const wallNorm  = normalFromCanvas(wallTex.image, 2.0);             // 由瓷砖图反推的凹凸(让砖缝有阴影)
  wallTex.repeat.set(2,1.2); wallNorm.repeat.set(2,1.2);
  const wallMat   = new THREE.MeshStandardMaterial({map:wallTex, normalMap:wallNorm, normalScale:new THREE.Vector2(0.8,0.8), roughness:0.92, metalness:0.0, color:0xffffff});

  const floorTex  = tileTexture('#cdcabf','#7d7a72', 80);            // 地板瓷砖(比墙略深略大格)
  const floorNorm = normalFromCanvas(floorTex.image, 2.2);
  floorTex.repeat.set(2.5,2); floorNorm.repeat.set(2.5,2);
  const floorMat  = new THREE.MeshStandardMaterial({map:floorTex, normalMap:floorNorm, normalScale:new THREE.Vector2(0.7,0.7), roughness:0.85, metalness:0.0});

  const ceilMat   = new THREE.MeshStandardMaterial({color:0xdeded8, roughness:1});                  // 天花板(纯色哑光)
  const woodMat   = new THREE.MeshStandardMaterial({map:woodTexture('#a39788'), roughness:0.82, metalness:0.04}); // 木橱柜门(浅木)
  const counterMat= new THREE.MeshStandardMaterial({color:0x2b2b30, roughness:0.4, metalness:0.15}); // 深石英台面
  const metalMat  = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7}); // 不锈钢/水龙头/把手
  const chromeMat = new THREE.MeshStandardMaterial({color:0xc8ccd0, roughness:0.2,  metalness:0.9}); // 亮面金属(冰箱面/灶头)
  const screenMat = new THREE.MeshStandardMaterial({color:0x0d0f12, roughness:0.25, metalness:0.3}); // 抽油烟机/微波黑面板
  const blackMat  = new THREE.MeshStandardMaterial({color:0x16171a, roughness:0.6, metalness:0.2});  // 灶台黑玻璃/燃气软管
  const whiteMat  = new THREE.MeshStandardMaterial({color:0xe6e3da, roughness:0.6, metalness:0.05}); // 碎盘子/白瓷
  const fireMat   = new THREE.MeshStandardMaterial({color:0xd23b2a, roughness:0.5, metalness:0.1, emissive:0x6e1208, emissiveIntensity:0.4}); // 燃气阀手轮(警示红)

  // ===========================================================================
  // 三、几何工具：box / cyl —— 拼家具的两块"积木"
  //   box：带阴影的长方体；cyl：带阴影的圆柱(灶头/锅/瓶罐用)。
  //   都只"返回 Mesh 不直接 add"，由各家具的 Group 拼好后整体加进 root。
  // ===========================================================================
  function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  function cyl(rt,rb,h,mat,x,y,z,seg=18){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  // add：把拼好的家具组(或单个 mesh)放进 root 托盘。x,y,z 是"房间内部坐标"(以房间中心为原点)。
  function add(obj,x,y,z){obj.position.set(x,y,z);root.add(obj);return obj;}

  // ===========================================================================
  // 四、房间外壳：地板 + 四面墙 + 天花板 + 南墙门洞
  //   注意：外壳这里只画"看得见的盒子"，让房间有四面墙的封闭感。
  //   真正让玩家"踩得住、撞得到"的碰撞，由集成代码用 ground()/wallB() 另加
  //   （集成时复用本函数返回的 floorMat/wallMat/ceilMat）。
  //   坐标系：房间中心(0,0,0)；东西=x∈[-2.5,2.5]，南北=z∈[-2,2]，门洞在 z=+2(南墙)正中。
  // ===========================================================================
  // 地板(顶面 y=0，盒高 0.3 → 中心 y=-0.15，和 game_v3 二楼地面齐平)
  add(box(RW, 0.3, RD, floorMat, 0,0,0), 0, -0.15, 0);
  // 天花板(顶贴 RH)
  add(box(RW, 0.2, RD, ceilMat, 0,0,0), 0, RH-0.1, 0);
  // 北墙(z=-2，整面，厨柜全靠这面)
  add(box(RW, RH, 0.2, wallMat, 0,0,0), 0, RH/2, -RD/2);
  // 东墙(x=+2.5，冰箱靠这面)
  add(box(0.2, RH, RD, wallMat, 0,0,0), RW/2, RH/2, 0);
  // 西墙(x=-2.5)
  add(box(0.2, RH, RD, wallMat, 0,0,0), -RW/2, RH/2, 0);
  // 南墙：拆成"门左段 + 门右段 + 门楣"，正中留 1.4 宽门洞(玩家从这进出)
  const DOORW = 1.4;                                   // 门洞净宽
  const segW  = (RW - DOORW)/2;                         // 门两侧每段墙宽 = (5-1.4)/2 = 1.8
  add(box(segW, RH, 0.2, wallMat, 0,0,0), -(DOORW/2+segW/2), RH/2, RD/2); // 门左段
  add(box(segW, RH, 0.2, wallMat, 0,0,0),  (DOORW/2+segW/2), RH/2, RD/2); // 门右段
  add(box(DOORW, RH-2.2, 0.2, wallMat, 0,0,0), 0, RH-(RH-2.2)/2, RD/2);   // 门楣(门洞上方那条横墙)

  // ===========================================================================
  // 五、家具：全部靠墙摆 + 全是装饰(在 root 里，不进 walls[]/grounds[])
  //   主体一字排开靠"北墙"(z≈-1.6)：下橱柜 → 灶台 → 水槽 → 抽油烟机/吊柜。冰箱靠东墙。
  //   留出门洞(南侧 z=+2)和中间走道，玩家能穿进来探索不被卡。
  // ===========================================================================

  // —— 5.1 下橱柜 + 石英台面 + 上吊柜（沿北墙一整排）——
  // 下橱柜：一长条柜体，再贴几扇木柜门(中间夹细缝当门缝)，顶上压一块深色石英台面。
  function buildCabinetRun(){
    const g=new THREE.Group();
    const runW=3.4;                                       // 这排柜子总宽
    g.add(box(runW,0.85,0.6, woodMat, 0,0.425,0));        // 柜体(高0.85)
    // 柜门：4 扇，等分贴在正面(z=+0.31)
    for(let i=0;i<4;i++){const dw=runW/4-0.05;const dx=-runW/2+dw/2+0.025+i*(runW/4);
      const door=box(dw,0.72,0.02, woodMat, dx,0.45,0.31);g.add(door);
      g.add(box(0.03,0.12,0.03, metalMat, dx+dw/2-0.06,0.45,0.33)); // 竖把手
    }
    g.add(box(runW+0.06,0.05,0.66, counterMat, 0,0.875,0)); // 石英台面(略出檐)
    return g;
  }
  add(buildCabinetRun(), -0.8, 0, -RD/2+0.45);

  // 上吊柜：挂在北墙高处。其中最右一扇"门歪开"(rotation.y)——地震甩开的破败感。
  function buildUpperCabinet(){
    const g=new THREE.Group();const runW=2.4;
    g.add(box(runW,0.7,0.35, woodMat, 0,0,0));            // 吊柜体
    // 三扇门，左两扇正常关，最右一扇用一个子 Group 绕左铰链甩开
    for(let i=0;i<2;i++){const dw=runW/3-0.04;const dx=-runW/2+dw/2+0.02+i*(runW/3);g.add(box(dw,0.62,0.02, woodMat, dx,0,0.18));}
    const hinge=new THREE.Group();                        // 铰链点放在门的左边缘
    const dw=runW/3-0.04;const hingeX=runW/2-runW/3+0.02;
    hinge.position.set(hingeX,0,0.18);
    const swung=box(dw,0.62,0.02, woodMat, dw/2,0,0);swung.castShadow=swung.receiveShadow=true;
    hinge.add(swung);hinge.rotation.y=-1.1;               // 门朝外甩开约 63°
    g.add(hinge);
    return g;
  }
  add(buildUpperCabinet(), -0.8, 1.9, -RD/2+0.32);

  // —— 5.2 灶台（box 台 + 4 个 cylinder 灶头 + 黑玻璃面）——
  // 这是科普核心区：灶台旁会埋"燃气总阀"。
  function buildStove(){
    const g=new THREE.Group();
    g.add(box(0.9,0.05,0.6, blackMat, 0,0.9,0));          // 黑玻璃灶面(压在台面上)
    // 4 个灶头：圆环托盘 + 中心喷嘴，2x2 排布
    const pos=[[-0.22,-0.13],[0.22,-0.13],[-0.22,0.13],[0.22,0.13]];
    for(const [px,pz] of pos){
      g.add(cyl(0.11,0.11,0.012, chromeMat, px,0.93,pz,20)); // 灶头圆盘
      g.add(cyl(0.05,0.06,0.05, blackMat, px,0.955,pz,16));  // 中心喷嘴
    }
    // 两个旋钮(前沿)
    g.add(cyl(0.03,0.03,0.03, metalMat, -0.2,0.905,0.28,12).rotateX(Math.PI/2));
    g.add(cyl(0.03,0.03,0.03, metalMat,  0.2,0.905,0.28,12).rotateX(Math.PI/2));
    return g;
  }
  add(buildStove(), 1.0, 0, -RD/2+0.45);

  // —— 5.3 水槽 + 水龙头（不锈钢内凹 + 金属龙头）——
  function buildSink(){
    const g=new THREE.Group();
    g.add(box(0.7,0.05,0.5, metalMat, 0,0.9,0));          // 水槽台沿(不锈钢)
    g.add(box(0.5,0.18,0.34, blackMat, 0,0.82,0));        // 内凹槽体(深色=往下凹的视觉)
    // 水龙头：竖管 + 弯头(rotateZ 的横管)
    g.add(cyl(0.025,0.03,0.32, metalMat, -0.18,1.05,-0.15)); // 竖管
    const spout=cyl(0.022,0.022,0.22, metalMat, 0,0,0);spout.rotation.z=Math.PI/2.4;spout.position.set(-0.1,1.18,-0.05);g.add(spout);
    return g;
  }
  add(buildSink(), 2.0, 0, -RD/2+0.45);

  // —— 5.4 抽油烟机（斜 box + 黑面板，挂在灶台正上方）——
  function buildHood(){
    const g=new THREE.Group();
    const body=box(0.95,0.18,0.55, metalMat, 0,0,0);body.rotation.x=-0.18;g.add(body); // 斜罩
    g.add(box(0.85,0.04,0.45, screenMat, 0,-0.06,0.06));  // 底部黑滤网面
    g.add(box(0.3,0.5,0.18, metalMat, 0,0.3,-0.18));      // 上方排烟管
    return g;
  }
  add(buildHood(), 1.0, 2.0, -RD/2+0.4);

  // —— 5.5 冰箱（高 box + 竖把手，靠东墙）——
  function buildFridge(){
    const g=new THREE.Group();
    g.add(box(0.7,2.0,0.65, chromeMat, 0,1.0,0));         // 冰箱主体(亮面不锈钢)
    g.add(box(0.69,0.03,0.66, blackMat, 0,1.25,0));       // 冷藏/冷冻分缝
    g.add(box(0.04,0.7,0.04, metalMat, -0.3,1.65,0.34));  // 上门竖把手
    g.add(box(0.04,0.5,0.04, metalMat, -0.3,0.85,0.34));  // 下门竖把手
    g.rotation.y=Math.PI/2;                               // 转 90°让门朝向房间内(-x)
    return g;
  }
  add(buildFridge(), RW/2-0.4, 0, -1.0);

  // —— 5.6 餐边柜（矮柜，靠西墙，上面放点瓶罐）——
  function buildSideboard(){
    const g=new THREE.Group();
    g.add(box(0.5,0.8,1.2, woodMat, 0,0.4,0));
    g.add(box(0.02,0.6,0.5, woodMat, 0.26,0.42,-0.3));    // 柜门
    g.add(box(0.02,0.6,0.5, woodMat, 0.26,0.42,0.3));
    // 顶上瓶罐
    g.add(cyl(0.05,0.06,0.18, whiteMat, 0,0.89,-0.2));
    g.add(cyl(0.045,0.05,0.14, metalMat, 0,0.87,0.1));
    g.rotation.y=Math.PI/2;
    return g;
  }
  add(buildSideboard(), -RW/2+0.3, 0, 0.9);

  // ===========================================================================
  // 六、地震破败细节（歪斜 + 散落 + 危险物）—— 房间的"被震过"灵魂
  // ===========================================================================

  // —— 6.1 打翻倒扣的锅(cylinder 当锅身，扁圆柱当锅，加一根手柄)——
  function buildFallenPot(){
    const g=new THREE.Group();
    g.add(cyl(0.16,0.14,0.13, metalMat, 0,0.065,0,20));   // 锅身
    g.add(box(0.22,0.025,0.04, blackMat, 0.24,0.05,0));   // 手柄(伸出来)
    g.rotation.set(Math.PI,0.4,0);                        // 倒扣(翻过来) + 随机转个角度
    return g;
  }
  add(buildFallenPot(), 0.3, 0, 0.4);
  // 第二口小锅，斜躺在另一处
  const pot2=buildFallenPot();pot2.rotation.set(Math.PI*0.8,1.2,0.3);add(pot2,-1.4,0.1,0.6);

  // —— 6.2 碎盘子(白瓷小 box，扁平随机散落在水槽/灶台前的地上)——
  for(let i=0;i<14;i++){
    const s=0.06+Math.random()*0.1;
    const shard=box(s,0.01,s*(0.5+Math.random()*0.6), whiteMat, 0,0,0);
    shard.rotation.set((Math.random()-0.5)*0.5, Math.random()*3, (Math.random()-0.5)*0.5);
    add(shard, 1.4+(Math.random()-0.5)*1.8, 0.006, 0.2+(Math.random()-0.5)*1.4);
  }

  // —— 6.3 燃气软管垂下(从灶台后墙根垂到地，黑色细管，地震拽脱的)——
  // 用几节短圆柱串成一条往下垂、末端弯到地面的软管。
  function buildGasHose(){
    const g=new THREE.Group();
    let py=0.85, pz=-RD/2+0.62, px=1.45;                   // 起点：灶台后方墙根
    let ang=0;
    for(let i=0;i<7;i++){
      const seg=cyl(0.018,0.018,0.16, blackMat, 0,0,0,8);
      seg.position.set(px, py, pz);
      seg.rotation.z=ang; ang+=0.22;                        // 越往下越往外弯，模拟垂落
      g.add(seg);
      py-=0.12; pz+=0.05;
    }
    return g;
  }
  add(buildGasHose(), 0, 0, 0);

  // —— 6.4 散落小杂物(餐具/碎块，撒一批，避开门洞通道 z>1.2 那段)——
  for(let i=0;i<24;i++){
    const s=0.04+Math.random()*0.12;
    const shade=0.6+Math.random()*0.3;
    const m=new THREE.Mesh(new THREE.BoxGeometry(s, s*(0.4+Math.random()*0.6), s*(0.6+Math.random()*0.8)),
                           new THREE.MeshStandardMaterial({color:new THREE.Color(shade,shade,shade*0.97), roughness:0.95}));
    // 撒在房间内但避开正中通道(让玩家走得进来)
    let rx=(Math.random()-0.5)*(RW-1.2);
    let rz=-1.4+Math.random()*2.2;                          // 偏北侧(家具脚下)，南侧门口留空
    m.position.set(rx, s*0.4, rz);
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    m.castShadow=m.receiveShadow=true;
    add(m, m.position.x, m.position.y, m.position.z);
  }

  // —— 6.5 墙面掉瓷砖露出的暗斑(贴北墙，地震震裂掉落)——
  const patchMat=new THREE.MeshStandardMaterial({color:0x6f6a62, roughness:1});
  add(box(0.5,0.6,0.02, patchMat, 0,0,0), -1.8, 1.9, -RD/2+0.12);
  add(box(0.35,0.4,0.02, patchMat, 0,0,0), 1.7, 2.2, -RD/2+0.12);

  // ===========================================================================
  // 七、科普埋点：燃气总阀 + 警示牌（房间的灵魂，把救命知识焊进场景实物）
  //   厨房 = 地震高危区：燃气泄漏 + 明火 = 爆炸；重锅/刀具坠落；玻璃。
  //   这里在灶台旁的墙根装一个醒目的红色"燃气总阀"，并立一块警示提示。
  //   设计意图：玩家走进厨房探索，看到这个红阀门，潜意识里记住"地震先关燃气总阀"。
  // ===========================================================================
  function buildGasValve(){
    const g=new THREE.Group();
    g.add(cyl(0.05,0.05,0.25, metalMat, 0,0,0,12).rotateZ(Math.PI/2)); // 横向的燃气管
    g.add(cyl(0.04,0.04,0.12, metalMat, 0,0.08,0,12));                 // 阀体竖管
    // 红色手轮(警示色 + 微自发光，在暗灰里一眼能看见)
    const wheel=cyl(0.11,0.11,0.025, fireMat, 0,0.16,0,16);
    g.add(wheel);
    g.add(box(0.2,0.02,0.02, fireMat, 0,0.16,0));                      // 手轮辐条
    g.add(box(0.02,0.02,0.2, fireMat, 0,0.16,0));
    return g;
  }
  add(buildGasValve(), 1.0, 0.55, -RD/2+0.28);   // 装在灶台正下方墙根(逻辑：灶台进气总阀)

  // 警示牌：一块小黄牌挂在燃气阀上方墙上(用自发光让它在暗处可读)
  const signMat=new THREE.MeshStandardMaterial({color:0xe8c84a, roughness:0.6, emissive:0x4a3c08, emissiveIntensity:0.5});
  const sign=box(0.42,0.3,0.02, signMat, 0,0,0);
  // 牌面画一个简易"关阀"图标 + 文字(用 canvas 现画贴上去，零外部文件)
  (function paintSign(){
    const{canvas,ctx}=makeCanvas(256);
    ctx.fillStyle='#e8c84a';ctx.fillRect(0,0,256,256);
    ctx.strokeStyle='#1a1408';ctx.lineWidth=8;ctx.strokeRect(10,10,236,236);
    // 阀门图标(圆+十字手轮)
    ctx.strokeStyle='#1a1408';ctx.lineWidth=12;ctx.beginPath();ctx.arc(128,95,42,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(128,45);ctx.lineTo(128,145);ctx.moveTo(78,95);ctx.lineTo(178,95);ctx.stroke();
    ctx.fillStyle='#1a1408';ctx.font='bold 44px sans-serif';ctx.textAlign='center';
    ctx.fillText('地震先', 128, 185);
    ctx.fillText('关燃气阀', 128, 232);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
    sign.material=new THREE.MeshStandardMaterial({map:t, roughness:0.6, emissive:0x222018, emissiveIntensity:0.35});
  })();
  sign.rotation.z=0.04;                            // 微歪(被震过)
  add(sign, 1.0, 1.4, -RD/2+0.13);

  // ===========================================================================
  // 八、照明：2 盏有位置的暖 PointLight(0xffd9a0) —— 绝不加全局光
  //   一盏当吸顶灯照全屋，一盏压在台面上方当焦点暖光，营造"神秘暗灰+暖焦点"氛围。
  //   坐标这里直接写"房间内部坐标"，因为灯也加进 root 托盘，会随 root 一起平移到世界。
  // ===========================================================================
  function warmPoint(x,y,z,intensity,dist){const l=new THREE.PointLight(0xffd9a0,intensity,dist,2);l.position.set(x,y,z);root.add(l);return l;}
  warmPoint(0, RH-0.4, 0.2, 9, 8);          // 吸顶主灯(略偏门口侧，照亮整屋)
  warmPoint(0.6, 1.7, -RD/2+0.9, 5, 5);     // 台面/灶台上方焦点暖光(突出科普危险区)

  // 返回三种外壳材质给集成处复用(玩家踩的地、撞的墙、头顶天花用同款质感)
  return {floorMat, wallMat, ceilMat};
}

// 卫生间支线房间 —— 余震·DROP 地震逃生科普游戏的可探索小房间。
//
// 【这个文件是干什么的】
// 想象它是一台"自己造房间的机器":你只要告诉它"把房间放在世界的哪个坐标(ox,oz)",
// 它就会就地用代码画出冷白瓷砖、捏出马桶/洗手台/镜子/淋浴房/毛巾架/置物架,
// 撒上地震后的狼藉(碎镜子、漏水痕、掉砖暗斑、倒下的洗漱品),再点上两盏灯把房间照亮。
// 全程不读任何外部图片/模型/音频文件(8MB 离线红线),所有质感都是 <canvas> 现画的。
//
// 【怎么用】
//   const mats = buildBathroomRoom(scene, THREE, ox, oz);
//   // mats = {floorMat, wallMat, ceilMat} —— 拿去给 game_v3 的 ground()/wallB() 复用,
//   //   这样玩家踩的地、撞的墙就是卫生间自己的瓷砖质感,跟视觉完全一致。
//
// 【坐标约定(和 game_v3 对齐,别搞错)】
//   - 房间先以自己的原点(0,0)为中心摆好所有东西,最后统一 +ox/+oz 平移到世界位置。
//   - 二楼地面顶面 y=0(玩家站在 y=0 的地上)。地板盒中心 y=-0.15、盒高0.3,顶面正好贴 0。
//   - 房间默认尺寸:宽(x) RW=3.6,深(z) RD=3.0,层高 RH=2.6 —— 卫生间就该是小开间。
//   - 门洞默认开在南墙(+z 那面)正中,宽 1.4,方便接到走廊。集成时按需调。
//
// 【铁律自检(违反必翻车,逐条焊死)】
//   1. 零外部文件、零 addons:只用传进来的 THREE,canvas 画纹理,没有 import 任何东西。
//   2. 绝不加 AmbientLight/HemisphereLight/DirectionalLight(全局光会照亮整栋楼毁掉暗灰氛围),
//      只用有位置的 PointLight。
//   3. 材质 map 必拆包:tileTexture() 返回真 Texture 可直接用;但凡返回 {map,normalMap}
//      打包对象的,一律 map:tex.map 不是 map:tex(整包传 .repeat.set() 会崩黑屏)。
//   4. 家具全用装饰网格(只 scene.add,不进 grounds[]/walls[] 碰撞数组),靠墙摆+留门洞,不挡路。
//   5. 我(子 agent)看不到渲染,只保证几何正确、比例真实、房间能亮;最终视觉由主 agent CDP 把关。
export function buildBathroomRoom(scene, THREE, ox, oz){
  // ========================================================================
  // 0) 程序化纹理工厂 —— 从 skill 的 textures.md 整段拷进来,放函数内部当局部函数,
  //    避免和别的房间(也拷了同名函数)在全局打架。8MB 红线:这些全是 canvas 现画,零图片。
  // ========================================================================

  // 开一张正方形离屏画布(像一块空白瓷砖,等着我们往上画花纹)
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点 —— 模拟落灰/颗粒感。amount=多密,lo/hi=每个点明暗扰动的范围。
  // 没有噪点的纯色面会显得"塑料假",撒一层噪点立刻有"旧脏"的真实感。
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 由灰度图反推法线图:看相邻像素谁亮谁暗,亮暗差就是"坡度",坡度决定表面朝哪。
  // 类比:闭眼用手摸墙,凹凸不平的地方手感不同 —— 法线图就是给光照"摸"出这种凹凸,
  // 让砖缝/裂纹在灯光下有真实的立体阴影,而不是一张平贴纸。strength 越大凹凸越猛。
  function normalFromCanvas(srcCanvas,strength){const S=srcCanvas.width;const sctx=srcCanvas.getContext('2d');const src=sctx.getImageData(0,0,S,S).data;const{canvas,ctx}=makeCanvas(S);const out=ctx.createImageData(S,S);const o=out.data;const lum=(x,y)=>{x=(x+S)%S;y=(y+S)%S;const i=(y*S+x)*4;return(src[i]+src[i+1]+src[i+2])/3/255;};for(let y=0;y<S;y++){for(let x=0;x<S;x++){const dx=(lum(x-1,y)-lum(x+1,y))*strength;const dy=(lum(x,y-1)-lum(x,y+1))*strength;const len=Math.sqrt(dx*dx+dy*dy+1);const i=(y*S+x)*4;o[i]=(dx/len*0.5+0.5)*255;o[i+1]=(dy/len*0.5+0.5)*255;o[i+2]=(1/len*0.5+0.5)*255;o[i+3]=255;}}ctx.putImageData(out,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;}

  // 瓷砖纹理:先铺一层缝隙底色,再一格格画上瓷砖(留缝),然后压霉斑(偏下,模拟水汽霉变),
  // 再随机抹黑几格表示"掉了/裂了的瓷砖",最后撒噪点。这是卫生间冷白墙地的灵魂。
  function tileTexture(base='#dfe6e6',gap='#8a9090',cell=64){const S=512;const{canvas,ctx}=makeCanvas(S);
    ctx.fillStyle=gap;ctx.fillRect(0,0,S,S);                                                  // 缝隙底色铺满
    for(let y=0;y<S;y+=cell)for(let x=0;x<S;x+=cell){ctx.fillStyle=base;ctx.fillRect(x+1.5,y+1.5,cell-3,cell-3);}  // 一格格瓷砖,四周留 1.5px 缝
    for(let i=0;i<10;i++){const x=Math.random()*S,y=S*0.55+Math.random()*S*0.45;const g=ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*40);g.addColorStop(0,'rgba(70,80,70,0.18)');g.addColorStop(1,'rgba(70,80,70,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}  // 霉斑(偏墙下,潮气从下往上)
    ctx.fillStyle='rgba(60,58,52,0.5)';for(let k=0;k<3;k++){const gx=Math.floor(Math.random()*S/cell)*cell;const gy=Math.floor(Math.random()*S/cell)*cell;ctx.fillRect(gx+1.5,gy+1.5,cell-3,cell-3);}  // 几片掉了/裂了的暗砖
    sprinkleNoise(ctx,S,0.3,-10,10);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // ========================================================================
  // 1) 房间尺寸常量 + 共享材质(★map 拆包★)
  // ========================================================================
  const RW=3.6, RD=3.0, RH=2.6;     // 宽(x) / 深(z) / 层高 —— 卫生间小开间
  const DOOR_W=1.4, DOOR_H=2.1;     // 门洞宽 / 高(开在南墙 +z 那面正中)

  // —— 墙:冷白瓷砖,带法线让砖缝有凹凸 ——
  const wallTex=tileTexture('#dfe6e6','#8a9090',64);
  const wallNormal=normalFromCanvas(wallTex.image,2.0);
  wallTex.repeat.set(2,2); wallNormal.repeat.set(2,2);   // 墙面铺 2x2 块瓷砖纹理,避免一张拉满糊成大格子
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex,normalMap:wallNormal,normalScale:new THREE.Vector2(0.7,0.7),roughness:0.9,metalness:0.0,color:0xffffff});

  // —— 地:更小格的冷白地砖,repeat 大一点让地面砖更密更细 ——
  const floorTex=tileTexture('#d6dcdc','#7e8585',48);
  const floorNormal=normalFromCanvas(floorTex.image,2.5);
  floorTex.repeat.set(3,3); floorNormal.repeat.set(3,3);
  const floorMat=new THREE.MeshStandardMaterial({map:floorTex,normalMap:floorNormal,normalScale:new THREE.Vector2(0.8,0.8),roughness:0.85,metalness:0.0});

  // —— 天花板:冷白哑光,不用纹理省开销 ——
  const ceilMat=new THREE.MeshStandardMaterial({color:0xd2d8d8,roughness:1});

  // —— 纯材质(瓷/陶/金属/玻璃,卫生间专用),不用纹理 ——
  const ceramicMat = new THREE.MeshStandardMaterial({color:0xf2f4f4, roughness:0.35, metalness:0.05});  // 马桶/洗手盆的白陶瓷,微微反光
  const ceramicDirty=new THREE.MeshStandardMaterial({color:0xe0e2df, roughness:0.55, metalness:0.04});  // 旧一点的陶瓷(水箱/底座)
  const metalMat  = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7});     // 水龙头/把手不锈钢
  const chromeMat = new THREE.MeshStandardMaterial({color:0xc8ccd0, roughness:0.2,  metalness:0.9});     // 镜框/亮面金属
  const glassMat  = new THREE.MeshStandardMaterial({color:0x9cc2df, roughness:0.1,  metalness:0.1, transparent:true, opacity:0.5});   // 淋浴隔断玻璃
  const mirrorMat = new THREE.MeshStandardMaterial({color:0xb8c6cc, roughness:0.08, metalness:0.6, transparent:true, opacity:0.7});   // 镜面(比玻璃更亮更映)
  const shardMat  = new THREE.MeshStandardMaterial({color:0xd6e2e6, roughness:0.05, metalness:0.8});     // 碎镜反光碎片
  const grimeMat  = new THREE.MeshStandardMaterial({color:0x4a5552, roughness:0.95, metalness:0.0});     // 掉砖露出的暗斑/漏水痕
  const towelMat  = new THREE.MeshStandardMaterial({color:0x9aa6a2, roughness:0.98, metalness:0.0});     // 毛巾(布感粗糙)
  const bottleA   = new THREE.MeshStandardMaterial({color:0x6fae9a, roughness:0.4,  metalness:0.1, transparent:true, opacity:0.85}); // 洗发水瓶(青绿半透)
  const bottleB   = new THREE.MeshStandardMaterial({color:0xc97b86, roughness:0.4,  metalness:0.1, transparent:true, opacity:0.85}); // 沐浴露瓶(暗粉)
  const bottleC   = new THREE.MeshStandardMaterial({color:0xd9d4c8, roughness:0.5,  metalness:0.05});                                 // 杂瓶罐(米白)

  // ========================================================================
  // 2) 几何工具:box()/cyl() 只造网格不入场景,place() 把整组家具 +ox/+oz 平移后入场景。
  //    所有家具都走 place(),所以家具只是装饰(scene.add 但不进 grounds[]/walls[]),不挡逃生路。
  // ========================================================================
  function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  // 圆柱:卫生间里水龙头、花洒杆、瓶罐、洗手盆都靠它。rt/rb=上/下半径,h=高,seg=圆滑度。
  function cyl(rt,rb,h,mat,seg){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||16),mat);m.castShadow=true;m.receiveShadow=true;return m;}
  // 把一组家具整体平移到世界坐标(房间内坐标 + ox/oz)再加进场景。这是"房间自己原点 → 世界原点"的桥。
  function place(g,x,y,z){g.position.set(x+ox,y,z+oz);scene.add(g);return g;}

  // ========================================================================
  // 3) 房间外壳:地板 + 四面墙(南墙留门洞) + 天花板。
  //    注意:外壳也走 place(),只是视觉外壳;真正能踩的地/能撞的墙由集成代码用 ground()/wallB()
  //    复用返回的 floorMat/wallMat 再加一遍(那才进碰撞数组)。这里只负责"看得见"。
  // ========================================================================
  function buildShell(){
    const g=new THREE.Group();
    // 地板:中心 y=-0.15,盒高 0.3,顶面正好 y=0,和走廊地面齐平(接缝无错位才不会掉出地板)
    g.add(box(RW,0.3,RD,floorMat,0,-0.15,0));
    // 天花板:贴在层高 RH 处
    g.add(box(RW,0.2,RD,ceilMat,0,RH+0.1,0));
    // 北墙(-z 那面,实心,贴马桶+置物架)
    g.add(box(RW,RH,0.2,wallMat,0,RH/2,-RD/2));
    // 东墙(+x 那面,实心,贴淋浴房)
    g.add(box(0.2,RH,RD,wallMat,RW/2,RH/2,0));
    // 西墙(-x 那面,实心,贴洗手台+镜子)
    g.add(box(0.2,RH,RD,wallMat,-RW/2,RH/2,0));
    // 南墙(+z 那面)拆成"门左段 + 门右段 + 门楣",中间留 DOOR_W 宽门洞当进出口
    const sideW=(RW-DOOR_W)/2;                                  // 门两侧每段墙的宽度
    g.add(box(sideW,RH,0.2,wallMat,-(DOOR_W/2+sideW/2),RH/2,RD/2));  // 门左段
    g.add(box(sideW,RH,0.2,wallMat, (DOOR_W/2+sideW/2),RH/2,RD/2));  // 门右段
    g.add(box(DOOR_W,RH-DOOR_H,0.2,wallMat,0,DOOR_H+(RH-DOOR_H)/2,RD/2));  // 门楣(门洞上方那条横墙)
    return g;
  }
  place(buildShell(),0,0,0);

  // ========================================================================
  // 4) 家具(多 box/cylinder 拼,绝不一个大方块糊弄)。靠墙摆,门洞(南墙)前留空走道。
  // ========================================================================

  // —— 马桶(贴北墙东侧):底座 box + 水箱 box + 椭圆盖(压扁的 box 当盖) ——
  // 椭圆盖用一个扁 box + 轻微缩放近似,够用又便宜。整体微歪表现被震过。
  function buildToilet(){
    const g=new THREE.Group();
    g.add(box(0.42,0.42,0.55,ceramicMat,0,0.21,0));            // 底座(坐桶身)
    g.add(box(0.4,0.04,0.5,ceramicMat,0,0.43,0.02));           // 坐圈
    const lid=box(0.42,0.05,0.46,ceramicMat,0,0.47,0.02);      // 椭圆盖
    lid.rotation.x=-0.5; lid.position.z=-0.18; lid.position.y=0.55; g.add(lid);  // 盖子掀开一点(地震掀盖)
    g.add(box(0.46,0.5,0.2,ceramicDirty,0,0.55,-0.26));        // 水箱(贴墙)
    g.add(box(0.12,0.04,0.08,metalMat,0.12,0.82,-0.26));       // 水箱按钮
    g.rotation.y=0.08;                                          // 整体微歪
    return g;
  }
  place(buildToilet(),1.0,0,-1.1);

  // —— 洗手台(贴西墙):台面 box + 圆盆 cylinder(倒锥近似台上盆) + 水龙头(竖管+横嘴) + 下柜 ——
  function buildVanity(){
    const g=new THREE.Group();
    g.add(box(1.0,0.06,0.5,ceramicMat,0,0.82,0));              // 台面
    g.add(box(0.96,0.7,0.46,ceramicDirty,0,0.45,-0.01));       // 下柜柜身
    const door=box(0.46,0.62,0.02,ceramicDirty,0.25,0.45,0.22); door.rotation.y=0.4; g.add(door);  // 柜门歪开一条缝(被震松)
    g.add(box(0.46,0.62,0.02,ceramicDirty,-0.24,0.45,0.23));   // 另一扇柜门(关着)
    const basin=cyl(0.18,0.12,0.12,ceramicMat,20); basin.position.set(0,0.91,0); g.add(basin);  // 台上圆盆(上宽下窄)
    const tap=cyl(0.022,0.022,0.16,metalMat,12); tap.position.set(0,1.02,-0.12); g.add(tap);    // 水龙头竖管
    const spout=cyl(0.018,0.018,0.12,metalMat,12); spout.rotation.x=Math.PI/2.4; spout.position.set(0,1.08,-0.06); g.add(spout);  // 弯出水嘴
    return g;
  }
  place(buildVanity(),-1.35,0,-0.2);

  // —— 镜子 + chrome 框(贴西墙,洗手台上方):薄镜面板 + 四条边框。镜子已碎,加几道反光裂纹细 box ——
  function buildMirror(){
    const g=new THREE.Group();
    const W=0.7,Hh=0.9,t=0.02;
    g.add(box(W,Hh,t,mirrorMat,0,0,0));                        // 镜面主体(薄)
    // chrome 边框:上下左右四条
    g.add(box(W+0.06,0.04,t+0.02,chromeMat,0,Hh/2+0.02,0));
    g.add(box(W+0.06,0.04,t+0.02,chromeMat,0,-Hh/2-0.02,0));
    g.add(box(0.04,Hh+0.06,t+0.02,chromeMat,-W/2-0.02,0,0));
    g.add(box(0.04,Hh+0.06,t+0.02,chromeMat, W/2+0.02,0,0));
    // 碎裂:几道随机角度的反光细条,贴在镜面前一点点,表现"镜子裂了反着光"
    for(let i=0;i<7;i++){
      const cr=box(0.1+Math.random()*0.45,0.008,0.006,shardMat,(Math.random()-0.5)*0.5,(Math.random()-0.5)*0.6,0.015);
      cr.rotation.z=(Math.random()-0.5)*2.4;                   // 随机倾角,像放射状裂纹
      g.add(cr);
    }
    g.rotation.z=0.04;                                          // 镜子整体被震歪一点
    return g;
  }
  // 镜子贴西墙(x=-RW/2 内侧),y≈1.5(人眼高),用 rotation.y 让镜面朝向房间内(+x)
  const mir=buildMirror(); mir.rotation.y=Math.PI/2; place(mir,-RW/2+0.12,1.55,-0.2);

  // —— 淋浴隔断(贴东墙角):大薄玻璃板 L 形围合 + 花洒(竖管+横臂+喷头圆盘) + 接水底盘 ——
  function buildShower(){
    const g=new THREE.Group();
    g.add(box(1.0,0.06,1.0,ceramicDirty,0,0.03,0));            // 淋浴底盘(微高出地)
    // L 形玻璃隔断:一片正面、一片侧面
    const gp1=box(0.04,2.0,1.0,glassMat,0.5,1.0,0); g.add(gp1);   // 侧面玻璃(沿 z)
    const gp2=box(1.0,2.0,0.04,glassMat,0,1.0,0.5); gp2.rotation.y=0.03; g.add(gp2);  // 正面玻璃(微裂歪)
    // chrome 边框立柱
    g.add(box(0.04,2.0,0.04,chromeMat,0.5,1.0,0.5));
    g.add(box(0.04,2.0,0.04,chromeMat,-0.5,1.0,0.5));
    // 花洒:贴墙竖管 + 弯出的横臂 + 喷头圆盘
    const pipe=cyl(0.02,0.02,1.2,metalMat,12); pipe.position.set(-0.45,1.4,-0.45); g.add(pipe);
    const arm=cyl(0.018,0.018,0.3,metalMat,12); arm.rotation.z=Math.PI/2.6; arm.position.set(-0.3,1.95,-0.45); g.add(arm);
    const head=cyl(0.09,0.06,0.05,chromeMat,16); head.position.set(-0.18,1.85,-0.45); g.add(head);  // 喷头圆盘
    return g;
  }
  place(buildShower(),0.95,0,0.7);

  // —— 毛巾架(贴北墙):两根 chrome 横杆 + 搭着歪斜的毛巾 ——
  function buildTowelRack(){
    const g=new THREE.Group();
    g.add(box(0.8,0.02,0.03,chromeMat,0,0.05,0));              // 上杆
    g.add(box(0.8,0.02,0.03,chromeMat,0,-0.1,0));             // 下杆
    g.add(box(0.03,0.18,0.05,chromeMat,-0.4,-0.02,0));        // 左支座
    g.add(box(0.03,0.18,0.05,chromeMat, 0.4,-0.02,0));        // 右支座
    const towel=box(0.3,0.42,0.04,towelMat,-0.12,-0.12,0.03); towel.rotation.z=0.12; g.add(towel);  // 搭着的毛巾(歪)
    const towel2=box(0.22,0.3,0.04,towelMat,0.22,-0.05,0.03); towel2.rotation.z=-0.18; g.add(towel2);// 另一条小毛巾
    return g;
  }
  place(buildTowelRack(),-0.3,1.2,-RD/2+0.13);

  // —— 置物架 + 瓶瓶罐罐(贴北墙马桶旁):三层窄板 + 一堆小 cylinder 瓶罐(有的倒了) ——
  function buildShelf(){
    const g=new THREE.Group();
    for(let i=0;i<3;i++){g.add(box(0.5,0.02,0.18,chromeMat,0,i*0.35,0));}  // 三层玻璃/金属窄板
    g.add(box(0.02,0.7,0.02,chromeMat,-0.24,0.35,-0.08));     // 后立柱
    g.add(box(0.02,0.7,0.02,chromeMat, 0.24,0.35,-0.08));
    // 瓶罐:站着的 + 倒下的(地震后东倒西歪)
    const b1=cyl(0.035,0.04,0.16,bottleA,12); b1.position.set(-0.12,0.43,0); g.add(b1);            // 站着的洗发水
    const b2=cyl(0.035,0.04,0.14,bottleB,12); b2.rotation.z=Math.PI/2; b2.position.set(0.1,0.74,0.02); g.add(b2);  // 倒在上层的沐浴露
    const b3=cyl(0.03,0.035,0.1,bottleC,12);  b3.position.set(0.14,0.08,0.01); g.add(b3);           // 底层小罐
    const b4=cyl(0.028,0.032,0.09,bottleC,12);b4.rotation.z=1.2; b4.position.set(-0.05,0.42,0.05); g.add(b4); // 中层歪倒的罐
    return g;
  }
  place(buildShelf(),0.0,0.9,-RD/2+0.18);

  // ========================================================================
  // 5) 地震破败细节:墙面漏水痕(暗竖条) + 瓷砖掉落露暗斑 + 倒在地上的洗漱品 + 满地碎镜/碎瓷散落。
  //    这些是"被震过"的氛围灵魂,光堆家具不够,得让玩家一眼看出灾后狼藉。
  // ========================================================================

  // 漏水痕:墙上从高往低拖的暗竖条(水顺墙流下的渍)。贴各面墙内侧,薄薄一片。
  function buildWaterStains(){
    const g=new THREE.Group();
    // 西墙漏水痕(2 条)
    for(let i=0;i<2;i++){const s=box(0.06+Math.random()*0.08,1.2+Math.random()*0.5,0.01,grimeMat,0,0,0); s.material.transparent=false; s.position.set(-RW/2+0.11, RH*0.55, -0.6+i*0.9); g.add(s);}
    // 北墙漏水痕 + 掉砖暗斑
    for(let i=0;i<2;i++){const s=box(0.05+Math.random()*0.06,0.9+Math.random()*0.4,0.01,grimeMat,0,0,0); s.position.set(-0.8+i*1.4, RH*0.5, -RD/2+0.11); g.add(s);}
    return g;
  }
  place(buildWaterStains(),0,0,0);

  // 掉砖暗斑:墙上几块瓷砖掉了,露出后面的水泥暗块(贴墙内侧的小暗 box)
  function buildFallenTiles(){
    const g=new THREE.Group();
    const spots=[[-RW/2+0.11,1.8,0.3],[-RW/2+0.11,0.9,-0.9],[-0.4,2.0,-RD/2+0.11],[1.0,1.3,-RD/2+0.11]];
    for(const [x,y,z] of spots){
      const w=0.18+Math.random()*0.12, h=0.18+Math.random()*0.12;
      const s=box((z<-RD/2+0.2? w:0.02),(z<-RD/2+0.2? h:h),(z<-RD/2+0.2?0.015:w),grimeMat,0,0,0);  // 北墙朝 z、西墙朝 x,厚度方向不同
      s.position.set(x,y,z); g.add(s);
    }
    return g;
  }
  place(buildFallenTiles(),0,0,0);

  // 满地散落:碎镜片(反光小 box) + 碎瓷片 + 倒下的洗漱品。撒在门洞前以外的地面角落,不堵走道。
  function buildDebris(){
    const g=new THREE.Group();
    // 碎镜片(亮反光,集中在镜子/洗手台下方)
    for(let i=0;i<14;i++){
      const s=0.03+Math.random()*0.06;
      const m=box(s,0.006,s*0.7,shardMat,0,0,0);
      m.position.set(-1.3+Math.random()*0.7,0.02,-0.8+Math.random()*1.2);
      m.rotation.set(Math.random()*0.3,Math.random()*Math.PI,Math.random()*0.3);
      g.add(m);
    }
    // 碎瓷片(白哑光,散开一点)
    for(let i=0;i<12;i++){
      const s=0.04+Math.random()*0.06;
      const m=box(s,0.008,s,ceramicMat,0,0,0);
      m.position.set(-1.4+Math.random()*2.6,0.02,-1.2+Math.random()*1.6);
      m.rotation.set(0,Math.random()*Math.PI,(Math.random()-0.5)*0.4);
      g.add(m);
    }
    // 倒在地上的瓶子(滚出来的洗漱品)
    const fb1=cyl(0.035,0.04,0.15,bottleA,12); fb1.rotation.z=Math.PI/2; fb1.position.set(-0.6,0.04,0.5); g.add(fb1);
    const fb2=cyl(0.03,0.035,0.12,bottleB,12); fb2.rotation.set(Math.PI/2,0,0.3); fb2.position.set(-0.2,0.035,-0.6); g.add(fb2);
    return g;
  }
  place(buildDebris(),0,0,0);

  // ========================================================================
  // 6) 科普埋点(房间的灵魂):把"地震知识"做成场景里的实物,让探索本身在教救命常识。
  //    卫生间是正面知识 —— 小开间+承重墙多=相对安全躲避点,但远离镜子/玻璃/热水器。
  //    做法:① 在门内侧承重墙角放一块"绿色安全角"提示牌(站立小立牌 box,正面绿底白字纹理);
  //          ② 在镜子/淋浴玻璃旁放"红色警示牌"(远离玻璃)。两牌一绿一红形成"安全角 vs 危险物"对照。
  // ========================================================================

  // 画一块带文字的告示牌纹理(canvas 现画,零图片)。bg=底色,line1/line2=两行字。
  function signTexture(bg,fg,line1,line2){
    const W=256,Hh=160;const c=document.createElement('canvas');c.width=W;c.height=Hh;const ctx=c.getContext('2d');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,Hh);
    ctx.strokeStyle=fg;ctx.lineWidth=6;ctx.strokeRect(8,8,W-16,Hh-16);
    ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='bold 30px sans-serif';ctx.fillText(line1,W/2,Hh*0.38);
    ctx.font='20px sans-serif';ctx.fillText(line2,W/2,Hh*0.68);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
  }

  // 绿色安全角提示牌:贴在北墙(承重墙)墙角,告诉玩家"这里小开间承重多=相对安全"
  function buildSafeSign(){
    const g=new THREE.Group();
    const t=signTexture('#1e6b3a','#eafff0','小开间·承重墙多','地震相对安全躲避点');
    const board=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.32,0.02),new THREE.MeshStandardMaterial({map:t,roughness:0.7}));
    board.castShadow=true;g.add(board);
    g.add(box(0.5,0.05,0.025,chromeMat,0,-0.18,0));            // 牌底框
    return g;
  }
  const safe=buildSafeSign(); safe.rotation.y=0; place(safe,-1.2,1.7,-RD/2+0.13);

  // 红色警示牌:贴在淋浴玻璃旁,提醒"远离镜子/玻璃/热水器"(和绿牌形成正反对照)
  function buildWarnSign(){
    const g=new THREE.Group();
    const t=signTexture('#7a1f1f','#ffe8e8','⚠ 远离玻璃','镜子/淋浴房/热水器');
    const board=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.3,0.02),new THREE.MeshStandardMaterial({map:t,roughness:0.7}));
    board.castShadow=true;board.rotation.z=0.06;g.add(board);  // 牌也被震歪一点
    return g;
  }
  const warn=buildWarnSign(); warn.rotation.y=Math.PI/2; place(warn,RW/2-0.13,1.6,0.7);

  // ========================================================================
  // 7) 照明:1 盏暖橙 PointLight(0xffd9a0)给房间整体暖焦点(守暗灰氛围),
  //    + 1 盏镜前冷白 PointLight(0xeef2f6)（卫生间冷光合理,catalog 指定）。
  //    绝不用全局光。两盏都是有位置的点光,只照亮局部。
  // ========================================================================
  // 暖橙顶灯(房间中央偏门口,把进门第一眼照暖)
  const warm=new THREE.PointLight(0xffd9a0, 2.6, 7, 2);
  warm.position.set(0+ox, RH-0.3, 0.4+oz); scene.add(warm);
  // 镜前冷白灯(贴西墙镜子位置,卫生间惨白的冷光,照亮洗手台一角)
  const cold=new THREE.PointLight(0xeef2f6, 1.8, 4.5, 2);
  cold.position.set(-RW/2+0.5+ox, 1.9, -0.2+oz); scene.add(cold);

  // 返回三件套材质,给集成代码的 ground()/wallB() 复用 —— 玩家踩的地、撞的墙就用卫生间瓷砖质感。
  return {floorMat, wallMat, ceilMat};
}

// 阳台 Balcony —— 半室外支线探索房间。零外部文件、零 addons、零全局光。
//
// 【这个文件是干什么的】
//   给地震逃生游戏 game_v3.html 造一间"阳台"支线房间。玩家从某面墙的门洞走进来，
//   能看到栏杆、晾衣架、花盆、藤椅、空调外机、一地杂物——以及一块"地震别上阳台"的警示牌。
//   阳台是反面教材房间：悬挑结构地震最易塌、玻璃和高空坠物多，走进来要让玩家"隐隐觉得不该来"。
//
// 【怎么用 / 接口】
//   buildBalconyRoom(scene, THREE, ox, oz) —— 自包含函数，把整间阳台塞进传入的 scene。
//   - ox,oz = 房间在世界坐标里的放置原点。房间内部所有东西先按"自己原点(0,0)"摆好，
//             最后统一挂到一个 Group 上，对 Group 做 position.set(ox,0,oz) 一次性平移到世界位置。
//             这样集成时只要决定一个 (ox,oz) 就行，房间内部坐标永远不用改。
//   - 返回 {floorMat, wallMat, ceilMat}：给 game_v3 集成处的 ground()/wallB() 复用，
//     让玩家真正踩的地、真正撞的墙，和这间房间的视觉质感一致。
//
// 【注意事项 / 坑】
//   1. 本函数只负责"摆出几何 + 给一盏灯"，不往 game_v3 的 grounds[]/walls[] 碰撞数组里塞东西
//      （那是集成处的活）。这里所有家具都是纯装饰，玩家能穿过，绝不卡死逃生路。
//   2. 材质里凡是用程序化纹理工厂，map 一定要"拆包"——见下方注释，传错会整段崩黑屏。
//   3. 绝不加 AmbientLight/HemisphereLight/DirectionalLight（全局光会照亮整栋楼、毁掉暗灰氛围）。
//      只用有位置的 PointLight。
//
// 【自己原点约定】
//   房间地面顶面 y=0（和游戏二楼地面齐平）。房间在 x 方向宽 7（x∈[-3.5, 3.5]），
//   z 方向进深 5（z∈[-2.5, 2.5]）。门洞默认开在"内侧墙"（z=-2.5 那面，朝向室内走廊）正中。
//   栏杆/朝外的开口在 z=+2.5 那面（朝小区外侧，能露一点天光）。层高 H=3。
export function buildBalconyRoom(scene, THREE, ox, oz){

  // ============================================================
  // 0) 整间房间挂一个 Group。可以把 Group 想象成一个"托盘"——
  //    我们把所有家具先摆在托盘上（坐标都相对托盘原点），
  //    最后端起整个托盘放到世界里指定位置（ox,oz）。
  //    这样房间内部坐标永远以 (0,0) 为中心，集成时只动托盘位置一处。
  // ============================================================
  const room = new THREE.Group();
  room.position.set(ox, 0, oz);
  scene.add(room);

  // 把网格加进 room 托盘的小助手：建好一个 Mesh，开启阴影，挂到 room 上。
  // 注意所有坐标都是"相对房间原点"的，不用手动 +ox/+oz——托盘整体平移会自动带上。
  function add(geo, mat, x, y, z){
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    room.add(m);
    return m;
  }

  // 房间尺寸常量（改这里就能整体放大缩小）
  const RW = 7;     // 房间宽(x 方向)
  const RD = 5;     // 房间进深(z 方向)
  const H  = 3;     // 层高(和 game_v3 一致)

  // ============================================================
  // 1) 程序化纹理工厂（从 references/textures.md 整段拷进来，当局部函数用，
  //    避免和别的房间函数全局重名冲突）。
  //    8MB 离线红线下不能用任何图片，所有质感都用 <canvas> 现画。
  // ============================================================

  // 开一张正方形离屏 canvas（画纹理的"画布"）
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点(落灰/颗粒感)。amount=密度, lo/hi=明度扰动范围。
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 递归裂纹(地震墙裂/地裂的灵魂细节)：从一个点出发，像树根一样随机分叉延伸。
  function drawCracks(ctx,S,count){for(let k=0;k<count;k++){let x=Math.random()*S,y=Math.random()*S*0.5;let angle=Math.PI/2+(Math.random()-0.5);let w=2.2;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);const steps=30+Math.floor(Math.random()*30);for(let i=0;i<steps;i++){angle+=(Math.random()-0.5)*0.6;x+=Math.cos(angle)*(6+Math.random()*8);y+=Math.sin(angle)*(6+Math.random()*8);ctx.lineTo(x,y);if(Math.random()<0.15){let bx=x,by=y,ba=angle+(Math.random()-0.5)*1.6;ctx.lineWidth=w*0.5;for(let j=0;j<8;j++){ba+=(Math.random()-0.5)*0.6;bx+=Math.cos(ba)*5;by+=Math.sin(ba)*5;ctx.lineTo(bx,by);}ctx.moveTo(x,y);ctx.lineWidth=w;}}ctx.stroke();}}

  // 墙面纹理(灰白裂纹水渍，破败底色)——阳台的隔断墙用它。
  function wallTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#d3d2cc';ctx.fillRect(0,0,S,S);for(let i=0;i<40;i++){ctx.fillStyle=`rgba(120,118,110,${0.04+Math.random()*0.08})`;const r=30+Math.random()*90;ctx.beginPath();ctx.arc(Math.random()*S,Math.random()*S,r,0,Math.PI*2);ctx.fill();}for(let i=0;i<14;i++){const x=Math.random()*S;const y=S*0.6+Math.random()*S*0.4;const g=ctx.createRadialGradient(x,y,2,x,y,40+Math.random()*50);g.addColorStop(0,'rgba(60,58,52,0.22)');g.addColorStop(1,'rgba(60,58,52,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}ctx.strokeStyle='rgba(40,38,34,0.55)';drawCracks(ctx,S,3);sprinkleNoise(ctx,S,0.5,-16,16);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // 木纹(藤椅木框/晾衣架可用)
  function woodTexture(base){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.strokeStyle='rgba(70,58,46,0.3)';ctx.lineWidth=1.5;for(let i=0;i<24;i++){ctx.beginPath();let y=Math.random()*S;ctx.moveTo(0,y);for(let x=0;x<=S;x+=16){y+=(Math.random()-0.5)*8;ctx.lineTo(x,y);}ctx.stroke();}for(let i=0;i<10;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,25+Math.random()*40);g.addColorStop(0,'rgba(200,196,186,0.28)');g.addColorStop(1,'rgba(200,196,186,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.35,-12,12);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // 布料(晾着的衣物用)
  function fabricTexture(base,dusty){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.globalAlpha=0.06;for(let i=0;i<S;i+=3){ctx.fillStyle=i%6===0?'#000':'#fff';ctx.fillRect(0,i,S,1);ctx.fillRect(i,0,1,S);}ctx.globalAlpha=1;if(dusty){for(let i=0;i<18;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,20+Math.random()*40);g.addColorStop(0,'rgba(210,208,200,0.3)');g.addColorStop(1,'rgba(210,208,200,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}}sprinkleNoise(ctx,S,0.4,-14,14);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // 混凝土(阳台水泥地/楼板，带法线凹凸)——★返回 {map,normalMap} 打包对象，下面用时必须拆包★
  function makeConcrete(size=512,base='#b9b9b6'){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');g.fillStyle=base;g.fillRect(0,0,size,size);for(let i=0;i<90;i++){const x=Math.random()*size,y=Math.random()*size,r=40+Math.random()*140;const a=(Math.random()-0.5)*0.16;const grad=g.createRadialGradient(x,y,0,x,y,r);const v=a>0?255:0;grad.addColorStop(0,`rgba(${v},${v},${v},${Math.abs(a)})`);grad.addColorStop(1,`rgba(${v},${v},${v},0)`);g.fillStyle=grad;g.beginPath();g.arc(x,y,r,0,7);g.fill();}const img=g.getImageData(0,0,size,size),d=img.data;for(let i=0;i<d.length;i+=4){const n=(Math.random()-0.5)*36;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}g.putImageData(img,0,0);g.strokeStyle='rgba(20,20,18,0.5)';for(let i=0;i<8;i++){g.lineWidth=0.6+Math.random()*1.2;g.beginPath();let x=Math.random()*size,y=Math.random()*size;g.moveTo(x,y);for(let s=0;s<8;s++){x+=(Math.random()-0.5)*70;y+=(Math.random()-0.5)*70;g.lineTo(x,y);}g.stroke();}const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;const nc=document.createElement('canvas');nc.width=nc.height=size;const ng=nc.getContext('2d');const srcData=g.getImageData(0,0,size,size).data;const out=ng.createImageData(size,size),od=out.data;const lum=(x,y)=>{const i=((y&(size-1))*size+(x&(size-1)))*4;return(srcData[i]+srcData[i+1]+srcData[i+2])/765;};for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=(lum(x-1,y)-lum(x+1,y))*2.2;const dy=(lum(x,y-1)-lum(x,y+1))*2.2;const len=Math.hypot(dx,dy,1);const i=(y*size+x)*4;od[i]=((dx/len)*0.5+0.5)*255;od[i+1]=((dy/len)*0.5+0.5)*255;od[i+2]=(1/len)*255;od[i+3]=255;}ng.putImageData(out,0,0);const normal=new THREE.CanvasTexture(nc);normal.wrapS=normal.wrapT=THREE.RepeatWrapping;return{map:tex,normalMap:normal};}

  // ============================================================
  // 2) 共享材质（★map 拆包★：makeConcrete 返回的是 {map,normalMap} 对象，
  //    必须取 .map / .normalMap 分别传，绝不能把整个对象当 map 传，否则
  //    下一行 .repeat.set() 会因为 map 不是真 Texture 抛 TypeError，整段脚本崩→3D 一片黑。）
  // ============================================================

  // 水泥地（阳台地面）。法线让裂纹有真实凹凸。
  const cc = makeConcrete(512, '#b3b1ab');
  cc.map.repeat.set(2.5, 2);            // 重复铺，否则一块纹理拉满整个地板会糊
  cc.normalMap.repeat.set(2.5, 2);
  const floorMat = new THREE.MeshStandardMaterial({
    map: cc.map, normalMap: cc.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.95, color: 0xffffff
  });

  // 隔断墙（阳台两侧实墙 + 内侧墙）
  const wt = wallTexture();
  const wallMat = new THREE.MeshStandardMaterial({
    map: wt, normalMap: null,
    roughness: 0.96, color: 0xe9e7e1
  });

  // 天花板（阳台顶板，也用水泥）。再造一份 concrete 当顶，纹理方向独立。
  const cc2 = makeConcrete(512, '#a7a5a0');
  cc2.map.repeat.set(2, 1.5);
  cc2.normalMap.repeat.set(2, 1.5);
  const ceilMat = new THREE.MeshStandardMaterial({
    map: cc2.map, normalMap: cc2.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.98, color: 0xf2f0ec
  });

  // 不锈钢/铁件（栏杆、晾衣架、空调外机外壳）
  const metalMat = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7});
  // 暗铁（栏杆立柱、生锈感稍重）
  const ironMat  = new THREE.MeshStandardMaterial({color:0x6b6660, roughness:0.7,  metalness:0.55});
  // 藤椅木框
  const woodMat  = new THREE.MeshStandardMaterial({map:woodTexture('#9a8a73'), roughness:0.85, metalness:0.0});
  // 泥土（摔碎花盆撒出来的土）
  const soilMat  = new THREE.MeshStandardMaterial({color:0x5a4632, roughness:1.0, metalness:0.0});
  // 陶土花盆
  const potMat   = new THREE.MeshStandardMaterial({color:0xa9603f, roughness:0.9, metalness:0.0});
  // 植物叶子（暗绿，半枯黄一点）
  const leafMat  = new THREE.MeshStandardMaterial({color:0x4d6638, roughness:0.85, metalness:0.0, flatShading:true});
  // 杂物纸箱
  const boxMat   = new THREE.MeshStandardMaterial({color:0xb39667, roughness:0.95, metalness:0.0});

  // ============================================================
  // 3) 房间外壳：地板 + 两侧实墙 + 内侧墙(门洞那面，留洞) + 顶板。
  //    朝外那面(z=+RD/2)不砌实墙，只砌一道矮护栏 + 上方留空给栏杆和天光——这是"阳台"的开放感来源。
  // ============================================================

  // 地板：盒高 0.3，中心 y=-0.15，顶面正好 y=0（和游戏地面齐平）
  add(new THREE.BoxGeometry(RW, 0.3, RD), floorMat, 0, -0.15, 0);

  // 顶板：阳台上方那块挑出的楼板（地震时正是它最容易塌——视觉上压在玩家头顶制造压迫感）
  add(new THREE.BoxGeometry(RW, 0.25, RD), ceilMat, 0, H - 0.125, 0);

  // 左侧实墙（x=-RW/2 那面）
  add(new THREE.BoxGeometry(0.25, H, RD), wallMat, -RW/2, H/2, 0);
  // 右侧实墙（x=+RW/2 那面）
  add(new THREE.BoxGeometry(0.25, H, RD), wallMat, RW/2, H/2, 0);

  // 内侧墙（z=-RD/2 朝室内那面）留门洞：拆成「门左段 + 门右段 + 门楣」。
  // 门洞宽 1.4，居中(x=0)。门左段占 x∈[-RW/2, -0.7]，门右段 x∈[0.7, RW/2]。
  const segLen = (RW/2 - 0.7);            // 单侧墙段长度
  const segCx  = -(0.7 + segLen/2);       // 门左段中心 x（右段取相反数）
  add(new THREE.BoxGeometry(segLen, H, 0.25), wallMat, segCx, H/2, -RD/2);   // 门左段
  add(new THREE.BoxGeometry(segLen, H, 0.25), wallMat, -segCx, H/2, -RD/2);  // 门右段
  // 门楣（门洞上方那条横梁，从门顶 y=2.1 到天花）
  const lintelH = H - 2.1;
  add(new THREE.BoxGeometry(1.4, lintelH, 0.25), wallMat, 0, 2.1 + lintelH/2, -RD/2);

  // 朝外那面(z=+RD/2)：一道矮护栏墙（混凝土女儿墙，约 0.9 高），上面再立金属栏杆。
  // 女儿墙顶面 y=0.9。
  add(new THREE.BoxGeometry(RW, 0.9, 0.22), floorMat, 0, 0.45, RD/2);

  // ============================================================
  // 4) 朝外金属栏杆（立柱 + 双横杆）——阳台的标志物。
  //    立柱：一排细 cylinder，间隔约 0.5；上下两道横杆把它们串起来。
  //    其中故意让一两根立柱歪斜(rotation)、栏杆有缺口——"松动/被震过"的破败感。
  // ============================================================
  {
    const railTopY = 1.35;                // 栏杆总高(女儿墙 0.9 + 上面金属段 0.45)
    const postR = 0.025, postH = railTopY - 0.9;  // 立柱半径/高度(从女儿墙顶往上)
    const postGeo = new THREE.CylinderGeometry(postR, postR, postH, 8);
    const nPosts = 13;
    for(let i=0;i<nPosts;i++){
      const x = -RW/2 + 0.3 + i*( (RW-0.6)/(nPosts-1) );
      // 跳过中间一根(缺口=被震掉/锈断)，做破败
      if(i===6) continue;
      const p = add(postGeo, ironMat, x, 0.9 + postH/2, RD/2);
      // 个别立柱歪一点(松动)
      if(i===3) p.rotation.z = 0.16;
      if(i===10) p.rotation.x = -0.12;
    }
    // 上横杆（贯穿，圆管）
    const railGeo = new THREE.CylinderGeometry(0.03, 0.03, RW-0.5, 8);
    const top = add(railGeo, metalMat, 0, railTopY, RD/2);
    top.rotation.z = Math.PI/2;           // 圆柱默认竖着，转 90°变横杆
    top.rotation.y = 0.02;                // 极轻微扭曲，地震后不那么笔直
    // 中横杆
    const mid = add(new THREE.CylinderGeometry(0.025,0.025,RW-0.5,8), ironMat, 0, 1.12, RD/2);
    mid.rotation.z = Math.PI/2;
  }

  // ============================================================
  // 5) 晾衣架 + 晾着的衣物（布料薄平面，挂歪表现地震）
  //    晾衣架：两根立杆 + 顶部横杆，靠左墙站。衣物=几片很薄的 box，垂在横杆下，给不同 rotation。
  // ============================================================
  {
    const rackX = -RW/2 + 0.9;            // 靠左墙
    const rackZ = -0.2;
    const poleGeo = new THREE.CylinderGeometry(0.03,0.03,1.7,8);
    add(poleGeo, metalMat, rackX, 0.85, rackZ-0.7);   // 立杆1
    add(poleGeo, metalMat, rackX, 0.85, rackZ+0.7);   // 立杆2
    const bar = add(new THREE.CylinderGeometry(0.025,0.025,1.6,8), metalMat, rackX, 1.65, rackZ);
    bar.rotation.x = Math.PI/2;           // 顶部横杆（沿 z 方向）
    // 晾着的衣物：薄薄的布料平面，挂在横杆下，各自歪斜
    const clothColors = ['#7a8fa6', '#9a6b6b', '#b5a886', '#5f6b58'];
    for(let i=0;i<4;i++){
      const cw = 0.5 + Math.random()*0.2, ch = 0.7 + Math.random()*0.3;
      const cm = new THREE.MeshStandardMaterial({map:fabricTexture(clothColors[i], true), roughness:0.95, side:THREE.DoubleSide});
      const cloth = add(new THREE.BoxGeometry(cw, ch, 0.02), cm, rackX, 1.65-ch/2, rackZ-0.55+i*0.36);
      cloth.rotation.z = (Math.random()-0.5)*0.4;   // 被风/被震吹歪
      cloth.rotation.y = (Math.random()-0.5)*0.3;
    }
    // 一件被震掉在地上的衣物
    const fallen = add(new THREE.BoxGeometry(0.6,0.45,0.02),
      new THREE.MeshStandardMaterial({map:fabricTexture('#88607a',true),roughness:0.95,side:THREE.DoubleSide}),
      rackX+0.3, 0.03, rackZ+1.1);
    fallen.rotation.x = -Math.PI/2 + 0.15; fallen.rotation.z = 0.6;
  }

  // ============================================================
  // 6) 花盆植物（cylinder 盆 + Icosahedron 叶子）+ 摔碎的花盆(土撒一地)——破败重点
  // ============================================================
  // 完好的一盆：靠右墙角
  {
    const px = RW/2 - 0.7, pz = -RD/2 + 0.7;
    const pot = add(new THREE.CylinderGeometry(0.22,0.16,0.32,12), potMat, px, 0.16, pz);
    // 一丛叶子：几个 Icosahedron 叠在盆口上方，大小不一
    for(let i=0;i<5;i++){
      const r = 0.13 + Math.random()*0.1;
      const leaf = add(new THREE.IcosahedronGeometry(r, 0), leafMat,
        px + (Math.random()-0.5)*0.18, 0.42 + Math.random()*0.22, pz + (Math.random()-0.5)*0.18);
      leaf.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    }
  }
  // 摔碎的一盆：在地上倒着，碎成几片陶土 + 土撒成一摊
  {
    const sx = 0.9, sz = RD/2 - 0.9;       // 靠近外侧栏杆处
    // 倒地的盆身(倒扣 cylinder)
    const broken = add(new THREE.CylinderGeometry(0.2,0.15,0.28,12), potMat, sx, 0.1, sz);
    broken.rotation.z = Math.PI/2 - 0.2;   // 横躺
    broken.rotation.y = 0.4;
    // 撒出来的土堆(扁球感，用压扁的 Icosahedron)
    const soil = add(new THREE.IcosahedronGeometry(0.28,0), soilMat, sx+0.25, 0.04, sz+0.1);
    soil.scale.set(1.4, 0.25, 1.2);
    // 几块碎陶片
    for(let i=0;i<5;i++){
      const sh = add(new THREE.BoxGeometry(0.06+Math.random()*0.05, 0.02, 0.05+Math.random()*0.05), potMat,
        sx + (Math.random()-0.5)*0.7, 0.02, sz + (Math.random()-0.5)*0.6);
      sh.rotation.set(Math.random(), Math.random()*3, Math.random());
    }
    // 散落的枯叶
    for(let i=0;i<3;i++){
      const lf = add(new THREE.IcosahedronGeometry(0.08,0), leafMat,
        sx + (Math.random()-0.5)*0.8, 0.02, sz + (Math.random()-0.5)*0.7);
      lf.scale.set(1, 0.3, 1.2); lf.rotation.y = Math.random()*3;
    }
  }

  // ============================================================
  // 7) 旧藤椅（木框 + 编织感座面靠背，给点歪斜=被震动过）
  //    椅 = 4 腿 + 座面 + 靠背 + 两侧扶手。靠右墙摆。
  // ============================================================
  {
    const cx = RW/2 - 0.8, cz = 0.6;
    const legGeo = new THREE.CylinderGeometry(0.03,0.03,0.42,8);
    const chair = new THREE.Group();
    const legXY = [[-0.22,-0.2],[0.22,-0.2],[-0.22,0.2],[0.22,0.2]];
    legXY.forEach(([lx,lz])=>{
      const l = new THREE.Mesh(legGeo, woodMat); l.position.set(cx+lx, 0.21, cz+lz);
      l.castShadow=true; room.add(l);
    });
    // 座面
    const seat = add(new THREE.BoxGeometry(0.52,0.06,0.5), woodMat, cx, 0.45, cz);
    // 靠背
    const back = add(new THREE.BoxGeometry(0.52,0.5,0.06), woodMat, cx, 0.7, cz-0.22);
    // 扶手
    add(new THREE.BoxGeometry(0.06,0.06,0.46), woodMat, cx-0.23, 0.5, cz);
    add(new THREE.BoxGeometry(0.06,0.06,0.46), woodMat, cx+0.23, 0.5, cz);
    // 整椅微歪(被震得偏了)——给座面+靠背+扶手统一旋转不好做（分散加的），
    // 这里简单给座面和靠背一点 z 轴歪斜代表松动感
    seat.rotation.z = 0.05; back.rotation.z = 0.07;
  }

  // ============================================================
  // 8) 空调外机（box 主体 + 正面格栅细 box + 侧面散热片）——靠左墙地面
  // ============================================================
  {
    const ax = -RW/2 + 0.55, ay = 0.55, az = RD/2 - 0.9;
    // 主体外壳
    add(new THREE.BoxGeometry(0.85,0.55,0.4), metalMat, ax, ay, az);
    // 正面格栅（朝外，z+方向）：一排横向细条
    const grilleMat = ironMat;
    for(let i=0;i<7;i++){
      add(new THREE.BoxGeometry(0.7,0.04,0.02), grilleMat, ax, 0.35+i*0.06, az+0.21);
    }
    // 圆形风扇罩（正面中央）
    const fan = add(new THREE.CylinderGeometry(0.22,0.22,0.03,16), ironMat, ax, ay, az+0.22);
    fan.rotation.x = Math.PI/2;
    // 支架（墙托）
    add(new THREE.BoxGeometry(0.06,0.06,0.45), metalMat, ax-0.3, 0.3, az);
    add(new THREE.BoxGeometry(0.06,0.06,0.45), metalMat, ax+0.3, 0.3, az);
  }

  // ============================================================
  // 9) 堆的杂物（纸箱堆 + 散落小物）——靠右后墙角，歪斜堆叠
  // ============================================================
  {
    const jx = RW/2 - 0.6, jz = RD/2 - 0.4;
    const b1 = add(new THREE.BoxGeometry(0.5,0.4,0.45), boxMat, jx, 0.2, jz);
    b1.rotation.y = 0.2;
    const b2 = add(new THREE.BoxGeometry(0.4,0.35,0.4), boxMat, jx-0.1, 0.57, jz+0.05);
    b2.rotation.y = -0.3; b2.rotation.z = 0.12;     // 上面这箱被震歪，快滑下来
    // 一只旧桶
    const bucket = add(new THREE.CylinderGeometry(0.16,0.13,0.3,12), ironMat, jx-0.5, 0.15, jz-0.3);
    bucket.rotation.z = 0.5;                          // 倒了
  }

  // ============================================================
  // 10) 地震破败：地面散落小石块/碎屑（一批随机灰白小 box）
  //     + 地砖裂缝感（靠纹理已有，再压一块薄"裂砖"暗片强调）
  // ============================================================
  {
    const rubbleMat = new THREE.MeshStandardMaterial({color:0xbdbab3, roughness:1.0});
    for(let i=0;i<22;i++){
      const s = 0.04 + Math.random()*0.12;
      const r = add(new THREE.BoxGeometry(s, s*0.6, s*0.9), rubbleMat,
        (Math.random()-0.5)*(RW-1), s*0.3, (Math.random()-0.5)*(RD-1));
      r.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    }
    // 几块翘起的裂地砖（暗一点的薄片，微微抬起一角）
    const crackTileMat = new THREE.MeshStandardMaterial({color:0x8d8a83, roughness:1.0});
    for(let i=0;i<3;i++){
      const t = add(new THREE.BoxGeometry(0.4,0.04,0.4), crackTileMat,
        (Math.random()-0.5)*(RW-2), 0.03, (Math.random()-0.5)*(RD-2));
      t.rotation.x = (Math.random()-0.5)*0.3; t.rotation.z = (Math.random()-0.5)*0.3;
    }
  }

  // ============================================================
  // 11) 🔴 科普埋点：墙上一块警示牌——"地震时绝对别上阳台！悬挑结构最易塌 + 玻璃高空坠物"
  //     用一块带文字 canvas 纹理的薄 box 挂在内侧墙(门洞旁)，玩家进门一抬头就看到。
  //     这是把救命知识焊进场景实物，而不只是堆家具。
  // ============================================================
  {
    function makeSignTexture(){
      const S=512;const{canvas,ctx}=makeCanvas(S);
      // 暗黄底+磨损（旧警示牌质感）
      ctx.fillStyle='#c9a83a';ctx.fillRect(0,0,S,S);
      for(let i=0;i<30;i++){ctx.fillStyle=`rgba(80,70,20,${0.05+Math.random()*0.1})`;ctx.beginPath();ctx.arc(Math.random()*S,Math.random()*S,10+Math.random()*40,0,7);ctx.fill();}
      // 黑边框
      ctx.strokeStyle='#1a1a14';ctx.lineWidth=14;ctx.strokeRect(20,20,S-40,S-40);
      // 警示三角 + 感叹号
      ctx.fillStyle='#1a1a14';ctx.beginPath();ctx.moveTo(S/2,70);ctx.lineTo(S/2+70,200);ctx.lineTo(S/2-70,200);ctx.closePath();ctx.fill();
      ctx.fillStyle='#c9a83a';ctx.fillRect(S/2-9,110,18,55);ctx.beginPath();ctx.arc(S/2,185,11,0,7);ctx.fill();
      // 文字
      ctx.fillStyle='#1a1a14';ctx.textAlign='center';
      ctx.font='bold 60px sans-serif';ctx.fillText('地震勿上阳台',S/2,300);
      ctx.font='34px sans-serif';
      ctx.fillText('悬挑结构最易垮塌',S/2,370);
      ctx.fillText('远离玻璃·高空坠物',S/2,420);
      ctx.fillText('应躲承重墙小开间',S/2,470);
      sprinkleNoise(ctx,S,0.25,-18,18);
      const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
    }
    const signMat = new THREE.MeshStandardMaterial({map:makeSignTexture(), roughness:0.85, metalness:0.1});
    // 挂在门洞右侧墙段上，朝向室内来人(法线朝 -z 这面正对进门玩家)
    const sign = add(new THREE.BoxGeometry(0.7,0.7,0.04), signMat, 1.6, 1.7, -RD/2 + 0.14);
    sign.rotation.z = -0.06;     // 挂歪一点(被震斜)，更真实
  }

  // ============================================================
  // 12) 照明：半室外阳台比室内稍亮。
  //     - 1 盏暖橙 PointLight 当吸顶灯/主光（0xffd9a0，强度比室内大一档）。
  //     - 1 盏偏冷的弱 PointLight 放朝外栏杆外侧，模拟"从外面透进来的一点天光"，
  //       强化"半室外"的感觉。两盏都是有位置的 PointLight，不是全局光，不破坏暗灰氛围。
  // ============================================================
  {
    // 暖主灯（吸顶位置，稍靠内）
    const warm = new THREE.PointLight(0xffd9a0, 3.6, 10, 2);
    warm.position.set(0, H - 0.5, -0.5);
    warm.castShadow = true;
    room.add(warm);
    // 冷天光（栏杆外、稍高，弱而冷，往室内打一点）
    const sky = new THREE.PointLight(0xbcd2e6, 1.4, 9, 2);
    sky.position.set(0, 1.8, RD/2 + 1.0);
    room.add(sky);
  }

  // 把房间外壳材质返回给集成处，让玩家真正踩的地/撞的墙复用同款质感。
  return {floorMat, wallMat, ceilMat};
}

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

export function buildDiningRoom(scene, THREE, ox, oz){

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

export function buildStudyRoom(scene, THREE, ox, oz) {
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
export function buildKidsRoom(scene, THREE, ox, oz) {
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

export function buildStorageRoom(scene, THREE, ox, oz) {

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
export function buildCorridorRoom(scene, THREE, ox, oz){

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
export function buildElevatorHall(scene, THREE, ox, oz){

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

// 房间名：邻居家虚掩门（Neighbor's Half-Open Door）—— 余震·DROP 地震逃生科普游戏的支线"窥视点"
// =============================================================================
// 这个文件是干什么的？
//   它造的不是"一间能走进去的房间"，而是走廊墙上的一道【半开的邻居家户门】——
//   门虚掩着，玩家路过往门缝里一看：邻居家客厅一角，沙发翻倒、东西散了一地、昏暗。
//   像主人没逃出去、又像刚仓皇逃走。它是一个"叙事窥视点"：制造情感冲击 + 埋邻里互助科普。
//
// 为什么不是普通房间？（和厨房/卫生间那种支线房间的区别）
//   普通支线房间：在墙上开门洞，玩家真的走进去探索。
//   本"窥视点"：玩家【不进去】，只从走廊隔着门缝看一眼。所以门后是一个【浅景箱(diorama)】——
//   一个贴在墙背面的浅浅的小客厅角，做出"门里别有洞天"的纵深感，全是装饰、不进碰撞、不挡路。
//   类比：就像橱窗——你贴着玻璃往里看一眼商品陈列，但你不会走进橱窗里。
//
// 为什么叫"程序化"？
//   整个游戏守 8MB 离线红线 + 禁外部 CDN —— 不能用任何图片/模型/音频文件。
//   所以这里所有木纹、布料、门牌质感，都是用一张看不见的画布(canvas)现画出来的，
//   所有东西都是用一堆小盒子(box)和圆柱(cylinder)拼出来的。零外部文件。
//
// 怎么用 / 接到游戏里？（给集成的主 agent 看，详见文末"集成说明"）
//   1) 把整个函数粘进 game_v3.html（和 buildLivingRoom / buildKitchenRoom 做邻居）。
//   2) 调用：buildNeighborHome(scene, THREE, ox, oz);
//      —— 它会自己挂一个 root Group 整体平移到 (ox,oz)，一行调用就摆好。
//   3) 本函数【不需要】集成处再开门洞——它自带门框、自带门后浅景箱、自带照明。
//      它默认贴在走廊【北墙(z 更小那侧)】上、门朝南(+z，朝主通道)开。玩家从走廊往北看就能看进去。
//      若要贴别的墙，整体绕 y 轴转 root 即可（见文末集成说明）。
//   4) 它【不进】walls[]/grounds[]——纯装饰，不挡逃生路（铁律4）。集成处那面墙若原本是完整墙，
//      保留即可（门是"嵌在墙上的一块凹进去的浅景"，不破坏墙的碰撞）。
//
// 坐标怎么平移？（关键，别搞错）
//   本函数所有物体都先按"门洞自己的原点(0,0)为中心"摆好（门框中心在 0,0,0，门后浅景往 -z 纵深），
//   然后整体塞进一个 root Group，最后 root.position.set(ox,0,oz) 一次性平移到世界位置。
//   好处：内部坐标永远干净（以 0,0 为中心），不用每件东西手写 +ox/+oz，不会漏。
//
// 五条铁律自检（本函数严格遵守）：
//   ① 零外部文件/零 addons：只用传入的 THREE，纹理全 canvas 现画，几何全程序化拼。
//   ② 绝不加全局光：只用 2 盏有位置的暖 PointLight(0xffd9a0)——一盏门内昏暗弱暖光、一盏门口走廊暖光，
//      不碰 Ambient/Hemisphere/Directional（全局光会照亮整栋楼、毁掉"神秘暗灰"氛围）。
//   ③ 材质 map 必拆包：本函数用的纹理工厂都返回"真 Texture"（不是 {map,normalMap} 打包对象），
//      赋值直接 map:tex；唯独"门面木纹的法线图"是单独算的，已正确拆开赋给 normalMap。
//   ④ 不挡逃生路：整体贴墙、门后是浅景箱（嵌在墙背后的空地，不占走道），全是装饰不进碰撞。
//   ⑤ 视觉由主 agent CDP 把关：本函数只保证几何正确/比例真实/能亮，不堆黑。
// =============================================================================

export function buildNeighborHome(scene, THREE, ox, oz){
  // ===========================================================================
  // 〇、root 容器：整个"门 + 门后浅景"的托盘
  //   想象成一个大托盘，先把门框、门、门牌、门后小客厅都摆在托盘上(以门中心为原点)，
  //   最后端起整个托盘走到世界里的 (ox,oz) 位置放下。这样内部坐标永远以 0 为中心。
  // ===========================================================================
  const root = new THREE.Group();
  root.position.set(ox, 0, oz);
  scene.add(root);

  // 关键尺寸（房间自己的内部坐标系，门中心=0,0,0）：
  //   门洞净宽 DOORW、净高 DOORH；门框在 z=0 这个平面上；
  //   门后浅景箱往 -z 方向纵深 DEPTH（朝走廊外侧看不见的墙背后），让玩家有"望进一个房间"的错觉。
  const DOORW = 1.1;    // 户门净宽(住宅户门略窄)
  const DOORH = 2.2;    // 户门净高
  const WALLH = 3.0;    // 这面墙(走廊层高)
  const FRAMET = 0.12;  // 门框木条粗细
  const DEPTH = 2.4;    // 门后浅景箱纵深(往 -z)
  const INW = 2.6;      // 门后小客厅的可见宽度
  const INH = 2.6;      // 门后小客厅的可见高度

  // ===========================================================================
  // 一、程序化纹理工厂（从 skill references/textures.md 整段拷进来，自包含）
  //   放在函数内部当局部函数，避免和 game_v3 里 buildLivingRoom 的同名函数冲突。
  //   每个工厂 = "现画一张正方形贴图"。下面按"通用工具 → 各材质"组织。
  // ===========================================================================

  // 开一张正方形离屏 canvas（看不见的画板，画完当贴图用）
  function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

  // 撒细噪点(落灰/颗粒感)。amount=密度，lo/hi=每个点的明暗扰动范围。
  // 类比：像往表面随机弹一层细沙，让纯色不那么"塑料假"。
  function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

  // 由灰度图反推法线图：相邻像素的明暗差 = 表面坡度 = 朝向。
  // 作用：让木纹/裂纹在灯光下有真实凹凸阴影，而不是一张平贴纸。
  // strength 越大凹凸越强（门面木纹 1.8 是合适值）。
  function normalFromCanvas(srcCanvas,strength){const S=srcCanvas.width;const sctx=srcCanvas.getContext('2d');const src=sctx.getImageData(0,0,S,S).data;const{canvas,ctx}=makeCanvas(S);const out=ctx.createImageData(S,S);const o=out.data;const lum=(x,y)=>{x=(x+S)%S;y=(y+S)%S;const i=(y*S+x)*4;return(src[i]+src[i+1]+src[i+2])/3/255;};for(let y=0;y<S;y++){for(let x=0;x<S;x++){const dx=(lum(x-1,y)-lum(x+1,y))*strength;const dy=(lum(x,y-1)-lum(x,y+1))*strength;const len=Math.sqrt(dx*dx+dy*dy+1);const i=(y*S+x)*4;o[i]=(dx/len*0.5+0.5)*255;o[i+1]=(dy/len*0.5+0.5)*255;o[i+2]=(1/len*0.5+0.5)*255;o[i+3]=255;}}ctx.putImageData(out,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;}

  // 递归裂纹（地震破败的灵魂细节）：一条主裂缝随机抖动前进，偶尔分叉出小裂缝。
  function drawCracks(ctx,S,count){for(let k=0;k<count;k++){let x=Math.random()*S,y=Math.random()*S*0.5;let angle=Math.PI/2+(Math.random()-0.5);let w=2.2;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);const steps=30+Math.floor(Math.random()*30);for(let i=0;i<steps;i++){angle+=(Math.random()-0.5)*0.6;x+=Math.cos(angle)*(6+Math.random()*8);y+=Math.sin(angle)*(6+Math.random()*8);ctx.lineTo(x,y);if(Math.random()<0.15){let bx=x,by=y,ba=angle+(Math.random()-0.5)*1.6;ctx.lineWidth=w*0.5;for(let j=0;j<8;j++){ba+=(Math.random()-0.5)*0.6;bx+=Math.cos(ba)*5;by+=Math.sin(ba)*5;ctx.lineTo(bx,by);}ctx.moveTo(x,y);ctx.lineWidth=w;}}ctx.stroke();}}

  // —— 墙面纹理（灰白裂纹水渍，SCP 破败底色）——
  // 门后小客厅的内墙、门框旁的墙面都用它。
  function wallTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#d3d2cc';ctx.fillRect(0,0,S,S);for(let i=0;i<40;i++){ctx.fillStyle=`rgba(120,118,110,${0.04+Math.random()*0.08})`;const r=30+Math.random()*90;ctx.beginPath();ctx.arc(Math.random()*S,Math.random()*S,r,0,Math.PI*2);ctx.fill();}for(let i=0;i<14;i++){const x=Math.random()*S;const y=S*0.6+Math.random()*S*0.4;const g=ctx.createRadialGradient(x,y,2,x,y,40+Math.random()*50);g.addColorStop(0,'rgba(60,58,52,0.22)');g.addColorStop(1,'rgba(60,58,52,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}ctx.strokeStyle='rgba(40,38,34,0.55)';drawCracks(ctx,S,3);sprinkleNoise(ctx,S,0.5,-16,16);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // —— 地板纹理（脏旧木条纹 + 积灰）——
  // 门后小客厅的地。
  function floorTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#b4afa5';ctx.fillRect(0,0,S,S);for(let i=0;i<S;i+=64){ctx.fillStyle=i%128===0?'rgba(110,104,94,0.18)':'rgba(150,145,135,0.12)';ctx.fillRect(0,i,S,60);ctx.fillStyle='rgba(60,56,50,0.5)';ctx.fillRect(0,i+60,S,3);}for(let i=0;i<30;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*60);g.addColorStop(0,'rgba(205,203,196,0.35)');g.addColorStop(1,'rgba(205,203,196,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.55,-20,20);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // —— 木纹（户门门扇、门框、踢脚、家具）——
  function woodTexture(base){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.strokeStyle='rgba(70,58,46,0.3)';ctx.lineWidth=1.5;for(let i=0;i<24;i++){ctx.beginPath();let y=Math.random()*S;ctx.moveTo(0,y);for(let x=0;x<=S;x+=16){y+=(Math.random()-0.5)*8;ctx.lineTo(x,y);}ctx.stroke();}for(let i=0;i<10;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,25+Math.random()*40);g.addColorStop(0,'rgba(200,196,186,0.28)');g.addColorStop(1,'rgba(200,196,186,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.35,-12,12);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // —— 布料（翻倒的沙发、抱枕、散落衣物）——
  function fabricTexture(base,dusty){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.globalAlpha=0.06;for(let i=0;i<S;i+=3){ctx.fillStyle=i%6===0?'#000':'#fff';ctx.fillRect(0,i,S,1);ctx.fillRect(i,0,1,S);}ctx.globalAlpha=1;if(dusty){for(let i=0;i<18;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,20+Math.random()*40);g.addColorStop(0,'rgba(210,208,200,0.3)');g.addColorStop(1,'rgba(210,208,200,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}}sprinkleNoise(ctx,S,0.4,-14,14);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}

  // ===========================================================================
  // 二、共享材质（★材质 map 拆包铁律★）
  //   这些工厂都返回"真 Texture"，所以可以直接 map:tex。
  //   只有"门面木纹的法线图"是单独算的——已正确赋给 normalMap，没有把打包对象整个塞进 map。
  // ===========================================================================
  const wallMat   = new THREE.MeshStandardMaterial({map:wallTexture(), roughness:0.95, metalness:0.0, color:0xffffff}); // 内墙(破败灰白)
  const floorMat  = (function(){const ft=floorTexture();ft.repeat.set(1.6,1.6);return new THREE.MeshStandardMaterial({map:ft, roughness:0.9, metalness:0.0});})(); // 门后客厅地
  const ceilMat   = new THREE.MeshStandardMaterial({color:0x4a4742, roughness:1});     // 门后天花(更暗，强化"看不真切的深处")

  // 户门门扇：深木 + 由木纹反推的法线(让门板有真实纹理凹凸)
  const doorTex   = woodTexture('#7a6353');                       // 户门常见的深胡桃木色
  const doorNorm  = normalFromCanvas(doorTex.image, 1.8);
  const doorMat   = new THREE.MeshStandardMaterial({map:doorTex, normalMap:doorNorm, normalScale:new THREE.Vector2(0.7,0.7), roughness:0.78, metalness:0.06, color:0xffffff});
  const frameMat  = new THREE.MeshStandardMaterial({map:woodTexture('#5f4d40'), roughness:0.8, metalness:0.05}); // 门框(比门略深)

  const metalMat  = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7});  // 门把手/合页/门牌底
  const chromeMat = new THREE.MeshStandardMaterial({color:0xc8ccd0, roughness:0.2,  metalness:0.9});  // 亮面金属(把手抛光面)
  const sofaMat   = new THREE.MeshStandardMaterial({map:fabricTexture('#8a4a36', true), roughness:0.96, metalness:0.0}); // 翻倒的暖橙红旧沙发(布满灰)
  const cushionMat= new THREE.MeshStandardMaterial({map:fabricTexture('#6b6f55', true), roughness:0.96, metalness:0.0}); // 散落抱枕(橄榄灰绿)
  const woodFurnMat=new THREE.MeshStandardMaterial({map:woodTexture('#857769'), roughness:0.82, metalness:0.04});         // 翻倒的茶几/相框
  const paperMat  = new THREE.MeshStandardMaterial({color:0xd8d4c6, roughness:1, metalness:0.0});      // 散落的纸张/相片
  const photoMat  = new THREE.MeshStandardMaterial({color:0xbfc6cf, roughness:0.5, metalness:0.1});    // 全家福相片(冷灰，更显凄凉)

  // ===========================================================================
  // 三、几何工具：box / cyl —— 拼东西的两块"积木"
  //   box：带阴影的长方体；cyl：带阴影的圆柱(把手/罐子/桌腿用)。
  //   都只"返回 Mesh 不直接 add"，由各组件的 Group 拼好后整体加进 root。
  // ===========================================================================
  function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  function cyl(rt,rb,h,mat,x,y,z,seg=16){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
  // add：把拼好的组件(或单个 mesh)放进 root 托盘。x,y,z 是"内部坐标"(以门中心为原点)。
  function add(obj,x,y,z){obj.position.set(x,y,z);root.add(obj);return obj;}

  // ===========================================================================
  // 四、门后浅景箱（diorama）：一个嵌在墙背后的浅浅小客厅角
  //   坐标系：门框平面在 z=0；浅景箱往 -z 纵深(DEPTH)。所以玩家站在走廊(+z 侧)
  //   往 -z 方向(穿过门缝)看，就能看见这个昏暗的小客厅角。
  //   它有自己的左/右/后墙 + 地 + 顶，五面围合(朝走廊那面=z=0 是开口，正是门所在)，
  //   做出"门里别有洞天"的封闭纵深感。全是装饰，不进碰撞数组(铁律4)。
  // ===========================================================================
  // 浅景箱地板(顶面 y=0，和走廊地面齐平；盒高 0.2 → 中心 y=-0.1)
  add(box(INW, 0.2, DEPTH, floorMat, 0,0,0), 0, -0.1, -DEPTH/2);
  // 后墙(z=-DEPTH，玩家视线尽头)
  add(box(INW, INH, 0.15, wallMat, 0,0,0), 0, INH/2, -DEPTH);
  // 左墙(x=-INW/2)
  add(box(0.15, INH, DEPTH, wallMat, 0,0,0), -INW/2, INH/2, -DEPTH/2);
  // 右墙(x=+INW/2)
  add(box(0.15, INH, DEPTH, wallMat, 0,0,0),  INW/2, INH/2, -DEPTH/2);
  // 天花板(更暗，强化"深处昏暗")
  add(box(INW, 0.15, DEPTH, ceilMat, 0,0,0), 0, INH-0.07, -DEPTH/2);
  // 踢脚线(后墙根一条深木条，增加室内细节)
  add(box(INW, 0.12, 0.04, frameMat, 0,0,0), 0, 0.06, -DEPTH+0.09);

  // ===========================================================================
  // 五、户门门框 + 半开的门扇 + 门牌号 + 把手 + 合页
  //   门框：三根木条(左竖+右竖+上横)围出门洞，立在 z=0 平面上。
  //   门扇：用一个"合页 Group"绕左侧门轴向内(往 -z，朝邻居家里)甩开约 50°——半开虚掩感。
  //   门牌：门框右上的小金属牌，canvas 现画门牌号"2-301"。
  // ===========================================================================
  // —— 5.1 门框（左竖梃 + 右竖梃 + 上门楣）——
  // 左竖梃(门洞左边那根)
  add(box(FRAMET, DOORH+FRAMET, FRAMET*1.6, frameMat, 0,0,0), -(DOORW/2+FRAMET/2), (DOORH)/2, 0);
  // 右竖梃
  add(box(FRAMET, DOORH+FRAMET, FRAMET*1.6, frameMat, 0,0,0),  (DOORW/2+FRAMET/2), (DOORH)/2, 0);
  // 上门楣(横在门洞顶)
  add(box(DOORW+FRAMET*2, FRAMET, FRAMET*1.6, frameMat, 0,0,0), 0, DOORH+FRAMET/2, 0);

  // —— 5.2 半开的门扇（合页 Group 绕左门轴向内甩开）——
  // 设计：把门板做成一个子 Group，铰链点(旋转中心)放在门洞【左边缘】的门轴位置；
  //   门板本体相对铰链向 +x 延伸 DOORW；然后 hinge.rotation.y 让整扇门绕门轴往房间里转开。
  //   类比：就像推开一扇真门——你推的是门把手那一侧，转轴在合页那一侧。
  function buildDoorLeaf(){
    const hinge = new THREE.Group();
    // 铰链(门轴)位置：门洞左边缘、地面到门高的中点
    hinge.position.set(-DOORW/2, DOORH/2, 0);
    // 门板：相对铰链中心，板心在 +x 半个门宽处(让门左缘对齐门轴)
    const leaf = box(DOORW, DOORH-0.04, 0.05, doorMat, DOORW/2, 0, 0);
    hinge.add(leaf);
    // 门板上的两道凹槽装饰(住宅户门常见的方形门芯线)，贴在门板朝外那面(+z)
    const panelMat = new THREE.MeshStandardMaterial({map:doorTex, normalMap:doorNorm, normalScale:new THREE.Vector2(0.5,0.5), roughness:0.8, metalness:0.05, color:0xe8e2da});
    hinge.add(box(DOORW*0.7, DOORH*0.34, 0.012, panelMat, DOORW/2, DOORH*0.22, 0.03));   // 上门芯
    hinge.add(box(DOORW*0.7, DOORH*0.34, 0.012, panelMat, DOORW/2, -DOORH*0.22, 0.03));  // 下门芯
    // 门把手(横拉手柄)：装在门板右侧(远离门轴那侧)，朝走廊面(+z)
    hinge.add(cyl(0.018,0.018,0.16, chromeMat, DOORW-0.12, -0.05, 0.06).rotateX(Math.PI/2)); // 把手横杆
    hinge.add(box(0.05,0.05,0.06, metalMat, DOORW-0.12, -0.05, 0.035));                       // 把手底座
    // 三个合页(门轴侧的小金属片)
    hinge.add(box(0.02,0.12,0.05, metalMat, 0.01, DOORH*0.32, 0.0));
    hinge.add(box(0.02,0.12,0.05, metalMat, 0.01, 0, 0.0));
    hinge.add(box(0.02,0.12,0.05, metalMat, 0.01, -DOORH*0.32, 0.0));
    // ★半开虚掩★：往房间里(-z)甩开约 50°。正值绕 y 让 +x 侧的门板往 -z 转(朝邻居家里开)。
    hinge.rotation.y = 0.9;   // ≈ 51.5°，半开，留出一道能看进去的门缝
    return hinge;
  }
  root.add(buildDoorLeaf());

  // —— 5.3 门牌号（门框右上的小金属牌，canvas 现画"2-301"）——
  // 设计意图：门牌让"这是一户具体人家"有了身份——不是抽象的门，是"301 室的邻居"，
  //   情感上更具体，呼应"敲门确认这一户人在不在"的科普点。
  const plateW=0.34, plateH=0.16;
  const plate=box(plateW, plateH, 0.02, metalMat, 0,0,0);
  (function paintPlate(){
    const{canvas,ctx}=makeCanvas(256);
    // 拉丝金属底
    ctx.fillStyle='#8c9095';ctx.fillRect(0,0,256,256);
    for(let i=0;i<256;i+=2){ctx.fillStyle=`rgba(255,255,255,${Math.random()*0.06})`;ctx.fillRect(0,i,256,1);}
    ctx.strokeStyle='#3a3c40';ctx.lineWidth=6;ctx.strokeRect(8,60,240,136);
    ctx.fillStyle='#15171a';ctx.font='bold 96px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('2-301', 128, 130);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
    plate.material=new THREE.MeshStandardMaterial({map:t, roughness:0.5, metalness:0.4});
  })();
  add(plate, DOORW/2+FRAMET+0.10, DOORH-0.25, FRAMET*0.9);

  // ===========================================================================
  // 六、门后小客厅一角（叙事核心）：翻倒的沙发 + 散落物 + 全家福相框
  //   摆在浅景箱里(z 在 -0.6 ~ -DEPTH 之间)，玩家从门缝看进去能看见。
  //   叙事留白："像没逃出 / 或刚逃走"——沙发翻倒、东西撒一地、全家福掉地上裂了。
  // ===========================================================================

  // —— 6.1 翻倒的旧沙发（多 box 拼：座垫底 + 靠背 + 两侧扶手，整体侧翻）——
  function buildToppledSofa(){
    const g=new THREE.Group();
    const sw=1.5, sd=0.7, sh=0.45;                          // 沙发原本的宽/深/座高
    g.add(box(sw, sh, sd, sofaMat, 0, sh/2, 0));            // 座体
    g.add(box(sw, 0.55, 0.18, sofaMat, 0, sh+0.18, -sd/2+0.09)); // 靠背
    g.add(box(0.18, sh+0.3, sd, sofaMat, -sw/2+0.09, (sh+0.3)/2, 0)); // 左扶手
    g.add(box(0.18, sh+0.3, sd, sofaMat,  sw/2-0.09, (sh+0.3)/2, 0)); // 右扶手
    g.add(box(sw*0.46, 0.16, sd-0.2, cushionMat, -sw*0.24, sh+0.08, 0.04)); // 座垫1
    g.add(box(sw*0.46, 0.16, sd-0.2, cushionMat,  sw*0.24, sh+0.08, 0.04)); // 座垫2
    // ★侧翻★：绕 z 轴翻倒约 80°，整体再随机转个角度，斜靠在后墙根
    g.rotation.set(0, 0.5, Math.PI*0.46);
    return g;
  }
  add(buildToppledSofa(), -0.35, 0.45, -DEPTH+0.7);

  // —— 6.2 翻倒的小茶几（台面 + 四腿，腿朝天）——
  function buildFlippedTable(){
    const g=new THREE.Group();
    g.add(box(0.7,0.05,0.45, woodFurnMat, 0,0,0));          // 台面
    for(const [tx,tz] of [[-0.3,-0.18],[0.3,-0.18],[-0.3,0.18],[0.3,0.18]])
      g.add(box(0.05,0.4,0.05, woodFurnMat, tx,0.22,tz));   // 四条腿
    g.rotation.set(Math.PI, 0.7, 0.12);                     // 翻过来(腿朝天)+随机转
    return g;
  }
  add(buildFlippedTable(), 0.55, 0.06, -DEPTH+1.0);

  // —— 6.3 掉地上的全家福相框（叙事点睛：暗示这户有家人/可能有老人小孩）——
  function buildFamilyPhoto(){
    const g=new THREE.Group();
    g.add(box(0.34,0.26,0.025, woodFurnMat, 0,0,0));        // 相框木边
    g.add(box(0.28,0.20,0.012, photoMat, 0,0,0.02));        // 相片(冷灰，更显凄凉)
    // 玻璃裂了：几道细白线斜划过相片面
    const crackMat=new THREE.MeshStandardMaterial({color:0xeef1f4, roughness:0.2, metalness:0.3});
    g.add(box(0.30,0.006,0.004, crackMat, 0,0.02,0.028).rotateZ(0.5));
    g.add(box(0.22,0.006,0.004, crackMat, 0,-0.02,0.028).rotateZ(-0.7));
    g.rotation.set(-Math.PI/2+0.15, 0.4, 0);                // 几乎平躺在地上(玻璃面朝上)
    return g;
  }
  add(buildFamilyPhoto(), 0.2, 0.02, -0.9);

  // —— 6.4 散落的纸张/相片（薄扁 box，撒在门口地上，像逃跑时带翻的）——
  for(let i=0;i<10;i++){
    const w=0.1+Math.random()*0.12;
    const p=box(w, 0.004, w*(0.7+Math.random()*0.5), paperMat, 0,0,0);
    p.rotation.set((Math.random()-0.5)*0.3, Math.random()*3, (Math.random()-0.5)*0.3);
    // 撒在浅景箱地上(z 在 -0.4 ~ -DEPTH+0.3)，避开正对门缝最中间留点空让人能看见纵深
    add(p, (Math.random()-0.5)*(INW-0.5), 0.004, -0.4-Math.random()*(DEPTH-0.6));
  }

  // —— 6.5 散落的生活杂物（小 box，灰白随机，强化"狼藉一地"）——
  for(let i=0;i<16;i++){
    const s=0.05+Math.random()*0.11;
    const shade=0.55+Math.random()*0.3;
    const m=new THREE.Mesh(new THREE.BoxGeometry(s, s*(0.5+Math.random()*0.7), s*(0.6+Math.random()*0.7)),
                           new THREE.MeshStandardMaterial({color:new THREE.Color(shade,shade,shade*0.96), roughness:0.95}));
    m.position.set((Math.random()-0.5)*(INW-0.4), s*0.4, -0.3-Math.random()*(DEPTH-0.5));
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    m.castShadow=m.receiveShadow=true;
    root.add(m);
  }

  // —— 6.6 一只散落的小拖鞋（暗示"人匆忙出门"，叙事留白）——
  // 用两块小 box 拼一只拖鞋：鞋底 + 鞋面(斜盖)，单独一只(另一只不知去向)。
  function buildSlipper(){
    const g=new THREE.Group();
    const slipMat=new THREE.MeshStandardMaterial({map:fabricTexture('#9a5a4a', true), roughness:0.95});
    g.add(box(0.10,0.025,0.24, slipMat, 0,0,0));            // 鞋底
    const top=box(0.10,0.05,0.10, slipMat, 0,0.03,-0.06);top.rotation.x=0.2;g.add(top); // 鞋面(脚背处)
    g.rotation.y=1.1;                                       // 随便撇在地上
    return g;
  }
  add(buildSlipper(), -0.9, 0.012, -0.55);

  // ===========================================================================
  // 七、科普埋点：门口立式提示牌（房间的灵魂，把"邻里互助"焊进场景）
  //   科普内容：地震后【敲门确认邻里，尤其家有老人/儿童的住户】——他们行动慢、可能被困或受伤，
  //   逃生时顺手敲一下邻居的门、喊一声，能救命。这是把"个人逃生"升华到"邻里互助"的情感+知识点。
  //   做法：在门框右下立一块发暖光的提示牌(贴墙)，canvas 现画图标+文字，暗处可读。
  // ===========================================================================
  const signMat=new THREE.MeshStandardMaterial({color:0x4aa3c8, roughness:0.6, emissive:0x0a2630, emissiveIntensity:0.5});
  const sign=box(0.46,0.34,0.02, signMat, 0,0,0);
  (function paintSign(){
    const{canvas,ctx}=makeCanvas(256);
    ctx.fillStyle='#2f7d96';ctx.fillRect(0,0,256,256);                 // 救援蓝(指示/互助语义)
    ctx.strokeStyle='#eaf4f8';ctx.lineWidth=8;ctx.strokeRect(10,10,236,236);
    // 图标：一只"敲门的手"——简化成拳头(圆)+门(竖线) 三道敲击波纹
    ctx.strokeStyle='#eaf4f8';ctx.lineWidth=8;
    ctx.beginPath();ctx.moveTo(150,40);ctx.lineTo(150,120);ctx.stroke();         // 门边
    ctx.fillStyle='#eaf4f8';ctx.beginPath();ctx.arc(100,80,20,0,Math.PI*2);ctx.fill(); // 拳头
    ctx.lineWidth=5;for(let k=0;k<3;k++){ctx.beginPath();ctx.arc(150,80,28+k*14,-0.6,0.6);ctx.stroke();} // 敲击波纹
    ctx.fillStyle='#eaf4f8';ctx.font='bold 40px sans-serif';ctx.textAlign='center';
    ctx.fillText('逃生顺手', 128, 168);
    ctx.fillText('敲邻居门', 128, 212);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
    sign.material=new THREE.MeshStandardMaterial({map:t, roughness:0.6, emissive:0x12343f, emissiveIntensity:0.4});
  })();
  sign.rotation.z=-0.03;                              // 微歪(被震过)
  add(sign, DOORW/2+FRAMET+0.18, 1.05, FRAMET*0.9);

  // 提示牌下方的立杆(让它像走廊里立着的指示牌，而不是凭空飘)
  add(cyl(0.018,0.022,0.85, metalMat, 0,0,0, 10), DOORW/2+FRAMET+0.18, 0.46, FRAMET*0.9);
  add(cyl(0.07,0.08,0.04, metalMat, 0,0,0, 12), DOORW/2+FRAMET+0.18, 0.04, FRAMET*0.9); // 底座

  // ===========================================================================
  // 八、照明：2 盏有位置的暖 PointLight(0xffd9a0) —— 绝不加全局光
  //   ① 门内昏暗弱暖光：藏在浅景箱深处，强度低、范围小——让邻居家"透出一点点暖"，
  //      但整体昏暗看不真切，制造"里面是不是还有人"的不安。
  //   ② 门口走廊暖光：在门框外(+z 走廊侧)上方，强度高一点——照亮门、门牌、提示牌，
  //      让玩家路过时被这道门"吸住目光"。
  //   坐标直接写"内部坐标"，因为灯也加进 root 托盘，会随 root 一起平移到世界。
  // ===========================================================================
  function warmPoint(x,y,z,intensity,dist){const l=new THREE.PointLight(0xffd9a0,intensity,dist,2);l.position.set(x,y,z);root.add(l);return l;}
  warmPoint(0.1, INH-0.6, -DEPTH+0.7, 3.0, 4.0);   // ① 门内昏暗弱暖光(深处、弱、范围小)
  warmPoint(0.0, DOORH-0.2, 0.7, 6.5, 5.0);        // ② 门口走廊暖光(门外上方，照亮门面/门牌/提示牌)

  // 返回三种材质给集成处复用(若集成想让这段走廊墙/地用同款质感)。
  // 注意：本"窥视点"默认不需要集成处再开门洞或加碰撞——它是贴墙的浅景装饰。
  return {floorMat, wallMat, ceilMat, doorMat};
}

