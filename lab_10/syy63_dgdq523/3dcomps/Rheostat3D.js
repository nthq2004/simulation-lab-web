/**
 * Rheostat3D —— 真 3D 滑动变阻器组件（串联限流，拖动滑片改变灯泡亮度）
 *
 * 电气模型：type='resistor'，端口 l/r，向求解内核申报 currentResistance。
 *   滑片位置 sliderPos（0~1）线性映射阻值 rMin~rMax（0 = 阻值最小、灯最亮）。
 *   内部接线（真实变阻器接法）：左柱 → 绕线入口（管左端第一环），右柱 → 上方金属条
 *   （滑轨）右端；电流路径 = 绕线（左端→滑片触点）+ 金属条（触点→右端）。
 *   所以滑片越往右（sliderPos 越大）接入的绕线越长、阻值越大，与下面的线性映射自洽。
 *   与灯泡串联后，变阻器阻值变化直接改变分压 → 灯泡端电压 → 灯泡热度 → 亮度，
 *   形成"滑片一动 → 亮度跟着变"的可见闭环（本工程的核心演示点）。
 *
 * 交互：点击并拖动滑片（宿主射线拾取滑片拾取盒，kind='slider'）→ 宿主把光标
 *   在滑轨高度平面上的落点交给 dragSlider()，本组件换算成本地 x → sliderPos。
 *   拖动期间宿主禁用 OrbitControls，相机不转；松手即停在原处（滑片不自复位）。
 *
 * 布局范式（与其它 3D/2D 组件同款）：构造期调 _recalcGeometry(config)，
 *   由底板长度 baseW / 底板宽度 baseD 推算瓷管、绕线环、滑轨、滑片、端子柱
 *   全部位（_geo 布局表）；buildThree() 只消费 _geo，不散落魔法数。
 */
import * as THREE from 'three';                                     // three.js 命名空间
import { BaseComponent } from '../components/BaseComponent.js';     // 平台组件基类
import { WORLD } from './world3d.js';                                // 世界常量（变阻器摆放位置）

const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));         // 数值钳制小工具（三处复用）

export class Rheostat3D extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);                                          // 基类构造：Konva group、登记进 sys

        this.type = 'resistor';                                       // 电气类型：电阻 → DeviceStamps 注入 currentResistance
        this.cache = false;                                           // 无 2D 画面，永不缓存位图
        this.group.draggable(false);                                  // 位置由 3D 宿主管理，禁 Konva 拖动

        this._initGroups();                                           // 基类标准三组（静态/动态/交互）

        // 规范顺序：_initGroups → _recalcGeometry → _initParameters(内联) → _init
        // 外形尺寸仅构造期生效：运行中改尺寸需整树重建 3D 模型，本工程不提供该路径
        this._recalcGeometry(config);                                 // 由底板尺寸推算全部部件位（_geo 布局表）

        // 铭牌参数（均可在右键参数框里改）
        this.rMin = _clamp(Number(config.rMin !== undefined ? config.rMin : 1), 0, 200);      // 最小阻值 1Ω（滑片到最左）
        this.rMax = _clamp(Number(config.rMax !== undefined ? config.rMax : 60), 0.5, 500);   // 最大阻值 60Ω（滑片到最右）
        if (this.rMax <= this.rMin) this.rMax = this.rMin + 1;                                 // 防倒置：最大必须大于最小
        this.sliderPos = _clamp(Number(config.sliderPos !== undefined ? config.sliderPos : 0.25), 0, 1); // 初始滑片位 25%（中亮）

        this.config = {                                               // 配置副本（先于 _init，供对话框回写与 hostId 取用）
            hostId: config.hostId,                                    // 宿主 id（3D 场景）
            rMin: this.rMin, rMax: this.rMax,                         // 阻值范围
            sliderPos: this.sliderPos,                                // 滑片位置（0~1）
            baseW: this._geo.baseW, baseD: this._geo.baseD,            // 外形尺寸留档（不进参数框：改它需重建模型）
        };

        // 电气量：串在回路里的即时阻值（求解内核每帧读这个值）
        this.currentResistance = this.rMin + (this.rMax - this.rMin) * this.sliderPos;

        this._init();                                                 // 端口 + 挂宿主
    }

    /** 部件布局推算（2D 组件 _recalcGeometry 同款范式）：
     *  由底板长度/宽度推算底板块、两端支架、陶瓷管、绕线环、滑轨、滑片、
     *  接线柱与 footprint 全部位；buildThree() 只消费 _geo。幂等可重跑。
     */
    _recalcGeometry(config) {
        const bw = _clamp(Number(config.baseW) || 0.95, 0.6, 1.3);     // 底板长 0.6~1.3m，缺省 0.95（长条形变阻器）
        const bd = _clamp(Number(config.baseD) || 0.30, 0.22, 0.5);    // 底板宽 0.22~0.5m，缺省 0.30

        const plateT = 0.04;                                           // 底板厚（固定）
        const postR = 0.030, postH = 0.10;                             // 接线柱半径/高
        const endX = bw / 2 - 0.07;                                    // 端子柱位：自板缘内收 70mm（支架之外）
        const postY = plateT + postH / 2;                              // 柱心：柱底坐在板面
        const postTop = postY + postH / 2;                             // 柱顶（footprint 顶面基准）

        const supW = 0.10, supH = 0.15;                                // 两端支架（瓷管座）尺寸
        const supX = bw / 2 - 0.16;                                    // 支架位：板内 160mm（给端子柱留位）
        const supY = plateT + supH / 2;                                // 支架心：坐在板面
        const tubeLen = bw - 0.34;                                     // 陶瓷管长：两端支架之间
        const tubeR = 0.055;                                           // 陶瓷管半径
        const tubeY = plateT + supH + tubeR - 0.02;                    // 管心：架在支架顶、略嵌入 20mm（不悬空）
        const wireN = 16;                                              // 绕线环数量（视觉密排，真实变阻器为连续绕线）
        const wireSpan = tubeLen - 0.14;                               // 绕线覆盖长度（两端各留 70mm 光管）
        const wireR = tubeR + 0.004, wireT = 0.007;                    // 绕线环半径（贴管面）/ 环截面半径

        const railY = tubeY + tubeR + 0.075;                           // 滑轨高度：管顶之上 75mm
        const railR = 0.011;                                           // 滑轨半径（细圆杆）
        const leadR = 0.008;                                           // 内部引线半径（镀锡铜线）
        const leadInX = -wireSpan / 2 - 0.015;                          // 绕线入口：管左端第一环外侧（左柱引到这里）
        const leadRailX = tubeLen / 2 + 0.01;                          // 金属条右端：与滑轨右端点对齐（右柱引到这里）
        const slideX0 = -wireSpan / 2 + 0.02;                          // 滑片行程起点（略入绕线区）
        const slideTravel = wireSpan - 0.04;                           // 滑片行程长度（silderPos 0→1 对应它）
        const slideBody = [0.055, 0.06, 0.10];                         // 滑片滑块尺寸（宽/高/深）
        const armH = railY - (tubeY + tubeR) - slideBody[1] / 2;       // 支臂长（滑块底 → 管面，随几何自适应）
        const armY = (railY + tubeY + tubeR) / 2 + 0.005;              // 支臂心：滑块与管面之间
        const contactY = tubeY + tubeR + 0.008;                        // 触点：压在管面绕线之上
        const gripR = 0.026, gripH = 0.05;                             // 顶部手柄（绝缘捏手）
        const gripY = railY + slideBody[1] / 2 + gripH / 2;            // 手柄：滑块顶面之上

        this._geo = {
            baseW: bw, baseD: bd, plateT, plateY: plateT / 2,          // 底板
            postR, postH, postY, postTop, endX,                        // 两端接线柱
            supW, supH, supX, supY,                                    // 支架
            tubeLen, tubeR, tubeY, wireN, wireSpan, wireR, wireT,      // 陶瓷管 + 绕线
            railY, railR,                                              // 滑轨
            leadR, leadInX, leadRailX,                                 // 内部引线：左柱→绕线入口、右柱→金属条右端
            slideX0, slideTravel, slideBody,                           // 滑片行程与滑块
            armH, armY, contactY,                                      // 滑片支臂/触点
            gripR, gripH, gripY,                                       // 手柄
            // 足迹顶面取"手柄顶 + 10mm"：电缆逃逸水平段必须高于滑片，否则会从滑片中间穿过
            fp: { hx: bw / 2, hz: bd / 2, top: gripY + gripH / 2 + 0.01 },
            tip: new THREE.Vector3(0, 0.035, 0),                       // 端子 tip：柱顶上方 35mm
        };
    }

    _init() {
        this.addPort(0, 0, 'l', 'wire', null);                        // 左端子端口：rhe_wire_l
        this.addPort(0, 0, 'r', 'wire', null);                        // 右端子端口：rhe_wire_r
        this.ports.forEach(p => {
            if (p.node) { p.node.listening(false); p.node.opacity(0); p.node.radius(2); } // 端口锚点隐形化（点击走 3D 射线）
        });

        const hostId = this.config.hostId;                            // 宿主 id 从配置副本取（构造器形参已出作用域）
        const host = (this.sys.comps || {})[hostId];                  // 在注册表找 3D 场景宿主
        if (host && typeof host.registerDevice === 'function') host.registerDevice(this); // 注册进 3D 场景
        else console.warn(`[Rheostat3D ${this.id}] 未找到 3D 宿主组件（hostId=${hostId}）`);
    }

    // ════════════════════════ 滑片 / 阻值 ════════════════════════

    /** 设置滑片位置（0~1）：写阻值 + 挪滑片网格 + 通知宿主重绘。
     *  这是滑片与电气量的唯一同步入口（拖动、参数框、演示脚本都走它）。
     */
    setSliderPos(p) {
        const q = _clamp(Number(p) || 0, 0, 1);                        // 钳到 0~1（非法值当 0）
        if (Math.abs(q - this.sliderPos) < 1e-6) return this.sliderPos; // 没变化就不折腾（防拖动时无谓重绘）
        this.sliderPos = q;
        this.config.sliderPos = q;                                     // 同步配置副本（再次打开参数框显示新值）
        this.currentResistance = this.rMin + (this.rMax - this.rMin) * q; // 阻值线性映射：0 → rMin，1 → rMax
        if (this._slideGroup) {                                        // 滑片网格存在才挪（未建树时只记状态）
            this._slideGroup.position.x = this._geo.slideX0 + this._geo.slideTravel * q; // 本地 x 随位置线性移动
        }
        if (this._host && this._host._invalidate) this._host._invalidate(); // 按需渲染：内容变了才有下一帧
        return q;
    }

    /** 拖动滑片：宿主传入光标在滑轨高度平面上的世界点 → 换算成本地 x → 位置 0~1。
     *  注意 root 可被整体拖动（换位），所以必须先刷新世界矩阵再 worldToLocal。
     */
    dragSlider(worldPoint) {
        if (!this._rootRef || !worldPoint) return;                     // 未建树/无落点则忽略
        this._rootRef.updateWorldMatrix(true, false);                  // 强刷世界矩阵（器件可能刚被拖到新位置）
        const local = this._rootRef.worldToLocal(worldPoint.clone());  // 世界点 → 器件本地坐标
        const p = (local.x - this._geo.slideX0) / this._geo.slideTravel; // 本地 x → 归一位置
        this.setSliderPos(p);                                          // 钳制 + 生效（setSliderPos 内部钳位）
    }

    /** 宿主射线拾取滑片时需要的"拖动平面高度"（世界 y）：
     *  取滑轨高度，光标在该平面上的落点与滑片同高，拖动不会因视角俯仰产生横向偏差。
     */
    slidePlaneY() {
        const rootY = this._rootRef ? this._rootRef.position.y : WORLD.tableTop; // 器件当前世界高度
        return rootY + this._geo.railY;                                // 滑轨世界高度
    }

    /** 右键参数框字段：阻值范围 + 滑片位置（拖动之外也能精确设定） */
    getConfigFields() {
        return [
            { key: 'rMin', label: '最小阻值 (Ω)', type: 'number', min: 0, max: 50, step: 0.5 },   // 滑片最左端
            { key: 'rMax', label: '最大阻值 (Ω)', type: 'number', min: 1, max: 500, step: 1 },    // 滑片最右端
            { key: 'sliderPos', label: '滑片位置 (0~1)', type: 'number', min: 0, max: 1, step: 0.01 }, // 精确设定滑片
        ];
    }

    /** 配置保存回调：钳位 + 即时生效（阻值重算、滑片跟着移动到新位置） */
    onConfigUpdate(cfg) {
        if (cfg.rMin !== undefined) {                                  // 最小阻值：0~200Ω
            this.rMin = _clamp(Number(cfg.rMin) || 0, 0, 200);
            this.config.rMin = this.rMin;
        }
        if (cfg.rMax !== undefined) {                                  // 最大阻值：0.5~500Ω，且必须大于最小
            this.rMax = _clamp(Number(cfg.rMax) || 1, 0.5, 500);
            this.config.rMax = this.rMax;
        }
        if (this.rMax <= this.rMin) this.rMax = this.rMin + 1;          // 防倒置（最小=最大时无法调节）
        if (cfg.sliderPos !== undefined) this.setSliderPos(cfg.sliderPos); // 滑片位置（内部会同步阻值与网格）
        else {                                                          // 只改了阻值范围：
            this.currentResistance = this.rMin + (this.rMax - this.rMin) * this.sliderPos; //   按当前滑片重算
            if (this._host && this._host._invalidate) this._host._invalidate();
        }
    }

    /** 每帧无需动画：滑片位置在拖动/设值时已即时生效，热度闭环由灯泡自己完成 */
    tick() { /* 无帧内动态（不做 tick 内工作，避免无谓重绘） */ }

    /** 构建真 3D 模型（由宿主调用）。
     *  造型：底板 + 两端支架 + 横置陶瓷管 + 密排绕线环 + 上方滑轨 + 可移动滑片 + 两端接线柱。
     */
    buildThree() {
        const g = this._geo;                                           // 布局表（_recalcGeometry 产物）
        const root = new THREE.Group();                                // 器件网格树根
        root.position.set(WORLD.rheX, WORLD.tableTop, WORLD.rheZ);     // 世界坐标：桌面中前部、贴桌面顶高
        this._rootRef = root;                                          // 存引用：拖动滑片时 worldToLocal / 取高度用

        const baseMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.7, metalness: 0.05 }); // 底板深灰
        const ceramic = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.75 });               // 陶瓷米白（管身/支架）
        const copper = new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.4, metalness: 0.75 }); // 绕线紫铜
        const brass = new THREE.MeshStandardMaterial({ color: 0xcfa64b, roughness: 0.35, metalness: 0.85 }); // 黄铜（柱/滑轨）
        const dark = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.55 });                  // 捏手哑光黑

        const base = new THREE.Mesh(new THREE.BoxGeometry(g.baseW, g.plateT, g.baseD), baseMat); // 绝缘底板（长条）
        base.position.y = g.plateY;                                    // 底面贴桌面
        base.castShadow = true;
        base.receiveShadow = true;
        root.add(base);

        // 两端支架：托起陶瓷管（下方留出端子柱位置）
        for (const sx of [-g.supX, g.supX]) {
            const sup = new THREE.Mesh(new THREE.BoxGeometry(g.supW, g.supH, g.baseD * 0.55), ceramic); // 支架块
            sup.position.set(sx, g.supY, 0);                            // 坐在底板上
            sup.castShadow = true;
            sup.receiveShadow = true;
            root.add(sup);
        }

        // 横向陶瓷管（圆柱默认沿 y，绕 z 转 90° → 沿 x 横放）
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(g.tubeR, g.tubeR, g.tubeLen, 28), ceramic);
        tube.rotation.z = Math.PI / 2;                                 // 轴向改为 x
        tube.position.set(0, g.tubeY, 0);                              // 架在两支架顶
        tube.castShadow = true;
        tube.receiveShadow = true;
        root.add(tube);

        // 密排绕线环（细 Torus）：模拟变阻器电阻丝，沿管长均布
        for (let i = 0; i < g.wireN; i++) {
            const t = g.wireN === 1 ? 0.5 : i / (g.wireN - 1);           // 0~1 归一分布
            const ring = new THREE.Mesh(new THREE.TorusGeometry(g.wireR, g.wireT, 8, 20), copper); // 贴管面的细环
            ring.rotation.y = Math.PI / 2;                              // Torus 默认在 xy 平面 → 转到 yz 平面（环面套住管轴）
            ring.position.set(-g.wireSpan / 2 + g.wireSpan * t, g.tubeY, 0); // 沿管轴均布
            root.add(ring);
        }

        // 上方滑轨（细黄铜圆杆，沿 x）
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(g.railR, g.railR, g.tubeLen + 0.02, 12), brass.clone());
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, g.railY, 0);
        rail.castShadow = true;
        root.add(rail);

        // 滑片组（随 sliderPos 沿 x 移动）：滑块 + 支臂 + 触点 + 顶部捏手
        this._slideGroup = new THREE.Group();
        this._slideGroup.position.set(g.slideX0 + g.slideTravel * this.sliderPos, 0, 0); // 初始位置按 sliderPos
        root.add(this._slideGroup);

        const body = new THREE.Mesh(new THREE.BoxGeometry(g.slideBody[0], g.slideBody[1], g.slideBody[2]), brass.clone()); // 滑块（套在滑轨上）
        body.position.y = g.railY;
        body.castShadow = true;
        this._slideGroup.add(body);

        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.026, Math.max(0.01, g.armH), 0.03), brass.clone()); // 支臂：滑块向下连到管面
        arm.position.y = g.armY;
        this._slideGroup.add(arm);

        const contact = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.085), copper); // 触点：压在绕线上（取电压）
        contact.position.y = g.contactY;
        this._slideGroup.add(contact);

        const grip = new THREE.Mesh(new THREE.CylinderGeometry(g.gripR, g.gripR, g.gripH, 16), dark); // 顶部绝缘捏手
        grip.position.y = g.gripY;
        grip.castShadow = true;
        this._slideGroup.add(grip);

        // 滑片拾取盒：罩住整个滑片（含手柄），宿主射线命中它 → kind='slider' 进入滑片拖动
        const hitSlider = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.34, 0.20),                    // 比滑片本体大一圈，好抓
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) // 全透明不写深度
        );
        hitSlider.position.set(0, g.railY + 0.05, 0);                   // 以滑轨高度为中心罩住滑片上下
        hitSlider.userData = { kind: 'slider', comp: this, visual: body }; // 自报家门：滑片拖动 + 高亮滑块
        this._slideGroup.add(hitSlider);                                // 挂滑片组下 → 拾取盒随滑片移动

        // 两端接线柱（立在底板端部，电缆从柱顶接进）
        const mkTerm = (x) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(g.postR, g.postR, g.postH, 18), brass.clone()); // 黄铜柱
            post.position.set(x, g.postY, 0);
            post.castShadow = true;
            root.add(post);

            const hit = new THREE.Mesh(                                 // 隐形拾取柱（端子优先于滑片拾取）
                new THREE.CylinderGeometry(0.062, 0.062, 0.20, 12),
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
            );
            hit.position.set(x, g.postY + 0.03, 0);                     // 比视觉柱高一截，覆盖柱顶之上
            root.add(hit);
            return { post, hit, tip: g.tip.clone() };
        };
        const L = mkTerm(-g.endX);                                      // 左端子（接绕线入口）
        const R = mkTerm(g.endX);                                       // 右端子（接金属条右端）

        // ── 内部引线：把两端接线柱与“绕线入口 / 金属条右端”真实连起来 ──
        // 真实教学变阻器就是这样接的：电流从左柱进去、经过一段绕线、经滑片触点
        // 转到上方金属条、再从右柱出来；滑片位置决定“接入绕线”的长度。
        const leadMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.9 }); // 镀锡亮银
        const mkLead = (pts) => {
            const curve = new THREE.CatmullRomCurve3(pts);              // 控制点平滑成弧线
            const lead = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, g.leadR, 10, false), leadMat);
            lead.castShadow = true;
            root.add(lead);
            return lead;
        };
        const joint = (x, y, z) => {                                    // 焊点小球（接头处好看也明确“连上了”）
            const s = new THREE.Mesh(new THREE.SphereGeometry(g.leadR * 1.5, 12, 10), leadMat);
            s.position.set(x, y, z);
            root.add(s);
        };

        // 左引线：左柱 → 从支架前侧绕过 → 接到管左端绕线入口
        const leadZ = g.baseD * 0.34;                                   // 走线 z：贴着支架前缘外侧（不穿支架）
        mkLead([
            new THREE.Vector3(-g.endX, g.postTop - 0.02, 0),            //   柱身顶部（埋入柱内）
            new THREE.Vector3(-g.endX, g.postTop + 0.04, leadZ * 0.5),  //   从柱顶稍稍抽出
            new THREE.Vector3(-(g.endX + g.supX) / 2, g.postTop + 0.03, leadZ), // 绕到支架前侧
            new THREE.Vector3(g.leadInX - 0.03, g.tubeY + 0.035, leadZ),         // 升到管心高度之上
            new THREE.Vector3(g.leadInX, g.tubeY, g.wireR),             //   落到绕线入口（管面前侧第一个环）
        ]);
        joint(g.leadInX, g.tubeY, g.wireR);                             // 绕线入口焊点

        // 右引线：右柱 → 竖直上升 → 沿金属条向右引到滑轨右端
        mkLead([
            new THREE.Vector3(g.endX, g.postTop - 0.02, 0),             //   柱身顶部
            new THREE.Vector3(g.endX, g.railY + 0.02, 0),               //   竖直升到滑轨高度之上
            new THREE.Vector3(g.leadRailX + 0.05, g.railY + 0.012, 0),  //   平直向左引向金属条
            new THREE.Vector3(g.leadRailX, g.railY, 0),                 //   接到滑轨（金属条）右端
        ]);
        joint(g.leadRailX, g.railY, 0);                                 // 金属条右端焊点

        // 申报协议：footprint 顶面高于滑片手柄（电缆从整机上方越过，不穿滑片）
        return {
            root,
            footprint: { hx: g.fp.hx, hz: g.fp.hz, top: g.fp.top },
            terminals: [
                { port: 'l', mesh: L.post, hit: L.hit, tip: L.tip },
                { port: 'r', mesh: R.post, hit: R.hit, tip: R.tip },
            ],
            pickables: [hitSlider],                                     // 滑片拾取盒 → 宿主统一拾取列表（kind 区分用途）
        };
    }
}
