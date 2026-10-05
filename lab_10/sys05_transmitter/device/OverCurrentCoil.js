import { BaseComponent } from '../components/BaseComponent.js';
import { OverCurrentDevice } from './OverCurrentDevice.js';

/**
 * OverCurrentCoil — 过流继电器「测量电流的绕组」（GLJ 线圈）
 *
 * ═══ 复合设备 ═══════════════════════════════════════════════
 *  与输出触头（OverCurrentNOContact）共享 OverCurrentDevice（同 deviceid），
 *  参照接触器线圈 + 辅助触头的组织形式。
 *
 * ═══ 界面（参照 ContactorCoil）═══════════════════════════════
 *  矩形绕组框 + 位号；动作时外框变红、显示动作电流。
 *
 * ═══ 端口 ═══════════════════════════════════════════════════
 *  a1 / a2 —— 串接在电流互感器副边回路中的测量绕组
 *
 * ═══ 取样 ═══════════════════════════════════════════════════
 *  优先直接读取配置的电流互感器（ctId）副边电流 I_secondary；
 *  未配置时按「绕组两端电压 / 绕组电阻 senseR」计算。
 */
export class OverCurrentCoil extends BaseComponent {
    static DeviceClass = OverCurrentDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(50, config.width  || 80);
        this.height = Math.max(48, config.height || 56);

        // 复用接触器线圈分类，使求解器对 a1/a2 作电阻注入
        this.type    = 'ContactorDevice';
        this.special = 'OC_COIL';
        this.cache   = 'fixed';

        // 复合设备标识（必须赋值，否则 consys 不会关联 deviceRef，触头将无法动作）
        this.deviceid = config.deviceid || 'GLJ';
        this.label    = config.label || this.deviceid;

        this._senseR = config.senseR !== undefined ? config.senseR : 0.1;
        this._ctId   = config.ctId || '';
        // 动作值 = 额定电流 × 动作倍率（折算到互感器副边电流）
        this._ratedCurrent   = config.ratedCurrent !== undefined ? config.ratedCurrent : 75.9;
        this._pickupRatio    = config.pickupRatio  !== undefined ? config.pickupRatio  : 0.6;
        this._delayTime      = config.delayTime    !== undefined ? config.delayTime    : 5;
        this._pickupCurrent  = config.pickupCurrent  !== undefined ? config.pickupCurrent  : 1.2;
        this._releaseCurrent = config.releaseCurrent !== undefined ? config.releaseCurrent : 0.9;
        this._picked = false;

        // 副边电流滑动平均窗口：20fps 采样 50Hz 时瞬时值走样剧烈，
        // 窗口过短会让动作延时计时器被波动反复清零（实测 6 帧时计时只到 0.7s）。
        this._iBuf = new Array(25).fill(0);
        this._iIdx = 0;

        this._initGroups();
        this._recalcGeometry();
        this._init();

        this.config = {
            deviceid: this.deviceid,
            label: this.label,
            ctId: this._ctId,
            ratedCurrent: this._ratedCurrent,
            pickupRatio: this._pickupRatio,
            delayTime: this._delayTime,
            pickupCurrent: this._pickupCurrent,
            releaseCurrent: this._releaseCurrent,
            senseR: this._senseR,
        };

        const cy = this.height / 2;
        this.addPort(0, cy, 'a1', 'wire');
        this.addPort(this.width, cy, 'a2', 'wire', 'p');
    }

    _recalcGeometry() {
        // 绕组矩形宽度取组件宽度的 1/3，居中放置（左右引线等长、对称引出）
        const boxW = this.width / 3;
        this._box = {
            x: (this.width - boxW) / 2,
            y: this.height / 2 - 11,
            w: boxW,
            h: 22,
        };
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const b = this._box, cy = this.height / 2;

        // 左右引线
        this._staticGroup.add(new Konva.Line({ points: [0, cy, b.x, cy], stroke: '#555', strokeWidth: 1.6 }));
        this._staticGroup.add(new Konva.Line({ points: [b.x + b.w, cy, this.width, cy], stroke: '#555', strokeWidth: 1.6 }));

        // 绕组矩形
        this._rect = new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 3,
            fill: '#ffffff', stroke: '#555', strokeWidth: 1.5,
        });
        this._staticGroup.add(this._rect);

        // 位号
        this._nameText = new Konva.Text({
            x: 2, y: 3, width: this.width - 4,
            text: this.deviceid || 'GLJ', fontSize: 12, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center',
        });
        this._staticGroup.add(this._nameText);
    }

    _createDynamicNodes() {
        this._curText = new Konva.Text({
            x: 2, y: this.height - 15, width: this.width - 4,
            text: '', fontSize: 11, fontStyle: 'bold',
            fill: '#c0392b', align: 'center',
        });
        this._dynamicGroup.add(this._curText);
    }

    _sampleCurrent() {
        // 优先测量"流过本测量绕组"的电流（绕组两端电压 / 绕组电阻）：
        // 当 2SJ 常开触头闭合把绕组短路时，绕组两端电压≈0 → 电流≈0 → GLJ 不动作，
        // 全部副边电流从 2SJ 触头流过。
        if (this.sys?.getVoltageBetween && this._senseR > 0) {
            const v = this.sys.getVoltageBetween(`${this.id}_wire_a1`, `${this.id}_wire_a2`);
            if (v !== undefined && isFinite(v)) return v / this._senseR;
        }
        // 退化：直接读取互感器副边电流
        const ct = this._ctId ? this.sys?.comps?.[this._ctId] : null;
        if (ct && typeof ct.I_secondary === 'number') return ct.I_secondary;
        return 0;
    }

    tick() {
        const i = this._sampleCurrent();
        // 有效值（RMS）：瞬时值平方 → 滑窗平均 → 开方；不可用瞬时值直接比较
        this._iBuf[this._iIdx] = i * i;
        this._iIdx = (this._iIdx + 1) % this._iBuf.length;
        const iRms = Math.sqrt(this._iBuf.reduce((a, b) => a + b, 0) / this._iBuf.length);

        if (this.deviceRef) {
            // 动作值折算到互感器副边：I_pickup(副边) = 额定电流 × 动作倍率 / 变比
            const ct = this._ctId ? this.sys?.comps?.[this._ctId] : null;
            const ratio = (ct && ct._turnsRatio) ? ct._turnsRatio : 1;
            const pickup = (this._ratedCurrent * this._pickupRatio) / ratio;
            this.deviceRef.setCurrent(iRms);
            this.deviceRef.setPickupCurrent(pickup);
            this.deviceRef.setReleaseCurrent(pickup * 0.9);
            this.deviceRef.setDelayTime(this._delayTime);
        }

        const picked = this.deviceRef ? this.deviceRef.isPickup() : false;
        const waiting = this.deviceRef && !picked ? this.deviceRef.getOverElapsed() : 0;
        if (picked !== this._picked) {
            this._picked = picked;
            this._rect.stroke(picked ? '#e03030' : '#555');
            this._rect.fill(picked ? '#ffcccc' : '#ffffff');
        }
        this._curText.text(picked ? `动作 ${iRms.toFixed(2)}A`
            : (waiting > 0.2 ? `计时 ${waiting.toFixed(1)}s` : ''));

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '设备 ID (deviceid)', key: 'deviceid',       type: 'text'   },
            { label: '取样互感器 id',       key: 'ctId',           type: 'text'   },
            { label: '额定电流 (A)',        key: 'ratedCurrent',   type: 'number' },
            { label: '动作值 (×额定)',      key: 'pickupRatio',    type: 'number' },
            { label: '动作延时 (s)',        key: 'delayTime',      type: 'number' },
            { label: '绕组电阻 (Ω)',        key: 'senseR',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.deviceid !== undefined)       this.deviceid = cfg.deviceid;
        if (cfg.ctId !== undefined)           this._ctId = cfg.ctId;
        if (cfg.ratedCurrent !== undefined)   this._ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.pickupRatio !== undefined)    this._pickupRatio = parseFloat(cfg.pickupRatio);
        if (cfg.delayTime !== undefined)      this._delayTime = parseFloat(cfg.delayTime);
        if (cfg.pickupCurrent !== undefined)  this._pickupCurrent = parseFloat(cfg.pickupCurrent);
        if (cfg.releaseCurrent !== undefined) this._releaseCurrent = parseFloat(cfg.releaseCurrent);
        if (cfg.senseR !== undefined)         this._senseR = parseFloat(cfg.senseR);
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();
        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
            background: white; border: 1px solid #ccc; border-radius: 4px;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
            padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;`;
        const createItem = (label, onClick) => {
            const it = document.createElement('div');
            it.innerText = label;
            it.style = 'padding: 8px 15px; cursor: pointer;';
            it.onmouseenter = () => it.style.background = '#f0f0f0';
            it.onmouseleave = () => it.style.background = 'transparent';
            it.onclick = () => { onClick(); menu.remove(); };
            return it;
        };
        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));
        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    destroy() { super.destroy?.(); }
}
