/**
 * DI.visuals.js — 数字量输入模块：图形绘制 Mixin
 *
 * 本文件导出一个 applyVisualsMixin(proto) 函数，
 * 将所有绘图方法混入 DIModule 的原型。
 */

import { W, H, CH_CONFIG } from './DI.constants.js';

export function applyVisualsMixin(proto) {

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
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#007733', cornerRadius: [3, 3, 0, 0] }));
    };

    proto._drawHeader = function () {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#007733', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'DI-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#00cc55' }));
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'DIGITAL  INPUT  MODULE', fontSize: 7, fill: '#1c8257' }));
        this._nodeAddrDisplay = new Konva.Text({
            x: 128, y: 14, text: `NODE:${String(this.nodeAddress).padStart(2, '0')}`,
            fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00',
        });
        sg.add(this._nodeAddrDisplay);
    };

    proto._drawChannelRows = function () {
        this._chDisplays = {};
        this._chLEDs = {};

        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52;
            const sg = this.scaleGroup;

            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
            sg.add(new Konva.Text({ x: 8, y: y + 4, text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#ef1313' }));
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.desc, fontSize: 7, fill: '#555' }));

            const typeColor = ch.type === 'DRY' ? '#1a3a1a' : '#1a2a3a';
            const typeFg = ch.type === 'DRY' ? '#00cc55' : '#00aaff';
            sg.add(new Konva.Rect({ x: 8, y: y + 28, width: 28, height: 12, fill: typeColor, stroke: typeFg, strokeWidth: 0.5, cornerRadius: 1 }));
            sg.add(new Konva.Text({ x: 8, y: y + 29, text: ch.type, fontSize: 7, fill: typeFg, width: 28, align: 'center' }));

            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#1a3a1a', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);

            const stateText = new Konva.Text({
                x: 46, y: y + 10, width: 96, text: '---',
                fontSize: 20, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#333', align: 'center',
            });
            sg.add(stateText);

            const voltText = new Konva.Text({ x: 46, y: y + 32, width: 96, text: '', fontSize: 7, fill: '#444', align: 'center' });
            sg.add(voltText);

            const led = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            sg.add(led);
            sg.add(new Konva.Text({ x: 170, y: y + 10, text: 'STA', fontSize: 7, fill: '#f4eded' }));

            const almText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            sg.add(almText);

            const cntText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#444' });
            sg.add(cntText);

            this._chDisplays[ch.id] = { bg: dispBg, state: stateText, volt: voltText, alm: almText, cnt: cntText };
            this._chLEDs[ch.id] = led;
        });
    };

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
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#f5eeee' }));
        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x + 10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f2ecec', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    };

    proto._drawAddressSwitch = function () {
        const sg = this.scaleGroup;
        const y = 288, swW = 18, gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f4ecec' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0 = 14 + i * gap;
            const isOn = (this.nodeAddress & bitVal) !== 0;
            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#fcf8f8', width: swW, align: 'center' });
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
        this._addrDecText = new Konva.Text({ x: 106, y: y + 10, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'left' });
        sg.add(this._addrDecText);
    };

    proto._drawTermSwitch = function () {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;
        sg.add(new Konva.Text({ x: x0 - 2, y: y0 - 6, text: '终端电阻', fontSize: 8, fill: '#f4efef' }));
        const termBg = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#f5f2f2', width: 32, align: 'center' });
        termBg.on('click tap', () => {
            this.termEnabled = !this.termEnabled;
            this.currentResistance = this.termEnabled ? 120 : 1000000;
            this._termKnob.y(this.termEnabled ? y0 + 10 : y0 + 22);
            this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
            this._refreshCache();
        });
        sg.add(termBg, this._termKnob, termLbl);
    };

    proto._drawBottomPanel = function () {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 0, y: H, width: W, height: 20, fill: '#9e9e9e', stroke: '#444', strokeWidth: 1.5 }));
        [{ x: 25, text: 'CAN1H' }, { x: 70, text: 'CAN1L' }, { x: 115, text: 'CAN2H' }, { x: 160, text: 'CAN2L' }]
            .forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    };

    proto._drawPortLabels = function () {
        const sg = this.scaleGroup;
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            const labels = ch.type === 'DRY' ? ['IN', 'COM'] : ['24V+', 'COM'];
            sg.add(new Konva.Text({ x: -44, y, text: `${ch.label} ${labels[0]}`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -44, y: y + 14, text: `${ch.label} ${labels[1]}`, fontSize: 7, fill: '#0d05f2' }));
        });
        sg.add(new Konva.Text({ x: W + 2, y: 10, text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 38, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
    };

    proto._render = function () {
        CH_CONFIG.forEach(ch => {
            const cData = this.channels[ch.id];
            const disp = this._chDisplays[ch.id];
            const led = this._chLEDs[ch.id];
            const alm = this.alarmConfig[ch.id];

            if (cData.fault) {
                disp.state.text('ERR');
                disp.state.fill('#ff3300');
                disp.bg.stroke('#550000');
                disp.alm.text('FLT');
                disp.alm.fill('#ff3300');
                led.fill('#ff3300');
                disp.volt.text(ch.type === 'WET' ? `${cData.voltage.toFixed(1)}V ?` : '');
                disp.cnt.text(`CNT:${cData.counter}`);
                return;
            }

            const on = cData.state;
            disp.state.text(on ? ' ON ' : 'OFF ');
            disp.state.fill(on ? '#00ff44' : '#555');
            disp.bg.stroke(on ? '#1a4a1a' : '#1a1a1a');
            led.fill(on ? '#00ff44' : '#222');
            disp.volt.text(ch.type === 'WET' ? `${(cData.voltage || 0).toFixed(1)}V` : '');
            const isAlarm = (alm.trigger === 'ON' && on) || (alm.trigger === 'OFF' && !on);
            disp.alm.text(isAlarm ? 'ALM' : '----');
            disp.alm.fill(isAlarm ? '#ff8800' : '#555');
            disp.cnt.text(`CNT:${cData.counter}`);
        });

        Object.keys(this._statusLEDs).forEach(id => {
            this._statusLEDs[id].dot.fill(this.ledStatus[id] ? this._statusLEDs[id].color : '#222');
        });
        this._refreshCache();
    };

    proto._renderOff = function () {
        CH_CONFIG.forEach(ch => {
            const d = this._chDisplays[ch.id];
            d.state.text(''); d.volt.text(''); d.alm.text(''); d.cnt.text('');
            d.bg.stroke('#333');
            this._chLEDs[ch.id].fill('#222');
        });
        Object.keys(this._statusLEDs).forEach(id => this._statusLEDs[id].dot.fill('#222'));
        this._refreshCache();
    };

    proto._refreshSwitches = function () {
        this._swObjs.forEach(sw => {
            const isOn = (this.nodeAddress & sw.bitVal) !== 0;
            sw.knob.y(isOn ? sw.y0 + 10 : sw.y0 + 22);
            sw.knob.fill(isOn ? '#ffcc00' : '#333');
        });
        this._addrDecText.text(String(this.nodeAddress));
    };
}
