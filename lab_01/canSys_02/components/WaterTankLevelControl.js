import { BaseComponent } from './BaseComponent.js';

/**
 * WaterTankSystem —— 水箱液位控制系统
 *
 * 布局：整体尺寸 W=480, H=280
 * 左侧：电动调节阀及控制面板区域 (W=120)  与水箱等高
 * 中间：水箱区域 (W=170)
 * 右侧：差压变送器 (W=100)，H/L 取压口均在左侧
 *       H端→水箱底部右侧，L端→水箱顶部右侧（差压法测液位）
 *
 * 外部接线端（顶边，左→右）：
 *   电动调节阀控制：valve_ctrl_l, valve_ctrl_r (4-20mA 输入，控制阀门开度)
 *   液位变送器：lt_l, lt_r (4-20mA 输出)
 */
export class WaterTankLevelControl extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 整体尺寸 ─────────────────
        this.W = config.W || 480;
        this.H = config.H || 280;
        this.scale = 1.35;
        this.title = config.title || '水箱液位控制';
        this.type = 'transmitter_2wire';
        this.special = 'diff_level';
        this.cache = 'fixed';

        // ── 水箱参数 ─────────────────
        this.tankW = 170;          // 水箱宽度

        // 三个区域 X 定位
        this.controlX = 15;        // 左侧控制面板 X
        this.controlW = 120;       // 控制面板宽度
        this.panelY = 5;           // 控制面板 Y
        this.panelH = this.H / 2; // 控制面板高度（水箱与此等高）

        this.tankH = this.H - 10;  // 水箱高度 = 控制面板高度
        this.tankX = this.controlX + this.controlW + 15; // 中间水箱 X
        this.tankY = this.panelY;  // 水箱与控制面板顶部对齐

        this.txX = 365;            // 右侧变送器 X
        this.txW = 100;            // 变送器宽度

        // 液位参数
        this.level = 0;            // 当前液位 (0-100%)，0%为空，100%为满
        this.targetLevel = 0;      // 目标液位（用于控制逻辑）
        this.capacity = 100;       // 最大容积 (L)
        this.area = this.tankW * this.tankH; // 截面积（像素单位，用于视觉）

        // 进出水参数
        this.inletFlowRate = 0;     // 进水流量 (L/s) 0-2
        this.outletFlowRate = 0.5;  // 出水流量 (L/s)，常开，固定值

        // 电动调节阀参数
        this.valve = {
            mode: 'local',          // 'local' 或 'remote'
            opening: 0,             // 阀门开度 0-100%，实际值
            targetOpening: 0,       // 目标开度
            maxFlow: 2.0,           // 阀门全开时的最大进水流量 (L/s)
            responseTime: 0.5,      // 阀门响应时间（秒，从0到100%）
        };

        // 用于平滑动画的阀门开度显示值
        this.displayValveOpening = 0;

        // 出水截止阀
        this.outletValve = {
            open: true,             // 阀门打开/关闭状态
            nominalFlow: 1.0,       // 阀门打开时的名义流量
        };
        // ── 出水负荷调节旋钮 ──
        this.loadKnob = {
            value: config.loadKnobValue !== undefined ? config.loadKnobValue : 0.5,  // 0-1 范围
            minFlow: 0,              // 最小流量 (L/s)
            maxFlow: 1.0,           // 最大流量 (L/s)
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
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.scaleGroup);

        // 物理更新定时器 (100ms)
        this._physicalTimer = setInterval(() => this._updatePhysics(), 100);
        // UI 更新定时器 (200ms)
        this._uiTimer = setInterval(() => this._updateUI(), 200);

        // 绘制组件
        this._drawValveAndControl();
        this._drawTank();
        this._drawTransmitter();
        this._drawPipes();
        this._drawExternalPorts();

        // 初始状态
        this.level = 50;
        this.displayLevel = 50;
        this.valve.opening = 50;
        this.valve.targetOpening = 50;
        this.displayValveOpening = 50;
        this._updateTransmitterOutput();
        this._updateValveOpening();
        this._updateOutletFlowRate();  // 初始化出水流量        
    }

    // ═══════════════════════════════════════════════════════════
    // 1. 左侧控制面板：电动调节阀 + 控制面板
    //    上半：模式开关 + 增大阀门/减小阀门按钮
    //    下半：电动调节阀动画图标
    // ═══════════════════════════════════════════════════════════
    _drawValveAndControl() {
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
            text: '电动调节阀控制',
            fontSize: 11, fontStyle: 'bold',
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
            this.valve.mode = this.valve.mode === 'local' ? 'remote' : 'local';
            this._modeKnob.rotation(this.valve.mode === 'local' ? -45 : 45);
            if (this.valve.mode === 'remote') this._updateRemoteCommand();
            this._refreshCache();
        });
        this.scaleGroup.add(this._modeKnob);

        // ── 增大阀门按钮（原启动按钮） ──
        const incBtnX = panelX + 26;
        const incBtnY = panelY + 85;
        this._incBtn = new Konva.Circle({
            x: incBtnX, y: incBtnY,
            radius: 14,
            fill: '#0a810a',
            stroke: '#000', strokeWidth: 2,
            cursor: 'pointer'
        });
        this._incBtn.on('mousedown', () => {
            if (this.valve.mode === 'local') {
                this.valve.targetOpening = Math.min(100, this.valve.targetOpening + 5);
                this._incBtn.y(incBtnY + 2);
            }
        });
        this._incBtn.on('mouseup mouseleave', () => { this._incBtn.y(incBtnY); });
        this.scaleGroup.add(this._incBtn);
        this.scaleGroup.add(new Konva.Text({
            x: incBtnX - 10, y: incBtnY + 18,
            text: '增大', fontSize: 10, fill: '#444', align: 'center'
        }));

        // ── 减小阀门按钮（原停止按钮） ──
        const decBtnX = panelX + panelW - 26;
        const decBtnY = panelY + 85;
        this._decBtn = new Konva.Circle({
            x: decBtnX, y: decBtnY,
            radius: 14,
            fill: '#871212',
            stroke: '#000', strokeWidth: 2,
            cursor: 'pointer'
        });
        this._decBtn.on('mousedown', () => {
            if (this.valve.mode === 'local') {
                this.valve.targetOpening = Math.max(0, this.valve.targetOpening - 5);
                this._decBtn.y(decBtnY + 2);
            }
        });
        this._decBtn.on('mouseup mouseleave', () => { this._decBtn.y(decBtnY); });
        this.scaleGroup.add(this._decBtn);
        this.scaleGroup.add(new Konva.Text({
            x: decBtnX - 10, y: decBtnY + 18,
            text: '减小', fontSize: 10, fill: '#444', align: 'center'
        }));

        // ══════════════ 下半部分：电动调节阀动画图标（工业电动阀风格）══════════════
        const valveCX = panelX + panelW / 2;      // 阀图标中心 X
        const valveCY = panelY + 225;              // 阀图标中心 Y

        this._valveAnimTime = 0;

        const valveGrp = new Konva.Group({ x: valveCX, y: valveCY });

        // ── 阀体底座 ──
        valveGrp.add(new Konva.Rect({
            x: -38, y: 30,
            width: 76, height: 12,
            fill: '#666', stroke: '#333', strokeWidth: 2,
            cornerRadius: 4,
        }));

        // ── 阀体主外壳（圆柱形，放大1.5倍）──
        valveGrp.add(new Konva.Rect({
            x: -35, y: -20,
            width: 70, height: 50,
            fill: '#7a8a9a',
            stroke: '#2a3a5a', strokeWidth: 3,
            cornerRadius: 8,
        }));

        // 阀体高光
        valveGrp.add(new Konva.Rect({
            x: -33, y: -18,
            width: 66, height: 46,
            fill: 'transparent',
            stroke: '#9ab0c4', strokeWidth: 1,
            cornerRadius: 6,
        }));

        // ── 阀体内部流道（水平）──
        valveGrp.add(new Konva.Rect({
            x: -30, y: -5,
            width: 60, height: 18,
            fill: '#4a5a6a',
            stroke: '#2a3a5a', strokeWidth: 2,
            cornerRadius: 2,
        }));

        // ── 进水口（左侧）──
        valveGrp.add(new Konva.Rect({
            x: -48, y: -8,
            width: 18, height: 20,
            fill: '#5a7a9a', stroke: '#2a3a5a', strokeWidth: 2.5,
            cornerRadius: 2,
        }));
        valveGrp.add(new Konva.Circle({ x: -42, y: -2, radius: 3, fill: '#aaa' }));
        valveGrp.add(new Konva.Circle({ x: -42, y: 9, radius: 3, fill: '#aaa' }));

        // ── 出水口（右侧）──
        valveGrp.add(new Konva.Rect({
            x: 30, y: -8,
            width: 18, height: 20,
            fill: '#5a7a9a', stroke: '#2a3a5a', strokeWidth: 2.5,
            cornerRadius: 2,
        }));
        valveGrp.add(new Konva.Circle({ x: 36, y: -2, radius: 3, fill: '#aaa' }));
        valveGrp.add(new Konva.Circle({ x: 36, y: 9, radius: 3, fill: '#aaa' }));

        // ── 阀芯（可移动部件，根据开度上下移动）──
        this._valveCore = new Konva.Group({ x: 0, y: 0 });

        // 阀芯杆（垂直）
        this._valveStem = new Konva.Rect({
            x: -4, y: -28,
            width: 8, height: 48,
            fill: '#c0c0c0',
            stroke: '#888', strokeWidth: 1.5,
            cornerRadius: 2,
        });

        // 阀芯碟片（水平方向）
        this._valveDisc = new Konva.Rect({
            x: -28, y: 9,
            width: 56, height: 12,
            fill: '#29a00e',
            stroke: '#886644', strokeWidth: 2,
            cornerRadius: 3,
        });

        // 阀芯密封圈
        this._valveSeal = new Konva.Rect({
            x: -30, y: 6,
            width: 60, height: 2,
            fill: '#ffaa44',
            stroke: '#cc8800', strokeWidth: 0.5,
        });

        this._valveCore.add(this._valveStem, this._valveDisc, this._valveSeal);
        valveGrp.add(this._valveCore);

        // ── 电动执行器（顶部）──
        valveGrp.add(new Konva.Rect({
            x: -22, y: -48,
            width: 44, height: 24,
            fill: '#4a6a8a',
            stroke: '#2a3a5a', strokeWidth: 2.5,
            cornerRadius: 4,
        }));
        valveGrp.add(new Konva.Rect({
            x: -18, y: -44,
            width: 36, height: 16,
            fill: '#2c3e50',
            stroke: '#1a2a3a', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 执行器接线盒
        valveGrp.add(new Konva.Rect({
            x: -8, y: -52,
            width: 16, height: 8,
            fill: '#666',
            stroke: '#444', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 电动执行器指示灯
        this._valveLed = new Konva.Circle({
            x: 0, y: -38,
            radius: 3,
            fill: '#0a0',
        });
        valveGrp.add(this._valveLed);

        // ── 阀位指示牌 ──
        const indicatorBg = new Konva.Rect({
            x: -15, y: -32,
            width: 30, height: 12,
            fill: '#fff',
            stroke: '#999', strokeWidth: 0.5,
            cornerRadius: 2,
        });
        this._valveIndicator = new Konva.Text({
            x: -15, y: -31,
            width: 30,
            text: '0%',
            fontSize: 9, fontStyle: 'bold',
            fill: '#333', align: 'center',
        });
        valveGrp.add(indicatorBg, this._valveIndicator);

        this.scaleGroup.add(valveGrp);

        // ── 进水管道（调节阀到水箱）──
        const pipeY = valveCY;
        this.scaleGroup.add(new Konva.Line({
            points: [panelX + panelW - 20, pipeY, this.tankX, pipeY],
            stroke: '#6699cc',
            strokeWidth: 8,
            dash: [10, 5],
        }));

        // ── 阀门状态文字 ──
        this._valveStatusText = new Konva.Text({
            x: panelX, y: panelY + panelH - 22,
            width: panelW,
            text: '开度: 0%',
            fontSize: 12,
            fontStyle: 'bold',
            fill: '#888', align: 'center',
        });
        this.scaleGroup.add(this._valveStatusText);

        // 存储引用
        this._valveGrp = valveGrp;
        this._valveCoreY = valveCY;
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
            points: [outletX, outletY, outletX + 40, outletY],
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
        this._valveHandle = new Konva.Group({ x: 0, y: 0 });
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
        this._valveStatusText2 = new Konva.Text({
            x: -10, y: 18,
            width: 20,
            text: '开',
            fontSize: 11, fontStyle: 'bold',
            fill: '#0a810a', align: 'center',
        });
        this._valveGroup.add(this._valveStatusText2);

        // 点击事件：切换阀门
        this._valveGroup.on('click', () => {
            this.outletValve.open = !this.outletValve.open;
            this._updateValveVisuals();
        });

        this.scaleGroup.add(this._valveGroup);

        // ═══════════════════════════════════════════════════════════
        // ── 负荷调节旋钮（截止阀右侧） ──
        // ═══════════════════════════════════════════════════════════
        const knobX = valveX + 40;   // 截止阀右侧40px
        const knobY = outletY;
        const knobRadius = 16;

        this._loadKnobGroup = new Konva.Group({ x: knobX, y: knobY, cursor: 'pointer' });

        // 旋钮底座（圆形刻度盘）
        this._loadKnobGroup.add(new Konva.Circle({
            radius: knobRadius,
            fill: '#666',
            stroke: '#444', strokeWidth: 2,
        }));

        // 刻度盘背景
        this._loadKnobGroup.add(new Konva.Circle({
            radius: knobRadius - 2,
            fill: '#333',
            stroke: '#555', strokeWidth: 1,
        }));

        // 刻度线（从 -120° 到 +120°，对应 0-100%）
        for (let i = 0; i <= 10; i++) {
            const percent = i / 10;
            const angle = -120 + percent * 240;  // -120° 到 +120°
            const rad = angle * Math.PI / 180;
            const isMajor = i % 2 === 0;
            const innerR = knobRadius - (isMajor ? 5 : 3);
            const outerR = knobRadius - (isMajor ? 2 : 1);
            const x1 = Math.cos(rad) * innerR;
            const y1 = Math.sin(rad) * innerR;
            const x2 = Math.cos(rad) * outerR;
            const y2 = Math.sin(rad) * outerR;
            this._loadKnobGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#aaa',
                strokeWidth: isMajor ? 1.5 : 0.8,
            }));
        }

        // 旋钮指针
        this._knobPointer = new Konva.Group({ x: 0, y: 0 });

        // 指针中心装饰
        this._knobPointer.add(new Konva.Circle({
            radius: 4,
            fill: '#ffd700',
            stroke: '#aa8800', strokeWidth: 1.5,
        }));

        // 指针线
        this._knobPointer.add(new Konva.Line({
            points: [0, 0, 0, -knobRadius + 3],
            stroke: '#ffd700',
            strokeWidth: 3,
            lineCap: 'round',
        }));

        // 指针头箭头（使用 Konva.Line + closed: true）
        this._knobPointer.add(new Konva.Line({
            points: [-3, -knobRadius + 8, 3, -knobRadius + 8, 0, -knobRadius + 2],
            fill: '#ffd700',
            stroke: '#aa8800',
            strokeWidth: 0.5,
            closed: true,
        }));

        this._loadKnobGroup.add(this._knobPointer);

        // 旋钮标签
        this._loadKnobGroup.add(new Konva.Text({
            x: -15, y: knobRadius + 5,
            width: 30,
            text: '负荷',
            fontSize: 9, fontStyle: 'bold',
            fill: '#555', align: 'center',
        }));

        // 负荷值显示
        this._loadKnobValueText = new Konva.Text({
            x: -15, y: knobRadius + 16,
            width: 30,
            text: '0.50',
            fontSize: 8,
            fill: '#3366cc', align: 'center', fontFamily: 'monospace',
        });
        this._loadKnobGroup.add(this._loadKnobValueText);

        // 先添加到组，再设置拖拽逻辑
        this.scaleGroup.add(this._loadKnobGroup);

        // 截止阀到负荷旋钮的管道
        this.scaleGroup.add(new Konva.Line({
            points: [valveX + 14, valveY, knobX - knobRadius, valveY],
            stroke: '#6699cc', strokeWidth: 5,
        }));

        // 负荷旋钮后的出水管道
        this.scaleGroup.add(new Konva.Line({
            points: [knobX + knobRadius, knobY, knobX + 40, knobY],
            stroke: '#6699cc', strokeWidth: 5,
        }));

        // 出水方向箭头（使用 Konva.Line + closed: true）
        const arrowEndX = knobX + 35;
        const arrowEndY = knobY;
        this.scaleGroup.add(new Konva.Line({
            points: [arrowEndX, arrowEndY - 4, arrowEndX + 8, arrowEndY, arrowEndX, arrowEndY + 4],
            fill: '#6699cc',
            stroke: '#6699cc',
            strokeWidth: 0.5,
            closed: true,
        }));

        // 旋钮拖拽逻辑（必须在添加到 scaleGroup 之后定义）
        let dragActive = false;
        let dragStartAngle = 0;
        let dragStartValue = 0;

        const updateKnobFromAngle = (angle) => {
            let normalized = (angle + 120) / 240;
            normalized = Math.max(0, Math.min(1, normalized));
            this.loadKnob.value = normalized;
            this._updateKnobVisuals();
            this._updateOutletFlowRate();
        };

        const getAngleFromEvent = (e) => {
            // 使用舞台的指针位置获取坐标，兼容 Konva 事件对象，避免 clientX/ clientY 为 undefined
            const rect = this._loadKnobGroup.getClientRect();
            const stage = this._loadKnobGroup.getStage && this._loadKnobGroup.getStage();
            let clientX, clientY;
            const pointer = stage && stage.getPointerPosition ? stage.getPointerPosition() : null;
            if (pointer && pointer.x !== undefined && pointer.y !== undefined) {
                clientX = pointer.x;
                clientY = pointer.y;
            } else if (e && e.touches && e.touches[0]) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e && e.clientX !== undefined && e.clientY !== undefined) {
                clientX = e.clientX;
                clientY = e.clientY;
            } else {
                return 0; // 无有效指针位置，返回 0°（不改变指针）
            }

            const dx = clientX - (rect.x + (rect.width || 0) / 2);
            const dy = clientY - (rect.y + (rect.height || 0) / 2);
            let angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (isNaN(angle)) return 0;
            angle = Math.max(-120, Math.min(120, angle));
            return angle;
        };

        const onMove = (e) => {
            if (!dragActive) return;
            const angle = getAngleFromEvent(e);
            const deltaAngle = angle - dragStartAngle;
            let newValue = dragStartValue + (deltaAngle / 240);
            newValue = Math.max(0, Math.min(1, newValue));
            this.loadKnob.value = newValue;
            this._updateKnobVisuals();
            this._updateOutletFlowRate();
            this._refreshCache();
        };

        const onUp = () => {
            dragActive = false;
            this._loadKnobGroup.getStage().off('mousemove touchmove', onMove);
            this._loadKnobGroup.getStage().off('mouseup touchend', onUp);
        };

        this._loadKnobGroup.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            dragActive = true;
            const angle = getAngleFromEvent(e);
            dragStartAngle = angle;
            dragStartValue = this.loadKnob.value;
            const stage = this._loadKnobGroup.getStage();
            if (stage) {
                stage.on('mousemove touchmove', onMove);
                stage.on('mouseup touchend', onUp);
            }
        });

        // 初始化旋钮视觉效果（放在最后，确保所有元素都已添加）
        this._updateKnobVisuals();
    }

    // 更新旋钮视觉效果（指针角度）
    _updateKnobVisuals() {
        if (!this._knobPointer) return;
        // 值 0-1 映射到角度 -120° 到 +120°
        const angle = -120 + this.loadKnob.value * 240;
        this._knobPointer.rotation(angle);
        if (this._loadKnobValueText) {
            this._loadKnobValueText.text(this.loadKnob.value.toFixed(2));
        }
    }

    // 更新出水流量（根据截止阀状态和负荷旋钮值）
    _updateOutletFlowRate() {
        if (this.outletValve.open) {
            // 阀门打开时：流量 = 名义最大流量 × 负荷系数
            this.outletFlowRate = this.loadKnob.value * this.outletValve.nominalFlow;
        } else {
            this.outletFlowRate = 0;
        }
    }


    // ═══════════════════════════════════════════════════════════
    // 3. 右侧差压变送器
    // ═══════════════════════════════════════════════════════════
    _drawTransmitter() {
        const txX = this.txX;
        const txW = this.txW;
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
        this._txBarY = barY;
        this._txBarH = barH;
        this.scaleGroup.add(new Konva.Rect({
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
            fontSize: 10, fill: '#555',
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

        // H/L 取压口
        const portX = txX;
        const hY = txY + txH - 16;
        const lY = txY + 28;
        const tankRight = this.tankX + this.tankW;

        // H（高压端）
        this.scaleGroup.add(new Konva.Circle({
            x: portX, y: hY,
            radius: 4, fill: '#cc3333', stroke: '#880000', strokeWidth: 1.5,
        }));
        this.scaleGroup.add(new Konva.Text({
            x: portX + 6, y: hY - 5,
            text: 'H', fontSize: 9, fontStyle: 'bold', fill: '#cc3333',
        }));
        this.scaleGroup.add(new Konva.Line({
            points: [
                portX, hY,
                (portX + tankRight) / 2, hY,
                (portX + tankRight) / 2, this.tankY + this.tankH,
                tankRight, this.tankY + this.tankH,
            ],
            stroke: '#cc3333', strokeWidth: 1.5,
            tension: 0.3,
        }));
        this.scaleGroup.add(new Konva.Circle({
            x: tankRight, y: this.tankY + this.tankH,
            radius: 3, fill: '#cc3333', stroke: '#880000', strokeWidth: 1,
        }));

        // L（低压端）
        this.scaleGroup.add(new Konva.Circle({
            x: portX, y: lY,
            radius: 4, fill: '#3366cc', stroke: '#003388', strokeWidth: 1.5,
        }));
        this.scaleGroup.add(new Konva.Text({
            x: portX + 6, y: lY - 5,
            text: 'L', fontSize: 9, fontStyle: 'bold', fill: '#3366cc',
        }));
        this.scaleGroup.add(new Konva.Line({
            points: [
                portX, lY,
                (portX + tankRight) / 2, lY,
                (portX + tankRight) / 2, this.tankY,
                tankRight, this.tankY,
            ],
            stroke: '#3366cc', strokeWidth: 1.5,
            tension: 0.3,
        }));
        this.scaleGroup.add(new Konva.Circle({
            x: tankRight, y: this.tankY,
            radius: 3, fill: '#3366cc', stroke: '#003388', strokeWidth: 1,
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 4. 管道示意
    // ═══════════════════════════════════════════════════════════
    _drawPipes() {
        // 进水管已在阀门面板中绘制
    }

    // ═══════════════════════════════════════════════════════════
    // 5. 外部接线端（顶边）
    // ═══════════════════════════════════════════════════════════
    _drawExternalPorts() {
        // 电动调节阀控制接口（4-20mA输入）
        const valveCtrlX1 = 45 * this.scale;
        const valveCtrlX2 = 105 * this.scale;
        this._addTopPort(valveCtrlX1, -5 * this.scale, 'l', 'p');
        this._addTopPort(valveCtrlX2, -5 * this.scale, 'r');

        // 液位变送器接口（4-20mA输出）
        const ltX1 = (this.W - 95) * this.scale;
        const ltX2 = (this.W - 35) * this.scale;
        this._addTopPort(ltX1, 60 * this.scale, 'p', 'p');
        this._addTopPort(ltX2, 60 * this.scale, 'n');
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
        
    }        
    _updatePhysics() {
        const dt = 0.1;

        // 远程控制：根据4-20mA输入电流更新目标开度
        if (this.valve.mode === 'remote') this._updateRemoteCommand();

        // 阀门开度平滑过渡（模拟电动执行器响应时间）
        const target = this.valve.targetOpening;
        const current = this.valve.opening;
        const maxStep = 100 * dt / this.valve.responseTime; // 每秒最大变化量
        const step = Math.max(-maxStep, Math.min(maxStep, target - current));
        this.valve.opening += step;

        // 边界处理
        this.valve.opening = Math.max(0, Math.min(100, this.valve.opening));

        // 根据阀门开度计算进水流量
        this.inletFlowRate = (this.valve.opening / 100) * this.valve.maxFlow;

        // 根据截止阀状态和负荷旋钮值调整出水流量（尊重负荷旋钮设置）
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

        let currentMA = null;
        const voltage = this.sys.getVoltageBetween(`${this.id}_wire_l`,`${this.id}_wire_r`);
        currentMA = voltage*4;
        console.log(currentMA);

        if (currentMA !== null && !isNaN(currentMA)) {
            // 4-20mA 线性映射到 0-100% 阀门开度
            let targetOpening = ((currentMA - 4) / 16) * 100;
            targetOpening = Math.max(0, Math.min(100, targetOpening));
            this.valve.targetOpening = targetOpening;
        } else {
            // 无信号时阀门保持当前开度（或可配置为故障安全位置）
            // 这里不做变化
        }
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

        // 平滑显示阀门开度（用于动画）
        this.displayValveOpening += (this.valve.opening - this.displayValveOpening) * 0.5;
        if (Math.abs(this.displayValveOpening - this.valve.opening) < 1) {
            this.displayValveOpening = this.valve.opening;
        }

        // ── 水箱水位 ──
        const fillHeight = (this.displayLevel / 100) * (this.tankH - 8);
        this._waterFill.height(fillHeight);
        this._waterFill.y(this.tankY + this.tankH - 4 - fillHeight);
        this._levelText.text(`液位: ${this.level.toFixed(1)}%`);

        // ── 电动调节阀动画 ──
        // 阀芯垂直移动：0%开度时阀芯在底部（-8），100%开度时阀芯在顶部（-28）
        // 阀芯行程：从 y=8（全关）到 y=-28（全开）
        const valveCoreY = 8 - (this.displayValveOpening / 100) * 36;
        if (this._valveCore) {
            this._valveCore.y(valveCoreY);
        }

        // 阀门指示器文字
        this._valveIndicator.text(`${Math.round(this.displayValveOpening)}%`);
        this._valveStatusText.text(`开度: ${Math.round(this.valve.opening)}%`);

        // 执行器指示灯：阀门动作时闪烁，静止时常亮
        const isMoving = Math.abs(this.valve.targetOpening - this.valve.opening) > 1;
        if (this._valveLed) {
            if (isMoving) {
                // 动作时橙色闪烁
                const blink = Math.floor(Date.now() / 200) % 2;
                this._valveLed.fill(blink ? '#ff8800' : '#ffcc00');
            } else if (this.valve.opening > 0) {
                this._valveLed.fill('#00cc00');
            } else {
                this._valveLed.fill('#aa0000');
            }
        }

        // 按钮颜色反馈（显示当前模式下的阀门状态）
        if (this.valve.mode === 'local') {
            // 本地模式：按钮颜色显示当前操作反馈
            // 增大/减小按钮颜色变化由点击事件处理，这里保持正常
        }

        // 模式开关文字颜色反馈
        if (this.valve.mode === 'remote') {
            this._valveStatusText.fill('#3366cc');
            this._valveStatusText.text(`遥控 ${Math.round(this.valve.opening)}%`);
        } else {
            this._valveStatusText.fill('#888');
            this._valveStatusText.text(`本地 ${Math.round(this.valve.opening)}%`);
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

        // 端口电流值
        if (this.ports['lt_l'] && this.ports['lt_r']) {
            this.ports['lt_l'].value = this.transmitter.currentOutput / 1000.0;
        }

        // 提供阀门开度给外部（通过端口值）
        if (this.ports['valve_ctrl_l'] && this.ports['valve_ctrl_r']) {
            // 在输出端口设置值（用于监控）
            // 实际输入控制已在 _updateRemoteCommand 中处理
        }

        this._refreshCache();
    }

    // 更新阀门开度（根据目标开度，在物理更新中平滑变化）
    _updateValveOpening() {
        // 这个方法已经被物理更新中的平滑逻辑替代
        // 保留作为外部接口
    }

    // ═══════════════════════════════════════════════════════════
    // 8. 更新截止阀视觉
    // ═══════════════════════════════════════════════════════════
    _updateValveVisuals() {
        if (this.outletValve.open) {
            this._valveHandle.rotation(0);
            this._valveStatusText2.text('开');
            this._valveStatusText2.fill('#0a810a');
        } else {
            this._valveHandle.rotation(90);
            this._valveStatusText2.text('关');
            this._valveStatusText2.fill('#c41e1e');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 9. 公开 API
    // ═══════════════════════════════════════════════════════════
    getLevel() { return this.level; }

    getCurrentOutput() { return this.transmitter.currentOutput; }

    getValveOpening() { return this.valve.opening; }

    setValveOpening(percent) {
        percent = Math.max(0, Math.min(100, percent));
        if (this.valve.mode === 'local') {
            this.valve.targetOpening = percent;
        }
    }

    setValveMode(mode) {
        this.valve.mode = mode === 'remote' ? 'remote' : 'local';
        this._modeKnob.rotation(this.valve.mode === 'local' ? -45 : 45);
        if (this.valve.mode === 'remote') this._updateRemoteCommand();
    }

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

export default WaterTankLevelControl;