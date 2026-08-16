import { BaseComponent } from './BaseComponent.js';

/**
 * 空调室外机仿真组件
 * （Outdoor Air Conditioning Unit / Condensing Unit）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件仿真壁挂式分体空调室外机，涵盖以下子系统：
 *
 *  【外壳结构】
 *  1. 机壳（Cabinet）：钣金外壳，前网格面板，顶部出风
 *  2. 进风格栅（Air Inlet Grille）：侧面/背面进风
 *  3. 出风口（Top Discharge）：顶部轴流风扇出风
 *  4. 底盘（Base Pan）：接水盘，制热化霜水排出
 *
 *  【制冷系统 — 室外侧核心部件】
 *  5.  压缩机（Compressor）：涡旋式，将低压气态制冷剂压缩为高温高压气体
 *      - 排气口（Discharge）：高温高压气体出口
 *      - 吸气口（Suction）：低压气体进口
 *      - 曲轴箱加热器（Crankcase Heater）：低温防液击保护
 *  6.  四通换向阀（4-Way Reversing Valve）：制冷/制热模式切换
 *      - D 口：压缩机排气（高压气体进入）
 *      - S 口：压缩机吸气（低压气体返回）
 *      - E 口：连接室内机蒸发器（气管）
 *      - C 口：连接冷凝器（室外盘管）
 *  7.  冷凝器（Condenser）：铝翅片铜管盘管，高压气体在此冷凝散热
 *  8.  储液器（Accumulator / Liquid Receiver）：
 *      - 高压储液器（Receiver）：节流前缓冲液态制冷剂
 *      - 气液分离器（Accumulator）：保护压缩机，防止液击
 *  9.  单向阀（Check Valve）：制热模式管路切换
 * 10.  干燥过滤器（Filter Dryer）：去除制冷剂中水分和杂质
 *
 *  【辅助系统】
 * 11. 轴流风扇（Axial Fan）：室外侧冷凝散热风机
 * 12. 风机电机（Fan Motor）：驱动轴流风扇
 * 13. 室外温度传感器（Outdoor Temp Sensor，Tso）
 * 14. 冷凝器管温传感器（Condenser Coil Sensor，Tco）
 * 15. 排气温度传感器（Discharge Temp Sensor，Td）
 * 16. 吸气温度传感器（Suction Temp Sensor，Ts）
 * 17. 高压保护开关（High Pressure Switch，HPS）
 * 18. 低压保护开关（Low Pressure Switch，LPS）
 * 19. 变频驱动板（Inverter/IPM Board）
 * 20. 主控板（Main PCB）
 *
 *  【管路连接端口（与室内机对接）】
 *  liquid_port  — 液管接口（细管，φ6.35mm）→ 室内机液管
 *  gas_port     — 气管接口（粗管，φ12.7mm）↔ 室内机气管
 *  power_port   — 电源/通信线接口
 *
 * ── 制冷循环（制冷模式）─────────────────────────────────────
 *
 *  压缩机排气 → 四通阀(D→C) → 冷凝器（冷凝放热）→ 干燥过滤器
 *  → 高压储液器 → 液管接口 → [室内机蒸发器] → 气管接口
 *  → 四通阀(E→S) → 气液分离器 → 压缩机吸气
 *
 * ── 制热循环（热泵模式）─────────────────────────────────────
 *
 *  压缩机排气 → 四通阀(D→E) → [室内机冷凝器] → 气管接口
 *  → 液管接口 → 冷凝器（蒸发吸热）→ 四通阀(C→S)
 *  → 气液分离器 → 压缩机吸气
 *
 * ── 动态仿真 ──────────────────────────────────────────────────
 *
 *  · 轴流风扇叶片旋转（顶视图叶片）
 *  · 制冷剂粒子沿管路路径流动，相态着色
 *  · 压缩机活塞振动动画（视觉律动）
 *  · 四通阀线圈通断指示
 *  · 传感器数值实时更新（Tso/Tco/Td/Ts）
 *  · 高低压压力值动态显示
 *  · 运行/停止/故障三色状态灯
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  liquid_port  — 液管接口（左侧下，细）
 *  gas_port     — 气管接口（左侧上，粗）
 *  power_port   — 电源/通信接口（左侧中）
 */
export class OutdoorACUnit extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 480);
        this.height = Math.max(260, config.height || 360);

        this.type    = 'outdoor_ac_unit';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.label        = config.label        || 'ODU-1';
        this.capacity     = config.capacity     || 3500;   // W 制冷量
        this.ratedPower   = config.ratedPower   || 1200;   // W
        this.refrigerant  = config.refrigerant  || 'R410A';
        this.compType     = config.compType     || 'inverter'; // inverter / fixed

        // ── 运行状态 ──
        this._running       = config.initRunning !== false ? false : true;
        this._mode          = config.mode         || 'cool';  // cool / heat
        this._fanSpeed      = config.fanSpeed     || 'auto';
        this._compFreq      = config.compFreq     || 60;      // Hz 压缩机频率
        this._outdoorTemp   = config.outdoorTemp  || 35;      // °C
        this._condCoilTemp  = config.condCoilTemp || 50;      // °C 冷凝器管温
        this._dischargeTemp = config.dischargeTemp|| 85;      // °C 排气温度
        this._suctionTemp   = config.suctionTemp  || 15;      // °C 吸气温度
        this._highPressure  = config.highPressure || 2.8;     // MPa 高压
        this._lowPressure   = config.lowPressure  || 0.8;     // MPa 低压

        // ── 动画状态 ──
        this._fanAngle    = 0;
        this._flowPhase   = 0;
        this._compPhase   = 0;   // 压缩机律动相位
        this._valveOn     = this._mode === 'heat'; // 四通阀线圈（制热=通电）

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 机壳
        this._cabinet = { x: W*0.02, y: H*0.04, w: W*0.96, h: H*0.90, rx: 8 };

        // 冷凝器区域（右侧大区域，L 形盘管）
        this._cond = {
            x: W*0.48, y: H*0.10,
            w: W*0.46, h: H*0.72,
        };

        // 压缩机区域（左下）
        this._comp = {
            cx: W*0.18, cy: H*0.72,
            rx: W*0.095, ry: H*0.130,
        };

        // 四通阀位置（中下区域）
        this._valve4 = {
            cx: W*0.36, cy: H*0.68,
            r: Math.min(W, H) * 0.045,
        };

        // 气液分离器（压缩机左侧）
        this._accum = {
            cx: W*0.08, cy: H*0.60,
            rx: W*0.040, ry: H*0.095,
        };

        // 高压储液器（冷凝器下方右侧）
        this._receiver = {
            cx: W*0.74, cy: H*0.86,
            rx: W*0.025, ry: H*0.060,
        };

        // 干燥过滤器（储液器左侧）
        this._dryer = {
            cx: W*0.60, cy: H*0.86,
            r: Math.min(W, H) * 0.025,
        };

        // 轴流风扇（顶部，俯视圆形）
        this._axialFan = {
            cx: W*0.27, cy: H*0.28,
            r: Math.min(W, H) * 0.155,
        };

        // 液管接口（左侧下）
        this._liquidPortX = W * 0.02;
        this._liquidPortY = H * 0.78;
        // 气管接口（左侧上）
        this._gasPortX    = W * 0.02;
        this._gasPortY    = H * 0.52;

        // 动画状态由 consys._tickAll 统一驱动

        this._init();

        // ── 端口注册 ──
        this.addPort(this._liquidPortX - 4, this._liquidPortY, 'liquid_port', 'pipe', 'LIQ');
        this.addPort(this._gasPortX - 4,    this._gasPortY,    'gas_port',    'pipe', 'GAS');
        this.addPort(W * 0.02, H * 0.65,   'power_port',       'wire',        'PWR');
    }

    // ══════════════════════════════════════════════
    _init() {
        this._drawCabinet();
        this._drawTopFanHousing();
        this._drawCondenser();
        this._drawAxialFan();           // 动态层
        this._drawCompressor();
        this._drawFourWayValve();
        this._drawAccumulator();
        this._drawReceiver();
        this._drawDryer();
        this._drawAllPipes();
        this._drawCheckValves();
        this._drawPressureSwitches();
        this._drawSensors();
        this._drawInverterBoard();
        this._drawMainPCB();
        this._drawPipeConnectors();
        this._drawLabel();
        this._drawStatusIndicator();
        this._buildDynamicLayers();
        this._bindInteraction();
    }

    // ── 机壳 ───────────────────────────────────────
    _drawCabinet() {
        const c = this._cabinet;
        const W = this.width, H = this.height;

        // 外壳主体
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: c.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#d4d8de',
                0.15,'#e0e4e9',
                0.85,'#c8ccd2',
                1,   '#b8bcC2',
            ],
            stroke: '#9fa5ad', strokeWidth: 1.5,
            cornerRadius: c.rx,
            shadowColor: '#000', shadowBlur: 12,
            shadowOffsetY: 5, shadowOpacity: 0.20,
        }));

        // 顶面
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 2, y: c.y + 2, width: c.w - 4, height: c.h * 0.08,
            fill: 'rgba(255,255,255,0.30)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));
        // 底边阴影
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y + c.h * 0.92, width: c.w, height: c.h * 0.08,
            fill: 'rgba(0,0,0,0.10)',
            cornerRadius: [0, 0, c.rx, c.rx],
        }));

        // 底盘
        this._staticGroup.add(new Konva.Rect({
            x: c.x - 6, y: c.y + c.h - 6,
            width: c.w + 12, height: H * 0.04,
            fill: '#8a9098', stroke: '#707880', strokeWidth: 1,
            cornerRadius: [0, 0, 4, 4],
        }));

        // 右侧冷凝器格栅区背景（深色，区分风道）
        this._staticGroup.add(new Konva.Rect({
            x: this._cond.x - 4, y: c.y + 2,
            width: this._cond.w + 4, height: c.h - 4,
            fill: '#1e2328',
            cornerRadius: [0, c.rx, c.rx, 0],
        }));

        // 冷凝器格栅竖条（模拟散热翅片护网）
        const grillX0 = this._cond.x;
        const grillW  = this._cond.w;
        const grillY0 = c.y + 4, grillH = c.h - 8;
        const barCount = 22;
        for (let i = 0; i <= barCount; i++) {
            const gx = grillX0 + (i / barCount) * grillW;
            this._staticGroup.add(new Konva.Line({
                points: [gx, grillY0, gx, grillY0 + grillH],
                stroke: '#2e353d', strokeWidth: 2,
                opacity: 0.7,
            }));
        }
    }

    // ── 顶部风扇出风口壳体 ─────────────────────────
    _drawTopFanHousing() {
        const f  = this._axialFan;
        const W  = this.width, H = this.height;
        const c  = this._cabinet;

        // 风扇护罩圆形框（从顶部俯视，在正视图中简化为椭圆）
        this._staticGroup.add(new Konva.Ellipse({
            x: f.cx, y: f.cy,
            radiusX: f.r + 10, radiusY: f.r * 0.35 + 6,
            fill: '#2a2e34', stroke: '#404850', strokeWidth: 2,
        }));
        // 护罩网格（同心圆）
        [0.35, 0.65, 0.90].forEach(s => {
            this._staticGroup.add(new Konva.Ellipse({
                x: f.cx, y: f.cy,
                radiusX: (f.r + 8) * s, radiusY: ((f.r * 0.35 + 4)) * s,
                fill: 'transparent', stroke: '#3a4248', strokeWidth: 1,
            }));
        });
        // 护罩辐条
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI;
            const ex = f.cx + (f.r + 8) * Math.cos(angle);
            const ey = f.cy + (f.r * 0.35 + 4) * Math.sin(angle);
            this._staticGroup.add(new Konva.Line({
                points: [f.cx, f.cy, ex, ey],
                stroke: '#3a4248', strokeWidth: 1,
            }));
            const ex2 = f.cx + (f.r + 8) * Math.cos(angle + Math.PI);
            const ey2 = f.cy + (f.r * 0.35 + 4) * Math.sin(angle + Math.PI);
            this._staticGroup.add(new Konva.Line({
                points: [f.cx, f.cy, ex2, ey2],
                stroke: '#3a4248', strokeWidth: 1,
            }));
        }

        // 出风箭头
        this._staticGroup.add(new Konva.Text({
            x: f.cx - 16, y: f.cy - f.r * 0.35 - 16,
            text: '↑ 出风', fontSize: 8, fill: '#78909c', fontStyle: 'bold',
        }));
    }

    // ── 冷凝器（铝翅片铜管，右侧大盘管）─────────────
    _drawCondenser() {
        const e  = this._cond;
        const W  = this.width;

        // 冷凝器翅片（密集横线，略倾斜）
        const finCount = Math.floor(e.h / 4);
        for (let i = 0; i < finCount; i++) {
            const fy   = e.y + (i / finCount) * e.h;
            const alpha = 0.20 + (i % 3 === 0 ? 0.10 : 0);
            this._staticGroup.add(new Konva.Line({
                points: [e.x, fy, e.x + e.w, fy],
                stroke: `rgba(130,180,210,${alpha})`, strokeWidth: 1,
            }));
        }

        // 铜管蛇形盘管（纵向排列，竖向蛇形，模拟 L 形布置）
        const tubeRows  = 5;
        const tubeColor = '#b87333';
        const tubeHL    = 'rgba(220,170,100,0.55)';
        const rowW      = e.w / (tubeRows + 0.5);

        for (let r = 0; r < tubeRows; r++) {
            const tx    = e.x + rowW * (r + 0.5);
            const goDown = (r % 2 === 0);

            // 主竖管
            this._staticGroup.add(new Konva.Line({
                points: [tx, e.y + 6, tx, e.y + e.h - 6],
                stroke: tubeColor, strokeWidth: 4.5, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [tx - 0.8, e.y + 8, tx - 0.8, e.y + e.h - 8],
                stroke: tubeHL, strokeWidth: 1.5, lineCap: 'round',
            }));

            // U 形弯（顶部或底部）
            if (r < tubeRows - 1) {
                const bendY = goDown ? (e.y + e.h - 6) : e.y + 6;
                const rad   = rowW * 0.42;
                this._staticGroup.add(new Konva.Arc({
                    x: tx + rad, y: bendY,
                    innerRadius: 0, outerRadius: rad + 2,
                    angle: 180, rotation: goDown ? 0 : 180,
                    fill: tubeColor, stroke: '#9a5a20', strokeWidth: 0.5,
                }));
            }
        }

        // 冷凝器标注
        this._staticGroup.add(new Konva.Text({
            x: e.x + e.w * 0.22, y: e.y + e.h * 0.44,
            text: '冷凝器\nCondenser',
            fontSize: 9, fill: 'rgba(200,130,80,0.80)',
            fontStyle: 'bold', lineHeight: 1.4,
        }));
    }

    // ── 轴流风扇（动态，正视图叶片轮廓）────────────
    _drawAxialFan() {
        const f = this._axialFan;

        // 风扇叶片组（动态层）
        this._fanGroup = new Konva.Group({ x: f.cx, y: f.cy });

        const bladeCount = 5;
        for (let i = 0; i < bladeCount; i++) {
            const angle = (i / bladeCount) * 360;
            // 叶片：宽扁矩形，有弧度
            const blade = new Konva.Line({
                points: [
                     0,  -3,
                     f.r * 0.90, -f.r * 0.22,
                     f.r * 0.90,  f.r * 0.08,
                     0,   3,
                ],
                closed: true,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: f.r, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#607d8b', 0.5, '#8fa8b8', 1, '#4a6070',
                ],
                stroke: '#37474f', strokeWidth: 0.8,
                rotation: angle,
            });
            this._fanGroup.add(blade);
        }
        // 中心毂
        this._fanGroup.add(new Konva.Circle({
            radius: f.r * 0.14,
            fill: '#455a64', stroke: '#263238', strokeWidth: 1.5,
        }));
        this._fanGroup.add(new Konva.Circle({
            radius: f.r * 0.07,
            fill: '#37474f',
        }));
        this._staticGroup.add(this._fanGroup);
    }

    // ── 压缩机（涡旋式，圆筒体）────────────────────
    _drawCompressor() {
        const c  = this._comp;
        const W  = this.width;

        // 外筒（渐变钢色）
        this._compGroup = new Konva.Group();

        this._compGroup.add(new Konva.Ellipse({
            x: c.cx, y: c.cy,
            radiusX: c.rx, radiusY: c.ry,
            fillLinearGradientStartPoint: { x: -c.rx, y: 0 },
            fillLinearGradientEndPoint:   { x:  c.rx, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#3a3a3a',
                0.3, '#606060',
                0.6, '#787878',
                0.8, '#585858',
                1,   '#383838',
            ],
            stroke: '#282828', strokeWidth: 1.5,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.35,
        }));

        // 顶部圆盖
        this._compGroup.add(new Konva.Ellipse({
            x: c.cx, y: c.cy - c.ry + c.ry * 0.12,
            radiusX: c.rx * 0.85, radiusY: c.ry * 0.18,
            fill: '#505050', stroke: '#383838', strokeWidth: 1,
        }));

        // 铭牌
        this._compGroup.add(new Konva.Rect({
            x: c.cx - c.rx * 0.55, y: c.cy - c.ry * 0.20,
            width: c.rx * 1.10, height: c.ry * 0.38,
            fill: '#f5f5f5', stroke: '#ccc', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        this._compGroup.add(new Konva.Text({
            x: c.cx - c.rx * 0.52, y: c.cy - c.ry * 0.14,
            text: `COMP\n${this._compFreq}Hz`,
            fontSize: 6.5, fill: '#333', fontStyle: 'bold',
            lineHeight: 1.3, align: 'center',
            width: c.rx * 1.05,
        }));

        // 曲轴箱加热器（底部橙色带）
        this._compGroup.add(new Konva.Ellipse({
            x: c.cx, y: c.cy + c.ry * 0.75,
            radiusX: c.rx * 0.70, radiusY: c.ry * 0.08,
            fill: '#bf360c', stroke: '#8d2c0a', strokeWidth: 0.8,
        }));
        this._compGroup.add(new Konva.Text({
            x: c.cx - c.rx * 0.55, y: c.cy + c.ry * 0.78,
            text: 'CHT', fontSize: 5.5, fill: '#ff8a65',
        }));

        // 排气管嘴（顶部左偏）
        this._compGroup.add(new Konva.Rect({
            x: c.cx - c.rx * 0.38, y: c.cy - c.ry - 10,
            width: 8, height: 12,
            fill: '#b87333', stroke: '#8a5520', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 吸气管嘴（顶部右偏）
        this._compGroup.add(new Konva.Rect({
            x: c.cx + c.rx * 0.20, y: c.cy - c.ry - 8,
            width: 10, height: 10,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        this._staticGroup.add(this._compGroup);

        // 压缩机标注
        this._staticGroup.add(new Konva.Text({
            x: c.cx - 22, y: c.cy + c.ry + 6,
            text: '涡旋压缩机', fontSize: 7.5, fill: '#90a4ae', fontStyle: 'bold',
        }));
    }

    // ── 四通换向阀 ──────────────────────────────────
    _drawFourWayValve() {
        const v  = this._valve4;
        const r  = v.r;
        const W  = this.width;

        // 阀体（圆形）
        this._staticGroup.add(new Konva.Circle({
            x: v.cx, y: v.cy, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r,  y:  r },
            fillLinearGradientColorStops: [0,'#4a4a52',0.5,'#6e6e78',1,'#3a3a42'],
            stroke: '#282830', strokeWidth: 1.5,
        }));

        // 阀体中心滑柱符号
        this._staticGroup.add(new Konva.Rect({
            x: v.cx - r * 0.55, y: v.cy - r * 0.18,
            width: r * 1.10, height: r * 0.36,
            fill: '#c0392b', stroke: '#922b21', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 四通阀电磁线圈（顶部）
        this._valveCoil = new Konva.Rect({
            x: v.cx - r * 0.40, y: v.cy - r - 14,
            width: r * 0.80, height: 14,
            fill: this._valveOn ? '#1565c0' : '#37474f',
            stroke: this._valveOn ? '#0d47a1' : '#263238',
            strokeWidth: 0.8, cornerRadius: 2,
        });
        this._staticGroup.add(this._valveCoil);

        // 线圈接线
        this._staticGroup.add(new Konva.Line({
            points: [v.cx - 6, v.cy - r - 14, v.cx - 6, v.cy - r - 20,
                     v.cx + 6, v.cy - r - 20, v.cx + 6, v.cy - r - 14],
            stroke: '#78909c', strokeWidth: 0.8, lineJoin: 'round',
        }));

        // 四个接口标注（D/S/E/C）
        const ports4 = [
            { label: 'D', dx:  0,    dy: -r - 4, color: '#ef5350' },  // 排气（上）
            { label: 'S', dx:  0,    dy:  r + 4, color: '#80d8ff' },  // 吸气（下）
            { label: 'E', dx: -r - 4, dy: 0,    color: '#80d8ff' },  // 室内气管（左）
            { label: 'C', dx:  r + 4, dy: 0,    color: '#ef5350' },  // 冷凝器（右）
        ];
        ports4.forEach(({ label, dx, dy, color }) => {
            this._staticGroup.add(new Konva.Circle({
                x: v.cx + dx, y: v.cy + dy, radius: 3.5,
                fill: color, stroke: '#111', strokeWidth: 0.6,
            }));
            this._staticGroup.add(new Konva.Text({
                x: v.cx + dx + (dx > 0 ? 4 : dx < 0 ? -11 : -4),
                y: v.cy + dy + (dy > 0 ? 3  : dy < 0 ? -14 : -5),
                text: label, fontSize: 8, fill: color, fontStyle: 'bold',
            }));
        });

        this._staticGroup.add(new Konva.Text({
            x: v.cx - 18, y: v.cy + r + 8,
            text: '四通换向阀', fontSize: 7, fill: '#b0bec5', fontStyle: 'bold',
        }));
    }

    // ── 气液分离器（Accumulator）────────────────────
    _drawAccumulator() {
        const a = this._accum;

        // 筒体
        this._staticGroup.add(new Konva.Ellipse({
            x: a.cx, y: a.cy,
            radiusX: a.rx, radiusY: a.ry,
            fillLinearGradientStartPoint: { x: -a.rx, y: 0 },
            fillLinearGradientEndPoint:   { x:  a.rx, y: 0 },
            fillLinearGradientColorStops: [
                0, '#4a5568', 0.4, '#718096', 0.7, '#606880', 1, '#3a4050',
            ],
            stroke: '#2d3748', strokeWidth: 1.2,
        }));
        // 顶部进气口
        this._staticGroup.add(new Konva.Rect({
            x: a.cx - 4, y: a.cy - a.ry - 10,
            width: 8, height: 12,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 底部出气口（U 管内置）
        this._staticGroup.add(new Konva.Rect({
            x: a.cx + 2, y: a.cy - a.ry - 8,
            width: 6, height: 10,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 液位线（静态示意）
        this._staticGroup.add(new Konva.Ellipse({
            x: a.cx, y: a.cy + a.ry * 0.25,
            radiusX: a.rx * 0.82, radiusY: a.ry * 0.12,
            fill: 'rgba(100,180,255,0.30)',
        }));

        this._staticGroup.add(new Konva.Text({
            x: a.cx - 20, y: a.cy + a.ry + 6,
            text: '气液分离器', fontSize: 7, fill: '#90a4ae',
        }));
    }

    // ── 高压储液器（Receiver）────────────────────────
    _drawReceiver() {
        const rv = this._receiver;

        // 筒体
        this._staticGroup.add(new Konva.Ellipse({
            x: rv.cx, y: rv.cy,
            radiusX: rv.rx, radiusY: rv.ry,
            fillLinearGradientStartPoint: { x: -rv.rx, y: 0 },
            fillLinearGradientEndPoint:   { x:  rv.rx, y: 0 },
            fillLinearGradientColorStops: [0,'#5d4037',0.4,'#8d6e63',1,'#4e342e'],
            stroke: '#3e2723', strokeWidth: 1,
        }));
        // 顶部液管接口（进/出）
        [-rv.rx * 0.35, rv.rx * 0.35].forEach(dx => {
            this._staticGroup.add(new Konva.Rect({
                x: rv.cx + dx - 3, y: rv.cy - rv.ry - 7,
                width: 6, height: 9,
                fill: '#b87333', stroke: '#8a5520', strokeWidth: 0.6,
                cornerRadius: 1,
            }));
        });

        // 充注阀（侧面小突起）
        this._staticGroup.add(new Konva.Circle({
            x: rv.cx + rv.rx, y: rv.cy,
            radius: 3.5, fill: '#f57f17', stroke: '#e65100', strokeWidth: 0.8,
        }));

        this._staticGroup.add(new Konva.Text({
            x: rv.cx - 18, y: rv.cy + rv.ry + 5,
            text: '高压储液器', fontSize: 6.5, fill: '#a1887f',
        }));
    }

    // ── 干燥过滤器 ───────────────────────────────────
    _drawDryer() {
        const d = this._dryer;

        // 筒体（小圆柱，竖向）
        this._staticGroup.add(new Konva.Ellipse({
            x: d.cx, y: d.cy,
            radiusX: d.r, radiusY: d.r * 1.9,
            fillLinearGradientStartPoint: { x: -d.r, y: 0 },
            fillLinearGradientEndPoint:   { x:  d.r, y: 0 },
            fillLinearGradientColorStops: [0,'#1a3a5a',0.5,'#2e6097',1,'#1a3a5a'],
            stroke: '#0d2440', strokeWidth: 1,
        }));
        // 视液镜（顶部小圆）
        this._staticGroup.add(new Konva.Circle({
            x: d.cx, y: d.cy - d.r * 1.9 - 5,
            radius: 4,
            fill: this._running ? 'rgba(80,200,80,0.60)' : 'rgba(80,80,80,0.40)',
            stroke: '#444', strokeWidth: 0.8,
        }));
        // 干燥剂标注（颗粒示意）
        this._staticGroup.add(new Konva.Text({
            x: d.cx - 3, y: d.cy - 5,
            text: 'D', fontSize: 7, fill: '#80b4e0', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: d.cx - 14, y: d.cy + d.r * 1.9 + 5,
            text: '干燥过滤器', fontSize: 6.5, fill: '#80b4e0',
        }));
    }

    // ── 单向阀（Check Valves）────────────────────────
    _drawCheckValves() {
        const W = this.width, H = this.height;
        // 液管路径上的单向阀（制热模式旁通用）
        const cvX = W * 0.66, cvY = H * 0.86;
        this._drawSingleCheckValve(cvX, cvY, '水平');
    }

    _drawSingleCheckValve(x, y, dir) {
        // 单向阀符号（三角+竖线）
        this._staticGroup.add(new Konva.Line({
            points: [x - 6, y - 5, x + 6, y, x - 6, y + 5],
            closed: true,
            fill: '#ff8f00', stroke: '#e65100', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x + 6, y - 5, x + 6, y + 5],
            stroke: '#e65100', strokeWidth: 1.5, lineCap: 'round',
        }));
    }

    // ── 高低压保护开关 ──────────────────────────────
    _drawPressureSwitches() {
        const W = this.width, H = this.height;

        // 高压开关（HPS，排气管上）
        const hpsX = W * 0.26, hpsY = H * 0.52;
        this._hpsNode = this._drawPressureSwitch(hpsX, hpsY, '#ef5350', 'HPS');

        // 低压开关（LPS，吸气管上）
        const lpsX = W * 0.16, lpsY = H * 0.50;
        this._lpsNode = this._drawPressureSwitch(lpsX, lpsY, '#80d8ff', 'LPS');
    }

    _drawPressureSwitch(x, y, color, label) {
        this._staticGroup.add(new Konva.Rect({
            x: x - 7, y: y - 5, width: 14, height: 10,
            fill: '#2a2a2a', stroke: color, strokeWidth: 1, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: x - 6, y: y - 4, text: label,
            fontSize: 5.5, fill: color, fontStyle: 'bold',
        }));
        return null;
    }

    // ── 传感器 ───────────────────────────────────────
    _drawSensors() {
        const W = this.width, H = this.height;
        const c = this._comp;
        const e = this._cond;

        const sensors = [
            {
                key: 'tso', x: W*0.08, y: H*0.18,
                color: '#ffca28', label: `Tso: ${this._outdoorTemp}°C`,
                tip: '室外温度',
            },
            {
                key: 'tco', x: e.x + e.w*0.55, y: e.y + e.h*0.35,
                color: '#ff7043', label: `Tco: ${this._condCoilTemp}°C`,
                tip: '冷凝管温',
            },
            {
                key: 'td', x: c.cx - c.rx*0.35, y: c.cy - c.ry - 18,
                color: '#ef5350', label: `Td: ${this._dischargeTemp}°C`,
                tip: '排气温度',
            },
            {
                key: 'ts', x: c.cx + c.rx*0.20, y: c.cy - c.ry - 16,
                color: '#80d8ff', label: `Ts: ${this._suctionTemp}°C`,
                tip: '吸气温度',
            },
        ];

        this._sensorTexts = {};
        sensors.forEach(s => {
            this._staticGroup.add(new Konva.Circle({
                x: s.x, y: s.y, radius: 4.5,
                fill: s.color, stroke: '#000', strokeWidth: 0.8,
            }));
            const txt = new Konva.Text({
                x: s.x + 6, y: s.y - 4,
                text: s.label,
                fontSize: 7, fill: s.color, fontStyle: 'bold',
            });
            this._staticGroup.add(txt);
            this._sensorTexts[s.key] = txt;
        });

        // 压力显示（静态数字框，内容动态）
        this._hpText = this._drawPressureDisplay(W*0.30, H*0.50, '#ef5350', `HP: ${this._highPressure.toFixed(2)}MPa`);
        this._lpText = this._drawPressureDisplay(W*0.12, H*0.48, '#80d8ff', `LP: ${this._lowPressure.toFixed(2)}MPa`);
    }

    _drawPressureDisplay(x, y, color, text) {
        this._staticGroup.add(new Konva.Rect({
            x, y: y - 1, width: 72, height: 11,
            fill: '#0d1117', stroke: color, strokeWidth: 0.7, cornerRadius: 2,
        }));
        const t = new Konva.Text({
            x: x + 2, y, text,
            fontSize: 7, fill: color, fontStyle: 'bold',
        });
        this._interactGroup.add(t);
        return t;
    }

    // ── 变频驱动板（IPM/Inverter）────────────────────
    _drawInverterBoard() {
        const W = this.width, H = this.height;
        const bx = W*0.09, by = H*0.24;
        const bw = W*0.12, bh = H*0.18;

        // 基板（蓝色 PCB）
        this._staticGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#0d2b45', stroke: '#1565c0', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // 散热片
        this._staticGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh * 0.30,
            fill: '#8d8d8d', stroke: '#666', strokeWidth: 0.5,
            cornerRadius: [2, 2, 0, 0],
        }));
        for (let i = 1; i < 5; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [bx + bw * i / 5, by, bx + bw * i / 5, by + bh * 0.30],
                stroke: '#555', strokeWidth: 1,
            }));
        }
        // IGBT 模块
        this._staticGroup.add(new Konva.Rect({
            x: bx + bw*0.15, y: by + bh*0.38,
            width: bw*0.70, height: bh*0.42,
            fill: '#101820', stroke: '#2a3a4a', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: bx + bw*0.20, y: by + bh*0.45,
            text: 'IPM\nInverter',
            fontSize: 5.5, fill: '#4fc3f7', fontStyle: 'bold',
            lineHeight: 1.3, align: 'center', width: bw * 0.60,
        }));
        this._staticGroup.add(new Konva.Text({
            x: bx, y: by - 10,
            text: '变频驱动板', fontSize: 7, fill: '#4fc3f7', fontStyle: 'bold',
        }));
    }

    // ── 主控板（Main PCB）─────────────────────────────
    _drawMainPCB() {
        const W = this.width, H = this.height;
        const bx = W*0.09, by = H*0.44;
        const bw = W*0.12, bh = H*0.14;

        this._staticGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#1b3a1e', stroke: '#2e7d32', strokeWidth: 1,
            cornerRadius: 2,
        }));
        for (let i = 0; i < 3; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [bx + 2, by + (i + 1) * bh / 4, bx + bw - 2, by + (i + 1) * bh / 4],
                stroke: '#ffd54f', strokeWidth: 0.5,
            }));
        }
        this._staticGroup.add(new Konva.Rect({
            x: bx + bw*0.25, y: by + bh*0.50,
            width: bw*0.50, height: bh*0.38,
            fill: '#111', stroke: '#444', strokeWidth: 0.5, cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: bx + bw*0.27, y: by + bh*0.54,
            text: 'MCU', fontSize: 5, fill: '#9e9e9e', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: bx, y: by - 10,
            text: '主控板', fontSize: 7, fill: '#4caf50', fontStyle: 'bold',
        }));
    }

    // ── 全部制冷管路 ────────────────────────────────
    _drawAllPipes() {
        const W = this.width, H = this.height;
        const c  = this._comp;
        const v  = this._valve4;
        const a  = this._accum;
        const e  = this._cond;
        const rv = this._receiver;
        const d  = this._dryer;

        // ── A. 压缩机排气 → 四通阀 D 口（高温高压，红色）──
        this._drawPipe([
            c.cx - c.rx * 0.38, c.cy - c.ry,          // 压缩机排气口
            c.cx - c.rx * 0.38, H * 0.58,
            v.cx,                H * 0.58,
            v.cx,                v.cy - v.r,            // 四通阀 D 口
        ], '#ef5350', 3, false, 'discharge');

        // ── B. 四通阀 C 口 → 冷凝器顶入口（高压气体，橙红）──
        this._drawPipe([
            v.cx + v.r,         v.cy,
            e.x + e.w * 0.10,   v.cy,
            e.x + e.w * 0.10,   e.y + 6,               // 冷凝器顶端入口
        ], '#ff8a65', 4, false, 'cond_in');

        // ── C. 冷凝器底出口 → 干燥器 → 储液器（液管，蓝色）──
        this._drawPipe([
            e.x + e.w * 0.88,  e.y + e.h - 6,          // 冷凝器底端出口
            e.x + e.w * 0.88,  H * 0.86,
            rv.cx + rv.rx,     H * 0.86,
            rv.cx,             rv.cy - rv.ry,            // 储液器顶入
        ], '#2196f3', 3, false, 'cond_out');

        this._drawPipe([
            rv.cx,              rv.cy - rv.ry,           // 储液器顶出
            d.cx + d.r,         H * 0.86,
            d.cx,               d.cy - d.r * 1.9,        // 干燥器顶入
        ], '#2196f3', 3, false, 'to_dryer');

        // ── D. 干燥器 → 单向阀 → 液管接口（液态，细蓝）──
        this._drawPipe([
            d.cx,               d.cy - d.r * 1.9,        // 干燥器顶出
            d.cx,               H * 0.78,
            W * 0.55,           H * 0.78,
            W * 0.30,           H * 0.78,
            this._liquidPortX,  this._liquidPortY,        // 液管接口
        ], '#2196f3', 3, false, 'liquid_line');

        // ── E. 气管接口 → 四通阀 E 口（低压气体，粗浅蓝虚线）──
        this._drawPipe([
            this._gasPortX,     this._gasPortY,           // 气管接口
            W * 0.28,           this._gasPortY,
            W * 0.28,           v.cy,
            v.cx - v.r,         v.cy,                     // 四通阀 E 口
        ], '#80d8ff', 5, true, 'suction_in');

        // ── F. 四通阀 S 口 → 气液分离器 → 压缩机吸气（低压，浅蓝虚线）──
        this._drawPipe([
            v.cx,               v.cy + v.r,               // 四通阀 S 口
            v.cx,               H * 0.78,
            a.cx + a.rx,        H * 0.78,
            a.cx,               a.cy + a.ry,              // 气液分离器底入
        ], '#80d8ff', 4, true, 'to_accum');

        this._drawPipe([
            a.cx + a.rx * 0.30, a.cy - a.ry,             // 气液分离器顶出
            a.cx + a.rx * 0.30, c.cy - c.ry,             // 压缩机吸气口
            c.cx + c.rx * 0.20, c.cy - c.ry,
        ], '#80d8ff', 5, true, 'suction_comp');

        // ── 管路保温棉标注 ──
        this._staticGroup.add(new Konva.Text({
            x: W * 0.10, y: this._gasPortY - 10,
            text: '气管 φ12.7\n（保温）',
            fontSize: 6, fill: '#80d8ff', lineHeight: 1.3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.10, y: this._liquidPortY + 5,
            text: '液管 φ6.35\n（保温）',
            fontSize: 6, fill: '#2196f3', lineHeight: 1.3,
        }));
    }

    _drawPipe(pts, color, width, dashed, tag) {
        const lineProps = {
            points: pts,
            stroke: color,
            strokeWidth: width,
            lineCap: 'round', lineJoin: 'round',
        };
        if (dashed) lineProps.dash = [7, 4];
        this._staticGroup.add(new Konva.Line(lineProps));
        // 管路高光（细线）
        this._staticGroup.add(new Konva.Line({
            points: pts,
            stroke: 'rgba(255,255,255,0.12)',
            strokeWidth: width * 0.35,
            lineCap: 'round', lineJoin: 'round',
            listening: false,
        }));
    }

    // ── 管路连接接口 ────────────────────────────────
    _drawPipeConnectors() {
        const W = this.width, H = this.height;

        // 液管接口
        this._drawPortFitting(this._liquidPortX, this._liquidPortY,
            3, '#2196f3', '液管\nφ6.35', 'right');

        // 气管接口
        this._drawPortFitting(this._gasPortX, this._gasPortY,
            5, '#80d8ff', '气管\nφ12.7', 'right');

        // 电源接口
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.02 - 5, y: H * 0.65 - 8,
            width: 10, height: 16,
            fill: '#3a3a3a', stroke: '#555', strokeWidth: 1, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.03, y: H * 0.65 + 10,
            text: 'PWR', fontSize: 6.5, fill: '#9e9e9e',
        }));
    }

    _drawPortFitting(x, y, r, color, labelText, labelDir) {
        const points = [];
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            points.push(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
        }
        this._staticGroup.add(new Konva.Line({
            points, closed: true,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r + 1,
            fill: '#1a2a3a', stroke: color, strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r - 0.5,
            fill: color, opacity: 0.4,
        }));

        const lx = labelDir === 'right' ? x + 12 : x - 30;
        const ly = y - 8;
        this._staticGroup.add(new Konva.Text({
            x: lx, y: ly, text: labelText,
            fontSize: 6.5, fill: color, fontStyle: 'bold',
            lineHeight: 1.3,
        }));
    }

    // ── 组件标注 ────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  壁挂式室外机  ${this.capacity}W  ${this.refrigerant}  ${this.compType === 'inverter' ? '变频' : '定频'}`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示灯 ──────────────────────────────────
    _drawStatusIndicator() {
        const W = this.width, H = this.height;
        const c = this._cabinet;
        const ix = c.x + 20;
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
            x: ix + 8, y: iy - 5,
            text: this._running ? '运行' : '停机',
            fontSize: 7, fontStyle: 'bold',
            fill: this._running ? '#00e676' : '#ef5350',
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    // ── 动态粒子层 ──────────────────────────────────
    _buildDynamicLayers() {
        const W = this.width, H = this.height;

        this._flowGroup = new Konva.Group();
        this._staticGroup.add(this._flowGroup);

        // 排气管（高温高压，红色粒子）
        this._dischargeParticles = this._makeParticles(3, '#ef5350', 3.5);
        // 冷凝器入口（橙红，气态）
        this._condInParticles    = this._makeParticles(3, '#ff8a65', 3.0);
        // 液管（液态制冷剂，蓝色）
        this._liquidParticles    = this._makeParticles(4, '#2196f3', 2.5);
        // 吸气管（低压气体，浅蓝，较大）
        this._suctionParticles   = this._makeParticles(3, '#80d8ff', 3.5);
    }

    _makeParticles(count, color, radius) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            const p = new Konva.Circle({
                radius,
                fill: color, opacity: 0.85,
                shadowColor: color, shadowBlur: 5, shadowOpacity: 0.55,
            });
            this._flowGroup.add(p);
            arr.push({ node: p, t: i / count });
        }
        return arr;
    }

    // ── 制冷模式管路路径（粒子流动用）────────────────
    _getDischargeFlowPath() {
        const W = this.width, H = this.height;
        const c = this._comp, v = this._valve4;
        return [
            { x: c.cx - c.rx*0.38, y: c.cy - c.ry },
            { x: c.cx - c.rx*0.38, y: H*0.58 },
            { x: v.cx,             y: H*0.58 },
            { x: v.cx,             y: v.cy - v.r },
        ];
    }

    _getCondInFlowPath() {
        const W = this.width, H = this.height;
        const v = this._valve4, e = this._cond;
        return [
            { x: v.cx + v.r,        y: v.cy },
            { x: e.x + e.w*0.10,    y: v.cy },
            { x: e.x + e.w*0.10,    y: e.y + 6 },
            { x: e.x + e.w*0.50,    y: e.y + e.h*0.5 },  // 穿越冷凝器
            { x: e.x + e.w*0.88,    y: e.y + e.h - 6 },
        ];
    }

    _getLiquidFlowPath() {
        const W = this.width, H = this.height;
        const e = this._cond, rv = this._receiver, d = this._dryer;
        return [
            { x: e.x + e.w*0.88,  y: e.y + e.h - 6 },
            { x: e.x + e.w*0.88,  y: H*0.86 },
            { x: rv.cx,            y: H*0.86 },
            { x: d.cx,             y: H*0.86 },
            { x: d.cx,             y: d.cy },
            { x: d.cx,             y: H*0.78 },
            { x: this._liquidPortX,y: this._liquidPortY },
        ];
    }

    _getSuctionFlowPath() {
        const W = this.width, H = this.height;
        const v = this._valve4, a = this._accum, c = this._comp;
        return [
            { x: this._gasPortX,       y: this._gasPortY },
            { x: W*0.28,               y: this._gasPortY },
            { x: W*0.28,               y: v.cy },
            { x: v.cx - v.r,           y: v.cy },
            { x: v.cx,                 y: v.cy + v.r },
            { x: v.cx,                 y: H*0.78 },
            { x: a.cx + a.rx,          y: H*0.78 },
            { x: a.cx + a.rx*0.30,     y: a.cy - a.ry },
            { x: c.cx + c.rx*0.20,     y: c.cy - c.ry },
        ];
    }

    _interpolatePath(path, t) {
        let totalLen = 0;
        const segs = [];
        for (let i = 0; i < path.length - 1; i++) {
            const dx = path[i+1].x - path[i].x;
            const dy = path[i+1].y - path[i].y;
            const len = Math.sqrt(dx*dx + dy*dy);
            segs.push(len);
            totalLen += len;
        }
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
            const allP = [
                ...this._dischargeParticles,
                ...this._condInParticles,
                ...this._liquidParticles,
                ...this._suctionParticles,
            ];
            allP.forEach(p => p.node.opacity(0));
            return;
        }

        // ── 轴流风扇旋转 ──
        const fanRpm = this._fanSpeed === 'high' ? 4.5 :
                       this._fanSpeed === 'mid'  ? 3.0 : 2.2;
        this._fanAngle += dt * 360 * fanRpm;
        this._fanGroup.rotation(this._fanAngle);

        // ── 压缩机律动（轻微缩放，模拟振动）──
        this._compPhase += dt * this._compFreq * 0.12;
        const pulse = 1 + 0.012 * Math.sin(this._compPhase * Math.PI * 2);
        this._compGroup.scaleX(pulse);
        this._compGroup.scaleY(pulse);

        // ── 制冷剂粒子流动 ──
        const speed = 0.22;
        this._flowPhase = (this._flowPhase + dt * speed) % 1;

        const paths = [
            { particles: this._dischargeParticles, path: this._getDischargeFlowPath(), opacity: 0.9 },
            { particles: this._condInParticles,    path: this._getCondInFlowPath(),    opacity: 0.75 },
            { particles: this._liquidParticles,    path: this._getLiquidFlowPath(),    opacity: 0.85 },
            { particles: this._suctionParticles,   path: this._getSuctionFlowPath(),   opacity: 0.65 },
        ];

        paths.forEach(({ particles, path, opacity }) => {
            particles.forEach(p => {
                const t = (p.t + this._flowPhase) % 1;
                const pos = this._interpolatePath(path, t);
                p.node.x(pos.x);
                p.node.y(pos.y);
                p.node.opacity(opacity);
            });
        });

        // ── 传感器数值动态更新（每 2 秒）──
        if (!this._sensorTimer || Date.now() - this._sensorTimer > 2000) {
            this._sensorTimer = Date.now();

            this._condCoilTemp  = 48 + 4 * Math.sin(Date.now() / 7000);
            this._dischargeTemp = 82 + 6 * Math.sin(Date.now() / 4000);
            this._suctionTemp   = 14 + 2 * Math.sin(Date.now() / 6000);
            this._highPressure  = parseFloat((2.75 + 0.12 * Math.sin(Date.now() / 5000)).toFixed(2));
            this._lowPressure   = parseFloat((0.78 + 0.05 * Math.sin(Date.now() / 4500)).toFixed(2));

            this._sensorTexts?.tco?.text(`Tco: ${this._condCoilTemp.toFixed(1)}°C`);
            this._sensorTexts?.td?.text( `Td: ${this._dischargeTemp.toFixed(1)}°C`);
            this._sensorTexts?.ts?.text( `Ts: ${this._suctionTemp.toFixed(1)}°C`);
            this._hpText?.text(`HP: ${this._highPressure.toFixed(2)}MPa`);
            this._lpText?.text(`LP: ${this._lowPressure.toFixed(2)}MPa`);

            // 压缩机铭牌频率更新
            if (this._compType === 'inverter') {
                this._compFreq = Math.round(30 + 60 * Math.abs(Math.sin(Date.now() / 10000)));
            }
        }

        this._refreshCache();
    }

    _bindInteraction() {
        if (this._statusDot) {
            this._statusDot.on('click tap', () => this.toggle());
            this._statusDot.listening(true);
        }
        if (this._statusText) {
            this._statusText.on('click tap', () => this.toggle());
            this._statusText.listening(true);
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

    /** 切换制冷/制热模式 */
    setMode(mode) {
        if (!['cool', 'heat'].includes(mode)) return;
        this._mode    = mode;
        this._valveOn = (mode === 'heat');
        if (this._valveCoil) {
            this._valveCoil.fill(this._valveOn ? '#1565c0' : '#37474f');
            this._valveCoil.stroke(this._valveOn ? '#0d47a1' : '#263238');
        }
        this._refreshCache();
    }

    /** 设置风速 */
    setFanSpeed(speed) {
        if (['auto', 'low', 'mid', 'high'].includes(speed)) {
            this._fanSpeed = speed;
        }
    }

    /** 设置压缩机频率（变频机型有效）*/
    setFrequency(hz) {
        this._compFreq = Math.max(15, Math.min(120, hz));
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
    }

    isRunning()         { return this._running; }
    getMode()           { return this._mode; }
    getHighPressure()   { return this._highPressure; }
    getLowPressure()    { return this._lowPressure; }
    getDischargeTemp()  { return this._dischargeTemp; }
    getSuctionTemp()    { return this._suctionTemp; }
    getCompFreq()       { return this._compFreq; }

    update(state) {
        if (typeof state === 'boolean') { state ? this.start() : this.stop(); }
        if (typeof state === 'object' && state !== null) {
            if (state.running   !== undefined) state.running ? this.start() : this.stop();
            if (state.mode      !== undefined) this.setMode(state.mode);
            if (state.fanSpeed  !== undefined) this.setFanSpeed(state.fanSpeed);
            if (state.frequency !== undefined) this.setFrequency(state.frequency);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',        type: 'text'   },
            { label: '制冷量 (W)',           key: 'capacity',     type: 'number' },
            { label: '额定功率 (W)',         key: 'ratedPower',   type: 'number' },
            { label: '制冷剂型号',           key: 'refrigerant',  type: 'text'   },
            { label: '压缩机类型',           key: 'compType',     type: 'text'   },
            { label: '运行模式(cool/heat)',  key: 'mode',         type: 'text'   },
            { label: '风速',                 key: 'fanSpeed',     type: 'text'   },
            { label: '压缩机频率 (Hz)',      key: 'compFreq',     type: 'number' },
            { label: '初始运行（1=运行）',   key: 'initRunning',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label       = cfg.label       || this.label;
        this.capacity    = parseFloat(cfg.capacity)   || this.capacity;
        this.ratedPower  = parseFloat(cfg.ratedPower) || this.ratedPower;
        this.refrigerant = cfg.refrigerant || this.refrigerant;
        this.compType    = cfg.compType    || this.compType;
        if (cfg.mode      !== undefined) this.setMode(cfg.mode);
        if (cfg.fanSpeed  !== undefined) this.setFanSpeed(cfg.fanSpeed);
        if (cfg.compFreq  !== undefined) this.setFrequency(parseFloat(cfg.compFreq));
        if (cfg.initRunning !== undefined) {
            parseInt(cfg.initRunning) ? this.start() : this.stop();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}