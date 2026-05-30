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
function buildBathroomRoom(scene, THREE, ox, oz){
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
