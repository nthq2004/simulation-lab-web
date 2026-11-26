import { BaseComponent } from './BaseComponent.js';

/**
 * Inductor - 电感器组件（视图 + 串联 L/R 后向欧拉伴随模型）
 *
 * 说明：
 * - 本组件包含电感的视觉表现与用于隐式电路求解的伴随（companion）模型。
 * - 采用串联「电感 L + 线圈直流电阻 R」的后向欧拉（Backward Euler）离散：
 *     V = R·i + L·(i - iLast)/dt  =>  i = gEq·V + α·iLast
 *   其中 gEq = dt/(R·dt + L)，α = L/(R·dt + L)。R = 0 时退化为理想电感。
 * - 直流稳态时 V = R·i，因此万用表直流电阻档测得的就是线圈电阻 R。
 * - 流程：求解器在每步使用 `getCompanionModel(dt)` 获取等效元件，求解线性电路后
 *   通过 `calculatePhysicalCurrent(vL, vR, dt)` 更新 `physCurrent`，随后调用 `updateState()`
 *   将本步电流保存为下一步的 `iLast`。
 * - 可配置项：`inductance`（H，默认 100）、`coilR`（Ω，默认 0），均可在参数配置界面实时修改。
 */

export class RealInductor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 基础物理参数
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'inductor';
        this.inductance = config.inductance || 100; // 默认 100H
        // 线圈直流电阻（Ω）：默认 0，可配置；用于万用表直流电阻档测量
        this.coilR = config.coilR !== undefined ? Number(config.coilR) : 0;
        if (!Number.isFinite(this.coilR) || this.coilR < 0) this.coilR = 0;
        this.iLast = 0;       // 用于 MNA 伴随模型的历史电流 (t-dt)
        this.physCurrent = 0; // 求解器存储的实时物理电流
        // 测试标志：为真时隐藏感值标签，供考核/测试使用
        this.testFlag = config.testFlag || false;

        this.config = { id: this.id, inductance: this.inductance, coilR: this.coilR, testFlag: this.testFlag };

        this.initVisuals();

        // 引脚从下方引出，保持与电容类似的接线布局
        this.addPort(-20, 60, 'l', 'wire','p');
        this.addPort(20, 60, 'r', 'wire');
    }

    initVisuals() {
        const colors = {
            body: '#27ae60',      // 典型的色码电感绿色背景
            ring1: '#7e5109',     // 棕色环
            ring2: '#2c3e50',     // 黑色环
            ring3: '#f1c40f',     // 金色环（误差/倍率）
            lead: '#aeb6bf'       // 金属引脚
        };

        // 1. 绘制引脚线
        const leadL = new Konva.Line({
            points: [-20, 20, -20, 60],
            stroke: colors.lead,
            strokeWidth: 3,
            lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [20, 20, 20, 60],
            stroke: colors.lead,
            strokeWidth: 3,
            lineCap: 'round'
        });

        // 2. 电感主体 (略显圆润的哑铃形或椭圆)
        this.body = new Konva.Rect({
            x: -25, y: -15,
            width: 50, height: 35,
            fill: colors.body,
            cornerRadius: 12,
            stroke: '#1e8449',
            strokeWidth: 2
        });

        // 3. 装饰色环 (增加电感辨识度)
        const createRing = (x, color) => new Konva.Rect({
            x: x, y: -15,
            width: 6, height: 35,
            fill: color,
            opacity: 0.9
        });

        const rings = new Konva.Group();
        rings.add(createRing(-12, colors.ring1));
        rings.add(createRing(-2, colors.ring2));
        rings.add(createRing(8, colors.ring3));

        // 4. 感值标注
        this.label = new Konva.Text({
            x: -30, y: -30,
            text: this.formatInductance(this.inductance),
            fontSize: 11,
            fontStyle: 'bold',
            fill: '#2c3e50',
            align: 'center',
            width: 60
        });

        this._staticGroup.add(leadL, leadR, this.body, rings, this.label);

        this._testLabels = [this.label];
        this._applyTestFlag();
    }

    formatInductance(henrys) {
        if (henrys >= 1) return henrys.toFixed(1) + 'H';
        if (henrys >= 1e-3) return (henrys * 1e3).toFixed(1) + 'mH';
        if (henrys >= 1e-6) return (henrys * 1e6).toFixed(1) + 'uH';
        if (henrys >= 1e-9) return (henrys * 1e9).toFixed(1) + 'nH';
        return henrys.toExponential(1) + 'H';
    }

    /**
     * 后向欧拉伴随模型（串联 L + 线圈电阻 R）
     * v = R·i + L·(i - iLast)/dt  =>  i = gEq·v + α·iLast
     *   gEq = dt / (R·dt + L)，α = L / (R·dt + L)
     * R = 0 时退化为理想电感 i = (dt/L)·v + iLast
     */
    getCompanionModel(dt) {
        const L = this.inductance;
        const R = this.coilR || 0;
        const denom = R * dt + L;
        const gEq = denom > 0 ? dt / denom : 0;
        const alpha = denom > 0 ? L / denom : 0;
        const iEq = alpha * this.iLast;
        // 返回供电路求解器装配矩阵使用的等效参数
        return { gEq, iEq };
    }

    /**
     * 更新上一时间步的历史电流
     */
    updateState() {
        // 在每次时间步结束后调用，将本步计算得到的物理电流保存为下一步的初始电流
        this.iLast = this.physCurrent;
    }

    /**
     * 求解结束后获取当前物理电流
     * 对于电感，physCurrent 就是我们在 updateState 中累加的结果
     */
    calculatePhysicalCurrent(vL, vR, dt) {
        // 使用伴随模型计算本步的物理电流（含线圈电阻 R）
        // vL/vR 为电感左右端口电压（V），vDiff = vL - vR
        const vDiff = vL - vR;

        const L = this.inductance;
        const R = this.coilR || 0;
        const denom = R * dt + L;
        const gEq = denom > 0 ? dt / denom : 0;
        const alpha = denom > 0 ? L / denom : 0;

        // 根据离散方程计算下一步电流（A）并存入 physCurrent，供上层读取/展示
        this.physCurrent = gEq * vDiff + alpha * this.iLast;
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '电感量 (H)', key: 'inductance', type: 'number' },
            { label: '线圈电阻 (Ω)', key: 'coilR', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id !== undefined ? newConfig.id : this.id;

        const newL = parseFloat(newConfig.inductance);
        if (Number.isFinite(newL) && newL > 0) this.inductance = newL;

        const newR = parseFloat(newConfig.coilR);
        if (Number.isFinite(newR) && newR >= 0) this.coilR = newR;

        if (newConfig.testFlag !== undefined) this.testFlag = !!newConfig.testFlag;

        // 回写配置，保证再次打开配置界面时显示当前值
        this.config = { ...this.config, ...newConfig, id: this.id, inductance: this.inductance, coilR: this.coilR, testFlag: this.testFlag };

        this.label.text(this.formatInductance(this.inductance));
        this._applyTestFlag();
        this._refreshCache();
        if (this.sys && this.sys.eventBus) {
            this.sys.eventBus.emit('inductor:configUpdate', { id: this.id, inductance: this.inductance, coilR: this.coilR });
        }
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


    destroy() {
        super.destroy?.();
    }
}
