import { BaseComponent } from './BaseComponent.js';

/**
 * 三相异步电动机（3D 立体造型，Three-Phase Induction Motor 3D）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（转子/风扇旋转、运行状态）全部 in-place 更新，不重建节点
 *  2. 不使用 shadowColor/shadowBlur/shadowOpacity，避免离屏阴影
 *  3. 静态部件（3D 机身、底座、端盖、接线盒、端子）init 时缓存一次
 *  4. 旋转指示器位于 _rotorGroup 内整体旋转
 *  5. PE 保护接地导线为"活动黄绿相间导线"，随组件移动自动重绘
 * ═══════════════════════════════════════════════════════════
 *
 * ── 3D 立体造型 ─────────────────────────────────────────────
 *  采用斜二测（oblique）投影的 3D 盒体：
 *  │
 *  ├─ 顶面（后上方退缩的平行四边形，浅色）    ← 产生高度方向纵深
 *  ├─ 左侧面（后上方退缩，暗色）             ← 产生宽度方向纵深
 *  ├─ 前面（主正面，圆角矩形 + 冷却筋）      ← 最大面
 *  ├─ 右前端盖（圆形散热/风扇罩，可旋转）    ← 快速转动效果
 *  ├─ 底座（3D 安装底板 + 地脚螺栓）
 *  └─ 接线盒（顶部小 3D 盒，含 U/V/W 端子）
 *
 * ── 端口 ────────────────────────────────────────────────────
 *  u, v, w → 三相进线（接线盒顶部引出）
 *  pe      → 保护接地端子（机座侧，黄绿导线 → 电机控制箱 PE1）
 *
 * ── 三相通电检测 ────────────────────────────────────────────
 *  读取 U/V/W 三相对地电压，两两差分得到线电压。
 *  三相线电压均 > 阈值时判定"三相通电" → 转子/风扇快速旋转，
 *  显示运行状态、相序、转速。
 */
export class ThreePhaseMotor3D extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(220, config.width  || 300);
        this.height = Math.max(210, config.height || 250);

        this.type    = 'motor_3d';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            ratedPower:   this.ratedPower,
            ratedVoltage: this.ratedVoltage,
            ratedSpeed:   this.ratedSpeed,
            cosphi:       this.cosphi,
        };

        this._addPorts();
        this._setupDynamicWire();
    }

    // ═══════════════════════════════════════════
    // 几何与参数
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 水平圆柱形机身 ─────────────────────────────
        // 电机横躺圆柱，轴沿水平方向：右侧为前向风扇端盖（正圆），
        // 左侧为远侧圆端（退缩椭圆），圆柱面用竖向渐变模拟圆润感。
        this._cylR  = Math.max(42, Math.min(H * 0.27, W * 0.24));
        this._cylCY = 58 + this._cylR;          // 机身中心 y（上方留接线盒空间）
        this._cylX1 = 24;                        // 左远侧圆端中心
        this._cylX2 = W - 26;                    // 右前向风扇端盖中心

        // 右侧前向端盖（正圆，含旋转风扇）＝ 圆柱右端面
        this._bellCX = this._cylX2;
        this._bellCY = this._cylCY;
        this._bellR  = this._cylR;

        // 转轴（从右端盖中心伸出）
        this._frontRight = this._cylX2;
        this._shaftW = 14;
        this._shaftH = Math.max(10, this._cylR * 0.18);
        this._shaftY = this._cylCY - this._shaftH / 2 - 2;

        // 底座（3D 安装板，位于圆柱下方）
        this._baseY = this._cylCY + this._cylR + 6;
        this._baseH = Math.max(18, H - this._baseY - 4);
        this._baseX = this._cylX1 - 16;
        this._baseW = (this._cylX2 - this._cylX1) + 34;

        // 接线盒（顶部小 3D 盒，置于圆柱顶面）
        const tbW = 78, tbH = 30;
        this._tbX = this._cylX1 + 22;
        this._tbY = (this._cylCY - this._cylR) - tbH + 2;
        this._tbW = tbW;
        this._tbH = tbH;

        // U/V/W 端子（接线盒顶面三点）与顶部引出端口
        this._termY = this._tbY - 4;
        this._termXs = [
            this._tbX + 16,
            this._tbX + tbW / 2,
            this._tbX + tbW - 16,
        ];
        this._termColors = ['#e03030', '#20a030', '#2050e0'];
        this._termNames = ['U', 'V', 'W'];

        // 顶部端口（接线引出到组件上缘）
        this._portU = { x: this._termXs[0], y: 3 };
        this._portV = { x: this._termXs[1], y: 3 };
        this._portW = { x: this._termXs[2], y: 3 };

        // PE 端子（机身左下方，黄绿）
        this._peX = this._cylX1 + 8;
        this._peY = this._cylCY + this._cylR - 26;

        this._termR = Math.max(6, W * 0.022);
    }

    _initParameters(config) {
        this.label        = config.label        || 'M1';
        this.ratedPower   = config.ratedPower   !== undefined ? config.ratedPower   : 5.5;   // kW
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 380;
        this.ratedSpeed   = config.ratedSpeed   !== undefined ? config.ratedSpeed   : 1440; // r/min
        this.cosphi       = config.cosphi       !== undefined ? config.cosphi       : 0.85;
        this.function     = config.function     || '三相异步电动机（3D）';

        // 旋转动画状态
        this._rotorAngle = 0;
        this._powered    = false;
        this._phaseSeq   = 0;      // 1 正序(UVW) / -1 逆序 / 0 无
        this._lastVu = 0; this._lastVv = 0; this._lastVw = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._addHitArea();
        this._addClickableParts();
    }

    /**
     * 透明命中层：机身绘制节点均为 listening:false（不参与命中检测），
     * 仅 4 个端口可命中导致机身大面积无法点击/拖动。
     * 在 group 最底层放置透明矩形覆盖整个机体，使任意位置都可命中拖动，
     * 且 z 序在端口之下，不遮挡连线交互。
     */
    _addHitArea() {
        if (this._hitRect) return;
        this._hitRect = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#ffffff', opacity: 0.002,
            listening: true,
        });
        // 在端口加入 group 之前插入，沉入最底层
        this.group.add(this._hitRect);
        this._hitRect.moveToBottom();
    }

    // ═══════════════════════════════════════════
    // 可点击部件（供工作流 find 步骤识别）
    // ═══════════════════════════════════════════

    _addClickableParts() {
        // 机座 PE 保护接地端子（电气端口点击会拦截热区，放大范围）
        this.addClickablePart('pe-terminal', this._peX - 24, this._peY - 24, 48, 48, true);
        // U/V/W 三相接线端子（整体识别区）
        const tr = this._termR;
        this.addClickablePart('term-uvw', this._termXs[0] - tr - 6, this._termY - tr - 6, (this._termXs[2] - this._termXs[0]) + (tr + 6) * 2, (tr + 6) * 2);
    }

    getClickablePartCenter(partId) {
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const rel = {
            'pe-terminal': { x: this._peX, y: this._peY },
            'term-uvw': { x: (this._termXs[0] + this._termXs[2]) / 2, y: this._termY },
        };
        const p = rel[partId];
        return p ? { x: gx + p.x, y: gy + p.y } : null;
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════

    _addPorts() {
        this.addPort(this._portU.x, this._portU.y, 'u', 'wire', 'p');
        this.addPort(this._portV.x, this._portV.y, 'v', 'wire', 'p');
        this.addPort(this._portW.x, this._portW.y, 'w', 'wire', 'p');
        this.addPort(this._peX, this._peY, 'pe', 'wire', 'n');
    }

    getPhasePort(n) { return `${this.id}_wire_${['u','v','w'][n]}`; }
    getPePortId()   { return `${this.id}_wire_pe`; }

    // ═══════════════════════════════════════════
    // 静态部件（3D）
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawBase();
        this._drawFarCap();
        this._drawCylinderBody();
        this._drawTerminalBox();
        this._drawPeTerminal();
        this._drawLabel();
    }

    /** 底座（3D 安装板：顶面 + 前面 + 地脚螺栓） */
    _drawBase() {
        const s = this._staticGroup;
        const bx = this._baseX, bw = this._baseW, by = this._baseY, bh = this._baseH;
        const px = -Math.max(14, this.width * 0.05), py = -Math.max(16, this.height * 0.06);

        // 底座顶面（前上方退缩，浅色）
        s.add(new Konva.Line({
            points: [bx, by, bx + bw, by, bx + bw + px, by + py, bx + px, by + py],
            closed: true, fill: '#9aa0aa',
            listening: false,
        }));
        // 底座前面（深灰）
        s.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: bh },
            fillLinearGradientColorStops: [0, '#6a7078', 1, '#464b52'],
            listening: false,
        }));
        // 底座分档线 + 地脚螺栓（4 个）
        const nFeet = 4;
        for (let i = 0; i < nFeet; i++) {
            const fx = bx + (bw / (nFeet - 1)) * i;
            s.add(new Konva.Circle({
                x: fx, y: by + bh / 2, radius: 4,
                fill: '#c0c4c8', stroke: '#3a3f45', strokeWidth: 1, listening: false,
            }));
            s.add(new Konva.Rect({
                x: fx - 3, y: by - py - 10, width: 6, height: 12,
                fill: '#8a9098', stroke: '#5c636a', strokeWidth: 0.8, listening: false,
            }));
        }
    }

    /** 远侧（左端）圆端面：退缩椭圆，表现圆柱纵向深度 */
    _drawFarCap() {
        const s = this._staticGroup;
        const cx = this._cylX1, cy = this._cylCY, r = this._cylR;
        // 远侧圆端（中心退缩，仅左侧半圆可见，暗色）
        s.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: r * 0.40, radiusY: r,
            fillLinearGradientStartPoint: { x: 0, y: cy - r },
            fillLinearGradientEndPoint:   { x: 0, y: cy + r },
            fillLinearGradientColorStops: [0, '#27405f', 0.5, '#41608c', 1, '#22384f'],
            stroke: '#1e3248', strokeWidth: 1.2, listening: false,
        }));
        // 远侧圆端高光弧（左缘）
        s.add(new Konva.Arc({
            x: cx, y: cy, innerRadius: r * 0.3, outerRadius: r * 0.3,
            angle: 180, rotation: 180, fill: 'rgba(255,255,255,0.28)',
            stroke: 'rgba(255,255,255,0.4)', strokeWidth: 2, listening: false,
        }));
    }

    /** 圆柱机身（水平圆柱：竖向渐变 + 顶部高光 + 冷却筋） */
    _drawCylinderBody() {
        const s = this._staticGroup;
        const x1 = this._cylX1, x2 = this._cylX2, cy = this._cylCY, r = this._cylR;
        const bw = x2 - x1;

        // 圆柱体（竖向明暗渐变表现圆润柱面）
        s.add(new Konva.Rect({
            x: x1, y: cy - r, width: bw, height: r * 2,
            fillLinearGradientStartPoint: { x: 0, y: cy - r },
            fillLinearGradientEndPoint:   { x: 0, y: cy + r },
            fillLinearGradientColorStops: [0, '#35527f', 0.22, '#6d96c8', 0.5, '#7ba6d8', 0.78, '#5b82b7', 1, '#2e4a75'],
            stroke: '#2c4470', strokeWidth: 1.5, listening: false,
        }));
        // 顶部高光（顺柱轴延伸，增强圆润感）
        s.add(new Konva.Line({
            points: [x1 + 3, cy - r + 2.5, x2 - 3, cy - r + 2.5],
            stroke: 'rgba(255,255,255,0.45)', strokeWidth: 2.5, lineCap: 'round', listening: false,
        }));
        // 底部阴影
        s.add(new Konva.Line({
            points: [x1 + 3, cy + r - 2.5, x2 - 3, cy + r - 2.5],
            stroke: 'rgba(20,36,60,0.35)', strokeWidth: 2, lineCap: 'round', listening: false,
        }));

        // 冷却散热筋（顺柱轴方向的横向脊线，表现圆柱表面凸起）
        const finY = [0.30, 0.44, 0.58];
        for (const f of finY) {
            const yy = cy - r + (r * 2) * f;
            s.add(new Konva.Line({
                points: [x1 + 8, yy, x2 - 8, yy],
                stroke: 'rgba(28,48,80,0.35)', strokeWidth: 3, lineCap: 'round', listening: false,
            }));
        }
    }

    /** 接线盒（顶部 3D 盒） */
    _drawTerminalBox() {
        const s = this._staticGroup;
        const x = this._tbX, y = this._tbY, w = this._tbW, h = this._tbH;
        const lpx = -Math.max(12, this.width * 0.05), lpy = -Math.max(14, this.height * 0.05);

        // 接线盒顶面（依据投影退缩）
        s.add(new Konva.Line({
            points: [x, y, x + w, y, x + w + lpx * 0.5, y + lpy * 0.5, x + lpx * 0.5, y + lpy * 0.5],
            closed: true, fill: '#a8adb6', listening: false,
        }));
        // 接线盒前面
        s.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 3,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#c8ccd2', 1, '#9aa0a8'],
            stroke: '#7a8088', strokeWidth: 1.2, listening: false,
        }));

        // 接线盒上盖分线（四周小螺钉）
        s.add(new Konva.Circle({ x: x + 4, y: y + 4, radius: 1.8, fill: '#666c74', listening: false }));
        s.add(new Konva.Circle({ x: x + w - 4, y: y + 4, radius: 1.8, fill: '#666c74', listening: false }));

        // 引出线（端子 → 顶部端口，红/绿/蓝三色）
        this._termXs.forEach((tx, i) => {
            const c = this._termColors[i];
            // 金属接线柱（连接盒体顶部到 U/V/W 母线）
            s.add(new Konva.Line({
                points: [tx, y + h, tx, this._termY],
                stroke: c, strokeWidth: 3, lineCap: 'round', listening: false,
            }));
            // 从端子到顶部的引出线
            s.add(new Konva.Line({
                points: [tx, this._termY, tx, 3],
                stroke: c, strokeWidth: 2.5, listening: false,
            }));
            // 刻接线柱（金属圆盘）
            s.add(new Konva.Circle({
                x: tx, y: this._termY, radius: this._termR * 0.55,
                fillLinearGradientStartPoint: { x: -5, y: -5 },
                fillLinearGradientEndPoint:   { x:  5, y:  5 },
                fillLinearGradientColorStops: [0, '#8a6a28', 0.5, '#d4ab4f', 1, '#8a6a28'],
                stroke: '#6a5220', strokeWidth: 0.8, listening: false,
            }));
            // 标签 U / V / W
            s.add(new Konva.Text({
                x: tx - 12, y: this._termY + this._termR * 0.55 + 1,
                text: this._termNames[i], fontSize: Math.max(12, this.width * 0.045),
                fontStyle: 'bold', fill: c, listening: false,
            }));
        });
    }

    /** PE 保护接地端子（机座左侧下方，黄绿） */
    _drawPeTerminal() {
        const s = this._staticGroup;
        const R = this._termR, x = this._peX, y = this._peY;
        // 黄绿色接地端子
        s.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [0, '#b8a020', 0.5, '#f0d34e', 1, '#8a7a1c'],
            stroke: '#6a5e1a', strokeWidth: 1.2, listening: false,
        }));
        s.add(new Konva.Circle({ x, y, radius: R * 0.42, fill: '#3a4a20', listening: false }));
        // 黄绿导线标志（一小段在端子下方）
        for (let i = 0; i < 4; i++) {
            s.add(new Konva.Line({
                points: [x - R, y + R + 3 + i * 3, x + R, y + R + 3 + i * 3],
                stroke: i % 2 === 0 ? '#f4c542' : '#20a030',
                strokeWidth: 2.4, lineCap: 'round', listening: false,
            }));
        }
        // 标签
        s.add(new Konva.Text({
            x: x - R - 2, y: y - R - 16,
            text: 'PE', fontSize: Math.max(13, this.width * 0.05),
            fontStyle: 'bold', fill: '#3a7a2a', listening: false,
        }));
    }

    /** 铭牌标签 */
    _drawLabel() {
        const s = this._staticGroup;
        const x = this._cylX1 + 4, y = this._baseY + this._baseH - 26;
        const fs = Math.max(12, this.width * 0.045);
        s.add(new Konva.Text({
            x, y: y - fs - 2,
            text: `${this.label}  三相电动机`,
            fontSize: fs, fontStyle: 'bold', fill: '#1c2c4c', listening: false,
        }));
        s.add(new Konva.Text({
            x, y,
            text: `${this.ratedPower}kW  ${this.ratedVoltage}V  ${this.ratedSpeed}rpm`,
            fontSize: Math.max(11, this.width * 0.04), fill: '#33455f', listening: false,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createBell();
        this._createShaft();
        this._createStatus();
        this._createPeWireSegs();
    }

    /** 右前端盖：圆形散热罩 + 转子/风扇标记（快速旋转） */
    _createBell() {
        const cx = this._bellCX, cy = this._bellCY, r = this._bellR;
        const d = this._dynamicGroup;

        // 端盖环（金属）
        d.add(new Konva.Ring({
            x: cx, y: cy, innerRadius: r * 0.88, outerRadius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#d8dbe0', 0.5, '#9aa0a8', 1, '#c8ccd2'],
            stroke: '#7a8088', strokeWidth: 1, listening: false,
        }));
        // 端盖内部深色（散热孔背景）
        d.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.88,
            fill: '#3c4248', listening: false,
        }));

        // 转子/风扇旋转组（核心快速转动效果）
        this._rotorGroup = new Konva.Group({ x: cx, y: cy, rotation: 0, listening: false });

        // 风扇叶片（6 片，放射状）—— 快速旋转时产生视觉转动
        const bladeN = 6;
        const rO = r * 0.80, rI = r * 0.30, bladeW = Math.PI / bladeN * 0.7;
        for (let i = 0; i < bladeN; i++) {
            const a0 = (i / bladeN) * Math.PI * 2;
            const pts = [];
            const seg = 12;
            for (let k = 0; k <= seg; k++) {
                const a = a0 - bladeW + (2 * bladeW) * (k / seg);
                pts.push(rI * Math.cos(a), rI * Math.sin(a));
            }
            for (let k = seg; k >= 0; k--) {
                const a = a0 - bladeW + (2 * bladeW) * (k / seg);
                pts.push(rO * Math.cos(a), rO * Math.sin(a));
            }
            // 叶片（带一定不透明度以示金属扇叶）
            this._rotorGroup.add(new Konva.Line({
                points: pts, closed: true,
                fill: i % 2 === 0 ? 'rgba(210,216,224,0.9)' : 'rgba(150,156,166,0.9)',
                stroke: '#6a7076', strokeWidth: 0.5, listening: false,
            }));
        }
        // 中心毂 + 一个醒目的旋转标记线（便于观察转速）
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r * 0.20,
            fillLinearGradientStartPoint: { x: -r * 0.2, y: -r * 0.2 },
            fillLinearGradientEndPoint:   { x:  r * 0.2, y:  r * 0.2 },
            fillLinearGradientColorStops: [0, '#e8eaee', 0.5, '#a8adb6', 1, '#c8ccd2'],
            stroke: '#666c74', strokeWidth: 1, listening: false,
        }));
        this._rotorGroup.add(new Konva.Line({
            points: [0, -r * 0.16, 0, r * 0.16],
            stroke: '#e03030', strokeWidth: 4, lineCap: 'round', listening: false,
        }));

        d.add(this._rotorGroup);

        // 端盖固定螺丝（静态，均匀分布）
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            d.add(new Konva.Circle({
                x: cx + r * 0.94 * Math.cos(a), y: cy + r * 0.94 * Math.sin(a),
                radius: 2.2, fill: '#d8dbe0', stroke: '#7a8088', strokeWidth: 0.6, listening: false,
            }));
        }
    }

    /** 转轴（端盖中心右侧伸出，带键槽） */
    _createShaft() {
        const d = this._dynamicGroup;
        const x0 = this._bellCX + this._bellR * 0.90;
        const x1 = this._frontRight + 20;
        const shY = this._shaftY, shH = this._shaftH;
        // 轴体
        d.add(new Konva.Rect({
            x: x0, y: shY, width: x1 - x0, height: shH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: shH },
            fillLinearGradientColorStops: [0, '#e8eaee', 0.5, '#b8bdc4', 1, '#c8ccd2'],
            stroke: '#8a9098', strokeWidth: 1, listening: false,
        }));
        // 键槽
        d.add(new Konva.Rect({
            x: x0 + 3, y: shY + shH - 6, width: 8, height: 4,
            fill: '#6a7076', stroke: '#5c636a', strokeWidth: 0.6, listening: false,
        }));
        // 轴端中心点
        d.add(new Konva.Circle({
            x: x1, y: shY + shH / 2, radius: 3,
            fill: '#c8ccd2', stroke: '#7a8088', strokeWidth: 1, listening: false,
        }));
    }

    /** 转速显示（右下角动态读数） */
    _createStatus() {
        const d = this._dynamicGroup;
        const cx = this._cylX2, cy = this._cylCY, r = this._cylR;
        const fs = Math.max(12, this.width * 0.042);

        this._speedText = new Konva.Text({
            x: cx - r + 6, y: cy + r + 8, text: '转速: 0 r/min',
            fontSize: fs, fontStyle: 'bold', fill: '#2a8a3a', listening: false,
        });
        d.add(this._speedText);
    }

    /** 活动黄绿 PE 导线线段（由 tick 沿直线排布） */
    _createPeWireSegs() {
        // 先在 _dynamicGroup 中无连接时不建立线段，由 _setupDynamicWire 建立
        this._wireSegs = [];
    }

    // ═══════════════════════════════════════════
    // 活动 PE 黄绿导线
    // ═══════════════════════════════════════════

    /** 查找与电机 PE 端子相连的活动黄绿导线（custom 标记），并创建黄绿线段 */
    _setupDynamicWire() {
        this._targetCompId = null;
        this._targetPortId = null;
        this._peerPortId = this.getPePortId();
        if (!this.sys || !this.sys.conns) { this._wireSegs = []; return; }

        const peer = this._peerPortId;
        const conn = this.sys.conns.find(c => c.type === 'wire' && c.custom &&
            (c.from === peer || c.to === peer));
        if (!conn) { this._wireSegs = []; return; }

        this._targetPortId = conn.from === peer ? conn.to : conn.from;
        this._targetCompId = (this._targetPortId.split('_wire_')[0] || this._targetPortId.split('_')[0]);

        const N = 16;
        for (let i = 0; i < N; i++) {
            const isYellow = i % 2 === 0;
            const seg = new Konva.Line({
                points: [0, 0, 0, 0],
                stroke: isYellow ? '#f4c542' : '#20a030',
                strokeWidth: 7, lineCap: 'round', listening: false,
            });
            this._dynamicGroup.add(seg);
            this._wireSegs.push(seg);
        }
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 每帧刷新活动黄绿导线（组件拖拽自动重绘） */
    _updateDynamicWire() {
        if (!this._wireSegs || this._wireSegs.length === 0) return;
        const sys = this.sys;
        if (!sys || !sys.comps) return;
        const target = sys.comps[this._targetCompId];
        if (!target || typeof target.getAbsPortPos !== 'function') return;

        const p1 = this.getAbsPortPos(this._peerPortId);
        const p2 = target.getAbsPortPos(this._targetPortId);
        if (!p1 || !p2) return;

        let inv = null;
        try { inv = this.group.getAbsoluteTransform().copy().invert(); } catch (e) { return; }
        const s = inv.point({ x: p1.x, y: p1.y });
        const e = inv.point({ x: p2.x, y: p2.y });

        const N = this._wireSegs.length;
        const dx = e.x - s.x, dy = e.y - s.y;
        for (let i = 0; i < N; i++) {
            const t0 = i / N, t1 = (i + 1) / N;
            this._wireSegs[i].points([s.x + dx * t0, s.y + dy * t0, s.x + dx * t1, s.y + dy * t1]);
        }
    }

    // ═══════════════════════════════════════════
    // 动态更新 / tick
    // ═══════════════════════════════════════════

    _updateDynamic(dt) {
        const solver = this.sys?.voltageSolver;
        const getV = (port) => {
            if (!solver) return 0;
            const ci = solver.portToCluster.get(`${this.id}_wire_${port}`);
            return ci !== undefined ? (solver.nodeVoltages.get(ci) || 0) : 0;
        };
        const Vu = getV('u'), Vv = getV('v'), Vw = getV('w');

        // 三相线电压检测（两两差分）
        const Vuv = Math.abs(Vu - Vv);
        const Vvw = Math.abs(Vv - Vw);
        const Vwu = Math.abs(Vw - Vu);
        const powered = Vuv > 25 && Vvw > 25 && Vwu > 25;

        // 相序检测（内部使用，决定旋转方向，不做显示）
        if (powered) {
            const seq = Vu * (Vv - Vw) + Vv * (Vw - Vu) + Vw * (Vu - Vv);
            this._phaseSeq = seq >= 0 ? 1 : -1;
        } else if (!(Vuv > 15 || Vvw > 15 || Vwu > 15)) {
            this._phaseSeq = 0;
        }

        this._powered = powered;

        // 转速值（正比于线电压幅值简单估算，额定为 ratedSpeed）
        let rpm = 0;
        if (powered) {
            const lineVrms = Math.sqrt((Vuv * Vuv + Vvw * Vvw + Vwu * Vwu) / 3) / Math.sqrt(2);
            const k = Math.min(1.05, Math.max(0, (lineVrms - 20) / (this.ratedVoltage)) );
            rpm = Math.round(this.ratedSpeed * k);
        }

        // 转子/风扇旋转角（快速旋转：通电时高速）
        const visualOmega = powered ? Math.min(this.ratedSpeed, 3000) * 2 * Math.PI / 60 : 0;
        if (powered) {
            this._rotorAngle += visualOmega * dt * (this._phaseSeq < 0 ? -1 : 1);
        }
        this._rotorGroup.rotation((this._rotorAngle * 180 / Math.PI) % 360);

        // 转速显示（仅动态读数，无指示灯/相序指示）
        this._speedText.text(`转速: ${rpm} r/min`);
        this._speedText.fill(powered ? '#2a8a3a' : '#3a7a2a');

        // 活动黄绿导线随组件移动自动重绘
        this._updateDynamicWire();
    }

    tick(dt) {
        // 懒初始化：连接尚未建立时每帧重试
        if ((!this._wireSegs || this._wireSegs.length === 0)
            && this.sys && this.sys.conns && this.sys.conns.length) {
            this._setupDynamicWire();
        }
        this._updateDynamic(dt);
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'label',        type: 'text' },
            { label: '额定功率 (kW)',    key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V)',     key: 'ratedVoltage', type: 'number' },
            { label: '额定转速 (r/min)', key: 'ratedSpeed',   type: 'number' },
            { label: '功率因数',         key: 'cosphi',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedPower   !== undefined) this.ratedPower   = parseFloat(cfg.ratedPower);
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedSpeed   !== undefined) this.ratedSpeed   = parseFloat(cfg.ratedSpeed);
        if (cfg.cosphi       !== undefined) this.cosphi       = parseFloat(cfg.cosphi);

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        // 重建静态缓存
        if (typeof this._refreshCache === 'function') this._refreshCache();
        else if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}
