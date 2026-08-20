import { BaseComponent } from './BaseComponent.js';

/**
 * 兆欧表（绝缘电阻表，Megohmmeter / Megger）紧凑版仿真组件
 *
 * ═══ 特点 ════════════════════════════════════════════════════════
 *  本组件为单面板紧凑布局，仅保留表盘与操作部件：
 *    - L / E（/G）接线柱位于顶部
 *    - 圆形比率型表盘居中
 *    - 手摇手柄位于底部
 *  不含右侧原理剖面图，用于教学场景中侧重"接线与读数"的操作练习。
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════
 *  摇表（兆欧表）测量绝缘电阻，内置手摇直流发电机产生高压直流
 *  （500V/1000V/2500V），流过被测绝缘体的微弱电流由比率型测量机构
 *  检测。表盘刻度反向：左端 ∞（断路），右端 0（短路），与电压无关。
 *
 * ═══ 三端测量 ════════════════════════════════════════════════════
 *  L（LINE/火线端）— 连接被测设备导体
 *  E（EARTH/地端）— 连接被测设备外壳/地
 *  G（GUARD/屏蔽端）— 消除表面漏电影响（高精度测量用）
 *
 * ═══ 端口 ════════════════════════════════════════════════════════
 *  l — L端（LINE，顶部左侧）
 *  e — E端（EARTH，顶部右侧）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════
 *  label       : 仪表标识（默认 'MΩ'）
 *  voltage     : 发电机额定电压 V（默认 500，常用值：500/1000/2500）
 *  resistance  : 被测绝缘电阻 MΩ（默认 ∞，即 Infinity）
 *  cranking    : 是否正在摇动手柄（默认 false）
 *  rampTime    : 指针响应时间常数 s（默认 1.5）
 */
export class RealMegohmMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 310);
        this.height = Math.max(210, config.height || 280);

        this.type    = 'realmegohm';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:      this.label,
            voltage:    this._ratedVoltage,
            resistance: this._targetR,
            cranking:   this._cranking,
            rampTime:   this._rampTime,
            insulSync:  this._insulSync,
        };

        // ── 端口（顶部接线柱下沿）────────────────────────
        this.addPort(this._portL.x, this._portL.y, 'l', 'wire', 'p');
        this.addPort(this._portE.x, this._portE.y, 'e', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        // ── 表盘：上沿直接靠边（金属环顶弧 y=0 贴组件顶边）──
        const fCx = W * 0.50;
        const fR  = Math.min(W * 0.38, H * 0.46) + 30;   // 在基准上加 30px
        const fCy = fR + 10;                   // 金属环外半径 r+7 顶压在 y=0
        this._face = { cx: fCx, cy: fCy, r: fR, capH: 30 };

        // 指针角度（Konva：0°=右，顺时针正）
        // 摇表刻度：右端=0Ω，左端=∞，扫过 170°
        this._angleZero    = 355;   // 0 Ω 时（右上）
        this._angleInf     = 185;   // ∞ Ω 时（左上）
        this._angleSweep   = 170;   // 总扫过角度

        // ── 接线柱：中心正好落在上边缘线 y=0 ────────────
        const termY   = 0;
        const termSp  = W * 0.17;
        this._faceTermL = { x: fCx - termSp, y: termY };
        this._faceTermE = { x: fCx + termSp, y: termY };
        this._faceTermG = { x: fCx,          y: termY };

        // ── 端口（接线柱根部）───────────────────────────
        this._portL = { x: this._faceTermL.x, y:termY };
        this._portE = { x: this._faceTermE.x, y: termY };

        // ── 手柄：紧贴高压警告下方 ───────────────────────
        this._crankR      = Math.min(W * 0.13, H * 0.10);
        const warnFs   = Math.max(8, fR * 0.14);
        this._crankCenter = {
            x: fCx,
            y: fCy + this._face.capH +  warnFs  + this._crankR + 4,
        };
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this.label         = config.label    || 'MΩ';
        this._ratedVoltage = config.voltage  !== undefined ? parseFloat(config.voltage) : 500;
        this._rampTime     = config.rampTime !== undefined ? parseFloat(config.rampTime) : 1.5;

        // 被测电阻（MΩ），Infinity 表示断路（∞）
        const rCfg = config.resistance;
        if (rCfg === undefined || rCfg === null) {
            // 未指定时随机初始停留阻值
            const stops = [5, 10, 20, 50, 100];
            this._targetR = stops[Math.floor(Math.random() * stops.length)];
        } else {
            this._targetR = (rCfg === 'Infinity') ? Infinity : parseFloat(rCfg);
        }
        this._currentR = this._targetR;

        this._cranking     = !!config.cranking;   // 是否在摇动
        this._crankAngle   = 0;                    // 手柄当前角度（度）
        this._genAngle     = 0;                    // 发电机转子角度（保留兼容）
        this._hvActive     = false;                // 高压是否建立

        // 特殊标志：联动绝缘指示灯（本教学例），不显示实际测量值，
        // 而是从绝缘指示灯读取数值（依 L 端口接点映射，见 _resolveInsulSyncR）
        this._insulSync    = !!config.insulSync;

        // 指针角度（初始指向上）
        this._needleAngle  = -90;

        this._warnFlash    = 0;                    // 高压警告闪烁计时
        this._stopValue    = null;                 // 停止后随机停留阻值
    }

    /**
     * 联动绝缘指示灯读数（Ω）解析：
     * 手摇兆欧表在【拉下对应负载开关后】测量某个负载的绝缘：L 端接到该
     * 负载的任意端子（相线端或星点端），E 端接地。
     *
     * 【核心物理】从 L 端口所在电气簇出发，沿
     *   ① 导线 / 开关零阻短接（求解器簇）＋
     *   ② 负载内部导电（白炽灯丝 l↔r、电机绕组 u1↔u2 / v1↔v2 / w1↔w2、
     *      三相可调负载内部星形 l1/l2/l3↔n）
     * 做闭包传播。凡闭包到达的负载相端子都导通，其绝缘电阻【并联】构成
     * 兆欧表读数（等效 = 各导通相绝缘的并联）。
     *
     * 由此自然满足：
     *   - 灯 A/B 相 r 端星点互联 → 搭 A/B 相任意端子（l 或 r）都读到两相
     *     绝缘并联；任一相低 → 测得低值。
     *   - C 相 r 端【未】与 A/B 互联 → 搭 C 相只导通 C 相 → 只读 C 相本身。
     *   - 电机 Y 接（U2/V2/W2 星点互联）→ 搭 U1/V1/W1/U2 任一端都导通三相
     *     → 读到三相绝缘并联；C 相接地 → 全测 0。
     *   - 开关闭合、L 测母线某相 → 该相相线端经母线与同相三路并联 → 读该相
     *     总绝缘（等效 getInsulResistance，但以并联求和统一实现）。
     *   - 未闭包到任何已知负载相端子 → 绝缘良好（∞）。
     * 返回 MΩ（Infinity 表示 ∞）。
     */
    _resolveInsulSyncR() {
        const sv = this.sys && this.sys.voltageSolver;
        const insul = this.sys && this.sys.comps ? this.sys.comps['insul'] : null;
        if (!sv || !insul || typeof insul.getLoadInsul !== 'function') {
            return Infinity;
        }
        try {
            const pId = `${this.id}_wire_l`;
            const cL = sv.portToCluster.get(pId);
            if (cL === undefined || !sv.clusters || !sv.clusters[cL]) return Infinity;
            const sets = sv.clusters;   // Array<Set<string>>：全部簇

            // ── 端口 → [该负载在绝缘指示灯中索引 ld, 相 ph] 映射 ──
            // im01=电机(ld0) / lamp1..3=照明(ld1) / tload=可调(ld2)
            // 相序 A=0, B=1, C=2。n 中性点 / 星点端不单独计相（只用来导通）。
            const portPhase = {
                'im01_wire_u1': [0, 0], 'im01_wire_u2': [0, 0],
                'im01_wire_v1': [0, 1], 'im01_wire_v2': [0, 1],
                'im01_wire_w1': [0, 2], 'im01_wire_w2': [0, 2],
                'lamp1_wire_l': [1, 0], 'lamp1_wire_r': [1, 0],
                'lamp2_wire_l': [1, 1], 'lamp2_wire_r': [1, 1],
                'lamp3_wire_l': [1, 2], 'lamp3_wire_r': [1, 2],
                'tload_wire_l1': [2, 0], 'tload_wire_l2': [2, 1], 'tload_wire_l3': [2, 2],
            };
            // ── 负载【内部导电】边（单相电气导通，非零阻，不计入求解器簇）──
            // No — from wire type conductor. 电机绕组、灯丝、可调星形都属于负载
            // 本体：电流可流过，故两端口视为同一导电网络成员。
            const internalEdge = {
                'im01_wire_u1': ['im01_wire_u2'], 'im01_wire_u2': ['im01_wire_u1'],
                'im01_wire_v1': ['im01_wire_v2'], 'im01_wire_v2': ['im01_wire_v1'],
                'im01_wire_w1': ['im01_wire_w2'], 'im01_wire_w2': ['im01_wire_w1'],
                'lamp1_wire_l': ['lamp1_wire_r'], 'lamp1_wire_r': ['lamp1_wire_l'],
                'lamp2_wire_l': ['lamp2_wire_r'], 'lamp2_wire_r': ['lamp2_wire_l'],
                'lamp3_wire_l': ['lamp3_wire_r'], 'lamp3_wire_r': ['lamp3_wire_l'],
                'tload_wire_l1': ['tload_wire_n'], 'tload_wire_l2': ['tload_wire_n'],
                'tload_wire_l3': ['tload_wire_n'],
                'tload_wire_n': ['tload_wire_l1', 'tload_wire_l2', 'tload_wire_l3'], // 星形：n 同时连往三相
            };
            const isKnown = p => portPhase[p] !== undefined || internalEdge[p] !== undefined;

            // ── 闭包传播：导线簇 ∪ 负载内部导电 ──
            const seen = new Set();
            const stack = [...sets[cL]];
            while (stack.length) {
                const p = stack.pop();
                if (seen.has(p) || !isKnown(p)) continue;
                seen.add(p);
                // ① 负载内部导电边
                const nxList = internalEdge[p];
                if (nxList) {
                    for (const nx of nxList) {
                        if (isKnown(nx) && !seen.has(nx)) stack.push(nx);
                    }
                }
                // ② 所在电气簇（导线 / 开关零阻短接）扩展
                const c = sv.portToCluster.get(p);
                if (c !== undefined && sets[c]) {
                    for (const q of sets[c]) if (!seen.has(q) && isKnown(q)) stack.push(q);
                }
            }
            if (seen.size === 0) return Infinity;

            // ── 收集闭包命中的所有负载相绝缘，求并联等效 ──
            // 同一负载同一相经 l/r、绕组两端会有多个端口落入闭包，仅计一次电导。
            const pairs = new Set();
            for (const p of seen) {
                const pp = portPhase[p];
                if (!pp) continue;   // 中性点/星点端本身不计相
                pairs.add(pp[0] * 3 + pp[1]);
            }
            if (pairs.size === 0) return Infinity;
            let g = 0;               // Σ(1/R)
            for (const k of pairs) {
                const ld = Math.floor(k / 3), ph = k % 3;
                const r = insul.getLoadInsul(ld, ph);
                if (!isFinite(r) || r <= 0) return 0;      // 任一同导通相接地 → 0
                g += 1 / r;
            }
            return (1 / g) / 1e6;
        } catch (_) {
            return Infinity;
        }
    }

    /**
     * 将绝缘电阻值（MΩ）映射到指针 Konva 角度
     * 刻度：反向对数律
     *   R=0       → angleZero (330°，右端)
     *   R=∞       → angleInf  (210°，左端)
     */
    _rToAngle(r) {
        if (!isFinite(r) || r >= 1000) return this._angleInf;
        if (r <= 0) return this._angleZero;

        const s = 2.4;
        const scale = 1 + 1000 * s;
        const frac = Math.log10(1 + s * r) / Math.log10(scale);
        const clampedFrac = Math.max(0, Math.min(1, frac));
        return this._angleZero - clampedFrac * this._angleSweep;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawFaceStatic();
        this._drawBottomPlate();
    }

    _drawFrame() {
        const f = this._frame;
        // 深绿色表壳
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#b4c3b4',
            stroke: '#849284',
            strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        // 顶部光泽
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: f.w - 4, height: f.h * 0.05,
            fill: 'rgba(255,255,255,0.06)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    /** ZC-7 铭牌（位于表盘下半保留的 30px 帽檐带内） */
    _drawBottomPlate() {
        const W = this.width;
        const { cx, cy, r, capH } = this._face;
        const plateW = W-12;
        const plateH = capH - 4;
        const plateX = cx - plateW / 2, plateY = cy + 2;
        this._staticGroup.add(new Konva.Rect({
            x: plateX, y: plateY, width: plateW, height: plateH,
            fill: '#ece8d8', stroke: '#b0aa90', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: plateX + 3, y: plateY + 5,
            text: `ZC-7  ${this._ratedVoltage}V  绝缘电阻表`,
            fontSize: Math.max(15, plateH * 0.55), fontFamily: 'Arial',fontStyle: 'bold',
            fill: '#202020', width: plateW - 6, align: 'center',
        }));
    }

    // ─────────────────────────────────────────────────
    // 表盘（外观）
    // ─────────────────────────────────────────────────

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;
        const W = this.width, H = this.height;
        const f = this._frame;

        // 面板（深绿色）
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: W - f.x - 4, height: f.h - 4,
            fill: '#778477',
            cornerRadius: f.rx - 1,
        }));

        // 表盘金属环（上半圆 + 底部 30px 帽檐带）
        const capH = this._face.capH;
        this._staticGroup.add(new Konva.Shape({
            x: cx, y: cy,
            fillLinearGradientStartPoint: { x: -(r+7), y: -(r+7) },
            fillLinearGradientEndPoint:   { x:  (r+7), y:  (r+7) },
            fillLinearGradientColorStops: [0, '#707870', 0.5, '#d0d8d0', 1, '#606860'],
            sceneFunc: (ctx, shape) => {
                ctx.beginPath();
                // 上半圆环
                ctx.arc(0, 0, r + 7, Math.PI, Math.PI * 2, false);
                ctx.arc(0, 0, r,     Math.PI * 2, Math.PI, true);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
                // 底部帽檐带
                ctx.beginPath();
                ctx.rect(-(r + 7), 0, (r + 7) * 2, capH);
                ctx.closePath();
                ctx.fill();
            },
            listening: false,
        }));

        // 表盘面（奶白色半圆）
        this._staticGroup.add(new Konva.Shape({
            x: cx, y: cy,
            fill: '#f4f0e4',
            stroke: '#c8c4b0', strokeWidth: 1,
            sceneFunc: (ctx, shape) => {
                ctx.beginPath();
                ctx.arc(0, 0, r, Math.PI, Math.PI * 2, false);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            listening: false,
        }));

        // 表盘内径暗晕（半圆）
        this._staticGroup.add(new Konva.Shape({
            x: cx, y: cy,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.55,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.08)'],
            sceneFunc: (ctx, shape) => {
                ctx.beginPath();
                ctx.arc(0, 0, r, Math.PI, Math.PI * 2, false);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            listening: false,
        }));

        // ── 刻度（压缩对数，20M 居中，500M 近 ∞，1000M = ∞） ──
        const majorVals = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, Infinity];
        const majorLabels = ['0', '1', '2', '5', '10', '20', '50', '100', '200', '500', '∞'];

        // 绘制导轨弧
        this._drawFaceArc(cx, cy, r * 0.94,
            Math.min(this._angleInf, this._angleZero),
            Math.max(this._angleInf, this._angleZero),
            '#404040', 1.2);

        // 主刻度
        const outerR = r * 0.94;
        const fs = Math.max(6, r * 0.11);
        majorVals.forEach((v, i) => {
            const angDeg = this._rToAngle(v);
            const angRad = angDeg * Math.PI / 180;
            const innerR = r * 0.76;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + innerR * Math.cos(angRad), cy + innerR * Math.sin(angRad),
                ],
                stroke: '#202020', strokeWidth: 1.6, lineCap: 'round',
            }));

            const labelR = r * 0.72;
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(angRad) - fs * 1.2,
                y: cy + labelR * Math.sin(angRad) - fs * 0.3,
                text: majorLabels[i],
                fontSize: fs, fontFamily: 'Arial',
                fill: '#1a1a1a',
                align: 'center', width: fs * 2.4,
            }));
        });

        // 辅助刻度（小格）
        const minorVals = [0.5, 3, 4, 7, 8, 9, 15, 30, 40, 70, 80, 90, 150, 300, 400, 700, 800];
        minorVals.forEach(v => {
            const angDeg = this._rToAngle(v);
            const angRad = angDeg * Math.PI / 180;
            const inR = r * 0.84;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + inR    * Math.cos(angRad), cy + inR    * Math.sin(angRad),
                ],
                stroke: '#606060', strokeWidth: 0.8, lineCap: 'round',
            }));
        });

        // 刻度单位
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.75, y: cy - r * 0.28,
            text: 'MΩ',
            fontSize: Math.max(9, r * 0.175), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#cc2010', width: r * 1.5, align: 'center',
        }));

        // 中心轴（静态底座）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fill: '#b0a880', stroke: '#807860', strokeWidth: 1,
        }));

        // ── 手摇手柄底座 ──────────────────────────────
        const { x: ckx, y: cky } = this._crankCenter;
        const ckR = this._crankR;

        this._staticGroup.add(new Konva.Circle({
            x: ckx, y: cky, radius: ckR + 4,
            fill: '#2a3a2a', stroke: '#506050', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: ckx, y: cky, radius: ckR * 0.30,
            fill: '#808070', stroke: '#606060', strokeWidth: 1,
        }));

        // 手柄标注（右侧）
        this._staticGroup.add(new Konva.Text({
            x: ckx + ckR * 1.8, y: cky - ckR * 0.35,
            text: '摇动', fontSize: Math.max(13, ckR * 0.28),
            fontFamily: 'Arial', fill: '#02fc62', align: 'left',
        }));

        // ── 顶部接线端（L / E / G） ───────────────────
        const tR = Math.max(7, this.width * 0.016);
        const termDefs = [
            { pos: this._faceTermL, label: 'L', color: '#e83020' },
            { pos: this._faceTermE, label: 'E', color: '#208020' },
            { pos: this._faceTermG, label: 'G', color: '#c07010' },
        ];
        termDefs.forEach(td => {
            this._drawTerminal(td.pos.x, td.pos.y, tR, td.label, td.color);
            // 标注（正下方）
            this._staticGroup.add(new Konva.Text({
                x: td.pos.x - tR * 1.5, y: td.pos.y + tR + 2,
                text: td.label,
                fontSize: Math.max(16, tR * 0.80), fontFamily: 'Arial', fontStyle: 'bold',
                fill: td.color, width: tR * 3, align: 'center',
            }));
        });
    }

    /** 绘制弧线（折线模拟） */
    _drawFaceArc(cx, cy, radius, startDeg, endDeg, stroke, sw) {
        const steps = Math.max(20, Math.abs(endDeg - startDeg) / 2);
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
            pts.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke, strokeWidth: sw,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
    }

    /** 绘制接线柱（黄铜螺柱） */
    _drawTerminal(x, y, r, sign, color) {
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#c8b050', 0.5, '#e8d080', 1, '#a09040'],
            stroke: '#807030', strokeWidth: 3,
        }));
    }

    // ═══════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createCrankHandle();
        this._createHvWarning();
        this._createResistanceDisplay();
    }

    /** 指针（表盘） */
    _createNeedle() {
        const { cx, cy, r } = this._face;
        const needleLen = r * 0.82;
        const tailLen   = r * 0.12;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        // 针身
        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.88, 0],
            stroke: '#dd1808', strokeWidth: 2.2, lineCap: 'round',
        }));
        // 针尖三角
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.68, -1.8, needleLen * 0.88, 0, needleLen * 0.68, 1.8],
            closed: true, fill: '#dd1808', stroke: '#dd1808', strokeWidth: 0.5,
        }));
        // 配重
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 5, y: -2.2, width: 7, height: 4.4,
            fill: '#aa1006', cornerRadius: 1,
        }));

        this._dynamicGroup.add(this._needleGroup);

        // 中心轴帽
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.056,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a838', 1, '#908020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    /** 手摇手柄（底部，可点击） */
    _createCrankHandle() {
        const { x: ckx, y: cky } = this._crankCenter;
        const ckR = this._crankR;

        this._crankGroup = new Konva.Group({ x: ckx, y: cky, rotation: this._crankAngle });

        // 曲柄臂
        this._crankGroup.add(new Konva.Rect({
            x: 0, y: -3,
            width: ckR * 1.10, height: 6,
            fill: '#808878',
            stroke: '#606860', strokeWidth: 1, cornerRadius: 3,
        }));

        // 手柄握持球
        this._crankGroup.add(new Konva.Circle({
            x: ckR * 1.10, y: 0, radius: ckR * 0.32,
            fill: '#c8b870',
            stroke: '#a09050', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._crankGroup);
    }

    /** 高压警告叠加层（摇动时闪烁） */
    _createHvWarning() {
        const W = this.width;
        const { cx, cy, r, capH } = this._face;
        const fs = Math.max(8, r * 0.14);

        this._hvWarningText = new Konva.Text({
            x: cx - r * 0.80, y: cy + capH + 4,
            text: '⚡ 高压危险！勿触 ⚡',
            fontSize: fs,
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ff3010',
            width: r * 1.6, align: 'center',
            visible: false,
        });
        this._dynamicGroup.add(this._hvWarningText);
    }

    /** 阻值数字显示（表盘内、MΩ 标注之上） */
    _createResistanceDisplay() {
        const { cx, cy, r, capH } = this._face;
        const fs = Math.max(8, r * 0.13);
        const y0 = cy - r * 0.45;

        this._rText = new Konva.Text({
            x: cx - r * 0.70,
            y: y0,
            text: '∞ MΩ',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#40e080',
            width: r * 1.40, align: 'center',
        });
        this._dynamicGroup.add(this._rText);
    }

    // ═══════════════════════════════════════════════════
    // 交互绑定（点击手柄切换摇动状态）
    // ═══════════════════════════════════════════════════

    _bindInteraction() {
        const { x: ckx, y: cky } = this._crankCenter;
        const ckR = this._crankR;

        const hit = new Konva.Circle({
            x: ckx, y: cky, radius: ckR * 1.8, fill: 'transparent',
        });
        hit.on('click tap', () => {
            this._cranking = !this._cranking;
            if (!this._cranking) this._hvActive = false;
        });
        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hit);
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic(dt) {
        const v   = this._currentR;
        const tau = Math.max(0.1, this._rampTime);
        const a   = 1 - Math.exp(-dt / tau);

        if (this._cranking) {
            // 指针平滑跟随目标角度（取最短路径）
            const target = this._rToAngle(v);
            let diff = target - this._needleAngle;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;
            this._needleAngle += diff * a;
        } else {
            // 停止后指向停留阻值对应角度（不再归零）
            const target = isFinite(v) ? this._rToAngle(v) : -90;
            let diff = target - this._needleAngle;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;
            this._needleAngle += diff * a;
        }

        this._needleGroup.rotation(this._needleAngle);

        // 手柄旋转（摇动时持续转）
        this._crankGroup.rotation(this._crankAngle);

        // 高压警告闪烁
        const showWarn = this._cranking && this._hvActive && (Math.floor(this._warnFlash * 3) % 2 === 0);
        this._hvWarningText.visible(showWarn);

        // 阻值数字
        if (!this._cranking) {
            this._rText.text('— MΩ');
            this._rText.fill('#606870');
        } else if (!isFinite(v) || v >= 1e6) {
            this._rText.text('∞ MΩ');
            this._rText.fill('#40e080');
        } else {
            this._rText.text(`${v >= 1000 ? (v / 1000).toFixed(1) + 'G' : v.toFixed(v < 10 ? 1 : 0)} MΩ`);
            this._rText.fill('#40e080');
        }
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        if (this._cranking) {
            this._stopValue = null;  // 下次停止重新随机

            // 手柄旋转：120 r/min → 720°/s
            this._crankAngle = (this._crankAngle + 720 * dt) % 360;

            // 高压建立
            this._hvActive = true;
            this._warnFlash += dt;

            if (this._insulSync) {
                // ── 联动绝缘指示灯模式：不显示实际测量值 ──
                // 依 L 端口所在簇映射到绝缘指示灯数据（MΩ）
                this._targetR = this._resolveInsulSyncR();
            } else {
                // 从电路求解器获取 L-E 间等效电阻（Ω → MΩ）
                try {
                    const rOhm = this.sys.voltageSolver._getEquivalentResistanceFromPorts(this.id, 'l', 'e');
                    this._targetR = (isFinite(rOhm) && rOhm >= 0) ? rOhm / 1e6 : Infinity;
                } catch (_) {
                    this._targetR = Infinity;
                }
            }
        } else {
            // 停止摇动：随机停留阻值
            if (this._stopValue === null) {
                const stops = [5, 10, 20, 50, 100];
                this._stopValue = stops[Math.floor(Math.random() * stops.length)];
            }
            this._targetR = this._stopValue;
            this._warnFlash = 0;
        }

        // 指针平滑跟随目标电阻（有惯性）
        const tau   = Math.max(0.1, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        if (isFinite(this._targetR) && isFinite(this._currentR)) {
            this._currentR += (this._targetR - this._currentR) * alpha;
        } else if (!isFinite(this._targetR)) {
            this._currentR = isFinite(this._currentR)
                ? this._currentR + (50000 - this._currentR) * alpha
                : Infinity;
            if (this._currentR > 9000) this._currentR = Infinity;
        } else {
            this._currentR = this._targetR;
        }

        this._updateDynamic(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    /** 设置被测绝缘电阻（MΩ），Infinity 表示断路 */
    setResistance(r) {
        if (r === Infinity || r === 'Infinity' || r === null) {
            this._targetR = Infinity;
        } else {
            this._targetR = Math.max(0, parseFloat(r) || 0);
        }
    }

    /** 启动/停止手摇 */
    setCranking(on) {
        this._cranking = !!on;
        if (!on) this._hvActive = false;
        if (on) this._stopValue = null;
    }

    isCranking()     { return this._cranking; }
    getResistance()  { return this._currentR; }

    update(state) {
        // state 可以是 {resistance, cranking} 对象，或直接是阻值
        if (typeof state === 'object' && state !== null) {
            if (state.resistance !== undefined) this.setResistance(state.resistance);
            if (state.cranking   !== undefined) this.setCranking(state.cranking);
        } else {
            this.setResistance(state);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '仪表标识',              key: 'label',      type: 'text'   },
            { label: '额定电压 V（500/1000/2500）', key: 'voltage', type: 'number' },
            { label: '被测电阻 MΩ（Infinity=∞）',  key: 'resistance', type: 'text' },
            { label: '是否摇动（true/false）', key: 'cranking',   type: 'text'   },
            { label: '响应时间常数 s',         key: 'rampTime',   type: 'number' },
            { label: '联动绝缘指示灯模式（true/false）', key: 'insulSync', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label      !== undefined) this.label          = cfg.label;
        if (cfg.voltage    !== undefined) this._ratedVoltage  = parseFloat(cfg.voltage) || 500;
        if (cfg.rampTime   !== undefined) this._rampTime      = parseFloat(cfg.rampTime) || 1.5;
        if (cfg.resistance !== undefined) this.setResistance(cfg.resistance);
        if (cfg.cranking   !== undefined) this.setCranking(cfg.cranking === 'true' || cfg.cranking === true);
        if (cfg.insulSync !== undefined) this._insulSync = (cfg.insulSync === 'true' || cfg.insulSync === true);

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}