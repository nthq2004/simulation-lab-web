/**
 * Bulb3D —— 真 3D 白炽灯泡组件
 *
 * 电气模型：type='resistor'，端口 l/r，向求解内核申报 currentResistance。
 * 亮度闭环（本组件是三件套中最“活”的，把电参量翻译成光）：
 *   ① 每帧读 sys.getVoltageBetween(l, r) 取端电压（MNA 解出，含电池内阻分压）；
 *   ② RMS 平滑（EMA α=0.16）模拟热惯性 —— 灯丝不是瞬亮瞬灭；
 *   ③ 热阻模型：rCold 9Ω → rHot 33Ω 随发光度插值（白炽灯冷阻低、热阻高），
 *      阻值又反过来影响下一帧电压 → 电阻-电流-亮度自洽闭环；
 *   ④ 亮度驱动三重发光：玻璃 emissive、灯丝 emissive、真实 PointLight 照亮桌面；
 *   ⑤ 过压保护：vRms > vBurn 持续 1.2s → 烧毁（断路 1e9Ω、灯变暗灰全灭）；
 *      灯丝为真实螺旋钨丝（TubeGeometry 沿螺旋曲线扫掠），烧断时切换成两截断丝，
 *      断口裸露、端头留熔珠，玻璃熏黑但更通透，可清楚看到烧断的灯丝。
 * 布局范式（与 2D 组件同款）：构造期调 _recalcGeometry(config)，由底板
 *   尺寸与玻璃半径（plateW/glassR，可由 config 覆盖、钳制安全区间）推算出
 *   _geo 部件布局表；buildThree() 只消费 _geo、不再散落魔法数。
 */
import * as THREE from 'three';                                     // three.js 命名空间
import { BaseComponent } from '../components/BaseComponent.js';     // 平台组件基类
import { WORLD } from './world3d.js';                                // 世界常量（灯泡位置）

export class Bulb3D extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);                                         // 基类构造：Konva group、登记进 sys

        this.type = 'resistor';                                    // 电气类型：电阻 → DeviceStamps 注入 currentResistance
        this.cache = false;                                          // 无 2D 画面，永不缓存
        this.group.draggable(false);                                 // 位置由 3D 宿主管理

        this._initGroups();                                          // 基类标准三组

        // 规范顺序：_initGroups → _recalcGeometry → _initParameters(内联) → _init
        // 外形尺寸仅构造期生效：运行中改尺寸需整树重建 3D 模型，本工程不提供该路径
        this._recalcGeometry(config);                                // 由底板/玻璃尺寸推算全部部件位（_geo 布局表）

        // 铭牌参数（均可在右键参数框里改）
        this.vRated = (config.vRated !== undefined) ? Number(config.vRated) : 3;   // 额定电压 3V：低于它亮度打折（欠压暗光）
        this.vBurn = (config.vBurn !== undefined) ? Number(config.vBurn) : 6.5;    // 烧毁阈值 6.5V：超过并持续 → 烧毁
        this.config = {                                             // 配置副本（先于 _init，供对话框回写与 hostId 取用）
            hostId: config.hostId,
            vRated: this.vRated,
            vBurn: this.vBurn,
            plateW: this._geo.plateW, glassR: this._geo.glassR,       // 外形尺寸留档（不进参数框：改它需重建模型）
        };

        // 热阻模型
        this.rCold = 9;                                              // 冷态电阻 9Ω：通电瞬间电流大（真实白炽灯特性）
        this.rHot = 33;                                              // 热态电阻 33Ω：正常发光时的阻值
        this.currentResistance = this.rCold;                         // 求解内核每帧读这个值（初始=冷态）

        // 亮度状态机
        this._heat = 0;                                              // 热度 0~1：0=完全冷（灭），1=满亮度
        this._v2 = 0;                                                // 电压平方的 EMA（RMS 平滑量）
        this._burnT = 0;                                             // 过压累计计时（秒）；烧毁前先“坚持”1.2s
        this._burned = false;                                        // 烧毁标志（不可逆，刷新页面才复位）

        this._init();                                                // 端口 + 挂宿主
    }

    /** 部件布局推算（2D 组件 _recalcGeometry 同款范式）：
     *  由底板尺寸与玻璃半径推算灯座/收口颈/玻璃/灯丝/点光/端子柱/footprint
     *  全部位；buildThree() 只消费 _geo。幂等可重跑（纯计算）。
     */
    _recalcGeometry(config) {
        const pw = Math.min(0.6, Math.max(0.24, Number(config.plateW) || 0.34));  // 底板边长 0.24~0.6m，缺省 0.34
        const gR = Math.min(0.16, Math.max(0.08, Number(config.glassR) || 0.115)); // 玻璃球半径 0.08~0.16m，缺省 0.115
        const plateT = 0.04;                                            // 底板厚（固定）
        const postR = 0.028, postH = 0.07;                              // 端子柱
        const postX = pw / 2 - 0.05;                                    // 柱位：自板缘内收 50mm
        const postZ = pw / 2 - 0.02;                                    // 柱靠前缘（板前 20mm）
        const postY = plateT / 2 + postH / 2;                          // 柱底插进板内一半
        const hitR = 0.06, hitH = 0.13;                                 // 拾取柱
        const sockH = 0.09, sockRt = 0.075, sockRb = 0.08;              // 灯座（锥台：顶细底粗）
        const sockY = plateT + sockH / 2;                              // 座坐底板上
        const neckH = 0.02, neckR = 0.09;                               // 收口颈
        const neckY = sockY + sockH / 2 - 0.005 + neckH / 2;            // 颈与座顶搭接 5mm
        const neckTop = neckY + neckH / 2;                              // 颈顶面
        const glassY = neckTop + gR - 0.015;                           // 球心：颈顶+半径−15mm（沉入搭接）
        const filY = glassY - 0.01;                                    // 灯丝在球心略下
        const filR = gR * 0.17;                                        // 灯丝螺旋半径（随玻璃自适应，缺省约 20mm）
        const filH = gR * 0.62;                                        // 灯丝螺旋段高
        const filTurns = 4.5;                                          // 螺旋圈数（半圈收尾 → 两端分居左右两侧，各接一根引线；太密又看不清圈间空隙）
        const filWire = Math.max(0.0016, gR * 0.018);                  // 钨丝线径（约 2.1mm：细到能看清绕组，又不至于细到看不见）
        const lightY = glassY + 0.035;                                 // 点光在泡心上方
        this._geo = {
            plateW: pw, plateT, plateY: plateT / 2,
            postX, postZ, postY, postR, postH,
            hitR, hitH,
            sockH, sockRt, sockRb, sockY,
            neckH, neckR, neckY,
            glassR: gR, glassY, filY, lightY,                           // 玻璃半径/球心/灯丝高/点光高
            filR, filH, filTurns, filWire,                              // 灯丝螺旋：半径/高/圈数/线径
            fp: { hx: pw / 2, hz: pw / 2, top: glassY + gR },           // 足迹：板半尺寸；顶面=玻璃泡顶（电缆逃逸用）
            tip: new THREE.Vector3(0, 0.035, 0),                       // 端子 tip：柱顶上方 35mm
        };
    }

    _init() {
        this.addPort(0, 0, 'l', 'wire', null);                       // 左端子端口：bulb_wire_l
        this.addPort(0, 0, 'r', 'wire', null);                       // 右端子端口：bulb_wire_r
        this.ports.forEach(p => {
            if (p.node) { p.node.listening(false); p.node.opacity(0); p.node.radius(2); } // 端口锚点隐形化（点击走 3D 射线）
        });

        const hostId = this.config.hostId;                           // 宿主 id 从配置副本取（构造器形参已出作用域）
        const host = (this.sys.comps || {})[hostId];                // 在注册表找 3D 场景宿主
        if (host && typeof host.registerDevice === 'function') host.registerDevice(this); // 注册进 3D 场景
        else console.warn(`[Bulb3D ${this.id}] 未找到 3D 宿主组件（hostId=${hostId}）`);
    }

    /** 右键参数框字段：额定电压 / 烧毁阈值两档铭牌参数 */
    getConfigFields() {
        return [
            { key: 'vRated', label: '额定电压 (V)', type: 'number', min: 1, max: 24, step: 0.5 },  // 亮度标尺用
            { key: 'vBurn', label: '烧毁电压 (V)', type: 'number', min: 2, max: 40, step: 0.5 },   // 保护门槛用
        ];
    }

    /** 配置保存回调：钳位 + 即时生效（无内部状态联动，直接赋值即可） */
    onConfigUpdate(cfg) {
        if (cfg.vRated !== undefined) {                               // 额定电压：1~24V 钳位
            this.vRated = Math.min(24, Math.max(1, Number(cfg.vRated) || 3));
            this.config.vRated = this.vRated;                        // 同步副本（下次打开对话框显示新值）
        }
        if (cfg.vBurn !== undefined) {                               // 烧毁阈值：2~40V 钳位
            this.vBurn = Math.min(40, Math.max(2, Number(cfg.vBurn) || 6.5));
            this.config.vBurn = this.vBurn;
        }
    }

    /** 每帧电气→热→光计算（consys 20fps 调用）。
     *  全流程：读端电压 → RMS 平滑 → 热度插值 → 热阻回写 → 视觉应用。
     *  getVoltageBetween 依赖求解内核算完的节点电位（consys 先 solve 再 tick，顺序有保证）。
     */
    tick(dt) {
        const sys = this.sys;                                        // 平台引用（勿裸用全局 window.sys）
        let v = 0;                                                   // 本帧端电压，默认 0（无任何保障时保持灭灯）

        // 读数防护三连：①内核就绪 ②至少有一根 wire 连线（_updatePhysics 无线不求解，读数是 NaN） ③数值有限
        if (sys && sys.voltageSolver && sys.conns && sys.conns.some(c => c.type === 'wire')) {
            const pd = sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`); // MNA 两端节点电位差
            if (Number.isFinite(pd)) v = Math.abs(pd);               // 有限才采纳（交流/奇异矩阵兜底全挡在门外）
        }

        // 过压烧毁判定：超过阈值持续 1.2s 才烧（模拟热累积，也避免接线瞬间的毛刺误伤）
        if (!this._burned && v > this.vBurn) {                       // 未烧且当前过压
            this._burnT += (dt || 0.05);                             // 累计过压时长（dt 缺省按 0.05s 防卡死）
            if (this._burnT > 1.2) this._setBurned();                 // 坚持 1.2s → 不可逆烧毁
        } else {
            this._burnT = 0;                                         // 电压回落则清零重计（间歇过压不烧）
        }

        // RMS 平滑（热惯性）：指数滑动平均 v²，α=0.16 → 时间常数约 0.3s
        // 帧间波动被抹平，灯丝像真的有余热，而不是随接触抖动疯狂闪烁
        this._v2 += (v * v - this._v2) * 0.16;
        const vRms = Math.sqrt(this._v2);                            // 还原成有效值

        // 热度 0~1：额定电压处到 1；低于额定按比例打折（欠压半亮），超压到烧毁前更亮
        let target = vRms / this.vRated;
        target = Math.max(0, Math.min(1.15, target));                // 上限 1.15：允许略超亮（烧毁前最后的光）
        this._heat += (target - this._heat) * 0.25;                  // 热度自身再平滑一层 → 亮灭渐变更柔和

        // 热阻回写：冷 9Ω → 热 33Ω 随热度线性插值
        // 这一步是闭环关键：阻值影响下帧电流分配 → 影响端电压 → 影响热度（负反馈自稳）
        const R = this.rCold + (this.rHot - this.rCold) * this._heat;
        this.currentResistance = (this._burned || R < 0.001) ? 1e9 : R; // 烧毁=断路 1e9Ω；防零电阻短路奇异

        this._applyVisual();                                         // 热度→玻璃/灯丝/点光三重发光
    }

    /** 不可逆烧毁：断路 + 视觉死亡（玻璃熏黑、全灭）+ toast 告知 */
    _setBurned() {
        this._burned = true;                                         // 闸落下不再抬起（复位只能刷新页面）
        this.currentResistance = 1e9;                                // 灯丝断了：断路大电阻
        this._heat = 0;                                              // 热度归零
        if (this.sys && this.sys.showFloatingTip)                    // 平台提示（无提示环境静默）
            this.sys.showFloatingTip(`💡 灯泡 ${this.id} 过压烧毁（>${this.vBurn}V 持续 1.2s）`, 2600);
        this._applyVisual();                                         // 立即应用烧毁外观（不等下帧）
    }

    /** 热度 → 三重发光表现（in-place 更新，不重建网格） */
    _applyVisual() {
        const b = this._burned ? 0 : Math.max(0, Math.min(1, this._heat)); // 烧毁后亮度恒 0

        if (this._glassMat) this._glassMat.emissiveIntensity = 2.4 * b;   // ① 玻璃泡自发光强度：满亮 2.4（发光的“壳”）
        if (this._glassMat && this._burned) {                        // 烧毁特殊外观：
            this._glassMat.color.setHex(0x3b352e);                    // 玻璃熏成暗烟灰
            this._glassMat.emissive.setHex(0x000000);                 // 自发光清零
            this._glassMat.opacity = 0.30;                            // 更通透一点，保证里面的断丝看得清
        }

        // ② 灯丝：完好时是一整根螺旋丝；烧毁后换成两截断丝（断口 + 熔珠），看得见“断了”
        if (this._filament) this._filament.visible = !this._burned;   // 完好灯丝
        if (this._filHalfA) this._filHalfA.visible = this._burned;    // 下截
        if (this._filHalfB) this._filHalfB.visible = this._burned;    // 上截
        if (this._beadA) this._beadA.visible = this._burned;          // 熔珠（同生共死）
        if (this._beadB) this._beadB.visible = this._burned;
        if (this._filMat) {
            this._filMat.emissiveIntensity = 4.6 * b;                 // 细丝需要更亮的自发光才看得见（比玻璃更亮）
            this._filMat.color.setHex(this._burned ? 0x6f6a60        //   烧断后：冷灰（不再白炽）
                : (b > 0.12 ? 0xffe6b0 : 0x7a6234));                  //   点亮时白炽偏白，熄灭时暗青铜
        }
        if (this._light) this._light.intensity = 7 * b;               // ③ 真实点光源：满亮 7，照亮桌面/邻近器件/影子

        // 有宿主且亮度确有变化才置脏重绘（按需渲染：热平衡后不再触发任何帧）
        if (this._host && this._host._invalidate) this._host._invalidate();
    }

    /** 构建真 3D 模型（由宿主调用）：灯座 + 玻璃泡 + 灯丝 + 左右接线柱。
     *  造型次序自下而上：底板 → 灯座 → 收口颈 → 玻璃球 → 灯丝；端子柱立在底板前缘两侧。
     */
    buildThree() {
        const g = this._geo;                                          // 布局表（_recalcGeometry 产物）：部件位全部由尺寸推算
        const root = new THREE.Group();                              // 器件网格树根
        root.position.set(WORLD.bulbX, WORLD.tableTop, WORLD.bulbZ); // 世界坐标：桌面右前，贴桌面顶高

        const brass = new THREE.MeshStandardMaterial({ color: 0xcfa64b, roughness: 0.35, metalness: 0.85 }); // 黄铜（端子柱）
        const plateMat = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.6, metalness: 0.1 }); // 底板深灰
        const sockMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.5, metalness: 0.3 });  // 灯座亮灰金属

        const plate = new THREE.Mesh(new THREE.BoxGeometry(g.plateW, g.plateT, g.plateW), plateMat); // 绝缘底板（尺寸可配）
        plate.position.y = g.plateY;                                 // 中心=半板厚 → 底面贴桌面
        plate.castShadow = true;                                     // 投影
        plate.receiveShadow = true;                                   // 受影
        root.add(plate);

        const sock = new THREE.Mesh(                                  // 灯座（锥台）：底粗顶细
            new THREE.CylinderGeometry(g.sockRt, g.sockRb, g.sockH, 24), // 尺寸随推算
            sockMat
        );
        sock.position.y = g.sockY;                                    // 坐在底板上
        sock.castShadow = true;
        root.add(sock);

        const neck = new THREE.Mesh(                                  // 收口颈：灯座与玻璃泡之间的过渡环
            new THREE.CylinderGeometry(g.neckR, g.neckR, g.neckH, 24), // 尺寸随推算
            sockMat
        );
        neck.position.y = g.neckY;                                   // 与灯座顶搭接包住玻璃底
        root.add(neck);

        this._glassMat = new THREE.MeshStandardMaterial({            // 玻璃泡材质（存引用：亮度时只改强度）
            color: 0xfdf6e3,                                          // 暖白基底
            emissive: 0xffc66e,                                       // 自发光色：暖橙（点亮后的“热光”）
            emissiveIntensity: 0,                                     // 初始灭灯（tick 里随热度驱动）
            roughness: 0.08,                                          // 高抛光：亮部聚成小高光
            transparent: true,                                        // 透明玻璃（能隐约看到里面的灯丝）
            opacity: 0.42,                                            // 半透明 42%
            depthWrite: false,                                       // 不写深度：避免透明面挡住内部灯丝的排序问题
        });
        const glass = new THREE.Mesh(new THREE.SphereGeometry(g.glassR, 32, 24), this._glassMat); // 玻璃球（半径可配）、32×24 段高精度
        glass.position.y = g.glassY;                                 // 球心随颈顶+半径推算，略沉入收口
        root.add(glass);

        this._filMat = new THREE.MeshStandardMaterial({              // 灯丝材质（存引用：亮度时只改强度/颜色）
            color: 0x7a6234,                                          // 冷态暗青铜（通电后变白炽）
            emissive: 0xffb84d,                                       // 自发光色：金橙
            emissiveIntensity: 0,                                     // 初始灭
            roughness: 0.55,
            metalness: 0.6,
        });

        // ── 灯丝：真实螺旋钨丝（沿螺旋曲线扫掠成细管，不再是方块占位）──
        const filGroup = new THREE.Group();                           // 灯丝总组：整体挂在泡心略下
        filGroup.position.y = g.filY;
        root.add(filGroup);

        const coilPts = [];                                           // 螺旋采样点（本地坐标，中心在 y=0）
        const SEG = 108;                                              // 采样段数（4.5 圈 → 每圈约 24 点，够平滑又不重建太重）
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const a = t * g.filTurns * Math.PI * 2;                   // 螺旋角（4 圈 → 两端在左右相对位置）
            coilPts.push(new THREE.Vector3(
                Math.cos(a) * g.filR,                                 // 绕轴旋开
                -g.filH / 2 + g.filH * t,                             // 沿轴线性上升
                Math.sin(a) * g.filR
            ));
        }
        const mkFil = (curve, tubeSeg) => new THREE.Mesh(             // 统一建丝：曲线 → 细管
            new THREE.TubeGeometry(curve, tubeSeg, g.filWire, 6, false), this._filMat
        );

        this._filament = mkFil(new THREE.CatmullRomCurve3(coilPts), 160); // ① 完好灯丝（未烧毁时显示）
        filGroup.add(this._filament);

        // ② 烧断形态：同一螺旋从中间切成两截（断口按采样点拉开成可见缺口）
        const cut = Math.floor(coilPts.length / 2);                   // 断口中点索引
        const gapHalf = Math.max(2, Math.round(SEG * 0.06));          // 断口半宽（采样点）：留出 ≈8 mm 缺口，近景能看清"断了"
        const mkHalf = (pts, pivotY) => {                             // 以“引线端”为支点建半截灯丝
            const grp = new THREE.Group();
            grp.position.y = pivotY;                                  // 固定端（引线侧）落在组原点
            const local = pts.map(p => new THREE.Vector3(p.x, p.y - pivotY, p.z)); // 平移到组坐标系
            grp.add(mkFil(new THREE.CatmullRomCurve3(local), Math.max(16, pts.length)));
            grp.visible = false;                                      // 初始隐藏（完好灯丝在用）
            filGroup.add(grp);
            return grp;
        };
        this._filHalfA = mkHalf(coilPts.slice(0, cut - gapHalf), -g.filH / 2); // 下截：支点在下端（接左侧引线）
        this._filHalfA.rotation.z = 0.11;                            // 断口处向外张开（钨丝受热变形回弹）
        this._filHalfB = mkHalf(coilPts.slice(cut + gapHalf), g.filH / 2);     // 上截：支点在上端
        this._filHalfB.rotation.z = -0.10;                           // 断口处向外张开（两截不再对齐）

        // 断口熔珠：烧断瞬间的金属熔珠（两端各一颗，明确“断了”）
        const beadMat = new THREE.MeshStandardMaterial({ color: 0x9a9088, roughness: 0.4, metalness: 0.85 });
        const mkBead = (x, y, z) => {
            const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.0055, g.filWire * 3.2), 12, 8), beadMat); // 熔珠鼓包（丝细了，下限兜住可见性）
            s.position.set(x, y, z);
            filGroup.add(s);
            return s;
        };
        const tipA = coilPts[cut - gapHalf - 1], tipB = coilPts[cut + gapHalf]; // 两截各自的断口端点
        this._beadA = mkBead(tipA.x, tipA.y - 0.005, tipA.z);         // 下截熔珠（略垂）
        this._beadB = mkBead(tipB.x, tipB.y + 0.005, tipB.z);         // 上截熔珠（略抬，拉开断口）
        this._beadA.visible = this._beadB.visible = false;            // 未烧毁时隐藏

        // ③ 两根内引线：从螺旋的**实际首尾点**引出（不再假设端头在左右哪侧），向下汇入玻璃颈
        //    历史教训：圈数取整数（4 圈）时两端都落在 +x 侧，若仍按“左上一根、右下一根”写死，
        //    上端引线与灯丝末端会差 2×filR ≈ 4 cm —— 画面上会出现一根悬空的断丝
        const leadMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.35, metalness: 0.9 });
        const coilEnds = [coilPts[0], coilPts[coilPts.length - 1]];   // 螺旋实际首尾点（下半端 / 上半端）
        for (const end of coilEnds) {                                 // 每端各引一根支架丝
            const x0 = end.x, yEnd = end.y, z0 = end.z;               // 端头坐标（与螺旋端点完全重合 → 不会断丝）
            const outward = x0 >= 0 ? 1 : -1;                         // 朝泡壁外侧的方向（引线先外张再下行）
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(x0, yEnd, z0),                                         // 焊在灯丝端头
                new THREE.Vector3(x0 * 1.25, yEnd + (yEnd > 0 ? -0.012 : 0.012), z0 * 0.5), // 贴着端头向下折
                new THREE.Vector3(outward * g.filR * 2.1, -g.filH / 2 - g.glassR * 0.30, 0),  // 沿泡内壁下行
                new THREE.Vector3(outward * g.filR * 1.2, -g.filH / 2 - g.glassR * 0.85, 0),  // 穿出玻璃底进颈部
            ]);
            const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, Math.max(0.0018, g.filWire * 1.15), 5, false), leadMat); // 引线略粗于灯丝，避免糊成一片
            filGroup.add(wire);
        }

        this._light = new THREE.PointLight(0xffc66e, 0, 3.2, 1.8);   // 点光源：暖橙、初始 0、作用半径 3.2m、平方衰减 1.8
        this._light.position.set(0, g.lightY, 0);                     // 挂在泡心上方一点（光从灯里发出）
        root.add(this._light);                                       // 作为 root 子节点：随器件拖动一起搬家

        // 左右接线柱：立在底板前缘（z=+0.15）两侧，电缆从柱顶接进
        const mkTerm = (x) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(g.postR, g.postR, g.postH, 16), brass.clone()); // 黄铜柱（clone 防悬停高亮串色）
            post.position.set(x, g.postY, g.postZ);                  // 坐在底板前缘两侧
            post.castShadow = true;
            root.add(post);

            const hit = new THREE.Mesh(                              // 隐形拾取柱：粗大一圈方便点中
                new THREE.CylinderGeometry(g.hitR, g.hitR, g.hitH, 12), // 命中范围随推算
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) // 全透明不写深度
            );
            hit.position.copy(post.position);                        // 与视觉柱同位
            root.add(hit);
            return { post, hit, tip: g.tip.clone() };                // tip=柱顶上方偏移：电缆端点落位处
        };
        const L = mkTerm(-g.postX);                                  // 左端子
        const R = mkTerm(g.postX);                                   // 右端子

        // 申报协议：footprint top=0.36 玻璃泡顶（比底板高得多！）
        // 教训：早期 top 只到灯座底板 0.05 → 电缆逃逸高度低于玻璃底 → 透过透明玻璃看见电缆贴行，
        // 观感即“导线穿灯泡中间”；改为玻璃顶后电缆从泡顶上方整体越过
        return {
            root,
            footprint: { hx: g.fp.hx, hz: g.fp.hz, top: g.fp.top }, // 足迹随底板/玻璃推算（顶面=玻璃泡顶：电缆从泡顶上方越过）
            terminals: [
                { port: 'l', mesh: L.post, hit: L.hit, tip: L.tip }, // 左端子（mesh=视觉柱：宿主取世界坐标）
                { port: 'r', mesh: R.post, hit: R.hit, tip: R.tip }, // 右端子
            ],
            pickables: [],                                          // 无可点部件（点击本体不触发任何动作）
        };
    }
}
