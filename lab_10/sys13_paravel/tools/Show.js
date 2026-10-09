/**
 * 展示类 V1.0 - 在自动展示操作时使用，提供一些工具函数来高亮组件、连线等，以便更清晰地展示电路的工作原理。
 * 设计原则：尽量不修改现有组件的结构和样式，而是通过在其上叠加 Konva 节点（如箭头、半透明遮罩等）来实现高亮和指示效果。
 * 主要功能：  
 */
export class Show {
    constructor(sys) {
        this.sys = sys;
        this.activeTips = new Map(); // 用于追踪当前显示的提示文字
    }

    // 在 sys 上添加：
    // 1) 在组件某侧添加并闪烁箭头
    addBlinkingArrow(compId, direction, opts = {}) {
        const comp = this.sys.comps[compId];
        if (!comp) return null;
        const box = comp.group.getClientRect({ relativeTo: this.sys.stage });
        const padding = opts.offset || 10;
        let x, y, points;
        // 箭头指向组件中心（从外指向内）
        if (direction === 'right') { x = box.x - padding; y = box.y - padding; points = [x, y, x + box.width + 2 * padding, y]; }
        if (direction === 'left') { x = box.x - padding; y = box.y - padding; points = [x + box.width + 2 * padding, y, x, y]; }
        if (direction === 'up') { x = box.x + box.width + padding; y = box.y - padding; points = [x, y + box.height + 2 * padding, x, y]; }
        if (direction === 'down') { x = box.x + box.width + padding; y = box.y - padding; points = [x, y, x, y + box.height + 2 * padding]; }

        const arrow = new Konva.Arrow({
            points,
            pointerLength: opts.pointerLength || 12,
            pointerWidth: opts.pointerWidth || 10,
            fill: opts.color || '#f39c12',
            stroke: opts.color || '#f39c12',
            strokeWidth: opts.strokeWidth || 3,
            opacity: 1,
            listening: false
        });
        this.sys.layer.add(arrow);
        // 闪烁：交替 visible 或 opacity
        let visible = true;
        arrow._blinkTimer = setInterval(() => {
            visible = !visible;
            arrow.opacity(visible ? 1 : 0.15);
            this.sys.requestRedraw ? this.sys.requestRedraw() : this.sys.layer.draw();
        }, opts.interval || 500);
        this._activeArrows = this._activeArrows || [];
        this._activeArrows.push(arrow);
        return arrow;
    }

    // 取消闪烁并移除箭头
    removeBlinkingArrow(arrow) {
        if (!arrow) return;
        if (arrow._blinkTimer) { clearInterval(arrow._blinkTimer); delete arrow._blinkTimer; }
        arrow.remove();
        this.sys.requestRedraw ? this.sys.requestRedraw() : this.sys.layer.draw();
    }

    // 2) 高亮一条连线（传入 Konva.Line / Konva.Arrow 节点）
    /**
     * 高亮一条连线
     * @param {Object} connData - 格式为 {from, to, type}
     * @param {Object} opts - 配置项 (color, pulse, pulseWidth, shadowBlur)
     */
    highlightLine(connData, opts = {}) {
        // 1. 严格过滤：只对 type 为 'wire' 的连接进行处理
        if (!connData || connData.type !== 'wire') return;

        // 2. 生成标准的 Key 值
        const targetKey = this.sys._connKeyCanonical(connData);

        // 3. 从 wireNodes 数组中直接查找匹配的 Konva 节点
        // 因为你在创建时执行了 line.setAttr('connKey', key)
        const lineNode = this.sys.wireNodes.find(n => n.getAttr('connKey') === targetKey);

        if (!lineNode) return;

        // 4. 备份原始样式（仅在第一次高亮时备份）
        if (!lineNode._orig) {
            lineNode._orig = {
                stroke: lineNode.stroke(),
                strokeWidth: lineNode.strokeWidth(),
                shadowBlur: lineNode.shadowBlur() || 0
            };
        }

        const color = opts.color || '#e74c3c';
        const pulseWidth = opts.pulseWidth || 3;

        // 使用 Konva.Tween 平滑过渡到高亮状态
        lineNode.to({
            stroke: color,
            strokeWidth: (lineNode._orig.strokeWidth || 2) + pulseWidth,
            shadowColor: color,
            shadowBlur: opts.shadowBlur || 12,
            duration: 0.12
        });

        // 5. 呼吸动画逻辑
        if (opts.pulse) {
            if (lineNode._pulseAnim) lineNode._pulseAnim.stop();
            lineNode._pulseAnim = new Konva.Animation((frame) => {
                // 使用正弦函数实现平滑呼吸效果
                const t = (Math.sin(frame.time * 2 * Math.PI / 1000) + 1) / 2;
                lineNode.strokeWidth(lineNode._orig.strokeWidth + pulseWidth * t);
            }, lineNode.getLayer());
            lineNode._pulseAnim.start();
        }

        // 触发重绘（建议使用之前提到的 requestRedraw 机制）
        if (this.sys.requestRedraw) {
            this.sys.requestRedraw();
        } else {
            lineNode.getLayer().batchDraw();
        }
    }
    // 恢复连线样式
    /**
     * 恢复连线样式
     * @param {Object} connData - 格式为 {from, to, type}
     */
    unhighlightLine(connData) {
        // 1. 过滤类型
        if (!connData || connData.type !== 'wire') return;

        const targetKey = this.sys._connKeyCanonical(connData);
        const lineNode = this.sys.wireNodes.find(n => n.getAttr('connKey') === targetKey);

        if (!lineNode || !lineNode._orig) return;

        // 2. 停止呼吸动画
        if (lineNode._pulseAnim) {
            lineNode._pulseAnim.stop();
            delete lineNode._pulseAnim;
        }

        // 3. 恢复备份的原始属性
        lineNode.to({
            stroke: lineNode._orig.stroke,
            strokeWidth: lineNode._orig.strokeWidth,
            shadowBlur: lineNode._orig.shadowBlur || 0,
            duration: 0.15
        });

        // 4. 清理备份标记以便下次重新备份
        delete lineNode._orig;

        if (this.sys.requestRedraw) {
            this.sys.requestRedraw();
        } else {
            lineNode.getLayer().batchDraw();
        }
    }






    // ... 已有的 addBlinkingArrow, highlightLine 等方法 ...

    /**
     * 3) 在组件附近显示提示文字
     * @param {string} compId - 组件ID
     * @param {string} text - 提示内容
     * @param {Object} opts - 配置 (color, fontSize, bgColor, duration)
     */
    showTooltip(compId, text, opts = {}) {
        const comp = this.sys.comps[compId];
        if (!comp) return null;

        // 如果该组件已有提示，先移除旧的
        if (this.activeTips.has(compId)) {
            this.removeTooltip(compId);
        }

        // 1. 获取组件位置和方向
        // 假设组件实例上有 direction 属性 ('horizontal' 或 'vertical')
        const isVertical = comp.direction === 'vertical';
        const box = comp.group.getClientRect({ relativeTo: this.sys.stage });
        const padding = 15;

        let x, y;
        if (isVertical) {
            // 竖着放的设备：文字显示在右侧
            x = box.x + box.width + padding;
            y = box.y + box.height / 2;
        } else {
            // 横着放的设备：文字显示在正上方
            x = box.x + box.width / 2;
            y = box.y - padding;
        }

        // 2. 创建文字组 (背景框 + 文字)
        const tipGroup = new Konva.Group({
            x: x,
            y: y,
            opacity: 0,
            listening: false
        });

        const textNode = new Konva.Text({
            text: text,
            fontSize: opts.fontSize || 16,
            fontStyle: 'bold',
            fill: opts.color || '#ffffff',
            padding: 8,
            align: 'center'
        });

        // 根据文字大小创建背景矩形
        const bgRect = new Konva.Rect({
            width: textNode.width(),
            height: textNode.height(),
            fill: opts.bgColor || 'rgba(44, 62, 80, 0.9)',
            cornerRadius: 4,
            shadowColor: 'black',
            shadowBlur: 5,
            shadowOpacity: 0.3
        });

        // 居中对齐处理
        if (isVertical) {
            // 右侧模式：垂直居中
            tipGroup.offsetY(textNode.height() / 2);
        } else {
            // 上方模式：水平居中并放在底部
            tipGroup.offsetX(textNode.width() / 2);
            tipGroup.offsetY(textNode.height());
        }

        tipGroup.add(bgRect, textNode);
        this.sys.layer.add(tipGroup);

        // 3. 入场动画
        tipGroup.to({
            opacity: 1,
            duration: 0.3,
            y: y + (isVertical ? 0 : -5), // 向上飘一点点
        });

        this.activeTips.set(compId, tipGroup);

        // 4. 自动重绘
        this.sys.requestRedraw ? this.sys.requestRedraw() : this.sys.layer.draw();

        // 如果设置了持续时间，到期自动移除
        if (opts.duration) {
            setTimeout(() => this.removeTooltip(compId), opts.duration);
        }

        return tipGroup;
    }

    /**
     * 移除特定组件的提示文字
     */
    removeTooltip(compId) {
        const tip = this.activeTips.get(compId);
        if (tip) {
            tip.to({
                opacity: 0,
                duration: 0.2,
                onFinish: () => {
                    tip.destroy();
                    this.activeTips.delete(compId);
                    this.sys.requestRedraw ? this.sys.requestRedraw() : this.sys.layer.draw();
                }
            });
        }
    }

    /**
     * 清除所有提示
     */
    clearAllTooltips() {
        this.activeTips.forEach((node, compId) => {
            this.removeTooltip(compId);
        });
    }

    /**
     * 4) 模拟电流流动效果
     * @param {Object} connData - 连线数据
     * @param {number} speed - 流动速度（正负代表方向）
     */
    flowSignal(connData, speed = 20) {
        const targetKey = this.sys._connKeyCanonical(connData);
        const lineNode = this.sys.wireNodes.find(n => n.getAttr('connKey') === targetKey);

        if (!lineNode) return;

        lineNode.dash([10, 5]); // 开启虚线
        const anim = new Konva.Animation((frame) => {
            const dist = (frame.time / 1000) * speed;
            lineNode.dashOffset(-dist);
        }, lineNode.getLayer());

        anim.start();
        this._activeAnims.push(anim);
        return anim;
    }

    /**
     * 5) 镜头聚焦功能
     * @param {string|string[]} compIds - 单个或多个组件ID
     * @param {number} padding - 留白大小
     */
    focusOn(compIds, padding = 50) {
        if (!Array.isArray(compIds)) compIds = [compIds];

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        compIds.forEach(id => {
            const comp = this.sys.comps[id];
            if (!comp) return;
            const box = comp.group.getClientRect();
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const stage = this.sys.stage;

        // 1. 计算缩放比例
        const scale = Math.min(
            stage.width() / (width + padding * 2),
            stage.height() / (height + padding * 2)
        );

        // 2. 居中计算核心：
        // 计算目标区域缩放后在舞台上的起始点，使其左右上下留白相等
        const centerX = (stage.width() - width * scale) / 2;
        const centerY = (stage.height() - height * scale) / 2;

        stage.to({
            x: -minX * scale + centerX,
            y: -minY * scale + centerY,
            scaleX: scale,
            scaleY: scale,
            duration: 1,
            easing: Konva.Easings.EaseInOut
        });
    }

    resetFocus() {
        const stage = this.sys.stage;
        stage.to({
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            duration: 1,
            easing: Konva.Easings.EaseInOut
        });
    }

    /**
     * 6) “爆炸”强调效果
     * 用于点击或故障发生时的瞬间视觉反馈
     */
    showExplosion(compId) {
        const comp = this.sys.comps[compId];
        const box = comp.group.getClientRect();
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

        const ring = new Konva.Ring({
            x: center.x, y: center.y,
            innerRadius: 0, outerRadius: 0,
            stroke: '#e74c3c', strokeWidth: 2,
            opacity: 1
        });
        this.sys.layer.add(ring);

        ring.to({
            innerRadius: 40, outerRadius: 50,
            opacity: 0, duration: 0.5,
            onFinish: () => ring.destroy()
        });
    }


    /**
 * 7) 全场暗场聚焦
 * @param {string[]} compIds - 需要保持明亮的组件 ID 列表
 */
    /**
     * 带有组件高亮的暗场聚焦功能
     * @param {string[]} compIds - 需要“亮起”并高亮的组件 ID 列表
     * @param {number} opacity - 背景遮罩的透明度
     */
    focusWithDimmer(compIds = [], opacity = 0.7) {
        // 1. 如果已有暗场，先恢复旧组件层级并销毁
        if (this.dimmer) {
            this.removeDimmer();
        }

        // 2. 创建覆盖全屏的暗场
        // 使用相对于舞台变换的坐标，确保缩放平移后依然全屏
        const stage = this.sys.stage;
        this.dimmer = new Konva.Rect({
            x: -stage.x() / stage.scaleX(),
            y: -stage.y() / stage.scaleY(),
            width: stage.width() / stage.scaleX(),
            height: stage.height() / stage.scaleY(),
            fill: 'black',
            opacity: 0,
            listening: false,
            name: 'dimmer-mask'
        });

        this.sys.layer.add(this.dimmer);

        // 3. 处理需要高亮的组件
        this._highlightedComps = compIds; // 记录下来以便后续恢复
        compIds.forEach(id => {
            const comp = this.sys.comps[id];
            if (!comp) return;

            // 备份原始层级索引
            comp._oldZIndex = comp.group.getZIndex();

            // 将组件移到 dimmer 之上
            // 在 Konva 中，后添加或 zIndex 大的节点在上方
            comp.group.moveToTop();

            // 触发组件自带的高亮效果（发光底座）
            if (typeof comp.highlight === 'function') {
                comp.highlight(true, '#f1c40f');
            }
        });

        // 将 dimmer 移到刚提升的组件下方
        // 逻辑：moveToTop 会把组件放最顶，我们把 dimmer 放它们下面一层
        this.dimmer.moveDown();

        // 执行渐变动画
        this.dimmer.to({ opacity: opacity, duration: 0.5 });

        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /**
     * 移除暗场并恢复所有组件层级
     */
    removeDimmer() {
        if (!this.dimmer) return;

        // 1. 恢复之前高亮组件的状态
        if (this._highlightedComps) {
            this._highlightedComps.forEach(id => {
                const comp = this.sys.comps[id];
                if (!comp) return;

                // 关闭发光底座
                if (typeof comp.highlight === 'function') {
                    comp.highlight(false);
                }

                // 恢复层级 (如果不恢复，组件会一直浮在最上层，破坏遮盖逻辑)
                if (comp._oldZIndex !== undefined) {
                    comp.group.setZIndex(comp._oldZIndex);
                }
            });
            this._highlightedComps = [];
        }

        // 2. 暗场消失动画
        this.dimmer.to({
            opacity: 0,
            duration: 0.3,
            onFinish: () => {
                if (this.dimmer) {
                    this.dimmer.destroy();
                    this.dimmer = null;
                }
                if (this.sys.requestRedraw) this.sys.requestRedraw();
            }
        });
    }

    /**
 * 8) 添加组件状态扩散环
 * @param {string} compId 
 */
    showStatusRing(compId, color = '#2ecc71') {
        const comp = this.sys.comps[compId];
        const box = comp.group.getClientRect();
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

        const ring = new Konva.Circle({
            x: center.x,
            y: center.y,
            radius: Math.max(box.width, box.height) / 2,
            stroke: color,
            strokeWidth: 2,
            opacity: 0.8,
            listening: false
        });
        this.sys.layer.add(ring);

        // 循环扩散动画
        const anim = new Konva.Tween({
            node: ring,
            radius: ring.radius() * 1.5,
            opacity: 0,
            duration: 1.2,
            onFinish: () => {
                ring.radius(Math.max(box.width, box.height) / 2);
                ring.opacity(0.8);
                anim.play();
            }
        });
        anim.play();
        return { node: ring, anim: anim };
    }

    /**
 * 9) 端口闪烁指引
 * @param {string} compId 
 * @param {string} portId 
 */
    pingPort(compId, portId, color = '#3498db') {
        const comp = this.sys.comps[compId];
        if (!comp || !comp.getAbsPortPos) return;

        const pos = comp.getAbsPortPos(portId);
        const ping = new Konva.Circle({
            x: pos.x,
            y: pos.y,
            radius: 5,
            fill: color,
            shadowColor: color,
            shadowBlur: 10,
            listening: false
        });
        this._activePings = this._activePings || [];
        this._activePings.push(ping);
        this.sys.layer.add(ping);

        // 缩放闪烁
        ping.to({
            scaleX: 2.5,
            scaleY: 2.5,
            opacity: 0,
            duration: 0.8,
            loop: true, // 如果你的系统封装了 loop
            onFinish: () => {
                ping.scale({ x: 1, y: 1 });
                ping.opacity(1);
                // 这里可以递归调用实现循环
            }
        });
    }

    /**
 * 自动化展示脚本执行器
 * @param {Array} steps - 脚本步骤数组
 * [{ action: 'focus', data: ['amp1'], duration: 1000 }, ...]
 */
    async playScript(steps) {
        if (!steps || !Array.isArray(steps)) return;

        // 标记当前正在执行脚本，防止多个脚本冲突
        this.isScriptRunning = true;
        console.log("🎬 自动演示开始...");

        for (const step of steps) {
            // 如果脚本中途被外部停止，则退出
            if (!this.isScriptRunning) break;

            const { action, data, opts = {}, wait = true } = step;

            try {
                // 1. 指令分发
                switch (action) {
                    case 'focus': // 镜头聚焦
                        this.focusOn(data, opts.padding);
                        break;
                    case 'unfocus': // 镜头聚焦
                        this.resetFocus();
                        break;
                    case 'dimmer': // 开启暗场
                        this.focusWithDimmer(data, opts.opacity);
                        break;
                    case 'undimmer': // 关闭暗场
                        this.removeDimmer();
                        break;
                    case 'tip': // 显示文字
                        this.showTooltip(data, opts.text, opts);
                        break;
                    case 'untip': // 移除文字
                        this.removeTooltip(data);
                        break;
                    case 'arrow': // 添加箭头
                        this.addBlinkingArrow(data, opts.direction, opts);
                        break;
                    case 'highlight': // 高亮连线/组件
                        if (opts.type === 'wire') {
                            this.highlightLine(data, opts);
                        } else {
                            // 假设组件实例有 highlight 方法
                            this.sys.comps[data]?.highlight(true, opts.color);
                        }
                        break;
                    case 'unhighlight':
                        if (opts.type === 'wire') {
                            this.unhighlightLine(data);
                        } else {
                            this.sys.comps[data]?.highlight(false);
                        }
                        break;
                    case 'flow': // 开启信号流动
                        this.flowSignal(data, opts.speed);
                        break;
                    case 'ping': // 端口指引
                        this.pingPort(data, opts.portId, opts.color);
                        break;
                    case 'clear': // 清除所有效果
                        this.clearAll();
                        break;
                    default:
                        console.warn(`未知指令: ${action}`);
                }

                // 2. 停顿处理
                // 如果 wait 为 true，则等待 step.duration 时间后再进入下一步
                if (wait) {
                    await new Promise(resolve => {
                        this._currentTimer = setTimeout(resolve, step.duration || 1000);
                    });
                }
            } catch (err) {
                console.error(`执行步骤失败: ${action}`, err);
            }
        }

        this.isScriptRunning = false;
        console.log("✅ 自动演示结束。");
    }

    /**
     * 强制中断当前运行的脚本
     */
    stopScript() {
        this.isScriptRunning = false;
        if (this._currentTimer) clearTimeout(this._currentTimer);
        this.clearAll();
    }

    /**
     * 清理所有临时展示效果
     */
    /**
     * 清理所有临时展示效果，将画布恢复至原始状态
     */
    clearAll() {
        // 1. 停止脚本运行标记与主计时器
        this.isScriptRunning = false;
        if (this._currentTimer) {
            clearTimeout(this._currentTimer);
            this._currentTimer = null;
        }

        // 2. 清理提示文字 (Tooltips)
        this.clearAllTooltips();

        // 3. 移除暗场效果 (Dimmer)
        this.removeDimmer();

        // 4. 停止并销毁所有 Konva.Animation (信号流、呼吸灯等)
        if (this._activeAnims && this._activeAnims.length > 0) {
            this._activeAnims.forEach(anim => {
                if (anim) anim.stop();
            });
            this._activeAnims = [];
        }

        // 5. 遍历并移除所有闪烁箭头 (Arrows)
        // 建议在 addBlinkingArrow 时将箭头存入 this._activeArrows 数组
        if (this._activeArrows && this._activeArrows.length > 0) {
            this._activeArrows.forEach(arrow => {
                if (arrow._blinkTimer) clearInterval(arrow._blinkTimer);
                arrow.destroy(); // 直接从内存中彻底销毁
            });
            this._activeArrows = [];
        }

        // 6. 移除所有端口指引 (Ping Rings)
        if (this._activePings && this._activePings.length > 0) {
            this._activePings.forEach(ping => ping.destroy());
            this._activePings = [];
        }

        // 7. 恢复所有被高亮的连线样式
        // 遍历 wireNodes，找到带 _orig 备份的节点并还原
        if (this.sys.wireNodes) {
            this.sys.wireNodes.forEach(lineNode => {
                if (lineNode._orig) {
                    // 停止可能存在的脉冲动画
                    if (lineNode._pulseAnim) {
                        lineNode._pulseAnim.stop();
                        delete lineNode._pulseAnim;
                    }
                    // 还原样式
                    lineNode.setAttrs({
                        stroke: lineNode._orig.stroke,
                        strokeWidth: lineNode._orig.strokeWidth,
                        shadowBlur: lineNode._orig.shadowBlur || 0
                    });
                    delete lineNode._orig;
                }
            });
        }

        // 8. 恢复所有组件的高亮状态 (Glow Layers)
        Object.values(this.sys.comps).forEach(comp => {
            if (typeof comp.highlight === 'function') {
                comp.highlight(false);
            }
        });

        // 9. 最后触发一次全局重绘
        if (this.sys.requestRedraw) {
            this.sys.requestRedraw();
        } else if (this.sys.layer) {
            this.sys.layer.batchDraw();
        }

        console.log("🧹 所有展示效果已清理完毕");
    }
}