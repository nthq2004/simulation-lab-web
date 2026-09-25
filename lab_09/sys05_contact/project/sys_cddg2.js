// 电子元器件识别与测试仿真工程


import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

// ── 电机控制与测量组件 ──
import { MotorControlBox } from '../components/MotorControlBox.js';
import { ThreePhaseMotor3D } from '../components/ThreePhaseMotor3D.js';
import { DiagramClampMeter } from '../components/DiagramClampMeter.js';
import { DiagramCurrentTransformer } from '../components/DiagramCurrentTransformer.js';
import { DiagramPotentialTransformer } from '../components/DiagramPotentialTransformer.js';
import { DiagramACVoltmeter } from '../components/DiagramACVoltmeter.js';
import { DiagramACAmmeter } from '../components/DiagramACAmmeter.js';
import { GroundBusBar } from '../components/GroundBusBar.js';
import { Ground } from '../components/Gnd.js';


export const FAULT_CONFIGS = {
};

export const PROJECT_WORKFLOWS = {
    // ── 操作流程：使用钳形电流表测量三相电动机线路电流 ──
    // 场景：电机控制箱给三相异步电动机供电，用钳形电流表分别测量 U、V 相线路电流。
    // 接线：电动机 U/V/W ↔ 控制箱出线 out1/out2/out3；控制箱 PE 端子 ↔ 接地母排。
    // 电流：负荷率 100% 时每相对地电流约 76A，与电动机额定电流（约 80A）接近。
    'clamp-meter-line-current': {
        id: 'clamp-meter-line-current',
        name: '1. 使用钳形电流表测量线路电流',
        steps: [
            {
                msg: '第 1 步：电动机接线——将电动机 U/V/W 三相绕组引出线接到电机控制箱出线端 out1/out2/out3，并把控制箱 PE 端子接到接地母排',
                mode: 'check',
                op: [{ type: 'wire', msg: '点击工具栏"自动接线"完成电动机与控制箱的接线' }],
                async act() {
                    const sys = this.sys;
                    const keep = (sys.conns || []).filter(c => c.custom);
                    sys.conns.length = 0;
                    sys.conns.push(...keep);
                    sys.redrawAll();
                    await _wireAnimated(sys, [
                        ['m-3d_wire_u', 'motor-control-box_wire_out1'],
                        ['m-3d_wire_v', 'motor-control-box_wire_out2'],
                        ['m-3d_wire_w', 'motor-control-box_wire_out3'],
                        ['motor-control-box_wire_pe1', 'pe-busbar_wire_pe2'],
                    ]);
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    return c('m-3d_wire_u', 'motor-control-box_wire_out1')
                        && c('m-3d_wire_v', 'motor-control-box_wire_out2')
                        && c('m-3d_wire_w', 'motor-control-box_wire_out3')
                        && c('motor-control-box_wire_pe1', 'pe-busbar_wire_pe2');
                },
            },
            {
                msg: '第 2 步：合上空气开关，按下起动按钮，电动机开始运行（电源开关默认已合上，无需操作）',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'motor-control-box', part: 'cell-acb', msg: '合上空气开关',
                      async act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (!box) return;
                          // 电源开关（QF）默认已合上，此处仅在其被上一流程断开时静默复位
                          if (box._qfState === 'trip') { box._toggleQf(); await _sleep(300); }
                          if (box._qfState !== 'on') box._toggleQf();
                          if (box._dualStates[1] !== 'close') box._toggleAcb();
                      } },
                    { type: 'btn', target: 'motor-control-box', part: 'cell-start', msg: '按下起动按钮，接触器吸合，电动机运行',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._dualStates[4] !== 'close') box._pressStart();
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const box = sys.comps['motor-control-box'];
                    const motor = sys.comps['m-3d'];
                    if (!box || !motor) return false;
                    return box._dualStates[1] === 'close'
                        && box._dualStates[4] === 'close'
                        && motor._powered === true;
                },
            },
            {
                msg: '第 3 步：电动机额定电流接近 80A，将钳形电流表量程调至 100A 档',
                mode: 'check',
                op: [{ type: 'knob', target: 'clamp1', msg: '将钳形电流表量程旋钮旋至 100A 档' }],
                act() {
                    const clamp = this.sys.comps['clamp1'];
                    if (clamp) clamp.setRange(100);
                },
                check() {
                    const clamp = this.sys.comps['clamp1'];
                    return !!clamp && clamp._range === 100;
                },
            },
            {
                msg: '第 4 步：移动钳形电流表，使 U 相绕组引出线穿过钳形铁芯；按下扳机打开钳口，套入导线后松开扳机合上钳口，开始测量 U 相电流',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'clamp1', msg: '拖动钳形电流表，使 U 相导线穿过钳口内孔',
                      async act() { await _moveClampToPhase(this.sys, 'u', -10, -35); } },
                    { type: 'observe', target: 'clamp1', msg: '按下扳机打开钳口，套入 U 相导线后合上钳口',
                      async act() {
                          const sys = this.sys;
                          _setClampJaw(sys, 'open');
                          await _sleep(900);
                          _setClampJaw(sys, 'close');
                          await _sleep(1400);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const clamp = sys.comps['clamp1'];
                    if (!clamp || !clamp._measuring || !clamp._clampedConn) return false;
                    const cn = clamp._clampedConn;
                    const onU = cn.from === 'm-3d_wire_u' || cn.to === 'm-3d_wire_u';
                    return onU && clamp.getCurrent() > 30;
                },
            },
            {
                msg: '第 5 步：根据钳形电流表显示，填写 U 相测到的额定电流',
                mode: 'fill',
                target: 'clamp1',
                ready() {
                    const clamp = this.sys.comps['clamp1'];
                    return !!(clamp && clamp._measuring && clamp.getCurrent() > 30);
                },
                fields: [
                    { label: 'U 相额定电流', unit: 'A', answer: 76, tolerance: 0.02, placeholder: '读取钳形表显示值后输入，如 75.9 或 76' },
                ],
            },
            {
                msg: '第 6 步：按下扳机打开钳口，将钳形电流表移到 V 相导线，套入后合上钳口，测量 V 相电流',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'clamp1', msg: '打开钳口，把钳形电流表移到 V 相导线',
                      async act() {
                          const sys = this.sys;
                          _setClampJaw(sys, 'open');
                          await _sleep(700);
                          await _moveClampToPhase(sys, 'v', -10, -35);
                      } },
                    { type: 'observe', target: 'clamp1', msg: '套入 V 相导线，合上钳口测量 V 相电流',
                      async act() {
                          const sys = this.sys;
                          _setClampJaw(sys, 'close');
                          await _sleep(1200);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const clamp = sys.comps['clamp1'];
                    if (!clamp || !clamp._measuring || !clamp._clampedConn) return false;
                    const cn = clamp._clampedConn;
                    return (cn.from === 'm-3d_wire_v' || cn.to === 'm-3d_wire_v') && clamp.getCurrent() > 30;
                },
            },
            {
                msg: '第 7 步：测试题——钳形电流表的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '钳形电流表在不断开被测电路的情况下测量交流电流，其工作原理是？',
                    options: [
                        '利用电流互感器原理：被测导线相当于一次绕组，钳形铁芯中的二次绕组感应出与被测电流成比例的小电流，经整流后由表头显示',
                        '把被测导线与表内电阻串联，通过测量导线两端的电压降换算电流',
                        '利用霍尔元件检测电流产生的磁场，但只能测量直流电流',
                        '钳口直接与被测导线接触导电，把电流引入表内测量',
                    ],
                    answer: 0,
                    analysis: '钳形电流表的核心是电流互感器（CT）：被测导线穿过钳形铁芯，相当于互感器的一次绕组（N₁=1），铁芯上的二次绕组匝数 N₂ 很多，根据 I₁N₁=I₂N₂，一次大电流在二次侧感应出成比例的小电流，经整流（交流钳形表）后推动表头显示。因此测量时无需断开电路；测量时应只钳入一根导线，若同时钳入不同相的多根导线，电流相互抵消会使读数偏小甚至为零。',
                },
            },
        ],
    },

    // ── 操作流程：使用手摇式兆欧表测量线路和设备绝缘 ──
    // 场景：先用开路/短路实验校验兆欧表，再分别测量电源进线 U 相、电动机 U 相对地的绝缘电阻。
    // 注意：测量绝缘前必须断开电源（本流程断开控制箱空气开关），测完断开接线。
    'megohm-insulation-test': {
        id: 'megohm-insulation-test',
        name: '2. 使用手摇式兆欧表测量线路和设备绝缘',
        steps: [
            {
                msg: '第 1 步：调出兆欧表。',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'megohm', msg: '勾选"手摇兆欧表"' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('megohm', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mg = this.sys.comps['megohm'];
                    return !!(mg && mg.group && mg.group.visible());
                },
            },
            {
                msg: '第 2 步：开路实验——L、E 端不接线，摇动手柄指针应指向 ∞；读完停止摇动',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'megohm', part: 'l', msg: '兆欧表 L、E 端保持开路',
                      act() { _disconnectMegohm(this.sys); } },
                    { type: 'observe', target: 'megohm', part: 'crank', msg: '摇动手柄，指针应指向 ∞，读完停止摇动',
                      async act() {
                          const sys = this.sys;
                          await _crankUntil(sys, r => !isFinite(r) || r >= 500);
                          _disconnectMegohm(sys);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const mg = sys.comps['megohm'];
                    if (!mg) return false;
                    const flags = this._projFlag || (this._projFlag = {});
                    const shorted = _sameCluster(sys, 'megohm_wire_l', 'megohm_wire_e');
                    if (mg.isCranking() && !shorted) {
                        const r = mg.getResistance();
                        if (!isFinite(r) || r >= 500) flags.open = true;
                        return false;
                    }
                    return !!flags.open && !mg.isCranking() && !shorted;
                },
            },
            {
                msg: '第 3 步：短路实验——将 L 端与 E 端短接，摇动手柄指针应指向 0；停止摇动并拆除短路线',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'megohm', part: 'l', msg: '将 L 端与 E 端短接',
                      async act() { await _shortMegohmLE(this.sys); } },
                    { type: 'observe', target: 'megohm', part: 'crank', msg: '摇动手柄，指针应指向 0，读完停止摇动并拆除短路线',
                      async act() {
                          const sys = this.sys;
                          await _crankUntil(sys, r => isFinite(r) && r < 0.5);
                          _disconnectMegohm(sys);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const mg = sys.comps['megohm'];
                    if (!mg) return false;
                    const flags = this._projFlag || (this._projFlag = {});
                    const shorted = _sameCluster(sys, 'megohm_wire_l', 'megohm_wire_e');
                    if (mg.isCranking() && shorted) {
                        const r = mg.getResistance();
                        if (isFinite(r) && r < 0.5) flags.short = true;
                        return false;
                    }
                    return !!flags.short && !mg.isCranking() && !shorted;
                },
            },
            {
                msg: '第 4 步：断开前面的电源开关（塑壳断路器 QF，切除电源）；兆欧表 L 端接电源进线 U 相、E 端接箱体 PE 端子，摇动手柄测量线路绝缘，读取绝缘电阻值。停止摇动并拆除接线',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'motor-control-box', part: 'qf-breaker', msg: '断开前面的电源开关（塑壳断路器 QF），切除电源',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (!box) return;
                          box._pressStop();
                          if (box._qfState === 'on') box._toggleQf();
                      } },
                    { type: 'observe', target: 'megohm', part: 'l', msg: 'L 端接电源进线 U 相，E 端接箱体 PE 端子',
                      async act() { await _wireMegohm(this.sys, 'motor-control-box_wire_in1', 'motor-control-box_wire_pe1'); } },
                    { type: 'observe', target: 'megohm', part: 'crank', msg: '摇动手柄，测量线路 U 相对地绝缘（约 80MΩ），读完停止摇动并拆除接线',
                      async act() {
                          const sys = this.sys;
                          await _crankUntil(sys, r => isFinite(r) && Math.abs(r - 80) < 4);
                          _disconnectMegohm(sys);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const mg = sys.comps['megohm'];
                    const box = sys.comps['motor-control-box'];
                    if (!mg || !box) return false;
                    const flags = this._projFlag || (this._projFlag = {});
                    const connected = _sameCluster(sys, 'megohm_wire_l', 'motor-control-box_wire_in1')
                        && _sameCluster(sys, 'megohm_wire_e', 'motor-control-box_wire_pe1');
                    if (mg.isCranking() && connected && box._qfState !== 'on') {
                        const r = mg.getResistance();
                        if (isFinite(r) && Math.abs(r - 80) < 8) flags.line = true;
                        return false;
                    }
                    return !!flags.line && !mg.isCranking() && !connected;
                },
            },
            {
                msg: '第 5 步：根据兆欧表读数，填写线路 U 相对地的绝缘电阻',
                mode: 'fill',
                target: 'megohm',
                ready() {
                    return !!(this._projFlag && this._projFlag.line);
                },
                fields: [
                    { label: '线路 U 相对地绝缘电阻', unit: 'MΩ', answer: 80, tolerance: 0.1, placeholder: '读取指针位置后输入，如 80' },
                ],
            },
            {
                msg: '第 6 步：L 端接电动机 U 相接线柱、E 端接电机外壳 PE 端子，摇动手柄测量电动机绝缘，读取绝缘电阻值。停止摇动并拆除接线',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'megohm', part: 'l', msg: 'L 端接电动机 U 相接线柱，E 端接电机外壳 PE 端子',
                      async act() { await _wireMegohm(this.sys, 'm-3d_wire_u', 'm-3d_wire_pe'); } },
                    { type: 'observe', target: 'megohm', part: 'crank', msg: '摇动手柄，测量电动机 U 相对地绝缘（约 50MΩ），读完停止摇动并拆除接线',
                      async act() {
                          const sys = this.sys;
                          await _crankUntil(sys, r => isFinite(r) && Math.abs(r - 50) < 3);
                          _disconnectMegohm(sys);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const mg = sys.comps['megohm'];
                    if (!mg) return false;
                    const flags = this._projFlag || (this._projFlag = {});
                    const connected = _sameCluster(sys, 'megohm_wire_l', 'm-3d_wire_u')
                        && _sameCluster(sys, 'megohm_wire_e', 'm-3d_wire_pe');
                    if (mg.isCranking() && connected) {
                        const r = mg.getResistance();
                        if (isFinite(r) && Math.abs(r - 50) < 6) flags.motor = true;
                        return false;
                    }
                    return !!flags.motor && !mg.isCranking() && !connected;
                },
            },
            {
                msg: '第 7 步：测试题——电动机三相绕组 Y 形连接时测得对地绝缘低，接下来怎么做？',
                mode: 'quiz',
                quizConfig: {
                    question: '用兆欧表测量三相异步电动机（三相绕组 Y 形连接）对地绝缘时，若测得绝缘电阻很低，接下来正确的做法是？',
                    options: [
                        '拆开三相绕组的中性点（星点 U2/V2/W2 的连接），分别测量每相绕组对地的绝缘电阻，找出绝缘不良的那一相',
                        '把三相绕组的星点短接后重新测量，取三相读数的平均值',
                        '直接给电动机通电运行，通过观察运行电流判断绝缘是否良好',
                        '把兆欧表电压等级从 500V 提高到 2500V 后直接重测，无需拆开星点',
                    ],
                    answer: 0,
                    analysis: '三相绕组 Y 形连接时，三相绕组在星点处相互连通，测量任一相对地读到的都是三相绕组的并联等效值，无法判断哪一相绝缘不良。应先断开星点（U2/V2/W2 分开），再分别测量各相绕组对外壳（PE）的绝缘电阻，才能定位并处理绝缘不良的那一相。',
                },
            },
        ],
    },

    // ── 操作流程：使用万用表测量交流电压/交流电流 ──
    // 场景：用数字万用表先测三相电源线电压（约 380V），
    //       再停机断线，把万用表串入电动机 U 相回路测量运行电流。
    'multimeter-ac-measure': {
        id: 'multimeter-ac-measure',
        name: '3. 使用万用表测量交流电压/交流电流',
        steps: [
            {
                msg: '第 1 步：调出数字万用表。',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'multimeter', msg: '勾选"数字万用表"' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('multimeter', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '第 2 步：将万用表量程旋钮旋到交流电压 500V 档。',
                mode: 'check',
                op: [{ type: 'knob', target: 'multimeter', part: 'knob', msg: '旋至 ~500V 交流电压档',
                    act() { _setMultimeterMode(this.sys, 'ACV500'); } }],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!mm && mm.mode === 'ACV500';
                },
            },
            {
                msg: '第 3 步：万用表红表笔(V-Ω)接电源进线 U 相、黑表笔(COM)接 V 相，测量线电压；读数稳定后断开表笔。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'multimeter', part: 'v', msg: '红表笔接进线 U 相，黑表笔接 V 相',
                      async act() {
                          const sys = this.sys;
                          const box = sys.comps['motor-control-box'];
                          if (box) {
                              if (box._qfState === 'trip') { box._toggleQf(); await _sleep(300); }
                              if (box._qfState !== 'on') box._toggleQf();
                          }
                          await _wireMultimeter(sys, [
                              ['multimeter_wire_v', 'motor-control-box_wire_in1'],
                              ['multimeter_wire_com', 'motor-control-box_wire_in2'],
                          ]);
                      } },
                    { type: 'observe', target: 'multimeter', msg: '读数稳定后断开表笔',
                      async act() {
                          const sys = this.sys;
                          await _waitStableMultimeter(sys, v => isFinite(v) && Math.abs(v - 380) < 10);
                          _disconnectDMM(sys);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (!mm) return false;
                    const flags = this._projFlag || (this._projFlag = {});
                    const connected = _dmmAcrossPorts(sys, 'motor-control-box_wire_in1', 'motor-control-box_wire_in2');
                    if (mm.mode === 'ACV500' && connected) {
                        const v = mm.value;
                        if (isFinite(v) && Math.abs(v - 380) < 10) flags.volt = true;
                        return false;
                    }
                    return !!flags.volt && !connected;
                },
            },
            {
                msg: '第 4 步：根据万用表读数，填写三相电源的线电压。',
                mode: 'fill',
                target: 'multimeter',
                ready() { return !!(this._projFlag && this._projFlag.volt); },
                fields: [
                    { label: '三相电源线电压', unit: 'V', answer: 380, tolerance: 0.08, placeholder: '读取显示值后输入，如 380' },
                ],
            },
            {
                msg: '第 5 步：电动机接线，合上空气开关，按下起动按钮，使电动机运行。',
                mode: 'check',
                op: [
                    { type: 'wire', msg: '点击工具栏"自动接线"完成电动机与控制箱接线',
                      async act() {
                          const sys = this.sys;
                          const keep = (sys.conns || []).filter(c => c.custom);
                          sys.conns.length = 0;
                          sys.conns.push(...keep);
                          sys.redrawAll();
                          await _wireAnimated(sys, [
                              ['m-3d_wire_u', 'motor-control-box_wire_out1'],
                              ['m-3d_wire_v', 'motor-control-box_wire_out2'],
                              ['m-3d_wire_w', 'motor-control-box_wire_out3'],
                              ['motor-control-box_wire_pe1', 'pe-busbar_wire_pe2'],
                          ]);
                      } },
                    { type: 'switch', target: 'motor-control-box', part: 'cell-acb', msg: '合上空气开关',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._dualStates[1] !== 'close') box._toggleAcb();
                      } },
                    { type: 'btn', target: 'motor-control-box', part: 'cell-start', msg: '按下起动按钮，电动机运行',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._dualStates[4] !== 'close') box._pressStart();
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const box = sys.comps['motor-control-box'];
                    const motor = sys.comps['m-3d'];
                    return !!(box && motor && box._dualStates[1] === 'close'
                        && box._dualStates[4] === 'close' && motor._powered);
                },
            },
            {
                msg: '第 6 步：按下停止按钮停机 → 断开电源开关（QF） → 断开 out1 到电动机 U 相接线 → 旋至电流档 → 将万用表 mA、COM 表笔串入 U 相回路 → 合上电源开关、按下起动按钮 → 测量 U 相电流。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'motor-control-box', part: 'cell-stop', msg: '按下停止按钮，接触器释放，电动机停机',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box) box._pressStop();
                      } },
                    { type: 'switch', target: 'motor-control-box', part: 'qf-breaker', msg: '断开前面的电源开关（塑壳断路器 QF），切除电源',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._qfState === 'on') box._toggleQf();
                      } },
                    { type: 'observe', target: 'multimeter', msg: '断开控制箱出线端 out1 到电动机 U 相的接线',
                      act() { _removeWireBetween(this.sys, 'm-3d_wire_u', 'motor-control-box_wire_out1'); } },
                    { type: 'knob', target: 'multimeter', part: 'knob', msg: '旋至电流档（mA）',
                      act() { _setMultimeterMode(this.sys, 'MA'); } },
                    { type: 'observe', target: 'multimeter', part: 'ma', msg: '将万用表 mA、COM 表笔串入 U 相回路（out1→mA，COM→电机 U 相）',
                      async act() {
                          await _wireMultimeter(this.sys, [
                              ['multimeter_wire_ma', 'motor-control-box_wire_out1'],
                              ['multimeter_wire_com', 'm-3d_wire_u'],
                          ]);
                      } },
                    { type: 'switch', target: 'motor-control-box', part: 'qf-breaker', msg: '合上电源开关（QF），恢复供电',
                      async act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._qfState !== 'on') { box._toggleQf(); await _sleep(400); }
                      } },
                    { type: 'btn', target: 'motor-control-box', part: 'cell-start', msg: '按下起动按钮，电动机运行，电流流过万用表',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._dualStates[1] === 'close' && box._dualStates[4] !== 'close') box._pressStart();
                      } },
                    { type: 'observe', target: 'multimeter', msg: '读数稳定后保持测量（电动机继续运行，万用表保持接入）',
                      async act() {
                          const sys = this.sys;
                          await _waitStableMultimeter(sys, v => isFinite(v) && v > 10000);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (!mm) return false;
                    const flags = this._projFlag || (this._projFlag = {});
                    const connected = _sameCluster(sys, 'multimeter_wire_ma', 'motor-control-box_wire_out1')
                        && _sameCluster(sys, 'multimeter_wire_com', 'm-3d_wire_u');
                    if (mm.mode === 'MA' && connected && isFinite(mm.value) && mm.value > 10000) {
                        flags.curr = true;
                    }
                    return !!flags.curr;   // 读稳即通过，保持电动机运行与万用表接入
                },
            },
            {
                msg: '第 7 步：根据万用表读数，填写电动机 U 相运行电流。',
                mode: 'fill',
                target: 'multimeter',
                ready() { return !!(this._projFlag && this._projFlag.curr); },
                fields: [
                    { label: '电动机 U 相电流', unit: 'A', answer: 72, tolerance: 0.05, placeholder: '读取显示值后输入，如 72' },
                ],
            },
            {
                msg: '第 8 步：测试题——万用表测量交流电压/交流电流的接线方式。',
                mode: 'quiz',
                quizConfig: {
                    question: '用万用表测量交流电压和交流电流时，接线方式分别是？',
                    options: [
                        '测电压：表笔并联在被测电路两端（电压档）；测电流：断开电路，把万用表串联接入被测支路（电流档）',
                        '测电压：把万用表串联接入电路（电压档）；测电流：表笔并联在被测电路两端（电流档）',
                        '测电压和测电流都是把表笔并联在被测电路两端',
                        '测电压和测电流都是把万用表串联接入电路',
                    ],
                    answer: 0,
                    analysis: '万用表测电压时，电压档内阻很大，应将表笔并联在被测电路两端；测电流时，电流档内阻很小，必须断开被测支路，把万用表串联接入，使被测电流全部流过万用表，否则并联会短路。测量交流量时应选交流（~）档。',
                },
            },
        ],
    },

    // ── 操作流程：交流电路参数测量（电压互感器+电压表 / 电流互感器+电流表 / 数字功率计） ──
    // 1) PT + 电压表：测电源进线 U/V 相之间的线电压（PT 变比 4:1，电压表读约 95V）
    // 2) CT + 电流表：测电动机 W 相电流（CT 变比 20:1，电流表读约 3.8A）
    // 3) 数字功率计：测电动机 V 相功率（U+/U- 接 V 相与电机 PE，I+/I- 串入 V 相）
    'ac-parameter-measure': {
        id: 'ac-parameter-measure',
        name: '4. 交流电路参数测量',
        steps: [
            {
                msg: '第 1 步：调出数字功率计。',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'elecmeter', msg: '勾选"数字功率计"' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('elecmeter', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const m = this.sys.comps['elecmeter'];
                    return !!(m && m.group && m.group.visible());
                },
            },
            {
                msg: '第 2 步：电压互感器接线——原边接电源进线 U、V 相，副边接交流电压表。',
                mode: 'check',
                op: [
                    { type: 'wire', msg: 'PT 原边接电源 U/V 相，S1 接 vp，S2 与 vn 分别接地',
                      async act() {
                          const sys = this.sys;
                          const box = sys.comps['motor-control-box'];
                          if (box) {
                              if (box._qfState === 'trip') { box._toggleQf(); await _sleep(300); }
                              if (box._qfState !== 'on') box._toggleQf();
                          }
                          await _wireAnimated(sys, [
                              ['pt1_wire_p1', 'motor-control-box_wire_in2'],
                              ['pt1_wire_p2', 'motor-control-box_wire_in1'],
                              ['pt1_wire_s1', 'ac-volt1_wire_vp'],
                              ['pt1_wire_s2', 'gnd1_wire_gnd'],
                              ['ac-volt1_wire_vn', 'gnd1_wire_gnd'],
                          ]);
                      } },
                    { type: 'observe', target: 'ac-volt1', msg: '读取交流电压表读数，等待读数稳定',
                      async act() {
                          await _waitStableValue(this.sys, () => this.sys.comps['ac-volt1'].getVoltage(), v => v > 50);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const flags = this._projFlag || (this._projFlag = {});
                    const wired = _sameCluster(sys, 'pt1_wire_p1', 'motor-control-box_wire_in2')
                        && _sameCluster(sys, 'pt1_wire_p2', 'motor-control-box_wire_in1')
                        && _sameCluster(sys, 'pt1_wire_s1', 'ac-volt1_wire_vp')
                        && _sameCluster(sys, 'pt1_wire_s2', 'gnd1_wire_gnd');
                    const v = sys.comps['ac-volt1'] ? sys.comps['ac-volt1'].getVoltage() : 0;
                    if (wired && isFinite(v) && v > 50) flags.volt = true;
                    return !!flags.volt;
                },
            },
            {
                msg: '第 3 步：填写电压表读数。',
                mode: 'fill',
                target: 'ac-volt1',
                ready() { return !!(this._projFlag && this._projFlag.volt); },
                fields: [
                    { label: '电压表读数', unit: 'V', answer: 95, tolerance: 0.05, placeholder: '读取电压表显示值，如 95' },
                ],
            },
            {
                msg: '第 4 步：电动机 U、V 相直接接线，W 相串入电流互感器原边、副边接交流电流表；合上空气开关、按下起动按钮。',
                mode: 'check',
                op: [
                    { type: 'wire', msg: 'U/V 相直接接线，W 相串入 CT 并接上电流表',
                      async act() {
                          const sys = this.sys;
                          await _wireAnimated(sys, [
                              ['m-3d_wire_u', 'motor-control-box_wire_out1'],
                              ['m-3d_wire_v', 'motor-control-box_wire_out2'],
                          ]);
                          _removeWireBetween(sys, 'm-3d_wire_w', 'motor-control-box_wire_out3');
                          await _wireAnimated(sys, [
                              ['motor-control-box_wire_out3', 'ct1_wire_p1'],
                              ['ct1_wire_p2', 'm-3d_wire_w'],
                              ['ct1_wire_s1', 'ac-amp1_wire_ap'],
                              ['ct1_wire_s2', 'ac-amp1_wire_an'],
                          ]);
                      } },
                    { type: 'switch', target: 'motor-control-box', part: 'cell-acb', msg: '合上空气开关',
                      async act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (!box) return;
                          if (box._qfState === 'trip') { box._toggleQf(); await _sleep(300); }
                          if (box._qfState !== 'on') box._toggleQf();
                          if (box._dualStates[1] !== 'close') box._toggleAcb();
                      } },
                    { type: 'btn', target: 'motor-control-box', part: 'cell-start', msg: '按下起动按钮，电动机运行',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._dualStates[1] === 'close' && box._dualStates[4] !== 'close') box._pressStart();
                      } },
                    { type: 'observe', target: 'ac-amp1', msg: '读取交流电流表读数，等待读数稳定',
                      async act() {
                          await _waitStableValue(this.sys, () => this.sys.comps['ac-amp1'].getCurrent(), v => v > 1);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const flags = this._projFlag || (this._projFlag = {});
                    const wired = _sameCluster(sys, 'ct1_wire_p1', 'motor-control-box_wire_out3')
                        && _sameCluster(sys, 'ct1_wire_s1', 'ac-amp1_wire_ap');
                    const i = sys.comps['ac-amp1'] ? sys.comps['ac-amp1'].getCurrent() : 0;
                    if (wired && isFinite(i) && i > 1) flags.curr = true;
                    return !!flags.curr;
                },
            },
            {
                msg: '第 5 步：填写电流表读数。',
                mode: 'fill',
                target: 'ac-amp1',
                ready() { return !!(this._projFlag && this._projFlag.curr); },
                fields: [
                    { label: '电流表读数', unit: 'A', answer: 3.8, tolerance: 0.06, placeholder: '读取电流表显示值，如 3.8' },
                ],
            },
            {
                msg: '第 6 步：停机并断开电源开关；断开控制箱出线端 out2 到电动机 V 相的接线，将数字功率计电流端串入 V 相、电压端  取 V 相与 W 相之间的线电压；再合上电源开关、按下起动按钮，读取功率。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'motor-control-box', part: 'cell-stop', msg: '按下停止按钮，电动机停机',
                      act() { const box = this.sys.comps['motor-control-box']; if (box) box._pressStop(); } },
                    { type: 'switch', target: 'motor-control-box', part: 'qf-breaker', msg: '断开电源开关（QF），切除电源',
                      act() { const box = this.sys.comps['motor-control-box']; if (box && box._qfState === 'on') box._toggleQf(); } },
                    { type: 'observe', target: 'elecmeter', msg: '断开 out2→V 相线，功率计 I+/I- 串入 V 相、U+/U- 取 V-W 线电压',
                      async act() {
                          const sys = this.sys;
                          _removeWireBetween(sys, 'm-3d_wire_v', 'motor-control-box_wire_out2');
                          await _wireAnimated(sys, [
                              ['motor-control-box_wire_out2', 'elecmeter_wire_ip'],
                              ['elecmeter_wire_in', 'm-3d_wire_v'],
                              ['elecmeter_wire_up', 'm-3d_wire_v'],
                              ['elecmeter_wire_un', 'm-3d_wire_w'],
                          ]);
                      } },
                    { type: 'switch', target: 'motor-control-box', part: 'qf-breaker', msg: '合上电源开关（QF），恢复供电',
                      async act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._qfState !== 'on') { box._toggleQf(); await _sleep(400); }
                      } },
                    { type: 'btn', target: 'motor-control-box', part: 'cell-start', msg: '按下起动按钮，电动机运行',
                      act() {
                          const box = this.sys.comps['motor-control-box'];
                          if (box && box._dualStates[1] === 'close' && box._dualStates[4] !== 'close') box._pressStart();
                      } },
                    { type: 'observe', target: 'elecmeter', msg: '读取数字功率计的 V/I/P，等待读数稳定',
                      async act() {
                          await _waitStableValue(this.sys, () => this.sys.comps['elecmeter'].P_avg, p => p > 1000);
                      } },
                ],
                check() {
                    const sys = this.sys;
                    const flags = this._projFlag || (this._projFlag = {});
                    const wired = _sameCluster(sys, 'elecmeter_wire_ip', 'motor-control-box_wire_out2')
                        && _sameCluster(sys, 'elecmeter_wire_up', 'm-3d_wire_v')
                        && _sameCluster(sys, 'elecmeter_wire_un', 'm-3d_wire_w');
                    const m = sys.comps['elecmeter'];
                    const p = (m && isFinite(m.P_avg)) ? m.P_avg : 0;
                    if (wired && p > 1000) flags.power = true;
                    return !!flags.power;
                },
            },
            {
                msg: '第 7 步：填写电动机功率（总功率的一半，两表法）。',
                mode: 'fill',
                target: 'elecmeter',
                ready() { return !!(this._projFlag && this._projFlag.power); },
                fields: [
                    { label: '电动机 V 相功率', unit: 'W', answer: 25000, tolerance: 0.1, placeholder: '读取功率计 P 显示值，如 25000' },
                ],
            },
            {
                msg: '第 8 步：测试题——互感器与仪表的测量要点。',
                mode: 'quiz',
                quizConfig: {
                    question: '用电压互感器（PT）/电流互感器（CT）配合电压表、电流表测量交流电路参数时，下列说法正确的是？',
                    options: [
                        'PT 原边并联在被测电压两端（高阻）、CT 原边串联在被测支路；仪表读数为副边值，实际值需乘以互感器变比',
                        'PT 原边串联在被测支路、CT 原边并联在被测电压两端，仪表读数即为实际值',
                        'PT、CT 原边都应并联在被测电路两端，仪表读数即为实际值',
                        'PT、CT 副边都开路运行，仪表直接读取原边大电压、大电流',
                    ],
                    answer: 0,
                    analysis: '电压互感器（PT）原边高阻抗、并联在被测电压两端，把高电压按变比降为低电压供电压表测量；电流互感器（CT）原边串联在被测支路（相当于一小段导线），把大电流按变比变为小电流供电流表测量。仪表读到的是副边值，实际值 = 读数 × 变比。注意 CT 副边严禁开路，否则会产生高压。',
                },
            },
        ],
    },
};

export const componentConfigs = [

    // ── 电机控制箱（整体缩放为原来的 2/3）；insulR=电源各相进线对地绝缘电阻 80MΩ ──
    { Class: MotorControlBox, id: 'motor-control-box', x: 300, y: -40, scale: 2 / 3, label: '电机控制箱（打开状态）', insulR: 80e6, visible: true },

    // ── 三相电机 3D 组件（整体缩放为原来的 2/3）；insulR=各相绕组对地绝缘电阻 50MΩ ──
    { Class: ThreePhaseMotor3D, id: 'm-3d', x: 580, y: 800, scale: 2 / 3, label: 'M1', ratedPower: 5.5, ratedVoltage: 380, ratedSpeed: 1440, cosphi: 0.85, insulR: 50e6, visible: true },

    // ── 钳形电流表（Diagram 简化版）──
    { Class: DiagramClampMeter, id: 'clamp1', x: 1260, y: 300, range: 50, current: 0, senseJaw: true, visible: true },

    // ── 简单外观的电流互感器 / 电压互感器（简化原理图版）──
    { Class: DiagramCurrentTransformer, id: 'ct1', x: 780, y: 590, turnsRatio: 20, primaryRated: 100, secondaryRated: 5, label: '电流互感器', visible: true },
    { Class: DiagramPotentialTransformer, id: 'pt1', x: 270, y: 640, rotation: 90, turnsRatio: 4, primaryRated: 400, secondaryRated: 100, label: '电压互感器', visible: true },

    // ── 交流电压表 / 交流电流表（Diagram 简化版）──
    { Class: DiagramACVoltmeter, id: 'ac-volt1', x: 260, y: 590, maxVoltage: 100, frequency: 50, visible: true },
    { Class: DiagramACAmmeter, id: 'ac-amp1', x: 1020, y: 320, maxCurrent: 5, frequency: 50, visible: true },

    // ── 接地母排与接地符号 ──
    { Class: GroundBusBar, id: 'pe-busbar', x: 1020, y: 20, visible: true },
    { Class: Ground, id: 'gnd1', x: 320, y: 980, visible: true },

    // ── 7 种保留仪表（默认隐藏，可从"选择仪表"中调出）──
    { Class: Multimeter, id: 'multimeter', x: 880, y: 440, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 120, y: 590, voltage: 2500, label: '手摇兆欧表(2500V)', rampTime: 0.6, visible: false },
];

export function initSlider(_sys) { }

/* ── 工作流辅助 ───────────────────────────────────────────── */
function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

/** 移除 MF47 的 VΩ/mA/COM 表笔接线 */
function _disconnectMF47(sys) {
    const ports = ['mf47-panel_wire_v', 'mf47-panel_wire_mA', 'mf47-panel_wire_COM'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 逐根动画接线（约 3s/根，本次接线数 <6 时一律动画接线） */
async function _wireAnimated(sys, pairs) {
    for (const [from, to] of pairs) {
        await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
    }
    sys.redrawAll();
}

/** 短接 VΩ 端与 COM 端（用于欧姆调零，动画接线） */
async function _shortVCOM(sys) {
    _disconnectMF47(sys);
    await _wireAnimated(sys, [['mf47-panel_wire_v', 'mf47-panel_wire_COM']]);
}

/** 断开 VΩ 端与 COM 端的短接线 */
function _openVCOMShort(sys) {
    const c = sys.conns.find(c =>
        (c.from === 'mf47-panel_wire_v' && c.to === 'mf47-panel_wire_COM') ||
        (c.from === 'mf47-panel_wire_COM' && c.to === 'mf47-panel_wire_v'));
    if (c) { sys.connMgr.removeConn(c); sys.redrawAll(); }
}

/** 延时辅助 */
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 移除兆欧表 L/E 表笔接线 */
function _disconnectMegohm(sys) {
    const ports = ['megohm_wire_l', 'megohm_wire_e'];
    const existing = (sys.conns || []).filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 兆欧表接线：先断开旧表笔，再将 L→lPort、E→ePort（动画接线） */
async function _wireMegohm(sys, lPort, ePort) {
    _disconnectMegohm(sys);
    await _wireAnimated(sys, [
        ['megohm_wire_l', lPort],
        ['megohm_wire_e', ePort],
    ]);
}

/** 短路实验：短接兆欧表 L 端与 E 端（动画接线） */
async function _shortMegohmLE(sys) {
    _disconnectMegohm(sys);
    await _wireAnimated(sys, [['megohm_wire_l', 'megohm_wire_e']]);
}

/**
 * 摇动兆欧表，直到读数满足条件且连续多次基本不变（稳定），再停止摇动。
 * 演示时用于「等读数稳定后再进入下一步」。
 * @param {object} sys 系统
 * @param {(r:number)=>boolean} isOk 读数判定（r 单位 MΩ）
 * @param {{maxMs?:number, holdMs?:number}} opts 最长摇动时间 / 稳定后保持展示时间
 */
async function _crankUntil(sys, isOk, opts = {}) {
    const { maxMs = 12000, holdMs = 1200 } = opts;
    const mg = sys.comps['megohm'];
    if (!mg) return;
    mg._stopValue = null;
    mg.setCranking(true);
    const t0 = Date.now();
    let last = null, stable = 0;
    while (Date.now() - t0 < maxMs) {
        await _sleep(150);
        const r = mg.getResistance();
        if (isOk(r)) {
            const same = (r === last)
                || (isFinite(r) && isFinite(last) && Math.abs(r - last) < 0.3);
            stable = same ? stable + 1 : 0;
            if (stable >= 4) break;   // 连续 4 次（约 0.6s）读数基本不变 → 认为稳定
        } else {
            stable = 0;
        }
        last = r;
    }
    await _sleep(holdMs);   // 保持摇动，让稳定读数停留可见
    mg._stopValue = mg.getResistance();   // 停止后保持在稳定读数（不随机跳变）
    mg.setCranking(false);
}

/** 与指定相导线（m-3d_wire_u/v/w）相连的接线，用于钳形电流表穿心测量 */
function _phaseWire(sys, phase) {
    const port = `m-3d_wire_${phase}`;
    return (sys.conns || []).find(c => c.type === 'wire' && !c.custom
        && (c.from === port || c.to === port));
}

/**
 * 移动钳形电流表，使指定相导线穿过钳口内孔：
 * 取该导线的两端端口绝对坐标中点，令钳口内孔中心与之重合，
 * 再叠加人工微调偏移 (dx, dy)。
 */
async function _moveClampToPhase(sys, phase, dx = 0, dy = 0) {
    const clamp = sys.comps['clamp1'];
    const conn = _phaseWire(sys, phase);
    if (!clamp || !conn || !clamp._jaw) return;
    const absPos = (pid) => {
        const did = pid.split('_wire_')[0];
        const comp = sys.comps[did];
        return comp && typeof comp.getAbsPortPos === 'function' ? comp.getAbsPortPos(pid) : null;
    };
    const p1 = absPos(conn.from), p2 = absPos(conn.to);
    if (!p1 || !p2) return;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const hole = { x: clamp._jaw.cx, y: clamp._jaw.topY + clamp._jaw.h * 0.5 };
    clamp.group.position({ x: mid.x - hole.x + dx, y: mid.y - hole.y + dy });
    if (sys.redrawAll) sys.redrawAll();
    await _sleep(120);
}

/**
 * 模拟钳口开合（穿心感知 senseJaw 模式）：
 * 张开 → 停止测量并清空读数；合上 → 锁定当前穿心导线，成功锁定才开始测量。
 */
function _setClampJaw(sys, action) {
    const clamp = sys.comps['clamp1'];
    if (!clamp) return;
    if (action === 'open') {
        clamp._jawOpen = true;
        clamp._measuring = false;
        clamp._clampedConn = null;
        clamp._rmsBuffer.length = 0;
        clamp._targetI = 0;
    } else {
        clamp._jawOpen = false;
        clamp._clampedConn = clamp._senseClampedWire();
        clamp._measuring = !!clamp._clampedConn;
        clamp._rmsBuffer.length = 0;
        if (!clamp._measuring) clamp._targetI = 0;
    }
}

/** 红黑表笔接到指定元器件两端（动画接线）。swap=true 时 V 接右端、COM 接左端 */
async function _probeDev(sys, id, swap) {
    _disconnectMF47(sys);
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    await _wireAnimated(sys, [
        ['mf47-panel_wire_v', vP],
        ['mf47-panel_wire_COM', cP],
    ]);
}

/** MF47 表笔是否跨接在指定元器件两端（swap 指定表笔方向） */
function _mf47Across(sys, id, swap) {
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    return _sameCluster(sys, 'mf47-panel_wire_v', vP)
        && _sameCluster(sys, 'mf47-panel_wire_COM', cP);
}

/** 移除数字万用表的 V/mA/COM 表笔接线 */
function _disconnectDMM(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_ma', 'multimeter_wire_com'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 设置数字万用表档位（同步旋钮指针并立即刷新显示） */
function _setMultimeterMode(sys, mode) {
    const mm = sys.comps['multimeter'];
    if (!mm) return;
    mm.mode = mode;
    if (typeof mm._updateAngleByMode === 'function') mm._updateAngleByMode();
    else if (typeof mm._measureNow === 'function') mm._measureNow();
}

/** 万用表表笔接线：先断开旧表笔，再按端口对逐根动画接线 */
async function _wireMultimeter(sys, pairs) {
    _disconnectDMM(sys);
    await _wireAnimated(sys, pairs);
}

/** 数字万用表 V 表笔 / COM 表笔是否分别跨接在指定两端口 */
function _dmmAcrossPorts(sys, vPort, cPort) {
    return _sameCluster(sys, 'multimeter_wire_v', vPort)
        && _sameCluster(sys, 'multimeter_wire_com', cPort);
}

/** 删除指定两端口之间的接线 */
function _removeWireBetween(sys, a, b) {
    const c = (sys.conns || []).find(x => x.type === 'wire' &&
        ((x.from === a && x.to === b) || (x.from === b && x.to === a)));
    if (c) { sys.connMgr.removeConn(c); sys.redrawAll(); }
}

/**
 * 等待万用表读数稳定（满足条件且连续多次基本不变），随后保持展示。
 * 用于演示时「等读数稳定后再进入下一步」。
 * @param {object} sys 系统
 * @param {(v:number)=>boolean} isOk 读数判定（v 为 mm.value 原始值：电压 V / 电流 mA）
 * @param {{maxMs?:number, holdMs?:number}} opts
 */
async function _waitStableMultimeter(sys, isOk, opts = {}) {
    const { maxMs = 8000, holdMs = 1000 } = opts;
    const mm = sys.comps['multimeter'];
    if (!mm) return;
    await _waitStableValue(sys, () => mm.value, isOk, { maxMs, holdMs });
}

/**
 * 通用：等待某个读数稳定（满足条件且连续多次基本不变），随后保持展示。
 * @param {object} sys 系统
 * @param {()=>number} getVal 读取函数
 * @param {(v:number)=>boolean} isOk 判定
 * @param {{maxMs?:number, holdMs?:number}} opts
 */
async function _waitStableValue(sys, getVal, isOk, opts = {}) {
    const { maxMs = 8000, holdMs = 1000 } = opts;
    const t0 = Date.now();
    let last = null, stable = 0;
    while (Date.now() - t0 < maxMs) {
        await _sleep(150);
        const v = getVal();
        if (isFinite(v) && isOk(v)) {
            const same = (last !== null && Math.abs(v - last) < Math.max(0.5, Math.abs(v) * 0.01));
            stable = same ? stable + 1 : 0;
            if (stable >= 4) break;
        } else {
            stable = 0;
        }
        last = v;
    }
    await _sleep(holdMs);
}

/** 数字万用表表笔接到指定元器件两端（动画接线）。swap=true 时 V 接右端、COM 接左端 */
async function _probeDMM(sys, id, swap) {
    _disconnectDMM(sys);
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    await _wireAnimated(sys, [
        ['multimeter_wire_v', vP],
        ['multimeter_wire_com', cP],
    ]);
}

/** 数字万用表表笔是否跨接在指定元器件两端 */
function _dmmAcross(sys, id, swap) {
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    return _sameCluster(sys, 'multimeter_wire_v', vP)
        && _sameCluster(sys, 'multimeter_wire_com', cP);
}

/** 移除某元器件全部引脚上的连线（如三极管的短接线） */
function _clearCompWiring(sys, compId) {
    const pre = `${compId}_wire_`;
    const existing = sys.conns.filter(c => (c.from && c.from.startsWith(pre)) || (c.to && c.to.startsWith(pre)));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 断开 MF47 表笔及指定元器件的全部接线 */
function _clearWiring(sys, compId) {
    _disconnectMF47(sys);
    if (compId) _clearCompWiring(sys, compId);
}

/** 先断开 MF47 表笔（及指定元器件接线），再按给定端口对逐根动画接线 */
async function _wireMF47(sys, pairs, compId) {
    _disconnectMF47(sys);
    if (compId) _clearCompWiring(sys, compId);
    await _wireAnimated(sys, pairs);
}

/** 给定端口对是否都处于同一 cluster（用于校验接线） */
function _joined(sys, pairs) {
    return pairs.every(([a, b]) => _sameCluster(sys, a, b));
}

/**
 * 自动接线：
 *   1) 电机 U/V/W ↔ 电机控制箱出线端 out1/out2/out3
 *   2) 电机控制箱第 1 个端子（pe1）↔ 接地母排第 2 个端子（pe2）
 * 注：电机 PE 端子默认不接线（按需手动接至控制箱 PE 端子）。
 */
function _autoWire(sys) {
    // 仅保留固定预接线（custom 标记），其余自动接线重排
    const keep = (sys.conns || []).filter(c => c.custom);
    sys.conns.length = 0;
    sys.conns.push(...keep);

    const cons = [
        // 电机三相进线 ↔ 控制箱对外出线端
        { from: 'm-3d_wire_u', to: 'motor-control-box_wire_out1', type: 'wire' },
        { from: 'm-3d_wire_v', to: 'motor-control-box_wire_out2', type: 'wire' },
        { from: 'm-3d_wire_w', to: 'motor-control-box_wire_out3', type: 'wire' },
        // 控制箱第 1 个端子 ↔ 接地母排第 2 个端子
        { from: 'motor-control-box_wire_pe1', to: 'pe-busbar_wire_pe2', type: 'wire' },
    ];
    cons.forEach(c => {
        if (sys.connMgr && typeof sys.connMgr.addConn === 'function') sys.connMgr.addConn(c);
        else sys.conns.push(c);
    });
    if (sys.redrawAll) sys.redrawAll();
}

export function applyAllPresets() {
    const sys = this.sys;
    if (!sys) return;
    _autoWire(sys);
    // 复位 MF47 并收起
    _disconnectMF47(sys);
    if (typeof sys.toggleInstrumentVisibility === 'function') {
        sys.toggleInstrumentVisibility('mf47-panel', false);
    }
    const mm = sys.comps['mf47-panel'];
    if (mm) {
        mm.setRange('ACV500');
        mm._ohmZeroAdjust = 0.5;
        mm.config.ohmZeroAdjust = 0.5;
        mm.markDirty();
    }
    if (sys.redrawAll) sys.redrawAll();
}

export async function applyStartSystem() { }

export function fiveStep() { }
