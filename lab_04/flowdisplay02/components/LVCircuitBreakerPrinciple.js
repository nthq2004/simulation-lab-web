import { BaseComponent } from './BaseComponent.js';

/**
 * 低压断路器工作原理仿真组件
 * （Low-Voltage Circuit Breaker Operating Principle Simulator）
 *
 * ── 参考图纸结构 ─────────────────────────────────────────────
 *
 *  图纸为低压断路器原理图，从左到右依次：
 *
 *  ① 主触点 + 手动闭合机构（左侧）
 *     黄色导电条（主回路），灰色滑块触点（×3），
 *     左端固定支架（接地符号），释放弹簧（合闸/分闸弹簧）
 *
 *  ② 连杆装置（中部）
 *     三组上下平行的连杆对，连接触点与锁钩机构
 *
 *  ③ 锁钩（中偏右）
 *     蓝色锁钩，锁住连杆装置，维持合闸状态
 *
 *  ④ 过流脱扣器（右中）
 *     串联在主回路中的电流线圈（螺线管） + 衔铁
 *     过流时吸引衔铁，推动脱扣杆，解除锁钩
 *
 *  ⑤ 欠压脱扣器（右侧）
 *     并联在电源侧的电压线圈 + 衔铁 + 复位弹簧
 *     欠压时弹簧推开衔铁，解除锁钩
 *
 * ── 补充的两种脱扣器 ─────────────────────────────────────────
 *
 *  ⑥ 热脱扣器（双金属片，Thermal Release）
 *     串联在主回路中，过载时双金属片弯曲推动脱扣杆
 *     动作较慢（秒级），有反时限特性（电流越大动作越快）
 *
 *  ⑦ 分励脱扣器（Shunt Release / Remote Trip Coil）
 *     并联在控制电源，接收外部控制信号（如消防联动）
 *     通电时线圈通电吸合衔铁，推动脱扣杆实现远程分闸
 *
 * ── 五种脱扣演示模式 ─────────────────────────────────────────
 *
 *  MODE 1 — 手动合闸/分闸（操作手柄，点击按钮）
 *  MODE 2 — 过流脱扣（Overcurrent Trip）
 *    电流 > 整定值 → 线圈磁力 > 弹簧力 → 衔铁被吸 → 推脱扣杆 → 解锁钩 → 弹簧分闸
 *  MODE 3 — 欠压脱扣（Undervoltage Trip）
 *    电压 < 整定值 → 线圈磁力减弱 → 弹簧推开衔铁 → 推脱扣杆 → 解锁钩 → 弹簧分闸
 *  MODE 4 — 热脱扣（Thermal Trip / Overload）
 *    持续过载 → 双金属片热积累弯曲 → 顶脱扣杆 → 解锁钩 → 弹簧分闸
 *  MODE 5 — 分励脱扣（Shunt Trip / Remote）
 *    外部信号 → 分励线圈通电 → 衔铁被吸 → 推脱扣杆 → 解锁钩 → 弹簧分闸
 *
 * ── 动画逻辑 ─────────────────────────────────────────────────
 *
 *  状态机：OPEN → [手动合闸] → CLOSED → [各种脱扣] → TRIPPING → OPEN
 *
 *  CLOSED（合闸）：
 *    · 触点接触，黄色铜排导通发光
 *    · 锁钩钩住连杆
 *    · 所有脱扣器处于待机状态
 *    · 电流粒子沿铜排流动（大小随负载电流变化）
 *
 *  TRIPPING（脱扣动作，约 120~300ms）：
 *    · 触发的脱扣器衔铁/双金属片动作（动画）
 *    · 脱扣杆旋转推开锁钩
 *    · 锁钩释放连杆
 *    · 连杆随弹簧力分离（滑块向右运动）
 *    · 触点离开，产生电弧（橙黄色闪光）
 *
 *  OPEN（分闸）：
 *    · 所有连杆复位到分闸位置
 *    · 触点完全断开
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l1_in  — 主回路 L1 进线
 *  terminal_l1_out — 主回路 L1 出线
 *  terminal_ctrl   — 分励脱扣器控制信号输入
 */
export class LVCircuitBreakerPrinciple extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(780, config.width  || 900);
        this.height = Math.max(440, config.height || 520);

        this.type    = 'lv_breaker_principle';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌 ──
        this.label        = config.label        || 'QF';
        this.ratedVoltage = config.ratedVoltage || 380;
        this.ratedCurrent = config.ratedCurrent || 100;

        // ── 运行参数 ──
        this.loadCurrent   = config.loadCurrent   || 0;    // A，当前负载
        this.supplyVoltage = config.supplyVoltage  || 380;  // V，当前电压

        // ── 状态 ──
        this._state     = config.initState || 'OPEN';
        this._tripCause = null;   // 'OVERCURRENT'|'UNDERVOLTAGE'|'THERMAL'|'SHUNT'|'MANUAL'

        // 触点开合进度（0=合闸,1=分闸）
        this._contactPos   = this._state === 'CLOSED' ? 0 : 1;
        this._targetContact= this._contactPos;

        // 锁钩状态（0=锁住,1=释放）
        this._latchPos = this._state === 'CLOSED' ? 0 : 1;

        // 各脱扣器内部状态
        this._overcurrentPlunger  = 0;   // 过流衔铁位移 0~1
        this._uvPlunger           = this._state === 'CLOSED' ? 1 : 0; // 欠压衔铁（有压=吸合=1）
        this._thermalBend         = 0;   // 热脱扣双金属片弯曲量 0~1
        this._shuntPlunger        = 0;   // 分励衔铁 0~1
        this._tripLeverAngle      = 0;   // 脱扣杆转角 0~1（0=正常，1=脱扣）

        // 热效应
        this._heatLevel = 0;

        // 分励信号
        this._shuntSignal = false;

        // 电弧
        this._arcT    = 0;
        this._arcActive = false;

        // 电流粒子
        this._particles = [];


        this._calcGeometry();
        this._init();

        // 端口
        const g = this._geo;
        this.addPort(g.busLeft - 8,  g.busY,         'terminal_l1_in',  'wire', 'L+');
        this.addPort(g.busRight + 8, g.busY,         'terminal_l1_out', 'wire', 'L-');
        this.addPort(g.shuntX + 40,  this.height + 4,'terminal_ctrl',   'wire', 'SH');
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // ── 主铜排（水平，中部偏上）──
        g.busY      = H * 0.36;
        g.busLeft   = W * 0.04;
        g.busRight  = W * 0.56;
        g.busH      = H * 0.042;

        // ── 三组触点（从左到右，等间距在铜排上）──
        g.contactCount  = 3;
        g.contactSpacing = (W * 0.30) / g.contactCount;
        g.contacts = Array.from({ length: g.contactCount }, (_, i) => ({
            x: g.busLeft + W * 0.06 + i * g.contactSpacing,
            y: g.busY - g.busH * 0.05,
        }));

        // ── 释放弹簧（左端）──
        g.springX   = g.busLeft - W * 0.01;
        g.springY   = g.busY - H * 0.12;

        // ── 连杆装置（三对，竖向连杆）──
        g.linkY1    = g.busY - H * 0.16;  // 上连杆 Y
        g.linkY2    = g.busY + H * 0.10;  // 下连杆 Y

        // ── 锁钩（中偏右）──
        g.latchX    = W * 0.52;
        g.latchY    = g.busY - H * 0.05;

        // ── 脱扣杆（锁钩左侧）──
        g.tripLeverX = g.latchX - W * 0.04;
        g.tripLeverY = g.busY + H * 0.05;

        // ── 过流脱扣器（右中，线圈竖置）──
        g.ocX       = W * 0.60;
        g.ocY       = H * 0.14;
        g.ocW       = W * 0.10;
        g.ocH       = H * 0.44;

        // ── 欠压脱扣器（右侧）──
        g.uvX       = W * 0.76;
        g.uvY       = g.ocY;
        g.uvW       = g.ocW;
        g.uvH       = g.ocH;

        // ── 热脱扣器（过流器左侧，双金属片）──
        g.thermalX  = W * 0.44;
        g.thermalY  = H * 0.12;
        g.thermalW  = W * 0.065;
        g.thermalH  = H * 0.52;

        // ── 分励脱扣器（欠压器右侧）──
        g.shuntX    = W * 0.88;
        g.shuntY    = g.ocY;
        g.shuntW    = g.ocW;
        g.shuntH    = g.ocH;

        // ── 支架 / 接地符号（左端）──
        g.groundX   = g.busLeft - W * 0.03;
        g.groundY   = g.busY;

        // ── 操作手柄（主触点左上方）──
        g.handleX   = W * 0.08;
        g.handleY   = H * 0.08;

        // ── 控制按钮面板 Y ──
        g.panelY    = H + 30;

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawGround();
        this._drawMainBus();
        this._drawReleaseSpring();
        this._drawThermalTripper();      // ⑥ 热脱扣器（双金属片）
        this._drawOvercurrentTripper();  // ④ 过流脱扣器
        this._drawUndervoltageTripper(); // ⑤ 欠压脱扣器
        this._drawShuntTripper();        // ⑦ 分励脱扣器
        this._buildLatchGroup();         // ③ 锁钩（动态）
        this._buildTripLeverGroup();     // 脱扣杆（动态）
        this._buildLinkageGroup();       // ② 连杆装置（动态）
        this._buildContactGroup();       // ① 主触点（动态）
        this._buildArcGroup();           // 电弧层
        this._buildCurrentGroup();       // 电流粒子层
        this._drawLabels();
        this._drawControlPanel();
        
    }

    // ── 背景 ─────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#f8f9fa', stroke: '#dde2e8', strokeWidth: 1.5,
            cornerRadius: 6,
            shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.15,
        }));
        // 主回路区背景
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: this._geo.busY - this.height*0.22,
            width: this._geo.busRight + 20,
            height: this.height * 0.44,
            fill: 'rgba(200,220,240,0.10)',
            cornerRadius: 4,
        }));
    }

    // ── 接地支架（左端固定）──────────────────
    _drawGround() {
        const g  = this._geo;
        const gx = g.groundX, gy = g.groundY;

        // 固定墙壁（锯齿）
        [gy - this.height*0.14, gy, gy + this.height*0.14].forEach(ly => {
            this._staticGroup.add(new Konva.Line({
                points: [gx - 12, ly - 6, gx, ly - 6, gx, ly + 6, gx - 12, ly + 6],
                stroke: '#333', strokeWidth: 2, lineJoin: 'round',
            }));
            // 斜纹
            for (let i = 0; i < 4; i++) {
                this._staticGroup.add(new Konva.Line({
                    points: [gx - 12, ly - 6 + i*4, gx - 4, ly - 6 + i*4 + 8],
                    stroke: '#555', strokeWidth: 1,
                }));
            }
        });

        // 竖向连接柱
        this._staticGroup.add(new Konva.Line({
            points: [gx, gy - this.height*0.14, gx, gy + this.height*0.14],
            stroke: '#333', strokeWidth: 3,
        }));
    }

    // ── 主铜排（黄色水平导电条）────────────
    _drawMainBus() {
        const g = this._geo;

        // 铜排阴影
        this._staticGroup.add(new Konva.Rect({
            x: g.busLeft + 2, y: g.busY - g.busH/2 + 2,
            width: g.busRight - g.busLeft, height: g.busH,
            fill: 'rgba(0,0,0,0.12)', cornerRadius: 2,
        }));

        // 铜排主体（黄色）
        this._busRect = new Konva.Rect({
            x: g.busLeft, y: g.busY - g.busH/2,
            width: g.busRight - g.busLeft, height: g.busH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: g.busH },
            fillLinearGradientColorStops: [
                0,'#e8c040', 0.35,'#f8d860', 0.65,'#f0d050', 1,'#c8a030',
            ],
            stroke: '#a08020', strokeWidth: 1,
            cornerRadius: 2,
        });
        this._staticGroup.add(this._busRect);

        // 铜排导通光晕（合闸时）
        this._busGlow = new Konva.Rect({
            x: g.busLeft, y: g.busY - g.busH/2 - 3,
            width: g.busRight - g.busLeft, height: g.busH + 6,
            fill: 'rgba(255,210,50,0)',
            cornerRadius: 3,
        });
        this._staticGroup.add(this._busGlow);

        // 铜排右延伸（到过流脱扣器）—— 蓝色（参考图）
        this._busExt = new Konva.Rect({
            x: g.busRight, y: g.busY - g.busH/2,
            width: this.width * 0.42, height: g.busH,
            fill: '#6ab0e0', stroke: '#3a80b0', strokeWidth: 1, cornerRadius: 2,
        });
        this._staticGroup.add(this._busExt);
    }

    // ── 释放弹簧（左侧，合分闸弹簧）─────────
    _drawReleaseSpring() {
        const g  = this._geo;
        // 弹簧主体
        const spPts = [];
        const coils = 8, spLen = this.height * 0.22;
        for (let i = 0; i <= coils; i++) {
            spPts.push(
                g.busLeft - 24 + (i%2===0 ? -8 : 8),
                g.busY - spLen/2 + (spLen/coils)*i
            );
        }
        this._releaseSpring = new Konva.Line({
            points: spPts, stroke: '#444', strokeWidth: 3,
            lineJoin: 'round', lineCap: 'round',
        });
        this._staticGroup.add(this._releaseSpring);
        // 弹簧上端固定点
        this._staticGroup.add(new Konva.Circle({
            x: g.busLeft - 24, y: g.busY - spLen/2,
            radius: 5, fill: '#555', stroke: '#333', strokeWidth: 1,
        }));
        // 弹簧下端连接铜排
        this._staticGroup.add(new Konva.Line({
            points: [g.busLeft - 24, g.busY + spLen/2, g.busLeft, g.busY],
            stroke: '#444', strokeWidth: 2,
        }));
    }

    // ── ⑥ 热脱扣器（双金属片）──────────────
    _drawThermalTripper() {
        const g  = this._geo;
        const tx = g.thermalX, ty = g.thermalY;
        const tw = g.thermalW, th = g.thermalH;

        // 外框标注
        this._drawTripperBox(tx - 8, ty - 12, tw + 40, th + 24,
            '⑥ 热脱扣器\n（双金属片）', '#e65100');

        // 双金属片主体（静态底层）
        this._staticGroup.add(new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#c0a030', stroke: '#8a7020', strokeWidth: 1.5,
            cornerRadius: [tw/2, tw/2, 0, 0],
        }));
        // 上层（第二种金属，浅色）
        this._staticGroup.add(new Konva.Rect({
            x: tx + tw*0.4, y: ty, width: tw*0.6, height: th,
            fill: '#9090a8', stroke: '#707088', strokeWidth: 0.8,
            cornerRadius: [0, tw/2*0.6, 0, 0],
        }));

        // 动态弯曲路径
        this._thermalPathHot = new Konva.Path({
            data: this._getThermalPath(0),
            stroke: '#ef5350', strokeWidth: 3,
            fill: 'transparent', opacity: 0,
        });
        this._staticGroup.add(this._thermalPathHot);

        // 热效应光晕
        this._thermalGlow = new Konva.Rect({
            x: tx - 4, y: ty - 4, width: tw + 8, height: th + 8,
            fill: 'rgba(255,100,0,0)', cornerRadius: 4,
        });
        this._staticGroup.add(this._thermalGlow);

        // 连接主铜排（竖线）
        this._staticGroup.add(new Konva.Line({
            points: [tx + tw/2, ty + th, tx + tw/2, g.busY + g.busH/2],
            stroke: '#c0a030', strokeWidth: 3,
        }));

        // 温度文字
        this._thermalText = new Konva.Text({
            x: tx - 12, y: ty + th * 0.5,
            text: '', fontSize: 8, fontStyle: 'bold', fill: '#ef5350',
        });
        this._staticGroup.add(this._thermalText);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: tx - 4, y: ty - 10,
            text: '↕ 串联\n主回路', fontSize: 6.5, fill: '#607080', lineHeight: 1.3,
        }));
    }

    _getThermalPath(bend) {
        const g  = this._geo;
        const tx = g.thermalX + g.thermalW/2;
        const ty = g.thermalY;
        const th = g.thermalH;
        const b  = bend * g.thermalW * 2.0;
        return `M ${tx} ${ty} C ${tx+b*0.3} ${ty+th*0.35} ${tx+b*0.7} ${ty+th*0.65} ${tx+b} ${ty+th}`;
    }

    _updateThermal() {
        const b = this._thermalBend;
        if (this._thermalPathHot) {
            this._thermalPathHot.data(this._getThermalPath(b));
            this._thermalPathHot.opacity(b * 0.9);
        }
        if (this._thermalGlow) {
            this._thermalGlow.fill(`rgba(255,100,0,${(b*0.35).toFixed(3)})`);
        }
        if (this._thermalText) {
            const t = Math.round(20 + b * 100);
            this._thermalText.text(b > 0.08 ? `🌡${t}°C` : '');
            this._thermalText.fill(b > 0.6 ? '#ff5252' : '#fb8c00');
        }
    }

    // ── ④ 过流脱扣器（螺线管 + 衔铁）────────
    _drawOvercurrentTripper() {
        const g  = this._geo;
        const ox = g.ocX, oy = g.ocY, ow = g.ocW, oh = g.ocH;

        this._drawTripperBox(ox - 8, oy - 12, ow + 28, oh + 24,
            '④ 过流脱扣器\n（电磁）', '#c62828');

        // 线圈框
        this._staticGroup.add(new Konva.Rect({
            x: ox, y: oy, width: ow, height: oh * 0.65,
            fill: '#1a1e2a', stroke: '#303448', strokeWidth: 1.5, cornerRadius: 3,
        }));
        // 线圈绕组
        const coilCount2 = 16;
        for (let i = 0; i < coilCount2; i++) {
            const cy2 = oy + 4 + (oh*0.65 - 10)*(i/coilCount2);
            const t2  = i/coilCount2;
            this._staticGroup.add(new Konva.Line({
                points: [ox+3, cy2, ox+ow-3, cy2+3],
                stroke: `rgb(${Math.round(160+t2*60)},${Math.round(90+t2*20)},20)`,
                strokeWidth: 3, lineCap: 'round',
            }));
        }

        // 弹簧（线圈下方）
        const spY = oy + oh*0.65;
        const spH = oh*0.20;
        const spPts = [];
        for (let i=0; i<=8; i++) {
            spPts.push(ox+ow/2+(i%2===0?-6:6), spY+(spH/8)*i);
        }
        this._staticGroup.add(new Konva.Line({
            points: spPts, stroke: '#3a8a3a', strokeWidth: 2, lineJoin: 'round',
        }));

        // 衔铁（动态，被吸时向上移动）
        this._ocPlungerShape = new Konva.Rect({
            x: ox + ow*0.15, y: oy + oh*0.65,
            width: ow*0.70, height: oh*0.14,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: ow*0.70, y: 0 },
            fillLinearGradientColorStops: [0,'#484858', 0.4,'#8080a0', 0.6,'#9090b0', 1,'#484858'],
            stroke: '#303040', strokeWidth: 1, cornerRadius: 2,
        });
        this._staticGroup.add(this._ocPlungerShape);

        // 衔铁推杆（连接到脱扣杆）
        this._ocPushrod = new Konva.Line({
            points: [ox + ow/2, oy + oh*0.65 + oh*0.14,
                     g.tripLeverX, g.tripLeverY],
            stroke: '#505868', strokeWidth: 2.5, lineCap: 'round', dash: [5,3],
        });
        this._staticGroup.add(this._ocPushrod);

        // 磁场光晕
        this._ocGlow = new Konva.Rect({
            x: ox-4, y: oy-4, width: ow+8, height: oh*0.65+8,
            fill: 'rgba(200,50,50,0)', stroke: 'rgba(200,50,50,0)', strokeWidth: 2, cornerRadius: 5,
        });
        this._staticGroup.add(this._ocGlow);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: ox, y: oy - 10, width: ow, text: '串联\n主路', fontSize: 6.5,
            fill: '#607080', align: 'center', lineHeight: 1.3,
        }));
        // 连接铜排延伸
        this._staticGroup.add(new Konva.Line({
            points: [ox+ow/2, g.busY+g.busH/2, ox+ow/2, oy+oh],
            stroke: '#6ab0e0', strokeWidth: 3,
        }));
    }

    _updateOcTripper() {
        const p = this._overcurrentPlunger;
        const g = this._geo;
        const oy = g.ocY, oh = g.ocH;

        if (this._ocPlungerShape) {
            const moveUp = p * oh * 0.48;
            this._ocPlungerShape.y(oy + oh*0.65 - moveUp);
        }
        if (this._ocGlow) {
            const a = p * 0.5;
            this._ocGlow.fill(`rgba(200,50,50,${(a*0.25).toFixed(3)})`);
            this._ocGlow.stroke(`rgba(200,50,50,${a.toFixed(3)})`);
        }
        if (this._ocPushrod) {
            const moveUp = p * this._geo.ocH * 0.48;
            this._ocPushrod.points([
                g.ocX + g.ocW/2, g.ocY + g.ocH*0.65 + g.ocH*0.14 - moveUp,
                g.tripLeverX, g.tripLeverY - moveUp * this._tripLeverPos,
            ]);
        }
    }

    // ── ⑤ 欠压脱扣器（电压线圈，失压弹开）──
    _drawUndervoltageTripper() {
        const g  = this._geo;
        const ux = g.uvX, uy = g.uvY, uw = g.uvW, uh = g.uvH;

        this._drawTripperBox(ux - 8, uy - 12, uw + 28, uh + 24,
            '⑤ 欠压脱扣器\n（电磁）', '#1565c0');

        // 线圈框（蓝色，表示电压线圈）
        this._staticGroup.add(new Konva.Rect({
            x: ux, y: uy, width: uw, height: uh * 0.60,
            fill: '#0d1e2a', stroke: '#1565c0', strokeWidth: 1.5, cornerRadius: 3,
        }));
        // 线圈绕组（蓝铜线）
        for (let i = 0; i < 18; i++) {
            const cy2 = uy + 4 + (uh*0.60 - 10)*(i/18);
            this._staticGroup.add(new Konva.Line({
                points: [ux+3, cy2, ux+uw-3, cy2+2.5],
                stroke: `rgba(${80+i*6},${120+i*4},200,0.85)`,
                strokeWidth: 2.5, lineCap: 'round',
            }));
        }

        // 衔铁（动态）
        this._uvPlungerShape = new Konva.Rect({
            x: ux + uw*0.12, y: uy + uh*0.60,
            width: uw*0.76, height: uh*0.12,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: uw*0.76, y: 0 },
            fillLinearGradientColorStops: [0,'#484858', 0.5,'#8888a8', 1,'#484858'],
            stroke: '#303040', strokeWidth: 1, cornerRadius: 2,
        });
        this._staticGroup.add(this._uvPlungerShape);

        // 弹簧（衔铁下方，失压时弹开）
        const spY2 = uy + uh*0.60 + uh*0.12;
        const spPts2 = [];
        for (let i=0; i<=6; i++) {
            spPts2.push(ux+uw/2+(i%2===0?-5:5), spY2+(uh*0.18/6)*i);
        }
        this._uvSpring = new Konva.Line({
            points: spPts2, stroke: '#3a8a3a', strokeWidth: 2, lineJoin: 'round',
        });
        this._staticGroup.add(this._uvSpring);

        // 衔铁推杆
        this._uvPushrod = new Konva.Line({
            points: [ux+uw/2, uy+uh*0.72, g.tripLeverX, g.tripLeverY],
            stroke: '#505868', strokeWidth: 2.5, lineCap: 'round', dash: [5,3],
        });
        this._staticGroup.add(this._uvPushrod);

        // 磁场光晕
        this._uvGlow = new Konva.Rect({
            x: ux-4, y: uy-4, width: uw+8, height: uh*0.60+8,
            fill: 'rgba(20,80,200,0)', stroke: 'rgba(80,130,255,0)', strokeWidth: 2, cornerRadius: 5,
        });
        this._staticGroup.add(this._uvGlow);

        // 标注（并联电源侧）
        this._staticGroup.add(new Konva.Text({
            x: ux, y: uy - 10, width: uw, text: '并联\n电源', fontSize: 6.5,
            fill: '#607080', align: 'center', lineHeight: 1.3,
        }));
    }

    _updateUvTripper() {
        const p  = this._uvPlunger;   // 1=吸合(有压), 0=释放(失压)
        const g  = this._geo;
        const uy = g.uvY, uh = g.uvH;
        const uw = g.uvW;

        if (this._uvPlungerShape) {
            // 有压时衔铁被吸入线圈（上移）
            const moveUp = p * uh * 0.44;
            this._uvPlungerShape.y(uy + uh*0.60 - moveUp);
        }
        if (this._uvGlow) {
            const a = p * 0.55;
            this._uvGlow.fill(`rgba(20,80,200,${(a*0.25).toFixed(3)})`);
            this._uvGlow.stroke(`rgba(80,130,255,${a.toFixed(3)})`);
        }
        if (this._uvPushrod) {
            const dropY = (1-p) * uh * 0.25;
            this._uvPushrod.points([
                g.uvX + uw/2, g.uvY + uh*0.72 + dropY,
                g.tripLeverX, g.tripLeverY + dropY * this._tripLeverPos * 0.5,
            ]);
        }
    }

    // ── ⑦ 分励脱扣器（远程分闸线圈）────────
    _drawShuntTripper() {
        const g  = this._geo;
        const sx = g.shuntX, sy = g.shuntY, sw = g.shuntW, sh = g.shuntH;

        this._drawTripperBox(sx - 8, sy - 12, sw + 28, sh + 24,
            '⑦ 分励脱扣器\n（远程控制）', '#2e7d32');

        // 线圈框（绿色，控制线圈）
        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh*0.58,
            fill: '#0d1a14', stroke: '#2e7d32', strokeWidth: 1.5, cornerRadius: 3,
        }));
        for (let i=0; i<14; i++) {
            const cy2 = sy+4+(sh*0.58-8)*(i/14);
            this._staticGroup.add(new Konva.Line({
                points: [sx+3, cy2, sx+sw-3, cy2+2.5],
                stroke: `rgba(${60+i*8},${130+i*6},${60+i*4},0.9)`,
                strokeWidth: 2.5, lineCap: 'round',
            }));
        }

        // 衔铁
        this._shuntPlungerShape = new Konva.Rect({
            x: sx+sw*0.12, y: sy+sh*0.58,
            width: sw*0.76, height: sh*0.12,
            fillLinearGradientStartPoint: {x:0,y:0}, fillLinearGradientEndPoint: {x:sw*0.76,y:0},
            fillLinearGradientColorStops: [0,'#484858', 0.5,'#80a080', 1,'#484858'],
            stroke: '#303040', strokeWidth: 1, cornerRadius: 2,
        });
        this._staticGroup.add(this._shuntPlungerShape);

        // 弹簧（复位弹簧）
        const spPts3 = [];
        for (let i=0; i<=6; i++) {
            spPts3.push(sx+sw/2+(i%2===0?-5:5), sy+sh*0.70+(sh*0.18/6)*i);
        }
        this._staticGroup.add(new Konva.Line({
            points: spPts3, stroke: '#3a8a3a', strokeWidth: 2, lineJoin: 'round',
        }));

        // 推杆
        this._shuntPushrod = new Konva.Line({
            points: [sx+sw/2, sy+sh*0.72, g.tripLeverX, g.tripLeverY],
            stroke: '#40a050', strokeWidth: 2.5, lineCap: 'round', dash: [5,3],
        });
        this._staticGroup.add(this._shuntPushrod);

        // 光晕
        this._shuntGlow = new Konva.Rect({
            x:sx-4,y:sy-4,width:sw+8,height:sh*0.58+8,
            fill:'rgba(20,120,50,0)',stroke:'rgba(50,200,80,0)',strokeWidth:2,cornerRadius:5,
        });
        this._staticGroup.add(this._shuntGlow);

        // 控制信号 LED
        this._shuntLED = new Konva.Circle({
            x: sx + sw*0.5, y: sy + sh*0.95,
            radius: 6, fill: '#333', stroke: '#2e7d32', strokeWidth: 1.2,
        });
        this._staticGroup.add(this._shuntLED);
        this._staticGroup.add(new Konva.Text({
            x: sx - 2, y: sy + sh*0.95 + 8, width: sw+4,
            text: '控制信号', fontSize: 7, fill: '#607080', align: 'center',
        }));
    }

    _updateShuntTripper() {
        const p = this._shuntPlunger;
        const g = this._geo;

        if (this._shuntPlungerShape) {
            const moveUp = p * g.shuntH * 0.45;
            this._shuntPlungerShape.y(g.shuntY + g.shuntH*0.58 - moveUp);
        }
        if (this._shuntGlow) {
            const a = p * 0.55;
            this._shuntGlow.fill(`rgba(20,120,50,${(a*0.25).toFixed(3)})`);
            this._shuntGlow.stroke(`rgba(50,200,80,${a.toFixed(3)})`);
        }
        if (this._shuntLED) {
            this._shuntLED.fill(this._shuntSignal ? '#66bb6a' : '#333');
            this._shuntLED.shadowColor(this._shuntSignal ? '#66bb6a' : 'transparent');
            this._shuntLED.shadowBlur(this._shuntSignal ? 8 : 0);
        }
    }

    // ── ③ 锁钩（动态）────────────────────────
    _buildLatchGroup() {
        const g = this._geo;
        this._latchGroup = new Konva.Group({ x: g.latchX, y: g.latchY });

        // 锁钩主体（倒 L 形）
        this._latchBody = new Konva.Path({
            data: `M 0 -18 L 0 18 L 22 18 L 22 10 L 8 10 L 8 -18 Z`,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.5,
            cornerRadius: 2,
        });
        this._latchGroup.add(this._latchBody);

        // 锁钩枢轴
        this._latchGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 4,
            fill: '#404858', stroke: '#303040', strokeWidth: 1,
        }));

        this._staticGroup.add(this._latchGroup);
    }

    _updateLatch() {
        const angle = this._latchPos * 35;
        if (this._latchGroup) this._latchGroup.rotation(angle);
    }

    // ── 脱扣杆（动态）────────────────────────
    _buildTripLeverGroup() {
        const g = this._geo;
        this._tripLeverGroup = new Konva.Group({ x: g.tripLeverX, y: g.tripLeverY });
        this._tripLeverPos = 0;

        this._tripLeverBody = new Konva.Path({
            data: `M -4 -40 L 4 -40 L 4 40 L 22 40 L 22 32 L 12 32 L 12 -40 L 4 -40 Z`,
            fill: '#2a2a2a', stroke: '#111', strokeWidth: 1, cornerRadius: 2,
        });
        this._tripLeverGroup.add(this._tripLeverBody);
        this._tripLeverGroup.add(new Konva.Circle({
            radius: 4, fill: '#606870', stroke: '#404050', strokeWidth: 1,
        }));

        this._staticGroup.add(this._tripLeverGroup);
    }

    _updateTripLever() {
        const angle = this._tripLeverPos * 28;
        if (this._tripLeverGroup) this._tripLeverGroup.rotation(-angle);
    }

    // ── ② 连杆装置（动态，三组）─────────────
    _buildLinkageGroup() {
        this._linkageGroup = new Konva.Group();
        this._staticGroup.add(this._linkageGroup);
    }

    _rebuildLinkage() {
        this._linkageGroup.destroyChildren();
        const g    = this._geo;
        const pos  = this._contactPos;  // 0=合, 1=分

        // 三对连杆竖柱
        for (let i = 0; i < g.contactCount; i++) {
            const cx = g.contacts[i].x + pos * g.contactSpacing * 0.45;
            const cy = g.busY;

            // 上连杆（竖向小柱）
            this._linkageGroup.add(new Konva.Rect({
                x: cx - 6, y: g.linkY1,
                width: 12, height: cy - g.linkY1,
                fill: '#505868', stroke: '#303848', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 下连杆
            this._linkageGroup.add(new Konva.Rect({
                x: cx - 6, y: cy,
                width: 12, height: g.linkY2 - cy,
                fill: '#505868', stroke: '#303848', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 上端黑圆点（连接点）
            this._linkageGroup.add(new Konva.Circle({
                x: cx, y: g.linkY1, radius: 5,
                fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.8,
            }));
            // 下端黑圆点
            this._linkageGroup.add(new Konva.Circle({
                x: cx, y: g.linkY2, radius: 5,
                fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.8,
            }));

            // 上下水平导线（连接各连杆）
            if (i < g.contactCount - 1) {
                const nx = g.contacts[i+1].x + pos * g.contactSpacing * 0.45;
                [g.linkY1, g.linkY2].forEach(ly => {
                    this._linkageGroup.add(new Konva.Line({
                        points: [cx, ly, nx, ly],
                        stroke: '#333', strokeWidth: 2,
                    }));
                });
            }
        }
    }

    // ── ① 主触点（动态滑块）─────────────────
    _buildContactGroup() {
        this._contactGroup = new Konva.Group();
        this._staticGroup.add(this._contactGroup);
    }

    _rebuildContacts() {
        this._contactGroup.destroyChildren();
        const g   = this._geo;
        const pos = this._contactPos;  // 0=合, 1=分
        const on  = pos < 0.05;

        for (let i = 0; i < g.contactCount; i++) {
            const cx = g.contacts[i].x + pos * g.contactSpacing * 0.45;
            const cy = g.contacts[i].y;
            const bh = g.busH;

            // 滑块主体（灰色金属块）
            this._contactGroup.add(new Konva.Rect({
                x: cx - 8, y: cy - bh*0.8,
                width: 16, height: bh*1.6,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 16, y: 0 },
                fillLinearGradientColorStops: [0,'#606870',0.35,'#9098a8',0.65,'#a0a8b8',1,'#606870'],
                stroke: '#404850', strokeWidth: 1, cornerRadius: 3,
                shadowColor: '#000', shadowBlur: on ? 6 : 2, shadowOpacity: 0.25,
            }));

            // 触点接触面（上下两个小铜片）
            [-bh*0.42, bh*0.28].forEach(dy => {
                this._contactGroup.add(new Konva.Rect({
                    x: cx - 7, y: cy + dy,
                    width: 14, height: bh*0.20,
                    fill: on ? '#f0c040' : '#a09060',
                    stroke: on ? '#b09020' : '#706040', strokeWidth: 0.8,
                    cornerRadius: 1,
                    shadowColor: on ? '#ffcc40' : 'transparent',
                    shadowBlur: on ? 5 : 0, shadowOpacity: 0.7,
                }));
            });
        }

        // 铜排导通光晕
        if (this._busGlow) {
            this._busGlow.fill(on ? 'rgba(255,200,50,0.18)' : 'rgba(255,200,50,0)');
        }
    }

    // ── 电弧层 ────────────────────────────────
    _buildArcGroup() {
        this._arcGroup = new Konva.Group();
        this._staticGroup.add(this._arcGroup);
    }

    _renderArcs() {
        this._arcGroup.destroyChildren();
        if (!this._arcActive || this._arcT <= 0) return;

        const g       = this._geo;
        const progress = Math.min(1, this._arcT / 0.55);
        const intensity = (1 - progress);

        g.contacts.forEach((c, i) => {
            const cx = c.x + this._contactPos * g.contactSpacing * 0.45;
            const arcColor = this._tripCause === 'OVERCURRENT' || this._tripCause === 'THERMAL'
                ? `rgba(255,${Math.round(160+Math.random()*95)},40,`
                : `rgba(${Math.round(180+Math.random()*75)},${Math.round(200+Math.random()*55)},255,`;

            for (let j=0; j<2; j++) {
                const pts = [];
                const steps = 5;
                const startY = g.busY - g.busH*0.3;
                const endY   = g.busY + g.busH*0.3;
                for (let s=0; s<=steps; s++) {
                    const t2 = s/steps;
                    pts.push(
                        cx + (Math.random()-0.5)*10*intensity,
                        startY + (endY-startY)*t2 + (Math.random()-0.5)*6*intensity
                    );
                }
                const alpha = (0.5 + Math.random()*0.4) * intensity;
                this._arcGroup.add(new Konva.Line({
                    points: pts,
                    stroke: arcColor + alpha.toFixed(2) + ')',
                    strokeWidth: 1.2 + intensity*2.5 + Math.random()*1.5,
                    lineJoin: 'round', lineCap: 'round',
                }));
            }
        });
    }

    // ── 电流粒子 ─────────────────────────────
    _buildCurrentGroup() {
        this._currentGroup = new Konva.Group();
        this._staticGroup.add(this._currentGroup);
    }

    _renderCurrentParticles(dt) {
        this._currentGroup.destroyChildren();
        if (this._state !== 'CLOSED' || this.loadCurrent <= 0) return;

        const g     = this._geo;
        const T     = Date.now() / 1000;
        const iRatio = Math.min(2, this.loadCurrent / this.ratedCurrent);
        const count = Math.floor(3 + iRatio * 8);

        for (let i=0; i<count; i++) {
            const phase = ((T*2 + i/count) % 1);
            const px    = g.busLeft + phase * (g.busRight - g.busLeft);
            const py    = g.busY + (Math.random()-0.5)*g.busH*0.5;
            const r     = Math.round(255 * Math.min(1, iRatio*0.7));
            const gb    = Math.round(255*(1-iRatio*0.3));
            const alpha = 0.5 + 0.4*Math.sin(phase*Math.PI);
            this._currentGroup.add(new Konva.Circle({
                x: px, y: py, radius: 2 + iRatio,
                fill: `rgba(${r},${gb},50,${alpha.toFixed(2)})`,
            }));
        }
    }

    // ── 标注层 ────────────────────────────────
    _drawLabels() {
        const g = this._geo, W = this.width;

        // 顶部标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -20, width: W,
            text: `${this.label}  低压断路器工作原理图  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 11, fontStyle: 'bold', fill: '#1a3050', align: 'center',
        }));

        // 图纸主标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: this.height - 30, width: W,
            text: '低压断路器原理图',
            fontSize: 13, fontStyle: 'bold', fill: '#1565c0', align: 'center',
        }));

        // 各部件标注（红色箭头标注风格，参考图片）
        const notes = [
            { x: g.busLeft - 50, y: g.busY - 28,  t: '①主触点\n手动闭合', c: '#c62828' },
            { x: g.busLeft + g.contactSpacing*0.3, y: g.linkY1 - 18, t: '②连杆装置', c: '#c62828' },
            { x: g.latchX - 5,   y: g.latchY - 32, t: '③锁钩',     c: '#c62828' },
            { x: g.busLeft - 60, y: g.busY + 20,    t: '释放弹簧',   c: '#c62828' },
        ];
        notes.forEach(({ x, y, t, c }) => {
            this._staticGroup.add(new Konva.Text({
                x, y, text: t, fontSize: 8, fontStyle: 'bold', fill: c,
                lineHeight: 1.3,
            }));
        });

        // 状态文字（动态）
        this._stateDisplay = new Konva.Text({
            x: 0, y: -8, width: W,
            text: this._getStateLabel(),
            fontSize: 9.5, fontStyle: 'bold',
            fill: this._getStateColor(), align: 'center',
        });
        this._staticGroup.add(this._stateDisplay);
    }

    _getStateLabel() {
        const m = {
            OPEN:     '○  分闸状态  —  回路断开',
            CLOSED:   '●  合闸运行  —  回路导通',
            TRIPPING: `⚡  脱扣动作中 [${this._tripCauseLabel()}]`,
            ARCING:   `🔥  燃弧/熄弧中 [${this._tripCauseLabel()}]`,
        };
        return m[this._state] || '';
    }

    _getStateColor() {
        const c = { OPEN:'#78909c', CLOSED:'#43a047', TRIPPING:'#fb8c00', ARCING:'#ef5350' };
        return c[this._state] || '#607080';
    }

    _tripCauseLabel() {
        const m = {
            OVERCURRENT: '过流脱扣', UNDERVOLTAGE: '欠压脱扣',
            THERMAL: '热脱扣', SHUNT: '分励脱扣', MANUAL: '手动分闸',
        };
        return m[this._tripCause] || '';
    }

    // 脱扣器外框辅助
    _drawTripperBox(x, y, w, h, title, color) {
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: 'rgba(255,255,255,0.60)',
            stroke: color, strokeWidth: 1.5, dash: [6,3],
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: x + 2, y: y + 2, width: w - 4,
            text: title, fontSize: 7.5, fontStyle: 'bold',
            fill: color, align: 'center', lineHeight: 1.35,
        }));
    }

    // ── 控制面板（底部按钮）─────────────────
    _drawControlPanel() {
        const W  = this.width;
        const py = this.height + 16;
        const bh = 22;

        const buttons = [
            { label: '● 手动合闸',     color: '#1b5e20', action: () => this.close() },
            { label: '○ 手动分闸',     color: '#455a64', action: () => this.manualOpen() },
            { label: '⚡ 过流脱扣',     color: '#b71c1c', action: () => this.simulateOvercurrent() },
            { label: '⚡ 欠压脱扣',     color: '#0d47a1', action: () => this.simulateUndervoltage() },
            { label: '🌡 热脱扣(过载)', color: '#e65100', action: () => this.simulateThermal() },
            { label: '📡 分励脱扣',     color: '#1b5e20', action: () => this.simulateShunt() },
        ];

        const bw = (W - 8) / buttons.length;
        buttons.forEach(({ label, color, action }, i) => {
            const btn = new Konva.Rect({
                x: 4 + i*bw, y: py, width: bw - 3, height: bh,
                fill: color, stroke: '#000', strokeWidth: 0.8, cornerRadius: 3,
            });
            this._interactGroup.add(btn);
            this._staticGroup.add(new Konva.Text({
                x: 4 + i*bw + 2, y: py + 5, width: bw - 7,
                text: label, fontSize: 7.5, fontStyle: 'bold',
                fill: '#fff', align: 'center',
            }));
            btn.on('click tap', action);
            btn.listening(true);
        });
    }

    // ═══════════════════════════════════════════
    // 主循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt);
    
        this._refreshCache();
    }
    _tick(dt) {
        // ── 热积累（过载仿真）──
        if (this._state === 'CLOSED') {
            const or = this.loadCurrent / this.ratedCurrent;
            if (or > 1.05) {
                this._heatLevel = Math.min(1, this._heatLevel + Math.pow(or-1, 1.4)*0.10*dt);
                this._thermalBend = this._heatLevel;
            } else {
                this._heatLevel = Math.max(0, this._heatLevel - 0.04*dt);
                this._thermalBend = this._heatLevel;
            }
            if (this._heatLevel >= 1 && this._tripCause !== 'THERMAL') {
                this._triggerTrip('THERMAL');
            }
        } else {
            this._heatLevel = Math.max(0, this._heatLevel - 0.03*dt);
            this._thermalBend = this._heatLevel;
        }

        // ── 脱扣动作进展 ──
        if (this._state === 'TRIPPING') {
            this._tripLeverPos  = Math.min(1, this._tripLeverPos + dt*5);
            this._latchPos      = Math.min(1, this._latchPos + dt*4.5);
            this._contactPos    = Math.min(1, this._contactPos + dt*3.0);
            if (this._contactPos > 0.15) {
                this._arcActive = true;
                this._arcT     += dt;
            }
            if (this._contactPos >= 1) {
                this._state     = 'OPEN';
                this._arcActive = true;
            }
        }

        // ── 电弧消退 ──
        if (this._state === 'OPEN' && this._arcActive) {
            this._arcT += dt;
            if (this._arcT > 0.55) {
                this._arcActive = false;
                this._arcT      = 0;
            }
        }

        // ── 合闸动作 ──
        if (this._state === 'RESETTING') {
            this._contactPos   = Math.max(0, this._contactPos - dt*3.0);
            this._latchPos     = Math.max(0, this._latchPos - dt*4.0);
            this._tripLeverPos = Math.max(0, this._tripLeverPos - dt*4.5);
            // 欠压器恢复吸合
            this._uvPlunger    = Math.min(1, this._uvPlunger + dt*4);
            // 过流/分励/热效衔铁复位
            this._overcurrentPlunger = Math.max(0, this._overcurrentPlunger - dt*3);
            this._shuntPlunger       = Math.max(0, this._shuntPlunger - dt*3);
            if (this._contactPos <= 0) {
                this._state    = 'CLOSED';
                this._tripCause = null;
                this._heatLevel = 0;
                this._thermalBend = 0;
            }
        }

        // ── 各脱扣器衔铁动态 ──
        this._updateThermal();
        this._updateOcTripper();
        this._updateUvTripper();
        this._updateShuntTripper();
        this._updateLatch();
        this._updateTripLever();

        // ── 重绘动态层 ──
        this._rebuildLinkage();
        this._rebuildContacts();
        this._renderArcs();
        this._renderCurrentParticles(dt);

        // ── 状态文字 ──
        if (this._stateDisplay) {
            this._stateDisplay.text(this._getStateLabel());
            this._stateDisplay.fill(this._getStateColor());
        }

        this._refreshCache();
    }

    // ── 触发脱扣 ─────────────────────────────
    _triggerTrip(cause) {
        if (this._state !== 'CLOSED') return;
        this._tripCause = cause;
        this._state     = 'TRIPPING';
        this._arcT      = 0;
        // 各脱扣器动作
        if (cause === 'OVERCURRENT') this._overcurrentPlunger = 1;
        if (cause === 'UNDERVOLTAGE') this._uvPlunger = 0;
        if (cause === 'SHUNT') this._shuntPlunger = 1;
    }

    // ═══════════════════════════════════════════
    // 公开 API

    /** 手动合闸 */
    close() {
        if (this._state === 'TRIPPING' || this._state === 'ARCING') return;
        if (this._state === 'CLOSED') return;
        this._state    = 'RESETTING';
        this._shuntSignal = false;
    }

    /** 手动分闸 */
    manualOpen() {
        if (this._state !== 'CLOSED') return;
        this._triggerTrip('MANUAL');
    }

    /** 模拟过流脱扣 */
    simulateOvercurrent(multiple = 12) {
        if (this._state !== 'CLOSED') { this.close(); setTimeout(() => this.simulateOvercurrent(multiple), 400); return; }
        this.loadCurrent = this.ratedCurrent * multiple;
        this._overcurrentPlunger = 0.8;
        this._triggerTrip('OVERCURRENT');
    }

    /** 模拟欠压脱扣 */
    simulateUndervoltage() {
        if (this._state !== 'CLOSED') { this.close(); setTimeout(() => this.simulateUndervoltage(), 400); return; }
        this.supplyVoltage = 0;
        this._uvPlunger = 0;
        this._triggerTrip('UNDERVOLTAGE');
    }

    /** 模拟热脱扣（注入 2.5×额定电流，等待热积累） */
    simulateThermal(multiple = 2.5) {
        if (this._state !== 'CLOSED') { this.close(); setTimeout(() => this.simulateThermal(multiple), 400); return; }
        this.loadCurrent = this.ratedCurrent * multiple;
        // 热积累到阈值后自动触发
    }

    /** 模拟分励脱扣（远程控制信号）*/
    simulateShunt() {
        this._shuntSignal = true;
        this._shuntPlunger = 0;
        const doTrip = () => {
            this._shuntPlunger = 1;
            if (this._state !== 'CLOSED') { this.close(); setTimeout(doTrip, 400); return; }
            this._triggerTrip('SHUNT');
        };
        doTrip();
    }

    /** 设置负载电流 */
    setLoadCurrent(A) { this.loadCurrent = Math.max(0, A); }

    /** 设置供电电压 */
    setVoltage(V) {
        this.supplyVoltage = V;
        if (V < this.ratedVoltage * 0.35 && this._state === 'CLOSED') {
            this.simulateUndervoltage();
        }
    }

    getState()    { return this._state; }
    isClosed()    { return this._state === 'CLOSED'; }
    getTripCause(){ return this._tripCause; }

    update(s) {
        if (typeof s === 'boolean') s ? this.close() : this.manualOpen();
        if (typeof s === 'string')  {
            if (s==='close') this.close();
            if (s==='open')  this.manualOpen();
            if (s==='overcurrent')  this.simulateOvercurrent();
            if (s==='undervoltage') this.simulateUndervoltage();
            if (s==='thermal')      this.simulateThermal();
            if (s==='shunt')        this.simulateShunt();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',             key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',      key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',      key: 'ratedCurrent', type: 'number' },
            { label: '负载电流 (A)',      key: 'loadCurrent',  type: 'number' },
            { label: '初始状态(OPEN/CLOSED)', key: 'initState', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedVoltage) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.loadCurrent !== undefined) this.loadCurrent = parseFloat(cfg.loadCurrent);
        if (cfg.initState)    this.update(cfg.initState);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}