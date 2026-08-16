import { BaseComponent } from './BaseComponent.js';

/**
 * 吹气式液位变送器（Bubbler / Air-Purge Level Transmitter）
 * 5倍放大版本 + 粗管路设计
 *
 * ── 测量原理 ────────────────────────────────────────────────
 *  恒定小流量气体（通常 0.3~1.0 L/min）经由浸没管连续吹入被测液体底部。
 *  气泡在液面处逸出时，管内气压 = 液柱静压头：
 *
 *    P_back = ρ · g · H
 *
 *  其中：
 *    P_back — 吹气背压 (Pa)
 *    ρ      — 液体密度 (kg/m³)
 *    g      — 重力加速度 9.81 m/s²
 *    H      — 液位高度 (m)
 *
 *  因此：H = P_back / (ρ · g)
 *
 *  本组件内置：
 *    1. 恒流组件（Constant Flow Regulator）— 稳定吹气流量
 *    2. 转子流量计（Rotameter）— 监视吹气流量
 *    3. 差压变送器（背压传感）— 将背压转换为 4-20mA
 *    4. 水箱（Tank）— 被测容器，可交互调节液位
 *    5. 浸没管 + 吹气口动画
 *
 * ── 端口 ───────────────────────────────────────────────────
 *  pipe_src  — 气源进口（仪表风 / 压缩空气，接 airBottle 或 regulator 输出）
 *  pipe_out  — 恒流组件输出口（可接管路，最终接浸没管）
 *  wire_p    — 24VDC 电源正
 *  wire_n    — 4-20mA 信号输出
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'press'
 *  求解器将 pipe_src 压力注入 device.press，然后调用 update(press)。
 *  内部恒流组件将气源压力调节至固定吹气压力，背压 = ρgH，
 *  最终输出 4-20mA 对应液位百分比。
 */
export class BubbleLevelTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 整体尺寸 - 1/4尺寸
        this.width  = Math.max(400, config.width  || 425);
        this.height = Math.max(400, config.height || 450);

        // ── 类型标识 ──
        this.type    = 'transmitter_2wire';
        this.special = 'bubble_level';
        this.cache   = 'fixed';

        // ── 物理参数 ──
        this.liquidDensity = config.liquidDensity || 1000;  // kg/m³（水）
        this.tankHeight    = config.tankHeight    || 2.0;   // 水箱满量程高度 m
        this.minLevel      = 0;
        this.maxLevel      = config.maxLevel      || 100;   // 液位量程 %
        this.purgeFlow     = config.purgeFlow     || 0.2;   // 恒定吹气流量 L/min
        this.maxPressure   = config.maxPressure   || 0.6;   // 气源最大压力 MPa

        // ── 运行状态 ──
        this.press      = 0;         // 气源压力 (MPa)
        this.liquidLevel = 50;       // 液位 % (0~100)，可拖拽调节
        this.backPress   = 0;        // 吹气背压 (kPa)
        this.flow        = 0;        // 实际吹气流量 L/min
        this.outCurrent  = 4;        // 4-20mA 输出
        this.isBreak     = false;
        this.powered     = false;

        // ── 动态流量响应 ──
        this.lastLiquidLevel = 50;   // 上一帧液位
        this.targetFlow      = this.purgeFlow;  // 目标流量（由恒流组件调节）
        this.actualFlow      = 0;    // 实际流量（平滑过渡）
        this.flowAdjustTime  = 2.5;  // 恒流组件调节响应时间（秒）
        this.lastUpdateTime  = null; // 上次update调用的时间戳
        this.flowChangeStartTime = null; // 流量动态变化的起始时间
        this.flowOvershoot   = 0;    // 流量超调量

        // ── 计算布局参数 ──
        this._calculateLayout();

        // ── 动画状态 ──
        this._bubbles      = [];   // 气泡粒子数组
        this._rotorAngle   = 0;    // 转子流量计浮子位置
        this._animId       = null;
        this._lastTs       = null;
        this._dragActive   = false;

        this.config = {
            id: this.id, liquidDensity: this.liquidDensity,
            tankHeight: this.tankHeight, maxLevel: this.maxLevel,
            purgeFlow: this.purgeFlow,
        };

        this._init();

        // 端口
        const bx = this._boxX;
        this.addPort(bx-5,                  this._boxY + 307,   'i', 'pipe', 'in');
        this.addPort(bx-5,                  this._boxY + 115,  'o', 'pipe');
        this.addPort(bx-3,          this._boxY + 30,   'p',   'wire', 'p');
        this.addPort(bx-3,          this._boxY + 80,  'n',   'wire');
    }

    // ═══════════════════════════════════════════════
    //  布局计算
    // ═══════════════════════════════════════════════
    _calculateLayout() {
        // 整体边距
        const MARGIN_LEFT = 12;
        const MARGIN_TOP = 25;
        const MARGIN_RIGHT = 12;
        const MARGIN_BOTTOM = 25;
        const MARGIN_MID = 12.5;  // 仪表盒和水箱之间的间距

        // 仪表盒（左侧）
        this._boxW = 175;
        this._boxH = this.height - MARGIN_TOP - MARGIN_BOTTOM;
        this._boxX = MARGIN_LEFT;
        this._boxY = MARGIN_TOP;

        // 水箱（右侧）
        this._tankX = this._boxX + this._boxW + MARGIN_MID;
        this._tankW = this.width - this._tankX - MARGIN_RIGHT;
        this._tankH = this.height - MARGIN_TOP - MARGIN_BOTTOM;
        this._tankY = MARGIN_TOP;

        // 管路粗度
        this._pipeStrokeWidth = 5;

        // ── 仪表盒内的3个子组件（从上到下）── 
        const subMargin = MARGIN_MID;
        const instrBoxInnerX = this._boxX + subMargin;
        const instrBoxInnerW = this._boxW - 2 * subMargin;

        // 1. 差压变送器（最上面）
        this._dpW = instrBoxInnerW;
        this._dpH = 82.5;
        this._dpX = instrBoxInnerX;
        this._dpY = this._boxY + subMargin;

        // 2. 转子流量计（中间）
        this._rotH = 100;
        this._rotW = instrBoxInnerW;
        this._rotX = instrBoxInnerX;
        this._rotY = this._dpY + this._dpH + subMargin+30;

        // 3. 恒流组件（最下面）
        this._cfrH = 65;
        this._cfrW = instrBoxInnerW;
        this._cfrX = instrBoxInnerX;
        this._cfrY = this._rotY + this._rotH + subMargin+25;

        // 液位显示（仪表盒底部）
        this._lvlDispY = this._cfrY + this._cfrH + subMargin-5;
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawInstrumentBox();
        this._drawDPTransmitter();      // 最上面
        this._drawRotameter();          // 中间
        this._drawConstantFlowUnit();   // 最下面
        this._drawPipingLines();
        this._drawTank();
        this._drawTankOverlay();
        this._drawLevelDisplay();
        this._setupTankDrag();
        this._startAnimation();
    }

    // ── 整体背景标签 ─────────────────────────────
    _drawBackground() {
        // 组件标题
        this._titleText = new Konva.Text({
            x: 10, y: 2.5, width: this.width,
            text: '吹气式液位变送器', fontSize: 15,
            fontStyle: 'bold', fill: '#263238', align: 'left',
        });
        // 仪表盒虚线框
        this._instrFrame = new Konva.Rect({
            x: this._boxX - 2.5, y: this._boxY - 2.5,
            width: this._boxW + 5, height: this._boxH + 5,
            fill: '#eceff1', stroke: '#90a4ae',
            strokeWidth: 1, dash: [6.25, 3.75], cornerRadius: 6.25,
        });
        // 仪表盒说明
        const instrLabel = new Konva.Text({
            x: this._boxX + 5, y: this._boxY + 1,
            text: '─ 仪表单元 ─',
            fontSize: 10, fill: '#78909c',
        });
        this.group.add(this._titleText, this._instrFrame, instrLabel);
    }

    // ── 仪表盒整体外壳 ───────────────────────────
    _drawInstrumentBox() {
        // 无需额外外壳，仪表盒由各子组件拼成
    }

    // ── 恒流组件 ─ 最下面 ───────────────────────────────
    _drawConstantFlowUnit() {
        const x = this._cfrX;
        const y = this._cfrY;
        const w = this._cfrW;
        const h = this._cfrH;

        // 外壳
        const body = new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#37474f', stroke: '#263238', strokeWidth: 2, cornerRadius: 6.25,
        });
        const sheen = new Konva.Rect({
            x: x+2.5, y: y+2.5, width: 10, height: h-5,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: 3.75,
        });
        // 标题
        const lbl = new Konva.Text({
            x: x+5, y: y+5, width: w-10,
            text: '恒  流  组  件', fontSize: 12,
            fontStyle: 'bold', fill: '#80cbc4', align: 'center',
        });
        // 内部弹簧隔膜图示（装饰）
        const springGroup = new Konva.Group({ x: x + w/2, y: y + 37.5 });
        // 弹簧波形
        const springPts = [];
        for (let i = 0; i <= 8; i++) {
            springPts.push(-35 + i * 8.75, i % 2 === 0 ? -6.25 : 6.25);
        }
        const spring = new Konva.Line({
            points: springPts, stroke: '#80cbc4', strokeWidth: 2,
            lineCap: 'round', lineJoin: 'round',
        });
        // 隔膜圆
        const diaphragm = new Konva.Ellipse({
            x: 0, y: 0, radiusX: 12.5, radiusY: 8.75,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        });
        springGroup.add(spring, diaphragm);

        // 设定值标签
        const setLabel = new Konva.Text({
            x: x + 5, y: y + h - 15, width: w - 10,
            text: `设定流量: ${this.purgeFlow} L/min`,
            fontSize: 9.5, fill: '#b0bec5', align: 'center',
        });
        this._cfrSetLabel = setLabel;

        this.group.add(body, sheen, lbl, springGroup, setLabel);
    }

    // ── 转子流量计（Rotameter）- 中间 ─────────────────────
    _drawRotameter() {
        const x = this._rotX;
        const y = this._rotY;
        const w = this._rotW;
        const h = this._rotH;

        // 外壳
        const body = new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#2e3f4f', stroke: '#1a2634', strokeWidth: 2, cornerRadius: 6.25,
        });
        const lbl = new Konva.Text({
            x: x+5, y: y+5, width: w-10,
            text: '转 子 流 量 计', fontSize: 12,
            fontStyle: 'bold', fill: '#4fc3f7', align: 'center',
        });

        // 玻璃管（中央锥形）
        const tubeX = x + w/2 - 10;
        const tubeY = y + 22.5;
        const tubeW = 20;
        const tubeH = 65;
        this._tubeX = tubeX;
        this._tubeY = tubeY;
        this._tubeW = tubeW;
        this._tubeH = tubeH;

        const tubeGlass = new Konva.Rect({
            x: tubeX, y: tubeY, width: tubeW, height: tubeH,
            fill: 'rgba(100,180,220,0.15)', stroke: '#4fc3f7',
            strokeWidth: 1.25, cornerRadius: 3.75,
        });
        // 刻度线
        for (let i = 0; i <= 4; i++) {
            const ly = tubeY + (tubeH * i) / 4;
            this.group.add(new Konva.Line({
                points: [tubeX - 6.25, ly, tubeX, ly],
                stroke: '#546e7a', strokeWidth: 1,
            }));
            this.group.add(new Konva.Text({
                x: tubeX - 27.5, y: ly - 6.25,
                text: `${100 - i * 25}%`, fontSize: 8.75, fill: '#607d8b',
            }));
        }
        // 浮子（圆球，位置动态）
        this._floatBall = new Konva.Circle({
            x: tubeX + tubeW / 2,
            y: tubeY + tubeH * 0.5,
            radius: 7.5,
            fill: '#ff7043', stroke: '#e64a19', strokeWidth: 1.25,
        });
        // 浮子高光
        this._floatGlint = new Konva.Circle({
            x: tubeX + tubeW / 2 - 2.5,
            y: tubeY + tubeH * 0.5 - 2.5,
            radius: 2.5, fill: 'rgba(255,255,255,0.45)',
        });

        this.group.add(body, lbl, tubeGlass, this._floatBall, this._floatGlint);

        // 流量读数
        this._rotText = new Konva.Text({
            x: tubeX + tubeW + 5, y: tubeY + 25,
            width: 62.5, text: '0.0\nL/min',
            fontSize: 10.5, fill: '#4fc3f7', align: 'left', lineHeight: 1.5,
        });
        this.group.add(this._rotText);
    }

    // ── 差压变送器（背压传感）─ 最上面 ──
    _drawDPTransmitter() {
        const x = this._dpX;
        const y = this._dpY;
        const w = this._dpW;
        const h = this._dpH;

        // 外壳
        const body = new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#1a237e', stroke: '#0d1457', strokeWidth: 2, cornerRadius: 6.25,
        });
        const sheen = new Konva.Rect({
            x: x+2.5, y: y+2.5, width: 10, height: h-5,
            fill: 'rgba(255,255,255,0.05)', cornerRadius: 3.75,
        });
        const lbl = new Konva.Text({
            x: x+5, y: y+5, width: w-10,
            text: '背 压 变 送 器', fontSize: 12,
            fontStyle: 'bold', fill: '#7986cb', align: 'center',
        });

        // 圆形表头（小型）
        const hCX = x + w/2;
        const hCY = y + 45;
        const outerC = new Konva.Circle({
            x: hCX, y: hCY, radius: 25,
            fill: '#0d1457', stroke: '#1a237e', strokeWidth: 1.25,
        });
        const midC = new Konva.Circle({
            x: hCX, y: hCY, radius: 22.5,
            fill: '#283593', stroke: '#3949ab', strokeWidth: 2.5,
        });
        this._dpLcdBg = new Konva.Circle({
            x: hCX, y: hCY, radius: 17.5, fill: '#010814',
        });
        this._dpMainTxt = new Konva.Text({
            x: hCX - 22.5, y: hCY - 10,
            width: 45, text: '----',
            fontSize: 11.25, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#1bf70c', align: 'center',
        });
        this._dpUnitTxt = new Konva.Text({
            x: hCX - 20, y: hCY + 3.75,
            width: 40, text: 'kPa',
            fontSize: 8.75, fill: '#31f00b', align: 'center', opacity: 0,
        });
        this._dpMaTxt = new Konva.Text({
            x: x + 5, y: y + h - 16.25,
            width: w - 10, text: '4.00 mA',
            fontSize: 10, fontFamily: 'Courier New, monospace',
            fill: '#19f405', align: 'center',
        });

        this.group.add(body, sheen, lbl, outerC, midC,
            this._dpLcdBg, this._dpMainTxt, this._dpUnitTxt, this._dpMaTxt);
    }

    // ── 管路连线（仪表内部气路图示）──────────────
    _drawPipingLines() {
        const pipeW = this._pipeStrokeWidth;
        
        // ── 定义各个关键点 ──
        const gasInPortX = this._boxX;
        const gasInPortY = this._cfrY + this._cfrH / 2;
        
        const cfrCtrX = this._cfrX + this._cfrW / 2;  // 恒流组件中心X
        const cfrTopY = this._cfrY;                    // 恒流组件顶部
        const cfrBotY = this._cfrY + this._cfrH;      // 恒流组件底部
        
        const rotCtrX = this._rotX + this._rotW / 2;  // 转子流量计中心X
        const rotTopY = this._rotY;                    // 转子流量计顶部
        const rotBotY = this._rotY + this._rotH;      // 转子流量计底部
        
        const dpCtrX = this._dpX + this._dpW / 2;     // 差压变送器中心X
        const dpBotY = this._dpY + this._dpH;         // 差压变送器底部
        
        const tubeCtrX = this._tankX + this._tankW / 2;  // 浸没管中心X
        const tubeTopY = this._tankY - 10;               // 浸没管顶部连接点
        
        const outPortX = this._boxX;
        const outPortY = this._boxY + 187;
        
        // ── 分流点（位于恒流组件上方） ──
        const branchY = rotTopY - 40;
        
        // ── 管路绘制 ──
        
        // 1. 气源输入 → 恒流组件
        this.group.add(new Konva.Line({
            points: [gasInPortX, gasInPortY, this._cfrX + 30, gasInPortY],
            stroke: '#80cbc4', strokeWidth: 2*pipeW, lineCap: 'round', lineJoin: 'round',
        }));
        
        // 2. 恒流组件 → 转子流量计（
        this.group.add(new Konva.Line({
            points: [cfrCtrX, cfrTopY - 3, cfrCtrX, rotBotY],
            stroke: '#80cbc4', strokeWidth: 2*pipeW, lineCap: 'round', lineJoin: 'round',
        }));
        // 3. 转子流量计 → 背压变送器（
        this.group.add(new Konva.Line({
            points: [cfrCtrX, rotTopY, cfrCtrX, dpBotY],
            stroke: '#80cbc4', strokeWidth: 2*pipeW, lineCap: 'round', lineJoin: 'round',
        }));        
        
        // 4. 分流点到左侧（气压输出口）
        this.group.add(new Konva.Line({
            points: [cfrCtrX, branchY + 20, outPortX - 1.25, branchY + 20],
            stroke: '#4fc3f7', strokeWidth: 2*pipeW, lineCap: 'round', lineJoin: 'round',
        }));
        
        // 5. 分流点向右上方到浸没管（弯曲路径）
        const midX = (this._boxW + 25 + this._tankX) / 2;
        
        // 向右
        this.group.add(new Konva.Line({
            points: [cfrCtrX, branchY + 20, midX - 10, branchY + 20],
            stroke: '#80cbc4', strokeWidth: 2*pipeW, lineCap: 'round', lineJoin: 'round',
        }));
        // 向上
        this.group.add(new Konva.Line({
            points: [midX - 8, branchY + 20, midX - 8, this._boxY - 20],
            stroke: '#80cbc4', strokeWidth: 1.5*pipeW, lineCap: 'round', lineJoin: 'round',
        }));
        // 向右到浸没管
        this.group.add(new Konva.Line({
            points: [midX - 6, this._boxY - 20, tubeCtrX, this._boxY - 20],
            stroke: '#80cbc4', strokeWidth: 1.5*pipeW, lineCap: 'round', lineJoin: 'round',
        }));
        // 进入浸没管
        this.group.add(new Konva.Line({
            points: [tubeCtrX, this._boxY - 20, tubeCtrX, tubeTopY],
            stroke: '#80cbc4', strokeWidth: 3.75, lineCap: 'round', lineJoin: 'round',
        }));
        
        // 6. 背压反馈线（浸没管→差压变送器）
        const feedbackY = this._dpY + 40;
        this._feedbackLine = new Konva.Line({
            points: [
                this._dpX + this._dpW, feedbackY - 20,
                this._tankX , feedbackY - 20,
            ],
            stroke: '#7986cb', strokeWidth: 10, dash: [5, 1],
        });
        this.group.add(this._feedbackLine);
        
        // 7. 分流点标记
        this.group.add(new Konva.Circle({
            x: cfrCtrX, y: branchY + 19, radius: 6,
            fill: '#f70606', stroke: '#4db6ac', strokeWidth: 1,
        }));
    }

    // ── 水箱 ─────────────────────────────────────
    _drawTank() {
        const tx = this._tankX, ty = this._tankY;
        const tw = this._tankW, th = this._tankH;

        // 水箱标签
        const tankLbl = new Konva.Text({
            x: tx+50, y: ty - 20, width: tw,
            text: '被测水箱', fontSize: 13.75,
            fontStyle: 'bold', fill: '#37474f', align: 'center',
        });

        // 外壳（金属感）
        const tankOuter = new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#cfd8dc', stroke: '#78909c',
            strokeWidth: 2.5, cornerRadius: [5,5,0,0],
        });
        // 内壁
        this._tankInner = new Konva.Rect({
            x: tx+5, y: ty+5, width: tw-10, height: th-5,
            fill: '#e8eef0', stroke: '#b0bec5', strokeWidth: 0.75,
        });
        // 液体填充矩形（高度由 liquidLevel 决定，动态更新）
        const liquidH = (this.liquidLevel / 100) * th ;
        this._liquidRect = new Konva.Rect({
            x: tx+5, y: ty + th - liquidH,
            width: tw-10, height: liquidH,
            fill: '#4fc3f7', opacity: 0.82,
        });
        // 液面反光
        this._liquidSurf = new Konva.Rect({
            x: tx+5, y: ty+5 + (th-10) - liquidH,
            width: tw-10, height: 5,
            fill: 'rgba(255, 255, 255, 0.3)',
        });
        // 水箱底部
        const tankBottom = new Konva.Rect({
            x: tx, y: ty+th, width: tw, height: 7.5,
            fill: '#90a4ae', stroke: '#78909c', strokeWidth: 1.25, cornerRadius: [0,0,3.75,3.75],
        });

        // 浸没管（从箱顶穿入，到箱底）
        const tubeX = tx + tw/2;
        this._diptube = new Konva.Line({
            points: [tubeX, ty - 12.5, tubeX, ty + th-10 ],
            stroke: '#37474f', strokeWidth: 3.75, lineCap: 'round',
        });
        // 浸没管内孔（颜色区分）
        this._diptubeInner = new Konva.Line({
            points: [tubeX, ty - 12.5, tubeX, ty + th + 2.5],
            stroke: '#80cbc4', strokeWidth: 2, lineCap: 'round',
        });

        // 液位刻度线（右侧）
        for (let i = 0; i <= 4; i++) {
            const ly = ty + (th * i) / 4;
            this.group.add(new Konva.Line({
                points: [tx + tw, ly, tx + tw + 10, ly],
                stroke: '#78909c', strokeWidth: 1,
            }));
            this.group.add(new Konva.Text({
                x: tx + tw + 12.5, y: ly - 6.25,
                text: `${100 - i*25}%`, fontSize: 10, fill: '#607d8b',
            }));
        }

        // 拖拽提示
        this._dragHint = new Konva.Text({
            x: tx, y: ty + th/2 - 10, width: tw,
            text: '↕ 拖拽调节', fontSize: 10,
            fill: 'rgba(255,255,255,0.6)', align: 'center',
        });

        this.group.add(
            tankLbl, tankOuter, this._tankInner,
            this._liquidRect, this._liquidSurf,
            tankBottom, this._diptube, this._diptubeInner,
            this._dragHint,
        );
    }

    // ── 水箱动态覆盖层（气泡容器）────────────────
    _drawTankOverlay() {
        this._bubbleGroup = new Konva.Group();
        this.group.add(this._bubbleGroup);
    }

    // ── 液位百分比大显示 ──────────────────────────
    _drawLevelDisplay() {
        const dispX = this._boxX + 12;
        const dispY = this._lvlDispY;
        const dispW = this._boxW - 24;
        const dispH = 50;

        const dispBg = new Konva.Rect({
            x: dispX, y: dispY, width: dispW, height: dispH,
            fill: '#d8dde3', stroke: '#1a2634', strokeWidth: 1.25, cornerRadius: 5,
        });
        this._levelMainTxt = new Konva.Text({
            x: dispX, y: dispY + 5, width: dispW,
            text: '50.0 %', fontSize: 27.5,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#4fc3f7', align: 'center',
        });
        this._levelSubTxt = new Konva.Text({
            x: dispX, y: dispY + 35, width: dispW,
            text: `H=1.00m  P=9.81kPa`,
            fontSize: 11.25, fontFamily: 'Courier New, monospace',
            fill: '#546e7a', align: 'center',
        });

        this.group.add(dispBg, this._levelMainTxt, this._levelSubTxt);
    }

    // ── 水箱拖拽交互 ────────────────────────────
    _setupTankDrag() {
        const tx = this._tankX, ty = this._tankY, th = this._tankH;

        // 在液体区域添加透明交互层
        this._tankHitArea = new Konva.Rect({
            x: tx, y: ty, width: this._tankW, height: th,
            fill: 'transparent', listening: true,
        });

        let dragStartY = null;
        let startLevel = null;

        this._tankHitArea.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            startLevel = this.liquidLevel;
            this._dragActive = true;
        });

        const onMove = (e) => {
            if (!this._dragActive || dragStartY === null) return;
            const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? 0);
            const dy = dragStartY - cy;
            const levelDelta = (dy / th) * 100;
            this.liquidLevel = Math.max(0, Math.min(100, startLevel + levelDelta));
            this._updateTankVisual();
        };
        const onUp = () => {
            this._dragActive = false;
            this.update();
            // 流量动态变化由动画循环持续更新，无需手动调用
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);

        this.group.add(this._tankHitArea);
    }

    // ── 更新水箱视觉 ─────────────────────────────
    _updateTankVisual() {
        const ty = this._tankY, th = this._tankH;
        const liquidH = Math.max(0, (this.liquidLevel / 100) * th);
        const newY = ty + th - liquidH;

        this._liquidRect.y(newY);
        this._liquidRect.height(liquidH);
        this._liquidSurf.y(newY);

        // 液体颜色随液位变化（低位偏绿，高位偏蓝）
        const r = Math.round(50  + (100 - this.liquidLevel) * 0.5);
        const g = Math.round(160 + (this.liquidLevel - 50) * 0.4);
        const b = Math.round(200 + (this.liquidLevel - 50) * 0.3);
        this._liquidRect.fill(`rgb(${Math.min(255,r)},${Math.min(255,g)},${Math.min(255,b)})`);
    }

    // ═══════════════════════════════════════════════
    //  动画循环
    // ═══════════════════════════════════════════════
    _startAnimation() {
        const animate = (ts) => {
            if (this._lastTs !== null) {
                const dt = (ts - this._lastTs) / 1000;
                if (this.press > 0) {
                    this._updateBubbles(dt);
                    this._updateRotameter(dt);
                }
                // 持续更新流量动态变化过程（即使液位或气压未改变）
                this.updateFlow();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(animate);
        };
        this._animId = requestAnimationFrame(animate);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 气泡动画 ─────────────────────────────────
    _updateBubbles(dt) {
        const tx = this._tankX + 5;
        const tw = this._tankW - 10;
        const ty = this._tankY + 5;
        const th = this._tankH - 10;
        const liquidH = (this.liquidLevel / 100) * th;
        const liquidTop = ty + th - liquidH;
        const tubeBottomY = ty + th;
        const tubeCX = this._tankX + this._tankW / 2;

        // 产生新气泡（频率随实际流量正比）- 使用actualFlow以反映动态变化
        const bubbleRate = (this.actualFlow / 1.0) * 3;
        if (Math.random() < bubbleRate * dt && this.liquidLevel > 2) {
            this._bubbles.push({
                x: tubeCX + (Math.random() - 0.5) * 5,
                y: tubeBottomY - 2.5,
                r: 3 + Math.random() * 2.5,
                vy: -(31.25 + Math.random() * 25),
                vx: (Math.random() - 0.5) * 10,
                alpha: 0.8,
                life: 0,
            });
        }

        // 更新气泡位置
        this._bubbles = this._bubbles.filter(b => {
            b.life += dt;
            b.y += b.vy * dt;
            b.x += b.vx * dt;
            b.r += dt;
            b.alpha = Math.max(0, 0.85 - b.life * 1.2);
            return b.y > liquidTop && b.alpha > 0.05 && b.x > tx && b.x < tx + tw;
        });

        // 重建气泡 Konva 节点
        this._bubbleGroup.destroyChildren();
        this._bubbles.forEach(b => {
            const circle = new Konva.Circle({
                x: b.x, y: b.y, radius: b.r,
                fill: `rgba(255,255,255,${b.alpha * 0.5})`,
                stroke: `rgba(200,240,255,${b.alpha})`,
                strokeWidth: 1,
            });
            this._bubbleGroup.add(circle);
        });

        // 液面波动
        if (this._bubbles.some(b => b.y - b.r <= liquidTop + 5)) {
            const wave = Math.sin(Date.now() / 200) * 1.875;
            this._liquidSurf.height(5 + Math.abs(wave));
        }
    }

    // ── 转子流量计浮子位置 ───────────────────────
    _updateRotameter(dt) {
        // 使用actualFlow以反映动态流量变化
        const targetPos = this._tubeY + this._tubeH * (1 - this.actualFlow / (this.purgeFlow * 1.5));
        const curr = this._floatBall.y();
        const newY = curr + (targetPos - curr) * Math.min(1, dt * 4);
        this._floatBall.y(Math.max(this._tubeY + 7.5, Math.min(this._tubeY + this._tubeH - 7.5, newY)));
        this._floatGlint.y(this._floatBall.y() - 2.5);
        this._rotText.text(`${this.actualFlow.toFixed(2)}\nL/min`);
    }

    // ═══════════════════════════════════════════════
    //  核心物理计算
    // ═══════════════════════════════════════════════
    _compute(press, deltaTime = 0) {

        // ─────────────────────────────────────────
        // 1. 检测液位变化 → 触发流量动态过渡
        // ─────────────────────────────────────────
        const liquidLevelChange = this.liquidLevel - this.lastLiquidLevel;
        if (Math.abs(liquidLevelChange) > 0.1) {  // 液位有明显变化
            // 液位下降时：背压减小，恒流阀瞬时超调，流量暂时增大
            // 液位上升时：背压增大，恒流阀无法维持，流量暂时保持，逐步减小
            // 无论上升或下降，都需要重新开始动态过渡
            const pressureDelta = liquidLevelChange * (this.liquidDensity * 9.81 / 100 / 1000); // kPa变化
            
            if (liquidLevelChange < 0) {
                // 液位下降：触发流量超调（液位下降Δh负→背压变化ΔP为负→超调因子为正）
                const overshootFactor = -pressureDelta * 2;
                this.flowOvershoot = this.purgeFlow * Math.max(0, overshootFactor) * 1.5;
            } else {
                // 液位上升：触发流量暂时保持（液位上升Δh正→背压变化ΔP为正→超调因子为负）

                const overshootFactor = pressureDelta * 2;
                this.flowOvershoot = -this.purgeFlow * Math.max(0, overshootFactor)*1.5 ;
            }
            
            this.flowChangeStartTime = performance.now() / 1000; // 记录变化开始时间
        }

        // ─────────────────────────────────────────
        // 2. 计算背压与稳定流量（液位升高→背压增大→流量减小）
        // ─────────────────────────────────────────
        const H = (this.liquidLevel / 100) * this.tankHeight;
        console.log(this.press,H);
        const backPressPa =this.liquidDensity * 9.81 * H; // 背压（Pa），不能超过气源压力对应的水柱高度
        const backPressKPa = Math.min( backPressPa / 1000,this.press*1000);
        const backPressMPa = backPressKPa / 1000;  // 转换为MPa便于与气源压力对比

        // 恒流阀的调节能力取决于【气源压力 - 背压】的差值
        // 差值越大，流量越稳定；差值越小，流量控制能力下降
        const pressureDiff = press - backPressMPa;  // 有效压差 (MPa)
        const minPressureDiff = 0.05;  // 恒流阀最小调节压差 (0.05 MPa = 50 kPa)
        
        let steadyFlow;
        if (pressureDiff < 0) {
            // 气源压力不足以克服背压
            steadyFlow = 0;
        } else if (pressureDiff < minPressureDiff) {
            // 压差不足，流量随压差线性衰减（液位升高→流量大幅下降）
            steadyFlow = this.purgeFlow * (pressureDiff / minPressureDiff);
        } else {
            // 压差充足，恒流阀正常维持设定流量
            steadyFlow = this.purgeFlow;
        }
        
        this.targetFlow = steadyFlow;

        // ─────────────────────────────────────────
        // 3. 平滑流量从超调值回到稳定值（指数衰减）
        // ─────────────────────────────────────────
        if (this.flowChangeStartTime !== null && deltaTime > 0) {
            const elapsedTime = (performance.now() / 1000) - this.flowChangeStartTime;
            const timeConstant = this.flowAdjustTime; // 1.5秒时间常数
            
            if (elapsedTime < timeConstant * 3) { // 3倍时间常数内完成过渡
                // 指数衰减：actualFlow = targetFlow + overshoot * exp(-t/τ)
                const decayFactor = Math.exp(-elapsedTime / timeConstant);
                this.actualFlow = this.targetFlow + this.flowOvershoot * decayFactor;
            } else {
                // 过渡完成，回到稳定流量
                this.actualFlow = this.targetFlow;
                this.flowChangeStartTime = null;
                this.flowOvershoot = 0;
            }
        } else {
            // 没有动态变化进行中，直接使用稳定值
            this.actualFlow = this.targetFlow;
        }

        // 确保流量在有效范围内
        this.actualFlow = Math.max(0, Math.min(this.actualFlow, this.purgeFlow * 2));

        // ─────────────────────────────────────────
        // 4. 输出参数
        // ─────────────────────────────────────────


        // 保存当前液位，用于下次比较
        this.lastLiquidLevel = this.liquidLevel;

        return { backPress: backPressKPa, flow: this.actualFlow, level: this.liquidLevel };
    }

    // ═══════════════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════════════
    updateFlow() {
        
        // 计算时间增量用于动态响应
        let deltaTime = 0;
        const currentTime = performance.now() / 1000;
        if (this.lastUpdateTime !== null) {
            deltaTime = currentTime - this.lastUpdateTime;
        }
        this.lastUpdateTime = currentTime;
        
        const res = this._compute(this.press, deltaTime);

        this.backPress   = res.backPress;
        this.flow        = res.flow;
        this._updateTankVisual();
    }

    // ═══════════════════════════════════════════════
    //  显示渲染
    // ═══════════════════════════════════════════════
    update(state) {
        // state: { powered: bool, transCurrent: number }
        // --- 核心修改：开路故障检查 ---
        // 如果开路被设置，或者 state 明确表示断电
        if (this.isBreak || !state || !state.powered) {
            this._dpMainTxt.text('----'); this._dpMainTxt.fill('#1a2634');
            this._dpUnitTxt.opacity(0);
            this._dpMaTxt.text('--- mA');
            this._levelMainTxt.text('-- %');
            this._levelMainTxt.fill('#1a2634');
            this._levelSubTxt.text('断电');
            this._refreshCache();
            return;
        };
        this.powered = true; // 确保状态同步

        const current = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;
        const H = (this.liquidLevel / 100) * this.tankHeight;

        // 背压显示
        this._dpMainTxt.text(this.backPress.toFixed(1)); this._dpMainTxt.fill('#18ee09');
        this._dpUnitTxt.opacity(1);
        this._dpMaTxt.text(`${current.toFixed(2)} mA`);

        // 液位大显示
        const level = Math.max(0, Math.min(100, this.liquidLevel));
        const lvColor = level > 80 ? '#f44336' : level < 20 ? '#ff9800' : '#4fc3f7';
        this._levelMainTxt.text(`${level.toFixed(1)} %`);
        this._levelMainTxt.fill(lvColor);
        this._levelSubTxt.text(`H=${H.toFixed(2)}m  P=${this.backPress.toFixed(1)}kPa`);

        // 恒流组件设定标签
        this._cfrSetLabel.text(`实际流量: ${this.flow.toFixed(2)} L/min`);
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',            key: 'id',            type: 'text'   },
            { label: '液体密度 (kg/m³)',      key: 'liquidDensity', type: 'number' },
            { label: '水箱满量程高度 (m)',    key: 'tankHeight',    type: 'number' },
            { label: '恒定吹气流量 (L/min)',  key: 'purgeFlow',     type: 'number' },
            { label: '气源最大压力 (MPa)',    key: 'maxPressure',   type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id            = newConfig.id            || this.id;
        this.liquidDensity = parseFloat(newConfig.liquidDensity) || this.liquidDensity;
        this.tankHeight    = parseFloat(newConfig.tankHeight)    || this.tankHeight;
        this.purgeFlow     = parseFloat(newConfig.purgeFlow)     || this.purgeFlow;
        this.maxPressure   = parseFloat(newConfig.maxPressure)   || this.maxPressure;
        this.config = { ...this.config, ...newConfig };
        if (this._titleText) this._titleText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}
