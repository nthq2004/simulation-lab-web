import { BaseComponent } from './BaseComponent.js';

/**
 * ElecMeter — 数字功率计（Wattmeter）
 *
 * 通过求解器读取电压/电流瞬时值，滑窗计算 V/I 有效值、有功与功率因数并在 LCD 显示。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * LCD 行放 `_dynamicGroup`，in-place 更新。
 */
export class ElecMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'wattmeter';
        this.special = 'WATTMETER';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        const portDefs = [
            { name: 'ip', pol: 'p' }, { name: 'in', pol: 'n' },
            { name: 'up', pol: 'p' }, { name: 'un', pol: 'n' },
        ];
        portDefs.forEach((pd, i) => this.addPort(this._pxs[i], this.height - 2, pd.name, 'wire', pd.pol));

        this.config = { id: this.id };
    }

    _recalcGeometry(config) {
        this.width = config.width || 190;
        this.height = config.height || 150;
        this._pxs = [0.11, 0.37, 0.63, 0.89].map(f => Math.round(this.width * f));
        this._lineH = 30;
    }

    _initParameters(_config) {
        this.currentIdx = undefined;
        this.physCurrent = 0;
        this._bufLen = 200;
        this._bufV2 = new Float64Array(this._bufLen);
        this._bufI2 = new Float64Array(this._bufLen);
        this._bufP  = new Float64Array(this._bufLen);
        this._bufIdx = 0;
        this._bufCount = 0;
        this._sumV2 = 0;
        this._sumI2 = 0;
        this._sumP = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const W = this.width, H = this.height;

        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: H - 4,
            fill: '#0a1a0a', stroke: '#333', strokeWidth: 2, cornerRadius: 4,
        }));

        const portLabels = ['I+', 'I-', 'U+', 'U-'];
        const ty = H - 2;
        this._pxs.forEach((cx, i) => {
            this._staticGroup.add(new Konva.Circle({ x: cx, y: ty, radius: 6, fill: '#4a5', stroke: '#283', strokeWidth: 1 }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 15, y: ty - 20, text: portLabels[i], fontSize: 12,
                fontFamily: 'Arial', fontStyle: 'bold', fill: '#4a5', width: 30, align: 'center',
            }));
        });

        this.addClickablePart('lcd', 0, 0, W, this._lineH * 4 + 8);
    }

    _createDynamicNodes() {
        const W = this.width;
        const fs = 24;
        this._lcdLines = [];
        ['V', 'I', 'P', 'PF'].forEach((label, i) => {
            const txt = new Konva.Text({
                x: 10, y: 4 + i * this._lineH, width: W - 20,
                text: `${label}=---`, fontSize: fs, fontFamily: 'Courier New',
                fontStyle: 'bold', fill: '#00ff00', align: 'left',
            });
            this._dynamicGroup.add(txt);
            this._lcdLines.push(txt);
        });
    }

    _bindInteraction() { /* 功率计为显示仪表，无需交互 */ }

    _formatVal(val, decimals) {
        if (val === undefined || val === null || isNaN(val)) return '---';
        if (Math.abs(val) < 0.001) return '0.00';
        return val.toFixed(decimals);
    }

    tick() {
        if (!this.sys || !this.sys.voltageSolver) return;

        const solver = this.sys.voltageSolver;
        const ptc = solver.portToCluster;

        const hasV = ptc.has(`${this.id}_wire_up`) && ptc.has(`${this.id}_wire_un`);
        const hasI = ptc.has(`${this.id}_wire_ip`) && ptc.has(`${this.id}_wire_in`);

        let vInstant = 0, iInstant = 0;
        if (hasV) vInstant = solver.getPD(`${this.id}_wire_up`, `${this.id}_wire_un`) || 0;
        if (hasI && this.currentIdx !== undefined) iInstant = this.physCurrent || 0;

        const pInstant = vInstant * iInstant;
        const v2 = vInstant * vInstant;
        const i2 = iInstant * iInstant;
        this._sumV2 -= this._bufV2[this._bufIdx]; this._bufV2[this._bufIdx] = v2; this._sumV2 += v2;
        this._sumI2 -= this._bufI2[this._bufIdx]; this._bufI2[this._bufIdx] = i2; this._sumI2 += i2;
        this._sumP -= this._bufP[this._bufIdx]; this._bufP[this._bufIdx] = pInstant; this._sumP += pInstant;
        this._bufIdx = (this._bufIdx + 1) % this._bufLen;
        if (this._bufCount < this._bufLen) this._bufCount++;

        const cnt = this._bufCount;
        const vRms = hasV ? Math.sqrt(this._sumV2 / cnt) : 0;
        const iRms = hasI ? Math.sqrt(this._sumI2 / cnt) : 0;
        const pAvg = cnt > 0 ? (this._sumP / cnt) : 0;
        const pf = (vRms > 0.01 && iRms > 0.01) ? Math.abs(pAvg / (vRms * iRms)) : 0;

        this.V_rms = vRms;
        this.I_rms = iRms;
        this.P_avg = pAvg;
        this.PF = pf;

        const lines = this._lcdLines;
        if (lines) {
            lines[0].text(hasV ? `V=${this._formatVal(vRms, 1)}V` : 'V=---');
            lines[1].text(hasI ? `I=${this._formatVal(iRms, 4)}A` : 'I=---');
            lines[2].text(hasV && hasI ? `P=${this._formatVal(pAvg, 1)}W` : 'P=---');
            lines[3].text(hasV && hasI ? `PF=${this._formatVal(pf, 3)}` : 'PF=---');
        }

        this._refreshIfDirty();
    }

    getConfigFields() {
        return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        this.config = { ...this.config, id: this.id };
    }

    destroy() {
        super.destroy?.();
    }
}
