// 家具舰队产出的4个精细程序化家具函数(agent生成,主agent集成)

// ==== 破败吊灯（带暖光） (makeChandelier) ====
function makeChandelier(cx, cy, cz){
  // ============================================================
  // 破败吊灯生成器
  // ------------------------------------------------------------
  // 思路：吊灯是“从天花板往下长”的，和地面家具方向相反。
  //   所以我先确定天花板高度 ceilY，再让吊杆、灯罩、灯泡一节一节往下挂。
  // 结构自上而下：天花板底座 → 吊杆(略歪=破败) → 吊环 → 灯罩(碗形=多圈box叠) → 灯泡 → 暖光源。
  //   把整体想象成“一串挂在天花板上的糖葫芦”，从上到下一颗颗串。
  // 冷暖对比是质感灵魂：灯体全用灰白冷调金属/陶瓷材质，
  //   只有灯泡 + PointLight 是暖色(0xffd9a0)，灰冷的废墟里点一簇暖光，反差才出味道。
  // ============================================================

  // ---- 0. 关键高度常量 ----
  // cy 是地面 y。本场景天花板在 y≈3（见主文件 box(...,1.5,...) 墙高3）。
  // 这里用 cy+2.78 作为吊灯吸顶盘位置，留一点余量贴住天花板。
  const ceilY = cy + 2.78;

  // 破败感的核心：让整盏灯有一个轻微的“歪斜”，像被余震晃松了一颗螺丝。
  // tilt 是吊杆相对竖直的偏角(弧度)，很小(约5°)，多了会出戏。
  const tilt = 0.09;          // 吊杆歪斜角度
  const sway = Math.sin(tilt); // 歪斜在水平方向上的位移量，用来让下方灯罩跟着偏过去

  // ---- 1. 程序化新材质（纯色，无贴图，守8MB红线）----
  // 灯具的“瓷白灯罩”：偏灰的脏白色，粗糙度高 → 一层灰扑扑的蒙尘感。
  const mShade = new THREE.MeshStandardMaterial({ color: 0xcfc9bf, roughness: 0.95, metalness: 0.05 });
  // 吊杆/吊环的“做旧金属”：比标准 mMetal 更暗更哑，像氧化发黑的旧黄铜。
  const mRod   = new THREE.MeshStandardMaterial({ color: 0x6a655c, roughness: 0.7, metalness: 0.75 });
  // 灯泡：自发光暖色。emissive 让它自己亮，即使 PointLight 关了灯泡本体也是暖的，配合 bloom 会有光晕。
  const mBulb  = new THREE.MeshStandardMaterial({ color: 0xfff0d6, emissive: 0xffd9a0, emissiveIntensity: 1.6, roughness: 0.3 });
  // 灯罩内壁/反光圈：被灯泡烤出的一圈暖色，强化“光是从这里漏出来的”。
  const mInner = new THREE.MeshStandardMaterial({ color: 0xffe3b0, emissive: 0xffcaa0, emissiveIntensity: 0.9, roughness: 0.8 });

  // ---- 2. 吸顶盘（贴住天花板的圆底座，这里用扁方块近似）----
  // 它是整盏灯的“根”，固定在天花板上，下面的一切都从它往下垂。
  box(0.5, 0.08, 0.5, mRod, cx, ceilY, cz);                 // 吸顶大盘
  box(0.34, 0.06, 0.34, mMetal, cx, ceilY - 0.06, cz);      // 第二级小盘，做出层次

  // ---- 3. 吊杆（细长金属杆，整体略微歪斜=破败）----
  // 吊杆长 0.62。因为整体歪了 tilt 度，杆的下端会往一侧偏 sway*长度。
  // 我把杆的中点放在“竖直中点 + 半个偏移”处，再用 rz 旋转，让它真的斜过去。
  const rodLen = 0.62;
  const rodMidY = ceilY - 0.06 - rodLen / 2;                // 吊杆竖直方向的中点高度
  const rodOffX = sway * (rodLen / 2);                      // 斜杆下端相对中点的水平偏移
  box(0.05, rodLen, 0.05, mRod, cx + rodOffX, rodMidY, cz, 0, 0, tilt); // rz=tilt 让杆歪斜

  // 下面所有零件的水平中心，都要跟着吊杆的歪斜整体平移过去（hangX/hangZ）。
  // 否则灯罩还挂在正中、杆却歪着，看起来是断开的。
  const hangX = cx + sway * rodLen;   // 杆下端的 x（灯罩中心）
  const hangZ = cz;                   // 只在 x 方向歪，z 不动（简化，已足够自然）

  // ---- 4. 吊环 + 灯座（杆和灯罩之间的连接节）----
  const ringY = ceilY - 0.06 - rodLen;                     // 吊杆下端高度
  box(0.12, 0.05, 0.12, mRod, hangX, ringY, hangZ);        // 连接环
  box(0.18, 0.07, 0.18, mMetal, hangX, ringY - 0.06, hangZ); // 灯座（灯泡螺口的金属帽）

  // ---- 5. 碗形灯罩（用多圈逐渐变大的扁方块叠出“倒扣的碗”）----
  // 真实碗罩是连续曲面，我们没法用单个 box 表达曲率，
  //   就用 4 层方块从小到大叠成阶梯，远看就是一个张口向下的喇叭/碗——这是低模拼细节的常用手法。
  // 每一层都要带上 hangX/hangZ 的偏移，整碗才跟着杆一起歪。
  const shadeTopY = ringY - 0.14;                          // 碗的最高一圈（最窄）
  const shadeRings = [
    { w: 0.22, h: 0.07, y: shadeTopY        },             // 碗顶（窄）
    { w: 0.34, h: 0.07, y: shadeTopY - 0.07 },
    { w: 0.46, h: 0.07, y: shadeTopY - 0.14 },
    { w: 0.56, h: 0.05, y: shadeTopY - 0.20 }              // 碗口（最宽，光从这里漏出）
  ];
  shadeRings.forEach(r => box(r.w, r.h, r.w, mShade, hangX, r.y, hangZ));
  // 灯罩内壁暖色反光圈：藏在碗口里侧，被暖光泡“烤亮”，让人感觉光确实从罩里透出来。
  box(0.44, 0.03, 0.44, mInner, hangX, shadeTopY - 0.18, hangZ);

  // ---- 6. 灯泡（暖色自发光小球，挂在碗口下方一点，半露出来）----
  const bulbY = shadeTopY - 0.24;                          // 灯泡比碗口再低一点，刚好从罩下探出
  const bulb = box(0.14, 0.18, 0.14, mBulb, hangX, bulbY, hangZ); // 用扁长方块近似灯泡形

  // ---- 7. 暖色点光源（质感灵魂：灰冷废墟里的一簇暖光）----
  // 颜色 0xffd9a0 = 钨丝灯的暖橙白，和场景灰白冷调形成冷暖对比。
  // 强度别太高，否则盖过整体压抑氛围；衰减距离 7 让它只照亮灯下一小片，
  //   光圈边缘自然没入黑暗——“一盏还亮着的灯 + 周围的废墟黑暗”正是地震后的家的感觉。
  const warm = new THREE.PointLight(0xffd9a0, 1.5, 7, 2);  // (颜色, 强度, 距离, 衰减指数)
  warm.position.set(hangX, bulbY - 0.05, hangZ);           // 光源放在灯泡正下方一点点
  warm.castShadow = true;                                  // 让灯下家具投出柔和阴影，更有体积感
  warm.shadow.mapSize.set(512, 512);                       // 阴影分辨率，512 够清晰又不卡
  warm.shadow.bias = -0.0015;                              // 修掉阴影自身的“摩尔纹”噪点
  scene.add(warm);

  // 返回灯泡 mesh，方便外部（比如地震时让灯闪烁/摇晃）继续操控。
  return bulb;
}

// ==== 卫浴角(马桶+洗手台+镜子) (makeBathroomCorner) ====
function makeBathroomCorner(cx,cy,cz){
  // ============================================================
  // 卫浴角：马桶 + 洗手台 + 墙上镜子，占地约 1.5 x 1.5 的墙角。
  // 设计思路：SCP 收容失效式灰白破败——白瓷为主、冷调，
  //   再用一盏暖色点光做"冷暖对比"，让白瓷不死板、有体积感。
  // 坐标约定：cx/cy/cz 是这个角落的中心，cy 是地面 y，所有东西从地面往上长。
  // 朝向假设：背靠两面墙——马桶/洗手台背面朝 -z，镜子挂在 -z 墙上。
  //   洗手台放在 +x 半边、马桶放在 -x 半边，两者并排塞进角落。
  // ============================================================

  // ---- 程序化材质（纯色，绝不导入贴图，守 8MB 红线）----
  // 白瓷：高 roughness 偏低一点点，带一丝反光感，但落了灰所以不锃亮。
  // 把白瓷想象成"放久了的搪瓷脸盆"——本是亮白，蒙了层灰后发青冷。
  const mPorcelain=new THREE.MeshStandardMaterial({color:0xcdd0cf,roughness:0.55,metalness:0.04});
  // 脏污白瓷：用在马桶底座/水箱这些更容易积垢的地方，比纯白瓷更暗黄灰。
  const mPorcelainDirty=new THREE.MeshStandardMaterial({color:0xb3b2a6,roughness:0.7,metalness:0.03});
  // 镀铬金属：水龙头/把手，冷亮高光，是画面里少数"反光点"，提精致度。
  const mChrome=new THREE.MeshStandardMaterial({color:0xc8ccce,roughness:0.25,metalness:0.85});
  // 镜面：低 roughness + 微金属 + 淡青，模拟蒙尘的旧镜子（不做真反射，省性能）。
  const mMirror=new THREE.MeshStandardMaterial({color:0x8f9ea3,roughness:0.18,metalness:0.5});
  // 镜框 / 台面下柜：深灰带锈，破败感来源。
  const mGrime=new THREE.MeshStandardMaterial({color:0x595650,roughness:0.95,metalness:0.1});

  // ============================================================
  // 一、马桶（放在角落的 -x 半边，背靠 -z 墙）
  //   结构拆成 4 块：底座（梯形感用上下两段拼）+ 碗沿 + 盖 + 水箱。
  //   不用一个大方块糊弄——分件才有"陶瓷洁具"的轮廓。
  // ============================================================
  const tx=cx-0.45;            // 马桶中心 x（偏到角落左半）
  const tz=cz-0.42;            // 贴近 -z 墙

  // 底座下段（坐地的大墩子，略宽）
  box(0.42,0.30,0.46,mPorcelainDirty, tx,cy+0.15,tz);
  // 底座上段（收窄一点，做出"陶瓷收腰"的层次）
  box(0.36,0.12,0.42,mPorcelain, tx,cy+0.36,tz);
  // 坐圈/碗沿（比底座宽一圈，前缘略突出）
  box(0.44,0.10,0.50,mPorcelain, tx,cy+0.47,tz+0.02);
  // 马桶盖（盖在碗沿上，微微抬起一点点角度——破败的家盖子没合严）
  box(0.42,0.05,0.46,mPorcelain, tx,cy+0.535,tz+0.02, -0.06,0,0);
  // 水箱（立在后方、贴墙，背面朝 -z）
  box(0.46,0.42,0.20,mPorcelainDirty, tx,cy+0.70,tz-0.27);
  // 水箱盖（压在水箱顶，略宽出沿）
  box(0.50,0.05,0.24,mPorcelain, tx,cy+0.935,tz-0.27);
  // 冲水按钮（镀铬小方块，画面里一个亮点）
  box(0.07,0.025,0.05,mChrome, tx,cy+0.965,tz-0.27);

  // ============================================================
  // 二、洗手台（放在角落 +x 半边，背靠 -z 墙）
  //   结构：下柜（柜体 + 两扇门缝）+ 台面 + 台上盆 + 水龙头。
  // ============================================================
  const wx=cx+0.42;            // 洗手台中心 x（偏右半）
  const wz=cz-0.40;            // 贴 -z 墙
  const counterTop=cy+0.82;    // 台面高度（约 82cm，符合真实台盆高）

  // 下柜柜体（深灰带锈的木柜，破败感主担当）
  box(0.62,0.74,0.46,mGrime, wx,cy+0.40,wz);
  // 柜门缝：中间一条竖向暗缝，做出"双开门"暗示（用一块更暗的薄板贴上去）
  box(0.02,0.62,0.01,new THREE.MeshStandardMaterial({color:0x2e2c28,roughness:1}), wx,cy+0.42,wz+0.235);
  // 两个柜门拉手（镀铬小竖条）
  box(0.02,0.10,0.03,mChrome, wx-0.13,cy+0.46,wz+0.24);
  box(0.02,0.10,0.03,mChrome, wx+0.13,cy+0.46,wz+0.24);
  // 台面（白瓷台板，比柜体宽出一圈台沿）
  box(0.70,0.06,0.52,mPorcelain, wx,counterTop,wz+0.01);
  // 台上洗手盆：用一个浅盆——外盆 + 内凹（内凹用一块更暗的小方块"掏"出阴影感）
  box(0.34,0.10,0.30,mPorcelain, wx,counterTop+0.085,wz+0.02);
  box(0.24,0.06,0.20,mPorcelainDirty, wx,counterTop+0.105,wz+0.02);
  // 水龙头：底座 + 立柱 + 横出水嘴（三段镀铬，几何精细的小亮点）
  box(0.07,0.04,0.07,mChrome, wx,counterTop+0.06,wz-0.16);          // 底座
  box(0.035,0.16,0.035,mChrome, wx,counterTop+0.14,wz-0.16);        // 立柱
  box(0.035,0.035,0.14,mChrome, wx,counterTop+0.21,wz-0.10);        // 出水横臂
  box(0.05,0.07,0.03,mChrome, wx+0.08,counterTop+0.10,wz-0.16, 0,0,0.6); // 侧把手（斜一点）

  // ============================================================
  // 三、墙上镜子（挂在 -z 墙上、洗手台正上方）
  //   结构：锈蚀镜框 + 镜面，镜面右下角"裂掉一块"——地震后的破败叙事。
  // ============================================================
  const mirrorY=cy+1.45;       // 镜子中心高度（约成人视线略上）
  const mirrorZ=cz-0.62;       // 紧贴 -z 墙面，比墙稍微突出一点
  // 镜框（比镜面大一圈的暗框）
  box(0.62,0.74,0.04,mGrime, wx,mirrorY,mirrorZ);
  // 镜面（嵌在框里，略往前一点点免得 z-fighting）
  box(0.54,0.66,0.02,mMirror, wx,mirrorY,mirrorZ+0.015);
  // 裂缝：右下角斜贴一条暗线，暗示玻璃裂了（旋转 rz 让它斜着走）
  box(0.30,0.012,0.005,new THREE.MeshStandardMaterial({color:0x33312d,roughness:1}),
      wx+0.08,mirrorY-0.16,mirrorZ+0.025, 0,0,-0.7);
  box(0.18,0.012,0.005,new THREE.MeshStandardMaterial({color:0x33312d,roughness:1}),
      wx+0.14,mirrorY-0.08,mirrorZ+0.025, 0,0,0.4);

  // ============================================================
  // 四、破败点缀：地上一摊"积水/瓷砖碎渣"，强化地震后的家。
  //   用一块极薄、低洼的暗板贴地，模拟漏水积成的水渍。
  // ============================================================
  const mWater=new THREE.MeshStandardMaterial({color:0x3a4246,roughness:0.15,metalness:0.3,transparent:true,opacity:0.55});
  box(0.55,0.01,0.40,mWater, cx-0.1,cy+0.012,cz+0.35);  // 地面水渍（反光，和暖光对比）
  box(0.12,0.04,0.10,mPorcelainDirty, cx+0.2,cy+0.03,cz+0.30); // 掉落的瓷片碎块

  // ============================================================
  // 五、光源：一盏暖色点光（冷暖对比的灵魂）
  //   放在镜子上方，像残存的镜前灯——暖橙色，照在冷白瓷上形成质感对比。
  //   把它想象成"断电后唯一还忽闪的应急灯"——暖光打在死白的瓷面上，
  //   冷暖一撞，破败的空间立刻有了戏剧张力。
  //   intensity/distance/decay 调得克制：只点亮这一角，不污染整间屋的冷调。
  // ============================================================
  const warmLight=new THREE.PointLight(0xffb060, 0.9, 3.2, 2.0);
  warmLight.position.set(wx, cy+1.95, cz-0.3);
  scene.add(warmLight);

  // 返回光源，方便外部需要时进一步控制（闪烁/熄灭等），不需要可忽略。
  return warmLight;
}

// ==== 破败高大双门衣柜 (makeWardrobe) ====
function makeWardrobe(cx,cy,cz){
  // ---- 1. 本柜专用材质（函数内自造，纯色程序化，不依赖外部材质名，避免名字对不上崩） ----
  // 设计思路：SCP 收容失效 = 灰白冷调 + 漆面剥落。深一档做柜体、浅一档做门板，制造层次。
  const mCarcass = new THREE.MeshStandardMaterial({color:0x4b4641, roughness:0.93, metalness:0.04}); // 柜体骨架：脏灰褐木
  const mDoor    = new THREE.MeshStandardMaterial({color:0x6f6a61, roughness:0.88, metalness:0.04}); // 门板：蒙尘的灰白
  const mDoorDk  = new THREE.MeshStandardMaterial({color:0x3d3934, roughness:0.95, metalness:0.03}); // 门缝/凹槽阴影色
  const mPanel   = new THREE.MeshStandardMaterial({color:0x57524b, roughness:0.9,  metalness:0.04}); // 门芯嵌板
  const mTrim    = new THREE.MeshStandardMaterial({color:0x787169, roughness:0.85, metalness:0.05}); // 顶/底封边亮线
  const mHandle  = new THREE.MeshStandardMaterial({color:0x8d9298, roughness:0.35, metalness:0.85}); // 金属拉手：冷反光
  const mHinge   = new THREE.MeshStandardMaterial({color:0x55585c, roughness:0.5,  metalness:0.7});  // 合页：暗金属
  const mGap     = new THREE.MeshStandardMaterial({color:0x161310, roughness:1.0,  metalness:0.0});  // 门内黑缝：露出虚掩的黑
  const mRust    = new THREE.MeshStandardMaterial({color:0x5a3a26, roughness:1.0,  metalness:0.1});  // 锈渍/水渍暖褐

  // ---- 2. 尺寸常量（真实比例：宽1.6 高2.4 厚0.58，厚重到地震会压死人） ----
  const W=1.6, H=2.4, D=0.58;          // 整体外包络
  const wall=0.05;                      // 板材厚度（厚板=重，强化“会砸死人”的体量感）
  const x=cx, z=cz, base=cy;            // base 是地面 y，柜子从地面往上长

  // 把“加进场景并设旋转”封装一下：box() 第8参在不同版本里或是父组、或不存在，
  // 这里统一用返回的 mesh 自己设 rotation/position，旋转就稳，永不依赖 box 的可选参数。
  const put=(w,h,d,m,px,py,pz,rx,ry,rz)=>{
    const e=box(w,h,d,m,px,py,pz,scene);   // 传 scene 作父组，确保挂得上
    if(rx||ry||rz) e.rotation.set(rx||0,ry||0,rz||0);
    e.castShadow=true; e.receiveShadow=true;
    return e;
  };

  // ---- 3. 柜体外壳：左右侧板 + 背板 + 顶底，拼出“有壁厚的箱子”而非实心方块 ----
  put(wall,H,D, mCarcass, x-W/2+wall/2, base+H/2, z);              // 左侧板
  put(wall,H,D, mCarcass, x+W/2-wall/2, base+H/2, z);              // 右侧板
  put(W,wall,D, mCarcass, x, base+wall/2, z);                      // 底板
  put(W,wall,D, mCarcass, x, base+H-wall/2, z);                    // 顶板（内层）
  put(W,H,wall, mCarcass, x, base+H/2, z-D/2+wall/2);              // 背板
  put(W-2*wall, H-2*wall, wall, mDoorDk, x, base+H/2, z-D/2+wall+0.005); // 内腔暗背，让门缝透出深色

  // ---- 4. 顶部细节：双层挑檐（冠饰），制造厚重压顶感——地震时正是这块先砸下 ----
  put(W+0.10, 0.08, D+0.10, mTrim,    x, base+H+0.04, z);          // 上挑檐（亮封边）
  put(W+0.04, 0.06, D+0.04, mCarcass, x, base+H-0.03, z);          // 下挑檐过渡
  put(W*0.5, 0.05, D*0.5,  mRust,     x-0.1, base+H+0.085, z+0.05);// 顶面一摊积灰/水渍

  // ---- 5. 踢脚底座：内缩一圈，让柜子“坐”在地上有承重感 ----
  put(W-0.12, 0.12, D-0.08, mDoorDk, x, base+0.06, z);

  // ---- 6. 两扇门：左门虚掩半开(0.34rad)、右门关闭。半开露黑暗内腔 = 破败遗弃感 ----
  // 一扇门由“门板 + 凹陷嵌板 + 拉手 + 两枚合页”组成，靠多 box 叠出立体门，而非一张平板。
  const doorW=(W-3*0.02)/2;   // 两门中间留 0.02 门缝，各占一半
  const doorH=H-0.12;
  const doorZ=z+D/2-0.015;    // 门贴在柜体正面
  const buildDoor=(side,open)=>{
    // side: -1 左门 / +1 右门；open: 开合弧度（绕各自外侧竖边旋转）
    const cxd = x + side*(0.01 + doorW/2);           // 关闭时门板中心 x
    const g = put(doorW, doorH, 0.04, mDoor, cxd, base+0.06+doorH/2, doorZ); // 门板主体
    if(open) g.rotation.set(0, side*-open, 0);        // 虚掩：绕 y 转，朝外开
    // 凹陷嵌板（两块竖直长方装饰，欧式柜门经典造型，加层次破单调）
    put(doorW*0.62, doorH*0.4, 0.012, mPanel, cxd, base+0.06+doorH*0.30, doorZ+0.022, 0, g.rotation.y, 0);
    put(doorW*0.62, doorH*0.4, 0.012, mPanel, cxd, base+0.06+doorH*0.70, doorZ+0.022, 0, g.rotation.y, 0);
    // 拉手：一根竖直金属条，装在门的内侧边（靠门缝那侧）
    const hx = cxd - side*(doorW/2-0.06);
    put(0.025, 0.34, 0.05, mHandle, hx, base+0.06+doorH*0.52, doorZ+0.05, 0, g.rotation.y, 0);
    // 两枚合页：装在门的外侧边
    const ox = cxd + side*(doorW/2-0.03);
    put(0.04,0.12,0.05, mHinge, ox, base+0.06+doorH*0.78, doorZ-0.01);
    put(0.04,0.12,0.05, mHinge, ox, base+0.06+doorH*0.24, doorZ-0.01);
  };
  buildDoor(-1, 0.34);   // 左门：虚掩半开
  buildDoor(+1, 0);      // 右门：关闭

  // 左门半开 → 露出门后的黑暗内腔（一块纯黑面板，营造“里面有东西”的不安）
  put(doorW*0.7, doorH*0.85, 0.02, mGap, x-doorW*0.55, base+0.06+doorH*0.5, z-0.02);

  // ---- 7. 破败细节：剥落的漆皮 + 斜挂污渍 + 门缝裂痕 ----
  put(0.22,0.30,0.01, mRust,    x+W*0.28, base+H*0.62, z+D/2+0.001, 0,0,0.3);   // 右门一块锈黄水渍
  put(0.14,0.5,0.01,  mDoorDk,  x-W*0.30, base+H*0.40, z+D/2+0.001, 0,0,-0.18); // 左门一道剥漆深痕
  put(0.4,0.05,0.01,  mDoorDk,  x, base+H*0.50, z+D/2+0.002);                    // 门缝中央横向裂痕

  // ---- 8. 暖色点光源：冷调灰柜旁打一盏微弱暖灯，制造冷暖对比(质感灵魂) ----
  // 设计思路：柜体全是灰白冷色，眼睛会觉得“死”。在虚掩门缝处藏一盏低强度暖橙光，
  // 像柜里漏出的余晖，既照亮破败细节，又和整体冷灰拉出温度差，画面立刻“活”。
  const glow=new THREE.PointLight(0xff9a4d, 0.9, 3.2, 2.0);  // 暖橙 / 弱 / 短射程，只舔亮柜门一角
  glow.position.set(x-doorW*0.4, base+H*0.55, z+0.15);
  scene.add(glow);

  return glow; // 返回光源，调用方需要时可调暗/关掉
}

// ==== 精细双人床（蒙尘破败） (makeBed) ====
function makeBed(cx,cy,cz){
  // ============================================================
  // 精细双人床（SCP 收容失效 / 灰白破败风）
  // 结构：四腿 + 木床架外框 + 床头/床尾板 + 下陷床垫 + 错落褶皱被子堆 + 两枕头 + 蒙尘膜 + 一盏暖点光
  // 设计思路：冷灰主调铺满破败感，再在床头压一盏低强度暖灯做冷暖对比——这是质感的灵魂。
  // 接口约定：用全局 box(w,h,d,mat,x,y,z) 生成带阴影盒子。为了"无论 box 是否支持末位旋转参都不崩"，
  //          这里用内部小工具 b() 包一层：先调 box 摆好位置，再把旋转直接写到返回 mesh 上（更稳）。
  // 坐标：cx/cy/cz 是床的放置中心，cy 是地面 y，所有部件从地面往上长。
  // ============================================================

  // ── 局部程序化材质（纯色，零贴图，守 8MB 红线）。比全局材质更偏冷灰、更脏，贴合"地震后的家" ──
  const mFrame    = new THREE.MeshStandardMaterial({color:0x4a3a28, roughness:0.92, metalness:0.04}); // 深木床架
  const mFrameTop = new THREE.MeshStandardMaterial({color:0x5a4734, roughness:0.88, metalness:0.04}); // 床架顶沿（略亮，做转折高光）
  const mMattress = new THREE.MeshStandardMaterial({color:0xb8b0a2, roughness:0.97, metalness:0.0});  // 床垫（脏白）
  const mQuilt    = new THREE.MeshStandardMaterial({color:0xa8a298, roughness:0.98, metalness:0.0});  // 被子主色（灰米）
  const mQuiltSh  = new THREE.MeshStandardMaterial({color:0x8f8a80, roughness:0.99, metalness:0.0});  // 被子暗面（褶皱阴影）
  const mPillow   = new THREE.MeshStandardMaterial({color:0xc9c3b6, roughness:0.96, metalness:0.0});  // 枕头（稍亮的脏白）
  const mDust     = new THREE.MeshStandardMaterial({color:0x6f6a60, roughness:1.0,  metalness:0.0, transparent:true, opacity:0.5}); // 半透灰膜=蒙尘
  const mLeg      = new THREE.MeshStandardMaterial({color:0x352a1c, roughness:0.9,  metalness:0.05}); // 床腿（最暗）

  // 内部摆放工具：把"相对床中心的偏移 (x,y,z)"换算成世界坐标交给全局 box，
  // 再把旋转弧度直接 set 到返回的 mesh 上——这样即便全局 box 不读末位 rx/ry/rz 也照样转得动。
  // 可以把它想象成"装修工"：你只说"在床中心右前方、抬高一点、歪 10 度放块被子"，它负责换算落点。
  function b(w,h,d,m,x,y,z,rx,ry,rz){
    const e = box(w,h,d,m, cx+x, cy+y, cz+z);
    if(rx||ry||rz){ e.rotation.set(rx||0, ry||0, rz||0); }
    return e;
  }

  // 关键尺寸（真实比例：约 2.0m 宽 × 1.6m 长，标准双人床体量）
  const W=2.0, L=1.6;
  const legH=0.18;                 // 床腿高
  const frameTopY=legH+0.16;       // 床架外框顶部 y
  const deckY=legH+0.18;           // 床板（垫子底）y
  const matH=0.26;                 // 床垫厚
  const matTopY=deckY+matH;        // 床垫顶面 y

  // ── 四条床腿（缩在四角内侧一点，更像真家具）──
  const lx=W/2-0.12, lz=L/2-0.12;
  [[-lx,-lz],[lx,-lz],[-lx,lz],[lx,lz]].forEach(p=>b(0.12,legH,0.12,mLeg,p[0],legH/2,p[1]));

  // ── 床架外框：四条侧板围一圈，再压两条顶沿做木质转折高光 ──
  b(W,0.16,0.14,mFrame, 0, frameTopY-0.08, -L/2+0.07);
  b(W,0.16,0.14,mFrame, 0, frameTopY-0.08,  L/2-0.07);
  b(0.14,0.16,L-0.14,mFrame, -W/2+0.07, frameTopY-0.08, 0);
  b(0.14,0.16,L-0.14,mFrame,  W/2-0.07, frameTopY-0.08, 0);
  b(W,0.04,0.16,mFrameTop, 0, frameTopY+0.02, -L/2+0.08);
  b(W,0.04,0.16,mFrameTop, 0, frameTopY+0.02,  L/2-0.08);

  // ── 床头板（高，带一条横档 + 两根立柱，破败木结构感）──
  b(W,0.66,0.1,mFrame, 0, frameTopY+0.3, -L/2+0.02);
  b(W-0.3,0.12,0.06,mFrameTop, 0, frameTopY+0.5, -L/2-0.01);
  b(0.1,0.7,0.12,mFrame, -W/2+0.05, frameTopY+0.32, -L/2+0.02);
  b(0.1,0.7,0.12,mFrame,  W/2-0.05, frameTopY+0.32, -L/2+0.02);
  // ── 床尾板（矮）──
  b(W,0.3,0.1,mFrame, 0, frameTopY+0.12, L/2-0.02);

  // ── 床垫（顶上叠一层略小的薄片，制造中央下陷/塌软感）──
  b(W-0.18,matH,L-0.16,mMattress, 0, deckY+matH/2, 0.02);
  b(W-0.3,0.04,L-0.3,mMattress, 0, matTopY-0.01, 0.04);

  // ── 褶皱被子：多块错落 + 微旋转的 box 堆叠，模拟掀乱的被子堆（盖住下半身）──
  const qBaseY = matTopY+0.04;
  b(W-0.22,0.14,0.95,mQuilt, 0, qBaseY, 0.28);                          // 主被毯
  b(0.9,0.12,0.5,mQuiltSh, -0.32, qBaseY+0.1, 0.42, 0.05,0.18,-0.06);   // 隆起褶皱 1（暗面）
  b(0.7,0.1,0.42,mQuilt,    0.38, qBaseY+0.09, 0.18, -0.04,-0.22,0.05); // 褶皱 2
  b(0.55,0.09,0.36,mQuiltSh,0.05, qBaseY+0.13, 0.55, 0.03,0.4,0.04);    // 褶皱 3（最高峰）
  b(0.5,0.08,0.3,mQuilt,   -0.55, qBaseY+0.07, 0.6, 0.06,-0.3,0.0);     // 掀开的一角
  b(0.4,0.22,0.12,mQuiltSh,-0.78, qBaseY-0.02, 0.5, 0.0,0.2,0.5);       // 垂出床沿外的被角（竖着掉下去）

  // ── 两个枕头（靠床头，各自略歪，没人睡过似的乱）──
  b(0.62,0.16,0.4,mPillow, -0.45, matTopY+0.12, -0.46, 0.0,0.12,0.04);
  b(0.62,0.16,0.4,mPillow,  0.45, matTopY+0.11, -0.5, 0.0,-0.16,-0.03);

  // ── 蒙尘层：在被子/两枕头顶各铺一张半透灰膜，远看像积了一层灰（破败感灵魂）──
  b(W-0.2,0.015,L-0.2,mDust, 0, matTopY+0.2, 0.1);
  b(0.66,0.012,0.44,mDust, -0.45, matTopY+0.21, -0.46);
  b(0.66,0.012,0.44,mDust,  0.45, matTopY+0.21, -0.5);

  // ── 暖色点光源：冷灰场景里压一盏低强度暖灯（床头斜上方），冷暖对比把床"焐活"──
  // 距离 4.2 + 衰减 2.0，光只罩住床周围，不污染整间冷调房。
  const warm = new THREE.PointLight(0xffb070, 0.9, 4.2, 2.0);
  warm.position.set(cx-0.7, cy+matTopY+0.7, cz-L/2+0.4);
  scene.add(warm);

  return warm;
}
