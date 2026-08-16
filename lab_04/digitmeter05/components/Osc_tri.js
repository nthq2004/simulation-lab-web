import { BaseComponent } from './BaseComponent.js';

/**
 * Osc_tri.js
 * 三路示波器组件（注释版）
 *
 * 说明：
 * - 基于 Konva 绘制的三通道示波器视觉与简单采样/触发逻辑实现。
 * - 提供 AUTO 与 NORM 两种触发模式：
 *   - AUTO：连续循环采样并在屏幕上滚动显示（环形缓冲区）。
 *   - NORM：等待触发（上升沿），捕获一屏数据后停止显示，直到下一次触发。
 * - 每个通道维护一个固定长度的历史缓冲区 `history`（Float32Array），由 `writePtr` 指示写入位置。
 * - 支持通道刻度（`vScales`）与时基（`tScales`）切换，UI 提供清屏、触发切换与通道档位按钮。
 *
 * 注意：本文件以文档注释为主，不改变原实现的行为。
 */

export class Oscilloscope_tri extends BaseComponent {
    /**
     * 构造函数
     * @param {object} config - 组件配置（当前未使用特定字段）
     * @param {object} sys - 系统上下文
     */
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oscilloscope_tri';
        this.cache = 'fixed';
        this._initGroups();
        this.bufferSize = 400; // 环形/顺序缓冲区长度（点数）

        // --- 1. 数据结构：三通道，每通道保存颜色、历史数据与电压档位索引 vIdx ---
        this.channels = [
            { id: 'CH1', color: '#f1c40f', history: new Float32Array(this.bufferSize), vIdx: 1 },
            { id: 'CH2', color: '#3498db', history: new Float32Array(this.bufferSize), vIdx: 1 },
            { id: 'CH3', color: '#e74c3c', history: new Float32Array(this.bufferSize), vIdx: 1 }
        ];

        this.writePtr = 0; // 写入指针
        // 通道电压档位（每个档位对应 y 缩放）
        this.vScales = [0.01, 0.1, 1, 5, 10, 50];
        // 时基倍率（用于控制 updateTrace 中的采样降频）
        this.tScales = [1, 2, 5, 10];
        this.tIdx = 0;
        this.isHold = false; // 暂停状态（目前用于显示状态）

        // --- 触发相关状态 ---
        this.triggerMode = 'AUTO';    // 'AUTO' 或 'NORM'
        this.isTriggered = false;     // NORM 模式下是否已检测到触发点
        this.lastTriggerVal = 0;      // 用于边沿检测（上一采样点的触发源值）

        this.initVisuals();
        this._resetBuffers();

        // 端口布局（每通道一组正负端子，供演示接线使用）
        const xOffsets = [-140, 0, 140];
        this.channels.forEach((ch, i) => {
            const x = xOffsets[i];
            this.addPort(x - 25, 180, `ch${i + 1}p`, 'wire', 'p');
            this.addPort(x + 25, 180, `ch${i + 1}n`, 'wire', 'n');
        });
    }

    /**
     * 重置缓冲区（清屏）
     * - 将每个通道的 history 预填充到屏幕中心线 y 值，重置写指针与触发状态
     */
    _resetBuffers() {
        const centerY = -20;
        this.channels.forEach(ch => ch.history.fill(centerY));
        this.writePtr = 0;
        this.isTriggered = false;
    }

    /**
     * 初始化视觉元素：外壳、屏幕网格、通道线对象与控制按钮
     * - gridGroup 保存网格线，channels 中每个 ch.line 为 Konva.Line 用于绘制波形
     */
    initVisuals() {
        const colors = { case: '#2c3e50', screenBg: '#0a1a17', grid: '#1abc9c', btnNormal: '#7f8c8d', btnHold: '#e67e22', btnClear: '#c0392b', btnTrig: '#9b59b6', text: '#ecf0f1' };

        // ── _staticGroup（不变的元素，系统统一缓存） ──
        const body = new Konva.Rect({ x: -220, y: -140, width: 440, height: 320, fill: colors.case, cornerRadius: 10 });
        this.title = new Konva.Text({ x: -200, y: -138, fontSize: 14, fill: colors.text, text: '三路示波器       江苏航院', width: 400, align: 'center', fontFamily: 'monospace' });
        const screenRect = new Konva.Rect({ x: -200, y: -120, width: 400, height: 200, fill: colors.screenBg, stroke: colors.grid, strokeWidth: 2 });

        this.gridGroup = new Konva.Group();
        for (let x = -200 + 40; x < 200; x += 40) {
            const isCenter = x === 0;
            this.gridGroup.add(new Konva.Line({ points: [x, -120, x, 80], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1, dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.8 : 0.6 }));
        }
        for (let y = -120 + 20; y < 80; y += 20) {
            const isCenter = y === -20;
            this.gridGroup.add(new Konva.Line({ points: [-200, y, 200, y], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1, dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.8 : 0.6 }));
        }

        this._staticGroup.add(body, screenRect, this.title, this.gridGroup);

        // 通道标签 → _staticGroup
        const labelX = [-140, 0, 140];
        labelX.forEach((x, i) => { const t = new Konva.Text({ x: x - 40, y: 165, text: `CH${i + 1} (IN)`, fontSize: 10, fill: this.channels[i].color, width: 80, align: 'center' }); this._staticGroup.add(t); });

        // ── _interactGroup（每帧变化的波形线 + 需要交互的按钮） ──
        this.channels.forEach(ch => { ch.line = new Konva.Line({ stroke: ch.color, strokeWidth: 2, lineJoin: 'round', tension: 0.1 }); this._interactGroup.add(ch.line); });

        this.statusText = new Konva.Text({ x: -200, y: 90, fontSize: 14, fill: colors.text, width: 400, align: 'center', fontFamily: 'monospace' });
        this._interactGroup.add(this.statusText);

        const createBtn = (x, label, color, onClick) => {
            const group = new Konva.Group({ x, y: 135 });
            const circle = new Konva.Circle({ radius: 14, fill: color, stroke: '#1a252f', strokeWidth: 2 });
            const txt = new Konva.Text({ x: -30, y: 18, text: label, fontSize: 9, fill: '#ecf0f1', width: 60, align: 'center' });
            group.add(circle, txt);
            group.on('mousedown', () => { onClick(); this.updateStatus(); });
            return { group, circle };
        };

        const tBtn = createBtn(60, '时基', colors.btnNormal, () => this.tIdx = (this.tIdx + 1) % this.tScales.length);
        const cBtn = createBtn(120, '清屏', colors.btnClear, () => { this._resetBuffers(); this._renderLines(); });
        const trigBtn = createBtn(180, '触发', colors.btnNormal, () => {
            this.triggerMode = (this.triggerMode === 'AUTO' ? 'NORM' : 'AUTO');
            trigBtn.circle.fill(this.triggerMode === 'NORM' ? colors.btnTrig : colors.btnNormal);
            this.isTriggered = false;
            this.writePtr = 0;
        });
        this._interactGroup.add(tBtn.group, cBtn.group, trigBtn.group);

        this.channels.forEach((ch, i) => { const btn = createBtn(-180 + i * 60, `CH${i + 1}档`, ch.color, () => { ch.vIdx = (ch.vIdx + 1) % this.vScales.length; }); this._interactGroup.add(btn.group); });

        this.updateStatus();
    }

    /**
     * 将缓冲区数据渲染到每个通道的 Konva.Line 对象
     * - AUTO 模式：使用环形缓冲区显示连续滚动的波形
     * - NORM 模式：顺序填充并仅渲染已经写入的部分，便于稳定显示触发后的波形
     */
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

    /**
     * 更新采样并写入波形数据
     * @param {number[]} vDiffs - 每个通道的幅值（参考差分值）
     * @param {number} iterCount - 外部迭代计数，用于时基降频（采样率控制）
     *
     * 触发逻辑简述：
     * - NORM 模式：只有在检测到触发源（CH1）从 <=0 跳变到 >0 的上升沿时开始写入，写满一屏后停止。
     * - AUTO 模式：始终写入并作为环形缓冲区循环显示。
     */
    updateTrace(vDiffs, iterCount) {
        if (iterCount % this.tScales[this.tIdx] !== 0) return; // 根据时基跳帧

        const centerY = -20;
        const triggerSourceVal = vDiffs[0] || 0; // 默认以 CH1 为触发源

        // 触发逻辑（NORM）
        if (this.triggerMode === 'NORM') {
            if (!this.isTriggered) {
                // 检测上升沿 (从 <=0 到 >0)
                if (this.lastTriggerVal <= 0 && triggerSourceVal > 0) {
                    this.isTriggered = true;
                    this.writePtr = 0;
                }
                this.lastTriggerVal = triggerSourceVal;
                if (!this.isTriggered) return; // 未触发前不写入数据
            }
        }

        // 写入每通道数据到当前 writePtr
        vDiffs.forEach((v, i) => {
            const ch = this.channels[i];
            const val = isNaN(v) ? 0 : v;
            const y = centerY - (val / this.vScales[ch.vIdx]) * 20;
            ch.history[this.writePtr] = Math.max(-118, Math.min(78, y));
        });

        this.writePtr++;

        // 根据模式处理写指针与刷新
        if (this.triggerMode === 'AUTO') {
            this.writePtr %= this.bufferSize;
            this._renderLines(); // AUTO 模式实时刷新
        } else {
            // NORM 模式：填满一屏后渲染并等待下次触发
            if (this.writePtr >= this.bufferSize) {
                this._renderLines();
                this.writePtr = 0;
                this.isTriggered = false;
            }
        }
    }

    /**
     * 更新状态文本（显示档位、触发模式与运行状态）
     */
    updateStatus() {
        const info = this.channels.map(ch => `${this.vScales[ch.vIdx]}V`).join('|');
        const trigInfo = this.triggerMode === 'NORM' ? 'TRG-WAIT' : 'AUTO';
        this.statusText.text(`MOD:${trigInfo} | 档位:${info} | 时基:${this.tScales[this.tIdx]}x | ${this.isHold ? 'PAUSED' : 'RUNNING'}`);
    }

    destroy() {
        super.destroy?.();
    }
}
