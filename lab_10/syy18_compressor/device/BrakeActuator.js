import { BaseComponent } from '../components/BaseComponent.js';
import { ContactorDevice } from './ContactorDevice.js';

/**
 * BrakeActuator — 电磁制动器（ZDQ，简化型）
 *
 * ═══ 界面 ═══════════════════════════════════════════════════
 *  仅保留一个矩形框 + 中央「抱闸 / 松闸」状态文字（宽度减半，恰好容纳文字）。
 *
 * ═══ 电路模型 ═══════════════════════════════════════════════
 *  单个电磁线圈（a1–a2），与接触器线圈同型：
 *      type='ContactorDevice'、special='contactcoil' → 复用 stampContactCoils
 *      吸合判定由 ContactorDevice（额定 220V，吸合 0.85Un、释放 0.7Un）完成。
 *
 *  得电 → 线圈励磁 → 松闸；失电 → 弹簧复位 → 抱闸。
 */
export class BrakeActuator extends BaseComponent {
    static DeviceClass = ContactorDevice;

    constructor(config, sys) {
        super(config, sys);

        // 宽度减半（仅容纳「抱闸/松闸」文字）
        this.width  = Math.max(60, config.width  || 64);
        this.height = Math.max(40, config.height || 44);

        this.type    = 'ContactorDevice';
        this.special = 'contactcoil';
        this.cache   = 'fixed';

        this._initGroups();
        this._initParameters(config);
        this._init();

        this.config = { deviceid: this.deviceid, label: this.label };

        const cy = this.height / 2;
        this.addPort(0, cy, 'a1', 'wire');
        this.addPort(this.width, cy, 'a2', 'wire', 'p');
    }

    _initParameters(config) {
        this.deviceid = config.deviceid || 'ZDQ';
        this.label    = config.label || 'ZDQ';
        // 线圈额定电压（V）：吸合 0.85Un、释放 0.7Un（本工程为 24V）
        this._ratedVoltage = config.ratedVoltage !== undefined ? parseFloat(config.ratedVoltage) : 24;
        this._vBuf = new Array(20).fill(0);
        this._vIdx = 0;
        this._released = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const W = this.width, H = this.height;
        const cy = H / 2;

        // 左右引线（静态）
        this._staticGroup.add(new Konva.Line({
            points: [0, cy, 5, cy], stroke: '#555', strokeWidth: 1.6,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [W - 5, cy, W, cy], stroke: '#555', strokeWidth: 1.6,
        }));
    }

    _createDynamicNodes() {
        const W = this.width, H = this.height;

        // 矩形框（下方留出状态文字位置）——放在动态组：得电时需填充淡红，
        // 静态组是一次性位图缓存、运行时不再重建，故必须由动态组逐帧刷新。
        this._rect = new Konva.Rect({
            x: 4, y: 3, width: W - 8, height: H - 18,
            cornerRadius: 4, fill: '#f6f4ee',
            stroke: '#a8a094', strokeWidth: 1.5,
        });
        this._dynamicGroup.add(this._rect);

        // 矩形框内标注位号 ZDQ（置于矩形框之上，避免被填充遮住）
        this._dynamicGroup.add(new Konva.Text({
            x: 4, y: 3 + (H - 18) / 2 - 8, width: W - 8,
            text: this.config.deviceid || this.label || 'ZDQ',
            fontSize: 12, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));

        // 得电（松闸）加粗红框
        this._activeFrame = new Konva.Rect({
            x: 4, y: 3, width: W - 8, height: H - 18,
            cornerRadius: 4, stroke: '#e03030', strokeWidth: 4,
            visible: false,
        });
        this._dynamicGroup.add(this._activeFrame);

        // 初始外观与当前状态保持一致（配置更新重建节点时不丢状态）
        const released = this._released === true;
        this._rect.fill(released ? '#ffcccc' : '#f6f4ee');
        this._activeFrame.visible(released);

        // 状态文字写在矩形框下面，字号 10px
        this._statusText = new Konva.Text({
            x: 2, y: this.height - 13, width: this.width - 4,
            text: '抱闸', fontSize: 10, fontStyle: 'bold',
            fill: '#1e8a3c', align: 'center',
        });
        this._dynamicGroup.add(this._statusText);
    }

    tick() {
        // 线圈断线（故障注入）：线圈内部开路，无励磁电流 → 线圈电压视为 0，
        // 设备判定释放（抱闸），锚机无法松闸起动。此时忽略端子间的开路电压，
        // 避免开路时端子电压偏高被误判为"松闸"。
        if (this._faultCoilOpen) {
            if (this.deviceRef) this.deviceRef.setVoltage(0);
        } else if (this.deviceRef && this.sys.getVoltageBetween) {
            const vRaw = this.sys.getVoltageBetween(`${this.id}_wire_a1`, `${this.id}_wire_a2`);
            if (vRaw !== undefined && isFinite(vRaw)) {
                const v2 = vRaw * vRaw;
                const old = this._vBuf[this._vIdx];
                this._vBuf[this._vIdx] = v2;
                this._vIdx = (this._vIdx + 1) % this._vBuf.length;
                const vRms = Math.sqrt(this._vBuf.reduce((a, b) => a + b, 0) / this._vBuf.length);
                this.deviceRef.setVoltage(vRms);
                this.deviceRef.setRatedVoltage?.(this._ratedVoltage);
            }
        }

        const released = this.deviceRef ? this.deviceRef.isPickup() : false;
        if (released !== this._released) {
            this._released = released;
            // 得电（松闸）：内部淡红背景填充 + 加粗红实线外框
            this._rect.fill(released ? '#ffcccc' : '#f6f4ee');
            this._activeFrame.visible(released);
            this._statusText.text(released ? '松闸' : '抱闸');
            this._statusText.fill(released ? '#c0392b' : '#1e8a3c');
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    getValue() { return 1000; }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',    type: 'text' },
            { label: '设备 ID (deviceid)', key: 'deviceid', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label    = cfg.label;
        if (cfg.deviceid !== undefined) this.deviceid = cfg.deviceid;
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
