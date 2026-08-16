import { BaseComponent } from './BaseComponent.js';

/**
 * 电压互感器（Potential Transformer / PT）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  电压互感器是一种将一次侧（原边）高电压按比例变换为二次侧（副边）
 *  低电压的测量设备，广泛用于电力系统的电压测量和保护回路。
 *
 *  ── 电磁感应原理 ──────────────────────────────────────────────────
 *    1. 原边绕组（P1-P2，匝数多，导线细）并联于被测回路（测量电压）
 *    2. 原边电压 V₁ 在铁芯中产生交变磁通 Φ
 *    3. 根据法拉第电磁感应定律，副边绕组（S1-S2，匝数少，导线粗）
 *       感应出电动势 E₂ = -N₂ × dΦ/dt
 *    4. 理想情况下：V₁ / V₂ = N₁ / N₂ = K（匝数比）
 *    5. 因此：V₂ = V₁ / K = V₁ × (N₂/N₁)
 *
 *  ── 重要特性 ──────────────────────────────────────────────────────
 *    ① 副边严禁短路：短路时副边电流极大，可能烧毁绕组
 *    ② 副边通常接近开路状态（接电压表/保护装置的高阻抗输入）
 *    ③ 变比 K = N₁/N₂（默认 10，可配置）
 *    ④ 极性标注：P1/S1 为同名端，电压同时为正时方向相同
 *
 * ═══ 仿真实现 ═════════════════════════════════════════════════════════
 *  采用 MNA 改进节点分析法注入电路求解：
 *
 *  ── 注入方法（在 DeviceStamps.stampPotentialTransformers 中实现）──
 *    ① 原边（P1-P2）：注入 1GΩ 高阻抗（等效为电压表内阻）
 *       - 对电路拓扑几乎无影响
 *
 *    ② 副边（S1-S2）：受控电压源（VCVS）
 *       - 目标电压：V₂ = V₁ / K（利用当前迭代 V₁ 值）
 *       - MNA 方程：V(S1) - V(S2) - (1/K) × (V(P1) - V(P2)) = 0
 *
 * ═══ 渲染结构 ═════════════════════════════════════════════════════════
 *  左侧（50%）：实物图片区
 *    ① 浅灰边框面板
 *    ② 从 pt01.jpg 加载的图片（等比缩放居中）
 *    ③ 底部标注"电压互感器实物图"
 *
 *  右侧（50%）：原理图与标准变压器符号
 *    ① 两条垂直铁芯柱 + 上下横轭
 *    ② 副边绕组（铁芯上方，5 匝，粗线蓝色）— S1/S2 在顶边
 *    ③ 原边绕组（铁芯下方，50 匝，细线铜色）— P1/P2 在底边
 *    ④ 接线端（黄铜螺柱 + 彩色引出线）
 *    ⑤ 动态显示区（V₁、V₂、变比）
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  s1 — S1（副边出线端 / 同名端，在组件顶边）
 *  s2 — S2（副边进线端，在组件顶边）
 *  p1 — P1（原边进线端 / 同名端，在组件底边）
 *  p2 — P2（原边出线端，在组件底边）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  turnsRatio    : 匝数比 K = N₁/N₂（默认 10）
 *  primaryRated  : 原边额定电压 V（默认 1000，仅用于显示）
 *  secondaryRated: 副边额定电压 V（默认 100，仅用于显示）
 */
export class PotentialTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 460);
        this.height = Math.max(200, config.height || 260);

        this.type    = 'potential_transformer';
        this.special = 'POTENTIAL_TRANSFORMER';

        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            turnsRatio:   this._turnsRatio,
            primaryRated: this._primaryRated,
            secondaryRated: this._secondaryRated,
        };

        this.addPort(this._portS1.x, this._portS1.y, 's1', 'wire', 'p');
        this.addPort(this._portS2.x, this._portS2.y, 's2', 'wire', 'n');
        this.addPort(this._portP1.x, this._portP1.y, 'p1', 'wire', 'p');
        this.addPort(this._portP2.x, this._portP2.y, 'p2', 'wire', 'n');

        this._loadImage();
    }

    /**
     * 几何尺寸计算
     *
     * 整体分为左右两半：
     *   - 左半区（0~_divX）：实物图片区
     *   - 右半区（_divX~W）：原理图（铁芯 + 原/副边绕组 + 端子）
     *
     * 原理图居中排列：
     *   - 铁芯为"日"字型（两柱 + 上下轭）
     *   - 副边绕组在上轭，接线端 S1/S2 在顶部
     *   - 原边绕组在下轭，接线端 P1/P2 在底部
     */
    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._divX  = W * 0.50;                   // 左右分界线
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 }; // 外框

        const rLeft = this._divX;
        const rW    = W - rLeft;

        this._imgRect = { x: 6, y: 6, w: rLeft - 10, h: H - 12 }; // 图片区

        // 原理图居中 X
        const schCx = rLeft + rW * 0.50;

        // 铁芯区域（日字型两柱 + 上下轭）
        const coreW = rW * 0.50;
        const coreH = H * 0.50;
        this._core = { cx: schCx, cy: H * 0.48, w: coreW, h: coreH };

        // 副边接线端子（顶部）
        const sp  = rW * 0.22;
        const tY = 34;
        this._termS1 = { x: schCx - sp * 0.5, y: tY };  // S1（左）
        this._termS2 = { x: schCx + sp * 0.5, y: tY };  // S2（右）

        // 原边接线端子（底部）
        const bY = H - 34;
        this._termP1 = { x: schCx - sp * 0.5, y: bY };  // P1（左）
        this._termP2 = { x: schCx + sp * 0.5, y: bY };  // P2（右）

        // 端口（组件的电气连接点）
        this._portS1 = { x: this._termS1.x, y: 4 };
        this._portS2 = { x: this._termS2.x, y: 4 };
        this._portP1 = { x: this._termP1.x, y: H - 4 };
        this._portP2 = { x: this._termP2.x, y: H - 4 };
    }

    _initParameters(config) {
        // 匝数比 K = N₁/N₂，默认 10（原边 50 匝 / 副边 5 匝）
        // 电压变换关系：V₂ = V₁ / turnsRatio
        this._turnsRatio    = config.turnsRatio    !== undefined ? parseFloat(config.turnsRatio)    : 10;

        this._primaryRated  = config.primaryRated  !== undefined ? parseFloat(config.primaryRated)  : 1000;
        this._secondaryRated = config.secondaryRated !== undefined ? parseFloat(config.secondaryRated) : 100;

        this._prevVPrimary  = 0;
        this.V_primary      = 0;
        this.V_secondary    = 0;

        this._freq          = config.frequency !== undefined ? parseFloat(config.frequency) : 50;
        this._acPhase       = 0;
    }

    _init() {
        this._drawFrame();
        this._drawImagePanel();
        this._drawSchematicStatic();
        this._createDynamicNodes();
    }

    _loadImage() {
        const img = new window.Image();
        img.onload = () => {
            this._ptImage = img;
            if (this._imgNode) {
                const r = this._imgRect;
                const scale = Math.min(r.w / img.width, r.h / img.height);
                const iw = img.width * scale;
                const ih = img.height * scale;
                this._imgNode.image(img);
                this._imgNode.width(iw);
                this._imgNode.height(ih);
                this._imgNode.x(r.x + (r.w - iw) / 2);
                this._imgNode.y(r.y + (r.h - ih) / 2);
                this._forceCacheFlush();
            }
        };
        img.src = './pt01.jpg';
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
    }

    _drawImagePanel() {
        const r = this._imgRect;

        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h,
            fill: '#f4f4f0',
            stroke: '#c8ccd0', strokeWidth: 1,
            cornerRadius: 4,
        }));

        const img = this._ptImage;
        this._imgNode = new Konva.Image({
            x: r.x, y: r.y,
            width: r.w, height: r.h,
            image: img || undefined,
        });
        if (img) {
            const scale = Math.min(r.w / img.width, r.h / img.height);
            const iw = img.width * scale;
            const ih = img.height * scale;
            this._imgNode.width(iw);
            this._imgNode.height(ih);
            this._imgNode.x(r.x + (r.w - iw) / 2);
            this._imgNode.y(r.y + (r.h - ih) / 2);
        }
        this._staticGroup.add(this._imgNode);

        this._staticGroup.add(new Konva.Text({
            x: r.x, y: r.y + r.h - 22,
            text: '电压互感器实物图',
            fontSize: 12, fontFamily: 'Arial',
            fill: '#888', width: r.w, align: 'center',
        }));
    }

    _drawSchematicStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;
        const rLeft = this._divX;

        this._staticGroup.add(new Konva.Rect({
            x: rLeft + 1, y: f.y + 2,
            width: W - rLeft - f.x - 2, height: f.h - 4,
            fill: '#f0f2f4',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._staticGroup.add(new Konva.Text({
            x: rLeft + 8, y: 10,
            text: '原理图',
            fontSize: 13, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#555',
        }));

        this._drawCore();
        this._drawSecondaryWinding();
        this._drawPrimaryWinding();
        this._drawTerminals();
        this._drawConnectionLabels();
    }

    _drawCore() {
        const { cx, cy, w, h } = this._core;
        const halfW = w * 0.5, halfH = h * 0.5;
        const barW = w * 0.18;

        this._staticGroup.add(new Konva.Rect({
            x: cx - halfW, y: cy - halfH,
            width: w, height: barW,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: cx - halfW, y: cy + halfH - barW,
            width: w, height: barW,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: cx - halfW, y: cy - halfH,
            width: barW, height: h,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: cx + halfW - barW, y: cy - halfH,
            width: barW, height: h,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 25, y: cy - 8,
            text: '铁芯',
            fontSize: 13, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e8eef0',
            width: 50, align: 'center',
        }));
    }

    /** 副边绕组（5 匝粗线，绕在上轭上，朝上开口连接顶部 S1/S2） */
    _drawSecondaryWinding() {
        const { cx, cy, w, h } = this._core;
        const halfW = w * 0.5, halfH = h * 0.5;
        const barW = w * 0.18;
        const nTurns = 5;
        const wireW = 3;

        const barY = cy - halfH + barW * 0.5;
        const coilR = barW * 0.7;
        const turnW = w * 0.35 / nTurns;
        const x0 = cx - (nTurns * turnW) / 2;

        for (let t = 0; t < nTurns; t++) {
            const ox = x0 + t * turnW + turnW * 0.5;
            this._staticGroup.add(new Konva.Arc({
                x: ox, y: barY,
                innerRadius: coilR * 0.5,
                outerRadius: coilR,
                angle: 180,
                rotation: 180,
                fill: '#3080b0',
                stroke: '#206090',
                strokeWidth: 0.8,
            }));
        }

        this._staticGroup.add(new Konva.Line({
            points: [this._termS1.x, this._termS1.y, x0, barY],
            stroke: '#3080b0', strokeWidth: wireW, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._termS2.x, this._termS2.y, x0 + nTurns * turnW, barY],
            stroke: '#3080b0', strokeWidth: wireW, lineCap: 'round',
        }));
    }

    /** 原边绕组（50 匝细线，绕在下轭上，朝下开口连接底部 P1/P2） */
    _drawPrimaryWinding() {
        const { cx, cy, w, h } = this._core;
        const halfW = w * 0.5, halfH = h * 0.5;
        const barW = w * 0.18;
        const nTurns = 50;
        const wireW = 1.2;

        const barY = cy + halfH - barW * 0.5;
        const coilR = barW * 0.7;
        const turnW = w * 0.55 / nTurns;
        const x0 = cx - (nTurns * turnW) / 2;

        for (let t = 0; t < nTurns; t++) {
            const ox = x0 + t * turnW + turnW * 0.5;
            this._staticGroup.add(new Konva.Arc({
                x: ox, y: barY,
                innerRadius: coilR * 0.4,
                outerRadius: coilR,
                angle: 180,
                rotation: 0,
                fill: '#c07030',
                stroke: '#a05820',
                strokeWidth: 0.3,
            }));
        }

        this._staticGroup.add(new Konva.Line({
            points: [this._termP1.x, this._termP1.y, x0, barY],
            stroke: '#c07030', strokeWidth: wireW, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._termP2.x, this._termP2.y, x0 + nTurns * turnW, barY],
            stroke: '#c07030', strokeWidth: wireW, lineCap: 'round',
        }));
    }

    _drawTerminals() {
        const tR = Math.max(5, this.width * 0.017);
        const termDefs = [
            { pos: this._termS1, label: 'S1', color: '#20a060', top: true },
            { pos: this._termS2, label: 'S2', color: '#806020', top: true },
            { pos: this._termP1, label: 'P1', color: '#c83020', top: false },
            { pos: this._termP2, label: 'P2', color: '#3068c0', top: false },
        ];
        termDefs.forEach(td => {
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR,
                fillLinearGradientStartPoint: { x: -tR, y: -tR },
                fillLinearGradientEndPoint:   { x:  tR, y:  tR },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR * 0.40, fill: '#383028',
            }));
            const extY = td.top ? 2 : this.height - 2;
            this._staticGroup.add(new Konva.Line({
                points: [td.pos.x, td.pos.y + (td.top ? -tR : tR), td.pos.x, extY],
                stroke: td.color, strokeWidth: 2,
            }));
        });
    }

    _drawConnectionLabels() {
        const labels = [
            { x: this._termS1.x, y: this._termS1.y - 18, label: 'S1' },
            { x: this._termS2.x, y: this._termS2.y - 18, label: 'S2' },
            { x: this._termP1.x, y: this._termP1.y + 4,  label: 'P1' },
            { x: this._termP2.x, y: this._termP2.y + 4,  label: 'P2' },
        ];
        labels.forEach(l => {
            this._staticGroup.add(new Konva.Text({
                x: l.x - 12, y: l.y,
                text: l.label,
                fontSize: 10, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#444',
                width: 24, align: 'center',
            }));
        });
    }

    _createDynamicNodes() {
        this._createVoltageDisplay();
        this._createRatioDisplay();
    }

    _createVoltageDisplay() {
        const rLeft = this._divX;
        const fs = 12;
        const baseY = this._core.cy + this._core.h * 0.5 + 12;
        this._primaryText = new Konva.Text({
            x: rLeft + 10, y: baseY,
            text: 'V₁ = 0.0 V',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#c83020',
            width: this.width - rLeft - 20, align: 'left',
        });
        this._dynamicGroup.add(this._primaryText);

        this._secondaryText = new Konva.Text({
            x: rLeft + 10, y: baseY + 18,
            text: 'V₂ = 0.0 V',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#206090',
            width: this.width - rLeft - 20, align: 'left',
        });
        this._dynamicGroup.add(this._secondaryText);
    }

    _createRatioDisplay() {
        const c = this._core;
        this._ratioText = new Konva.Text({
            x: c.cx - c.w * 0.3, y: c.cy - 8,
            text: `变比 ${this._turnsRatio}:1`,
            fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#666',
            width: c.w * 0.6, align: 'center',
        });
        this._dynamicGroup.add(this._ratioText);
    }

    _updateDynamic() {
        const v1 = this.V_primary;
        const v2 = this.V_secondary;

        this._primaryText.text(`V₁ = ${v1.toFixed(1)} V`);
        this._secondaryText.text(`V₂ = ${v2.toFixed(1)} V`);

        this._ratioText.text(`变比 ${this._turnsRatio}:1`);

        const active = Math.abs(v1) > 0.1;
        this._primaryText.fill(active ? '#c83020' : '#999');
        this._secondaryText.fill(active ? '#206090' : '#999');
    }

    /**
     * 每帧仿真更新（20fps，由 ControlSystem 集中驱动）
     *
     * 从 MNA 求解器中读取四个端口的节点电压，计算：
     *   - V₁ = V(P1) - V(P2)  原边电压
     *   - V₂ = V(S1) - V(S2)  副边电压
     *
     * 注意：此处仅做电压读取和显示更新。
     * 实际的受控源注入（V₂ = V₁ / K）由 DeviceStamps.stampPotentialTransformers
     * 和 CircuitSolver 在 MNA 求解阶段完成。
     *
     * @param {number} dt - 帧时间间隔（秒）
     */
    tick(dt) {
        const sv = this.sys?.voltageSolver;
        if (sv) {
            const getV = (port) => {
                const c = sv.portToCluster.get(`${this.id}_wire_${port}`);
                if (c === undefined) return 0;
                return sv.nodeVoltages.get(c) || 0;
            };
            const vP1 = getV('p1');
            const vP2 = getV('p2');
            const vS1 = getV('s1');
            const vS2 = getV('s2');
            this.V_primary   = vP1 - vP2;
            this.V_secondary = vS1 - vS2;

            this._prevVPrimary = this.V_primary;
        }

        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._freq) % (2 * Math.PI);

        this._updateDynamic();

        this.markDirty();
        this._refreshIfDirty();
    }

    setTurnsRatio(ratio) {
        this._turnsRatio = Math.max(1, parseFloat(ratio) || 10);
    }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.turnsRatio !== undefined) this.setTurnsRatio(state.turnsRatio);
            if (state.primaryRated !== undefined) this._primaryRated = parseFloat(state.primaryRated) || 1000;
            if (state.secondaryRated !== undefined) this._secondaryRated = parseFloat(state.secondaryRated) || 100;
        }
    }

    getConfigFields() {
        return [
            { label: '匝数比（原边:副边）',  key: 'turnsRatio',    type: 'number' },
            { label: '原边额定电压 V',       key: 'primaryRated',  type: 'number' },
            { label: '副边额定电压 V',       key: 'secondaryRated', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.turnsRatio     !== undefined) this._turnsRatio     = Math.max(1, parseFloat(cfg.turnsRatio) || 10);
        if (cfg.primaryRated   !== undefined) this._primaryRated   = parseFloat(cfg.primaryRated)   || 1000;
        if (cfg.secondaryRated !== undefined) this._secondaryRated = parseFloat(cfg.secondaryRated) || 100;

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawFrame();
        this._drawImagePanel();
        this._drawSchematicStatic();
        this._createDynamicNodes();
        this._loadImage();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
