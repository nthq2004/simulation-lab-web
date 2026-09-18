/**
 * DiagramStopButton 停止按钮/停止开关图形组件。
 *
 * 作用：这是一个用于仿真平台中的停止按钮元件，呈现常闭触点结构的电气控制按钮。
 * 它在默认状态下保持闭合，用户按下按钮后触点断开，从而模拟“停止”信号的动作；
 * 同时支持手动闭合和断开模拟、右键菜单配置以及工作流定位。
 *
 * 设计特点：
 * 1. 使用红色典型停止按钮风格体现“停机”语义；
 * 2. 动态刀片角度变化模拟常闭触点打开/闭合；
 * 3. getValue() 返回断开/闭合状态对应的电气值；
 * 4. 可通过菜单和配置界面对位号和模拟状态进行控制。
 */
import { BaseComponent } from './BaseComponent.js';

export class DiagramStopButton extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件通用行为和系统引用环境。
        super(config, sys);

        // 组件大小默认按最小值起步，允许上层传入更大尺寸以适配布局。
        this.width  = Math.max(80, config.width  || 100);
        this.height = Math.max(80, config.height || 80);

        // 组件类型声明为 PUSHBUTTON，并且标记为 STOP-BTN 表示停止按钮。
        this.type    = 'PUSHBUTTON';
        this.special = 'STOP-BTN';
        // 静态渲染采用 fixed 缓存，减少重复重绘。
        this.cache   = 'fixed';

        // 按钮的状态变量：当前按压状态、手动覆盖状态、刀片当前角度和触点半径。
        this._isPressed = false;
        this._manualPressed = false;
        this._curBladeAng = 2;
        this._contactR = 5;

        // 按常规顺序初始化图层、几何参数、配置参数和视觉结构。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 配置对象保存位号和标签，以便后续识别和更新。
        this.config = { id: this.id, label: this.label };

        // 左右两侧端口表示常闭触点的两个连接端子。
        this.addPort(2, this.height / 2 - 10, 'nc3', 'wire');
        this.addPort(this.width - 2, this.height / 2 - 10, 'nc4', 'wire', 'p');
    }

    _recalcGeometry() {
        // 计算按钮的中心和触点几何位置，确保刀片动作在合理范围内。
        const W = this.width, H = this.height;
        this._cx = W / 2;
        // 左右静触点间距缩至原 2/3（端子位置不变，触点向中心收拢）
        const _gap = (W - 40) * 2 / 3;
        this._leftX = (W - _gap) / 2;
        this._rightX = (W + _gap) / 2;
        this._pivotY = H / 2 - 10;
        this._contactInY = this._pivotY - 20;
    }

    _initParameters(config) {
        // 确认按钮文本标签，默认值为 SB。
        this.label = config.label || 'SB';
    }

    _init() {
        // 初始化流程分为静态部件、动态触点和交互绑定三步。
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        // 生成停止按钮的固定部件，如触点、端子和按钮帽。
        const W = this.width, H = this.height;
        const cy = this._pivotY;
        const poleColor = '#e03030';

        // 左端子 → 左静触头，表示连接线到左侧固定触点。
        this._staticGroup.add(new Konva.Line({
            points: [2, cy, this._leftX, cy],
            stroke: poleColor, strokeWidth: 2,
        }));

        // 右端子 → 右静触头，表示连接线到右侧固定触点。
        this._staticGroup.add(new Konva.Line({
            points: [this._rightX, cy, W - 2, cy],
            stroke: poleColor, strokeWidth: 2,
        }));

        // 左静触头（小圆点）作为固定触点的一部分。
        this._staticGroup.add(new Konva.Circle({
            x: this._leftX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 右静触头（小圆点）与左静触头对称，形成常闭触点结构。
        this._staticGroup.add(new Konva.Circle({
            x: this._rightX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 端子圆点增加真实金属接点视觉感。
        this._drawTerminal(2, cy, poleColor);
        this._drawTerminal(W - 2, cy, poleColor);

        // 倒山字按钮帽（底部，红色）体现停止按钮的典型样式。
        this._drawButtonCap(this._cx, H - 20, poleColor);

        // 标签显示位号或名称，方便区分不同停止按钮。
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 10, width: W,
            text: this.label, fontSize: 14, fill: '#333', align: 'center',fontStyle:'bold',
        }));
    }

    _drawButtonCap(cx, y, color) {
        // 按钮帽由横线和竖线构成，形成倒山字结构的机械外观。
        const hatH = 13;
        const sideH = 11;

        // 底部横线作为按钮帽的底座。
        this._staticGroup.add(new Konva.Line({
            points: [cx - 14, y, cx + 14, y],
            stroke: color, strokeWidth: 2.5,
        }));
        // 左竖线（高）模拟按钮两侧支撑。
        this._staticGroup.add(new Konva.Line({
            points: [cx - 14, y, cx - 14, y - sideH],
            stroke: color, strokeWidth: 2,
        }));
        // 中竖线（高）形成按钮帽中心轴。
        this._staticGroup.add(new Konva.Line({
            points: [cx, y, cx, y - hatH],
            stroke: color, strokeWidth: 2,
        }));
        // 右竖线（高）与左侧保持对称。
        this._staticGroup.add(new Konva.Line({
            points: [cx + 14, y, cx + 14, y - sideH],
            stroke: color, strokeWidth: 2,
        }));
    }

    _drawTerminal(x, y, color) {
        // 端子以金属圆点模拟真实接线端子，增强仪表感。
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: 4,
            fillLinearGradientStartPoint: { x: -4, y: -4 },
            fillLinearGradientEndPoint:   { x: 4, y: 4 },
            fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
            stroke: '#908030', strokeWidth: 1,
        }));
    }

    _createDynamicNodes() {
        // 动态节点负责更新刀片角度、推杆位置与触点状态。
        const cx = this._cx;

        // 推杆虚线（从按钮帽到旋转点）提示机械连接关系。
        this._plungerLine = new Konva.Line({
            points: [cx, this.height - 30, cx, this._pivotY-2 ],
            stroke: '#e03030', strokeWidth: 1.5,
            dash: [4, 3],
        });
        this._dynamicGroup.add(this._plungerLine);

        // 旋转触点臂（围绕右端子旋转，NC初始闭合）模拟常闭触点的初始状态。
        this._bladeGroup = new Konva.Group({
            x: this._rightX,
            y: this._pivotY,
            rotation: 5,
        });

        // 刀片线构成按钮的动态触点骨架。
        this._bladeGroup.add(new Konva.Line({
            points: [0, 0, -(this._rightX - this._leftX), 0],
            stroke: '#e03030', strokeWidth: 2.5, lineCap: 'round',
        }));

        // 动触点小半圆（面向左侧静触点）代表触头在闭合状态下接触区域。
        this._bladeGroup.add(new Konva.Arc({
            x: -(this._rightX - this._leftX), y: 0,
            innerRadius: 0, outerRadius: this._contactR,
            angle: 180, rotation: 0,
            fill: '#e8c86a', stroke: '#e03030', strokeWidth: 1.5,
        }));

        this._dynamicGroup.add(this._bladeGroup);
    }

    _bindInteraction() {
        // 用鼠标/触摸事件模拟按钮按下/释放，即常闭触点断开/恢复闭合。
        const hitArea = new Konva.Rect({
            x: this._cx - 20, y: this.height - 35,
            width: 40, height: 30,
            fill: 'transparent',
        });
        hitArea.on('mousedown touchstart', (e) => {
            // 按下时旋转刀片，令常闭触点断开。
            e.cancelBubble = true;
            this._isPressed = true;
            this._curBladeAng = 22.5;
            this._bladeGroup.rotation(22.5);
            this._updatePlunger();
        });
        hitArea.on('mouseup touchend', (e) => {
            // 松开时恢复到初始角度，常闭触点再次闭合。
            e.cancelBubble = true;
            this._isPressed = false;
            this._curBladeAng = 5;
            this._bladeGroup.rotation(5);
            this._updatePlunger();
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => {
            // 离开区域时恢复默认样式，若当前还处于按压状态则自动回位。
            document.body.style.cursor = 'default';
            if (this._isPressed) {
                this._isPressed = false;
                this._curBladeAng = 5;
                this._bladeGroup.rotation(5);
                this._updatePlunger();
            }
        });
        this._interactGroup.add(hitArea);
    }

    _updatePlunger() {
        // 根据刀片角度计算推杆末端位置，维持按钮机械运动的同步性。
        const cy = this._pivotY;
        const rad = this._curBladeAng * Math.PI / 180;
        const armLen = this._rightX - this._leftX;
        const tipY = cy - armLen * Math.sin(rad);
        this._plungerLine.points([this._cx, this.height - 25, this._cx, tipY+5]);
    }

    getValue() {
        // 返回当前按钮的接通状态：按下或手动覆盖时为断开电气值，默认闭合时返回接通值。
        return (this._isPressed || this._manualPressed) ? 10000000 : 0.01;
    }

    /** 模拟按下/松开（工作流调用）：等效于常闭触点断开/闭合 */
    setManualOverride(v) {
        // 手动覆盖按钮状态，用于工作流和右键菜单中的强制演示。
        this._manualPressed = !!v;
        const ang = this._manualPressed ? 22.5 : 2;
        this._curBladeAng = ang;
        this._bladeGroup.rotation(ang);
        this._updatePlunger();
        this.markDirty();
        this._refreshIfDirty();
    }

    getManualOverride() {
        // 返回当前是否处于手动闭合覆盖状态。
        return !!this._manualPressed;
    }

    tick(dt) {}

    /** 返回可点击部件中心坐标（供工作流 find/箭头指示定位）：'btn' = 按钮帽中心 */
    getClickablePartCenter(partId) {
        // 工作流调用时，可根据按钮帽或者中心区域返回定位点。
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const rel = (partId === 'btn' || !partId)
            ? { x: this._cx, y: this.height - 20 }    // 按钮帽（倒山字帽位置）
            : { x: this.width / 2, y: this.height / 2 };
        return { x: gx + rel.x, y: gy + rel.y };
    }

    getConfigFields() {
        // 配置面板只允许编辑按钮位号，便于在控制逻辑中区分不同停止按钮。
        return [{ label: '位号', key: 'label', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        // 更新位号后重建静态和动态图层，确保界面同步反映新配置。
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() { super.destroy?.(); }
}
