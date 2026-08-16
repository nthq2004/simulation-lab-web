import { BaseComponent } from './BaseComponent.js';

export class NpnTempSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'bjt';
        this.subType = 'NPN';
        this.cache = 'fixed';

        this._initGroups();
        // 温度传感参数
        this.areaRatio = config.areaRatio || 1;
        this.vbe0 = config.vbe0 || 0.65;
        this.vbeTC = -0.002;
        this.beta = config.beta || 200;
        this.vceSat = 0.2;

        this.config = {
            id: this.id,
            areaRatio: this.areaRatio,
            vbe0: this.vbe0,
            beta: this.beta
        };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        const s = this.scale;
        this.addPort(-40 * s, 0, 'b', 'wire', 'b');
        this.addPort(20 * s, -40 * s, 'c', 'wire', 'c');
        this.addPort(20 * s, 40 * s, 'e', 'wire', 'e');
    }

    initVisuals() {
        this.group.destroyChildren();
        const s = this.scale;
        const stroke = '#000000';
        const sw = 2 * s;

        // 圆圈
        this._staticGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 30 * s,
            stroke, strokeWidth: sw, fill: '#ffffff'
        }));

        // 基极竖线
        this._staticGroup.add(new Konva.Line({
            points: [-10 * s, -15 * s, -10 * s, 15 * s],
            stroke, strokeWidth: 3 * s
        }));

        // 引线
        this._staticGroup.add(new Konva.Line({ points: [-40 * s, 0, -10 * s, 0], stroke, strokeWidth: sw }));
        this._staticGroup.add(new Konva.Line({ points: [-10 * s, -8 * s, 20 * s, -25 * s, 20 * s, -40 * s], stroke, strokeWidth: sw }));
        this._staticGroup.add(new Konva.Line({ points: [-10 * s, 8 * s, 20 * s, 25 * s, 20 * s, 40 * s], stroke, strokeWidth: sw }));

        // NPN 箭头
        this._staticGroup.add(new Konva.Arrow({
            points: [2 * s, 16 * s, 15 * s, 23 * s],
            pointerLength: 8 * s, pointerWidth: 6 * s,
            fill: stroke, stroke: stroke, strokeWidth: 1 * s
        }));

        // 面积比标签
        this.areaLabel = new Konva.Text({
            x: 25 * s, y: -10 * s,
            text: `×${this.areaRatio}`,
            fontSize: 11 * s, fill: '#e74c3c', fontStyle: 'bold'
        });
        this._staticGroup.add(this.areaLabel);
    }

    getVbeOn() {
        if (!this.sys || this.sys.globalTemp === undefined) {
            return this.vbe0;
        }
        const T = this.sys.globalTemp;
        const Vt = 8.617e-5 * (273 + T);
        const areaCorrection = Vt * Math.log(this.areaRatio);
        return this.vbe0 + (T - 25) * this.vbeTC - areaCorrection;
    }

    getCompanionModel(vB, vC, vE) {
        const pol = 1;
        const beta = this.beta || 200;

        const vbe = (vB - vE) * pol;
        const vce = (vC - vE) * pol;

        const V_ON = this.getVbeOn();
        const G_ON = 0.01;
        const gBE = (vbe > V_ON && vbe > 0) ? G_ON : 1e-9;
        const iBE = (vbe > V_ON && vbe > 0) ? -V_ON * G_ON : 0;

        const saturationMultiplier = Math.tanh(Math.max(0, vce) / 0.2);
        const currentBeta = beta * saturationMultiplier;

        let gCE_sat = 0;
        if (vbe > V_ON) {
            gCE_sat = G_ON * (1 - saturationMultiplier);
        }
        if (vce < 0) gCE_sat += 100;

        return {
            internal: { gBE, iBE, beta: currentBeta, gCE_sat, pol, V_SAT: 0.2 }
        };
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '面积比', key: 'areaRatio', type: 'select', options: [
                { label: '1 (Q1)', value: 1 },
                { label: '8 (Q2)', value: 8 }
            ]},
            { label: 'Vbe0 @25°C (V)', key: 'vbe0', type: 'number' },
            { label: '放大倍数 Beta', key: 'beta', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id = newConfig.id;
        this.areaRatio = parseInt(newConfig.areaRatio) || 1;
        this.vbe0 = parseFloat(newConfig.vbe0) || 0.65;
        this.beta = parseInt(newConfig.beta) || 200;
        this.initVisuals();
        this.initPorts();
        this._refreshCache();
    }


    destroy() {
        super.destroy?.();
    }
}
