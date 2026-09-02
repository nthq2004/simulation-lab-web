import { BaseComponent } from './BaseComponent.js';

export class DigitalFrequencyMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this._initGroups();

        this.width  = config.width  || 200;
        this.height = config.height || 72;

        this.type    = 'INSTRUMENT';
        this.special = 'FREQ_METER_DIGITAL';

        this._rangeMin  = config.rangeMin  !== undefined ? config.rangeMin  : 10;
        this._rangeMax  = config.rangeMax  !== undefined ? config.rangeMax  : 10000;
        this._frequency = config.frequency !== undefined ? config.frequency : 50;
        this._unit      = config.unit      || 'Hz';

        // 多周期过零检测
        this._lastV = 0;
        this._crossTimes = [];

        this._drawStatic();
        this._createDynamic();

        this.addPort(8, this.height / 2, 'L', 'wire', 'p');
        this.addPort(this.width - 8, this.height / 2, 'N', 'wire', 'n');
    }

    _drawStatic() {
        this._staticGroup.add(new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#f5f5f5', stroke: '#c0c0c0',
            strokeWidth: 1.5, cornerRadius: 4,
        }));

        this._staticGroup.add(new Konva.Rect({
            x: 12, y: 10,
            width: this.width - 24, height: this.height - 20,
            fill: '#111', cornerRadius: 3,
        }));

        this._staticGroup.add(new Konva.Text({
            x: this.width - 50, y: this.height - 18,
            text: this._unit,
            fontSize: 11, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#666',
        }));
    }

    _createDynamic() {
        this._text = new Konva.Text({
            x: 12, y: 8,
            width: this.width - 24, height: this.height - 16,
            text: '----',
            fontSize: 26,
            fontFamily: 'Courier New',
            fontStyle: 'bold',
            fill: '#00ff00',
            align: 'center',
            verticalAlign: 'middle',
        });
        this._dynamicGroup.add(this._text);
    }

    tick(dt) {
        const sv = this.sys?.voltageSolver;
        if (sv) {
            const cL = sv.portToCluster.get(`${this.id}_wire_L`);
            const cN = sv.portToCluster.get(`${this.id}_wire_N`);
            if (cL !== undefined && cN !== undefined) {
                const vL = sv.nodeVoltages.get(cL) || 0;
                const vN = sv.nodeVoltages.get(cN) || 0;
                const vDiff = vL - vN;

                // 正方向过零检测
                if (this._lastV <= 0 && vDiff > 0) {
                    this._crossTimes.push(sv.currentTime);

                    // 每 5 次过零（4 个完整周期）做一次滤波平均
                    if (this._crossTimes.length >= 5) {
                        const periods = [];
                        for (let i = 1; i < 5; i++) {
                            periods.push(this._crossTimes[i] - this._crossTimes[i - 1]);
                        }
                        // 去掉一个最大、一个最小
                        let minIdx = 0, maxIdx = 0;
                        for (let i = 1; i < 4; i++) {
                            if (periods[i] < periods[minIdx]) minIdx = i;
                            if (periods[i] > periods[maxIdx]) maxIdx = i;
                        }
                        let sum = 0, count = 0;
                        for (let i = 0; i < 4; i++) {
                            if (i !== minIdx && i !== maxIdx) {
                                sum += periods[i];
                                count++;
                            }
                        }
                        if (count > 0 && sum / count > 0.001) {
                            const avgPeriod = sum / count;
                            const f = Math.max(this._rangeMin, Math.min(this._rangeMax, 1 / avgPeriod));
                            this._frequency = f;
                            const disp = f >= 100 ? f.toFixed(0) : f.toFixed(1);
                            this._text.text(disp + ' ' + this._unit);
                            this.markDirty();
                        }
                        // 保留最后一个过零时刻作为下一轮起点
                        this._crossTimes = [this._crossTimes[4]];
                    }
                }
                this._lastV = vDiff;
            }
        }
        this._refreshIfDirty();
    }

    update(state) {
        const f = parseFloat(state);
        if (!isNaN(f)) {
            this._frequency = Math.max(this._rangeMin, Math.min(this._rangeMax, f));
            const disp = this._frequency >= 100 ? this._frequency.toFixed(0) : this._frequency.toFixed(1);
            this._text.text(disp + ' ' + this._unit);
            this.markDirty();
        }
    }

    getConfigFields() {
        return [
            { label: '量程下限 (Hz)', key: 'rangeMin',   type: 'number' },
            { label: '量程上限 (Hz)', key: 'rangeMax',   type: 'number' },
            { label: '当前频率 (Hz)', key: 'frequency',  type: 'number' },
            { label: '单位',          key: 'unit',       type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.rangeMin  !== undefined) this._rangeMin  = parseFloat(cfg.rangeMin);
        if (cfg.rangeMax  !== undefined) this._rangeMax  = parseFloat(cfg.rangeMax);
        if (cfg.unit      !== undefined) this._unit      = cfg.unit;
        if (cfg.frequency !== undefined) this.update(cfg.frequency);

        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStatic();
        this._createDynamic();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
