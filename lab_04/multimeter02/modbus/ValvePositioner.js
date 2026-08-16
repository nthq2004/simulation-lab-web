/**
 * ValvePositioner.js — 阀门定位器 Modbus RTU 从站
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * Unit ID: 5
 * 输入寄存器: IR[0]=开度%×10, IR[1]=状态
 * 保持寄存器: HR[0]=设定开度%×10, HR[1]=死区
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { applyFieldDeviceMixin } from './dpu/fieldDevice.mixin.js';

class ModbusValvePositioner extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 120;
        this.height = 140;
        this.type = 'modbus_valve';
        this.cache = 'fixed';

        this.positionPct = 0;
        this.setpointPct = 0;
        this.deadband = 2; // %
        this.isBreak = false;
        this.moduleFault = false;

        this._initModbus(5);
        this.holdingRegisters[0] = 0;   // 设定开度
        this.holdingRegisters[1] = 20;  // 死区 2.0%

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
            x: 5, y: 5, text: 'VALVE\n阀门定位', fontSize: 11,
            fill: '#e17055', fontStyle: 'bold',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 58, text: 'ID:05', fontSize: 10, fill: '#dfe6e9',
        }));

        this.posText = new Konva.Text({
            x: 5, y: 72, width: 110, height: 30,
            text: '--.- %', fontSize: 16,
            fill: '#00ff00', fontFamily: 'monospace', align: 'center',
        });
        this.group.add(this.posText);

        // 阀门开度指示器（圆形表头）
        this.valveArc = new Konva.Arc({
            x: 60, y: 36, innerRadius: 12, outerRadius: 18,
            angle: 0, fill: '#e17055', stroke: '#636e72',
            rotation: -90,
        });
        this.group.add(this.valveArc);

        this.group.add(new Konva.Circle({ x: 60, y: 36, radius: 8, fill: '#2d3436', stroke: '#636e72' }));

        this.statusLED = new Konva.Circle({ x: 15, y: 48, radius: 5, fill: '#00b894' });
        this.group.add(this.statusLED);

        this.commLED = new Konva.Circle({ x: 35, y: 48, radius: 5, fill: '#636e72' });
        this.group.add(this.commLED);

        this.group.add(new Konva.Text({
            x: 60, y: 5, text: 'Unit 5', fontSize: 10, fill: '#b2bec3',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 105, text: 'RS485', fontSize: 9, fill: '#636e72',
        }));
    }

    update(state) {
        if (this.isBreak) {
            this.posText.text('ERR');
            this.posText.fill('#ff4757');
            this.statusLED.fill('#ff4757');
            this._updateRegisters();
            this._refreshCache();
            return;
        }

        // 从保持寄存器读取设定值
        this.setpointPct = (this.holdingRegisters[0] || 0) / 10;
        this.deadband = (this.holdingRegisters[1] || 20) / 10;

        if (state && typeof state.positionPct === 'number') {
            this.positionPct = state.positionPct;
        }

        // 位置跟随设定值（带死区）
        const diff = this.setpointPct - this.positionPct;
        if (Math.abs(diff) > this.deadband) {
            this.positionPct += Math.sign(diff) * Math.min(Math.abs(diff) * 0.1, 1);
        }

        this.positionPct = Math.max(0, Math.min(100, this.positionPct));

        // 更新显示
        this.posText.text(`${this.positionPct.toFixed(1)} %`);
        this.posText.fill('#00ff00');
        this.statusLED.fill('#00b894');

        // 更新阀门指示
        this.valveArc.angle((this.positionPct / 100) * 270);

        this._updateRegisters();
        this._refreshCache();
    }

    _updateRegisters() {
        const status = this._getStatusWord();
        this.updateInputRegisters({
            0: this.positionPct,
            1: status,
        });
    }

    blinkComm() {
        this.commLED.fill('#e17055');
        setTimeout(() => { this.commLED.fill('#636e72'); }, 100);
    }
}

applyFieldDeviceMixin(ModbusValvePositioner.prototype);
export { ModbusValvePositioner };
