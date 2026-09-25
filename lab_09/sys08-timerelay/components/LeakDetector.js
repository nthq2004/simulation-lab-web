import { BaseComponent } from './BaseComponent.js';

/**
 * LeakDetector - 泡沫/泄漏检测器视觉组件
 *
 * 功能说明：
 * - 该组件模拟一瓶 "肥皂水" 泄漏检测器：当检测到附近某个 `pipe` 端口处有泄漏且有正压时，
 *   会在泄漏位置生成浮动泡泡粒子以示意泄漏位置。
 * - 检测机制：通过扫描系统内所有组件的 `pipe` 端口（使用 `getTerminals()`），
 *   判断端口的 `isLeaking` 标记并结合系统压力数据（`sys.pressSolver.terminalPressures`）确认为真正泄漏。
 * - 可视化：`startEmitting` 使用 `Konva.Animation` 周期性创建泡泡粒子并更新其位置/透明度，`clearAllBubbles` 清理。
 *
 * 注意：此组件为教学/演示用途，不会修改系统物理状态，仅从视觉上提示泄漏点。
 */

export class LeakDetector extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 可缩放参数与定位（来自 config）
        this.scale = config.scale || 1;
        this.x = config.x;
        this.y = config.y;

        // 组件尺寸（像素）——若 config 中未提供宽高，使用默认值并乘以 scale
        this.w = (config.width ? config.width * this.scale : 60 * this.scale);
        this.h = (config.height ? config.height * this.scale : 90 * this.scale);
        this.type = 'leakDetector';
        // 静态视觉组件，启用固定缓存以减少重绘
        this.cache = 'fixed';

        this._initGroups();
        // 泡泡粒子集合与动画控制句柄
        this.bubbles = [];
        this.isEmitting = false;
        this.anim = null;

        // 绘制静态外观并绑定交互
        this.initVisuals();
        this.initInteractions();
    }

    initVisuals() {
        // 1. 瓶身：渐变填充模拟透明塑料瓶
        this.bottle = new Konva.Rect({
            width: this.w,
            height: this.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.w, y: 0 },
            fillLinearGradientColorStops: [0, '#a1c4fd', 0.5, '#c2e9fb', 1, '#a1c4fd'],
            stroke: '#5fa9f6',
            strokeWidth: 2,
            cornerRadius: [this.w * 0.1, this.w * 0.1, this.w * 0.2, this.w * 0.2],
            opacity: 0.8
        });

        // 2. 瓶盖：用于定位探测点（瓶口在瓶体上方）
        const capW = this.w * 0.5;
        const capH = Math.min(this.h * 0.12, 10);
        this.cap = new Konva.Rect({
            x: (this.w - capW) / 2,
            y: -capH,
            width: capW,
            height: capH,
            fill: '#4a90e2',
            cornerRadius: 2
        });

        // 3. 标签：标识用途（仅视觉）
        this.label = new Konva.Text({
            text: '肥皂水',
            fontSize: Math.max(this.w * 0.2, 10),
            fontStyle: 'bold',
            fill: '#2c3e50',
            x: 0,
            y: this.h * 0.3,
            width: this.w,
            align: 'center'
        });

        // 4. 内部装饰小泡泡（静态装饰，不代表泄漏）
        for (let i = 0; i < 5; i++) {
            const deco = new Konva.Circle({
                x: Math.random() * (this.w * 0.8) + (this.w * 0.1),
                y: Math.random() * (this.h * 0.7) + (this.h * 0.1),
                radius: Math.random() * (this.w * 0.08) + 1,
                fill: 'white',
                opacity: 0.4
            });
            this._staticGroup.add(deco);
        }

        this._staticGroup.add(this.bottle, this.cap, this.label);
    }

    initInteractions() {
        // 当检测器被拖动时，实时检测周围端口以触发或关闭泡泡效果
        this.group.on('dragmove', () => {
            this.checkCollision();
        });

        // 鼠标交互反馈：改变光标以提示可拖拽
        this.group.on('mouseenter', () => {
            if (this.sys) this.sys.container.style.cursor = 'grab';
        });

        this.group.on('mouseleave', () => {
            if (this.sys) this.sys.container.style.cursor = 'default';
        });
    }

    /**
     * 获取场景中所有其他组件的 pipe 类型端口节点（Konva Group）
     * 返回格式: Array<{ node: Konva.Group, absPos: {x, y}, isLeaking: boolean }>
     */
    getTerminals() {
        if (!this.sys || !this.sys.comps) return [];

        const result = [];

        for (const [compId, comp] of Object.entries(this.sys.comps)) {
            // 跳过自身
            if (compId === this.id) continue;
            // 跳过没有 ports 的组件
            if (!Array.isArray(comp.ports)) continue;

            for (const port of comp.ports) {
                // 只关注 pipe 类型端口
                if (port.type !== 'pipe') continue;
                if (!port.node) continue;

                // 获取端口的舞台绝对坐标（支持旋转/缩放）
                let absPos;
                try {
                    absPos = port.node.getAbsolutePosition();
                } catch (e) {
                    // 回退：通过组件 getAbsPortPos 接口
                    absPos = comp.getAbsPortPos(port.id);
                }
                // 读取端口上可能存在的 isLeaking 标记（布尔），用于快速筛查
                const isLeaking = !!port.node.getAttr('isLeaking');

                result.push({ id: port.id, node: port.node, absPos, isLeaking });
            }
        }

        return result;
    }

    checkCollision() {
        const detectorPos = this.group.getAbsolutePosition();

        // 探测点：瓶盖正上方中心
        const probeX = detectorPos.x + this.w / 2;
        const probeY = detectorPos.y - (this.h * 0.1);

        const terminals = this.getTerminals();
        let foundLeak = false;
        let leakX = probeX;
        let leakY = probeY;

        for (const term of terminals) {
            const dist = Math.sqrt(
                Math.pow(probeX - term.absPos.x, 2) +
                Math.pow(probeY - term.absPos.y, 2)
            );

            // 碰撞判定半径随瓶子宽度微调
            if (dist < this.w * 0.6 && term.isLeaking) {
                // 进一步结合压力求解器数据确认是否存在真实泄漏（压力>0 表示有流体压力）
                if (this.sys.pressSolver && this.sys.pressSolver.terminalPressures && this.sys.pressSolver.terminalPressures[term.id] > 0) {
                    foundLeak = true;
                } else {
                    // 若无压力信息可用，则不直接触发真实泄漏，仅作为演示时可改为 true
                    foundLeak = false;
                }
                // 泡泡从实际泄漏端口位置冒出，而不是固定在探测点
                leakX = term.absPos.x;
                leakY = term.absPos.y;
                break;
            }
        }

        if (foundLeak) {
            this.startEmitting(leakX, leakY);
        } else {
            this.clearAllBubbles();
        }
    }

    startEmitting(x, y) {
        // 启动粒子动画：如果已经在发射则跳过
        if (this.isEmitting) return;
        this.isEmitting = true;

        // 使用 Konva.Animation 在层上执行逐帧更新：创建新泡泡并驱动已存在泡泡上升/衰减
        this.anim = new Konva.Animation((frame) => {
            // 随机产生新粒子，timeDiff 用于节流
            if (frame.timeDiff > 0 && Math.random() > 0.8) {
                this.createBubbleParticle(x, y);
            }

            // 更新粒子位置与透明度，超时则销毁并从数组移除
            for (let i = this.bubbles.length - 1; i >= 0; i--) {
                const b = this.bubbles[i];
                b.setY(b.y() - 1.2);
                b.setX(b.x() + Math.sin(frame.time / 200) * 0.8);
                b.opacity(b.opacity() - 0.015);

                if (b.opacity() <= 0) {
                    b.destroy();
                    this.bubbles.splice(i, 1);
                }
            }
        }, this.sys.layer);

        this.anim.start();
    }

    stopEmitting() {
        this.isEmitting = false;
        if (this.anim) {
            this.anim.stop();
            this.anim = null;
        }
    }

    createBubbleParticle(x, y) {
        const bubble = new Konva.Circle({
            x: x + (Math.random() - 0.5) * (this.w * 0.3),
            y: y,
            radius: Math.random() * (this.w * 0.2) + 2,
            stroke: 'white',
            strokeWidth: 1,
            fill: 'rgba(7, 7, 233, 0.4)',
            opacity: 0.8,
            listening: false
        });
        this.sys.layer.add(bubble);
        this.bubbles.push(bubble);
    }

    clearAllBubbles() {
        this.stopEmitting();

        this.bubbles.forEach(b => {
            if (b) b.destroy();
        });
        this.bubbles = [];
        this._refreshCache();
    }
}