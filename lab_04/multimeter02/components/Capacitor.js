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
        this.vLast = 0;       // 上一状态的节点电压差（V）
        this.physCurrent = 0; // 计算得到的物理电流（A）

        // 极板电容通常对称，引脚设在左右两侧或上下
        // 这里默认水平排列：左 (l) / 右 (r)
        this.addPort(-40, 0, 'l', 'wire');
        this.addPort(40, 0, 'r', 'wire');

        // 构建视觉元素
        this.initVisuals();
        // 注意：下面一行为赋值表达式（原始代码采用 = 而非 ==/===），保留原行为
        if (config && (config.direction = 'vertical')) this.group.rotate(90);
    }

    initVisuals() {
        // 构建视觉元素：左右引线、两个极板与文本标签
        const theme = { stroke: '#2c3e50', strokeWidth: 3, labelColor: '#34495e' };

        // 左侧引线（从端口到极板）
        const leadL = new Konva.Line({ points: [-40, 0, -6, 0], stroke: theme.stroke, strokeWidth: theme.strokeWidth });
        // 右侧引线
        const leadR = new Konva.Line({ points: [6, 0, 40, 0], stroke: theme.stroke, strokeWidth: theme.strokeWidth });
        // 左极板（竖线）
        const plateL = new Konva.Line({ points: [-6, -20, -6, 20], stroke: theme.stroke, strokeWidth: 4, lineCap: 'round' });
        // 右极板
        const plateR = new Konva.Line({ points: [6, -20, 6, 20], stroke: theme.stroke, strokeWidth: 4, lineCap: 'round' });

        // 电容数值标签（显示格式化过的容值，例如 '10.0 uF'）
        this.label = new Konva.Text({ x: -40, y: -35, text: this.formatCapacitance(this.capacitance), fontSize: 12, fontStyle: 'bold', fill: theme.labelColor, align: 'center', width: 80 });

        // 将元素添加至静态层（不频繁重绘）
        this._staticGroup.add(leadL, leadR, plateL, plateR, this.label);

        // 命中区域（Hit Area）：提高点击交互体验
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
        const gEq = this.capacitance / deltaTime;
        const iEq = gEq * this.vLast;
        return { gEq, iEq };
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
        ];
    }
    onConfigUpdate(newConfig) {
        // 同步配置到内部状态：注意输入的电容值期望为 μF（微法）
        this.config = newConfig;
        this.id = newConfig.id;
        this.capacitance = parseFloat(newConfig.capacitance) * 1e-6;
        if (this.label) this.label.text(this.formatCapacitance(this.capacitance));
        this._refreshCache();
    }


    destroy() {
        super.destroy?.();
    }
}
