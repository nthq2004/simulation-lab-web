/**
 * IASServer.mixin.js — IAS 监控主机显示管理混入
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 提供：
 *   - 页面渲染（概览、温度、压力、电气、报警）
 *   - 报警处理逻辑
 *   - 数据显示更新
 */

import { FC, RegHelper } from '../MODBUS.js';

/**
 * 混入 IAS 显示管理方法到目标原型
 * @param {Object} proto - IASServer.prototype
 */
export function applyIASServerMixin(proto) {

    /**
     * 初始化 IAS 监控状态
     */
    proto._initIAS = function () {
        this.deviceData = {};
        this.alarms = [];
        this.alarmConfig = {
            1: { 0: { hh: 800, h: 650, l: -100, ll: -200 } },
            2: { 0: { hh: 1600, h: 1400, l: 100, ll: 50 } },
            4: { 0: { hh: 900, h: 800, l: 100, ll: 50 } },
        };
        this.currentPage = 'overview';
        this.pages = ['overview', 'temperature', 'pressure', 'electrical', 'alarm'];
        this._pageTexts = {};
        this._alarmTexts = {};
        this._statusLEDs = {};
        this._pollTimer = 0;
        this.pollInterval = 500;
    };

    /**
     * 更新设备数据缓存
     */
    proto.updateDeviceData = function (data) {
        if (!data) return;
        for (const [sid, device] of Object.entries(data)) {
            if (!this.deviceData[sid]) {
                this.deviceData[sid] = { inputRegisters: [], holdingRegisters: [], coils: [], discreteInputs: [], online: false, lastUpdate: 0 };
            }
            this.deviceData[sid].inputRegisters = device.inputRegisters ? [...device.inputRegisters] : [];
            this.deviceData[sid].holdingRegisters = device.holdingRegisters ? [...device.holdingRegisters] : [];
            this.deviceData[sid].coils = device.coils ? [...device.coils] : [];
            this.deviceData[sid].discreteInputs = device.discreteInputs ? [...device.discreteInputs] : [];
            this.deviceData[sid].online = device.online;
            this.deviceData[sid].lastUpdate = device.lastUpdate || Date.now();
        }
    };

    /**
     * 报警检测与更新
     */
    proto.checkAlarms = function () {
        const now = Date.now();

        for (const [sidStr, config] of Object.entries(this.alarmConfig)) {
            const slaveId = parseInt(sidStr);
            const dev = this.deviceData[slaveId];
            if (!dev || !dev.online) continue;

            for (const [regIdx, limits] of Object.entries(config)) {
                const idx = parseInt(regIdx);
                const value = dev.inputRegisters[idx];
                if (value === undefined) continue;

                const realValue = value / 10;
                const devName = this._getDeviceName(slaveId);

                if (limits.hh !== undefined && realValue >= limits.hh / 10) {
                    this._addAlarm(`hh_${slaveId}_${idx}`, slaveId, devName, devName + ' 高高报警', realValue, limits.hh / 10, 'HH', now);
                } else if (limits.h !== undefined && realValue >= limits.h / 10) {
                    this._addAlarm(`h_${slaveId}_${idx}`, slaveId, devName, devName + ' 高报警', realValue, limits.h / 10, 'H', now);
                } else if (limits.ll !== undefined && realValue <= limits.ll / 10) {
                    this._addAlarm(`ll_${slaveId}_${idx}`, slaveId, devName, devName + ' 低低报警', realValue, limits.ll / 10, 'LL', now);
                } else if (limits.l !== undefined && realValue <= limits.l / 10) {
                    this._addAlarm(`l_${slaveId}_${idx}`, slaveId, devName, devName + ' 低报警', realValue, limits.l / 10, 'L', now);
                } else {
                    this._clearAlarm('hh_' + slaveId + '_' + idx);
                    this._clearAlarm('h_' + slaveId + '_' + idx);
                    this._clearAlarm('ll_' + slaveId + '_' + idx);
                    this._clearAlarm('l_' + slaveId + '_' + idx);
                }
            }
        }

        for (const [sid, dev] of Object.entries(this.deviceData)) {
            if (!dev.online && dev.lastUpdate > 0) {
                const sId = parseInt(sid);
                const devName = this._getDeviceName(sId);
                this._addAlarm('offline_' + sid, sId, devName, devName + ' 通信中断', 0, 0, 'COMM', now);
            } else {
                this._clearAlarm('offline_' + sid);
            }
        }

        if (this.alarms.length > 100) {
            this.alarms = this.alarms.slice(-100);
        }
    };

    proto._addAlarm = function (id, slaveId, name, description, value, limit, type, timestamp) {
        const existing = this.alarms.find(a => a.id === id);
        if (existing) {
            existing.active = true;
            existing.value = value;
            existing.timestamp = timestamp;
            return;
        }
        this.alarms.unshift({
            id, slaveId, name, description, value, limit, type, timestamp,
            acknowledged: false,
            active: true,
        });
    };

    proto._clearAlarm = function (id) {
        const alarm = this.alarms.find(a => a.id === id);
        if (alarm) alarm.active = false;
    };

    proto.acknowledgeAlarm = function (alarmId) {
        const alarm = this.alarms.find(a => a.id === alarmId);
        if (alarm) alarm.acknowledged = true;
    };

    proto.acknowledgeAll = function () {
        this.alarms.forEach(a => { a.acknowledged = true; });
    };

    proto.getActiveAlarmCount = function () {
        return this.alarms.filter(a => a.active && !a.acknowledged).length;
    };

    proto._getDeviceName = function (slaveId) {
        const names = { 1: '温度变送器', 2: '压力变送器', 3: '变频器', 4: '液位变送器', 5: '阀门定位器' };
        return names[slaveId] || ('从站 ' + slaveId);
    };

    proto.getPageData = function (page) {
        switch (page) {
            case 'overview': return this._buildOverviewData();
            case 'temperature': return this._buildTemperatureData();
            case 'pressure': return this._buildPressureData();
            case 'electrical': return this._buildElectricalData();
            case 'alarm': return this._buildAlarmData();
            default: return [];
        }
    };

    proto._buildOverviewData = function () {
        const rows = [];
        for (const [sid, dev] of Object.entries(this.deviceData)) {
            const sId = parseInt(sid);
            const name = this._getDeviceName(sId);
            const temp = dev.inputRegisters?.[0] !== undefined ? (dev.inputRegisters[0] / 10).toFixed(1) : '--';
            const status = dev.online ? '在线' : '离线';
            rows.push({ slaveId: sId, name, temp, status, online: dev.online });
        }
        return rows;
    };

    proto._buildTemperatureData = function () {
        const dev = this.deviceData[1];
        if (!dev) return [];
        return [
            { label: '温度 (°C)', value: dev.inputRegisters?.[0] !== undefined ? (dev.inputRegisters[0] / 10).toFixed(1) : '--' },
            { label: '电阻值 (Ω)', value: dev.inputRegisters?.[1] !== undefined ? dev.inputRegisters[1].toFixed(1) : '--' },
            { label: '设备状态', value: dev.online ? '正常' : '离线' },
        ];
    };

    proto._buildPressureData = function () {
        const dev = this.deviceData[2];
        if (!dev) return [];
        return [
            { label: '压力 (kPa)', value: dev.inputRegisters?.[0] !== undefined ? (dev.inputRegisters[0] / 10).toFixed(2) : '--' },
            { label: '设备状态', value: dev.online ? '正常' : '离线' },
        ];
    };

    proto._buildElectricalData = function () {
        const dev = this.deviceData[3];
        if (!dev) return [];
        return [
            { label: '转速 (RPM)', value: dev.inputRegisters?.[0] !== undefined ? dev.inputRegisters[0] : '--' },
            { label: '电流 (A)', value: dev.inputRegisters?.[1] !== undefined ? (dev.inputRegisters[1] / 10).toFixed(1) : '--' },
            { label: '频率 (Hz)', value: dev.inputRegisters?.[2] !== undefined ? (dev.inputRegisters[2] / 10).toFixed(1) : '--' },
            { label: '设备状态', value: dev.online ? '正常' : '离线' },
        ];
    };

    proto._buildAlarmData = function () {
        return this.alarms.filter(a => a.active).slice(0, 20).map(a => ({
            id: a.id,
            name: a.name,
            description: a.description,
            value: a.type === 'COMM' ? '--' : a.value.toFixed(1),
            type: a.type,
            timestamp: new Date(a.timestamp).toLocaleTimeString(),
            acknowledged: a.acknowledged,
        }));
    };

    proto.switchPage = function (page) {
        if (this.pages.includes(page)) {
            this.currentPage = page;
        }
    };
}
