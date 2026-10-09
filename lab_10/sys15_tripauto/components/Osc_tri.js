import { BaseComponent } from './BaseComponent.js';

/**
 * Osc_tri.js — 三路示波器组件
 *
 * AUTO / NORM 两种触发模式；每通道固定长度历史缓冲（Float32Array），writePtr 指示写入位置。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * 波形线与状态文本放 `_dynamicGroup`，按钮放 `_interactGroup`，in-place 更新。
 */
export class Oscilloscope_tri extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'oscilloscope_tri';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters();
        this._init();

        this.config = { id: this.id };

        const xOffsets = [-140, 0, 140];
        this.channels.forEach((ch, i) => {
            const x = xOffsets[i];
            this.addPort(x - 25, 180, `ch${i + 1}p`, 'wire', 'p');
            this.addPort(x + 25, 180, `ch${i + 1}n`, 'wire', 'n');
        });
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.bufferSize = 400;
        this._labelX = [-140, 0, 140];
    }

    _initParameters() {
        this.channels = [
            { id: 'CH1', color: '#f1c40f', history: new Float32Array(this.bufferSize), vIdx: 1 },
            { id: 'CH2', color: '#3498db', history: new Float32Array(this.bufferSize), vIdx: 1 },
            { id: 'CH3', color: '#e74c3c', history: new Float32Array(this.bufferSize), vIdx: 1 },
        ];
        this.writePtr = 0;
        this.vScales = [0.01, 0.1, 1, 5, 10, 50, 100, 200];
        this.tScales = [1, 2, 5, 10];
        this.tIdx = 0;
        this.isHold = false;
        this.triggerMode = 'AUTO';
        this.isTriggered = false;
        this.lastTriggerVal = 0;
    }

    _init() {
        this._drawStaticParts();
        this._resetBuffers();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const colors = { case: '#2c3e50', screenBg: '#0a1a17', grid: '#1abc9c', text: '#ecf0f1' };

        this._staticGroup.add(new Konva.Rect({ x: -220, y: -140, width: 440, height: 320, fill: colors.case, cornerRadius: 10 }));
        this._staticGroup.add(new Konva.Text({ x: -200, y: -138, fontSize: 14, fill: colors.text, text: '三路示波器       江苏航院', width: 400, align: 'center', fontFamily: 'monospace' }));
        this._staticGroup.add(new Konva.Rect({ x: -200, y: -120, width: 400, height: 200, fill: colors.screenBg, stroke: colors.grid, strokeWidth: 2 }));

        const gridGroup = new Konva.Group();
        for (let x = -200 + 40; x < 200; x += 40) {
            const isCenter = x === 0;
            gridGroup.add(new Konva.Line({ points: [x, -120, x, 80], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1, dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.8 : 0.6 }));
        }
        for (let y = -120 + 20; y < 80; y += 20) {
            const isCenter = y === -20;
            gridGroup.add(new Konva.Line({ points: [-200, y, 200, y], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1, dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.8 : 0.6 }));
        }
        this._staticGroup.add(gridGroup);

        this._labelX.forEach((x, i) => {
            this._staticGroup.add(new Konva.Text({
                x: x - 40, y: 165, text: `CH${i + 1} (IN)`, fontSize: 10,
                fill: this.channels[i].color, width: 80, align: 'center',
            }));
        });

        this.addClickablePart('screen', -200, -120, 400, 200);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        this.channels.forEach(ch => {
            ch.line = new Konva.Line({ stroke: ch.color, strokeWidth: 2, lineJoin: 'round', tension: 0.1 });
            this._dynamicGroup.add(ch.line);
        });

        this.statusText = new Konva.Text({ x: -200, y: 90, fontSize: 14, fill: '#ecf0f1', width: 400, align: 'center', fontFamily: 'monospace' });
        this._dynamicGroup.add(this.statusText);

        // 按钮（交互）
        this._buttons = [];
        const mk = (x, label, color, onClick) => {
            const group = new Konva.Group({ x, y: 135 });
            const circle = new Konva.Circle({ radius: 14, fill: color, stroke: '#1a252f', strokeWidth: 2 });
            const txt = new Konva.Text({ x: -30, y: 18, text: label, fontSize: 9, fill: '#ecf0f1', width: 60, align: 'center' });
            group.add(circle, txt);
            this._interactGroup.add(group);
            this._buttons.push({ group, circle, onClick, label });
            return { group, circle };
        };

        const colors = { btnNormal: '#7f8c8d', btnHold: '#e67e22', btnClear: '#c0392b', btnTrig: '#9b59b6' };
        mk(60, '时基', colors.btnNormal, () => { this.tIdx = (this.tIdx + 1) % this.tScales.length; });
        mk(120, '清屏', colors.btnClear, () => { this._resetBuffers(); this._renderLines(); });
        const trigBtn = mk(180, '触发', colors.btnNormal, () => {
            this.triggerMode = (this.triggerMode === 'AUTO' ? 'NORM' : 'AUTO');
            trigBtn.circle.fill(this.triggerMode === 'NORM' ? colors.btnTrig : colors.btnNormal);
            this.isTriggered = false;
            this.writePtr = 0;
        });
        this.channels.forEach((ch, i) => {
            mk(-180 + i * 60, `CH${i + 1}档`, ch.color, () => { ch.vIdx = (ch.vIdx + 1) % this.vScales.length; });
        });

        this.updateStatus();
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this._buttons.forEach(b => {
            b.group.on('mousedown', () => { b.onClick(); this.updateStatus(); });
        });
    }

    // ═══════════════════════════════════════════════════════
    // 逻辑 / 渲染
    // ═══════════════════════════════════════════════════════

    _resetBuffers() {
        const centerY = -20;
        this.channels.forEach(ch => ch.history.fill(centerY));
        this.writePtr = 0;
        this.isTriggered = false;
    }

    _renderLines() {
        this.channels.forEach(ch => {
            const points = [];
            const renderLimit = (this.triggerMode === 'NORM') ? this.writePtr : this.bufferSize;
            for (let i = 0; i < renderLimit; i++) {
                const dataIdx = (this.triggerMode === 'AUTO') ? (this.writePtr + i) % this.bufferSize : i;
                const x = -200 + (i / this.bufferSize) * 400;
                points.push(x, ch.history[dataIdx]);
            }
            ch.line.points(points);
        });
    }

    updateTrace(vDiffs, iterCount) {
        if (iterCount % this.tScales[this.tIdx] !== 0) return;

        const centerY = -20;
        const triggerSourceVal = vDiffs[0] || 0;

        if (this.triggerMode === 'NORM') {
            if (!this.isTriggered) {
                if (this.lastTriggerVal <= 0 && triggerSourceVal > 0) {
                    this.isTriggered = true;
                    this.writePtr = 0;
                }
                this.lastTriggerVal = triggerSourceVal;
                if (!this.isTriggered) return;
            }
        }

        vDiffs.forEach((v, i) => {
            const ch = this.channels[i];
            const val = isNaN(v) ? 0 : v;
            const y = centerY - (val / this.vScales[ch.vIdx]) * 20;
            ch.history[this.writePtr] = Math.max(-118, Math.min(78, y));
        });

        this.writePtr++;

        if (this.triggerMode === 'AUTO') {
            this.writePtr %= this.bufferSize;
            this._renderLines();
        } else if (this.writePtr >= this.bufferSize) {
            this._renderLines();
            this.writePtr = 0;
            this.isTriggered = false;
        }
    }

    updateStatus() {
        const info = this.channels.map(ch => `${this.vScales[ch.vIdx]}V`).join('|');
        const trigInfo = this.triggerMode === 'NORM' ? 'TRG-WAIT' : 'AUTO';
        this.statusText.text(`MOD:${trigInfo} | 档位:${info} | 时基:${this.tScales[this.tIdx]}x | ${this.isHold ? 'PAUSED' : 'RUNNING'}`);
    }

    tick() {
        const s = this.sys?.voltageSolver;
        if (!s) return;
        const channels = [
            { p: 'ch1p', n: 'ch1n' },
            { p: 'ch2p', n: 'ch2n' },
            { p: 'ch3p', n: 'ch3n' },
        ];
        const vDiffs = channels.map(ch => {
            const clusP = s.portToCluster.get(`${this.id}_wire_${ch.p}`);
            const clusN = s.portToCluster.get(`${this.id}_wire_${ch.n}`);
            return (s.nodeVoltages.get(clusP) || 0) - (s.nodeVoltages.get(clusN) || 0);
        });
        this.updateTrace(vDiffs, s.globalIterCount);
    }

    getConfigFields() {
        return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        this.config = { ...this.config, id: this.id };
    }

    destroy() {
        super.destroy?.();
    }
}
