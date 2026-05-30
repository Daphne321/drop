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

function buildNeighborHome(scene, THREE, ox, oz){
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
