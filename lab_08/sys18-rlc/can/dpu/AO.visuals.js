/**
 * AO.visuals.js — 模拟量输出模块：图形绘制 Mixin
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 本文件导出一个 applyVisualsMixin(proto) 函数，
 * 将所有绘图方法混入 AOModule 的原型。
 */

import { W, H, CH_CONFIG } from './AO.constants.js';

export function applyVisualsMixin(proto) {

    // ──────────────────────────────────────────
    //  总入口：初始化视觉元素
    // ──────────────────────────────────────────
    proto._initVisuals = function () {
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.scaleGroup);

        this._drawBody();
        this._drawHeader();
        this._drawChannelRows();
        this._drawStatusLEDs();
        this._drawAddressSwitch();
        this._drawTermSwitch();
        this._drawBottomPanel();
        this._drawPortLabels();
    };

    // ──────────────────────────────────────────
    //  主体
    // ──────────────────────────────────────────
    proto._drawBody = function () {
        const sg = this.scaleGroup;

        const railAttr = { width: 18, height: H, fill: '#9e9e9e', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2 };
        sg.add(new Konva.Rect({ x: -18, y: 0, ...railAttr }));
        sg.add(new Konva.Rect({ x: W, y: 0, ...railAttr }));

        sg.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: 0 },
            fillLinearGradientColorStops: [0, '#2c2c2c', 0.5, '#3a3a3a', 1, '#2c2c2c'],
            stroke: '#222', strokeWidth: 3, cornerRadius: 3,
        }));

        // 顶部装饰条（橙色）
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#cc5500', cornerRadius: [3, 3, 0, 0] }));
    };

    // ──────────────────────────────────────────
    //  标题栏
    // ──────────────────────────────────────────
    proto._drawHeader = function () {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#cc5500', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'AO-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#ff8833' }));
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'ANALOG  OUTPUT  MODULE', fontSize: 7, fill: '#11872b' }));
        this._nodeAddrDisplay = new Konva.Text({ x: 128, y: 14, text: `NODE:${String(this.nodeAddress).padStart(2, '0')}`, fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00' });
        sg.add(this._nodeAddrDisplay);
    };

    // ──────────────────────────────────────────
    //  通道行
    // ──────────────────────────────────────────
    proto._drawChannelRows = function () {
        this._chDisplays = {};
        this._chLEDs = {};

        CH_CONFIG.forEach((ch) => {
            const y = 44 + CH_CONFIG.indexOf(ch) * 52;
            const sg = this.scaleGroup;

            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));

            sg.add(new Konva.Text({ x: 8, y: y + 4, text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#aaa' }));
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.type, fontSize: 8, fill: '#21a54d' }));

            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#2a2a00', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);

            const valText = new Konva.Text({
                x: 46, y: y + 8, width: 96, text: '----',
                fontSize: 18, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#ffaa00', align: 'right',
            });
            const unitText = new Konva.Text({ x: 46, y: y + 30, width: 96, text: '', fontSize: 8, fill: '#f7eeee', align: 'right' });
            this._chDisplays[ch.id] = { val: valText, unit: unitText, bg: dispBg };
            sg.add(valText, unitText);

            if (ch.type === 'PWM') {
                const barBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 4, fill: '#111' });
                const barFg = new Konva.Rect({ x: 44, y: y + 4, width: 0, height: 4, fill: '#ff6600' });
                this._chDisplays[ch.id].barBg = barBg;
                this._chDisplays[ch.id].barFg = barFg;
                sg.add(barBg, barFg);
            }

            const led = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const ledLabel = new Konva.Text({ x: 170, y: y + 10, text: 'OUT', fontSize: 7, fill: '#f1e5e5' });
            this._chLEDs[ch.id] = led;
            sg.add(led, ledLabel);

            const statusText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            this._chDisplays[ch.id].status = statusText;
            sg.add(statusText);

            const physText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#1ef40b' });
            this._chDisplays[ch.id].phys = physText;
            sg.add(physText);
        });
    };

    // ──────────────────────────────────────────
    //  状态指示灯
    // ──────────────────────────────────────────
    proto._drawStatusLEDs = function () {
        const sg = this.scaleGroup;
        const y = 256;
        const defs = [
            { id: 'pwr', label: 'PWR', color: '#00ff00', x: 14 },
            { id: 'run', label: 'RUN', color: '#00ff00', x: 58 },
            { id: 'flt', label: 'FLT', color: '#ff3300', x: 102 },
            { id: 'com', label: 'COM', color: '#00aaff', x: 146 },
        ];

        sg.add(new Konva.Rect({ x: 4, y: y - 4, width: W - 8, height: 28, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#f7f1f1' }));

        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x + 10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f8f1f1', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    };

    // ──────────────────────────────────────────
    //  拨码开关
    // ──────────────────────────────────────────
    proto._drawAddressSwitch = function () {
        const sg = this.scaleGroup;
        const y = 288;
        const swW = 18;
        const swH = 26;
        const gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f1ecec' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0 = 14 + i * gap;
            const isOn = (this.nodeAddress & bitVal) !== 0;

            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: swH, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#f1e8e8', width: swW, align: 'center' });
            const vLbl = new Konva.Text({ x: x0, y: y + 12, text: bitVal.toString(), fontSize: 6, fill: '#444', width: swW, align: 'center' });

            swBg.on('click tap', () => {
                if (this.nodeAddress & bitVal) this.nodeAddress &= ~bitVal;
                else this.nodeAddress |= bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });
            vLbl.on('click tap', () => {
                if (this.nodeAddress & bitVal) this.nodeAddress &= ~bitVal;
                else this.nodeAddress |= bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });

            this._swObjs.push({ knob, bitVal, y0: y });
            sg.add(swBg, knob, lbl, vLbl);
        }

        this._addrDecText = new Konva.Text({ x: 105, y: y + 10, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'left' });
        sg.add(this._addrDecText);
    };

    // ──────────────────────────────────────────
    //  终端电阻开关
    // ──────────────────────────────────────────
    proto._drawTermSwitch = function () {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;

        sg.add(new Konva.Text({ x: x0 - 2, y: y0 - 6, text: '终端电阻', fontSize: 8, fill: '#f7eded' }));
        const termBg = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#f9f2f2', width: 32, align: 'center' });

        termBg.on('click tap', () => {
            this.termEnabled = !this.termEnabled;
            this.currentResistance = this.termEnabled ? 120 : 1000000;
            this._termKnob.y(this.termEnabled ? y0 + 10 : y0 + 22);
            this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
            this._refreshCache();
        });

        sg.add(termBg, this._termKnob, termLbl);
    };

    // ──────────────────────────────────────────
    //  底部面板
    // ──────────────────────────────────────────
    proto._drawBottomPanel = function () {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 0, y: H, width: W, height: 20, fill: '#9e9e9e', stroke: '#444', strokeWidth: 1.5 }));
        const labels = [
            { x: 25, text: 'CAN1H' },
            { x: 70, text: 'CAN1L' },
            { x: 115, text: 'CAN2H' },
            { x: 160, text: 'CAN2L' },
        ];
        labels.forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    };

    // ──────────────────────────────────────────
    //  端口标注
    // ──────────────────────────────────────────
    proto._drawPortLabels = function () {
        const sg = this.scaleGroup;
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            sg.add(new Konva.Text({ x: -40, y: y - 4, text: `${ch.label}+`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -40, y: y + 18, text: `${ch.label}-`, fontSize: 7, fill: '#0d05f2' }));
        });
        sg.add(new Konva.Text({ x: W + 2, y: 8, text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 34, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
    };

    // ──────────────────────────────────────────
    //  渲染
    // ──────────────────────────────────────────
    proto._render = function () {
        CH_CONFIG.forEach(ch => {
            const cData = this.channels[ch.id];
            const disp = this._chDisplays[ch.id];
            const led = this._chLEDs[ch.id];
            const rng = this.ranges[ch.id];

            if (cData.mode === 'disable') {
                disp.val.text('DISABLE');
                disp.val.fill('#555555');
                disp.unit.text('');
                disp.bg.stroke('#333333');
                disp.phys.text('');
                disp.status.text('OFF');
                disp.status.fill('#555555');
                led.fill('#222222');
                if (ch.type === 'PWM' && disp.barFg) disp.barFg.width(0);
                return;
            }

            if (!this.powerOn || cData.fault) {
                disp.val.text(cData.fault ? ' FAULT' : '');
                disp.val.fill('#ff3300');
                disp.unit.text('');
                disp.bg.stroke('#550000');
                disp.phys.text(cData.fault ? 'OPEN LOOP' : '');
                disp.status.text(cData.fault ? 'FLT' : '');
                disp.status.fill('#ff3300');
                led.fill(cData.fault ? '#ff3300' : '#222');
                if (ch.type === 'PWM' && disp.barFg) disp.barFg.width(0);
                return;
            }

            let pct = cData.percent;
            pct = Math.max(rng.lrv, Math.min(rng.urv, pct));
            pct = Math.max(0, Math.min(100, pct));

            if (ch.type === '4-20mA') {
                disp.val.text(pct.toFixed(1).padStart(6, ' '));
                disp.unit.text('%');
                disp.phys.text(`${cData.actual.toFixed(2)} mA`);
                disp.val.fill(pct > 0.1 ? '#ffaa00' : '#444');
                disp.bg.stroke(pct > 0.1 ? '#2a2a00' : '#1a1a1a');
                led.fill(pct > 0.1 ? '#ffaa00' : '#222');
            } else if (ch.type === 'PWM') {
                disp.val.text(pct.toFixed(1).padStart(6, ' '));
                disp.unit.text('%');
                disp.phys.text(`${cData.frequency}Hz ${cData.instantOn ? '●ON' : '○OF'}`);
                if (disp.barFg) disp.barFg.width(Math.round(pct / 100 * 100));
                const pwmColor = cData.instantOn ? '#ff6600' : '#663300';
                disp.val.fill(pct > 0.1 ? pwmColor : '#444');
                disp.bg.stroke(pct > 0.1 ? '#2a1800' : '#1a1a1a');
                led.fill(cData.instantOn ? '#ff6600' : (pct > 0.1 ? '#442200' : '#222'));
            }

            if (cData.mode === 'hand') {
                disp.status.text('HAND');
                disp.status.fill('#ffcc00');
            } else if (cData.mode === 'auto') {
                disp.status.text('AUTO');
                disp.status.fill('#00ff44');
            } else {
                disp.status.text(cData.hold ? 'HOLD' : '----');
                disp.status.fill(cData.hold ? '#ffcc00' : '#555');
            }
        });

        Object.keys(this._statusLEDs).forEach(id => {
            const led = this._statusLEDs[id];
            led.dot.fill(this.ledStatus[id] ? led.color : '#222');
        });

        this._refreshCache();
    };

    // ──────────────────────────────────────────
    //  断电黑屏
    // ──────────────────────────────────────────
    proto._renderOff = function () {
        CH_CONFIG.forEach(ch => {
            const d = this._chDisplays[ch.id];
            d.val.text('');
            d.unit.text('');
            d.phys.text('');
            d.status.text('');
            d.bg.stroke('#333');
            this._chLEDs[ch.id].fill('#222');
            if (ch.type === 'PWM' && d.barFg) d.barFg.width(0);
        });
        Object.keys(this._statusLEDs).forEach(id => this._statusLEDs[id].dot.fill('#222'));
        Object.keys(this.channels).forEach(id => {
            this.channels[id].actual = 0;
            this.channels[id].instantOn = false;
        });
        this._refreshCache();
    };

    // ──────────────────────────────────────────
    //  拨码开关同步刷新
    // ──────────────────────────────────────────
    proto._refreshSwitches = function () {
        this._swObjs.forEach(sw => {
            const isOn = (this.nodeAddress & sw.bitVal) !== 0;
            sw.knob.y(isOn ? sw.y0 + 10 : sw.y0 + 22);
            sw.knob.fill(isOn ? '#ffcc00' : '#333');
        });
        this._addrDecText.text(String(this.nodeAddress));
    };
}
