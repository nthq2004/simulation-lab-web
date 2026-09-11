import { BaseComponent } from './BaseComponent.js';

/**
 * 电容器组件（Capacitor）
 *
 * 说明：该组件在画布上渲染一个简单的双极板电容符号，并提供用于电路求解器的
 * 基本接口：`getCompanionModel(deltaTime)`（用于向时域求解器提供等效导纳与电流源），
 * `updateState(vL, vR)` 与 `calculatePhysicalCurrent(vL, vR, deltaTime)` 用于在仿真步中更新内部状态。
 *
 * 单位与约定：
 *  - 内部 `this.capacitance` 以法拉（F）为单位存储（构造时若传入 `config.capacitance`，视为 μF 并乘以 1e-6）
 *  - `vL`, `vR` 参数表示端子电压（伏特），`physCurrent` 单位为安培（A）
 *
 * 端口布局：默认水平排列，左端口 `l`（左侧），右端口 `r`（右侧）。可通过 config.direction 设置方向（'vertical'）。
 */
export class Capacitor extends BaseComponent {
    // 构造器：初始化绘图分组、参数与端口
    constructor(config, sys) {
        super(config, sys);

        this.type = 'capacitor';
        this.cache = 'fixed';
        this._initGroups();

        // 注意：构造时预期 config.capacitance 为 μF（微法），因此乘以 1e-6 转为 F
        // 若 config.capacitance 未提供，使用默认 10 μF
        this.capacitance = (config && config.capacitance) ? parseFloat(config.capacitance) * 1e-6 : 10e-6;
        this.subtype = (config && config.subtype) || 'standard';
        this.vLast = 0;
        this.physCurrent = 0;
        this.leakResistance = (config && config.leak) || 1e9;

        // 极板电容通常对称，引脚设在左右两侧或上下
        // 这里默认水平排列：左 (l) / 右 (r)
        this.addPort(-40, 0, 'l', 'wire');
        this.addPort(40, 0, 'r', 'wire');

        // 构建视觉元素
        this.initVisuals();
        // 根据 direction 方向旋转：水平布局→垂直放置需要 +90°
        // 仅当 config.rotation 未设置（首次创建）时才自动旋转；
        // 撤销恢复时 config.rotation 已有值，不再二次旋转
        if (config && (config.direction = 'vertical')) {
            if (config.rotation === undefined || config.rotation === 0) {
                this.group.rotate(90);
            }
        }
    }

    initVisuals() {
        const theme = { stroke: '#2c3e50', strokeWidth: 3, labelColor: '#34495e' };

        const leadL = new Konva.Line({ points: [-40, 0, -6, 0], stroke: theme.stroke, strokeWidth: theme.strokeWidth });
        const leadR = new Konva.Line({ points: [16, 0, 40, 0], stroke: theme.stroke, strokeWidth: theme.strokeWidth });
        const plateL = new Konva.Line({ points: [-6, -20, -6, 20], stroke: theme.stroke, strokeWidth: 4, lineCap: 'round' });

        this._staticGroup.add(leadL, leadR, plateL);

        if (this.subtype === 'el') {
            const plateR = new Konva.Path({
                data: 'M 16,-18 Q 0,0 16,18',
                stroke: theme.stroke,
                strokeWidth: 4,
                lineCap: 'round',
            });
            const plus = new Konva.Text({
                x: -14, y: -24,
                text: '+',
                fontSize: 14,
                fontStyle: 'bold',
                fill: '#e74c3c',
            });
            this._staticGroup.add(plateR, plus);
        } else {
            const plateR = new Konva.Line({ points: [16, -20, 16, 20], stroke: theme.stroke, strokeWidth: 4, lineCap: 'round' });
            this._staticGroup.add(plateR);
        }

        this.label = new Konva.Text({ x: -40, y: -35, text: this.formatCapacitance(this.capacitance), fontSize: 12, fontStyle: 'bold', fill: theme.labelColor, align: 'center', width: 80 });
        this._staticGroup.add(this.label);

        const hitArea = new Konva.Rect({ x: -40, y: -25, width: 80, height: 50, fill: 'transparent' });
        this._staticGroup.add(hitArea);
    }

    // 保持你原有的 formatCapacitance 逻辑
    formatCapacitance(farads) {
        if (farads >= 1) return farads.toFixed(1) + ' F';
        if (farads >= 1e-3) return (farads * 1e3).toFixed(1) + ' mF';
        if (farads >= 1e-6) return (farads * 1e6).toFixed(1) + ' uF';
        if (farads >= 1e-9) return (farads * 1e9).toFixed(1) + ' nF';
        return (farads * 1e12).toFixed(1) + ' pF';
    }

    // 返回与时域求解器使用的等效导纳（gEq）和电流源项（iEq）
    // deltaTime 单位为秒，等效导纳近似为 C / dt
    getCompanionModel(deltaTime) {
        const gCap = this.capacitance / deltaTime;
        const gLeak = this.leakResistance > 0 ? (1 / this.leakResistance) : 0;
        return { gEq: gCap + gLeak, iEq: gCap * this.vLast };
    }

    updateState(vL, vR) {
        // 在时间步更新后记录电容两端电压差，供下一步的等效电流计算使用
        this.vLast = vL - vR;
    }

    calculatePhysicalCurrent(vL, vR, deltaTime) {
        if (deltaTime <= 0) return 0;
        // 计算物理电流的近似值：I = C * dV/dt ≈ (C/dt) * (V_now - V_prev)
        const gEq = this.capacitance / deltaTime;
        this.physCurrent = gEq * ((vL - vR) - this.vLast);
    }
    getConfigFields() {
        return [
            { label: '名称', key: 'id', type: 'text' },
            { label: '电容值', key: 'capacitance', type: 'number' },
            { label: '类型', key: 'subtype', type: 'select', options: [
                { value: 'standard', label: '普通电容' },
                { value: 'el', label: '电解电容' },
            ]},
            { label: '漏电阻 (Ω)', key: 'leak', type: 'number' },
        ];
    }
    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id = newConfig.id;
        this.capacitance = parseFloat(newConfig.capacitance) * 1e-6;
        this.leakResistance = parseFloat(newConfig.leak) || 0;
        const subtypeChanged = this.subtype !== newConfig.subtype;
        if (newConfig.subtype !== undefined) this.subtype = newConfig.subtype;

        if (subtypeChanged) {
            this._staticGroup.destroyChildren();
            this.initVisuals();
        }
        if (this.label) this.label.text(this.formatCapacitance(this.capacitance));
        this._refreshCache();
    }


    destroy() {
        super.destroy?.();
    }
}
