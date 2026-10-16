import { BaseComponent } from './BaseComponent.js';
import { MasterControllerDevice, MASTER_POSITIONS } from '../device/MasterControllerDevice.js';

/**
 * MasterController — 主令控制器（主设备：仿三维直推手柄，7 个档位）
 *
 * ═══ 外观 ═══════════════════════════════════════════════════
 *  竖直面板 + 中央导向滑槽，滑槽内是一个仿三维（顶面 + 右侧厚度面 + 正面
 *  渐变 + 高光 + 防滑纹）的直推手柄；滑槽右侧自上而下标注 7 个档位：
 *      上升3 / 上升2 / 上升1 / OFF / 下降1 / 下降2 / 下降3
 *  手柄随档位在滑槽内上下移动，当前档位以半透明高亮标出。
 *
 * ═══ 交互 ═══════════════════════════════════════════════════
 *  · 拖动手柄：沿滑槽上下移动，松手吸附到最近档位
 *  · 点击滑槽：在手柄上方 → 升一档；下方 → 降一档
 *  · 点击档位文字：直接跳到该档位
 *  · 右键菜单：升一档 / 降一档 / 回零位 / 参数设置
 *
 * ═══ 复合设备 ═══════════════════════════════════════════════
 *  与 LK1~LK7 附属开关共享 MasterControllerDevice（同 deviceid），
 *  手柄档位变化即驱动各 LK 开关按各自动作表通断。
 */
export class MasterController extends BaseComponent {
    static DeviceClass = MasterControllerDevice;

    constructor(config, sys) {
        super(config, sys);

        // 面板宽度：左侧空白已裁去 2/3（手柄保持与右边缘的相对距离不变）
        this.width  = Math.max(110, config.width  || 128);
        this.height = Math.max(400, config.height || 430);

        this.type  = 'master_controller';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            deviceid: this.deviceid,
            label: this.label,
            initPosition: this.initPosition,
        };
    }

    // ═══════════════════════════════════════════
    // 几何 / 参数 / 初始化
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        // 手柄中心距右边缘固定 85px：左侧空白裁剪时手柄与档位文字整体左移，
        // 右侧排布（滑槽 / 手柄 / 档位文字）保持不变。
        this._cx = Math.max(26, W - 85);

        this._yTop = 58;              // 上升3 档位中心
        this._yBot = H - 46;          // 下降3 档位中心
        this._step = (this._yBot - this._yTop) / 6;

        this._slotW    = 18;
        this._slotTop  = this._yTop - 22;
        this._slotBot  = this._yBot + 22;

        this._handleW = 40;
        this._handleH = 26;

        // 档位文字起始 x：让开手柄宽度，避免手柄压住文字
        this._labelX = this._cx + this._handleW / 2 + 10;
    }

    _initParameters(config) {
        this.label        = config.label || '主令控制器';
        this.deviceid     = config.deviceid || 'LK';
        this.initPosition = config.initPosition !== undefined ? config.initPosition : 3;
        this._pos         = Math.max(0, Math.min(6, Math.round(this.initPosition)));
        this._posApplied  = false;
        this._dragging    = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    /** 档位索引 → 手柄中心 y */
    _yFor(pos) { return this._yBot - pos * this._step; }

    // ═══════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawPanel();
        this._drawSlot();
        this._drawDetents();
    }

    _drawPanel() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: H - 4,
            cornerRadius: 8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#eef1f4', 0.5, '#e3e7ec', 1, '#d6dbe1'],
            stroke: '#9aa2ab', strokeWidth: 1.5,
        }));

        this._staticGroup.add(new Konva.Text({
            x: 4, y: 8, width: W - 8,
            text: this.label,
            fontSize: 14, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center',
        }));
    }

    _drawSlot() {
        const x = this._cx - this._slotW / 2;
        const h = this._slotBot - this._slotTop;

        // 滑槽（凹槽：深色渐变 + 左右内壁高光/暗线）
        this._staticGroup.add(new Konva.Rect({
            x, y: this._slotTop, width: this._slotW, height: h,
            cornerRadius: this._slotW / 2,
            fillLinearGradientStartPoint: { x, y: 0 },
            fillLinearGradientEndPoint:   { x: x + this._slotW, y: 0 },
            fillLinearGradientColorStops: [0, '#3a3f47', 0.5, '#565c66', 1, '#3a3f47'],
            stroke: '#2b2f35', strokeWidth: 1,
        }));
    }

    _drawDetents() {
        const x0 = this._cx - this._slotW / 2 - 5;
        const x1 = this._cx + this._slotW / 2 + 5;
        for (let i = 0; i < 7; i++) {
            const y = this._yFor(i);
            // 档位刻线
            this._staticGroup.add(new Konva.Line({
                points: [x0, y, x1, y],
                stroke: '#c2c8d0', strokeWidth: 1.5,
            }));
            // 档位名称
            const isOff = (i === 3);
            this._staticGroup.add(new Konva.Text({
                x: this._labelX, y: y - 9,
                text: MASTER_POSITIONS[i],
                fontSize: isOff ? 13 : 12,
                fontStyle: 'bold',
                fill: isOff ? '#c0392b' : '#3a4a5a',
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        // 当前档位高亮（半透明，覆盖在档位文字之上）
        this._activeRect = new Konva.Rect({
            x: this._labelX - 4,
            y: this._yFor(this._pos) - 11,
            width: 54, height: 22, cornerRadius: 4,
            fill: 'rgba(46,204,113,0.28)',
            stroke: 'rgba(30,160,80,0.7)', strokeWidth: 1,
            listening: false,
        });
        this._dynamicGroup.add(this._activeRect);

        this._createHandle();
    }

    _createHandle() {
        const hw = this._handleW, hh = this._handleH;
        const dx = 5, dy = 5;   // 斜等测厚度

        const g = new Konva.Group({
            x: this._cx,
            y: this._yFor(this._pos),
            draggable: true,
        });

        // 面板投影
        g.add(new Konva.Rect({
            x: -hw / 2 + 2, y: -hh / 2 + 3,
            width: hw, height: hh,
            fill: 'rgba(0,0,0,0.18)', cornerRadius: 5, listening: false,
        }));

        // 顶面（厚度）
        g.add(new Konva.Line({
            points: [
                -hw / 2, -hh / 2,
                 hw / 2, -hh / 2,
                 hw / 2 + dx, -hh / 2 - dy,
                -hw / 2 + dx, -hh / 2 - dy,
            ],
            closed: true, fill: '#1c4e8c', listening: false,
        }));

        // 右侧面（厚度）
        g.add(new Konva.Line({
            points: [
                 hw / 2, -hh / 2,
                 hw / 2 + dx, -hh / 2 - dy,
                 hw / 2 + dx,  hh / 2 - dy,
                 hw / 2,  hh / 2,
            ],
            closed: true, fill: '#123a6e', listening: false,
        }));

        // 正面主体
        g.add(new Konva.Rect({
            x: -hw / 2, y: -hh / 2, width: hw, height: hh,
            cornerRadius: 5,
            fillLinearGradientStartPoint: { x: 0, y: -hh / 2 },
            fillLinearGradientEndPoint:   { x: 0, y:  hh / 2 },
            fillLinearGradientColorStops: [
                0, '#55a4ee', 0.35, '#3382d2', 0.7, '#2266b2', 1, '#17508f',
            ],
            stroke: '#1040a0', strokeWidth: 1,
        }));

        // 正面顶部高光
        g.add(new Konva.Rect({
            x: -hw / 2 + 3, y: -hh / 2 + 2,
            width: hw - 6, height: hh * 0.26,
            fill: 'rgba(255,255,255,0.38)',
            cornerRadius: [3, 3, 0, 0], listening: false,
        }));

        // 防滑横纹
        for (let i = 0; i < 2; i++) {
            const ly = -hh * 0.10 + i * 5;
            g.add(new Konva.Line({
                points: [-hw * 0.30, ly, hw * 0.30, ly],
                stroke: 'rgba(0,0,0,0.22)', strokeWidth: 1.2, listening: false,
            }));
        }

        g.on('mouseenter', () => { document.body.style.cursor = 'grab'; });
        g.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        // 点击手柄（未拖动）：记录部件标识，供工作流 find 步骤校验
        g.on('click tap', (e) => {
            if (this._dragging) return;
            this.sys.lastClickedId = this.id;
            this.sys.lastClickedPartId = `${this.id}/handle`;
        });

        g.on('dragmove', () => {
            this._dragging = true;
            const y = Math.max(this._yTop, Math.min(this._yBot, g.y()));
            g.y(y);
            this._setPosition(Math.round((this._yBot - y) / this._step));
        });
        g.on('dragend', () => {
            this._dragging = false;
            this._setPosition(Math.round((this._yBot - g.y()) / this._step));
        });

        this._handleGroup = g;
        // 手柄置于最上层（在交互层之上），否则会被滑槽点击热区挡住而无法拖动
        this.group.add(g);
    }

    // ═══════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 滑槽区域：点击上方升一档、下方降一档
        const slotHit = new Konva.Rect({
            x: this._cx - this._slotW / 2 - 12,
            y: this._slotTop,
            width: this._slotW + 24,
            height: this._slotBot - this._slotTop,
            fill: 'transparent',
        });
        slotHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this.sys.lastClickedId = this.id;
            const p = slotHit.getRelativePointerPosition();
            if (!p) return;
            const hy = this._handleGroup.y();
            if (p.y < hy - 6) this.stepUp();
            else if (p.y > hy + 6) this.stepDown();
        });
        slotHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        slotHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(slotHit);

        // 档位文字：点击直接跳到该档位
        for (let i = 0; i < 7; i++) {
            const y = this._yFor(i);
            const partId = `pos${i}`;
            const hit = new Konva.Rect({
                x: this._labelX - 4, y: y - 12,
                width: 54, height: 24,
                fill: 'transparent',
            });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.sys.lastClickedId = this.id;
                this.sys.lastClickedPartId = `${this.id}/${partId}`;
                this._setPosition(i);
            });
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(hit);
        }

        // 防止手柄区域内拖动时整体组件被拖动
        this.group.off('dragstart');
        this.group.on('dragstart', (e) => {
            const stage = this.group.getStage();
            const pointer = stage && stage.getPointerPosition();
            if (!pointer) return;
            const tr = this.group.getTransform().copy(); tr.invert();
            const local = tr.point(pointer);
            const inSlot = local.x >= this._cx - this._slotW / 2 - 14
                        && local.x <= this._cx + this._slotW / 2 + 14
                        && local.y >= this._slotTop && local.y <= this._slotBot;
            if (inSlot) {
                e.cancelBubble = true;
                if (typeof this.group.stopDrag === 'function') this.group.stopDrag();
            }
        });
    }

    // ═══════════════════════════════════════════
    // 档位 API
    // ═══════════════════════════════════════════

    _setPosition(p) {
        const np = Math.max(0, Math.min(6, Math.round(p)));
        this._pos = np;
        if (this.deviceRef) this.deviceRef.setPosition(np);
    }

    getPosition() { return this._pos; }

    setPosition(p) { this._setPosition(p); }

    stepUp() { this._setPosition(this._pos + 1); }

    stepDown() { this._setPosition(this._pos - 1); }

    /** 回零位（OFF） */
    reset() { this._setPosition(3); }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        if (!this._posApplied && this.deviceRef) {
            this.deviceRef.setPosition(this.initPosition);
            this._pos = Math.max(0, Math.min(6, Math.round(this.initPosition)));
            this._posApplied = true;
        }

        const pos = this.deviceRef ? this.deviceRef.getPosition() : this._pos;
        if (pos !== this._pos) this._pos = pos;

        const targetY = this._yFor(this._pos);

        if (!this._dragging) {
            const cy = this._handleGroup.y();
            if (Math.abs(cy - targetY) < 0.4) {
                this._handleGroup.y(targetY);
            } else {
                this._handleGroup.y(cy + (targetY - cy) * 0.4);
            }
        }
        this._activeRect.y(targetY - 11);

        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 工作流定位支持
    // ═══════════════════════════════════════════

    getClickablePartCenter(partId) {
        let pt = { x: this._cx, y: this._handleGroup ? this._handleGroup.y() : this._yFor(this._pos) };
        if (partId === 'handle') pt = { x: this._cx, y: this._handleGroup.y() };
        else if (partId === 'up')    pt = { x: this._cx, y: this._yTop };
        else if (partId === 'down')  pt = { x: this._cx, y: this._yBot };
        else if (partId === 'off')   pt = { x: this._cx, y: this._yFor(3) };
        else if (/^pos[0-6]$/.test(partId || '')) {
            const i = parseInt(partId.slice(3), 10);
            pt = { x: this._labelX + 22, y: this._yFor(i) };
        }
        const abs = this.group.getAbsoluteTransform().point({ x: pt.x, y: pt.y });
        return { x: abs.x, y: abs.y };
    }

    // ═══════════════════════════════════════════
    // 配置 / 菜单
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '名称',              key: 'label',        type: 'text'   },
            { label: '设备 ID (deviceid)', key: 'deviceid',     type: 'text'   },
            { label: '初始档位 (0~6)',     key: 'initPosition', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.deviceid !== undefined) this.deviceid = cfg.deviceid;
        if (cfg.initPosition !== undefined) {
            this.initPosition = Math.max(0, Math.min(6, parseInt(cfg.initPosition) || 0));
            this._setPosition(this.initPosition);
        }
        this.config = { ...this.config, ...cfg };
        if (this._handleGroup) { this._handleGroup.destroy(); this._handleGroup = null; }
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache();
    }

    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 130px; font-family: sans-serif; font-size: 14px;
    `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
        };

        menu.appendChild(createItem('升一档', () => this.stepUp()));
        menu.appendChild(createItem('降一档', () => this.stepDown()));
        menu.appendChild(createItem('回零位 (OFF)', () => this.reset()));
        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));

        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    destroy() { super.destroy?.(); }
}
