import { BaseComponent } from './BaseComponent.js';

/**
 * CheckValve — 单向截止阀可视化组件
 *
 * 图形（按教学截图）：
 *   · 左侧空心三角（箭头向右）＋ 右侧实心三角（箭头向右），中间竖直阀座线；
 *   · 外包方框支架；中间横向管路穿过。
 * 状态：
 *   · 默认「截止」——右侧实心三角为黑色；
 *   · 点击阀体手动打开——右侧实心三角变为蓝色（导通）。
 *
 * 求解器：`type='stopValve'`，端口 `i`(左, 进) / `o`(右, 出)，
 *         提供 `isOpen`，直接复用 PneumaticSolver 的截止阀透传逻辑。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 addPort。
 */
export class CheckValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(120, config.width || 180);
        this.height = Math.max(80, config.height || 120);

        this.type = 'stopValve';          // 复用气路求解器的截止阀分支
        this.special = 'checkvalve';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, isOpen: this.isOpen, label: this.label };

        this.addPort(6 * this._K, this._cy, 'i', 'pipe', 'in');   // 左：进气
        this.addPort(this._w - 6 * this._K, this._cy, 'o', 'pipe'); // 右：出气

        this.update();   // 按初始 isOpen 同步视觉
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        // config.scale 保持 1；内部再缩为原设计的 2/3
        const K = 2 / 3;
        this._K = K;
        this._w = (config.internalWidth || 180) * K;
        this._h = (config.internalHeight || 110) * K;
        this._cx = this._w / 2;
        this._cy = this._h / 2;
        this._pipeH = 20 * K;
    }

    _initParameters(config) {
        this.isOpen = config.isOpen || false;          // 默认截止
        this.label = config.label || '';
        this._tri = null;
        this._statusText = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const cx = this._cx, cy = this._cy, w = this._w, K = this._K;
        const half = 46 * K;
        const pipeStyle = {
            fillLinearGradientStartPoint: { x: 0, y: cy - this._pipeH / 2 },
            fillLinearGradientEndPoint: { x: 0, y: cy + this._pipeH / 2 },
            fillLinearGradientColorStops: [0, '#c8ccce', 0.5, '#9aa3a8', 1, '#c8ccce'],
            stroke: '#7a8288', strokeWidth: 1,
        };

        // 管路：只保留左右两段（中间一截取消）
        g.add(new Konva.Rect({ x: 0, y: cy - this._pipeH / 2, width: cx - half, height: this._pipeH, ...pipeStyle }));
        g.add(new Konva.Rect({ x: cx + half, y: cy - this._pipeH / 2, width: w - (cx + half), height: this._pipeH, ...pipeStyle }));

        // 手柄横线（红色）：上移 4px、左右各再缩短 5px，线宽 6px
        const hw = 52 * K - 10;
        const hy = cy - 46 * K - 4;
        g.add(new Konva.Line({ points: [cx - hw, hy, cx + hw, hy], stroke: '#e60000', strokeWidth: 6, lineCap: 'round', listening: false }));

        // 中间竖线：只保留上边一半
        g.add(new Konva.Line({ points: [cx, cy - 50 * K, cx, cy - 4 * K], stroke: '#111', strokeWidth: 3, lineCap: 'round', listening: false }));

        // 左：空心三角（向右）——与右三角在中心相连，左右导通
        g.add(new Konva.Line({
            points: [cx - half, cy - 34 * K, cx - half, cy + 34 * K, cx, cy, cx - half, cy - 34 * K],
            stroke: '#111', strokeWidth: 3, closed: true,
            fill: '#ffffff', listening: false,
        }));

        // 标注（再上移 5px，字号增大 2px）
        if (this.label) {
            g.add(new Konva.Text({
                x: 0, y: -14 * K - 5, width: w, text: this.label,
                fontSize: 18 * K + 2, fontStyle: 'bold', fill: '#333', align: 'center',
            }));
        }

        // 可识别部件（阀体 / 两端）
        this.addClickablePart('body', cx - 55 * K, cy - 52 * K, 110 * K, 100 * K);
        this.addClickablePart('i', 6 * K - 12 * K, cy - 12 * K, 24 * K, 24 * K);
        this.addClickablePart('o', w - 6 * K - 12 * K, cy - 12 * K, 24 * K, 24 * K);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（右侧实心三角 + 状态文字）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const cx = this._cx, cy = this._cy, K = this._K;
        const half = 46 * K;
        this._tri = new Konva.Line({
            points: [cx, cy, cx + half, cy - 34 * K, cx + half, cy + 34 * K],
            closed: true, stroke: '#111', strokeWidth: 3,
            fill: '#555555',   // 默认淡黑色 = 截止
        });
        this._dynamicGroup.add(this._tri);

        this._statusText = new Konva.Text({
            x: 0, y: this._h - 17, width: this._w,
            text: '截止', fontSize: 15 * K + 3, fontStyle: 'bold',
            fill: '#c0392b', align: 'center',
        });
        this._dynamicGroup.add(this._statusText);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const hit = this.getClickablePartNode('body');
        if (hit) {
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.toggle();
            });
        }
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.update();
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    update() {
        if (this._tri) this._tri.fill(this.isOpen ? '#00e83a' : '#555555');
        if (this._statusText) {
            this._statusText.text(this.isOpen ? '导通' : '截止');
            this._statusText.fill(this.isOpen ? '#00a020' : '#c0392b');
        }
        this.config = { ...this.config, isOpen: this.isOpen };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    getValue() { return this.isOpen; }

    setValue(val) {
        if ((val === true || val === false) && this.isOpen !== val) {
            this.isOpen = val;
            this.update();
        }
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '标签', key: 'label', type: 'text' },
            {
                label: '初始状态', key: 'isOpen', type: 'select',
                options: [
                    { label: '截止 (关闭)', value: false },
                    { label: '导通 (开启)', value: true },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.label !== undefined) this.label = newConfig.label;
        if (newConfig.isOpen !== undefined) {
            this.isOpen = (newConfig.isOpen === 'true' || newConfig.isOpen === true);
        }
        this.config = { ...this.config, ...newConfig };
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}

export default CheckValve;
