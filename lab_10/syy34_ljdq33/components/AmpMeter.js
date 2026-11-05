import { BaseComponent } from './BaseComponent.js';

/**
 * 模拟电流表（模拟仪表面板）
 *
 * 视觉：带刻度、指针和嵌入式 LCD 的电流表，支持数值→角度映射、可配置量程。
 * 行为：`update(mA)` 外部驱动，完成限幅、指针旋转与 LCD 文本更新。
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`
 * （`_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`），最后 `addPort`。
 * 指针与 LCD 数值放 `_dynamicGroup`，in-place 更新，不再逐帧刷新静态缓存。
 */
export class AmpMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'ampmeter';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, title: this.title, min: this.min, max: this.max };

        const radp = Konva.getAngle(120);
        const x1 = (this.radius + 10 * this.scale) * Math.cos(radp);
        const y1 = (this.radius + 10 * this.scale) * Math.sin(radp);
        this.addPort(x1, y1, 'n', 'wire');

        const radn = Konva.getAngle(60);
        const x2 = (this.radius + 10 * this.scale) * Math.cos(radn);
        const y2 = (this.radius + 10 * this.scale) * Math.sin(radn);
        this.addPort(x2, y2, 'p', 'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.scale = 1;
        this.radius = (config.radius || 70) * this.scale;
        this.textRadius = this.radius - 22 * this.scale;
        // 船舶仪表标准：-120° ~ +120°
        this.startAngle = -120;
        this.endAngle = 120;
        this._lcdY = this.radius * 0.44;
    }

    _initParameters(config) {
        this.min = config.min !== undefined ? parseFloat(config.min) : 0;
        this.max = config.max !== undefined ? parseFloat(config.max) : 20;
        this.value = 0;
        this.title = config.title || '电流表mA';
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
        this._drawShell();
        this._drawZones();
        this._drawTicks();
        this._drawCenter();
        this._drawLcdShell();
        this._drawName();

        // 可识别部件
        this.addClickablePart('dial', -this.radius, -this.radius, this.radius * 2, this.radius * 2);
        this.addClickablePart('lcd', -35 * this.scale, this._lcdY, 70 * this.scale, 24 * this.scale);
    }

    valueToAngle(value) {
        const ratio = (value - this.min) / (this.max - this.min);
        return this.startAngle + ratio * (this.endAngle - this.startAngle);
    }

    _drawShell() {
        this._staticGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: this.radius + 6 * this.scale,
            stroke: '#333', strokeWidth: 4 * this.scale,
            fillRadialGradientStartPoint: { x: -20 * this.scale, y: -20 * this.scale },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: 20 * this.scale, y: 20 * this.scale },
            fillRadialGradientEndRadius: this.radius + 10 * this.scale,
            fillRadialGradientColorStops: [0, '#ffffff', 0.5, '#d0d6da', 1, '#9aa1a5'],
        }));
    }

    _drawZones() {
        const zones = [
            { from: 0.0, to: 0.2, color: '#e74c3c' },
            { from: 0.2, to: 0.9, color: '#2ecc71' },
            { from: 0.9, to: 1.0, color: '#f1c40f' },
        ];
        zones.forEach(z => {
            const angle = (z.to - z.from) * (this.endAngle - this.startAngle);
            const rotation = this.startAngle - 90 + z.from * (this.endAngle - this.startAngle);
            this._staticGroup.add(new Konva.Arc({
                x: 0, y: 0, innerRadius: this.radius - 12 * this.scale,
                outerRadius: this.radius, angle, rotation, fill: z.color, opacity: 0.65,
            }));
        });
    }

    _drawTicks() {
        const majorCount = 10;
        const totalSteps = 20;
        const range = this.max - this.min;
        for (let i = 0; i <= totalSteps; i++) {
            const v = this.min + (range * i / totalSteps);
            const angle = this.valueToAngle(v);
            const rad = Konva.getAngle(angle - 90);
            const isMajor = i % (totalSteps / majorCount) === 0;
            const len = isMajor ? 16 * this.scale : 8 * this.scale;
            this._staticGroup.add(new Konva.Line({
                points: [
                    (this.radius - len) * Math.cos(rad), (this.radius - len) * Math.sin(rad),
                    this.radius * Math.cos(rad), this.radius * Math.sin(rad),
                ],
                stroke: '#111', strokeWidth: isMajor ? 2 * this.scale : 1 * this.scale,
            }));
            if (isMajor) {
                const textRad = Konva.getAngle(angle - 90);
                this._staticGroup.add(new Konva.Text({
                    x: this.textRadius * Math.cos(textRad) - 14 * this.scale,
                    y: this.textRadius * Math.sin(textRad) - 6 * this.scale,
                    width: 28 * this.scale, align: 'center', text: v.toString(),
                    fontSize: 11 * this.scale, fill: '#000',
                }));
            }
        }
    }

    _drawCenter() {
        this._staticGroup.add(new Konva.Circle({ x: 0, y: 0, radius: 4 * this.scale, fill: '#333' }));
    }

    /** LCD 外壳（静态），数值文字在 _createDynamicNodes */
    _drawLcdShell() {
        const w = 70 * this.scale, h = 24 * this.scale;
        const x = -w / 2, y = this._lcdY;
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 6 * this.scale,
            stroke: '#333', strokeWidth: 1 * this.scale,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#ececec', 0.6, '#c8c8c8', 1, '#9a9a9a'],
        }));
        this._staticGroup.add(new Konva.Rect({
            x: x + 4 * this.scale, y: y + 4 * this.scale,
            width: w - 8 * this.scale, height: h - 8 * this.scale, cornerRadius: 4 * this.scale,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h - 8 * this.scale },
            fillLinearGradientColorStops: [0, '#0b2a0b', 0.6, '#042404', 1, '#072207'],
        }));
    }

    _drawName() {
        const w = 140 * this.scale, h = 20 * this.scale, x = -w / 2;
        let y;
        if (this._lcdY !== undefined) {
            y = Math.max(12 * this.scale, this._lcdY - h - 12 * this.scale);
        } else {
            y = Math.max(12 * this.scale, this.radius * 0.12);
        }
        this.nameText = new Konva.Text({
            x, y, width: w, align: 'center', text: String(this.title ?? ''),
            fontSize: 14 * this.scale, fontStyle: 'bold', fill: '#222', listening: false,
        });
        this._staticGroup.add(this.nameText);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        this.pointer = new Konva.Line({
            points: [0, 0, 0, -(this.radius - 25 * this.scale)],
            stroke: '#c0392b', strokeWidth: 3 * this.scale, lineCap: 'round',
            rotation: this.startAngle,
        });
        this._dynamicGroup.add(this.pointer);

        this.lcdText = new Konva.Text({
            x: -70 * this.scale / 2 + 4 * this.scale, y: this._lcdY + 4 * this.scale,
            width: 70 * this.scale - 8 * this.scale, align: 'center',
            text: Number(this.min).toFixed(1), fontSize: 14 * this.scale,
            fontFamily: 'monospace', fill: '#7fff7f',
        });
        this._dynamicGroup.add(this.lcdText);
    }

    _bindInteraction() { /* 电流表为纯显示仪表，无需交互 */ }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    update(mA) {
        const clamped = Math.max(this.min, Math.min(this.max, mA));
        this.value = clamped;

        if (this.pointer) this.pointer.rotation(this.valueToAngle(clamped));
        if (this.lcdText) {
            this.lcdText.text(mA.toFixed(2));
            this.lcdText.fill(clamped >= 100 ? '#ff4444' : '#7fff7f');
        }
        this._refreshIfDirty();
    }

    tick() {
        const current = this.physCurrent || 0;
        this.update(current * 1000);
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '仪表名称', key: 'title', type: 'text' },
            { label: '量程上限 (mA)', key: 'max', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id || this.id;
        this.title = newConfig.title || this.title;
        if (newConfig.max !== undefined) this.max = parseFloat(newConfig.max);
        this.config = { ...this.config, id: this.id, title: this.title, max: this.max };
        this._rebuild();
    }

    _rebuild() {
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this.pointer = null;
        this.lcdText = null;
        this._parts = {};
        this._drawStaticParts();
        this._createDynamicNodes();
        this.update(this.value || 0);
    }

    destroy() {
        super.destroy?.();
    }
}
