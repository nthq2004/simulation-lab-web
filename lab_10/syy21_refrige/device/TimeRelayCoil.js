import { BaseComponent } from '../components/BaseComponent.js';
import { TimeRelayDevice } from './TimeRelayDevice.js';

/**
 * TimeRelayCoil — 时间继电器线圈（复合设备驱动元件）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（吸合红框）in-place 更新
 *  2. 消除所有 shadow 属性
 *  3. 静态部件（虚线框、线圈符号、位号、时钟图标）仅 init 时缓存
 * ═══════════════════════════════════════════════════════════
 *
 * ── 界面 ────────────────────────────────────────────────────
 *  上下两个紧贴矩形：上矩形内画 ×（时间继电器线圈符号），
 *  下矩形内标注位号 KT1。左右引线从总高中间引出。
 *  得电吸合时外框变红（activeFrame）。
 *
 * ── 数据流 ──────────────────────────────────────────────────
 *  getValue() → MNA stamp（线圈电阻注入）
 *    → tick() 20 点滑动 RMS 采集 a1-a2 电压 → deviceRef.setVoltage(vRms)
 *    → TimeRelayDevice.preUpdate() 状态迁移（计时/输出）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  a1 — 线圈进线（左）
 *  a2 — 线圈出线（右，'p' 极性）
 */
export class TimeRelayCoil extends BaseComponent {
    static DeviceClass = TimeRelayDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(100, config.width  || 124);
        this.height = Math.max(48, config.height || 60);

        // type 复用接触器分类，使求解器对线圈端口作 MNA stamp（固定电阻）；
        // DeviceClass 仍为 TimeRelayDevice，驱动时间继电器状态机
        this.type    = 'ContactorDevice';
        this.special = 'contactcoil';
        this.cache   = 'fixed';

        this._coilResistance = config.coilResistance || 2000;
        this._delayTime      = config.delayTime      !== undefined ? config.delayTime : 5;
        this._energized = false;

        this._vBuf = new Array(20).fill(0);
        this._vBufIdx = 0;
        this._vBufSum = 0;
        this._vBufCount = 0;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            deviceid:        config.deviceid,
            label:           this.label,
            delayTime:       this._delayTime,
            coilResistance:  this._coilResistance,
        };

        const cy = this.height / 2;
        this.addPort(0, cy, 'a1', 'wire');
        this.addPort(this.width, cy, 'a2', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const bw = Math.min(40, Math.max(24, W - 30));   // 矩形宽 40，两端各留 15 引线
        const bx = (W - bw) / 2;
        const topBh = 12;                                  // 上矩形矮
        const botBh = 23;                                 // 下矩形高
        const topY = Math.max(4, Math.round((H - (topBh + botBh)) / 2));
        this._upperRect = { bx, by: topY, bw, bh: topBh };
        this._lowerRect = { bx, by: topY + topBh, bw, bh: botBh };
        this._coilBox   = { bx, by: topY, bw, bh: topBh + botBh };
    }

    _initParameters(config) {
        this.label = config.label || 'KT';
        // 延时方式：'on' 通电延时；'off' 断电延时
        this._mode = config.mode === 'off' ? 'off' : 'on';
        // 线圈额定电压（V）：吸合取 0.85Un、返回取 0.7Un
        this._ratedVoltage = config.ratedVoltage !== undefined ? parseFloat(config.ratedVoltage) : 24;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const u = this._upperRect;
        const W = this.width, H = this.height;
        const cy = H / 2;

        // 左右引线（从总高中间引出）——静态
        this._staticGroup.add(new Konva.Line({
            points: [0, cy, u.bx, cy],
            stroke: '#555', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [u.bx + u.bw, cy, W, cy],
            stroke: '#555', strokeWidth: 1.5, listening: false,
        }));
    }

    _createDynamicNodes() {
        const u = this._upperRect, l = this._lowerRect, b = this._coilBox;

        // 上/下矩形：得电时需填充淡红。静态组是一次性位图缓存、运行时不再重建，
        // 故两个矩形必须放在 _dynamicGroup 才能逐帧刷新填充色（in-place 更新）。
        this._fillRects = [];
        this._fillRects.push(new Konva.Rect({
            x: u.bx, y: u.by, width: u.bw, height: u.bh,
            stroke: '#555', strokeWidth: 1.5, cornerRadius: 3,
            fill: '#f5f5f0',
        }));
        this._dynamicGroup.add(this._fillRects[this._fillRects.length - 1]);

        // 上矩形内 ×（交叉对角线，时间继电器线圈符号）
        const mx1 = u.bx + 4, my1 = u.by + 2, mx2 = u.bx + u.bw - 4, my2 = u.by + u.bh - 2;
        this._dynamicGroup.add(new Konva.Line({
            points: [mx1, my1, mx2, my2], stroke: '#202020', strokeWidth: 1.6,
            lineCap: 'round', listening: false,
        }));
        this._dynamicGroup.add(new Konva.Line({
            points: [mx1, my2, mx2, my1], stroke: '#202020', strokeWidth: 1.6,
            lineCap: 'round', listening: false,
        }));

        // 下矩形
        this._fillRects.push(new Konva.Rect({
            x: l.bx, y: l.by, width: l.bw, height: l.bh,
            stroke: '#555', strokeWidth: 1.5, cornerRadius: 3,
            fill: '#f5f5f0',
        }));
        this._dynamicGroup.add(this._fillRects[this._fillRects.length - 1]);

        // 下矩形内位号 KT1（置于矩形之上，避免被填充遮住）
        this._dynamicGroup.add(new Konva.Text({
            x: l.bx + 2, y: l.by + (l.bh - 14) / 2, width: l.bw - 4,
            text: this.config.deviceid || this.label || 'KT',
            fontSize: 13, fontStyle: 'bold', fill: '#333', align: 'center',
        }));

        // 得电加粗红框（覆盖上、下两个矩形）
        this._activeFrame = new Konva.Rect({
            x: b.bx, y: b.by, width: b.bw, height: b.bh,
            stroke: '#e03030', strokeWidth: 4, cornerRadius: 3,
            visible: false,
        });
        this._dynamicGroup.add(this._activeFrame);

        // 动态倒计时文本（显示在线圈左侧，垂直居中）
        const l0 = this._lowerRect;
        this._countdownText = new Konva.Text({
            x: 0,
            y: l0.by + (l0.bh - 18) / 2,
            width: Math.max(20, u.bx - 2),
            text: '', fontSize: 16, fontStyle: 'bold',
            fill: '#e03030', align: 'right',
            visible: false,
        });
        this._dynamicGroup.add(this._countdownText);

        // 延时方式标注（通电延时 / 断电延时）
        this._modeText = new Konva.Text({
            x: 0, y: this.height - 10, width: this.width,
            text: this._mode === 'off' ? '断电延时' : '通电延时',
            fontSize: 9, fill: '#5a6a7a', align: 'center',
            listening: false,
        });
        this._dynamicGroup.add(this._modeText);
    }

    getValue() {
        return this._coilResistance;
    }

    tick(dt) {
        if (this.deviceRef && this.sys.getVoltageBetween) {
            const vRaw = this.sys.getVoltageBetween(`${this.id}_wire_a1`, `${this.id}_wire_a2`);
            if (vRaw !== undefined && isFinite(vRaw)) {
                const v2 = vRaw * vRaw;
                const old = this._vBuf[this._vBufIdx];
                this._vBuf[this._vBufIdx] = v2;
                this._vBufSum = this._vBufSum - old + v2;
                this._vBufIdx = (this._vBufIdx + 1) % 20;
                if (this._vBufCount < 20) this._vBufCount++;

                if (this._vBufCount >= 20) {
                    const vRms = Math.sqrt(this._vBufSum / 20);
                    this.deviceRef.setVoltage(vRms);
                    this.deviceRef.setDelayTime(this._delayTime);
                    if (typeof this.deviceRef.setMode === 'function') this.deviceRef.setMode(this._mode);
                    if (typeof this.deviceRef.setRatedVoltage === 'function') this.deviceRef.setRatedVoltage(this._ratedVoltage);
                }
            }
        }

        const energized = this.deviceRef ? this.deviceRef.isEnergized() : false;
        this._activeFrame.visible(energized);
        // 得电：粗红实线外框 + 内部淡红背景填充
        if (energized !== this._lastEnergized) {
            this._lastEnergized = energized;
            if (this._fillRects) this._fillRects.forEach(r => r.fill(energized ? '#ffcccc' : '#f5f5f0'));
        }

        // 倒计时：通电延时在计时阶段显示剩余时间；断电延时在断电延续期显示剩余时间
        const st = this.deviceRef ? this.deviceRef.getState() : 'idle';
        const counting = (this._mode === 'on')
            ? (st === 'timing')
            : (st === 'output' && !energized && !this.deviceRef.getManualOverride());
        if (counting && this.deviceRef.state) {
            const remain = Math.max(0, this._delayTime - (this.deviceRef.state.elapsed || 0));
            this._countdownText.text(remain.toFixed(1) + 's');
            this._countdownText.visible(true);
        } else {
            this._countdownText.visible(false);
        }

        if (this._modeText) this._modeText.text(this._mode === 'off' ? '断电延时' : '通电延时');

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '设备 ID (deviceid)', key: 'deviceid', type: 'text' },
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '延时方式', key: 'mode', type: 'select', options: [
                { value: 'on',  label: '通电延时' },
                { value: 'off', label: '断电延时' },
            ]},
            { label: '延时时间 (s)', key: 'delayTime', type: 'number', min: 0, max: 30, step: 0.5 },
            { label: '线圈额定电压 (V)', key: 'ratedVoltage', type: 'number' },
            { label: '线圈电阻 (Ω)', key: 'coilResistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.mode !== undefined) this._mode = cfg.mode === 'off' ? 'off' : 'on';
        if (cfg.delayTime !== undefined) this._delayTime = Math.max(0, Math.min(30, parseFloat(cfg.delayTime)));
        if (cfg.ratedVoltage !== undefined) this._ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.coilResistance !== undefined) this._coilResistance = parseFloat(cfg.coilResistance);
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() { super.destroy?.(); }
}
