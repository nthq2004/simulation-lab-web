import { BaseComponent } from './BaseComponent.js';

/**
 * PT100 温度传感器（简化示意）
 *
 * 说明：
 * - 该组件在画布上以探棒形状展示 PT100 温度传感器，并提供两个接线端口；
 * - 内部将温度（单位：°C）映射为电阻值：默认公式为 R = 100 + 0.3851 * T（此系数为项目内使用的经验值）；
 * - 支持模拟开路（isOpen）与短路（isShort）故障：分别返回极大阻值或 0Ω；
 * - 视觉元素使用 Konva 绘制并加入 `_staticGroup`，使用 `this._refreshCache()` 刷新显示。
 */
export class PT100 extends BaseComponent {
    /**
     * 构造器
     * @param {Object} config - 组件配置（保留位置以备扩展）
     * @param {Object} sys - 全局系统对象（用于重绘等）
     */
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();
        this.type = 'resistor';
        this.cache = 'fixed'; // 用于静态缓存的特殊标识

        // 标称阻值与动态状态
        this.value = 100; // 标称阻值：PT100 在 0°C 时约为 100Ω
        this.currentResistance = 100; // 当前阻值（随温度或故障变化）
        this.isOpen = false;  // 模拟开路故障
        this.isShort = false; // 模拟短路故障

        // --- 视觉：探棒与标签 ---
        const probe = new Konva.Line({
            points: [-10, 20, 10, 20, 20, 10, 30, 30, 40, 10, 50, 30, 60, 10, 70, 20, 90, 20],
            stroke: '#2c3e50', strokeWidth: 2
        });

        const info = new Konva.Text({
            y: 35, width: 80, text: 'PT100', align: 'center', fontSize: 18
        });

        this.resText = info;
        this._staticGroup.add(probe, info);

        // 注册接线端口（左/右）以便与电路连线
        this.addPort(-10, 20, 'l', 'wire');
        this.addPort(90, 20, 'r', 'wire');

        // 将整个组件旋转以匹配原有画布方向
        this.group.rotate(90);

        // 双击清除故障标志（用户交互恢复正常状态）
        this.group.on('dblclick', () => {
            if (this.isOpen === true) this.isOpen = false;
            if (this.isShort === true) this.isShort = false;
            // 注意：不强制刷新缓存，外层调用 update 时会刷新
        });
    }

    /**
     * 更新传感器状态：根据温度计算阻值，并处理开路/短路故障覆盖
     * @param {number} temp - 温度，单位 °C
     */
    update(temp) {
        // 基本线性关系（项目中使用的经验系数）：R = 100 + 0.3851 * T
        this.currentResistance = 100 + 0.3851 * temp;

        // 故障覆盖：开路返回非常大的阻值；短路返回 0Ω
        if (this.isOpen === true) {
            this.currentResistance = 1e9; // 近似表示开路
        }
        if (this.isShort === true) {
            this.currentResistance = 0; // 短路
        }
    }

    destroy() {
        super.destroy?.();
    }
}
