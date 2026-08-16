/**
 * Timer555.js — NE555 定时器组件
 *
 * 引脚定义（DIP-8，底视图）：
 *   GND(1) — 电源地       TR(2)  — 触发输入（模拟）
 *   OUT(3) — 输出           RST(4) — 复位（低电平有效，数字）
 *   CTRL(5)— 控制电压       TH(6)  — 阈值输入（模拟）
 *   DIS(7) — 放电（开集电极） VCC(8) — 电源正
 *
 * 工作模式：
 *   无稳态（Astable）— 自动振荡，产生方波
 *   单稳态（Monostable）— TR 负脉冲触发，输出固定宽度脉冲
 *
 * 内部结构：
 *   3×5kΩ 分压网络 → 1/3 VCC 和 2/3 VCC 参考电压
 *   两个比较器 → RS 触发器 → 输出缓冲 + 放电管
 *
 * 仿真策略（混合信号）：
 *   - TH/TR 通过 MNA 求解获得模拟电压
 *   - 内部控制逻辑在 DigitalSolver 中实现
 *   - DIS 放电管在 DeviceStamps 中建模为可控电阻
 *   - OUT 通过 SignalBridge 写入数字信号线，同时在 MNA 层反映电压
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { signalBridge } from '../tools/SignalBridge.js';

export class Timer555 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_555';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 70 * s;
        const H = 100 * s;

        // ── 内部状态 ──
        this._q = 0;           // RS 触发器输出
        this._disChargeOn = false; // 放电管状态
        this._outHigh = false;  // OUT 引脚电平
        this._lastTH = 0;      // 上一帧 TH 电压（用于阈值穿越检测）
        this._lastTR = 0;      // 上一帧 TR 电压
        this._prevRST = 1;     // 上一帧 RST 值
        this._prevOut = 0;     // 上一帧 OUT（数字信号线）

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#1a1a2e',
            stroke: '#e94560',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 凹槽标记（DIP-8 方向指示） ──
        const notch = new Konva.Rect({
            x: -6 * s, y: -H / 2 - 2 * s,
            width: 12 * s, height: 4 * s,
            fill: '#e94560',
            cornerRadius: 2 * s,
        });
        this.group.add(notch);

        // ── 型号标识 ──
        const label = new Konva.Text({
            text: 'NE555',
            x: -W / 2 + 8 * s, y: -H / 2 + 10 * s,
            fontSize: 16 * s, fontFamily: 'Courier New',
            fill: '#e94560', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 工作模式显示 ──
        this._mode = config.mode || 'astable'; // 'astable' | 'monostable'
        this._modeText = new Konva.Text({
            text: this._mode === 'astable' ? '无稳态' : '单稳态',
            x: -W / 2 + 8 * s, y: H / 2 - 28 * s,
            fontSize: 9 * s, fontFamily: 'Arial',
            fill: 'rgba(255,255,255,0.7)',
        });
        this.group.add(this._modeText);

        // ── 状态文字 ──
        this._outText = new Konva.Text({
            text: 'OUT: L',
            x: -W / 2 + 8 * s, y: -H / 2 + 30 * s,
            fontSize: 10 * s, fontFamily: 'Courier New',
            fill: '#ecf0f1', fontStyle: 'bold',
        });
        this.group.add(this._outText);

        // ── 引脚排列（左侧从上到下：GND, TR, OUT, RST） ──
        const leftPins = [
            { name: 'tr',  label: 'TR',  y: -30 * s, polarity: 'n' },
            { name: 'out', label: 'OUT', y: -10 * s, polarity: 'p' },
            { name: 'rst', label: 'RST', y: 10 * s,  polarity: 'n' },
            { name: 'gnd', label: 'GND', y: 30 * s,  polarity: 'n' },
        ];

        // ── 引脚排列（右侧从上到下：VCC, DIS, TH, CTRL） ──
        const rightPins = [
            { name: 'vcc',  label: 'VCC', y: -30 * s, polarity: 'p' },
            { name: 'dis',  label: 'DIS', y: -10 * s, polarity: 'n' },
            { name: 'th',   label: 'TH',  y: 10 * s,  polarity: 'n' },
            { name: 'ctrl', label: 'CTRL', y: 30 * s, polarity: 'n' },
        ];

        leftPins.forEach(pin => {
            this.addPort(-W / 2 - 10 * s, pin.y, pin.name, 'wire', pin.polarity);
            const t = new Konva.Text({
                text: pin.label, x: -W / 2 - 28 * s, y: pin.y - 5 * s,
                fontSize: 8 * s, fontFamily: 'Arial', fill: '#bdc3c7',
            });
            this.group.add(t);
        });

        rightPins.forEach(pin => {
            this.addPort(W / 2 + 10 * s, pin.y, pin.name, 'wire', pin.polarity);
            const t = new Konva.Text({
                text: pin.label, x: W / 2 + 14 * s, y: pin.y - 5 * s,
                fontSize: 8 * s, fontFamily: 'Arial', fill: '#bdc3c7',
            });
            this.group.add(t);
        });

        // 引脚编号
        const pinNumbers = ['1', '2', '3', '4', '5', '6', '7', '8'];
        const pinYX = [
            { x: -W / 2 - 18 * s, y: 30 * s },  // 1: GND
            { x: -W / 2 - 18 * s, y: -30 * s },  // 2: TR
            { x: -W / 2 - 18 * s, y: -10 * s },  // 3: OUT
            { x: -W / 2 - 18 * s, y: 10 * s },   // 4: RST
            { x: W / 2 + 24 * s, y: 30 * s },    // 5: CTRL
            { x: W / 2 + 24 * s, y: 10 * s },    // 6: TH
            { x: W / 2 + 24 * s, y: -10 * s },   // 7: DIS
            { x: W / 2 + 24 * s, y: -30 * s },   // 8: VCC
        ];
        pinNumbers.forEach((num, i) => {
            const t = new Konva.Text({
                text: num, x: pinYX[i].x, y: pinYX[i].y - 5 * s,
                fontSize: 7 * s, fontFamily: 'Arial', fill: '#7f8c8d',
            });
            this.group.add(t);
        });

        // ── OUT LED 指示 ──
        this._led = new Konva.Circle({
            x: -W / 2 + 6 * s, y: -H / 2 + 48 * s,
            radius: 4 * s, fill: '#555',
            stroke: '#fff', strokeWidth: 1 * s,
        });
        this.group.add(this._led);

        // ── 注册数字信号线（OUT 和 RST） ──
        const outLine = `${this.id}_out`;
        signalBridge.createSignalLine(outLine);
        signalBridge.connectToLine(outLine, `${this.id}_out`);

        const rstLine = `${this.id}_rst`;
        signalBridge.createSignalLine(rstLine);
        signalBridge.connectToLine(rstLine, `${this.id}_rst`);

        // ── 配置参数 ──
        this.frequency = config.frequency || 1;    // 无稳态模式目标频率(Hz)
        this.dutyCycle = config.dutyCycle || 50;   // 占空比(%)
        this.pulseWidth = config.pulseWidth || 1;  // 单稳态脉冲宽度(s)

        this.digitalOut = 0;
    }

    // ── DigitalSolver 需要的方法 ──

    getDigitalInputs() {
        return [`${this.id}_rst`];
    }

    getDigitalOutput() {
        return `${this.id}_out`;
    }

    getDigitalOutputs() {
        return [`${this.id}_out`];
    }

    /**
     * 获取 TH 端口的 MNA 簇索引（供 DigitalSolver 读取电压）
     */
    getTHCluster() {
        return `${this.id}_wire_th`;
    }

    getTRCluster() {
        return `${this.id}_wire_tr`;
    }

    getCTRLCluster() {
        return `${this.id}_wire_ctrl`;
    }

    getVCCCluster() {
        return `${this.id}_wire_vcc`;
    }

    // ── 配置界面 ──

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            {
                label: '工作模式', key: 'mode', type: 'select',
                options: [
                    { value: 'astable', label: '无稳态 (Astable)' },
                    { value: 'monostable', label: '单稳态 (Monostable)' },
                ],
            },
            { label: '目标频率 (Hz, 无稳态)', key: 'frequency', type: 'number' },
            { label: '占空比 (%, 无稳态)', key: 'dutyCycle', type: 'number' },
            { label: '脉冲宽度 (s, 单稳态)', key: 'pulseWidth', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        this._mode = newConfig.mode || 'astable';
        this.frequency = parseFloat(newConfig.frequency) || 1;
        this.dutyCycle = Math.max(1, Math.min(99, parseFloat(newConfig.dutyCycle) || 50));
        this.pulseWidth = Math.max(0.001, parseFloat(newConfig.pulseWidth) || 1);

        if (this._modeText) this._modeText.text(this._mode === 'astable' ? '无稳态' : '单稳态');

        // 重新创建信号线（ID 可能变了）
        signalBridge.createSignalLine(`${this.id}_out`);
        signalBridge.createSignalLine(`${this.id}_rst`);

        this._refreshCache();
    }

    /**
     * 更新 LED 显示（由 consys.js 的 _updateDigitalLEDs 调用）
     */
    updateLED() {
        if (this._led) this._led.fill(this._outHigh ? '#e94560' : '#555');
        if (this._outText) this._outText.text(this._outHigh ? 'OUT: H' : 'OUT: L');
    }
}
