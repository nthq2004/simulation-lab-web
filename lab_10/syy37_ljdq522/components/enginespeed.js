import { BaseComponent } from './BaseComponent.js';

/**
 * EngineSpeed - 简易发动机转速显示组件
 *
 * 说明：
 * - 该组件绘制一个四缸发动机的简化视图，包含活塞、连杆、分段曲轴、火焰、烟管与涡轮等元素。
 * - 提供局部交互：开/关开关、转速调节旋钮。
 * - 运行逻辑：通过 `tick` 周期调用 `update`，在运行时根据 `speed` 模拟活塞上下行、曲轴宽度变化和火焰强度。
 * - 用途：教学演示发动机工作原理与转速影响的视觉效果，不用于精确物理仿真。
 */

export class EngineSpeed extends BaseComponent {
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
        this._speed = 0;              // 当前转速 (RPM)，范围：[0, 1000]
        this._targetSpeed = 0;        // 目标转速，用于平滑过渡

        // 可视元素数组：便于在 update 中批量操作
        this.pistons = [];
        this.rods = [];
        this.crankWebs = [];
        this.crankShafts = [];
        this.flames = []; // 火焰节点引用，用于根据冲程显示/隐藏并调整强度

        // 初始化视图与交互控件
        this.initVisuals();
        this.initControlSwitch();
        this.initSpeedKnob();

        // 流体端口（教学示意）：联轴器中心位置
        this.addPort(this.w - 8, this.h / 2 + 5, 'o', 'pipe');
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

    /**
     * 公开 API：设定转速
     * @param {number} rpm - 转速值，范围 0 ~ 1000
     */
    setSpeed(rpm) {
        this._targetSpeed = Math.max(0, Math.min(1000, rpm));
        // 同步更新指针位置
        this._updateSpeedPointer(this._targetSpeed);
        this.markDirty();
    }

    /**
     * 获取当前转速
     * @returns {number} 当前转速 (RPM)
     */
    getSpeed() {
        return this._speed;
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

        // 5. 右侧短轴与联轴器
        this._initCoupling();
    }

    /**
     * 初始化右侧联轴器
     */
    _initCoupling() {
        const couplingGroup = new Konva.Group({ x: 230, y: this.h / 2 + 5 });

        // 短轴（从机体伸出的轴段）
        const shaft = new Konva.Rect({
            x: -10, y: -4,
            width: 12, height: 8,
            fill: '#7f8c8d',
            stroke: '#2c3e50',
            strokeWidth: 1
        });

        // 联轴器外圈（弹性体示意）
        const couplingOuter = new Konva.Circle({
            x: 2, y: 0,
            radius: 14,
            fill: '#e67e22',
            stroke: '#d35400',
            strokeWidth: 2
        });

        // 联轴器内圈（金属毂）
        const couplingInner = new Konva.Circle({
            x: 2, y: 0,
            radius: 7,
            fill: '#bdc3c7',
            stroke: '#7f8c8d',
            strokeWidth: 1.5
        });

        // 联轴器弹性体纹路（装饰）
        const dotPattern = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const dot = new Konva.Circle({
                x: 2 + Math.cos(angle) * 10,
                y: Math.sin(angle) * 10,
                radius: 2,
                fill: '#f39c12',
                opacity: 0.6
            });
            dotPattern.push(dot);
        }

        // 联轴器中心标记（管路接口位置）
        const centerMark = new Konva.Circle({
            x: 2, y: 0,
            radius: 3,
            fill: '#2c3e50',
            opacity: 0.3
        });

        couplingGroup.add(shaft, couplingOuter, couplingInner, ...dotPattern, centerMark);

        // 保存联轴器引用以便旋转动画
        this._couplingGroup = couplingGroup;
        this._couplingOuter = couplingOuter;
        this._couplingInner = couplingInner;

        this._staticGroup.add(couplingGroup);
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

    initSpeedKnob() {
        // 转速调节旋钮位置（原油量旋钮位置）
        const knobGroup = new Konva.Group({ x: 160, y: 15 });

        // 1. 刻度盘背景
        const dial = new Konva.Arc({
            innerRadius: 16,
            outerRadius: 22,
            angle: 180,
            fill: '#2980b9',
            stroke: '#2c3e50',
            strokeWidth: 1,
            rotation: 180
        });

        // 2. 指针（转速指示）
        this.speedPointer = new Konva.Line({
            points: [0, 0, 0, -18],
            stroke: '#e74c3c',
            strokeWidth: 3,
            lineCap: 'round',
            rotation: 0 // 对应 600 RPM（中间值）
        });

        // 3. 刻度文字
        const label = new Konva.Text({
            x: -28, y: 5,
            text: 'SPEED (RPM)',
            fontSize: 8,
            fill: '#2c3e50',
            fontStyle: 'bold'
        });

        // 刻度标记（0, 500, 1000）
        const tick0 = new Konva.Text({ x: -22, y: 22, text: '0', fontSize: 7, fill: '#7f8c8d' });
        const tick500 = new Konva.Text({ x: -6, y: 28, text: '500', fontSize: 7, fill: '#2c3e50', fontStyle: 'bold' });
        const tick1000 = new Konva.Text({ x: 10, y: 22, text: '1000', fontSize: 7, fill: '#7f8c8d' });

        // 4. 透明交互层（左半圆减小，右半圆增大）
        const leftHit = new Konva.Rect({ x: -25, y: -25, width: 25, height: 30, fill: 'transparent' });
        const rightHit = new Konva.Rect({ x: 0, y: -25, width: 25, height: 30, fill: 'transparent' });

        // 5. 发动机铭牌
        const labelText = new Konva.Text({ x: -85, y: -16, text: '柴油机', fontSize: 18, fontStyle: 'bold' });

        // 绑定点击事件（每次调整50 RPM）
        leftHit.on('click', () => this.setSpeed(this._targetSpeed - 50));
        rightHit.on('click', () => this.setSpeed(this._targetSpeed + 50));

        knobGroup.add(dial, label, this.speedPointer, tick0, tick500, tick1000, leftHit, rightHit, labelText);
        this._staticGroup.add(knobGroup);

        // 初始化指针位置
        this._updateSpeedPointer(this._speed);
    }

    /**
     * 更新转速指针角度
     * 转速 0 ~ 1000 映射到角度 -90 ~ +90
     */
    _updateSpeedPointer(speed) {
        const clampedSpeed = Math.max(0, Math.min(1000, speed));
        // 映射：0 -> -90°, 500 -> 0°, 1000 -> 90°
        const angle = -90 + (clampedSpeed / 1000) * 180;
        if (this.speedPointer) {
            this.speedPointer.rotation(angle);
        }
    }

    update(isOn) {
        // 转速平滑过渡
        if (this._speed !== this._targetSpeed) {
            const diff = this._targetSpeed - this._speed;
            const step = Math.sign(diff) * Math.min(Math.abs(diff), 5); // 每帧平滑变化5 RPM
            this._speed += step;
            // 确保不超出范围
            this._speed = Math.max(0, Math.min(1000, this._speed));
            this._updateSpeedPointer(this._speed);
        }

        const changed = this._lastEngOn !== isOn;
        this._lastEngOn = isOn;

        if (isOn) {
            // --- 动态运动逻辑 ---
            // 运动速度与转速成正比
            const speedFactor = this._speed / 1000; // 0~1
            const speedBase = 0.008;
            const speed = speedBase + (speedFactor * 0.015);
            const time = Date.now() * speed;
            const stroke = 15; // 活塞行程振幅（像素）

            // 仪表旋钮平滑过渡到 ON 位置
            this.knob.rotation(this.knob.rotation() + (45 - this.knob.rotation()) * 0.5);

            // 联轴器旋转（转速越高旋转越快）
            if (this._couplingGroup) {
                const rotSpeed = 0.5 + speedFactor * 2;
                this._couplingGroup.rotation((this._couplingGroup.rotation() || 0) + rotSpeed);
            }

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
                    // 火焰强度随转速变化
                    const intensity = Math.sin(angle) * (0.3 + speedFactor * 0.7);
                    flame.scaleY(Math.max(0.3, intensity * 2));
                    flame.opacity(Math.min(1, intensity + 0.2));
                    flame.scaleX(0.8 + Math.random() * 0.4);
                } else if (changed) {
                    flame.visible(false);
                    flame.opacity(0);
                }
            });

            // 根据转速改变排气歧管颜色（热力反馈）
            if (this.exhaustManifold) {
                const heat = Math.floor(44 + speedFactor * 180);
                this.exhaustManifold.fill(`rgb(${heat}, ${Math.floor(46 + speedFactor * 60)}, ${Math.floor(80 - speedFactor * 40)})`);
            }

            // 联轴器颜色随转速变化（发热指示）
            if (this._couplingOuter) {
                const heat = Math.floor(200 + speedFactor * 55);
                this._couplingOuter.fill(`rgb(${heat}, ${Math.floor(120 - speedFactor * 40)}, 50)`);
            }
        } else if (changed) {
            // 柴油机停止 → 转速归零
            this.setSpeed(0);
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
                this.exhaustManifold.fill('rgb(44, 46, 80)');
            }
            if (this._couplingOuter) {
                this._couplingOuter.fill('#e67e22');
            }
        }

        // 标记为脏以便下一次绘制刷新
        if (isOn || changed) this.markDirty();
    }
}