/**
 * Sequential.js — 时序逻辑组件
 *
 * 包含：DFF (D 触发器), JKFF (JK 触发器), ClockGen (时钟发生器), Counter (4位计数器)
 * 所有组件通过 DigitalBase 注册数字信号线，由 DigitalSolver 在时钟边沿驱动。
 */

import { DigitalBase } from './DigitalBase.js';
import { signalBridge } from '../tools/SignalBridge.js';

// ══════════════════════════════════════════════
//  D 触发器
// ══════════════════════════════════════════════

export class DFlipFlop extends DigitalBase {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_dff';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 60 * s;
        const H = 60 * s;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#8e44ad',
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 时钟三角标记 ──
        const tri = new Konva.Line({
            points: [
                -8 * s, -8 * s,
                0, 0,
                -8 * s, 8 * s,
            ],
            closed: true,
            fill: '#fff',
            stroke: '#2c3e50',
            strokeWidth: 1 * s,
        });
        tri.x(W / 2 - 2 * s);
        tri.y(0);
        this.group.add(tri);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'D',
            x: -W / 2 + 8 * s,
            y: -H / 2 + 6 * s,
            fontSize: 20 * s,
            fontFamily: 'Courier New',
            fill: '#fff',
            fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 端口说明文字 ──
        const portLabels = [
            { text: 'D', x: -W / 2 - 20 * s, y: -14 * s },
            { text: 'CLK', x: -W / 2 - 28 * s, y: 0 },
            { text: 'Q', x: W / 2 + 8 * s, y: -14 * s },
            { text: 'Q\'', x: W / 2 + 8 * s, y: 14 * s },
        ];
        portLabels.forEach(pl => {
            const t = new Konva.Text({
                text: pl.text,
                x: pl.x,
                y: pl.y,
                fontSize: 10 * s,
                fontFamily: 'Arial',
                fill: '#fff',
            });
            this.group.add(t);
        });

        // ── 端口 ──
        this.addDigitalInput(-W / 2 - 10 * s, -14 * s, 'd');
        this.addDigitalInput(-W / 2 - 10 * s, 0, 'clk');
        this.addDigitalOutput(W / 2 + 10 * s, -14 * s, 'q');
        this.addDigitalOutput(W / 2 + 10 * s, 14 * s, 'qn');

        // ── 内部状态 ──
        this.q = 0;
        this.qn = 1;
        this.digitalOut = 0;

        // ── Q/QN LED 指示 ──
        this._ledQ = new Konva.Circle({
            x: W / 2 + 24 * s, y: -14 * s,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this._ledQn = new Konva.Circle({
            x: W / 2 + 24 * s, y: 14 * s,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this.group.add(this._ledQ, this._ledQn);
    }

    /** D 触发器特定：时钟端口 */
    getClockPort() {
        return `${this.id}_clk`;
    }
    getDataPort() {
        return `${this.id}_d`;
    }
    getOutputPort() {
        return `${this.id}_q`;
    }
    getComplementPort() {
        return `${this.id}_qn`;
    }

    updateLED() {
        if (this._ledQ) this._ledQ.fill(this.q ? '#2ecc71' : '#555');
        if (this._ledQn) this._ledQn.fill(this.qn ? '#2ecc71' : '#555');
    }
}


// ══════════════════════════════════════════════
//  JK 触发器
// ══════════════════════════════════════════════

export class JKFlipFlop extends DigitalBase {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_jkff';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 60 * s;
        const H = 70 * s;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#c0392b',
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 时钟三角 ──
        const tri = new Konva.Line({
            points: [-8 * s, -8 * s, 0, 0, -8 * s, 8 * s],
            closed: true, fill: '#fff',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        tri.x(W / 2 - 2 * s);
        tri.y(0);
        this.group.add(tri);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'JK',
            x: -W / 2 + 8 * s, y: -H / 2 + 6 * s,
            fontSize: 18 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 端口说明 ──
        const portLabels = [
            { text: 'J', x: -W / 2 - 20 * s, y: -16 * s },
            { text: 'K', x: -W / 2 - 20 * s, y: 16 * s },
            { text: 'CLK', x: -W / 2 - 28 * s, y: 0 },
            { text: 'Q', x: W / 2 + 8 * s, y: -16 * s },
            { text: 'Q\'', x: W / 2 + 8 * s, y: 16 * s },
        ];
        portLabels.forEach(pl => {
            const t = new Konva.Text({
                text: pl.text, x: pl.x, y: pl.y,
                fontSize: 10 * s, fontFamily: 'Arial', fill: '#fff',
            });
            this.group.add(t);
        });

        // ── 端口 ──
        this.addDigitalInput(-W / 2 - 10 * s, -16 * s, 'j');
        this.addDigitalInput(-W / 2 - 10 * s, 0, 'clk');
        this.addDigitalInput(-W / 2 - 10 * s, 16 * s, 'k');
        this.addDigitalOutput(W / 2 + 10 * s, -16 * s, 'q');
        this.addDigitalOutput(W / 2 + 10 * s, 16 * s, 'qn');

        this.q = 0;
        this.qn = 1;
        this.digitalOut = 0;

        this._ledQ = new Konva.Circle({
            x: W / 2 + 24 * s, y: -16 * s,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this._ledQn = new Konva.Circle({
            x: W / 2 + 24 * s, y: 16 * s,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this.group.add(this._ledQ, this._ledQn);
    }

    getClockPort() { return `${this.id}_clk`; }
    getOutputPort() { return `${this.id}_q`; }
    getComplementPort() { return `${this.id}_qn`; }

    updateLED() {
        if (this._ledQ) this._ledQ.fill(this.q ? '#2ecc71' : '#555');
        if (this._ledQn) this._ledQn.fill(this.qn ? '#2ecc71' : '#555');
    }
}


// ══════════════════════════════════════════════
//  时钟发生器
// ══════════════════════════════════════════════

export class ClockGen extends DigitalBase {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_clockgen';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 50 * s;
        const H = 40 * s;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#f39c12',
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 波形图标 ──
        const wave = new Konva.Line({
            points: [
                -20 * s, -10 * s,
                -20 * s, 10 * s,
                -10 * s, 10 * s,
                -10 * s, -10 * s,
                0, -10 * s,
                0, 10 * s,
                10 * s, 10 * s,
                10 * s, -10 * s,
                20 * s, -10 * s,
                20 * s, 10 * s,
            ],
            stroke: '#fff',
            strokeWidth: 2 * s,
            lineCap: 'round',
            lineJoin: 'round',
        });
        this.group.add(wave);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'CLK',
            x: -W / 2 + 6 * s, y: -H / 2 + 4 * s,
            fontSize: 12 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 参数信息 ──
        this.frequency = config.frequency || 10; // Hz
        this.duty = config.duty || 0.5;

        this._infoText = new Konva.Text({
            text: `${this.frequency}Hz`,
            x: -W / 2 + 6 * s, y: 6 * s,
            fontSize: 9 * s, fontFamily: 'Arial',
            fill: 'rgba(255,255,255,0.8)',
        });
        this.group.add(this._infoText);

        // ── 输出端口 ──
        this.addDigitalOutput(W / 2 + 10 * s, 0, 'out');

        // ── 注册时钟到 SignalBridge ──
        this.clockId = `${this.id}_clock`;
        signalBridge.registerClock(this.clockId, this.frequency, this.duty);

        this.digitalOut = 0;

        // LED
        this._led = new Konva.Circle({
            x: W / 2 + 20 * s, y: 0,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this.group.add(this._led);
    }

    getOutputPort() { return `${this.id}_out`; }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '频率 (Hz)', key: 'frequency', type: 'number' },
            { label: '占空比 (0~1)', key: 'duty', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        this.frequency = parseFloat(newConfig.frequency) || 10;
        this.duty = Math.max(0, Math.min(1, parseFloat(newConfig.duty) || 0.5));
        signalBridge.registerClock(this.clockId, this.frequency, this.duty);
        if (this._infoText) this._infoText.text(`${this.frequency}Hz`);
        this._refreshCache();
    }

    updateLED() {
        if (this._led) this._led.fill(this.digitalOut ? '#2ecc71' : '#555');
    }
}


// ══════════════════════════════════════════════
//  4 位二进制计数器
// ══════════════════════════════════════════════

export class Counter extends DigitalBase {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_counter';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 70 * s;
        const H = 80 * s;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#2980b9',
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'CTR',
            x: -W / 2 + 8 * s, y: -H / 2 + 6 * s,
            fontSize: 18 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 计数值显示 ──
        this._countText = new Konva.Text({
            text: '0x0',
            x: -W / 2 + 8 * s, y: 10 * s,
            fontSize: 20 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(this._countText);

        // ── 端口 ──
        this.addDigitalInput(-W / 2 - 10 * s, -14 * s, 'clk');
        this.addDigitalInput(-W / 2 - 10 * s, 14 * s, 'rst');

        // 输出：Q0~Q3
        for (let i = 0; i < 4; i++) {
            this.addDigitalOutput(W / 2 + 10 * s, (-15 + i * 10) * s, `q${i}`);
        }

        this.count = 0;
        this.digitalOut = 0;

        // LED
        this._leds = [];
        for (let i = 0; i < 4; i++) {
            const led = new Konva.Circle({
                x: W / 2 + 22 * s, y: (-15 + i * 10) * s,
                radius: 3 * s, fill: '#555',
                stroke: '#2c3e50', strokeWidth: 1 * s,
            });
            this.group.add(led);
            this._leds.push(led);
        }
    }

    getClockPort() { return `${this.id}_clk`; }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
        ];
    }

    updateLED() {
        if (!this._leds) return;
        for (let i = 0; i < 4; i++) {
            const bit = (this.count >> i) & 1;
            this._leds[i].fill(bit ? '#2ecc71' : '#555');
        }
        if (this._countText) {
            this._countText.text(`0x${this.count.toString(16).toUpperCase()}`);
        }
    }
}
