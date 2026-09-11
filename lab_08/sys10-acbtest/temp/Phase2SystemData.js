/**
 * Phase2SystemData - Phase 2 全部系统设备配置
 * 主动力系统 / 电站系统 / 燃油滑油系统 / 压缩空气系统
 */
export const MAIN_ENGINE_DEVICES = [
    {
        id: 'me-01',
        type: 'diesel_engine',
        label: '主机',
        system: 'main_engine',
        sensors: {
            rpm: { label: '转速', unit: 'rpm', default: 0, min: 0, max: 200, alarmHigh: 180 },
            exhaustTemp: { label: '排气温度', unit: '°C', default: 30, min: 0, max: 600, alarmHigh: 500 },
            coolantTemp: { label: '冷却水温', unit: '°C', default: 25, min: 0, max: 100, alarmHigh: 90 },
            oilPress: { label: '滑油压力', unit: 'kPa', default: 0, min: 0, max: 500, alarmLow: 100 },
            fuelRate: { label: '喷油量', unit: '%', default: 0, min: 0, max: 100 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
            speedSet: { label: '转速设定', default: 0, min: 0, max: 200 },
        },
        initialState: { running: false, speed: 0, load: 0 },
    },
    {
        id: 'governor-01',
        type: 'governor',
        label: '调速器',
        system: 'main_engine',
        sensors: {
            actualRpm: { label: '实际转速', unit: 'rpm', default: 0, min: 0, max: 200 },
            setRpm: { label: '设定转速', unit: 'rpm', default: 0, min: 0, max: 200 },
            fuelCommand: { label: '油门指令', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { running: false, setRpm: 0, actualRpm: 0, fuelCommand: 0 },
    },
];

export const GENERATOR_DEVICES = [
    {
        id: 'gen-01',
        type: 'generator',
        label: '1号发电机组',
        system: 'power_station',
        sensors: {
            voltage: { label: '电压', unit: 'V', default: 0, min: 0, max: 450, alarmHigh: 440 },
            current: { label: '电流', unit: 'A', default: 0, min: 0, max: 500 },
            frequency: { label: '频率', unit: 'Hz', default: 0, min: 0, max: 60, alarmHigh: 52 },
            power: { label: '功率', unit: 'kW', default: 0, min: 0, max: 500 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, voltage: 0, frequency: 0 },
    },
    {
        id: 'switchboard-01',
        type: 'switchboard',
        label: '主配电板',
        system: 'power_station',
        sensors: {
            busVoltage: { label: '母线电压', unit: 'V', default: 0, min: 0, max: 450 },
            busCurrent: { label: '母线电流', unit: 'A', default: 0, min: 0, max: 1000 },
            busFrequency: { label: '母线频率', unit: 'Hz', default: 0, min: 0, max: 60 },
        },
        initialState: { energized: false, busVoltage: 0 },
    },
];

export const FUEL_OIL_DEVICES = [
    {
        id: 'tank-hfo-01',
        type: 'fuel_tank',
        label: '重油仓',
        system: 'fuel_oil',
        sensors: {
            level: { label: '液位', unit: '%', default: 80, min: 0, max: 100, alarmLow: 10 },
            temperature: { label: '温度', unit: '°C', default: 50, min: 0, max: 100 },
        },
        actuators: {
            outletValve: { label: '出口阀', default: 0, min: 0, max: 1 },
        },
        initialState: { level: 80, temperature: 50 },
    },
    {
        id: 'tank-doa-01',
        type: 'fuel_tank',
        label: '日用油柜',
        system: 'fuel_oil',
        sensors: {
            level: { label: '液位', unit: '%', default: 60, min: 0, max: 100, alarmLow: 20 },
            temperature: { label: '温度', unit: '°C', default: 60, min: 0, max: 120 },
        },
        actuators: {
            outletValve: { label: '出口阀', default: 0, min: 0, max: 1 },
        },
        initialState: { level: 60, temperature: 60 },
    },
    {
        id: 'purifier-01',
        type: 'oil_separator',
        label: '分油机',
        system: 'fuel_oil',
        sensors: {
            running: { label: '运行状态', unit: '', default: 0, min: 0, max: 1 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false },
    },
    {
        id: 'pump-hfo-01',
        type: 'pump',
        label: '燃油输送泵',
        system: 'fuel_oil',
        sensors: {
            outletPress: { label: '出口压力', unit: 'kPa', default: 0, min: 0, max: 1000 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, speed: 0 },
    },
];

export const COMPRESSED_AIR_DEVICES = [
    {
        id: 'compressor-01',
        type: 'air_compressor',
        label: '主空压机',
        system: 'compressed_air',
        sensors: {
            outletPress: { label: '出口压力', unit: 'MPa', default: 0, min: 0, max: 3.0 },
            running: { label: '运行状态', unit: '', default: 0, min: 0, max: 1 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, pressure: 0 },
    },
    {
        id: 'air-bottle-main',
        type: 'air_bottle',
        label: '主气瓶',
        system: 'compressed_air',
        sensors: {
            pressure: { label: '压力', unit: 'MPa', default: 0, min: 0, max: 3.0, alarmLow: 1.5 },
            volume: { label: '容积', unit: 'L', default: 2000, min: 0, max: 5000 },
        },
        initialState: { pressure: 0 },
    },
    {
        id: 'air-distributor-01',
        type: 'air_distributor',
        label: '空气分配器',
        system: 'compressed_air',
        sensors: {
            supplyPress: { label: '供给压力', unit: 'MPa', default: 0, min: 0, max: 3.0 },
        },
        actuators: {
            startAir: { label: '起动空气', default: 0, min: 0, max: 1 },
            controlAir: { label: '控制空气', default: 0, min: 0, max: 1 },
        },
        initialState: { supplyPress: 0, startAirOpen: false, controlAirOpen: false },
    },
];

/** 全系统统一列表 */
export const PHASE2_ALL_DEVICES = [
    ...MAIN_ENGINE_DEVICES,
    ...GENERATOR_DEVICES,
    ...FUEL_OIL_DEVICES,
    ...COMPRESSED_AIR_DEVICES,
];
