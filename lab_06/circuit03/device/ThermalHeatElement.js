import { BaseComponent } from '../components/BaseComponent.js';
import { ThermalRelayDevice } from './ThermalRelayDevice.js';

/**
 * ThermalHeatElement — 热继电器发热元件（复合设备驱动元件）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（发热丝颜色、过热红晕）全部 in-place 更新
 *  2. 消除所有 shadow 属性
 *  3. 静态部件（外框、发热丝符号、标签）仅 init 时缓存
 * ═══════════════════════════════════════════════════════════
 *
 * ── 界面（三相热元件）───────────────────────────────────────
 *  上方 3 个电气端口 L1/L2/L3，下方 3 个端口 T1/T2/T3。
 *  每相中间是发热元件符号（折叠发热丝）：
 *    端口 → 直下 → 右折 → 下 → 左折 → 直下到下方端口
 *  过载时发热丝由铜色渐变至红热，脱扣后高亮。
 *
 * ── 数据流 ──────────────────────────────────────────────────
 *  getValue() → MNA stamp（3× 0.01Ω 注入）
 *    → tick() 40 点滑动 RMS 采集三相电流 → deviceRef.setCurrent(max)
 *    → ThermalRelayDevice.preUpdate() 热积累 → tripped 状态
 *
 * ── 交互（试验/复位二合一）──────────────────────────────────
 *  未脱扣：点击 = 手动试验脱扣（TEST）
 *  已脱扣且过载消失：点击 = 复位（RESET）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  l1/l2/l3 — 进线（顶部）
 *  t1/t2/t3 — 出线（底部，'p' 极性）
 */
export class ThermalHeatElement extends BaseComponent {
    static DeviceClass = ThermalRelayDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(120, config.width  || 160);
        this.height = Math.max(90, config.height || 130);

        this.type  = 'ThermalRelayDevice';
        this.special = 'heatelement';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            deviceid:        config.deviceid,
            label:           this.label,
            ratedCurrent:    this.ratedCurrent,
            tripClass:       this.tripClass,
            phaseResistance: this._phaseResistance,
        };

        // ── 端口 ─────────────────────────────────
        this._poleData.forEach((p, i) => {
            this.addPort(p.cx, 2, ['l1', 'l2', 'l3'][i], 'wire');
            this.addPort(p.cx, this.height - 2, ['t1', 't2', 't3'][i], 'wire', 'p');
        });
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const margin = 15;
        const slotW = (W - margin * 2) / 3;

        this._poleData = Array.from({ length: 3 }, (_, i) => ({
            cx: 10 + (i + 0.5) * slotW,
            color: ['#e03030', '#20a030', '#2050e0'][i],
        }));

        // 发热丝折叠路径（相对每相中心列）——折叠高度为原 1/3，居中
        this._foldOffX = Math.max(10, slotW * 0.28);
        this._foldY1 = H * 0.42;
        this._foldY2 = H * 0.54;

        this._termR = Math.max(3.5, W * 0.014);
    }

    _initParameters(config) {
        this.label         = config.label        || 'FR';
        this.ratedCurrent  = config.ratedCurrent !== undefined ? config.ratedCurrent : 9;
        this.tripClass     = config.tripClass    !== undefined ? config.tripClass    : 10;
        this.function      = config.function     || '热继电器';

        this._phaseResistance = config.phaseResistance !== undefined ? config.phaseResistance : 0.01;

        // 每相 40 点滑动 RMS 缓冲区
        this._iBuf     = [new Array(40).fill(0), new Array(40).fill(0), new Array(40).fill(0)];
        this._iBufSum  = [0, 0, 0];
        this._iBufIdx  = 0;
        this._iBufCount = 1;
        this._phaseCurrents = [0, 0, 0];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawHeatSymbols();
        this._drawPanelLabel();
    }

    _drawFrame() {
        const W = this.width, H = this.height;
        const f = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f2efe8', stroke: '#c8b8a0', strokeWidth: 1.5, cornerRadius: f.rx,
        }));

    }

    /** 每相发热元件符号：上端口 → 直下 → 右 → 下 → 左 → 直下到下端口 */
    _drawHeatSymbols() {
        const H = this.height;
        const fs = Math.max(13, this.width * 0.017);
        const WIRE = '#c89020';

        this._poleData.forEach((p, i) => {
            const cx = p.cx;
            const foldX = cx + this._foldOffX;
            const y1 = this._foldY1;
            const y2 = this._foldY2;

            // 上端口引出线（直下）
            this._staticGroup.add(new Konva.Line({
                points: [cx, 2, cx, y1],
                stroke: WIRE, strokeWidth: 2.2, lineCap: 'round',
            }));
            // 发热丝折叠（右→下→左）
            this._staticGroup.add(new Konva.Line({
                points: [cx, y1, foldX, y1, foldX, y2, cx, y2],
                stroke: WIRE, strokeWidth: 2.6, lineCap: 'round', lineJoin: 'round',
            }));
            // 下端口引出线（直下）
            this._staticGroup.add(new Konva.Line({
                points: [cx, y2, cx, H - 2],
                stroke: WIRE, strokeWidth: 2.2, lineCap: 'round',
            }));

            // 标签 L1/L2/L3 与 T1/T2/T3
            this._staticGroup.add(new Konva.Text({
                x: cx - 18, y: 8,
                text: ['L1', 'L2', 'L3'][i], fontSize: fs, fontStyle: 'bold', fill: p.color,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 18, y: H - fs - 8,
                text: ['T1', 'T2', 'T3'][i], fontSize: fs, fontStyle: 'bold', fill: p.color,
            }));
        });
    }

    _drawPanelLabel() {
        const fs = Math.max(16, this.width * 0.028);
        this._staticGroup.add(new Konva.Text({
            x: this.width - 30, y: (this.height - fs) / 4,
            text: this.label,
            fontSize: fs, fontStyle: 'bold', fill: '#a06020',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        // 每相折叠发热丝的动态副本（用于过热变色，覆盖在静态丝之上）
        this._foldLines = this._poleData.map(p => {
            const cx = p.cx;
            const foldX = cx + this._foldOffX;
            const line = new Konva.Line({
                points: [cx, this._foldY1, foldX, this._foldY1, foldX, this._foldY2, cx, this._foldY2],
                stroke: 'rgba(255,120,0,0)', strokeWidth: 2.6,
                lineCap: 'round', lineJoin: 'round',
                listening: false,
            });
            this._dynamicGroup.add(line);
            return line;
        });

        // 过热红晕（围绕发热丝区域）
        const W = this.width, H = this.height;
        this._glow = new Konva.Rect({
            x: 6, y: this._foldY1 - 6,
            width: W - 12, height: (this._foldY2 - this._foldY1) + 12,
            cornerRadius: 8, fill: 'rgba(255,60,0,0)',
            listening: false,
        });
        this._dynamicGroup.add(this._glow);

        // 状态文字（试验/复位提示，TRIP 状态显示）
        this._statusText = new Konva.Text({
            x: -26, y: this._foldY1 + (this._foldY2 - this._foldY1) / 2 - 26,
            width: W,
            text: 'TRIP', fontSize: 14, fontStyle: 'bold',
            fill: '#e01010', align: 'center', visible: false,
            listening: false,
        });
        this._dynamicGroup.add(this._statusText);
    }

    // ═══════════════════════════════════════════
    // 交互（试验/复位二合一）
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: 'transparent',
        });
        hitArea.on('click tap', (e) => {
            if (e.evt?.button === 2) return;  // 右键仅弹出右键菜单
            e.cancelBubble = true;
            if (!this.deviceRef) return;
            if (this.deviceRef.isTripped()) {
                if (this.deviceRef.getManualTrip()) {
                    // 试验脱扣状态 → 取消试验并复位
                    this.deviceRef.setManualTrip(false);
                    this.deviceRef.requestReset();
                } else {
                    // 过载脱扣状态 → 复位（过载消失后生效）
                    this.deviceRef.requestReset();
                }
            } else {
                // 未脱扣 → 试验脱扣
                this.deviceRef.setManualTrip(!this.deviceRef.getManualTrip());
            }
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════
    // 电流采集与动态更新
    // ═══════════════════════════════════════════

    _sampleCurrents() {
        const R = this._phaseResistance || 0.01;
        if (!this.sys.getVoltageBetween) return;

        const idx = this._iBufIdx;
        for (let i = 0; i < 3; i++) {
            const v = this.sys.getVoltageBetween(`${this.id}_wire_l${i + 1}`, `${this.id}_wire_t${i + 1}`);
            const ia = (v !== undefined && isFinite(v)) ? v / R : 0;
            const old = this._iBuf[i][idx];
            this._iBuf[i][idx] = ia * ia;
            this._iBufSum[i] += ia * ia - old;
        }
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;

        let maxI = 0;
        for (let i = 0; i < 3; i++) {
            this._phaseCurrents[i] = Math.sqrt(this._iBufSum[i] / this._iBufCount);
            maxI = Math.max(maxI, this._phaseCurrents[i]);
        }

        if (this.deviceRef) {
            this.deviceRef.setCurrent(maxI);
            this.deviceRef.setRatedCurrent(this.ratedCurrent);
            this.deviceRef.setTripClass(this.tripClass);
        }
    }

    _updateVisual() {
        const dev = this.deviceRef;
        const heat = dev ? dev.getHeat() : 0;
        const tripped = dev ? dev.isTripped() : false;

        // 发热丝颜色：铜 → 橙 → 红（过热程度）
        const r = Math.round(200 + 55 * heat);
        const g = Math.round(144 - 124 * heat);
        const b = Math.round(32 - 32 * heat);
        const col = `rgba(${r},${g},${b},1)`;
        this._foldLines.forEach(l => l.stroke(col));

        // 红晕强度
        this._glow.fill(`rgba(255,60,0,${0.12 + heat * 0.22})`);
        this._glow.visible(heat > 0.05);

        // TRIP 指示
        this._statusText.visible(tripped);
    }

    getValue() {
        return this._phaseResistance;
    }

    tick(dt) {
        this._sampleCurrents();
        this._updateVisual();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '设备 ID (deviceid)', key: 'deviceid', type: 'text' },
            { label: '整定电流 (A)', key: 'ratedCurrent', type: 'number' },
            { label: '脱扣等级', key: 'tripClass', type: 'number' },
            { label: '热元件电阻 (Ω)', key: 'phaseResistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.deviceid !== undefined) this.config.deviceid = cfg.deviceid;
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.tripClass !== undefined) this.tripClass = parseFloat(cfg.tripClass);
        if (cfg.phaseResistance !== undefined) this._phaseResistance = parseFloat(cfg.phaseResistance);
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
