/**
 * Battery3D —— 真 3D 电池（直流电源）组件
 *
 * 电气模型：type='source'，端口 p/n（求解内核 Norton 等效注入：
 *   getValue() / rOn，负端由内核自动钳位为电压参考地）。
 * 视觉模型：three.js 立体电池盒 + 正负极接线柱，注册进 3D 宿主
 *   Circuit3DScene；点击接线柱由宿主射线拾取后转发 sys.handlePortClick。
 *
 * 双重身份（本工程的关键设计）：
 *   它同时是「平台组件」（继承 BaseComponent：端口、配置框、求解接口）
 *   和「3D 器件」（buildThree 交出 three.js 网格树，由宿主统一渲染拾取）。
 *   Konva 侧只保留两个隐形端口锚点，供 2D 仪表连线用协议坐标。
 * 布局范式（与 2D 组件同款）：构造期调 _recalcGeometry(config)，由外形
 *   尺寸（boxW/boxH/boxD，可由 config 覆盖、钳制安全区间）推算出 _geo
 *   部件布局表；buildThree() 只消费 _geo、不再散落魔法数。
 */
import * as THREE from 'three';                                     // three.js 命名空间（本组件自建 3D 模型）
import { BaseComponent } from '../components/BaseComponent.js';     // 平台组件基类：端口/配置框/分组等公共能力
import { WORLD } from './world3d.js';                                // 世界常量：桌面高度、电池摆放位置

export class Battery3D extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);                                         // 基类构造：建 Konva group、登记进 sys

        this.type = 'source';                                       // 电气类型：直流电源 → DeviceStamps 按 Norton 源注入 MNA
        this.cache = false;                                          // Konva 侧永不缓存位图（本组件没有 2D 画面，仅端口锚点）
        this.group.draggable(false);                                 // 禁止 Konva 拖动（位置固定于 3D 桌面，由宿主管理）

        this._initGroups();                                          // 基类标准三组：static/dynamic/interact（本组件基本闲置）

        // 规范顺序：_initGroups → _recalcGeometry → _initParameters(内联) → _init
        // 外形尺寸仅构造期生效：运行中改尺寸需整树重建 3D 模型，本工程不提供该路径
        this._recalcGeometry(config);                                // 由外形尺寸推算全部部件位（_geo 布局表）

        this.voltage = (config.voltage !== undefined) ? Number(config.voltage) : 3;  // 端电压，默认 3V（可右键改 0.5~24V）
        this.rOn = 0.4;                                              // 内阻 0.4Ω（Norton 电导 = 1/rOn；关断时置 1e9）
        this.isOn = true;                                            // 电池恒输出（保留断路能力：false 时 getValue=0）

        // config 副本必须先于 _init() 建好：_init 里要用 hostId 找宿主，
        // 且 BaseComponent.showConfigDialog 保存时会整份回写这份副本
        // （外形尺寸留档但不进参数框：改它需要重建模型，不放右键对话框）
        this.config = { hostId: config.hostId, voltage: this.voltage, rOn: this.rOn,
            boxW: this._geo.bodyW, boxH: this._geo.bodyH, boxD: this._geo.bodyD };

        this._init();                                                // 端口注册 + 挂接 3D 宿主
    }

    /** 部件布局推算（2D 组件 _recalcGeometry 同款范式）：
     *  由外形尺寸推算盒体/盖板/接线柱/识别环/铭牌/footprint 全部位，
     *  存入 _geo；buildThree() 只消费 _geo —— 改一处尺寸，全身随动。
     *  幂等可重跑（纯计算，不碰场景）。
     */
    _recalcGeometry(config) {
        const w = Math.min(1.0, Math.max(0.4, Number(config.boxW) || 0.6));   // 盒长 0.4~1.0m，缺省 0.6
        const h = Math.min(0.6, Math.max(0.2, Number(config.boxH) || 0.34));  // 盒高 0.2~0.6m，缺省 0.34
        const d = Math.min(0.7, Math.max(0.3, Number(config.boxD) || 0.42));  // 盒深 0.3~0.7m，缺省 0.42
        const capT = 0.02;                                             // 盖板厚（固定工艺尺寸）
        const capY = h + capT;                                        // 盖板中心：骑在盒顶
        const postR = 0.034, postH = 0.09;                            // 接线柱半径/高（固定）
        const postX = w / 2 - 0.13;                                   // 柱位：自盒缘内收 130mm
        const postZ = Math.max(0.02, d / 2 - 0.15);                   // 柱稍偏盒后侧（前部让给铭牌）
        const postY = capY + capT / 2 + postH / 2;                    // 柱底坐盖板顶
        const ringR = 0.05, ringT = 0.014;                             // 极性识别环
        const ringY = capY + capT / 2 + ringT / 2;                     // 环贴盖板顶包住柱底
        const hitR = 0.065, hitH = 0.16;                               // 拾取柱（视觉柱的命中加粗版）
        const plateW = Math.min(0.3, w * 0.5);                         // 顶部铭牌宽（随盒长但不超 0.3）
        const plateH = plateW * (0.115 / 0.3);                        // 铭牌高按原比例
        const plateY = capY + capT / 2 + 0.002;                      // 贴盖板顶上方 2mm
        const plateZ = -(d / 2 - 0.16);                               // 略偏盒后侧（让出前部接线区）
        this._geo = {
            bodyW: w, bodyH: h, bodyD: d, bodyY: h / 2,               // 盒体：中心=半高 → 底贴桌面
            capW: w - 0.08, capT, capD: d - 0.08, capY,               // 盖板比盒体四周小 40mm
            postX, postY, postZ, postR, postH,
            ringY, ringR, ringT,
            hitR, hitH,
            plateW, plateH, plateY, plateZ,
            fp: { hx: w / 2, hz: d / 2, top: capY + capT / 2 },        // 足迹：半尺寸=盒半宽深，顶面=盖板顶
            tip: new THREE.Vector3(0, 0.045, 0),                     // 端子 tip：柱心上方 45mm（柱高一半）
        };
    }

    _init() {
        // 端口仅作电气锚点：坐标由 3D 宿主每帧按投影覆盖，节点不监听
        // Konva 事件（真实点击全部走 three.js 射线拾取）
        this.addPort(0, 0, 'p', 'wire', 'p');                        // 正极端口：polarity 'p' → 端口名 bat_wire_p（红色线约定）
        this.addPort(0, 0, 'n', 'wire', null);                      // 负极端口：bat_wire_n（求解内核自动钳为参考地）
        this.ports.forEach(p => {
            if (p.node) { p.node.listening(false); p.node.opacity(0); p.node.radius(2); } // 隐形化：不监听、全透明、缩成小点
        });

        const hostId = this.config.hostId;                           // 从配置副本取宿主 id（勿用构造器形参 config，_init 时它不在作用域）
        const host = (this.sys.comps || {})[hostId];                // 在组件注册表里找 3D 场景宿主
        if (host && typeof host.registerDevice === 'function') host.registerDevice(this); // 找到 → 把自己注册进 3D 场景
        else console.warn(`[Battery3D ${this.id}] 未找到 3D 宿主组件（hostId=${hostId}）`); // 没找到只警告不崩溃（可独立 2D 使用）
    }

    /** 电源注入电压 (V)；rOn 为内阻 (Ω)。
     *  求解内核 stampPowerSources 以 getValue()/rOn 做 Norton 等效：
     *  电流源 V/rOn 并联电导 1/rOn —— 三参数二端戴维南→诺顿变换。
     */
    getValue() {
        return this.isOn ? this.voltage : 0;                         // 断路（isOn=false）时注入 0V
    }

    /** 右键参数配置框字段（平台 showConfigDialog 渲染，输入框 id=diag_voltage） */
    getConfigFields() {
        return [
            { key: 'voltage', label: '电池电压 (V)', type: 'number', min: 0.5, max: 24, step: 0.5 }, // 电压范围 0.5~24V、步进 0.5
        ];
    }

    /** 配置保存回调：钳位到安全区间并即时生效（求解每帧读 getValue） */
    onConfigUpdate(cfg) {
        if (cfg.voltage !== undefined) {                             // 只处理显式给出的字段
            this.voltage = Math.min(24, Math.max(0.5, Number(cfg.voltage) || 3)); // 双向钳位 0.5~24V；非法值回落 3V
            this.config.voltage = this.voltage;                     // 同步回配置副本（下次打开对话框显示当前值）
            this._drawTopLabel();                                   // 重绘盒顶铭牌 "DC x V"，画面即时反映
        }
    }

    /** 构建真 3D 模型（由宿主 Circuit3DScene 调用）。
     *  返回 { root, footprint, terminals, pickables }——宿主按此协议接管渲染与拾取。
     *  坐标为器件局部系（原点在桌面放置点），宿主把 root.position 定到 WORLD.batX/batZ。
     */
    buildThree() {
        const root = new THREE.Group();                              // 器件网格树根节点（宿主会挂到 _deviceRoot 下）
        root.position.set(WORLD.batX, WORLD.tableTop, WORLD.batZ);  // 放到世界坐标：桌面左前（约定式贴合，y=桌面顶高）

        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d4e89, roughness: 0.5, metalness: 0.15 }); // 盒体：深蓝塑料（低金属度）
        const capMat = new THREE.MeshStandardMaterial({ color: 0x3a6bb5, roughness: 0.45, metalness: 0.1 }); // 顶盖条：浅蓝塑料
        const brass = new THREE.MeshStandardMaterial({ color: 0xcfa64b, roughness: 0.35, metalness: 0.85 }); // 黄铜：高金属度，用于接线柱

        const g = this._geo;                                          // 布局表（_recalcGeometry 产物）：部件位全部由尺寸推算
        const body = new THREE.Mesh(new THREE.BoxGeometry(g.bodyW, g.bodyH, g.bodyD), bodyMat); // 电池盒主体（尺寸可配）
        body.position.y = g.bodyY;                                   // 盒中心=半盒高 → 底面贴桌面
        body.castShadow = true;                                      // 投影：光源照射在桌面产生影子
        body.receiveShadow = true;                                   // 受影：接受其他物体投来的影子（自遮挡更真实）
        root.add(body);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(g.capW, g.capT, g.capD), capMat); // 盒顶装饰盖板（比盒体小一圈）
        cap.position.y = g.capY;                                     // 骑在盒顶之上
        cap.receiveShadow = true;                                    // 受影
        root.add(cap);

        root.add(this._makeTopPlate());                              // 顶部电压铭牌（见下方方法）

        // 正负极接线柱（+ 红 / − 黑，均带更大的透明拾取柱）
        // mkPost(x, ringColor)：在盒顶 x 处立一根黄铜柱 + 彩色识别环 + 隐形拾取柱
        const mkPost = (x, ringColor) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(g.postR, g.postR, g.postH, 20), brass.clone()); // 黄铜柱（clone 材质：宿主悬停高亮会改 emissive，避免互相串色）
            post.position.set(x, g.postY, g.postZ);                  // 立在盖板顶之上，稍偏盒后侧
            post.castShadow = true;                                 // 投影
            root.add(post);

            const ring = new THREE.Mesh(                            // 柱底识别环：靠颜色区分正负极
                new THREE.CylinderGeometry(g.ringR, g.ringR, g.ringT, 20), // 环片尺寸随推算
                new THREE.MeshStandardMaterial({ color: ringColor, roughness: 0.6 }) // 颜色由调用方给（红/黑）
            );
            ring.position.set(x, g.ringY, g.postZ);                  // 贴在盖板顶上方包住柱底
            root.add(ring);

            const hit = new THREE.Mesh(                             // 隐形拾取柱：比视觉柱粗得多，方便鼠标点中
                new THREE.CylinderGeometry(g.hitR, g.hitR, g.hitH, 12), // 命中范围（视觉柱的加粗加高版）
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) // 全透明不写深度：完全不可见、也不遮挡后续绘制
            );
            hit.position.copy(post.position);                       // 与视觉柱同位（拾取范围上下扩展超出柱体）
            root.add(hit);
            return { post, hit };                                    // 视觉柱与拾取柱一并交回调用方
        };

        const p = mkPost(-g.postX, 0xd23b2f);                        // 正极：盒顶左侧，红环
        const n = mkPost(g.postX, 0x22262b);                         // 负极：盒顶右侧，黑环

        // 器件申报协议四件套：
        //   footprint —— 电缆足迹逃逸用（半尺寸+顶面高）：端点在盒内 → 电缆先爬出盒顶再下垂
        //   terminals —— 端子登记：mesh=视觉柱（宿主取世界坐标）、hit=拾取柱（射线目标）、tip=柱顶偏移（电缆端点）
        //   pickables —— 额外可点部件（闸刀手柄用，电池无）
        return {
            root,
            footprint: { hx: g.fp.hx, hz: g.fp.hz, top: g.fp.top }, // 电池盒足迹（随盒体尺寸推算；电缆逃逸越高越顶用）
            terminals: [
                { port: 'p', mesh: p.post, hit: p.hit, tip: g.tip.clone() }, // 正极端子：tip=柱顶偏移（电缆端点落位处）
                { port: 'n', mesh: n.post, hit: n.hit, tip: g.tip.clone() },  // 负极端子同上
            ],
            pickables: [],
        };
    }

    /** 顶部电压铭牌（CanvasTexture，随配置更新）。
     *  three.js 无内建文字：先在离屏 canvas 上写 "DC x V"，包装成纹理贴到盒顶平面。
     *  保留 canvas 与纹理的引用，改电压时只重画贴图、不重建网格。
     */
    _makeTopPlate() {
        const g = this._geo;                                         // 铭牌位置/尺寸同样取自布局表
        const cv = document.createElement('canvas');                // 离屏画布（不进 DOM）
        cv.width = 256;                                              // 尺寸须在 getContext 前设定
        cv.height = 96;
        this._topCanvas = cv;                                        // 存引用：_drawTopLabel 重画时复用
        this._topTex = new THREE.CanvasTexture(cv);                 // canvas → three 纹理
        if ('colorSpace' in this._topTex) this._topTex.colorSpace = THREE.SRGBColorSpace; // sRGB 色彩空间（r152+）

        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(g.plateW, g.plateH),            // 铭牌平面尺寸随盒体推算，盖在顶盖条上
            new THREE.MeshBasicMaterial({ map: this._topTex, transparent: true, depthWrite: false }) // Basic 材质不受光照，文字恒亮；不写深度防 z-fighting
        );
        m.rotation.x = -Math.PI / 2;                                 // 竖直平面放倒为水平（面朝上）
        m.position.set(0, g.plateY, g.plateZ);                       // 贴盖板顶、略偏盒后侧（让出前部接线区）
        this._drawTopLabel();                                       // 立即画第一帧铭牌文字
        return m;
    }

    /** 重画铭牌文字（电压变化时调用，只改贴图内容） */
    _drawTopLabel() {
        if (!this._topCanvas) return;                                // 铭牌尚未创建（构造早期）则跳过
        const cv = this._topCanvas;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);                   // 清掉旧字（透明底）
        ctx.font = 'bold 52px sans-serif';                           // 大号粗体，斜视角可读
        ctx.textAlign = 'center';                                    // 水平居中
        ctx.textBaseline = 'middle';                                 // 垂直居中
        const text = `DC ${this.voltage} V`;                         // 铭牌文案：直流电压值
        ctx.lineWidth = 8;                                           // 描边宽 8px
        ctx.strokeStyle = '#10131a';                                 // 深色描边（在蓝底上勾出字廓）
        ctx.strokeText(text, cv.width / 2, cv.height / 2);          // 先描边
        ctx.fillStyle = '#f0ead9';                                   // 米白字色
        ctx.fillText(text, cv.width / 2, cv.height / 2);            // 再填充，与描边同位叠印
        if (this._topTex) this._topTex.needsUpdate = true;           // 通知 three 重传贴图（否则 GPU 里还是旧图）
    }
}
