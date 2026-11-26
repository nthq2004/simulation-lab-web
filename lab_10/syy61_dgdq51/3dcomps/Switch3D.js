/**
 * Switch3D —— 真 3D 闸刀开关组件
 *
 * 电气模型：type='switch'，端口 l/r；合闸时拓扑直接并簇（getValue()=0），
 *   分闸时按 getValue()=Infinity 注入断路电阻。
 * 交互：点击闸刀杆（宿主射线拾取手柄拾取盒）→ toggle() 翻转 isOn，
 *   tick() 内插值旋转闸刀杆完成合/分闸动画。
 *
 * 电气语义在求解内核的两面性：
 *   合闸（isOn=true）→ CircuitTopology 直接把 l/r 端口并成同一节点簇（零电阻，拓扑短路）；
 *   分闸（isOn=false）→ 拓扑不并簇，DeviceStamps 读 getValue()=Infinity 作断路大电阻——
 *   实测这条路径只在两侧端口都有连线时才参与求解（无线的开关等于不存在）。
 * 布局范式（与 2D 组件同款）：构造期调 _recalcGeometry(config)，由底板尺寸
 *   （baseW/baseD，可由 config 覆盖、钳制安全区间）推算出 _geo 部件布局表；
 *   buildThree() 只消费 _geo、不再散落魔法数。
 */
import * as THREE from 'three';                                     // three.js 命名空间
import { BaseComponent } from '../components/BaseComponent.js';     // 平台组件基类
import { WORLD } from './world3d.js';                                // 世界常量（开关位置、分闸角）

export class Switch3D extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);                                         // 基类构造：Konva group、登记进 sys

        this.type = 'switch';                                       // 电气类型：开关 → 拓扑并簇 / 断路电阻
        this.cache = false;                                          // 无 2D 画面，永不缓存位图
        this.group.draggable(false);                                 // 位置由 3D 宿主管理，禁 Konva 拖动

        this._initGroups();                                          // 基类标准三组

        // 规范顺序：_initGroups → _recalcGeometry → _initParameters(内联) → _init
        // 外形尺寸仅构造期生效：运行中改尺寸需整树重建 3D 模型，本工程不提供该路径
        this._recalcGeometry(config);                                // 由底板尺寸推算全部部件位（_geo 布局表）

        this.isOn = false;                                            // 初始分闸（灯泡默认不亮，先接线再合闸演示）
        this._leverAngle = WORLD.openLeverAngle;                      // 杆当前角（动画插值用），初始即分闸角 0.92rad
        this._leverTarget = WORLD.openLeverAngle;                     // 杆目标角（toggle 时改，tick 向它收敛）

        this.config = { hostId: config.hostId,                       // 配置副本先于 _init()（hostId 要在其中取）
            baseW: this._geo.baseW, baseD: this._geo.baseD };        // 外形尺寸留档（不进参数框：改它需重建模型）

        this._init();                                                // 端口 + 挂宿主
    }

    /** 部件布局推算（2D 组件 _recalcGeometry 同款范式）：
     *  由底板尺寸推算两端绝缘子/接线柱、闸刀杆与手柄、夹口、手柄拾取盒、
     *  footprint 全部位；buildThree() 只消费 _geo。幂等可重跑（纯计算）。
     */
    _recalcGeometry(config) {
        const bw = Math.min(0.9, Math.max(0.4, Number(config.baseW) || 0.55)); // 底板长 0.4~0.9m，缺省 0.55
        const bd = Math.min(0.5, Math.max(0.24, Number(config.baseD) || 0.32)); // 底板深 0.24~0.5m，缺省 0.32
        const baseT = 0.05;                                            // 底板厚（固定）
        const endX = bw / 2 - 0.055;                                   // 端子柱位：自板缘内收 55mm
        const blkS = 0.09;                                             // 陶瓷绝缘块边长（固定）
        const blkY = baseT + blkS / 2;                                 // 块坐在底板上
        const blkTop = baseT + blkS;                                   // 块顶面
        const postR = 0.032, postH = 0.11;                             // 接线柱
        const postY = blkTop + postH / 2 - 0.005;                     // 柱底插进块顶 5mm
        const hitR = 0.06, hitH = 0.22;                               // 拾取柱
        const hitY = postY + 0.04;                                     // 拾取柱心再抬高（覆盖柱顶以上区域）
        const leverY = postY + postH / 2;                            // 闸刀铰点 = 左柱顶端
        const barLen = endX * 2 + 0.01;                               // 刀杆长 = 两柱距 + 10mm 搭接
        const barW = 0.026, barT = 0.05;                               // 杆截面（固定）
        const knobR = 0.038, knobH = 0.06;                             // 手柄帽
        const knobX = barLen - 0.05, knobY = 0.035;                    // 帽挂杆身外端、稍上凸
        const jawW = 0.05, jawH = 0.03, jawD = 0.058;                  // 静触头夹口
        const jawY = leverY + 0.017;                                   // 夹口略高于杆落位线 → 0° 时端部嵌入
        const hitBoxW = bw + 0.07, hitBoxH = 0.46, hitBoxD = 0.20;    // 手柄拾取盒（罩摆动带）
        const hitBoxX = 0.02, hitBoxY = 0.47;                          // 盒心抬高避开柱区（端子可点优先）
        this._geo = {
            baseW: bw, baseD: bd, baseT, baseY: baseT / 2,
            endX, blkS, blkY, postR, postH, postY,
            hitR, hitH, hitY,
            leverY, barLen, barW, barT,
            knobX, knobR, knobH, knobY,
            jawW, jawH, jawD, jawY,
            hitBoxW, hitBoxH, hitBoxD, hitBoxX, hitBoxY,
            fp: { hx: bw / 2, hz: bd / 2, top: blkTop + 0.01 },        // 足迹：板半尺寸，顶面=块顶+余量
            tip: new THREE.Vector3(0, 0.055, 0),                      // 端子 tip：柱顶上方 55mm
        };
    }

    _init() {
        this.addPort(0, 0, 'l', 'wire', null);                       // 左端子端口：sw_wire_l
        this.addPort(0, 0, 'r', 'wire', null);                       // 右端子端口：sw_wire_r
        this.ports.forEach(p => {
            if (p.node) { p.node.listening(false); p.node.opacity(0); p.node.radius(2); } // 端口锚点隐形化（真实点击走 3D 射线）
        });

        const hostId = this.config.hostId;                            // 从配置副本取宿主 id（构造器形参已出作用域）
        const host = (this.sys.comps || {})[hostId];                 // 找 3D 场景宿主
        if (host && typeof host.registerDevice === 'function') host.registerDevice(this); // 注册：交出 3D 模型由宿主接管
        else console.warn(`[Switch3D ${this.id}] 未找到 3D 宿主组件（hostId=${hostId}）`);
    }

    /** 触点电阻：合闸 0Ω（拓扑并簇），分闸 ∞（断路）。
     *  合闸返回 0 仅供统一接口：内核对 switch 且 isOn 时直接并簇，不走电阻 stamp。
     */
    getValue() {
        return this.isOn ? 0 : Infinity;                             // 分闸时 Infinity → DeviceStamps 注入断路大电阻
    }

    /** 合/分闸（点击闸刀手柄触发），返回新的闸态。
     *  只改 isOn 与杆目标角：电气即时生效（下一帧求解就变），
     *  视觉由 tick() 插值慢慢转过去 —— 电气先于视觉，动画只是表现。
     */
    toggle() {
        this.isOn = !this.isOn;                                      // 翻转闸态
        this._leverTarget = this.isOn ? 0 : WORLD.openLeverAngle;    // 合闸目标角 0（杆落进右柱夹口）；分闸抬起 53°
        return this.isOn;                                            // 把新闸态回传给调用方（宿主 toast 显示用）
    }

    /** 右键参数框字段：开关无可调项（返回空 → 宿主弹“该器件暂无可调参数”提示） */
    getConfigFields() {
        return [];
    }

    onConfigUpdate() { /* 无可配置项 */ }

    /** 每帧动画（consys 20fps 调用）：闸刀杆角度向目标角插值收敛。
     *  in-place 更新（只改 rotation 属性），不动缓存；角度变化时通知宿主置脏重绘。
     */
    tick(dt) {
        const before = this._leverAngle;                             // 记下本帧起角，末尾比较判断是否需要重绘
        const diff = this._leverTarget - this._leverAngle;           // 离目标角还差多少
        if (Math.abs(diff) > 0.004) {                                // 差距还明显 → 指数收敛
            this._leverAngle += diff * Math.min(1, (dt || 0.05) * 14); // 收敛速率 14/s（dt 缺省按 0.05s 防卡死）
        } else {
            this._leverAngle = this._leverTarget;                   // 差距很小直接贴齐（防无限渐近抖动）
        }
        if (this._lever) this._lever.rotation.z = this._leverAngle;   // 应用到杆节点（绕铰轴 z 旋转）
        // 角度确有变化才让宿主置脏 —— 按需渲染机制下不触发就不会重绘一帧
        if (this._host && Math.abs(this._leverAngle - before) > 1e-6) this._host._invalidate();
    }

    /** 构建真 3D 模型（由宿主调用）。
     *  造型：底座 + 两端陶瓷绝缘子（各立一根接线柱）+ 铰接在左柱顶的闸刀杆 + 右柱顶静触头夹口。
     *  杆绕左柱顶端的 z 轴旋转：0 = 水平落进右夹口（合闸），0.92rad = 抬起（分闸）。
     */
    buildThree() {
        const g = this._geo;                                          // 布局表（_recalcGeometry 产物）：部件位全部由尺寸推算
        const root = new THREE.Group();                              // 器件网格树根
        root.position.set(WORLD.swX, WORLD.tableTop, WORLD.swZ);    // 世界坐标：桌面上后方居中、贴桌面顶高

        const baseMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.7, metalness: 0.05 }); // 底座深灰
        const ceramic = new THREE.MeshStandardMaterial({ color: 0xcfc7b8, roughness: 0.65 });               // 绝缘子米白陶瓷
        const brass = new THREE.MeshStandardMaterial({ color: 0xcfa64b, roughness: 0.35, metalness: 0.85 }); // 黄铜柱/夹口
        const silver = new THREE.MeshStandardMaterial({ color: 0xb8bfc9, roughness: 0.3, metalness: 0.9 });  // 闸刀杆银亮金属

        const base = new THREE.Mesh(new THREE.BoxGeometry(g.baseW, g.baseT, g.baseD), baseMat); // 绝缘底板（尺寸可配）
        base.position.y = g.baseY;                                   // 底板中心=半板厚 → 底面贴桌面
        base.castShadow = true;                                      // 投影
        base.receiveShadow = true;                                   // 受影
        root.add(base);

        // 两端绝缘子 + 接线柱：mkEnd(x) 在 x 处建“陶瓷块 + 黄铜柱 + 隐形拾取柱”一组
        const mkEnd = (x) => {
            const blk = new THREE.Mesh(new THREE.BoxGeometry(g.blkS, g.blkS, g.blkS), ceramic); // 陶瓷绝缘块（尺寸随推算）
            blk.position.set(x, g.blkY, 0);                           // 坐在底板上
            blk.castShadow = true;
            blk.receiveShadow = true;
            root.add(blk);

            const post = new THREE.Mesh(new THREE.CylinderGeometry(g.postR, g.postR, g.postH, 20), brass.clone()); // 黄铜接线柱（clone 材质防悬停高亮串色）
            post.position.set(x, g.postY, 0);                         // 立在陶瓷块顶、微微插入
            post.castShadow = true;
            root.add(post);

            const hit = new THREE.Mesh(                              // 隐形拾取柱：加高加粗，上下越过杆摆动区
                new THREE.CylinderGeometry(g.hitR, g.hitR, g.hitH, 12), // 命中范围随推算
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) // 全透明不写深度
            );
            hit.position.set(x, g.hitY, 0);                           // 比视觉柱更高：拾取范围覆盖柱顶以上，端子优先于手柄拾取
            root.add(hit);
            return { post, hit };                                     // 视觉柱与拾取柱交回
        };
        const L = mkEnd(-g.endX);                                     // 左端（闸刀铰接侧）
        const R = mkEnd(g.endX);                                      // 右端（静触头侧）

        // 闸刀杆（铰接在左柱顶端，合闸落向右柱）
        // 用 Group 而非 Mesh：杆身 + 手柄两个部件随同一个铰点旋转
        this._lever = new THREE.Group();
        this._lever.position.set(-g.endX, g.leverY, 0);              // 铰点 = 左柱顶端（tick 里改它的 rotation.z）

        const bar = new THREE.Mesh(new THREE.BoxGeometry(g.barLen, g.barW, g.barT), silver.clone()); // 银质刀杆（长=两柱距+搭接余量，铰点在内端）
        bar.position.set(g.barLen / 2, 0, 0);                        // 杆身从铰点向 +x 伸出
        bar.castShadow = true;

        const knob = new THREE.Mesh(                                  // 杆外端手柄（黑色绝缘帽）
            new THREE.CylinderGeometry(g.knobR, g.knobR, g.knobH, 16), // 手柄尺寸随推算
            new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.55 }) // 哑光黑
        );
        knob.position.set(g.knobX, g.knobY, 0);                       // 挂在杆身外端、稍向上凸起
        knob.castShadow = true;

        this._lever.add(bar, knob);                                   // 两个部件装进铰组
        this._lever.rotation.z = this._leverAngle;                    // 应用初始角（分闸抬起状态）
        root.add(this._lever);

        // 右柱顶端静触头夹口
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(g.jawW, g.jawH, g.jawD), brass.clone()); // 黄铜夹口块：合闸时杆外端落进来
        jaw.position.set(g.endX, g.jawY, 0);                         // 坐在右柱顶端上方 → 杆 0° 时端部嵌入
        root.add(jaw);

        // 手柄拾取盒（只罩闸刀摆动区，上移避开端子柱；端子另有更高优先级拾取兼底）
        // 教训：早期版本此盒以铰点为中心罩住全部 → 点击接线柱命中了开关手柄，端子永远接不上线；
        // 现在盒心抬高到 0.47、只盖 0.24~0.70 的摆动带，端子柱拾取范围(0.12~0.28)与其仅边缘相接，
        // 且 _pickAt 在命中列表中“端子优先于手柄”双保险
        const hitBox = new THREE.Mesh(
            new THREE.BoxGeometry(g.hitBoxW, g.hitBoxH, g.hitBoxD),   // 罩住整个摆动带（含分闸抬起后的杆位）
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) // 隐形
        );
        hitBox.position.set(g.hitBoxX, g.hitBoxY, 0);                 // 盒心抬高避开柱区、贴住杆柄
        hitBox.userData = { kind: 'switch', comp: this, visual: bar }; // 宿主射线命中此盒 → 知道是“开关手柄”，并高亮杆身
        root.add(hitBox);

        // 申报协议：footprint 供电缆逃逸（陶瓷块顶 0.14 为 top）；
        // terminals 的 tip=柱顶上方 55mm；pickables 交出手柄拾取盒（电池/灯泡无此项）
        return {
            root,
            footprint: { hx: g.fp.hx, hz: g.fp.hz, top: g.fp.top },  // 开关足迹（随底板尺寸推算）
            terminals: [
                { port: 'l', mesh: L.post, hit: L.hit, tip: g.tip.clone() }, // 左端子（铰接侧）
                { port: 'r', mesh: R.post, hit: R.hit, tip: g.tip.clone() }, // 右端子（静触头侧）
            ],
            pickables: [hitBox],                                     // 手柄拾取盒 → 宿主 _pickSwitch 列表（点击合分闸）
        };
    }
}
