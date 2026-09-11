/**
 * VFD.js — 变频器 Modbus RTU 从站
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * Unit ID: 3
 * 输入寄存器: IR[0]=转速, IR[1]=电流×10, IR[2]=频率×10, IR[3]=状态
 * 保持寄存器: HR[0]=转速设定, HR[1]=加速时间, HR[2]=减速时间
 * 线圈: Coil[0]=运行, Coil[1]=故障复位
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { applyFieldDeviceMixin } from './dpu/fieldDevice.mixin.js';

class ModbusVFD extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 120;
        this.height = 140;
        this.type = 'modbus_vfd';
        this.cache = 'fixed';

        // VFD 参数
        this.speedRPM = 0;
        this.currentA = 0;
        this.freqHz = 0;
        this.isRunning = false;
        this.isBreak = false;
        this.moduleFault = false;

        // 设定值
        this.speedSetpoint = 1500;
        this.accelTime = 10;
        this.decelTime = 10;

        this._initModbus(3);
        this.holdingRegisters[0] = this.speedSetpoint;
        this.holdingRegisters[1] = this.accelTime;
        this.holdingRegisters[2] = this.decelTime;
        this.coils[0] = false;
        this.coils[1] = false;

        this._drawVisuals();
        this._addPorts();

        // 内部仿真定时器
        this._currentSpeed = 0;
    }

    _addPorts() {
        this.addPort(10, 120, 'in1', 'wire');
        this.addPort(50, 120, 'in2', 'wire');
        this.addPort(100, 120, 'vcc', 'wire', 'p');
        this.addPort(100, 130, 'gnd', 'wire');
    }

    _drawVisuals() {
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#2d3436', cornerRadius: 4, stroke: '#636e72', strokeWidth: 2,
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 5, text: 'VFD\n变频器', fontSize: 11,
            fill: '#fdcb6e', fontStyle: 'bold',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 58, text: 'ID:03', fontSize: 10, fill: '#dfe6e9',
        }));

        this.speedText = new Konva.Text({
            x: 5, y: 70, width: 110, height: 20,
            text: '0 RPM', fontSize: 13,
            fill: '#00ff00', fontFamily: 'monospace', align: 'center',
        });
        this.group.add(this.speedText);

        this.freqText = new Konva.Text({
            x: 5, y: 88, width: 110, height: 16,
            text: '0.0 Hz', fontSize: 11,
            fill: '#74b9ff', fontFamily: 'monospace', align: 'center',
        });
        this.group.add(this.freqText);

        this.runLED = new Konva.Circle({ x: 15, y: 48, radius: 5, fill: '#636e72' });
        this.group.add(this.runLED);

        this.commLED = new Konva.Circle({ x: 35, y: 48, radius: 5, fill: '#636e72' });
        this.group.add(this.commLED);

        this.group.add(new Konva.Text({
            x: 60, y: 5, text: 'Unit 3', fontSize: 10, fill: '#b2bec3',
        }));

        this.group.add(new Konva.Text({
            x: 5, y: 110, text: 'RS485', fontSize: 9, fill: '#636e72',
        }));
    }

    update(state) {
        if (this.isBreak) {
            this.speedText.text('ERR');
            this.speedText.fill('#ff4757');
            this.runLED.fill('#ff4757');
            this._updateRegisters();
            this._refreshCache();
            return;
        }

        // 检查保持寄存器的设定值变化
        this.speedSetpoint = this.holdingRegisters[0] || 1500;
        this.accelTime = this.holdingRegisters[1] || 10;
        this.decelTime = this.holdingRegisters[2] || 10;
        this.isRunning = this.coils[0] || false;

        // 简单速度仿真：加减速斜坡
        const targetSpeed = this.isRunning ? this.speedSetpoint : 0;
        const rampRate = this.isRunning ? (this.speedSetpoint / Math.max(1, this.accelTime * 10)) : (this._currentSpeed / Math.max(1, this.decelTime * 10));

        if (Math.abs(this._currentSpeed - targetSpeed) < rampRate) {
            this._currentSpeed = targetSpeed;
        } else if (this._currentSpeed < targetSpeed) {
            this._currentSpeed += rampRate;
        } else {
            this._currentSpeed -= rampRate;
        }

        this.speedRPM = Math.round(this._currentSpeed);
        this.freqHz = (this.speedRPM / 1500) * 50; // 基频 50Hz @ 1500RPM
        this.currentA = this.isRunning ? (5 + Math.random() * 3) : 0;

        // 更新显示
        this.speedText.text(`${this.speedRPM} RPM`);
        this.freqText.text(`${this.freqHz.toFixed(1)} Hz`);
        this.runLED.fill(this.isRunning ? '#00b894' : '#636e72');

        this._updateRegisters();
        this._refreshCache();
    }

    _updateRegisters() {
        let status = this._getStatusWord();
        if (this.isRunning) status |= 0x10; // bit4: 运行标志
        this.updateInputRegisters({
            0: this.speedRPM,
            1: this.currentA,
            2: this.freqHz,
            3: status,
        });
    }

    blinkComm() {
        this.commLED.fill('#fdcb6e');
        setTimeout(() => { this.commLED.fill('#636e72'); }, 100);
    }
}

applyFieldDeviceMixin(ModbusVFD.prototype);
export { ModbusVFD };
