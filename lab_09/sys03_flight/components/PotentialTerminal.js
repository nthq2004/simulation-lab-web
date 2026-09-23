import { BaseComponent } from './BaseComponent.js';

/**
 * PotentialTerminal — 电位端子组件
 *
 * 说明：
 * - 视觉：圆形接线柱 + 竖直短线 + 下方电气端口，并显示当前电位值；
 * - 电气：该端口相对求解器参考地保持设定的电位（诺顿等效：电流源 V*g + 对地电导 g），
 *   可替代直流电源，使仿真电路简化；
 * - 参数：参数栏可设置"对地电压"（V，可为负值）。
 */

export class PotentialTerminal extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.type = 'pterm';
        this.cache = 'fixed';
        this.scale = config.scale || 1.4;

        this.potential = (config.potential !== undefined) ? config.potential : 5;

        // 诺顿等效参数（线性，每次迭代重注入，无额外方程）
        this._nortonG = 100;   // 对地电导 (S)，等效内阻 0.01Ω
        this._terminalCurrent = 0;

        this.config = { id: this.id, potential: this.potential };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(0, 14 * this.scale, 'p', 'wire', 'p');
    }

    initVisuals() {
        const s = this.scale;
        const stroke = '#333333';

        // 1) 竖直短线：从接线柱底部到端口
        const line = new Konva.Line({
            points: [0, -6 * s, 0, 14 * s],
            stroke: stroke,
            strokeWidth: 2 * s
        });

        // 2) 圆形接线柱
        const post = new Konva.Circle({
            x: 0, y: -12 * s,
            radius: 7 * s,
            fill: '#e8b339',
            stroke: stroke,
            strokeWidth: 2 * s
        });

        // 3) 电位值标签（in-place 更新的动态节点）
        this._label = new Konva.Text({
            x: 10 * s, y: -20 * s,
            text: this._labelText(),
            fontSize: 13 * s,
            fontStyle: 'bold',
            fill: '#b26a00',
            listening: false
        });

        this._staticGroup.add(line, post);
        this._dynamicGroup.add(this._label);
    }

    _labelText() {
        return `${this.potential >= 0 ? '+' : ''}${this.potential}V`;
    }

    /** 求解器 stamp 专用：端口cluster → 对地电导 + 注入电流源 */
    getStamp() {
        return { g: this._nortonG, v: this.potential };
    }

    /** 端子电流（A）：流入电路为正 */
    getTerminalCurrent(nodeV) {
        return (this.potential - nodeV) * this._nortonG;
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '对地电压 (V)', key: 'potential', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.config = cfg;
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.potential !== undefined) {
            this.potential = Number(cfg.potential) || 0;
            this._label.text(this._labelText());
            this._refreshCache();
        }
    }

    markDirty() {
        super.markDirty?.();
    }

    destroy() {
        super.destroy?.();
    }
}
