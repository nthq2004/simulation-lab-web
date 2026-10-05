/**
 * BusTermResistor.js — CAN 总线终端电阻（120Ω，竖直放置，可通断）
 *
 * 教学用途：
 *   CAN 总线标准要求两端各接一个 120Ω 终端电阻，两个并联后总线等效电阻
 *   为 60Ω，阻抗匹配、通信正常；任一终端断开则等效电阻变为 120Ω 或开路，
 *   通信错误率上升。
 *
 *   本组件放在中央监控计算机下方总线连接器的左侧，与 DI 模块自带的终端
 *   电阻（termEnabled）共同构成这两个终端。
 *
 * 电气建模：
 *   this.type = 'resistor'  → 走 CircuitSolver 的通用电阻 stamp
 *   （DeviceStamps.stampResistors 按 `${id}_wire_l` / `${id}_wire_r` 取端口）
 *   currentResistance = 接通 ? 120 : 1000000，改动会触发拓扑签名变化并重解。
 *
 * 按新组件模板实现：
 *   构造 _initGroups → _recalcGeometry → _initParameters → _init → addPort
 *   _init = _drawStaticParts → _createDynamicNodes → _bindInteraction
 */

import { BaseComponent } from './BaseComponent.js';

const W = 52;
const H = 168;

export class BusTermResistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = W;
        this.height = H;
        this.type = 'resistor';          // 走通用电阻 MNA stamp（端口 l / r）
        this.special = 'bus_term';
        this.cache = 'fixed';            // 模板：静态部件仅 _staticGroup 做一次位图缓存

        this.enabled = true;             // 默认接通（与 DI 终端电阻共同构成 60Ω）

        // ── 新组件模板：固定调用顺序 ──
        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();
        this.config = {
            enabled: this.enabled,
            resistance: this.enabled ? 120 : 1000000,
        };

        // 最后注册端口（上 = CANH，下 = CANL，竖直放置）
        this.addPort(W / 2, 0, 'l', 'wire', 'p');
        this.addPort(W / 2, H, 'r', 'wire');
    }

    // ══════════════════════════════════════════
    //  模板：几何 / 参数 / 配置 API
    // ══════════════════════════════════════════
    _recalcGeometry() {
        this.width = W;
        this.height = H;
    }

    _initParameters(config) {
        if (config) {
            if (config.enabled != null) this.enabled = !!config.enabled;
        }
        this._syncResistance();
        this.config = { enabled: this.enabled, resistance: this.currentResistance };
    }

    getConfigFields() {
        return [
            { key: 'enabled', label: '终端电阻接通', type: 'boolean' },
        ];
    }

    onConfigUpdate(cfg) {
        if (!cfg) return;
        if (cfg.enabled != null) this.enabled = !!cfg.enabled;
        this._syncResistance();
        this.config.enabled = this.enabled;
        this.config.resistance = this.currentResistance;
        this._updateVisual();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 按通断状态同步 MNA stamp 所需的阻值 */
    _syncResistance() {
        this.currentResistance = this.enabled ? 120 : 1000000;
    }

    /** 当前接入的阻值（Ω） */
    getResistance() { return this.currentResistance; }

    /** 是否接通 */
    isEnabled() { return !!this.enabled; }

    /** 切换通断（点击或由演示调用，等价于真实点击） */
    toggle() {
        this.enabled = !this.enabled;
        this._syncResistance();
        this.config.enabled = this.enabled;
        this.config.resistance = this.currentResistance;
        this._updateVisual();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ══════════════════════════════════════════
    //  模板：_init() 三段式
    // ══════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    /** ① 静态部件：面板、标题、引线、端子、阻值标签（init 后不再变） */
    _drawStaticParts() {
        const st = this._staticGroup;
        const cx = W / 2;

        st.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#1b2430', stroke: '#3b4a5a', strokeWidth: 1.5, cornerRadius: 5,
        }));
        st.add(new Konva.Text({
            x: 2, y: 5, width: W - 4, text: '总线终端电阻',
            fontSize: 9, align: 'center', fill: '#8fb8d8',
        }));

        // 上下引线与端子
        st.add(new Konva.Line({ points: [cx, 24, cx, 52], stroke: '#d0d4d8', strokeWidth: 2 }));
        st.add(new Konva.Line({ points: [cx, H - 46, cx, H - 24], stroke: '#d0d4d8', strokeWidth: 2 }));
        st.add(new Konva.Rect({ x: cx - 10, y: 16, width: 20, height: 9, fill: '#c0c6cc', stroke: '#6b7379', strokeWidth: 1, cornerRadius: 2 }));
        st.add(new Konva.Rect({ x: cx - 10, y: H - 25, width: 20, height: 9, fill: '#c0c6cc', stroke: '#6b7379', strokeWidth: 1, cornerRadius: 2 }));

        // 阻值标签（固定文案）
        st.add(new Konva.Text({
            x: 2, y: H - 44, width: W - 4, text: '120Ω',
            fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', align: 'center', fill: '#ffcc00',
        }));
        // 端口标识
        st.add(new Konva.Text({ x: 2, y: 0, width: W - 4, text: 'CANH', fontSize: 7, align: 'center', fill: '#7f95a8' }));
        st.add(new Konva.Text({ x: 2, y: H - 12, width: W - 4, text: 'CANL', fontSize: 7, align: 'center', fill: '#7f95a8' }));
    }

    /** ② 动态节点：电阻体、锯齿波形、通断状态（会随 toggle 改变） */
    _createDynamicNodes() {
        const dyn = this._dynamicGroup;
        const cx = W / 2;

        this._body = new Konva.Rect({
            x: 7, y: 52, width: W - 14, height: 58,
            fill: '#2c3e50', stroke: '#8a97a5', strokeWidth: 1.5, cornerRadius: 3,
        });

        // 竖向锯齿电阻符号
        const pts = [cx, 52];
        const y0 = 58, y1 = 104, amp = 11, n = 6;
        for (let i = 0; i <= n; i++) {
            const y = y0 + (y1 - y0) * (i / n);
            pts.push(cx + (i % 2 === 0 ? -amp : amp), y);
        }
        pts.push(cx, 104);
        this._zig = new Konva.Line({
            points: pts, stroke: '#ffcc00', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
        });

        // 通断状态徽章
        this._stateBg = new Konva.Rect({
            x: 7, y: H - 64, width: W - 14, height: 16, fill: '#0f2b12', stroke: '#2f7d3a',
            strokeWidth: 1, cornerRadius: 3,
        });
        this._stateTxt = new Konva.Text({
            x: 7, y: H - 62, width: W - 14, text: '接通', fontSize: 10,
            align: 'center', fill: '#66d07a',
        });

        dyn.add(this._body, this._zig, this._stateBg, this._stateTxt);
        this._updateVisual();
    }

    /** ③ 交互绑定：点击整个面板切换通断 */
    _bindInteraction() {
        const hit = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: 'rgba(0,0,0,0)', stroke: null, listening: true, cursor: 'pointer',
        });
        this._interactGroup.add(hit);
        hit.on('click tap', () => this.toggle());
    }

    /** in-place 刷新通断外观 */
    _updateVisual() {
        const on = this.enabled;
        if (this._body) this._body.fill(on ? '#24405a' : '#3a2a2a');
        if (this._zig) this._zig.stroke(on ? '#ffcc00' : '#6a6a6a');
        if (this._stateBg) {
            this._stateBg.fill(on ? '#0f2b12' : '#2b1113');
            this._stateBg.stroke(on ? '#2f7d3a' : '#a33a3a');
        }
        if (this._stateTxt) {
            this._stateTxt.text(on ? '接通' : '断开');
            this._stateTxt.fill(on ? '#66d07a' : '#e08585');
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 无周期性变化，仅在点击/配置时刷新（保持模板 tick 结构） */
    tick(dt) { }
}
