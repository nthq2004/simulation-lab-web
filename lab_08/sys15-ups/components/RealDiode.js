import { BaseComponent } from './BaseComponent.js';

export class RealDiode extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'diode';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward || 0.68;
        this.rOn = 0.5;
        this.rOff = 1e8;
        // 测试标志：为真时隐藏管压降标签，供考核/测试使用
        this.testFlag = config.testFlag || false;

        this.config = { id: this.id, vForward: this.vForward, testFlag: this.testFlag };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const colors = {
            body: '#1a1a1a',
            ring: '#e8e8e8',
            lead: '#aeb6bf',
            marking: '#ccc',
        };

        const leadL = new Konva.Line({
            points: [-40, 0, -25, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [25, 0, 40, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });

        this.body = new Konva.Rect({
            x: -25, y: -9,
            width: 50, height: 18,
            fill: colors.body,
            cornerRadius: 3,
            stroke: '#333',
            strokeWidth: 1
        });

        this.cathodeRing = new Konva.Rect({
            x: 17, y: -9,
            width: 8, height: 18,
            fill: colors.ring,
            cornerRadius: [0, 3, 3, 0],
            opacity: 0.9
        });

        const cathodeMark = new Konva.Text({
            x: 17, y: -10,
            text: '|',
            fontSize: 18,
            fontStyle: 'bold',
            fill: '#1a1a1a',
            width: 8,
            align: 'center',
            listening: false
        });

        this.vfLabel = new Konva.Text({
            x: -25, y: -30, width: 50,
            text: this.vForward.toFixed(3) + 'V',
            fontSize: 10,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        this._staticGroup.add(leadL, leadR, this.body, this.cathodeRing, cathodeMark, this.vfLabel);

        this._testLabels = [this.vfLabel];
        this._applyTestFlag();
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateVfLabel();
            if (this.sys && this.sys.eventBus) {
                this.sys.eventBus.emit('diode:vfChanged', { id: this.id, vForward: cfg.vForward });
            }
        }
        if (cfg.testFlag !== undefined) this.testFlag = !!cfg.testFlag;
        this._applyTestFlag();
        this.config = cfg;
        this._refreshCache();
    }

    _applyTestFlag() {
        const nodes = this._testLabels || [];
        nodes.forEach(n => { if (n) n.visible(!this.testFlag); });
    }

    setTestFlag(v) {
        v = !!v;
        if (this.testFlag === v) return;
        this.testFlag = v;
        this._applyTestFlag();
        this._refreshCache();
    }

    _updateVfLabel() {
        if (this.vfLabel) {
            this.vfLabel.text(this.vForward.toFixed(3) + 'V');
            this.markDirty();
        }
    }

    destroy() {
        super.destroy?.();
    }
}
