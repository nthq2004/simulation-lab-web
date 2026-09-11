/**
 * AI.visuals.js — 模拟量输入模块：图形绘制 Mixin
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 本文件导出一个 applyVisualsMixin(proto) 函数，
 * 将所有绘图方法混入 AIModule 的原型，保持主类简洁。
 */

import { W, H, CH_CONFIG } from './AI.constants.js';

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
    //  模块主体外壳
    // ──────────────────────────────────────────
    proto._drawBody = function () {
        const sg = this.scaleGroup;

        // 左右侧板（安装导轨卡扣）
        const railAttr = { width: 18, height: H, fill: '#9e9e9e', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2 };
        sg.add(new Konva.Rect({ x: -18, y: 0, ...railAttr }));
        sg.add(new Konva.Rect({ x: W,   y: 0, ...railAttr }));

        // 主体面板
        sg.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: 0 },
            fillLinearGradientColorStops: [0, '#2c2c2c', 0.5, '#3a3a3a', 1, '#2c2c2c'],
            stroke: '#222', strokeWidth: 3, cornerRadius: 3,
        }));

        // 顶部装饰条
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#0055aa', cornerRadius: [3, 3, 0, 0] }));
    };

    // ──────────────────────────────────────────
    //  标题栏
    // ──────────────────────────────────────────
    proto._drawHeader = function () {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#0055aa', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'AI-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#00aaff' }));
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'ANALOG  INPUT  MODULE', fontSize: 7, fill: '#18b70a' }));

        // 节点地址显示（保存引用以便后续更新）
        this._nodeAddrDisplay = new Konva.Text({
            x: 140, y: 14,
            text: `NODE:${String(this.nodeAddress).padStart(2, '0')}`,
            fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00',
        });
        sg.add(this._nodeAddrDisplay);
    };

    // ──────────────────────────────────────────
    //  4个通道输入行
    // ──────────────────────────────────────────
    proto._drawChannelRows = function () {
        this._chDisplays = {};
        this._chLEDs = {};

        CH_CONFIG.forEach((ch, i) => {
            const y  = 44 + i * 52;
            const sg = this.scaleGroup;

            // 通道背景框
            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));

            // 通道标签 / 类型标签
            sg.add(new Konva.Text({ x: 8, y: y + 4,  text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#f00b0b' }));
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.type,  fontSize: 8,  fill: '#039540' }));

            // 数值显示区域背景
            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#1a4a1a', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);

            // 工程量数值
            const valText = new Konva.Text({
                x: 46, y: y + 8, width: 96,
                text: '----', fontSize: 18, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#00ff44', align: 'right',
            });
            // 单位
            const unitText = new Konva.Text({ x: 46, y: y + 30, width: 96, text: '', fontSize: 8, fill: '#faf4f4', align: 'right' });

            this._chDisplays[ch.id] = { val: valText, unit: unitText, bg: dispBg };
            sg.add(valText, unitText);

            // 通道运行指示灯
            const led      = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const ledLabel = new Konva.Text({ x: 170, y: y + 10, text: 'RUN', fontSize: 7, fill: '#f5eeee' });
            this._chLEDs[ch.id] = led;
            sg.add(led, ledLabel);

            // 报警状态文字
            const almText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            this._chDisplays[ch.id].alm = almText;
            sg.add(almText);

            // 原始信号值（小字）
            const rawText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#06f040' });
            this._chDisplays[ch.id].raw = rawText;
            sg.add(rawText);
        });
    };

    // ──────────────────────────────────────────
    //  模块状态指示灯区域 (PWR / RUN / ERR / COM)
    // ──────────────────────────────────────────
    proto._drawStatusLEDs = function () {
        const sg   = this.scaleGroup;
        const y    = 256;
        const defs = [
            { id: 'pwr', label: 'PWR', color: '#00ff00', x: 14  },
            { id: 'run', label: 'RUN', color: '#00ff00', x: 58  },
            { id: 'flt', label: 'ERR', color: '#ff3300', x: 102 },
            { id: 'com', label: 'COM', color: '#00aaff', x: 146 },
        ];

        sg.add(new Konva.Rect({ x: 4, y: y - 4, width: W - 8, height: 28, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#f4eded' }));

        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x + 10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f8f4f4', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    };

    // ──────────────────────────────────────────
    //  4位地址码拨码开关 SW1~SW4
    // ──────────────────────────────────────────
    proto._drawAddressSwitch = function () {
        const sg  = this.scaleGroup;
        const y   = 288;
        const swW = 18;
        const swH = 26;
        const gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f1ebeb' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0    = 14 + i * gap;
            const isOn  = (this.nodeAddress & bitVal) !== 0;

            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: swH, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl  = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#f4eeee', width: swW, align: 'center' });
            const vLbl = new Konva.Text({ x: x0, y: y + 12, text: bitVal.toString(), fontSize: 6, fill: '#444', width: swW, align: 'center' });

            const toggle = () => {
                const cur = (this.nodeAddress & bitVal) !== 0;
                if (cur) this.nodeAddress &= ~bitVal;
                else     this.nodeAddress |= bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            };
            swBg.on('click tap', toggle);
            vLbl.on('click tap', toggle);

            this._swObjs.push({ knob, bitVal });
            sg.add(swBg, knob, lbl, vLbl);
        }

        // 十进制地址显示
        this._addrDecText = new Konva.Text({
            x: 110, y: y + 10,
            text: String(this.nodeAddress),
            fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'left',
        });
        sg.add(this._addrDecText);
    };

    // ──────────────────────────────────────────
    //  终端电阻开关 (120Ω)
    // ──────────────────────────────────────────
    proto._drawTermSwitch = function () {
        const sg      = this.scaleGroup;
        const x0      = 160;
        const y0      = 288;

        sg.add(new Konva.Text({ x: x0 - 2, y: y0 - 6, text: '终端电阻', fontSize: 8, fill: '#dfd6d6' }));
        const termBg  = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl  = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#ebe5e5', width: 32, align: 'center' });

        termBg.on('click tap', () => {
            this.termEnabled       = !this.termEnabled;
            this.currentResistance = this.termEnabled ? 120 : 1000000;
            this._termKnob.y(this.termEnabled ? y0 + 10 : y0 + 22);
            this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
            this._refreshCache();
        });

        sg.add(termBg, this._termKnob, termLbl);
    };

    // ──────────────────────────────────────────
    //  底部面板（CAN / 电源接线端）
    // ──────────────────────────────────────────
    proto._drawBottomPanel = function () {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 0, y: H, width: W, height: 20, fill: '#9e9e9e', stroke: '#444', strokeWidth: 1.5 }));

        const labels = [
            { x: 25,  text: 'CAN1H' },
            { x: 70,  text: 'CAN1L' },
            { x: 115, text: 'CAN2H' },
            { x: 160, text: 'CAN2L' },
        ];
        labels.forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    };

    // ──────────────────────────────────────────
    //  接线端口标注（侧边）
    // ──────────────────────────────────────────
    proto._drawPortLabels = function () {
        const sg = this.scaleGroup;
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            sg.add(new Konva.Text({ x: -40, y: y - 4,  text: `${ch.label}+`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -40, y: y + 18, text: `${ch.label}-`, fontSize: 7, fill: '#0d05f2' }));
        });
        sg.add(new Konva.Text({ x: W + 2, y: 8,  text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 34, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
    };

    // ──────────────────────────────────────────
    //  拨码开关同步刷新
    // ──────────────────────────────────────────
    proto._refreshSwitches = function () {
        this._swObjs.forEach(sw => {
            sw.knob.y(((this.nodeAddress & sw.bitVal) !== 0) ? 298 : 310);
            sw.knob.fill(((this.nodeAddress & sw.bitVal) !== 0) ? '#ffcc00' : '#333');
        });
        this._addrDecText.text(String(this.nodeAddress));
    };

    // ──────────────────────────────────────────
    //  渲染更新（通道数值 + 状态灯）
    // ──────────────────────────────────────────
    proto._render = function () {
        CH_CONFIG.forEach(ch => {
            // 分别表示数据、量程、警报
            const cData  = this.channels[ch.id];
            const rng    = this.ranges[ch.id];
            const alm    = this.alarms[ch.id];

            const disp   = this._chDisplays[ch.id];
            const led    = this._chLEDs[ch.id];
            const rawUnit = { '4-20mA': 'mA', RTD: 'Ω', TC: 'mV' }[cData.type];

            if (cData.mode === 'disable') {
                disp.val.text(''); disp.unit.text(''); disp.raw.text(''); disp.alm.text('');
                disp.bg.stroke('#333');
                led.fill('#222');
                return;
            }

            if (cData.fault) {
                //有错、显示错误文本、单位不显示
                disp.val.text(`${cData.faultText}`);
                disp.val.fill('#ff3300');
                disp.unit.text('');
                disp.bg.stroke('#f9e103');
                //原始文本、PT100断路显示----， 断路时tc显示----
                if      (ch.id === 'ch3' && cData.raw > 1000) disp.raw.text(`---${rawUnit}`);
                else if (ch.id === 'ch4' && cData.raw < -1)   disp.raw.text(`---${rawUnit}`);
                else                                           disp.raw.text(`${cData.raw.toFixed(2)}${rawUnit}`);
                led.fill('#ff3300');
                // 报警文本也显示为故障
                disp.alm.text('FLT');
                disp.alm.fill('#ff3300');
            } else {
                const v        = cData.value;
                const almColor = { HH: '#ff3300', H: '#ff8800', LL: '#ff3300', L: '#ffcc00', normal: '#00ff44', FAULT: '#ff3300' };
                // 3,4通道温度显示1位小数。压力显示2位小数。
                disp.val.text(v.toFixed(ch.id === 'ch3' || ch.id === 'ch4' ? 1 : 2).padStart(7, ' '));
                disp.unit.text(rng.unit);
                disp.val.fill(almColor[alm.status] || '#00ff44');
                disp.bg.stroke(alm.status !== 'normal' ? '#f10e0e' : '#0ae80a');
                // 正常时报警文本显示----，否则显示HH。LL。H。L。
                disp.alm.text(alm.status === 'normal' ? '----' : alm.status);
                disp.alm.fill(almColor[alm.status] || '#555');
                // data数据体有 value和raw两个值
                disp.raw.text(`${cData.raw.toFixed(2)}${rawUnit}`);
                led.fill('#00ff44');
            }
        });

        // 更新模块状态灯 (PWR, RUN, FLT, COM)
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
            d.val.text(''); d.unit.text(''); d.raw.text(''); d.alm.text('');
            d.bg.stroke('#333');
            this._chLEDs[ch.id].fill('#222');
        });
        Object.keys(this._statusLEDs).forEach(id => {
            this._statusLEDs[id].dot.fill('#222');
        });
        this._refreshCache();
    };
}