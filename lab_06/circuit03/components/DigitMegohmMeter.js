import { BaseComponent } from './BaseComponent.js';

export class DigitMegohmMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 400);
        this.height = Math.max(200, config.height || 360);

        this.type    = 'digitmegohm';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:       this.label,
            testVoltage: this._testVoltage,
            resistance:  this._targetR,
            testing:     this._testing,
            rampTime:    this._rampTime,
        };

        this.addPort(this._portL.x, this._portL.y, 'l', 'wire', 'p');
        this.addPort(this._portE.x, this._portE.y, 'e', 'wire', 'n');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX = W * 0.55;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        const lW = this._divX;
        const cx = lW * 0.50;

        // ── 左侧垂直布局 ──
        const topPad = H * 0.025;
        // LCD
        const lcdW = lW * 0.92;
        const lcdH = H * 0.30;
        const lcdCy = topPad + lcdH / 2;
        this._lcd = { cx, cy: lcdCy, w: lcdW, h: lcdH };

        // 电压选择区（中间）
        const voltCy = H * 0.50;
        this._voltSel = { cx, cy: voltCy };

        // TEST/LOCK 按钮区（靠近底部）
        const btnCy = H * 0.80;
        this._testBtn = { cx: cx - lW * 0.15, cy: btnCy, r: Math.min(lW * 0.11, H * 0.055) };
        this._lockBtn = { cx: cx + lW * 0.15, cy: btnCy, r: Math.min(lW * 0.11, H * 0.055) };

        // 端子（底部）
        const termY = H * 0.99;
        const termSp = lW * 0.18;
        this._termL = { x: cx - termSp, y: termY };
        this._termE = { x: cx + termSp, y: termY };
        this._portL = { x: this._termL.x, y: H - 2 };
        this._portE = { x: this._termE.x, y: H - 2 };

        this._badge = { cx, cy: H * 0.01 };

        // ── 右侧：原理框图，均匀分布 ──
        const rLeft = this._divX + W * 0.025;
        const rW    = W - rLeft - W * 0.020;
        const rCx   = rLeft + rW * 0.50;

        const blockH = (H - H * 0.10) / 5.8;
        const gapPer = blockH * 0.30;
        const blockW = rW * 0.56;
        const startY = H * 0.04;

        let by = startY;
        const bwArr = [blockW, blockW * 0.90, blockW, blockW * 0.85, blockW * 0.80];
        const bhArr = [blockH, blockH * 0.85, blockH, blockH * 0.85, blockH * 0.85];
        this._dcdc     = { cx: rCx, cy: by + bhArr[0] / 2, w: bwArr[0], h: bhArr[0] }; by += bhArr[0] + gapPer;
        this._hvSwitch = { cx: rCx, cy: by + bhArr[1] / 2, w: bwArr[1], h: bhArr[1] }; by += bhArr[1] + gapPer;
        this._sample   = { cx: rCx, cy: by + bhArr[2] / 2, w: bwArr[2], h: bhArr[2] }; by += bhArr[2] + gapPer;
        this._adc      = { cx: rCx, cy: by + bhArr[3] / 2, w: bwArr[3], h: bhArr[3] }; by += bhArr[3] + gapPer;
        this._mcu      = { cx: rCx, cy: by + bhArr[4] / 2, w: bwArr[4], h: bhArr[4] };

        const rTermY = H * 0.96;
        this._rTermL = { x: rLeft + rW * 0.78, y: rTermY };
        this._rTermE = { x: rLeft + rW * 0.22, y: rTermY };
    }

    _initParameters(config) {
        this.label        = config.label    || '数字MΩ';
        this._testVoltage = config.testVoltage !== undefined ? parseFloat(config.testVoltage) : 500;
        this._rampTime    = config.rampTime !== undefined ? parseFloat(config.rampTime) : 0.5;

        const rCfg = config.resistance;
        if (rCfg === undefined || rCfg === null) {
            const stops = [5, 10, 20, 50, 100];
            this._targetR = stops[Math.floor(Math.random() * stops.length)];
        } else {
            this._targetR = (rCfg === 'Infinity') ? Infinity : parseFloat(rCfg);
        }
        this._currentR = this._targetR;

        this._testing     = !!config.testing;
        this._lockMode    = false;
        this._hvActive    = false;
        this._flashTimer  = 0;

        this._displayValue = '∞';
        this._displayUnit  = 'MΩ';
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        this._drawFrame();
        this._drawLCDPanel();
        this._drawVoltButtons();
        this._drawActionButtons();
        this._drawTerminals();
        this._drawDivider();
        this._drawPrincipleStatic();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f0ece4',
            stroke: '#c0b8a8', strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: f.w - 4, height: f.h * 0.06,
            fill: 'rgba(255,255,255,0.35)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    _drawDivider() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, f.y + 10, this._divX, f.y + f.h - 10],
            stroke: '#c0b8a8', strokeWidth: 1, dash: [5, 4],
        }));
    }

    _drawLCDPanel() {
        const { cx, cy, w, h } = this._lcd;
        const hw = w/2, hh = h/2;

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw - 5, y: cy - hh - 5,
            width: w + 10, height: h + 10,
            fill: '#d8d4c8', stroke: '#b0a898', strokeWidth: 2,
            cornerRadius: 4,
        }));

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh,
            width: w, height: h,
            fill: '#182818', stroke: '#203820', strokeWidth: 1,
            cornerRadius: 2,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx + hw - 60, y: cy + hh - 26,
            text: 'MΩ',
            fontSize: Math.max(14, h * 0.14), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#00ff00',
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - hw + 6, y: cy + hh - 22,
            text: '⏚',
            fontSize: Math.max(12, h * 0.12), fontFamily: 'Arial',
            fill: '#00cc00',
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - hw + 6, y: cy - hh + 4,
            text: '数字绝缘电阻测试仪',
            fontSize: 16, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#36e736',
        }));

        this._lockIndicator = new Konva.Text({
            x: cx + hw - 48, y: cy - hh + 6,
            text: '',
            fontSize: Math.max(10, h * 0.10), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#d08010',
            visible: false,
        });
        this._staticGroup.add(this._lockIndicator);
    }

    _drawVoltButtons() {
        const { cx, cy } = this._voltSel;
        const btnR = Math.max(16, this._divX * 0.055);
        const voltages = [250, 500, 1000];
        const fillColors = ['#c8d8c8', '#a8c8a8', '#88a888'];
        const selColors = ['#60b060', '#40a040', '#309030'];
        const spacing = btnR * 3.2;
        const textY = cy + btnR + 8;

        this._voltBtnCircles = [];
        this._voltBtnTexts = [];
        voltages.forEach((v, i) => {
            const x = cx + (i - 1) * spacing;
            const isSel = v === this._testVoltage;
            const circle = new Konva.Circle({
                x, y: cy, radius: btnR,
                fill: isSel ? selColors[i] : fillColors[i],
                stroke: isSel ? '#308030' : '#b0b8b0',
                strokeWidth: isSel ? 2.5 : 1.5,
            });
            this._staticGroup.add(circle);
            this._voltBtnCircles.push(circle);
            const numText = new Konva.Text({
                x: x - btnR, y: cy - btnR * 0.35,
                text: `${v}`,
                fontSize: Math.max(13, btnR * 0.55), fontFamily: 'Arial', fontStyle: 'bold',
                fill: isSel ? '#ffffff' : '#203820', width: btnR * 2, align: 'center',
            });
            this._staticGroup.add(numText);
            this._voltBtnTexts.push(numText);
            this._staticGroup.add(new Konva.Text({
                x: x - 1.5*btnR, y: textY,
                text: i === 0 ? '250V' : (i === 1 ? '500V' : '1000V'),
                fontSize: 14, fontFamily: 'Arial',
                fill: '#607060', width: btnR * 3, align: 'center',
            }));
        });

        this._staticGroup.add(new Konva.Text({
            x: cx - this._divX * 0.35, y: cy - btnR * 2.2,
            text: '测试电压选择',
            fontSize: 15, fontFamily: 'Arial',
            fill: '#486048', width: this._divX * 0.70, align: 'center',
        }));
    }

    _drawActionButtons() {
        const { cx, cy, r } = this._testBtn;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 4,
            fill: '#d0ccc0', stroke: '#b0a898', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#d04030', stroke: '#b03020', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - r, y: cy - r * 0.35,
            text: 'TEST',
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ffffff', width: r * 2, align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 1.5, y: cy - r * 2.2,
            text: '测试',
            fontSize: 14, fontFamily: 'Arial',
            fill: '#b04030', width: r * 3, align: 'center',
        }));

        const { cx: lcx, cy: lcy, r: lr } = this._lockBtn;
        this._staticGroup.add(new Konva.Circle({
            x: lcx, y: lcy, radius: lr + 3,
            fill: '#d0ccc0', stroke: '#b0a898', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: lcx, y: lcy, radius: lr,
            fill: '#5898c8', stroke: '#4080b0', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: lcx - lr, y: lcy - lr * 0.3,
            text: 'LOCK',
            fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ffffff', width: lr * 2, align: 'center',
        }));
    }

    _drawTerminals() {
        const tR = Math.max(6, this._divX * 0.022);
        const termDefs = [
            { pos: this._termE, label: 'E', color: '#30a030' },
            { pos: this._termL, label: 'L', color: '#c83020' },
        ];
        termDefs.forEach(td => {
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR + 6,
                fill: '#d8d4c8', stroke: '#b0a898', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR,
                fillLinearGradientStartPoint: { x: -tR, y: -tR },
                fillLinearGradientEndPoint:   { x:  tR, y:  tR },
                fillLinearGradientColorStops: [0, '#d8c060', 0.5, '#e8d890', 1, '#c0a850'],
                stroke: '#a09040', strokeWidth: 2,
            }));
            this._staticGroup.add(new Konva.Text({
                x: td.pos.x - tR * 1.5, y: td.pos.y + tR + 10,
                text: td.label,
                fontSize: Math.max(16, tR * 0.85), fontFamily: 'Arial', fontStyle: 'bold',
                fill: td.color, width: tR * 3, align: 'center',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [td.pos.x, td.pos.y + tR, td.pos.x, this.height - 2],
                stroke: td.color, strokeWidth: 1.5 + (td.label === 'E' ? 0.5 : 0),
            }));
        });
    }

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;

        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#f8f6f0',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._drawBlock('DC-DC\n升压变换器', this._dcdc, '#e0ece0', '#70a070');
        this._drawBlock('高压开关\n& 采样电路', this._hvSwitch, '#dce4ec', '#7090b0');
        this._drawBlock('I/V 变换\n& 滤波', this._sample, '#e0e0ec', '#8090b0');
        this._drawBlock('ADC\n模数转换', this._adc, '#e0dcec', '#9080b0');
        this._drawBlock('MCU\nLCD 驱动', this._mcu, '#e8dce8', '#a080a0');

        const blocks = [this._dcdc, this._hvSwitch, this._sample, this._adc, this._mcu];
        for (let i = 0; i < blocks.length - 1; i++) {
            const from = blocks[i];
            const to   = blocks[i + 1];
            const y1 = from.cy + from.h / 2;
            const y2 = to.cy - to.h / 2;
            this._staticGroup.add(new Konva.Line({
                points: [from.cx, y1, from.cx, y1 + (y2 - y1) * 0.45, to.cx, y1 + (y2 - y1) * 0.55, to.cx, y2],
                stroke: '#909890', strokeWidth: 1.2, listening: false,
            }));
        }


   }

    _drawBlock(text, rect, fill, stroke) {
        const { cx, cy, w, h } = rect;
        const hw = w/2, hh = h/2;
        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill, stroke, strokeWidth: 0.8, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - hw, y: cy - hh + 4,
            text,
            fontSize: 15, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#384838', width: w, align: 'center', lineHeight: 1.2,
        }));
    }

    _createDynamicNodes() {
        this._createLCDDynamic();
        this._createTestButtonDynamic();
        this._createHVIndicator();
    }

    _createLCDDynamic() {
        const { cx, cy, w, h } = this._lcd;
        const hw = w/2, hh = h/2;
        const fs = Math.max(32, h * 0.50);

        this._lcdValue = new Konva.Text({
            x: cx - hw + 8, y: cy - hh + 2,
            text: '∞',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00',
            width: w - 16, height: h - 12,
            align: 'right', verticalAlign: 'middle',
        });
        this._dynamicGroup.add(this._lcdValue);

        this._lcdDecimal = new Konva.Text({
            x: cx - hw + 8, y: cy + hh - 22,
            text: '',
            fontSize: Math.max(10, h * 0.12), fontFamily: 'Arial',
            fill: '#00cc00',
            width: w - 16, align: 'right',
        });
        this._dynamicGroup.add(this._lcdDecimal);
    }

    _createTestButtonDynamic() {
        const { cx, cy, r } = this._testBtn;
        this._testBtnState = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#d04030', stroke: '#b03020', strokeWidth: 2,
        });
        this._dynamicGroup.add(this._testBtnState);
    }

    _createHVIndicator() {
        const hx = (this._termL.x + this._termE.x) / 2;

        this._hvIndicator = new Konva.Text({
            x: hx - 60, y: this._termL.y - 36,
            text: '',
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#d03010', width: 120, align: 'center',
        });
        this._dynamicGroup.add(this._hvIndicator);
    }

    _bindInteraction() {
        const { cx, cy, r } = this._testBtn;
        const testHit = new Konva.Circle({
            x: cx, y: cy, radius: r + 6, fill: 'transparent',
        });
        testHit.on('click tap', () => {
            this._testing = !this._testing;
            if (!this._testing) this._hvActive = false;
        });
        testHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        testHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(testHit);

        const { cx: lcx, cy: lcy, r: lr } = this._lockBtn;
        const lockHit = new Konva.Circle({
            x: lcx, y: lcy, radius: lr + 5, fill: 'transparent',
        });
        lockHit.on('click tap', () => {
            this._lockMode = !this._lockMode;
        });
        lockHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        lockHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(lockHit);

        const voltR = Math.max(12, this._divX * 0.035);
        const { cx: vcx, cy: vcy } = this._voltSel;
        const voltages = [250, 500, 1000];
        voltages.forEach((v, i) => {
            const x = vcx + (i - 1) * (voltR * 3.2);
            const voltHit = new Konva.Circle({
                x, y: vcy, radius: voltR + 4, fill: 'transparent',
            });
            voltHit.on('click tap', () => {
                if (this._testing) return;
                this._testVoltage = v;
                this._updateVoltageDisplay();
            });
            voltHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            voltHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(voltHit);
        });
    }

    _updateVoltageDisplay() {
        if (!this._voltBtnCircles) return;
        const voltages = [250, 500, 1000];
        const fillColors = ['#c8d8c8', '#a8c8a8', '#88a888'];
        const selColors = ['#60b060', '#40a040', '#309030'];
        voltages.forEach((v, i) => {
            const isSel = v === this._testVoltage;
            this._voltBtnCircles[i].fill(isSel ? selColors[i] : fillColors[i]);
            this._voltBtnCircles[i].stroke(isSel ? '#308030' : '#b0b8b0');
            this._voltBtnCircles[i].strokeWidth(isSel ? 2.5 : 1.5);
            if (this._voltBtnTexts[i]) {
                this._voltBtnTexts[i].fill(isSel ? '#ffffff' : '#203820');
            }
        });
    }

    _updateDynamic(dt) {
        const v = this._currentR;

        this._testBtnState.fill(this._testing ? '#40a030' : '#d04030');
        this._testBtnState.stroke(this._testing ? '#308020' : '#b03020');

        this._hvIndicator.text(this._testing && this._hvActive ? '⚡ 高压 ⚡' : '');
        this._hvIndicator.visible(this._testing && this._hvActive);

        this._lockIndicator.text(this._lockMode ? 'LOCK' : '');
        this._lockIndicator.visible(this._lockMode);

        if (!this._testing) {
            this._lcdValue.text('—');
            this._lcdValue.fill('#006600');
        } else if (!isFinite(v) || v >= 900) {
            this._lcdValue.text('∞');
            this._lcdValue.fill('#00ff00');
        } else {
            const display = v >= 10000
                ? (v / 1000).toFixed(1) + 'G'
                : v >= 100
                    ? v.toFixed(0)
                    : v >= 10
                        ? v.toFixed(1)
                        : v.toFixed(2);
            this._lcdValue.text(display);
            this._lcdValue.fill('#00ff00');
        }
    }

    tick(dt) {
        if (this._testing) {
            this._flashTimer += dt;

            if (this._flashTimer > 0.3) {
                this._hvActive = true;
            }

            try {
                const rOhm = this.sys.voltageSolver._getEquivalentResistanceFromPorts(this.id, 'l', 'e');
                this._targetR = (isFinite(rOhm) && rOhm >= 0) ? rOhm / 1e6 : Infinity;
            } catch (_) {
                this._targetR = Infinity;
            }
        } else {
            this._hvActive = false;
            this._flashTimer = 0;
            if (!this._lockMode) {
                this._targetR = Infinity;
            }
        }

        const tau   = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        if (isFinite(this._targetR) && isFinite(this._currentR)) {
            this._currentR += (this._targetR - this._currentR) * alpha;
        } else if (!isFinite(this._targetR)) {
            this._currentR = isFinite(this._currentR)
                ? this._currentR + (50000 - this._currentR) * alpha
                : Infinity;
            if (this._currentR > 9000) this._currentR = Infinity;
        } else {
            this._currentR = this._targetR;
        }

        this._updateDynamic(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    setResistance(r) {
        if (r === Infinity || r === 'Infinity' || r === null) {
            this._targetR = Infinity;
        } else {
            this._targetR = Math.max(0, parseFloat(r) || 0);
        }
    }

    setTesting(on) {
        this._testing = !!on;
        if (!on) this._hvActive = false;
    }

    isTesting()     { return this._testing; }
    getResistance() { return this._currentR; }

    getDisplayedValue() {
        if (!this._testing) return null;
        return this._currentR;
    }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.resistance  !== undefined) this.setResistance(state.resistance);
            if (state.testing     !== undefined) this.setTesting(state.testing);
            if (state.testVoltage !== undefined) this._testVoltage = parseFloat(state.testVoltage) || 500;
        } else {
            this.setResistance(state);
        }
    }

    getConfigFields() {
        return [
            { label: '仪表标识',                    key: 'label',       type: 'text'   },
            { label: '测试电压 V（250/500/1000）', key: 'testVoltage', type: 'number' },
            { label: '被测电阻 MΩ（Infinity=∞）',   key: 'resistance',  type: 'text'   },
            { label: '测试中（true/false）',         key: 'testing',     type: 'text'   },
            { label: '响应时间常数 s',              key: 'rampTime',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label        = cfg.label;
        if (cfg.testVoltage !== undefined) this._testVoltage = parseFloat(cfg.testVoltage) || 500;
        if (cfg.rampTime    !== undefined) this._rampTime    = parseFloat(cfg.rampTime) || 0.5;
        if (cfg.resistance  !== undefined) this.setResistance(cfg.resistance);
        if (cfg.testing     !== undefined) this.setTesting(cfg.testing === 'true' || cfg.testing === true);

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
