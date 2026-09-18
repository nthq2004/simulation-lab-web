/**
 * DiagramStartButton 启动按钮/起动按钮图形组件。
 *
 * 作用：这是一个用于教学仿真平台中的启动按钮元件，表现为传统电气控制开关的按钮结构。
 * 它可以模拟按钮被按下时动触点向左旋转闭合，形成“启动”信号；松开后恢复到断开状态，
 * 同时支持右键菜单中的手动闭合/断开模拟与配置编辑。
 *
 * 设计特点：
 * 1. 组件包含静态端子和动态刀片触点，形象表现按钮动作；
 * 2. 支持按下/释放时的旋转动画和推杆位置更新；
 * 3. 提供 getValue() 输出闭合状态，供其他电路/逻辑模块读取；
 * 4. 允许通过右键菜单和配置界面进行手动覆盖和位号编辑。
 */
import { BaseComponent } from './BaseComponent.js';

export class DiagramStartButton extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化通用组件和系统引用环境。
        super(config, sys);

        // 组件尺寸设定为最小 80×80，允许上层调用时按需指定更大尺寸。
        this.width  = Math.max(80, config.width  || 100);
        this.height = Math.max(80, config.height || 100);

        // 组件类型用于区分按钮器件，同时标记为启动按钮特殊类型。
        this.type    = 'PUSHBUTTON';
        this.special = 'START-BTN';
        // 静态视觉采用固定缓存，减少频繁重绘。
        this.cache   = 'fixed';

        // 组件状态：是否当前按下、是否被手动覆盖、刀片当前角度和动态触点半径。
        this._isPressed = false;
        this._manualPressed = false;
        this._curBladeAng = -22.5;
        this._contactR = 5;

        // 按常规顺序初始化图层、几何参数、配置参数和视觉结构。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 组件配置对象中保存位号和文本标签，方便后续重置或显示。
        this.config = { id: this.id, label: this.label };

        // 在左右两侧创建端口，表示按钮的常开接点两端。
        this.addPort(2, this.height / 2 - 10, 'no1', 'wire');
        this.addPort(this.width - 2, this.height / 2 - 10, 'no2', 'wire', 'p');
    }

    _recalcGeometry() {
        // 计算核心几何参数，确定中心、静触头位置、支点和刀片动作范围。
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
        // 读取标签参数，默认以 SB 作为位号标识。
        this.label = config.label || 'SB';
    }

    _init() {
        // 组件初始化逻辑分三步：静态主体、动态刀片、交互事件绑定。
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        // 生成该按钮的固定视觉部件，如端子、静触头和按钮帽。
        const W = this.width, H = this.height;
        const cy = this._pivotY;
        const poleColor = '#20a030';

        // 左端子 → 左静触头，表示按钮的左侧输入端子连接线。
        this._staticGroup.add(new Konva.Line({
            points: [2, cy, this._leftX, cy],
            stroke: poleColor, strokeWidth: 2,
        }));

        // 右端子 → 右静触头，表示按钮的右侧输出端子连接线。
        this._staticGroup.add(new Konva.Line({
            points: [this._rightX, cy, W - 2, cy],
            stroke: poleColor, strokeWidth: 2,
        }));

        // 左静触头（小圆点），用于与刀片动触点接触闭合。
        this._staticGroup.add(new Konva.Circle({
            x: this._leftX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 右静触头（小圆点），对称地形成另一侧固定触点。
        this._staticGroup.add(new Konva.Circle({
            x: this._rightX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 端子圆点用于增强连接状态的视觉辨识。
        this._drawTerminal(2, cy, poleColor);
        this._drawTerminal(W - 2, cy, poleColor);

        // 倒山字按钮帽（底部，靠近开关）是按钮的可见按压结构。
        this._drawButtonCap(this._cx, H - 20, poleColor);

        // 组件标签显示位号或名称，方便识别在控制面板中的位置。
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 18, width: W,
            text: this.label, fontSize: 14, fill: '#333', align: 'center',fontStyle:'bold',
        }));
    }

    _drawButtonCap(cx, y, color) {
        // 按钮帽由横线和三段竖线组成，突出“倒山字”按钮的机构样式。
        const hatH = 13;
        const sideH = 10;

        // 底部横线构成按钮帽的基座。
        this._staticGroup.add(new Konva.Line({
            points: [cx - 14, y, cx + 14, y],
            stroke: color, strokeWidth: 2.5,
        }));
        // 左竖线（高）与右竖线体现按钮帽两侧支撑。
        this._staticGroup.add(new Konva.Line({
            points: [cx - 14, y, cx - 14, y - sideH],
            stroke: color, strokeWidth: 2,
        }));
        // 中间竖线连接按钮帽中心，形成明显中轴。
        this._staticGroup.add(new Konva.Line({
            points: [cx, y, cx, y - hatH],
            stroke: color, strokeWidth: 2,
        }));
        // 右竖线（高）与左侧对称，增强按钮帽立体感。
        this._staticGroup.add(new Konva.Line({
            points: [cx + 14, y, cx + 14, y - sideH],
            stroke: color, strokeWidth: 2,
        }));
    }

    _drawTerminal(x, y, color) {
        // 端子绘制为带渐变的圆点，表示电气连接点的金属触点。
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: 4,
            fillLinearGradientStartPoint: { x: -4, y: -4 },
            fillLinearGradientEndPoint:   { x: 4, y: 4 },
            fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
            stroke: '#908030', strokeWidth: 1,
        }));
    }

    _createDynamicNodes() {
        // 创建动作时会变化的刀片触点和推杆虚线，代表按钮按下过程中的机械运动。
        const cx = this._cx;

        // 推杆虚线（从按钮帽到旋转点）提示机械连接关系。
        this._plungerLine = new Konva.Line({
            points: [cx, this.height - 30, cx, this._pivotY+15 ],
            stroke: '#20a030', strokeWidth: 1.5,
            dash: [4, 3],
        });
        this._dynamicGroup.add(this._plungerLine);

        // 旋转触点臂（围绕右端子旋转）模拟按钮所驱动的刀片式触头动作。
        this._bladeGroup = new Konva.Group({
            x: this._rightX,
            y: this._pivotY,
            rotation: this._curBladeAng,
        });

        // 刀片线形成可转动的主触头。
        this._bladeGroup.add(new Konva.Line({
            points: [0, 0, -(this._rightX - this._leftX), 0],
            stroke: '#e03030', strokeWidth: 2.5, lineCap: 'round',
        }));

        // 动触点小半圆（面向左侧静触点）体现刀片在闭合时与静触点接触。
        this._bladeGroup.add(new Konva.Arc({
            x: -(this._rightX - this._leftX), y: 0,
            innerRadius: 0, outerRadius: this._contactR,
            angle: 180, rotation: 180,
            fill: '#e8c86a', stroke: '#e03030', strokeWidth: 1.5,
        }));

        this._dynamicGroup.add(this._bladeGroup);
    }

    _bindInteraction() {
        // 为按钮帽区域绑定鼠标交互，实现按压与松开时的视觉反馈。
        const hitArea = new Konva.Rect({
            x: this._cx - 20, y: this.height - 35,
            width: 40, height: 30,
            fill: 'transparent',
        });
        hitArea.on('mousedown touchstart', (e) => {
            // 按下时改变角度并更新推杆状态，模拟按钮闭合。
            e.cancelBubble = true;
            this._isPressed = true;
            this._curBladeAng = -5;
            this._bladeGroup.rotation(-5);
            this._updatePlunger();
        });
        hitArea.on('mouseup touchend', (e) => {
            // 抬起时恢复角度，刀片回到打开位置。
            e.cancelBubble = true;
            this._isPressed = false;
            this._curBladeAng = -22.5;
            this._bladeGroup.rotation(-22.5);
            this._updatePlunger();
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => {
            // 鼠标离开区域时恢复默认指针，并在已按下状态下自动复位。
            document.body.style.cursor = 'default';
            if (this._isPressed) {
                this._isPressed = false;
                this._curBladeAng = -22.5;
                this._bladeGroup.rotation(-22.5);
                this._updatePlunger();
            }
        });
        this._interactGroup.add(hitArea);
    }

    _updatePlunger() {
        // 根据当前刀片角度计算推杆末端位置，以维持机械动作连贯。
        const cy = this._pivotY;
        const rad = this._curBladeAng * Math.PI / 180;
        const armLen = this._rightX - this._leftX;
        const tipY = cy - armLen * Math.sin(rad);
        this._plungerLine.points([this._cx, this.height - 25, this._cx, tipY-5]);
    }

    getValue() {
        // 返回当前按钮的接通状态，按下或手动闭合时返回非常小的导通电阻值；否则返回很大的断开值。
        return (this._isPressed || this._manualPressed) ? 0.01 : 10000000;
    }

    /** 模拟闭合/断开（右键菜单用）：等效于按下/松开按钮 */
    setManualOverride(v) {
        // 手动覆盖按钮状态，用于右键菜单中的强制闭合/断开演示。
        this._manualPressed = !!v;
        const ang = this._manualPressed ? -5 : -22.5;
        this._curBladeAng = ang;
        this._bladeGroup.rotation(ang);
        this._updatePlunger();
        this.markDirty();
        this._refreshIfDirty();
    }

    getManualOverride() {
        // 返回当前是否处于手动闭合状态。
        return !!this._manualPressed;
    }

    showContextMenu(evt) {
        // 构建右键菜单，支持旋转、参数设置和模拟闭合/断开等操作。
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
            background: white; border: 1px solid #ccc; border-radius: 4px;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
            padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;`;

        const createItem = (label, onClick) => {
            // 动态创建菜单项，并为点击行为绑定对应处理函数。
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
        };

        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));

        const isClosed = this.getManualOverride();
        menu.appendChild(createItem(isClosed ? '模拟断开' : '模拟闭合', () => {
            this.setManualOverride(!isClosed);
        }));

        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    tick(dt) {}

    /** 返回可点击部件中心坐标（供工作流 find/箭头指示定位）：'btn' = 按钮帽中心 */
    getClickablePartCenter(partId) {
        // 工作流在提示点击目标时，需要知道对应部件的中心坐标。
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const rel = (partId === 'btn' || !partId)
            ? { x: this._cx, y: this.height - 20 }    // 按钮帽
            : { x: this.width / 2, y: this.height / 2 };
        return { x: gx + rel.x, y: gy + rel.y };
    }

    getConfigFields() {
        // 配置面板只允许编辑按钮位号，便于在控制逻辑中区分不同启动按钮。
        return [{ label: '位号', key: 'label', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        // 当配置更新时，更新标签并重建静态/动态图形以反映新配置。
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
