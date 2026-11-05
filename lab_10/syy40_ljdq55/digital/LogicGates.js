/**
 * LogicGates.js — 基本逻辑门组件
 *
 * 包含：AND, OR, NOT, NAND, NOR, XOR
 * 符合标准 IEC 矩形符号风格，方便教学识别
 */

import { DigitalBase } from './DigitalBase.js';
import { signalBridge } from '../tools/SignalBridge.js';

// ── 门形状定义 ──
const GATE_STYLES = {
    d_and:  { label: '&',  pins: 2, color: '#3498db' },
    d_or:   { label: '≥1', pins: 2, color: '#2ecc71' },
    d_not:  { label: '1',  pins: 1, color: '#e74c3c' },
    d_nand: { label: '&',  pins: 2, color: '#9b59b6', invert: true },
    d_nor:  { label: '≥1', pins: 2, color: '#e67e22', invert: true },
    d_xor:  { label: '=1', pins: 2, color: '#1abc9c' },
};

class LogicGate extends DigitalBase {
    constructor(config, sys) {
        super(config, sys);
        this.type = config.digitalType || 'd_and';
        this.cache = 'fixed';

        const style = GATE_STYLES[this.type] || GATE_STYLES.d_and;
        const s = this.scale;
        const W = 50 * s;
        const H = style.pins === 1 ? 36 * s : 50 * s;

        // ── 主体矩形 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: style.color,
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 输出反相圈（NAND/NOR） ──
        if (style.invert) {
            const circle = new Konva.Circle({
                x: W / 2 + 6 * s, y: 0,
                radius: 5 * s,
                fill: '#fff',
                stroke: '#2c3e50',
                strokeWidth: 1.5 * s,
            });
            this.group.add(circle);
        }

        // ── 功能标识文字 ──
        const labelText = new Konva.Text({
            text: style.label,
            x: -W / 2 + 8 * s,
            y: -8 * s,
            fontSize: 18 * s,
            fontFamily: 'Courier New',
            fill: '#fff',
            fontStyle: 'bold',
        });
        this.group.add(labelText);

        // ── 类型名称（小字） ──
        const typeLabel = new Konva.Text({
            text: this.type.replace('d_', '').toUpperCase(),
            x: -W / 2 + 8 * s,
            y: 4 * s,
            fontSize: 9 * s,
            fontFamily: 'Arial',
            fill: 'rgba(255,255,255,0.8)',
        });
        this.group.add(typeLabel);

        // ── 端口 ──
        const inputY = style.pins === 1 ? 0 : -14 * s;
        const inputY2 = 14 * s;

        this.addDigitalInput(-W / 2 - 10 * s, inputY, 'a');
        if (style.pins === 2) {
            this.addDigitalInput(-W / 2 - 10 * s, inputY2, 'b');
        }
        this.addDigitalOutput(W / 2 + (style.invert ? 14 : 10) * s, 0, 'out');

        // ── 输出值 LED 指示 ──
        this._ledIndicator = new Konva.Circle({
            x: W / 2 + (style.invert ? 24 : 20) * s,
            y: 0,
            radius: 4 * s,
            fill: '#555',
            stroke: '#2c3e50',
            strokeWidth: 1 * s,
        });
        this.group.add(this._ledIndicator);

        // ── 初始状态 ──
        this.digitalOut = 0;
    }

    /**
     * 更新 LED 颜色指示输出状态（由渲染循环或 DigitalSolver 输出后调用）
     */
    updateLED() {
        if (this._ledIndicator) {
            this._ledIndicator.fill(this.digitalOut ? '#2ecc71' : '#555');
        }
    }
}

// ── 导出各门类 ──

export class AND extends LogicGate {
    constructor(config, sys) {
        super({ ...config, digitalType: 'd_and' }, sys);
    }
}

export class OR extends LogicGate {
    constructor(config, sys) {
        super({ ...config, digitalType: 'd_or' }, sys);
    }
}

export class NOT extends LogicGate {
    constructor(config, sys) {
        super({ ...config, digitalType: 'd_not' }, sys);
    }
}

export class NAND extends LogicGate {
    constructor(config, sys) {
        super({ ...config, digitalType: 'd_nand' }, sys);
    }
}

export class NOR extends LogicGate {
    constructor(config, sys) {
        super({ ...config, digitalType: 'd_nor' }, sys);
    }
}

export class XOR extends LogicGate {
    constructor(config, sys) {
        super({ ...config, digitalType: 'd_xor' }, sys);
    }
}
