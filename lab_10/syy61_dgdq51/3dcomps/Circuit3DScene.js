/**
 * Circuit3DScene —— three.js 真 3D 实验台宿主组件
 *
 * 职责：
 *   1. 在 Konva 画布上方挂一块 DOM 视窗（WebGL canvas），内建真 3D 实验室
 *      场景：地面网格 + 长方形木桌（桌面 + 四腿 + 横撑）+ 桌面器件标签。
 *   2. 接收 3D 器件（Battery3D / Switch3D / Bulb3D …）注册：buildThree()
 *      返回的 root 挂到场景，接线柱登记进 _portRegistry。
 *   3. 射线拾取交互：
 *      - 点击接线柱 → sys.handlePortClick(comp, fullPort, 'wire')，复用平台
 *        原有连线流程（首点建立 linkingState，次点成线 + 历史记录/撤销）；
 *      - 点击闸刀手柄 → Switch3D.toggle()（合/分闸动画在器件 tick 内完成）；
 *      - 双击 3D 电缆 → removeConnWithHistory 拆线。
 *   4. 3D 连线动态生成：两端都在 3D 器件上的 wire conn 标记 custom=true
 *      （2D Renderer 不再绘制），由本组件按 CatmullRom 下垂曲线 + TubeGeometry
 *      生成电缆，带生长动画；接线过程中实时显示下垂预览线。
 *   5. 每 tick 将接线柱世界坐标投影到屏幕，同步器件的 Konva 端口锚点
 *      （供 2D 仪表连线/电压读取使用）。
 *
 * 相机交互：OrbitControls（左键旋转、滚轮缩放、右键平移、阻尼）。
 */
import * as THREE from 'three';                                            // three.js 核心（场景/相机/渲染器/射线）
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'; // 官方轨道相机控件（r187 examples/jsm 路径）
import { BaseComponent } from '../components/BaseComponent.js';            // 平台组件基类（本组件同时是 Konva 图层占位者）
import { WORLD, sagCurve, makeTableLabel } from './world3d.js';            // 世界常量、下垂曲线生成器、canvas 文字标签

export class Circuit3DScene extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);                                                // 基类构造：建 Konva group、登记进 sys.comps

        this.type = 'circuit3d';                                           // 类型标识（非电气设备：不进求解器设备表）
        this.cache = false;                                                // 本组件没有 2D 画面可缓存，永不缓存位图
        this.group.draggable(false);                                       // 场景视窗框不许在 Konva 层被拖走
        this.width = config.width || 1400;                                  // 视窗逻辑宽（1920×1080 基准），缺省 1400
        this.height = config.height || 780;                                 // 视窗逻辑高，缺省 780

        this._initGroups();                                                // 基类标准三组（static/dynamic/interact，本组件闲置）

        // ── 状态登记表 ──
        this._devices = [];                                                // 已注册的 3D 器件组件数组（Battery3D/Switch3D/Bulb3D…）
        this._portRegistry = new Map();  // fullPortId -> {comp, port, mesh, hit, tip, node}   // 端子注册表：全名端口 → 视觉柱/拾取柱/锚点
        this._pickTerminals = [];         // 接线柱拾取盒                    // 射线拾取列表①：所有端子透明柱
        this._pickSwitch = [];             // 闸刀手柄拾取盒                  // 射线拾取列表②：手柄透明盒
        this._cables = new Map();         // connKey -> {mesh, conn, born, done}           // 3D 电缆表：排序端口对 → 电缆网格+生长动画状态
        this._cableSig = '';                                               // 电缆集合签名（含端点世界坐标）：签名变了才重建
        this._preview = null;                                              // 接线预览电缆网格（接线中显示，随时可弃）
        this._hovered = null;                                              // 当前悬停高亮的视觉网格
        this._hoverBase = null;                                            // 悬停前的自发光原值（离开时还原用）
        this._mouse = null;                                                // 视窗内鼠标状态（NDC 归一化坐标）
        this._down = null;                                                 // pointerdown 落点（判点击 vs 拖动）
        this._lastClick = null;                                            // 最近一次点击记录（双击拆线时撤误触连线用）
        this._lastSwitchT = 0;                                             // 闸刀最近翻转时刻（双击防抖）
        this._tmpV = new THREE.Vector3();                                 // 复用向量（避免每帧 new 产生 GC 压力）
        this._cursor = null;                                               // 全窗口光标位置（覆盖层预览线用，可出视窗）
        this._compFp = new Map();       // compId -> 器件足迹（相对量 + root 引用）         // 器件足迹表：拖动后位置实时变化，存“相对量+root 引用”
        this._drag = null;               // 器件本体拖动状态                  // 当前拖动中的器件（null=不在拖器件）

        this._initViewport();                                              // 建 DOM 视窗 + 操作提示条 + 2D 覆盖层
        this._initThree();                                                 // 建 WebGL 渲染器/场景/相机/灯光/环境
        this._bindEvents();                                                // 指针/滚轮/右键/全局监听全套
        this._startLoop();                                                 // rAF 渲染循环（按需渲染）

        // Esc 取消连线
        this._escHandler = (e) => {                                        // 全局键盘监听（destroy 时成对移除）
            if (e.key === 'Escape' && this.sys && this.sys.linkingState && this.sys.connMgr) { // 仅在接线中才响应
                try { this.sys.connMgr.resetLinking(); } catch (err) { /* ignore */ }        // 复位平台连线态（try 兜底防断言崩溃）
                this._disposePreview();                                    // 弃掉 3D 预览电缆
            }
        };
        window.addEventListener('keydown', this._escHandler);              // 挂 window：焦点不在视窗也能取消
    }

    // ════════════════════════ 视窗 DOM ════════════════════════

    /** 建 DOM 视窗：absolute 定位的 div（内装 WebGL canvas）+ 提示条 + 全幅覆盖层。
     *  位置与 Konva group 同位 —— consys 已按 1920×1080 基准把 group 摆好，
     *  div 直接抄 group.x()/y()，与 2D 画布严格对齐。
     */
    _initViewport() {
        const container = this.sys.stage.container();                      // Konva 舞台容器（#container，相对布局）
        const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080); // 全局适配缩放（与 consys 同式）
        const w = Math.max(320, Math.round(this.width * scale));           // 视窗实宽=逻辑宽×缩放，下限 320 保小屏可用
        const h = Math.max(240, Math.round(this.height * scale));          // 视窗实高，下限 240
        this._vpW = w;                                                     // 存成员：投影/射线换算处处要用
        this._vpH = h;

        this._vp = document.createElement('div');                          // 3D 视窗本体
        this._vp.style.cssText = `                                         // inline 样式一次写全
            position: absolute;                                             // 相对 #container 定位（容器 position:relative）
            left: ${this.group.x()}px; top: ${this.group.y()}px;           // 与 Konva group 同点对齐
            width: ${w}px; height: ${h}px;
            border: 2px solid #3a4250; border-radius: 10px;                // 画框圆角，标出 3D 区域边界
            overflow: hidden; z-index: 10;                                 // 盖在 Konva 画布之上（Konva 默认 1）
            cursor: grab; background: #23262e;                             // 抓手光标 + 场景底色占位（防加载闪白）
        `;
        container.appendChild(this._vp);                                   // 挂进舞台容器

        // 操作提示条（不拦截指针事件）
        const legend = document.createElement('div');                      // 左上角操作说明
        legend.style.cssText = `
            position: absolute; left: 10px; top: 8px; z-index: 2;          // 贴视窗内左上
            padding: 5px 12px; border-radius: 6px;
            background: rgba(15, 18, 24, 0.62); color: #cfd6e0;            // 半透明深底浅字
            font: 12px/1.6 sans-serif; pointer-events: none;               // 关键：不拦截指针，鼠标穿过去照常操作 3D
            white-space: nowrap;                                           // 单行不折行
        `;
        legend.innerHTML = '💡 左键拖动旋转视角 · 滚轮推进/拉远 · 右键拖动平移<br>点击接线柱连线 · 双击导线拆除 · 点击闸刀合/分闸 · 右键点击器件打开参数设置<br>左键按住器件本体拖动可在桌面移动位置（端子/闸刀小位移仍是点击）<br>「选择仪表」后点击接线柱可与仪表连线 · 双击接线柱拆除仪表线'; // 四行操作指南（功能演进时同步更新）
        this._legend = legend;                                             // 存引用（必要时可更新文案）
        this._vp.appendChild(legend);                                      // 挂进视窗

        // 全幅 2D 覆盖层（z-index 高于 3D 视窗）：仪表连线/接线预览画在 3D 画面之上。
        // pointer-events:none —— 纯绘制表面，不拦截任何指针事件。
        const rect = container.getBoundingClientRect();                     // 容器在页面中的偏移（光标坐标→画布坐标换算用）
        this._rectLeft = rect.left;                                        // 存下：window 光标事件 clientX 减它得画布系
        this._rectTop = rect.top;
        this._ow = Math.max(320, container.clientWidth || (window.innerWidth - rect.left));   // 覆盖层宽=容器宽（兜底 window）
        this._oh = Math.max(240, container.clientHeight || (window.innerHeight - rect.top)); // 覆盖层高=容器高
        const dpr = Math.min(window.devicePixelRatio || 1, 2);             // 设备像素比封顶 2（高分屏清晰、开销可控）
        const overlay = document.createElement('canvas');                  // 覆盖画布（2D）
        overlay.id = 'd3-overlay';                                         // 标 id 便于调试/测试定位
        overlay.style.cssText = `position:absolute;left:0;top:0;width:${this._ow}px;height:${this._oh}px;z-index:15;pointer-events:none;`; // 盖住 3D 视窗(z10) 之上
        overlay.width = Math.round(this._ow * dpr);                       // 物理像素=逻辑×dpr（高清不糊）
        overlay.height = Math.round(this._oh * dpr);
        this._overlay = overlay;                                           // 存引用（destroy 移除用）
        this._octx = overlay.getContext('2d');                             // 2D 绘图上下文
        this._octx.scale(dpr, dpr);                                        // 之后按逻辑像素画，自动乘 dpr
        container.appendChild(overlay);                                    // 覆盖层挂容器（全幅，不限视窗内）
    }

    // ════════════════════════ 3D 场景 ════════════════════════

    /** 建 WebGL 渲染器、场景、相机、轨道控件、三灯、环境（地面/桌子）。 */
    _initThree() {
        this._renderer = new THREE.WebGLRenderer({ antialias: true });    // 抗锯齿：边缘平滑
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // 像素比封顶 1.5（性能折中）
        this._renderer.setSize(this._vpW, this._vpH);                     // 画布尺寸=视窗尺寸
        this._renderer.shadowMap.enabled = true;                           // 开阴影（桌面投影是立体感的关键）
        this._renderer.shadowMap.type = THREE.PCFShadowMap;                // r187 可用的 PCF 柔影（PCFSoftShadowMap 已移除）
        // 场景基本静态：阴影贴图只在内容变化时重烘（省掉每帧 shadow pass）
        this._renderer.shadowMap.autoUpdate = false;                       // 关自动烘影（性能：空闲零 shadow 开销）
        this._renderer.shadowMap.needsUpdate = true;                       // 手动标记：首帧必烘一次
        this._vp.appendChild(this._renderer.domElement);                   // WebGL canvas 挂进视窗 div

        this._scene = new THREE.Scene();                                   // 3D 场景根
        this._scene.background = new THREE.Color(0x23262e);                 // 背景色=平台深灰（与页面浑然一体）
        this._scene.fog = new THREE.Fog(0x23262e, 9, 24);                  // 雾：远处地板渐隐进背景，无边界感

        this._camera = new THREE.PerspectiveCamera(40, this._vpW / this._vpH, 0.05, 80); // 40° 透视、近裁 0.05m 远裁 80m
        this._camera.position.set(2.9, 2.35, 3.35);                        // 初始机位：斜上方 45° 俯视桌面

        this._controls = new OrbitControls(this._camera, this._vp);       // 轨道控件绑相机与视窗（注意其拖动监听在 document 层）
        this._controls.target.set(0, 0.85, 0);                             // 视线焦点：桌面中心略上（器件群高度）
        this._controls.enableDamping = true;                               // 阻尼：松手后惯性滑行
        this._controls.dampingFactor = 0.08;                               // 阻尼系数（小=滑得远）
        this._controls.minDistance = 1.4;                                 // 最近 1.4m：不许钻进器件内部
        this._controls.maxDistance = 9;                                    // 最远 9m：不许拉出雾外
        this._controls.maxPolarAngle = 1.45;                               // 极角上限 83°：不许钻到桌底
        this._controls.zoomToCursor = true;   // 滚轮朝鼠标指向推进/拉远  // r187 特性：缩放对准光标（操作直觉）
        this._controls.update();                                           // 应用初始参数（也初始化内部球坐标）

        // 按需渲染脏标记：相机一动或内容一变才重绘（空闲零渲染）
        this._dirty = true;                                                // 首帧必绘
        this._portsDirty = true;                                           // 首帧必投影端口
        this._controls.addEventListener('change', () => {                  // 相机任何变化（拖/缩/平/阻尼步进）→
            this._dirty = true;       // 相机变化 → 重绘                 //   置脏待重绘
            this._portsDirty = true;   // 投影变化 → Konva 端口锚点需同步   //   端口投影也要重算（仪表连线跟脚）
        });

        // 灯光：环境光 + 主光（投影）+ 冷色补光
        const amb = new THREE.AmbientLight(0xffffff, 0.5);                 // 环境光 0.5：全局打底，无死角
        const key = new THREE.DirectionalLight(0xfff2dd, 1.15);            // 暖白主光 1.15：唯一投影光源
        key.position.set(3.5, 5.5, 2.6);                                   // 从右上前方照（影子甩向左后）
        key.castShadow = true;                                             // 投影开
        key.shadow.mapSize.set(1024, 1024);                               // 阴影贴图 1024²（够用即可）
        key.shadow.camera.left = -4;                                      // 正交影相机范围 ±4m：
        key.shadow.camera.right = 4;                                       //   盖住整张桌+器件
        key.shadow.camera.top = 4;
        key.shadow.camera.bottom = -4;
        key.shadow.camera.near = 1;                                        // 影相机近平面 1m
        key.shadow.camera.far = 15;                                       // 远平面 15m（光在 3.5,5.5,2.6 → 距桌约 7m，15 罩住）
        key.shadow.bias = -0.0004;                                         // 影偏置：消自阴影条纹
        key.shadow.normalBias = 0.02;                                      // 法向偏置：消曲面痤疮
        const fill = new THREE.DirectionalLight(0x9db4ff, 0.28);           // 冷蓝补光 0.28：反向补暗部，立体不糊
        fill.position.set(-3.2, 4.2, -2.8);                                // 从左后上方来
        this._scene.add(amb, key, fill);                                   // 三灯齐挂

        this._buildEnvironment();                                          // 地面/网格/桌子

        this._deviceRoot = new THREE.Group();                              // 器件容器：所有注册器件的 root 挂这里
        this._scene.add(this._deviceRoot);                                 // （右键拾取射线只扫这个组，避开环境）

        this._raycaster = new THREE.Raycaster();                           // 射线拾取器（全场景共用一只）
        this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WORLD.tableTop); // 桌面平面 y=tableTop（拖器件/预览线落点用）

        // 电缆材质（红色为电池正极线）
        this._redMat = new THREE.MeshStandardMaterial({ color: 0xc9412f, roughness: 0.55, metalness: 0.05 }); // 正极红：绝缘皮质感
        this._darkMat = new THREE.MeshStandardMaterial({ color: 0x36404a, roughness: 0.6, metalness: 0.05 }); // 常规深灰蓝
        this._previewMat = new THREE.MeshBasicMaterial({ color: 0xe0523d, transparent: true, opacity: 0.55 }); // 预览线：Basic 不受光+半透明（虚线感）
    }

    /** 地面 + 网格 + 实验桌 + 桌面标签 */
    _buildEnvironment() {
        const floor = new THREE.Mesh(                                      // 地面：40m 大平面
            new THREE.PlaneGeometry(40, 40),
            new THREE.MeshStandardMaterial({ color: 0x272c34, roughness: 1, metalness: 0 }) // 全哑光深灰
        );
        floor.rotation.x = -Math.PI / 2;                                  // Plane 默认立着（XY 面）→ 放倒成地面（XZ 面）
        floor.receiveShadow = true;                                       // 承接桌腿影子
        this._scene.add(floor);

        const grid = new THREE.GridHelper(16, 32, 0x39414e, 0x303844);     // 16m×32 格辅助网格（中心线深些）
        grid.position.y = 0.002;                                           // 抬 2mm 防 z-fighting（与地面同深度闪烁）
        this._scene.add(grid);

        // 桌面 + 四条腿 + 腿间横撑
        const wood = new THREE.MeshStandardMaterial({ color: 0x9c7a56, roughness: 0.82, metalness: 0.02 }); // 桌面原木色
        const woodDark = new THREE.MeshStandardMaterial({ color: 0x74553a, roughness: 0.85, metalness: 0.02 }); // 桌腿深木色

        const top = new THREE.Mesh(                                       // 桌面板：尺寸全由 WORLD 常量定义
            new THREE.BoxGeometry(WORLD.tableW, WORLD.tableH, WORLD.tableD), wood // 3.2 × 0.08 × 1.7 m
        );
        top.position.y = WORLD.tableTop - WORLD.tableH / 2;               // 顶面恰在 tableTop 高度（0.82）：桌面中心=顶高−半厚
        top.castShadow = true;                                            // 桌面投影到地面
        top.receiveShadow = true;                                         // 器件投影到桌面
        this._scene.add(top);

        const legGeo = new THREE.BoxGeometry(WORLD.legW, WORLD.legH, WORLD.legW); // 桌腿几何：方柱 0.09m 见方 × 0.74m 高
        const lx = WORLD.tableW / 2 - 0.14;                               // 腿 x 位：内缩 0.14m（不顶着桌角外沿）
        const lz = WORLD.tableD / 2 - 0.13;                               // 腿 z 位：内缩 0.13m
        for (const sx of [-1, 1]) {                                       // 前后左右四个象限：
            for (const sz of [-1, 1]) {
                const leg = new THREE.Mesh(legGeo, woodDark);             //   各立一条腿（共享同一几何体省内存）
                leg.position.set(sx * lx, WORLD.legH / 2, sz * lz);       //   腿中心高=半腿高（底面贴地面 y=0）
                leg.castShadow = true;                                   //   腿投影
                leg.receiveShadow = true;                                //   腿受影
                this._scene.add(leg);
            }
        }
        const braceGeo = new THREE.BoxGeometry(lx * 2 - WORLD.legW, 0.06, 0.05); // 前后横撑：跨距=两腿内缘，截面 0.06×0.05
        for (const sz of [-1, 1]) {                                       // 前后各一根：
            const brace = new THREE.Mesh(braceGeo, woodDark);
            brace.position.set(0, 0.18, sz * lz);                          //   离地 0.18m，结构感+不挡腿
            brace.castShadow = true;
            this._scene.add(brace);
        }

        // 桌面器件标签（置于各器件前方，随三角布局）
        // 器件名称标签不再铺在固定位置——随器件注册挂到各自根节点下，
        // 拖动器件时标签跟随移动（见 registerDevice）。
    }

    // ════════════════════════ 器件注册 ════════════════════════

    /** 器件注册协议入口：三器件 _init() 里调用。
     *  接管 buildThree() 的产出：挂 root、记足迹、挂标签、登记端子与拾取盒。
     */
    registerDevice(comp) {
        const built = comp.buildThree(THREE);                             // 让器件自建 3D 模型（THREE 命名空间传进去，器件零依赖全局）
        built.root.userData.comp = comp;   // 右键拾取：由命中网格向上回溯所属器件 // 所有子网格命中后都能 parent 链找到器件
        this._deviceRoot.add(built.root);                                 // 器件树挂进场景（之后射线只扫 _deviceRoot）
        comp._host = this;                                                // 反向引用：器件 tick 里调 _host._invalidate() 请求重绘

        // 器件足迹（相对量 + 根引用）：拖动后位置实时变化，
        // cx/cz 由 _fpFor() 按 root 当前位置动态求出，逃逸点不会用到过期位置
        const fpb = built.footprint;                                       // 器件申报的足迹（本地坐标半尺寸+顶高）
        const fp = fpb ? {                                                // 换算成宿主侧登记项：
            hx: fpb.hx, hz: fpb.hz,                                       //   半宽/半深照抄（器件自身尺寸不变）
            top: built.root.position.y + (fpb.top || 0),                  //   世界顶高=放置高+本地顶高（电缆越过的高度）
            cxOff: fpb.cx || 0, czOff: fpb.cz || 0,                        //   中心偏移（一般 0，留协议扩展位）
            root: built.root,                                             //   存 root 引用：拖动后读它拿实时位置
        } : null;
        if (fp) this._compFp.set(comp.id, fp);                            // 入足迹表（拖动碰撞检测/逃逸计算共享）

        // 名称标签挂在器件根下：拖动器件时标签跟随移动（贴在足迹前方）
        const DEV_LABELS = { bat: '电池', sw: '闸刀开关', bulb: '灯泡' };    // 器件 id → 中文名（三件套固定）
        const text = DEV_LABELS[comp.id];
        if (text && fpb) {                                                // 有名可挂才画：
            const lab = makeTableLabel(THREE, text, 0, 0);                //   canvas 文字平面（本地原点先画）
            lab.position.set(fpb.cx || 0, 0.002, (fpb.cz || 0) + fpb.hz + 0.126); //   贴足迹前缘外 126mm、抬 2mm 防闪面
            built.root.add(lab);                                          //   挂 root 下 → 拖动器件标签自动跟
        }

        for (const t of built.terminals || []) {                          // 逐个登记端子：
            const fullPort = `${comp.id}_wire_${t.port}`;                 //   平台端口全名（如 bat_wire_p）
            const entry = comp.ports.find(p => p.id === fullPort);        //   找器件 Konva 端口锚点（仪表连线用）
            t.hit.userData = { kind: 'terminal', fullPort, comp, visual: t.mesh }; //   拾取柱自报家门：类型/全名/所属/高亮目标
            this._portRegistry.set(fullPort, {                           //   注册表登记（后续一切按全名查）
                comp, port: t.port, mesh: t.mesh, hit: t.hit, tip: t.tip, //   视觉柱 mesh + 柱顶偏移 tip（电缆端点）
                node: entry ? entry.node : null, fp,                      //   Konva 锚点 + 足迹（混合线/逃逸用）
            });
            this._pickTerminals.push(t.hit);                              //   进端子拾取列表
        }
        for (const p of built.pickables || []) this._pickSwitch.push(p);  // 器件申报的可点部件（闸刀手柄盒）进第二拾取列表

        this._devices.push(comp);                                         // 进器件数组
        this._portsDirty = true;                                          // 新端子 → 投影/锚点重算
        this._invalidate();                                               // 新模型 → 重绘 + 重烘影
    }

    /** 接线柱顶端的世界坐标 */
    _terminalWorld(fullPort, out) {
        const reg = this._portRegistry.get(fullPort);                     // 查端子登记
        if (!reg) return null;                                            // 无登记（2D 端口等）→ null 交调用方分支处理
        reg.mesh.updateWorldMatrix(true, false);                          // 强刷世界矩阵（拖动后 position 变了，这里算最新）
        out.copy(reg.tip).applyMatrix4(reg.mesh.matrixWorld);            // tip 本地偏移 × 世界矩阵 = 柱顶世界坐标
        return out;                                                       // 写进调用方的复用向量，零分配
    }

    /** 端子所属器件的实时足迹（拖动后 cx/cz 跟随 root 当前位置，逃逸计算不过期） */
    _fpFor(fullPort) {
        const reg = this._portRegistry.get(fullPort);                     // 查端子→它的器件足迹
        if (!reg || !reg.fp) return null;                                 // 无足迹 → 逃逸算法跳过（直连下垂）
        const f = reg.fp, r = f.root;                                     // 相对量 + root 实时位置
        return {
            cx: r.position.x + f.cxOff, cz: r.position.z + f.czOff,       // 中心=当前摆放位置+申报偏移（拖动即时生效）
            hx: f.hx, hz: f.hz, top: f.top,                               // 尺寸/顶高不变照抄
        };
    }

    /** 内容变化 → 需要重绘 + 阴影重烘（器件动画/重建电缆时调用） */
    _invalidate() {
        this._dirty = true;                                               // rAF 循环见到脏标记才 render
        if (this._renderer && this._renderer.shadowMap) {
            this._renderer.shadowMap.needsUpdate = true;                   // autoUpdate=false 模式下手动要求重烘
        }
    }

    // ════════════════════════ tick（20fps）════════════════════════

    /** 平台 20fps 心跳：端口投影（脏门控）+ 电缆差量重建 + 混合线覆盖层。 */
    tick() {
        // 端口投影只在相机/器件/连线变化后才需要重算
        if (this._portsDirty) {                                           // 脏门控：没变化就不投影（省 CPU）
            this._syncPortCircles();                                      // 3D 柱顶 → 屏 → Konva 锚点
            this._portsDirty = false;                                     // 清脏
        }
        this._syncCables();                                               // 差量重建 3D 电缆（签名比对）
        this._drawHybridOverlay();                                        // 仪表混合线画上覆盖层
    }

    /** 投影接线柱 → 屏幕，同步器件的 Konva 端口锚点（仪表连线用） */
    _syncPortCircles() {
        const v = this._tmpV;                                              // 复用向量
        for (const [, reg] of this._portRegistry) {                       // 遍历所有 3D 端子
            if (!reg.node || !this._terminalWorld(`${reg.comp.id}_wire_${reg.port}`, v)) continue; // 无锚点/算不出世界坐标则跳过
            v.project(this._camera);                                       // 世界 → NDC（-1~1）
            reg.node.position({                                           // NDC → 视窗像素，写进 Konva 锚点
                x: (v.x + 1) * 0.5 * this._vpW,                            //   x：0..1 × 视窗宽
                y: (1 - v.y) * 0.5 * this._vpH,                            //   y：NDC 上为正 → 屏幕向下翻转
            });
        }
    }

    /** 两端均为 3D 器件的 wire：标 custom（2D 不画），并按签名差量重建 3D 电缆。
     *  签名含端点世界坐标（1mm 精度）——拖动器件时电缆随之重建 */
    _syncCables() {
        const sys = this.sys;
        const keys = [];                                                   // 本轮 3D↔3D 连线的键集合
        const pos = [];                                                    // 及其端点世界坐标串
        const v = this._tmpV;
        for (const c of sys.conns) {                                       // 遍历平台连线表
            if (c.type !== 'wire') continue;                               // 只管电气线
            const a3d = this._portRegistry.has(c.from), b3d = this._portRegistry.has(c.to); // 两端是否 3D 端子
            if (a3d || b3d) {                                              // 任一端是 3D 就接管：
                if (!c.custom) {                                          //   尚未标记才标（幂等）
                    // 2D 渲染层让位：3D↔3D 由宿主画 3D 电缆，3D↔2D（仪表）由覆盖层绘制
                    c.custom = true;                                       //   Renderer._visWireConns 过滤 custom，2D 不画
                    if (typeof sys.requestRedraw === 'function') sys.requestRedraw(); //   请求 2D 层也重绘（旧线消失）
                }
            }
            if (a3d && b3d) {                                              // 双 3D 才生成真电缆：
                keys.push([c.from, c.to].sort().join('~'));               //   键=排序端口对（方向无关）
                for (const end of [c.from, c.to]) {                        //   端点世界坐标入签名串：
                    if (this._terminalWorld(end, v)) {                    //   取世界坐标
                        pos.push(v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3)); // mm 精度序列化
                    }
                }
            }
        }
        const sig = keys.sort().join('|') + '#' + pos.join(';');           // 拼总签名：键集合 + 端点坐标
        if (sig !== this._cableSig) {                                     // 与上轮不同（增删线/拖动器件）：
            this._cableSig = sig;                                          //   记新签名
            this._rebuildCables();                                        //   全量重建电缆
        }
    }

    /** 全量重建 3D 电缆（先清旧，再按连线表逐根生成 Tube 管体，带生长动画起点）。 */
    _rebuildCables() {
        this._invalidate();                                               // 有增删 → 重绘 + 重烘影
        this._portsDirty = true;                                          // 电缆变 → 覆盖层/投影刷新
        for (const [, c] of this._cables) {                              // 清掉旧电缆网格：
            this._scene.remove(c.mesh);                                   //   移出场景
            c.mesh.geometry.dispose();                                    //   释放显存（TubeGeometry 每根独立）
        }
        this._cables.clear();                                             // 表清空

        const A = new THREE.Vector3();                                    // 复用起点/终点容器
        const B = new THREE.Vector3();
        for (const c of this.sys.conns) {                                 // 逐根连线生成：
            if (c.type !== 'wire' || !c.custom) continue;                 //   只处理接管的 wire（custom 标记）
            if (!this._terminalWorld(c.from, A) || !this._terminalWorld(c.to, B)) continue; // 任一端算不出坐标跳过（2D 混合线另走覆盖层）
            const key = [c.from, c.to].sort().join('~');                  //   键=排序端口对
            const red = (c.from === 'bat_wire_p' || c.to === 'bat_wire_p'); //   电池正极线 → 红皮（电气约定红=正极）
            const geo = new THREE.TubeGeometry(                           //   下垂电缆几何：
                sagCurve(THREE, A, B, WORLD.cableSagY, this._fpFor(c.from), this._fpFor(c.to)), //     八控制点下垂曲线（足迹逃逸版），两端足迹实时取
                44, WORLD.cableR, 10);                                    //     44 段、半径 0.016m、10 边（圆度足够）
            const mesh = new THREE.Mesh(geo, red ? this._redMat : this._darkMat); //   管体 + 红或灰材质
            mesh.castShadow = true;                                      //   电缆投影（桌面可见）
            mesh.userData = { kind: 'cable', key };                       //   自报家门：双击拆线时按键反查
            this._scene.add(mesh);                                        //   进场景（不在 _deviceRoot：拖动器件不连带它）
            this._cables.set(key, { mesh, conn: c, born: performance.now(), done: false }); // 入表，born 记生长动画起点
        }
    }

    // ════════════════════════ 2D 覆盖层（仪表连线）════════════════════════

    /** 3D 端子 ↔ 2D 仪表端口的混合连线 + 接线预览，画在 3D 画面之上 */
    _drawHybridOverlay() {
        const ctx = this._octx;                                           // 覆盖层画笔
        const sys = this.sys;
        if (!ctx || !sys) return;                                         // 初始化未完则跳过
        ctx.clearRect(0, 0, this._ow, this._oh);                          // 每帧全清（画布不大，全清最省心）

        for (const c of (sys.conns || [])) {                              // 遍历连线找混合线：
            if (c.type !== 'wire' || !c.custom) continue;                 //   只看接管的 wire
            const a3d = this._portRegistry.has(c.from), b3d = this._portRegistry.has(c.to); // 两端哪头是 3D？
            if (a3d === b3d) continue;          // 双 3D 已画成电缆；双 2D 由平台渲染 // 同侧交给别的层（3D 电缆 / 平台 2D）
            const p3d = a3d ? c.from : c.to;                              //   3D 端全名
            const p2d = a3d ? c.to : c.from;                              //   2D 端全名（仪表端口）
            const A = this._portScreen(p3d);                             //   3D 端屏幕坐标（走投影锚点）
            const B = this._absPortPos(p2d);                              //   仪表端舞台坐标（Konva 绝对位）
            if (!A || !B) continue;                                      //   有一端取不到（如仪表隐藏）就不画
            const red = p3d.endsWith('_p') || p2d.endsWith('_p');         //   正极红：任一端是 _p 端口（平台红极性约定）
            const mx = (A.x + B.x) / 2;                                   //   贝塞尔控制点：x 中点（水平走向自然）
            ctx.strokeStyle = red ? '#e60c0c' : '#544f4f';                //   与平台 Renderer 同色系
            ctx.lineWidth = 4;                                            //   与平台线宽一致
            ctx.setLineDash([]);                                          //   实线（连线已成立）
            ctx.beginPath();
            ctx.moveTo(A.x, A.y);                                         //   从 3D 端子投影点
            ctx.bezierCurveTo(mx, A.y, mx, B.y, B.x, B.y);                //   S 形弯到仪表端口
            ctx.stroke();
            this._overlayDot(ctx, A.x, A.y, p3d.endsWith('_p') ? '#e60c0c' : '#22262b'); // 两端各画一个铆点
            this._overlayDot(ctx, B.x, B.y, p2d.endsWith('_p') ? '#e60c0c' : '#22262b'); // （红/黑随极性）
        }

        // 接线预览：3D 端子 → 光标（光标位于 3D 视窗外时；窗内另有 3D 下垂预览）
        const ls = sys.linkingState;                                      // 平台接线中状态
        if (ls && ls.type === 'wire' && this._portRegistry.has(ls.portId) //   从 3D 端子起头
                && this._cursor && !this._cursorInVp()) {                 //   且光标已离开视窗（跑向仪表区）
            const A = this._portScreen(ls.portId);                        //   3D 端子屏幕坐标
            if (A) {
                ctx.strokeStyle = '#e0523d';                              //   预览橙红
                ctx.lineWidth = 3;                                        //   比正式线细一号
                ctx.setLineDash([8, 6]);                                 //   虚线 = “预览”语义
                ctx.beginPath();
                ctx.moveTo(A.x, A.y);
                ctx.lineTo(this._cursor.x, this._cursor.y);              //   直线追光标
                ctx.stroke();
                ctx.setLineDash([]);                                     //   记得关虚线（canvas 状态机）
                this._overlayDot(ctx, A.x, A.y, '#e0523d');               //   起点铆点
            }
        }
    }

    /** 覆盖层铆点：实心圆 + 白描边（仿平台端口点样式） */
    _overlayDot(ctx, x, y, color) {
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);                               // r=5.5 整圆
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#f2f4f7';                                      // 白边：任何底色上都清晰
        ctx.stroke();
    }

    /** 3D 端子的屏幕坐标（视窗原点 + Konva 端口锚点投影） */
    _portScreen(fullPort) {
        const reg = this._portRegistry.get(fullPort);                     // 查端子
        if (!reg || !reg.node) return null;                               // 无锚点不可画
        return { x: this.group.x() + reg.node.x(), y: this.group.y() + reg.node.y() }; // 锚点在视窗局部系 → 加 group 原点回舞台系
    }

    /** 2D 组件端口的舞台绝对坐标（仪表隐藏时不画） */
    _absPortPos(fullPort) {
        const sys = this.sys;
        const k = fullPort.indexOf('_wire_');                             // 全名格式 compId_wire_port
        if (k < 0) return null;                                           // 不是标准端口名 → 放弃
        const comp = (sys.comps || {})[fullPort.slice(0, k)];             // 切出 compId 查组件
        if (!comp || !comp.ports || !comp.group.visible()) return null;   // 不存在或隐藏（visible:false 仪表）不画
        const entry = comp.ports.find(p => p.id === fullPort);            // 找端口登记
        if (!entry || !entry.node) return null;                           // 无节点不可画
        const pos = entry.node.getAbsolutePosition();                     // Konva 绝对坐标（含 group 位移）
        return { x: pos.x, y: pos.y };
    }

    /** 光标当前是否在 3D 视窗内（内→3D 预览线管；外→覆盖层预览线管） */
    _cursorInVp() {
        const c = this._cursor;
        if (!c) return false;                                             // 无光标信息当作窗外
        const vx = this.group.x(), vy = this.group.y();                   // 视窗左上角（舞台系）
        return c.x >= vx && c.x <= vx + this._vpW && c.y >= vy && c.y <= vy + this._vpH; // 矩形包含测试
    }

    // ════════════════════════ 指针交互 ════════════════════════

    /** 视窗指针事件全套：拖器件/悬停/点击/双击/右键/滚轮/全局光标/仪表拖动守卫。 */
    _bindEvents() {
        const vp = this._vp;

        // 注意：OrbitControls 的拖动 pointermove / pointerup 监听挂在 document 层（冒泡阶段），
        // 下列 pointer 系处理器一律不得 stopPropagation —— 否则事件冒不到 document，
        // 旋转/平移全部失效；且 pointerup 被阻断后 state 永远卡在 ROTATE/PAN，
        // 滚轮也会因 state !== NONE 被拒。Konva 的监听在同级 .konvajs-content 上，
        // 本视窗的事件本就传不到它，无需阻断。

        vp.addEventListener('pointerdown', (e) => {                       // 按下：记录落点 + 器件拖动预备
            this._down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; // 落点三要素：位置/时刻/键（松开时判点击 vs 拖动）
            // 左键按在 3D 器件本体上（含接线柱/闸刀，小位移仍是点击）→ 准备拖动器件。
            // OrbitControls 的 pointerdown 已先执行并捕获指针，此处立即禁用其拖动跟随，
            // 拖器件时相机不再旋转；小位移松开仍走 _handleClick（连线/合闸语义不变）。
            if (e.button === 0) {                                         // 只对左键做器件拖动预备
                this._updateMouse(e);                                     // 刷新 NDC（射线要用）
                const comp = this._deviceAtPoint();                       // 光标下是哪只 3D 器件？
                if (comp) {                                              // 按在器件本体上：
                    const fp = this._compFp.get(comp.id);                 //   取它的足迹
                    if (fp) {
                        this._drag = { comp, fp, started: false, offX: 0, offZ: 0 }; //   进拖动预备态（未起拖：等 6px 位移）
                        this._controls.enabled = false;                   //   立即禁 OrbitControls：拖的是器件不是相机
                    }
                }
            }
        });

        vp.addEventListener('pointermove', (e) => {                       // 移动：拖器件优先，否则悬停高亮
            this._updateMouse(e);                                         // NDC 跟随光标
            if (this._drag) { this._dragMove(e); return; }                // 拖动中 → 器件移动（相机已被禁不受影响）
            this._updateHover();                                          // 空闲 → 悬停高亮 + 光标形态
        });

        vp.addEventListener('pointerup', (e) => {                         // 松开：先收拖动，再按位移/时长分派点击
            if (!this._down) return;                                      // 没有按下记录（异常时序）则忽略
            const b = this._down.b;                                       // 按下时的键（以按下为准，防中途换键）
            const dx = e.clientX - this._down.x;                          // 位移量
            const dy = e.clientY - this._down.y;
            const dt = performance.now() - this._down.t;                  // 按住时长
            this._endDrag();                                              // 收尾拖动（恢复 OrbitControls/光标）——先于点击分派
            this._down = null;                                            // 清按下记录
            if (Math.hypot(dx, dy) >= 6 || dt >= 550) return;   // 位移大 = 拖动（器件/视角），不算点击 // 阈值：6px 或 0.55s 都算拖过，不算点击
            if (b === 0 && e.button === 0) this._handleClick(e);         // 左键短击 → 左键语义（连线/合闸）
            else if (b === 2 && e.button === 2) this._handleContextClick(e);   // 右键点击器件 → 参数设置 // 右键短击 → 参数框
        });

        // 指针被系统取消（触摸打断等）：复位拖动状态，恢复 OrbitControls
        vp.addEventListener('pointercancel', () => this._endDrag());      // 中断兜底：不留卡死状态

        vp.addEventListener('pointerleave', (e) => {                      // 光标离开视窗
            this._mouse = null;                                           // 清 NDC（预览线失效条件）
            this._clearHover();                                           // 灭悬停高亮
        });

        // dblclick：OrbitControls 未监听此事件，阻断冒泡无碍
        vp.addEventListener('dblclick', (e) => {                          // 双击：拆线（OrbitControls 不占用此事件）
            e.stopPropagation();                                          // 只为防触发 Konva 层双击
            this._handleDblClick(e);
        });

        // wheel / contextmenu：OrbitControls 的同名监听也挂在本元素上且注册在先，
        // 先于本处 stopPropagation 执行，互不影响；此处仅阻断向 #container 的冒泡（保险）
        vp.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true }); // 滚轮给 OrbitControls 缩放；只堵冒泡
        vp.addEventListener('contextmenu', (e) => e.stopPropagation());    // 右键菜单自绘，不出浏览器默认菜单

        // 全局光标跟踪（接线预览用：光标可以移出 3D 视窗，落到仪表区）
        this._cursorMove = (e) => {                                       // window 级监听（视窗外也收到）
            this._cursor = { x: e.clientX - this._rectLeft, y: e.clientY - this._rectTop }; // 页面坐标 → 画布坐标
        };
        window.addEventListener('pointermove', this._cursorMove, { passive: true }); // passive：不阻塞滚动

        // 2D 组件（仪表等）拖动约束：不许压在 3D 视窗上，否则会被 WebGL 画面遮住
        const stage = this.sys && this.sys.stage;                         // Konva 舞台（仪表是 Konva 组件）
        if (stage) {
            stage.on('dragmove.d3guard', (e) => {                         // 命名空间事件：只管仪表拖动守卫
                const t = e.target;                                      // 被拖的 Konva 节点
                if (!t || t === this.group) return;                       // 不是组件/是本视窗自身 → 无视
                const comps = this.sys.comps || {};
                let comp = null;
                for (const id in comps) {                                // 反查该节点属于哪个组件
                    if (comps[id] && comps[id].group === t) { comp = comps[id]; break; }
                }
                if (!comp || comp._host) return;      // 3D 器件（已禁拖）不受限 // 找不到/是 3D 器件（不可拖）→ 放行
                const w = comp.width || 120, h = comp.height || 80;       // 组件尺寸（兜底默认）
                const vx = this.group.x(), vy = this.group.y(), vw = this._vpW, vh = this._vpH; // 视窗矩形
                const x = t.x(), y = t.y();                               // 组件当前位
                const oL = Math.min(x + w, vx + vw) - Math.max(x, vx);    // 重叠宽（≤0 = 不重叠）
                const oT = Math.min(y + h, vy + vh) - Math.max(y, vy);    // 重叠高
                if (oL <= 0 || oT <= 0) return;        // 与视窗无重叠 // 不重叠 → 不用管
                const pushL = x + w - vx, pushR = vx + vw - x;           // 四个方向推出量：
                const pushU = y + h - vy, pushD = vy + vh - y;             //   推左/推右/推上/推下各需挪多远
                const m = Math.min(pushL, pushR, pushU, pushD);           // 取最省事的一向
                if (m === pushL) t.x(vx - w);                             //   贴视窗左缘外
                else if (m === pushR) t.x(vx + vw);                       //   贴右缘外
                else if (m === pushU) t.y(vy - h);                        //   贴上缘外
                else t.y(vy + vh);                                       //   贴下缘外（二分判断覆盖四向）
            });
        }
    }

    /** 把鼠标事件换算成视窗 NDC（射线拾取的标准输入）。 */
    _updateMouse(e) {
        const r = this._vp.getBoundingClientRect();                        // 视窗实时矩形（含边框缩放后）
        this._mouse = {
            ndc: new THREE.Vector2(
                ((e.clientX - r.left) / r.width) * 2 - 1,                  // x：0..1 → -1..1（左负右正）
                -((e.clientY - r.top) / r.height) * 2 + 1                 // y：翻转！屏幕向下正 → NDC 向上正
            ),
        };
    }

    /** 清悬停高亮：还原材质自发光 + 光标回抓手。 */
    _clearHover() {
        if (this._hovered && this._hoverBase) {                            // 有高亮才需要还原
            const m = this._hovered.material;
            if (m && m.emissive) {                                        // 只对有自发光的材质
                m.emissive.setHex(this._hoverBase.hex);                   //   色还原
                m.emissiveIntensity = this._hoverBase.i;                  //   强度还原（灯泡玻璃别被误灭）
            }
            this._dirty = true;                                           // 还原了要重绘
        }
        this._hovered = null;                                             // 清引用
        this._hoverBase = null;
        this._vp.style.cursor = 'grab';                                   // 光标回抓手
    }

    /** 结束器件拖动：恢复 OrbitControls 与光标 */
    _endDrag() {
        if (this._drag) {                                                 // 只在拖动态收尾（无拖幂等安全）
            this._drag = null;                                            // 清拖动状态
            if (this._controls) this._controls.enabled = true;            // 恢复相机控件（视角操作回归）
            this._vp.style.cursor = 'grab';                                // 光标回抓手
        }
    }

    /** 器件本体拖动：射线交桌面平面 → 按抓取偏移移动（钳制桌沿内、与其他器件互不重叠） */
    _dragMove(e) {
        const d = this._drag;                                             // 当前拖动上下文
        const root = d.fp.root;                                           // 器件根节点（挪它的 position）
        if (!d.started) {                                                 // 尚未起拖：
            if (Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) < 6) return; //   位移不足 6px 不算起拖（还是点击预备）
            const P0 = this._tablePoint();                                //   起拖：先取桌面落点
            if (!P0) return;                                              //   射线打不到桌面（理论少见）放弃
            d.offX = P0.x - root.position.x;                             //   抓取偏移：落点相对器件中心的差
            d.offZ = P0.z - root.position.z;                             //   （拖动期间恒用 → 器件不瞬移到光标下）
            d.started = true;                                            //   正式进入拖动
            this._vp.style.cursor = 'grabbing';                           //   光标变抓住
        }
        const P = this._tablePoint();                                     // 本帧光标的桌面落点
        if (!P) return;
        const hx = d.fp.hx, hz = d.fp.hz;                                 // 足迹半尺寸（桌沿钳制用）
        // 前向为名称标签留位（标签贴在足迹前方），其余方向按足迹钳制
        const labFront = hz + 0.212;                                      // 前向禁区=足迹+标签宽 126mm+余量
        const limZf = WORLD.tableD / 2 - labFront - 0.01;                 // 前缘界限：z ≤ 桌半深−(足迹+标签)−1cm
        const limZb = -WORLD.tableD / 2 + hz + 0.03;                      // 后缘界限：z ≥ −桌半深+足迹+3cm
        const limX = WORLD.tableW / 2 - hx - 0.03;                        // 左右界限：|x| ≤ 桌半宽−足迹−3cm
        const nx = Math.max(-limX, Math.min(limX, P.x - d.offX));         // 目标 x = 落点−偏移，双向钳进桌内
        const nz = Math.max(limZb, Math.min(limZf, P.z - d.offZ));        // 目标 z 同理（前向多让一块标签位）
        const ox = root.position.x, oz = root.position.z;                 // 现位置（无变化早退 + 滑墙基准）
        if (nx === ox && nz === oz) return;                               // 没动就不折腾（防重绘风暴）
        // 与其他器件互不重叠：整步被挡时退而只走单轴（滑墙），仍不行则保持原位
        const cands = [[nx, nz], [nx, oz], [ox, nz]];                     // 候选位次序：双轴 → 只动 x → 只动 z
        for (const [cx, cz] of cands) {                                   // 挨个试：
            if (this._hitsDevice(d.comp.id, cx, cz, hx, hz)) continue;    //   撞别的器件 → 试下一候选
            if (cx !== ox || cz !== oz) {                                 //   确实有位移才写：
                root.position.x = cx;                                     //     应用新位
                root.position.z = cz;
                this._portsDirty = true;    // 端口投影/电缆端点/覆盖层跟随 //     端子坐标全变了
                this._invalidate();        // 重绘 + 阴影重烘               //     立刻重绘 + 重烘影（电缆签名下轮 tick 自会重建）
            }
            return;                                                      //   应用成功（或全候选撞死保持原位）即止
        }
    }

    /** (cx,cz) 处的足迹是否与其他器件重叠 */
    _hitsDevice(selfId, cx, cz, hx, hz) {
        for (const [id, f] of this._compFp) {                             // 遍历所有已注册器件足迹
            if (id === selfId) continue;                                  // 不和自己比
            const r = f.root.position;                                   // 对方实时位置
            if (Math.abs(cx - r.x) < hx + f.hx + 0.02                     // x 向重叠（双方半尺寸和+2cm 余量）
                && Math.abs(cz - r.z) < hz + f.hz + 0.02) return true;    // z 向也重叠 → 撞了
        }
        return false;                                                     // 全场无撞
    }

    /** 当前光标在桌面平面上的世界坐标点 */
    _tablePoint() {
        if (!this._mouse) return null;                                    // 无 NDC 无从谈起
        this._syncMatrices();                                             // 矩阵保鲜（Raycaster 不自动更新）
        this._raycaster.setFromCamera(this._mouse.ndc, this._camera);     // 光标发射线
        const P = new THREE.Vector3();
        if (!this._raycaster.ray.intersectPlane(this._plane, P)) return null; // 与桌面平行不相交 → null
        return P;                                                         // 桌面上的世界坐标点
    }

    /** 光标下的 3D 器件（本体任意网格均可拖动；端子/手柄小位移仍按点击处理） */
    _deviceAtPoint() {
        if (!this._mouse) return null;                                    // 无 NDC 直接 null
        this._syncMatrices();                                             // 矩阵保鲜
        this._raycaster.setFromCamera(this._mouse.ndc, this._camera);     // 光标射线
        const hits = this._raycaster.intersectObjects(this._deviceRoot.children, true); // 递归扫全部器件网格
        if (!hits.length) return null;                                    // 空白桌面/背景 → null
        let node = hits[0].object;                                        // 最近命中网格
        while (node && node !== this._deviceRoot) {                       // 沿 parent 链上溯：
            if (node.userData && node.userData.comp) return node.userData.comp; // 找到登记过器件的节点 → 返回该器件
            node = node.parent;                                           // （root.userData.comp 在 registerDevice 挂的）
        }
        return null;                                                      // 到顶了没有 → null
    }

    /** 射线前强制刷新世界矩阵：Raycaster 不自动更新 matrixWorld，
     *  页面隐藏/最初几帧等未渲染状态会让矩阵停留旧值 → 全部拾取静默失效 */
    _syncMatrices() {
        this._scene.updateMatrixWorld(true);                              // 整棵场景树强制重算（拖动后 position 已变）
        this._camera.updateMatrixWorld(true);                             // 相机不在 scene 内，单独更新（射线方向依赖它）
    }

    /** 射线拾取（端子优先于手柄盒，确保被罩住的接线柱依然可点） */
    _pickAt() {
        if (!this._mouse) return null;                                    // 无 NDC
        this._syncMatrices();                                             // 矩阵保鲜
        this._raycaster.setFromCamera(this._mouse.ndc, this._camera);     // 光标射线
        const hits = this._raycaster.intersectObjects([...this._pickTerminals, ...this._pickSwitch], false); // 端子列表+手柄列表合扫（false=只扫这两层透明体自身）
        if (!hits.length) return null;                                     // 没点中可交互物
        const term = hits.find(h => h.object.userData && h.object.userData.kind === 'terminal'); // 命中里先找端子
        return term ? term.object : hits[0].object;                       // 端子优先；否则首个命中（闸刀手柄）
    }

    /** 悬停高亮：命中物的视觉网格自发光提亮 + 光标形态分派。 */
    _updateHover() {
        if (!this._mouse) return;                                         // 无 NDC（已离开视窗）
        const hit = this._pickAt();                                        // 拾取（端子优先）
        const visual = hit ? (hit.userData.visual || hit) : null;           // 高亮目标=端子视觉柱或手柄盒登记的 visual

        if (this._hovered !== visual) {                                   // 高亮目标变了才处理（省重绘）
            this._clearHover();                                            // 先灭旧高亮（还原材质）
            if (visual && visual.material && visual.material.emissive) {  // 能发光才高亮：
                this._hovered = visual;                                   //   记新目标
                this._hoverBase = {                                       //   存原值（灯丝/玻璃正被亮度驱动着，离开时必须还原）
                    hex: visual.material.emissive.getHex(),
                    i: visual.material.emissiveIntensity,
                };
                visual.material.emissive.setHex(0x6e5a10);                 //   暖黄高亮色
                visual.material.emissiveIntensity = 0.55;                 //   半亮高亮强度
            }
            this._vp.style.cursor = hit ? 'pointer' : (this._deviceAtPoint() ? 'move' : 'grab'); // 可点=手指；器件本体=移动；空白=抓手
            this._dirty = true;   // 高亮变化 → 重绘                      //   高亮变化要重绘
        }
    }

    /** 左键短击分派：端子 → 平台连线流程；闸刀手柄 → 防抖翻转。 */
    _handleClick(e) {
        this._updateMouse(e);                                             // 松开点的 NDC（不是移动中最后一点）
        const hit = this._pickAt();                                       // 拾取
        if (!hit) return;                                                 // 点空白 → 交给 OrbitControls 语义（拖动等已处理）

        const ud = hit.userData;                                          // 命中物自报的家门
        const now = performance.now();

        if (ud.kind === 'terminal') {                                     // ① 端子 → 接线：
            const wasLinking = !!(this.sys.linkingState);                 //   之前是否已在接线中（决定提示语）
            this.sys.handlePortClick(ud.comp, ud.fullPort, 'wire');       //   完全复用平台连线（首点建 linkingState、次点成线+历史）
            this._lastClick = { kind: 'terminal', key: ud.fullPort, t: now }; //   记录（双击时若是误触要撤）
            if (!wasLinking) {                                            //   起头才提示（次点成线不啰嗦）
                this._toast('已选中接线柱，请点击另一端子完成连线（Esc 取消）');
            }
        } else if (ud.kind === 'switch') {                                // ② 闸刀手柄 → 合/分闸：
            // 双击防抖：避免双击把闸刀反复翻转
            if (now - this._lastSwitchT > 320) {                          //   320ms 防抖窗
                this._lastSwitchT = now;                                  //   记时刻
                ud.comp.toggle();                                        //   翻转闸态（动画在器件 tick 里渐变）
            }
            this._lastClick = { kind: 'switch', key: ud.comp.id, t: now }; //   记录（供双击分派参考）
        }
    }

    /** 双击拆线：3D 电缆优先；打不到电缆时打端子 → 拆该端子上的仪表混合线。
     *  双击首击若已误触发接线（单击语义），先取消连线再拆。 */
    _handleDblClick(e) {
        // 双击导线拆除；若双击首击误触发了接线柱，先取消连线
        const now = performance.now();
        if (this.sys.linkingState && this._lastClick && this._lastClick.kind === 'terminal' // 刚点过端子且进入接线态
            && now - this._lastClick.t < 450 && this.sys.connMgr) {       // 双击第二击在 450ms 内到达
            try { this.sys.connMgr.resetLinking(); } catch (err) { /* ignore */ } // 撤销那次误起的接线
            this._disposePreview();                                       // 弃 3D 预览线
        }

        this._updateMouse(e);                                             // 双击点的 NDC
        this._syncMatrices();                                             // 矩阵保鲜
        this._raycaster.setFromCamera(this._mouse.ndc, this._camera);     // 射线
        const cables = [...this._cables.values()].map(c => c.mesh);        // 当前全部 3D 电缆网格
        const hits = this._raycaster.intersectObjects(cables, false);     // 先打电缆（管体自身有几何）
        if (!hits.length) {                                               // 没打到电缆 → 也许想拆仪表线：
            // 双击接线柱 → 拆除挂在该端子上的仪表连接线（3D↔2D 混合连线）
            const th = this._raycaster.intersectObjects(this._pickTerminals, false); // 改打端子拾取柱
            if (!th.length) return;                                       // 也不是端子 → 无事发生
            const fp = th[0].object.userData.fullPort;                   // 命中端子全名
            const conn = this.sys.conns.find(c => c.type === 'wire'       // 找挂在该端子上的“混合线”：
                && (c.from === fp || c.to === fp)                          //   一端是它
                && (this._portRegistry.has(c.from) !== this._portRegistry.has(c.to))); // 且两端一 3D 一 2D
            if (conn && this.sys.connMgr) {                              // 找到 → 拆
                this.sys.connMgr.removeConnWithHistory(conn);            //   走平台拆线（带撤销历史）
                this._toast('已拆除仪表连接线');
            }
            return;
        }
        const key = hits[0].object.userData.key;                          // 打中电缆：取它的键
        const conn = this.sys.conns.find(                                 // 按键反查平台连线记录
            c => c.type === 'wire' && [c.from, c.to].sort().join('~') === key
        );
        if (conn && this.sys.connMgr) {                                   // 查到 → 拆
            this.sys.connMgr.removeConnWithHistory(conn);                 //   （含撤销历史，撤销栈还能恢复）
            this._toast('已拆除此导线');
        }
    }

    /** 右键点击器件 → 打开平台参数设置对话框（「保存」后 onConfigUpdate 实时生效） */
    _handleContextClick(e) {
        this._updateMouse(e);                                             // 右键点的 NDC
        if (!this._mouse) return;
        this._syncMatrices();                                             // 矩阵保鲜
        this._raycaster.setFromCamera(this._mouse.ndc, this._camera);     // 射线
        const hits = this._raycaster.intersectObjects(this._deviceRoot.children, true); // 扫器件本体（递归）
        if (!hits.length) {                                               // 点空白：
            this._toast('请在器件本体上点击右键打开参数设置');              //   给出指引（不再静默）
            return;
        }
        let node = hits[0].object;                                        // 命中网格
        let comp = null;
        while (node && node !== this._deviceRoot) {                       // 上溯找器件
            if (node.userData && node.userData.comp) { comp = node.userData.comp; break; }
            node = node.parent;
        }
        if (!comp) {                                                      // 上溯到顶没找到（理论少见）
            this._toast('请在器件本体上点击右键打开参数设置');
            return;
        }
        const fields = (typeof comp.getConfigFields === 'function') ? comp.getConfigFields() : []; // 器件可配置项
        const names = { source: '电池', switch: '闸刀开关', resistor: '灯泡' }; // type→中文名（提示语用）
        const label = names[comp.type] || comp.id;                        // 兜底用 id
        if (fields.length) {                                              // 有可调参数：
            comp.showConfigDialog();                                      //   弹平台参数框（输入 id=diag_<key>，保存→onConfigUpdate）
            this._toast(`正在设置「${label}」参数，修改后点击「保存」实时生效`);
        } else {                                                          // 开关等无可调项：
            this._toast('该器件暂无可调参数');                             //   明说，不给假希望
        }
    }

    /** 平台浮动提示的薄封装（无提示环境静默降级）。 */
    _toast(msg, ms = 2400) {
        const sys = this.sys;
        if (sys && typeof sys.showFloatingTip === 'function') {           // 平台提示可用才用
            try { sys.showFloatingTip(msg, ms); } catch (e) { /* ignore */ } // 提示失败不致命
        }
    }

    // ════════════════════════ 渲染循环 ════════════════════════

    /** rAF 主循环：控件阻尼步进 → 预览线 → 生长动画 → 脏了才渲染（渲染顺带同步投影与覆盖层）。 */
    _startLoop() {
        const loop = () => {
            this._rafId = requestAnimationFrame(loop);                   // 自续 rAF（destroy 时 cancel）
            this._controls.update();                                      // 阻尼每帧步进（enableDamping 需要手动 update）
            this._updateLinkPreview();                                    // 接线预览线跟随光标
            this._animateCableSpawn();                                    // 新电缆生长动画推进
            if (this._dirty) {                                            // 按需渲染核心：脏才画
                this._renderer.render(this._scene, this._camera);         //   真正出帧
                this._dirty = false;                                     //   消脏
                // 刚渲染过 = 相机/内容有变化：端口投影与 2D 覆盖层同步到最新帧，
                // 拖动视角时仪表连线紧跟 3D 端子（无需等 20fps 的 tick）
                this._syncPortCircles();                                  //   端口投影即时同步
                this._portsDirty = false;                                 //   消投影脏
                this._drawHybridOverlay();                                //   覆盖层即时同步
            }
        };
        loop();                                                           // 立即启动
    }

    /** 接线中：从起点端子到鼠标在桌面上的投影点画下垂预览线
     *  预览曲线仅在落点变化时重建（避免每帧 TubeGeometry 分配造成卡顿） */
    _updateLinkPreview() {
        const ls = this.sys ? this.sys.linkingState : null;               // 平台接线状态
        const active = ls && ls.type === 'wire' && this._portRegistry.has(ls.portId) && this._mouse; // 从 3D 端子起头且光标在视窗内

        if (!active) {                                                    // 不在有效预览态：
            if (this._preview) { this._disposePreview(); this._dirty = true; } // 有预览就清掉（多一帧消影）
            return;
        }
        const A = new THREE.Vector3();
        if (!this._terminalWorld(ls.portId, A)) {                         // 起点端子坐标算不出（理论少见）：
            if (this._preview) { this._disposePreview(); this._dirty = true; } // 同上清预览
            return;
        }
        this._syncMatrices();                                             // 矩阵保鲜
        this._raycaster.setFromCamera(this._mouse.ndc, this._camera);     // 光标射线
        const P = new THREE.Vector3();
        if (!this._raycaster.ray.intersectPlane(this._plane, P)) {        // 射线与桌面不相交：
            if (this._preview) { this._disposePreview(); this._dirty = true; }
            return;
        }
        P.y = Math.max(P.y, WORLD.tableTop + 0.02);                        // 落点高度下限：桌面上 2cm（预览线不钻桌底）

        if (this._previewEnd && this._previewEnd.distanceToSquared(P) < 1e-8) return; // 落点没动（<0.01mm）→ 不重建（防 TubeGeometry 每帧分配卡顿）
        this._previewEnd = P.clone();                                     // 记新落点

        if (!this._preview) {                                             // 首次建预览网格：
            this._preview = new THREE.Mesh(new THREE.BufferGeometry(), this._previewMat); // 空几何占位（马上被替换）
            this._scene.add(this._preview);
        }
        this._preview.geometry.dispose();                                 // 释放旧几何
        this._preview.geometry = new THREE.TubeGeometry(                 // 换新下垂预览管：
            sagCurve(THREE, A, P, WORLD.cableSagY, this._fpFor(ls.portId), null), // 起端带足迹逃逸；落点是桌面点无足迹
            24, WORLD.cableR * 1.1, 8);                                   //   预览用低配 24 段、稍粗 10%（醒目）
        this._dirty = true;                                               // 有新预览要重绘
    }

    /** 弃掉预览线（Esc/成线/失效时）。 */
    _disposePreview() {
        if (this._preview) {
            this._scene.remove(this._preview);                            // 移出场景
            this._preview.geometry.dispose();                             // 释放几何
            this._preview = null;                                         // 清引用
        }
        this._previewEnd = null;                                          // 落点记忆一并清（下次接线重建）
    }

    /** 新电缆生长动画（drawRange 从起点逐渐展开） */
    _animateCableSpawn() {
        const now = performance.now();
        for (const [, c] of this._cables) {                              // 遍历电缆表
            if (c.done) continue;                                         // 已长完的跳过
            const geo = c.mesh.geometry;
            const t = (now - c.born) / 520;                               // 归一进度（520ms 长完）
            if (t >= 1) {                                                 // 长完了：
                geo.setDrawRange(0, Infinity);                            //   全量绘制
                c.done = true;                                            //   标完成（下轮不再碰）
            } else {                                                      // 还在长：
                const ease = 1 - Math.pow(1 - t, 3);                      //   ease-out cubic（先快后慢）
                const total = geo.index ? geo.index.count : Infinity;     //   索引总量
                geo.setDrawRange(0, Math.max(6, Math.floor(total * ease))); //   只画前 ease 比例（最少 6 个索引防空绘）
            }
            this._dirty = true;   // 本帧改动了 drawRange → 需要重绘        // 动画进行中每帧都要重绘
        }
    }

    // ════════════════════════ 清理 ════════════════════════

    /** 全量销毁：rAF/监听器/覆盖层/控件/渲染器/场景资源/DOM，一项不落。 */
    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);               // 停渲染循环
        window.removeEventListener('keydown', this._escHandler);           // Esc 监听成对移除
        if (this._cursorMove) window.removeEventListener('pointermove', this._cursorMove); // 全局光标监听移除
        if (this.sys && this.sys.stage) {                                 // Konva 侧守卫事件：
            try { this.sys.stage.off('dragmove.d3guard'); } catch (err) { /* ignore */ } // 命名空间整体 off
        }
        if (this._overlay) this._overlay.remove();                        // 覆盖画布移出 DOM
        if (this._controls) this._controls.dispose();                     // OrbitControls 释放（含其全部监听）
        if (this._renderer) this._renderer.dispose();                      // WebGL 上下文释放
        if (this._scene) {
            this._scene.traverse((o) => {                                 // 场景树深度遍历：
                if (o.geometry) o.geometry.dispose();                     //   每个几何体释放显存
                if (o.material) {
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { //   材质可能数组：
                        if (m.map && m.map.dispose) m.map.dispose();     //     先放贴图（标签 canvas 纹理）
                        m.dispose();                                      //     再放材质本体
                    });
                }
            });
        }
        if (this._vp && this._vp.parentNode) this._vp.parentNode.removeChild(this._vp); // 视窗 div 移出 DOM
    }
}
