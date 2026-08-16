import { BaseComponent } from './BaseComponent.js';

/**
 * 兆欧表（Megohmmeter / Insulation Resistance Tester）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  兆欧表由以下三大部分组成：
 *
 *  1. 手摇直流发电机（Hand-Cranked DC Generator）
 *     - 手柄（Crank Handle）：用户拖拽旋转，驱动发电
 *     - 转子（Rotor）：旋转产生电压 E
 *     - 额定转速约 120 r/min → E ≈ 500V / 1000V / 2500V（量程）
 *
 *  2. 磁电式流比计（Ratio Meter / Logometer）— 核心测量元件
 *     - 永久磁铁：U 形蹄形磁铁，极靴形状特殊，使气隙中磁场 **不均匀**
 *       （越靠近 ∞ 端磁场越强，越靠近 0 端磁场越弱）
 *     - 铁芯：圆柱固定铁芯，进一步塑造不均匀磁场分布
 *     - 线圈1（电流线圈，Current Coil）：串联在电流回路中
 *       · 回路：E⁺ → Rx（被测绝缘电阻）→ RA（限流）→ 线圈1 → E⁻
 *       · 产生转动力矩 T1 = B1(α)·I1·k，使指针向低阻侧（右/0Ω）偏转
 *     - 线圈2（电压线圈，Voltage Coil）：串联在电压回路中
 *       · 回路：E⁺ → RV（限流）→ 线圈2 → E⁻
 *       · 产生反作用力矩 T2 = B2(α)·I2·k，使指针向高阻侧（左/∞）偏转
 *     - 两线圈绕向相反，互成约 60° 固定夹角，随可动部分一同转动
 *     - 平衡条件：T1(α,I1) = T2(α,I2)
 *       即 B1(α)·I1 = B2(α)·I2
 *       由于 I1 ∝ 1/Rx，解方程得 α = f(I1/I2) = f(1/Rx)
 *
 *  3. 接线柱（Terminals）
 *     - L（Line / 线路端）：接被测电阻的一端
 *     - E（Earth / 接地端）：接被测电阻的另一端（通常接外壳或地）
 *     - G（Guard / 屏蔽端，可选）：用于消除表面漏电影响
 *
 * ── 不均匀磁场模型 ──────────────────────────────────────────
 *
 *  B1(α) ∝ sin(α + δ1)   -- 线圈1 所在位置的有效磁感应强度
 *  B2(α) ∝ sin(α + δ2)   -- 线圈2 所在位置的有效磁感应强度
 *
 *  其中 δ1、δ2 由极靴几何形状决定，本模型取：
 *    δ1 = 30°（线圈1偏置角）
 *    δ2 = 90°（线圈2偏置角）
 *    线圈夹角 φ = 60°
 *
 *  平衡时：B1(α)·I1 = B2(α)·I2
 *    → sin(α+30°)·I1 = sin(α+90°)·I2
 *    → α = arctan[ (I2·cos30° − I1·cos90°) / (I1·sin30° − I2·sin90°) ]（近似）
 *  实际采用数值迭代求解平衡角。
 *
 * ── 刻度特性 ────────────────────────────────────────────────
 *
 *  指针满偏向右（α_max）= Rx → 0 Ω（短路）
 *  指针满偏向左（α_min）= Rx → ∞ Ω（断路/超量程）
 *  刻度非线性（对数特性），数字从右到左增大：0, 1, 2, 5, 10, 50, 100, ∞
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  1. 摇动手柄（_crankAngle 增大）→ 发电机转速 > 0 → 输出电压 E
 *  2. E 驱动两个回路，I1 = E/(Rx+RA)，I2 = E/RV
 *  3. 两线圈受安培力，合力矩驱动可动部分转动
 *  4. 物理模型：转矩差 ΔT(α) = T1(α)−T2(α) 驱动转动，加阻尼
 *  5. 平衡后指针稳定在 α，对应刻度盘上的 Rx 读数
 *  6. 停止摇动 → E→0 → I1,I2→0 → 两转矩均消失 → 指针停在当前位置（无回零弹簧）
 *     注：流比计无回零弹簧，断电后指针保持最后位置（区别于普通电流表）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l — L 端（线路端，接被测绝缘电阻一端）
 *  terminal_e — E 端（接地端，接被测绝缘电阻另一端）
 *  terminal_g — G 端（屏蔽端，可选）
 *
 * ── 交互 ─────────────────────────────────────────────────────
 *  拖拽手柄 → 摇动发电机
 *  点击/拖拽 Rx 滑块 → 改变被测绝缘电阻
 */
export class Megohmmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 400);
        this.height = Math.max(280, config.height || 360);

        this.type    = 'megohmmeter';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.label       = config.label       || 'MΩ';
        this.ratedVoltage= config.ratedVoltage|| 500;      // V（发电机额定电压）
        this.maxRx       = config.maxRx       || 2000;     // MΩ（量程上限）
        this.RA          = config.RA          || 2500;     // Ω（电流回路限流电阻）
        this.RV          = config.RV          || 5000;     // Ω（电压回路限流电阻）

        // 不均匀磁场偏置角（决定刻度形状）
        this._delta1     = (config.delta1Deg  || 30)  * Math.PI / 180;  // 线圈1 磁场偏置
        this._delta2     = (config.delta2Deg  || 90)  * Math.PI / 180;  // 线圈2 磁场偏置
        this._coilAngle  = (config.coilAngleDeg || 60) * Math.PI / 180; // 两线圈夹角

        // ── 状态 ──
        this._crankAngle  = 0;          // 手柄累计旋转角（rad），用于驱动发电
        this._crankSpeed  = 0;          // 手柄角速度（rad/s）
        this._crankTarget = 0;          // 目标转速（用户拖拽时更新）
        this._genVoltage  = 0;          // 发电机当前输出电压（V）

        this._Rx          = config.initRx || 500;   // MΩ，被测绝缘电阻
        this._targetRx    = this._Rx;

        this._pointerAngle= 0;          // 指针偏转角（rad），正 = 右偏（低阻）
        this._angularVel  = 0;          // 指针角速度

        this._maxAngle    = 75 * Math.PI / 180;   // 最大偏转角
        this._minAngle    = -75 * Math.PI / 180;  // 最小偏转角（∞侧）

        // 物理参数
        this._inertia     = config.inertia  || 1.5;
        this._damping     = config.damping  || 1.8;   // 流比计阻尼较大

        // 手柄拖拽状态
        this._dragging    = false;
        this._lastDragAngle = 0;
        this._autoSpin    = false;       // 自动匀速摇动模式

        // 动画
        this._animating   = true;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        this._cx = W * 0.52;           // 流比计中心 x
        this._cy = H * 0.48;           // 流比计中心 y

        // 发电机区域（左侧）
        this._genX  = W * 0.08;
        this._genY  = H * 0.38;
        this._genW  = W * 0.20;
        this._genH  = H * 0.28;

        // 手柄
        this._crankCX = this._genX + this._genW / 2;
        this._crankCY = this._genY + this._genH * 0.35;
        this._crankR  = W * 0.050;     // 手柄旋转半径

        // 流比计磁铁
        this._magnetW = W * 0.14;
        this._magnetH = H * 0.46;
        this._gapHalf = W * 0.18;

        // 铁芯
        this._ironR   = W * 0.10;

        // 两线圈尺寸
        this._coilW   = W * 0.06;
        this._coilH   = H * 0.17;

        // 指针
        this._pointerLen = H * 0.33;

        // 刻度弧
        this._scaleR  = H * 0.38;

        // 底座
        this._base = { x: W*0.03, y: H*0.88, w: W*0.94, h: H*0.09, rx: 4 };

        // 端子位置
        this._termLx = W * 0.60;
        this._termEx = W * 0.74;
        this._termGx = W * 0.88;
        this._termY  = this._base.y + this._base.h + 4;

        this._init();
        this._bindInteraction();

        this.addPort(this._termLx, this._termY, 'terminal_l', 'wire', 'L');
        this.addPort(this._termEx, this._termY, 'terminal_e', 'wire', 'E');
        this.addPort(this._termGx, this._termY, 'terminal_g', 'wire', 'G');
    }

    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawBase();
        this._drawCasing();
        this._drawScaleArc();
        this._drawMagnets();
        this._drawIronCore();
        this._drawCircuitDiagram();
        this._drawStaticLabels();
        this._drawStatusBar();

        // 动态层
        this._rebuildDynamic();
    }

    // ── 底座 ─────────────────────────────────────────────────
    _drawBase() {
        const W = this.width, H = this.height;
        const b = this._base;

        // 外壳
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.93,
            fill: '#1c1c20', stroke: '#2e2e34', strokeWidth: 1.5, cornerRadius: 8,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 4, shadowOpacity: 0.4,
        }));
        // 表面（刻度区背景）
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.03, y: H * 0.03,
            width: W * 0.94, height: H * 0.80,
            fill: '#f2f0e8', stroke: '#c0bc9e', strokeWidth: 0.8, cornerRadius: 5,
        }));
        // 底座
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#28282e', stroke: '#383840', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        [0.15, 0.50, 0.85].forEach(fx => {
            const sx = b.x + b.w * fx, sy = b.y + b.h / 2, sr = this.width * 0.018;
            this._staticGroup.add(new Konva.Circle({ x: sx, y: sy, radius: sr, fill: '#888', stroke: '#555', strokeWidth: 0.7 }));
            this._staticGroup.add(new Konva.Line({ points: [sx-sr*0.6, sy, sx+sr*0.6, sy], stroke: '#444', strokeWidth: 1, lineCap: 'round' }));
            this._staticGroup.add(new Konva.Line({ points: [sx, sy-sr*0.6, sx, sy+sr*0.6], stroke: '#444', strokeWidth: 1, lineCap: 'round' }));
        });
    }

    // ── 仪表外壳细节 ────────────────────────────────────────
    _drawCasing() {
        const W = this.width, H = this.height;
        // 发电机区域外框
        this._staticGroup.add(new Konva.Rect({
            x: this._genX - 4, y: this._genY - 4,
            width: this._genW + 8, height: this._genH + 8,
            fill: '#2a2a30', stroke: '#404048', strokeWidth: 1, cornerRadius: 5,
        }));
        // 分隔线
        this._staticGroup.add(new Konva.Line({
            points: [W * 0.30, H * 0.06, W * 0.30, H * 0.83],
            stroke: '#c0bc9e', strokeWidth: 0.8, dash: [4, 3],
        }));
        // 发电机铭牌
        this._staticGroup.add(new Konva.Text({
            x: this._genX, y: this._genY - 16, width: this._genW,
            text: '手摇发电机', fontSize: 8, fill: '#888', align: 'center',
        }));
    }

    // ── 刻度盘（非线性，对数特性）──────────────────────────
    _drawScaleArc() {
        const cx = this._cx, cy = this._cy;
        const R  = this._scaleR;

        // 弧形背景
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R - 10, outerRadius: R + 10,
            angle: 150, rotation: -165,
            fill: '#e8e4d8',
        }));

        // 刻度值（MΩ），非线性映射到角度
        // 角度范围：-75°（∞侧左） ~ +75°（0Ω侧右）→ 映射到刻度
        const scalePoints = [
            { rx: Infinity, label: '∞',   deg: -75 },
            { rx: 2000,     label: '2000', deg: -65 },
            { rx: 1000,     label: '1000', deg: -55 },
            { rx: 500,      label: '500',  deg: -42 },
            { rx: 200,      label: '200',  deg: -28 },
            { rx: 100,      label: '100',  deg: -14 },
            { rx: 50,       label: '50',   deg:   0 },
            { rx: 20,       label: '20',   deg:  16 },
            { rx: 10,       label: '10',   deg:  30 },
            { rx: 5,        label: '5',    deg:  44 },
            { rx: 2,        label: '2',    deg:  57 },
            { rx: 1,        label: '1',    deg:  65 },
            { rx: 0,        label: '0',    deg:  75 },
        ];

        // 存储映射表供物理计算用
        this._scaleMap = scalePoints;

        const scaleGroup = new Konva.Group();
        scalePoints.forEach(({ label, deg }, i) => {
            const isMajor = ['∞','1000','100','10','1','0'].includes(label);
            const tLen    = isMajor ? 13 : 7;
            const rad     = (deg - 90) * Math.PI / 180;
            const x1 = cx + R * Math.cos(rad);
            const y1 = cy + R * Math.sin(rad);
            const x2 = cx + (R + tLen) * Math.cos(rad);
            const y2 = cy + (R + tLen) * Math.sin(rad);

            scaleGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: isMajor ? '#333' : '#888',
                strokeWidth: isMajor ? 1.5 : 0.8,
            }));

            if (isMajor) {
                const lx = cx + (R + 24) * Math.cos(rad);
                const ly = cy + (R + 24) * Math.sin(rad);
                scaleGroup.add(new Konva.Text({
                    x: lx - 16, y: ly - 8, width: 32, height: 16,
                    text: label, fontSize: 8, fontStyle: 'bold',
                    fill: '#333', align: 'center', verticalAlign: 'middle',
                }));
            }
        });

        // 刻度单位
        scaleGroup.add(new Konva.Text({
            x: cx - 20, y: cy - R - 38, width: 40,
            text: 'MΩ', fontSize: 9, fontStyle: 'bold', fill: '#555', align: 'center',
        }));
        // 红色∞标线
        const infRad = (-75 - 90) * Math.PI / 180;
        scaleGroup.add(new Konva.Line({
            points: [cx+(R-8)*Math.cos(infRad), cy+(R-8)*Math.sin(infRad),
                     cx+(R+14)*Math.cos(infRad), cy+(R+14)*Math.sin(infRad)],
            stroke: '#cc3030', strokeWidth: 2,
        }));

        this._staticGroup.add(scaleGroup);
    }

    // ── 永久磁铁（不均匀磁场，极靴特殊形状）────────────────
    _drawMagnets() {
        const cx = this._cx, cy = this._cy;
        const mw = this._magnetW, mh = this._magnetH;
        const gp = this._gapHalf;

        this._drawMagnetBlock(cx - gp - mw, cy - mh/2, mw, mh, 'N', true);
        this._drawMagnetBlock(cx + gp,      cy - mh/2, mw, mh, 'S', false);
        this._drawUnevenFieldLines();
    }

    _drawMagnetBlock(x, y, w, h, label, isN) {
        const c0 = isN ? ['#7a2828','#c03838','#e05858','#b03838','#7a2828']
                       : ['#283068','#3858b8','#5878d8','#3858a8','#283068'];
        const stroke = isN ? '#801818' : '#182068';

        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:w, y:0 },
            fillLinearGradientColorStops: [0,c0[0], 0.25,c0[1], 0.55,c0[2], 0.80,c0[3], 1,c0[4]],
            stroke, strokeWidth: 1.2, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x, y: y+h/2-10, width: w,
            text: label, fontSize: 16, fontStyle: 'bold', fill: '#fff',
            align: 'center',
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.5,
        }));

        // 极靴（不均匀形状：偏心弧形，使气隙不均匀）
        // 极靴上半部分较厚（气隙窄，磁场强）→ 对应 ∞ 侧
        // 极靴下半部分较薄（气隙宽，磁场弱）→ 对应 0 侧
        const poleX  = isN ? x + w - 2 : x - 14;
        const poleW  = 14;
        // 上厚极靴
        this._staticGroup.add(new Konva.Rect({
            x: poleX, y: y,
            width: poleW, height: h * 0.32,
            fill: isN ? '#b82828' : '#2840a8',
            stroke, strokeWidth: 0.6,
            cornerRadius: isN ? [0,4,4,0] : [4,0,0,4],
        }));
        // 下薄极靴
        this._staticGroup.add(new Konva.Rect({
            x: poleX + (isN ? 3 : 0), y: y + h * 0.68,
            width: poleW - 3, height: h * 0.32,
            fill: isN ? '#b82828' : '#2840a8',
            stroke, strokeWidth: 0.6,
            cornerRadius: isN ? [0,4,4,0] : [4,0,0,4],
        }));

        this._staticGroup.add(new Konva.Text({
            x: x - 2, y: y + h + 5, width: w + 4,
            text: isN ? 'N极' : 'S极',
            fontSize: 7, fill: isN ? '#c03838' : '#3858b8', align: 'center',
        }));
    }

    // 不均匀磁场线（密度从上到下递减，体现不均匀分布）
    _drawUnevenFieldLines() {
        const cx = this._cx, cy = this._cy;
        const gp = this._gapHalf;
        const mw = this._magnetW;
        const mh = this._magnetH;

        // 上部（∞侧）：磁场密（线多）
        const linesTop = 5;
        for (let i = 0; i < linesTop; i++) {
            const t  = i / (linesTop - 1);
            const ay = cy - mh * 0.22 + t * mh * 0.20;
            const alpha = 0.30 - t * 0.10;
            this._staticGroup.add(new Konva.Line({
                points: [cx-gp, ay, cx+gp, ay],
                stroke: `rgba(160,50,110,${alpha})`, strokeWidth: 1.2,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [cx+gp-8, ay-4, cx+gp, ay, cx+gp-8, ay+4],
                stroke: `rgba(160,50,110,${alpha})`, strokeWidth: 1.2,
                lineCap: 'round', lineJoin: 'round',
            }));
        }
        // 下部（0Ω侧）：磁场稀（线少，虚线）
        const linesBot = 3;
        for (let i = 0; i < linesBot; i++) {
            const t  = i / (linesBot - 1);
            const ay = cy + mh * 0.05 + t * mh * 0.22;
            this._staticGroup.add(new Konva.Line({
                points: [cx-gp, ay, cx+gp, ay],
                stroke: 'rgba(160,50,110,0.14)', strokeWidth: 0.9, dash: [4,4],
            }));
        }

        // 不均匀标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 26, y: cy - mh/2 - 12, width: 52,
            text: '↑密(强)', fontSize: 7, fill: 'rgba(150,40,100,0.55)', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 26, y: cy + mh/2 + 2, width: 52,
            text: '↓稀(弱)', fontSize: 7, fill: 'rgba(150,40,100,0.35)', align: 'center',
        }));
    }

    // ── 铁芯 ─────────────────────────────────────────────────
    _drawIronCore() {
        const cx = this._cx, cy = this._cy;
        const r  = this._ironR;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: -r*0.25, y: -r*0.25 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.12,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, '#d0d0d0', 0.6, '#909090', 1, '#484848'],
            stroke: '#606060', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - r*0.26, y: cy - r*0.26,
            radiusX: r*0.20, radiusY: r*0.13,
            fill: 'rgba(255,255,255,0.18)', rotation: -30,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 14, y: cy + r + 5, width: 28,
            text: '铁芯', fontSize: 7, fill: '#888', align: 'center',
        }));
    }

    // ── 电路原理图（小图，右下角）──────────────────────────
    _drawCircuitDiagram() {
        const W = this.width, H = this.height;
        const ox = W * 0.58, oy = H * 0.72;  // 原点
        const sw = W * 0.36, sh = H * 0.14;

        // 背景框
        this._staticGroup.add(new Konva.Rect({
            x: ox - 4, y: oy - 4, width: sw + 8, height: sh + 8,
            fill: 'rgba(0,0,0,0.05)', stroke: '#b0ac94', strokeWidth: 0.6, cornerRadius: 3,
        }));

        // 上方：电流回路（E+ → Rx → RA → 线圈1 → E-）
        const y1 = oy + sh * 0.20;
        this._staticGroup.add(new Konva.Line({ points:[ox, y1, ox+sw, y1], stroke:'#b03030', strokeWidth:1.0 }));
        // Rx 符号
        const rxX = ox + sw * 0.18;
        this._drawResistorSymbol(rxX, y1, 'Rx', '#b03030', true);
        // RA 符号
        const raX = ox + sw * 0.52;
        this._drawResistorSymbol(raX, y1, 'RA', '#b03030', false);
        // 线圈1符号
        this._staticGroup.add(new Konva.Circle({ x: ox+sw*0.82, y: y1, radius: 5, stroke:'#b03030', strokeWidth:1, fill:'none' }));
        this._staticGroup.add(new Konva.Text({ x: ox+sw*0.82-5, y: y1+6, text:'1', fontSize:7, fill:'#b03030' }));

        // 下方：电压回路（E+ → RV → 线圈2 → E-）
        const y2 = oy + sh * 0.75;
        this._staticGroup.add(new Konva.Line({ points:[ox, y2, ox+sw, y2], stroke:'#3050b0', strokeWidth:1.0 }));
        const rvX = ox + sw * 0.35;
        this._drawResistorSymbol(rvX, y2, 'RV', '#3050b0', false);
        this._staticGroup.add(new Konva.Circle({ x: ox+sw*0.82, y: y2, radius: 5, stroke:'#3050b0', strokeWidth:1, fill:'none' }));
        this._staticGroup.add(new Konva.Text({ x: ox+sw*0.82-5, y: y2+6, text:'2', fontSize:7, fill:'#3050b0' }));

        // 左侧连线（电源）
        this._staticGroup.add(new Konva.Line({ points:[ox, y1, ox, y2], stroke:'#888', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x: ox-14, y: (y1+y2)/2-5, text:'E', fontSize:7, fontStyle:'bold', fill:'#666' }));
        // 右侧连线
        this._staticGroup.add(new Konva.Line({ points:[ox+sw, y1, ox+sw, y2], stroke:'#888', strokeWidth:0.8 }));
    }

    _drawResistorSymbol(x, y, label, color, isRx) {
        const rw = isRx ? 16 : 12, rh = 6;
        this._staticGroup.add(new Konva.Rect({
            x: x - rw/2, y: y - rh/2, width: rw, height: rh,
            fill: 'none', stroke: color, strokeWidth: 0.9, cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: x - 8, y: y - rh/2 - 9, width: 16,
            text: label, fontSize: 7, fill: color, align: 'center',
        }));
    }

    // ── 静态标注 ─────────────────────────────────────────────
    _drawStaticLabels() {
        const W = this.width;

        // 位号
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  绝缘电阻表  ${this.ratedVoltage}V`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 端子标注（L/E/G）
        [
            { x: this._termLx, label: 'L', color: '#ef9a9a' },
            { x: this._termEx, label: 'E', color: '#90caf9' },
            { x: this._termGx, label: 'G', color: '#a5d6a7' },
        ].forEach(({ x, label, color }) => {
            this._staticGroup.add(new Konva.Text({
                x: x - 6, y: this._termY - 2,
                text: label, fontSize: 9, fontStyle: 'bold', fill: color,
            }));
            this._staticGroup.add(new Konva.Rect({
                x: x - 8, y: this._termY + 8,
                width: 16, height: 10,
                fill: '#2a2a2e', stroke: color, strokeWidth: 1.2, cornerRadius: 2,
            }));
        });

        // 电路原理图标题
        this._staticGroup.add(new Konva.Text({
            x: this.width * 0.58, y: this._cy + this._magnetH / 2 + 12,
            text: '电路原理', fontSize: 7, fill: '#888',
        }));
    }

    // ── 状态栏 ───────────────────────────────────────────────
    _drawStatusBar() {
        const b = this._base;
        this._statusRxText = new Konva.Text({
            x: b.x + 24, y: b.y + b.h/2 - 5, width: 80,
            text: 'Rx: ---', fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        });
        this._statusVText = new Konva.Text({
            x: b.x + 110, y: b.y + b.h/2 - 5, width: 80,
            text: 'E: 0V', fontSize: 8, fontStyle: 'bold', fill: '#a5d6a7',
        });
        this._statusDot = new Konva.Circle({
            x: b.x + 10, y: b.y + b.h/2, radius: 4,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.6,
        });
        this._staticGroup.add(this._statusDot, this._statusRxText, this._statusVText);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态层（发电机 + 手柄 + 两线圈 + 安培力 + 指针 + 连线）
    // ═══════════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawGenerator();
        this._drawCrank();
        this._drawCoils();
        this._drawForceArrows();
        this._drawPointer();
        this._drawRxConnection();
    }

    // ── 手摇发电机 ───────────────────────────────────────────
    _drawGenerator() {
        const gx = this._genX, gy = this._genY;
        const gw = this._genW, gh = this._genH;
        const cx = gx + gw / 2, cy = gy + gh * 0.35;

        // 发电机本体（圆形截面）
        const genR = Math.min(gw, gh * 0.7) * 0.42;
        const glow = Math.min(1, this._genVoltage / this.ratedVoltage);

        // 定子外环
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: genR + 4,
            fill: '#383840', stroke: '#484850', strokeWidth: 1.2,
        }));
        // 转子（旋转，颜色随电压变化）
        const rotG = new Konva.Group({ x: cx, y: cy, rotation: this._crankAngle * 180 / Math.PI });
        // 转子线圈绕组（十字形）
        for (let i = 0; i < 4; i++) {
            const ra = i * Math.PI / 2;
            rotG.add(new Konva.Rect({
                x: -genR * 0.55,
                y: -genR * 0.12,
                width: genR * 1.10,
                height: genR * 0.24,
                fill: glow > 0.1 ? `rgba(200,160,40,${0.4 + glow * 0.5})` : '#5a5040',
                rotation: ra * 180 / Math.PI,
                offsetX: 0, offsetY: 0,
            }));
        }
        // 转子轴
        rotG.add(new Konva.Circle({ x: 0, y: 0, radius: genR * 0.18, fill: '#aaa', stroke: '#888', strokeWidth: 0.8 }));
        this._dynamicGroup.add(rotG);

        // 电刷（两侧，静止）
        [-1, 1].forEach(side => {
            this._dynamicGroup.add(new Konva.Rect({
                x: cx + side * (genR + 1) - 2, y: cy - 4,
                width: 4, height: 8,
                fill: '#888', stroke: '#666', strokeWidth: 0.6, cornerRadius: 1,
            }));
        });

        // 发电机外框（透明玻璃效果）
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: genR + 4,
            fill: 'none', stroke: '#606068', strokeWidth: 1,
        }));

        // 电压发光圆环
        if (glow > 0.05) {
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: genR + 6,
                fill: 'none',
                stroke: `rgba(120,200,120,${glow * 0.5})`,
                strokeWidth: 3,
            }));
        }

        // 输出导线（发电机 → 流比计）
        const wireAlpha = Math.min(0.9, glow * 1.2);
        if (wireAlpha > 0.02) {
            this._dynamicGroup.add(new Konva.Line({
                points: [cx + genR + 4, cy - 4, this._cx - this._gapHalf - this._magnetW, this._cy - 20],
                stroke: `rgba(200,80,80,${wireAlpha})`, strokeWidth: 1.5,
                lineCap: 'round', tension: 0.4,
            }));
            this._dynamicGroup.add(new Konva.Line({
                points: [cx + genR + 4, cy + 4, this._cx - this._gapHalf - this._magnetW, this._cy + 20],
                stroke: `rgba(80,120,200,${wireAlpha})`, strokeWidth: 1.5,
                lineCap: 'round', tension: 0.4,
            }));
        }
    }

    // ── 手柄（可拖拽）───────────────────────────────────────
    _drawCrank() {
        const gx = this._genX, gy = this._genY;
        const gw = this._genW, gh = this._genH;
        const cx = gx + gw / 2, cy = gy + gh * 0.35;
        const R  = this._crankR;
        const a  = this._crankAngle;

        // 手柄臂
        const hx = cx + R * 1.6 * Math.cos(a);
        const hy = cy + R * 1.6 * Math.sin(a);
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, cy, hx, hy],
            stroke: '#888', strokeWidth: 4, lineCap: 'round',
        }));
        // 手柄圆球
        this._crankHandleCircle = new Konva.Circle({
            x: hx, y: hy, radius: R * 0.65,
            fill: '#c8220a', stroke: '#8a1506', strokeWidth: 1,
            shadowColor: '#600', shadowBlur: 4, shadowOpacity: 0.4,
        });
        this._dynamicGroup.add(this._crankHandleCircle);
        // 手柄高光
        this._dynamicGroup.add(new Konva.Circle({
            x: hx - R * 0.18, y: hy - R * 0.18,
            radius: R * 0.20,
            fill: 'rgba(255,255,255,0.25)',
        }));

        // 曲柄中心轴
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 5,
            fill: '#aaa', stroke: '#888', strokeWidth: 0.8,
        }));

        // 旋转方向提示（小箭头弧）
        if (!this._autoSpin) {
            const arcR = R * 2.2;
            this._dynamicGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: arcR - 1, outerRadius: arcR + 1,
                angle: 120, rotation: a * 180/Math.PI + 30,
                stroke: 'rgba(150,150,150,0.4)', strokeWidth: 2,
            }));
        }

        // 摇动提示文字（静止时显示）
        if (Math.abs(this._crankSpeed) < 0.3) {
            this._dynamicGroup.add(new Konva.Text({
                x: gx, y: gy + gh + 4, width: gw,
                text: '← 摇动手柄 →', fontSize: 8, fill: '#888', align: 'center',
            }));
        }
    }

    // ── 两线圈（随指针角度旋转，绕向相反，互成60°）────────
    _drawCoils() {
        const cx = this._cx, cy = this._cy;
        const alpha = this._pointerAngle;
        const I1norm = this._getI1Norm();
        const I2norm = this._getI2Norm();
        const phi    = this._coilAngle;   // 两线圈夹角（60°）

        // 线圈1（电流线圈，红色，电流回路）
        this._drawOneCoil(cx, cy, alpha,       this._coilW, this._coilH,
                          I1norm, true,  'I₁', '电流线圈');
        // 线圈2（电压线圈，蓝色，电压回路）
        this._drawOneCoil(cx, cy, alpha + phi, this._coilW, this._coilH,
                          I2norm, false, 'I₂', '电压线圈');
    }

    _drawOneCoil(cx, cy, angle, cw, ch, inorm, isCoil1, currentLabel, nameLabel) {
        const color   = isCoil1 ? '#E24B4A' : '#378ADD';
        const coilCol = isCoil1
            ? ['#6a3520','#c07040','#e09060','#b06030','#6a3520']
            : ['#203570','#3868c0','#6090e0','#3868b0','#203570'];
        const opacity = 0.5 + Math.min(0.45, inorm * 0.55);

        const g = new Konva.Group({ x: cx, y: cy, rotation: angle * 180 / Math.PI });

        // 线圈框
        g.add(new Konva.Rect({
            x: -cw/2, y: -ch/2, width: cw, height: ch,
            fillLinearGradientStartPoint: { x: -cw/2, y:0 },
            fillLinearGradientEndPoint:   { x:  cw/2, y:0 },
            fillLinearGradientColorStops: [0,coilCol[0],0.3,coilCol[1],0.6,coilCol[2],0.85,coilCol[3],1,coilCol[4]],
            stroke: isCoil1 ? '#9a4020' : '#204090',
            strokeWidth: 0.8, cornerRadius: 2, opacity,
        }));
        // 匝线
        for (let yy = -ch/2+4; yy < ch/2-3; yy += 4) {
            g.add(new Konva.Line({
                points: [-cw/2+1.5, yy, cw/2-1.5, yy],
                stroke: isCoil1 ? '#9a4020' : '#204090',
                strokeWidth: 0.6, opacity: opacity * 0.6,
            }));
        }
        // 电流流向箭头
        if (inorm > 0.08) {
            const dir = isCoil1 ? 1 : -1;   // 绕向相反
            const arrAlpha = Math.min(0.85, inorm * 0.8 + 0.2);
            const arrY = ch / 2 - 12;
            [[-cw/2+2, dir], [cw/2-2, -dir]].forEach(([xp, d]) => {
                const ya = d > 0 ? -arrY : arrY;
                const yb = d > 0 ? -(arrY - ch*0.22) : (arrY - ch*0.22);
                g.add(new Konva.Arrow({
                    points: [xp, ya, xp, yb],
                    stroke: color, fill: color, strokeWidth: 1.5,
                    pointerLength: 5, pointerWidth: 4, opacity: arrAlpha,
                }));
            });
        }
        // 发光（电流较大时）
        if (inorm > 0.35) {
            g.add(new Konva.Rect({
                x: -cw/2-2, y: -ch/2-2, width: cw+4, height: ch+4,
                fill: `rgba(${isCoil1?'255,100,40':'40,120,255'},${inorm*0.14})`,
                cornerRadius: 3,
            }));
        }

        this._dynamicGroup.add(g);

        // 线圈名称标注（径向方向，不随线圈旋转）
        const labelR = this._ironR + ch/2 + 14;
        const lx = cx + labelR * Math.cos(angle - Math.PI/2) - 14;
        const ly = cy + labelR * Math.sin(angle - Math.PI/2) - 5;
        this._dynamicGroup.add(new Konva.Text({
            x: lx, y: ly, width: 28, text: nameLabel,
            fontSize: 7, fill: color, align: 'center',
        }));
    }

    // ── 安培力矢量（两线圈各自受力）───────────────────────
    _drawForceArrows() {
        const I1n = this._getI1Norm();
        const I2n = this._getI2Norm();
        if (I1n < 0.08 && I2n < 0.08) return;

        const cx = this._cx, cy = this._cy;
        const alpha = this._pointerAngle;
        const phi   = this._coilAngle;

        this._drawForceOnCoil(cx, cy, alpha,       I1n, true);
        this._drawForceOnCoil(cx, cy, alpha + phi, I2n, false);
    }

    _drawForceOnCoil(cx, cy, angle, inorm, isCoil1) {
        if (inorm < 0.08) return;
        const ch   = this._coilH;
        const cw   = this._coilW;
        const len  = 14 + inorm * 20;
        const col  = isCoil1 ? '#E24B4A' : '#378ADD';
        const dir  = isCoil1 ? 1 : -1;   // T1 使指针向右偏，T2 向左偏

        const g = new Konva.Group({
            x: cx, y: cy,
            rotation: angle * 180 / Math.PI,
            opacity: Math.min(0.88, inorm * 0.9 + 0.2),
        });

        const topY = -ch/2 + 8;
        const botY =  ch/2 - 8;
        const xOff = cw/2 + 5;

        g.add(new Konva.Arrow({
            points: [-dir*xOff, topY, -dir*(xOff+len), topY],
            stroke: col, fill: col, strokeWidth: 1.8,
            pointerLength: 6, pointerWidth: 5,
        }));
        g.add(new Konva.Arrow({
            points: [dir*xOff, botY, dir*(xOff+len), botY],
            stroke: col, fill: col, strokeWidth: 1.8,
            pointerLength: 6, pointerWidth: 5,
        }));
        // T标签
        g.add(new Konva.Text({
            x: -dir*(xOff+len) - 8, y: topY - 14,
            text: isCoil1 ? 'T₁' : 'T₂',
            fontSize: 10, fontStyle: 'bold italic', fill: col,
        }));

        this._dynamicGroup.add(g);
    }

    // ── 指针 ─────────────────────────────────────────────────
    _drawPointer() {
        const cx = this._cx, cy = this._cy;
        const PL = this._pointerLen;
        const alpha = this._pointerAngle;

        const g = new Konva.Group({
            x: cx, y: cy,
            rotation: (alpha - Math.PI/2) * 180 / Math.PI,
        });

        // 指针杆（渐变：根部粗，尖部细）
        g.add(new Konva.Line({
            points: [0, 14, 0, -PL + 10],
            stroke: '#8a7020', strokeWidth: 3, lineCap: 'round',
        }));
        // 尖端
        g.add(new Konva.Line({
            points: [0, -PL, 3, -PL+14, -3, -PL+14],
            stroke: '#c0a000', fill: '#c0a000', strokeWidth: 0.5, closed: true,
        }));
        // 高光
        g.add(new Konva.Line({
            points: [0, -PL, 0.8, -PL+9],
            stroke: 'rgba(255,255,180,0.55)', strokeWidth: 1, lineCap: 'round',
        }));
        // 平衡块（无回零弹簧，流比计）
        g.add(new Konva.Rect({
            x: -5, y: 8, width: 10, height: 12,
            fill: '#666', stroke: '#555', strokeWidth: 0.7, cornerRadius: 2,
        }));

        this._dynamicGroup.add(g);

        // 轴心
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 7,
            fillRadialGradientStartPoint:  { x: -2, y: -2 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 1,
            fillRadialGradientEndRadius:   7,
            fillRadialGradientColorStops:  [0, '#e0e0e0', 1, '#808080'],
            stroke: '#888', strokeWidth: 0.8,
        }));
    }

    // ── 被测电阻连接线（L/E端子到气隙）────────────────────
    _drawRxConnection() {
        const rx = this._Rx;
        const isOpen = rx >= 9999;
        const alpha  = Math.min(0.8, this._genVoltage / this.ratedVoltage * 1.2);

        if (!isOpen && alpha > 0.02) {
            // L端连线（红）
            this._dynamicGroup.add(new Konva.Line({
                points: [this._termLx, this._termY, this._termLx, this._cy + 60,
                         this._cx + this._gapHalf + this._magnetW - 4, this._cy],
                stroke: `rgba(200,80,80,${alpha * 0.6})`,
                strokeWidth: 1.2, tension: 0.3, lineCap: 'round',
            }));
            // E端连线（蓝）
            this._dynamicGroup.add(new Konva.Line({
                points: [this._termEx, this._termY, this._termEx, this._cy + 70,
                         this._cx + this._gapHalf + this._magnetW - 4, this._cy + 30],
                stroke: `rgba(80,120,200,${alpha * 0.6})`,
                strokeWidth: 1.2, tension: 0.3, lineCap: 'round',
            }));
            // Rx符号（端子旁）
            const rxLabel = rx >= 1000
                ? `${(rx/1000).toFixed(1)}GΩ`
                : `${rx}MΩ`;
            this._dynamicGroup.add(new Konva.Text({
                x: (this._termLx + this._termEx)/2 - 16,
                y: this._termY + 14,
                width: 32, text: rxLabel,
                fontSize: 7, fill: '#ef9a9a', align: 'center',
            }));
        } else if (isOpen) {
            // 断路标记
            this._dynamicGroup.add(new Konva.Text({
                x: this._termLx - 5, y: this._termY + 14,
                text: '∞ 未接', fontSize: 7, fill: '#888',
            }));
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════════════════════

    _bindInteraction() {
        // 手柄拖拽（通过 _dynamicGroup 事件冒泡）
        this._dynamicGroup.on('mousedown touchstart', (e) => {
            const pos   = e.target.getStage().getPointerPosition();
            const local = this._dynamicGroup.getAbsoluteTransform().copy().invert().point(pos);
            const dx    = local.x - this._crankCX;
            const dy    = local.y - this._crankCY;
            const dist  = Math.sqrt(dx*dx + dy*dy);
            if (dist < this._crankR * 2.5) {
                this._dragging = true;
                this._lastDragAngle = Math.atan2(dy, dx);
            }
        });

        this._dynamicGroup.on('mousemove touchmove', (e) => {
            if (!this._dragging) return;
            const pos   = e.target.getStage().getPointerPosition();
            const local = this._dynamicGroup.getAbsoluteTransform().copy().invert().point(pos);
            const dx    = local.x - this._crankCX;
            const dy    = local.y - this._crankCY;
            const angle = Math.atan2(dy, dx);
            let delta   = angle - this._lastDragAngle;
            // 角度环绕修正
            if (delta >  Math.PI) delta -= Math.PI * 2;
            if (delta < -Math.PI) delta += Math.PI * 2;
            this._crankSpeed  = delta / 0.016;   // 近似 60fps
            this._crankAngle += delta;
            this._lastDragAngle = angle;
        });

        this._dynamicGroup.on('mouseup touchend mouseleave', () => {
            this._dragging = false;
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 物理计算
    // ═══════════════════════════════════════════════════════════

    /** 计算发电机电压（正比于转速，有饱和） */
    _updateGenVoltage(dt) {
        // 阻尼减速
        if (!this._dragging) {
            this._crankSpeed *= Math.pow(0.85, dt * 60);
        }
        this._crankAngle += this._crankSpeed * dt;

        const omega = Math.abs(this._crankSpeed);   // rad/s
        // 额定转速约 13 rad/s（≈120 rpm）时输出额定电压
        const ratedOmega = 13;
        const targetV = this.ratedVoltage * Math.min(1, omega / ratedOmega);
        // 电压平滑
        this._genVoltage += (targetV - this._genVoltage) * Math.min(1, dt * 4);
    }

    /** 电流回路电流 I1 归一化（0~1） */
    _getI1Norm() {
        if (this._genVoltage < 1) return 0;
        const RxOhm = this._Rx * 1e6;    // MΩ → Ω
        const I1 = this._genVoltage / (RxOhm + this.RA);
        const I1max = this.ratedVoltage / this.RA;  // Rx=0 时最大电流
        return Math.min(1, I1 / I1max);
    }

    /** 电压回路电流 I2 归一化（0~1，与Rx无关） */
    _getI2Norm() {
        if (this._genVoltage < 1) return 0;
        const I2 = this._genVoltage / this.RV;
        const I2max = this.ratedVoltage / this.RV;
        return Math.min(1, I2 / I2max);
    }

    /** 不均匀磁场中各角度的有效磁感应强度（相对值）
     *  B(α, δ) ∝ sin(α + δ)，限制在 [0, 1]
     */
    _B1(alpha) { return Math.max(0, Math.sin(alpha + this._delta1)); }
    _B2(alpha) { return Math.max(0, Math.sin(alpha + this._delta2)); }

    /** 合力矩驱动指针 */
    _updatePointer(dt) {
        const I1 = this._getI1Norm();
        const I2 = this._getI2Norm();
        const alpha = this._pointerAngle;
        const phi   = this._coilAngle;

        // T1 = B1(α)·I1（驱动线圈，使 α 增大，向低阻/右偏）
        // T2 = B2(α+φ)·I2（反作用线圈，使 α 减小，向 ∞/左偏）
        const T1   = this._B1(alpha) * I1 * 3.0;
        const T2   = this._B2(alpha + phi) * I2 * 3.0;
        const netT = T1 - T2;

        // 阻尼
        const dampT = -this._damping * this._angularVel;
        const acc   = (netT + dampT) / this._inertia;

        this._angularVel   += acc * dt;
        this._pointerAngle += this._angularVel * dt;

        // 限位（流比计无硬限位，但物理上不超过±75°）
        if (this._pointerAngle >  this._maxAngle) {
            this._pointerAngle =  this._maxAngle;
            this._angularVel  *= -0.08;
        }
        if (this._pointerAngle < this._minAngle) {
            this._pointerAngle = this._minAngle;
            this._angularVel  *= -0.08;
        }
        // 注：流比计断电后指针保持最后位置（无回零弹簧）
    }

    /** 由偏转角估算示数（MΩ），查刻度映射表线性插值 */
    _angleToDeg(rad) { return rad * 180 / Math.PI; }

    _readRxFromAngle() {
        const deg = this._angleToDeg(this._pointerAngle);
        const map = this._scaleMap;
        // 刻度从左（-75°/∞）到右（+75°/0Ω）
        for (let i = 0; i < map.length - 1; i++) {
            const a = map[i].deg, b = map[i+1].deg;
            if (deg >= a && deg <= b) {
                const t   = (deg - a) / (b - a);
                const rxa = map[i].rx,   rxb = map[i+1].rx;
                if (!isFinite(rxa)) return rxb * (1 - t) + rxb * 2 * t;   // ∞侧插值
                if (!isFinite(rxb)) return rxa * (1 + t * 2);
                return rxa * (1-t) + rxb * t;
            }
        }
        return deg < map[0].deg ? Infinity : 0;
    }

    // ═══════════════════════════════════════════════════════════
    // tick（由 consys._tickAll 在 60fps 调用）
    // ═══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickSimulation(dt);
    
        this._refreshCache();
    }

    _tickSimulation(dt) {
        // 被测电阻平滑跟随
        this._Rx += (this._targetRx - this._Rx) * Math.min(1, dt * 3);

        this._updateGenVoltage(dt);
        this._updatePointer(dt);
        this._rebuildDynamic();
        this._updateStatusBar();
        this._refreshCache();
    }

    _updateStatusBar() {
        const V    = this._genVoltage;
        const active = V > 5;
        const reading = this._readRxFromAngle();
        const rxStr = !isFinite(reading) || reading > 5000
            ? '∞'
            : reading > 1000
            ? `${(reading/1000).toFixed(2)}GΩ`
            : `${reading.toFixed(0)} MΩ`;

        if (this._statusRxText) this._statusRxText.text(`Rx: ${rxStr}`);
        if (this._statusVText)  this._statusVText.text(`E: ${V.toFixed(0)}V`);
        if (this._statusDot) {
            this._statusDot.fill(active ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(active ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(active ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(active ? 5 : 2);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /**
     * 设置被测绝缘电阻（MΩ）
     * @param {number} rxMOhm  绝缘电阻值（MΩ），Infinity 表示断路
     */
    setRx(rxMOhm) {
        this._targetRx = Math.max(0, rxMOhm || 0);
        this._refreshCache();
    }

    /**
     * 模拟摇动手柄（自动匀速模式）
     * @param {boolean} on  true=开始摇动，false=停止
     * @param {number} rpm  转速（r/min），默认 120
     */
    setCrankRunning(on, rpm = 120) {
        this._autoSpin  = on;
        this._crankSpeed = on ? (rpm * Math.PI * 2 / 60) : 0;
        this._refreshCache();
    }

    /** 获取当前指示值（MΩ） */
    getReading()    { return this._readRxFromAngle(); }

    /** 获取当前偏转角（°） */
    getAngleDeg()   { return this._angleToDeg(this._pointerAngle); }

    /** 获取发电机当前输出电压（V） */
    getGenVoltage() { return this._genVoltage; }

    update(state) {
        if (typeof state === 'number') this.setRx(state);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',          type: 'text'   },
            { label: '发电机额定电压 (V)', key: 'ratedVoltage',   type: 'number' },
            { label: '量程上限 (MΩ)',      key: 'maxRx',          type: 'number' },
            { label: '限流电阻 RA (Ω)',    key: 'RA',             type: 'number' },
            { label: '限流电阻 RV (Ω)',    key: 'RV',             type: 'number' },
            { label: '线圈1磁场偏置角(°)', key: 'delta1Deg',      type: 'number' },
            { label: '线圈2磁场偏置角(°)', key: 'delta2Deg',      type: 'number' },
            { label: '两线圈夹角(°)',      key: 'coilAngleDeg',   type: 'number' },
            { label: '阻尼系数',           key: 'damping',        type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)         this.label          = cfg.label;
        if (cfg.ratedVoltage)  this.ratedVoltage   = parseFloat(cfg.ratedVoltage);
        if (cfg.maxRx)         this.maxRx          = parseFloat(cfg.maxRx);
        if (cfg.RA)            this.RA             = parseFloat(cfg.RA);
        if (cfg.RV)            this.RV             = parseFloat(cfg.RV);
        if (cfg.delta1Deg)     this._delta1        = parseFloat(cfg.delta1Deg)    * Math.PI/180;
        if (cfg.delta2Deg)     this._delta2        = parseFloat(cfg.delta2Deg)    * Math.PI/180;
        if (cfg.coilAngleDeg)  this._coilAngle     = parseFloat(cfg.coilAngleDeg) * Math.PI/180;
        if (cfg.damping)       this._damping       = parseFloat(cfg.damping);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}