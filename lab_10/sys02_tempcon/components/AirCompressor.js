import { BaseComponent } from "./BaseComponent.js";

/**
 * AirCompressor — 空压机（Air Compressor）仿真组件
 *
 * 说明：
 * - 模拟 V 型压缩机的视觉与简化动态行为，包含转速惯性、启动/停止控制与面板交互；
 * - 遥控（remote）模式下，运行与否由控制端 L-R 是否连通决定（供压力开关等外部触点控制）；
 * - 活塞/连杆/旋钮/按钮等为动态节点，在 `_dynamicGroup` 中 in-place 更新。
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`
 * （`_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`），最后 `addPort`。
 */
export class AirCompressor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(180, config.height || 220);

        this.type  = 'airCompressor';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            mode: this.mode,
            refillRate: this.refillRate,
        };

        // 电气接口（控制端 L/R）与气路接口（吸气 i / 排气 o）
        this.addPort(70, 0, "l", "wire", 'p');
        this.addPort(130, 0, "r", "wire");
        this.addPort(0, 180, "i", "pipe", 'in');
        this.addPort(this.W, 180, "o", "pipe");
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.W = this.width;
        this.H = this.height;
        this._centerX = 100;
        this._centerY = 155;
        this._cylinderAngles = [-45, 45];
        // 控制面板布局
        this._panel = { y: 15, startX: 40, spacing: 60, centerY: 25, labelY: 22 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.mode = config.mode || "local";  // "local" 或 "remote"
        this.running = false;                // 运行状态
        this.power = 0;                      // 实际转速 0-1
        this.targetPower = 0;                // 目标转速 0-1
        this.crankAngle = 0;                 // 曲轴转角
        this.refillRate = config.refillRate !== undefined ? parseFloat(config.refillRate) : 0.001; // 每帧充气量 MPa

        this._knobAngle = this.mode === 'local' ? -45 : 45;
        this._knobTarget = this._knobAngle;
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        // 主机座
        this._staticGroup.add(new Konva.Rect({
            width: this.W, height: this.H,
            fill: '#d1d1d1', stroke: '#444', strokeWidth: 2, cornerRadius: 5,
        }));
        // 黑色曲轴箱
        this._staticGroup.add(new Konva.Rect({
            x: 40, y: 110, width: 120, height: 90,
            fill: '#222', stroke: '#000', cornerRadius: 10,
        }));
        // 曲轴中心盖
        this._staticGroup.add(new Konva.Circle({
            x: this._centerX, y: this._centerY, radius: 20,
            fillRadialGradientColorStops: [0, '#666', 1, '#222'],
        }));

        // 控制面板标注（仅保留模式旋钮 LOC/REM 标注；两个按钮改为带灯按钮，无文字标签）
        const p = this._panel;
        this._staticGroup.add(new Konva.Text({ x: p.startX - 35, y: p.centerY - 18, text: "LOC", fontSize: 10, fontStyle: 'bold' }));
        this._staticGroup.add(new Konva.Text({ x: p.startX + 15, y: p.centerY - 18, text: "REM", fontSize: 10, fontStyle: 'bold' }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 1. V 型双缸（缸体 + 连杆 + 活塞，随曲轴角往复运动）
        this.cyls = [];
        this._cylinderAngles.forEach((angle) => {
            const g = new Konva.Group({ x: this._centerX, y: this._centerY, rotation: angle });

            g.add(new Konva.Rect({ x: -25, y: -90, width: 50, height: 75, fill: '#555', stroke: '#333', cornerRadius: 2 }));
            const rod = new Konva.Line({ points: [0, 0, 0, 45], stroke: '#888', strokeWidth: 5, lineCap: 'round' });
            const piston = new Konva.Rect({ x: -20, y: -75, width: 40, height: 25, fill: '#aaa', stroke: '#444', cornerRadius: 2 });
            g.add(rod, piston);

            this._dynamicGroup.add(g);
            this.cyls.push({ piston, rod, originY: -75 });
        });

        // 2. 模式旋钮（可点切换 LOCAL/REMOTE）
        const p = this._panel;
        const knobGroup = new Konva.Group({ x: p.startX, y: p.centerY + p.y, cursor: 'pointer' });
        knobGroup.add(new Konva.Circle({ radius: 15, fill: '#444', stroke: '#000', strokeWidth: 1 }));
        knobGroup.add(new Konva.Rect({ x: -2, y: -15, width: 4, height: 12, fill: '#fff', cornerRadius: 1 }));
        this.knobGroup = knobGroup;
        this._dynamicGroup.add(knobGroup);

        // 3. 起动按钮（带灯按钮：整个按钮即指示灯；未激活暗绿、激活亮绿；LOC 下可手动起动）
        const startGroup = new Konva.Group({ x: p.startX + p.spacing, y: p.centerY + p.y, cursor: 'pointer' });
        startGroup.add(new Konva.Circle({ radius: 17, fill: '#2a2f34', stroke: '#141618', strokeWidth: 1.5 })); // 按钮座
        this.startBtn = new Konva.Circle({ radius: 15, fill: '#0b3d0b', stroke: '#0a2a0a', strokeWidth: 1 });    // 按钮整体（灯）
        startGroup.add(this.startBtn);
        this.startGroup = startGroup;
        this._dynamicGroup.add(startGroup);

        // 4. 停止按钮（带灯按钮：整个按钮即指示灯；未激活暗红、激活亮红）
        const stopGroup = new Konva.Group({ x: p.startX + p.spacing * 2, y: p.centerY + p.y, cursor: 'pointer' });
        stopGroup.add(new Konva.Circle({ radius: 17, fill: '#2a2f34', stroke: '#141618', strokeWidth: 1.5 }));
        this.stopBtn = new Konva.Circle({ radius: 15, fill: '#3d0b0b', stroke: '#2a0a0a', strokeWidth: 1 });
        stopGroup.add(this.stopBtn);
        this.stopGroup = stopGroup;
        this._dynamicGroup.add(stopGroup);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.knobGroup.on('click', () => {
            this.mode = this.mode === 'local' ? 'remote' : 'local';
            this._knobTarget = this.mode === 'local' ? -45 : 45;
            // 切换模式后先停机，交由物理逻辑重新判定
            this.targetPower = 0;
            this.running = false;
        });
        this.startGroup.on('click', () => {
            if (this.mode === "local") { this.running = true; this.targetPower = 1.0; }
        });
        this.stopGroup.on('click', () => {
            if (this.mode === "local") { this.running = false; this.targetPower = 0; }
        });
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    _updateDynamic() {
        // 1. 活塞往复运动（V 型 90° 相位差）
        this.cyls.forEach((cyl, i) => {
            const phase = i * 90 * (Math.PI / 180);
            const rad = (this.crankAngle * Math.PI / 180) + phase;
            const travel = Math.sin(rad) * 18;
            cyl.piston.y(cyl.originY + travel);
            cyl.rod.points([0, 0, -Math.cos(rad) * 8, -45 + travel]);
        });

        // 2. 带灯按钮：整个按钮即指示灯——运行 → 起动灯亮绿；停止 → 停止灯亮红
        if (this.running) {
            this.startBtn.fill('#39ff14');   // 起动：亮绿（激活）
            this.stopBtn.fill('#3d0b0b');    // 停止：暗红（未激活）
        } else {
            this.startBtn.fill('#0b3d0b');   // 起动：暗绿（未激活）
            this.stopBtn.fill('#ff2020');    // 停止：亮红（激活）
        }

        // 3. 旋钮角度插值
        this._knobAngle += (this._knobTarget - this._knobAngle) * 0.2;
        this.knobGroup.rotation(this._knobAngle);
    }

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        // 遥控模式：由压力开关 NC 触点控制启停——
        //   压力低于下限 → NC 闭合（控制端 L-R 连通）→ 起动；
        //   压力超过上限 → NC 断开、NO 闭合 → 控制端 L-R 断开 → 停止。
        if (this.mode === "remote") {
            const controlClosed = this.sys.isPortConnected(`${this.id}_wire_l`, `${this.id}_wire_r`);
            this.targetPower = controlClosed === true ? 1.0 : 0;
            this.running = this.targetPower > 0;
        }

        // 转速惯性
        const lerpSpeed = this.targetPower > this.power ? 0.25 : 0.12;
        this.power += (this.targetPower - this.power) * lerpSpeed * 0.2;
        if (this.power < 0.01) this.power = 0;

        // 曲轴转角
        this.crankAngle += this.power * 200 * 0.2;

        this._updateDynamic();
        // 动态节点位于 _dynamicGroup（不参与静态缓存），仅请求重绘即可
        this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    setMode(mode) {
        if (mode === 'local' || mode === 'remote') {
            this.mode = mode;
            this._knobTarget = mode === 'local' ? -45 : 45;
        }
    }
    getMode() { return this.mode; }
    isRunning() { return this.running; }

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    /** 返回部件中心的世界坐标（供工作流箭头定位） */
    getClickablePartCenter(partId) {
        const p = this._panel;
        switch (partId) {
            case 'mode': return this._toAbs(p.startX, p.centerY + p.y);                 // 模式旋钮
            case 'on':   return this._toAbs(p.startX + p.spacing, p.centerY + p.y);     // ON 启动按钮
            case 'off':  return this._toAbs(p.startX + p.spacing * 2, p.centerY + p.y); // OFF 停止按钮
            case 'l':    return this._toAbs(70, 0);     // 电气接线端 L
            case 'r':    return this._toAbs(130, 0);    // 电气接线端 R
            case 'i':    return this._toAbs(0, 180);    // 吸气口
            case 'o':    return this._toAbs(this.W, 180); // 排气口
            default:     return null;
        }
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '控制模式',
                key: 'mode',
                type: 'select',
                options: [
                    { label: '就地 LOCAL', value: 'local' },
                    { label: '遥控 REMOTE', value: 'remote' },
                ],
            },
            { label: '每帧充气量 (MPa)', key: 'refillRate', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.mode) this.setMode(newConfig.mode);
        if (newConfig.refillRate !== undefined) this.refillRate = parseFloat(newConfig.refillRate) || 0;

        this.config = { id: this.id, mode: this.mode, refillRate: this.refillRate };
    }

    destroy() {
        super.destroy?.();
    }
}
