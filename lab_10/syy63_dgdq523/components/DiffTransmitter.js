import { BaseComponent } from './BaseComponent.js';

/**
 * 差压变送器组件（DiffTransmitter）—— 电动差压变送器（二线制 4~20mA）
 *
 * 功能概述：
 * - 过程接口：低压室 L、高压室 H（下方两个气路端口），测量差压 Δp = p(H) − p(L)；
 * - 电气接口：二线制供电/信号 p(+) / n(−)，回路电流 4~20mA 与差压成正比；
 * - 面板：LCD 数显（显示实测差压，超限显示 LLLL / HHHH）、零点微调旋钮 Z、量程微调旋钮 S。
 *
 * 物理模型（与工具链 CircuitUtils.calcTransmitterCurrent 配合）：
 *     I_raw = 4 + 16 × (Δp − min) / (max − min)         理想电流
 *     I_out = (I_raw − 4) × spanAdj + 4 + zeroAdj       零点/量程修正后的回路电流
 *   LCD 显示值按反变换还原：Δp_disp = ((I_out − 4 − zeroAdj) / (16·spanAdj)) × (max − min) + min
 *   因此「旋钮只改变输出电流，不改变显示差压」——这正是现场调校的判据：
 *   差压不变而电流被拉回 4mA / 20mA，说明零点 / 量程被修正。
 *
 * 交互：
 * - 零点旋钮 Z：按住上半部增大 zeroAdj、按住下半部减小 zeroAdj（按住连续微调，松开停止）；
 * - 量程旋钮 S：按住上半部增大 spanAdj、按住下半部减小 spanAdj；
 * - 两个方向各登记独立热区（zero-inc / zero-dec / span-inc / span-dec），
 *   自动演示可直接 fire('mousedown') → 等待 → fire('mouseup') 模拟“按住旋钮微调”。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * 静态部件入 `_staticGroup` 只缓存一次；LCD 与旋钮转子入 `_dynamicGroup` in-place 更新；
 * 不使用 shadowColor / shadowBlur / shadowOpacity。
 */
export class DiffTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 外观尺寸：差压变送器较宽，以容纳左右双室
        this.width  = Math.max(180, Math.min(config.width  || 180, 240));
        this.height = Math.max(200, Math.min(config.height || 200, 260));

        this.type    = 'transmitter_2wire';
        this.special = 'diff';       // 差压设备标识（气路求解器据此计算 H − L）
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, min: this.min, max: this.max,
            press: this.press, unit: this.unit,
        };

        // ── 端口 ──
        // 过程接口（气路）：低压室 L、高压室 H（与三阀组输出口等距，便于垂直接管）
        this.addPort(this.width / 2 - 45, 183, 'l', 'pipe');
        this.addPort(this.width / 2 + 45, 183, 'h', 'pipe');
        // 二线制供电/信号（电气）：p(+) / n(−)
        this.addPort(this.width - 22, 15, 'p', 'wire', 'p');
        this.addPort(this.width - 22, 50, 'n', 'wire');

        this._render(true, 0);       // 初始：未通电 → 黑屏
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this._cx = this.width / 2;
        this._lcdY = 90;
        this._knobZeroX = 40;
        this._knobSpanX = this.width - 40;
        this._knobY = 32;
    }

    _initParameters(config) {
        // 面板微调量：零点偏移（mA 等效）、量程放大系数
        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        // 测量值与标定量程（MPa）
        this.press = 0;
        this.min = config.min !== undefined ? parseFloat(config.min) : 0;
        this.max = config.max !== undefined ? parseFloat(config.max) : 1;
        this.unit = config.unit || 'MPa';

        // 故障 / 电路状态（由求解器写入）
        this.isBreak = false;
        this.isShort = false;
        this.physCurrent = 0;
        this._lastVDiff = 0;

        // 按住旋钮时的微调步长与定时器
        this._trimStepZero = 0.02;    // mA / 50ms
        this._trimStepSpan = 0.004;   // 系数 / 50ms
        this._trimTimer = null;

        this.knobs = {};
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const cx = this._cx;

        // 1. 顶部接线盒
        const tBar = new Konva.Rect({
            x: 25, y: 10, width: this.width - 50, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5,
        });
        const title = new Konva.Text({
            x: 0, y: 12, width: this.width,
            text: '差压变送器', fontSize: 13, align: 'center',
            fill: '#2c3e50', fontStyle: 'bold',
        });
        this._staticGroup.add(tBar, title);

        // 2. 表头（深绿色圆盖）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: this._lcdY, radius: 55,
            fill: '#27ae60', stroke: '#1e8449', strokeWidth: 4,
        }));

        // 3. 底部差压测量室：左 L 室 + 中央敏感元件 + 右 H 室
        const flangeL = new Konva.Rect({
            x: cx - 80, y: 145, width: 65, height: 45,
            fill: '#bdc3c7', stroke: '#7f8c8d', cornerRadius: 2,
        });
        const flangeH = new Konva.Rect({
            x: cx + 15, y: 145, width: 65, height: 45,
            fill: '#bdc3c7', stroke: '#7f8c8d', cornerRadius: 2,
        });
        const chamber = new Konva.Rect({
            x: cx - 15, y: 140, width: 30, height: 55,
            fill: '#2f3542', stroke: '#1e272e', strokeWidth: 1, cornerRadius: 2,
        });
        // 中央隔膜（两室之间的分界）
        const diaphragm = new Konva.Line({
            points: [cx, 142, cx, 193],
            stroke: '#c0392b', strokeWidth: 3, lineCap: 'round',
        });
        const labelL = new Konva.Text({ x: cx - 60, y: 155, text: 'L', fontSize: 18, fill: '#c0392b', fontStyle: 'bold' });
        const labelH = new Konva.Text({ x: cx + 40, y: 155, text: 'H', fontSize: 18, fill: '#2980b9', fontStyle: 'bold' });
        this._staticGroup.add(flangeL, flangeH, chamber, diaphragm, labelL, labelH);

        // 4. 两个微调旋钮的底座 + 名称（旋钮转子在动态层）
        [[this._knobZeroX, '零点'], [this._knobSpanX, '量程']].forEach(([kx, name]) => {
            this._staticGroup.add(new Konva.Circle({
                x: kx, y: this._knobY, radius: 10,
                fill: '#dfe4ea', stroke: '#747d8c', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: kx - 13, y: 0, width: 26,
                text: name, fontSize: 9, align: 'center', fill: '#34495e',
            }));
        });

        // 5. 接线盒端子标识
        this._staticGroup.add(new Konva.Text({ x: this.width - 52, y: 10, text: 'p+', fontSize: 9, fill: '#c0392b' }));
        this._staticGroup.add(new Konva.Text({ x: this.width - 52, y: 45, text: 'n−', fontSize: 9, fill: '#34495e' }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const cx = this._cx;

        // LCD 屏（底色随正常/故障/断电变化）
        this.lcdBg = new Konva.Circle({ x: cx, y: this._lcdY, radius: 40, fill: '#000' });
        this.lcdText = new Konva.Text({
            x: cx - 38, y: this._lcdY - 10, width: 76,
            text: '', fontSize: 20, fontFamily: 'Digital-7, monospace',
            fill: '#00ff00', align: 'center',
        });
        this.unitText = new Konva.Text({
            x: cx - 20, y: this._lcdY + 15,
            text: '', fontSize: 10, fill: '#00ff00', opacity: 0.85,
        });
        this._dynamicGroup.add(this.lcdBg, this.lcdText, this.unitText);

        // 零点 / 量程微调旋钮的转子（随调节转动，in-place 更新）
        [[this._knobZeroX, 'zero'], [this._knobSpanX, 'span']].forEach(([kx, key]) => {
            const rotor = new Konva.Group({ x: kx, y: this._knobY, rotation: 0 });
            rotor.add(new Konva.Circle({ radius: 7, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -5, 0, 5], stroke: '#c0392b', strokeWidth: 2 }));
            this.knobs[key] = rotor;
            this._dynamicGroup.add(rotor);
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互（按住旋钮上/下半部连续微调）
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const bind = (kind, cx) => {
            const inc = this.addClickablePart(`${kind}-inc`, cx - 11, this._knobY - 11, 22, 11);
            const dec = this.addClickablePart(`${kind}-dec`, cx - 11, this._knobY, 22, 11);
            [[inc, 1], [dec, -1]].forEach(([hit, dir]) => {
                hit.on('mousedown touchstart', (e) => {
                    e.cancelBubble = true;
                    this._startTrim(kind, dir);
                });
                hit.on('mouseup mouseleave touchend', () => this._stopTrim());
            });
        };
        bind('zero', this._knobZeroX);
        bind('span', this._knobSpanX);

        // 整只旋钮 / LCD 的几何登记：仅供自动演示箭头与圈选定位（不注册命中区，
        // 避免遮挡上面的上/下半区热区）
        this._parts['zero'] = { x: this._knobZeroX - 10, y: this._knobY - 10, w: 20, h: 20 };
        this._parts['span'] = { x: this._knobSpanX - 10, y: this._knobY - 10, w: 20, h: 20 };
        this._parts['lcd']  = { x: this._cx - 40, y: this._lcdY - 40, w: 80, h: 80 };
        this._parts['chamber'] = { x: this._cx - 80, y: 140, w: 160, h: 55 };
    }

    _startTrim(kind, dir) {
        this._stopTrim();
        this._trim(kind, dir);
        this._trimTimer = setInterval(() => this._trim(kind, dir), 50);
    }

    _stopTrim() {
        if (this._trimTimer) {
            clearInterval(this._trimTimer);
            this._trimTimer = null;
        }
    }

    /** 单步微调（kind: 'zero' | 'span'；dir: +1 / -1） */
    _trim(kind, dir) {
        if (kind === 'zero') {
            this.zeroAdj = Math.max(-8, Math.min(8, this.zeroAdj + dir * this._trimStepZero));
            if (this.knobs.zero) this.knobs.zero.rotation(this.zeroAdj * 180);
        } else {
            this.spanAdj = Math.max(0.5, Math.min(2, this.spanAdj + dir * this._trimStepSpan));
            if (this.knobs.span) this.knobs.span.rotation((this.spanAdj - 1) * 900);
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /** 逐格微调零点（供脚本/演示兜底使用，dir=+1 增大） */
    adjustZero(dir = 1, steps = 1) {
        for (let i = 0; i < Math.abs(steps); i++) this._trim('zero', dir >= 0 ? 1 : -1);
        return this.zeroAdj;
    }

    /** 逐格微调量程 */
    adjustSpan(dir = 1, steps = 1) {
        for (let i = 0; i < Math.abs(steps); i++) this._trim('span', dir >= 0 ? 1 : -1);
        return this.spanAdj;
    }

    /** 直接设置零点偏移（mA），同步旋钮角度 */
    setZero(v) {
        this.zeroAdj = Math.max(-8, Math.min(8, parseFloat(v) || 0));
        if (this.knobs.zero) this.knobs.zero.rotation(this.zeroAdj * 180);
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 直接设置量程系数，同步旋钮角度 */
    setSpan(v) {
        this.spanAdj = Math.max(0.5, Math.min(2, parseFloat(v) || 1));
        if (this.knobs.span) this.knobs.span.rotation((this.spanAdj - 1) * 900);
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 零点/量程复位（出厂状态） */
    resetTrim() {
        this.setZero(0);
        this.setSpan(1);
    }

    /** 当前输出电流对应的显示差压（MPa） */
    get displayPress() {
        const i = (this.physCurrent || 0) * 1000;
        return ((i - 4 - this.zeroAdj) / (16 * this.spanAdj)) * (this.max - this.min) + this.min;
    }

    /**
     * 刷新 LCD 显示
     * @param {object} state { powered:boolean, transCurrent:number(mA) }
     */
    update(state) {
        const powered = !!(state && state.powered);
        const mA = (state && typeof state.transCurrent === 'number')
            ? state.transCurrent : (this.physCurrent || 0) * 1000;
        this._render(powered, mA);
    }

    /** LCD 渲染（in-place 更新，不重建节点） */
    _render(powered, inCurrent) {
        if (!this.lcdText || !this.lcdBg) return;

        // 断电 / 断线：黑屏
        if (this.isBreak || !powered) {
            if (this.lcdText.text() !== '') {
                this.lcdText.text('');
                this.unitText.text('');
                this.unitText.opacity(0);
                this.lcdBg.fill('#000');
                this._refreshIfDirty();
            }
            return;
        }

        // 差压 → 显示值
        const press = ((inCurrent - 4 - this.zeroAdj) / (16 * this.spanAdj)) * (this.max - this.min) + this.min;
        const disp = (this.unit === 'MPa') ? press : press * 10;
        const prec = (this.unit === 'MPa') ? 3 : 2;

        let text, bg, fg, showUnit;
        if (inCurrent < 3.8) {                 // 低于 3.8mA：回路开路/欠量程
            text = 'LLLL'; bg = '#2f3542'; fg = '#ff4757'; showUnit = false;
        } else if (inCurrent > 20.5) {         // 高于 20.5mA：超量程
            text = 'HHHH'; bg = '#2f3542'; fg = '#ff4757'; showUnit = false;
        } else {
            text = disp.toFixed(prec); bg = '#2ed573'; fg = '#1a1a1a'; showUnit = true;
        }

        if (this.lcdText.text() !== text) this.lcdText.text(text);
        if (this.lcdText.fill() !== fg) this.lcdText.fill(fg);
        if (this.lcdBg.fill() !== bg) this.lcdBg.fill(bg);
        const uText = showUnit ? this.unit : '';
        if (this.unitText.text() !== uText) this.unitText.text(uText);
        const uOp = showUnit ? 1 : 0;
        if (this.unitText.opacity() !== uOp) this.unitText.opacity(uOp);

        this._refreshIfDirty();
    }

    /** 每帧刷新：由求解器给出的回路电压/电流驱动 LCD */
    tick() {
        const powered = (this._lastVDiff || 0) > 10;
        this._render(powered, (this.physCurrent || 0) * 1000);
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '量程下限 (MPa)', key: 'min', type: 'number' },
            { label: '量程上限 (MPa)', key: 'max', type: 'number' },
            {
                label: '单位', key: 'unit', type: 'select',
                options: [
                    { label: 'MPa', value: 'MPa' },
                    { label: 'Bar', value: 'Bar' },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.min !== undefined && !Number.isNaN(parseFloat(newConfig.min))) {
            this.min = parseFloat(newConfig.min);
        }
        if (newConfig.max !== undefined && !Number.isNaN(parseFloat(newConfig.max))) {
            this.max = parseFloat(newConfig.max);
        }
        this.unit = newConfig.unit || this.unit;
        this.config = { ...this.config, id: this.id, min: this.min, max: this.max, unit: this.unit };
        if (this.unitText) this.unitText.text(this.unit);
        this.markDirty();
        this._refreshIfDirty();
        this._render((this._lastVDiff || 0) > 10, (this.physCurrent || 0) * 1000);
    }

    destroy() {
        this._stopTrim();
        super.destroy?.();
    }
}
