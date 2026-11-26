/**
 * world3d.js —— 3D 实验台共享世界常量与小工具
 *
 * 本文件是整个 3D 场景的“世界坐标唯一真相源”：
 *   器件组件（Battery3D / Switch3D / Bulb3D）只负责自身造型与电气逻辑，
 *   它们放置在哪、桌子多大、电缆如何下垂，全部由这里的 WORLD 常量统一约定。
 *
 * 世界坐标约定（单位≈米）：
 *   x 沿桌面长边（右为正）、z 沿短边（前为正）、y 向上；
 *   桌面顶面高度 y = WORLD.tableTop。
 */
export const WORLD = {
    // ── 实验桌几何 ──────────────────────────────────────────────
    tableTop: 0.82,                        // 桌面顶面高度：所有器件 root.y 都贴这个值（约定式贴合，非物理碰撞）
    tableW: 3.2, tableD: 1.7, tableH: 0.08,// 桌面长 3.2m、宽 1.7m、板厚 0.08m
    legW: 0.09, legH: 0.74,                // 桌腿截面 0.09m 见方、高 0.74m（0.74 + 0.08 = 0.82 桌面顶高）

    // ── 四器件布局：电池左前、开关后中、变阻器中前、灯泡右前 ──────
    // 长条变阻器居中、开关退到后排：四条标准连线路径互不重合，视觉清晰
    batX: -1.05, batZ: 0.30,               // 电池：桌面左前
    swX: 0.0,   swZ: -0.42,                // 闸刀开关：桌面上后方居中
    rheX: 0.0,  rheZ: 0.34,                // 滑动变阻器：桌面中前（长条机身，左右留空给电池/灯泡）
    bulbX: 1.05, bulbZ: 0.30,             // 灯泡：桌面右前
    mmX: 1.30,  mmZ: -0.42,               // 万用表：桌面右后（偏右错开灯泡，默认视角下不被遮挡）

    // ── 电缆造型参数 ────────────────────────────────────────────
    cableSagY: 0.86,                       // 电缆下垂中部高度（略高于桌面 0.04m，呈自然垂度又不拖到桌面上）
    cableR: 0.016,                        // 电缆实体半径（TubeGeometry 管半径）
    openLeverAngle: 0.92,                  // 闸刀分闸旋转角（弧度，约 53°，合闸为 0）
};

/** 端点在器件足迹内时的水平“逃逸点”：
 *  沿指向对端的方向退出足迹矩形，高度保持在器件顶面之上，
 *  避免电缆离开接线柱后斜穿器件本体（如穿入电池盒内部）。
 *
 * 参数：
 *   THREE —— three.js 命名空间（宿主组件传入，避免本文件绑定具体版本）
 *   a     —— 本端端子的世界坐标（射线的起点）
 *   other —— 对端端子的世界坐标（决定逃逸方向：朝对端走最短路径）
 *   fp    —— 本端器件的足迹 {cx, cz, hx, hz, top}（中心、半长宽、顶面高度）
 * 返回：逃逸点坐标；端点不在足迹内返回 null（无需逃逸）
 */
function _escapePoint(THREE, a, other, fp) {
    if (!fp) return null;                                          // 没有足迹信息（如对端是 2D 仪表的混合线）→ 不逃逸
    const hx = fp.hx + 0.04, hz = fp.hz + 0.04;                    // 足迹半尺寸外扩 0.04m 安全余量，电缆不擦盒壁
    const dx = a.x - fp.cx, dz = a.z - fp.cz;                       // 端点相对足迹中心的偏移
    if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) return null;     // 端点已在足迹矩形之外 → 电缆直接下垂即可，无需逃逸
    let ux = other.x - a.x, uz = other.z - a.z;                     // 逃逸方向：由本端指向对端（世界 XZ 平面）
    const len = Math.hypot(ux, uz);                                 // 方向向量长度
    if (len < 1e-4) { ux = -dx; uz = -dz; }                        // 两端点几乎重合 → 退化为“背离足迹中心”方向
    else { ux /= len; uz /= len; }                                  // 正常情况：归一化为单位方向向量
    // 在 XZ 平面上做“矩形边界射线求交”：算出沿 (ux,uz) 走多远能出足迹矩形
    // x 轴边界距离 tx：方向朝 +x 取右边界 (hx-dx)/ux；朝 -x 取左边界 (-hx-dx)/ux；x 分量为 0 取 Infinity（永远走不出 x 边界）
    const tx = ux > 1e-6 ? (hx - dx) / ux : (ux < -1e-6 ? (-hx - dx) / ux : Infinity);
    // z 轴边界距离 tz：同理
    const tz = uz > 1e-6 ? (hz - dz) / uz : (uz < -1e-6 ? (-hz - dz) / uz : Infinity);
    const t = Math.min(tx, tz) + 0.06;                              // 取最近边界距离，再外推 0.06m，保证整根电缆都离开盒体
    // 逃逸点高度：优先用器件自声明的 fp.escapeY（本地高度，宿主已换算到世界），未声明时退回 fp.top
    //   · fp.escapeY 的语义是“电缆从这个高度水平伸出就不会撞到自己的本体”：
    //     电池/开关 → 接线柱顶（略高于端子即可，水平段能越过同器件另一根柱）
    //     万用表  → 插孔柱高度（插孔位于面板前表面之外，抬高 5cm 就能水平走出，绝不翻过表顶挡住面板）
    //   · 未声明 escapeY 的器件退回 fp.top（灯泡=玻璃泡顶、变阻器=滑片顶），
    //     电缆从结构最高点上方绕行，因此不会像早期版本那样横穿玻璃泡或绕线管
    const base = fp.escapeY != null ? fp.escapeY : fp.top;          // 安全逃逸基准高度（世界坐标）
    const ey = Math.max(a.y + 0.002, base + 0.05);                  // 逃逸高度：不低于端子，且高出结构 5cm
    return new THREE.Vector3(a.x + ux * t, ey, a.z + uz * t);
}

/** 端子间下垂电缆曲线：端点先逃逸出器件足迹，中部再下垂。
 *
 * 这是 3D 接线的核心曲线算法，生成的 CatmullRomCurve3 供 TubeGeometry 挤成实体电缆。
 * 控制点序列（最多 8 个）：
 *   [端子A, A竖直升降点, A逃逸点, 中垂1, 中垂2, B逃逸点, B竖直升降点, 端子B]
 *
 * 参数：
 *   a/b  —— 两端端子世界坐标（3D 端子时位于接线柱顶端）
 *   sagY —— 电缆中部下垂到的高度（默认 WORLD.cableSagY = 0.86）
 *   fpA/fpB —— 两端各自器件的足迹（可为 null：2D 仪表端无足迹）
 */
export function sagCurve(THREE, a, b, sagY = WORLD.cableSagY, fpA = null, fpB = null) {
    // 先算两端的逃逸点：各自沿“指向对端”的方向退出自己的足迹
    const ea = _escapePoint(THREE, a, b, fpA);                       // A 端逃逸点（端子在足迹外时为 null）
    const eb = _escapePoint(THREE, b, a, fpB);                       // B 端逃逸点
    const s0 = ea || a, s1 = eb || b;                                // 中段下垂的起止参考：有逃逸点用逃逸点，否则直接用端子
    const m1 = s0.clone().lerp(s1, 0.35);                            // 中垂控制点1：两参考点的 35% 插值处
    const m2 = s0.clone().lerp(s1, 0.65);                            // 中垂控制点2：65% 插值处（两点错开让曲线平滑无尖角）
    m1.y = sagY;                                                     // 压低到下垂高度 → 电缆中段自然垂落
    m2.y = sagY;
    const pts = [a.clone()];                                         // 控制点序列从 A 端子本身开始（clone：不污染调用方的向量）
    // 两段式逃逸：先在端子正上/下方竖直升降到逃逸高度（紧贴接线柱，不斜穿器件侧壁），
    // 再水平走到足迹边缘 —— 水平段恒高于器件顶面，“斜线擦穿本体”在结构上不再可能
    if (ea) pts.push(new THREE.Vector3(a.x, ea.y, a.z), ea);         // A 竖直升降点（同 XZ、改 y）→ A 水平逃逸点
    pts.push(m1, m2);                                                // 中部下垂两控制点
    if (eb) pts.push(eb, new THREE.Vector3(b.x, eb.y, b.z));        // B 水平逃逸点 → B 竖直下降点（回到端子正上方）
    pts.push(b.clone());                                             // 终点：B 端子本身
    // CatmullRom 过所有控制点平滑插值（非闭合曲线），后续 TubeGeometry 沿它挤出圆管
    return new THREE.CatmullRomCurve3(pts);
}

/** Canvas 文字贴图（浅字深描边，适合贴在木质桌面上）。
 *  three.js 的文字必须先画进 <canvas> 再包装成 CanvasTexture 贴到几何面上。
 */
export function makeTextTexture(THREE, text, opt = {}) {
    const px = opt.px || 512;                                        // 贴图画布宽度（像素），文字量大时可调高
    const py = opt.py || 192;                                        // 贴图画布高度
    const color = opt.color || '#f2ead9';                           // 字体颜色：米白（浅）
    const outline = opt.outline || '#1a1206';                       // 描边颜色：深棕黑（与桌面木色对比清晰）
    const font = opt.font || `bold ${Math.floor(py * 0.5)}px sans-serif`; // 字号 = 画布高的一半，bold 保证远看清晰

    const cv = document.createElement('canvas');                    // 离屏 canvas（不挂进 DOM）
    cv.width = px;                                                   // 注意：canvas 尺寸必须在 getContext 前设置才生效
    cv.height = py;
    const ctx = cv.getContext('2d');                                // 取 2D 绘图上下文
    ctx.font = font;                                                 // 字体样式
    ctx.textAlign = 'center';                                        // 水平居中锚定
    ctx.textBaseline = 'middle';                                     // 垂直居中锚定
    ctx.lineWidth = py * 0.075;                                      // 描边线宽：画布高的 7.5%
    ctx.strokeStyle = outline;                                       // 先画描边（在底层）
    ctx.strokeText(text, px / 2, py / 2);                            // 描边字画在画布正中
    ctx.fillStyle = color;                                           // 再填充字色（盖在描边之上）
    ctx.fillText(text, px / 2, py / 2);                              // 填充字与描边字同位置叠印

    const tex = new THREE.CanvasTexture(cv);                        // canvas 包装成 three 纹理
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; // 指定 sRGB 色彩空间（r152+ 必需，旧版无此属性则跳过）
    tex.anisotropy = 4;                                              // 各向异性过滤 4x：斜视角看桌面文字不糊
    return tex;
}

/** 平铺在桌面上的文字标签（不可交互，仅提示器件名称）。
 *  PlaneGeometry 旋转到水平后放在桌面上方 2mm，跟随宿主的桌面坐标。
 */
export function makeTableLabel(THREE, text, x, z, w = 0.46, h = 0.172, px = 512) {
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),                               // 默认竖直的矩形平面
        new THREE.MeshBasicMaterial({                                // Basic 材质：不受光照影响，文字始终清晰
            map: makeTextTexture(THREE, text, { px }),              // 贴上面生成的文字贴图（长名加宽画布，避免字被拉伸）
            transparent: true,                                       // 贴图空白处透明
            depthWrite: false,                                       // 不写深度：避免半透明面与桌面 z-fighting
        })
    );
    m.rotation.x = -Math.PI / 2;                                     // 绕 x 轴转 -90°：竖直平面放倒成水平（面朝上）
    m.position.set(x, WORLD.tableTop + 0.002, z);                   // 放在指定桌面位置、高出桌面 2mm 防 z-fighting
    return m;
}
