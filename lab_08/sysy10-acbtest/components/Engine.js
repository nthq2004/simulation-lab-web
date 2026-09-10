import { BaseComponent } from './BaseComponent.js';

/**
 * Engine - 简易发动机视觉组件与控制演示
 *
 * 说明：
 * - 该组件绘制一个四缸发动机的简化视图，包含活塞、连杆、分段曲轴、火焰、烟管与涡轮等元素。
 * - 提供局部交互：开/关开关、喷油量旋钮（负荷调节）。
 * - 运行逻辑：通过 `tick` 周期调用 `update`，在运行时根据 `fuelRate` 模拟活塞上下行、曲轴宽度变化和火焰强度。
 * - 用途：教学演示发动机工作原理与负荷影响的视觉效果，不用于精确物理仿真。
 */

export class Engine extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        // 尺寸 (像素) 和类型声明
        this.w = 240;
        this.h = 180;
        this.type = 'engine';
        // 使用固定缓存以提升渲染性能（静态元素较多）
        this.cache = 'fixed';

        // 运行状态与参数
        this.engOn = false;           // 发动机开/关状态（由面板开关控制）
        this.fuelRate = 0.7;          // 喷油量/负荷，范围：[0.1, 1.0]，影响转速与火焰强度

        // 可视元素数组：便于在 update 中批量操作
        this.pistons = [];
        this.rods = [];
        this.crankWebs = [];
        this.crankShafts = [];
        this.flames = []; // 火焰节点引用，用于根据冲程显示/隐藏并调整强度

        // 初始化视图与交互控件
        this.initVisuals();
        this.initControlSwitch();
        this.initFuelKnob();

        // 流体端口（教学示意）：冷却水入口与出口位置
        this.addPort(this.w - 10, this.h - 40, 'i', 'pipe', 'in');
        this.addPort(10, 70, 'o', 'pipe');
    }

    /**
     * 集中化 tick 动画（20fps）
     */
    tick(dt) {
        // tick 周期驱动 update，使动画按固定帧率（约 20fps）更新
        this.update(this.engOn);

        // 仅在脏标记时执行重绘（BaseComponent 提供）
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }

    initVisuals() {
        const cylinderCount = 4;
        const startX = 45;
        const spacing = 45;

        // 1. 机体主色调 (底座)
        const casing = new Konva.Rect({
            x: 10, y: 30, width: 220, height: 140,
            fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 3
        });
        this._staticGroup.add(casing);

        // 2. 烟管与增压器
        this.exhaustManifold = new Konva.Rect({
            x: 10, y: 30, width: 180, height: 18,
            fill: '#2c3e50', stroke: '#000', cornerRadius: 2
        });

        // 增压器移至边缘对齐
        this.turbo = new Konva.Group({ x: 210, y: 40 });
        this.turbo.add(
            new Konva.Arc({ innerRadius: 6, outerRadius: 20, angle: 300, fill: '#7f8c8d', stroke: '#2c3e50', rotation: -150 }),
            new Konva.Circle({ radius: 8, fill: '#34495e', stroke: '#2c3e50' })
        );
        this._staticGroup.add(this.exhaustManifold, this.turbo);

        // 3. 循环生成分隔的气缸和分段曲轴
        for (let i = 0; i < cylinderCount; i++) {
            const x = startX + i * spacing;

            // 分隔的气缸室
            const cylinderBox = new Konva.Rect({
                x: x - 21, y: 50, width: 42, height: 70,
                stroke: '#34495e', strokeWidth: 1, fill: 'rgba(255,255,255,0.05)'
            });

            // 蓝色活塞
            const p = new Konva.Rect({
                x: x - 18, y: 60, width: 36, height: 18,
                fill: '#b06f7a', stroke: '#1a5276', strokeWidth: 1.5, cornerRadius: 2
            });

            // 粗连杆 (矩形加厚)
            const r = new Konva.Rect({
                x: x - 6, y: 78, width: 12, height: 60,
                fill: '#ecf0f1', stroke: '#7f8c8d', strokeWidth: 1
            });

            // 分段主轴颈 (分段显示)
            const shaftLeft = new Konva.Rect({ x: x - 22, y: 140, width: 14, height: 12, fill: '#1e6ab6' });
            const shaftRight = new Konva.Rect({ x: x + 10, y: 140, width: 14, height: 12, fill: '#1c65ae' });

            // 蓝色曲拐臂
            const web = new Konva.Rect({
                x: x - 10, y: 135, width: 20, height: 25,
                fill: '#2980b9', stroke: '#1a5276', strokeWidth: 1, cornerRadius: 3
            });

                // --- 新增：火焰效果节点 ---
                // 使用 Path 绘制一个简单的火苗形状，放置在气缸顶部
            const flame = new Konva.Path({
                x: x - 15,
                y: 50, // 固定在气缸顶部
                data: 'M15 0 L30 30 Q15 45 0 30 Z', // 简单的火苗路径
                fillRadialGradientStartPoint: { x: 15, y: 30 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 15, y: 30 },
                fillRadialGradientEndRadius: 30,
                fillRadialGradientColorStops: [0, '#ffff00', 0.5, '#ff6600', 1, 'rgba(255,0,0,0)'],
                opacity: 0,
                visible: false,
                scaleY: 0
            });
            // 将火焰节点保存在数组中，更新时根据活塞冲程设置可见性与强度
            this.flames.push(flame);
            this.pistons.push(p);
            this.rods.push(r);
            this.crankWebs.push(web);
            this._staticGroup.add(cylinderBox, shaftLeft, shaftRight, web, r, p, flame);
        }

        // 4. 油底壳
        const oilPan = new Konva.Rect({
            x: 10, y: 165, width: 220, height: 10,
            fill: '#34495e', stroke: '#2c3e50', cornerRadius: [0, 0, 3, 3]
        });
        this._staticGroup.add(oilPan);
    }

    initControlSwitch() {
        // 紧贴左上角布局
        this.switchGroup = new Konva.Group({ x: 42, y: 10 });
        const dial = new Konva.Circle({ radius: 18, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 2 });
        this.knob = new Konva.Group({ rotation: -45 });
        this.knob.add(
            new Konva.Rect({ x: -2.5, y: -16, width: 5, height: 18, fill: '#2c3e50', cornerRadius: 1 }),
            new Konva.Rect({ x: -1, y: -14, width: 2, height: 5, fill: '#ecf0f1' })
        );

        // 切换发动机开关：翻转 engOn 状态并刷新缓存
        const toggle = () => { this.engOn = !this.engOn; this._refreshCache(); };
        dial.on('click', toggle);
        this.knob.on('click', toggle);

        this.switchGroup.add(
            dial,
            new Konva.Text({ x: -30, y: -15, text: 'OFF', fontSize: 10, fill: '#c0392b', fontStyle: 'bold' }),
            new Konva.Text({ x: 10, y: -15, text: 'ON', fontSize: 10, fill: '#27ae60', fontStyle: 'bold' }),
            this.knob
        );
        this._staticGroup.add(this.switchGroup);
    }
    initFuelKnob() {
        // 旋钮位置设定在柴油机顶部中间靠右
        const knobGroup = new Konva.Group({ x: 160, y: 15 });

        // 1. 刻度盘背景
        const dial = new Konva.Arc({
            innerRadius: 16,
            outerRadius: 22,
            angle: 180,
            fill: '#0d9a5a',
            stroke: '#2c3e50',
            strokeWidth: 1,
            rotation: 180
        });

        // 2. 指针
        this.fuelPointer = new Konva.Line({
            points: [0, 0, 0, -18],
            stroke: '#e74c3c',
            strokeWidth: 3,
            lineCap: 'round',
            rotation: 30 // 对应 0.7 的初始负荷
        });

        // 3. 装饰性刻度文字
        const label = new Konva.Text({
            x: -26, y: 5,
            text: 'FUEL / LOAD',
            fontSize: 9,
            fill: '#2c3e50',
            fontStyle: 'bold'
        });

        // 4. 透明交互层（左半圆减小，右半圆增大）
        const leftHit = new Konva.Rect({ x: -25, y: -25, width: 25, height: 30, fill: 'transparent' });
        const rightHit = new Konva.Rect({ x: 0, y: -25, width: 25, height: 30, fill: 'transparent' });

        // 5. 柴油机铭牌
        const labelText = new Konva.Text({ x: -85, y: -16, text: '柴油机', fontSize: 18, fontStyle: 'bold' });

        // 绑定点击事件
        leftHit.on('click', () => this.adjustFuel(-0.1));
        rightHit.on('click', () => this.adjustFuel(0.1));

        knobGroup.add(dial, label, this.fuelPointer, leftHit, rightHit, labelText);
        this._staticGroup.add(knobGroup);
    }

    adjustFuel(delta) {
        // 更新本地负荷值（限制在安全范围），并更新指针角度以反映当前燃油占空
        this.fuelRate = Math.max(0.1, Math.min(1.0, this.fuelRate + delta));

        // 指针映射：fuelRate 从 0.1 到 1.0 映射到 -90 到 +110 度（总跨度 200 度）
        const targetAngle = -90 + (this.fuelRate - 0.1) * 200;
        this.fuelPointer.rotation(targetAngle);

        // 视觉已变更，刷新缓存以触发重绘
        this._refreshCache();
    }
    update(isOn) {
        // 将燃油率映射到指针角度（视觉同步）
        const targetAngle = -90 + (this.fuelRate - 0.1) * 200;
        this.fuelPointer.rotation(targetAngle);

        const changed = this._lastEngOn !== isOn;
        this._lastEngOn = isOn;

        if (isOn) {
            // --- 动态运动逻辑 ---
            // 运动速度与燃油率有关：fuelRate 越大动画越快、火焰越强
            const speedBase = 0.01;
            const speed = speedBase + (this.fuelRate * 0.003);
            const time = Date.now() * speed;
            const stroke = 15; // 活塞行程振幅（像素）

            // 仪表旋钮平滑过渡到 ON 位置
            this.knob.rotation(this.knob.rotation() + (45 - this.knob.rotation()) * 0.5);

            // 遍历每个气缸，计算相位并应用位移与缩放变化
            this.pistons.forEach((p, i) => {
                // 简单相位安排：0 & 3 同相，1 & 2 反相（用于视觉交替）
                const phase = (i === 0 || i === 3) ? 0 : Math.PI;
                const angle = (time + phase) % (Math.PI * 2);
                const dy = Math.sin(angle) * stroke;

                // 活塞与连杆的竖向位移
                p.y(70 + dy);
                this.rods[i].y(88 + dy);
                this.crankWebs[i].y(135 + dy);

                // 模拟曲轴宽度随相位微变，增强立体感
                const scale = Math.abs(Math.cos(angle));
                const targetW = 20 * (0.8 + scale * 0.2);
                this.crankWebs[i].width(targetW);
                this.crankWebs[i].x((45 + i * 45) - targetW / 2);

                // 火焰显示：在下行（angle 在 0 到 PI）阶段显示火焰
                const flame = this.flames[i];
                if (angle > 0 && angle < Math.PI) {
                    flame.visible(true);
                    // 火焰强度随 sin(angle) 与燃油率变化
                    const intensity = Math.sin(angle) * this.fuelRate + 0.1;
                    flame.scaleY(intensity * 1.5);
                    flame.opacity(intensity);
                    flame.scaleX(0.8 + Math.random() * 0.4); // 轻微抖动
                } else if (changed) {
                    flame.visible(false);
                    flame.opacity(0);
                }
            });

            // 根据负荷改变排气歧管颜色来做热力反馈（视觉效果）
            if (this.exhaustManifold) {
                const heat = Math.min(255, 44 + (this.fuelRate - 0.1) * 200);
                this.exhaustManifold.fill(`rgb(${Math.floor(heat)}, 46, 80)`);
            }
        } else if (changed) {
            // 刚从开到关或关到开时的复位逻辑：平滑回到静止位置
            this.knob.rotation(this.knob.rotation() + (-45 - this.knob.rotation()) * 0.5);
            this.pistons.forEach((p, i) => {
                p.y(70);
                this.rods[i].y(88);
                this.crankWebs[i].y(135);
                this.crankWebs[i].width(20);
                this.crankWebs[i].x((45 + i * 45) - 10);
            });
            this.flames.forEach(f => {
                f.visible(false);
                f.opacity(0);
            });
            if (this.exhaustManifold) {
                const heat = Math.min(255, 44);
                this.exhaustManifold.fill(`rgb(${Math.floor(heat)}, 46, 80)`);
            }
        }

        // 标记为脏以便下一次绘制刷新（仅在状态改变时）
        if (isOn || changed) this.markDirty();
    }
}