/**
 * WorkflowManager - 流程与故障管理模块
 * 负责项目操作流程定义（stepsArray）、故障配置（FAULT_CONFIG）、
 * 流程切换、一键连线、系统启动、5点步进等业务逻辑
 */
export class WorkflowManager {
    /**
     * @param {object} sys - ControlSystem 实例
     */
    constructor(sys) {
        this.sys = sys;
        sys.requiredPipes = [

        ];
    }

    // ==========================================
    // 1. 流程初始化：填充下拉框 + 定义所有步骤
    // ==========================================
    initSteps() {
        const sys = this.sys;

        const projectConfigs = [
            { id: 0, name: "8.1 监测系统通信总线状态检测和故障判定" },
            { id: 1, name: "8.2 监测系统模块、通道故障判定和处理" },
            { id: 2, name: "8.3 计算机控制单元线路、接口、继电器板故障判定和处理" },
            { id: 3, name: "8.4 监测系统内存故障、死机等系统故障判定和处理" },
        ];

        const taskSelect = document.getElementById('taskSelect');
        if (taskSelect) {
            taskSelect.innerHTML = '<option value="" selected>请选择操作项目...</option>';
            projectConfigs.forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj.id;
                opt.textContent = proj.name;
                taskSelect.appendChild(opt);
            });
        }

        const autoConns = [
            { from: 'ai_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'ai_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'ao_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'ao_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'di_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'di_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'do_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'do_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },

            { from: 'ai_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'ai_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'ao_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'ao_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'di_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'di_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'do_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'do_wire_can1n', to: 'can_wire_can1n', type: 'wire' },

            { from: 'cc_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'cc_wire_can1n', to: 'can_wire_can1n', type: 'wire' },

            { from: 'tank_wire_p', to: 'ai_wire_ch1p', type: 'wire' },
            { from: 'tank_wire_n', to: 'ai_wire_ch1n', type: 'wire' },
            { from: 'tank_wire_l', to: 'do_wire_ch1p', type: 'wire' },
            { from: 'tank_wire_r', to: 'do_wire_ch1n', type: 'wire' },

            { from: 'fuel_wire_l', to: 'ai_wire_ch3p', type: 'wire' },
            { from: 'fuel_wire_r', to: 'ai_wire_ch3n', type: 'wire' },
            { from: 'fuel_wire_p', to: 'ao_wire_ch1p', type: 'wire' },
            { from: 'fuel_wire_n', to: 'ao_wire_ch1n', type: 'wire' },

            { from: 'prelay_wire_NO', to: 'btnstop_wire_l', type: 'wire' },
            { from: 'btnstop_wire_r', to: 'di_wire_ch1p', type: 'wire' },
            { from: 'prelay_wire_COM', to: 'di_wire_ch1n', type: 'wire' },

            { from: 'vrelay_wire_l', to: 'do_wire_ch3p', type: 'wire' },
            { from: 'vrelay_wire_r', to: 'do_wire_ch3n', type: 'wire' },
            { from: 'vrelay_wire_NO', to: 'alarm_wire_l', type: 'wire' },
            { from: 'vrelay_wire_COM', to: 'alarm_wire_r', type: 'wire' },

        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            {
                msg: "1：完成系统连线. ",
                act: async () => {
                    sys.conns = [];
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyAllPresets();
                },
                check: () => checkConnectionsExist([0, 1, 2, 3, 4, 5, 6, 7])
            },
            {
                msg: "2：起动系统.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyStartSystem();
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "3：触发通信线路连接故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const ai = sys.comps.ai;
                    ai.commFault = true;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.ai.commFault === true
            },
            {
                msg: "4：消音、确认警报。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const cc = sys.comps.cc;
                    const alarm = sys.comps.alarm;
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    alarm.alarming = false;
                    alarm.silenced = false;
                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 4000));
                    const cc = sys.comps.cc;
                    console.log(cc.activeAlarms);
                    return cc.activeAlarms.every(a => a.muted);
                }
            },
            {
                msg: "5：找到通信故障模块、观察运行指示灯、故障指示灯、通信指示灯，确认通信故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.highlight(true);
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.highlight(false);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.lastClickedId === 'ai'
            },
            {
                msg: "6：修复通信模块断线故障，清除警报，恢复正常运行",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.coilFault = false;
                    await new Promise(r => setTimeout(r, 5000));
                    const cc = sys.comps.cc;
                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms = cc.activeAlarms.filter(a => !a.confirmed);

                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 4000));
                    const cc = sys.comps.cc;
                    return cc.activeAlarms.every(a => a.muted && a.confirmed);
                }
            }
        ];
        sys.stepsArray[1] = [
            {
                msg: "1：完成系统连线. ",
                act: async () => {
                    sys.conns = [];
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyAllPresets();
                },
                check: () => checkConnectionsExist([0, 1, 2, 3, 4, 5, 6, 7])
            },
            {
                msg: "2：起动系统.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyStartSystem();
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "3：触发输入通道失效故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const ai = sys.comps.ai;
                    ai.channelFault = true;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.ai.channelFault === true
            },
            {
                msg: "4：消音、确认警报。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const cc = sys.comps.cc;
                    const alarm = sys.comps.alarm;
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    alarm.alarming = false;
                    alarm.silenced = false;
                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 4000));
                    const cc = sys.comps.cc;
                    return cc.activeAlarms.every(a => a.muted);
                }
            },
            {
                msg: "5：找到AI模块、观察运行指示灯、通道状态指示，确认输入通道故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.highlight(true);
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.highlight(false);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.lastClickedId === 'ai'
            },
            {
                msg: "6：进入AI设置页面，将故障通道禁用，开启备用通道，并调换接线",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const cc = sys.comps.cc;
                    cc.showPage(3);
                    await new Promise(r => setTimeout(r, 2000));

                    // 将故障通道转为disable状态
                    const ai = sys.comps['ai'];
                    const data1 = [0x05, 0, 2, 0, 0, 0, 0, 0];
                    try {
                        cc.data.ai['ch1'].mode = 'disable';
                        ai.channels['ch1'].mode = 'disable';
                        cc._aiRows['ch1'].modeTxt.text(`Mode: disable`);
                        cc._aiRows['ch1'].modeTxt.fill(C.textDim);
                        cc._updateAIRowFromModule('ch1');
                    } catch (e) { console.warn('optimistic UI update failed', e); }
                    try {
                        cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data1, sender: cc.id, timestamp: Date.now() });
                        setTimeout(() => cc._requestNodeConfig('ai', 0x0A, 0), 10);
                    } catch (e) { console.warn(e); }

                    // 删除ai ch1的两根连线，接入ch2
                    const delwires = [{ from: 'tank_wire_p', to: 'ai_wire_ch1p', type: 'wire' },
                    { from: 'tank_wire_n', to: 'ai_wire_ch1n', type: 'wire' }];
                    const newwires = [{ from: 'tank_wire_p', to: 'ai_wire_ch2p', type: 'wire' },
                    { from: 'tank_wire_n', to: 'ai_wire_ch2n', type: 'wire' }];
                    for (const conn of delwires) {
                        const exists = sys.conns.some(c => sys._connEqual(c, conn));
                        if (exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            sys.removeConn(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    for (const conn of newwires) {
                        const exists = sys.conns.some(c => sys._connEqual(c, conn));
                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await sys.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }

                    //将备用通道转为'normal'状态
                    await new Promise(r => setTimeout(r, 2000));
                    const data2 = [0x05, 1, 0, 0, 0, 0, 0, 0];
                    try {
                        cc.data.ai['ch2'].mode = 'normal';
                        ai.channels['ch2'].mode = 'normal';
                        cc._aiRows['ch2'].modeTxt.text(`Mode:normal`);
                        cc._aiRows['ch2'].modeTxt.fill(C.green);
                        cc._updateAIRowFromModule('ch2');
                    } catch (e) { console.warn('optimistic UI update failed', e); }
                    try {
                        cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data2, sender: cc.id, timestamp: Date.now() });
                        setTimeout(() => cc._requestNodeConfig('ai', 0x0A, 0), 20);
                    } catch (e) { console.warn(e); }
                    await new Promise(r => setTimeout(r, 2000));



                },
                check: async () => {
                    const cc = sys.comps.cc;
                    const c1 = cc.data.ai['ch1'].mode === 'disable';
                    const c2 = cc.data.ai['ch2'].mode === 'normal';
                    const newwires = [{ from: 'tank_wire_p', to: 'ai_wire_ch2p', type: 'wire' },
                    { from: 'tank_wire_n', to: 'ai_wire_ch2n', type: 'wire' }];
                    //检查newwires已经连线
                    const wiresConnected = newwires.every(conn => sys.conns.some(c => sys._connEqual(c, conn)));
                    return c1 && c2 && wiresConnected;
                }
            },
            {
                msg: "7：进入液位控制页面，将输入通道切换为备用通道.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const cc = sys.comps.cc;
                    cc.showPage(7);
                    await new Promise(r => setTimeout(r, 2000));
                    cc.levelCtrl.inputChannel = 'ch2';
                    await new Promise(r => setTimeout(r, 2000));

                },
                check: () => {
                    const cc = sys.comps.cc;
                    return cc.levelCtrl.inputChannel === 'ch2';
                }
            },
            {
                msg: "8：回到监测报警页面，清除警报，恢复正常运行",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));
                    const cc = sys.comps.cc;
                    cc.showPage(0);
                    await new Promise(r => setTimeout(r, 10000));

                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms = cc.activeAlarms.filter(a => !a.confirmed);

                },
                check: async () => {
                    const cc = sys.comps.cc;
                    return cc.activeAlarms.every(a => a.muted && a.confirmed);
                }
            }
        ];
        sys.stepsArray[2] = [
            {
                msg: "1：完成系统连线. ",
                act: async () => {
                    sys.conns = [];
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyAllPresets();
                },
                check: () => checkConnectionsExist([0, 1, 2, 3, 4, 5, 6, 7])
            },
            {
                msg: "2：起动系统.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyStartSystem();
                    await new Promise(r => setTimeout(r, 3000));
                    const alarm = sys.comps.alarm;
                    alarm.alarming = false;
                    alarm.silenced = false;
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "3：按下报警测试按钮，触发报警。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const stop = sys.comps.btnstop;
                    stop._setPressed(true);
                    await new Promise(r => setTimeout(r, 5000));
                    stop._setPressed(false);
                    await new Promise(r => setTimeout(r, 2000));                    
                    const alarm = sys.comps.alarm;
                    alarm.alarming = false;
                    alarm.silenced = false;                    
                },
                check: () => sys.comps.btnstop.isOn === false
            },
            {
                msg: "4：触发继电器触头失效故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const vrelay = sys.comps.vrelay;
                    vrelay.contactFault = true;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.vrelay.contactFault === true
            },
            {
                msg: "5：按下报警测试按钮，再次触发，报警器没有响应。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const stop = sys.comps.btnstop;
                    stop._setPressed(true);
                    await new Promise(r => setTimeout(r, 3000));
                    stop._setPressed(false);
                    await new Promise(r => setTimeout(r, 2000));                    
                    const alarm = sys.comps.alarm;
                    alarm.alarming = false;
                    alarm.silenced = false;                          
                },
                check: () => sys.comps.btnstop.isOn === false
            },
            {
                msg: "6：持续触发报警，确认继电器动作。调出万用表，测量输出触头没有导通，确认触头故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const stop = sys.comps.btnstop;
                    stop._setPressed(true);
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.multimeter.group.visible(true);

                    const newwires = [{ from: 'multimeter_wire_v', to: 'vrelay_wire_NO', type: 'wire' },
                    { from: 'multimeter_wire_com', to: 'vrelay_wire_COM', type: 'wire' }];
                    for (const conn of newwires) {
                        const exists = sys.conns.some(c => sys._connEqual(c, conn));
                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await sys.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    sys.comps.multimeter.mode = 'RES200';
                    sys.comps.multimeter._updateAngleByMode();
                    await new Promise(r => setTimeout(r, 3000));
                    stop._setPressed(false);

                },
                check: async () => {
                    const newwires = [{ from: 'multimeter_wire_v', to: 'vrelay_wire_NO', type: 'wire' },
                    { from: 'multimeter_wire_com', to: 'vrelay_wire_COM', type: 'wire' }];
                    //检查newwires已经连线
                    const wiresConnected = newwires.every(conn => sys.conns.some(c => sys._connEqual(c, conn)));
                    return wiresConnected;
                }
            },
            {
                msg: "7：修复故障，再次按下报警测试按钮，触发报警，确认正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.vrelay.contactFault = false;
                    await new Promise(r => setTimeout(r, 2000));
                    const stop = sys.comps.btnstop;
                    stop._setPressed(true);
                    await new Promise(r => setTimeout(r, 5000));
                    stop._setPressed(false);
                    await new Promise(r => setTimeout(r, 2000));                    
                    const alarm = sys.comps.alarm;
                    alarm.alarming = false;
                    alarm.silenced = false;                          
                },
                check: () => sys.comps.btnstop.isOn === false
            },
            {
                msg: "8：消音、确认警报，恢复正常运行",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));
                    const cc = sys.comps.cc;
                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms = cc.activeAlarms.filter(a => !a.confirmed);

                },
                check: async () => {
                    const cc = sys.comps.cc;
                    return cc.activeAlarms.every(a => a.muted && a.confirmed);
                }
            }
        ];
        sys.stepsArray[3] = [
            {
                msg: "1：完成系统连线. ",
                act: async () => {
                    sys.conns = [];
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyAllPresets();
                },
                check: () => checkConnectionsExist([0, 1, 2, 3, 4, 5, 6, 7])
            },
            {
                msg: "2：起动系统.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.applyStartSystem();
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "3：触发系统死机故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const ai = sys.comps.ai;
                    ai.sysFault = true;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.ai.sysFault === true
            },
            {
                msg: "4：消音、确认警报。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const cc = sys.comps.cc;
                    const alarm = sys.comps.alarm;
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    alarm.alarming = false;
                    alarm.silenced = false;
                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 4000));
                    const cc = sys.comps.cc;
                    console.log(cc.activeAlarms);
                    return cc.activeAlarms.every(a => a.muted);
                }
            },
            {
                msg: "5：找到系统死机故障模块、观察运行指示灯、故障指示灯，确认系统死机。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.highlight(true);
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.highlight(false);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.lastClickedId === 'ai'
            },
            {
                msg: "6：修复系统死机故障，清除警报，恢复正常运行",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.ai.sysFault = false;
                    await new Promise(r => setTimeout(r, 5000));
                    const cc = sys.comps.cc;
                    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
                    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
                    cc.activeAlarms = cc.activeAlarms.filter(a => !a.confirmed);

                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 4000));
                    const cc = sys.comps.cc;
                    return cc.activeAlarms.every(a => a.muted && a.confirmed);
                }
            }
        ];        
    }

    // ==========================================
    // 2. 故障初始化
    // ==========================================
    initFault() {
        const sys = this.sys;

        sys.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "1. DPU 通信线路故障 ",
                trigger: () => { sys.comps['ai'].commFault = true; },
                check: () => { return sys.comps['ai'].commFault === true; },
                repair: () => { sys.comps['ai'].commFault = false; }
            },
            2: {
                id: 2,
                name: "2. DPU 输入通道故障 ",
                trigger: () => { sys.comps['ai'].channelFault = true; },
                check: () => { return sys.comps['ai'].channelFault === true; },
                repair: () => { sys.comps['ai'].channelFault = false; }
            },
            3: {
                id: 3,
                name: "3. 继电器板 触头故障 ",
                trigger: () => { sys.comps['vrelay'].contactFault = true; },
                check: () => { return sys.comps['vrelay'].contactFault === true; },
                repair: () => { sys.comps['vrelay'].contactFault = false; }
            },

            4: {
                id: 4,
                name: "4. DPU 系统故障 ",
                trigger: () => { sys.comps['ai'].sysFault = true; },
                check: () => { return sys.comps['ai'].sysFault === true; },
                repair: () => { sys.comps['ai'].sysFault = false; }
            },
            5: {
                id: 5,
                name: "5. DPU 模块故障 ",
                trigger: () => { sys.comps['ai'].moduleFault = true; },
                check: () => { return sys.comps['ai'].moduleFault === true; },
                repair: () => { sys.comps['ai'].moduleFault = false; }
            },
            6: {
                id: 6,
                name: "6. 继电器板 线圈故障 ",
                trigger: () => { sys.comps['vrelay'].coilFault = true; },
                check: () => { return sys.comps['vrelay'].coilFault === true; },
                repair: () => { sys.comps['vrelay'].coilFault = false; }
            },
        };

        const faultForm = document.getElementById('faultForm');
        if (faultForm) {
            faultForm.innerHTML = '';
            Object.values(sys.FAULT_CONFIG).forEach(fault => {
                const label = document.createElement('label');
                label.className = 'f-checkbox';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = fault.id;
                checkbox.id = `fault_check_${fault.id}`;
                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(` ${fault.name}`));
                faultForm.appendChild(label);
            });
        }
    }

    // ==========================================
    // 3. 流程切换与控制
    // ==========================================

    /** 项目选择框调用的函数，用于切换任务流程 */
    switchWorkflow(taskValue) {
        const sys = this.sys;
        if (!taskValue) {
            console.log("未选择任何任务，清空流程数据");
            sys.workflowComp._workflow = [];
            sys.workflowComp._workflowIdx = 0;
            if (sys.workflowComp._workflowPanelEl) {
                sys.workflowComp.closeWorkflowPanel();
            }
            return;
        }
        console.log("切换至任务:", taskValue);
        sys.workflowComp._workflow = sys.stepsArray[taskValue];
        sys.workflowComp._workflowIdx = 0;
        if (sys.workflowComp._workflowPanelEl) {
            sys.workflowComp.closeWorkflowPanel();
        }
    }

    /** 根据用户选择的方式（单步/完整/评估/演练）打开流程面板 */
    openWorkflowPanel(mode) {
        const sys = this.sys;
        if (mode === 'step') {
            sys.workflowComp.stepByStep();
        } else {
            sys.workflowComp.openWorkflowPanel(mode);
        }
    }

    // ==========================================
    // 4. 快捷操作
    // ==========================================

    /** 一键自动连线：将预设的逻辑关系注入连接池 */
    applyAllPresets() {
        const sys = this.sys;
        sys.conns = [
            { from: 'ai_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'ai_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'ao_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'ao_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'di_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'di_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'do_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'do_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },

            { from: 'ai_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'ai_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'ao_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'ao_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'di_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'di_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'do_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'do_wire_can1n', to: 'can_wire_can1n', type: 'wire' },

            { from: 'cc_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'cc_wire_can1n', to: 'can_wire_can1n', type: 'wire' },

            { from: 'tank_wire_p', to: 'ai_wire_ch1p', type: 'wire' },
            { from: 'tank_wire_n', to: 'ai_wire_ch1n', type: 'wire' },
            { from: 'tank_wire_l', to: 'do_wire_ch1p', type: 'wire' },
            { from: 'tank_wire_r', to: 'do_wire_ch1n', type: 'wire' },

            { from: 'fuel_wire_l', to: 'ai_wire_ch3p', type: 'wire' },
            { from: 'fuel_wire_r', to: 'ai_wire_ch3n', type: 'wire' },
            { from: 'fuel_wire_p', to: 'ao_wire_ch1p', type: 'wire' },
            { from: 'fuel_wire_n', to: 'ao_wire_ch1n', type: 'wire' },

            { from: 'prelay_wire_NO', to: 'btnstop_wire_l', type: 'wire' },
            { from: 'btnstop_wire_r', to: 'di_wire_ch1p', type: 'wire' },
            { from: 'prelay_wire_COM', to: 'di_wire_ch1n', type: 'wire' },

            { from: 'vrelay_wire_l', to: 'do_wire_ch3p', type: 'wire' },
            { from: 'vrelay_wire_r', to: 'do_wire_ch3n', type: 'wire' },
            { from: 'vrelay_wire_NO', to: 'alarm_wire_l', type: 'wire' },
            { from: 'vrelay_wire_COM', to: 'alarm_wire_r', type: 'wire' },

        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();

        const tank = sys.comps.tank;
        tank.pump.mode = 'remote';
        tank._modeKnob.rotation(45);
        tank.targetRunning = false;
        tank._updateRemoteCommand();
        tank._refreshCache();

        const cc = sys.comps.cc;
        cc.levelCtrl.simMode = 'AUTO';
        cc.levelCtrl.isManualMode = false;
        // 通过 CAN 总线发送模式切换命令到 DO 模块
        const outputCh = cc.levelCtrl.outputChannel;
        const chIdx = outputCh === 'ch1' ? 0 : outputCh === 'ch2' ? 1 : 0;
        // 0 = hand (手动), 1 = auto (自动)
        const modeValue = 1;  // 
        const newMode = 'auto'; // 对应 DO 模块的模式
        try {
            cc._requestNodeConfig('do', 0x10, chIdx);  // 0x10: 设置模式
            // 构建模式设置命令帧
            const bus = cc.sys?.canBus;
            if (bus && cc.busConnected && !cc.commFault) {
                bus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x10, chIdx, modeValue, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now(),
                });
            }
        } catch (_) { }
        // 同步更新 DO 页面相应通道的模式
        const doMod = cc.sys?.comps?.['do'];
        if (doMod && doMod.channels) {
            const outputChId = cc.levelCtrl.outputChannel;
            if (doMod.channels[outputChId]) {
                doMod.channels[outputChId].mode = newMode;
            }
        }
        if (!cc.data.do[cc.levelCtrl.outputChannel]) {
            cc.data.do[cc.levelCtrl.outputChannel] = {};
        }
        cc.data.do[cc.levelCtrl.outputChannel].mode = newMode;
        cc._refreshCache();

        const fuel = sys.comps.fuel;
        fuel.valveMode = 'remote';
        fuel._modeKnob.rotation(45);
        fuel._updateRemoteCommand();
        fuel._refreshCache();

        cc.tempCtrl.simMode = 'AUTO';
        cc.tempCtrl.isManualMode = false;

        // 同步 AO 模块模式（通过 CAN 总线）
        const toutputCh = cc.tempCtrl.outputChannel;
        const tchIdx = toutputCh === 'ch1' ? 0 : outputCh === 'ch2' ? 1 : 0;
        const tmodeValue = 1; // 0 = hand, 1 = auto
        const tnewMode = 'auto';

        try {
            const bus = cc.sys?.canBus;
            if (bus && cc.busConnected && !cc.commFault) {
                bus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x10, tchIdx, tmodeValue, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now(),
                });
            }
        } catch (_) { }

        // 同步 AO 模块数据结构
        const aoMod = cc.sys?.comps?.['ao'];
        if (aoMod && aoMod.channels) {
            if (aoMod.channels[toutputCh]) {
                aoMod.channels[toutputCh].mode = tnewMode;
            }
        }
        if (!cc.data.ao[toutputCh]) {
            cc.data.ao[toutputCh] = {};
        }
        cc.data.ao[toutputCh].mode = tnewMode;
        cc._refreshCache();


    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        // const pid = sys.comps['pid'];
        const isManual = true;
        const steps = isManual
            ? [0, 25, 50, 75, 100]
            : [0.25, 0.5, 0.75, 1, 0];

        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {

        } else {
            // 自动模式预留扩展
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
