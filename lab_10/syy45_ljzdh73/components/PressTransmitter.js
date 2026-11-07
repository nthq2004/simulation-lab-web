import { BaseComponent } from './BaseComponent.js';

/**
 * 压力变送器（两线制）组件
 *
 * 功能概述：
 * - 模拟 2-wire 压力变送器：接收变送器输出电流（4-20mA），映射为压力值并在 LCD 上显示；
 * - 支持零点/满度旋钮微调（`zeroAdj` / `spanAdj`），支持开路/断电故障时的黑屏或故障显示；
 * - 提供 `update(state)`：`state` 含 `powered` 与 `transCurrent`（mA）；
 * - 可配置量程（`min` / `max`）与显示单位（`MPa` / `Bar`）。
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`
 * （`_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`），最后 `addPort`。
 * 动态节点（LCD 背景/数值/单位、旋钮转子）放 `_dynamicGroup` / `_interactGroup`，in-place 更新，
 * 不再逐帧刷新静态位图缓存。
 */
export class PressTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 动态尺寸设置：最小宽140, 最小高180
        this.width  = Math.max(140, Math.min(config.width  || 140, 200));
        this.height = Math.max(180, Math.min(config.height || 180, 240));

        this.type    = 'transmitter_2wire';
        this.special = 'press';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, min: this.min, max: this.max, unit: this.unit };

        this.addPort(70, 168, 'i', 'pipe', 'in');
        this.addPort(140, 18, 'p', 'wire', 'p');
        this.addPort(140, 48, 'n', 'wire');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this._centerX = this.width / 2;
        this._lcdCY   = 85;
        this._lcdR    = 38;
        this.knobConfigs = [
            { id: 'zero', x: 50, label: 'Z' },
            { id: 'span', x: this.width - 50, label: 'S' },
        ];
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.min  = config.min !== undefined ? parseFloat(config.min) : 0;
        this.max  = config.max !== undefined ? parseFloat(config.max) : 1;
        this.unit = config.unit || 'MPa';

        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        this.press   = 0;
        this.isBreak = false;   // 默认电路闭合（正常）

        this.knobs = {};
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const centerX = this._centerX;

        // 1. 顶部 T 型横梁 (Junction Box)
        const labelText = new Konva.Text({
            x: 22, y: -10, width: this.w, text: '压力变送器', fontSize: 18,
            align: 'center', fill: '#2c3e50', fontStyle: 'bold',
        });
        const tBar = new Konva.Rect({
            x: 20, y: 10, width: this.width - 40, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5,
        });
        const leftCap  = new Konva.Rect({ x: 0, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });
        const rightCap = new Konva.Rect({ x: this.width - 20, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });

        // 2. 圆形表头与防滑旋盖（深绿色）
        const outerCover = new Konva.Circle({ x: centerX, y: this._lcdCY, radius: 55, fill: '#2f3542', stroke: '#1e272e', strokeWidth: 1 });
        const greenCover = new Konva.Circle({ x: centerX, y: this._lcdCY, radius: 52, fill: '#27ae60', stroke: '#1e8449', strokeWidth: 4 });

        // 3. 底部金属丝扣接口
        const stem = new Konva.Rect({ x: centerX - 10, y: 140, width: 20, height: 30, fill: '#ced6e0', stroke: '#747d8c' });

        this._staticGroup.add(tBar, leftCap, rightCap, outerCover, greenCover, stem, labelText);

        // 4. 旋钮底座（静态），转子在 _createDynamicNodes 建立
        this.knobConfigs.forEach(k => {
            this._staticGroup.add(new Konva.Circle({ x: k.x, y: 32, radius: 11, fill: '#dfe4ea', stroke: '#747d8c' }));
        });

        // 5. 可识别部件（供工作流箭头/圈选定位）
        this.addClickablePart('lcd', centerX - this._lcdR, this._lcdCY - this._lcdR, this._lcdR * 2, this._lcdR * 2);
        this.addClickablePart('i', 60, 158, 20, 20);
        this.addClickablePart('p', 130, 8, 20, 20);
        this.addClickablePart('n', 130, 38, 20, 20);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const centerX = this._centerX;

        // LCD 背景（黑屏）
        this.lcdBg = new Konva.Circle({ x: centerX, y: this._lcdCY, radius: this._lcdR, fill: '#000' });
        this._dynamicGroup.add(this.lcdBg);

        this.lcdText = new Konva.Text({
            x: centerX - 30, y: this._lcdCY - 10, width: 60, text: '',
            fontSize: 18, fontFamily: 'Digital-7, monospace', fill: '#00ff00',
            align: 'center', fontStyle: 'bold',
        });
        this._dynamicGroup.add(this.lcdText);

        this.unitText = new Konva.Text({
            x: centerX - 15, y: this._lcdCY + 12, text: 'MPa',
            fontSize: 10, fill: '#1a1a1a', opacity: 0,
        });
        this._dynamicGroup.add(this.unitText);

        // 旋钮转子（动态，可拖动）
        this.knobConfigs.forEach(k => {
            const rotor = new Konva.Group({ x: k.x, y: 32 });
            rotor.add(new Konva.Circle({ radius: 8, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#2f3542', strokeWidth: 3 }));
            this.knobs[k.id] = rotor;
            this._interactGroup.add(rotor);
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        // 旋钮拖动：上下移动改变旋转角度，映射为零点/满度校正值
        Object.keys(this.knobs).forEach(id => {
            const k = this.knobConfigs.find(c => c.id === id);
            const rotor = this.knobs[id];
            if (!rotor) return;
            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.8;
                    else this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.5;
                    this._refreshIfDirty();
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    window.removeEventListener('touchend', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup', onUp);
                window.addEventListener('touchend', onUp);
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    update(state) {
        // state: { powered: bool, transCurrent: number }
        // 开路或断电 → 黑屏
        if (this.isBreak || !state || !state.powered) {
            this.lcdText.text('');
            this.unitText.text('');
            this.lcdBg.fill('#000');
            this.unitText.opacity(0);
            this._refreshIfDirty();
            return;
        }

        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;

        // 4-20mA 映射到量程：4mA → min, 20mA → max
        const press = ((inCurrent - 4) / 16) * this.max + this.min;
        const pressDisp = this.unit === 'MPa' ? press : press * 10;
        const pricision = this.unit === 'MPa' ? 3 : 2;

        let displayText = '';
        let isFault = false;

        if (inCurrent < 3.8) {
            displayText = 'LLLL';
            isFault = true;
        } else if (inCurrent > 20.5) {
            displayText = 'HHHH';
            isFault = true;
        } else {
            displayText = pressDisp.toFixed(pricision);
        }

        if (isFault) {
            this.lcdText.fill('#ff4757');
            this.lcdText.text(displayText);
            this.unitText.opacity(0);
            this.lcdBg.fill('#2f3542');
        } else {
            this.lcdText.fill('#1a1a1a');
            this.lcdText.text(displayText);
            this.unitText.opacity(1);
            this.unitText.text(this.unit);
            this.lcdBg.fill('#2ed573');
        }

        this._refreshIfDirty();
    }

    tick() {
        this.update({
            powered: (this._lastVDiff || 0) > 10,
            transCurrent: (this.physCurrent || 0) * 1000,
        });
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '测量最小值 (Min)', key: 'min', type: 'number' },
            { label: '测量最大值 (Max)', key: 'max', type: 'number' },
            {
                label: '显示单位', key: 'unit', type: 'select',
                options: [
                    { label: 'MPa', value: 'MPa' },
                    { label: 'Bar', value: 'Bar' },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id   = newConfig.id || this.id;
        this.min  = parseFloat(newConfig.min);
        this.max  = parseFloat(newConfig.max);
        this.unit = newConfig.unit || 'MPa';
        this.config = newConfig;
        this.update({ powered: (this._lastVDiff || 0) > 10, transCurrent: (this.physCurrent || 0) * 1000 });
    }

    destroy() {
        super.destroy?.();
    }
}
