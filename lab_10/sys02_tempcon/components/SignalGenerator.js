import { BaseComponent } from './BaseComponent.js';

/**
 * SignalGenerator — 双通道函数/任意波形信号发生器（参考 RIGOL DG4162）
 *
 * 通道功能：Sine / Square / Ramp / Pulse / Noise / DC；频率、幅度、偏置、相位可按档位调节。
 * 端口：CH1 输出（左）/ CH2 输出（右）。
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * 静态→`_staticGroup`，动态→`_dynamicGroup`，交互按钮→`_interactGroup`，in-place 更新。
 */
export class SignalGenerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'signal_generator';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            ch1Frequency: this.channels[0].frequency,
            ch2Frequency: this.channels[1].frequency,
        };

        // 端口：CH1+/CH1-  CH2+/CH2-
        this.addPort(-160, 100, 'ch1p', 'wire', 'p');
        this.addPort(-100, 100, 'ch1n', 'wire');
        this.addPort(100, 100, 'ch2p', 'wire', 'p');
        this.addPort(160, 100, 'ch2n', 'wire');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this._knobCx = 155;
        this._knobCy = -110;
    }

    _initParameters(_config) {
        this._C = {
            body: '#474948', bodyAccent: '#253545', screen: '#040404',
            screenBorder: '#1abc9c', gridLine: '#1abc9c',
            ch1Color: '#fce80b', ch2Color: '#0ff80b',
            btnNormal: '#34495e', btnActive: '#1abc9c', btnWave: '#2980b9',
            btnDanger: '#c0392b', text: '#ecf0f1', textDim: '#c3caca',
            label: '#0cc081', knob: '#2c3e50', knobRim: '#1abc9c',
        };

        this.channels = [
            { name: 'CH1', enabled: true, waveform: 'Sine', frequency: 1000, amplitude: 1.0, offset: 0.0, phase: 0, dutyCycle: 50, harmonic: 1 },
            { name: 'CH2', enabled: true, waveform: 'Sine', frequency: 1000, amplitude: 1.0, offset: 0.0, phase: 0, dutyCycle: 50, harmonic: 1 },
        ];

        this.selectedCh = 0;
        this.selectedParam = 'frequency';

        this.freqSteps = [0.1, 1, 10, 100, 1000, 10000];
        this.freqStepIdx = 1;
        this.ampSteps = [0.001, 0.01, 0.1, 1.0, 10];
        this.ampStepIdx = 2;
        this.offSteps = [0.01, 0.1, 1.0, 10];
        this.offStepIdx = 1;

        this.waveforms = ['Sine', 'Square', 'Ramp', 'Pulse', 'Noise', 'DC'];
        this.knobAngle = 0;

        this._btnDefs = [];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshDisplay();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const C = this._C;

        const body = new Konva.Rect({
            x: -240, y: -170, width: 480, height: 290,
            fill: C.body, cornerRadius: 12, stroke: '#111', strokeWidth: 2,
        });
        const bodyTop = new Konva.Rect({
            x: -240, y: -170, width: 480, height: 20,
            fill: C.bodyAccent, cornerRadius: [12, 12, 0, 0],
        });
        const brandText = new Konva.Text({
            x: -230, y: -165, text: '         双路信号发生器', fontFamily: 'monospace',
            fontSize: 14, fontStyle: 'bold', fill: C.ch2Color,
        });
        const modelText = new Konva.Text({
            x: 100, y: -165, text: '    江苏航院', fontFamily: 'monospace',
            fontSize: 14, fill: C.text,
        });
        const screen = new Konva.Rect({
            x: -230, y: -145, width: 300, height: 180,
            fill: C.screen, stroke: C.screenBorder, strokeWidth: 2, cornerRadius: 4,
        });
        const divider = new Konva.Line({
            points: [-80, -145, -80, 15], stroke: C.gridLine,
            strokeWidth: 2, dash: [4, 4], opacity: 0.5,
        });

        // 大旋钮（静态外观）
        this._knobOuter = new Konva.Circle({ x: this._knobCx, y: this._knobCy, radius: 32, fill: C.knob, stroke: C.knobRim, strokeWidth: 3 });
        this._knobInner = new Konva.Circle({ x: this._knobCx, y: this._knobCy, radius: 24, fill: '#1a252f' });
        const knobLabel = new Konva.Text({ x: 135, y: -70, text: '调节旋钮', fontFamily: 'monospace', fontSize: 12, fill: C.textDim });

        this._staticGroup.add(body, bodyTop, brandText, modelText, screen, divider, this._knobOuter, this._knobInner, knobLabel);

        // BNC 插座
        const portLabels = [
            { x: -175, y: 78, color: C.ch1Color }, { x: -115, y: 78, color: C.ch1Color },
            { x: 85, y: 78, color: C.ch2Color }, { x: 145, y: 78, color: C.ch2Color },
        ];
        portLabels.forEach(pl => {
            this._staticGroup.add(new Konva.Circle({ x: pl.x + 15, y: 100, radius: 10, fill: '#1a252f', stroke: '#555', strokeWidth: 2 }));
            this._staticGroup.add(new Konva.Circle({ x: pl.x + 15, y: 100, radius: 4, fill: '#333' }));
        });

        // 可识别部件
        this.addClickablePart('screen', -230, -145, 300, 180);
        this.addClickablePart('knob', this._knobCx - 32, this._knobCy - 32, 64, 64);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const C = this._C;

        this.ch1Label = new Konva.Text({ x: -188, y: -142, text: 'CH1  50Ω', fontFamily: 'monospace', fontSize: 12, fontStyle: 'bold', fill: C.ch1Color });
        this.ch2Label = new Konva.Text({ x: -28, y: -142, text: 'CH2  HiZ', fontFamily: 'monospace', fontSize: 12, fontStyle: 'bold', fill: C.ch2Color });

        this.ch1InfoGroup = new Konva.Group({ x: -228, y: -128 });
        this.ch2InfoGroup = new Konva.Group({ x: -78, y: -128 });

        this.wavePreviewCh1 = new Konva.Line({ stroke: C.ch1Color, strokeWidth: 2, lineJoin: 'round' });
        this.wavePreviewCh2 = new Konva.Line({ stroke: C.ch2Color, strokeWidth: 2, lineJoin: 'round' });

        this.knobMark = new Konva.Line({ points: [this._knobCx, this._knobCy, this._knobCx, this._knobCy - 24], stroke: C.knobRim, strokeWidth: 3 });

        this._dynamicGroup.add(
            this.ch1Label, this.ch2Label, this.knobMark,
            this.ch1InfoGroup, this.ch2InfoGroup,
            this.wavePreviewCh1, this.wavePreviewCh2,
        );

        this._buildButtons();

        this._stepDisplayBg = new Konva.Rect({
            x: 193, y: -68, width: 44, height: 20,
            fill: '#0a1810', stroke: C.screenBorder, strokeWidth: 1, cornerRadius: 3,
        });
        this._stepDisplayText = new Konva.Text({
            x: 193, y: -65, text: this._fmtStep(),
            fontSize: 11, fontFamily: 'monospace', fill: C.label, width: 44, align: 'center',
        });
        this._dynamicGroup.add(this._stepDisplayBg, this._stepDisplayText);
    }

    _buildButtons() {
        const C = this._C;
        const waveIcons = { Sine: '∿', Square: '⊓', Ramp: '⋀', Pulse: '⊓̈', Noise: '≈', DC: '─' };
        this.waveforms.forEach((wf, i) => {
            this._makeBtn(95, -130 + i * 28, waveIcons[wf] || wf, C.btnWave, () => {
                this.channels[this.selectedCh].waveform = wf;
                this._refreshDisplay();
            }, wf);
        });

        this.outBtns = [];
        this.outBtns.push(this._makeBtn(-130, 78, 'CH1 OUT', C.btnNormal, () => {
            this.channels[0].enabled = !this.channels[0].enabled;
            this._refreshDisplay();
        }));
        this.outBtns.push(this._makeBtn(130, 78, 'CH2 OUT', C.btnNormal, () => {
            this.channels[1].enabled = !this.channels[1].enabled;
            this._refreshDisplay();
        }));

        const params = [
            { label: '频率', key: 'frequency' }, { label: '幅度', key: 'amplitude' },
            { label: '偏置', key: 'offset' }, { label: '相位', key: 'phase' },
            { label: '占空比', key: 'dutyCycle' }, { label: '谐波', key: 'harmonic' },
        ];
        params.forEach((p, i) => {
            this._makeBtn(-205 + i * 50, 50, p.label, C.btnNormal, () => {
                this.selectedParam = p.key;
                this._refreshDisplay();
            });
        });

        this._makeBtn(155, -30, 'CH1', C.btnNormal, () => { this.selectedCh = 0; this._refreshDisplay(); });
        this._makeBtn(155, 10, 'CH2', C.btnNormal, () => { this.selectedCh = 1; this._refreshDisplay(); });

        this._makeBtn(215, -130, '步进↑', C.btnNormal, () => this._bumpStep(1));
        this._makeBtn(215, -95, '步进↓', C.btnNormal, () => this._bumpStep(-1));

        this._makeBtn(210, -10, '复位', C.btnDanger, () => {
            const ch = this.channels[this.selectedCh];
            ch.frequency = 1000; ch.amplitude = 1.0; ch.offset = 0;
            ch.phase = 0; ch.dutyCycle = 50; ch.harmonic = 1;
            ch.waveform = 'Sine';
            this.selectedCh = 0;
            this.selectedParam = 'frequency';
            this.freqStepIdx = 1;
            this.ampStepIdx = 2;
            this.offStepIdx = 1;
            this._refreshDisplay();
        });
    }

    _bumpStep(dir) {
        if (this.selectedParam === 'frequency') {
            this.freqStepIdx = Math.max(0, Math.min(this.freqSteps.length - 1, this.freqStepIdx + dir));
        } else if (this.selectedParam === 'amplitude') {
            this.ampStepIdx = Math.max(0, Math.min(this.ampSteps.length - 1, this.ampStepIdx + dir));
        } else if (this.selectedParam === 'offset') {
            this.offStepIdx = Math.max(0, Math.min(this.offSteps.length - 1, this.offStepIdx + dir));
        }
        this._refreshDisplay();
    }

    _makeBtn(x, y, label, color, onClick, tooltip) {
        const g = new Konva.Group({ x, y });
        const bg = new Konva.Rect({ x: -22, y: -10, width: 44, height: 22, fill: color, cornerRadius: 4, stroke: '#0a1a17', strokeWidth: 1 });
        const txt = new Konva.Text({ x: -22, y: -6, text: label, fontSize: 12, fill: '#ecf0f1', width: 44, align: 'center', fontFamily: 'monospace' });
        g.add(bg, txt);
        this._interactGroup.add(g);
        this._btnDefs.push({ group: g, bg, txt, color, onClick, tooltip });
        return { group: g, bg, txt };
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const handleKnob = () => {
            const pos = this.group.getRelativePointerPosition();
            const direction = pos.y < this._knobCy ? 1 : -1;
            this._onKnobClick(direction);
        };
        this._knobOuter.on('mousedown', handleKnob);
        this._knobInner.on('mousedown', handleKnob);
        this._knobOuter.on('dblclick', (e) => e.cancelBubble = true);
        this._knobInner.on('dblclick', (e) => e.cancelBubble = true);

        this._btnDefs.forEach(d => {
            d.group.on('mousedown', () => {
                d.bg.fill('#1abc9c');
                setTimeout(() => { d.bg.fill(d.color); }, 120);
                d.onClick();
            });
            d.group.on('dblclick', (e) => e.cancelBubble = true);
        });
    }

    // ═══════════════════════════════════════════════════════
    // 旋钮调节
    // ═══════════════════════════════════════════════════════

    _onKnobClick(dir) {
        const ch = this.channels[this.selectedCh];
        const step = this.freqSteps[this.freqStepIdx];
        switch (this.selectedParam) {
            case 'frequency': ch.frequency = Math.max(0.001, ch.frequency + dir * step); break;
            case 'amplitude': ch.amplitude = Math.max(0.001, +(ch.amplitude + dir * this.ampSteps[this.ampStepIdx]).toFixed(4)); break;
            case 'offset': ch.offset = +(ch.offset + dir * this.offSteps[this.offStepIdx]).toFixed(4); break;
            case 'phase': ch.phase = ((ch.phase + dir * 10) + 360) % 360; break;
            case 'dutyCycle': ch.dutyCycle = Math.min(99, Math.max(1, ch.dutyCycle + dir)); break;
            case 'harmonic': ch.harmonic = Math.max(1, ch.harmonic + dir); break;
        }
        this.knobAngle += dir * 3.6;
        this.knobMark.points([
            this._knobCx, this._knobCy,
            this._knobCx + 24 * Math.sin(this.knobAngle * Math.PI / 180),
            this._knobCy - 24 * Math.cos(this.knobAngle * Math.PI / 180),
        ]);
        this._refreshDisplay();
    }

    _fmtStep() {
        if (this.selectedParam === 'frequency') {
            const step = this.freqSteps[this.freqStepIdx];
            if (step >= 1000) return (step / 1000) + 'kHz';
            if (step < 1) return (step * 1000).toFixed(0) + 'mHz';
            return step + 'Hz';
        } else if (this.selectedParam === 'amplitude') {
            const step = this.ampSteps[this.ampStepIdx];
            if (step < 0.1) return (step * 1000) + 'mv';
            return step + 'V';
        } else if (this.selectedParam === 'offset') {
            const step = this.offSteps[this.offStepIdx];
            if (step < 0.1) return (step * 1000) + 'mv';
            return step + 'V';
        }
        return '';
    }

    // ═══════════════════════════════════════════════════════
    // 屏幕刷新
    // ═══════════════════════════════════════════════════════

    _refreshDisplay() {
        this._updateChannelInfo(0);
        this._updateChannelInfo(1);
        this._drawPreviewWave(0);
        this._drawPreviewWave(1);
        if (this._stepDisplayText) this._stepDisplayText.text(this._fmtStep());
        if (this.outBtns) {
            this.outBtns.forEach((btn, idx) => {
                const isEnabled = this.channels[idx].enabled;
                btn.bg.fill(isEnabled ? this._C.btnActive : this._C.btnNormal);
            });
        }
        this.ch1Label.fontStyle(this.selectedCh === 0 ? 'bold' : 'normal');
        this.ch1Label.text(this.channels[0].enabled ? 'CH1  50Ω' : 'CH1  HiZ');
        this.ch2Label.fontStyle(this.selectedCh === 1 ? 'bold' : 'normal');
        this.ch2Label.text(this.channels[1].enabled ? 'CH2  50Ω' : 'CH2  HiZ');

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _updateChannelInfo(chIdx) {
        const ch = this.channels[chIdx];
        const g = chIdx === 0 ? this.ch1InfoGroup : this.ch2InfoGroup;
        const color = chIdx === 0 ? this._C.ch1Color : this._C.ch2Color;
        const highlight = this.selectedCh === chIdx ? color : this._C.textDim;
        const sel = this.selectedParam;

        g.destroyChildren();

        const lines = [
            { label: '波形', value: ch.waveform, key: 'waveform' },
            { label: '频率', value: this._fmtFreq(ch.frequency), key: 'frequency' },
            { label: '幅度', value: ch.amplitude.toFixed(2) + ' Vpp', key: 'amplitude' },
            { label: '偏置', value: ch.offset.toFixed(2) + ' Vdc', key: 'offset' },
            { label: '相位', value: ch.phase.toFixed(1) + '°', key: 'phase' },
            { label: '占空', value: ch.dutyCycle.toFixed(0) + '%', key: 'dutyCycle' },
            { label: '谐波', value: ch.harmonic + '次', key: 'harmonic' },
        ];

        lines.forEach((l, i) => {
            const isSelected = this.selectedCh === chIdx && sel === l.key;
            g.add(new Konva.Text({
                x: 10, y: i * 14, text: `${l.label}: ${l.value}`,
                fontSize: 12, fontFamily: 'monospace',
                fill: isSelected ? '#fff' : highlight,
                fontStyle: isSelected ? 'bold' : 'normal',
            }));
        });

        g.add(new Konva.Text({
            x: 10, y: lines.length * 14 + 2, text: ch.enabled ? '▶ ON' : '■ OFF',
            fontSize: 12, fontFamily: 'monospace', fill: ch.enabled ? '#2ecc71' : '#e74c3c',
        }));
    }

    _fmtFreq(hz) {
        if (hz >= 1e6) return (hz / 1e6).toFixed(6) + ' MHz';
        if (hz >= 1e3) return (hz / 1e3).toFixed(3) + ' kHz';
        return hz.toFixed(3) + ' Hz';
    }

    _drawPreviewWave(chIdx) {
        const ch = this.channels[chIdx];
        const line = chIdx === 0 ? this.wavePreviewCh1 : this.wavePreviewCh2;
        const xStart = chIdx === 0 ? -228 : -78;
        const yCenter = 10;
        const W = 140, H = 20;
        const N = 80;
        const pts = [];

        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const x = xStart + t * W;
            const cycles = 2;
            const angle = t * cycles * 2 * Math.PI * ch.harmonic + ch.phase * Math.PI / 180;
            let y = 0;
            switch (ch.waveform) {
                case 'Sine': y = Math.sin(angle); break;
                case 'Square': y = Math.sin(angle) >= 0 ? 1 : -1; break;
                case 'Ramp': y = ((t * cycles * ch.harmonic) % 1) * 2 - 1; break;
                case 'Pulse': y = ((t * cycles * ch.harmonic) % 1) < (ch.dutyCycle / 100) ? 1 : -1; break;
                case 'Noise': y = (Math.sin(angle * 13.7) + Math.sin(angle * 7.3)) / 2; break;
                case 'DC': y = ch.offset !== 0 ? Math.sign(ch.offset) : 0; break;
            }
            pts.push(x, yCenter - y * H);
        }
        line.points(pts);
        line.opacity(ch.enabled ? 1 : 0.4);
    }

    // ═══════════════════════════════════════════════════════
    // 输出波形采样（供仿真引擎调用）
    // ═══════════════════════════════════════════════════════

    update(t) {
        const result = { ch1: 0, ch2: 0 };
        ['ch1', 'ch2'].forEach((key, idx) => {
            const ch = this.channels[idx];
            if (!ch.enabled) { result[key] = 0; return; }
            const omega = 2 * Math.PI * ch.frequency * ch.harmonic;
            const phi = ch.phase * Math.PI / 180;
            const A = ch.amplitude / 2;
            const off = ch.offset;
            switch (ch.waveform) {
                case 'Sine': result[key] = A * Math.sin(omega * t + phi) + off; break;
                case 'Square': result[key] = (Math.sin(omega * t + phi) >= 0 ? A : -A) + off; break;
                case 'Ramp': {
                    const frac = ((ch.frequency * ch.harmonic * t + phi / (2 * Math.PI)) % 1 + 1) % 1;
                    result[key] = A * (2 * frac - 1) + off; break;
                }
                case 'Pulse': {
                    const frac = ((ch.frequency * ch.harmonic * t) % 1 + 1) % 1;
                    result[key] = (frac < ch.dutyCycle / 100 ? A : -A) + off; break;
                }
                case 'Noise': result[key] = A * (Math.random() * 2 - 1) + off; break;
                case 'DC': result[key] = off; break;
            }
        });
        return result;
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: 'CH1 频率 (Hz)', key: 'ch1Frequency', type: 'number' },
            { label: 'CH2 频率 (Hz)', key: 'ch2Frequency', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.ch1Frequency !== undefined) this.channels[0].frequency = parseFloat(newConfig.ch1Frequency) || 0;
        if (newConfig.ch2Frequency !== undefined) this.channels[1].frequency = parseFloat(newConfig.ch2Frequency) || 0;
        this.config = { ...this.config, id: this.id };
        this._refreshDisplay();
    }

    destroy() {
        super.destroy?.();
    }
}
