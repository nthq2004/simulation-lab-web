import { BaseComponent } from './BaseComponent.js';

/**
 * 三阀组组件（Three-valve Manifold）
 *
 * 结构：高压阀 vH、低压阀 vL、平衡阀 vE 三只截止阀组成的阀组，用于差压变送器的投运与隔离：
 * - 投运前：先开平衡阀 vE（使高低压室连通、差压为零），再开高低压阀，最后关平衡阀；
 * - 停运时：先开平衡阀，再关高低压阀，避免单向受压损坏膜片。
 *
 * 端口：inl / inh（低压 / 高压输入，下方），outl / outh（低压 / 高压输出，上方）。
 *
 * 遵循新组件模板：静态阀体与管路入 `_staticGroup`（只缓存一次），
 * 手柄（随开/关转动变色）入 `_dynamicGroup` in-place 更新；
 * 三只手柄均用 `addClickablePart()` 登记热区并保存命中节点，供自动演示真实点击。
 */
export class ThreeValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.cache = 'fixed';

        this.width = 180;
        this.height = 160;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 端口定义
        this.addPort(45, 140, 'inl', 'pipe', 'in');
        this.addPort(135, 140, 'inh', 'pipe', 'in');
        this.addPort(45, 20, 'outl', 'pipe');
        this.addPort(135, 20, 'outh', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = 180;
        this.h = 160;
        // 三只手柄的位置（组件本地坐标）
        this._valvePos = {
            vE: { x: 90, y: 50, horizontal: true,  label: '平衡阀' },
            vL: { x: 45, y: 90, horizontal: false, label: '低压阀' },
            vH: { x: 135, y: 90, horizontal: false, label: '高压阀' },
        };
    }

    _initParameters(config) {
        this.type = '3valve';
        this.vE = config.vE !== undefined ? !!config.vE : false;  // 平衡阀
        this.vL = config.vL !== undefined ? !!config.vL : false;  // 低压截止阀
        this.vH = config.vH !== undefined ? !!config.vH : false;  // 高压截止阀
        this.valveElements = {};
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this.updateUI();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件（阀体 + 管路 + 名称）
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        // 1. 阀体
        this._staticGroup.add(new Konva.Rect({
            x: 20, y: 30, width: 140, height: 100,
            fill: '#c9cdce', stroke: '#95a5a6', strokeWidth: 2, cornerRadius: 5,
        }));

        // 2. 超粗管路（H/L 两条竖管 + 中间平衡管）
        const pipeStyle = { stroke: '#7f8c8d', strokeWidth: 16, lineCap: 'round' };
        this._staticGroup.add(new Konva.Line({ points: [45, 30, 45, 130], ...pipeStyle }));
        this._staticGroup.add(new Konva.Line({ points: [135, 30, 135, 130], ...pipeStyle }));
        this._staticGroup.add(new Konva.Line({ points: [45, 50, 135, 50], ...pipeStyle }));

        // 3. 阀门名称
        Object.values(this._valvePos).forEach(v => {
            this._staticGroup.add(new Konva.Text({
                x: v.x - 25, y: v.horizontal ? v.y - 40 : v.y + 22, width: 50,
                text: v.label, fontSize: 12, align: 'center',
                fill: '#0580fa', fontStyle: 'bold',
            }));
        });
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（手柄）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        Object.entries(this._valvePos).forEach(([key, v]) => {
            const g = new Konva.Group({ x: v.x, y: v.y });
            g.add(new Konva.Circle({ radius: 10, fill: '#34495e', stroke: '#2c3e50' }));

            const handle = new Konva.Rect({
                x: 0, y: 0, width: 12, height: 36,
                stroke: '#2c3e50', strokeWidth: 1.5, cornerRadius: 6,
                offsetX: 6, offsetY: 18,
                fill: '#e74c3c',
            });
            g.add(handle);
            this._dynamicGroup.add(g);

            this.valveElements[key] = { handle, isPipeHorizontal: v.horizontal };
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        Object.entries(this._valvePos).forEach(([key, v]) => {
            const hit = this.addClickablePart(key, v.x - 17, v.y - 17, 34, 34);
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.toggleValve(key);
            });
        });
    }

    /** 扳动某只手柄（切换开/关） */
    toggleValve(key) {
        if (this[key] === undefined) return this[key];
        this[key] = !this[key];
        this.updateUI();
        if (this.sys && typeof this.sys.updateTopology === 'function') this.sys.updateTopology();
        return this[key];
    }

    /** 设定某只阀的开/关状态（已处于目标位则不重复动作） */
    setValve(key, open) {
        if (this[key] === undefined) return false;
        if (!!this[key] !== !!open) this.toggleValve(key);
        return this[key];
    }

    /**
     * 核心更新函数：外部脚本可直接调用
     * 根据 vE / vL / vH 同步手柄角度与颜色（in-place，不重建节点）
     */
    updateUI() {
        for (const key in this.valveElements) {
            const { handle, isPipeHorizontal } = this.valveElements[key];
            const open = this[key];
            // 水平管路：导通 90°、截止 0°；垂直管路：导通 0°、截止 90°
            handle.rotation(isPipeHorizontal ? (open ? 90 : 0) : (open ? 0 : 90));
            handle.fill(open ? '#2ecc71' : '#e74c3c');
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }
}
