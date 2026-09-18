/**
 * FluorescentLamp 荧光灯组件。
 *
 * 作用：这是一个模拟荧光灯的视觉和状态组件，主要用于演示灯丝预热、击穿启动、正常发光和熄灭恢复等过程。
 * 它通过检测两端间的电压来决定当前是否达到起辉条件，并据此更新灯管发光强度和状态标签，适合在照明电路教学中展示启动特性。
 *
 * 设计特点：
 * 1. 左右两端灯丝分别模拟热阴极发热过程；
 * 2. 灯管中间发光强度跟随电压和状态变化；
 * 3. 状态分为 idle、preheat、on 等，能够表现灯管的起辉和熄灭过程；
 * 4. 支持配置灯丝阻值和导通状态参数，便于实验调参。
 */
import { BaseComponent } from './BaseComponent.js';

export class FluorescentLamp extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，完成基础组件和系统引用的初始化。
        super(config, sys);

        // 设置灯管的标准尺寸，固定宽高后方便视觉布局和端口定位。
        this.width = 473;
        this.height = 79;

        // 组件类型和缓存标记用于系统识别和减少组件重绘成本。
        this.type = 'fluorescent_lamp';
        this.cache = 'fixed';

        // 按常规组件顺序依次初始化几何、参数和渲染节点。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 配置对象中记录关键运行参数，便于后续编辑器和状态同步使用。
        this.config = {
            id: this.id,
            filamentR: this.filamentR,
            gapOnR: this.gapOnR,
        };
        // 灯管两端的四个端口分别对应左右两侧的两个灯丝端点，支持真实接线和电压测量。
        const s = this.scale || 1;
        this.addPort(-this._W / 2 - 10 * s, -16 * s, 'left_a', 'wire');
        this.addPort(-this._W / 2 - 10 * s, 16 * s, 'left_b', 'wire');
        this.addPort(this._W / 2 + 10 * s, -16 * s, 'right_a', 'wire');
        this.addPort(this._W / 2 + 10 * s, 16 * s, 'right_b', 'wire');
    }

    _recalcGeometry() {
        // 用当前缩放比例重算灯管主体尺寸、灯管宽度和端帽宽度，保证整体比例稳定。
        const s = this.scale || 1;
        this._W = this.width * s;
        this._H = this.height * s;
        this._tubeW = this._W - 15 * s;
        this._tubeH = 28 * s;
        this._endCapW = 18 * s;
    }

    _initParameters(config) {
        // 灯丝电阻和通态电阻决定灯管导通特性，而状态参数用于维护当前发光阶段。
        this.filamentR = config.filamentR || 200;
        this.gapOnR = config.gapOnR || 220;
        this._state = 'idle';
        this._strikeV = 420;
        this._vAcrossGap = 0;
        this._filamentGlow = 0;
        this._tubeGlow = 0;
        this._startupTimer = 0;
        this._flickerPhase = 0;
        this._gapPeakV = 0;
        this._peakFilamentV = 0;
        this._offTimer = 0;
        this._faultAged = false;
    }

    _init() {
        // 初始化时立即绘制静态结构和动态发光节点，方便打开展示和后续状态更新。
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const s = this.scale || 1;
        const W = this._W;
        const H = this._H;
        const tw = this._tubeW;
        const th = this._tubeH;
        const ecw = this._endCapW;

        // 透明点击区域（拖拽支持）
        this._interactGroup.add(new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        }));

        const bg = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#f0f0f0', listening: false,
        });
        this._staticGroup.add(bg);

        const tube = new Konva.Rect({
            x: -tw / 2, y: -th / 2, width: tw, height: th,
            fill: '#f5f0e8', stroke: '#bbb', strokeWidth: 1.2,
            cornerRadius: 4, listening: false,
        });
        this._staticGroup.add(tube);

        const capL = new Konva.Rect({
            x: -tw / 2 - ecw, y: -th / 2 - 2,
            width: ecw, height: th + 4,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1,
            cornerRadius: 3, listening: false,
        });
        const capR = new Konva.Rect({
            x: tw / 2, y: -th / 2 - 2,
            width: ecw, height: th + 4,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1,
            cornerRadius: 3, listening: false,
        });
        this._staticGroup.add(capL, capR);

        for (const side of [-1, 1]) {
            const cx = side * (tw / 2 + ecw / 2);
            const pin1 = new Konva.Circle({ x: cx, y: -th / 4 - 2, radius: 3 * s, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1, listening: false });
            const pin2 = new Konva.Circle({ x: cx, y: th / 4 + 2, radius: 3 * s, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1, listening: false });
            this._staticGroup.add(pin1, pin2);
        }

        const drawVerticalFilament = (cx, cy) => {
            const pts = [];
            for (let i = 0; i < 9; i++) {
                const offsetY = -16 * s + i * 4 * s;
                pts.push(cx + (i % 2 === 0 ? -2 * s : 2 * s), cy + offsetY);
            }
            const line = new Konva.Line({ points: pts, stroke: '#888', strokeWidth: 1.5 * s, tension: 0.3, listening: false });
            this._staticGroup.add(line);
        };
        drawVerticalFilament(-W / 2 + 11 * s, 0);
        drawVerticalFilament(W / 2 - 11 * s, 0);
    }

    _createDynamicNodes() {
        const s = this.scale || 1;
        this._leftFilamentGlow = new Konva.Circle({
            x: -this._W / 2 + 11 * s, y: 0, radius: 0, fill: '#ff4400', opacity: 0, listening: false,
        });
        this._dynamicGroup.add(this._leftFilamentGlow);
        this._rightFilamentGlow = new Konva.Circle({
            x: this._W / 2 - 11 * s, y: 0, radius: 0, fill: '#ff4400', opacity: 0, listening: false,
        });
        this._dynamicGroup.add(this._rightFilamentGlow);

        this._tubeGlowNode = new Konva.Rect({
            x: -this._tubeW / 2, y: -this._tubeH / 2, width: this._tubeW, height: this._tubeH,
            fill: '#000000', opacity: 0, cornerRadius: 4, listening: false,
        });
        this._dynamicGroup.add(this._tubeGlowNode);

        this._stateLabel = new Konva.Text({
            x: -36, y: 20, width: 80,
            text: '', fontSize: 15, fill: '#2c3e50', fontFamily: 'Arial', fontStyle: 'bold',
            align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._stateLabel);
    }

    setState(newState) {
        if (this._state === newState) return;
        this._state = newState;
        this.markDirty();
    }

    tick(dt) {
        // 读取灯管两端电压，作为判断启动、发光和熄灭的核心依据。
        const gapV = this.sys.getVoltageBetween(
            `${this.id}_wire_left_b`, `${this.id}_wire_right_b`
        ) || 0;
        this._vAcrossGap = gapV;
        const absV = Math.abs(gapV);
        this._gapPeakV = Math.max(absV, this._gapPeakV * 0.92);
        const effectiveGapV = this._gapPeakV / Math.SQRT2;

        if (this._faultAged) {
            // 老化故障时直接置为待机，避免灯管继续正常发光。
            this._state = 'idle';
            this._tubeGlow = 0;
        }

        if (this._state === 'idle' || this._state === 'preheat') {
            if (effectiveGapV >= this._strikeV && !this._faultAged) {
                this._state = 'on';
                this._startupTimer = 0;
            }
        }

        if (this._state === 'on') {
            if (effectiveGapV < 10) {
                this._offTimer += dt;
                if (this._offTimer > 0.3) { this._state = 'idle'; this._offTimer = 0; }
            } else {
                this._offTimer = 0;
            }
            this._startupTimer += dt;
            this._flickerPhase += dt * 30;
            const flicker = this._startupTimer < 0.3
                ? 0.3 + 0.7 * Math.abs(Math.sin(this._flickerPhase))
                : 1.0;
            this._tubeGlow += (flicker - this._tubeGlow) * 0.1;
            this._filamentGlow *= 0.9;
        } else {
            this._tubeGlow *= 0.95;
            const filamentV = Math.abs(this.sys.getVoltageBetween(
                `${this.id}_wire_left_a`, `${this.id}_wire_left_b`
            ) || 0);
            const peakFilament = Math.max(filamentV, this._peakFilamentV * 0.9) || filamentV;
            this._peakFilamentV = peakFilament;
            const targetFilament = peakFilament > 5 ? Math.min(1, peakFilament / 50) : 0;
            this._filamentGlow += (targetFilament - this._filamentGlow) * 0.1;
        }

        this._updateVisuals();
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateVisuals() {
        // 根据状态同步灯管和灯丝的发光强度、状态文字和颜色，形成真实的发光动画。
        if (this._tubeGlow > 0.1) {
            const t = Math.min(1, this._tubeGlow);
            const r = Math.min(255, 40 + Math.round(215 * t));
            const g = Math.min(255, 100 + Math.round(155 * t));
            const b = 255;
            this._tubeGlowNode.fill(`rgb(${r},${g},${b})`);
            this._tubeGlowNode.opacity(0.35 + 0.55 * t);
            this._leftFilamentGlow.opacity(0);
            this._rightFilamentGlow.opacity(0);
            this._stateLabel.text('已点亮');
            this._stateLabel.fill('#27ae60');
        } else if (this._filamentGlow > 0.1) {
            const t = Math.min(1, this._filamentGlow);
            const r = 255;
            const g = Math.round(60 * (1 - t));
            const s = this.scale || 1;
            const color = `rgb(${r},${g},0)`;
            const radius = 12 * s;
            const opacity = 0.4 + 0.5 * t;
            this._leftFilamentGlow.fill(color);
            this._leftFilamentGlow.radius(radius);
            this._leftFilamentGlow.opacity(opacity);
            this._rightFilamentGlow.fill(color);
            this._rightFilamentGlow.radius(radius);
            this._rightFilamentGlow.opacity(opacity);
            this._tubeGlowNode.opacity(0);
            this._stateLabel.text('预热中');
            this._stateLabel.fill('#e67e22');
        } else {
            this._leftFilamentGlow.opacity(0);
            this._rightFilamentGlow.opacity(0);
            this._tubeGlowNode.opacity(0);
            this._stateLabel.text('待机');
            this._stateLabel.fill('#7f8c8d');
        }
    }

    getConfigFields() {
        // 配置面板只暴露关键参数，便于维护灯丝和导通电阻等特性值。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '灯丝电阻 (\u03a9)', key: 'filamentR', type: 'number' },
            { label: '导通电阻 (\u03a9)', key: 'gapOnR', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 配置更新时同步到属性并重新刷显示，确保用户参数修改后的状态和视觉一致。
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.filamentR !== undefined) this.filamentR = cfg.filamentR;
        if (cfg.gapOnR !== undefined) this.gapOnR = cfg.gapOnR;
        this.config = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }
}