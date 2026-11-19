/**
 * KChiefSolver — 船舶机舱监视报警系统（Kongsberg K-Chief 600）过程模型
 * ═══════════════════════════════════════════════════════════════
 *  本模型只管"数据"，不画图：
 *    · 6 个监测点（tag）：测量值、报警方向、设定值、延时、死区、优先级、报警组、闭锁
 *    · 报警状态机（K-Chief 600 规则）：
 *        正常 →（越限并持续超过延时）→ 未确认 UNACK（闪 + 鸣响）
 *             →（按下 ACK）→ 已确认 ACK（常亮，仍报）
 *             →（测量值回到死区外）→ 报警消失；若尚未确认则先变"已恢复正常 RTN"
 *    · 报警组与延伸报警：ME/AUX/BILGE 三组可延伸到驾驶台与当班轮机员值班面板
 *    · 值班与呼叫：On Watch（BRIDGE / ECR）、当班轮机员（Duty）、
 *      Call All Engineer（呼叫全体轮机员）、Call Duty Engineer（呼叫值班轮机员）
 *
 *  组件侧：
 *    components/KChiefConsole.js     读 tags/alarms 绘制主界面
 *    components/ExtensionAlarmUnit.js 读 stationState() 绘制 6 块值班面板
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * 报警组（K-Chief 的 alarm group）——左侧 UnDock 报警组列表逐组显示未确认报警数。
 * extend=true：该组报警延伸到驾驶室与当班轮机员值班面板。
 * cn：中文组名（提示与表格视图中使用）。
 */
export const ALARM_GROUPS = {
    'ME-GEN':      { name: 'M/E GENERAL',        cn: '主机总用',          extend: true },
    'ME-CFW':      { name: 'M/E COOL FW SYS',    cn: '主机高温冷却水',    extend: true },
    'ME-PCOOL':    { name: 'M/E PISTON COOL',    cn: '主机活塞冷却',      extend: true },
    'ME-CSW':      { name: 'M/E COOL SW SYS',    cn: '主机海水冷却',      extend: true },
    'ME-LO':       { name: 'M/E LO SYSTEM',      cn: '主机滑油系统',      extend: true },
    'ME-FO':       { name: 'M/E FO SYSTEM',      cn: '主机燃油系统',      extend: true },
    'ME-EXH':      { name: 'M/E EXH GAS SYST',   cn: '主机排气系统',      extend: true },
    'ME-AIR':      { name: 'M/E AIR SYSTEM',     cn: '主机空气系统',      extend: true },
    'AUX-BOILER':  { name: 'AUX BOILER',         cn: '辅锅炉',            extend: true },
    'FIRE':        { name: 'FIRE SYSTEM',        cn: '消防系统',          extend: true },
    'POWER':       { name: 'POWER STATION',      cn: '电站',              extend: true },
    'DG1':         { name: 'NO.1 D/G',           cn: '1# 发电机组',       extend: true },
    'DG2':         { name: 'NO.2 D/G',           cn: '2# 发电机组',       extend: true },
    'DG3':         { name: 'NO.3 D/G',           cn: '3# 发电机组',       extend: true },
    'IGS':         { name: 'IGS, COP & WBP SYS', cn: '惰气、货油泵与压载泵', extend: true },
    'MISC':        { name: 'MISCELLANEOUS',      cn: '其他杂用',          extend: true },
    'TANK':        { name: 'TANK LEVEL',         cn: '舱柜液位',          extend: true },
    'AUX-MACH':    { name: 'AUX MACHINERY',      cn: '辅机',              extend: true },
    'HOUR':        { name: 'RUNNING HOUR',       cn: '运行小时',          extend: true },
};

/** 允许在「标签参数设置」中指定的报警组（19 个组都有监测点，可循环切换） */
export const SETTABLE_GROUPS = Object.keys(ALARM_GROUPS);

/** 报警优先级：A 报警（红）/ B 注意（橙）/ C 警告（黄） */
export const PRIORITIES = {
    A: { name: 'A 报警', color: '#e01b1b' },
    B: { name: 'B 注意', color: '#e08a00' },
    C: { name: 'C 警告', color: '#c9a800' },
};

/** 延伸报警面板（值班面板）定义 */
export const STATIONS = [
    { id: 'bridge', title: '驾驶室', sub: '（值班面板）', role: '值班驾驶员', bridge: true },
    { id: 'chief',  title: '轮机长', sub: '（值班面板）', role: '轮机长' },
    { id: 'first',  title: '大管轮', sub: '（值班面板）', role: '大管轮' },
    { id: 'second', title: '二管轮', sub: '（值班面板）', role: '二管轮' },
    { id: 'third',  title: '三管轮', sub: '（值班面板）', role: '三管轮' },
    { id: 'elec',   title: '电机员', sub: '（值班面板）', role: '电机员' },
];

/**
 * 监测点（tag）出厂参数
 *   dir  : 'low' 低限报警 / 'high' 高限报警
 *   span : 量程（用于量程百分比与设定值步进）
 *   en   : 英文报警描述（最新警报横幅 / 列表用）
 *   opt  : { db 死区, delay 延时(s), prio 优先级, step 步长, fault 故障注入值 }
 */
/** 报警功能号前缀（测量类型）：压力 PI / 流量 QI / 液位 LI / 温度 TI，其余 XI */
const fnPrefix = (name) => {
    if (/压力/.test(name)) return 'P';
    if (/流量/.test(name)) return 'Q';
    if (/(液位|水位|高位|低位)/.test(name)) return 'L';
    if (/(温度|露点)/.test(name)) return 'T';
    return 'X';
};

/** 报警功能号后缀：高报警 AH / 低报警 AL（如需 AHH / ALL 等特殊后缀，用 opt.fn 直接指定） */
const fnSuffix = (dir) => (dir === 'high' ? 'AH' : 'AL');

const T = (id, name, en, group, unit, dir, limit, normal, span, opt = {}) => {
    const spanW = span[1] - span[0];
    return {
        id, name, en, group, unit, dir, limit, normal, span,
        deadband: opt.db != null ? opt.db : Math.max(spanW * 0.004, Math.abs(limit) * (dir === 'low' ? 0.04 : 0.02)),
        delay: opt.delay != null ? opt.delay : 3,
        prio: opt.prio || 'B',
        step: opt.step != null ? opt.step : Math.max(Math.round(spanW) / 100, 0.01),
        faultVal: opt.fault != null ? opt.fault : (dir === 'low' ? limit * 0.55 : limit * 1.15),
        // 报警功能号：如 PIAL（压力低报警）/ TIAH（温度高报警）；opt.fn 可指定特殊功能号
        fn: opt.fn || (fnPrefix(name) + 'I' + fnSuffix(dir)),
        // 安保动作：AHH（高高）/ ALL（低低）触发主机自动停车 SHD 或自动减速 SLD；
        // 可在延时内按 Cancel SHD / Cancel SLD 越控（记入 Overridden tags）
        safety: opt.safety !== undefined ? opt.safety
            : ((opt.prio || 'B') === 'A' ? (dir === 'low' ? 'SHD' : 'SLD') : null),
        safetyDelay: opt.safetyDelay != null ? opt.safetyDelay : 5,   // 安保动作延时（s）
        enabled: opt.enabled !== false,     // Is Alarm：是否投入报警（No 时该测点不产生报警）
    };
};

/** 开关量报警测点：动作（1）即报警，无设定值 / 死区 */
const D = (id, name, en, group, opt = {}) => ({
    id, name, en, group, unit: '', dir: 'digital', digital: true,
    limit: 1, normal: 0, span: [0, 1], deadband: 0,
    delay: opt.delay != null ? opt.delay : 2,
    prio: opt.prio || 'B',
    step: 0,
    faultVal: 1,
    fn: 'XA',        // 接受外来的开关信号
    enabled: opt.enabled !== false,   // Is Alarm：是否投入报警
    // 开关量也可参与安保动作（如滑油低压开关 → 主机自动停车 SHD）；默认不参与
    safety: opt.safety !== undefined ? opt.safety : null,
    safetyDelay: opt.safetyDelay != null ? opt.safetyDelay : 5,
});

/**
 * 全船 19 个报警组、共 95 个典型监测点（每组 5 个）
 * 前 6 个（ME-LO-P / ME-CW-T / ME-FO-P / AUX-BLR-L / AUX-AC-T / BLG-LV）为教学示例测点，
 * 其设定值、延时、死区与工作流、故障设置一一对应，修改时需同步检查工作流 check()。
 */
export const ALARM_TAGS = [
    // ── ① M/E GENERAL 主机总用 ──
    T('ME-GEN-RPM', '主机转速', 'M/E SPEED HIGH', 'ME-GEN', 'r/min', 'high', 105, 88, [0, 130], { db: 2, delay: 2, prio: 'A', fault: 112 }),
    T('ME-GEN-LOAD', '主机负荷', 'M/E LOAD HIGH', 'ME-GEN', '%', 'high', 95, 78, [0, 110], { db: 2, delay: 5 }),
    T('ME-GEN-SAIR', '主机起动空气压力', 'M/E START AIR PRESS LOW', 'ME-GEN', 'MPa', 'low', 1.5, 2.4, [0, 3.5], { db: 0.05, delay: 5, prio: 'A' }),
    T('ME-GEN-TORQ', '主机轴扭矩', 'M/E SHAFT TORQUE HIGH', 'ME-GEN', '%', 'high', 100, 82, [0, 120], { db: 2, delay: 5 }),
    T('ME-GEN-SDEV', '主机转速偏差', 'M/E SPEED DEVIATION HIGH', 'ME-GEN', 'r/min', 'high', 5, 1, [0, 15], { db: 0.5, delay: 8, prio: 'C' }),
    D('ME-GEN-SHDN', '主机安全保护动作', 'M/E SAFETY SHUTDOWN ACTIVE', 'ME-GEN', { delay: 1, prio: 'A' }),
    D('ME-GEN-TRIP', '主机自动停车动作', 'M/E AUTO STOP ACTIVE', 'ME-GEN', { delay: 1, prio: 'A' }),
    D('ME-GEN-START-F', '主机起动失败', 'M/E START FAILURE', 'ME-GEN', { delay: 5, prio: 'B' }),

    // ── ② M/E COOL FW SYS 主机高温冷却水 ──
    T('ME-CW-T', '主机缸套冷却水出口温度', 'M/E CW OUTLET TEMP HIGH', 'ME-CFW', '℃', 'high', 88, 78, [0, 120], { db: 1.0, delay: 5, prio: 'A', step: 0.5, fault: 96 }),
    T('ME-CW-IN', '缸套水进口温度', 'M/E CW INLET TEMP HIGH', 'ME-CFW', '℃', 'high', 75, 62, [0, 100], { db: 1, delay: 5 }),
    T('ME-CW-P', '缸套水泵出口压力', 'M/E CW PUMP PRESS LOW', 'ME-CFW', 'MPa', 'low', 0.25, 0.38, [0, 0.6], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    T('ME-CW-EXP', '膨胀水箱水位', 'M/E CW EXP TANK LEVEL LOW', 'ME-CFW', '%', 'low', 40, 65, [0, 100], { db: 2, delay: 8 }),
    T('ME-CW-DP', '缸套水冷却器压差', 'M/E CW COOLER DP HIGH', 'ME-CFW', 'MPa', 'high', 0.12, 0.06, [0, 0.25], { db: 0.01, delay: 8, prio: 'C', step: 0.005 }),
    D('ME-CW-PUMP-F', '缸套水泵运行故障', 'M/E CW PUMP TRIP', 'ME-CFW', { delay: 2, prio: 'A' }),
    D('ME-CW-LVL-SW', '膨胀水箱低液位开关', 'M/E CW EXP TANK LEVEL LOW SW', 'ME-CFW', { delay: 2, prio: 'B' }),
    D('ME-CW-HI-T', '缸套水高温停车', 'M/E CW TEMP HIGH SHUTDOWN', 'ME-CFW', { delay: 1, prio: 'A' }),

    // ── ③ M/E PISTON COOL 主机活塞冷却 ──
    T('ME-PC-T', '活塞冷却油出口温度', 'M/E PISTON COOL OIL TEMP HIGH', 'ME-PCOOL', '℃', 'high', 65, 52, [0, 90], { db: 1, delay: 5 }),
    T('ME-PC-P', '活塞冷却油压力', 'M/E PISTON COOL OIL PRESS LOW', 'ME-PCOOL', 'MPa', 'low', 0.3, 0.45, [0, 0.8], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    T('ME-PC-FLOW', '活塞冷却油流量', 'M/E PISTON COOL FLOW LOW', 'ME-PCOOL', 'm³/h', 'low', 60, 85, [0, 120], { db: 2, delay: 5 }),
    T('ME-PC-TK', '活塞冷却油柜液位', 'M/E PISTON COOL TANK LEVEL LOW', 'ME-PCOOL', '%', 'low', 35, 60, [0, 100], { db: 2, delay: 8, prio: 'C' }),
    T('ME-PC-DP', '活塞冷却油滤器压差', 'M/E PISTON COOL FILTER DP HIGH', 'ME-PCOOL', 'MPa', 'high', 0.1, 0.04, [0, 0.2], { db: 0.01, delay: 8, prio: 'C', step: 0.005 }),
    D('ME-PC-PUMP-F', '活塞冷却泵故障', 'M/E PISTON COOL PUMP TRIP', 'ME-PCOOL', { delay: 2, prio: 'A' }),
    D('ME-PC-FLOW-SW', '活塞冷却流量低开关', 'M/E PISTON COOL FLOW LOW SW', 'ME-PCOOL', { delay: 2, prio: 'B' }),
    D('ME-PC-LVL-SW', '活塞冷却油柜低液位开关', 'M/E PISTON COOL TANK LOW SW', 'ME-PCOOL', { delay: 2, prio: 'C' }),

    // ── ④ M/E COOL SW SYS 主机海水冷却 ──
    T('ME-SW-P', '海水泵出口压力', 'M/E SW PUMP PRESS LOW', 'ME-CSW', 'MPa', 'low', 0.15, 0.28, [0, 0.5], { db: 0.01, delay: 3, step: 0.005 }),
    T('ME-SW-T', '海水出口温度', 'M/E SW OUTLET TEMP HIGH', 'ME-CSW', '℃', 'high', 45, 32, [0, 70], { db: 1, delay: 5 }),
    T('ME-SW-LT', '低温淡水进口温度', 'M/E LT FW INLET TEMP HIGH', 'ME-CSW', '℃', 'high', 38, 30, [0, 60], { db: 1, delay: 5, prio: 'C' }),
    T('ME-SW-DP', '海水滤器压差', 'M/E SW STRAINER DP HIGH', 'ME-CSW', 'MPa', 'high', 0.08, 0.03, [0, 0.15], { db: 0.005, delay: 8, prio: 'C', step: 0.005 }),
    T('ME-SW-FLOW', '海水流量', 'M/E SW FLOW LOW', 'ME-CSW', 'm³/h', 'low', 120, 180, [0, 300], { db: 3, delay: 5 }),
    D('ME-SW-PUMP-F', '海水泵故障', 'M/E SW PUMP TRIP', 'ME-CSW', { delay: 2, prio: 'B' }),
    D('ME-SW-FLOW-SW', '海水流量低开关', 'M/E SW FLOW LOW SW', 'ME-CSW', { delay: 2, prio: 'B' }),
    D('ME-SW-STR-SW', '海水滤器堵塞开关', 'M/E SW STRAINER BLOCKED', 'ME-CSW', { delay: 2, prio: 'C' }),

    // ── ⑤ M/E LO SYSTEM 主机滑油 ──
    T('ME-LO-P', '主机滑油进机压力', 'M/E LO INLET PRESS LOW', 'ME-LO', 'MPa', 'low', 0.25, 0.36, [0, 0.6], { db: 0.02, delay: 3, prio: 'A', step: 0.05, fault: 0.15 }),
    T('ME-LO-T', '滑油进机温度', 'M/E LO INLET TEMP HIGH', 'ME-LO', '℃', 'high', 55, 45, [0, 80], { db: 1, delay: 5 }),
    T('ME-LO-FILT', '滑油滤器压差', 'M/E LO FILTER DP HIGH', 'ME-LO', 'MPa', 'high', 0.12, 0.05, [0, 0.25], { db: 0.01, delay: 8, prio: 'C', step: 0.005 }),
    T('ME-LO-TK', '滑油循环柜液位', 'M/E LO CIRC TANK LEVEL LOW', 'ME-LO', '%', 'low', 40, 62, [0, 100], { db: 2, delay: 8 }),
    T('ME-LO-CYL', '气缸油柜液位', 'M/E CYL OIL TANK LEVEL LOW', 'ME-LO', '%', 'low', 30, 55, [0, 100], { db: 2, delay: 8 }),
    D('ME-LO-PUMP-F', '主滑油泵故障', 'M/E LO PUMP TRIP', 'ME-LO', { delay: 2, prio: 'A' }),
    // 压力继电器（YT1226）NC 触点闭合 = 低低压动作 → 安保延时 6 s 后自动停车；延时内触点断开则不动作
    D('ME-LO-PR-SW', '滑油低压开关', 'M/E LO PRESS LOW SW', 'ME-LO', { delay: 0, prio: 'A', safety: 'SHD', safetyDelay: 6 }),
    D('ME-LO-FILT-SW', '滑油滤器堵塞开关', 'M/E LO FILTER BLOCKED', 'ME-LO', { delay: 2, prio: 'C' }),

    // ── ⑥ M/E FO SYSTEM 主机燃油 ──
    T('ME-FO-P', '主机燃油进机压力', 'M/E FO INLET PRESS LOW', 'ME-FO', 'MPa', 'low', 0.30, 0.42, [0, 0.8], { db: 0.02, delay: 3, prio: 'B', step: 0.05, fault: 0.18 }),
    T('ME-FO-T', '燃油进机温度', 'M/E FO INLET TEMP HIGH', 'ME-FO', '℃', 'high', 135, 125, [0, 160], { db: 2, delay: 5 }),
    T('ME-FO-VISC', '燃油进机粘度', 'M/E FO VISCOSITY HIGH', 'ME-FO', 'cSt', 'high', 20, 14, [0, 30], { db: 0.5, delay: 10 }),
    T('ME-FO-FILT', '燃油滤器压差', 'M/E FO FILTER DP HIGH', 'ME-FO', 'MPa', 'high', 0.15, 0.06, [0, 0.3], { db: 0.01, delay: 8, prio: 'C', step: 0.005 }),
    T('ME-FO-TK', '燃油日用柜液位', 'M/E FO SETTLING TANK LEVEL LOW', 'ME-FO', '%', 'low', 25, 70, [0, 100], { db: 2, delay: 8, prio: 'A' }),
    D('ME-FO-PUMP-F', '燃油泵故障', 'M/E FO PUMP TRIP', 'ME-FO', { delay: 2, prio: 'A' }),
    D('ME-FO-PR-SW', '燃油低压开关', 'M/E FO PRESS LOW SW', 'ME-FO', { delay: 1, prio: 'A' }),
    D('ME-FO-LEAK', '燃油泄漏报警', 'M/E FO LEAK', 'ME-FO', { delay: 2, prio: 'A' }),

    // ── ⑦ M/E EXH GAS SYST 主机排气 ──
    T('ME-EXH-T1', '1# 缸排气温度', 'M/E CYL 1 EXH TEMP HIGH', 'ME-EXH', '℃', 'high', 420, 350, [0, 500], { db: 5, delay: 5 }),
    T('ME-EXH-DEV', '排气温度偏差', 'M/E EXH TEMP DEVIATION HIGH', 'ME-EXH', '℃', 'high', 45, 12, [0, 80], { db: 2, delay: 10 }),
    T('ME-EXH-TC-T', '增压器出口温度', 'M/E T/C OUTLET TEMP HIGH', 'ME-EXH', '℃', 'high', 380, 300, [0, 450], { db: 5, delay: 5 }),
    T('ME-EXH-TC-N', '增压器转速', 'M/E T/C SPEED HIGH', 'ME-EXH', 'r/min', 'high', 14000, 11000, [0, 18000], { db: 50, delay: 2, prio: 'A', step: 100 }),
    T('ME-EXH-BOIL', '废气锅炉蒸汽压力', 'M/E EXH BOILER STEAM PRESS HIGH', 'ME-EXH', 'MPa', 'high', 0.7, 0.5, [0, 1.0], { db: 0.02, delay: 5, step: 0.01 }),
    D('ME-EXH-TC-F', '增压器故障', 'M/E T/C TRIP', 'ME-EXH', { delay: 2, prio: 'B' }),
    D('ME-EXH-T-SW', '排气高温开关', 'M/E EXH TEMP HIGH SW', 'ME-EXH', { delay: 2, prio: 'A' }),
    D('ME-EXH-BLR-LVL', '废气锅炉低水位开关', 'M/E EXH BOILER LEVEL LOW SW', 'ME-EXH', { delay: 2, prio: 'B' }),

    // ── ⑧ M/E AIR SYSTEM 主机空气 ──
    T('ME-AIR-REC', '空气瓶压力', 'M/E AIR RECEIVER PRESS LOW', 'ME-AIR', 'MPa', 'low', 1.8, 2.8, [0, 3.5], { db: 0.05, delay: 5, prio: 'A' }),
    T('ME-AIR-CMP-T', '空压机排气温度', 'M/E AIR COMPR TEMP HIGH', 'ME-AIR', '℃', 'high', 95, 72, [0, 150], { db: 2, delay: 5 }),
    T('ME-AIR-CMP-P', '空压机出口压力', 'M/E AIR COMPR PRESS HIGH', 'ME-AIR', 'MPa', 'high', 3.2, 2.8, [0, 4], { db: 0.05, delay: 5, prio: 'C' }),
    T('ME-AIR-DEW', '空气干燥器露点', 'M/E AIR DRYER DEW POINT HIGH', 'ME-AIR', '℃', 'high', 5, -5, [-20, 20], { db: 1, delay: 10, prio: 'C', fault: 8 }),
    T('ME-AIR-CTRL', '控制空气压力', 'M/E CONTROL AIR PRESS LOW', 'ME-AIR', 'MPa', 'low', 0.5, 0.7, [0, 1.0], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    D('ME-AIR-CMP-F', '空压机故障', 'M/E AIR COMPR TRIP', 'ME-AIR', { delay: 2, prio: 'B' }),
    D('ME-AIR-PR-SW', '空气低压开关', 'M/E AIR PRESS LOW SW', 'ME-AIR', { delay: 1, prio: 'A' }),
    D('ME-AIR-DRY-F', '空气干燥器故障', 'M/E AIR DRYER FAULT', 'ME-AIR', { delay: 5, prio: 'C' }),

    // ── ⑨ AUX BOILER 辅锅炉 ──
    T('AUX-BLR-L', '辅锅炉水位', 'AUX BOILER WATER LEVEL LOW', 'AUX-BOILER', '%', 'low', 30, 55, [0, 100], { db: 2, delay: 8, prio: 'B', step: 1, fault: 12 }),
    T('AUX-BLR-P', '辅锅炉蒸汽压力', 'AUX BOILER STEAM PRESS LOW', 'AUX-BOILER', 'MPa', 'low', 0.4, 0.6, [0, 1.0], { db: 0.02, delay: 5, step: 0.01 }),
    T('AUX-BLR-PH', '辅锅炉蒸汽压力高', 'AUX BOILER STEAM PRESS HIGH', 'AUX-BOILER', 'MPa', 'high', 0.75, 0.6, [0, 1.0], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    T('AUX-BLR-FW', '辅锅炉给水温度', 'AUX BOILER FEED WATER TEMP LOW', 'AUX-BOILER', '℃', 'low', 60, 95, [0, 120], { db: 2, delay: 10, prio: 'C' }),
    T('AUX-BLR-SAL', '辅锅炉炉水盐度', 'AUX BOILER SALINITY HIGH', 'AUX-BOILER', 'ppm', 'high', 30, 8, [0, 60], { db: 1, delay: 10 }),
    D('AUX-BLR-FLAME', '辅锅炉火焰熄灭', 'AUX BOILER FLAME FAILURE', 'AUX-BOILER', { delay: 1, prio: 'A' }),
    D('AUX-BLR-VLVL', '辅锅炉极低水位', 'AUX BOILER VERY LOW LEVEL', 'AUX-BOILER', { delay: 1, prio: 'A' }),
    D('AUX-BLR-BRN-F', '辅锅炉燃烧器故障', 'AUX BOILER BURNER FAULT', 'AUX-BOILER', { delay: 2, prio: 'B' }),

    // ── ⑩ FIRE SYSTEM 消防 ──
    T('FIRE-PUMP-P', '消防泵出口压力', 'FIRE PUMP PRESS LOW', 'FIRE', 'MPa', 'low', 0.6, 0.85, [0, 1.2], { db: 0.03, delay: 3, prio: 'A', step: 0.01 }),
    T('FIRE-TANK-L', '消防水柜液位', 'FIRE WATER TANK LEVEL LOW', 'FIRE', '%', 'low', 50, 80, [0, 100], { db: 2, delay: 5, prio: 'A' }),
    T('FIRE-CO2-P', 'CO₂ 瓶组压力', 'CO2 BOTTLE PRESS LOW', 'FIRE', 'MPa', 'low', 4.0, 5.5, [0, 7], { db: 0.1, delay: 5, prio: 'A', step: 0.05 }),
    T('FIRE-SMOKE', '机舱烟雾浓度', 'ENGINE ROOM SMOKE HIGH', 'FIRE', '%/m', 'high', 15, 2, [0, 40], { db: 1, delay: 2, prio: 'A' }),
    T('FIRE-ROOM-T', '机舱环境温度', 'ENGINE ROOM TEMP HIGH', 'FIRE', '℃', 'high', 55, 32, [0, 80], { db: 1, delay: 10 }),
    D('FIRE-LOOP1', '1# 探测回路火警', 'FIRE LOOP 1 ALARM', 'FIRE', { delay: 1, prio: 'A' }),
    D('FIRE-LOOP2', '2# 探测回路火警', 'FIRE LOOP 2 ALARM', 'FIRE', { delay: 1, prio: 'A' }),
    D('FIRE-MCP', '手动报警按钮动作', 'FIRE MANUAL CALL POINT', 'FIRE', { delay: 1, prio: 'A' }),

    // ── ⑪ POWER STATION 电站 ──
    T('PW-BUS-V', '汇流排电压', 'MAIN BUS VOLTAGE LOW', 'POWER', 'V', 'low', 380, 400, [0, 450], { db: 3, delay: 3, prio: 'A', step: 2 }),
    T('PW-BUS-F', '汇流排频率', 'MAIN BUS FREQ LOW', 'POWER', 'Hz', 'low', 58, 60, [0, 65], { db: 0.2, delay: 3, prio: 'A', step: 0.1 }),
    T('PW-LOAD', '发电机总负荷', 'GENERATOR TOTAL LOAD HIGH', 'POWER', '%', 'high', 90, 65, [0, 110], { db: 2, delay: 5 }),
    T('PW-PF', '功率因数', 'POWER FACTOR LOW', 'POWER', '', 'low', 0.7, 0.85, [0, 1], { db: 0.02, delay: 10, prio: 'C', step: 0.01 }),
    T('PW-INSUL', '汇流排绝缘电阻', 'BUS INSULATION LOW', 'POWER', 'MΩ', 'low', 1.0, 5, [0, 10], { db: 0.1, delay: 5, prio: 'A', step: 0.1 }),
    D('PW-BLACKOUT', '全船失电', 'BLACKOUT', 'POWER', { delay: 1, prio: 'A' }),
    D('PW-DG-TRIP', '发电机跳闸', 'GENERATOR TRIP', 'POWER', { delay: 1, prio: 'A' }),
    D('PW-PREF-TRIP', '优先脱扣动作', 'PREFERENTIAL TRIP', 'POWER', { delay: 1, prio: 'B' }),

    // ── ⑫ NO.1 D/G 1# 发电机组 ──
    T('DG1-LO-P', '1# 发电机滑油压力', 'NO.1 D/G LO PRESS LOW', 'DG1', 'MPa', 'low', 0.25, 0.4, [0, 0.8], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    T('DG1-CW-T', '1# 发电机冷却水温度', 'NO.1 D/G CW TEMP HIGH', 'DG1', '℃', 'high', 85, 72, [0, 110], { db: 1, delay: 5 }),
    T('DG1-EXH-T', '1# 发电机排气温度', 'NO.1 D/G EXH TEMP HIGH', 'DG1', '℃', 'high', 480, 400, [0, 600], { db: 5, delay: 5 }),
    T('DG1-RPM', '1# 发电机转速', 'NO.1 D/G SPEED LOW', 'DG1', 'r/min', 'low', 580, 600, [0, 700], { db: 3, delay: 3, prio: 'A', step: 2 }),
    T('DG1-FO-P', '1# 发电机燃油压力', 'NO.1 D/G FO PRESS LOW', 'DG1', 'MPa', 'low', 0.2, 0.35, [0, 0.6], { db: 0.02, delay: 3, step: 0.01 }),
    D('DG1-TRIP', '1# 发电机跳闸', 'NO.1 D/G TRIP', 'DG1', { delay: 1, prio: 'A' }),
    D('DG1-LO-SW', '1# 发电机滑油低压开关', 'NO.1 D/G LO PRESS LOW SW', 'DG1', { delay: 1, prio: 'A' }),
    D('DG1-OVERLOAD', '1# 发电机过载', 'NO.1 D/G OVERLOAD', 'DG1', { delay: 2, prio: 'B' }),

    // ── ⑬ NO.2 D/G 2# 发电机组 ──
    T('DG2-LO-P', '2# 发电机滑油压力', 'NO.2 D/G LO PRESS LOW', 'DG2', 'MPa', 'low', 0.25, 0.4, [0, 0.8], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    T('DG2-CW-T', '2# 发电机冷却水温度', 'NO.2 D/G CW TEMP HIGH', 'DG2', '℃', 'high', 85, 72, [0, 110], { db: 1, delay: 5 }),
    T('DG2-EXH-T', '2# 发电机排气温度', 'NO.2 D/G EXH TEMP HIGH', 'DG2', '℃', 'high', 480, 400, [0, 600], { db: 5, delay: 5 }),
    T('DG2-RPM', '2# 发电机转速', 'NO.2 D/G SPEED LOW', 'DG2', 'r/min', 'low', 580, 600, [0, 700], { db: 3, delay: 3, prio: 'A', step: 2 }),
    T('DG2-FO-P', '2# 发电机燃油压力', 'NO.2 D/G FO PRESS LOW', 'DG2', 'MPa', 'low', 0.2, 0.35, [0, 0.6], { db: 0.02, delay: 3, step: 0.01 }),
    D('DG2-TRIP', '2# 发电机跳闸', 'NO.2 D/G TRIP', 'DG2', { delay: 1, prio: 'A' }),
    D('DG2-LO-SW', '2# 发电机滑油低压开关', 'NO.2 D/G LO PRESS LOW SW', 'DG2', { delay: 1, prio: 'A' }),
    D('DG2-OVERLOAD', '2# 发电机过载', 'NO.2 D/G OVERLOAD', 'DG2', { delay: 2, prio: 'B' }),

    // ── ⑭ NO.3 D/G 3# 发电机组 ──
    T('DG3-LO-P', '3# 发电机滑油压力', 'NO.3 D/G LO PRESS LOW', 'DG3', 'MPa', 'low', 0.25, 0.4, [0, 0.8], { db: 0.02, delay: 3, prio: 'A', step: 0.01 }),
    T('DG3-CW-T', '3# 发电机冷却水温度', 'NO.3 D/G CW TEMP HIGH', 'DG3', '℃', 'high', 85, 72, [0, 110], { db: 1, delay: 5 }),
    T('DG3-EXH-T', '3# 发电机排气温度', 'NO.3 D/G EXH TEMP HIGH', 'DG3', '℃', 'high', 480, 400, [0, 600], { db: 5, delay: 5 }),
    T('DG3-RPM', '3# 发电机转速', 'NO.3 D/G SPEED LOW', 'DG3', 'r/min', 'low', 580, 600, [0, 700], { db: 3, delay: 3, prio: 'A', step: 2 }),
    T('DG3-FO-P', '3# 发电机燃油压力', 'NO.3 D/G FO PRESS LOW', 'DG3', 'MPa', 'low', 0.2, 0.35, [0, 0.6], { db: 0.02, delay: 3, step: 0.01 }),
    D('DG3-TRIP', '3# 发电机跳闸', 'NO.3 D/G TRIP', 'DG3', { delay: 1, prio: 'A' }),
    D('DG3-LO-SW', '3# 发电机滑油低压开关', 'NO.3 D/G LO PRESS LOW SW', 'DG3', { delay: 1, prio: 'A' }),
    D('DG3-OVERLOAD', '3# 发电机过载', 'NO.3 D/G OVERLOAD', 'DG3', { delay: 2, prio: 'B' }),

    // ── ⑮ IGS, COP & WBP SYS 惰气、货油泵与压载泵 ──
    T('IGS-O2', '惰气含氧量', 'INERT GAS O2 HIGH', 'IGS', '%', 'high', 5, 3, [0, 12], { db: 0.3, delay: 5, prio: 'A', step: 0.1 }),
    T('IGS-P', '惰气压力', 'INERT GAS PRESS LOW', 'IGS', 'kPa', 'low', 0.3, 0.8, [0, 2], { db: 0.05, delay: 5, step: 0.01 }),
    T('IGS-SEAL', '甲板水封水位', 'DECK WATER SEAL LEVEL LOW', 'IGS', '%', 'low', 40, 70, [0, 100], { db: 2, delay: 8 }),
    T('COP-BRG-T', '货油泵轴承温度', 'CARGO PUMP BRG TEMP HIGH', 'IGS', '℃', 'high', 75, 55, [0, 110], { db: 2, delay: 5 }),
    T('WBP-FLOW', '压载泵流量', 'BALLAST PUMP FLOW LOW', 'IGS', 'm³/h', 'low', 200, 350, [0, 600], { db: 5, delay: 8, prio: 'C' }),
    D('IGS-O2-SW', '惰气含氧量高开关', 'INERT GAS O2 HIGH SW', 'IGS', { delay: 1, prio: 'A' }),
    D('IGS-PR-SW', '惰气低压开关', 'INERT GAS PRESS LOW SW', 'IGS', { delay: 2, prio: 'B' }),
    D('IGS-SEAL-SW', '甲板水封低液位开关', 'DECK WATER SEAL LOW SW', 'IGS', { delay: 2, prio: 'B' }),

    // ── ⑯ MISCELLANEOUS 其他杂用 ──
    T('BLG-LV', '舱底水高位', 'BILGE WATER LEVEL HIGH', 'MISC', '%', 'high', 80, 15, [0, 100], { db: 3, delay: 2, prio: 'A', step: 2, fault: 92 }),
    T('MISC-BLG-P', '舱底泵出口压力', 'BILGE PUMP PRESS LOW', 'MISC', 'MPa', 'low', 0.15, 0.3, [0, 0.5], { db: 0.01, delay: 3, step: 0.005 }),
    T('MISC-SEW', '生活污水柜液位', 'SEWAGE TANK LEVEL HIGH', 'MISC', '%', 'high', 85, 45, [0, 100], { db: 3, delay: 8 }),
    T('MISC-SLUDGE', '污油柜液位', 'SLUDGE TANK LEVEL HIGH', 'MISC', '%', 'high', 80, 35, [0, 100], { db: 3, delay: 8 }),
    T('MISC-HYD', '液压舵机压力', 'STEERING GEAR HYD PRESS LOW', 'MISC', 'MPa', 'low', 8, 12, [0, 18], { db: 0.2, delay: 3, prio: 'A', step: 0.1 }),
    D('MISC-BLG-SW', '舱底水高位开关', 'BILGE WATER HIGH LEVEL SW', 'MISC', { delay: 1, prio: 'A' }),
    D('MISC-EMCY-STOP', '机舱应急停止', 'ENGINE ROOM EMERGENCY STOP', 'MISC', { delay: 1, prio: 'A' }),
    D('MISC-QCV', '速闭阀动作', 'QUICK CLOSING VALVE ACTIVE', 'MISC', { delay: 1, prio: 'A' }),

    // ── ⑰ TANK LEVEL 舱柜液位 ──
    T('TK-HFO', '重油舱液位', 'HFO TANK LEVEL LOW', 'TANK', '%', 'low', 15, 65, [0, 100], { db: 2, delay: 10 }),
    T('TK-DO', '柴油舱液位', 'DO TANK LEVEL LOW', 'TANK', '%', 'low', 15, 70, [0, 100], { db: 2, delay: 10 }),
    T('TK-LO', '滑油储存舱液位', 'LO STORAGE TANK LEVEL LOW', 'TANK', '%', 'low', 10, 60, [0, 100], { db: 2, delay: 10, prio: 'C' }),
    T('TK-FW', '淡水舱液位', 'FW TANK LEVEL LOW', 'TANK', '%', 'low', 20, 75, [0, 100], { db: 2, delay: 10 }),
    T('TK-SLUDGE', '污油舱液位', 'SLUDGE TANK LEVEL HIGH', 'TANK', '%', 'high', 85, 30, [0, 100], { db: 3, delay: 8 }),
    D('TK-HFO-HI', '重油舱高液位开关', 'HFO TANK HIGH LEVEL SW', 'TANK', { delay: 2, prio: 'B' }),
    D('TK-FW-LO', '淡水舱低液位开关', 'FW TANK LOW LEVEL SW', 'TANK', { delay: 2, prio: 'B' }),
    D('TK-OVERFLOW', '舱柜溢流报警', 'TANK OVERFLOW', 'TANK', { delay: 2, prio: 'A' }),

    // ── ⑱ AUX MACHINERY 辅机 ──
    T('AUX-AC-T', '主空压机排气温度', 'AUX AIR COMPR TEMP HIGH', 'AUX-MACH', '℃', 'high', 95, 72, [0, 150], { db: 2, delay: 5, prio: 'B', step: 1, fault: 108 }),
    T('AUX-AC-P', '空压机出口压力', 'AUX AIR COMPR PRESS HIGH', 'AUX-MACH', 'MPa', 'high', 3.0, 2.6, [0, 4], { db: 0.05, delay: 5, prio: 'C' }),
    T('AUX-SEP-T', '分油机出口温度', 'SEPARATOR OUTLET TEMP HIGH', 'AUX-MACH', '℃', 'high', 98, 90, [0, 130], { db: 1, delay: 5 }),
    T('AUX-SEP-P', '分油机进口压力', 'SEPARATOR INLET PRESS LOW', 'AUX-MACH', 'MPa', 'low', 0.15, 0.3, [0, 0.5], { db: 0.01, delay: 3, step: 0.005 }),
    T('AUX-REF-T', '冷库温度', 'COLD ROOM TEMP HIGH', 'AUX-MACH', '℃', 'high', -12, -18, [-30, 10], { db: 1, delay: 10, prio: 'C', fault: -8 }),
    D('AUX-SEP-F', '分油机故障', 'SEPARATOR FAULT', 'AUX-MACH', { delay: 2, prio: 'B' }),
    D('AUX-REF-F', '冷库压缩机故障', 'COLD ROOM COMPR FAULT', 'AUX-MACH', { delay: 2, prio: 'B' }),
    D('AUX-PUMP-F', '辅机泵故障', 'AUX MACHINERY PUMP TRIP', 'AUX-MACH', { delay: 2, prio: 'C' }),

    // ── ⑲ RUNNING HOUR 运行小时 ──
    T('HR-ME', '主机运行小时', 'M/E RUNNING HOUR HIGH', 'HOUR', 'h', 'high', 500, 320, [0, 1000], { db: 5, delay: 1, prio: 'C', step: 5 }),
    T('HR-DG1', '1# 发电机运行小时', 'NO.1 D/G RUNNING HOUR HIGH', 'HOUR', 'h', 'high', 500, 210, [0, 1000], { db: 5, delay: 1, prio: 'C', step: 5 }),
    T('HR-DG2', '2# 发电机运行小时', 'NO.2 D/G RUNNING HOUR HIGH', 'HOUR', 'h', 'high', 500, 180, [0, 1000], { db: 5, delay: 1, prio: 'C', step: 5 }),
    T('HR-BLR', '辅锅炉运行小时', 'AUX BOILER RUNNING HOUR HIGH', 'HOUR', 'h', 'high', 400, 150, [0, 1000], { db: 5, delay: 1, prio: 'C', step: 5 }),
    T('HR-SEP', '分油机运行小时', 'SEPARATOR RUNNING HOUR HIGH', 'HOUR', 'h', 'high', 300, 90, [0, 1000], { db: 5, delay: 1, prio: 'C', step: 5 }),
    D('HR-ME-SVC', '主机保养到期', 'M/E MAINTENANCE DUE', 'HOUR', { delay: 1, prio: 'C' }),
    D('HR-DG-SVC', '发电机保养到期', 'D/G MAINTENANCE DUE', 'HOUR', { delay: 1, prio: 'C' }),
    D('HR-BLR-SVC', '辅锅炉保养到期', 'AUX BOILER MAINTENANCE DUE', 'HOUR', { delay: 1, prio: 'C' }),

    // ── ⑳ 轮机员安全系统（Dead Man System，由 DeadmanPanel 组件驱动）──
    D('DEADMAN', '轮机员安全系统报警', 'DEADMAN ALARM', 'MISC', { delay: 0, prio: 'A' }),
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 失职（重复 Repeat）报警延时的默认值（s）：可在「报警参数」界面 Repeat delay 行修改 */
export const DEFAULT_REPEAT_DELAY = 180;

/** 时间戳：11:25:10（报警/事件列表用） */
function stamp(d) {
    const t = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/** 日期时间：13 Nov 2026 11:25:10（顶栏时钟用） */
export function dateTimeText(d) {
    const t = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(t.getDate())} ${MONTHS[t.getMonth()]} ${t.getFullYear()} ${stamp(t)}`;
}

export class KChiefSolver {
    constructor(sys) {
        this.sys = sys;
        this.reset();
    }

    // ═══════════════════════════════════════════════════════
    //  初始化 / 复位
    // ═══════════════════════════════════════════════════════
    reset() {
        this.t = 0;

        /** 监测点（含出厂参数副本 initial，供「标签恢复初值」使用） */
        this.tags = ALARM_TAGS.map(cfg => ({
            ...cfg,
            initial: {
                dir: cfg.dir, limit: cfg.limit, deadband: cfg.deadband,
                delay: cfg.delay, prio: cfg.prio, group: cfg.group,
            },
            value: cfg.normal,      // 一阶趋近的过程量
            display: cfg.normal,    // 显示值（含微小波动）
            timer: 0,               // 越限持续时间（判延时）
            inhibit: false,         // 闭锁（Inhibit）
            override: false,        // 越控（Override）
            fault: false,           // 故障注入（过程量被强制拉向 faultVal）
        }));

        this.alarms = [];      // 当前报警（state: UNACK / ACK / RTN）
        this.history = [];     // 报警历史（已确认且已消失）
        this.events = [];      // 事件日志
        this._safetyTimers = {};   // 安保动作延时计时：tagId → 剩余秒
        this.safetyActions = [];   // 已执行的安保动作 {tagId, type, t}
        this.overrides = [];       // 越控记录（Overridden tags）{tagId, fn, type, t, ts, name}

        this.watch = 'ECR';         // On Watch 值班位置：BRIDGE / ECR
        this.dutyPanel = null;      // 当班轮机员（值班面板 id）；null = 目前无人值班
        this.callTarget = null;     // 正在呼叫的轮机员（Watch calling 对话框）
        this.pendingDuty = null;    // 已应答、等待原值班者交班的接班者（交接中）
        this.repeatDelay = DEFAULT_REPEAT_DELAY;   // 失职（重复）报警延时（s），可在参数界面设置
        this.repeatActive = false;  // 失职（重复）报警：驾驶台与轮机长面板显示 REPEAT
        this._repeatStart = null;   // 报警出现后、值班面板尚未确认的起始时刻
        this._masterRepeatStart = null;  // 值班面板消音后、主站尚未确认的起始时刻
        this.call = null;           // 'all' | 'duty' | null
        this.callTimer = 0;
        this.silenced = false;      // 主界面蜂鸣器已消音
        this.extMuted = {};         // 各延伸面板本地静音
        this._seq = 0;
        this.deadmanActive = false;   // 轮机员安全系统 DEADMAN 报警（由 DeadmanPanel 驱动）
    }

    // ═══════════════════════════════════════════════════════
    //  查询
    // ═══════════════════════════════════════════════════════
    tag(tagId) { return this.tags.find(t => t.id === tagId) || null; }

    alarmOf(tagId) { return this.alarms.find(a => a.tagId === tagId) || null; }

    /** 未确认报警数（含"已恢复正常未确认"） */
    unackCount() { return this.alarms.filter(a => a.state === 'UNACK' || a.state === 'RTN').length; }

    /** 报警总数（活动报警） */
    activeCount() { return this.alarms.length; }

    /** 某报警组的活动报警数（含已确认、故障未排除仍在列表中的报警） */
    groupActive(group) { return this.alarms.filter(a => a.group === group).length; }

    /** 某报警组的未确认数 */
    groupUnack(group) {
        return this.alarms.filter(a => a.group === group && (a.state === 'UNACK' || a.state === 'RTN')).length;
    }

    /** 主界面是否需要鸣响 */
    get buzzer() { return this.unackCount() > 0 && !this.silenced; }

    /** 报警状态中文 */
    static stateText(state) {
        return state === 'UNACK' ? '未确认' : (state === 'ACK' ? '已确认' : (state === 'RTN' ? '已恢复正常' : '—'));
    }

    // ═══════════════════════════════════════════════════════
    //  过程仿真（20fps 由组件 tick 驱动）
    // ═══════════════════════════════════════════════════════
    solve(dt) {
        this.t += dt;
        for (const tag of this.tags) {
            const target = tag.fault ? tag.faultVal : tag.normal;
            // 一阶惯性趋近：模拟量约 2.5 s 时间常数；开关量约 0.4 s（触点动作）
            tag.value += (target - tag.value) * Math.min(1, dt / (tag.digital ? 0.4 : 2.5));
            // 微小波动，让读数"活着"，幅值小于死区，不会误触发（开关量不波动）
            const span = tag.span[1] - tag.span[0];
            const wob = tag.digital ? 0 : Math.sin(this.t * 1.6 + tag.id.length) * span * 0.0012;
            tag.display = tag.digital ? (tag.value >= 0.5 ? 1 : 0) : tag.value + wob;

            if (tag.inhibit || tag.enabled === false) { tag.timer = 0; continue; }

            const v = tag.display;
            const beyond = tag.digital ? tag.value >= 0.5
                : (tag.dir === 'low' ? v < tag.limit : v > tag.limit);
            const back = tag.digital ? tag.value < 0.5
                : (tag.dir === 'low' ? v > tag.limit + tag.deadband : v < tag.limit - tag.deadband);

            const al = this.alarmOf(tag.id);
            if (beyond) {
                if (!al) {
                    tag.timer += dt;
                    if (tag.timer >= tag.delay) this._raise(tag);
                } else if (al.state === 'RTN') {
                    // 已恢复正常但未确认，又再次越限 → 回到未确认
                    al.state = 'UNACK';
                    al.t = stamp();
                    this.silenced = false;
                    this._unmuteAll();
                }
            } else if (back) {
                tag.timer = 0;
                if (al) {
                    // 故障在安保延时内恢复（触点断开）→ 撤销尚未执行的安保动作
                    if (this._safetyTimers[tag.id] != null) {
                        delete this._safetyTimers[tag.id];
                        this._log(`安保延时取消：${tag.name} 已恢复正常，不执行自动动作`);
                    }
                    if (al.state === 'ACK') {
                        this._clear(tag.id);
                    } else {
                        al.state = 'RTN';
                        al.tRtn = stamp();
                    }
                }
            } else {
                tag.timer = 0;   // 停在死区内：保持现状（这就是"死区/回差"的作用）
            }
        }

        // ── 安保动作延时：到时间且未被越控 → 执行主机停车 / 减速 ──
        for (const tagId of Object.keys(this._safetyTimers)) {
            const left = this._safetyTimers[tagId] - dt;
            if (left > 0) { this._safetyTimers[tagId] = left; continue; }
            delete this._safetyTimers[tagId];
            const tag = this.tag(tagId);
            const al = this.alarmOf(tagId);
            if (tag && al && !al.override) {
                this.safetyActions.unshift({ tagId, type: tag.safety, t: stamp(), ts: Date.now(), name: tag.name });
                if (this.safetyActions.length > 20) this.safetyActions.pop();
                // 联锁到主机遥控模型：执行实际的停车 / 减速（MCU 主机的燃油切断）
                const ac = this.sys && this.sys.ac600;
                if (ac && typeof ac.safetyAction === 'function') ac.safetyAction(tag.safety, tagId);
                this._log(`安保动作：${tag.name} 触发主机${tag.safety === 'SHD' ? '自动停车' : '自动减速'}`);
            }
        }

        // ── 失职（重复 Repeat）报警：3 min 内面板未确认，或消音后 3 min 内主站未确认 ──
        if (this.unackCount() === 0) {
            this._repeatStart = null;
            this._masterRepeatStart = null;
            this.repeatActive = false;
        } else {
            const rd = this.repeatDelay || DEFAULT_REPEAT_DELAY;
            if (this._repeatStart !== null && this.t - this._repeatStart >= rd) {
                if (!this.repeatActive) this._log(`失职报警（Repeat）：值班面板 ${rd} s 未确认`);
                this.repeatActive = true;
            }
            if (this._masterRepeatStart !== null && this.t - this._masterRepeatStart >= rd) {
                if (!this.repeatActive) this._log(`失职报警（Repeat）：主站 ${rd} s 未确认`);
                this.repeatActive = true;
            }
        }

        if (this.call) {
            this.callTimer -= dt;
            // Call All：5 位轮机员都单独确认后结束
            if (this.call === 'all') {
                const allAcked = ['chief', 'first', 'second', 'third', 'elec']
                    .every(id => !!this.extMuted[id]);
                if (allAcked) { this.call = null; this.callTimer = 0; }
            }
            if (this.callTimer <= 0) { this.call = null; }
        }
    }

    _raise(tag) {
        this._seq += 1;
        this.alarms.push({
            tagId: tag.id,
            name: tag.name,
            en: tag.en || tag.name,
            group: tag.group,
            prio: tag.prio,
            dir: tag.dir,
            fn: tag.fn,
            limit: tag.limit,
            unit: tag.unit,
            value: tag.display,
            state: 'UNACK',
            t: stamp(),
            ts: Date.now(),
            seq: this._seq,
        });
        this.silenced = false;
        this._unmuteAll();
        if (this._repeatStart === null) this._repeatStart = this.t;   // 失职报警计时开始
        this._log(`报警产生：${tag.id} ${tag.name}`);
        // AHH / ALL 级报警启动安保动作延时（SHD 停车 / SLD 减速）
        if (tag.safety) {
            this._safetyTimers[tag.id] = tag.safetyDelay != null ? tag.safetyDelay : 5;
            this._log(`安保延时启动：${tag.name} → ${tag.safety === 'SHD' ? '自动停车' : '自动减速'}（可 Cancel 越控）`);
        }
    }

    _clear(tagId) {
        const i = this.alarms.findIndex(a => a.tagId === tagId);
        if (i < 0) return;
        const al = this.alarms[i];
        // 历史记录保留消失时的确认状态：
        //   ACK  → 已确认后故障消失（历史里显示 ✓ + A）
        //   RTN  → 故障先恢复、之后才确认（历史里显示 ⏎ + A）
        this.history.unshift({
            ...al,
            state: al.state === 'RTN' ? 'RTN' : 'ACK',
            tClear: stamp(),
            tsClear: Date.now(),
        });
        if (this.history.length > 40) this.history.pop();
        this.alarms.splice(i, 1);
        delete this._safetyTimers[tagId];
        this.overrides = this.overrides.filter(o => o.tagId !== tagId);
        this._log(`报警消失：${al.tagId} ${al.name}`);
    }

    // ═══════════════════════════════════════════════════════
    //  操作（主界面）
    // ═══════════════════════════════════════════════════════

    /** 确认全部报警（ACK）：未确认 → 已确认；已恢复正常 → 移除 */
    ackAll() {
        let n = 0;
        for (const al of [...this.alarms]) {
            if (al.state === 'UNACK') { al.state = 'ACK'; n += 1; }
            else if (al.state === 'RTN') { this._clear(al.tagId); n += 1; }
        }
        this.silenced = true;
        this._unmuteAll();
        // 主站确认后失职（重复）报警复位
        this.repeatActive = false;
        this._repeatStart = null;
        this._masterRepeatStart = null;
        this._log(n ? `报警确认（ACK）：${n} 条` : '报警确认（ACK）：无未确认报警');
        return n;
    }

    /**
     * 越控（Override）：在安保动作延时到之前按下 Cancel SHD / Cancel SLD，
     * 取消该 AHH/ALL 报警引起的自动停车 / 自动减速，并记入 Overridden tags。
     * 注意：越控只取消"安保动作"，报警本身仍然存在、仍需确认。
     * @param {'SHD'|'SLD'} type 取消哪一类安保动作
     * @returns {number} 本次越控的测点数
     */
    cancelSafety(type) {
        let n = 0;
        for (const tagId of Object.keys(this._safetyTimers)) {
            const tag = this.tag(tagId);
            if (!tag || tag.safety !== type) continue;
            const al = this.alarmOf(tagId);
            if (!al) { delete this._safetyTimers[tagId]; continue; }
            delete this._safetyTimers[tagId];
            al.override = true;
            this.overrides.unshift({
                tagId, fn: tag.fn, type, name: tag.name,
                t: stamp(), ts: Date.now(),
            });
            this._log(`安保越控：${tag.name}（${type === 'SHD' ? '自动停车' : '自动减速'}）已被 Cancel ${type} 取消`);
            n += 1;
        }
        return n;
    }

    /** 正在计时的安保动作（供界面显示） */
    get pendingSafety() {
        return Object.keys(this._safetyTimers).map(tagId => ({
            tagId, type: (this.tag(tagId) || {}).safety,
            left: this._safetyTimers[tagId],
        }));
    }

    /** 单独确认某一个测点的报警（参数界面 Acknowledge 按钮） */
    ackTag(tagId) {
        const al = this.alarmOf(tagId);
        if (!al) return false;
        if (al.state === 'UNACK') { al.state = 'ACK'; this.silenced = true; this._log(`单独确认：${al.tagId} ${al.name}`); return true; }
        if (al.state === 'RTN') { this._clear(tagId); this._log(`单独确认（已恢复）：${al.tagId} ${al.name}`); return true; }
        return false;
    }

    /** 消音（Silence）：停止蜂鸣，报警灯仍闪 */
    silence() {
        this.silenced = true;
        this._log('报警消音（Silence）');
    }

    /** 闭锁 / 解除闭锁（Inhibit tags） */
    inhibit(tagId, on) {
        const tag = this.tag(tagId);
        if (!tag) return;
        tag.inhibit = !!on;
        if (tag.inhibit) {
            // 闭锁后该点的报警立即消失，且不再产生新报警
            const al = this.alarmOf(tagId);
            if (al) this._clear(tagId);
            tag.timer = 0;
            this._log(`闭锁报警：${tag.id} ${tag.name}`);
        } else {
            tag.timer = 0;
            this._log(`解除闭锁：${tag.id} ${tag.name}`);
        }
    }

    /** 参数设置（设定值 / 延时 / 死区 / 优先级 / 方向 / 组） */
    updateTag(tagId, patch) {
        const tag = this.tag(tagId);
        if (!tag) return;
        Object.assign(tag, patch);
        tag.timer = 0;
        const keys = Object.keys(patch).map(k => `${k}=${patch[k]}`).join('，');
        this._log(`参数修改：${tag.id} ${keys}`);
    }

    /** 标签恢复初值（Tags Recovery to Initial） */
    recoverAll() {
        for (const tag of this.tags) {
            Object.assign(tag, tag.initial);
            tag.inhibit = false;
            tag.override = false;
            tag.enabled = true;     // Is Alarm 恢复为 Yes
            tag.timer = 0;
        }
        this._log('标签参数恢复初值');
    }

    // ═══════════════════════════════════════════════════════
    //  值班 / 延伸报警
    // ═══════════════════════════════════════════════════════

    setWatch(pos) {
        this.watch = (pos === 'BRIDGE') ? 'BRIDGE' : 'ECR';
        this._log(`值班位置切换：${this.watch === 'BRIDGE' ? '驾驶台值班（BRIDGE）' : '集控室值班（ECR）'}`);
    }

    setDuty(stationId) {
        if (!STATIONS.some(s => s.id === stationId)) return;
        this.dutyPanel = stationId;
        this.extMuted = {};
        this._log(`当班轮机员：${STATIONS.find(s => s.id === stationId).title}`);
    }

    /** 取消值班（再按一次值班呼叫面板上常亮的按钮） */
    clearDuty() {
        const st = STATIONS.find(s => s.id === this.dutyPanel);
        this.dutyPanel = null;
        this.pendingDuty = null;
        this._log(`取消值班：${st ? st.title : ''}`);
    }

    /**
     * 呼叫某位轮机员（Watch calling 对话框 Engine duty 按钮）：
     * 再次点击同一按钮＝取消呼叫。
     */
    callEngineer(stationId) {
        const st = STATIONS.find(s => s.id === stationId);
        if (!st) return false;
        if (this.callTarget === stationId) {
            this.callTarget = null;
            this._log(`取消值班呼叫：${st.title}`);
            return false;
        }
        this.callTarget = stationId;
        this.extMuted = {};
        this._log(`值班呼叫：${st.title}`);
        return true;
    }

    /**
     * 应答呼叫（Accept）：
     *   无人值班 → 直接成为值班轮机员（首次值班）；
     *   已有人值班 → 进入"待接班"状态（值班呼叫面板上同时显示原值班者与接班者），
     *                必须由原值班者再按一次自己的按钮才解除其值班状态、完成交接。
     */
    acceptCall() {
        if (!this.callTarget) return false;
        const id = this.callTarget;
        const st = STATIONS.find(s => s.id === id);
        this.callTarget = null;
        if (!this.dutyPanel) {
            this.dutyPanel = id;
            this.pendingDuty = null;
            this.extMuted = {};
            this._log(`首次值班：${st.title}`);
        } else if (this.dutyPanel === id) {
            this.pendingDuty = null;
        } else {
            this.pendingDuty = id;
            const cur = STATIONS.find(s => s.id === this.dutyPanel);
            this._log(`接班待确认：${st.title}（原值班 ${cur ? cur.title : ''} 需再按一次自己的按钮完成交接）`);
        }
        return true;
    }

    /**
     * 值班者点击自己的按钮：解除自己的值班状态；
     * 若有待接班的轮机员，则同时完成交接（接班者成为值班轮机员）。
     */
    releaseDuty(stationId) {
        if (this.dutyPanel !== stationId) return false;
        const cur = STATIONS.find(s => s.id === stationId);
        const next = this.pendingDuty;
        this.dutyPanel = next || null;
        this.pendingDuty = null;
        this.extMuted = {};
        const nextSt = next ? STATIONS.find(s => s.id === next) : null;
        this._log(next ? `值班交接完成：${nextSt.title} 接班` : `取消值班：${cur ? cur.title : ''}`);
        return true;
    }

    /** 拒绝呼叫（Reject）：取消本次值班呼叫 */
    rejectCall() {
        if (!this.callTarget) return false;
        const st = STATIONS.find(s => s.id === this.callTarget);
        this.callTarget = null;
        this._log(`值班呼叫被拒绝：${st ? st.title : ''}`);
        return true;
    }

    callAll() {
        this.call = 'all';
        this.callTimer = 60;      // 最多 60 s，或全部轮机员都单独确认后自动结束
        this._unmuteAll();
        this._log('呼叫全体轮机员（Call All Engineer）：轮机长/大管轮/二管轮/三管轮/电机员');
    }

    callDuty() {
        this.call = 'duty';
        this.callTimer = 6;
        this._unmuteAll();
        this._log('呼叫值班轮机员（Call Duty Engineer）');
    }

    /** 延伸面板就地确认（静音本面板；主界面报警仍需 ACK） */
    extAck(stationId) {
        this.extMuted[stationId] = true;
        const st = STATIONS.find(s => s.id === stationId);
        // 面板已消音：若主站仍未确认，则开始"主站未确认"计时（3 min 后触发失职报警）
        this._repeatStart = null;
        if (this.unackCount() > 0 && this._masterRepeatStart === null) this._masterRepeatStart = this.t;
        this._log(`延伸报警确认（面板消音）：${st ? st.title : stationId}`);
    }

    _unmuteAll() { this.extMuted = {}; }

    /**
     * 某延伸面板的显示状态
     *   驾驶台面板与"当班轮机员"面板接收延伸报警；其余面板待命（只显示值班信息）
     */
    stationState(stationId) {
        const duty = (stationId === this.dutyPanel);
        const bridge = (stationId === 'bridge');
        // 机舱报警只延伸到「值班轮机员」面板；驾驶台面板不接收（只显示失职 REPEAT）
        const recv = duty;
        const alarms = recv ? this.alarms.filter(a => ALARM_GROUPS[a.group].extend) : [];
        const unack = alarms.filter(a => a.state === 'UNACK' || a.state === 'RTN');
        const muted = !!this.extMuted[stationId];
        // DEADMAN：驾驶台与轮机长面板无条件接收（不论是否当班），且不能在本面板清除
        const deadman = !!this.deadmanActive && (stationId === 'bridge' || stationId === 'chief');
        // Call All Engineer 只触发 5 位轮机员面板，驾驶台不参与
        const call = (this.call === 'all')
            ? (bridge ? null : 'all')
            : (this.call === 'duty' && duty ? 'duty' : null);
        const buzz = (unack.length > 0 || !!call || deadman) && !muted;
        return {
            duty, bridge, recv, alarms, unack, muted, call, buzz, deadman,
            calling: this.callTarget === stationId,     // 正在呼叫本面板（值班呼叫）
            repeat: this.repeatActive,                  // 失职（重复）报警
            flash: buzz && (Math.floor(this.t * 2) % 2 === 0),
            watch: this.watch,
            dutyRole: (STATIONS.find(s => s.id === this.dutyPanel) || {}).title || '—',
        };
    }

    // ═══════════════════════════════════════════════════════
    //  故障注入（由项目 FAULT_CONFIGS 调用）
    // ═══════════════════════════════════════════════════════
    /**
     * 轮机员安全系统 DEADMAN：超过「预警 + 报警时间」未复位时由 DeadmanPanel 置位。
     * 置位即在报警列表产生一条 A 级 DEADMAN 报警（可正常 ACK 消闪），
     * 同时驾驶台与轮机长值班面板显示 DEADMAN（只能由安全系统复位按钮清除）。
     */
    setDeadman(on) {
        const tag = this.tag('DEADMAN');
        if (!tag) return;
        this.deadmanActive = !!on;
        if (on) {
            tag.fault = true;
            tag.value = tag.faultVal;      // 立即动作，避免下一帧被判为"已恢复"
            if (!this.alarmOf('DEADMAN')) this._raise(tag);
            this._log('轮机员安全系统：DEADMAN 报警');
        } else {
            tag.fault = false;
            tag.value = 0;
            const al = this.alarmOf('DEADMAN');
            if (al) this._clear('DEADMAN');
            this._log('轮机员安全系统：DEADMAN 报警复位');
        }
    }

    setFault(tagId, on) {
        const tag = this.tag(tagId);
        if (!tag) return;
        tag.fault = !!on;
        this._log(on ? `故障注入：${tag.name}异常` : `故障恢复：${tag.name}恢复正常`);
    }

    // ═══════════════════════════════════════════════════════
    //  事件日志
    // ═══════════════════════════════════════════════════════
    _log(text) {
        this.events.unshift({ t: stamp(), text });
        if (this.events.length > 60) this.events.pop();
    }
}
