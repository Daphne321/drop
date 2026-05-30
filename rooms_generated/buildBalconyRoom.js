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
function buildBalconyRoom(scene, THREE, ox, oz){

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
