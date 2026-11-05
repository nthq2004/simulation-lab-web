import { BaseComponent } from './BaseComponent.js';

/**
 * HvTransformer 高压三相变压器（6600V → 440V，星形-星形，中性点接地）
 *
 * 界面：三个交错的圆形（三相绕组，120° 对称）
 *   - 顶部 3 个电气端口：h1/h2/h3 —— 原边（接 6600V 线电压）
 *   - 底部 3 个电气端口：x1/x2/x3 —— 副边（输出 440V 线电压）
 *
 * 电气模型（type='hv_transformer'，每相理想变压器）：
 *   - 副边受控电压源 V_x = k·V_h（k = 副边/原边变比，读原边对地电压）
 *   - 原边励磁阻抗（对地）+ 原边电流回馈 I_p = k·I_s（功率平衡，迭代收敛）
 *   - 原边/副边中性点均视为接地（星形联接），相电压 = 端口对地电压
 */
const COLORS = ['#e02020', '#20a030', '#2a60d0'];
const WINDINGS = ['U', 'V', 'W'];

export class HvTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80, config.width  || 87);
        this.height = Math.max(150, config.height || 170);

        this.type  = 'hv_transformer';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:    this.label,
            ratio:    this._ratio,
            vPrimary: this.vPrimary,
            vSecondary: this.vSecondary,
        };

        // 端口：顶部 h1/h2/h3（原边），底部 x1/x2/x3（副边）
        ['h1', 'h2', 'h3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], 2, nm, 'wire', 'p');
        });
        ['x1', 'x2', 'x3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], this.height - 2, nm, 'wire', 'p');
        });
    }

    // ═══════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════

    _recalcGeometry() {
        const w = this.width, h = this.height;
        // 三相列（顶部/底部端口）：紧凑间距
        const gap = 26;
        this._staticXs = [w / 2 - gap, w / 2, w / 2 + gap];
        // 三个交错圆（等边三角顶点，边长 45 < 2r=46 → 两两稍交叉）
        //   与端口列直线对应：V 中列(顶)、U 左列(底)、W 右列(底) —— 引线不交叉
        //   圆区 42.5~127.5 垂直居中（中心 85 = 170/2）→ 上下引线对称
        const cx = w / 2, r = 23;
        this._circles = [
            { cx: cx - 22.5, cy: 104.5, r: r },   // U（左列，接 h1/x1）
            { cx: cx,        cy: 65.5,  r: r },   // V（中列，接 h2/x2）
            { cx: cx + 22.5, cy: 104.5, r: r },   // W（右列，接 h3/x3）
        ];
    }

    // ═══════════════════════════════════════
    // 参数
    // ═══════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || '高压三相变压器';
        this.function = '高压三相变压器';
        this.vPrimary   = parseFloat(config.vPrimary)   || 6600;
        this.vSecondary = parseFloat(config.vSecondary) || 440;
        this._ratio = parseFloat(config.ratio) || (this.vSecondary / this.vPrimary);
        this._magR  = parseFloat(config.magR)  || 2e6;    // 励磁阻抗 Ω
        this._iSec  = [0, 0, 0];    // 副边电流（原边回馈用，由求解器回写）
        // ── 温度（绕组温度，℃）：正常运行 40℃，≥90℃ 视为温度过高 ──
        this._temp = config.temp !== undefined ? parseFloat(config.temp) : 40;
        this._overTemp = false;
        // ── 热模型参数 ──
        this._ambient     = 20;                                       // 环境温度 ℃
        this._healthyTemp = config.healthyTemp !== undefined ? parseFloat(config.healthyTemp) : 60;  // 散热正常 + 通电时的平衡温度 ℃
        this._heatRate    = config.heatRate !== undefined ? parseFloat(config.heatRate) : 6;         // 散热不良温升率 ℃/s（约 15s 从 40→130）
        this._coolRate    = config.coolRate !== undefined ? parseFloat(config.coolRate) : ((130 - 20) / 60); // 断电冷却率 ℃/s（60s 从 130→20）
        this._coolFault   = false;                                   // 严重散热不良故障标志
        // ── 高温保护系统：温度超过阈值且持续延时后，跳开上级真空断路器 ──
        this._protBk     = config.protBk || '';                                  // 上级断路器 id
        this._hTripTemp  = config.hTripTemp  !== undefined ? parseFloat(config.hTripTemp)  : 130;  // 动作阈值 ℃
        this._hTripDelay = config.hTripDelay !== undefined ? parseFloat(config.hTripDelay) : 3;    // 动作延时 s
        this._hTimer     = 0;                      // 超温持续时间累计
        this._hTripDone  = false;                  // 本次超温是否已跳闸
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════

    _drawStaticParts() {
        const s = this._staticGroup;
        // 面板
        s.add(new Konva.Rect({ x: 0, y: 0, width: this.width, height: this.height, fill: '#eef2f5', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: this.width - 6, height: this.height - 6, fill: '#e4eaef', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: 0, y: 2, width: this.width, align: 'center', text: '三相变压器', fontSize: 9, fontStyle: 'bold', fill: '#1a252f' }));

        // 三个交错圆（三相绕组，稍有交叉）
        this._circles.forEach((c, i) => {
            s.add(new Konva.Circle({ x: c.cx, y: c.cy, radius: c.r, fill: 'rgba(255,255,255,0.75)', stroke: COLORS[i], strokeWidth: 2 }));
            s.add(new Konva.Text({ x: c.cx - 6, y: c.cy - 7, width: 12, text: WINDINGS[i], fontSize: 10, fontStyle: 'bold', fill: COLORS[i], align: 'center', listening: false }));
        });

        // 端口金点
        this._staticXs.forEach(x => {
            s.add(new Konva.Circle({ x, y: 8, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
            s.add(new Konva.Circle({ x, y: this.height - 8, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
        });

        // 原边引线（顶部端口 → 对应圆，直线引出不交叉）
        this._staticXs.forEach((x, i) => {
            const c = this._circles[i];
            s.add(new Konva.Line({ points: [x, 12, c.cx, c.cy - c.r], stroke: COLORS[i], strokeWidth: 2, lineCap: 'round' }));
            // 副边引线（对应圆 → 底部端口，直线引出不交叉）
            s.add(new Konva.Line({ points: [c.cx, c.cy + c.r, x, this.height - 12], stroke: COLORS[i], strokeWidth: 2, lineCap: 'round' }));
        });
    }

    // ═══════════════════════════════════════
    // 动态节点（温度过高指示）
    // ═══════════════════════════════════════

    _createDynamicNodes() {
        // 温度/散热异常警示文本（右侧，正常隐藏）
        this._tempText = new Konva.Text({
            x: this.width + 4, y: this.height / 2 - 14, text: '', align: 'left',
            fontSize: 13, fontStyle: 'bold', fill: '#d02020', visible: false,
            listening: false,
        });
        this._dynamicGroup.add(this._tempText);
        // 高温保护倒计时提示（面板下方，超温计时期间显示）
        this._tripHintText = new Konva.Text({
            x: 2, y: this.height + 2, width: this.width + 40,
            text: '', align: 'center', fontSize: 12, fontStyle: 'bold',
            fill: '#c02020', visible: false, listening: false,
        });
        this._dynamicGroup.add(this._tripHintText);
    }

    // ═══════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════

    getRatio() { return this._ratio; }

    /** 设置绕组温度（℃）：≥90℃ 自动判定为温度过高并显示红色警示 */
    setTemp(c) {
        this._temp = parseFloat(c) || 0;
        this._applyTempUI();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    getTemp() { return this._temp; }
    isOverTemp() { return this._overTemp; }
    isCoolingFault() { return this._coolFault; }

    /** 设置是否严重散热不良（散热不良仅在通电时累计温升；不通电不升温） */
    setCoolingFault(on) {
        this._coolFault = !!on;
        this._applyTempUI();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ── 温度警示 UI（≥90℃ 显示红色"温度过高"；散热不良故障不单独显示）──
    _applyTempUI() {
        this._overTemp = this._temp >= 90;
        if (!this._tempText) return;
        let txt = '', fill = '#d02020';
        if (this._temp >= 90) {
            txt = `⚠ 温度过高 ${Math.round(this._temp)}℃`;
        }
        this._tempText.text(txt);
        this._tempText.fill(fill);
        this._tempText.visible(!!txt);
    }

    // ── 原边是否带电：原边 h1 端口对地电压 > 200V 视为通电 ──
    _powered() {
        const vs = this.sys && this.sys.voltageSolver;
        if (!vs || !vs.portToCluster || !vs.nodeVoltages) return false;
        const c = vs.portToCluster.get(`${this.id}_wire_h1`);
        if (c === undefined) return false;
        return Math.abs(vs.nodeVoltages.get(c) || 0) > 200;
    }

    // ── 热模型演化 ──
    _updateTemp(dt) {
        const t = this._temp;
        if (this._powered()) {
            if (this._coolFault) {
                this._temp = t + this._heatRate * dt;                 // 散热不良（通电）：线性升温
            } else {
                this._temp += (this._healthyTemp - t) * Math.min(1, dt * 0.25);   // 散热正常（通电）：趋向平衡温度
            }
        } else {
            // 断电：自动冷却到环境温度（60s 从 130℃ 降到 20℃）
            this._temp = Math.max(this._ambient, t - this._coolRate * dt);
        }
        this._applyTempUI();
    }

    // ── 高温保护系统：温度 ≥ 阈值持续延时 → 跳开上级真空断路器 ──
    tick(dt) {
        this._updateTemp(dt);
        if (!this._protBk) return;                       // 未配置保护对象不参与
        if (this._temp >= this._hTripTemp) {
            this._hTimer += dt;
            if (!this._hTripDone && this._hTimer >= this._hTripDelay) {
                this._hTripDone = true;
                this._tripUpstreamBreaker();
            }
        } else if (this._temp < this._hTripTemp - 10) {  // 温度回差（10℃）复位
            this._hTimer = 0;
            this._hTripDone = false;
        }
        this._updateTripHint(dt);
    }

    _tripUpstreamBreaker() {
        const bk = this.sys && this.sys.comps && this.sys.comps[this._protBk];
        if (bk) {
            if (typeof bk.tryTrip === 'function') bk.tryTrip();
            bk._tripSource = '高温保护';
            if (this.sys && typeof this.sys.showFloatingTip === 'function') {
                this.sys.showFloatingTip(`${this.label} 温度过高，${this._hTripDelay}s 延时到期，已断开 ${bk.label || this._protBk}`);
            }
        }
    }

    _updateTripHint(dt) {
        if (!this._tripHintText) return;
        const counting = this._protBk && this._temp >= this._hTripTemp && !this._hTripDone;
        if (counting) {
            const left = Math.max(0, this._hTripDelay - this._hTimer);
            this._tripHintText.text(`高温保护：${left.toFixed(1)}s 后跳闸 ${this._protBk}`);
            this._tripHintText.visible(true);
        } else {
            this._tripHintText.visible(false);
        }
    }

    getConfigFields() {
        return [
            { label: '原边电压 (V)', key: 'vPrimary', type: 'number' },
            { label: '副边电压 (V)', key: 'vSecondary', type: 'number' },
            { label: '励磁阻抗 (Ω)', key: 'magR', type: 'number' },
            { label: '上级断路器 id（高温保护）', key: 'protBk', type: 'text' },
            { label: '高温动作阈值 (℃)', key: 'hTripTemp', type: 'number' },
            { label: '高温动作延时 (s)', key: 'hTripDelay', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.vPrimary !== undefined)   this.vPrimary   = parseFloat(cfg.vPrimary)   || 6600;
        if (cfg.vSecondary !== undefined) this.vSecondary = parseFloat(cfg.vSecondary) || 440;
        if (cfg.magR !== undefined)       this._magR      = parseFloat(cfg.magR)       || 2e6;
        if (cfg.protBk !== undefined)     this._protBk    = String(cfg.protBk);
        if (cfg.hTripTemp !== undefined)  this._hTripTemp = parseFloat(cfg.hTripTemp) || 130;
        if (cfg.hTripDelay !== undefined) this._hTripDelay= parseFloat(cfg.hTripDelay) || 3;
        this._ratio = this.vSecondary / this.vPrimary;
        this.config = { ...this.config, ...cfg };
        // 更新电压标签
        const sg = this._staticGroup;
        sg.getChildren().forEach(n => {
            if (n.getClassName() === 'Text') {
                const t = n.text();
                if (t && t.includes('原边')) n.text(`${this.vPrimary}V 原边`);
                if (t && t.includes('副边')) n.text(`${this.vSecondary}V 副边`);
            }
        });
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    destroy() { super.destroy?.(); }
}