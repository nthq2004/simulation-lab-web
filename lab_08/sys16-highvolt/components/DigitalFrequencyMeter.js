/**
 * DigitalFrequencyMeter 数字式频率表组件。
 *
 * 作用：这是一个用于测量输入交流信号频率的数字仪表，用于仿真平台中的电工教学场景。
 * 它通过检测两端电压的过零点来估算周期，再反推出信号频率，并将结果显示在表盘内。
 * 这种实现适合作为频率测量元件，能够在控制系统和电路求解器之间提供实时频率读数。
 *
 * 设计要点：
 * 1. 使用两端电压差值进行过零检测；
 * 2. 采集多个周期的过零时刻并做去极值滤波；
 * 3. 通过平均周期计算频率，并更新数字显示；
 * 4. 支持配置量程、单位和值更新，适合仪表参数维护。
 */
import { BaseComponent } from './BaseComponent.js';

export class DigitalFrequencyMeter extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，完成基础组件和系统对象的初始化。
        super(config, sys);

        // 初始化 Konva 图层组，便于后续静态图形和动态文本分开管理。
        this._initGroups();

        // 设置仪表的宽高，默认值为 200×72，允许配置覆盖。
        this.width  = config.width  || 200;
        this.height = config.height || 72;

        // 组件类型声明用于区分仪表类元件，并标记其特殊用途。
        this.type    = 'INSTRUMENT';
        this.special = 'FREQ_METER_DIGITAL';

        // 读取量程范围、初始频率和显示单位，避免配置项缺失时直接出错。
        this._rangeMin  = config.rangeMin  !== undefined ? config.rangeMin  : 10;
        this._rangeMax  = config.rangeMax  !== undefined ? config.rangeMax  : 10000;
        this._frequency = config.frequency !== undefined ? config.frequency : 50;
        this._unit      = config.unit      || 'Hz';

        // 多周期过零检测需要保存上一时刻的电压差和最近的过零时刻列表。
        this._lastV = 0;
        this._crossTimes = [];

        // 依次绘制静态背景和动态数值显示区域。
        this._drawStatic();
        this._createDynamic();

        // 输入端和输出端分别表示 L（火线）和 N（中性线），用于电路网络接线。
        this.addPort(8, this.height / 2, 'L', 'wire', 'p');
        this.addPort(this.width - 8, this.height / 2, 'N', 'wire', 'n');
    }

    _drawStatic() {
        // 静态背景由外框、显示屏和单位标签组成，定义仪表的基础视觉结构。
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
        // 动态文本节点负责显示实时计算出的频率值，颜色和字号用于模拟数字仪表效果。
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
        // 每次仿真步进都会检查系统的电压解算结果，更新表计读数。
        const sv = this.sys?.voltageSolver;
        if (sv) {
            // 通过端口名从求解器中找到对应的节点簇，获取两端电压值。
            const cL = sv.portToCluster.get(`${this.id}_wire_L`);
            const cN = sv.portToCluster.get(`${this.id}_wire_N`);
            if (cL !== undefined && cN !== undefined) {
                const vL = sv.nodeVoltages.get(cL) || 0;
                const vN = sv.nodeVoltages.get(cN) || 0;
                const vDiff = vL - vN;

                // 正方向过零检测：当上一时刻电压不大于 0 且当前电压大于 0，说明完成一次正向过零。
                if (this._lastV <= 0 && vDiff > 0) {
                    this._crossTimes.push(sv.currentTime);

                    // 每 5 次过零（约 4 个完整周期）做一次滤波平均，降低抖动。
                    if (this._crossTimes.length >= 5) {
                        const periods = [];
                        for (let i = 1; i < 5; i++) {
                            periods.push(this._crossTimes[i] - this._crossTimes[i - 1]);
                        }
                        // 去掉一个最大值和一个最小值，避免极端噪声影响判断。
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
                        // 保留最后一个过零时刻作为下一轮起点，持续跟踪后续周期变化。
                        this._crossTimes = [this._crossTimes[4]];
                    }
                }
                this._lastV = vDiff;
            }
        }
        this._refreshIfDirty();
    }

    update(state) {
        // 外部调用 update() 时将状态解析为数字，并直接刷新表头显示。
        const f = parseFloat(state);
        if (!isNaN(f)) {
            this._frequency = Math.max(this._rangeMin, Math.min(this._rangeMax, f));
            const disp = this._frequency >= 100 ? this._frequency.toFixed(0) : this._frequency.toFixed(1);
            this._text.text(disp + ' ' + this._unit);
            this.markDirty();
        }
    }

    getConfigFields() {
        // 返回配置面板中允许编辑的字段，供界面动态生成对应输入控件。
        return [
            { label: '量程下限 (Hz)', key: 'rangeMin',   type: 'number' },
            { label: '量程上限 (Hz)', key: 'rangeMax',   type: 'number' },
            { label: '当前频率 (Hz)', key: 'frequency',  type: 'number' },
            { label: '单位',          key: 'unit',       type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        // 接收配置更新时逐项修改状态，然后重建动态和静态图形，保持界面同步。
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
        // 释放时调用父类的销毁逻辑，确保组件生命周期保持统一。
        super.destroy?.();
    }
}
