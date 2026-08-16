import { BaseComponent } from './BaseComponent.js';

/**
 * S 型离心分油机仿真组件
 * （S-Type Centrifugal Oil Purifier / Separator）
 *
 * ── 设备说明 ──────────────────────────────────────────────────
 *
 *  S 型自动排渣离心分油机广泛用于船舶及工业场合，对燃油、
 *  润滑油进行净化处理，去除水分和固体杂质。
 *
 *  主要结构（从外到内，纵截面）：
 *
 *  1. 机架与驱动电机（Frame & Motor）
 *     支撑转鼓，提供高速旋转动力（转速约 4500~7200 rpm）
 *
 *  2. 转鼓外壳（Bowl Shell）
 *     分离腔主体，随主轴高速旋转，产生离心力场
 *     （离心力约为重力的 6000~8000 倍）
 *
 *  3. 碟片组（Disc Stack）
 *     转鼓内叠放若干锥形碟片（约 50~150 片），
 *     增大分离面积，缩短沉降距离，提升分离效率
 *     碟片间间隙约 0.4~0.8 mm，碟片半角约 40°~45°
 *
 *  4. 分配板（Distributor）
 *     位于碟片组下方，将进油均匀分配到各碟片间隙
 *
 *  5. 重相腔（Heavy Phase Chamber）& 轻相腔（Light Phase Chamber）
 *     - 重相腔（外侧）：收集水分和重质杂质，经重相出口排出
 *     - 轻相腔（内侧/顶部）：净化后的油，经净油出口排出
 *
 *  6. 转鼓底盖（Bowl Bottom）& 活塞（Piston）
 *     底盖内有液压操作活塞，通过调节水压力控制底盖开关
 *     - 开启水：升高底盖液位，活塞下移，底盖打开 → 排渣
 *     - 密封水：在底盖下方形成水封，阻止油液泄漏
 *     - 调节水：调节转鼓内重相界面位置（界面盘位置）
 *
 *  7. 界面盘（Gravity Disc / Interface Disc）
 *     位于转鼓顶部，按所处理油品密度选配不同内径，
 *     决定油-水界面在转鼓内的径向位置
 *
 * ── 工作流程 ──────────────────────────────────────────────────
 *
 *  净油（Purifier Mode）：
 *    密封水注入 → 形成水封 → 待分油从底部进入
 *    → 经分配板均匀进入碟片组
 *    → 离心力使油（轻相）向中心聚集 → 净油出口排出
 *    → 水和重杂质（重相）向外壁聚集 → 由界面盘控制排出
 *    → 固体杂质沉积在转鼓外壁渣腔 → 积累到一定量后排渣
 *
 *  排渣（Desludging）：
 *    开启水注入活塞腔 → 活塞下移 → 底盖向下开启
 *    → 渣腔瞬间打开（约 0.1~0.5 s）→ 渣和水从排渣口喷出
 *    → 底盖关闭（开启水停止，密封水重新建立）→ 继续净油
 *
 * ── 仿真接口 ──────────────────────────────────────────────────
 *
 *  输入端口（左侧，从上到下）：
 *    inlet_reg_water   — 调节水进口（Regulating Water Inlet）
 *    inlet_seal_water  — 密封水进口（Sealing Water Inlet）
 *    inlet_open_water  — 开启水进口（Opening Water Inlet）
 *    inlet_dirty_oil   — 待分油进口（Dirty Oil Inlet）
 *
 *  输出端口（右侧，从上到下）：
 *    outlet_clean_oil  — 净油出口（Clean Oil Outlet）
 *    outlet_drain      — 排水口（Water Drain Outlet）
 *    outlet_sludge     — 排渣口（Sludge Discharge Outlet）
 *
 * ── 仿真状态机 ────────────────────────────────────────────────
 *
 *  IDLE        — 停机（转鼓静止，所有管路关闭）
 *  STARTING    — 启动加速（转速从 0 上升到额定，约 3 s 动画）
 *  SEALING     — 密封水注入（转鼓达速，注水建立水封，约 1 s）
 *  PURIFYING   — 正常净油运行（连续工作，各相流动动画循环）
 *  DESLUDGING  — 排渣（底盖开启，渣粒喷出，约 0.8 s）
 *  STOPPING    — 停机减速（约 2 s 动画）
 *
 *  点击组件：循环切换状态
 *    IDLE → STARTING → SEALING → PURIFYING → DESLUDGING → PURIFYING
 *  调用 stop()：任意状态 → STOPPING → IDLE
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图纵截面（Front View Cross-Section），展示：
 *  - 机架与电机（底部）
 *  - 转鼓外壳（中部，随转速旋转的视觉纹理）
 *  - 碟片组（转鼓内，楔形叠层）
 *  - 各相流体粒子（油：黄棕，水：蓝，渣：深褐）
 *  - 各管路流动动画（连接端口）
 *  - 转速表（右上角）
 *  - 状态指示灯（左下角）
 */
export class SOilSeparator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(260, config.width  || 320);
        this.height = Math.max(320, config.height || 400);

        this.type    = 's_oil_separator';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 设备参数 ──
        this.label       = config.label      || 'SP';      // 位号
        this.model       = config.model      || 'S-500';   // 型号
        this.ratedRpm    = config.ratedRpm   || 6000;      // rpm，额定转速
        this.capacity    = config.capacity   || 500;       // L/h，处理量
        this.oilDensity  = config.oilDensity || 0.890;     // g/cm³，待分油密度

        // ── 状态机 ──
        // 'idle' | 'starting' | 'sealing' | 'purifying' | 'desludging' | 'stopping'
        this._state      = config.initState  || 'idle';
        this._animating  = false;
        this._stateT     = 0;     // 当前状态已持续时间（s）
        this._stateDur   = {      // 各状态持续/动画时长（s）
            starting:   3.0,
            sealing:    1.0,
            desludging: 0.8,
            stopping:   2.0,
        };

        // ── 物理量（仿真） ──
        this._rpm        = 0;           // 当前转速
        this._drumAngle  = 0;           // 转鼓视觉旋转角（°）
        this._sludgeLevel= 0;           // 渣腔充满度 0~1
        this._sludgeAccum= config.initSludge || 0;  // 累计进油时长（归一化）
        this._waterSeal  = false;       // 水封是否建立
        this._bowlOpen   = false;       // 底盖是否开启（排渣中）

        // 粒子系统
        this._oilParticles   = [];      // 净油流粒子
        this._waterParticles = [];      // 排水粒子
        this._sludgeParticles= [];      // 排渣粒子
        this._feedParticles  = [];      // 进油粒子
        this._pTimer         = 0;

        // 操作计数
        this.opsCount    = config.initOps || 0;


        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 机架（最底部）
        this._frame = {
            x: W * 0.10, y: H * 0.80,
            w: W * 0.80, h: H * 0.16,
            rx: 4,
        };

        // 电机（机架上方，左侧）
        this._motor = {
            x: W * 0.12, y: H * 0.66,
            w: W * 0.28, h: H * 0.14,
        };

        // 转鼓外壳（中部居中）
        this._bowl = {
            x: W * 0.25, y: H * 0.12,
            w: W * 0.50, h: H * 0.58,
            rx: W * 0.08,
        };
        this._bowlCx = this._bowl.x + this._bowl.w / 2;
        this._bowlCy = this._bowl.y + this._bowl.h / 2;

        // 碟片组区域（转鼓内，中部）
        this._discZone = {
            x: this._bowl.x + this._bowl.w * 0.12,
            y: this._bowl.y + this._bowl.h * 0.18,
            w: this._bowl.w * 0.76,
            h: this._bowl.h * 0.52,
        };

        // 进料管（底部轴线，进入分配板）
        this._feedPipeY  = this._bowl.y + this._bowl.h * 0.88;

        // 净油出口管（顶部轴线）
        this._cleanOilY  = this._bowl.y + this._bowl.h * 0.08;

        // 排水管（转鼓中部侧面）
        this._drainY     = this._bowl.y + this._bowl.h * 0.30;

        // 排渣口（转鼓底部侧面）
        this._sludgeY    = this._bowl.y + this._bowl.h * 0.82;

        // ── 端口 x 坐标 ──
        this._leftPortX  = this._bowl.x - W * 0.12;
        this._rightPortX = this._bowl.x + this._bowl.w + W * 0.12;

        // ── 调节水进口 y（左侧，从上到下排列）──
        const portSpan = (this._sludgeY - this._cleanOilY) / 3;
        this._portRegWaterY  = this._cleanOilY + portSpan * 0.0;
        this._portSealWaterY = this._cleanOilY + portSpan * 1.0;
        this._portOpenWaterY = this._cleanOilY + portSpan * 2.0;
        this._portDirtyOilY  = this._cleanOilY + portSpan * 3.0;

        // 右侧出口 y
        this._portCleanOilY  = this._cleanOilY;
        this._portDrainY     = this._drainY;
        this._portSludgeY    = this._sludgeY;

        this._init();

        // ── 端口注册 ──
        // 输入端口（左侧）
        this.addPort(this._leftPortX - 2, this._portRegWaterY,  'inlet_reg_water',   'wire', '调节水');
        this.addPort(this._leftPortX - 2, this._portSealWaterY, 'inlet_seal_water',  'wire', '密封水');
        this.addPort(this._leftPortX - 2, this._portOpenWaterY, 'inlet_open_water',  'wire', '开启水');
        this.addPort(this._leftPortX - 2, this._portDirtyOilY,  'inlet_dirty_oil',   'wire', '待分油');
        // 输出端口（右侧）
        this.addPort(this._rightPortX + 2, this._portCleanOilY, 'outlet_clean_oil',  'wire', '净油');
        this.addPort(this._rightPortX + 2, this._portDrainY,    'outlet_drain',      'wire', '排水');
        this.addPort(this._rightPortX + 2, this._portSludgeY,   'outlet_sludge',     'wire', '排渣');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawFrame();            // 静态：机架
        this._drawMotor();            // 静态：电机
        this._drawBowlBody();         // 静态：转鼓外壳主体
        this._drawCrossSection();     // 静态：内部截面结构（碟片、腔室标注）
        this._drawPipework();         // 静态：进出管路（固定管段）
        this._drawPortLabels();       // 静态：端口标注
        this._drawDrumLayer();        // 动态层①：转鼓旋转纹理 + 转速
        this._drawFlowLayer();        // 动态层②：流体粒子 + 排渣动画
        this._drawWindowLayer();      // 动态层③：状态窗口（转速 / 渣位 / 水封）
        this._drawBowlFront();        // 静态前景：转鼓轮廓 + 高光（覆盖动态层）
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 机架 ──────────────────────────────────────────────────
    _drawFrame() {
        const f = this._frame;
        // 阴影
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 3, y: f.y + 5,
            width: f.w, height: f.h,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: f.rx,
        }));
        // 主体（铸铁灰）
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: 0,   y: f.h },
            fillLinearGradientColorStops: [
                0, '#3a3a3e', 0.4, '#4a4a50', 0.7, '#42424a', 1, '#2e2e32',
            ],
            stroke: '#555560', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        // 机架顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 3, y: f.y + 2, width: f.w - 6, height: f.h * 0.12,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        // 底脚螺栓（四个）
        const boltY = f.y + f.h - 6;
        [f.x + f.w * 0.12, f.x + f.w * 0.30, f.x + f.w * 0.70, f.x + f.w * 0.88].forEach(bx => {
            this._staticGroup.add(new Konva.Rect({
                x: bx - 5, y: boltY, width: 10, height: 8,
                fill: '#6a6a72', stroke: '#4a4a52', strokeWidth: 0.8, cornerRadius: 2,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: bx, y: boltY + 4, radius: 2.5,
                fill: '#909098', stroke: '#606068', strokeWidth: 0.5,
            }));
        });
        // 机架标牌
        this._staticGroup.add(new Konva.Rect({
            x: this._bowlCx - 28, y: f.y + f.h * 0.22,
            width: 56, height: f.h * 0.50,
            fill: '#1a1a20', stroke: '#2a2a30', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._bowlCx - 26, y: f.y + f.h * 0.28,
            width: 52, text: this.model,
            fontSize: 8, fontStyle: 'bold', fill: '#c0a040', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._bowlCx - 26, y: f.y + f.h * 0.52,
            width: 52, text: `${this.capacity} L/h`,
            fontSize: 7, fill: '#7a8a94', align: 'center',
        }));
    }

    // ── 电机 ──────────────────────────────────────────────────
    _drawMotor() {
        const m = this._motor;
        // 电机壳体
        this._staticGroup.add(new Konva.Rect({
            x: m.x, y: m.y, width: m.w, height: m.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: 0,   y: m.h },
            fillLinearGradientColorStops: [
                0, '#2c3e50', 0.5, '#3a5068', 1, '#2c3e50',
            ],
            stroke: '#4a6080', strokeWidth: 1, cornerRadius: 4,
        }));
        // 散热片（竖线纹）
        for (let i = 0; i < 6; i++) {
            const lx = m.x + m.w * (0.15 + i * 0.12);
            this._staticGroup.add(new Konva.Line({
                points: [lx, m.y + 3, lx, m.y + m.h - 3],
                stroke: 'rgba(80,120,160,0.35)', strokeWidth: 0.8,
            }));
        }
        // 电机标注
        this._staticGroup.add(new Konva.Text({
            x: m.x, y: m.y + m.h / 2 - 5,
            width: m.w, text: 'MOTOR',
            fontSize: 8, fill: '#6a9ab0', align: 'center',
        }));
        // 主轴（电机右侧连接到转鼓底部）
        const shaftY = m.y + m.h * 0.50;
        this._staticGroup.add(new Konva.Rect({
            x: m.x + m.w, y: shaftY - 5,
            width: this._bowl.x - (m.x + m.w) + this._bowl.w * 0.5, height: 10,
            fill: '#707078', stroke: '#505058', strokeWidth: 0.5,
        }));
    }

    // ── 转鼓外壳主体（静态底层）─────────────────────────────
    _drawBowlBody() {
        const b = this._bowl;

        // 外壳阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 5,
            width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: b.rx,
        }));
        // 外壳主体（不锈钢，冷灰渐变）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#3a3a40',
                0.18,'#5a5a62',
                0.40,'#6e6e78',
                0.60,'#62626a',
                0.82,'#525258',
                1,   '#3a3a40',
            ],
            stroke: '#6a6a74', strokeWidth: 1.5, cornerRadius: b.rx,
        }));
    }

    // ── 内部截面结构（碟片组 + 腔室标注）───────────────────
    _drawCrossSection() {
        const dz = this._discZone;
        const b  = this._bowl;

        // ── 内腔背景（暗色，油液区域）──
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 4, y: b.y + 4,
            width: b.w - 8, height: b.h - 8,
            fill: '#141418', cornerRadius: b.rx - 2,
        }));

        // ── 轻相腔（顶部，净油区，浅黄色）──
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 6, y: b.y + 5,
            width: b.w - 12, height: b.h * 0.14,
            fill: 'rgba(200,170,60,0.14)',
            cornerRadius: [b.rx - 3, b.rx - 3, 0, 0],
        }));

        // ── 重相腔（外侧环形区域，蓝色，水/重质杂质）──
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 5, y: dz.y - 4,
            width: dz.x - b.x - 9, height: dz.h + 8,
            fill: 'rgba(40,120,200,0.12)',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: dz.x + dz.w + 4, y: dz.y - 4,
            width: b.x + b.w - (dz.x + dz.w) - 9, height: dz.h + 8,
            fill: 'rgba(40,120,200,0.12)',
        }));

        // ── 渣腔（底部环形，深褐色）──
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 6, y: dz.y + dz.h + 4,
            width: b.w - 12, height: b.h - (dz.y - b.y) - dz.h - 12,
            fill: 'rgba(80,50,20,0.22)',
            cornerRadius: [0, 0, b.rx - 3, b.rx - 3],
        }));

        // ── 碟片组（V 形楔形叠层）──
        const discCount = 10;
        const dW = dz.w;
        const dH = dz.h / discCount;
        for (let i = 0; i < discCount; i++) {
            const dy = dz.y + i * dH;
            const inset = i * 0.5;   // 越往下碟片内径越大（近似）
            // 碟片（梯形截面，两侧斜边）
            const leftX  = dz.x + inset;
            const rightX = dz.x + dW - inset;
            const midX   = this._bowlCx;
            this._staticGroup.add(new Konva.Line({
                points: [
                    midX - dW * 0.10, dy,
                    leftX,            dy + dH * 0.75,
                    leftX,            dy + dH * 0.75,
                    midX - dW * 0.10, dy,
                ],
                stroke: 'rgba(120,130,160,0.55)', strokeWidth: 0.6,
                lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [
                    midX + dW * 0.10, dy,
                    rightX,           dy + dH * 0.75,
                ],
                stroke: 'rgba(120,130,160,0.55)', strokeWidth: 0.6,
                lineCap: 'round',
            }));
            // 碟片实体（浅色矩形条）
            this._staticGroup.add(new Konva.Rect({
                x: leftX, y: dy + dH * 0.78,
                width: dW - inset * 2, height: dH * 0.14,
                fill: 'rgba(140,148,170,0.40)',
            }));
        }

        // 碟片组中心轴孔（暗灰圆）
        this._staticGroup.add(new Konva.Rect({
            x: this._bowlCx - dW * 0.09,
            y: dz.y,
            width: dW * 0.18, height: dz.h,
            fill: '#0e0e14', stroke: '#2a2a34', strokeWidth: 0.5,
        }));

        // ── 界面盘（顶部，圆形轮廓）──
        const gdY = dz.y - b.h * 0.04;
        this._staticGroup.add(new Konva.Ellipse({
            x: this._bowlCx, y: gdY,
            radiusX: dz.w * 0.28, radiusY: b.h * 0.025,
            fill: '#2a2a32', stroke: '#5a5a6a', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._bowlCx - 18, y: gdY - 5,
            text: '界面盘', fontSize: 6, fill: '#6a7a84',
        }));

        // ── 分配板（碟片组底部）──
        const distY = dz.y + dz.h + 2;
        this._staticGroup.add(new Konva.Rect({
            x: dz.x + dW * 0.05, y: distY,
            width: dW * 0.90, height: b.h * 0.028,
            fill: '#303038', stroke: '#4a4a58', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._bowlCx - 16, y: distY + 2,
            text: '分配板', fontSize: 6, fill: '#6a7a84',
        }));

        // ── 活塞底盖区域（转鼓最底部）──
        const pistonY = b.y + b.h * 0.86;
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 8, y: pistonY,
            width: b.w - 16, height: b.h * 0.10,
            fill: 'rgba(40,60,100,0.20)',
            stroke: 'rgba(60,90,140,0.30)', strokeWidth: 0.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._bowlCx - 16, y: pistonY + 3,
            text: '活塞底盖', fontSize: 6, fill: '#5a6a80',
        }));

        // ── 腔室标注线 ──
        const notes = [
            { text: '轻相腔（净油）', x: b.x + b.w + 5, y: b.y + b.h * 0.06,  col: '#c8a040' },
            { text: '重相腔（水）',   x: b.x + b.w + 5, y: dz.y + dz.h * 0.32, col: '#4090d0' },
            { text: '碟片组',         x: b.x + b.w + 5, y: dz.y + dz.h * 0.50, col: '#8090a8' },
            { text: '渣腔',           x: b.x + b.w + 5, y: dz.y + dz.h + 12,   col: '#a07040' },
        ];
        notes.forEach(({ text, x, y, col }) => {
            this._staticGroup.add(new Konva.Line({
                points: [b.x + b.w - 2, y, x - 2, y],
                stroke: `${col}50`, strokeWidth: 0.6, dash: [2, 2],
            }));
            this._staticGroup.add(new Konva.Text({
                x, y: y - 5, text,
                fontSize: 6.5, fill: col,
            }));
        });
    }

    // ── 固定管路（连接端口到转鼓的短管段）───────────────────
    _drawPipework() {
        const lx  = this._leftPortX;
        const rx  = this._rightPortX;
        const bx0 = this._bowl.x;
        const bx1 = this._bowl.x + this._bowl.w;
        const pW  = 4;

        // 左侧进口管（4根）
        const leftPipes = [
            { y: this._portRegWaterY,  col: '#4090d0', label: '' },
            { y: this._portSealWaterY, col: '#3080c0', label: '' },
            { y: this._portOpenWaterY, col: '#60a0e0', label: '' },
            { y: this._portDirtyOilY,  col: '#c8a030', label: '' },
        ];
        leftPipes.forEach(({ y, col }) => {
            this._staticGroup.add(new Konva.Rect({
                x: lx, y: y - pW / 2,
                width: bx0 - lx, height: pW,
                fill: col, stroke: `${col}80`, strokeWidth: 0.5,
                opacity: 0.55,
            }));
        });

        // 右侧出口管（3根）
        const rightPipes = [
            { y: this._portCleanOilY, col: '#e0c040' },
            { y: this._portDrainY,    col: '#3090c0' },
            { y: this._portSludgeY,   col: '#8a5030' },
        ];
        rightPipes.forEach(({ y, col }) => {
            this._staticGroup.add(new Konva.Rect({
                x: bx1, y: y - pW / 2,
                width: rx - bx1, height: pW,
                fill: col, stroke: `${col}80`, strokeWidth: 0.5,
                opacity: 0.55,
            }));
        });
    }

    // ── 端口标注（端口旁小字）───────────────────────────────
    _drawPortLabels() {
        const lx = this._leftPortX - 58;
        const rx = this._rightPortX + 4;

        [
            { x: lx, y: this._portRegWaterY  - 5, text: '调节水进口', col: '#4090d0' },
            { x: lx, y: this._portSealWaterY - 5, text: '密封水进口', col: '#3080c0' },
            { x: lx, y: this._portOpenWaterY - 5, text: '开启水进口', col: '#60a0e0' },
            { x: lx, y: this._portDirtyOilY  - 5, text: '待分油进口', col: '#c8a030' },
            { x: rx, y: this._portCleanOilY  - 5, text: '净油出口',   col: '#e0c040' },
            { x: rx, y: this._portDrainY     - 5, text: '排水口',     col: '#3090c0' },
            { x: rx, y: this._portSludgeY    - 5, text: '排渣口',     col: '#8a5030' },
        ].forEach(({ x, y, text, col }) => {
            this._staticGroup.add(new Konva.Text({
                x, y, text, fontSize: 7, fontStyle: 'bold', fill: col,
            }));
        });
    }

    // ── 动态层①：转鼓旋转纹理 ───────────────────────────────
    _drawDrumLayer() {
        this._drumGroup = new Konva.Group();
        this._staticGroup.add(this._drumGroup);
        this._rebuildDrum();
    }

    _rebuildDrum() {
        this._drumGroup.destroyChildren();
        const rpmFrac = Math.max(0, Math.min(1, this._rpm / this.ratedRpm));
        if (rpmFrac < 0.01) return;

        const b  = this._bowl;
        const cx = this._bowlCx, cy = this._bowlCy;

        // 旋转速度感线（随转速增多）
        const lineCount = Math.round(rpmFrac * 10);
        for (let i = 0; i < lineCount; i++) {
            const ang  = (this._drumAngle + i * (360 / lineCount)) * Math.PI / 180;
            const r0   = b.w * 0.12;
            const r1   = b.w * 0.46;
            const alpha= rpmFrac * (0.15 + 0.15 * (i % 2));
            this._drumGroup.add(new Konva.Line({
                points: [
                    cx + r0 * Math.cos(ang), cy + r0 * Math.sin(ang),
                    cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang),
                ],
                stroke: `rgba(200,220,255,${alpha})`,
                strokeWidth: 0.7, lineCap: 'round',
            }));
        }

        // 转鼓外壁条纹（旋转感，模拟高速）
        if (rpmFrac > 0.50) {
            const streakAlpha = (rpmFrac - 0.50) / 0.50 * 0.20;
            this._drumGroup.add(new Konva.Rect({
                x: b.x + 3, y: b.y + 3,
                width: b.w - 6, height: b.h - 6,
                fillLinearGradientStartPoint: { x: 0,   y: 0 },
                fillLinearGradientEndPoint:   { x: b.w, y: 0 },
                fillLinearGradientColorStops: [
                    0,   `rgba(180,190,220,${streakAlpha})`,
                    0.3, `rgba(220,230,255,${streakAlpha * 0.5})`,
                    0.5, `rgba(100,110,140,0)`,
                    0.7, `rgba(220,230,255,${streakAlpha * 0.5})`,
                    1,   `rgba(180,190,220,${streakAlpha})`,
                ],
                cornerRadius: b.rx - 2,
            }));
        }
    }

    // ── 动态层②：流体粒子 + 排渣动画 ──────────────────────
    _drawFlowLayer() {
        this._flowGroup = new Konva.Group();
        this._staticGroup.add(this._flowGroup);
        this._rebuildFlow();
    }

    _rebuildFlow() {
        this._flowGroup.destroyChildren();
        const active = (this._state === 'purifying' || this._state === 'desludging' || this._state === 'sealing');

        if (!active) return;

        // ── 进油粒子（左侧 → 转鼓底部）──
        this._feedParticles.forEach(p => {
            this._flowGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: p.r,
                fill: `rgba(180,140,30,${p.alpha})`,
                shadowColor: 'rgba(200,160,40,0.6)', shadowBlur: 2, shadowOpacity: p.alpha,
            }));
        });

        // ── 净油粒子（转鼓顶 → 右侧净油出口）──
        this._oilParticles.forEach(p => {
            this._flowGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: p.r,
                fill: `rgba(220,185,40,${p.alpha})`,
                shadowColor: 'rgba(240,200,50,0.5)', shadowBlur: 2, shadowOpacity: p.alpha,
            }));
        });

        // ── 排水粒子（转鼓中部 → 右侧排水口）──
        this._waterParticles.forEach(p => {
            this._flowGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: p.r,
                fill: `rgba(60,140,220,${p.alpha})`,
                shadowColor: 'rgba(80,160,240,0.5)', shadowBlur: 2, shadowOpacity: p.alpha,
            }));
        });

        // ── 排渣粒子（排渣时从底盖喷出）──
        if (this._state === 'desludging') {
            this._sludgeParticles.forEach(p => {
                this._flowGroup.add(new Konva.Circle({
                    x: p.x, y: p.y, radius: p.r,
                    fill: `rgba(100,60,20,${p.alpha})`,
                    shadowColor: 'rgba(120,70,20,0.6)', shadowBlur: 3, shadowOpacity: p.alpha,
                }));
            });
            // 排渣冲击光晕（转鼓底盖开启处）
            const bowlBot = this._bowl.y + this._bowl.h;
            this._flowGroup.add(new Konva.Ellipse({
                x: this._bowlCx, y: bowlBot + 4,
                radiusX: this._bowl.w * 0.20,
                radiusY: this._bowl.h * 0.03,
                fill: 'rgba(140,80,20,0.30)',
                shadowColor: 'rgba(200,120,30,0.5)', shadowBlur: 8, shadowOpacity: 0.6,
            }));
        }

        // ── 渣位条（转鼓底部左侧竖向进度条）──
        if (this._state !== 'idle') {
            const barX = this._bowl.x + 6;
            const barH = this._bowl.h * 0.18;
            const barY = this._bowl.y + this._bowl.h * 0.74;
            this._flowGroup.add(new Konva.Rect({
                x: barX, y: barY, width: 6, height: barH,
                fill: '#1a1212', stroke: '#3a2a1a', strokeWidth: 0.5, cornerRadius: 1,
            }));
            this._flowGroup.add(new Konva.Rect({
                x: barX, y: barY + barH * (1 - this._sludgeLevel),
                width: 6, height: barH * this._sludgeLevel,
                fill: `rgba(${Math.round(100 + this._sludgeLevel * 80)},${Math.round(60 + this._sludgeLevel * 20)},20,0.80)`,
                cornerRadius: [0, 0, 1, 1],
            }));
        }

        // ── 水封指示（密封水区，蓝色薄层）──
        if (this._waterSeal) {
            const wsY = this._bowl.y + this._bowl.h * 0.84;
            this._flowGroup.add(new Konva.Rect({
                x: this._bowl.x + 7, y: wsY,
                width: this._bowl.w - 14, height: this._bowl.h * 0.04,
                fill: 'rgba(60,130,220,0.28)',
                stroke: 'rgba(80,160,240,0.40)', strokeWidth: 0.5,
            }));
        }
    }

    // ── 动态层③：状态信息窗口 ──────────────────────────────
    _drawWindowLayer() {
        this._windowGroup = new Konva.Group();
        this._staticGroup.add(this._windowGroup);
        this._rebuildWindow();
    }

    _rebuildWindow() {
        this._windowGroup.destroyChildren();
        const W = this.width;
        const wx = this._bowl.x + this._bowl.w * 0.08;
        const wy = this._bowl.y + this._bowl.h * 0.04;
        const ww = this._bowl.w * 0.50;
        const wh = this._bowl.h * 0.12;

        // 仪表窗背景
        this._windowGroup.add(new Konva.Rect({
            x: wx, y: wy, width: ww, height: wh,
            fill: '#05080e', stroke: '#1a2a3a', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 转速显示
        const rpmFrac = Math.min(1, this._rpm / this.ratedRpm);
        const rR = Math.round(60  + rpmFrac * 195);
        const rG = Math.round(180 - rpmFrac * 100);
        const rB = Math.round(220 - rpmFrac * 160);
        this._windowGroup.add(new Konva.Text({
            x: wx + 4, y: wy + 3,
            text: 'RPM', fontSize: 6, fill: '#4a8aa0', letterSpacing: 1,
        }));
        this._windowGroup.add(new Konva.Text({
            x: wx + 4, y: wy + 11,
            text: `${Math.round(this._rpm)}`,
            fontSize: 14, fontStyle: 'bold', fontFamily: 'monospace',
            fill: `rgb(${rR},${rG},${rB})`,
        }));

        // 转速进度条
        const barW = ww - 8;
        this._windowGroup.add(new Konva.Rect({
            x: wx + 4, y: wy + wh - 6, width: barW, height: 3,
            fill: '#0d1824', stroke: '#1a2a3a', strokeWidth: 0.5, cornerRadius: 1,
        }));
        this._windowGroup.add(new Konva.Rect({
            x: wx + 4, y: wy + wh - 6, width: barW * rpmFrac, height: 3,
            fill: `rgb(${rR},${rG},${rB})`, cornerRadius: 1,
        }));

        // 渣位显示
        const slX = wx + ww * 0.62;
        this._windowGroup.add(new Konva.Text({
            x: slX, y: wy + 3,
            text: '渣位', fontSize: 6, fill: '#6a5030',
        }));
        this._windowGroup.add(new Konva.Text({
            x: slX, y: wy + 11,
            text: `${Math.round(this._sludgeLevel * 100)}%`,
            fontSize: 11, fontStyle: 'bold', fontFamily: 'monospace',
            fill: this._sludgeLevel > 0.85 ? '#ef5350' : '#c07030',
        }));
    }

    // ── 转鼓前景（高光 + 轮廓，覆盖动态层）────────────────
    _drawBowlFront() {
        const b = this._bowl;

        // 顶部高光（不锈钢镜面）
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.rx * 0.6, y: b.y + b.h * 0.015,
            width: b.w - b.rx * 1.2, height: b.h * 0.06,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: b.rx * 0.5,
        }));
        // 左侧高光弧
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 3, y: b.y + b.h * 0.08,
            width: b.w * 0.06, height: b.h * 0.70,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: 2,
        }));
        // 轮廓线
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: 'transparent', stroke: '#6a6a74', strokeWidth: 1.5,
            cornerRadius: b.rx,
        }));
        // 顶盖横线（盖板接缝）
        this._staticGroup.add(new Konva.Line({
            points: [b.x + b.rx, b.y + b.h * 0.06, b.x + b.w - b.rx, b.y + b.h * 0.06],
            stroke: '#4a4a54', strokeWidth: 0.8,
        }));
        // 底盖横线（底盖接缝）
        const bowlBotSeam = b.y + b.h * 0.90;
        this._staticGroup.add(new Konva.Line({
            points: [b.x + b.rx, bowlBotSeam, b.x + b.w - b.rx, bowlBotSeam],
            stroke: '#4a4a54', strokeWidth: 0.8,
        }));
    }

    // ── 位号 + 规格标注 ─────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  ${this.model}  S 型离心分油机`,
            fontSize: 10, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -6, width: W,
            text: `${this.ratedRpm} rpm  /  ${this.capacity} L/h  /  ρ=${this.oilDensity} g/cm³`,
            fontSize: 7, fill: '#5a7a8a', align: 'center',
        }));
    }

    // ── 状态指示灯（机架左下角）─────────────────────────────
    _drawStatusIndicator() {
        const ix = this._frame.x + 10;
        const iy = this._frame.y + this._frame.h / 2;

        const info = this._stateInfo();
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4.5,
            fill: info.col, stroke: info.scol, strokeWidth: 0.8,
            shadowColor: info.col, shadowBlur: info.glow, shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix + 8, y: iy - 5,
            text: info.text, fontSize: 8, fontStyle: 'bold', fill: info.col,
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    _stateInfo() {
        const map = {
            idle:       { col: '#546e7a', scol: '#2e454f', text: '停机',   glow: 2 },
            starting:   { col: '#ffa726', scol: '#e65100', text: '启动中', glow: 6 },
            sealing:    { col: '#4fc3f7', scol: '#0277bd', text: '注水封', glow: 5 },
            purifying:  { col: '#66bb6a', scol: '#2e7d32', text: '净油中', glow: 7 },
            desludging: { col: '#ef5350', scol: '#c62828', text: '排渣中', glow: 9 },
            stopping:   { col: '#ff7043', scol: '#bf360c', text: '停机中', glow: 5 },
        };
        return map[this._state] || map.idle;
    }

    // ── 点击交互：状态步进 ───────────────────────────────────
    _bindInteraction() {
        this.group.on('click tap', (e) => {
            e.cancelBubble = true;
            this.stepState();
        });
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        let needRefresh = false;
        this._stateT += dt;

        // ── 转速模拟 ──
        const rpmTarget = (this._state === 'purifying' || this._state === 'sealing' || this._state === 'desludging')
            ? this.ratedRpm
            : (this._state === 'starting' ? this.ratedRpm * (this._stateT / this._stateDur.starting)
            : (this._state === 'stopping' ? this.ratedRpm * Math.max(0, 1 - this._stateT / this._stateDur.stopping)
            : 0));
        const rpmDiff = rpmTarget - this._rpm;
        this._rpm += rpmDiff * Math.min(1, dt * 3.5);

        // ── 转鼓视觉旋转角 ──
        this._drumAngle = (this._drumAngle + this._rpm * dt * 0.06) % 360;

        // ── 状态自动推进 ──
        switch (this._state) {
            case 'starting':
                if (this._stateT >= this._stateDur.starting) this._advanceState('sealing');
                break;
            case 'sealing':
                if (this._stateT >= this._stateDur.sealing) {
                    this._waterSeal = true;
                    this._advanceState('purifying');
                }
                break;
            case 'desludging':
                this._bowlOpen = true;
                if (this._stateT >= this._stateDur.desludging) {
                    this._bowlOpen    = false;
                    this._sludgeLevel = 0;
                    this._sludgeParticles = [];
                    this._advanceState('purifying');
                }
                break;
            case 'stopping':
                if (this._stateT >= this._stateDur.stopping) {
                    this._rpm        = 0;
                    this._waterSeal  = false;
                    this._advanceState('idle');
                }
                break;
            case 'purifying':
                // 渣位缓慢累积
                this._sludgeLevel = Math.min(1, this._sludgeLevel + dt * 0.0055);
                // 渣位超过 90% 自动触发排渣
                if (this._sludgeLevel >= 0.90) {
                    this._advanceState('desludging');
                }
                break;
        }

        // ── 粒子更新 ──
        const rpmFrac = Math.min(1, this._rpm / this.ratedRpm);
        if (rpmFrac > 0.3) {
            this._pTimer += dt;
            const spawnInt = 0.06 + (1 - rpmFrac) * 0.08;
            if (this._pTimer > spawnInt) {
                this._pTimer = 0;
                this._spawnParticles(rpmFrac);
            }
        } else {
            this._oilParticles = [];
            this._waterParticles = [];
            this._feedParticles = [];
        }

        // 排渣粒子
        if (this._state === 'desludging' && this._bowlOpen) {
            this._spawnSludgeParticles();
        }

        // 粒子物理更新
        this._oilParticles = this._oilParticles.filter(p => {
            p.x += p.vx * dt; p.y += p.vy * dt; p.alpha -= dt * 1.4;
            return p.alpha > 0 && p.x < this._rightPortX + 10;
        });
        this._waterParticles = this._waterParticles.filter(p => {
            p.x += p.vx * dt; p.y += p.vy * dt; p.alpha -= dt * 1.4;
            return p.alpha > 0 && p.x < this._rightPortX + 10;
        });
        this._feedParticles = this._feedParticles.filter(p => {
            p.x += p.vx * dt; p.y += p.vy * dt; p.alpha -= dt * 1.2;
            return p.alpha > 0 && p.y < this._bowl.y + this._bowl.h;
        });
        this._sludgeParticles = this._sludgeParticles.filter(p => {
            p.x += p.vx * dt; p.y += p.vy * dt;
            p.vy += 60 * dt;  // 重力
            p.alpha -= dt * 1.8;
            return p.alpha > 0 && p.y < this._frame.y + this._frame.h;
        });

        needRefresh = true;

        if (needRefresh) {
            this._rebuildDrum();
            this._rebuildFlow();
            this._rebuildWindow();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _spawnParticles(rpmFrac) {
        const purifying = (this._state === 'purifying' || this._state === 'desludging');
        if (!purifying) return;

        // 净油粒子（转鼓顶部轴线→净油出口）
        this._oilParticles.push({
            x: this._bowlCx + (Math.random() - 0.5) * 8,
            y: this._portCleanOilY + (Math.random() - 0.5) * 4,
            vx: 35 + Math.random() * 20, vy: (Math.random() - 0.5) * 6,
            r: 1.5 + Math.random() * 1.5, alpha: 0.7 + Math.random() * 0.3,
        });
        // 排水粒子（转鼓中部→排水口）
        this._waterParticles.push({
            x: this._bowlCx + this._bowl.w * 0.30 + (Math.random() - 0.5) * 6,
            y: this._portDrainY + (Math.random() - 0.5) * 4,
            vx: 28 + Math.random() * 16, vy: (Math.random() - 0.5) * 5,
            r: 1.5 + Math.random() * 1.0, alpha: 0.6 + Math.random() * 0.4,
        });
        // 进油粒子（进口→转鼓底部）
        this._feedParticles.push({
            x: this._leftPortX + (Math.random() - 0.5) * 4,
            y: this._portDirtyOilY + (Math.random() - 0.5) * 4,
            vx: 22 + Math.random() * 14, vy: (Math.random() - 0.5) * 5,
            r: 1.5 + Math.random() * 1.5, alpha: 0.6 + Math.random() * 0.4,
        });
    }

    _spawnSludgeParticles() {
        const bowlBotY = this._bowl.y + this._bowl.h;
        for (let i = 0; i < 2; i++) {
            this._sludgeParticles.push({
                x: this._bowlCx + (Math.random() - 0.5) * this._bowl.w * 0.35,
                y: bowlBotY,
                vx: (Math.random() - 0.5) * 50,
                vy: 20 + Math.random() * 30,
                r:  1.5 + Math.random() * 2.5,
                alpha: 0.8 + Math.random() * 0.2,
            });
        }
    }

    _advanceState(next) {
        this._state  = next;
        this._stateT = 0;
    }

    _updateStatus() {
        const info = this._stateInfo();
        if (this._statusDot) {
            this._statusDot.fill(info.col);
            this._statusDot.stroke(info.scol);
            this._statusDot.shadowColor(info.col);
            this._statusDot.shadowBlur(info.glow);
        }
        if (this._statusText) {
            this._statusText.text(info.text);
            this._statusText.fill(info.col);
        }
    }

    // ═══════════════════════════════════════════
    /**
     * 点击步进状态
     * 循环：idle → starting → (自动→sealing→purifying) → desludging → purifying
     */
    stepState() {
        if (this._animating) return;
        switch (this._state) {
            case 'idle':       this.start();     break;
            case 'purifying':  this.desludge();  break;
            case 'desludging': break;            // 自动完成
            default:           break;
        }
    }

    /** 启动分油机（idle → starting） */
    start() {
        if (this._state !== 'idle') return;
        this._advanceState('starting');
        this.opsCount++;
        this._refreshCache();
    }

    /** 手动触发排渣（purifying → desludging） */
    desludge() {
        if (this._state !== 'purifying') return;
        this._advanceState('desludging');
        this.opsCount++;
        this._refreshCache();
    }

    /** 停机（任意工作状态 → stopping → idle） */
    stop() {
        if (this._state === 'idle' || this._state === 'stopping') return;
        this._advanceState('stopping');
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询当前状态 */
    getState()        { return this._state; }
    getRpm()          { return Math.round(this._rpm); }
    getSludgeLevel()  { return this._sludgeLevel; }
    hasWaterSeal()    { return this._waterSeal; }
    isAnimating()     { return this._state !== 'idle'; }
    getOpsCount()     { return this.opsCount; }

    update(state) {
        if (state === 'start')    this.start();
        else if (state === 'stop')     this.stop();
        else if (state === 'desludge') this.desludge();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',      type: 'text'   },
            { label: '型号',              key: 'model',      type: 'text'   },
            { label: '额定转速 (rpm)',    key: 'ratedRpm',   type: 'number' },
            { label: '处理量 (L/h)',      key: 'capacity',   type: 'number' },
            { label: '油品密度 (g/cm³)',  key: 'oilDensity', type: 'number' },
            { label: '初始渣位 (0~1)',    key: 'initSludge', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label      !== undefined) this.label      = cfg.label;
        if (cfg.model      !== undefined) this.model      = cfg.model;
        if (cfg.ratedRpm   !== undefined) this.ratedRpm   = parseFloat(cfg.ratedRpm)   || this.ratedRpm;
        if (cfg.capacity   !== undefined) this.capacity   = parseFloat(cfg.capacity)   || this.capacity;
        if (cfg.oilDensity !== undefined) this.oilDensity = parseFloat(cfg.oilDensity) || this.oilDensity;
        if (cfg.initSludge !== undefined) {
            const s = parseFloat(cfg.initSludge);
            if (!isNaN(s)) this._sludgeLevel = Math.max(0, Math.min(1, s));
        }
        this.config = { ...this.config, ...cfg };
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}