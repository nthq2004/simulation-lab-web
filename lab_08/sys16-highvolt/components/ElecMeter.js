/**
 * ElecMeter 电能表/功率表组件。
 *
 * 作用：这是一个用于测量交流电压、电流、有功功率和功率因数的数字仪表组件，通常用于教学仿真中的电力系统监测场景。
 * 它通过读取系统端口两端的电压差和对应的电流值，计算有效值与平均功率，并在显示屏中实时更新四项参数：V、I、P、PF。
 *
 * 设计特点：
 * 1. 采用端口对方式检测电压和电流，适配四端口接线；
 * 2. 使用滑动窗口缓存历史样本，计算 RMS 与平均功率，减少瞬时噪声；
 * 3. 通过功率因数推算输入负载特性，便于教学展示功率质量；
 * 4. 屏幕内用四行文本展示关键参数，方便观察和调试。
 */
import { BaseComponent } from './BaseComponent.js';

export class ElecMeter extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化通用组件能力和系统引用。
        super(config, sys);

        // 组件类型标记用于在系统里区分为功率计类设备，并启用静态缓存。
        this.type = 'wattmeter';
        this.special = 'WATTMETER';
        this.cache = 'fixed';

        // 组件创建时先初始化图层分组，然后设置尺寸和状态参数。
        this._initGroups();

        this.width = config.width || 190;
        this.height = config.height || 150;

        // 初始化参数并计算四个端口的横坐标，然后创建图形与端口定义。
        this._initParameters(config);
        this._pxs = [0.11, 0.37, 0.63, 0.89].map(f => Math.round(this.width * f));
        this._init();

        const portDefs = [
            { name: 'ip', pol: 'p' }, { name: 'in', pol: 'n' },
            { name: 'up', pol: 'p' }, { name: 'un', pol: 'n' },
        ];
        portDefs.forEach((pd, i) => this.addPort(this._pxs[i], this.height - 2, pd.name, 'wire', pd.pol));
    }

    _initParameters(config) {
        // 初始化采样缓存和当前状态，以便后续按滑动窗口计算 RMS 和平均功率。
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
        // 构造表头外壳和四行 LCD 参数显示，界面采用黑底绿色字的仪表风格。
        const W = this.width, H = this.height;

        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: H - 4,
            fill: '#0a1a0a',
            stroke: '#333', strokeWidth: 2,
            cornerRadius: 4,
        }));

        const portLabels = ['I+', 'I-', 'U+', 'U-'];
        const ty = H - 2;
        this._pxs.forEach((cx, i) => {
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: ty, radius: 6,
                fill: '#4a5', stroke: '#283', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 15, y: ty - 20,
                text:                 portLabels[i], fontSize: 12,
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#4a5', width: 30, align: 'center',
            }));
        });

        const lineH = 30;
        const fs = 24;
        this._lcdLines = [];
        ['V', 'I', 'P', 'PF'].forEach((label, i) => {
            const ty2 = 4 + i * lineH;
            const txt = new Konva.Text({
                x: 10, y: ty2, width: W - 20,
                text: `${label}=---`,
                fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#00ff00', align: 'left',
            });
            this._staticGroup.add(txt);
            this._lcdLines.push(txt);
        });
    }

    _formatVal(val, decimals) {
        // 统一格式化显示值：无效数据显示为 ---，极小值压到 0.00，避免显示无意义的小数。
        if (val === undefined || val === null || isNaN(val)) return '---';
        if (Math.abs(val) < 0.001) return '0.00';
        return val.toFixed(decimals);
    }

    tick(dt) {
        // 仿真循环中先读取端口电压和电流，再根据 RMS 和平均功率更新显示。
        if (!this.sys || !this.sys.voltageSolver) return;

        const solver = this.sys.voltageSolver;
        const ptc = solver.portToCluster;

        const hasV = ptc.has(`${this.id}_wire_up`) && ptc.has(`${this.id}_wire_un`);
        const hasI = ptc.has(`${this.id}_wire_ip`) && ptc.has(`${this.id}_wire_in`);

        let vInstant = 0, iInstant = 0;

        if (hasV) {
            // 电压读取通过端口对的电压差计算，得到瞬时 U 值。
            vInstant = solver.getPD(`${this.id}_wire_up`, `${this.id}_wire_un`) || 0;
        }
        if (hasI && this.currentIdx !== undefined) {
            // 电流如果已经关联到当前相位值，就采用实际电流，否则按 0 处理。
            iInstant = this.physCurrent || 0;
        }

        // 瞬时功率、平方项和缓存 buffer 都会更新，用于后续计算有效值与平均功率。
        const pInstant = vInstant * iInstant;
        const v2 = vInstant * vInstant;
        const i2 = iInstant * iInstant;
        this._sumV2 -= this._bufV2[this._bufIdx];
        this._bufV2[this._bufIdx] = v2;
        this._sumV2 += v2;
        this._sumI2 -= this._bufI2[this._bufIdx];
        this._bufI2[this._bufIdx] = i2;
        this._sumI2 += i2;
        this._sumP -= this._bufP[this._bufIdx];
        this._bufP[this._bufIdx] = pInstant;
        this._sumP += pInstant;
        this._bufIdx = (this._bufIdx + 1) % this._bufLen;
        if (this._bufCount < this._bufLen) this._bufCount++;

        // 计算有效值和平均功率，并用功率因数反映负载特性，最终写入四行 LCD 文本。
        const cnt = this._bufCount;
        const vRms = hasV ? Math.sqrt(this._sumV2 / cnt) : 0;
        const iRms = hasI ? Math.sqrt(this._sumI2 / cnt) : 0;
        const pAvg = cnt > 0 ? (this._sumP / cnt) : 0;
        const pf = (vRms > 0.01 && iRms > 0.01) ? Math.abs(pAvg / (vRms * iRms)) : 0;

        const lines = this._lcdLines;
        if (lines) {
            lines[0].text(hasV ? `V=${this._formatVal(vRms, 1)}V` : 'V=---');
            lines[1].text(hasI ? `I=${this._formatVal(iRms, 4)}A` : 'I=---');
            lines[2].text(hasV && hasI ? `P=${this._formatVal(pAvg, 1)}W` : 'P=---');
            lines[3].text(hasV && hasI ? `PF=${this._formatVal(pf, 3)}` : 'PF=---');
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        // 调用父类的销毁逻辑以保持组件生命周期的一致性。
        super.destroy?.();
    }
}
