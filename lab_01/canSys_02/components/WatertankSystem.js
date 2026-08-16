import { BaseComponent } from './BaseComponent.js';

/**
 * WaterTankSystem —— 水箱液位控制系统
 *
 * 布局：整体尺寸 W=480, H=280
 * 左侧：水泵及控制面板区域 (W=120)  与水箱等高
 * 中间：水箱区域 (W=170)
 * 右侧：差压变送器 (W=100)，H/L 取压口均在左侧
 *       H端→水箱底部右侧，L端→水箱顶部右侧（差压法测液位）
 *
 * 外部接线端（顶边，左→右）：
 *   水泵控制：pump_ctrl_l, pump_ctrl_r (开关量输入，接通=运行)
 *   液位变送器：lt_l, lt_r (4-20mA 输出)
 */
export class WaterTankSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 整体尺寸 ─────────────────
        this.W = config.W || 480;
        this.H = config.H || 280;
        this.scale = 1.35;
        this.title = config.title || '水箱液位控制';
        this.type = 'transmitter_2wire';
        this.special = 'diff_level';
        this.cache = false;

        // ── 水箱参数 ─────────────────
        this.tankW = 170;          // 水箱宽度

        // 三个区域 X 定位
        this.controlX = 15;        // 左侧控制面板 X
        this.controlW = 120;       // 控制面板宽度
        this.panelY = 5;           // 控制面板 Y
        this.panelH = this.H/2 ; // 控制面板高度（水箱与此等高）

        this.tankH = this.H - 10;  // 水箱高度 = 控制面板高度
        this.tankX = this.controlX + this.controlW + 15; // 中间水箱 X
        this.tankY = this.panelY;  // 水箱与控制面板顶部对齐

        this.txX = 365;            // 右侧变送器 X
        this.txW = 100;            // 变送器宽度
        // 变送器 Y 定位稍后由 _drawTransmitter 基于水箱位置计算

        // 液位参数
        this.level = 0;            // 当前液位 (0-100%)，0%为空，100%为满
        this.targetLevel = 0;      // 目标液位（用于控制逻辑）
        this.capacity = 100;       // 最大容积 (L)
        this.area = this.tankW * this.tankH; // 截面积（像素单位，用于视觉）

        // 进出水参数
        this.inletFlowRate = 0;     // 进水流量 (L/s) 0-2
        this.outletFlowRate = 0.5;  // 出水流量 (L/s)，常开，固定值

        // 出水截止阀
        this.outletValve = {
            open: true,             // 阀门打开/关闭状态
            nominalFlow: 0.5,       // 阀门打开时的名义流量
        };

        // ── 水泵 ──────────────────
        this.pump = {
            mode: 'local',          // 'local' 或 'remote'
            running: false,         // 实际运行状态
            targetRunning: false,   // 目标运行状态（本地按钮或远程信号）
            power: 0,               // 平滑功率 0-1
            maxFlow: 2.0,           // 最大进水流量 (L/s)
        };

        // ── 差压变送器 (4-20mA) ──
        this.transmitter = {
            output4ma: 4,
            output20ma: 20,
            currentOutput: 4,
            fault: null
        };

        this.displayLevel = 0;

        // ── 支持整体缩放的组 ──
        this.scaleGroup = new Konva.Group({scaleX:this.scale,scaleY:this.scale});
        this.group.add(this.scaleGroup);

        // 此组件有旋转动画，禁用缓存避免 Konva cache 对 height=0 元素的警告
        // this._refreshCache = function() {
        //     if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
        // };

        // 物理更新定时器 (100ms)
        this._physicalTimer = setInterval(() => this._updatePhysics(), 100);
        // UI 更新定时器 (200ms)
        this._uiTimer = setInterval(() => this._updateUI(), 200);

        // 绘制组件（无外框）
        this._drawPumpAndControl();
        this._drawTank();
        this._drawTransmitter();
        this._drawPipes();
        this._drawExternalPorts();

        // 初始状态
        this.level = 50;
        this.displayLevel = 50;
        this._updateTransmitterOutput();
    }

    // ═══════════════════════════════════════════════════════════
    // 1. 左侧控制面板（上下两部分）
    //    上半：模式开关 + 启动/停止按钮
    //    下半：逼真水泵动画图标
    // ═══════════════════════════════════════════════════════════
    _drawPumpAndControl() {
        const panelX = this.controlX;
        const panelW = this.controlW;
        const panelY = this.panelY;
        const panelH = this.panelH;

        // ── 面板底板 ──
        this.scaleGroup.add(new Konva.Rect({
            x: panelX, y: panelY,
            width: panelW, height: panelH,
            fill: '#e8e6e0',
            stroke: '#999', strokeWidth: 1.5,
            cornerRadius: 6,
        }));

        // ── 面板标题 ──
        this.scaleGroup.add(new Konva.Text({
            x: panelX, y: panelY + 6,
            width: panelW,
            text: '水泵控制',
            fontSize: 12, fontStyle: 'bold',
            fill: '#444', align: 'center'
        }));

        // ══════════════ 上半部分 ══════════════
        // ── 手动/遥控转换开关 ──
        const switchX = panelX + panelW / 2;
        const switchY = panelY + 40;

        this.scaleGroup.add(new Konva.Circle({
            x: switchX, y: switchY,
            radius: 15,
            fill: '#555',
            stroke: '#222', strokeWidth: 2
        }));

        this.scaleGroup.add(new Konva.Text({
            x: switchX - 40, y: switchY - 10,
            text: 'LOC', fontSize: 10, fontStyle: 'bold',
            fill: '#222', align: 'center'
        }));
        this.scaleGroup.add(new Konva.Text({
            x: switchX + 20, y: switchY - 10,
            text: 'REM', fontSize: 10, fontStyle: 'bold',
            fill: '#222', align: 'center'
        }));

        this._modeKnob = new Konva.Group({ x: switchX, y: switchY, cursor: 'pointer' });
        this._modeKnob.add(new Konva.Circle({ radius: 11, fill: '#888', stroke: '#000', strokeWidth: 1.5 }));
        this._modeKnob.add(new Konva.Rect({ x: -1.5, y: -9, width: 3, height: 9, fill: '#ffcc00', cornerRadius: 1 }));
        this._modeKnob.rotation(-45);
        this._modeKnob.on('click', () => {
            this.pump.mode = this.pump.mode === 'local' ? 'remote' : 'local';
            this._modeKnob.rotation(this.pump.mode === 'local' ? -45 : 45);
            this.pump.targetRunning = false;
            if (this.pump.mode === 'remote') this._updateRemoteCommand();
            this._refreshCache();
        });
        this.scaleGroup.add(this._modeKnob);

        // ── 启动按钮 ──
        const startBtnX = panelX + 26;
        const startBtnY = panelY + 85;
        this._startBtn = new Konva.Circle({
            x: startBtnX, y: startBtnY,
            radius: 14,
            fill: '#0a810a',
            stroke: '#000', strokeWidth: 2,
            cursor: 'pointer'
        });
        this._startBtn.on('mousedown', () => {
            if (this.pump.mode === 'local') {
                this.pump.targetRunning = true;
                this._startBtn.y(startBtnY + 2);
            }
        });
        this._startBtn.on('mouseup mouseleave', () => { this._startBtn.y(startBtnY); });
        this.scaleGroup.add(this._startBtn);
        this.scaleGroup.add(new Konva.Text({
            x: startBtnX - 10, y: startBtnY + 18,
            text: '启动', fontSize: 10, fill: '#444', align: 'center'
        }));

        // ── 停止按钮 ──
        const stopBtnX = panelX + panelW - 26;
        const stopBtnY = panelY + 85;
        this._stopBtn = new Konva.Circle({
            x: stopBtnX, y: stopBtnY,
            radius: 14,
            fill: '#871212',
            stroke: '#000', strokeWidth: 2,
            cursor: 'pointer'
        });
        this._stopBtn.on('mousedown', () => {
            if (this.pump.mode === 'local') {
                this.pump.targetRunning = false;
                this._stopBtn.y(stopBtnY + 2);
            }
        });
        this._stopBtn.on('mouseup mouseleave', () => { this._stopBtn.y(stopBtnY); });
        this.scaleGroup.add(this._stopBtn);
        this.scaleGroup.add(new Konva.Text({
            x: stopBtnX - 10, y: stopBtnY + 18,
            text: '停止', fontSize: 10, fill: '#444', align: 'center'
        }));

        // ══════════════ 下半部分：水泵动画图标（工业离心泵风格 - 放大1.5倍）══════════════
        const pumpCX = panelX + panelW / 2;      // 水泵图标中心 X
        const pumpCY = panelY + 220;              // 水泵图标中心 Y（保持原位置，因为1.5倍不会超出太多）

        this._pumpAnimTime = 0;

        const pumpGrp = new Konva.Group({ x: pumpCX, y: pumpCY });

        // ── 泵体底座（原宽度50→75，高度8→12）──
        pumpGrp.add(new Konva.Rect({
            x: -38, y: 38,
            width: 76, height: 12,
            fill: '#666', stroke: '#333', strokeWidth: 2,
            cornerRadius: 4,
        }));

        // ── 泵体主外壳（半径 34→51）──
        pumpGrp.add(new Konva.Circle({
            radius: 51,
            fill: '#4a6a8a',
            stroke: '#2a3a5a', strokeWidth: 3.5,
        }));
        pumpGrp.add(new Konva.Circle({
            radius: 38,
            fill: '#7a9aba',
            stroke: '#3a5a7a', strokeWidth: 2.5,
        }));

        // ── 出水口（右侧法兰短管，宽度8→12，高度22→33）──
        pumpGrp.add(new Konva.Rect({
            x: 42, y: -15,
            width: 12, height: 33,
            fill: '#5a7a9a', stroke: '#2a3a5a', strokeWidth: 2.5,
        }));
        pumpGrp.add(new Konva.Circle({ x: 48, y: -9, radius: 3, fill: '#aaa' }));
        pumpGrp.add(new Konva.Circle({ x: 48, y: 9, radius: 3, fill: '#aaa' }));

        // ── 进水口（左侧法兰短管，宽度8→12，高度22→33）──
        pumpGrp.add(new Konva.Rect({
            x: -54, y: -12,
            width: 12, height: 33,
            fill: '#5a7a9a', stroke: '#2a3a5a', strokeWidth: 2.5,
        }));
        pumpGrp.add(new Konva.Circle({ x: -48, y: -6, radius: 3, fill: '#aaa' }));
        pumpGrp.add(new Konva.Circle({ x: -48, y: 12, radius: 3, fill: '#aaa' }));

        // ── 蜗壳隔舌（泵体内壁凸起，放大1.5倍）──
        const tongue = new Konva.Shape({
            sceneFunc: function (context, shape) {
                context.beginPath();
                context.arc(0, 0, 38, -0.3, 0.35, false);
                context.lineTo(45, 12);
                context.lineTo(42, -10.5);
                context.closePath();
                context.fillStrokeShape(shape);
            },
            fill: '#6a8aaa',
            stroke: '#3a5a7a',
            strokeWidth: 2,
        });
        pumpGrp.add(tongue);

        // ── 叶轮（旋转叶片，放大1.5倍）──
        this._impeller = new Konva.Group({ x: 0, y: 0 });

        const bladeCount = 6;
        for (let i = 0; i < bladeCount; i++) {
            const baseAngle = (i / bladeCount) * Math.PI * 2;
            const r1 = 11;       // 原7 → 10.5 → 11
            const r2 = 32;       // 原21 → 31.5 → 32
            const sweep = 0.5;

            const x1 = Math.cos(baseAngle) * r1;
            const y1 = Math.sin(baseAngle) * r1;
            const x2 = Math.cos(baseAngle + sweep) * r2;
            const y2 = Math.sin(baseAngle + sweep) * r2;

            const blade = new Konva.Shape({
                sceneFunc: function (context, shape) {
                    context.beginPath();
                    context.moveTo(x1, y1);
                    const cpx = Math.cos(baseAngle + sweep * 0.6) * (r1 + r2) * 0.55;
                    const cpy = Math.sin(baseAngle + sweep * 0.6) * (r1 + r2) * 0.55;
                    context.quadraticCurveTo(cpx, cpy, x2, y2);
                    const thickness = 13;    // 原8.5 → 12.75 → 13
                    const angle = baseAngle + sweep;
                    const tx = Math.cos(angle + Math.PI / 2) * thickness;
                    const ty = Math.sin(angle + Math.PI / 2) * thickness;
                    context.lineTo(x2 + tx, y2 + ty);
                    const cx2 = Math.cos(baseAngle - sweep * 0.4) * (r1 + r2) * 0.5;
                    const cy2 = Math.sin(baseAngle - sweep * 0.4) * (r1 + r2) * 0.5;
                    context.quadraticCurveTo(cx2 + tx, cy2 + ty, x1 + tx, y1 + ty);
                    context.closePath();
                    context.fillStrokeShape(shape);
                },
                fill: '#cce0ff',
                stroke: '#2a5a8a',
                strokeWidth: 1.2,
                opacity: 0.9,
            });
            this._impeller.add(blade);
        }

        // 叶轮中心轮毂（半径7→10.5→11）
        this._impeller.add(new Konva.Circle({
            radius: 11,
            fill: '#e8cc66',
            stroke: '#aa8800', strokeWidth: 2.5,
        }));
        this._impeller.add(new Konva.Circle({
            radius: 5,
            fill: '#ccaa44',
            stroke: '#886600', strokeWidth: 1.2,
        }));

        pumpGrp.add(this._impeller);
        this.scaleGroup.add(pumpGrp);

        // ── 进出水管道（面板边界到水箱，管径适当加粗）──
        const pipeY = pumpCY;
        this.scaleGroup.add(new Konva.Line({
            points: [panelX + panelW - 20, pipeY, this.tankX, pipeY],
            stroke: '#6699cc',
            strokeWidth: 8,        // 原6 → 8
            dash: [10, 5],
        }));

        // ── 水泵状态文字 ──
        this._pumpStatusText = new Konva.Text({
            x: panelX, y: panelY + panelH - 22,
            width: panelW,
            text: '停止',
            fontSize: 13,         // 原12 → 13
            fontStyle: 'bold',
            fill: '#888', align: 'center',
        });
        this.scaleGroup.add(this._pumpStatusText);

        // 存引用
        this._pumpGrp = pumpGrp;
        this._pumpIconCY = pumpCY;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. 中间水箱
    // ═══════════════════════════════════════════════════════════
    _drawTank() {
        // 水箱外框
        this.scaleGroup.add(new Konva.Rect({
            x: this.tankX, y: this.tankY,
            width: this.tankW, height: this.tankH,
            fill: '#e6f0f5',
            stroke: '#2c5a7a', strokeWidth: 2.5,
            cornerRadius: 3,
        }));

        // 水箱内壁高光
        this.scaleGroup.add(new Konva.Rect({
            x: this.tankX + 3, y: this.tankY + 3,
            width: this.tankW - 6, height: this.tankH - 6,
            fill: 'transparent',
            stroke: '#9abed4', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 水量显示（动态水位）
        this._waterFill = new Konva.Rect({
            x: this.tankX + 4, y: this.tankY + this.tankH - 4,
            width: this.tankW - 8, height: 0,
            fill: '#3788cc',
            cornerRadius: 2,
            opacity: 0.85,
        });
        this.scaleGroup.add(this._waterFill);

        // ── 液位刻度（左侧）──
        for (let i = 1; i <= 3; i++) {
            const yPos = this.tankY + this.tankH - (i * this.tankH / 4);
            this.scaleGroup.add(new Konva.Line({
                points: [this.tankX + 5, yPos, this.tankX + 15, yPos],
                stroke: '#7a9cbb', strokeWidth: 1,
            }));
            this.scaleGroup.add(new Konva.Text({
                x: this.tankX + 17, y: yPos - 5,
                text: `${i * 25}%`,
                fontSize: 10, fill: '#d06417',
            }));
        }

        // 液位数字显示（水箱上方）
        this._levelText = new Konva.Text({
            x: this.tankX + 3, y: this.tankY - 20,
            text: '液位: 0.0%',
            fontSize: 15, fontStyle: 'bold',
            fill: '#094e11',
        });
        this.scaleGroup.add(this._levelText);

        // 出水口（水箱右下角）
        const outletX = this.tankX + this.tankW - 6;
        const outletY = this.tankY + this.tankH - 20;
        this.scaleGroup.add(new Konva.Circle({
            x: outletX, y: outletY,
            radius: 4,
            fill: '#999',
            stroke: '#555', strokeWidth: 1.5,
        }));
        this.scaleGroup.add(new Konva.Line({
            points: [outletX, outletY, outletX + 40, outletY ],
            stroke: '#6699cc', strokeWidth: 5,
        }));
        this.scaleGroup.add(new Konva.Text({
            x: outletX + 8, y: outletY - 16,
            text: '出水', fontSize: 12, fill: '#555',
        }));

        // ── 出水截止阀 ──
        const valveX = outletX + 50;  // 阀门位置在出水口向右
        const valveY = outletY - 2;
        this._valveGroup = new Konva.Group({ x: valveX, y: valveY, cursor: 'pointer' });
        
        // 阀体外壳
        this._valveGroup.add(new Konva.Rect({
            x: -14, y: -18,
            width: 28, height: 36,
            fill: '#888',
            stroke: '#444', strokeWidth: 2,
            cornerRadius: 4,
        }));
        
        // 阀体内部背景
        this._valveGroup.add(new Konva.Rect({
            x: -12, y: -16,
            width: 24, height: 32,
            fill: '#ddd',
            stroke: '#666', strokeWidth: 1,
            cornerRadius: 2,
        }));
        
        // 阀杆（可动部分）
        this._valveHandle = new Konva.Group({ x: 0, y: 0 ,ratation:90});
        this._valveHandle.add(new Konva.Rect({
            x: -2, y: -10,
            width: 4, height: 20,
            fill: '#ffd700',
            stroke: '#cc9900', strokeWidth: 1.5,
            cornerRadius: 1,
        }));
        this._valveHandle.add(new Konva.Circle({
            x: 0, y: -12,
            radius: 3,
            fill: '#ffee99',
            stroke: '#cc9900', strokeWidth: 1,

        }));
        this._valveGroup.add(this._valveHandle);
        
        // 标签
        this._valveGroup.add(new Konva.Text({
            x: -12, y: -32,
            width: 30,
            text: '截止',
            fontSize: 11, fontStyle: 'bold',
            fill: '#333', align: 'center',
        }));
        
        // 状态指示
        this._valveStatusText = new Konva.Text({
            x: -10, y: 18,
            width: 20,
            text: '开',
            fontSize: 11, fontStyle: 'bold',
            fill: '#0a810a', align: 'center',
        });
        this._valveGroup.add(this._valveStatusText);
        
        // 点击事件：切换阀门
        this._valveGroup.on('click', () => {
            this.outletValve.open = !this.outletValve.open;
            this._updateValveVisuals();
        });
        
        this.scaleGroup.add(this._valveGroup);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. 右侧差压变送器
    //    H/L 取压口均在变送器左侧：
    //       H（高压）→ 经底部走 -> 接水箱底部右侧
    //       L（低压）→ 经顶部走 -> 接水箱顶部右侧
    //    差压 ΔP = ρg · h  →  4-20mA 线性对应液位
    // ═══════════════════════════════════════════════════════════
    _drawTransmitter() {
        const txX = this.txX;
        const txW = this.txW;
        // 变送器垂直居中于水箱高度
        const txH = 140;
        const txY = this.tankY + (this.tankH - txH) / 2;

        // ── 变送器外壳 ──
        this.scaleGroup.add(new Konva.Rect({
            x: txX, y: txY,
            width: txW, height: txH,
            fill: '#b8b8b8',
            stroke: '#666', strokeWidth: 2,
            cornerRadius: 6,
        }));

        // 顶部高光条
        this.scaleGroup.add(new Konva.Rect({
            x: txX + 4, y: txY + 4,
            width: txW - 8, height: 20,
            fill: '#e0e0e0',
            stroke: '#aaa', strokeWidth: 0.5,
            cornerRadius: 4,
        }));

        // 标题
        this.scaleGroup.add(new Konva.Text({
            x: txX, y: txY + 7,
            width: txW,
            text: '差压变送器',
            fontSize: 12, fontStyle: 'bold',
            fill: '#333', align: 'center',
        }));

        // ── 液位指示条 ──
        const barX = txX + txW - 28;
        const barY = txY + 32;
        const barW = 16;
        const barH = 72;
        this._txBarY  = barY;
        this._txBarH  = barH;
        this.group.add(new Konva.Rect({
            x: barX, y: barY, width: barW, height: barH,
            fill: '#ddd',
            stroke: '#888', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this._txLevelFill = new Konva.Rect({
            x: barX + 1, y: barY + barH - 1,
            width: barW - 2, height: 0,
            fill: '#2a8acc',
            cornerRadius: 1,
        });
        this.scaleGroup.add(this._txLevelFill);

        // 百分比标签
        this._txPercentText = new Konva.Text({
            x: barX - 5, y: barY + barH + 4,
            width: barW + 10,
            text: '0%',
            fontSize: 10, fill: '#ed0b0b', align: 'center',
        });
        this.scaleGroup.add(this._txPercentText);

        // ── 电流显示 ──
        this.scaleGroup.add(new Konva.Text({
            x: txX + 6, y: barY + 2,
            text: '输出',
            fontSize:10, fill: '#555',
        }));
        this._currentDisplay = new Konva.Text({
            x: txX + 4, y: barY + 20,
            width: txW - 34,
            text: '4.0 mA',
            fontSize: 16, fontStyle: 'bold',
            fill: '#003366',
            align: 'center',
            fontFamily: 'monospace',
        });
        this.scaleGroup.add(this._currentDisplay);

        // ════════════════════════════════════════════════
        //  H/L 取压口：均在变送器左侧
        //    H 在下方 → 水平向右到水箱底部右侧
        //    L 在上方 → 水平向右到水箱顶部右侧
        // ════════════════════════════════════════════════
        const portX = txX;                // 取压口在变送器左边缘
        const hY = txY + txH - 16;        // H 口位置（变送器下部）
        const lY = txY + 28;              // L 口位置（变送器上部）

        const tankRight = this.tankX + this.tankW;  // 水箱右边缘 X

        // ── H（高压端）──
        this.scaleGroup.add(new Konva.Circle({
            x: portX, y: hY,
            radius: 4, fill: '#cc3333', stroke: '#880000', strokeWidth: 1.5,
        }));
        this.scaleGroup.add(new Konva.Text({
            x: portX + 6, y: hY - 5,
            text: 'H', fontSize: 9, fontStyle: 'bold', fill: '#cc3333',
        }));
        // H 导压管：从变送器左侧水平向右延伸到水箱底部右侧，再折到水箱底部
        this.scaleGroup.add(new Konva.Line({
            points: [
                portX, hY,                                   // 变送器 H 口
                (portX + tankRight) / 2, hY,                 // 水平到中点
                (portX + tankRight) / 2, this.tankY + this.tankH, // 向下到底部
                tankRight, this.tankY + this.tankH,          // 到水箱底部右侧
            ],
            stroke: '#cc3333', strokeWidth: 1.5,
            tension: 0.3,
        }));
        // 水箱底部取压点标记
        this.scaleGroup.add(new Konva.Circle({
            x: tankRight, y: this.tankY + this.tankH,
            radius: 3, fill: '#cc3333', stroke: '#880000', strokeWidth: 1,
        }));

        // ── L（低压端）──
        this.scaleGroup.add(new Konva.Circle({
            x: portX, y: lY,
            radius: 4, fill: '#3366cc', stroke: '#003388', strokeWidth: 1.5,
        }));
        this.scaleGroup.add(new Konva.Text({
            x: portX + 6, y: lY - 5,
            text: 'L', fontSize: 9, fontStyle: 'bold', fill: '#3366cc',
        }));
        // L 导压管：从变送器左侧水平向右延伸到水箱顶部右侧
        this.scaleGroup.add(new Konva.Line({
            points: [
                portX, lY,                     // 变送器 L 口
                (portX + tankRight) / 2, lY,   // 水平到中点
                (portX + tankRight) / 2, this.tankY, // 向上到顶
                tankRight, this.tankY,         // 到水箱顶部右侧
            ],
            stroke: '#3366cc', strokeWidth: 1.5,
            tension: 0.3,
        }));
        // 水箱顶部取压点标记
        this.scaleGroup.add(new Konva.Circle({
            x: tankRight, y: this.tankY,
            radius: 3, fill: '#3366cc', stroke: '#003388', strokeWidth: 1,
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 4. 管道示意
    // ═══════════════════════════════════════════════════════════
    _drawPipes() {
        // 进水管到水箱顶（水泵—水箱的管道已画在控制区里）
    }

    // ═══════════════════════════════════════════════════════════
    // 5. 外部接线端（顶边）
    // ═══════════════════════════════════════════════════════════
    _drawExternalPorts() {
        // 水泵控制接口（左半区）
        const pumpCtrlX1 = 45*this.scale;
        const pumpCtrlX2 = 105*this.scale;
        this._addTopPort(pumpCtrlX1, -5*this.scale, `l`, 'p');
        this._addTopPort(pumpCtrlX2, -5*this.scale, `r`);

        // 液位变送器接口（右半区）
        const ltX1 = (this.W - 95)*this.scale;
        const ltX2 = (this.W - 35)*this.scale;
        this._addTopPort(ltX1, 60*this.scale, `p`, 'p');
        this._addTopPort(ltX2, 60*this.scale, `n`);
    }

    _addTopPort(x, y, portId, polarity = 'n') {
        this.group.add(new Konva.Line({
            points: [x, y + 12, x, y],
            stroke: '#888', strokeWidth: 1.5,
        }));
        this.group.add(new Konva.Rect({
            x: x - 6, y: y - 12,
            width: 12, height: 12,
            fill: '#ddd6c0', stroke: '#666', strokeWidth: 1.5, cornerRadius: 2,
        }));
        this.addPort(x, y - 6, portId, 'wire', polarity);
    }

    // ═══════════════════════════════════════════════════════════
    // 6. 物理模型更新 (100ms)
    // ═══════════════════════════════════════════════════════════
    update(state) {
        console.log(state.powered,state.transCurrent);
    }    
    _updatePhysics() {
        const dt = 0.1;

        // 远程控制
        if (this.pump.mode === 'remote') this._updateRemoteCommand();

        // 水泵功率平滑过渡
        const targetPower = this.pump.targetRunning ? 1 : 0;
        const inertia = targetPower > this.pump.power ? 0.8 : 0.4;
        this.pump.power += (targetPower - this.pump.power) * inertia * dt;
        if (this.pump.power < 0.01) this.pump.power = 0;
        if (this.pump.power > 0.99) this.pump.power = 1;

        this.pump.running = this.pump.power > 0.1;
        this.inletFlowRate = this.pump.power * this.pump.maxFlow;

        // 根据截止阀状态调整出水流量
        this.outletFlowRate = this.outletValve.open ? (this.loadKnob.value * this.outletValve.nominalFlow) : 0;

        // 液位变化
        const netFlow = this.inletFlowRate - this.outletFlowRate;
        const deltaLevel = (netFlow / this.capacity) * dt * 100;
        let newLevel = this.level + deltaLevel;
        newLevel = Math.max(0, Math.min(100, newLevel));
        this.level = newLevel;

        this._updateTransmitterOutput();
    }

    _updateRemoteCommand() {
        const isConnected = this.sys.isPortConnected(
            `${this.id}_wire_l`,
            `${this.id}_wire_r`
        );
        this.pump.targetRunning = isConnected;
    }

    _updateTransmitterOutput() {
        if (this.transmitter.fault === 'open') {
            this.transmitter.currentOutput = 0;
        } else if (this.transmitter.fault === 'short') {
            this.transmitter.currentOutput = 24;
        } else {
            const percent = this.level / 100;
            this.transmitter.currentOutput = 4 + percent * (20 - 4);
            this.transmitter.currentOutput = Math.round(this.transmitter.currentOutput * 10) / 10;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 7. UI 更新 (200ms)
    // ═══════════════════════════════════════════════════════════
    _updateUI() {
        // 平滑显示液位
        this.displayLevel += (this.level - this.displayLevel) * 0.4;
        if (Math.abs(this.displayLevel - this.level) < 0.5) {
            this.displayLevel = this.level;
        }

        // ── 水箱水位 ──
        const fillHeight = (this.displayLevel / 100) * (this.tankH - 8);
        this._waterFill.height(fillHeight);
        this._waterFill.y(this.tankY + this.tankH - 4 - fillHeight);
        this._levelText.text(`液位: ${this.level.toFixed(1)}%`);

        // ── 水泵状态 ──
        if (this.pump.running) {
            // 叶轮旋转动画
            this._pumpAnimTime += 0.15;
            this._impeller.rotation(this._pumpAnimTime * 180);
            this._pumpStatusText.text('运行中');
            this._pumpStatusText.fill('#0a810a');
        } else {
            this._impeller.rotation(0);
            this._pumpStatusText.text('停止');
            this._pumpStatusText.fill('#888');
        }

        // 按钮颜色反馈
        if (this.pump.mode === 'local') {
            this._startBtn.fill(this.pump.targetRunning ? '#00cc00' : '#0a810a');
            this._stopBtn.fill(!this.pump.targetRunning ? '#dd2222' : '#871212');
        } else {
            this._startBtn.fill(this.pump.targetRunning ? '#00cc00' : '#0a810a');
            this._stopBtn.fill(!this.pump.targetRunning ? '#dd2222' : '#871212');
        }

        // ── 变送器显示 ──
        this._currentDisplay.text(`${this.transmitter.currentOutput.toFixed(1)} mA`);

        // 变送器指示条
        const txBarH = this._txBarH || 72;
        const txFillH = (this.displayLevel / 100) * (txBarH - 2);
        const barY = this._txBarY || 0;
        this._txLevelFill.height(txFillH);
        this._txLevelFill.y(barY + txBarH - 1 - txFillH);
        this._txPercentText.text(`${Math.round(this.displayLevel)}%`);

        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════
    // 8. 更新截止阀视觉
    // ═══════════════════════════════════════════════════════════
    _updateValveVisuals() {
        if (this.outletValve.open) {
            // 打开状态：阀杆水平，绿色
            this._valveHandle.rotation(0);
            this._valveStatusText.text('开');
            this._valveStatusText.fill('#0a810a');
        } else {
            // 关闭状态：阀杆垂直，红色
            this._valveHandle.rotation(90);
            this._valveStatusText.text('关');
            this._valveStatusText.fill('#c41e1e');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 9. 公开 API
    // ═══════════════════════════════════════════════════════════
    getLevel() { return this.level; }

    getCurrentOutput() { return this.transmitter.currentOutput; }

    setOutletFlow(flow) { this.outletFlowRate = Math.max(0, flow); }

    setLevel(percent) {
        this.level = Math.max(0, Math.min(100, percent));
        this._updateTransmitterOutput();
    }

    setOutletValveOpen(isOpen) {
        this.outletValve.open = isOpen;
        this._updateValveVisuals();
    }

    getOutletValveOpen() {
        return this.outletValve.open;
    }

    destroy() {
        if (this._physicalTimer) clearInterval(this._physicalTimer);
        if (this._uiTimer) clearInterval(this._uiTimer);
    }
}

export default WaterTankSystem;
