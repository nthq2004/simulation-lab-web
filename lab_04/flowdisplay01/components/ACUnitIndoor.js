import { BaseComponent } from './BaseComponent.js';

/**
 * 空调室内机仿真组件
 * （Indoor Air Conditioning Unit）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件仿真壁挂式分体空调室内机，涵盖以下子系统：
 *
 *  【外壳结构】
 *  1. 机壳（Cabinet）：弧面壳体，前面板导风栅
 *  2. 进风口（Air Inlet）：顶部/背部吸风口
 *  3. 出风口（Air Outlet）：底部百叶出风栅
 *  4. 导风板（Louver）：可动水平导风叶片
 *
 *  【制冷系统 — 室内侧】
 *  5. 蒸发器（Evaporator）：铝翅片铜管换热盘管，制冷剂在此蒸发吸热
 *  6. 液管接头（Liquid Line Port）：细管（液态制冷剂进入，约 φ6.35mm）
 *  7. 气管接头（Gas/Suction Line Port）：粗管（气态制冷剂返回，约 φ12.7mm）
 *  8. 膨胀装置（Expansion Device）：电子膨胀阀 / 毛细管节流
 *  9. 排水盘（Drain Pan）：收集蒸发器凝结水
 * 10. 排水管（Drain Pipe）：将冷凝水排至室外
 *
 *  【电气与控制】
 * 11. 贯流风机（Cross-Flow Fan）：室内侧循环风机
 * 12. 风机电机（Fan Motor）：驱动贯流风机
 * 13. 控制板（PCB/Controller）：主控电路板
 * 14. 室内温度传感器（Indoor Temp Sensor，Tsi）
 * 15. 蒸发器管温传感器（Coil Temp Sensor，Tci）
 * 16. 显示面板（Display Panel）：室温、设定温度、运行模式
 *
 *  【管路连接端口】
 *  liquid_port  — 液管（细管）接口，连接室外机膨胀阀出口
 *  gas_port     — 气管（粗管）接口，连接室外机压缩机吸气口
 *  drain_port   — 排水管接口
 *  power_port   — 供电/信号线接口
 *
 * ── 制冷流程 ──────────────────────────────────────────────────
 *
 *  液管入口 → 电子膨胀阀（节流降压）→ 蒸发器盘管（蒸发吸热）→ 气管出口
 *
 *  室内空气经贯流风机循环，流过蒸发器换热：
 *  热空气 → 蒸发器（降温除湿）→ 冷空气经导风板送出
 *  凝结水 → 排水盘 → 排水管 → 室外
 *
 * ── 动态仿真 ──────────────────────────────────────────────────
 *
 *  · 运行状态：风机叶片旋转动画，制冷剂流向动画（虚线流动）
 *  · 导风板摆动：上下扫风模式时百叶周期摆动
 *  · 温度数值动态更新：Tsi / Tci 实时显示
 *  · 制冷剂相态着色：液相（蓝色）→ 两相（青蓝）→ 气相（浅蓝虚线）
 *  · 凝结水动画：蒸发器底部水滴滴落至排水盘
 *  · 状态指示：运行/停止/故障 三色指示灯
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  liquid_port  — 液管接口（右侧下，细）
 *  gas_port     — 气管接口（右侧上，粗）
 *  drain_port   — 排水管接口（底部右）
 *  power_port   — 电源/通信接口（右侧中）
 */
export class IndoorACUnit extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 420);
        this.height = Math.max(220, config.height || 300);

        this.type    = 'indoor_ac_unit';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.label           = config.label           || 'IDU-1';
        this.capacity        = config.capacity        || 3500;    // W 制冷量
        this.ratedPower      = config.ratedPower      || 1200;    // W 电功率
        this.refrigerant     = config.refrigerant     || 'R410A';
        this.airflow         = config.airflow         || 600;     // m³/h

        // ── 运行状态 ──
        this._running        = config.initRunning !== false ? false : true;
        this._mode           = config.mode           || 'cool';   // cool/heat/fan/dry/auto
        this._fanSpeed       = config.fanSpeed       || 'auto';   // auto/low/mid/high
        this._setTemp        = config.setTemp        || 26;       // °C
        this._indoorTemp     = config.indoorTemp     || 28;       // °C 室内温度
        this._coilTemp       = config.coilTemp       || 12;       // °C 蒸发器管温
        this._louverAngle    = 30;                                 // 导风板角度 °
        this._louverDir      = 1;                                  // 摆动方向

        // ── 动画状态 ──
        this._fanAngle       = 0;     // 风机旋转角 °
        this._flowPhase      = 0;     // 制冷剂流动相位 0~1
        this._dropPhase      = 0;     // 水滴下落相位 0~1
        this._louverPhase    = 0;     // 导风板摆动相位 0~1
        this._swingMode      = config.swingMode !== false ? true : false;

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 机壳区域
        this._cabinet = { x: W*0.02, y: H*0.05, w: W*0.96, h: H*0.88, rx: 16 };

        // 进风口（顶部）
        this._inletTop = { x: W*0.10, y: H*0.05, w: W*0.76, h: H*0.06 };

        // 蒸发器区域（内部）
        this._evap = {
            x: W*0.08, y: H*0.12,
            w: W*0.62, h: H*0.45,
        };

        // 贯流风机区域
        this._fan = {
            cx: W*0.78, cy: H*0.50,
            r:  Math.min(W, H) * 0.10,
        };

        // 排水盘
        this._drainPan = {
            x: W*0.08, y: H*0.58,
            w: W*0.62, h: H*0.04,
        };

        // 出风口
        this._outlet = { x: W*0.06, y: H*0.84, w: W*0.88, h: H*0.08 };

        // 管路区域（右侧）
        this._pipeArea = { x: W*0.88, y: H*0.10, w: W*0.10, h: H*0.75 };

        // 显示面板区域
        this._display = { x: W*0.10, y: H*0.06, w: W*0.40, h: H*0.05 };

        // ── 制冷管路关键坐标 ──
        // 液管入口（右侧下）
        this._liquidPortX  = W * 0.95;
        this._liquidPortY  = H * 0.72;
        // 气管出口（右侧上）
        this._gasPortX     = W * 0.95;
        this._gasPortY     = H * 0.20;
        // 膨胀阀位置
        this._expValveX    = W * 0.82;
        this._expValveY    = H * 0.68;
        // 蒸发器液管入口（左下角）
        this._evapLiqInX   = this._evap.x;
        this._evapLiqInY   = this._evap.y + this._evap.h;
        // 蒸发器气管出口（左上角）
        this._evapGasOutX  = this._evap.x;
        this._evapGasOutY  = this._evap.y;

        // 排水管出口
        this._drainPortX   = W * 0.80;
        this._drainPortY   = H * 0.93;

        // 动画状态由 consys._tickAll 统一驱动

        this._init();

        // ── 端口注册 ──
        this.addPort(this._liquidPortX + 4, this._liquidPortY, 'liquid_port', 'pipe', 'LIQ');
        this.addPort(this._gasPortX + 4,    this._gasPortY,    'gas_port',    'pipe', 'GAS');
        this.addPort(this._drainPortX,       this._drainPortY + 4, 'drain_port', 'pipe', 'DRN');
        this.addPort(W * 0.95, H * 0.45,   'power_port',  'wire', 'PWR');
    }

    // ══════════════════════════════════════════════
    _init() {
        this._drawCabinet();
        this._drawAirInlet();
        this._drawEvaporator();
        this._drawExpansionValve();
        this._drawRefrigerantPipes();
        this._drawDrainPan();
        this._drawDrainPipe();
        this._drawFan();
        this._drawAirOutlet();
        this._drawLouvers();
        this._drawSensors();
        this._drawControlBoard();
        this._drawDisplayPanel();
        this._drawPipeConnectors();
        this._drawLabel();
        this._drawStatusIndicator();
        this._buildDynamicLayers();
        this._bindInteraction();
    }

    // ── 机壳 ──────────────────────────────────────
    _drawCabinet() {
        const c = this._cabinet;
        const W = this.width, H = this.height;

        // 外壳主体（浅灰白，家电质感）
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: c.h },
            fillLinearGradientColorStops: [
                0,   '#f0f2f5',
                0.3, '#e8eaed',
                0.7, '#dddfe3',
                1,   '#c8cacf',
            ],
            stroke: '#adb1b8', strokeWidth: 1.5,
            cornerRadius: c.rx,
            shadowColor: '#000', shadowBlur: 10,
            shadowOffsetY: 4, shadowOpacity: 0.18,
        }));

        // 前面板弧面高光（顶部）
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 3,
            width: c.w - 6, height: c.h * 0.12,
            fill: 'rgba(255,255,255,0.40)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));

        // 底部阴影边（立体感）
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y + c.h * 0.88,
            width: c.w, height: c.h * 0.12,
            fill: 'rgba(0,0,0,0.08)',
            cornerRadius: [0, 0, c.rx, c.rx],
        }));

        // 机壳左侧竖向装饰线
        this._staticGroup.add(new Konva.Line({
            points: [c.x + 14, c.y + 20, c.x + 14, c.y + c.h - 20],
            stroke: 'rgba(0,0,0,0.06)', strokeWidth: 2,
        }));
        // 右侧对应
        this._staticGroup.add(new Konva.Line({
            points: [c.x + c.w - 14, c.y + 20, c.x + c.w - 14, c.y + c.h - 20],
            stroke: 'rgba(0,0,0,0.06)', strokeWidth: 2,
        }));
    }

    // ── 进风口（顶部格栅）─────────────────────────
    _drawAirInlet() {
        const W = this.width;
        const ix = this._inletTop.x, iy = this._inletTop.y;
        const iw = this._inletTop.w;

        // 格栅背景
        this._staticGroup.add(new Konva.Rect({
            x: ix, y: iy - 4, width: iw, height: 14,
            fill: '#c8cace', stroke: '#aaa', strokeWidth: 0.8,
            cornerRadius: [4, 4, 0, 0],
        }));
        // 进风格栅横条（均匀分布）
        const barCount = 10;
        const barGap = iw / barCount;
        for (let i = 0; i <= barCount; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [ix + i * barGap, iy - 4, ix + i * barGap, iy + 10],
                stroke: '#9a9ca0', strokeWidth: 0.7,
            }));
        }
        // 进风箭头标注
        this._staticGroup.add(new Konva.Text({
            x: ix + iw * 0.40, y: iy - 14,
            text: '↓ 进风', fontSize: 8, fill: '#6c7a89', fontStyle: 'bold',
        }));
    }

    // ── 蒸发器（铝翅片铜管盘管）──────────────────
    _drawEvaporator() {
        const e = this._evap;
        const W = this.width, H = this.height;

        // 蒸发器背板（深色背景）
        this._staticGroup.add(new Konva.Rect({
            x: e.x - 2, y: e.y - 2,
            width: e.w + 4, height: e.h + 4,
            fill: '#1e2a38', stroke: '#2c3e50', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 铝翅片（密集横向线条，模拟翅片）
        const finCount = Math.floor(e.h / 5);
        for (let i = 0; i < finCount; i++) {
            const fy = e.y + (i / finCount) * e.h;
            const alpha = 0.25 + (i % 2) * 0.08;
            this._staticGroup.add(new Konva.Line({
                points: [e.x, fy, e.x + e.w, fy],
                stroke: `rgba(160,200,220,${alpha})`, strokeWidth: 1,
            }));
        }

        // 铜管蛇形盘管（横向 U 形弯）
        const tubeRows  = 4;
        const tubeColor = '#b87333'; // 铜色
        const tubeHL    = 'rgba(220,170,100,0.6)';
        const rowH = e.h / (tubeRows + 0.5);

        for (let r = 0; r < tubeRows; r++) {
            const ty = e.y + rowH * (r + 0.5);
            const goLeft  = (r % 2 === 0);

            // 主横管
            this._staticGroup.add(new Konva.Line({
                points: [e.x + 6, ty, e.x + e.w - 6, ty],
                stroke: tubeColor, strokeWidth: 5, lineCap: 'round',
            }));
            // 铜管高光
            this._staticGroup.add(new Konva.Line({
                points: [e.x + 8, ty - 1, e.x + e.w - 8, ty - 1],
                stroke: tubeHL, strokeWidth: 1.5, lineCap: 'round',
            }));

            // U 形弯（右侧或左侧）
            if (r < tubeRows - 1) {
                const bendX = goLeft ? (e.x + e.w - 6) : e.x + 6;
                const r1 = rowH * 0.40;
                this._staticGroup.add(new Konva.Arc({
                    x: bendX, y: ty + r1,
                    innerRadius: 0, outerRadius: r1 + 2.5,
                    angle: 180, rotation: goLeft ? -90 : 90,
                    fill: tubeColor, stroke: '#9a5a20', strokeWidth: 0.5,
                }));
                this._staticGroup.add(new Konva.Arc({
                    x: bendX, y: ty + r1,
                    innerRadius: r1 - 1.5, outerRadius: r1 - 0.5,
                    angle: 180, rotation: goLeft ? -90 : 90,
                    fill: tubeHL,
                }));
            }
        }

        // 蒸发器标注
        this._staticGroup.add(new Konva.Text({
            x: e.x + 4, y: e.y + e.h / 2 - 7,
            text: '蒸发器\nEvaporator',
            fontSize: 9, fill: 'rgba(120,190,230,0.85)',
            fontStyle: 'bold', lineHeight: 1.4,
        }));

        // 制冷剂流向指示（蒸发器左侧）
        this._evapFlowArrows = [];
        for (let r = 0; r < tubeRows; r++) {
            const ty = e.y + rowH * (r + 0.5);
            const goRight = (r % 2 === 0);
            const ax = goRight
                ? e.x + e.w * 0.55
                : e.x + e.w * 0.45;
            const arrow = new Konva.Text({
                x: ax, y: ty - 6,
                text: goRight ? '→' : '←',
                fontSize: 9, fill: 'rgba(80,200,255,0.7)', fontStyle: 'bold',
            });
            this._staticGroup.add(arrow);
            this._evapFlowArrows.push({ node: arrow, baseX: ax, ty, goRight });
        }
    }

    // ── 电子膨胀阀 ────────────────────────────────
    _drawExpansionValve() {
        const vx = this._expValveX;
        const vy = this._expValveY;
        const W  = this.width;

        // 阀体
        this._staticGroup.add(new Konva.Rect({
            x: vx - 10, y: vy - 12,
            width: 20, height: 24,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 20, y: 0 },
            fillLinearGradientColorStops: [0,'#4a4a52',0.5,'#72727a',1,'#4a4a52'],
            stroke: '#333', strokeWidth: 1, cornerRadius: 3,
        }));

        // 阀体顶部电磁线圈
        this._staticGroup.add(new Konva.Rect({
            x: vx - 7, y: vy - 22,
            width: 14, height: 10,
            fill: '#2a4a7a', stroke: '#1a3a5a', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 线圈接线
        this._staticGroup.add(new Konva.Line({
            points: [vx - 4, vy - 22, vx - 4, vy - 28, vx + 4, vy - 28, vx + 4, vy - 22],
            stroke: '#5a7aaa', strokeWidth: 1, lineJoin: 'round',
        }));

        // 节流符号（△）
        this._staticGroup.add(new Konva.Line({
            points: [vx, vy - 6, vx - 5, vy + 4, vx + 5, vy + 4, vx, vy - 6],
            stroke: '#ffcc44', strokeWidth: 1, closed: true, fill: 'rgba(255,200,50,0.25)',
        }));

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: vx - 16, y: vy + 14,
            text: 'EXV', fontSize: 7, fill: '#88aacc', fontStyle: 'bold',
        }));
    }

    // ── 制冷剂管路 ────────────────────────────────
    _drawRefrigerantPipes() {
        const W = this.width, H = this.height;
        const e = this._evap;

        // ── 液管路径（细管，蓝色）：液管接口 → 膨胀阀 → 蒸发器下端入口 ──
        const liquidPath = [
            // 液管接口
            this._liquidPortX, this._liquidPortY,
            // 横向进入机体
            W * 0.88, this._liquidPortY,
            // 向上至膨胀阀
            this._expValveX, this._liquidPortY,
            this._expValveX, this._expValveY + 12,
        ];

        // 膨胀阀出口 → 蒸发器液管入口
        const liqEvapPath = [
            this._expValveX, this._expValveY + 12,
            this._expValveX, H * 0.64,
            e.x + e.w * 0.15, H * 0.64,
            e.x + e.w * 0.15, e.y + e.h,
        ];

        // 液管（实线，蓝色）
        this._staticGroup.add(new Konva.Line({
            points: liquidPath,
            stroke: '#2196f3', strokeWidth: 3,
            lineCap: 'round', lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: liqEvapPath,
            stroke: '#2196f3', strokeWidth: 3,
            lineCap: 'round', lineJoin: 'round',
        }));

        // ── 气管路径（粗管，浅蓝虚线）：蒸发器上端出口 → 气管接口 ──
        const gasPath = [
            e.x + e.w * 0.50, e.y,
            e.x + e.w * 0.50, H * 0.10,
            W * 0.88, H * 0.10,
            this._gasPortX, H * 0.10,
            this._gasPortX, this._gasPortY,
        ];

        this._staticGroup.add(new Konva.Line({
            points: gasPath,
            stroke: '#80d8ff', strokeWidth: 5,
            lineCap: 'round', lineJoin: 'round',
            dash: [8, 4],
        }));

        // 管路流向箭头标注（静态）
        this._staticGroup.add(new Konva.Text({
            x: W * 0.87, y: this._liquidPortY - 14,
            text: '液管 ↑', fontSize: 7, fill: '#2196f3', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.87, y: this._gasPortY + 4,
            text: '气管 ↓', fontSize: 7, fill: '#80d8ff', fontStyle: 'bold',
        }));

        // ── 管路保温层标注 ──
        this._staticGroup.add(new Konva.Text({
            x: W * 0.88, y: H * 0.38,
            text: '保温\n管路',
            fontSize: 6.5, fill: '#546e7a', lineHeight: 1.4, align: 'center',
        }));
    }

    // ── 排水盘 ────────────────────────────────────
    _drawDrainPan() {
        const dp = this._drainPan;

        // 排水盘主体
        this._staticGroup.add(new Konva.Rect({
            x: dp.x, y: dp.y,
            width: dp.w, height: dp.h,
            fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1,
            cornerRadius: [0, 0, 3, 3],
        }));
        // 积水槽（蓝色水面）
        this._waterLevel = new Konva.Rect({
            x: dp.x + 2, y: dp.y + 1,
            width: dp.w - 4, height: dp.h - 3,
            fill: 'rgba(100,180,255,0.35)',
            cornerRadius: [0, 0, 2, 2],
        });
        this._staticGroup.add(this._waterLevel);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: dp.x + dp.w * 0.30, y: dp.y - 10,
            text: '排水盘', fontSize: 7, fill: '#78909c',
        }));
    }

    // ── 排水管 ────────────────────────────────────
    _drawDrainPipe() {
        const dp = this._drainPan;
        const W  = this.width, H = this.height;

        // 排水管路径：排水盘右侧 → 向下 → 穿出机壳底部
        const drainX = dp.x + dp.w * 0.85;
        const drainPathPoints = [
            drainX, dp.y + dp.h,
            drainX, H * 0.88,
            this._drainPortX, H * 0.88,
            this._drainPortX, this._drainPortY,
        ];

        this._staticGroup.add(new Konva.Line({
            points: drainPathPoints,
            stroke: '#78909c', strokeWidth: 3,
            lineCap: 'round', lineJoin: 'round',
        }));
        // 排水管高光
        this._staticGroup.add(new Konva.Line({
            points: drainPathPoints.map((v, i) => i % 2 === 0 ? v - 0.5 : v),
            stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1,
            lineCap: 'round', lineJoin: 'round',
        }));
        // 标注
        this._staticGroup.add(new Konva.Text({
            x: this._drainPortX + 4, y: H * 0.86,
            text: '排水管', fontSize: 7, fill: '#78909c',
        }));
    }

    // ── 贯流风机 ──────────────────────────────────
    _drawFan() {
        const f    = this._fan;
        const r    = f.r;
        const bladeCount = 18;

        // 风机外壳
        this._staticGroup.add(new Konva.Circle({
            x: f.cx, y: f.cy, radius: r + 4,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5,
        }));

        // 叶片组（动态层）
        this._fanGroup = new Konva.Group({ x: f.cx, y: f.cy });
        for (let i = 0; i < bladeCount; i++) {
            const angle = (i / bladeCount) * 360;
            const blade = new Konva.Line({
                points: [0, 0, 0, -r * 0.85],
                stroke: '#90a4ae', strokeWidth: 2.2,
                lineCap: 'round', rotation: angle,
            });
            this._fanGroup.add(blade);
        }
        // 风机中心轴
        this._fanGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r * 0.15,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1,
        }));
        this._staticGroup.add(this._fanGroup);

        // 风机电机（轴端标注）
        this._staticGroup.add(new Konva.Text({
            x: f.cx - 12, y: f.cy + r + 6,
            text: '贯流风机', fontSize: 7, fill: '#78909c', fontStyle: 'bold',
        }));
    }

    // ── 出风口百叶 ────────────────────────────────
    _drawAirOutlet() {
        const o  = this._outlet;
        const W  = this.width;

        // 出风口框架
        this._staticGroup.add(new Konva.Rect({
            x: o.x, y: o.y, width: o.w, height: o.h,
            fill: '#c8cacd', stroke: '#a8aaad', strokeWidth: 1,
            cornerRadius: [0, 0, 10, 10],
        }));

        // 出风箭头标注
        this._staticGroup.add(new Konva.Text({
            x: o.x + o.w * 0.38, y: o.y + o.h + 4,
            text: '↓ 出风', fontSize: 8, fill: '#6c7a89', fontStyle: 'bold',
        }));
    }

    // ── 导风板（可动百叶）────────────────────────
    _drawLouvers() {
        const o = this._outlet;
        this._louverGroup = new Konva.Group();

        // 5 片水平导风叶片
        this._louvers = [];
        const louverCount = 5;
        const louverGap   = o.w * 0.90 / louverCount;

        for (let i = 0; i < louverCount; i++) {
            const lx = o.x + o.w * 0.05 + i * louverGap;
            const ly = o.y + o.h * 0.30;

            const louver = new Konva.Line({
                points: [lx, ly, lx + louverGap * 0.85, ly],
                stroke: '#7a7e84', strokeWidth: 4,
                lineCap: 'round',
                rotation: this._louverAngle,
                offsetX: 0, offsetY: 0,
            });
            this._louverGroup.add(louver);
            this._louvers.push({ node: louver, lx, ly });
        }
        this._staticGroup.add(this._louverGroup);
    }

    // ── 传感器 ────────────────────────────────────
    _drawSensors() {
        const W = this.width, H = this.height;
        const e = this._evap;

        // 室内温度传感器（Tsi）
        const tsiX = e.x + e.w * 0.85;
        const tsiY = e.y + e.h * 0.20;
        this._staticGroup.add(new Konva.Circle({
            x: tsiX, y: tsiY, radius: 5,
            fill: '#ff8f00', stroke: '#e65100', strokeWidth: 1,
        }));
        this._tsiText = new Konva.Text({
            x: tsiX - 18, y: tsiY + 7,
            text: `Tsi: ${this._indoorTemp}°C`,
            fontSize: 7, fill: '#ff8f00', fontStyle: 'bold',
        });
        this._staticGroup.add(this._tsiText);

        // 蒸发器管温传感器（Tci，夹在铜管上）
        const tciX = e.x + e.w * 0.30;
        const tciY = e.y + e.h * 0.70;
        this._staticGroup.add(new Konva.Circle({
            x: tciX, y: tciY, radius: 5,
            fill: '#29b6f6', stroke: '#0277bd', strokeWidth: 1,
        }));
        this._tciText = new Konva.Text({
            x: tciX - 18, y: tciY + 7,
            text: `Tci: ${this._coilTemp}°C`,
            fontSize: 7, fill: '#29b6f6', fontStyle: 'bold',
        });
        this._staticGroup.add(this._tciText);

        // 传感器导线
        this._staticGroup.add(new Konva.Line({
            points: [tsiX, tsiY, tsiX + 10, tsiY - 12, W * 0.85, tsiY - 12],
            stroke: '#e65100', strokeWidth: 0.8, dash: [3, 2],
        }));
        this._staticGroup.add(new Konva.Line({
            points: [tciX, tciY, tciX + 10, tciY - 8, W * 0.75, tciY - 8],
            stroke: '#0277bd', strokeWidth: 0.8, dash: [3, 2],
        }));
    }

    // ── 控制板（PCB）──────────────────────────────
    _drawControlBoard() {
        const W = this.width, H = this.height;
        const bx = W * 0.70, by = H * 0.28;
        const bw = W * 0.14, bh = H * 0.22;

        // PCB 基板（绿色）
        this._staticGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#1b5e20', stroke: '#2e7d32', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // PCB 铜箔走线（示意）
        for (let i = 0; i < 4; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [bx + 3, by + (i + 1) * bh / 5, bx + bw - 3, by + (i + 1) * bh / 5],
                stroke: '#ffd54f', strokeWidth: 0.6,
            }));
        }
        // 电容器（两个小矩形）
        [[bx + bw * 0.20, by + bh * 0.15], [bx + bw * 0.60, by + bh * 0.15]].forEach(([cx, cy]) => {
            this._staticGroup.add(new Konva.Rect({
                x: cx - 2, y: cy, width: 5, height: 8,
                fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.5, cornerRadius: 1,
            }));
        });
        // MCU 芯片
        this._staticGroup.add(new Konva.Rect({
            x: bx + bw * 0.25, y: by + bh * 0.50,
            width: bw * 0.50, height: bh * 0.35,
            fill: '#212121', stroke: '#616161', strokeWidth: 0.5, cornerRadius: 1,
        }));
        // 芯片标注
        this._staticGroup.add(new Konva.Text({
            x: bx + bw * 0.26, y: by + bh * 0.56,
            text: 'MCU', fontSize: 5.5, fill: '#9e9e9e', fontStyle: 'bold',
        }));

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: bx, y: by - 10,
            text: '主控板', fontSize: 7, fill: '#4caf50', fontStyle: 'bold',
        }));
    }

    // ── 显示面板 ──────────────────────────────────
    _drawDisplayPanel() {
        const d = this._display;
        const W = this.width;

        // 显示屏背景（深色）
        this._staticGroup.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: '#0d1117', stroke: '#30363d', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 显示内容
        const modeIcon = { cool: '❄', heat: '🔥', fan: '🌀', dry: '💧', auto: 'A' };
        this._displayText = new Konva.Text({
            x: d.x + 4, y: d.y + 1,
            text: `${modeIcon[this._mode] || '❄'} ${this._setTemp}°C  室内:${this._indoorTemp}°C`,
            fontSize: 8, fill: this._running ? '#00e5ff' : '#444',
            fontStyle: 'bold',
        });
        this._staticGroup.add(this._displayText);

        // 运行状态指示灯（显示屏右端）
        this._runLed = new Konva.Circle({
            x: d.x + d.w - 6, y: d.y + d.h / 2,
            radius: 3,
            fill: this._running ? '#00e676' : '#444',
            stroke: this._running ? '#00c853' : '#222',
            strokeWidth: 0.8,
            shadowColor: this._running ? '#00e676' : 'transparent',
            shadowBlur: this._running ? 6 : 0,
            shadowOpacity: 0.9,
        });
        this._staticGroup.add(this._runLed);
    }

    // ── 管路接口连接头 ────────────────────────────
    _drawPipeConnectors() {
        const W = this.width, H = this.height;

        // 液管接口（细，蓝色）
        this._drawPortFitting(
            this._liquidPortX, this._liquidPortY,
            3, '#2196f3', '液管\nφ6.35', 'left'
        );

        // 气管接口（粗，浅蓝）
        this._drawPortFitting(
            this._gasPortX, this._gasPortY,
            5, '#80d8ff', '气管\nφ12.7', 'left'
        );

        // 排水管接口（灰色）
        this._drawPortFitting(
            this._drainPortX, this._drainPortY,
            3, '#90a4ae', '排水\nφ16', 'top'
        );

        // 电源接口
        const pwrX = W * 0.95, pwrY = H * 0.45;
        this._staticGroup.add(new Konva.Rect({
            x: pwrX - 5, y: pwrY - 8,
            width: 10, height: 16,
            fill: '#3a3a3a', stroke: '#555', strokeWidth: 1, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: pwrX - 12, y: pwrY + 10,
            text: 'PWR', fontSize: 6.5, fill: '#9e9e9e',
        }));
    }

    _drawPortFitting(x, y, r, color, labelText, labelDir) {
        // 法兰（外六角）
        const points = [];
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            points.push(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
        }
        this._staticGroup.add(new Konva.Line({
            points, closed: true,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        }));
        // 管口
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r + 1,
            fill: '#1a2a3a', stroke: color, strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r - 0.5,
            fill: color, opacity: 0.4,
        }));

        // 标注
        const lx = labelDir === 'left' ? x - 26 : x - 10;
        const ly = labelDir === 'top'  ? y - 22  : y - 8;
        this._staticGroup.add(new Konva.Text({
            x: lx, y: ly, text: labelText,
            fontSize: 6.5, fill: color, fontStyle: 'bold',
            lineHeight: 1.3, align: 'right',
        }));
    }

    // ── 组件标注 ──────────────────────────────────
    _drawLabel() {
        const W = this.width;
        // 位号
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  壁挂式室内机  ${this.capacity}W  ${this.refrigerant}`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示灯 ────────────────────────────────
    _drawStatusIndicator() {
        const W = this.width, H = this.height;
        const c = this._cabinet;
        const ix = c.x + c.w - 20;
        const iy = c.y + 16;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 5,
            fill: this._running ? '#00e676' : '#ef5350',
            stroke: this._running ? '#00c853' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._running ? '#00e676' : '#ef5350',
            shadowBlur: this._running ? 8 : 2,
            shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix - 16, y: iy + 7,
            text: this._running ? '运行' : '停机',
            fontSize: 7, fontStyle: 'bold',
            fill: this._running ? '#00e676' : '#ef5350',
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    // ── 动态层（制冷剂流动粒子、水滴）────────────
    _buildDynamicLayers() {
        const W = this.width, H = this.height;

        // 制冷剂流动动画层
        this._flowGroup = new Konva.Group();
        this._staticGroup.add(this._flowGroup);

        // 液管流动粒子（3 粒）
        this._liquidParticles = [];
        for (let i = 0; i < 3; i++) {
            const p = new Konva.Circle({
                x: 0, y: 0, radius: 2.5,
                fill: '#2196f3', opacity: 0.8,
                shadowColor: '#2196f3', shadowBlur: 4, shadowOpacity: 0.6,
            });
            this._flowGroup.add(p);
            this._liquidParticles.push({ node: p, t: i / 3 });
        }

        // 气管流动粒子（3 粒，较大）
        this._gasParticles = [];
        for (let i = 0; i < 3; i++) {
            const p = new Konva.Circle({
                x: 0, y: 0, radius: 3.5,
                fill: '#80d8ff', opacity: 0.6,
                shadowColor: '#80d8ff', shadowBlur: 5, shadowOpacity: 0.5,
            });
            this._flowGroup.add(p);
            this._gasParticles.push({ node: p, t: i / 3 });
        }

        // 蒸发器制冷剂相态变化（从蓝→青的渐变条，覆盖在蒸发器上）
        this._phaseOverlay = new Konva.Rect({
            x: this._evap.x, y: this._evap.y,
            width: this._evap.w, height: this._evap.h,
            fillLinearGradientStartPoint: { x: 0, y: this._evap.h },
            fillLinearGradientEndPoint:   { x: 0, y: 0 },
            fillLinearGradientColorStops: [
                0, 'rgba(30,100,255,0.10)',
                0.5, 'rgba(0,180,255,0.07)',
                1,  'rgba(100,230,255,0.05)',
            ],
            cornerRadius: 3,
            listening: false,
        });
        this._flowGroup.add(this._phaseOverlay);

        // 水滴层
        this._dropGroup = new Konva.Group();
        this._staticGroup.add(this._dropGroup);

        this._drops = [];
        const dp = this._drainPan;
        for (let i = 0; i < 4; i++) {
            const dropX = this._evap.x + (i + 1) * this._evap.w / 5;
            const drop = new Konva.Ellipse({
                x: dropX,
                y: this._evap.y + this._evap.h - 5,
                radiusX: 2, radiusY: 3,
                fill: 'rgba(100,180,255,0.7)',
                opacity: 0,
            });
            this._dropGroup.add(drop);
            this._drops.push({
                node: drop,
                baseY: this._evap.y + this._evap.h - 5,
                targetY: dp.y,
                t: i / 4,
            });
        }
    }

    // ══════════════════════════════════════════════
    // 液管粒子路径：液管接口 → 膨胀阀 → 蒸发器入口
    _getLiquidPath() {
        const W = this.width, H = this.height;
        const e = this._evap;
        return [
            { x: this._liquidPortX,      y: this._liquidPortY },
            { x: W * 0.88,               y: this._liquidPortY },
            { x: this._expValveX,        y: this._liquidPortY },
            { x: this._expValveX,        y: this._expValveY + 12 },
            { x: this._expValveX,        y: H * 0.64 },
            { x: e.x + e.w * 0.15,       y: H * 0.64 },
            { x: e.x + e.w * 0.15,       y: e.y + e.h },
        ];
    }

    // 气管粒子路径：蒸发器出口 → 气管接口
    _getGasPath() {
        const W = this.width, H = this.height;
        const e = this._evap;
        return [
            { x: e.x + e.w * 0.50, y: e.y },
            { x: e.x + e.w * 0.50, y: H * 0.10 },
            { x: W * 0.88,          y: H * 0.10 },
            { x: this._gasPortX,    y: H * 0.10 },
            { x: this._gasPortX,    y: this._gasPortY },
        ];
    }

    _interpolatePath(path, t) {
        // 计算路径总长度
        let totalLen = 0;
        const segs = [];
        for (let i = 0; i < path.length - 1; i++) {
            const dx = path[i+1].x - path[i].x;
            const dy = path[i+1].y - path[i].y;
            const len = Math.sqrt(dx*dx + dy*dy);
            segs.push(len);
            totalLen += len;
        }
        // 找到 t 对应的位置
        let target = t * totalLen;
        for (let i = 0; i < segs.length; i++) {
            if (target <= segs[i] || i === segs.length - 1) {
                const frac = segs[i] > 0 ? target / segs[i] : 0;
                return {
                    x: path[i].x + (path[i+1].x - path[i].x) * frac,
                    y: path[i].y + (path[i+1].y - path[i].y) * frac,
                };
            }
            target -= segs[i];
        }
        return path[path.length - 1];
    }

    // ══════════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }

    _tickAnimation(dt) {
        if (!this._running) {
            // 停机时确保粒子不可见
            [...this._liquidParticles, ...this._gasParticles].forEach(p => p.node.opacity(0));
            this._drops.forEach(d => d.node.opacity(0));
            return;
        }

        // ── 风机旋转 ──
        this._fanAngle += dt * 360 * (
            this._fanSpeed === 'high' ? 3.5 :
            this._fanSpeed === 'mid'  ? 2.5 : 1.8
        );
        this._fanGroup.rotation(this._fanAngle);

        // ── 制冷剂粒子流动 ──
        const flowSpeed = 0.25; // 路径/s
        this._flowPhase = (this._flowPhase + dt * flowSpeed) % 1;

        const liqPath = this._getLiquidPath();
        const gasPath = this._getGasPath();

        this._liquidParticles.forEach(p => {
            const t = (p.t + this._flowPhase) % 1;
            const pos = this._interpolatePath(liqPath, t);
            p.node.x(pos.x);
            p.node.y(pos.y);
            p.node.opacity(0.85);
        });

        this._gasParticles.forEach(p => {
            const t = (p.t + this._flowPhase) % 1;
            const pos = this._interpolatePath(gasPath, t);
            p.node.x(pos.x);
            p.node.y(pos.y);
            p.node.opacity(0.65);
        });

        // ── 导风板摆动 ──
        if (this._swingMode) {
            this._louverPhase += dt * 0.5;
            const swingAngle = 20 + 25 * Math.sin(this._louverPhase * Math.PI * 2);
            this._louvers.forEach(({ node }) => {
                node.rotation(swingAngle);
            });
            this._louverAngle = swingAngle;
        }

        // ── 水滴动画（蒸发器 → 排水盘）──
        const dropSpeed = 0.6;
        this._dropPhase = (this._dropPhase + dt * dropSpeed) % 1;
        this._drops.forEach(d => {
            const t = (d.t + this._dropPhase) % 1;
            const cy = d.baseY + (d.targetY - d.baseY) * t;
            d.node.y(cy);
            // 淡入淡出
            const fade = t < 0.1 ? t * 10 :
                         t > 0.85 ? (1 - t) * 6.67 : 1;
            d.node.opacity(fade * 0.7);
        });

        // ── 温度数值更新（每秒）──
        if (!this._tempTimer || Date.now() - this._tempTimer > 2000) {
            this._tempTimer = Date.now();
            if (this._running) {
                // 制冷模式下室内温度缓慢下降
                if (this._mode === 'cool' && this._indoorTemp > this._setTemp) {
                    this._indoorTemp = Math.max(this._setTemp,
                        parseFloat((this._indoorTemp - 0.05).toFixed(1)));
                }
                // 管温动态
                this._coilTemp = 10 + 3 * Math.sin(Date.now() / 5000);
            }
            this._tsiText?.text(`Tsi: ${this._indoorTemp.toFixed(1)}°C`);
            this._tciText?.text(`Tci: ${this._coilTemp.toFixed(1)}°C`);
            this._displayText?.text(
                `❄ ${this._setTemp}°C  室内:${this._indoorTemp.toFixed(1)}°C`
            );
        }

        this._refreshCache();
    }

    _bindInteraction() {
        // 点击显示面板切换运行状态
        if (this._displayText) {
            this._displayText.on('click tap', () => this.toggle());
            this._displayText.listening(true);
        }
        if (this._runLed) {
            this._runLed.on('click tap', () => this.toggle());
            this._runLed.listening(true);
        }
    }

    // ══════════════════════════════════════════════
    // ── 公共 API ──────────────────────────────────

    /** 切换运行/停机 */
    toggle() {
        this._running = !this._running;
        this._updateStatus();
        this._refreshCache();
    }

    /** 启动 */
    start() {
        if (this._running) return;
        this._running = true;
        this._updateStatus();
        this._refreshCache();
    }

    /** 停机 */
    stop() {
        if (!this._running) return;
        this._running = false;
        this._updateStatus();
        this._refreshCache();
    }

    /** 设置目标温度 */
    setTemperature(temp) {
        this._setTemp = Math.max(16, Math.min(30, temp));
        this._displayText?.text(`❄ ${this._setTemp}°C  室内:${this._indoorTemp.toFixed(1)}°C`);
        this._refreshCache();
    }

    /** 设置运行模式 */
    setMode(mode) {
        if (['cool', 'heat', 'fan', 'dry', 'auto'].includes(mode)) {
            this._mode = mode;
            this._refreshCache();
        }
    }

    /** 设置风速 */
    setFanSpeed(speed) {
        if (['auto', 'low', 'mid', 'high'].includes(speed)) {
            this._fanSpeed = speed;
        }
    }

    /** 开/关摆风 */
    setSwing(on) {
        this._swingMode = !!on;
        if (!on) {
            this._louvers.forEach(({ node }) => node.rotation(30));
        }
    }

    _updateStatus() {
        if (this._statusDot) {
            this._statusDot.fill(this._running ? '#00e676' : '#ef5350');
            this._statusDot.stroke(this._running ? '#00c853' : '#c62828');
            this._statusDot.shadowColor(this._running ? '#00e676' : '#ef5350');
            this._statusDot.shadowBlur(this._running ? 8 : 2);
        }
        if (this._statusText) {
            this._statusText.text(this._running ? '运行' : '停机');
            this._statusText.fill(this._running ? '#00e676' : '#ef5350');
        }
        if (this._runLed) {
            this._runLed.fill(this._running ? '#00e676' : '#444');
            this._runLed.shadowColor(this._running ? '#00e676' : 'transparent');
            this._runLed.shadowBlur(this._running ? 6 : 0);
        }
    }

    isRunning()     { return this._running; }
    getMode()       { return this._mode; }
    getFanSpeed()   { return this._fanSpeed; }
    getSetTemp()    { return this._setTemp; }
    getIndoorTemp() { return this._indoorTemp; }
    getCoilTemp()   { return this._coilTemp; }

    update(state) {
        if (typeof state === 'boolean') { state ? this.start() : this.stop(); }
        if (typeof state === 'object' && state !== null) {
            if (state.running  !== undefined) state.running ? this.start() : this.stop();
            if (state.setTemp  !== undefined) this.setTemperature(state.setTemp);
            if (state.mode     !== undefined) this.setMode(state.mode);
            if (state.fanSpeed !== undefined) this.setFanSpeed(state.fanSpeed);
            if (state.swing    !== undefined) this.setSwing(state.swing);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '制冷量 (W)',         key: 'capacity',     type: 'number' },
            { label: '额定功率 (W)',       key: 'ratedPower',   type: 'number' },
            { label: '制冷剂型号',         key: 'refrigerant',  type: 'text'   },
            { label: '设定温度 (°C)',      key: 'setTemp',      type: 'number' },
            { label: '运行模式',           key: 'mode',         type: 'text'   },
            { label: '风速',               key: 'fanSpeed',     type: 'text'   },
            { label: '初始运行（1=运行）', key: 'initRunning',  type: 'number' },
            { label: '摆风（1=开）',       key: 'swingMode',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label        = cfg.label       || this.label;
        this.capacity     = parseFloat(cfg.capacity)   || this.capacity;
        this.ratedPower   = parseFloat(cfg.ratedPower) || this.ratedPower;
        this.refrigerant  = cfg.refrigerant || this.refrigerant;
        if (cfg.setTemp   !== undefined) this.setTemperature(parseFloat(cfg.setTemp));
        if (cfg.mode      !== undefined) this.setMode(cfg.mode);
        if (cfg.fanSpeed  !== undefined) this.setFanSpeed(cfg.fanSpeed);
        if (cfg.swingMode !== undefined) this.setSwing(!!parseInt(cfg.swingMode));
        if (cfg.initRunning !== undefined) {
            parseInt(cfg.initRunning) ? this.start() : this.stop();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}