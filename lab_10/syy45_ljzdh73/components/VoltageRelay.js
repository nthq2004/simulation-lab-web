import { BaseComponent } from './BaseComponent.js';

/**
 * VoltageRelay — 电压继电器（电压继电器）仿真组件
 *
 * 说明：
 * - 模拟以线圈电压/电流驱动的继电器：线圈得电（电流 ≥ pickupCurrent）吸合，触点闭合；
 *   电流 ≤ releaseCurrent 时释放，触点断开；
 * - 提供 `pickupCurrent` / `releaseCurrent` 等参数以定义吸合/释放阈值，
 *   并提供线圈与触点动画；
 * - 遵循新组件规范（BaseComponent 模板）：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`；
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`；
 *   静态件位图缓存一次，动态件（动触臂/线圈颜色）in-place 更新，不刷新缓存、无阴影。
 */
export class VoltageRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'relay';       // 用于万用表识别
        this.special = 'voltage';  // 用于区分继电器和普通电阻
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        // 可选位号标注（如零压继电器 LYJ）
        this.label = config.label || '';

        this.config = {
            id: this.id,
            label: this.label,
            pickupCurrent: this.pickupCurrent,
            releaseCurrent: this.releaseCurrent,
        };

        // 线圈（l/r）与触点（COM/NO）
        this.addPort(30, 0, 'l', 'wire', 'p');
        this.addPort(this.W - 30, 0, 'r', 'wire');
        this.addPort(30, this.H, 'COM', 'wire');
        this.addPort(this.W - 30, this.H, 'NO', 'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════════

    _recalcGeometry() {
        this.W = 160;
        this.H = 100;
        this._contactY = 70;
    }

    _initParameters(config) {
        this.currentResistance = 120;                                  // Ω（万用表读取）
        this.pickupCurrent = config.pickupCurrent || 0.15;             // A
        this.releaseCurrent = config.releaseCurrent || 0.05;           // A
        this.current = 0;
        this.isEnergized = false;
        this.coilFault = false;
        this.contactFault = false;
        this._tickAcc = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════════

    _drawStaticParts() {
        const W = this.W, H = this.H;
        const centerY = 35, contactY = this._contactY;

        // 外壳
        this._staticGroup.add(new Konva.Rect({
            width: W, height: H, stroke: 'black', strokeWidth: 3, fill: '#f8f8f8',
        }));

        // 位号（可选）
        if (this.config && this.config.label) {
            this._staticGroup.add(new Konva.Text({
                x: 8, y: 4, width: W - 16,
                text: this.config.label, fontSize: 13, fontStyle: 'bold',
                fill: '#2c3e50', align: 'left',
            }));
        }

        // 线圈两端引线到顶部端子
        this._staticGroup.add(new Konva.Line({ points: [30, 0, 30, centerY, 50, centerY], stroke: 'black', strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [W - 30, 0, W - 30, centerY, W - 50, centerY], stroke: 'black', strokeWidth: 2 }));

        // NO 触点（固定）+ 引线
        this._staticGroup.add(new Konva.Line({ points: [W - 60, contactY, W - 30, contactY], stroke: 'black', strokeWidth: 3 }));
        this._staticGroup.add(new Konva.Circle({ x: W - 60, y: contactY, radius: 4, fill: 'black' }));
        this._staticGroup.add(new Konva.Line({ points: [W - 30, contactY, W - 30, H], stroke: 'black', strokeWidth: 2 }));

        // COM 触点（固定）+ 引线
        this._staticGroup.add(new Konva.Line({ points: [30, contactY, 60, contactY], stroke: 'black', strokeWidth: 3 }));
        this._staticGroup.add(new Konva.Circle({ x: 60, y: contactY, radius: 4, fill: 'black' }));
        this._staticGroup.add(new Konva.Line({ points: [30, contactY, 30, H], stroke: 'black', strokeWidth: 2 }));

        // 可识别部件：线圈、动触臂、触点
        this.addClickablePart('coil', 40, centerY - 16, W - 80, 32);
        this.addClickablePart('arm', 55, contactY - 6, 55, 30);
        this.addClickablePart('contact', W - 70, contactY - 10, 55, 24);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态节点（in-place 更新）
    // ═══════════════════════════════════════════════════════════

    _createDynamicNodes() {
        const W = this.W, centerY = 35, contactY = this._contactY;

        // 螺旋线圈
        const startX = 50, endX = W - 50, turns = 6, amplitude = 10, points = [];
        for (let i = 0; i <= turns * 25; i++) {
            const t = i / (turns * 25);
            points.push(startX + (endX - startX) * t, centerY + Math.sin(t * turns * Math.PI * 2) * amplitude);
        }
        this.coilShape = new Konva.Line({ points, stroke: 'blue', strokeWidth: 2, lineCap: 'round', lineJoin: 'round' });
        this._dynamicGroup.add(this.coilShape);

        // 动触臂（吸合 → 闭合；释放 → 张开）
        this.armOpenPoints = [60, contactY, 100, contactY + 20];
        this.armClosedPoints = [60, contactY, 100, contactY];
        this.arm = new Konva.Line({ points: this.armOpenPoints, stroke: 'black', strokeWidth: 3, lineCap: 'round' });
        this._dynamicGroup.add(this.arm);
    }

    _bindInteraction() { /* 继电器为被控器件，无需交互 */ }

    // ═══════════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.1) return;
        this._tickAcc = 0;
        this.update();
    }

    update() {
        if (!this.sys.getVoltageBetween) return;

        const voltage = Math.abs(this.sys.getVoltageBetween(
            `${this.id}_wire_l`, `${this.id}_wire_r`
        ));
        if (voltage == null) return;

        // 线圈故障时等效内阻极大（近似断路）
        this.currentResistance = this.coilFault ? 1e9 : 120;
        this.current = voltage / this.currentResistance;

        if (!this.isEnergized && this.current >= this.pickupCurrent) this._energize();
        if (this.isEnergized && this.current <= this.releaseCurrent) this._deenergize();

        this._updateCoilVisual();
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateCoilVisual() {
        const ratio = Math.min(this.current / this.pickupCurrent, 1);
        this.coilShape.stroke(`rgb(${Math.floor(255 * ratio)},0,255)`);
    }

    _energize() {
        this.isEnergized = true;
        new Konva.Tween({ node: this.arm, duration: 0.15, points: this.armClosedPoints, easing: Konva.Easings.EaseInOut }).play();
        this.arm.stroke('red');
    }

    _deenergize() {
        this.isEnergized = false;
        new Konva.Tween({ node: this.arm, duration: 0.2, points: this.armOpenPoints, easing: Konva.Easings.ElasticEaseOut }).play();
        this.arm.stroke('black');
    }

    // ═══════════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '位号标注', key: 'label', type: 'text' },
            { label: '吸合电流 (A)', key: 'pickupCurrent', type: 'number' },
            { label: '释放电流 (A)', key: 'releaseCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.label !== undefined) this.label = newConfig.label;
        if (newConfig.pickupCurrent !== undefined) this.pickupCurrent = parseFloat(newConfig.pickupCurrent) || 0.15;
        if (newConfig.releaseCurrent !== undefined) this.releaseCurrent = parseFloat(newConfig.releaseCurrent) || 0.05;
        this.config = {
            ...this.config,
            id: this.id, label: this.label,
            pickupCurrent: this.pickupCurrent, releaseCurrent: this.releaseCurrent,
        };
    }

    destroy() {
        super.destroy?.();
    }
}

export default VoltageRelay;
