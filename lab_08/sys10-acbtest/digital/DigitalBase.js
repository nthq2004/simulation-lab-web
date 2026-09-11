/**
 * DigitalBase.js — 数字组件基类
 * 为数字逻辑器件提供统一的端口注册、信号线连接和右键菜单。
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { signalBridge } from '../tools/SignalBridge.js';

export class DigitalBase extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._inputPorts = [];
        this._outputPorts = [];
        this._signalLines = [];
    }

    /**
     * 注册数字输入引脚，同时创建对应的 wire 端口和数字信号线
     * @param {number} x — 相对组件原点的 x
     * @param {number} y — 相对组件原点的 y
     * @param {string} name — 引脚名称 (如 'a', 'b', 'clk')
     */
    addDigitalInput(x, y, name) {
        const portName = `dig_${name}`;
        this.addPort(x, y, portName, 'wire', name === 'clk' ? 'p' : 'n');
        const signalLineId = `${this.id}_${name}`;
        signalBridge.createSignalLine(signalLineId);
        signalBridge.connectToLine(signalLineId, `${this.id}_${name}`);
        this._inputPorts.push({ name, signalLineId });
        this._signalLines.push(signalLineId);
    }

    /**
     * 注册数字输出引脚
     * @param {number} x — 相对组件原点的 x
     * @param {number} y — 相对组件原点的 y
     * @param {string} name — 引脚名称 (如 'out', 'q', 'qn')
     */
    addDigitalOutput(x, y, name) {
        const portName = `dig_${name}`;
        this.addPort(x, y, portName, 'wire', 'p');
        const signalLineId = `${this.id}_${name}`;
        signalBridge.createSignalLine(signalLineId);
        signalBridge.connectToLine(signalLineId, `${this.id}_${name}`);
        this._outputPorts.push({ name, signalLineId });
        this._signalLines.push(signalLineId);
    }

    /**
     * 获取数字输入引脚对应的信号线 ID 列表
     * @returns {string[]}
     */
    getDigitalInputs() {
        return this._inputPorts.map(p => p.signalLineId);
    }

    /**
     * 获取数字输出引脚对应的信号线 ID
     * @returns {string}
     */
    getDigitalOutput() {
        return this._outputPorts[0]?.signalLineId || null;
    }

    /**
     * 获取数字输入信号线名称 -> ID 映射
     */
    getDigitalInputMap() {
        const map = {};
        this._inputPorts.forEach(p => { map[p.name] = p.signalLineId; });
        return map;
    }

    /**
     * 读取输入引脚值
     * @param {string} name — 引脚名称
     * @returns {0|1}
     */
    readInput(name) {
        const port = this._inputPorts.find(p => p.name === name);
        if (!port) return 0;
        return signalBridge.readSignal(port.signalLineId);
    }

    /**
     * 配置字段
     */
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
        ];
    }
}
