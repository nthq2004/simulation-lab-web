/**
 * PreBuiltScenarios - 预置工况场景库
 * 为船舶机舱数字孪生系统提供 5 种典型工况场景
 */
export const PRE_BUILT_SCENARIOS = [
    // ─── 1. 正常巡航 ───────────────────────────────────────────
    {
        id: 'normal_cruise',
        name: '正常巡航',
        description: '主机在额定转速下稳定运行，发电机正常供电，各辅助系统正常工作。',
        states: {
            'me-01':            { running: true, speed: 120, load: 70 },
            'governor-01':      { running: true, setRpm: 120, actualRpm: 120, fuelCommand: 45 },
            'gen-01':           { running: true, voltage: 400, frequency: 50 },
            'switchboard-01':   { energized: true, busVoltage: 400 },
            'pump-sw-01':       { running: true, speed: 1450 },
            'pump-fw-01':       { running: true, speed: 1450 },
            'hx-01':            { running: true, efficiency: 0.85 },
            'pump-hfo-01':      { running: true, speed: 1200 },
            'compressor-01':    { running: true, pressure: 2.5 },
            'air-bottle-main':  { pressure: 2.5, level: 85 },
            'purifier-01':      { running: true },
        },
    },

    // ─── 2. 备车状态 ───────────────────────────────────────────
    {
        id: 'standby',
        name: '备车状态',
        description: '主机尚未起动，由岸电供电，辅助系统低速运行，压缩空气系统已准备好。',
        states: {
            'me-01':            { running: false, speed: 0 },
            'gen-01':           { running: false },
            'switchboard-01':   { energized: true, busVoltage: 400 },
            'pump-sw-01':       { running: true, speed: 500 },
            'pump-fw-01':       { running: true, speed: 500 },
            'compressor-01':    { running: true, pressure: 2.5 },
            'air-bottle-main':  { pressure: 2.5, level: 80 },
        },
    },

    // ─── 3. 紧急停车 ───────────────────────────────────────────
    {
        id: 'emergency_stop',
        name: '紧急停车',
        description: '全船失电，所有设备停止运行，主配电板失电，压缩空气压力正在下降。',
        states: {
            'me-01':            { running: false, speed: 0, load: 0 },
            'governor-01':      { running: false },
            'pump-sw-01':       { running: false, speed: 0 },
            'pump-fw-01':       { running: false, speed: 0 },
            'pump-hfo-01':      { running: false, speed: 0 },
            'compressor-01':    { running: false, pressure: 1.0 },
            'gen-01':           { running: false, voltage: 0 },
            'switchboard-01':   { energized: false, busVoltage: 0 },
        },
    },

    // ─── 4. 发电机并车 ─────────────────────────────────────────
    {
        id: 'generator_parallel',
        name: '发电机并车',
        description: '主机运行，发电机投入并车操作，配电板带电，冷却系统全速运行。',
        states: {
            'me-01':            { running: true, speed: 120, load: 60 },
            'governor-01':      { running: true, setRpm: 120, actualRpm: 120 },
            'gen-01':           { running: true, voltage: 400, frequency: 50 },
            'switchboard-01':   { energized: true, busVoltage: 400 },
            'pump-sw-01':       { running: true, speed: 1450 },
            'pump-fw-01':       { running: true, speed: 1450 },
        },
    },

    // ─── 5. 冷却水故障 ─────────────────────────────────────────
    {
        id: 'cooling_fault',
        name: '冷却水故障',
        description: '海水泵故障停止，淡水泵转速下降，换热器效率降低，主机被迫降负荷运行。',
        states: {
            'me-01':            { running: true, speed: 100, load: 50 },
            'governor-01':      { running: true, setRpm: 100, actualRpm: 100 },
            'pump-sw-01':       { running: false, speed: 0 },
            'pump-fw-01':       { running: true, speed: 800 },
            'hx-01':            { running: true, efficiency: 0.4 },
        },
    },
];
