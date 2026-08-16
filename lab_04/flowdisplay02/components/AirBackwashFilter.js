import { BaseComponent } from './BaseComponent.js';

/**
 * 空气反冲式自清洗滤器（Air Backwash Self-Cleaning Filter）仿真组件
 *
 * ── 结构说明（参照图纸）────────────────────────────────────────
 *
 *  本仿真对应图纸左侧剖面图，各编号对应如下：
 *
 *  1  — 滤筒（Filter Cartridge）：内部圆柱形滤网，过滤流体杂质
 *  2  — 电动机（Motor）：驱动旋转体（清洗臂）旋转，顶部安装
 *  3  — 压差传感器高压侧（ΔP₂ upper）：出口侧压力测点
 *  4  — 压差传感器低压侧（ΔP₁ lower）：进口侧压力测点
 *  5  — 旋转体（Rotating Cleaner Arm）：带喷嘴，对准某节滤筒时反吹清洗
 *  6  — 滤筒截面（正视图）：四叶花瓣形截面，显示各滤筒位置
 *  7  — 出口（Outlet）：过滤后的洁净流体出口（底部）
 *  8  — 进口（Inlet）：含杂质流体进口（侧面）
 *  9  — 清洗位置指示（旋转体当前对准的滤筒编号）
 *  S₁ — 位置开关（Position Switch）：检测旋转体是否对准滤筒
 *  P₀ — 反冲气源压力（Air Supply for Backwash）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  正常过滤：
 *    流体从进口(8)进入滤筒(1)，经滤网过滤后从出口(7)流出。
 *    随着滤网积污，进出口压差 ΔP = ΔP₂ - ΔP₁ 逐渐增大。
 *
 *  清洗触发条件（满足任一）：
 *    A. 压差 ΔP ≥ 清洗启动阈值（默认 0.08 MPa）
 *    B. 定时清洗（可配置间隔，默认关闭）
 *    C. 手动触发
 *
 *  清洗过程：
 *    1. 电动机启动（motor_run=true）→ 旋转体开始旋转
 *    2. 旋转体每对准一节滤筒时，位置开关 S₁ 触发（s1_active=true）
 *    3. S₁ 触发同时，清洗电磁阀（solenoid_valve）通电，
 *       反冲气体 P₀ 从旋转体喷嘴喷出，反向冲洗对准的滤筒
 *    4. 被冲洗的杂质从排污口排出
 *    5. 旋转体完成一圈（所有滤筒均清洗完毕）→ 电动机停止
 *    6. 清洗结束后压差恢复正常
 *
 * ── 压差模型 ──────────────────────────────────────────────────
 *
 *  进口压力 P_in  : 0.10 ~ 0.50 MPa（可配置，默认 0.30 MPa）
 *  出口压力 P_out : P_in - ΔP
 *  正常压差 ΔP_clean : 0.01 ~ 0.03 MPa（滤网洁净）
 *  污堵压差 ΔP_dirty : 0.08 ~ 0.15 MPa（滤网积污）
 *  清洗后压差逐渐恢复至 ΔP_clean
 *
 *  每次清洗使压差降低 ΔP_step（一节滤筒的贡献量）
 *
 * ── 状态机 ────────────────────────────────────────────────────
 *
 *  FILTERING  : 正常过滤，压差缓慢上升
 *  CLEANING   : 清洗中，旋转体旋转，逐节反吹
 *  PAUSED     : 电动机停止（手动暂停或故障）
 *
 * ── 重点接口（对外可观测/可控） ──────────────────────────────
 *
 *  motor_run       [bool]   — 电动机运行状态
 *  solenoid_valve  [bool]   — 清洗电磁阀状态（S₁对准时同步为true）
 *  s1_active       [bool]   — 位置开关状态（旋转体对准滤筒时true）
 *  s1_cartridge    [int]    — 当前对准的滤筒编号（0-N_CARTRIDGES-1）
 *  rotorAngle      [°]      — 旋转体当前角度
 *  pressureIn      [MPa]    — 进口压力
 *  pressureOut     [MPa]    — 出口压力
 *  deltaPressure   [MPa]    — 压差 ΔP
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_inlet      — 进口（流体输入）
 *  port_outlet     — 出口（净化输出）
 *  port_drain      — 排污口
 *  port_air        — 反冲气源
 *  port_motor_u    — 电动机电源 U
 *  port_motor_v    — 电动机电源 V
 *  port_motor_w    — 电动机电源 W
 *  port_s1_com     — 位置开关公共端
 *  port_s1_no      — 位置开关常开端
 *  port_sol_plus   — 电磁阀正极
 *  port_sol_minus  — 电磁阀负极
 *  port_dp_high    — 压差传感器高压侧
 *  port_dp_low     — 压差传感器低压侧
 */
export class AirBackwashFilter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 420);
        this.height = Math.max(340, config.height || 440);

        this.type    = 'air_backwash_filter';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label           = config.label           || 'FT-01';
        this.ratedFlow       = config.ratedFlow       || 100;      // m³/h
        this.filterRating    = config.filterRating    || 100;      // μm
        this.designPressure  = config.designPressure  || 1.0;      // MPa
        this.N_CARTRIDGES    = config.nCartridges     || 4;        // 滤筒数量

        // ── 压力参数 ──
        this.pressureInNominal  = config.pressureInNominal  || 0.30;  // MPa 进口额定压力
        this.dPclean            = config.dPclean            || 0.02;  // MPa 洁净时压差
        this.dPdirty            = config.dPdirty            || 0.10;  // MPa 开始清洗阈值
        this.dPmax              = config.dPmax              || 0.15;  // MPa 最大允许压差
        this.dPstep             = (this.dPdirty - this.dPclean) / this.N_CARTRIDGES; // 每节清洗降低量

        // ── 运行状态 ──
        this._state         = 'FILTERING'; // FILTERING | CLEANING | PAUSED
        this._deltaPressure = this.dPclean;  // 当前压差（MPa）
        this._pressureIn    = this.pressureInNominal;
        this._dirtyRate     = config.dirtyRate || 0.004; // MPa/s 积污速率

        // ── 电动机 & 旋转体 ──
        this._motorRunning  = false;
        this._rotorAngle    = 0;            // ° 0-360
        this._motorSpeed    = config.motorSpeed || 18; // °/s (1圈/20s)
        this._motorCurrentAnim = 0;         // 电流动画

        // ── 位置开关 ──
        this._s1Active      = false;
        this._s1Cartridge   = -1;           // 当前对准滤筒编号
        this._s1HoldTime    = 0.6;          // s 位置开关保持时间（角度窗口/速度）
        this._s1Timer       = 0;

        // ── 电磁阀 ──
        this._solenoidOn    = false;
        this._backwashFlowT = 0;            // 反冲气流动画计时

        // ── 清洗计数 ──
        this._cleanedCount  = 0;            // 本次清洗已清洗的滤筒数
        this._totalCycles   = 0;            // 累计清洗次数
        this.opsCount       = config.initOps || 0;

        // ── 流体流动动画 ──
        this._flowPhase     = 0;
        this._inletFlowOn   = true;

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 主体外壳（剖面视图）
        this._body = {
            x: W*0.04, y: H*0.12,
            w: W*0.58, h: H*0.72,
        };

        // 电动机（顶部）
        this._motor = {
            cx: W*0.04 + W*0.58*0.42,
            y:  H*0.04,
            w:  W*0.10, h: H*0.08,
        };

        // 旋转体中心（滤筒中央）
        this._rotorCX = this._body.x + this._body.w * 0.42;
        this._rotorCY = this._body.y + this._body.h * 0.52;
        this._rotorArmLen = this._body.w * 0.22;

        // 滤筒截面（正视图，右侧）
        this._sectionCX = W*0.80;
        this._sectionCY = H*0.50;
        this._sectionR  = Math.min(W, H) * 0.17;

        // 压差仪表区
        this._gaugeX    = W*0.67;
        this._gaugeDpY  = H*0.40;  // ΔP 上仪表
        this._gaugeDp1Y = H*0.55;  // ΔP₁ 下仪表


        this._init();

        // ── 注册端口 ──
        const bx = this._body.x, by = this._body.y;
        const bw = this._body.w, bh = this._body.h;
        // 流体端口
        this.addPort(bx + bw*0.50, by + bh + 6,       'port_inlet',    'pipe', '进口');
        this.addPort(bx + bw*0.85, by + bh*0.85,      'port_outlet',   'pipe', '出口');
        this.addPort(bx + bw*0.50, by + bh + 6,       'port_drain',    'pipe', '排污');
        this.addPort(W*0.67,       by + bh*0.10,       'port_air',      'pipe', 'P₀');
        // 电气端口
        const mx = this._motor.cx;
        this.addPort(mx - 8, by - 6,                  'port_motor_u',  'wire', 'U');
        this.addPort(mx,     by - 6,                  'port_motor_v',  'wire', 'V');
        this.addPort(mx + 8, by - 6,                  'port_motor_w',  'wire', 'W');
        this.addPort(W*0.67, by + bh*0.25,            'port_s1_com',   'wire', 'S₁C');
        this.addPort(W*0.67, by + bh*0.30,            'port_s1_no',    'wire', 'S₁NO');
        this.addPort(W*0.67, by + bh*0.18,            'port_sol_plus', 'wire', 'SV+');
        this.addPort(W*0.67, by + bh*0.22,            'port_sol_minus','wire', 'SV-');
        this.addPort(W*0.67, this._gaugeDpY,           'port_dp_high',  'wire', 'ΔP₂');
        this.addPort(W*0.67, this._gaugeDp1Y,          'port_dp_low',   'wire', 'ΔP₁');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();
        this._drawFilterCartridges();
        this._drawMotor();
        this._drawPipework();
        this._drawGauges();
        this._drawWiringPanel();
        this._drawSectionView();
        this._drawLabel();

        // 动态层
        this._dynFlow   = new Konva.Group(); // 流体流动
        this._dynRotor  = new Konva.Group(); // 旋转体
        this._dynStatus = new Konva.Group(); // 状态叠加
        this._staticGroup.add(this._dynFlow, this._dynRotor, this._dynStatus);

        this._rebuildFlow();
        this._rebuildRotor();
        this._rebuildStatus();
        this._drawStatusPanel();
        
    }

    // ── 主体外壳（剖面视图）──────────────────
    _drawBody() {
        const b = this._body;
        const W = this.width;

        // 外壳阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.x+3, y: b.y+3, width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.15)', cornerRadius: 6,
        }));

        // 外壳主体（剖面深灰）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:b.w, y:0 },
            fillLinearGradientColorStops: [0,'#4a5568',0.15,'#5a6a80',0.85,'#5a6a80',1,'#3a4558'],
            stroke: '#2d3748', strokeWidth: 2,
            cornerRadius: 6,
        }));

        // 内腔（过滤室）
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w*0.08, y: b.y + b.h*0.06,
            width: b.w*0.84, height: b.h*0.82,
            fill: '#e8f4f8', stroke: '#90a0b0', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 剖面线（壳体截面斜线，上下左右各段）
        const hatchColor = '#3a4558';
        const hatchW = b.w * 0.07;
        const hatchRegions = [
            // 左壁
            { x: b.x, y: b.y, w: hatchW, h: b.h },
            // 右壁
            { x: b.x + b.w - hatchW, y: b.y, w: hatchW, h: b.h },
            // 顶壁（中部留电机轴孔）
            { x: b.x, y: b.y, w: b.w*0.35, h: hatchW },
            { x: b.x + b.w*0.52, y: b.y, w: b.w*0.48, h: hatchW },
            // 底壁
            { x: b.x, y: b.y + b.h - hatchW, w: b.w, h: hatchW },
        ];
        hatchRegions.forEach(r => {
            this._staticGroup.add(new Konva.Rect({
                x: r.x, y: r.y, width: r.w, height: r.h,
                fill: hatchColor, opacity: 0.8,
            }));
            // 45°剖面斜线
            for (let i = -20; i < Math.max(r.w, r.h) + 20; i += 5) {
                this._staticGroup.add(new Konva.Line({
                    points: [r.x+i, r.y, r.x+i+r.h, r.y+r.h],
                    stroke: 'rgba(255,255,255,0.12)', strokeWidth: 0.8,
                    listening: false,
                }));
            }
        });
    }

    // ── 滤筒（4支竖向圆柱形滤网）────────────
    _drawFilterCartridges() {
        const b = this._body;
        const cx = this._rotorCX;
        const cy = this._rotorCY;
        const R  = this._rotorArmLen * 0.85;
        const n  = this.N_CARTRIDGES;
        const cH = b.h * 0.55;
        const cW = b.w * 0.08;

        this._cartridgeRects = [];
        for (let i = 0; i < n; i++) {
            const angle = (360 / n) * i - 90;
            const rad   = angle * Math.PI / 180;
            const cartCX = cx + R * Math.cos(rad);
            const cartCY = cy;

            // 滤筒外壳
            const rect = new Konva.Rect({
                x: cartCX - cW/2, y: cy - cH/2,
                width: cW, height: cH,
                fillLinearGradientStartPoint: { x:0, y:0 },
                fillLinearGradientEndPoint:   { x:cW, y:0 },
                fillLinearGradientColorStops: [0,'#c8d4dc',0.3,'#e8f0f4',0.7,'#d8e4ec',1,'#a8b8c4'],
                stroke: '#7a8a96', strokeWidth: 1,
                cornerRadius: cW/2,
            });
            this._staticGroup.add(rect);
            this._cartridgeRects.push({ rect, cx: cartCX, cy, i });

            // 滤网纹路（细横线）
            for (let j = 0; j < 12; j++) {
                const ly = cy - cH/2 + cH * (j+1) / 13;
                this._staticGroup.add(new Konva.Line({
                    points: [cartCX - cW*0.35, ly, cartCX + cW*0.35, ly],
                    stroke: 'rgba(100,130,150,0.55)', strokeWidth: 0.6,
                    listening: false,
                }));
            }

            // 编号标注
            this._staticGroup.add(new Konva.Text({
                x: cartCX - 5, y: cy - cH/2 - 12,
                text: `${i+1}`, fontSize: 8,
                fill: '#4a6070', fontStyle: 'bold',
            }));
        }
    }

    // ── 电动机（顶部）────────────────────────
    _drawMotor() {
        const m  = this._motor;
        const cx = m.cx;

        // 电机外壳（圆柱形）
        this._staticGroup.add(new Konva.Rect({
            x: cx - m.w/2, y: m.y,
            width: m.w, height: m.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:m.w, y:0 },
            fillLinearGradientColorStops: [0,'#5a5a6e',0.3,'#7a7a90',0.7,'#6a6a80',1,'#4a4a5e'],
            stroke: '#3a3a4e', strokeWidth: 1.5,
            cornerRadius: [4,4,0,0],
        }));
        // 电机顶帽
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: m.y + 2,
            radiusX: m.w/2, radiusY: m.h*0.15,
            fill: '#8a8aaa', stroke: '#4a4a6a', strokeWidth: 1,
        }));
        // 标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 8, y: m.y + m.h*0.35,
            text: 'M', fontSize: 10, fontStyle: 'bold',
            fill: '#dde0f0',
        }));
        // 轴
        const b = this._body;
        this._staticGroup.add(new Konva.Rect({
            x: cx - 3, y: m.y + m.h,
            width: 6, height: b.y - (m.y + m.h) + b.h*0.06,
            fill: '#8890a0', stroke: '#5a6070', strokeWidth: 0.8,
        }));
        // 编号 2
        this._staticGroup.add(new Konva.Text({
            x: cx + m.w/2 + 4, y: m.y + m.h*0.2,
            text: '2', fontSize: 9, fill: '#4a6070',
        }));
    }

    // ── 管道（进出口、排污、气源）────────────
    _drawPipework() {
        const b = this._body;
        const W = this.width;

        // ── 进口管（底部弯管进侧面）──
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w*0.25, y: b.y + b.h - b.h*0.07,
            width: b.w*0.30, height: b.h*0.07 + 30,
            fill: '#6a7a8a', stroke: '#4a5a6a', strokeWidth: 1.2,
        }));
        // 进口箭头标注
        this._staticGroup.add(new Konva.Text({
            x: b.x + b.w*0.12, y: b.y + b.h + 32,
            text: '8 进口', fontSize: 8, fill: '#4a6070', fontStyle: 'bold',
        }));

        // ── 出口管（侧面）──
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w, y: b.y + b.h*0.78,
            width: W*0.06, height: b.h*0.07,
            fill: '#6a7a8a', stroke: '#4a5a6a', strokeWidth: 1.2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x + b.w + W*0.06 + 3, y: b.y + b.h*0.80,
            text: '7 出口', fontSize: 8, fill: '#4a6070', fontStyle: 'bold',
        }));

        // ── 气源管（顶部进电磁阀）──
        this._staticGroup.add(new Konva.Line({
            points: [
                W*0.67, b.y + b.h*0.06,
                b.x + b.w*0.60, b.y + b.h*0.06,
                b.x + b.w*0.60, b.y + b.h*0.18,
            ],
            stroke: '#8a9aaa', strokeWidth: 2.5,
            lineCap: 'round', lineJoin: 'round',
        }));

        // 压差取压管
        [[this._gaugeDpY, '3', 'ΔP₂'], [this._gaugeDp1Y, '4', 'ΔP₁']].forEach(([y, num, label]) => {
            this._staticGroup.add(new Konva.Line({
                points: [b.x + b.w, y, W*0.67 - 18, y],
                stroke: '#7a8a9a', strokeWidth: 1.5, dash: [4,2],
            }));
            this._staticGroup.add(new Konva.Text({
                x: W*0.67 - 16, y: y - 5,
                text: `${num}`, fontSize: 8, fill: '#4a6070',
            }));
        });
    }

    // ── 压力/压差仪表 ──────────────────────
    _drawGauges() {
        // 仪表由 _rebuildStatus 动态更新，这里只画底框
        const W = this.width;
        const labels = [
            { y: this._gaugeDpY,  tag: 'ΔP₂', desc: '出口压力' },
            { y: this._gaugeDp1Y, tag: 'ΔP₁', desc: '进口压力' },
        ];
        labels.forEach(({ y, tag, desc }) => {
            this._staticGroup.add(new Konva.Rect({
                x: W*0.67 - 2, y: y - 14,
                width: 52, height: 28,
                fill: '#f0f4f8', stroke: '#8090a0', strokeWidth: 1,
                cornerRadius: 3,
            }));
            this._staticGroup.add(new Konva.Text({
                x: W*0.67, y: y - 12,
                text: tag, fontSize: 7.5, fontStyle: 'bold', fill: '#3a5060',
            }));
        });

        // ΔP 压差仪表（合并显示）
        const dy = (this._gaugeDpY + this._gaugeDp1Y) / 2 - 20;
        this._staticGroup.add(new Konva.Rect({
            x: W*0.67 - 2, y: dy,
            width: 52, height: 20,
            fill: '#e8f0f8', stroke: '#8090a0', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W*0.67, y: dy + 2,
            text: 'ΔP', fontSize: 7.5, fontStyle: 'bold', fill: '#2a4050',
        }));
    }

    // ── 电气接线面板（S₁、电磁阀端子）───────
    _drawWiringPanel() {
        const W = this.width, b = this._body;

        // S₁ 位置开关符号
        const sx = W*0.67, sy = b.y + b.h*0.05;
        this._staticGroup.add(new Konva.Rect({
            x: sx - 2, y: sy, width: 28, height: 30,
            fill: '#f8f8f0', stroke: '#8090a0', strokeWidth: 1, cornerRadius: 2,
        }));
        // 开关符号（常开触点）
        this._staticGroup.add(new Konva.Line({ points:[sx+2,sy+22, sx+12,sy+22], stroke:'#2a4050', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[sx+2,sy+22, sx+2,sy+10], stroke:'#2a4050', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[sx+12,sy+8, sx+12,sy+22], stroke:'#2a4050', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[sx+12,sy+22, sx+22,sy+22], stroke:'#2a4050', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Text({ x:sx+4, y:sy-10, text:'S₁', fontSize:9, fontStyle:'bold', fill:'#2a4050' }));

        // 电磁阀符号（矩形线圈）
        const vx = sx, vy = b.y + b.h*0.14;
        this._staticGroup.add(new Konva.Rect({ x:vx-2, y:vy, width:28, height:22, fill:'#f0f0f8', stroke:'#8090a0', strokeWidth:1, cornerRadius:2 }));
        this._staticGroup.add(new Konva.Text({ x:vx, y:vy+4, text:'SV', fontSize:8, fontStyle:'bold', fill:'#2a4050' }));
        this._staticGroup.add(new Konva.Text({ x:sx+4, y:vy-9, text:'P₀', fontSize:8, fill:'#2a4060' }));
    }

    // ── 截面正视图（右侧，四叶花瓣形）────────
    _drawSectionView() {
        const cx = this._sectionCX;
        const cy = this._sectionCY;
        const sr = this._sectionR;
        const n  = this.N_CARTRIDGES;

        // 外环
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: sr + 10,
            fill: '#4a5568', stroke: '#2d3748', strokeWidth: 2,
        }));
        // 内腔（洁净区）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: sr,
            fill: '#e8f4f8', stroke: '#8090a0', strokeWidth: 1,
        }));

        // 花瓣形截面（每个滤筒的截面）
        this._sectionPetals = [];
        for (let i = 0; i < n; i++) {
            const angle = (360 / n) * i - 90;
            const rad   = angle * Math.PI / 180;
            const px    = cx + sr * 0.58 * Math.cos(rad);
            const py    = cy + sr * 0.58 * Math.sin(rad);
            const pr    = sr * 0.35;

            const petal = new Konva.Circle({
                x: px, y: py, radius: pr,
                fill: '#c8d8e8', stroke: '#6a8090', strokeWidth: 1.2,
            });
            this._staticGroup.add(petal);
            this._sectionPetals.push(petal);

            // 内部滤网（双圆圈）
            this._staticGroup.add(new Konva.Circle({ x:px, y:py, radius:pr*0.65, fill:'transparent', stroke:'#8090a0', strokeWidth:0.7 }));
            this._staticGroup.add(new Konva.Circle({ x:px, y:py, radius:pr*0.35, fill:'#6a8090', stroke:'#4a6070', strokeWidth:0.5 }));

            // 截面编号
            this._staticGroup.add(new Konva.Text({
                x: px - 4, y: py - 4,
                text: `${i+1}`, fontSize: 8, fill: '#e8f4f8', fontStyle: 'bold',
            }));
        }

        // 中心轴孔
        this._staticGroup.add(new Konva.Circle({ x:cx, y:cy, radius:sr*0.12, fill:'#8090a0', stroke:'#5a6070', strokeWidth:1 }));
        this._staticGroup.add(new Konva.Circle({ x:cx, y:cy, radius:sr*0.06, fill:'#3a4858' }));

        // 清洗臂截面（旋转指示）
        this._sectionArrow = new Konva.Arrow({
            x: cx, y: cy,
            points: [0, 0, sr * 0.50, 0],
            pointerLength: 6, pointerWidth: 5,
            fill: '#e05030', stroke: '#e05030', strokeWidth: 2,
            rotation: this._rotorAngle - 90,
        });
        this._staticGroup.add(this._sectionArrow);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 22, y: cy - sr - 18,
            text: '截面图 6', fontSize: 8, fontStyle: 'bold', fill: '#3a5060',
        }));

        // 5号标注（旋转体）
        this._staticGroup.add(new Konva.Text({
            x: cx + sr + 6, y: cy - 5,
            text: '5', fontSize: 8, fill: '#3a5060',
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -20, width: this.width,
            text: `${this.label}  空气反冲式自清洗滤器  ${this.filterRating}μm  ${this.ratedFlow}m³/h  ${this.designPressure}MPa`,
            fontSize: 9, fontStyle: 'bold', fill: '#3a5060', align: 'center',
        }));

        // 结构编号标注
        const b = this._body;
        const annots = [
            { x: b.x - 16, y: b.y + b.h*0.12, text: '1' },
            { x: b.x + b.w*0.40, y: b.y + b.h*0.45, text: '9' },
            { x: b.x + b.w*0.10, y: b.y + b.h*0.65, text: '8' },
            { x: b.x + b.w*0.55, y: b.y + b.h*0.75, text: '7' },
        ];
        annots.forEach(({ x, y, text }) => {
            this._staticGroup.add(new Konva.Text({ x, y, text, fontSize: 9, fill: '#3a5060' }));
        });
    }

    // ── 状态面板（右上角）────────────────────
    _drawStatusPanel() {
        const W = this.width;
        this._stateBox = new Konva.Rect({
            x: W*0.67, y: 0, width: W*0.32, height: 38,
            fill: '#f0f4f8', stroke: '#8090a0', strokeWidth: 1, cornerRadius: 3,
        });
        this._stateText = new Konva.Text({
            x: W*0.68, y: 4,
            text: '过滤中', fontSize: 8, fontStyle: 'bold', fill: '#2a6040',
        });
        this._motorText = new Konva.Text({
            x: W*0.68, y: 14,
            text: 'M: 停止', fontSize: 7.5, fill: '#4a5060',
        });
        this._solText = new Konva.Text({
            x: W*0.68, y: 24,
            text: 'SV: 关', fontSize: 7.5, fill: '#4a5060',
        });
        this._staticGroup.add(this._stateBox, this._stateText, this._motorText, this._solText);

        // 交互按钮（手动清洗/暂停）
        const btnY = this._body.y + this._body.h*0.65;
        this._btnClean = new Konva.Rect({
            x: W*0.67, y: btnY, width: 44, height: 16,
            fill: '#4a90d0', cornerRadius: 3, listening: true,
        });
        this._btnCleanText = new Konva.Text({
            x: W*0.67+3, y: btnY+3,
            text: '手动清洗', fontSize: 7.5, fill: '#fff', listening: false,
        });
        this._btnPause = new Konva.Rect({
            x: W*0.67, y: btnY+20, width: 44, height: 16,
            fill: '#c06030', cornerRadius: 3, listening: true,
        });
        this._btnPauseText = new Konva.Text({
            x: W*0.67+5, y: btnY+23,
            text: '暂停/运行', fontSize: 7.5, fill: '#fff', listening: false,
        });
        this._staticGroup.add(this._btnClean, this._btnCleanText, this._btnPause, this._btnPauseText);
        this._btnClean.on('click tap', () => this.startCleaning());
        this._btnPause.on('click tap', () => this._togglePause());
    }

    // ─────────────────────────────────────────
    // ── 动态层：流体流动 ──────────────────────
    _rebuildFlow() {
        this._dynFlow.destroyChildren();
        const b = this._body;
        const ph = this._flowPhase;

        if (!this._inletFlowOn) return;

        const flowColor = this._state === 'FILTERING'
            ? 'rgba(40,120,220,0.55)'
            : 'rgba(40,180,100,0.45)';
        const flowW = 6;

        // 进口流（底部向上）
        for (let j = 0; j < 3; j++) {
            const progress = ((ph * 0.5 + j / 3) % 1);
            const fy = b.y + b.h * (0.92 - progress * 0.30);
            this._dynFlow.add(new Konva.Rect({
                x: b.x + b.w*0.38, y: fy,
                width: flowW, height: 10,
                fill: flowColor,
                cornerRadius: 3, opacity: 0.7 - progress*0.3,
            }));
        }

        // 出口流（向右）
        for (let j = 0; j < 3; j++) {
            const progress = ((ph * 0.6 + j / 3) % 1);
            const fx = b.x + b.w * (0.85 + progress * 0.10);
            this._dynFlow.add(new Konva.Rect({
                x: fx, y: b.y + b.h*0.79,
                width: 10, height: flowW,
                fill: 'rgba(20,180,80,0.55)',
                cornerRadius: 3, opacity: 0.7 - progress*0.25,
            }));
        }

        // 反冲气流（当电磁阀开时）
        if (this._solenoidOn && this._s1Active) {
            const cart = this._cartridgeRects.find(c => c.i === this._s1Cartridge);
            if (cart) {
                for (let j = 0; j < 3; j++) {
                    const progress = ((this._backwashFlowT * 2 + j / 3) % 1);
                    const fy = cart.cy + cart.rect.height()/2 * (1 - progress) - cart.rect.height()/4;
                    this._dynFlow.add(new Konva.Rect({
                        x: cart.cx - 3, y: fy,
                        width: 6, height: 8,
                        fill: `rgba(255,180,40,${0.8 - progress*0.5})`,
                        cornerRadius: 2,
                    }));
                }
            }
        }
    }

    // ── 动态层：旋转体 ────────────────────────
    _rebuildRotor() {
        this._dynRotor.destroyChildren();
        const cx = this._rotorCX, cy = this._rotorCY;
        const armLen = this._rotorArmLen;
        const angle  = this._rotorAngle;
        const rad    = (angle - 90) * Math.PI / 180;

        // 旋转臂
        const armGroup = new Konva.Group({ x: cx, y: cy, rotation: angle - 90 });

        // 主臂
        armGroup.add(new Konva.Rect({
            x: -4, y: 0, width: 8, height: armLen,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:8, y:0 },
            fillLinearGradientColorStops: [0,'#7a8890',0.5,'#b0bcc8',1,'#7a8890'],
            stroke: '#5a6878', strokeWidth: 0.8,
            cornerRadius: [3,3,0,0],
        }));

        // 喷嘴（臂端）
        const nozzleColor = this._solenoidOn && this._s1Active
            ? '#ff8020' : '#8090a0';
        armGroup.add(new Konva.Rect({
            x: -6, y: armLen - 10, width: 12, height: 12,
            fill: nozzleColor, stroke: '#5a6070', strokeWidth: 1,
            cornerRadius: 2,
            shadowColor: nozzleColor,
            shadowBlur: this._solenoidOn && this._s1Active ? 8 : 0,
            shadowOpacity: 0.8,
        }));

        this._dynRotor.add(armGroup);

        // 中心轴
        this._dynRotor.add(new Konva.Circle({
            x: cx, y: cy, radius: 8,
            fillLinearGradientStartPoint: { x:-8, y:-8 },
            fillLinearGradientEndPoint:   { x:8, y:8 },
            fillLinearGradientColorStops: [0,'#9090a8',0.5,'#c0c0d8',1,'#6a6a80'],
            stroke: '#4a4a60', strokeWidth: 1.2,
        }));
        this._dynRotor.add(new Konva.Circle({ x:cx, y:cy, radius:3, fill:'#3a3a50' }));

        // 截面视图的旋转臂更新
        if (this._sectionArrow) {
            this._sectionArrow.rotation(angle - 90);
        }
    }

    // ── 动态层：状态叠加（仪表数值、S₁指示、SV指示） ──
    _rebuildStatus() {
        this._dynStatus.destroyChildren();
        const W = this.width, b = this._body;

        // ── 压力/压差数值显示 ──
        const dP   = this._deltaPressure;
        const pIn  = this._pressureIn;
        const pOut = Math.max(0.01, pIn - dP);

        const gaugeData = [
            { y: this._gaugeDpY,  val: pOut, label: 'P出' },
            { y: this._gaugeDp1Y, val: pIn,  label: 'P进' },
        ];
        gaugeData.forEach(({ y, val, label }) => {
            const color = val < 0.05 ? '#c02020'
                : val > this.designPressure * 0.9 ? '#e06020'
                : '#204060';
            this._dynStatus.add(new Konva.Text({
                x: W*0.67 + 22, y: y - 6,
                text: `${val.toFixed(3)}`, fontSize: 8, fontStyle: 'bold',
                fill: color,
            }));
        });

        // 压差 ΔP 数值
        const dpColor = dP >= this.dPdirty ? '#cc2020'
            : dP >= this.dPdirty * 0.7 ? '#e06010'
            : '#206040';
        const dpDisplayY = (this._gaugeDpY + this._gaugeDp1Y) / 2 - 16;
        this._dynStatus.add(new Konva.Text({
            x: W*0.67 + 22, y: dpDisplayY + 2,
            text: `${dP.toFixed(3)}`, fontSize: 8, fontStyle: 'bold',
            fill: dpColor,
        }));

        // 压差警告指示条
        if (dP >= this.dPdirty * 0.8) {
            this._dynStatus.add(new Konva.Rect({
                x: W*0.67 - 2, y: dpDisplayY - 2,
                width: 52, height: 20,
                fill: dP >= this.dPdirty ? 'rgba(220,40,40,0.15)' : 'rgba(220,150,20,0.12)',
                cornerRadius: 2,
            }));
        }

        // ── S₁ 位置开关状态指示 ──
        const s1Color = this._s1Active ? '#20cc40' : '#808090';
        const s1Y = b.y + b.h*0.05;
        this._dynStatus.add(new Konva.Circle({
            x: W*0.67 + 32, y: s1Y + 8,
            radius: 4,
            fill: s1Color,
            shadowColor: s1Color,
            shadowBlur: this._s1Active ? 7 : 0,
            shadowOpacity: 0.9,
        }));
        if (this._s1Active) {
            this._dynStatus.add(new Konva.Text({
                x: W*0.67 + 38, y: s1Y + 3,
                text: `#${this._s1Cartridge + 1}`,
                fontSize: 8, fontStyle: 'bold', fill: '#20a040',
            }));
        }

        // ── 电磁阀状态指示 ──
        const svY = b.y + b.h*0.14;
        const svColor = this._solenoidOn ? '#ff8020' : '#808090';
        this._dynStatus.add(new Konva.Circle({
            x: W*0.67 + 30, y: svY + 8,
            radius: 4, fill: svColor,
            shadowColor: svColor,
            shadowBlur: this._solenoidOn ? 8 : 0,
            shadowOpacity: 0.9,
        }));

        // ── 滤筒清洁度着色（截面图）──
        const dirtyRatio = (this._deltaPressure - this.dPclean) / (this.dPdirty - this.dPclean);
        if (this._sectionPetals) {
            this._sectionPetals.forEach((petal, i) => {
                // 正在被清洗的滤筒标绿
                if (this._s1Active && this._s1Cartridge === i) {
                    petal.fill('#60e080');
                } else {
                    const dr = Math.max(0, Math.min(1, dirtyRatio));
                    const r  = Math.round(200 + dr * 55);
                    const g  = Math.round(220 - dr * 100);
                    const bv = Math.round(232 - dr * 80);
                    petal.fill(`rgb(${r},${g},${bv})`);
                }
            });
        }

        // ── 清洗位置指示（主视图编号9）──
        if (this._motorRunning) {
            this._dynStatus.add(new Konva.Text({
                x: this._rotorCX + 12,
                y: this._rotorCY - 8,
                text: this._s1Active ? `9↓${this._s1Cartridge+1}` : '9',
                fontSize: 8, fontStyle: 'bold',
                fill: this._s1Active ? '#e06020' : '#6a7a8a',
            }));
        }

        // ── 状态面板文字更新 ──
        const stateMap = {
            FILTERING: { text: '正常过滤', color: '#1a7040' },
            CLEANING:  { text: '清洗中…', color: '#c06010' },
            PAUSED:    { text: '已暂停',  color: '#8030a0' },
        };
        const { text: stText, color: stColor } = stateMap[this._state] || stateMap.FILTERING;
        if (this._stateText) { this._stateText.text(stText); this._stateText.fill(stColor); }
        if (this._motorText) {
            this._motorText.text(`M: ${this._motorRunning ? '运行 ↻' : '停止'}`);
            this._motorText.fill(this._motorRunning ? '#1060d0' : '#606070');
        }
        if (this._solText) {
            this._solText.text(`SV: ${this._solenoidOn ? '通电 ●' : '断电'}`);
            this._solText.fill(this._solenoidOn ? '#d06010' : '#606070');
        }
    }

    // ── 主循环 ────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt);
    
        this._refreshCache();
    }
    _tick(dt) {
        this._flowPhase = (this._flowPhase + dt * 1.2) % 1;

        if (this._state === 'PAUSED') {
            this._rebuildFlow();
            this._rebuildRotor();
            this._rebuildStatus();
            this._refreshCache();
            return;
        }

        // ── 过滤状态：压差缓慢上升 ──
        if (this._state === 'FILTERING') {
            this._deltaPressure = Math.min(
                this.dPmax,
                this._deltaPressure + this._dirtyRate * dt
            );
            // 达到清洗阈值自动启动
            if (this._deltaPressure >= this.dPdirty) {
                this.startCleaning();
            }
        }

        // ── 清洗状态：旋转体旋转 & 位置开关逻辑 ──
        if (this._state === 'CLEANING' && this._motorRunning) {
            this._rotorAngle = (this._rotorAngle + this._motorSpeed * dt) % 360;

            // 计算当前旋转体对准哪个滤筒
            const n          = this.N_CARTRIDGES;
            const slotAngle  = 360 / n;
            // 滤筒角度偏移（从正上 -90° 起）
            const normalizedAngle = ((this._rotorAngle + 90) % 360 + 360) % 360;
            const cartridgeIdx    = Math.floor(normalizedAngle / slotAngle) % n;
            const angleInSlot     = normalizedAngle - cartridgeIdx * slotAngle;
            // 位置开关窗口：每节滤筒前后各 15%
            const windowFrac = 0.30;
            const inWindow   = angleInSlot < slotAngle * windowFrac || angleInSlot > slotAngle * (1 - windowFrac / 2);

            // 位置开关变化
            if (inWindow !== this._s1Active) {
                if (inWindow) {
                    // 新对准一节滤筒
                    this._s1Active    = true;
                    this._s1Cartridge = cartridgeIdx;
                    this._solenoidOn  = true;
                    this._backwashFlowT = 0;
                } else {
                    // 离开
                    this._s1Active   = false;
                    this._solenoidOn = false;
                    // 清洗完成一节：压差降低
                    this._deltaPressure = Math.max(
                        this.dPclean,
                        this._deltaPressure - this.dPstep
                    );
                    this._cleanedCount++;

                    // 完成一圈
                    if (this._cleanedCount >= n) {
                        this._finishCleaning();
                    }
                }
            }

            if (this._solenoidOn) {
                this._backwashFlowT += dt;
            }
        }

        this._rebuildFlow();
        this._rebuildRotor();
        this._rebuildStatus();
        this._refreshCache();
    }

    // ── 清洗完成 ─────────────────────────────
    _finishCleaning() {
        this._motorRunning  = false;
        this._solenoidOn    = false;
        this._s1Active      = false;
        this._cleanedCount  = 0;
        this._totalCycles++;
        this.opsCount++;
        this._state         = 'FILTERING';
        this._emitEvent?.('cleaningDone', { cycles: this._totalCycles, deltaP: this._deltaPressure });
    }

    _togglePause() {
        if (this._state === 'PAUSED') {
            this._state = this._motorRunning ? 'CLEANING' : 'FILTERING';
        } else {
            this._state = 'PAUSED';
        }
    }

    // ═══════════════════════════════════════════
    /** 启动清洗 */
    startCleaning() {
        if (this._state === 'CLEANING') return;
        this._state        = 'CLEANING';
        this._motorRunning = true;
        this._cleanedCount = 0;
        this._emitEvent?.('cleaningStart', { deltaP: this._deltaPressure });
    }

    /** 停止电动机（紧急停止） */
    stopMotor() {
        this._motorRunning = false;
        this._solenoidOn   = false;
        this._s1Active     = false;
        if (this._state === 'CLEANING') this._state = 'PAUSED';
    }

    /** 手动设置压差（仿真注入，MPa） */
    setDeltaPressure(dP) {
        this._deltaPressure = Math.max(this.dPclean, Math.min(this.dPmax, dP));
        this._refreshCache();
    }

    /** 手动设置进口压力（MPa） */
    setInletPressure(p) {
        this._pressureIn = Math.max(0.05, Math.min(this.designPressure, p));
        this._refreshCache();
    }

    // ── 状态查询 ──────────────────────────────
    getState()           { return this._state; }
    isMotorRunning()     { return this._motorRunning; }
    isSolenoidOn()       { return this._solenoidOn; }
    isS1Active()         { return this._s1Active; }
    getS1Cartridge()     { return this._s1Cartridge; }
    getRotorAngle()      { return this._rotorAngle; }
    getPressureIn()      { return this._pressureIn; }
    getPressureOut()     { return Math.max(0.01, this._pressureIn - this._deltaPressure); }
    getDeltaPressure()   { return this._deltaPressure; }
    getTotalCycles()     { return this._totalCycles; }
    getOpsCount()        { return this.opsCount; }

    update(state) {
        if (state && typeof state === 'object') {
            if (state.cleaning === true)  this.startCleaning();
            if (state.cleaning === false) this.stopMotor();
            if (state.deltaP  !== undefined) this.setDeltaPressure(state.deltaP);
            if (state.pressureIn !== undefined) this.setInletPressure(state.pressureIn);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',              type: 'text'   },
            { label: '过滤精度 (μm)',      key: 'filterRating',       type: 'number' },
            { label: '额定流量 (m³/h)',    key: 'ratedFlow',          type: 'number' },
            { label: '设计压力 (MPa)',     key: 'designPressure',     type: 'number' },
            { label: '滤筒数量',          key: 'nCartridges',        type: 'number' },
            { label: '进口额定压力(MPa)', key: 'pressureInNominal',  type: 'number' },
            { label: '洁净压差 (MPa)',    key: 'dPclean',            type: 'number' },
            { label: '清洗启动压差(MPa)', key: 'dPdirty',            type: 'number' },
            { label: '最大压差 (MPa)',    key: 'dPmax',              type: 'number' },
            { label: '积污速率 (MPa/s)',  key: 'dirtyRate',          type: 'number' },
            { label: '电机转速 (°/s)',    key: 'motorSpeed',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)             this.label             = cfg.label;
        if (cfg.filterRating)      this.filterRating      = parseFloat(cfg.filterRating)      || this.filterRating;
        if (cfg.ratedFlow)         this.ratedFlow         = parseFloat(cfg.ratedFlow)         || this.ratedFlow;
        if (cfg.designPressure)    this.designPressure    = parseFloat(cfg.designPressure)    || this.designPressure;
        if (cfg.pressureInNominal) this._pressureIn       = parseFloat(cfg.pressureInNominal) || this._pressureIn;
        if (cfg.dPclean)           this.dPclean           = parseFloat(cfg.dPclean)           || this.dPclean;
        if (cfg.dPdirty)           this.dPdirty           = parseFloat(cfg.dPdirty)           || this.dPdirty;
        if (cfg.dPmax)             this.dPmax             = parseFloat(cfg.dPmax)             || this.dPmax;
        if (cfg.dirtyRate)         this._dirtyRate        = parseFloat(cfg.dirtyRate)         || this._dirtyRate;
        if (cfg.motorSpeed)        this._motorSpeed       = parseFloat(cfg.motorSpeed)        || this._motorSpeed;
        this.dPstep = (this.dPdirty - this.dPclean) / this.N_CARTRIDGES;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}