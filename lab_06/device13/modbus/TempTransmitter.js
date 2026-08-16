/**
 * TempTransmitter.js — 温度变送器 Modbus RTU 从站
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * Unit ID: 1
 * 输入寄存器: IR[0]=温度×10, IR[1]=电阻值, IR[2]=状态
 * 保持寄存器: HR[0]=报警高限, HR[1]=报警低限
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { applyFieldDeviceMixin } from './dpu/fieldDevice.mixin.js';

class ModbusTempTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 120;
        this.height = 140;
        this.type = 'modbus_temp';
        this.cache = 'fixed';

        // NTC 参数
        this.temperature = 25;
        this.resistance = 10000;
        this.isBreak = false;
        this.moduleFault = false;

        // 初始化 Modbus 从站（slaveId = 1）
        this._initModbus(1);
        this.holdingRegisters[0] = 800;  // 报警高限 80.0°C
        this.holdingRegisters[1] = -200; // 报警低限 -20.0°C

        this._drawVisuals();
        this._addPorts();
    }

    _addPorts() {
        this.addPort(10, 120, 'sig1', 'wire');
        this.addPort(50, 120, 'sig2', 'wire');
        this.addPort(100, 120, 'vcc', 'wire', 'p');
        this.addPort(100, 130, 'gnd', 'wire');
    }

    _drawVisuals() {
        // 面板底色
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#2d3436', cornerRadius: 4, stroke: '#636e72', strokeWidth: 2,
        }));

        // 标签
        this.group.add(new Konva.Text({
            x: 5, y: 5, text: 'TEMP\n变送器', fontSize: 11,
            fill: '#74b9ff', fontStyle: 'bold',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 58, text: 'ID:01', fontSize: 10, fill: '#dfe6e9',
        }));

        // 温度显示
        this.tempText = new Konva.Text({
            x: 5, y: 72, width: 110, height: 30,
            text: '--.- °C', fontSize: 16,
            fill: '#00ff00', fontFamily: 'monospace', align: 'center',
        });
        this.group.add(this.tempText);

        // 状态指示灯
        this.statusLED = new Konva.Circle({ x: 15, y: 48, radius: 5, fill: '#00b894' });
        this.group.add(this.statusLED);

        // 通信指示灯
        this.commLED = new Konva.Circle({ x: 35, y: 48, radius: 5, fill: '#636e72' });
        this.group.add(this.commLED);

        // ID 标签
        this.group.add(new Konva.Text({
            x: 60, y: 5, text: 'Unit 1', fontSize: 10,
            fill: '#b2bec3',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 105, text: 'RS485', fontSize: 9,
            fill: '#636e72',
        }));
    }

    /**
     * 更新温度数据（由仿真引擎调用）
     * @param {Object} state - { temperature: number, resistance: number }
     */
    update(state) {
        if (this.isBreak) {
            this.tempText.text('ERR');
            this.tempText.fill('#ff4757');
            this.statusLED.fill('#ff4757');
            this._updateRegisters();
            this._refreshCache();
            return;
        }

        if (state && typeof state.temperature === 'number') {
            this.temperature = state.temperature;
        }
        if (state && typeof state.resistance === 'number') {
            this.resistance = state.resistance;
        }

        // 更新显示
        this.tempText.text(`${this.temperature.toFixed(1)} °C`);
        this.tempText.fill('#00ff00');
        this.statusLED.fill('#00b894');

        // 更新寄存器
        this._updateRegisters();
        this._refreshCache();
    }

    /** 更新寄存器数据 */
    _updateRegisters() {
        const status = this._getStatusWord();
        this.updateInputRegisters({
            0: this.temperature,  // 温度 ×10
            1: this.resistance,   // 电阻值
            2: status,
        });
    }

    /** 通信指示灯闪烁 */
    blinkComm() {
        this.commLED.fill('#74b9ff');
        setTimeout(() => { this.commLED.fill('#636e72'); }, 100);
    }
}

applyFieldDeviceMixin(ModbusTempTransmitter.prototype);
export { ModbusTempTransmitter };
