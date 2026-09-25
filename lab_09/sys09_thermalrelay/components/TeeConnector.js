import { BaseComponent } from './BaseComponent.js';

/**
 * TeeConnector — 三通接头（Tee Connector）组件
 *
 * 说明：
 * - 三通管件的可视化组件，支持四个方向（up/down/left/right）的端口布局；
 * - 无源被动组件：静态视觉放入 `_staticGroup` 并启用缓存，无动态节点；
 * - 端口通过 `_setupPorts()` 按方向计算并注册，适用于管道连线拓扑中的分支节点。
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`
 * （`_init` 内 `_drawStaticParts` + `_createDynamicNodes`），最后 `addPort`。
 */
export class TeeConnector extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(60, config.width  || 100);
        this.height = Math.max(60, config.height || 100);

        this.type  = 'teeConnector';
        this.cache = 'fixed'; // 静态内容缓存，无动态刷新

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, direction: this.direction };

        // 端口依赖方向/几何，放在最后注册
        this._setupPorts();
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = this.width;
        this.h = this.height;
        this._cx = this.w / 2;
        this._cy = this.h / 2;
        this._offset = 45;   // 端口距中心的距离（组件局部坐标）
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.direction = config.direction || 'up';
        this._rotMap = { up: 0, right: 90, down: 180, left: -90 };
        this._colors = {
            body: '#c1bcbc',      // 浅灰色塑钢主体
            metal: '#353638',     // 不锈钢卡环
            terminal: '#8590d8',  // 逻辑端子颜色
        };
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        // 视觉组：中心对齐并随方向旋转
        this.viewGroup = new Konva.Group({
            x: this._cx,
            y: this._cy,
            rotation: this._rotMap[this.direction] || 0,
        });
        this._staticGroup.add(this.viewGroup);

        // 中心块
        this.viewGroup.add(new Konva.Rect({
            x: -20, y: -20, width: 40, height: 40,
            fill: this._colors.body, stroke: '#999', strokeWidth: 1, cornerRadius: 5,
        }));

        // 三个方向的物理外观
        this._drawPortVisual(0, -20, 0);    // 上 (u)
        this._drawPortVisual(-20, 0, -90);  // 左 (l)
        this._drawPortVisual(20, 0, 90);    // 右 (r)
    }

    /** 绘制快插接口的物理外观 */
    _drawPortVisual(x, y, rotation) {
        const pG = new Konva.Group({ x, y, rotation });

        pG.add(new Konva.Rect({
            x: -15, y: -20, width: 30, height: 20,
            fill: this._colors.body, stroke: '#999', strokeWidth: 0.5,
        }));
        pG.add(new Konva.Rect({
            x: -17, y: -24, width: 34, height: 6,
            fill: this._colors.metal, cornerRadius: 1,
        }));

        this.viewGroup.add(pG);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 三通为无源被动组件，无动态节点
    }

    tick() {
        // 无动态，无需刷新
    }

    // ═══════════════════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════════════════

    /** 根据旋转方向计算并注册逻辑端口（先清理旧的 pipe 端口） */
    _setupPorts() {
        // 清理旧端口节点
        this.ports.forEach(p => {
            if (p.type === 'pipe' && p.node) p.node.destroy();
        });
        this.ports = this.ports.filter(p => p.type !== 'pipe');

        const cx = this._cx, cy = this._cy, off = this._offset;
        const rawOffsets = {
            u: { dx: 0, dy: -off },
            l: { dx: -off, dy: 0 },
            r: { dx: off, dy: 0 },
        };
        const rad = (this._rotMap[this.direction] || 0) * Math.PI / 180;

        ['u', 'l', 'r'].forEach(label => {
            const pos = rawOffsets[label];
            // 旋转矩阵
            const rx = pos.dx * Math.cos(rad) - pos.dy * Math.sin(rad);
            const ry = pos.dx * Math.sin(rad) + pos.dy * Math.cos(rad);
            this.addPort(cx + rx, cy + ry, label, 'pipe');
        });
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /** 三通为无源部件，压力由求解器直接传播，无需自身更新 */
    update() { }

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    /** 返回部件中心的世界坐标（供工作流箭头定位；方向与 _setupPorts 一致） */
    getClickablePartCenter(partId) {
        if (partId === 'body') return this._toAbs(this._cx, this._cy);

        const off = this._offset;
        const raw = { u: [0, -off], l: [-off, 0], r: [off, 0] };
        if (raw[partId]) {
            const rad = (this._rotMap[this.direction] || 0) * Math.PI / 180;
            const [dx, dy] = raw[partId];
            const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
            const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
            return this._toAbs(this._cx + rx, this._cy + ry);
        }
        return null;
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '安装方向',
                key: 'direction',
                type: 'select',
                options: [
                    { label: '开口朝上', value: 'up' },
                    { label: '开口朝下', value: 'down' },
                    { label: '开口朝左', value: 'left' },
                    { label: '开口朝右', value: 'right' },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;

        if (newConfig.direction && newConfig.direction !== this.direction) {
            this.direction = newConfig.direction;
            this._rebuild();
        }
    }

    /** 重建静态视觉与端口（方向变化时） */
    _rebuild() {
        this._staticGroup.destroyChildren();
        this.viewGroup = null;
        this._drawStaticParts();
        this.viewGroup.rotation(this._rotMap[this.direction] || 0);
        this._setupPorts();
        this.markDirty();
        this._refreshIfDirty();
    }
}
