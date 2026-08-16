import { BaseComponent } from './BaseComponent.js';

export class Oscilloscope_tri extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oscilloscope_tri';
        this.bufferSize = 400;

        // --- 1. 数据结构 ---
        this.channels = [
            { id: 'CH1', color: '#f1c40f', history: new Float32Array(this.bufferSize), vIdx: 2 },
            { id: 'CH2', color: '#3498db', history: new Float32Array(this.bufferSize), vIdx: 2 },
            { id: 'CH3', color: '#e74c3c', history: new Float32Array(this.bufferSize), vIdx: 2 }
        ];

        this.writePtr = 0;
        this.vScales = [0.01, 0.1, 1, 5, 10, 50];
        this.tScales = [1, 2, 5, 10];
        this.tIdx = 0;
        this.isHold = false;

        // --- 触发相关状态 ---
        this.triggerMode = 'AUTO';    // 'AUTO' 或 'NORM'
        this.isTriggered = false;     // 是否已捕获触发点
        this.lastTriggerVal = 0;      // 用于检测上升沿

        this.initVisuals();
        this._resetBuffers();

        // 端口布局
        const xOffsets = [-140, 0, 140];
        this.channels.forEach((ch, i) => {
            const x = xOffsets[i];
            this.addPort(x - 25, 180, `ch${i + 1}p`, 'wire', 'p');
            this.addPort(x + 25, 180, `ch${i + 1}n`, 'wire', 'n');
        });
    }

    _resetBuffers() {
        const centerY = -20;
        this.channels.forEach(ch => ch.history.fill(centerY));
        this.writePtr = 0;
        this.isTriggered = false;
    }

    initVisuals() {
        const colors = {
            case: '#2c3e50', screenBg: '#0a1a17', grid: '#1abc9c',
            btnNormal: '#7f8c8d', btnHold: '#e67e22', btnClear: '#c0392b',
            btnTrig: '#9b59b6', text: '#ecf0f1'
        };

        const body = new Konva.Rect({ x: -220, y: -140, width: 440, height: 320, fill: colors.case, cornerRadius: 10 });
        this.title = new Konva.Text({
            x: -200, y: -138, fontSize: 14, fill: colors.text, text: '三路示波器       江苏航院', width: 400, align: 'center', fontFamily: 'monospace'
        });
        const screenRect = new Konva.Rect({ x: -200, y: -120, width: 400, height: 200, fill: colors.screenBg, stroke: colors.grid, strokeWidth: 2 });

        // 网格绘制 (中心线增强)
        this.gridGroup = new Konva.Group();
        for (let x = -200 + 40; x < 200; x += 40) {
            const isCenter = x === 0;
            this.gridGroup.add(new Konva.Line({ points: [x, -120, x, 80], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1, dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.8 : 0.4 }));
        }
        for (let y = -120 + 20; y < 80; y += 20) {
            const isCenter = y === -20;
            this.gridGroup.add(new Konva.Line({ points: [-200, y, 200, y], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1, dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.8 : 0.4 }));
        }

        this.channels.forEach(ch => {
            ch.line = new Konva.Line({ stroke: ch.color, strokeWidth: 2, lineJoin: 'round', tension: 0.1 });
        });

        this.statusText = new Konva.Text({ x: -200, y: 90, fontSize: 14, fill: colors.text, width: 400, align: 'center', fontFamily: 'monospace' });

        const createBtn = (x, label, color, onClick) => {
            const group = new Konva.Group({ x, y: 135 });
            const circle = new Konva.Circle({ radius: 14, fill: color, stroke: '#1a252f', strokeWidth: 2 });
            const txt = new Konva.Text({ x: -30, y: 18, text: label, fontSize: 9, fill: '#ecf0f1', width: 60, align: 'center' });
            group.add(circle, txt);
            group.on('mousedown', () => { onClick(); this.updateStatus(); this.sys.layer.batchDraw(); });
            return { group, circle };
        };

        // --- 重新排列按钮 (间距 50) ---


        // 4. 时基
        const tBtn = createBtn(60, "时基", colors.btnNormal, () => this.tIdx = (this.tIdx + 1) % this.tScales.length);

        // // 5. 保持
        // const hBtn = createBtn(50, "保持", colors.btnNormal, () => {
        //     this.isHold = !this.isHold;
        //     hBtn.circle.fill(this.isHold ? colors.btnHold : colors.btnNormal);
        // });

        // 6. 清屏
        const cBtn = createBtn(120, "清屏", colors.btnClear, () => { this._resetBuffers(); this._renderLines(); });

        // 7. 触发按钮 (新增)
        const trigBtn = createBtn(180, "触发", colors.btnNormal, () => {
            this.triggerMode = (this.triggerMode === 'AUTO' ? 'NORM' : 'AUTO');
            trigBtn.circle.fill(this.triggerMode === 'NORM' ? colors.btnTrig : colors.btnNormal);
            this.isTriggered = false;
            this.writePtr = 0;
        });

        const labelX = [-140, 0, 140];
        labelX.forEach((x, i) => {
            const t = new Konva.Text({ x: x - 40, y: 165, text: `CH${i + 1} (IN)`, fontSize: 10, fill: this.channels[i].color, width: 80, align: 'center' });
            this.group.add(t);
        });

        this.group.add(body, screenRect, this.title, this.gridGroup, this.statusText, tBtn.group, cBtn.group, trigBtn.group);
        // 1-3. 通道档位
        this.channels.forEach((ch, i) => {
            const btn = createBtn(-180 + i * 60, `CH${i + 1}档`, ch.color, () => {
                ch.vIdx = (ch.vIdx + 1) % this.vScales.length;
            });
            this.group.add(btn.group);
        });
        this.channels.forEach(ch => this.group.add(ch.line));
        this.updateStatus();
    }

    _renderLines() {
        this.channels.forEach(ch => {
            const points = [];
            // 在 NORM 模式下，如果没画完，只显示已画部分
            const renderLimit = (this.triggerMode === 'NORM') ? this.writePtr : this.bufferSize;

            for (let i = 0; i < renderLimit; i++) {
                // AUTO 模式是环形缓冲区显示，NORM 模式是顺序填充显示
                const dataIdx = (this.triggerMode === 'AUTO') ? (this.writePtr + i) % this.bufferSize : i;
                const x = -200 + (i / this.bufferSize) * 400;
                points.push(x, ch.history[dataIdx]);
            }
            ch.line.points(points);
        });
    }

    updateTrace(vDiffs, iterCount) {
        // if (this.isHold) return;
        if (iterCount % this.tScales[this.tIdx] !== 0) return;

        const centerY = -20;
        const triggerSourceVal = vDiffs[0] || 0; // 默认以 CH1 为触发源

        // --- 触发逻辑实现 ---
        if (this.triggerMode === 'NORM') {
            if (!this.isTriggered) {
                // 检测上升沿 (从 <=0 到 >0)
                if (this.lastTriggerVal <= 0 && triggerSourceVal > 0) {
                    this.isTriggered = true;
                    this.writePtr = 0;
                }
                this.lastTriggerVal = triggerSourceVal;
                if (!this.isTriggered) return; // 没触发前不写数据
            }
        }

        // --- 数据写入 ---
        vDiffs.forEach((v, i) => {
            const ch = this.channels[i];
            const val = isNaN(v) ? 0 : v;
            const y = centerY - (val / this.vScales[ch.vIdx]) * 20;
            ch.history[this.writePtr] = Math.max(-118, Math.min(78, y));
        });

        this.writePtr++;

        // --- 指针处理与刷新渲染 ---
        if (this.triggerMode === 'AUTO') {
            this.writePtr %= this.bufferSize;
            this._renderLines(); // AUTO 模式实时刷新
        } else {
            // NORM 模式：画满一屏后停止，等待下一次触发
            if (this.writePtr >= this.bufferSize) {
                this._renderLines(); // 画满才刷，保证波形稳定
                this.writePtr = 0;
                this.isTriggered = false;
            }
        }
    }

    updateStatus() {
        const info = this.channels.map(ch => `${this.vScales[ch.vIdx]}V`).join('|');
        const trigInfo = this.triggerMode === 'NORM' ? 'TRG-WAIT' : 'AUTO';
        this.statusText.text(`MOD:${trigInfo} | 档位:${info} | 时基:${this.tScales[this.tIdx]}x | ${this.isHold ? 'PAUSED' : 'RUNNING'}`);
    }
}