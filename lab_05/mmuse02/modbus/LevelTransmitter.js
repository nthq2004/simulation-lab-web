/**
 * LevelTransmitter.js — 液位变送器 Modbus RTU 从站
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * Unit ID: 4
 * 输入寄存器: IR[0]=液位%×10, IR[1]=状态
 * 保持寄存器: HR[0]=罐高度, HR[1]=报警高限
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { applyFieldDeviceMixin } from './dpu/fieldDevice.mixin.js';

class ModbusLevelTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 120;
        this.height = 140;
        this.type = 'modbus_level';
        this.cache = 'fixed';

        this.levelPct = 0;
        this.tankHeight = 500; // cm
        this.isBreak = false;
        this.moduleFault = false;

        this._initModbus(4);
        this.holdingRegisters[0] = this.tankHeight;
        this.holdingRegisters[1] = 800; // 报警高限 80%

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
            x: 5, y: 5, text: 'LEVEL\n液位', fontSize: 11,
            fill: '#55efc4', fontStyle: 'bold',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 58, text: 'ID:04', fontSize: 10, fill: '#dfe6e9',
        }));

        this.levelText = new Konva.Text({
            x: 5, y: 72, width: 110, height: 30,
            text: '--.- %', fontSize: 16,
            fill: '#00ff00', fontFamily: 'monospace', align: 'center',
        });
        this.group.add(this.levelText);

        // 液位指示条背景
        this.barBg = new Konva.Rect({ x: 90, y: 30, width: 20, height: 60, fill: '#1e272e', stroke: '#636e72', cornerRadius: 2 });
        this.barFill = new Konva.Rect({ x: 92, y: 82, width: 16, height: 6, fill: '#55efc4', cornerRadius: 1 });
        this.group.add(this.barBg);
        this.group.add(this.barFill);

        this.statusLED = new Konva.Circle({ x: 15, y: 48, radius: 5, fill: '#00b894' });
        this.group.add(this.statusLED);

        this.commLED = new Konva.Circle({ x: 35, y: 48, radius: 5, fill: '#636e72' });
        this.group.add(this.commLED);

        this.group.add(new Konva.Text({
            x: 60, y: 5, text: 'Unit 4', fontSize: 10, fill: '#b2bec3',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 105, text: 'RS485', fontSize: 9, fill: '#636e72',
        }));
    }

    update(state) {
        if (this.isBreak) {
            this.levelText.text('ERR');
            this.levelText.fill('#ff4757');
            this.statusLED.fill('#ff4757');
            this._updateRegisters();
            this._refreshCache();
            return;
        }

        if (state && typeof state.levelPct === 'number') {
            this.levelPct = Math.max(0, Math.min(100, state.levelPct));
        }

        this.levelText.text(`${this.levelPct.toFixed(1)} %`);
        this.levelText.fill('#00ff00');
        this.statusLED.fill('#00b894');

        // 更新液位指示条
        const fillHeight = (this.levelPct / 100) * 58;
        this.barFill.y(82 - fillHeight);
        this.barFill.height(fillHeight);

        this._updateRegisters();
        this._refreshCache();
    }

    _updateRegisters() {
        const status = this._getStatusWord();
        this.updateInputRegisters({
            0: this.levelPct,
            1: status,
        });
    }

    blinkComm() {
        this.commLED.fill('#55efc4');
        setTimeout(() => { this.commLED.fill('#636e72'); }, 100);
    }
}

applyFieldDeviceMixin(ModbusLevelTransmitter.prototype);
export { ModbusLevelTransmitter };
