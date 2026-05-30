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

function buildKitchenRoom(scene, THREE, ox, oz){
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
