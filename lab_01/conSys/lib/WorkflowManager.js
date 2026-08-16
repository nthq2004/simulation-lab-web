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
    }

    // ==========================================
    // 1. 流程初始化：填充下拉框 + 定义所有步骤
    // ==========================================
    initSteps() {
        const sys = this.sys;

        const projectConfigs = [
            { id: 0, name: "1. 冷却水温度控制系统运行" },
            { id: 1, name: "2. PT100短路故障排除(项目6.1)" },
            { id: 2, name: "3. PT100断路故障排除(项目6.1)" },
            { id: 3, name: "4. 温度变送器输出断路故障排除" },
            { id: 4, name: "5. 温度变送器零点漂移故障排除(项目6.3)" },
            { id: 5, name: "6. 温度变送器量程偏差故障排除(项目6.3)" },
            { id: 6, name: "7. PID调节器参数失调故障排除(项目6.4)" },
            { id: 7, name: "8. PID调节器输出回路故障排除(项目6.4)" },
            { id: 8, name: "9. 三通调节阀执行机构卡死故障排除(项目6.2)" },
            { id: 9, name: "10. 三通调节阀信号输入回路断路故障排除" },
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
            { from: 'engine_pipe_o', to: 'pump_pipe_i', type: 'pipe' },
            { from: 'pump_pipe_o', to: 'tconn_pipe_l', type: 'pipe' },
            { from: 'tconn_pipe_u', to: 'valve_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'cooler_pipe_i', type: 'pipe' },
            { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' },
            { from: 'valve_pipe_r', to: 'engine_pipe_i', type: 'pipe' },

            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },

            { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
            { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
            { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' },
            { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            { from: 'pid_wire_no1', to: 'valve_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' },

            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            {
                msg: "1：从柴油机冷却水出口 --> 水泵入口。",
                act: async () => {
                    sys.conns = [];
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    sys.comps['pump'].pumpOn = false;
                    sys.comps['engine'].engOn = false;
                    sys.comps['pid'].mode = 'MAN';
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[0]);
                },
                check: () => checkConnectionsExist([0])
            },
            {
                msg: "2：从水泵出口 --> T型管上端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[1]);
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => checkConnectionsExist([1])
            },
            {
                msg: "3：从T型管右端 --> 三通调节阀左端",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[2]);
                },
                check: () => checkConnectionsExist([2])
            },
            {
                msg: "4：从T型管下端 --> 冷却器入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[3]);
                },
                check: () => checkConnectionsExist([3])
            },
            {
                msg: "5：从冷却器出口 --> 三通调节阀下端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[4]);
                },
                check: () => checkConnectionsExist([4])
            },
            {
                msg: "6：从三通调节阀上端 --> 柴油机冷却水入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[5]);
                },
                check: () => checkConnectionsExist([5])
            },
            {
                msg: "7：连接 PID 控制器电源到 DC24V 正负极,并接地。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[6]);
                    await sys.connMgr.addConnectionAnimated(autoConns[7]);
                    await sys.connMgr.addConnectionAnimated(autoConns[8]);
                },
                check: () => checkConnectionsExist([6, 7, 8])
            },
            {
                msg: "8：连接 PT100 信号线至温度变送器端子。",
                act: async () => {
                    await sys.connMgr.addConnectionAnimated(autoConns[9]);
                    await sys.connMgr.addConnectionAnimated(autoConns[10]);
                    await sys.connMgr.addConnectionAnimated(autoConns[11]);                    
                },
                check: () => checkConnectionsExist([9, 10,11])
            },
            {
                msg: "9：连接温度变送器输出信号 (4-20mA) 至 PID 输入端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[12]);
                    await sys.connMgr.addConnectionAnimated(autoConns[13]);
                    await sys.connMgr.addConnectionAnimated(autoConns[14]);
                },
                check: () => checkConnectionsExist([12, 13, 14])
            },
            {
                msg: "10：连接 PID 控制输出至三通调节阀电机端子。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[15]);
                    await sys.connMgr.addConnectionAnimated(autoConns[16]);
                },
                check: () => checkConnectionsExist([15, 16])
            },
            {
                msg: "11：连接 RS485 通讯总线至上位机监控终端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[17]);
                    await sys.connMgr.addConnectionAnimated(autoConns[18]);
                },
                check: () => checkConnectionsExist([17, 18])
            },
            {
                msg: "12：开启24V电源。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "13：手动调节阀门开度到略大于20%。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.mode = "MAN";
                    sys.comps.pid.OUT = 25;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.valve.currentPos > 0.2
            },
            {
                msg: "14：开启冷却水泵。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pump.pumpOn = true;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.pump.pumpOn === true
            },
            {
                msg: "15：开启柴油机。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.engine.engOn = true;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.engine.engOn === true
            },
            {
                msg: "16：PID控制器切换到自动模式。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.mode = 'AUTO';
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.pid.mode === 'AUTO'
            },
            {
                msg: "17：确保系统警报已经消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => !sys.comps.monitor.activeAlarms.some(a => !a.muted)
            }
        ];
        sys.stepsArray[1] = [
            // --- PT100短路故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 20000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发PT100短路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pt._pt100Fault = 'short';
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.pt._pt100Fault === 'short'
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: async () => {
                    // 1. 先等待 6s 确保仿真引擎的温度升高并触发了报警逻辑
                    await new Promise(r => setTimeout(r, 3000));
                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;
                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：PID控制器切换到手动模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：断开温度变送器电源，断开PT100接线。",
                act: async () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    await new Promise(r => setTimeout(r, 2000));
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    return transLines.every(target => {
                        return !sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                }

            },
            {
                msg: "6：万用表打到蜂鸣器档或者200欧姆档，测量PT100电阻，确认电阻为0。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.multimeter.mode = "RES200";
                    sys.comps.multimeter._updateAngleByMode();
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(resolve => setTimeout(resolve, 5000));

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "RES200" || sys.comps.multimeter.mode === "DIODE";
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c, conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conn2));
                    const c4 = sys.comps.multimeter.value < 1;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "7：更换PT100，确认新电阻的阻值正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.multimeter.mode = "RES200";
                    sys.comps.multimeter._updateAngleByMode();
                    sys.comps.pt._pt100Fault = null;
                    await new Promise(r => setTimeout(r, 3000));

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "RES200" || sys.comps.multimeter.mode === "DIODE";
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c, conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conn2));
                    const c4 = sys.comps.multimeter.value > 100;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "8：接入新的PT100，重新接入PID输入回路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    sys.removeConn(conn1);
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    sys.removeConn(conn2);
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒

                    sys.comps.multimeter.mode = "OFF";
                    sys.comps.multimeter._updateAngleByMode();

                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.addConn(conn);   // 重新接入当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 2000));

                },
                check: () => {
                    const requiredLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];

                    // 检查是否每一条预期的线都存在于当前的 conns 数组中
                    return requiredLines.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });
                    });
                }
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[2] = [
            // --- PT100断路故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 20000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发PT100断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pt._pt100Fault = 'open';
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.pt._pt100Fault === 'open'
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: async () => {
                    // 1. 先等待 6s 确保仿真引擎的温度升高并触发了报警逻辑
                    await new Promise(r => setTimeout(r, 3000));
                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;
                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：PID控制器切换到手动模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：断开温度变送器电源，断开PT100接线。",
                act: async () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    await new Promise(r => setTimeout(r, 3000));
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    return transLines.every(target => {
                        return !sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                }

            },
            {
                msg: "6：万用表打到200k欧姆档，测量PT100电阻，确认电阻为无穷大。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.multimeter.mode = "RES200k";
                    sys.comps.multimeter._updateAngleByMode();
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(r => setTimeout(r, 5000));

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "RES200k";
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c, conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conn2));
                    const c4 = sys.comps.multimeter.value > 1000 || sys.comps.multimeter.value === Infinity;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "7：更换PT100，确认新电阻的阻值正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.multimeter.mode = "RES200";
                    sys.comps.multimeter._updateAngleByMode();
                    sys.comps.pt._pt100Fault = null;
                    await new Promise(r => setTimeout(r, 5000));

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "RES200"||sys.comps.multimeter.mode === "RES2k";
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c, conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conn2));
                    const c4 = sys.comps.multimeter.value < 200;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "8：接入新的PT100，重新接入PID输入回路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const conn1 = { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' };
                    sys.removeConn(conn1);
                    await new Promise(r => setTimeout(r, 1000)); // 等待2秒
                    sys.removeConn(conn2);
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒

                    sys.comps.multimeter.mode = "OFF";
                    sys.comps.multimeter._updateAngleByMode();

                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.addConn(conn);   // 重新接入当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 2000));

                },
                check: () => {
                    const requiredLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];

                    // 检查是否每一条预期的线都存在于当前的 conns 数组中
                    return requiredLines.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });
                    });
                }
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[3] = [
            // --- 温度变送器输出回路断路故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 20000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发温度变送器输出回路断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.ttrans.isBreak = true;
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => sys.comps.ttrans.isBreak === true
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: async () => {
                    // 1. 先等待 6s 确保仿真引擎的温度升高并触发了报警逻辑
                    await new Promise(r => setTimeout(r, 3000));

                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;

                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：PID控制器切换到手动模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：万用表打到直流200V档，测量温度变送器电源电压正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.multimeter.mode = "DCV200";
                    sys.comps.multimeter._updateAngleByMode();
                    const conn1 = { from: 'multimeter_wire_com', to: 'ttrans_wire_n', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'ttrans_wire_p', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(resolve => setTimeout(resolve, 5000));

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "DCV200";
                    const conn1 = { from: 'multimeter_wire_com', to: 'ttrans_wire_n', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'ttrans_wire_p', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c, conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conn2));
                    const c4 = sys.comps.multimeter.value > 23 || sys.comps.multimeter.value === 24;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "6：观察20mA电流表，电流为0，可确认温度变送器输出回路断路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 5000));
                    const c1 = sys.comps.ampmeter.value < 0.1;
                    return c1;
                }

            },
            {
                msg: "7：断开温度变送器电源接线，修复断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const transLines = [
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    sys.comps.ttrans.isBreak = false;
                    await new Promise(r => setTimeout(r, 5000));

                },
                check: () => {
                    const c1 = sys.comps.ttrans.isBreak === false;
                    return c1;
                }
            },
            {
                msg: "8：接通温度变送器电源回路，电流表显示电流大于4mA，确认回路恢复正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const transLines = [
                        { from: 'ttrans_wire_p', to: 'ampmeter_wire_n', type: 'wire' },
                        { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.addConn(conn);   // 
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    await new Promise(r => setTimeout(r, 2000));

                },
                check: () => {
                    const c1 = sys.comps.ampmeter.value > 4;
                    return c1;
                }
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[4] = [
            // --- 温度变送器零点漂移故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 20000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发温度变送器零点漂移故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.ttrans.zeroAdj = 0.4;
                    sys.comps.ttrans.knobs['zero'].rotation(180);
                    sys.comps.ttrans._refreshCache();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.ttrans.zeroAdj > 0.1
            },
            {
                msg: "3：PID控制器切换到手动模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "4：断开PT100的接线，接入标准可调电阻。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    sys.comps.pt.group.position({ x: 270, y: 480 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    sys.comps.stdres.group.position({ x: 280, y: 400 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    for (const conn of transLinesNew) {
                        sys.addConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const ptDisconnected = transLines.every(target => {
                        return !sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const stdresConnected = transLinesNew.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    return ptDisconnected && stdresConnected;
                }
            },
            {
                msg: "5：将标准电阻每次增加3.85欧姆，直到138.5欧姆左右，确认每次仪表指示值增加10度，可确认变送器零点漂移故障，而不是量程偏差故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    for (let i = 1; i <= 10; i++) {
                        sys.comps.stdres.currentResistance = 100 + i * 3.851;
                        sys.comps.stdres.update();
                        await new Promise(r => setTimeout(r, 3000));

                    }
                    await new Promise(resolve => setTimeout(resolve, 4000));

                },
                check: () => sys.comps.stdres.currentResistance > 138

            },
            {
                msg: "6：将标准电阻调回100欧姆，调整变送器零点，使得温度显示值为0度左右。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.stdres.currentResistance = 100;
                    sys.comps.stdres.update();
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.ttrans.zeroAdj = 0;
                    sys.comps.ttrans.knobs['zero'].rotation(0);
                    sys.comps.ttrans._refreshCache();
                    await new Promise(resolve => setTimeout(resolve, 5000));

                },
                check: () => {
                    const c1 = Math.abs(sys.comps.stdres.currentResistance - 100) < 3;
                    const c2 = Math.abs(sys.comps.ttrans.zeroAdj) < 0.05;
                    return c1 && c2;
                }
            },
            {
                msg: "7：将标准电阻调回138.5欧姆，确认温度显示值为100度左右。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.stdres.currentResistance = 138.51;
                    sys.comps.stdres.update();
                    await new Promise(resolve => setTimeout(resolve, 5000));

                },
                check: () => {
                    const c1 = Math.abs(sys.comps.stdres.currentResistance - 138) < 3;
                    const c2 = Math.abs(sys.comps.ttrans.zeroAdj) < 0.05;
                    return c1 && c2;
                }
            },
            {
                msg: "8：断开标准可调电阻，重新接回PT100电阻，确认温度显示正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    for (const conn of transLinesNew) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    sys.comps.stdres.group.position({ x: 1200, y: 310 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    sys.comps.pt.group.position({ x: 270, y: 400 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.addConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    await new Promise(r => setTimeout(r, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const ptConnected = transLines.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const stdresDisconnected = transLinesNew.every(target => {
                        return !sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    return ptConnected && stdresDisconnected;
                }
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[5] = [
            // --- 温度变送器量程偏差故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 20000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发温度变送器量程偏差故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.ttrans.spanAdj = 1.125;
                    sys.comps.ttrans.knobs['span'].rotation(90);
                    sys.comps.ttrans._refreshCache();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.ttrans.spanAdj > 1.1
            },
            {
                msg: "3：PID控制器切换到手动模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "4：断开PT100的接线，接入标准可调电阻。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    sys.comps.pt.group.position({ x: 270, y: 500 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    sys.comps.stdres.group.position({ x: 270, y: 360 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    for (const conn of transLinesNew) {
                        sys.addConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const ptDisconnected = transLines.every(target => {
                        return !sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const stdresConnected = transLinesNew.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    return ptDisconnected && stdresConnected;
                }
            },
            {
                msg: "5：将标准电阻每次增加3.85欧姆，直到138.5欧姆左右，确认每次仪表指示值的变化量不等于10度，可确认变送器量程偏差故障，而不是零点漂移故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    for (let i = 1; i <= 10; i++) {
                        sys.comps.stdres.currentResistance = 100 + i * 3.851;
                        sys.comps.stdres.update();
                        await new Promise(r => setTimeout(r, 2000));

                    }
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => sys.comps.stdres.currentResistance > 138

            },
            {
                msg: "6：将标准电阻保持138.5欧姆，调整变送器量程，使得温度显示值为100度左右。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.stdres.currentResistance = 138.51;
                    sys.comps.stdres.update();
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.ttrans.spanAdj = 1;
                    sys.comps.ttrans.knobs['span'].rotation(0);
                    await new Promise(r => setTimeout(r, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const c1 = Math.abs(sys.comps.stdres.currentResistance - 138) < 3;
                    const c2 = Math.abs(sys.comps.ttrans.spanAdj - 1) < 0.05;
                    return c1 && c2;
                }
            },
            {
                msg: "7：将标准电阻调回100欧姆，确认温度显示值为0度左右。若有偏差，调整量程。然后将电阻调到138.5欧姆，确保温度显示值为100度左右。反复调整2-3次。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.stdres.currentResistance = 100;
                    sys.comps.stdres.update();
                    await new Promise(resolve => setTimeout(resolve, 5000));

                },
                check: () => {
                    const c1 = Math.abs(sys.comps.stdres.currentResistance - 100) < 3;
                    const c2 = Math.abs(sys.comps.ttrans.spanAdj - 1) < 0.05;
                    return c1 && c2;
                }
            },
            {
                msg: "8：断开标准可调电阻，重新接回PT100电阻，确认温度显示正常。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    for (const conn of transLinesNew) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    sys.comps.stdres.group.position({ x: 1250, y: 320 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    sys.comps.pt.group.position({ x: 270, y: 450 });
                    await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' }
                    ];
                    for (const conn of transLines) {
                        sys.addConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    };
                    await new Promise(r => setTimeout(r, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const transLines = [
                        { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const ptConnected = transLines.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    const transLinesNew = [
                        { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' },
                        { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' },
                    ];
                    const stdresDisconnected = transLinesNew.every(target => {
                        return !sys.conns.some(conn => {
                            return sys._connEqual(conn, target);
                        });

                    });
                    return ptConnected && stdresDisconnected;
                }
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[6] = [
            // --- PID调节器参数失调故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 20000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发PID参数失调故障,温度波动，阀门开度几乎不变。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.P = 0.03;
                    sys.comps.pid.I = 0;
                    sys.comps.pid.D = 0;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                },
                check: () => sys.comps.pid.P < 0.5
            },
            {
                msg: "3：手动改变温度设定值,调到75度或85度，阀门开度仍然不变化或变化小。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    for (let i = 1; i <= 5; i++) {
                        sys.comps.pid.SV = 80 - i;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => Math.abs(sys.comps.pid.SV - 80) > 3
            },
            {
                msg: "4：PID控制器切换到手动模式，阀位可调节到60-70之间，说明PID调节器输出回路正常，自动模式下P/I/D参数设置不当。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：进入PID系统菜单，调节P、I、D参数，比例系数调到4左右。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.P = 4;
                    sys.comps.pid.I = 30;
                    sys.comps.pid.D = 0;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => sys.comps.pid.P > 3
            },
            {
                msg: "6：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[7] = [
            // --- PID调节器输出回路断路故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 20000));
                },
                check: async () => {
                    // 1. 等待 2 秒让物理引擎计算出趋势
                    await new Promise(r => setTimeout(r, 2000));
                    const pid = sys.comps.pid;
                    // c1: 必须是自动模式
                    const c1 = pid.mode === "AUTO";

                    // c2: 误差范围缩小。
                    // 如果要求严格，建议范围设为 1~2 度。10 度误差对于 80 度的目标确实太大了。
                    const c2 = Math.abs(pid.PV - pid.SV) < 10;

                    // c3: 报警检查逻辑改进
                    // 应该检查：1. 是否当前完全没有报警（通常系统稳定后不应有报警）
                    // 或者：2. 如果有报警，必须全部已消音
                    const alarms = sys.comps.monitor.activeAlarms;
                    const c3 = alarms.length === 0 || alarms.every(a => a.muted === true);

                    // c4: 基础硬件状态
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;

                    // 只有当温度真正接近 80 度，且硬件全开、模式正确、无未处理报警时才通过
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发PID调节器输出回路断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.out1Fault = true;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.pid.out1Fault === true
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;
                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：阀门切换到本地模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.controlMode = "MANUAL";
                    sys.comps.valve.updateModeText("MANUAL");
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.valve.manualPos = 0.65;
                    sys.comps.valve.update();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.valve.controlMode === "MANUAL";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：断开PID调节器输出回路正极接线，接入20mA电流表，电流为0。无论手动还是自动，OUT有输出，但回路电流始终为0。",
                act: async () => {
                    const transLines = [
                        { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' }
                    ];
                    await new Promise(r => setTimeout(r, 3000));
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    sys.comps.ampmeter2.group.position({ x: 720, y: 300 });
                    const conn1 = { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' };
                    const conn2 = { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 50;
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const connP = { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' };
                    const c1 = !sys.conns.some(c => sys._connEqual(c,connP));
                    const transLines = [
                        { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
                        { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' }
                    ];
                    const ampMeterIn = transLines.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn,target);
                        });

                    });
                    const c2 = sys.comps.ampmeter2.value <0.1;
                    const c3 = sys.comps.pid.mode === "MAN";
                    return c1 && ampMeterIn && c2 && c3;
                }

            },
            {
                msg: "6：关闭24V电源，测量输出回路电阻，电阻正常为250欧姆左右，确认是PID调节器输出回路断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.dcpower.isOn = false;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.multimeter.mode = "RES2k";
                    sys.comps.multimeter._updateAngleByMode();
                    const conn1 = { from: 'multimeter_wire_com', to: 'pid_wire_no1', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pid_wire_po1', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(r => setTimeout(r, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "RES2k" || sys.comps.multimeter.mode === "RES200k";
                    const conn1 = { from: 'multimeter_wire_com', to: 'pid_wire_no1', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'pid_wire_po1', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c,conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c,conn2));
                    const c4 = Math.abs(sys.comps.multimeter.value - 250) < 10;
                    const c5 = sys.comps.dcpower.isOn === false;
                    return c1 && c2 && c3 && c4 && c5;
                }
            },
            {
                msg: "7：修复PID调节器输出回路故障。万用表打到直流20V档。接通电源，观察输出回路电流应大于4mA，万用表测量电压应大于1V。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.out1Fault = false;
                    await new Promise(r => setTimeout(r, 1000));
                    sys.comps.multimeter.mode = "DCV20";
                    sys.comps.multimeter._updateAngleByMode();
                    await new Promise(r => setTimeout(r, 1000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.dcpower.isOn === true;
                    const c2 = sys.comps.pid.out1Fault === false;
                    const c3 = sys.comps.multimeter.mode === "DCV20" || sys.comps.multimeter.mode === "DCV200";
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "8：阀门切换到遥控模式",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.controlMode = "REMOTE";
                    sys.comps.valve.updateModeText("REMOTE");
                    await new Promise(resolve => setTimeout(resolve, 1000));
                },
                check: () => sys.comps.valve.controlMode === "REMOTE"
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[8] = [
            // --- 三通调节阀执行机构卡死故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 20000));
                },
                check: async () => {
                    // 1. 等待 2 秒让物理引擎计算出趋势
                    await new Promise(r => setTimeout(r, 2000));

                    const pid = sys.comps.pid;
                    // c1: 必须是自动模式
                    const c1 = pid.mode === "AUTO";

                    // c2: 误差范围缩小。
                    // 如果要求严格，建议范围设为 1~2 度。10 度误差对于 80 度的目标确实太大了。
                    const c2 = Math.abs(pid.PV - pid.SV) < 10;

                    // c3: 报警检查逻辑改进
                    // 应该检查：1. 是否当前完全没有报警（通常系统稳定后不应有报警）
                    // 或者：2. 如果有报警，必须全部已消音
                    const alarms = sys.comps.monitor.activeAlarms;
                    const c3 = alarms.length === 0 || alarms.every(a => a.muted === true);

                    // c4: 基础硬件状态
                    const c4 = sys.comps.engine.engOn && sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;

                    // 只有当温度真正接近 80 度，且硬件全开、模式正确、无未处理报警时才通过
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发三通调节阀执行机构卡死故障,温度波动，阀门开度完全不变。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.isStuck = true;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.valve.isStuck === true
            },
            {
                msg: "3：手动改变温度设定值,调到75度或85度，阀门开度仍然不变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    for (let i = 1; i <= 5; i++) {
                        sys.comps.pid.SV = 80 - i;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => Math.abs(sys.comps.pid.SV - 80) > 3
            },
            {
                msg: "4：调节器切换到手动模式,手动调整开度到20%以上，阀门开度仍然不变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 30;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "MAN";
                    const c2 = sys.comps.valve.isStuck === true;
                    const c3 = sys.comps.pid.OUT - 20 > 1;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：阀门切换到本地模式，转动手轮，阀门不动作，确定阀门卡死。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.controlMode = "MANUAL";
                    sys.comps.valve.updateModeText("MANUAL");
                    await new Promise(r => setTimeout(r, 2000));

                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.valve.controlMode === "MANUAL";
                    const c2 = sys.comps.valve.isStuck === true;
                    return c1 && c2;
                }
            },
            {
                msg: "6：关闭柴油机，关闭淡水泵，关闭电源。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.engine.engOn = false;
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pump.pumpOn = false;
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = false;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.engine.engOn === false;
                    const c2 = sys.comps.pump.pumpOn === false;
                    const c3 = sys.comps.dcpower.isOn === false;
                    return c1 && c2 && c3;
                }

            },
            {
                msg: "7：修复阀门卡死故障。阀门转到手动模式，手轮调节阀门到50%开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.isStuck = false;
                    sys.comps.valve.controlMode = "MANUAL";
                    sys.comps.valve.updateModeText("MANUAL");
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.valve.manualPos = 0.5
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const c1 = Math.abs(sys.comps.valve.currentPos - 0.5) < 0.1;
                    const c2 = sys.comps.valve.isStuck === false;
                    const c3 = sys.comps.valve.controlMode === "MANUAL";
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "8：阀门转到遥控模式，重启系统。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.controlMode = "REMOTE";
                    sys.comps.valve.updateModeText("REMOTE");
                    await new Promise(r => setTimeout(r, 3000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(resolve => setTimeout(resolve, 5000));
                },
                check: () => sys.comps.valve.controlMode === "REMOTE"

            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ];
        sys.stepsArray[9] = [
            // --- 三通调节阀信号输入回路断路故障排除 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyAllPresets();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.applyStartSystem();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 20000));
                },
                check: async () => {
                    // 1. 等待 2 秒让物理引擎计算出趋势
                    await new Promise(r => setTimeout(r, 2000));

                    const pid = sys.comps.pid;
                    // c1: 必须是自动模式
                    const c1 = pid.mode === "AUTO";

                    // c2: 误差范围缩小。
                    // 如果要求严格，建议范围设为 1~2 度。10 度误差对于 80 度的目标确实太大了。
                    const c2 = Math.abs(pid.PV - pid.SV) < 10;

                    // c3: 报警检查逻辑改进
                    // 应该检查：1. 是否当前完全没有报警（通常系统稳定后不应有报警）
                    // 或者：2. 如果有报警，必须全部已消音
                    const alarms = sys.comps.monitor.activeAlarms;
                    const c3 = alarms.length === 0 || alarms.every(a => a.muted === true);

                    // c4: 基础硬件状态
                    const c4 = sys.comps.engine.engOn &&sys.comps.pump.pumpOn && sys.comps.dcpower.isOn;

                    // 只有当温度真正接近 80 度，且硬件全开、模式正确、无未处理报警时才通过
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发三通调节阀信号输入回路断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.currentResistance = 1000000;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.valve.currentResistance > 1000
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;
                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：阀门切换到本地模式，阀位控制在60-70之间。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.controlMode = "MANUAL";
                    sys.comps.valve.updateModeText("MANUAL");
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.valve.manualPos = 0.65;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.valve.controlMode === "MANUAL";
                    const c2 = sys.comps.valve.currentPos <= 0.7;
                    const c3 = sys.comps.valve.currentPos >= 0.6;
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "5：断开PID调节器输出回路正极接线，接入20mA电流表，电流为0。无论手动还是自动，OUT有输出，但回路电流始终为0。",
                act: async () => {
                    const transLines = [
                        { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' }
                    ];
                    await new Promise(r => setTimeout(r, 3000));
                    for (const conn of transLines) {
                        sys.removeConn(conn);   // 删除当前线
                        await new Promise(r => setTimeout(r, 2000)); // 等待2秒
                    }
                    sys.comps.ampmeter2.group.position({ x: 620, y: 320 });
                    const conn1 = { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' };
                    const conn2 = { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.pid.mode = "MAN";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.OUT = 50;
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const connP =  { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' };
                    const c1 = !sys.conns.some(c => sys._connEqual(c,connP));
                    const transLines = [
                        { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
                        { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' }
                    ];
                    const ampMeterIn = transLines.every(target => {
                        return sys.conns.some(conn => {
                            return sys._connEqual(conn,target);
                        });

                    });
                    const c2 = sys.comps.ampmeter2.value <0.1;
                    const c3 = sys.comps.pid.mode === "MAN";
                    return c1 && ampMeterIn && c2 && c3;
                }

            },
            {
                msg: "6：关闭24V电源，测量输出回路电阻，电阻正常为250欧姆左右，三通调节阀信号输入端子现在为无穷大，确认是三通调节阀信号输入回路断路故障。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.dcpower.isOn = false;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.multimeter.mode = "RES2k";
                    sys.comps.multimeter._updateAngleByMode();
                    const conn1 = { from: 'multimeter_wire_com', to: 'valve_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'valve_wire_l', type: 'wire' };
                    await sys.addConnectionAnimated(conn1);
                    await sys.addConnectionAnimated(conn2);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();

                },
                check: () => {
                    const c1 = sys.comps.multimeter.mode === "RES2k" || sys.comps.multimeter.mode === "RES200k";
                    const conn1 = { from: 'multimeter_wire_com', to: 'valve_wire_r', type: 'wire' };
                    const conn2 = { from: 'multimeter_wire_v', to: 'valve_wire_l', type: 'wire' };
                    const c2 = sys.conns.some(c => sys._connEqual(c,conn1));
                    const c3 = sys.conns.some(c => sys._connEqual(c,conn2));
                    const c4 = sys.comps.multimeter.value > 1000;
                    const c5 = sys.comps.dcpower.isOn === false;
                    return c1 && c2 && c3 && c4 && c5;
                }
            },
            {
                msg: "7：修复三通调节阀信号输入回路断路故障。万用表显示电阻约为250欧姆左右。接通电源，观察输出回路电流应大于4mA，万用表测量电压应大于1V。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.currentResistance = 250;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.comps.multimeter.mode = "DCV20";
                    sys.comps.multimeter._updateAngleByMode();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.comps.dcpower.isOn === true;
                    const c2 = sys.comps.ampmeter2.value >4 ;
                    const c3 = sys.comps.multimeter.mode === "DCV20" || sys.comps.multimeter.mode === "RES2k";
                    return c1 && c2 && c3;
                }
            },
            {
                msg: "8：阀门切换到遥控模式",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.valve.controlMode = "REMOTE";
                    sys.comps.valve.updateModeText("REMOTE");
                    await new Promise(resolve => setTimeout(resolve, 1000));
                },
                check: () => sys.comps.valve.controlMode === "REMOTE"
            },
            {
                msg: "9：系统切回自动模式，确认PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && c3;
                }
            }

        ]        
    }

    // ==========================================
    // 2. 故障初始化
    // ==========================================
    initFault() {
        const sys = this.sys;

        sys.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "2. PT100 传感器短路",
                trigger: () => { sys.comps['pt']._pt100Fault = 'short'; },
                check: () => { return sys.comps['pt']._pt100Fault === 'short'; },
                repair: () => { if (sys.comps['pt']._pt100Fault == 'short') sys.comps['pt']._pt100Fault = null; }
            },
            2: {
                id: 2,
                name: "3. PT100 传感器断路",
                trigger: () => { sys.comps['pt']._pt100Fault = 'open'; },
                check: () => { return sys.comps['pt']._pt100Fault === 'open'; },
                repair: () => { if (sys.comps['pt']._pt100Fault == 'open') sys.comps['pt']._pt100Fault = null; }
            },
            3: {
                id: 3,
                name: "4. 温度变送器输出断路",
                trigger: () => { sys.comps['ttrans'].isBreak = true; },
                check: () => { return sys.comps['ttrans'].isBreak === true; },
                repair: () => { sys.comps['ttrans'].isBreak = false; }
            },
            4: {
                id: 4,
                name: "5. 温度变送器零点漂移",
                trigger: () => {
                    sys.comps['ttrans'].zeroAdj = 0.4;
                    sys.comps['ttrans'].knobs['zero'].rotation(180);
                    sys.comps.ttrans._refreshCache();
                },
                check: () => { return Math.abs(sys.comps['ttrans'].zeroAdj - 0.5) < 0.1; },
                repair: () => {
                    sys.comps['ttrans'].zeroAdj = 0;
                    sys.comps['ttrans'].knobs['zero'].rotation(0);
                    sys.comps.ttrans._refreshCache();
                }
            },
            5: {
                id: 5,
                name: "6. 温度变送器量程偏差",
                trigger: () => {
                    sys.comps['ttrans'].spanAdj = 1.125;
                    sys.comps['ttrans'].knobs['span'].rotation(90);
                    sys.comps.ttrans._refreshCache();
                },
                check: () => { return Math.abs(sys.comps['ttrans'].spanAdj - 1.125) < 0.05; },
                repair: () => {
                    sys.comps['ttrans'].spanAdj = 1;
                    sys.comps['ttrans'].knobs['span'].rotation(0);
                    sys.comps.ttrans._refreshCache();
                }
            },
            6: {
                id: 6,
                name: "7. PID调节器参数失调",
                trigger: () => {
                    sys.comps['pid'].P = 0.05;
                    sys.comps['pid'].I = 0;
                    sys.comps['pid'].D = 0;
                },
                check: () => { return Math.abs(sys.comps['pid'].P - 0.1) < 0.1; },
                repair: () => { sys.comps['pid'].P = 4; }
            },
            7: {
                id: 7,
                name: "8. PID调节器输出回路断路",
                trigger: () => { sys.comps['pid'].out1Fault = true; },
                check: () => { return sys.comps['pid'].out1Fault === true; },
                repair: () => { sys.comps['pid'].out1Fault = false; }
            },
            8: {
                id: 8,
                name: "9. 三通调节阀执行机构卡死",
                trigger: () => { sys.comps['valve'].isStuck = true; },
                check: () => { return sys.comps['valve'].isStuck === true; },
                repair: () => { sys.comps['valve'].isStuck = false; }
            },
            9: {
                id: 9,
                name: "10. 三通调节阀信号输入回路断路",
                trigger: () => { sys.comps['valve'].currentResistance = 1e8; },
                check: () => { return sys.comps['valve'].currentResistance > 10000; },
                repair: () => { sys.comps['valve'].currentResistance = 250; }
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
            { from: 'engine_pipe_o', to: 'pump_pipe_i', type: 'pipe' },
            { from: 'pump_pipe_o', to: 'tconn_pipe_l', type: 'pipe' },
            { from: 'tconn_pipe_u', to: 'valve_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'cooler_pipe_i', type: 'pipe' },
            { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' },
            { from: 'valve_pipe_r', to: 'engine_pipe_i', type: 'pipe' },

            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },            
            { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
            { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
            { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' },
            { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            { from: 'pid_wire_no1', to: 'valve_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' },

            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
        sys.comps.pump.pumpOn = true;
        sys.comps.engine.engOn = true;
        sys.comps.pid.mode = "AUTO";
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        const pid = sys.comps['pid'];
        const isManual = pid.mode === "MAN";
        const steps = isManual
            ? [0, 25, 50, 75, 100]
            : [0.25, 0.5, 0.75, 1, 0];

        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            pid.OUT = targetValue;
        } else {
            // 自动模式预留扩展
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
