import { BaseComponent } from './BaseComponent.js';

/**
 * SignalGenerator — 双通道函数/任意波形信号发生器
 * 参考 RIGOL DG4162 外观与功能
 *
 * 通道功能：
 *   - 波形类型：Sine / Square / Ramp / Pulse / Noise / DC
 *   - 频率、幅度、偏置、相位均可按档位调节
 *   - 两通道独立输出，可叠加谐波
 *
 * 端口：
 *   CH1 输出 (左侧)   — 正/负极
 *   CH2 输出 (右侧)   — 正/负极
 */
export class SignalGenerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'signal_generator';
        this.cache = 'fixed';

        // ── 通道默认参数 ──────────────────────────────────────────
        this.channels = [
            {
                name: 'CH1',
                enabled: true,
                waveform: 'Sine',       // Sine | Square | Ramp | Pulse | Noise | DC
                frequency: 1000,        // Hz
                amplitude: 1.0,         // Vpp
                offset: 0.0,            // Vdc
                phase: 0,               // deg
                dutyCycle: 50,          // % (Pulse/Square)
                harmonic: 1,            // 谐波次数
            },
            {
                name: 'CH2',
                enabled: true,
                waveform: 'Sine',
                frequency: 1000,
                amplitude: 1.0,
                offset: 0.0,
                phase: 0,
                dutyCycle: 50,
                harmonic: 1,
            },
        ];

        // 当前选中的通道/参数索引
         this.selectedCh = 0;
        this.selectedParam = 'frequency'; // frequency | amplitude | offset | phase | dutyCycle | harmonic

        // 频率档位（倍率）
        this.freqSteps = [0.1, 1, 10, 100, 1000, 10000];
        this.freqStepIdx = 1;

        // 幅度档位
        this.ampSteps = [0.001, 0.01, 0.1, 1.0, 10];
        this.ampStepIdx = 2;

        // 偏置档位
        this.offSteps = [0.01, 0.1, 1.0, 10];
        this.offStepIdx = 1;

        this.waveforms = ['Sine', 'Square', 'Ramp', 'Pulse', 'Noise', 'DC'];

        this._initVisuals();

        // 端口：CH1+/CH1-  CH2+/CH2-
        this.addPort(-160, 100, 'ch1p', 'wire', 'p');
        this.addPort(-100, 100, 'ch1n', 'wire');
        this.addPort(100, 100, 'ch2p', 'wire', 'p');
        this.addPort(160, 100, 'ch2n', 'wire');
    }

    // ─────────────────────────────────────────────────────────────
    //  视觉初始化
    // ─────────────────────────────────────────────────────────────
    _initVisuals() {
        const C = {
            body: '#474948',
            bodyAccent: '#253545',
            screen: '#040404',
            screenBorder: '#1abc9c',
            gridLine: '#1abc9c',
            ch1Color: '#fce80b',
            ch2Color: '#0ff80b',
            btnNormal: '#34495e',
            btnActive: '#1abc9c',
            btnWave: '#2980b9',
            btnDanger: '#c0392b',
            text: '#ecf0f1',
            textDim: '#c3caca',
            label: '#0cc081',
            knob: '#2c3e50',
            knobRim: '#1abc9c',
        };
        this._C = C;

        // ── 机箱外壳 ──────────────────────────────────────────────
        const body = new Konva.Rect({
            x: -240, y: -170, width: 480, height: 290,
            fill: C.body, cornerRadius: 12,
            stroke: '#111', strokeWidth: 2,
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

        // ── 显示屏 ────────────────────────────────────────────────
        const screen = new Konva.Rect({
            x: -230, y: -145, width: 300, height: 180,
            fill: C.screen, stroke: C.screenBorder, strokeWidth: 2, cornerRadius: 4,
        });

        // 屏幕内部分隔线（CH1 / CH2 两个面板）
        const divider = new Konva.Line({
            points: [-80, -145, -80, 15], stroke: C.gridLine,
            strokeWidth: 2, dash: [4, 4], opacity: 0.5,
        });

        // CH1 标签
        this.ch1Label = new Konva.Text({
            x: -188, y: -142, text: 'CH1  50Ω', fontFamily: 'monospace',
            fontSize: 12, fontStyle: 'bold', fill: C.ch1Color,
        });
        // CH2 标签
        this.ch2Label = new Konva.Text({
            x: -28, y: -142, text: 'CH2  HiZ', fontFamily: 'monospace',
            fontSize: 12, fontStyle: 'bold', fill: C.ch2Color,
        });

        // CH1 参数显示区
        this.ch1InfoGroup = new Konva.Group({ x: -228, y: -128 });
        this.ch2InfoGroup = new Konva.Group({ x: -78, y: -128 });

        // 预览波形区
        this.wavePreviewCh1 = new Konva.Line({ stroke: C.ch1Color, strokeWidth: 2, lineJoin: 'round' });
        this.wavePreviewCh2 = new Konva.Line({ stroke: C.ch2Color, strokeWidth: 2, lineJoin: 'round' });

        // ── 右侧旋钮区 ────────────────────────────────────────────
        // 大旋钮（Frequency/Amplitude调节）
        this.knobAngle = 0;
        const knobOuter = new Konva.Circle({ x: 155, y: -110, radius: 32, fill: C.knob, stroke: C.knobRim, strokeWidth: 3 });
        const knobInner = new Konva.Circle({ x: 155, y: -110, radius: 24, fill: '#1a252f' });
        this.knobMark = new Konva.Line({
            points: [155, -110, 155, -134], stroke: C.knobRim, strokeWidth: 3,
        });
        const knobLabel = new Konva.Text({ x: 135, y: -70, text: '调节旋钮', fontFamily: 'monospace', fontSize: 12, fill: C.textDim });

        // ── 旋钮交互逻辑优化 ────────────────────────────────────────────
        // 点击上半部分 +1，下半部分 -1
        const handleKnobClick = (e) => {
            // 获取点击位置相对于组件 group 的局部坐标
            // 如果你的 group 经过了缩放或位移，使用 getRelativePointerPosition 更稳妥
            const pos = this.group.getRelativePointerPosition();

            // 旋钮中心的 Y 坐标是 -110
            // 如果点击的 y 小于 -110，说明点击的是上半部分
            const direction = pos.y < -110 ? 1 : -1;

            this._onKnobClick(direction);
        };

        knobOuter.on('mousedown', (e) => handleKnobClick(e));
        knobInner.on('mousedown', (e) => handleKnobClick(e));
        knobOuter.on('dblclick', (e) => e.cancelBubble = true);
        knobInner.on('dblclick', (e) => e.cancelBubble = true);
        // ── 将所有元素添加到组 ────────────────────────────────────
        this.group.add(
            body, bodyTop, brandText, modelText,
            screen, divider,
            this.ch1Label, this.ch2Label,
            this.ch1InfoGroup, this.ch2InfoGroup,
            this.wavePreviewCh1, this.wavePreviewCh2,
            knobOuter, knobInner, this.knobMark, knobLabel,
        );

        // ── 功能按钮区 ────────────────────────────────────────────
        this._buildButtons(C);

        // ── 端口标记 ──────────────────────────────────────────────
        const portLabels = [
            { x: -175, y: 78, text: 'CH1+', color: C.ch1Color },
            { x: -115, y: 78, text: 'CH1-', color: C.ch1Color },
            { x: 85, y: 78, text: 'CH2+', color: C.ch2Color },
            { x: 145, y: 78, text: 'CH2-', color: C.ch2Color },
        ];
        portLabels.forEach(pl => {
            // BNC 插座外圈
            const bnc = new Konva.Circle({ x: pl.x + 15, y: 100, radius: 10, fill: '#1a252f', stroke: '#555', strokeWidth: 2 });
            const bncDot = new Konva.Circle({ x: pl.x + 15, y: 100, radius: 4, fill: '#333' });
            this.group.add(bnc, bncDot);
        });

        // 初始渲染
        this._refreshDisplay();
    }

    // ─────────────────────────────────────────────────────────────
    //  按钮构建
    // ─────────────────────────────────────────────────────────────
    _buildButtons(C) {
        // 波形选择按钮（右侧竖排）
        const waveIcons = { Sine: '∿', Square: '⊓', Ramp: '⋀', Pulse: '⊓̈', Noise: '≈', DC: '─' };
        this.waveforms.forEach((wf, i) => {
            this._makeBtn(95, -130 + i * 28, waveIcons[wf] || wf, C.btnWave, () => {
                this.channels[this.selectedCh].waveform = wf;
                this._refreshDisplay();
            }, wf);
        });

        // 保存按钮引用以便后续更新
        this.outBtns = [];

        const btnCh1 = this._makeBtn(-130, 78, 'CH1 OUT', C.btnNormal, () => {
            this.channels[0].enabled = !this.channels[0].enabled;
            this._refreshDisplay();
        });
        this.outBtns.push(btnCh1);

        const btnCh2 = this._makeBtn(130, 78, 'CH2 OUT', C.btnNormal, () => {
            this.channels[1].enabled = !this.channels[1].enabled;
            this._refreshDisplay();
        });
        this.outBtns.push(btnCh2);

        // 参数选择按钮
        const params = [
            { label: '频率', key: 'frequency' },
            { label: '幅度', key: 'amplitude' },
            { label: '偏置', key: 'offset' },
            { label: '相位', key: 'phase' },
            { label: '占空比', key: 'dutyCycle' },
            { label: '谐波', key: 'harmonic' },
        ];
        params.forEach((p, i) => {
            this._makeBtn(-205 + i * 50, 50, p.label, C.btnNormal, () => {
                this.selectedParam = p.key;
                this._refreshDisplay();
            });
        });

        // 通道选择
        this._makeBtn(155, -30, 'CH1', C.btnNormal, () => {
            this.selectedCh = 0;
            this._refreshDisplay();
        });
        this._makeBtn(155, 10, 'CH2', C.btnNormal, () => {
            this.selectedCh = 1;
            this._refreshDisplay();
        });

        // 频率步进
        this._makeBtn(215, -130, '步进↑', C.btnNormal, () => {
            if (this.selectedParam === 'frequency') {
                this.freqStepIdx = Math.min(this.freqSteps.length - 1, this.freqStepIdx + 1);
            } else if (this.selectedParam === 'amplitude') {
                this.ampStepIdx = Math.min(this.ampSteps.length - 1, this.ampStepIdx + 1);
            } else if (this.selectedParam === 'offset') {
                this.offStepIdx = Math.min(this.offSteps.length - 1, this.offStepIdx + 1);
            }

            this._refreshDisplay();
        });
        this._makeBtn(215, -95, '步进↓', C.btnNormal, () => {
            if (this.selectedParam === 'frequency') {
                this.freqStepIdx = Math.max(0, this.freqStepIdx - 1);
            } else if (this.selectedParam === 'amplitude') {
                this.ampStepIdx = Math.max(0, this.ampStepIdx - 1);
            } else if (this.selectedParam === 'offset') {
                this.offStepIdx = Math.max(0, this.offStepIdx - 1);
            }
            this._refreshDisplay();
        });
        this._stepDisplayBg = new Konva.Rect({
            x: 193, y: -68, width: 44, height: 20,
            fill: '#0a1810', stroke: C.screenBorder,
            strokeWidth: 1, cornerRadius: 3,
        });
        this._stepDisplayText = new Konva.Text({
            x: 193, y: -65,
            text: this._fmtStep(),
            fontSize: 11, fontFamily: 'monospace',
            fill: C.label, width: 44, align: 'center',
        });
        this.group.add(this._stepDisplayBg, this._stepDisplayText);
        // 复位
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

    }
    _makeBtn(x, y, label, color, onClick, tooltip) {
        const g = new Konva.Group({ x, y });
        const bg = new Konva.Rect({ x: -22, y: -10, width: 44, height: 22, fill: color, cornerRadius: 4, stroke: '#0a1a17', strokeWidth: 1 });
        const txt = new Konva.Text({ x: -22, y: -6, text: label, fontSize: 12, fill: '#ecf0f1', width: 44, align: 'center', fontFamily: 'monospace' });
        g.add(bg, txt);
        g.on('mousedown', (e) => {
            bg.fill('#1abc9c');
            this._refreshDisplay();
            setTimeout(() => { bg.fill(color); this._refreshDisplay(); }, 120);
            onClick();
        });
        g.on('dblclick', e => e.cancelBubble = true);
        this.group.add(g);
        return { group: g, bg, txt };
    }

    // ─────────────────────────────────────────────────────────────
    //  旋钮调节
    // ─────────────────────────────────────────────────────────────
    _onKnobClick(dir) {
        const ch = this.channels[this.selectedCh];
        const step = this.freqSteps[this.freqStepIdx];
        switch (this.selectedParam) {
            case 'frequency':
                ch.frequency = Math.max(0.001, ch.frequency + dir * step);
                break;
            case 'amplitude':
                ch.amplitude = Math.max(0.001, +(ch.amplitude + dir * this.ampSteps[this.ampStepIdx]).toFixed(4));
                break;
            case 'offset':
                ch.offset = +(ch.offset + dir * this.offSteps[this.offStepIdx]).toFixed(4);
                break;
            case 'phase':
                ch.phase = ((ch.phase + dir * 10) + 360) % 360;
                break;
            case 'dutyCycle':
                ch.dutyCycle = Math.min(99, Math.max(1, ch.dutyCycle + dir));
                break;
            case 'harmonic':
                ch.harmonic = Math.max(1, ch.harmonic + dir);
                break;
        }
        this.knobAngle += dir * 3.6;
        this.knobMark.points([
            155, -110,
            155 + 24 * Math.sin(this.knobAngle * Math.PI / 180),
            -110 - 24 * Math.cos(this.knobAngle * Math.PI / 180),
        ]);
        this._refreshDisplay();
    }

    // ─────────────────────────────────────────────────────────────
    //  屏幕刷新
    // ─────────────────────────────────────────────────────────────
    _refreshDisplay() {
        this._updateChannelInfo(0);
        this._updateChannelInfo(1);
        this._drawPreviewWave(0);
        this._drawPreviewWave(1);
        if (this._stepDisplayText) {
            this._stepDisplayText.text(this._fmtStep());
        }
        // --- 新增：更新输出按钮颜色 ---
        if (this.outBtns) {
            this.outBtns.forEach((btn, idx) => {
                const isEnabled = this.channels[idx].enabled;
                // 开启时显示 active 颜色（绿色系），关闭时显示 normal 颜色（灰色系）
                btn.bg.fill(isEnabled ? this._C.btnActive : this._C.btnNormal);
            });
        }
        // 高亮选中通道标签
        this.ch1Label.fontStyle(this.selectedCh === 0 ? 'bold' : 'normal');
        this.ch1Label.text(`${this.channels[0].enabled ? 'CH1  50Ω' : 'CH1  HiZ'}`);
        this.ch2Label.fontStyle(this.selectedCh === 1 ? 'bold' : 'normal');
        this.ch2Label.text(`${this.channels[1].enabled ? 'CH2  50Ω' : 'CH2  HiZ'}`);

        this._refreshCache();
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
                x: 10, y: i * 14,
                text: `${l.label}: ${l.value}`,
                fontSize: 12, fontFamily: 'monospace',
                fill: isSelected ? '#fff' : highlight,
                fontStyle: isSelected ? 'bold' : 'normal',
            }));
        });

        // 输出状态
        g.add(new Konva.Text({
            x: 10, y: lines.length * 14 + 2,
            text: ch.enabled ? '▶ ON' : '■ OFF',
            fontSize: 12, fontFamily: 'monospace',
            fill: ch.enabled ? '#2ecc71' : '#e74c3c',
        }));
    }

    _fmtFreq(hz) {
        if (hz >= 1e6) return (hz / 1e6).toFixed(6) + ' MHz';
        if (hz >= 1e3) return (hz / 1e3).toFixed(3) + ' kHz';
        return hz.toFixed(3) + ' Hz';
    }

    // ─────────────────────────────────────────────────────────────
    //  屏幕内小波形预览
    // ─────────────────────────────────────────────────────────────
    _drawPreviewWave(chIdx) {
        const ch = this.channels[chIdx];
        const line = chIdx === 0 ? this.wavePreviewCh1 : this.wavePreviewCh2;

        // 预览框范围
        const xStart = chIdx === 0 ? -228 : -78;
        const yCenter = 10;   // 屏幕坐标内
        const W = 140, H = 20;
        const N = 80;
        const pts = [];

        for (let i = 0; i <= N; i++) {
            const t = i / N;       // 0~1
            const x = xStart + t * W;
            const cycles = 2;
            const angle = t * cycles * 2 * Math.PI * ch.harmonic + ch.phase * Math.PI / 180;
            let y = 0;

            switch (ch.waveform) {
                case 'Sine':
                    y = Math.sin(angle);
                    break;
                case 'Square':
                    y = Math.sin(angle) >= 0 ? 1 : -1;
                    break;
                case 'Ramp':
                    y = ((t * cycles * ch.harmonic) % 1) * 2 - 1;
                    break;
                case 'Pulse': {
                    const duty = ch.dutyCycle / 100;
                    y = ((t * cycles * ch.harmonic) % 1) < duty ? 1 : -1;
                    break;
                }
                case 'Noise':
                    y = (Math.sin(angle * 13.7) + Math.sin(angle * 7.3)) / 2;
                    break;
                case 'DC':
                    y = ch.offset !== 0 ? Math.sign(ch.offset) : 0;
                    break;
            }

            pts.push(x, yCenter - y * H);
        }

        line.points(pts);
        line.opacity(ch.enabled ? 1 : 0.4);
    }

    // ─────────────────────────────────────────────────────────────
    //  输出波形采样（供仿真引擎调用）
    // ─────────────────────────────────────────────────────────────
    /**
     * 返回 { ch1: voltage, ch2: voltage } 在时刻 t (秒)
     */
    update(t) {
        const result = { ch1: 0, ch2: 0 };
        ['ch1', 'ch2'].forEach((key, idx) => {
            const ch = this.channels[idx];
            if (!ch.enabled) { result[key] = 0; return; }

            const omega = 2 * Math.PI * ch.frequency * ch.harmonic;
            const phi = ch.phase * Math.PI / 180;
            const A = ch.amplitude / 2;   // 半幅度
            const off = ch.offset;

            switch (ch.waveform) {
                case 'Sine':
                    result[key] = A * Math.sin(omega * t + phi) + off;
                    break;
                case 'Square': {
                    const v = Math.sin(omega * t + phi);
                    result[key] = (v >= 0 ? A : -A) + off;
                    break;
                }
                case 'Ramp': {
                    const frac = ((ch.frequency * ch.harmonic * t + phi / (2 * Math.PI)) % 1 + 1) % 1;
                    result[key] = A * (2 * frac - 1) + off;
                    break;
                }
                case 'Pulse': {
                    const frac = ((ch.frequency * ch.harmonic * t) % 1 + 1) % 1;
                    result[key] = (frac < ch.dutyCycle / 100 ? A : -A) + off;
                    break;
                }
                case 'Noise':
                    result[key] = A * (Math.random() * 2 - 1) + off;
                    break;
                case 'DC':
                    result[key] = off;
                    break;
            }
        });
        return result;
    }

}