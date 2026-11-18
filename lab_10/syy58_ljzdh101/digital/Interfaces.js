/**
 * Interfaces.js — 模拟-数字接口组件
 *
 * 包含：ADC（模数转换器）、DAC（数模转换器）
 *
 * ADC 在模拟域有 wire 端口（输入模拟电压），在数字域有数字信号线（输出数字值）
 * DAC 在数字域有数字信号线（输入数字值），在模拟域有 wire 端口（输出模拟电压）
 *
 * 这些组件同时被 CircuitSolver（MNA 模型）和 DigitalSolver（数字逻辑）认知。
 * 模拟和数字域之间通过 SignalBridge 交换数据。
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { signalBridge } from '../tools/SignalBridge.js';

// ══════════════════════════════════════════════
//  ADC — 模数转换器
// ══════════════════════════════════════════════

export class ADC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_adc';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 60 * s;
        const H = 50 * s;

        // ── 设置 ──
        this.bits = config.bits || 10;
        this.vRef = config.vRef || 5.0;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#16a085',
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'ADC',
            x: -W / 2 + 8 * s, y: -H / 2 + 6 * s,
            fontSize: 20 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 参数信息 ──
        this._infoText = new Konva.Text({
            text: `${this.bits}bit ${this.vRef}V`,
            x: -W / 2 + 8 * s, y: 6 * s,
            fontSize: 9 * s, fontFamily: 'Arial',
            fill: 'rgba(255,255,255,0.8)',
        });
        this.group.add(this._infoText);

        // ── 模拟输入端口（wire 类型，左侧） ──
        this.addPort(-W / 2 - 10 * s, 0, 'in', 'wire', 'p');

        // ── 数字输出 —— 使用信号线而非 wire 端口 ──
        // 数字输出信号线通过 DigitalBase 风格注册
        this._digitalOutLine = `${this.id}_digital_out`;
        signalBridge.createSignalLine(this._digitalOutLine);

        // ── 数字输出图标（右侧的箭头） ──
        const arrow = new Konva.Arrow({
            points: [W / 2 + 2 * s, 0, W / 2 + 18 * s, 0],
            stroke: '#fff',
            strokeWidth: 2 * s,
            fill: '#fff',
            pointerLength: 6 * s,
            pointerWidth: 4 * s,
        });
        this.group.add(arrow);

        // ── 数字值 LED 指示（0/1 简化） ──
        this._led = new Konva.Circle({
            x: W / 2 + 24 * s, y: 0,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this.group.add(this._led);

        // ── 数值显示 ──
        this._valText = new Konva.Text({
            text: '0',
            x: -W / 2 + 8 * s, y: -8 * s,
            fontSize: 14 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(this._valText);

        // ── 注册 ADC 通道到 SignalBridge ──
        signalBridge.registerADC(`${this.id}_wire_in`, this.bits, this.vRef);

        this.digitalOut = 0;
    }

    /** 获取模拟输入端口名（供 SignalBridge 查找电压） */
    getAnalogInputPort() {
        return `${this.id}_wire_in`;
    }

    /** 获取数字输出信号线 */
    getDigitalOutput() {
        return this._digitalOutLine;
    }

    getDigitalInputs() {
        return [];
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '分辨率 (bit)', key: 'bits', type: 'number' },
            { label: '参考电压 (V)', key: 'vRef', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        this.bits = parseInt(newConfig.bits) || 10;
        this.vRef = parseFloat(newConfig.vRef) || 5.0;
        signalBridge.registerADC(`${this.id}_wire_in`, this.bits, this.vRef);
        if (this._infoText) this._infoText.text(`${this.bits}bit ${this.vRef}V`);
        this._refreshCache();
    }

    updateLED() {
        const val = signalBridge.getADCDigital(`${this.id}_wire_in`);
        if (this._valText) this._valText.text(`${val}`);
        if (this._led) this._led.fill(val > 0 ? '#2ecc71' : '#555');
    }
}


// ══════════════════════════════════════════════
//  DAC — 数模转换器
// ══════════════════════════════════════════════

export class DAC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_dac';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 60 * s;
        const H = 50 * s;

        // ── 设置 ──
        this.bits = config.bits || 10;
        this.vRef = config.vRef || 5.0;
        this.maxOutput = this.vRef;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#d35400',
            stroke: '#2c3e50',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'DAC',
            x: -W / 2 + 8 * s, y: -H / 2 + 6 * s,
            fontSize: 20 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 参数信息 ──
        this._infoText = new Konva.Text({
            text: `${this.bits}bit ${this.vRef}V`,
            x: -W / 2 + 8 * s, y: 6 * s,
            fontSize: 9 * s, fontFamily: 'Arial',
            fill: 'rgba(255,255,255,0.8)',
        });
        this.group.add(this._infoText);

        // ── 数字输入信号线（左侧箭头） ──
        this._digitalInLine = `${this.id}_digital_in`;
        signalBridge.createSignalLine(this._digitalInLine);

        const arrow = new Konva.Arrow({
            points: [-W / 2 - 18 * s, 0, -W / 2 - 2 * s, 0],
            stroke: '#fff',
            strokeWidth: 2 * s,
            fill: '#fff',
            pointerLength: 6 * s,
            pointerWidth: 4 * s,
        });
        this.group.add(arrow);

        // ── 模拟输出端口（wire 类型，右侧） ──
        this.addPort(W / 2 + 10 * s, 0, 'out', 'wire', 'p');

        // ── 数值显示 ──
        this._valText = new Konva.Text({
            text: '0V',
            x: W / 2 - 30 * s, y: -8 * s,
            fontSize: 12 * s, fontFamily: 'Courier New',
            fill: '#fff', fontStyle: 'bold',
        });
        this.group.add(this._valText);

        // ── LED ──
        this._led = new Konva.Circle({
            x: -W / 2 - 24 * s, y: 0,
            radius: 4 * s, fill: '#555',
            stroke: '#2c3e50', strokeWidth: 1 * s,
        });
        this.group.add(this._led);

        // ── 注册 DAC 通道 ──
        signalBridge.registerDAC(`${this.id}_analog_out`, this.bits, this.vRef);

        this.digitalOut = 0;
    }

    /** 获取数字输入信号线 */
    getDigitalInputPort() {
        return this._digitalInLine;
    }

    getDigitalOutput() {
        return null;
    }

    getDigitalInputs() {
        return [this._digitalInLine];
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '分辨率 (bit)', key: 'bits', type: 'number' },
            { label: '参考电压 (V)', key: 'vRef', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        this.bits = parseInt(newConfig.bits) || 10;
        this.vRef = parseFloat(newConfig.vRef) || 5.0;
        this.maxOutput = this.vRef;
        signalBridge.registerDAC(`${this.id}_analog_out`, this.bits, this.vRef);
        if (this._infoText) this._infoText.text(`${this.bits}bit ${this.vRef}V`);
        this._refreshCache();
    }

    updateLED() {
        const v = signalBridge.getDACVoltage(`${this.id}_analog_out`);
        if (this._valText) this._valText.text(`${v.toFixed(2)}V`);
        if (this._led) this._led.fill(v > 0.1 ? '#2ecc71' : '#555');
    }
}
