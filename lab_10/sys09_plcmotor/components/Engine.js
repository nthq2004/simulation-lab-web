import { BaseComponent } from './BaseComponent.js';

/**
 * Engine - 简易发动机视觉组件与控制演示
 *
 * 说明：
 * - 绘制一个四缸发动机的简化视图，包含活塞、连杆、分段曲轴、火焰、烟管与涡轮等元素；
 * - 提供局部交互：开/关开关、喷油量旋钮（负荷调节）；
 * - 运行逻辑：通过 `tick` 周期调用 `update`，在运行时根据 `fuelRate` 模拟活塞上下行、
 *   曲轴宽度变化和火焰强度。
 *
 * 遵循新组件模板：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`，
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 *   · 机壳/气缸/油底壳/刻度盘/文字入 `_staticGroup`（缓存一次）；
 *   · 活塞/连杆/曲拐/火焰/排气歧管/开关手柄/负荷指针入 `_dynamicGroup`，tick 中 in-place 更新；
 *   · 开关与负荷旋钮用 `addClickablePart` 注册命中区并绑定交互；
 *   · 无 shadow 三件套。
 */
export class Engine extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'engine';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, fuelRate: this.fuelRate, engOn: this.engOn };

        // 流体端口（教学示意）：冷却水入口与出口位置
        this.addPort(this.w - 10, this.h - 40, 'i', 'pipe', 'in');
        this.addPort(10, 70, 'o', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = 240;
        this.h = 180;
    }

    _initParameters() {
        this.engOn = false;      // 发动机开/关状态
        this.fuelRate = 0.7;     // 喷油量/负荷，范围 [0.1, 1.0]
        this._lastEngOn = false;

        // 动态可视元素数组：便于在 update 中批量 in-place 操作
        this.pistons = [];
        this.rods = [];
        this.crankWebs = [];
        this.flames = [];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件（机壳、气缸、曲轴主轴颈、油底壳、刻度盘、文字）
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const cylinderCount = 4;
        const startX = 45;
        const spacing = 45;

        // 1. 机体底座
        g.add(new Konva.Rect({ x: 10, y: 30, width: 220, height: 140, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 3 }));

        // 2. 增压器（静态）
        const turbo = new Konva.Group({ x: 210, y: 40 });
        turbo.add(
            new Konva.Arc({ innerRadius: 6, outerRadius: 20, angle: 300, fill: '#7f8c8d', stroke: '#2c3e50', rotation: -150 }),
            new Konva.Circle({ radius: 8, fill: '#34495e', stroke: '#2c3e50' })
        );
        g.add(turbo);

        // 3. 气缸室 + 分段主轴颈
        for (let i = 0; i < cylinderCount; i++) {
            const x = startX + i * spacing;
            g.add(new Konva.Rect({ x: x - 21, y: 50, width: 42, height: 70, stroke: '#34495e', strokeWidth: 1, fill: 'rgba(255,255,255,0.05)' }));
            g.add(new Konva.Rect({ x: x - 22, y: 140, width: 14, height: 12, fill: '#1e6ab6' }));
            g.add(new Konva.Rect({ x: x + 10, y: 140, width: 14, height: 12, fill: '#1c65ae' }));
        }

        // 4. 油底壳
        g.add(new Konva.Rect({ x: 10, y: 165, width: 220, height: 10, fill: '#34495e', stroke: '#2c3e50', cornerRadius: [0, 0, 3, 3] }));

        // 5. 开关刻度盘（静态底 + 文字）
        g.add(new Konva.Circle({ x: 42, y: 10, radius: 18, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: 12, y: -5, text: 'OFF', fontSize: 10, fill: '#c0392b', fontStyle: 'bold' }));
        g.add(new Konva.Text({ x: 52, y: -5, text: 'ON', fontSize: 10, fill: '#27ae60', fontStyle: 'bold' }));

        // 6. 负荷刻度盘 + 文字 + 柴油机铭牌
        g.add(new Konva.Arc({ x: 160, y: 15, innerRadius: 16, outerRadius: 22, angle: 180, fill: '#0d9a5a', stroke: '#2c3e50', strokeWidth: 1, rotation: 180 }));
        g.add(new Konva.Text({ x: 134, y: 20, text: 'FUEL / LOAD', fontSize: 9, fill: '#2c3e50', fontStyle: 'bold' }));
        g.add(new Konva.Text({ x: 75, y: -1, text: '柴油机', fontSize: 18, fontStyle: 'bold' }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（排气歧管、活塞、连杆、曲拐、火焰、开关手柄、负荷指针）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const cylinderCount = 4;
        const startX = 45;
        const spacing = 45;

        // 排气歧管（颜色随负荷变化）
        this.exhaustManifold = new Konva.Rect({ x: 10, y: 30, width: 180, height: 18, fill: '#2c3e50', stroke: '#000', cornerRadius: 2 });
        d.add(this.exhaustManifold);

        for (let i = 0; i < cylinderCount; i++) {
            const x = startX + i * spacing;

            // 活塞
            const p = new Konva.Rect({ x: x - 18, y: 60, width: 36, height: 18, fill: '#b06f7a', stroke: '#1a5276', strokeWidth: 1.5, cornerRadius: 2 });
            // 连杆
            const r = new Konva.Rect({ x: x - 6, y: 78, width: 12, height: 60, fill: '#ecf0f1', stroke: '#7f8c8d', strokeWidth: 1 });
            // 曲拐臂
            const web = new Konva.Rect({ x: x - 10, y: 135, width: 20, height: 25, fill: '#2980b9', stroke: '#1a5276', strokeWidth: 1, cornerRadius: 3 });
            // 火焰
            const flame = new Konva.Path({
                x: x - 15, y: 50,
                data: 'M15 0 L30 30 Q15 45 0 30 Z',
                fillRadialGradientStartPoint: { x: 15, y: 30 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 15, y: 30 },
                fillRadialGradientEndRadius: 30,
                fillRadialGradientColorStops: [0, '#ffff00', 0.5, '#ff6600', 1, 'rgba(255,0,0,0)'],
                opacity: 0, visible: false, scaleY: 0, listening: false,
            });

            this.pistons.push(p);
            this.rods.push(r);
            this.crankWebs.push(web);
            this.flames.push(flame);
            d.add(flame, web, r, p);
        }

        // 开关手柄
        this.knob = new Konva.Group({ x: 42, y: 10, rotation: -45 });
        this.knob.add(
            new Konva.Rect({ x: -2.5, y: -16, width: 5, height: 18, fill: '#2c3e50', cornerRadius: 1 }),
            new Konva.Rect({ x: -1, y: -14, width: 2, height: 5, fill: '#ecf0f1' })
        );
        d.add(this.knob);

        // 负荷指针
        this.fuelPointer = new Konva.Line({ x: 160, y: 15, points: [0, 0, 0, -18], stroke: '#e74c3c', strokeWidth: 3, lineCap: 'round', rotation: 30 });
        d.add(this.fuelPointer);
    }

    // ═══════════════════════════════════════════════════════
    // 交互（开关切换、负荷调节）
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const toggle = () => { this.engOn = !this.engOn; };

        const switchHit = this.addClickablePart('switch', 24, -8, 36, 36);
        switchHit.on('click tap', toggle);

        const fuelDown = this.addClickablePart('fuel-down', 135, -10, 25, 30);
        fuelDown.on('click tap', () => this.adjustFuel(-0.1));

        const fuelUp = this.addClickablePart('fuel-up', 160, -10, 25, 30);
        fuelUp.on('click tap', () => this.adjustFuel(0.1));

        // 机体整体（供演示箭头指示）
        this.addClickablePart('body', 10, 30, 220, 140);
    }

    adjustFuel(delta) {
        this.fuelRate = Math.max(0.1, Math.min(1.0, this.fuelRate + delta));
        this.fuelPointer.rotation(-90 + (this.fuelRate - 0.1) * 200);
    }

    // ═══════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this.update(this.engOn);
        this._refreshIfDirty();
    }

    update(isOn) {
        // 燃油率映射到指针角度
        this.fuelPointer.rotation(-90 + (this.fuelRate - 0.1) * 200);

        const changed = this._lastEngOn !== isOn;
        this._lastEngOn = isOn;

        if (isOn) {
            const speedBase = 0.01;
            const speed = speedBase + (this.fuelRate * 0.003);
            const time = Date.now() * speed;
            const stroke = 15;

            // 仪表旋钮平滑过渡到 ON 位置（每帧插值，到位后吸附 45°）
            const kOn = this.knob.rotation();
            this.knob.rotation(Math.abs(45 - kOn) < 0.5 ? 45 : kOn + (45 - kOn) * 0.5);

            this.pistons.forEach((p, i) => {
                const phase = (i === 0 || i === 3) ? 0 : Math.PI;
                const angle = (time + phase) % (Math.PI * 2);
                const dy = Math.sin(angle) * stroke;

                p.y(70 + dy);
                this.rods[i].y(88 + dy);
                this.crankWebs[i].y(135 + dy);

                const scale = Math.abs(Math.cos(angle));
                const targetW = 20 * (0.8 + scale * 0.2);
                this.crankWebs[i].width(targetW);
                this.crankWebs[i].x((45 + i * 45) - targetW / 2);

                const flame = this.flames[i];
                if (angle > 0 && angle < Math.PI) {
                    const intensity = Math.sin(angle) * this.fuelRate + 0.1;
                    flame.visible(true);
                    flame.scaleY(intensity * 1.5);
                    flame.opacity(intensity);
                    flame.scaleX(0.8 + Math.random() * 0.4);
                } else {
                    flame.visible(false);
                    flame.opacity(0);
                }
            });

            // 排气歧管热力反馈
            const heat = Math.min(255, 44 + (this.fuelRate - 0.1) * 200);
            this.exhaustManifold.fill(`rgb(${Math.floor(heat)}, 46, 80)`);
        } else {
            // 仪表旋钮必须「每帧」平滑回到 OFF(-45°) 位置：
            // 若像原来那样只在 changed 的那一帧插值一次，从 ON(+45°) 切到 OFF 时
            // 只会走一步到 0°（正上方）就停住，导致 OFF 手柄指向正上方。
            const kOff = this.knob.rotation();
            this.knob.rotation(Math.abs(-45 - kOff) < 0.5 ? -45 : kOff + (-45 - kOff) * 0.5);

            if (changed) {
                this.pistons.forEach((p, i) => {
                    p.y(70);
                    this.rods[i].y(88);
                    this.crankWebs[i].y(135);
                    this.crankWebs[i].width(20);
                    this.crankWebs[i].x((45 + i * 45) - 10);
                });
                this.flames.forEach(f => { f.visible(false); f.opacity(0); });
                this.exhaustManifold.fill('rgb(44, 46, 80)');
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '喷油量/负荷 (0.1~1.0)', key: 'fuelRate', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.fuelRate !== undefined) this.fuelRate = Math.max(0.1, Math.min(1.0, parseFloat(cfg.fuelRate)));
        this.fuelPointer.rotation(-90 + (this.fuelRate - 0.1) * 200);
        this.config = { ...this.config, id: this.id, fuelRate: this.fuelRate };
    }

    destroy() {
        super.destroy?.();
    }
}
