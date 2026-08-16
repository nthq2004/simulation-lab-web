import { BaseComponent } from './BaseComponent.js';

export class Oscilloscope extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oscilloscope';
        this.cache ='fixed';    
        this.bufferSize = 400;

        // 档位定义
        this.vScales = [0.001, 0.01, 0.1, 1, 2, 10, 100];
        this.iScales = [0.001, 0.005, 0.01, 0.05, 0.1, 1];
        this.tScales = [1, 2, 5, 10, 20];

        this.vIdx = 3;
        this.iIdx = 2;
        this.tIdx = 0;

        // --- 触发相关状态 ---
        this.triggerMode = 'AUTO';
        this.isTriggered = false;
        this.lastTriggerVal = 0;
        this.writePtr = 0;

        this._resetBuffers();
        this.initVisuals();

        // 端口布局
        this.addPort(-120, 180, 'l', 'wire', 'p');
        this.addPort(-60, 180, 'r', 'wire');
        this.addPort(70, 180, 'p', 'wire', 'p');
        this.addPort(130, 180, 'n', 'wire');
    }

    _resetBuffers() {
        const centerY = -20;
        this.vHistory = new Float32Array(this.bufferSize).fill(centerY);
        this.iHistory = new Float32Array(this.bufferSize).fill(centerY);
        this.writePtr = 0;
        this.isTriggered = false;
    }

    initVisuals() {
        const colors = {
            case: '#2c3e50', screenBg: '#0a1a17', grid: '#1abc9c',
            vTrace: '#f1c40f', iTrace: '#e74c3c',
            btnNormal: '#7f8c8d', btnTrig: '#9b59b6', btnClear: '#c0392b',
            text: '#f8fdfd', label: '#0cc081'
        };

        // 外壳和屏幕
        const body = new Konva.Rect({ x: -210, y: -140, width: 420, height: 320, fill: colors.case, cornerRadius: 10 });
        this.title = new Konva.Text({
            x: -200, y: -138, fontSize: 14, fill: colors.text, text: '双踪示波器       江苏航院', width: 400, align: 'center', fontFamily: 'monospace'
        });
        const screenRect = new Konva.Rect({ x: -200, y: -120, width: 400, height: 200, fill: colors.screenBg, stroke: colors.grid, strokeWidth: 2 });

        // 网格
        this.gridGroup = new Konva.Group();
        for (let x = -200 + 40; x < 200; x += 40) {
            const isCenter = (x === 0);
            this.gridGroup.add(new Konva.Line({
                points: [x, -120, x, 80], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1,
                dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.7 : 0.4
            }));
        }
        for (let y = -120 + 20; y < 80; y += 20) {
            const isCenter = (y === -20);
            this.gridGroup.add(new Konva.Line({
                points: [-200, y, 200, y], stroke: colors.grid, strokeWidth: isCenter ? 1.5 : 1,
                dash: isCenter ? [] : [2, 4], opacity: isCenter ? 0.7 : 0.4
            }));
        }

        this.statusText = new Konva.Text({
            x: -200, y: 90, fontSize: 14, fill: colors.text, width: 400, align: 'center', fontFamily: 'monospace'
        });

        // 统一的按钮构造器
        const createInteractBtn = (x, label, color, onClick) => {
            const btnGroup = new Konva.Group({ x, y: 128 });
            const circle = new Konva.Circle({ radius: 15, fill: color, stroke: '#1a252f', strokeWidth: 2 });
            const txt = new Konva.Text({ x: -25, y: 18, text: label, fontSize: 9, fill: colors.text, width: 50, align: 'center' });
            btnGroup.add(circle, txt);
            btnGroup.on('mousedown', (e) => {
                onClick();
                this.updateStatus();
            });
            btnGroup.on('dblclick', (e) => {
                e.cancelBubble = true;
            });
            this.group.add(btnGroup); // 关键：确保按钮被添加到组件组中
            return { group: btnGroup, circle };
        };


        // 波形线条
        this.vLine = new Konva.Line({ stroke: colors.vTrace, strokeWidth: 2, lineJoin: 'round' });
        this.iLine = new Konva.Line({ stroke: colors.iTrace, strokeWidth: 2, lineJoin: 'round' });

        // 端口文字说明
        const tCur = new Konva.Text({ x: -127, y: 165, text: '电流', fontSize: 10, fill: colors.iTrace, width: 70, align: 'center' });
        const tVol = new Konva.Text({ x: 62, y: 165, text: '电压', fontSize: 10, fill: colors.vTrace, width: 70, align: 'center' });

        // 将所有元素添加到主组
        this.group.add(body, screenRect, this.title, this.gridGroup, this.statusText, this.vLine, this.iLine, tCur, tVol);
        // --- 按钮排布：从左到右依次排列 ---
        createInteractBtn(-160, "电压档", colors.btnNormal, () => {
            this.vIdx = (this.vIdx + 1) % this.vScales.length;
        });

        createInteractBtn(-80, "电流档", colors.btnNormal, () => {
            this.iIdx = (this.iIdx + 1) % this.iScales.length;
        });

        createInteractBtn(20, "时基", colors.btnNormal, () => {
            this.tIdx = (this.tIdx + 1) % this.tScales.length;
        });

        createInteractBtn(100, "清屏", colors.btnClear, () => {
            this._resetBuffers();
            this._renderLines();
        });

        // 触发按钮放在最右边
        const trigBtn = createInteractBtn(180, "触发", colors.btnNormal, () => {
            this.triggerMode = (this.triggerMode === 'AUTO' ? 'NORM' : 'AUTO');
            trigBtn.circle.fill(this.triggerMode === 'NORM' ? colors.btnTrig : colors.btnNormal);
            this.isTriggered = false;
            this.writePtr = 0;
        });

        this.updateStatus();
    }

    updateStatus() {
        const modeText = this.triggerMode === 'NORM' ? "TRG" : "AUTO";
        const vScale = this.vScales[this.vIdx];
        const iScale = this.iScales[this.iIdx] * 1000;
        this.statusText.text(`MOD:${modeText} | V:${vScale}V/div | I:${iScale}mA/div | Step:${this.tScales[this.tIdx]}x`);
        this._refreshCache();
    }

    _renderLines() {
        const vPoints = [], iPoints = [];
        const limit = (this.triggerMode === 'AUTO') ? this.bufferSize : this.writePtr;

        for (let i = 0; i < limit; i++) {
            const dataIdx = (this.triggerMode === 'AUTO') ? (this.writePtr + i) % this.bufferSize : i;
            const x = -200 + (i / this.bufferSize) * 400;

            vPoints.push(x, Math.max(-118, Math.min(78, this.vHistory[dataIdx])));
            iPoints.push(x, Math.max(-118, Math.min(78, this.iHistory[dataIdx])));
        }
        this.vLine.points(vPoints);
        this.iLine.points(iPoints);
    }

    updateTrace(vDiff, iVal, iterCount) {
        if (iterCount % this.tScales[this.tIdx] !== 0) return;

        const centerY = -20;
        const vScale = this.vScales[this.vIdx];
        const iScale = this.iScales[this.iIdx];

        if (this.triggerMode === 'NORM') {
            if (!this.isTriggered) {
                if (this.lastTriggerVal <= 0 && vDiff > 0) {
                    this.isTriggered = true;
                    this.writePtr = 0;
                }
                this.lastTriggerVal = vDiff;
                if (!this.isTriggered) return;
            }
        }

        const vY = centerY - (vDiff / vScale) * 20;
        const iY = centerY - (iVal / iScale) * 20;

        this.vHistory[this.writePtr] = vY;
        this.iHistory[this.writePtr] = iY;

        this.writePtr++;

        if (this.triggerMode === 'AUTO') {
            this.writePtr %= this.bufferSize;
            this._renderLines();
        } else {
            if (this.writePtr >= this.bufferSize) {
                this._renderLines();
                this.writePtr = 0;
                this.isTriggered = false;
            }
        }
        this._refreshCache();
    }
}