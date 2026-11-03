import { BaseComponent } from './BaseComponent.js';

/**
 * BridgeRectifier — 单相桥式整流器（KZ）
 *
 * ═══ 电路模型 ═══════════════════════════════════════════════
 *  四个理想二极管（带正向压降 vForward 与导通电阻 rOn）组成全桥：
 *      D1: AC1 → DC+      D2: AC2 → DC+
 *      D3: DC− → AC1      D4: DC− → AC2
 *  端口：ac1 / ac2（交流输入）、pp（直流 +）、nn（直流 −）。
 *  注入方式见 DeviceStamps.stampBridgeRectifiers（与 stampDiodes 同一二极管模型）。
 *
 * ═══ 外观 ═══════════════════════════════════════════════════
 *  菱形框（四边各一个二极管符号），中央标注 KZ，四角为交流/直流端子。
 */
export class BridgeRectifier extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(90,  config.width  || 120);
        this.height = Math.max(90,  config.height || 120);

        this.type  = 'bridge_rectifier';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, label: this.label,
            vForward: this.vForward, rOn: this.rOn, rOff: this.rOff,
        };

        const t = this._tp;
        this.addPort(t.ac1.x, t.ac1.y, 'ac1', 'wire');
        this.addPort(t.ac2.x, t.ac2.y, 'ac2', 'wire');
        this.addPort(t.pp.x,  t.pp.y,  'pp',  'wire', 'p');
        this.addPort(t.nn.x,  t.nn.y,  'nn',  'wire');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const cx = W / 2, cy = H / 2;
        this._cx = cx; this._cy = cy;

        const d = Math.min(W, H) * 0.34;         // 菱形半对角
        this._d = d;

        this._tp = {
            ac1: { x: 6,      y: cy },           // 交流 1（左）
            ac2: { x: W - 6,  y: cy },           // 交流 2（右）
            pp:  { x: cx,     y: 6 },            // 直流 +
            nn:  { x: cx,     y: H - 6 },        // 直流 −
        };
    }

    _initParameters(config) {
        this.label    = config.label || 'KZ';
        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        this.rOn      = config.rOn !== undefined ? config.rOn : 1;
        this.rOff     = config.rOff !== undefined ? config.rOff : 1e9;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const cx = this._cx, cy = this._cy, d = this._d;

        // 四角端子 → 菱形顶点引线
        const top = { x: cx, y: cy - d };
        const bot = { x: cx, y: cy + d };
        const lef = { x: cx - d, y: cy };
        const rig = { x: cx + d, y: cy };

        this._staticGroup.add(new Konva.Line({ points: [6, cy, lef.x, lef.y], stroke: '#555', strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [rig.x, rig.y, this.width - 6, cy], stroke: '#555', strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [cx, 6, top.x, top.y], stroke: '#555', strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [cx, this.height - 6, bot.x, bot.y], stroke: '#555', strokeWidth: 2 }));

        // 菱形框
        this._staticGroup.add(new Konva.Line({
            points: [top.x, top.y, rig.x, rig.y, bot.x, bot.y, lef.x, lef.y],
            closed: true, stroke: '#2c3e50', strokeWidth: 2, fill: '#f4f6f8',
        }));

        // 四个二极管符号（左侧两个左转 90°，右侧两个右转 90°）
        this._drawDiode(cx - d * 0.5, cy - d * 0.5, 45 - 90);
        this._drawDiode(cx - d * 0.5, cy + d * 0.5, -45 - 90);
        this._drawDiode(cx + d * 0.5, cy - d * 0.5, 135 + 90);
        this._drawDiode(cx + d * 0.5, cy + d * 0.5, -135 + 90);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 40, y: cy - 10, width: 80,
            text: this.label, fontSize: 14, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center',
        }));
    }

    /** 单个二极管符号（三角形 + 横杠），angle 为朝向（度） */
    _drawDiode(x, y, angle) {
        const s = Math.max(6, this._d * 0.22);
        const g = new Konva.Group({ x, y, rotation: angle });
        g.add(new Konva.Line({
            points: [-s, -s * 0.7, -s, s * 0.7, s, 0],
            closed: true, fill: '#34495e', stroke: '#2c3e50', strokeWidth: 1,
        }));
        g.add(new Konva.Line({
            points: [s, -s * 0.7, s, s * 0.7], stroke: '#2c3e50', strokeWidth: 2,
        }));
        this._staticGroup.add(g);
    }

    _createDynamicNodes() {
        // 直流输出极性标注
        this._dynamicGroup.add(new Konva.Text({
            x: this._cx - 34, y: 2, width: 68, text: '+', fontSize: 14,
            fontStyle: 'bold', fill: '#c0392b', align: 'right',
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: this._cx - 34, y: this.height - 20, width: 68, text: '−', fontSize: 16,
            fontStyle: 'bold', fill: '#2c3e50', align: 'right',
        }));
    }

    tick() { /* 整流桥为纯无源器件，无需每帧更新 */ }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '名称',            key: 'label',    type: 'text'   },
            { label: '正向压降 (V)',     key: 'vForward', type: 'number' },
            { label: '导通电阻 (Ω)',     key: 'rOn',      type: 'number' },
            { label: '截止电阻 (Ω)',     key: 'rOff',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label    = cfg.label;
        if (cfg.vForward !== undefined) this.vForward = parseFloat(cfg.vForward);
        if (cfg.rOn      !== undefined) this.rOn      = parseFloat(cfg.rOn);
        if (cfg.rOff     !== undefined) this.rOff     = parseFloat(cfg.rOff);
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();
        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
            background: white; border: 1px solid #ccc; border-radius: 4px;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
            padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;`;
        const item = document.createElement('div');
        item.innerText = '参数设置';
        item.style = 'padding: 8px 15px; cursor: pointer;';
        item.onmouseenter = () => item.style.background = '#f0f0f0';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = () => { this.showConfigDialog(); menu.remove(); };
        menu.appendChild(item);
        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    destroy() { super.destroy?.(); }
}
