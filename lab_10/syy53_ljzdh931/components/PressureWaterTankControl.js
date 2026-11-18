import { BaseComponent } from './BaseComponent.js';

/**
 * PressureWaterTankControl —— 压力水柜液位控制器
 * ═══════════════════════════════════════════════════════════════════════════
 *  面向 PLC 液位控制实验：压力水柜（水泵 + 水柜 + 压力开关）示意组件。
 *
 *  与已有 WaterTankTwoPos / WaterTankLevelControl 的区别：
 *    · 不提供电机控制接口（无 LOC/REM 开关、无启动/停止按钮）——水泵由
 *      仿真电路中的三相电机联动：电机运行（转速 > 阈值）则水泵转动、水柜液位上升；
 *    · 输出接口不用 4~20mA 变送器，而是两个**干接点**：
 *        - 低压动作**常开**触头 lo_com / lo_no：液位低于低压设定值闭合，高于则断开；
 *        - 高压动作**常闭**触头 hi_com / hi_nc：液位高于高压设定值断开，低于则闭合；
 *      两个触头内部均有断开/闭合动画（动触头摆臂），且**无回差**（单一阈值）。
 *
 *  电气行为由 tools/CircuitTopology.js 中的 pressure_water_tank 分支处理：
 *    触头闭合时两端口并入同一节点（等效零阻），断开时开路。
 *
 *  布局（W=330, H=300）：
 *    左下：水泵（无面板外壳，尺寸为原 2/3，底部与水柜底对齐、紧靠水柜左下）
 *    中：  压力水柜（宽度为原 2/3，动态水位 / 刻度 / 高低限标记）
 *    右：  压力开关（宽度为原 1/2，两个竖直触点，上=高压 NC、下=低压 NO，
 *          紧靠水柜右侧无间隙，引线从右侧引出到组件边缘的外部接线端）
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class PressureWaterTankControl extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 300;
        this.H = 300;
        this.width = this.W;
        this.height = this.H;
        this.scale = 1.0;                 // 直接以基础坐标绘制
        this.title = config.title || '压力水柜液位控制';
        this.type = 'pressure_water_tank';
        this.special = 'level_press';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // config 副本（供参数对话框）
        this.config = {
            id: this.id,
            label: this.label,
            sourceMotor: this.sourceMotor,
            speedThreshold: this.speedThreshold,
            lowLimit: this.lowLimit,
            highLimit: this.highLimit,
            capacity: this.capacity,
            pumpMaxFlow: this.pumpMaxFlow,
            outletFlow: this.outletFlow,
        };

        // ── 外部接线端（右侧引出）：上=高压 COM/NC，下=低压 COM/NO ──
        this._addRightPort(this.portX, this.hiTopY, 'hi_com', 'n');
        this._addRightPort(this.portX, this.hiBotY, 'hi_nc', 'p');
        this._addRightPort(this.portX, this.loTopY, 'lo_com', 'n');
        this._addRightPort(this.portX, this.loBotY, 'lo_no', 'p');
    }

    // ═══════════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        // 压力水柜（宽度为原 2/3：180 → 120）
        this.tankX = 100;
        this.tankY = 18;
        this.tankW = 120;
        this.tankH = 264;                 // 底部 = 282

        // 压力开关（紧靠水柜右侧，宽度为原 1/2：138 → 69）
        this.swX = this.tankX + this.tankW;   // 220，无间隙
        this.swY = this.tankY;
        this.swW = 69;
        this.swH = this.tankH;

        // 两个竖直触点：上=高压(NC)、下=低压(NO)；中心 X 在面板内偏左，引线向右引出
        this.cx = this.swX + 24;          // 244
        this.hiCy = this.swY + 72;        // 高压触点中心 Y = 90（上）
        this.loCy = this.swY + 172;       // 低压触点中心 Y = 190（下）
        this.termDy = 16;                 // 上下端子相对中心的偏移
        this.armLen = 32;                 // 动触头摆臂长度（= 2×termDy）

        this.hiTopY = this.hiCy - this.termDy;   // 74
        this.hiBotY = this.hiCy + this.termDy;   // 106
        this.loTopY = this.loCy - this.termDy;   // 174
        this.loBotY = this.loCy + this.termDy;   // 206

        this.portX = 294;                 // 右侧引脚 X（位于组件边缘，紧靠开关面板）
        this.leadEndX = this.portX - 6;   // 引线末端（端口标记左侧）

        // 水泵（尺寸 2/3，底部与水柜底对齐）
        this.pumpScale = 2 / 3;
        this.pumpCX = 52;
        this.pumpCY = 247;                // 底 = 247 + 52×(2/3) ≈ 282，与水柜底对齐
    }

    _initParameters(config) {
        this.label = config.label || '压力水柜';

        // 联动电机
        this.sourceMotor = config.sourceMotor || 'm2';
        this.speedThreshold = config.speedThreshold !== undefined ? parseFloat(config.speedThreshold) : 20;

        // 低压 / 高压设定值（%），无回差
        this.lowLimit = config.lowLimit !== undefined ? parseFloat(config.lowLimit) : 30;
        this.highLimit = config.highLimit !== undefined ? parseFloat(config.highLimit) : 70;

        // 水柜参数
        this.capacity = config.capacity !== undefined ? parseFloat(config.capacity) : 40;      // L
        this.pumpMaxFlow = config.pumpMaxFlow !== undefined ? parseFloat(config.pumpMaxFlow) : 2.5; // L/s
        this.outletFlow = config.outletFlow !== undefined ? parseFloat(config.outletFlow) : 0.3;     // L/s 常排（水位下降速率）
        this.initialLevel = config.initialLevel !== undefined ? parseFloat(config.initialLevel) : 50;
        this.level = this.initialLevel;
        this.displayLevel = this.level;

        // 水泵状态
        this.pump = { running: false, power: 0 };
        this.inletFlowRate = 0;
        this.outletFlowRate = this.outletFlow;

        // 触头状态（无回差）
        this._lowClosed = this.level < this.lowLimit;
        this._highClosed = this.level < this.highLimit;

        // 动画用摆臂角度（每帧缓动 → 视觉效果）
        this._loAngle = this._lowClosed ? 0 : 40;
        this._hiAngle = this._highClosed ? 0 : 40;

        this._lastRpm = 0;
        this._acc = 0;
        this._uiAcc = 0;
        this._pumpAngle = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════════
    _drawStaticParts() {
        this._drawTitle();
        this._drawPump();
        this._drawTankFrame();
        this._drawSwitchPanel();
    }

    _drawTitle() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 2, width: this.W,
            text: this.title, fontSize: 14, fontStyle: 'bold',
            fontFamily: 'Microsoft YaHei', fill: '#1a3a5a', align: 'center',
        }));
    }

    // ── 左下角水泵（无外壳、2/3 尺寸）──
    _drawPump() {
        const s = this.pumpScale;
        const g = new Konva.Group({ x: this.pumpCX, y: this.pumpCY, scaleX: s, scaleY: s });
        this._staticGroup.add(g);

        // 底座
        g.add(new Konva.Rect({ x: -38, y: 40, width: 76, height: 12, fill: '#666', stroke: '#333', strokeWidth: 2, cornerRadius: 4 }));
        // 泵体外壳
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 50, fill: '#4a6a8a', stroke: '#2a3a5a', strokeWidth: 3.5 }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 37, fill: '#7a9aba', stroke: '#3a5a7a', strokeWidth: 2.5 }));
        // 蜗壳隔舌
        g.add(new Konva.Shape({
            sceneFunc: function (context, shape) {
                context.beginPath();
                context.arc(0, 0, 37, -0.3, 0.35, false);
                context.lineTo(44, 12);
                context.lineTo(41, -10.5);
                context.closePath();
                context.fillStrokeShape(shape);
            },
            fill: '#6a8aaa', stroke: '#3a5a7a', strokeWidth: 2, listening: false,
        }));
        // 进出口法兰
        g.add(new Konva.Rect({ x: 42, y: -15, width: 12, height: 30, fill: '#5a7a9a', stroke: '#2a3a5a', strokeWidth: 2.5 }));
        g.add(new Konva.Rect({ x: -54, y: -15, width: 12, height: 30, fill: '#5a7a9a', stroke: '#2a3a5a', strokeWidth: 2.5 }));

        // 水泵到水柜的短管（泵出口 → 水柜左下）
        const pipeY = this.pumpCY;
        const pumpRight = this.pumpCX + 54 * s;
        this._staticGroup.add(new Konva.Line({
            points: [pumpRight, pipeY, this.tankX, pipeY],
            stroke: '#6699cc', strokeWidth: 6, lineCap: 'round',
        }));
        // 水柜进水管接头
        this._staticGroup.add(new Konva.Circle({ x: this.tankX, y: pipeY, radius: 4, fill: '#6699cc', stroke: '#3a6a9a', strokeWidth: 1.5 }));
    }

    // ── 中间压力水柜 ──
    _drawTankFrame() {
        const { tankX: tx, tankY: ty, tankW: tw, tankH: th } = this;

        this._staticGroup.add(new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#e6f0f5', stroke: '#2c5a7a', strokeWidth: 2.5, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: tx + 3, y: ty + 3, width: tw - 6, height: th - 6,
            fill: 'transparent', stroke: '#9abed4', strokeWidth: 1, cornerRadius: 2,
        }));

        // 刻度
        for (let i = 1; i <= 3; i++) {
            const yPos = ty + th - (i * th / 4);
            this._staticGroup.add(new Konva.Line({ points: [tx + 4, yPos, tx + 12, yPos], stroke: '#7a9cbb', strokeWidth: 1 }));
            this._staticGroup.add(new Konva.Text({ x: tx + 14, y: yPos - 5, text: `${i * 25}%`, fontSize: 9, fill: '#d06417' }));
        }

        // 高压限值线（红）/ 低压限值线（蓝）
        const yHigh = ty + th * (1 - this.highLimit / 100);
        const yLow = ty + th * (1 - this.lowLimit / 100);
        this._staticGroup.add(new Konva.Line({
            points: [tx + 2, yHigh, tx + tw - 2, yHigh],
            stroke: '#cc3333', strokeWidth: 1.5, dash: [5, 3],
        }));
        this._staticGroup.add(new Konva.Text({ x: tx + tw - 46, y: yHigh - 11, text: `高 ${this.highLimit}%`, fontSize: 8, fill: '#cc3333' }));
        this._staticGroup.add(new Konva.Line({
            points: [tx + 2, yLow, tx + tw - 2, yLow],
            stroke: '#2a8acc', strokeWidth: 1.5, dash: [5, 3],
        }));
        this._staticGroup.add(new Konva.Text({ x: tx + tw - 46, y: yLow + 3, text: `低 ${this.lowLimit}%`, fontSize: 8, fill: '#2a8acc' }));
    }

    // ── 右侧压力开关（竖直触点、引脚右引、紧贴水柜）──
    _drawSwitchPanel() {
        const { swX: sx, swY: sy, swW: sw } = this;

        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: this.swH,
            fill: '#f2f0ea', stroke: '#8a8578', strokeWidth: 1.5, cornerRadius: 6,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx, y: sy + 4, width: sw, text: '压力开关',
            fontSize: 10, fontStyle: 'bold', fill: '#444', align: 'center',
        }));

        // 触点名称标签（上=高压 NC，下=低压 NO）
        this._staticGroup.add(new Konva.Text({
            x: sx + 2, y: this.hiCy - 37, width: sw - 4, text: '高压 NC',
            fontSize: 8, fontStyle: 'bold', fill: '#cc3333', align: 'left',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx + 2, y: this.loCy - 37, width: sw - 4, text: '低压 NO',
            fontSize: 8, fontStyle: 'bold', fill: '#2a8acc', align: 'left',
        }));

        // 两个竖直触点（高压上、低压下）
        this._drawContactStatic(this.cx, this.hiTopY, this.hiBotY, this.portX, 'hi');
        this._drawContactStatic(this.cx, this.loTopY, this.loBotY, this.portX, 'lo');
    }

    /** 竖直触点静态部分：上下固定触点 + 向右引出的两条引线 + 端口标记 */
    _drawContactStatic(cx, topY, botY, portX, key) {
        // 上下固定触点
        this._staticGroup.add(new Konva.Circle({ x: cx, y: topY, radius: 4, fill: '#888', stroke: '#555', strokeWidth: 1.4 }));
        this._staticGroup.add(new Konva.Circle({ x: cx, y: botY, radius: 4, fill: '#888', stroke: '#555', strokeWidth: 1.4 }));

        // 引线：自触点水平向右引出至端口
        this._staticGroup.add(new Konva.Line({ points: [cx + 4, topY, portX - 6, topY], stroke: '#666', strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [cx + 4, botY, portX - 6, botY], stroke: '#666', strokeWidth: 2 }));
    }

    _addRightPort(x, y, portId, polarity = 'n') {
        // 端口标记方块 + 实际接线端口
        this._staticGroup.add(new Konva.Rect({
            x: x - 6, y: y - 6, width: 12, height: 12,
            fill: '#ddd6c0', stroke: '#666', strokeWidth: 1.5, cornerRadius: 2,
        }));
        this.addPort(x, y, portId, 'wire', polarity);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const { tankX: tx, tankY: ty, tankW: tw, tankH: th } = this;

        // 水位
        this._waterFill = new Konva.Rect({
            x: tx + 4, y: ty + th - 4, width: tw - 8, height: 0,
            fill: '#3788cc', cornerRadius: 2, opacity: 0.85,
        });
        this._levelText = new Konva.Text({
            x: tx + 3, y: ty + 6, text: '液位: 0.0%',
            fontSize: 13, fontStyle: 'bold', fill: '#094e11',
        });
        d.add(this._waterFill, this._levelText);

        // 水泵叶轮（同 2/3 缩放）
        const s = this.pumpScale;
        this._impeller = new Konva.Group({ x: this.pumpCX, y: this.pumpCY, scaleX: s, scaleY: s });
        this._addImpellerBlades(this._impeller);
        d.add(this._impeller);

        // 水泵状态文字（水泵上方）
        this._pumpStatusText = new Konva.Text({
            x: 0, y: 196, width: 104,
            text: '水泵 停止', fontSize: 12, fontStyle: 'bold', fill: '#888', align: 'center',
        });
        d.add(this._pumpStatusText);

        // 两个触点的竖直动触头摆臂 + 状态文字（上=高压，下=低压）
        this._hiArm = this._createArm(this.cx, this.hiTopY, this.armLen);
        this._loArm = this._createArm(this.cx, this.loTopY, this.armLen);

        this._hiStateText = new Konva.Text({
            x: this.swX, y: this.hiCy + 22, width: this.swW,
            text: '断开', fontSize: 10, fontStyle: 'bold', fill: '#888', align: 'center',
        });
        this._loStateText = new Konva.Text({
            x: this.swX, y: this.loCy + 22, width: this.swW,
            text: '断开', fontSize: 10, fontStyle: 'bold', fill: '#888', align: 'center',
        });
        d.add(this._hiStateText, this._loStateText);
    }

    _addImpellerBlades(grp) {
        const bladeCount = 6;
        for (let i = 0; i < bladeCount; i++) {
            const a = (i / bladeCount) * Math.PI * 2;
            const r1 = 11, r2 = 31, sweep = 0.5;
            const x1 = Math.cos(a) * r1, y1 = Math.sin(a) * r1;
            const x2 = Math.cos(a + sweep) * r2, y2 = Math.sin(a + sweep) * r2;
            grp.add(new Konva.Shape({
                sceneFunc: function (context, shape) {
                    context.beginPath();
                    context.moveTo(x1, y1);
                    const cpx = Math.cos(a + sweep * 0.6) * (r1 + r2) * 0.55;
                    const cpy = Math.sin(a + sweep * 0.6) * (r1 + r2) * 0.55;
                    context.quadraticCurveTo(cpx, cpy, x2, y2);
                    const thick = 12, ang = a + sweep;
                    const txx = Math.cos(ang + Math.PI / 2) * thick;
                    const tyy = Math.sin(ang + Math.PI / 2) * thick;
                    context.lineTo(x2 + txx, y2 + tyy);
                    const cx2 = Math.cos(a - sweep * 0.4) * (r1 + r2) * 0.5;
                    const cy2 = Math.sin(a - sweep * 0.4) * (r1 + r2) * 0.5;
                    context.quadraticCurveTo(cx2 + txx, cy2 + tyy, x1 + txx, y1 + tyy);
                    context.closePath();
                    context.fillStrokeShape(shape);
                },
                fill: '#cce0ff', stroke: '#2a5a8a', strokeWidth: 1.2, opacity: 0.92, listening: false,
            }));
        }
        grp.add(new Konva.Circle({ radius: 10, fill: '#e8cc66', stroke: '#aa8800', strokeWidth: 2.5 }));
        grp.add(new Konva.Circle({ radius: 4.5, fill: '#ccaa44', stroke: '#886600', strokeWidth: 1.2 }));
    }

    /** 竖直动触头：以下端固定触点为支点，闭合时竖直（rotation 0），断开时向左摆 */
    _createArm(cx, topY, len) {
        const g = new Konva.Group({ x: cx, y: topY });
        const arm = new Konva.Line({ points: [0, 0, 0, len], stroke: '#c0392b', strokeWidth: 3.2, lineCap: 'round' });
        const pivot = new Konva.Circle({ radius: 2.6, fill: '#aa8800', stroke: '#7a6028', strokeWidth: 1 });
        g.add(arm, pivot);
        this._dynamicGroup.add(g);
        return g;
    }

    _bindInteraction() {
        // 部件热区（供工作流箭头定位 / 点击识别）
        this.addClickablePart('pump', 0, 190, 104, 100);
        this.addClickablePart('tank', this.tankX, this.tankY, this.tankW, this.tankH);
        this.addClickablePart('hi-contact', this.swX, this.hiCy - 24, this.swW, 60);
        this.addClickablePart('lo-contact', this.swX, this.loCy - 24, this.swW, 60);
    }

    // ═══════════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════════
    tick(dt) {
        dt = dt || 1 / 20;

        // 触头摆臂缓动动画（每帧）：闭合 0°，断开 +40°（向左摆）
        const loTarget = this._lowClosed ? 0 : 40;
        const hiTarget = this._highClosed ? 0 : 40;
        const k = Math.min(1, dt * 12);
        this._loAngle += (loTarget - this._loAngle) * k;
        this._hiAngle += (hiTarget - this._hiAngle) * k;
        if (this._loArm) this._loArm.rotation(this._loAngle);
        if (this._hiArm) this._hiArm.rotation(this._hiAngle);

        // 叶轮旋转
        if (this._impeller) {
            if (this.pump.running) {
                this._pumpAngle = (this._pumpAngle + dt * 540) % 360;
                this._impeller.rotation(this._pumpAngle);
            } else {
                this._impeller.rotation(0);
            }
        }

        // 物理量 10Hz
        this._acc += dt;
        if (this._acc >= 0.1) {
            this._updatePhysics(0.1);
            this._acc = 0;
        }

        // UI 文字 5Hz
        this._uiAcc += dt;
        if (this._uiAcc >= 0.2) {
            this._updateUI();
            this._uiAcc = 0;
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    _updatePhysics(dt) {
        // 电机联动：电机运行（转速 > 阈值）→ 水泵工作
        const motor = this.sys && this.sys.comps ? this.sys.comps[this.sourceMotor] : null;
        const rpm = (motor && typeof motor.getSpeed === 'function') ? motor.getSpeed() : 0;
        this._lastRpm = rpm;
        const running = Math.abs(rpm) > this.speedThreshold;

        // 水泵随电机立即启停（无功率平滑滞后）：电机一停，水泵立即停
        this.pump.power = running ? 1 : 0;
        this.pump.running = running;

        this.inletFlowRate = this.pump.power * this.pumpMaxFlow;
        this.outletFlowRate = this.outletFlow;

        const net = this.inletFlowRate - this.outletFlowRate;
        const dLevel = (net / this.capacity) * dt * 100;
        this.level = Math.max(0, Math.min(100, this.level + dLevel));

        // 两个触头，无回差（单一阈值）
        this._lowClosed = this.level < this.lowLimit;      // 低于低压设定值闭合，高于断开
        this._highClosed = this.level <= this.highLimit;   // 高于高压设定值断开，低于闭合
    }

    _updateUI() {
        const { tankX: tx, tankY: ty, tankW: tw, tankH: th } = this;

        this.displayLevel += (this.level - this.displayLevel) * 0.4;
        if (Math.abs(this.displayLevel - this.level) < 0.3) this.displayLevel = this.level;

        // 水位
        const fillH = (this.displayLevel / 100) * (th - 8);
        this._waterFill.height(fillH);
        this._waterFill.y(ty + th - 4 - fillH);
        this._levelText.text(`液位: ${this.level.toFixed(1)}%`);

        // 水泵状态
        if (this.pump.running) {
            this._pumpStatusText.text('水泵 运行中');
            this._pumpStatusText.fill('#0a810a');
        } else {
            this._pumpStatusText.text('水泵 停止');
            this._pumpStatusText.fill('#888');
        }

        // 触点状态文字/颜色（摆臂动画在 tick 中）
        this._applyContactText(this._loStateText, this._lowClosed);
        this._applyContactText(this._hiStateText, this._highClosed);
    }

    _applyContactText(textNode, closed) {
        if (!textNode) return;
        textNode.text(closed ? '闭合' : '断开');
        textNode.fill(closed ? '#0a810a' : '#888');
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════
    getLevel() { return this.level; }
    isPumpRunning() { return this.pump.running; }
    getLowContactClosed() { return this._lowClosed; }
    getHighContactClosed() { return this._highClosed; }

    setLevel(percent) {
        this.level = Math.max(0, Math.min(100, percent));
        this._lowClosed = this.level < this.lowLimit;
        this._highClosed = this.level <= this.highLimit;
    }

    setLimits(low, high) {
        this.lowLimit = low;
        this.highLimit = high;
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text', get: c => c.label },
            { label: '联动电机 id', key: 'sourceMotor', type: 'text', get: c => c.sourceMotor },
            { label: '电机运行阈值 (r/min)', key: 'speedThreshold', type: 'number', get: c => c.speedThreshold },
            { label: '低压设定值 (%)', key: 'lowLimit', type: 'number', get: c => c.lowLimit },
            { label: '高压设定值 (%)', key: 'highLimit', type: 'number', get: c => c.highLimit },
            { label: '水柜容积 (L)', key: 'capacity', type: 'number', get: c => c.capacity },
            { label: '水泵最大流量 (L/s)', key: 'pumpMaxFlow', type: 'number', get: c => c.pumpMaxFlow },
            { label: '出水流量 (L/s)', key: 'outletFlow', type: 'number', get: c => c.outletFlow },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.sourceMotor !== undefined) this.sourceMotor = cfg.sourceMotor;
        if (cfg.speedThreshold !== undefined) this.speedThreshold = parseFloat(cfg.speedThreshold) || 0;
        if (cfg.lowLimit !== undefined) this.lowLimit = parseFloat(cfg.lowLimit);
        if (cfg.highLimit !== undefined) this.highLimit = parseFloat(cfg.highLimit);
        if (cfg.capacity !== undefined) this.capacity = Math.max(1, parseFloat(cfg.capacity));
        if (cfg.pumpMaxFlow !== undefined) this.pumpMaxFlow = parseFloat(cfg.pumpMaxFlow);
        if (cfg.outletFlow !== undefined) this.outletFlow = parseFloat(cfg.outletFlow);
        this.config = Object.assign({}, this.config, cfg);
        this.markDirty();
        this._refreshIfDirty(true);
    }

    destroy() {
        super.destroy?.();
    }
}

export default PressureWaterTankControl;
