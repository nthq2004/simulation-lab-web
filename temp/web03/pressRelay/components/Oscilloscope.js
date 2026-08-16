import { BaseComponent } from './BaseComponent.js';

export class Oscilloscope extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oscilloscope';
        this.bufferSize = 400;
        this._resetBuffers(); // 初始化缓冲区

        // 档位定义
        this.vScales = [1, 2, 5, 10, 20,100];
        this.iScales = [0.001, 0.005, 0.01, 0.05, 0.1, 1];
        this.tScales = [1, 2, 5, 10];

        this.vIdx = 2; // 5V
        this.iIdx = 2; // 10mA
        this.tIdx = 0; // 1x

        this.vScale = this.vScales[this.vIdx];
        this.iScale = this.iScales[this.iIdx];
        this.timeStepFactor = this.tScales[this.tIdx];
        this.isHold = false;

        this.initVisuals();

        // 端口布局（适配更宽的外壳）
        this.addPort(-120, 180, 'l', 'wire','p');
        this.addPort(-60, 180, 'r', 'wire');
        this.addPort(70, 180, 'p', 'wire', 'p');
        this.addPort(130, 180, 'n', 'wire');
    }

    /**
     * 重置数据缓冲区的内部方法
     */
    _resetBuffers() {
        const centerY = -15; // 屏幕垂直中心位置
        this.vHistory = new Array(this.bufferSize).fill(centerY);
        this.iHistory = new Array(this.bufferSize).fill(centerY);
    }

    initVisuals() {
        const colors = {
            case: '#2c3e50', screenBg: '#0a1a17', grid: '#1abc9c',
            vTrace: '#f1c40f', iTrace: '#e74c3c',
            btnNormal: '#7f8c8d', btnHold: '#e67e22', btnClear: '#c0392b',
            text: '#ecf0f1'
        };

        // 1. 扩宽外壳适配 5 个按钮 (原 320 -> 现 380)
        const body = new Konva.Rect({ x: -210, y: -140, width: 420, height: 320, fill: colors.case, cornerRadius: 10 });
        const screenRect = new Konva.Rect({ x: -200, y: -120, width: 400, height: 200, fill: colors.screenBg, stroke: colors.grid, strokeWidth: 2 });
        // --- 新增：绘制虚线网格 ---
        this.gridGroup = new Konva.Group();
        const step = 21; // 每一格 21 像素

        // 绘制纵向虚线 (垂直分割时间轴)
        for (let x = -200 + step; x < 200; x += step) {
            this.gridGroup.add(new Konva.Line({
                points: [x, -120, x, 90],
                stroke: colors.grid,
                strokeWidth: 1,
                dash: [2, 4], // 2像素实线，4像素空白
                opacity: 0.4
            }));
        }

        // 绘制横向虚线 (水平分割电压/电流轴)
        for (let y = -120 + step; y < 80; y += step) {
            this.gridGroup.add(new Konva.Line({
                points: [-200, y, 200, y],
                stroke: colors.grid,
                strokeWidth: 1,
                dash: [2, 4],
                opacity: 0.4
            }));
        }
        // 绘制中心基准实线 (0点参考线)
        this.gridGroup.add(new Konva.Line({
            points: [-200, -15, 200, -15], // 屏幕垂直中心 Y=-15
            stroke: colors.grid,
            strokeWidth: 1,
            opacity: 0.8
        }));
        // --- 虚线网格部分结束 ---        
        // 2. 状态显示
        this.statusText = new Konva.Text({
            x: -160, y: 100, fontSize: 13, fontStyle: 'bold', fill: colors.text, width: 320, align: 'center',
            text: this._getStatusString()
        });

        // 3. 按钮构造器
        const createInteractBtn = (x, label, color, onClick) => {
            const btnGroup = new Konva.Group({ x, y: 135 });
            const circle = new Konva.Circle({ radius: 15, fill: color, stroke: '#1a252f', strokeWidth: 2 });
            const txt = new Konva.Text({ x: -25, y: 18, text: label, fontSize: 9, fill: '#0cc081', width: 50, align: 'center' });

            btnGroup.add(circle, txt);
            btnGroup.on('mousedown', () => {
                onClick();
                this.updateStatus();
                this.sys.layer.batchDraw();
            });
            btnGroup.on('dblclick', (e) => {
                e.cancelBubble = true;
            });
            return { group: btnGroup, circle };
        };

        // --- 五个功能按钮分布 ---
        const vBtn = createInteractBtn(-130, "每格电压", colors.btnNormal, () => {
            this.vIdx = (this.vIdx + 1) % this.vScales.length;
            this.vScale = this.vScales[this.vIdx];
        });

        const iBtn = createInteractBtn(-65, "每格电流", colors.btnNormal, () => {
            this.iIdx = (this.iIdx + 1) % this.iScales.length;
            this.iScale = this.iScales[this.iIdx];
        });

        const tBtn = createInteractBtn(0, "时基", colors.btnNormal, () => {
            this.tIdx = (this.tIdx + 1) % this.tScales.length;
            this.timeStepFactor = this.tScales[this.tIdx];
        });

        const hBtn = createInteractBtn(65, "保持", colors.btnNormal, () => {
            this.isHold = !this.isHold;
            hBtn.circle.fill(this.isHold ? colors.btnHold : colors.btnNormal);
        });

        // CLEAR 按钮：重置缓冲区并重绘
        const cBtn = createInteractBtn(130, "清屏", colors.btnClear, () => {
            this._resetBuffers();
            // 如果是在 HOLD 状态下清理，需要强制重画一次直线
            this._renderLines();
        });

        // 4. 波形线条
        this.vLine = new Konva.Line({ stroke: colors.vTrace, strokeWidth: 2, lineJoin: 'round' });
        this.iLine = new Konva.Line({ stroke: colors.iTrace, strokeWidth: 2, lineJoin: 'round' });

        this.cur = new Konva.Text({ x: -110, y: 170, text: '电流', fontSize: 10, fill: '#0bf14c', width: 30, align: 'center' });
        this.volt = new Konva.Text({ x: 80, y: 170, text: '电压', fontSize: 10, fill: '#1ff760', width: 30, align: 'center' });
        this.group.add(body, screenRect, this.gridGroup, this.statusText, vBtn.group, iBtn.group, tBtn.group, hBtn.group, cBtn.group, this.vLine, this.iLine, this.cur, this.volt);
    }

    _getStatusString() {
        const holdStatus = this.isHold ? "[ STOPPED ]" : "[ RUNNING ]";
        return `V: ${this.vScale}V/div  |  I: ${this.iScale * 1000}mA/div  |  Step: ${this.timeStepFactor}  |  ${holdStatus}`;
    }

    updateStatus() {
        this.statusText.text(this._getStatusString());
    }

    /**
     * 内部渲染逻辑：根据缓冲区绘制线条
     */
    _renderLines() {
        const vPoints = [], iPoints = [];
        for (let i = 0; i < this.vHistory.length; i++) {
            const x = -200 + (i / this.bufferSize) * 400;
            vPoints.push(x, Math.max(-120, Math.min(80, this.vHistory[i])));
            iPoints.push(x, Math.max(-120, Math.min(80, this.iHistory[i])));
        }
        this.vLine.points(vPoints);
        this.iLine.points(iPoints);
    }

    updateTrace(vDiff, iVal, iterCount) {
        if (this.isHold) return;
        if (iterCount % this.timeStepFactor !== 0) return;

        const centerY = -15;
        const vY = centerY - (vDiff / this.vScale) * 20;
        const iY = centerY - (iVal / this.iScale) * 20;

        this.vHistory.push(vY);
        this.iHistory.push(iY);
        if (this.vHistory.length > this.bufferSize) {
            this.vHistory.shift();
            this.iHistory.shift();
        }

        this._renderLines();
    }
}