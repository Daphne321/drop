# 程序化纹理工厂（拷贝即用）

8MB 离线红线下不能用任何图片，所有质感都用 `<canvas>` 现画。**这次每个场景函数都重写了一遍这些工厂——别再重复，建房间时从这里整段拷进你的 `buildXxxRoom` 内部即可**（放函数内部当局部函数，避免全局命名冲突）。game_v3.html 里 `buildLivingRoom`/`buildDeathScene` 有现成同款，也可直接参考。

全部已在 game_v3 验证跑通。下面按"通用工具 → 各材质"组织。

## 通用工具（每个房间都要）

```javascript
// 开一张正方形离屏 canvas
function makeCanvas(size){const c=document.createElement('canvas');c.width=c.height=size;return{canvas:c,ctx:c.getContext('2d')};}

// 撒细噪点(落灰/颗粒)。amount=密度, lo/hi=明度扰动范围
function sprinkleNoise(ctx,size,amount,lo,hi){const img=ctx.getImageData(0,0,size,size);const d=img.data;for(let i=0;i<d.length;i+=4){if(Math.random()<amount){const v=lo+Math.random()*(hi-lo);d[i]=Math.min(255,d[i]+v);d[i+1]=Math.min(255,d[i+1]+v);d[i+2]=Math.min(255,d[i+2]+v);}}ctx.putImageData(img,0,0);}

// 由灰度图反推法线图:相邻像素明暗差=坡度=表面朝向。让裂纹/颗粒在光照下有真实凹凸，不是平贴纸。
// strength 越大凹凸越强(墙 2.0, 地 2.5, 混凝土 2.2 是验证过的好值)
function normalFromCanvas(srcCanvas,strength){const S=srcCanvas.width;const sctx=srcCanvas.getContext('2d');const src=sctx.getImageData(0,0,S,S).data;const{canvas,ctx}=makeCanvas(S);const out=ctx.createImageData(S,S);const o=out.data;const lum=(x,y)=>{x=(x+S)%S;y=(y+S)%S;const i=(y*S+x)*4;return(src[i]+src[i+1]+src[i+2])/3/255;};for(let y=0;y<S;y++){for(let x=0;x<S;x++){const dx=(lum(x-1,y)-lum(x+1,y))*strength;const dy=(lum(x,y-1)-lum(x,y+1))*strength;const len=Math.sqrt(dx*dx+dy*dy+1);const i=(y*S+x)*4;o[i]=(dx/len*0.5+0.5)*255;o[i+1]=(dy/len*0.5+0.5)*255;o[i+2]=(1/len*0.5+0.5)*255;o[i+3]=255;}}ctx.putImageData(out,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;}

// 递归裂纹(地震墙裂的灵魂细节)
function drawCracks(ctx,S,count){for(let k=0;k<count;k++){let x=Math.random()*S,y=Math.random()*S*0.5;let angle=Math.PI/2+(Math.random()-0.5);let w=2.2;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);const steps=30+Math.floor(Math.random()*30);for(let i=0;i<steps;i++){angle+=(Math.random()-0.5)*0.6;x+=Math.cos(angle)*(6+Math.random()*8);y+=Math.sin(angle)*(6+Math.random()*8);ctx.lineTo(x,y);if(Math.random()<0.15){let bx=x,by=y,ba=angle+(Math.random()-0.5)*1.6;ctx.lineWidth=w*0.5;for(let j=0;j<8;j++){ba+=(Math.random()-0.5)*0.6;bx+=Math.cos(ba)*5;by+=Math.sin(ba)*5;ctx.lineTo(bx,by);}ctx.moveTo(x,y);ctx.lineWidth=w;}}ctx.stroke();}}
```

## 墙面（灰白裂纹水渍，SCP 破败底色）—— 几乎每个房间都用

```javascript
function wallTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#d3d2cc';ctx.fillRect(0,0,S,S);for(let i=0;i<40;i++){ctx.fillStyle=`rgba(120,118,110,${0.04+Math.random()*0.08})`;const r=30+Math.random()*90;ctx.beginPath();ctx.arc(Math.random()*S,Math.random()*S,r,0,Math.PI*2);ctx.fill();}for(let i=0;i<14;i++){const x=Math.random()*S;const y=S*0.6+Math.random()*S*0.4;const g=ctx.createRadialGradient(x,y,2,x,y,40+Math.random()*50);g.addColorStop(0,'rgba(60,58,52,0.22)');g.addColorStop(1,'rgba(60,58,52,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}ctx.strokeStyle='rgba(40,38,34,0.55)';drawCracks(ctx,S,3);sprinkleNoise(ctx,S,0.5,-16,16);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}
// 用法: const wt=wallTexture(); const wn=normalFromCanvas(wt.image,2.0);
//      const wallMat=new THREE.MeshStandardMaterial({map:wt,normalMap:wn,normalScale:new THREE.Vector2(0.8,0.8),roughness:0.95,color:0xffffff});
```

## 地板（脏旧木条纹 + 积灰）

```javascript
function floorTexture(){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle='#b4afa5';ctx.fillRect(0,0,S,S);for(let i=0;i<S;i+=64){ctx.fillStyle=i%128===0?'rgba(110,104,94,0.18)':'rgba(150,145,135,0.12)';ctx.fillRect(0,i,S,60);ctx.fillStyle='rgba(60,56,50,0.5)';ctx.fillRect(0,i+60,S,3);}for(let i=0;i<30;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*60);g.addColorStop(0,'rgba(205,203,196,0.35)');g.addColorStop(1,'rgba(205,203,196,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.55,-20,20);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}
// 地板材质记得 repeat: floorTex.repeat.set(3,3); 否则一块纹理拉满整个地板会糊
```

## 木纹（家具：橱柜/书架/桌椅）

```javascript
function woodTexture(base){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.strokeStyle='rgba(70,58,46,0.3)';ctx.lineWidth=1.5;for(let i=0;i<24;i++){ctx.beginPath();let y=Math.random()*S;ctx.moveTo(0,y);for(let x=0;x<=S;x+=16){y+=(Math.random()-0.5)*8;ctx.lineTo(x,y);}ctx.stroke();}for(let i=0;i<10;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,25+Math.random()*40);g.addColorStop(0,'rgba(200,196,186,0.28)');g.addColorStop(1,'rgba(200,196,186,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}sprinkleNoise(ctx,S,0.35,-12,12);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}
// 深木 woodTexture('#857769') / 浅木 woodTexture('#a39788')
```

## 布料（沙发/床/窗帘/地毯）

```javascript
function fabricTexture(base,dusty){const S=256;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=base;ctx.fillRect(0,0,S,S);ctx.globalAlpha=0.06;for(let i=0;i<S;i+=3){ctx.fillStyle=i%6===0?'#000':'#fff';ctx.fillRect(0,i,S,1);ctx.fillRect(i,0,1,S);}ctx.globalAlpha=1;if(dusty){for(let i=0;i<18;i++){const x=Math.random()*S,y=Math.random()*S;const g=ctx.createRadialGradient(x,y,1,x,y,20+Math.random()*40);g.addColorStop(0,'rgba(210,208,200,0.3)');g.addColorStop(1,'rgba(210,208,200,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}}sprinkleNoise(ctx,S,0.4,-14,14);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}
```

## 混凝土（裸墙/楼板/碎块，带法线）—— ⚠️ 返回打包对象，必拆包

```javascript
function makeConcrete(size=512,base='#b9b9b6'){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');g.fillStyle=base;g.fillRect(0,0,size,size);for(let i=0;i<90;i++){const x=Math.random()*size,y=Math.random()*size,r=40+Math.random()*140;const a=(Math.random()-0.5)*0.16;const grad=g.createRadialGradient(x,y,0,x,y,r);const v=a>0?255:0;grad.addColorStop(0,`rgba(${v},${v},${v},${Math.abs(a)})`);grad.addColorStop(1,`rgba(${v},${v},${v},0)`);g.fillStyle=grad;g.beginPath();g.arc(x,y,r,0,7);g.fill();}const img=g.getImageData(0,0,size,size),d=img.data;for(let i=0;i<d.length;i+=4){const n=(Math.random()-0.5)*36;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}g.putImageData(img,0,0);g.strokeStyle='rgba(20,20,18,0.5)';for(let i=0;i<8;i++){g.lineWidth=0.6+Math.random()*1.2;g.beginPath();let x=Math.random()*size,y=Math.random()*size;g.moveTo(x,y);for(let s=0;s<8;s++){x+=(Math.random()-0.5)*70;y+=(Math.random()-0.5)*70;g.lineTo(x,y);}g.stroke();}const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;const nc=document.createElement('canvas');nc.width=nc.height=size;const ng=nc.getContext('2d');const srcData=g.getImageData(0,0,size,size).data;const out=ng.createImageData(size,size),od=out.data;const lum=(x,y)=>{const i=((y&(size-1))*size+(x&(size-1)))*4;return(srcData[i]+srcData[i+1]+srcData[i+2])/765;};for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=(lum(x-1,y)-lum(x+1,y))*2.2;const dy=(lum(x,y-1)-lum(x,y+1))*2.2;const len=Math.hypot(dx,dy,1);const i=(y*size+x)*4;od[i]=((dx/len)*0.5+0.5)*255;od[i+1]=((dy/len)*0.5+0.5)*255;od[i+2]=(1/len)*255;od[i+3]=255;}ng.putImageData(out,0,0);const normal=new THREE.CanvasTexture(nc);normal.wrapS=normal.wrapT=THREE.RepeatWrapping;return{map:tex,normalMap:normal};}
// ★必拆包★: const cc=makeConcrete(); new MeshStandardMaterial({map:cc.map, normalMap:cc.normalMap, ...})
//   绝不能 {map: cc} —— cc 是 {map,normalMap} 对象，整包传会让 .repeat.set() 抛 TypeError 崩黑屏
```

## 瓷砖（厨房/卫生间专用，新补）

这次没做，但厨房/卫生间是瓷砖墙地。模板（白瓷砖 + 砖缝 + 霉斑污渍 + 几片裂/掉砖）：

```javascript
function tileTexture(base='#e8e6e0',gap='#9a968c',cell=64){const S=512;const{canvas,ctx}=makeCanvas(S);ctx.fillStyle=gap;ctx.fillRect(0,0,S,S);          // 缝隙底色
  for(let y=0;y<S;y+=cell)for(let x=0;x<S;x+=cell){ctx.fillStyle=base;ctx.fillRect(x+1.5,y+1.5,cell-3,cell-3);}  // 一格格瓷砖(留缝)
  for(let i=0;i<10;i++){const x=Math.random()*S,y=S*0.55+Math.random()*S*0.45;const g=ctx.createRadialGradient(x,y,2,x,y,30+Math.random()*40);g.addColorStop(0,'rgba(70,80,70,0.18)');g.addColorStop(1,'rgba(70,80,70,0)');ctx.fillStyle=g;ctx.fillRect(0,0,S,S);}  // 霉斑(偏下)
  ctx.fillStyle='rgba(60,58,52,0.5)';for(let k=0;k<3;k++){const gx=Math.floor(Math.random()*S/cell)*cell;const gy=Math.floor(Math.random()*S/cell)*cell;ctx.fillRect(gx+1.5,gy+1.5,cell-3,cell-3);}  // 几片掉了/裂了的暗砖
  sprinkleNoise(ctx,S,0.3,-10,10);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;return tex;}
// 厨房瓷砖 tileTexture('#e8e6e0','#9a968c') / 卫生间冷白 tileTexture('#dfe6e6','#8a9090')
```

## 金属 / 玻璃 / 屏幕（纯材质，不用纹理）

```javascript
const metalMat  = new THREE.MeshStandardMaterial({color:0x9aa0a4, roughness:0.45, metalness:0.7});  // 不锈钢/把手/水龙头
const chromeMat = new THREE.MeshStandardMaterial({color:0xc8ccd0, roughness:0.2,  metalness:0.9});  // 镜框/亮面金属
const glassMat  = new THREE.MeshStandardMaterial({color:0x9cc2df, roughness:0.1,  metalness:0.1, transparent:true, opacity:0.55});  // 玻璃/镜面
const screenMat = new THREE.MeshStandardMaterial({color:0x0d0f12, roughness:0.25, metalness:0.3});  // 黑屏(电视/微波炉面板)
```
