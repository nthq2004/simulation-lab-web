/**
 * Phase3FaultConfig - 船舶机舱故障场景配置
 * 12 个典型故障模式，与 EquipmentPool 配合
 *
 * 每个故障包含:
 *   id       — 唯一标识
 *   name     — 显示名称
 *   system   — 所属系统
 *   check()  — 是否处于故障状态
 *   trigger()— 触发故障
 *   repair() — 修复故障
 */

/** 获取设备状态 */
function getDev(sys, id) {
    return sys.equipmentPool?.get(id);
}

/** 发出报警 */
function setAlarm(sys, devId, alarmText) {
    const dev = getDev(sys, devId);
    if (dev) {
        if (!dev.state.alarms) dev.state.alarms = [];
        if (!dev.state.alarms.includes(alarmText)) {
            dev.state.alarms.push(alarmText);
        }
    }
}

/** 清除报警 */
function clearAlarm(sys, devId, alarmText) {
    const dev = getDev(sys, devId);
    if (dev && dev.state.alarms) {
        dev.state.alarms = dev.state.alarms.filter(a => a !== alarmText);
    }
}

export const FAULT_CONFIGS = {
    // ── 冷却水系统故障 ──
    'fault-coolant-high': {
        id: 'fault-coolant-high',
        name: '冷却水高温',
        system: 'cooling',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.coolantTemp > 85;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.coolantTemp = 92;
                setAlarm(sys, 'me-01', '冷却水高温报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.coolantTemp = 75;
                clearAlarm(sys, 'me-01', '冷却水高温报警');
            }
        },
    },

    'fault-pump-sw-fail': {
        id: 'fault-pump-sw-fail',
        name: '海水泵故障',
        system: 'cooling',
        check: () => {
            const pump = window.sys?.equipmentPool?.get('pump-sw-01');
            return pump && !pump.state.running;
        },
        trigger: () => {
            const pump = getDev(window.sys, 'pump-sw-01');
            if (pump) {
                pump.state.running = false;
                pump.state.speed = 0;
                setAlarm(window.sys, 'pump-sw-01', '海水泵停机');
            }
        },
        repair: () => {
            const pump = getDev(window.sys, 'pump-sw-01');
            if (pump) {
                pump.state.running = true;
                pump.state.speed = 1450;
                clearAlarm(window.sys, 'pump-sw-01', '海水泵停机');
            }
        },
    },

    'fault-pump-fw-fail': {
        id: 'fault-pump-fw-fail',
        name: '淡水泵故障',
        system: 'cooling',
        check: () => {
            const pump = window.sys?.equipmentPool?.get('pump-fw-01');
            return pump && !pump.state.running;
        },
        trigger: () => {
            const pump = getDev(window.sys, 'pump-fw-01');
            if (pump) {
                pump.state.running = false;
                pump.state.speed = 0;
                setAlarm(window.sys, 'pump-fw-01', '淡水泵停机');
            }
        },
        repair: () => {
            const pump = getDev(window.sys, 'pump-fw-01');
            if (pump) {
                pump.state.running = true;
                pump.state.speed = 1450;
                clearAlarm(window.sys, 'pump-fw-01', '淡水泵停机');
            }
        },
    },

    'fault-hx-fouling': {
        id: 'fault-hx-fouling',
        name: '换热器结垢',
        system: 'cooling',
        check: () => {
            const hx = window.sys?.equipmentPool?.get('hx-01');
            return hx && (hx.state.duty || 0.5) < 0.2;
        },
        trigger: () => {
            const hx = getDev(window.sys, 'hx-01');
            if (hx) {
                hx.state.duty = 0.15;
                setAlarm(window.sys, 'hx-01', '换热器效率下降');
            }
        },
        repair: () => {
            const hx = getDev(window.sys, 'hx-01');
            if (hx) {
                hx.state.duty = 0.7;
                clearAlarm(window.sys, 'hx-01', '换热器效率下降');
            }
        },
    },

    // ── 滑油系统故障 ──
    'fault-oil-low': {
        id: 'fault-oil-low',
        name: '滑油低压',
        system: 'main_engine',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.oilPress < 80;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.oilPress = 45;
                setAlarm(sys, 'me-01', '滑油低压报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.oilPress = 250;
                clearAlarm(sys, 'me-01', '滑油低压报警');
            }
        },
    },

    // ── 燃油系统故障 ──
    'fault-fuel-leak': {
        id: 'fault-fuel-leak',
        name: '燃油泄漏',
        system: 'fuel_oil',
        check: () => {
            const tank = window.sys?.equipmentPool?.get('tank-hfo-01');
            return tank && tank.state.level < 30;
        },
        trigger: () => {
            const sys = window.sys;
            const tank = getDev(sys, 'tank-hfo-01');
            if (tank) {
                tank.state.level = 25;
                setAlarm(sys, 'tank-hfo-01', '燃油液位低');
            }
        },
        repair: () => {
            const sys = window.sys;
            const tank = getDev(sys, 'tank-hfo-01');
            if (tank) {
                tank.state.level = 80;
                clearAlarm(sys, 'tank-hfo-01', '燃油液位低');
            }
        },
    },

    'fault-purifier-fail': {
        id: 'fault-purifier-fail',
        name: '分油机故障',
        system: 'fuel_oil',
        check: () => {
            const pur = window.sys?.equipmentPool?.get('purifier-01');
            return pur && !pur.state.running;
        },
        trigger: () => {
            const pur = getDev(window.sys, 'purifier-01');
            if (pur) {
                pur.state.running = false;
                setAlarm(window.sys, 'purifier-01', '分油机故障');
            }
        },
        repair: () => {
            const pur = getDev(window.sys, 'purifier-01');
            if (pur) {
                pur.state.running = true;
                clearAlarm(window.sys, 'purifier-01', '分油机故障');
            }
        },
    },

    // ── 电站系统故障 ──
    'fault-power-loss': {
        id: 'fault-power-loss',
        name: '电网失电',
        system: 'power_station',
        check: () => {
            const sw = window.sys?.equipmentPool?.get('switchboard-01');
            return sw && !sw.state.energized;
        },
        trigger: () => {
            const sys = window.sys;
            const sw = getDev(sys, 'switchboard-01');
            if (sw) {
                sw.state.energized = false;
                sw.state.busVoltage = 0;
                sw.state.busCurrent = 0;
                setAlarm(sys, 'switchboard-01', '电网失电');
            }
            const gen = getDev(sys, 'gen-01');
            if (gen) {
                gen.state.running = false;
                gen.state.voltage = 0;
                gen.state.frequency = 0;
            }
        },
        repair: () => {
            const sys = window.sys;
            const gen = getDev(sys, 'gen-01');
            if (gen) {
                gen.state.running = true;
                gen.state.voltage = 380;
                gen.state.frequency = 50;
            }
            const sw = getDev(sys, 'switchboard-01');
            if (sw) {
                sw.state.energized = true;
                sw.state.busVoltage = 380;
                sw.state.busCurrent = 150;
                clearAlarm(sys, 'switchboard-01', '电网失电');
            }
        },
    },

    'fault-gen-overload': {
        id: 'fault-gen-overload',
        name: '发电机过载',
        system: 'power_station',
        check: () => {
            const gen = window.sys?.equipmentPool?.get('gen-01');
            return gen && gen.state.current > 450;
        },
        trigger: () => {
            const gen = getDev(window.sys, 'gen-01');
            if (gen) {
                gen.state.current = 480;
                setAlarm(window.sys, 'gen-01', '发电机过载');
            }
        },
        repair: () => {
            const gen = getDev(window.sys, 'gen-01');
            if (gen) {
                gen.state.current = 250;
                clearAlarm(window.sys, 'gen-01', '发电机过载');
            }
        },
    },

    // ── 主机系统故障 ──
    'fault-engine-overspeed': {
        id: 'fault-engine-overspeed',
        name: '主机超速',
        system: 'main_engine',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.speed > 180;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.speed = 195;
                me.state.fuelRate = 90;
                setAlarm(sys, 'me-01', '主机超速报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.speed = 120;
                me.state.fuelRate = 50;
                clearAlarm(sys, 'me-01', '主机超速报警');
            }
        },
    },

    'fault-exhaust-high': {
        id: 'fault-exhaust-high',
        name: '排烟温度过高',
        system: 'main_engine',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.exhaustTemp > 500;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.exhaustTemp = 550;
                setAlarm(sys, 'me-01', '排烟温度高报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.exhaustTemp = 350;
                clearAlarm(sys, 'me-01', '排烟温度高报警');
            }
        },
    },

    'fault-gov-fail': {
        id: 'fault-gov-fail',
        name: '调速器故障',
        system: 'main_engine',
        check: () => {
            const gov = window.sys?.equipmentPool?.get('governor-01');
            return gov && gov.state.fuelCommand === 0;
        },
        trigger: () => {
            const gov = getDev(window.sys, 'governor-01');
            if (gov) {
                gov.state.fuelCommand = 0;
                gov.state.setRpm = 0;
                setAlarm(window.sys, 'governor-01', '调速器故障');
            }
        },
        repair: () => {
            const gov = getDev(window.sys, 'governor-01');
            if (gov) {
                gov.state.fuelCommand = 50;
                gov.state.setRpm = 120;
                clearAlarm(window.sys, 'governor-01', '调速器故障');
            }
        },
    },

    // ── 压缩空气系统故障 ──
    'fault-air-low': {
        id: 'fault-air-low',
        name: '气瓶压力不足',
        system: 'compressed_air',
        check: () => {
            const bottle = window.sys?.equipmentPool?.get('air-bottle-main');
            return bottle && bottle.state.pressure < 1.0;
        },
        trigger: () => {
            const bottle = getDev(window.sys, 'air-bottle-main');
            if (bottle) {
                bottle.state.pressure = 0.5;
                setAlarm(window.sys, 'air-bottle-main', '气瓶压力低');
            }
        },
        repair: () => {
            const bottle = getDev(window.sys, 'air-bottle-main');
            if (bottle) {
                bottle.state.pressure = 2.5;
                clearAlarm(window.sys, 'air-bottle-main', '气瓶压力低');
            }
        },
    },
};
