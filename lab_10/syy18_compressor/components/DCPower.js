import { BaseComponent } from './BaseComponent.js';

/**
 * 直流电源组件（DCPower）
 *
 * 面板式 DC 电源：电源开关、可调电压旋钮与 LCD 显示；输出直流电压（getValue），
 * 带输出内阻 rOn 参与电路仿真。`isBreak` 用于模拟开路。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * 无阴影；LCD 文本放 `_dynamicGroup`，按键/旋钮放 `_interactGroup`，in-place 更新。
 */
export class DCPower extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'source';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, voltage: this.voltage, isOn: this.isOn };

        this.addPort(45 * this.scale, 135 * this.scale, 'n', 'wire');
        this.addPort(100 * this.scale, 135 * this.scale, 'p', 'wire', 'p');

        // 按初始 isOn / voltage 刷新 LCD 与电源键显示（此前构造后从未调用，
        // 导致配置为 on 时界面仍显示空/OFF）
        this.update();
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.scale = 1.2;
        this.width = 145 * this.scale;
        this.height = 135 * this.scale;
        this._ctrlY = 78 * this.scale;
        this._knobX = this.width - 50 * this.scale;
        this._knobY = this._ctrlY + 10 * this.scale;
    }

    _initParameters(config) {
        this.isOn = config.isOn !== undefined ? config.isOn : false;
        this.isBreak = false;
        this.voltage = (config && config.voltage) ? config.voltage : 24;
        this.maxVoltage = 24;
        this.rOn = 0.1;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        // 1. 机箱
        this._staticGroup.add(new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#ecf0f1', stroke: '#2c3e50',
            strokeWidth: 3 * this.scale, cornerRadius: 5 * this.scale,
        }));

        // 2. 铭牌
        this._staticGroup.add(new Konva.Text({ x: 10 * this.scale, y: 5 * this.scale, text: 'DC 24V', fontSize: 12 * this.scale, fontStyle: 'bold' }));
        this._staticGroup.add(new Konva.Text({ x: this.width - 60 * this.scale, y: 5 * this.scale, text: '江苏航院', fontSize: 11 * this.scale }));

        // 3. LCD 底屏（数值在动态组）
        this._staticGroup.add(new Konva.Rect({
            x: 10 * this.scale, y: 18 * this.scale,
            width: this.width - 20 * this.scale, height: 30 * this.scale,
            fill: '#000', cornerRadius: 3 * this.scale,
        }));

        // 4. 旋钮刻度
        const scaleValues = [0, 4, 8, 12, 16, 20, 24];
        scaleValues.forEach(v => {
            const angle = (v / 24) * 300 - 150;
            const rad = (angle - 90) * Math.PI / 180;
            const r = 32 * this.scale;
            this._staticGroup.add(new Konva.Text({
                x: this._knobX + r * Math.cos(rad) - 10 * this.scale,
                y: this._knobY + r * Math.sin(rad) - 5 * this.scale,
                text: v.toString(), fontSize: 10 * this.scale, fontStyle: 'bold',
                width: 20 * this.scale, align: 'center', fill: '#0a1314',
            }));
        });

        // 5. 可识别部件
        this.addClickablePart('power', 12 * this.scale, this._ctrlY, 33 * this.scale, 20 * this.scale);
        this.addClickablePart('knob', this._knobX - 26 * this.scale, this._knobY - 26 * this.scale, 52 * this.scale, 52 * this.scale);
        this.addClickablePart('lcd', 10 * this.scale, 18 * this.scale, this.width - 20 * this.scale, 30 * this.scale);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // LCD 数值
        this.voltageText = new Konva.Text({
            x: 10 * this.scale, y: 22 * this.scale,
            width: this.width - 20 * this.scale, text: '',
            fontSize: 22 * this.scale, fontFamily: 'monospace',
            fill: '#00ff00', align: 'center',
        });
        this._dynamicGroup.add(this.voltageText);

        // 电源键
        this.powerBtnGroup = new Konva.Group({ x: 12 * this.scale, y: this._ctrlY });
        this.powerBtnBase = new Konva.Rect({
            width: 33 * this.scale, height: 20 * this.scale,
            fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1 * this.scale,
            cornerRadius: 2 * this.scale,
        });
        this.powerBtnGroup.add(this.powerBtnBase);
        this.powerBtnGroup.add(new Konva.Text({
            x: 0, y: 25 * this.scale, text: '电源键',
            fontSize: 12 * this.scale, fontStyle: 'bold', fill: '#34495e',
        }));
        this._interactGroup.add(this.powerBtnGroup);

        // 电压旋钮（交互）
        this.knobGroup = new Konva.Group({ x: this._knobX, y: this._knobY });
        this.knobCircle = new Konva.Circle({ radius: 26 * this.scale, fill: '#e3e8e9', stroke: '#34495e', cursor: 'hand' });
        this.knobPointer = new Konva.Line({
            points: [0, 0, 0, -24 * this.scale], stroke: '#e74c3c',
            strokeWidth: 2 * this.scale, lineCap: 'round', rotation: 135,
        });
        this.knobGroup.add(this.knobCircle, this.knobPointer);
        this._interactGroup.add(this.knobGroup);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.powerBtnGroup.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });
        this.powerBtnGroup.on('dblclick', (e) => { e.cancelBubble = true; });

        this.knobCircle.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.voltage;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.voltage = Math.max(0, Math.min(24, startV + (startY - cy) * 0.1));
                this.update();
            };
            const onUp = () => {
                this.update();
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
        this.knobCircle.on('dblclick', (e) => { e.cancelBubble = true; });
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    _updateBtnStyle() {
        if (this.isOn) {
            this.powerBtnBase.setAttrs({ x: 1 * this.scale, y: 1 * this.scale, fill: '#95a5a6' });
        } else {
            this.powerBtnBase.setAttrs({ x: 0, y: 0, fill: '#bdc3c7' });
        }
    }

    getValue() {
        return this.isOn && !this.isBreak ? this.voltage : 0;
    }

    update() {
        // 关机/开路时内阻置极大，防止电容反向放电
        this.rOn = (this.isOn && !this.isBreak) ? 0.1 : 1e9;

        this._updateBtnStyle();
        this.knobPointer.rotation((this.voltage / 24) * 300 - 150);
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);

        if (!this.isOn) {
            this.voltageText.text('OFF');
            this.voltageText.fill('#333');
        } else {
            this.voltageText.text(this.voltage.toFixed(1) + ' V');
            this.voltageText.fill('#00ff00');
        }
        this.config = { ...this.config, voltage: this.voltage, isOn: this.isOn };
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '输出电压 V', key: 'voltage', type: 'number' },
            {
                label: '电源开关', key: 'isOn', type: 'select',
                options: [
                    { label: '关闭', value: false },
                    { label: '开启', value: true },
                ],
            },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.voltage !== undefined) {
            this.voltage = Math.max(0, Math.min(this.maxVoltage, parseFloat(cfg.voltage) || 0));
        }
        if (cfg.isOn !== undefined) this.isOn = cfg.isOn === true || cfg.isOn === 'true';
        this.config = { ...this.config, id: this.id, voltage: this.voltage, isOn: this.isOn };
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}
