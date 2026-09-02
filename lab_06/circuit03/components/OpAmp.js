/**
 * OpAmp.js
 * 运算放大器（OpAmp）可视化与仿真组件（注释版）
 *
 * 说明：
 * - 该组件继承自 `BaseComponent` 并在画布上用 Konva 绘制运放封装、引脚与内部符号。
 * - 提供简单的仿真属性（开环增益 `gain`、对称电源 `sourceVolt`、输入失调 `inputOffset`），
 *   并通过 `getConfigFields` / `onConfigUpdate` 暴露配置面板。
 * - 元件视觉与仿真分离：视觉元素放入 `_staticGroup`（可缓存），逻辑端口通过 `addPort` 注册。
 *
 * 设计注意：
 * - 运放的内部限制使用 `vPosLimit` / `vNegLimit` 来模拟电源轨限制。
 * - 该组件不实现完整电路级运放行为（如频率响应、输入偏置电流等），而提供近似的模型与可视化。
 */
import { BaseComponent } from './BaseComponent.js';

export class OpAmp extends BaseComponent {
    /**
     * 构造函数
     * @param {object} config - 配置对象（含 gain, source, inputOffset 等）
     * @param {object} sys - 系统上下文
     */
    constructor(config, sys) {
        super(config, sys);

        this._initGroups();
        // 仿真属性
        this.sourceVolt = config.source || 15; // 对称电源 ±sourceVolt
        this.gain = config.gain || 1000000;    // 开环增益

        // 电源轨限幅：输出不会超过电源轨减去一定裕量
        this.vPosLimit = this.sourceVolt - 1.5; // 正轨限幅（V）
        this.vNegLimit = -this.vPosLimit;       // 负轨限幅（V）
        this.type = 'amplifier';
        this.cache = 'fixed'; // 可对静态图形缓存

        this.inputOffset = config.inputOffset || 0; // 输入失调电压（V），用于帮助电路启动或调试

        this.config = { id: this.id, gain: this.gain, sourceVolt: this.sourceVolt };
        this.initVisuals();
        this.initPorts();
    }

    /**
     * 初始化端口（视觉上仅添加仿真需要的引脚位置）
     * - 仅注册常用逻辑引脚：负输入 `n` (pin2), 正输入 `p` (pin3), 输出 `OUT` (pin6)
     */
    initPorts() {
        // 根据 OP07 等运放常见封装位置添加端口
        this.addPort(-57.5 * this.scale, -15 * this.scale, 'n', 'wire');  // 引脚 2: 负输入
        this.addPort(-57.5 * this.scale, 15 * this.scale, 'p', 'wire', 'p');   // 引脚 3: 正输入
        this.addPort(57.5 * this.scale, 15 * this.scale, 'OUT', 'wire', 'p');    // 引脚 6: 输出
    }

    /**
     * 绘制运放的视觉元素（封装、引脚、内部三角符号等）
     * - 所有不会频繁改变的图形放入 `_staticGroup`，以便缓存提升性能
     */
    initVisuals() {
        const colors = {
            body: '#ffffff',
            stroke: '#000000',
            pin: '#2c3e50',
            internalWire: '#7f8c8d'
        };

        // 芯片外壳（矩形）
        const body = new Konva.Rect({
            x: -50 * this.scale, y: -60 * this.scale,
            width: 100 * this.scale, height: 120 * this.scale,
            fill: colors.body,
            stroke: colors.stroke,
            strokeWidth: 2 * this.scale,
            cornerRadius: 4 * this.scale
        });
        this._staticGroup.add(body);

        // 引脚 1 标识点（凹口）
        const notch = new Konva.Circle({ x: -38 * this.scale, y: -48 * this.scale, radius: 4 * this.scale, fill: colors.stroke });

        // 绘制 8 个引脚的外观（仅视觉，不全部注册为仿真端口）
        const pinPositions = [
            { x: -65 * this.scale, y: -45 * this.scale, label: '1' },
            { x: -65 * this.scale, y: -15 * this.scale, label: '2' },
            { x: -65 * this.scale, y: 15 * this.scale, label: '3' },
            { x: -65 * this.scale, y: 45 * this.scale, label: '4', name: `-${this.sourceVolt}V` },
            { x: 50 * this.scale, y: -45 * this.scale, label: '8' },
            { x: 50 * this.scale, y: -15 * this.scale, label: '7', name: `+${this.sourceVolt}V` },
            { x: 50 * this.scale, y: 15 * this.scale, label: '6' },
            { x: 50 * this.scale, y: 45 * this.scale, label: '5' }
        ];

        pinPositions.forEach(pos => {
            // 引脚金属片
            this._staticGroup.add(new Konva.Rect({ x: pos.x, y: pos.y - 5 * this.scale, width: 15 * this.scale, height: 10 * this.scale, fill: '#bdc3c7', stroke: colors.stroke, strokeWidth: 1 * this.scale }));
            // 引脚编号文字
            this._staticGroup.add(new Konva.Text({ x: pos.x > 0 ? pos.x + 18 * this.scale : pos.x - 12 * this.scale, y: pos.y - 4 * this.scale, text: pos.label, fontSize: 10 * this.scale, fill: '#7f8c8d' }));
        });

        // 电源文本（正负电源标注）
        this.negVolt = new Konva.Text({ x: -45 * this.scale, y: 40 * this.scale, text: `-${this.sourceVolt}V`, fontSize: 12 * this.scale, align: 'left' });
        this.posVolt = new Konva.Text({ x: 20 * this.scale, y: -19 * this.scale, text: `+${this.sourceVolt}V`, fontSize: 12 * this.scale, align: 'right' });
        this._staticGroup.add(this.negVolt, this.posVolt);

        // 内部三角符号表示放大功能
        const triangle = new Konva.Line({ points: [-18 * this.scale, -29 * this.scale, -18 * this.scale, 29 * this.scale, 22 * this.scale, 0], closed: true, stroke: colors.stroke, strokeWidth: 2 * this.scale });

        // 内部连接线（用虚线表示示意连接到逻辑引脚）
        const wires = [
            { pts: [-18 * this.scale, -15 * this.scale, -50 * this.scale, -15 * this.scale], color: colors.internalWire },
            { pts: [-18 * this.scale, 15 * this.scale, -50 * this.scale, 15 * this.scale], color: colors.internalWire },
            { pts: [22 * this.scale, 0, 50 * this.scale, 15 * this.scale], color: colors.internalWire }
        ];
        wires.forEach(w => { this._staticGroup.add(new Konva.Line({ points: w.pts, stroke: w.color, strokeWidth: 3.2 * this.scale, dash: [3, 2] })); });

        // 标题与输入/输出标识
        const title = new Konva.Text({ x: -22 * this.scale, y: -55 * this.scale, text: 'OP07', fontSize: 14 * this.scale, fontStyle: 'bold' });
        const symMinus = new Konva.Text({ x: -15 * this.scale, y: -24 * this.scale, text: '-', fontSize: 18 * this.scale });
        const symPlus = new Konva.Text({ x: -15 * this.scale, y: 8 * this.scale, text: '+', fontSize: 14 * this.scale });
        const symOut = new Konva.Text({ x: -8 * this.scale, y: -8 * this.scale, text: 'out', fontSize: 14 * this.scale });

        this._staticGroup.add(triangle, title, symMinus, symPlus, symOut, notch);
    }

    /**
     * 在配置变更后刷新显示电源文本并更新限幅
     */
    updateSource() {
        if (this.negVolt && this.posVolt) {
            this.negVolt.text(`-${this.sourceVolt}V`);
            this.posVolt.text(`+${this.sourceVolt}V`);
            // 更新限幅值（输出不会驱动到电源侧）
            this.vPosLimit = this.sourceVolt - 1.5;
            this.vNegLimit = -this.vPosLimit;
        }
    }

    /**
     * 配置面板字段定义（用于 UI 编辑器）
     */
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '开环增益 (A)', key: 'gain', type: 'number' },
            { label: '电源电压（正负对称）', key: 'sourceVolt', type: 'number' },
        ];
    }

    /**
     * 当配置面板更新参数时调用
     */
    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.gain = parseInt(newConfig.gain) || 1e6;
        this.sourceVolt = parseInt(newConfig.sourceVolt);
        this.id = newConfig.id;
        this.updateSource();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
