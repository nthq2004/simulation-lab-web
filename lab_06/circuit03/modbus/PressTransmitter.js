/**
 * PressTransmitter.js — 压力变送器 Modbus RTU 从站
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * Unit ID: 2
 * 输入寄存器: IR[0]=压力×10, IR[1]=状态
 * 保持寄存器: HR[0]=量程上限
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { applyFieldDeviceMixin } from './dpu/fieldDevice.mixin.js';

class ModbusPressTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 120;
        this.height = 140;
        this.type = 'modbus_press';
        this.cache = 'fixed';

        this.pressure = 0;
        this.rangeMax = 2000; // kPa
        this.isBreak = false;
        this.moduleFault = false;

        this._initModbus(2);
        this.holdingRegisters[0] = this.rangeMax;

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
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#2d3436', cornerRadius: 4, stroke: '#636e72', strokeWidth: 2,
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 5, text: 'PRESS\n变送器', fontSize: 11,
            fill: '#fd79a8', fontStyle: 'bold',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 58, text: 'ID:02', fontSize: 10, fill: '#dfe6e9',
        }));

        this.pressText = new Konva.Text({
            x: 5, y: 72, width: 110, height: 30,
            text: '---- kPa', fontSize: 15,
            fill: '#00ff00', fontFamily: 'monospace', align: 'center',
        });
        this.group.add(this.pressText);

        this.statusLED = new Konva.Circle({ x: 15, y: 48, radius: 5, fill: '#00b894' });
        this.group.add(this.statusLED);

        this.commLED = new Konva.Circle({ x: 35, y: 48, radius: 5, fill: '#636e72' });
        this.group.add(this.commLED);

        this.group.add(new Konva.Text({
            x: 60, y: 5, text: 'Unit 2', fontSize: 10, fill: '#b2bec3',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 105, text: 'RS485', fontSize: 9, fill: '#636e72',
        }));
    }

    update(state) {
        if (this.isBreak) {
            this.pressText.text('ERR');
            this.pressText.fill('#ff4757');
            this.statusLED.fill('#ff4757');
            this._updateRegisters();
            this._refreshCache();
            return;
        }

        if (state && typeof state.pressure === 'number') {
            this.pressure = state.pressure;
        }

        this.pressText.text(`${this.pressure.toFixed(1)} kPa`);
        this.pressText.fill('#00ff00');
        this.statusLED.fill('#00b894');

        this._updateRegisters();
        this._refreshCache();
    }

    _updateRegisters() {
        const status = this._getStatusWord();
        this.updateInputRegisters({
            0: this.pressure,
            1: status,
        });
    }

    blinkComm() {
        this.commLED.fill('#fd79a8');
        setTimeout(() => { this.commLED.fill('#636e72'); }, 100);
    }
}

applyFieldDeviceMixin(ModbusPressTransmitter.prototype);
export { ModbusPressTransmitter };
