import { BaseComponent } from './BaseComponent.js';

/**
 * 压力表组件（PressMeter）
 *
 * 功能概述：
 * - 绘制模拟机械压力表（表盘 + 刻度 + 指针 + LCD 数显 + 管口）；
 * - 支持自定义量程（`min` / `max`，单位 MPa），将输入值线性映射到表盘角度；
 * - 提供 `update(inP)` 供求解器调用更新显示；指针/LCD 为动态节点，in-place 更新。
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`
 * （`_init` 内 `_drawStaticParts` + `_createDynamicNodes`），最后 `addPort`。
 */
export class PressMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'pressMeter';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, title: this.title, min: this.min, max: this.max };

        // 进气端口（表盘正下方）
        this.addPort(0, this.radius + 28 * this.scale, 'i', 'pipe', 'in');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.radius = (config.radius || 80) * this.scale;
        this.textRadius = this.radius - 25 * this.scale;
        this.w = (this.radius + 10) * 2;
        this.h = (this.radius + 40) * 2;

        // 指针扫描角度
        this.startAngle = -120;
        this.endAngle = 120;
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.title = config.title || '压力表 MPa';
        this.min = config.min !== undefined ? config.min : 0;
        this.max = config.max !== undefined ? config.max : 1.0;  // 默认 1.0 MPa
        this.pressure = 0;
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
        this.viewGroup = new Konva.Group({ x: 0, y: 0 });
        this._staticGroup.add(this.viewGroup);

        this._drawShell();
        this._drawPipe();
        this._drawZones();
        this._drawTicks();
        this._drawCenter();
        this._drawLcdPanel();
        this._drawName();
    }

    _drawShell() {
        this.viewGroup.add(new Konva.Circle({
            radius: this.radius + 6 * this.scale,
            stroke: '#333',
            strokeWidth: 4 * this.scale,
            fillRadialGradientEndPoint: { x: 20 * this.scale, y: 20 * this.scale },
            fillRadialGradientEndRadius: this.radius + 10 * this.scale,
            fillRadialGradientColorStops: [0, '#ffffff', 0.5, '#d0d6da', 1, '#9aa1a5'],
        }));
    }

    _drawPipe() {
        const pW = 20 * this.scale, pH = 25 * this.scale;
        this.viewGroup.add(new Konva.Rect({
            x: -pW / 2, y: this.radius + 4 * this.scale,
            width: pW, height: pH,
            stroke: '#555', strokeWidth: 3 * this.scale, fill: '#a09c9c', cornerRadius: 2,
        }));
    }

    _drawZones() {
        const zones = [
            { from: 0.0, to: 0.8 * this.max, color: '#5ff475' },        // 正常区
            { from: 0.8 * this.max, to: 1.0 * this.max, color: '#f80202' }, // 危险区
        ];
        zones.forEach(z => {
            const startA = this.valueToAngle(z.from);
            const endA = this.valueToAngle(z.to);
            this.viewGroup.add(new Konva.Arc({
                innerRadius: this.radius - 12 * this.scale,
                outerRadius: this.radius,
                angle: endA - startA,
                rotation: startA - 90,
                fill: z.color,
                opacity: 0.5,
            }));
        });
    }

    _drawTicks() {
        const majorCount = 10;
        const totalSteps = 50;
        const range = this.max - this.min;

        for (let i = 0; i <= totalSteps; i++) {
            const v = this.min + (range * i / totalSteps);
            const angle = this.valueToAngle(v);
            const rad = (angle - 90) * (Math.PI / 180);

            const isMajor = i % (totalSteps / majorCount) === 0;
            const len = (isMajor ? 16 : 8) * this.scale;

            this.viewGroup.add(new Konva.Line({
                points: [
                    (this.radius - len) * Math.cos(rad), (this.radius - len) * Math.sin(rad),
                    this.radius * Math.cos(rad), this.radius * Math.sin(rad),
                ],
                stroke: '#111', strokeWidth: (isMajor ? 2 : 1) * this.scale,
            }));

            if (isMajor) {
                this.viewGroup.add(new Konva.Text({
                    x: this.textRadius * Math.cos(rad) - 15 * this.scale,
                    y: this.textRadius * Math.sin(rad) - 6 * this.scale,
                    width: 30 * this.scale, align: 'center',
                    text: v.toFixed(1), fontSize: 11 * this.scale,
                    fontStyle: 'bold', fill: '#000',
                }));
            }
        }
    }

    _drawCenter() {
        this.viewGroup.add(new Konva.Circle({
            radius: 5 * this.scale, fill: '#333', stroke: '#000', strokeWidth: 1,
        }));
    }

    /** LCD 外壳（静态），数值文字在 _createDynamicNodes */
    _drawLcdPanel() {
        const w = 70 * this.scale, h = 24 * this.scale;
        const y = this.radius * 0.45 + 10 * this.scale;
        this._lcdY = y;
        this.viewGroup.add(new Konva.Rect({
            x: -w / 2, y, width: w, height: h,
            cornerRadius: 4 * this.scale, fill: '#072207', stroke: '#333', strokeWidth: 1,
        }));
    }

    _drawName() {
        this.viewGroup.add(new Konva.Text({
            x: -this.radius,
            y: this.radius * 0.35,
            width: this.radius * 2, align: 'center',
            text: this.title, fontSize: 12 * this.scale, fontStyle: 'bold', fill: '#444',
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 指针（绕表盘中心旋转）
        this.pointer = new Konva.Line({
            points: [0, 5 * this.scale, 0, -(this.radius - 15 * this.scale)],
            stroke: '#c0392b', strokeWidth: 3 * this.scale, lineCap: 'round',
            rotation: this.startAngle,
        });
        this._dynamicGroup.add(this.pointer);

        // LCD 数值
        this.lcdText = new Konva.Text({
            x: -70 * this.scale / 2, y: this._lcdY + 4 * this.scale,
            width: 70 * this.scale, align: 'center',
            text: '0.000', fontSize: 14 * this.scale,
            fontFamily: 'monospace', fill: '#7fff7f',
        });
        this._dynamicGroup.add(this.lcdText);
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    /** 量值（MPa）→ 表盘角度（度） */
    valueToAngle(value) {
        const ratio = (value - this.min) / (this.max - this.min);
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        return this.startAngle + clampedRatio * (this.endAngle - this.startAngle);
    }

    /**
     * 核心更新：供求解器调用
     * @param {number} inP 传入压力 MPa
     */
    update(inP = 0) {
        // 允许短暂超量程显示（最多到 max*1.1）
        const val = Math.max(this.min, Math.min(this.max * 1.1, inP));
        this.pressure = val;

        if (this.pointer) this.pointer.rotation(this.valueToAngle(val));
        if (this.lcdText) {
            this.lcdText.text(val.toFixed(3));
            this.lcdText.fill(val > this.max ? '#ff0000' : '#7fff7f');
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    getValue() {
        return this.pressure;
    }

    getConfigFields() {
        return [
            { label: '器件id', key: 'id', type: 'text' },
            { label: '器件名称', key: 'title', type: 'text' },
            { label: '最大量程 (MPa)', key: 'max', type: 'number' },
            { label: '最小量程 (MPa)', key: 'min', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.title) this.title = newConfig.title;
        if (newConfig.max) this.max = parseFloat(newConfig.max);
        if (newConfig.min) this.min = parseFloat(newConfig.min);

        this._rebuild();
    }

    /** 重建静态与动态视觉（量程/名称变化时），并重绘当前读数 */
    _rebuild() {
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this.pointer = null;
        this.lcdText = null;
        this._drawStaticParts();
        this._createDynamicNodes();
        this.update(this.pressure);
    }

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    /** 返回部件中心的世界坐标（供工作流箭头定位） */
    getClickablePartCenter(partId) {
        switch (partId) {
            case 'dial':    // 表盘中心
            case 'pointer': // 指针
                return this._toAbs(0, 0);
            case 'lcd':     // 数显
                return this._toAbs(0, this._lcdY + 12 * this.scale);
            case 'i':       // 进气口
                return this._toAbs(0, this.radius + 28 * this.scale);
            default:
                return null;
        }
    }

    destroy() {
        super.destroy?.();
    }
}
