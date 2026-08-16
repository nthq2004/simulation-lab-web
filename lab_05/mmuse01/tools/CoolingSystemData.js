/**
 * CoolingSystemData - 冷却水系统设备配置
 * 供 EquipmentPool 和 3D/2D 渲染层使用
 */
export const COOLING_SYSTEM_DEVICES = [
    {
        id: 'pump-sw-01',
        type: 'pump',
        label: '海水泵',
        system: 'cooling',
        sensors: {
            outletPress: { label: '出口压力', unit: 'kPa', default: 0, min: 0, max: 500, alarmLow: 50 },
            motorCurrent: { label: '电机电流', unit: 'A', default: 0, min: 0, max: 100 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, speed: 0 },
    },
    {
        id: 'pump-fw-01',
        type: 'pump',
        label: '淡水泵',
        system: 'cooling',
        sensors: {
            outletPress: { label: '出口压力', unit: 'kPa', default: 0, min: 0, max: 500, alarmLow: 50 },
            motorCurrent: { label: '电机电流', unit: 'A', default: 0, min: 0, max: 100 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, speed: 0 },
    },
    {
        id: 'hx-01',
        type: 'heat_exchanger',
        label: '板式换热器',
        system: 'cooling',
        sensors: {
            fwInTemp: { label: '淡水进口温度', unit: '°C', default: 25, min: 0, max: 100 },
            fwOutTemp: { label: '淡水出口温度', unit: '°C', default: 25, min: 0, max: 100 },
            swInTemp: { label: '海水进口温度', unit: '°C', default: 20, min: 0, max: 60 },
            swOutTemp: { label: '海水出口温度', unit: '°C', default: 20, min: 0, max: 60 },
        },
        initialState: { duty: 0 },
    },
    {
        id: 'valve-sw-01',
        type: 'valve',
        label: '海水进口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'valve-sw-02',
        type: 'valve',
        label: '海水出口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'valve-fw-01',
        type: 'valve',
        label: '淡水进口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'valve-fw-02',
        type: 'valve',
        label: '淡水出口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'temp-fw-in',
        type: 'temperature_sensor',
        label: '淡水进口温度',
        system: 'cooling',
        sensors: {
            value: { label: '温度', unit: '°C', default: 25, min: 0, max: 100, alarmHigh: 55 },
        },
        initialState: { value: 25 },
    },
    {
        id: 'temp-fw-out',
        type: 'temperature_sensor',
        label: '淡水出口温度',
        system: 'cooling',
        sensors: {
            value: { label: '温度', unit: '°C', default: 25, min: 0, max: 100, alarmHigh: 60 },
        },
        initialState: { value: 25 },
    },
];
