import { BaseComponent } from '../components/BaseComponent.js';
import { MasterControllerDevice, LK_PATTERNS } from './MasterControllerDevice.js';

/**
 * LKAuxContact — 主令控制器附属开关（LK1 ~ LK7）
 *
 * ═══ 外观（静态）═══════════════════════════════════════════
 *   左边电气接口 ── 短横线 ──● 静触点        静触点 ●── 短横线 ── 右边电气接口
 *                        （中间约 40px 间隙）
 *   开关下方从左到右 7 个空心圆点（对应 7 个档位）；本开关动作的档位，
 *   圆点半径 +1px 并变为黑色实心。
 *
 * ═══ 状态 ═════════════════════════════════════════════════
 *   手柄处于本开关的任一动作档位时，左右静触点之间以亮绿粗线连通，
 *   代表开关接通（MNA 中以 0.01Ω 注入；断开时 10MΩ）。
 *
 * ═══ 复合设备 ═════════════════════════════════════════════
 *   与主令控制器手柄共享 MasterControllerDevice（同 deviceid），
 *   通过 lk 配置（1~7）选用对应的动作档位表。
 */
export class LKAuxContact extends BaseComponent {
    static DeviceClass = MasterControllerDevice;

    constructor(config, sys) {
        super(config, sys);

        // 宽度按"左右引线各约 22px（原 44px 的一半）"取值
        this.width  = Math.max(88, config.width  || 88);
        this.height = Math.max(76,  config.height || 86);

        this.type  = 'ContactorDevice';
        this.special = 'nocontact';
        this.cache = 'fixed';

        this._isClosed = false;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            deviceid: this.deviceid,
            lk:       this.lk,
            label:    this.label,
        };

        this.addPort(2, this._contactY, 'com', 'wire');
        this.addPort(this.width - 2, this._contactY, 'no', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._contactY = H / 2 - 8;
        this._gap      = 40;                 // 两静触点间隙
        this._leftX    = (W - this._gap) / 2;
        this._rightX   = (W + this._gap) / 2;

        this._dotR  = 3;                     // 空心圆点半径
        this._dotY  = H - 36;                // 圆点行（再上移 10px，贴近开关）
        this._dotX0 = 12;
        this._dotX1 = W - 12;
    }

    _initParameters(config) {
        this.deviceid = config.deviceid || 'LK';
        this.lk       = config.lk !== undefined ? Math.max(1, Math.min(7, parseInt(config.lk))) : 1;
        this.label    = config.label || `LK${this.lk}`;
        this._pattern = LK_PATTERNS[this.lk] || [];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawContacts();
        this._drawTerminals();
        this._drawLabel();
        this._drawPositionDots();
    }

    _drawContacts() {
        const W = this.width, cy = this._contactY;
        const color = '#7a828c';

        // 左接口 → 左静触点
        this._staticGroup.add(new Konva.Line({
            points: [2, cy, this._leftX, cy],
            stroke: color, strokeWidth: 2, lineCap: 'round',
        }));
        // 右静触点 → 右接口
        this._staticGroup.add(new Konva.Line({
            points: [this._rightX, cy, W - 2, cy],
            stroke: color, strokeWidth: 2, lineCap: 'round',
        }));

        // 左右静触点
        [this._leftX, this._rightX].forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: cy, radius: 4,
                fill: '#4a525c', stroke: '#2f353b', strokeWidth: 0.8,
            }));
        });
    }

    _drawTerminals() {
        const cy = this._contactY;
        [2, this.width - 2].forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: cy, radius: 4,
                fillLinearGradientStartPoint: { x: -4, y: -4 },
                fillLinearGradientEndPoint:   { x: 4, y: 4 },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
        });
    }

    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 8, width: W,
            text: this.label,
            fontSize: 14, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center',
        }));
    }

    /** 下方 7 个空心圆点；本开关动作的档位 → 半径 +1 且黑色实心 */
    _drawPositionDots() {
        const n = 7;
        for (let i = 0; i < n; i++) {
            const x = this._dotX0 + (this._dotX1 - this._dotX0) * i / (n - 1);
            const active = this._pattern[i] === 1;
            this._staticGroup.add(new Konva.Circle({
                x, y: this._dotY,
                radius: active ? this._dotR + 1 : this._dotR,
                fill: active ? '#000000' : 'rgba(0,0,0,0)',
                stroke: active ? '#000000' : '#8a8a8a',
                strokeWidth: 1.2,
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 动态节点（接通时的亮绿粗线）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._greenLine = new Konva.Line({
            points: [this._leftX, this._contactY, this._rightX, this._contactY],
            stroke: '#20e020', strokeWidth: 5,
            lineCap: 'round',
            visible: false, listening: false,
        });
        this._dynamicGroup.add(this._greenLine);
    }

    // ═══════════════════════════════════════════
    // 状态
    // ═══════════════════════════════════════════

    getValue() {
        return this._isClosed ? 0.01 : 10000000;
    }

    tick(dt) {
        const closed = this.deviceRef ? this.deviceRef.isLKClosed(this.lk) : false;
        if (closed !== this._isClosed) {
            this._isClosed = closed;
            this._greenLine.visible(closed);
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '开关编号 LK (1~7)',  key: 'lk',       type: 'number' },
            { label: '设备 ID (deviceid)', key: 'deviceid', type: 'text'   },
            { label: '标签',               key: 'label',    type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.lk !== undefined) {
            this.lk = Math.max(1, Math.min(7, parseInt(cfg.lk) || 1));
            this._pattern = LK_PATTERNS[this.lk] || [];
        }
        if (cfg.deviceid !== undefined) this.deviceid = cfg.deviceid;
        if (cfg.label !== undefined) this.label = cfg.label;
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
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
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
