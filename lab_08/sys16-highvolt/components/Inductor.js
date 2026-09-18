/**
 * Inductor 电感器组件。
 *
 * 作用：这是一个用于教学仿真的线性电感元件，负责表示电感器的基础符号、端口连接以及电感值显示。
 * 它通过电感量参数和电压-电流关系模拟储能特性，适合在电路原理教学中展示电感对电流变化的延迟和储能作用。
 *
 * 设计特点：
 * 1. 仅实现电感器的基本图形和参数管理，适合基础电路示意；
 * 2. 使用端口 l 和 r 表示左右两端，便于串联或并联接入电路；
 * 3. 通过格式化显示电感值，方便在图面上直接看到元件参数；
 * 4. 保留了简单的物理状态更新接口，支持和求解器/事件总线协作。
 */
import { BaseComponent } from './BaseComponent.js';

export class Inductor extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，建立基本的组件状态和系统引用。
        super(config, sys);

        // 固定缓存用于静态图形复用，减少重复绘制开销。
        this.cache = 'fixed';
        // 初始化 Konva 图层容器，以供外观和动态状态挂载。
        this._initGroups();
        // 组件类型用于仿真系统识别和器件分类。
        this.type = 'inductor';
        // 电感值决定了构建的电磁状态模型和显示单位。
        this.inductance = config.inductance || 100;
        this.iLast = 0;
        this.physCurrent = 0;

        // 配置对象保存标识和电感值，方便编辑器和状态同步。
        this.config = { id: this.id, inductance: this.inductance };

        // 初始化电感符号和标签，确保实例化后即可显示在电路图中。
        this.initVisuals();

        // 左右端口分别代表电感的两端连接点，便于电路接线和电压计算。
        this.addPort(-45, 0, 'l', 'wire', 'p');
        this.addPort(45, 0, 'r', 'wire');
    }

    initVisuals() {
        // 左右导线将电感器连接到电路的两端，形成标准的两端元件外形。
        const leadL = new Konva.Line({
            points: [-45, 0, -30, 0],
            stroke: '#bdc3c7',
            strokeWidth: 2,
            lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [30, 0, 45, 0],
            stroke: '#bdc3c7',
            strokeWidth: 2,
            lineCap: 'round'
        });

        // 电感线圈采用连续半圆弧的形式，体现电感器的典型图形特征。
        const coilPath = new Konva.Path({
            data: 'M -30 5 A 7.5 7.5 0 0 1 -15 5 A 7.5 7.5 0 0 1 0 5 A 7.5 7.5 0 0 1 15 5 A 7.5 7.5 0 0 1 30 5',
            stroke: '#2c3e50',
            strokeWidth: 2.5,
            lineCap: 'round',
            fill: null
        });

        // 中间横线表示电感芯体，增强器件的辨识度和图形稳定性。
        const coreTop = new Konva.Line({
            points: [-27, -7, 27, -7],
            stroke: '#2c3e50',
            strokeWidth: 3,
            lineCap: 'round'
        });

        // 标签显示当前电感值，使用可读的工程单位格式展示 H、mH、μH 等。
        this.label = new Konva.Text({
            x: -30,
            y: 8,
            text: this.formatInductance(this.inductance),
            fontSize: 13,
            fontStyle: 'bold',
            fontFamily: 'Calibri',
            fill: '#2c3e50',
            align: 'center',
            width: 60
        });

        // 所有静态部件加入静态图层，保证元件外观固定且容易复用。
        this._staticGroup.add(leadL, leadR, coilPath, coreTop, this.label);
    }

    formatInductance(henrys) {
        // 对不同数量级的电感值做单位转换，便于读取和演示。
        if (henrys >= 1) return henrys.toFixed(1) + 'H';
        if (henrys >= 1e-3) return (henrys * 1e3).toFixed(1) + 'mH';
        if (henrys >= 1e-6) return (henrys * 1e6).toFixed(1) + 'μH';
        if (henrys >= 1e-9) return (henrys * 1e9).toFixed(1) + 'nH';
        return henrys.toExponential(1) + 'H';
    }

    getCompanionModel(dt) {
        // 这是电感的一阶伴随模型：电流更新依赖 dt / L 和上一步电流状态。
        const gEq = dt / this.inductance;
        const iEq = this.iLast;
        return { gEq, iEq };
    }

    updateState() {
        // 更新上一步电流，用于下一时刻反推当前积分状态。
        this.iLast = this.physCurrent;
    }

    calculatePhysicalCurrent(vL, vR, dt) {
        // 电感的电流变化受两端电压差和时间步影响，满足 i = i_last + (dt / L) * v。
        const vDiff = vL - vR;
        const gEq = dt / this.inductance;
        this.physCurrent = gEq * vDiff + this.iLast;
    }

    getConfigFields() {
        // 配置面板只公开器件标识和电感值，符合电感器的基本建模需求。
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '电感量 (H)', key: 'inductance', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        // 更新后同步电感值、界面显示和事件总线通知，以保证状态一致。
        this.inductance = parseFloat(newConfig.inductance);
        this.label.text(this.formatInductance(this.inductance));
        this._refreshCache();
        if (this.sys && this.sys.eventBus) {
            this.sys.eventBus.emit('inductor:configUpdate', { id: this.id, inductance: this.inductance });
        }
    }

    destroy() {
        super.destroy?.();
    }
}
