import { BaseComponent } from './BaseComponent.js';

/**
 * 双踪示波器组件
 *
 * 功能概述：
 * - 在画布上绘制双通道（电压/电流）示波器界面，包括网格、波形、状态文本和交互按钮；
 * - 支持多档电压/电流/时基缩放（`vScales`, `iScales`, `tScales`）；
 * - 支持触发模式（`AUTO` / `NORM`），在 `NORM` 模式下等待上升沿触发；
 * - 内部以循环缓冲区保存波形采样（`vHistory`, `iHistory`），通过 `updateTrace` 写入数据并按档位采样；
 * - 仅更改显示和注释，不改变原有信号处理逻辑。
 *
 * 端口布局（在构造器中注册）：
 * - 左侧电流输入端口（标记为 'p' 或 'r' 用于显示/连接）
 * - 右侧电压输入端口
 *
 * 备注：视觉元素使用 Konva 对象构建，调用 `this._refreshCache()` 刷新缓存。
 */
export class Oscilloscope extends BaseComponent {
    /**
     * 构造器
     * @param {Object} config - 组件配置（来自项目场景）
     * @param {Object} sys - 全局系统对象（用于请求重绘等）
     */
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oscilloscope';
        this.cache ='fixed';    
        this._initGroups();
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

        // 初始化缓冲区与视图元素
        // _resetBuffers: 分配 vHistory/iHistory 并置位 writePtr
        // initVisuals: 构建 Konva 图形对象并绑定交互
        this._resetBuffers();
        this.initVisuals();

        // 端口布局
        this.addPort(-120, 180, 'l', 'wire', 'p');
        this.addPort(-60, 180, 'r', 'wire');
        this.addPort(70, 180, 'p', 'wire', 'p');
        this.addPort(130, 180, 'n', 'wire');
    }

    /**
     * 重置/初始化波形缓冲区
     * - 将历史数组填充为屏幕中心 Y 值，重置写指针与触发状态
     */
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
        // 参数：x - 水平偏移，label - 按钮文字，color - 填充色，onClick - 点击回调
        // 返回：{ group, circle }，并自动添加到 `_interactGroup` 中
        const createInteractBtn = (x, label, color, onClick) => {
            const btnGroup = new Konva.Group({ x, y: 128 });
            const circle = new Konva.Circle({ radius: 15, fill: color, stroke: '#1a252f', strokeWidth: 2 });
            const txt = new Konva.Text({ x: -25, y: 18, text: label, fontSize: 9, fill: colors.text, width: 50, align: 'center' });
            btnGroup.add(circle, txt);
            // 鼠标按下触发回调并更新状态文本
            btnGroup.on('mousedown', (e) => {
                onClick();
                this.updateStatus();
            });
            btnGroup.on('dblclick', (e) => {
                e.cancelBubble = true;
            });
            this._interactGroup.add(btnGroup); // 关键：确保按钮被添加到组件组中
            return { group: btnGroup, circle };
        };


        // 波形线条
        this.vLine = new Konva.Line({ stroke: colors.vTrace, strokeWidth: 2, lineJoin: 'round' });
        this.iLine = new Konva.Line({ stroke: colors.iTrace, strokeWidth: 2, lineJoin: 'round' });

        // 端口文字说明
        const tCur = new Konva.Text({ x: -127, y: 165, text: '电流', fontSize: 10, fill: colors.iTrace, width: 70, align: 'center' });
        const tVol = new Konva.Text({ x: 62, y: 165, text: '电压', fontSize: 10, fill: colors.vTrace, width: 70, align: 'center' });

        // 将所有元素添加到主组
        this._staticGroup.add(body, screenRect, this.title, this.gridGroup, this.statusText, this.vLine, this.iLine, tCur, tVol);
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
        // 切换触发模式：AUTO <-> NORM；NORM 模式下等上升沿触发
        const trigBtn = createInteractBtn(180, "触发", colors.btnNormal, () => {
            this.triggerMode = (this.triggerMode === 'AUTO' ? 'NORM' : 'AUTO');
            trigBtn.circle.fill(this.triggerMode === 'NORM' ? colors.btnTrig : colors.btnNormal);
            this.isTriggered = false;
            this.writePtr = 0;
        });

        this.updateStatus();
    }

    updateStatus() {
        // 刷新状态文本（模式、刻度、时基）并刷新缓存
        const modeText = this.triggerMode === 'NORM' ? "TRG" : "AUTO";
        const vScale = this.vScales[this.vIdx];
        const iScale = this.iScales[this.iIdx] * 1000;
        this.statusText.text(`MOD:${modeText} | V:${vScale}V/div | I:${iScale}mA/div | Step:${this.tScales[this.tIdx]}x`);
        this._refreshCache();
    }

    _renderLines() {
        const vPoints = [], iPoints = [];
        // 绘制波形线条
        // AUTO 模式下绘制整个循环缓冲区（从 writePtr 起），
        // NORM 模式下仅绘制已写入的数据长度（writePtr）。
        const limit = (this.triggerMode === 'AUTO') ? this.bufferSize : this.writePtr;

        for (let i = 0; i < limit; i++) {
            const dataIdx = (this.triggerMode === 'AUTO') ? (this.writePtr + i) % this.bufferSize : i;
            const x = -200 + (i / this.bufferSize) * 400;

            // 限幅到屏幕范围，防止 points 数组出现越界坐标
            vPoints.push(x, Math.max(-118, Math.min(78, this.vHistory[dataIdx])));
            iPoints.push(x, Math.max(-118, Math.min(78, this.iHistory[dataIdx])));
        }
        this.vLine.points(vPoints);
        this.iLine.points(iPoints);
    }

    updateTrace(vDiff, iVal, iterCount) {
        // 根据时基档位进行抽样：只有当 iterCount 与当前时基整除时才写入波形
        if (iterCount % this.tScales[this.tIdx] !== 0) return;

        const centerY = -20; // 屏幕中心 Y，用于将信号映射到画布坐标
        const vScale = this.vScales[this.vIdx];
        const iScale = this.iScales[this.iIdx];

        // NORM 触发逻辑：等待上升沿（lastTriggerVal <= 0 且当前 vDiff > 0）触发一次，
        // 触发后从 writePtr=0 开始记录直到缓冲区满；AUTO 模式则不断循环写入。
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

        // 将物理量映射为屏幕 Y 坐标：每个刻度对应 20 像素
        const vY = centerY - (vDiff / vScale) * 20;
        const iY = centerY - (iVal / iScale) * 20;

        this.vHistory[this.writePtr] = vY;
        this.iHistory[this.writePtr] = iY;

        this.writePtr++;

        if (this.triggerMode === 'AUTO') {
            // 自动模式循环覆盖缓冲区
            this.writePtr %= this.bufferSize;
            this._renderLines();
        } else {
            // 触发模式写满一次后渲染并重置触发状态
            if (this.writePtr >= this.bufferSize) {
                this._renderLines();
                this.writePtr = 0;
                this.isTriggered = false;
            }
        }
        this._refreshCache();
    }


    tick(dt) {
        const s = this.sys?.voltageSolver;
        if (!s) return;
        const cVH = s.portToCluster.get(`${this.id}_wire_p`);
        const cVL = s.portToCluster.get(`${this.id}_wire_n`);
        const vDiff = (s.nodeVoltages.get(cVH) || 0) - (s.nodeVoltages.get(cVL) || 0);
        const iVal = this.physCurrent || 0;
        this.updateTrace(vDiff, iVal, s.globalIterCount);
    }

    destroy() {
        // 清理工作交由基类处理（若基类实现了 destroy）
        super.destroy?.();
    }
}
