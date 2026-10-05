import { BaseComponent } from './BaseComponent.js';

export class IGBT extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'igbt';

        this.vth = 4.5;
        this.vOn = 1.8;
        this.rOn = 0.1;
        this.rOnDisp = 50;
        this.rOff = 1e6;
        // C-E 间固有 PN 结（体二极管）正向压降，供万用表测量；0 表示无体二极管
        this.vBodyDiode = config.vBodyDiode !== undefined ? Number(config.vBodyDiode) : 0.6;
        this._igbtStampMode = 'off';
        this._isOn = false;
        this._faultCEShort = false;
        this._faultCEOpen = false;

        this.config = { id: this.id, vth: this.vth, vOn: this.vOn, rOn: this.rOn, rOff: this.rOff, vBodyDiode: this.vBodyDiode };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        // 标准 IEEE/ANSI 符号：集电极在上、发射极在下、栅极在左
        this.addPort(18, -52, 'c', 'wire', 'p');
        this.addPort(18, 52, 'e', 'wire');
        this.addPort(-30, 13, 'g', 'wire', 'g');
    }

    // IEEE/ANSI 绝缘栅双极型晶体管（N 沟道）图形符号：
    // 左侧栅极板（与导电沟道平行、留有绝缘间隙），中间竖直沟道条，
    // 集电极自沟道上部 45° 引出至右上，发射极自沟道下部 45° 引出至右下并带外向箭头
    initVisuals() {
        const s = '#000';

        const channelBar = new Konva.Line({ points: [0, -24, 0, 24], stroke: s, strokeWidth: 2.5, lineCap: 'round' });
        const gatePlate = new Konva.Line({ points: [-7, -12, -7, 13], stroke: s, strokeWidth: 2.5, lineCap: 'round' });
        const gateLead = new Konva.Line({ points: [-7, 13, -30, 13], stroke: s, strokeWidth: 2 });

        const collectorLead = new Konva.Line({ points: [0, -15, 18, -33, 18, -52], stroke: s, strokeWidth: 2 });
        const emitterLead = new Konva.Line({ points: [0, 15, 18, 33, 18, 52], stroke: s, strokeWidth: 2 });

        const emitterArrow = new Konva.Arrow({
            points: [5, 20, 16, 31],
            pointerLength: 9, pointerWidth: 7,
            fill: s, stroke: s, strokeWidth: 2,
        });

        this._staticGroup.add(channelBar, gatePlate, gateLead, collectorLead, emitterLead, emitterArrow);

        const lbl = { fontSize: 11, fill: '#333', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: 23, y: -62, text: 'C', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 23, y: 50, text: 'E', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: -36, y: 8, text: 'G', ...lbl }));

        this._valueLabel = new Konva.Text({
            x: -20, y: 60, text: `${this.rOn}Ω`, fontSize: 9,
            fill: '#555', fontFamily: 'Arial', align: 'center', width: 40,
        });
        this._staticGroup.add(this._valueLabel);
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通压降 Vce(on) (V)', key: 'vOn', type: 'number' },
            { label: '导通电阻 Ron (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
            { label: '体二极管压降 (V)', key: 'vBodyDiode', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.vBodyDiode !== undefined) this.vBodyDiode = Number(cfg.vBodyDiode);
        this.config = { ...this.config, ...cfg, vBodyDiode: this.vBodyDiode };
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
