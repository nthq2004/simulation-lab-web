import { BaseComponent } from './BaseComponent.js';

/**
 * 膜片压力表仿真组件
 * （Diaphragm Pressure Gauge）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  膜片压力表由以下部分组成：
 *
 *  1. 表壳（Case）：圆形金属外壳，上半部为仪表腔，下半部为膜盒腔
 *  2. 表盘（Dial）：白色刻度盘，印有量程刻度与单位
 *  3. 膜盒（Diaphragm Capsule）：核心敏感元件，位于表壳下半部
 *     - 上膜片（Upper Diaphragm）：焊接于膜盒上盖，随压力上拱
 *     - 下膜片（Lower Diaphragm）：焊接于膜盒下盖，与被测介质接触
 *     - 膜盒腔（Reference Chamber）：两膜片之间的密封腔体
 *     - 工作原理：被测压力作用于下膜片，使膜片中心向上位移，
 *       通过推杆将位移传递至表头传动机构
 *  4. 推杆（Push Rod）：将膜片中心位移垂直向上传递
 *  5. 连杆（Link）：将推杆直线位移转换为扇形齿轮的角位移
 *  6. 扇形齿轮（Sector Gear）：放大并传递角位移
 *  7. 小齿轮（Pinion）：与指针轴固连，由扇形齿轮驱动
 *  8. 游丝（Hair Spring）：消除齿轮间隙，保证回程线性
 *  9. 指针（Pointer）：固定在小齿轮轴上，指示压力读数
 * 10. 接头（Socket / Fitting）：膜盒下方螺纹接头，连接被测管路
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  升压过程：
 *    进口压力↑ → 下膜片向上挠曲 → 膜片中心上移 → 推杆上推
 *    → 连杆驱动扇形齿轮转动 → 小齿轮正转 → 指针顺时针偏转
 *
 *  降压过程：
 *    压力↓ → 膜片弹性回复 → 推杆下移 → 游丝弹力辅助回零
 *    → 指针逆时针回零
 *
 *  与波登管压力表的区别：
 *    - 敏感元件为平面膜片，适合低压、微压、腐蚀性介质测量
 *    - 膜片位移为垂直线性位移（而非弧形弯曲），经推杆传递
 *    - 量程通常为 0~25 kPa 以下（本仿真默认 0~25 kPa）
 *    - 过载保护性好：膜片达到限位后不再变形
 *
 *  仿真动画采用正弦缓动（ease in-out），时长可配置。
 *  膜片颜色随压力线性从钢蓝（低压）渐变至铜橙（高压）。
 *
 * ── 几何关系 ──────────────────────────────────────────────────
 *
 *  膜片位于表壳下半部，膜盒高度约占组件高度 20%。
 *  膜片最大中心挠度：MAX_DIAPHRAGM_DEFL（像素），对应满量程。
 *  推杆将挠度垂直传递至连杆铰接点，连杆拉动扇形齿轮旋转，
 *  最终使指针在 0~270° 范围内偏转对应量程。
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）二维仿真，表盘朝向观察者。
 *  膜盒截面图绘制在表壳下方延伸区域，清晰展示膜片变形过程。
 *  传动机构（推杆、连杆、扇形齿轮）以半透明方式叠加于表盘区域。
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_inlet — 进气口（膜盒接头底部中心，接被测管路）
 */
export class DiaphragmGauge extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(260, config.height || 310);

        this.type    = 'diaphragm_gauge';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.label      = config.label      || 'PI';     // 位号
        this.rangeMax   = config.rangeMax   || 100;       // 量程上限（kPa）
        this.rangeUnit  = config.rangeUnit  || 'kPa';   // 单位
        this.dialDivs   = config.dialDivs   || 10;      // 刻度主分格数

        // ── 压力状态 ──
        this._pressure  = config.initPressure || 0;     // 当前仿真压力（kPa）
        this._animating = false;
        this._animT     = 0;        // 动画进度 0~1
        this._animDur   = config.animDur || 0.8;        // s
        this._pressFrom = 0;        // 动画起始压力
        this._pressTo   = 0;        // 动画目标压力
        this.opsCount   = config.initOps || 0;

        // ── 几何常量（所有坐标相对组件左上角）──
        const W = this.width, H = this.height;

        // 表盘圆心、半径（位于组件上部）
        this._cx = W * 0.50;
        this._cy = H * 0.36;
        this._R  = Math.min(W, H * 0.80) * 0.38;

        // ── 膜盒区域（位于表盘正下方，与接头相连）──
        // 膜盒外壳矩形（圆角，模拟圆形膜盒侧视图）
        this._capsuleX = this._cx - this._R * 0.72;
        this._capsuleY = this._cy + this._R + 6;
        this._capsuleW = this._R * 1.44;
        this._capsuleH = H * 0.20;

        // 膜盒内腔：上下各留壁厚
        this._wallT     = this._capsuleH * 0.12;        // 上下盖壁厚
        this._chamberY0 = this._capsuleY + this._wallT; // 腔体上边界（紧贴上盖）
        this._chamberY1 = this._capsuleY + this._capsuleH - this._wallT; // 腔体下边界

        // 膜片中心 x（与推杆同轴，位于膜盒宽度中心）
        this._memCx     = this._cx;
        // 膜片基准 y（零压时，上膜片中心 y）
        this._memTopY0  = this._chamberY0 + this._wallT * 0.5;
        // 零压时，下膜片中心 y
        this._memBotY0  = this._chamberY1 - this._wallT * 0.5;
        // 膜片最大中心挠度（满量程时上膜片中心上移量）
        // 增大系数使变形过程更明显可见
        this._maxDefl   = this._capsuleH * 0.14;

        // ── 推杆 ──
        // 推杆上端铰接点（零压时）= 上膜片中心
        this._rodTopY0  = this._memTopY0;
        // 推杆下端固连在膜片中心（随膜片同步上移）

        // ── 传动机构（位于表盘下半区）──
        // 扇形齿轮轴心（固定）
        this._sectorPivotX = this._cx + this._R * 0.10;
        this._sectorPivotY = this._cy + this._R * 0.30;
        this._sectorR  = this._R * 0.22;    // 扇形齿轮半径
        this._linkLen  = this._R * 0.35;    // 连杆长度
        this._rodLen   = this._R * 0.22;    // 推杆长度（从膜片中心到连杆铰接点）

        // 游丝（绘制在指针轴周围）
        this._hairCx = this._cx;
        this._hairCy = this._cy;

        // 指针轴（表盘圆心）
        this._needleLen  = this._R * 0.84;
        this._needleTail = this._R * 0.17;

        // 表盘刻度角范围（与波登管一致）
        // 0 压 = −225°（SVG顺时针），满量程 = −225°+315° = +90°
        this._dialAngStart = 225;    // 起始角（度）
        this._dialAngEnd   = 315;    // 总扫角（度）

        // 接头
        this._socketX = this._cx;
        this._socketY = this._capsuleY + this._capsuleH + 2;
        this._socketW = this._R * 0.28;
        this._socketH = H * 0.09;


        this._init();

        // 端口：进气口（接头底部中心）
        this.addPort(
            this._socketX,
            this._socketY + this._socketH + 4,
            'port_inlet', 'wire', 'P'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawCase();
        this._drawCapsuleBody();         // 静态：膜盒外壳
        this._drawDial();
        this._drawSocket();
        this._drawMechanismLayer();      // 动态层：膜片 + 推杆 + 连杆 + 齿轮
        this._drawNeedleLayer();         // 动态层：指针
        this._drawBezel();
        this._drawCenterCap();
        this._drawLabel();
        this._drawComponentLabels();
        this._drawStatusIndicator();
    }

    // ── 表壳（仅外圈环 + 极淡底色）────────────────────────────
    _drawCase() {
        const cx = this._cx, cy = this._cy, R = this._R;

        // 极淡内部底色
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R - 2,
            fill: '#f5f4f0',
        }));

        // 外圈阴影
        this.group.add(new Konva.Circle({
            x: cx + 2, y: cy + 3, radius: R + 6,
            fill: 'rgba(0,0,0,0.10)',
        }));
        // 金属外圈环
        this.group.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: R - 4, outerRadius: R + 6,
            fillLinearGradientStartPoint: { x: -(R+6), y: -(R+6) },
            fillLinearGradientEndPoint:   { x:  (R+6), y:  (R+6) },
            fillLinearGradientColorStops: [
                0,   '#b8b8be',
                0.3, '#a0a0a8',
                0.6, '#888890',
                1,   '#787880',
            ],
            stroke: '#c0c0c8', strokeWidth: 1,
        }));
        // 外圈高光
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R + 1, outerRadius: R + 7,
            angle: 80, rotation: -200,
            fill: 'rgba(255,255,255,0.20)',
        }));
    }

    // ── 膜盒外壳（静态，浅色壳体）──────────────────────────
    _drawCapsuleBody() {
        const x = this._capsuleX, y = this._capsuleY;
        const w = this._capsuleW, h = this._capsuleH;

        // 膜盒阴影
        this.group.add(new Konva.Rect({
            x: x + 3, y: y + 4, width: w, height: h,
            fill: 'rgba(0,0,0,0.08)', cornerRadius: 5,
        }));
        // 膜盒外壳主体（浅灰）
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#e8e6e0', stroke: '#c0c0b8', strokeWidth: 1,
            cornerRadius: 5,
        }));
        // 上盖板（淡黄铜色）
        this.group.add(new Konva.Rect({
            x: x + 2, y: y + 1,
            width: w - 4, height: this._wallT * 1.2,
            fill: '#d4c8a0', stroke: '#b8a880', strokeWidth: 0.6,
            cornerRadius: [4, 4, 0, 0],
        }));
        // 下盖板（淡黄铜色）
        this.group.add(new Konva.Rect({
            x: x + 2, y: y + h - this._wallT * 1.2 - 1,
            width: w - 4, height: this._wallT * 1.2,
            fill: '#d4c8a0', stroke: '#b8a880', strokeWidth: 0.6,
            cornerRadius: [0, 0, 4, 4],
        }));
        // 膜盒腔内壁（极淡灰色，显示膜片）
        this.group.add(new Konva.Rect({
            x: x + 4, y: this._chamberY0,
            width: w - 8, height: this._chamberY1 - this._chamberY0,
            fill: '#e0ded8', stroke: '#c8c6c0', strokeWidth: 0.5,
        }));
        // 连接颈（表壳与膜盒之间的短颈）
        const neckW = w * 0.30;
        this.group.add(new Konva.Rect({
            x: this._cx - neckW / 2,
            y: this._cy + this._R + 2,
            width: neckW,
            height: y - (this._cy + this._R + 2) + 2,
            fill: '#d4c8a0', stroke: '#b8a880', strokeWidth: 0.6,
        }));
        // 推杆穿孔（上盖中心小孔）
        this.group.add(new Konva.Circle({
            x: this._memCx,
            y: this._capsuleY + this._wallT * 0.6,
            radius: 2.5,
            fill: '#b0b0a8', stroke: '#909088', strokeWidth: 0.5,
        }));
    }

    // ── 表盘（极简刻度，突出内部机构）────────────────────────
    _drawDial() {
        const cx = this._cx, cy = this._cy, R = this._R;

        // ── 刻度线（淡化处理）──
        const divs       = this.dialDivs;
        const subDivs    = 5;
        const totalTicks = divs * subDivs;

        for (let i = 0; i <= totalTicks; i++) {
            const frac    = i / totalTicks;
            const angDeg  = -(this._dialAngStart) + this._dialAngEnd * frac;
            const angRad  = angDeg * Math.PI / 180;
            const isMajor = (i % subDivs === 0);
            const isMid   = (i % subDivs === Math.floor(subDivs / 2));

            const rOuter = R * 0.94;
            const rInner = isMajor ? R * 0.80 : (isMid ? R * 0.86 : R * 0.90);
            const sw     = isMajor ? 1.2 : 0.6;

            const col = isMajor ? '#889098' : '#b0b8c0';

            this.group.add(new Konva.Line({
                points: [
                    cx + rOuter * Math.cos(angRad),
                    cy + rOuter * Math.sin(angRad),
                    cx + rInner * Math.cos(angRad),
                    cy + rInner * Math.sin(angRad),
                ],
                stroke: col, strokeWidth: sw, lineCap: 'round',
            }));

            if (isMajor) {
                const val  = Math.round((i / totalTicks) * this.rangeMax);
                const rTxt = R * 0.70;
                this.group.add(new Konva.Text({
                    x: cx + rTxt * Math.cos(angRad) - 12,
                    y: cy + rTxt * Math.sin(angRad) - 6,
                    width: 24, height: 12,
                    text: String(val),
                    fontSize: Math.max(6, R * 0.085),
                    fill: '#889098',
                    align: 'center', verticalAlign: 'middle',
                }));
            }
        }

        // 量程单位（淡化）
        this.group.add(new Konva.Text({
            x: cx - R * 0.28, y: cy + R * 0.28,
            width: R * 0.56, height: 12,
            text: this.rangeUnit,
            fontSize: Math.max(6, R * 0.080),
            fill: '#a0a8b0', align: 'center',
        }));
    }

    // ── 接头（膜盒底部螺纹接口）─────────────────────────────
    _drawSocket() {
        const sx = this._socketX, sy = this._socketY;
        const sw = this._socketW, sh = this._socketH;

        // 接头主体（黄铜色）
        this.group.add(new Konva.Rect({
            x: sx - sw / 2, y: sy,
            width: sw, height: sh * 0.65,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: sw, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#7a6a28',
                0.25,'#c8a842',
                0.55,'#e0c060',
                0.80,'#b08030',
                1,   '#7a6a28',
            ],
            stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 六角螺母头
        this.group.add(new Konva.Rect({
            x: sx - sw * 0.65, y: sy + sh * 0.60,
            width: sw * 1.30, height: sh * 0.40,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: sw * 1.30, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#8a7030',
                0.5, '#d4aa48',
                1,   '#8a7030',
            ],
            stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 螺纹纹路
        for (let i = 0; i < 3; i++) {
            const ty = sy + sh * 0.10 + i * sh * 0.17;
            this.group.add(new Konva.Line({
                points: [sx - sw / 2 + 1, ty, sx + sw / 2 - 1, ty],
                stroke: 'rgba(80,60,20,0.35)', strokeWidth: 0.6,
            }));
        }
        // 端口标注
        this.group.add(new Konva.Text({
            x: sx - sw, y: sy + sh + 5,
            width: sw * 2, text: 'P',
            fontSize: 8, fill: '#ef9a9a', fontStyle: 'bold', align: 'center',
        }));
    }

    // ── 动态层：膜片 + 推杆 + 连杆 + 齿轮 ───────────────────
    _drawMechanismLayer() {
        this._mechGroup = new Konva.Group();
        this.group.add(this._mechGroup);
        this._rebuildMechanism();
    }

    _rebuildMechanism() {
        this._mechGroup.destroyChildren();
        const frac = Math.max(0, Math.min(1, this._pressure / this.rangeMax));

        // ── 计算各活动件坐标 ──
        const geo = this._calcGeometry(frac);

        // ── 绘制各部件（由后向前）──
        this._drawDiaphragm(frac, geo);
        this._drawPushRod(frac, geo);
        this._drawLink(geo);
        this._drawSectorGear(geo);
        this._drawHairSpring(frac);

        // ── 膜片位移标注（压力 > 2% 时显示）───────────────────
        if (frac > 0.02) {
            const geo0 = this._calcGeometry(0);
            const disp = geo0.topMemY - geo.topMemY; // 上移量
            const cx = this._cx;
            this._mechGroup.add(new Konva.Text({
                x: cx - this._R * 0.50,
                y: this._capsuleY + this._capsuleH + 4,
                width: this._R,
                text: `膜片位移: ${disp.toFixed(1)}px`,
                fontSize: 8, fill: '#ffa726', align: 'center', fontStyle: 'bold',
            }));
        }
    }

    /**
     * 核心几何计算：给定压力分数，返回所有活动件坐标
     *  defl       — 膜片中心上移量（px，正值向上）
     *  topMemY    — 上膜片中心当前 y 坐标
     *  botMemY    — 下膜片中心当前 y 坐标（向下挠曲，略向下）
     *  rodTopY    — 推杆上端（连杆铰接点）当前 y
     *  linkPivotX/Y — 连杆与扇形齿轮的铰接点坐标
     *  sectorAng  — 扇形齿轮当前转角（rad）
     */
    _calcGeometry(frac) {
        const defl    = frac * this._maxDefl;      // 膜片中心上移量（px）
        const topMemY = this._memTopY0 - defl;     // 上膜片中心 y（上移）
        // 下膜片向上挠曲（略小于上膜片，模拟膜盒两膜片联动）
        const botMemY = this._memBotY0 - defl * 0.75;
        const rodTopY = topMemY - this._rodLen;    // 推杆上端（固定长度，跟随膜片移动）

        // 连杆上端铰接于推杆顶端
        const linkTopX = this._memCx;
        const linkTopY = rodTopY;

        // 扇形齿轮轴心（固定）
        const spx = this._sectorPivotX;
        const spy = this._sectorPivotY;

        // 连杆另一端绕扇形轴运动（连杆长度固定）
        // 零压时连杆下端与扇形轴心的初始相对角度
        const dx0    = linkTopX - spx;
        const dy0    = (this._memTopY0) - spy;
        const dist0  = Math.sqrt(dx0 * dx0 + dy0 * dy0);
        const ang0   = Math.atan2(dy0, dx0);       // 初始角

        // 升压后连杆上端上移，连杆绕扇形轴旋转
        const dxN    = linkTopX - spx;
        const dyN    = linkTopY - spy;
        const distN  = Math.sqrt(dxN * dxN + dyN * dyN);
        // 连杆与扇形轴距离近似为连杆下端到扇形轴的初始距离
        const armR   = this._linkLen * 0.75;        // 扇形臂长（连杆铰接半径）
        const sectorAng = Math.atan2(-dyN, dxN);   // 扇形当前角度（SVG坐标系）

        // 连杆下端（扇形臂端点）
        const linkBotX = spx + armR * Math.cos(-sectorAng);
        const linkBotY = spy + armR * Math.sin(-sectorAng);

        return { defl, topMemY, botMemY, rodTopY, linkTopX, linkTopY,
                 linkBotX, linkBotY, spx, spy, sectorAng };
    }

    // ── 膜片（膜盒内，C形波纹轮廓）────────────────────────
    _drawDiaphragm(frac, geo) {
        const { topMemY, botMemY } = geo;
        const cx   = this._memCx;
        const x    = this._capsuleX + 4;
        const w    = this._capsuleW - 8;
        const half = w / 2;

        // 压力色（低压蓝→高压橙）
        const r = Math.round(60  + frac * 150);
        const g = Math.round(110 - frac * 50);
        const b = Math.round(185 - frac * 130);
        const memCol     = `rgba(${r},${g},${b},0.70)`;
        const memColDark = `rgba(${Math.round(r*0.65)},${Math.round(g*0.65)},${Math.round(b*0.65)},0.80)`;

        // ── 零压膜片参考位置（虚线轮廓，压力 > 3% 时显示）──
        if (frac > 0.03) {
            const ghostPath = this._buildDiaphragmWavePath(cx, this._memTopY0, half, 0, 1);
            this._mechGroup.add(new Konva.Path({
                data: ghostPath,
                fill: 'none', stroke: 'rgba(100,200,255,0.50)',
                strokeWidth: 2, dash: [5, 3],
            }));
            // 零压标签（居中于膜片上方）
            this._mechGroup.add(new Konva.Text({
                x: cx - 28, y: this._memTopY0 - 10,
                width: 56,
                text: '零压位置', fontSize: 7, fill: 'rgba(100,200,255,0.55)',
                fontStyle: 'bold', align: 'center',
            }));
        }

        // ── 上膜片（受推杆压力，向上拱起）──
        // 波纹数：3个半波，模拟同心圆波纹膜片截面
        const wavesTop = this._buildDiaphragmWavePath(cx, topMemY, half, frac, 1);
        this._mechGroup.add(new Konva.Path({
            data: wavesTop,
            fill: 'none', stroke: memCol, strokeWidth: 2, lineCap: 'round',
        }));
        // 上膜片中心高光点
        this._mechGroup.add(new Konva.Circle({
            x: cx, y: topMemY, radius: 3,
            fill: memCol, stroke: memColDark, strokeWidth: 0.8,
        }));

        // ── 下膜片（接触被测介质，向上挠曲）──
        const wavesBot = this._buildDiaphragmWavePath(cx, botMemY, half, frac * 0.75, 1);
        this._mechGroup.add(new Konva.Path({
            data: wavesBot,
            fill: 'none',
            stroke: `rgba(${Math.round(r*0.8)},${Math.round(g*0.8)},${Math.round(b*0.8)},0.55)`,
            strokeWidth: 1.5, lineCap: 'round',
        }));

        // ── 膜腔内气体/介质填充色（上膜片以下到下膜片以上）──
        // 用简化矩形 + 半透明表示受压腔体
        const cavH = Math.max(2, botMemY - topMemY);
        this._mechGroup.add(new Konva.Rect({
            x: x + 2, y: topMemY,
            width: w - 4, height: cavH,
            fill: `rgba(${r},${g},${b},0.08)`,
        }));
        // 腔体内压力/状态标注（腔体足够大时显示）
        if (cavH > 18 && frac > 0.08) {
            this._mechGroup.add(new Konva.Text({
                x: cx - 36, y: (topMemY + botMemY) / 2 - 6,
                width: 72, text: '受压上拱',
                fontSize: 8, fill: `rgba(${Math.min(255,r+40)},${Math.min(255,g+40)},${Math.min(255,b+40)},0.55)`,
                align: 'center', fontStyle: 'bold',
            }));
        }

        // ── 膜片边缘夹持（两侧固定点）──
        [x, x + w].forEach(ex => {
            this._mechGroup.add(new Konva.Rect({
                x: ex - 1.5, y: topMemY - 4,
                width: 3, height: 8,
                fill: '#6a7888', stroke: '#4a5868', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
            this._mechGroup.add(new Konva.Rect({
                x: ex - 1.5, y: botMemY - 4,
                width: 3, height: 8,
                fill: '#6a7888', stroke: '#4a5868', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        });

        // ── 膜片挠度标注箭头（压力 > 10% 时显示）──
        if (frac > 0.10) {
            const arrowX = x - 12;
            const baseY  = this._memTopY0;
            const curY   = topMemY;
            // 箭头从基准线指向当前位置
            this._mechGroup.add(new Konva.Line({
                points: [arrowX, baseY, arrowX, curY + 2],
                stroke: `rgba(${r},${g},${b},0.60)`,
                strokeWidth: 1.5, lineCap: 'round',
            }));
            this._mechGroup.add(new Konva.Line({
                points: [arrowX - 3, curY + 5, arrowX, curY + 1, arrowX + 3, curY + 5],
                stroke: `rgba(${r},${g},${b},0.60)`,
                strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
            }));
            // 箭头顶部标注"δ"
            this._mechGroup.add(new Konva.Text({
                x: arrowX - 14, y: curY - 4,
                text: '\u03B4', fontSize: 7, fill: `rgba(${r},${g},${b},0.70)`,
                fontStyle: 'bold',
            }));
        }
    }

    /**
     * 构建单片膜片的波纹轮廓路径（SVG Path 字符串）
     * 模拟膜片截面：从左边缘到右边缘，经过若干同心波纹，中心向上拱起
     * @param {number} cx      膜片中心 x
     * @param {number} cy      膜片中心当前 y
     * @param {number} half    膜片半径（px）
     * @param {number} frac    压力分数（0~1），决定拱起幅度
     * @param {number} sign    +1=向上拱起，-1=向下拱起
     */
    _buildDiaphragmWavePath(cx, cy, half, frac, sign) {
        // 膜片用3段抛物弧模拟同心波纹：外段、中段、内段
        // 各段最大挠度由内向外递减（中心挠度最大）
        const waveCount  = 3;                       // 波纹数
        const waveW      = half / waveCount;        // 每段宽度
        const baseDefl   = frac * this._maxDefl;    // 中心最大挠度

        let pts = [];
        const steps = 30;                           // 每段采样点数

        for (let w = 0; w < waveCount; w++) {
            // 从外向内（右→左）
            const xOuter = cx + half - w * waveW;
            const xInner = cx + half - (w + 1) * waveW;
            // 每段挠度：内层大，外层小（近似膜片弯曲形状）
            const deflOuter = baseDefl * Math.pow((half - w       * waveW) / half, 1.8);
            const deflInner = baseDefl * Math.pow((half - (w + 1) * waveW) / half, 1.8);
            // 交替波峰/波谷方向（外波向下，次波向上，内波向上）
            const dirOuter = (w % 2 === 0) ?  sign * 0.20 : -sign * 0.20;
            const dirInner = (w % 2 === 0) ? -sign * 0.20 :  sign * 0.20;

            for (let s = 0; s <= steps; s++) {
                const t  = s / steps;
                const xL = xOuter + (xInner - xOuter) * t;
                const xR = cx - (xL - cx);            // 对称右侧
                // 抛物线高度：段内抛物线，两端与相邻段相切
                const parab = 4 * t * (1 - t);
                const deflL = deflOuter * (1 - t) + deflInner * t;
                const yDev  = (dirOuter * (1 - t) + dirInner * t) * waveW * parab;
                const yL    = cy - deflL + yDev;

                if (w === 0 && s === 0) {
                    pts.push(`M${xL.toFixed(1)},${yL.toFixed(1)}`);
                } else {
                    pts.push(`L${xL.toFixed(1)},${yL.toFixed(1)}`);
                }
            }
            // 补充右侧对称路径（逆序）
            for (let s = steps; s >= 0; s--) {
                const t  = s / steps;
                const xL = xOuter + (xInner - xOuter) * t;
                const xR = cx - (xL - cx);
                const parab = 4 * t * (1 - t);
                const deflL = deflOuter * (1 - t) + deflInner * t;
                const yDev  = (dirOuter * (1 - t) + dirInner * t) * waveW * parab;
                const yR    = cy - deflL + yDev;
                pts.push(`L${xR.toFixed(1)},${yR.toFixed(1)}`);
            }
        }
        return pts.join(' ');
    }

    // ── 推杆（垂直，连接膜片中心与连杆）────────────────────
    _drawPushRod(frac, geo) {
        const { topMemY } = geo;
        const cx = this._memCx;
        // 推杆为固定长度刚性杆，从膜片中心向上延伸，跟随膜片同步移动
        const rodBottomY = topMemY;                 // 推杆下端 = 膜片中心（随压力上移）
        const rodTopActY = rodBottomY - this._rodLen; // 推杆上端 = 下端 + 固定长度

        // 推杆主体
        this._mechGroup.add(new Konva.Line({
            points: [cx, rodBottomY, cx, rodTopActY],
            stroke: '#9090a8', strokeWidth: 2.5, lineCap: 'round',
        }));
        // 推杆顶端铰接球
        this._mechGroup.add(new Konva.Circle({
            x: cx, y: rodTopActY, radius: 3.5,
            fill: '#b8b8cc', stroke: '#787898', strokeWidth: 0.8,
        }));
        // 导向槽轮廓（表示推杆穿过上盖的套管）
        const guideH = 10;
        this._mechGroup.add(new Konva.Rect({
            x: cx - 2.5, y: this._memTopY0 - guideH / 2,
            width: 5, height: guideH,
            fill: '#3a4050', stroke: '#6a6a80', strokeWidth: 0.6,
            cornerRadius: 1,
        }));
    }

    // ── 连杆（推杆顶端 → 扇形齿轮臂端）────────────────────
    _drawLink(geo) {
        const { linkTopX, linkTopY, linkBotX, linkBotY } = geo;
        this._mechGroup.add(new Konva.Line({
            points: [linkTopX, linkTopY, linkBotX, linkBotY],
            stroke: '#8090a8', strokeWidth: 2, lineCap: 'round',
        }));
        // 两端铰销
        [{ x: linkTopX, y: linkTopY }, { x: linkBotX, y: linkBotY }].forEach(pt => {
            this._mechGroup.add(new Konva.Circle({
                x: pt.x, y: pt.y, radius: 3,
                fill: '#b0b8c8', stroke: '#707888', strokeWidth: 0.8,
            }));
        });
    }

    // ── 扇形齿轮 ─────────────────────────────────────────────
    _drawSectorGear(geo) {
        const { spx, spy, sectorAng } = geo;
        const sR      = this._sectorR;
        const halfAng = 0.55;

        // 扇形体
        this._mechGroup.add(new Konva.Wedge({
            x: spx, y: spy,
            radius: sR,
            angle: (halfAng * 2) * 180 / Math.PI,
            rotation: -(sectorAng + halfAng) * 180 / Math.PI,
            fill: 'rgba(100,120,160,0.22)',
            stroke: '#6070a0', strokeWidth: 1,
        }));
        // 轮齿（7颗）
        const teethN = 7;
        for (let i = 0; i <= teethN; i++) {
            const a  = (sectorAng - halfAng) + (i / teethN) * halfAng * 2;
            const rx = spx + sR       * Math.cos(-a);
            const ry = spy + sR       * Math.sin(-a);
            const tx = spx + (sR + 4) * Math.cos(-a);
            const ty = spy + (sR + 4) * Math.sin(-a);
            this._mechGroup.add(new Konva.Line({
                points: [rx, ry, tx, ty],
                stroke: '#7080b0', strokeWidth: 1.4, lineCap: 'round',
            }));
        }
        // 轴心圆
        this._mechGroup.add(new Konva.Circle({
            x: spx, y: spy, radius: 3.5,
            fill: '#404860', stroke: '#7080a0', strokeWidth: 0.8,
        }));
    }

    // ── 游丝（螺旋弹簧，绘制在指针轴周围）──────────────────
    _drawHairSpring(frac) {
        const cx = this._hairCx, cy = this._hairCy;
        const turns = 2.5;
        const r0    = this._R * 0.04;
        const r1    = this._R * 0.11;
        const pts   = [];
        const steps = 80;
        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            const ang = t * turns * Math.PI * 2 + frac * 0.8;
            const r   = r0 + (r1 - r0) * t;
            pts.push(cx + r * Math.cos(ang));
            pts.push(cy + r * Math.sin(ang));
        }
        this._mechGroup.add(new Konva.Line({
            points: pts,
            stroke: 'rgba(130,150,180,0.55)', strokeWidth: 0.7,
            lineCap: 'round', lineJoin: 'round', tension: 0.4,
        }));
    }

    // ── 动态层：指针 ──────────────────────────────────────────
    _drawNeedleLayer() {
        this._needleGroup = new Konva.Group();
        this.group.add(this._needleGroup);
        this._rebuildNeedle();
    }

    _rebuildNeedle() {
        this._needleGroup.destroyChildren();
        const frac        = Math.max(0, Math.min(1, this._pressure / this.rangeMax));
        const needleAngDeg = -(this._dialAngStart) + this._dialAngEnd * frac;
        const needleAngRad = needleAngDeg * Math.PI / 180;

        const cx   = this._cx, cy = this._cy;
        const nLen = this._needleLen, nTail = this._needleTail;
        const nW   = this._R * 0.025;

        const nx1 = cx + nLen  * Math.cos(needleAngRad);
        const ny1 = cy + nLen  * Math.sin(needleAngRad);
        const nx2 = cx - nTail * Math.cos(needleAngRad);
        const ny2 = cy - nTail * Math.sin(needleAngRad);

        const perpAng = needleAngRad + Math.PI / 2;
        const wx = nW * Math.cos(perpAng);
        const wy = nW * Math.sin(perpAng);
        const mxPos = cx + (nLen * 0.12) * Math.cos(needleAngRad);
        const myPos = cy + (nLen * 0.12) * Math.sin(needleAngRad);

        const col = frac >= 0.80 ? '#e04030' : frac >= 0.60 ? '#c08020' : '#c82010';

        // 指针阴影
        this._needleGroup.add(new Konva.Line({
            points: [nx2 + 1.5, ny2 + 1.5, nx1 + 1.5, ny1 + 1.5],
            stroke: 'rgba(0,0,0,0.30)', strokeWidth: 3, lineCap: 'round',
        }));
        // 指针主体（菱形有宽腰）
        this._needleGroup.add(new Konva.Line({
            points: [
                nx2, ny2,
                mxPos + wx, myPos + wy,
                nx1, ny1,
                mxPos - wx, myPos - wy,
            ],
            closed: true,
            fill: col,
            stroke: frac >= 0.80 ? '#901010' : '#a01008',
            strokeWidth: 0.5,
        }));
        // 指针高光
        this._needleGroup.add(new Konva.Line({
            points: [mxPos + wx * 0.3, myPos + wy * 0.3, nx1, ny1],
            stroke: 'rgba(255,180,160,0.30)', strokeWidth: 1.5, lineCap: 'round',
        }));
    }

    // ── 压圈（表盖边框）──────────────────────────────────────
    _drawBezel() {
        const cx = this._cx, cy = this._cy, R = this._R;
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 5,
            fill: 'transparent', stroke: '#5a5a62', strokeWidth: 2.5,
        }));
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 2,
            fill: 'transparent', stroke: '#3a3a40', strokeWidth: 1,
        }));
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R + 3, outerRadius: R + 6,
            angle: 100, rotation: -220,
            fill: 'rgba(255,255,255,0.10)',
        }));
    }

    // ── 中心轴帽 ─────────────────────────────────────────────
    _drawCenterCap() {
        const cx = this._cx, cy = this._cy;
        const r  = this._R * 0.055;
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#3a3840', stroke: '#5a5860', strokeWidth: 1,
        }));
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.40,
            fill: '#7a7888',
        }));
    }

    // ── 位号标注 ─────────────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  0 ~ ${this.rangeMax} ${this.rangeUnit}`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 结构标注 + 工作原理说明（中文，与波登管风格一致）───
    _drawComponentLabels() {
        const cx = this._cx, cy = this._cy, R = this._R;
        const W = this.width;
        const H = this.height;

        // 标注项：[文本, 目标x, 目标y, 标签x, 标签y, 颜色]
        const items = [
            { text: '膜片',     tx: cx,                           ty: this._memTopY0,               lx: 4,               ly: this._capsuleY + 8,     color: '#2196F3' },
            { text: '推杆',     tx: this._memCx,                  ty: this._memTopY0 - this._rodLen * 0.5, lx: W - 66,  ly: this._capsuleY - 8,     color: '#4CAF50' },
            { text: '连杆',     tx: cx,                           ty: this._cy + R*0.15,            lx: 4,               ly: this._cy + R*0.02,      color: '#FF9800' },
            { text: '扇形齿轮', tx: this._sectorPivotX + 6,       ty: this._sectorPivotY,           lx: W - 74,          ly: this._sectorPivotY - 8, color: '#9C27B0' },
            { text: '指针',     tx: cx - R*0.40,                  ty: cy - R*0.50,                  lx: W - 62,          ly: cy - R*0.68,            color: '#F44336' },
        ];

        items.forEach(item => {
            // 目标标记点
            this.group.add(new Konva.Circle({
                x: item.tx, y: item.ty, radius: 2,
                fill: item.color, listening: false,
            }));
            // 标签
            const tag = new Konva.Tag({
                fill: item.color, cornerRadius: 3, opacity: 0.12,
            });
            const text = new Konva.Text({
                text: item.text, fontSize: 9, fill: item.color,
                padding: 2, fontStyle: 'bold',
            });
            const label = new Konva.Label({ x: item.lx, y: item.ly });
            label.add(tag);
            label.add(text);
            this.group.add(label);
            // 引线
            const dx = (item.lx + 5) - item.tx;
            const dy = (item.ly + 5) - item.ty;
            if (dx*dx + dy*dy > 400) {
                this.group.add(new Konva.Line({
                    points: [item.tx + 3, item.ty, item.lx + 5, item.ly + 5],
                    stroke: item.color, strokeWidth: 0.6, opacity: 0.35,
                    dash: [2, 3], listening: false,
                }));
            }
        });

        // ── 工作原理说明（状态指示下方）──
        this.group.add(new Konva.Text({
            x: R*0.20, y: cy + R*0.72 + 8,
            width: W - R*0.40,
            text: '压力→膜片变形→推杆→连杆→扇形齿轮→指针偏转',
            fontSize: 7, fill: '#78909c', align: 'center',
        }));
    }

    // ── 状态指示（表壳下半部）───────────────────────────────
    _drawStatusIndicator() {
        const cx = this._cx, cy = this._cy, R = this._R;
        const ix = cx - R * 0.70;
        const iy = cy + R * 0.65;

        const frac        = this._pressure / this.rangeMax;
        const overPressure = frac >= 0.80;
        const col  = frac >= 0.80 ? '#ef5350' : frac >= 0.60 ? '#ffa726' : '#66bb6a';
        const scol = frac >= 0.80 ? '#c62828' : frac >= 0.60 ? '#e65100' : '#2e7d32';
        const text = frac >= 0.80 ? '过压' : frac >= 0.60 ? '注意' : '正常';

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: col, stroke: scol, strokeWidth: 0.8,
            shadowColor: col, shadowBlur: overPressure ? 6 : 2, shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text, fontSize: 8, fontStyle: 'bold', fill: col,
        });
        this.group.add(this._statusDot, this._statusText);

        // 压力读数
        this._readout = new Konva.Text({
            x: cx - R * 0.35, y: iy - 5,
            width: R * 0.70,
            text: `${this._pressure.toFixed(1)} ${this.rangeUnit}`,
            fontSize: 9, fontStyle: 'bold',
            fill: frac >= 0.80 ? '#ef5350' : '#4a5a64',
            align: 'center',
        });
        this.group.add(this._readout);
    }

    // ── 点击交互 ─────────────────────────────────────────────
    _bindInteraction() {
        // 点击表盘：压力步进 +10%
        this.group.on('click tap', () => this.step());
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT     = 1;
            this._animating = false;
            this._pressure  = this._pressTo;
        }

        // 正弦缓动（ease in-out），模拟膜片弹性响应手感
        const ease     = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._pressure = this._pressFrom + (this._pressTo - this._pressFrom) * ease;

        this._rebuildMechanism();
        this._rebuildNeedle();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const frac = this._pressure / this.rangeMax;
        const col  = frac >= 0.80 ? '#ef5350' : frac >= 0.60 ? '#ffa726' : '#66bb6a';
        const scol = frac >= 0.80 ? '#c62828' : frac >= 0.60 ? '#e65100' : '#2e7d32';
        const text = frac >= 0.80 ? '过压' : frac >= 0.60 ? '注意' : '正常';

        if (this._statusDot) {
            this._statusDot.fill(col);
            this._statusDot.stroke(scol);
            this._statusDot.shadowColor(col);
            this._statusDot.shadowBlur(frac >= 0.80 ? 6 : 2);
        }
        if (this._statusText) {
            this._statusText.text(text);
            this._statusText.fill(col);
        }
        if (this._readout) {
            this._readout.text(`${this._pressure.toFixed(1)} ${this.rangeUnit}`);
            this._readout.fill(frac >= 0.80 ? '#ef5350' : '#4a5a64');
        }
    }

    // ═══════════════════════════════════════════
    /** 施加目标压力（kPa），带动画过渡 */
    applyPressure(value) {
        const target = Math.max(0, Math.min(this.rangeMax, value));
        if (Math.abs(target - this._pressure) < 0.01) return;
        this._pressFrom = this._pressure;
        this._pressTo   = target;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 压力步进 +10% 量程（点击时调用） */
    step() {
        if (this._animating) return;
        const stepVal = this.rangeMax * 0.10;
        const next    = this._pressure + stepVal > this.rangeMax
            ? 0
            : this._pressure + stepVal;
        this.applyPressure(next);
    }

    /** 归零（带动画） */
    zero() {
        this.applyPressure(0);
    }

    /** 当前压力值（kPa） */
    getPressure()    { return this._pressure; }

    /** 是否处于过压状态（≥80% 量程） */
    isOverPressure() { return this._pressure / this.rangeMax >= 0.80; }

    /** 当前膜片中心挠度（mm，仿真值） */
    getDeflection()  {
        return (this._pressure / this.rangeMax * this._maxDefl).toFixed(2);
    }

    isAnimating()    { return this._animating; }
    getOpsCount()    { return this.opsCount; }

    update(state) {
        if (typeof state === 'number') {
            this.applyPressure(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',        type: 'text'   },
            { label: '量程上限',        key: 'rangeMax',     type: 'number' },
            { label: '单位',            key: 'rangeUnit',    type: 'text'   },
            { label: '刻度主分格数',    key: 'dialDivs',     type: 'number' },
            { label: '当前压力',        key: 'initPressure', type: 'number' },
            { label: '动作时间 (s)',    key: 'animDur',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label     = cfg.label;
        if (cfg.rangeUnit    !== undefined) this.rangeUnit = cfg.rangeUnit;
        if (cfg.rangeMax     !== undefined) this.rangeMax  = parseFloat(cfg.rangeMax)  || this.rangeMax;
        if (cfg.dialDivs     !== undefined) this.dialDivs  = parseInt(cfg.dialDivs)    || this.dialDivs;
        if (cfg.animDur      !== undefined) this._animDur  = parseFloat(cfg.animDur)   || this._animDur;
        if (cfg.initPressure !== undefined) {
            const p = parseFloat(cfg.initPressure);
            if (!isNaN(p)) this.applyPressure(p);
        }
        this.config = { ...this.config, ...cfg };

        // 重建所有静态层（量程/单位变化需重绘刻度盘）
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._readout    = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}