import { BaseComponent } from './BaseComponent.js';

/**
 * SpeedTransmitter — 转速变送器（两线制，4~20mA 输出）
 * ═══════════════════════════════════════════════════════════════════════════
 *  - 采集所配电机（sourceMotor）的实际转速 r/min，按量程线性转换为 4~20mA：
 *        I(mA) = 4 + 16 × (n − n_min) / (n_max − n_min)
 *  - 电气模型：两线制电流吸收器（环路需 24V 供电，串接 AI04 电流输入端子）；
 *    复用平台既有的 transmitter_2wire 模型（`DeviceStamps.stampTransmitters`
 *    + `CircuitUtils.calcTransmitterCurrent` 的 special='speed' 分支）。
 *  - 端口：p（回路 +，接 24V+）、n（回路 −，接 AI04 的 ch+）。
 */
export class SpeedTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(150, config.width || 170);
        this.height = Math.max(180, config.height || 205);

        this.type = 'transmitter_2wire';
        this.special = 'speed';
        this.cache = 'fixed';
        this.label = config.label || '转速变送器';

        this.sourceMotor = config.sourceMotor || 'm-3d';
        this.rpmMin = config.rpmMin !== undefined ? parseFloat(config.rpmMin) : 0;
        this.rpmMax = config.rpmMax !== undefined ? parseFloat(config.rpmMax) : 2000;

        this.zeroAdj = 0;
        this.spanAdj = 1;
        this.isBreak = false;          // 与 transmitter 模型一致的断路标志
        this._loopPct = 0;             // 0~1
        this._loopCurrent = 4;         // mA
        this._rpm = 0;

        this._initGroups();
        this._draw();
        this._bind();

        // 两线制回路端子
        this.addPort(55, this.height, 'p', 'wire', 'p');   // 回路 +
        this.addPort(115, this.height, 'n', 'wire');       // 回路 −

        this.config = {
            id: this.id, label: this.label, sourceMotor: this.sourceMotor,
            rpmMin: this.rpmMin, rpmMax: this.rpmMax,
        };
    }

    _draw() {
        const W = this.width, H = this.height;
        // 外壳
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 6,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#3a4048', 0.5, '#2b3138', 1, '#1f2429'],
            stroke: '#12161a', strokeWidth: 1.5, listening: false,
        }));
        // 铭牌
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.06, y: H * 0.07, width: W * 0.88, height: H * 0.16,
            fill: '#e9e6dc', stroke: '#9aa0a6', strokeWidth: 0.8, cornerRadius: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.06, y: H * 0.085, width: W * 0.88, text: '转速变送器',
            fontSize: Math.max(12, W * 0.085), fontStyle: 'bold', fontFamily: 'Microsoft YaHei',
            fill: '#0a5a5a', align: 'center', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.06, y: H * 0.155, width: W * 0.88, text: '4~20mA 两线制',
            fontSize: Math.max(9, W * 0.055), fontFamily: 'Arial, sans-serif',
            fill: '#333', align: 'center', listening: false,
        }));
        // LCD
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.10, y: H * 0.28, width: W * 0.80, height: H * 0.40,
            fill: '#05140a', stroke: '#0a3a1a', strokeWidth: 1, cornerRadius: 3, listening: false,
        }));
        // 端子
        [[55, 'P'], [115, 'N']].forEach(([x, t]) => {
            this._staticGroup.add(new Konva.Rect({
                x: x - 5, y: H - 6, width: 10, height: 10, cornerRadius: 1,
                fill: t === 'P' ? '#c9a227' : '#8a929a', stroke: '#5a6168', strokeWidth: 0.6, listening: false,
            }));
            this._staticGroup.add(new Konva.Text({
                x: x - 10, y: H - 26, width: 20, text: t, fontSize: 11,
                fontFamily: 'Arial, sans-serif', fill: '#dbe2e8', align: 'center', listening: false,
            }));
        });

        // 动态显示：转速 / 电流
        this._rpmText = new Konva.Text({
            x: W * 0.10, y: H * 0.305, width: W * 0.80, text: '0 r/min',
            fontSize: Math.max(16, W * 0.11), fontFamily: 'Consolas, monospace',
            fill: '#4df08a', align: 'center', listening: false,
        });
        this._maText = new Konva.Text({
            x: W * 0.10, y: H * 0.47, width: W * 0.80, text: '4.00 mA',
            fontSize: Math.max(13, W * 0.085), fontFamily: 'Consolas, monospace',
            fill: '#9fe0b8', align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._rpmText, this._maText);

        // 整机命中层
        this._interactGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0)', listening: true,
        }));

        // 端子热区（供工作流箭头精确定位）
        this.addClickablePart('term-p', 45, H - 32, 20, 38);
        this.addClickablePart('term-n', 105, H - 32, 20, 38);
    }

    _bind() {
        this.group.on('dblclick dbltap', (e) => { e.cancelBubble = true; this.showConfigDialog(); });
    }

    tick() {
        const motor = this.sys && this.sys.comps ? this.sys.comps[this.sourceMotor] : null;
        const rpm = (motor && typeof motor.getSpeed === 'function') ? motor.getSpeed() : 0;
        this._rpm = rpm;
        const span = Math.max(1e-6, this.rpmMax - this.rpmMin);
        this._loopPct = Math.max(0, Math.min(1, (rpm - this.rpmMin) / span));
        this._loopCurrent = 4 + this._loopPct * 16;

        if (this._rpmText) this._rpmText.text(`${Math.round(rpm)} r/min`);
        if (this._maText) this._maText.text(`${this._loopCurrent.toFixed(2)} mA`);
        this.markDirty();
        this._refreshIfDirty();
    }

    // ── 供求解器/监控读取 ──
    getLoopPercent() { return this._loopPct; }
    getLoopCurrent() { return this._loopCurrent; }   // mA
    getSpeed() { return this._rpm; }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '转速来源（电机组件 id）', key: 'sourceMotor', type: 'text' },
            { label: '量程下限 (r/min)', key: 'rpmMin', type: 'number' },
            { label: '量程上限 (r/min)', key: 'rpmMax', type: 'number' },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.sourceMotor !== undefined) this.sourceMotor = cfg.sourceMotor;
        if (cfg.rpmMin !== undefined) this.rpmMin = parseFloat(cfg.rpmMin) || 0;
        if (cfg.rpmMax !== undefined) this.rpmMax = parseFloat(cfg.rpmMax) || 2000;
        this.config = Object.assign({}, this.config, cfg);
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() { super.destroy?.(); }
}

export default SpeedTransmitter;
