/**
 * Phase3Workflows - 船舶操作标准流程 (SOP) 定义
 * 配合 Workflow.js 的 show/step/train/eval 四模式
 *
 * 步骤模式:
 *   find  — 学员点击指定设备
 *   quiz  — 弹出选择题
 *   check — 检测设备状态是否满足条件
 *   act   — 自动执行动作（演示模式用）
 */

/** 步骤帮助函数：查找组件并高亮 */
function findStep(targetId, msg) {
    return { mode: 'find', target: targetId, msg };
}

/** 步骤帮助函数：状态检测 */
function checkStep(checkFn, msg) {
    return { mode: 'check', check: checkFn, msg };
}

/** 步骤帮助函数：选择题 */
function quizStep(question, options, answer, analysis, isMultiple = false) {
    return {
        mode: 'quiz',
        msg: question,
        quizConfig: { question, options, answer, analysis, isMultiple }
    };
}

/** 步骤帮助函数：自动动作（演示用）*/
function actStep(actFn, msg) {
    return { mode: 'act', act: actFn, msg };
}

// =============================================
// SOP 1: 备车 (Standby)
// =============================================
const STANDBY_STEPS = [
    {
        mode: 'act',
        msg: '备车操作：检查压缩空气系统压力',
        act: async function () {
            const sys = this.sys || this;
            const eq = sys.equipmentPool?.get('air-bottle-main');
            if (eq) eq.state.pressure = 2.5;
        }
    },
    findStep('air-distributor-01', '找到空气分配器，打开起动空气阀'),
    {
        mode: 'check',
        msg: '确认主气瓶压力 ≥ 2.0 MPa',
        check: async function () {
            const eq = this.sys?.equipmentPool?.get('air-bottle-main');
            return eq && eq.state.pressure >= 2.0;
        }
    },
    quizStep(
        '备车时，主气瓶压力应不低于多少？',
        ['1.0 MPa', '1.5 MPa', '2.0 MPa', '2.5 MPa'],
        2,
        '备车状态要求主气瓶压力不低于 2.0 MPa，以保证起动空气充足。'
    ),
    findStep('pump-sw-01', '找到海水泵，准备起动'),
    findStep('pump-fw-01', '找到淡水泵，准备起动'),
    {
        mode: 'act',
        msg: '起动预润滑泵，建立滑油压力',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) me.state.oilPress = 120;
            }
        }
    },
    {
        mode: 'check',
        msg: '确认滑油压力 ≥ 100 kPa',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && me.state.oilPress >= 100;
        }
    },
];

// =============================================
// SOP 2: 主机起动 (Start)
// =============================================
const ENGINE_START_STEPS = [
    quizStep(
        '主机起动前，盘车机构应处于什么状态？',
        ['连接状态', '脱开状态', '任意状态', '半连接状态'],
        1,
        '盘车机构必须脱开，否则可能损坏主机。'
    ),
    findStep('me-01', '找到主机，确认准备好起动'),
    findStep('governor-01', '找到调速器，检查设定'),
    {
        mode: 'act',
        msg: '打开起动空气，主机开始转动',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) {
                    me.state.running = true;
                    me.state.speed = 80;
                    me.state.fuelRate = 30;
                }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) {
                    gov.state.running = true;
                    gov.state.actualRpm = 80;
                    gov.state.setRpm = 80;
                    gov.state.fuelCommand = 30;
                }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认主机转速 ≥ 50 rpm',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && me.state.running && me.state.speed >= 50;
        }
    },
    findStep('tank-doa-01', '检查日用油柜油位'),
    {
        mode: 'check',
        msg: '确认日用油柜油位 ≥ 20%',
        check: async function () {
            const tank = this.sys?.equipmentPool?.get('tank-doa-01');
            return tank && tank.state.level >= 20;
        }
    },
    {
        mode: 'act',
        msg: '逐渐增加油门至正常转速',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) {
                    me.state.speed = 120;
                    me.state.fuelRate = 50;
                }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) {
                    gov.state.actualRpm = 120;
                    gov.state.setRpm = 120;
                    gov.state.fuelCommand = 50;
                }
            }
        }
    },
];

// =============================================
// SOP 3: 并车 (Generator Parallel)
// =============================================
const GEN_PARALLEL_STEPS = [
    findStep('gen-01', '找到发电机组，准备起动'),
    {
        mode: 'act',
        msg: '起动发电机组',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const gen = sys.equipmentPool.get('gen-01');
                if (gen) {
                    gen.state.running = true;
                    gen.state.voltage = 380;
                    gen.state.frequency = 50;
                }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认发电机电压 ≈ 400V，频率 ≈ 50Hz',
        check: async function () {
            const gen = this.sys?.equipmentPool?.get('gen-01');
            return gen && gen.state.running &&
                Math.abs(gen.state.voltage - 400) < 20 &&
                Math.abs(gen.state.frequency - 50) < 1;
        }
    },
    quizStep(
        '发电机并车时，需要满足哪些条件？（多选）',
        ['电压相等', '频率相等', '相序一致', '功率相等'],
        [0, 1, 2],
        '并车三要素：电压相等、频率相等、相序一致。功率不要求相等。',
        true
    ),
    findStep('switchboard-01', '找到主配电板，准备合闸'),
    {
        mode: 'act',
        msg: '合闸并车',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const sw = sys.equipmentPool.get('switchboard-01');
                if (sw) {
                    sw.state.energized = true;
                    sw.state.busVoltage = 380;
                    sw.state.busFrequency = 50;
                    sw.state.busCurrent = 200;
                }
            }
        }
    },
];

// =============================================
// SOP 4: 调速 (Speed Adjust)
// =============================================
const SPEED_ADJUST_STEPS = [
    findStep('governor-01', '找到调速器'),
    quizStep(
        '调速器的作用是什么？',
        ['增加燃油消耗', '根据负载变化自动调节转速', '控制冷却水温度', '调节进气量'],
        1,
        '调速器根据负载变化自动调节喷油量，维持主机转速稳定。'
    ),
    {
        mode: 'act',
        msg: '增加主机转速至 150 rpm',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) { me.state.speed = 150; me.state.fuelRate = 65; }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) { gov.state.setRpm = 150; gov.state.actualRpm = 150; gov.state.fuelCommand = 65; }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认主机转速稳定在 150 ± 5 rpm',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && me.state.running && Math.abs(me.state.speed - 150) <= 5;
        }
    },
    {
        mode: 'act',
        msg: '降低转速至 100 rpm',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) { me.state.speed = 100; me.state.fuelRate = 40; }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) { gov.state.setRpm = 100; gov.state.actualRpm = 100; gov.state.fuelCommand = 40; }
            }
        }
    },
];

// =============================================
// SOP 5: 停车 (Stop)
// =============================================
const ENGINE_STOP_STEPS = [
    {
        mode: 'act',
        msg: '逐渐减少负荷，降低转速',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) { me.state.speed = 60; me.state.fuelRate = 20; }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) { gov.state.setRpm = 60; gov.state.actualRpm = 60; gov.state.fuelCommand = 20; }
            }
        }
    },
    quizStep(
        '主机停车前，应首先做什么？',
        ['直接按停机按钮', '先减负荷至最低', '先关闭冷却水', '先停止燃油泵'],
        1,
        '主机停车前必须先减负荷至最低，然后脱开离合器，最后停车。'
    ),
    {
        mode: 'act',
        msg: '停止主机',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) {
                    me.state.running = false;
                    me.state.speed = 0;
                    me.state.fuelRate = 0;
                }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) {
                    gov.state.running = false;
                    gov.state.actualRpm = 0;
                    gov.state.setRpm = 0;
                    gov.state.fuelCommand = 0;
                }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认主机已停止（转速 = 0）',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && !me.state.running && me.state.speed === 0;
        }
    },
    findStep('air-distributor-01', '关闭起动空气阀'),
    {
        mode: 'act',
        msg: '关闭相关辅助系统',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) me.state.oilPress = 0;
            }
        }
    },
];

// =============================================
// 导出：WorkflowManager 可用步骤集
// =============================================
export const SHIP_WORKFLOWS = {
    'sop-standby': {
        id: 'sop-standby',
        name: '备车 (Standby)',
        steps: STANDBY_STEPS,
    },
    'sop-start': {
        id: 'sop-start',
        name: '主机起动 (Start)',
        steps: ENGINE_START_STEPS,
    },
    'sop-parallel': {
        id: 'sop-parallel',
        name: '并车 (Parallel)',
        steps: GEN_PARALLEL_STEPS,
    },
    'sop-speed': {
        id: 'sop-speed',
        name: '调速 (Speed Adjust)',
        steps: SPEED_ADJUST_STEPS,
    },
    'sop-stop': {
        id: 'sop-stop',
        name: '停车 (Stop)',
        steps: ENGINE_STOP_STEPS,
    },
};
