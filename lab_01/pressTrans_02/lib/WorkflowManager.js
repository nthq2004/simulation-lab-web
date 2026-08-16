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
            { id: 0, name: "1. 压力变送器的功能测试(项目4.1)" },
            { id: 1, name: "2. 压力变送器回路断路故障排除(项目4.1)" },
            { id: 2, name: "3. 压力变送器气路漏气故障排除(项目4.1)" },
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
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
            { from: 'varires_wire_r', to: 'ptrans_wire_p', type: 'wire' },
            { from: 'ptrans_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'cab_pipe_o', to: 'stopv_pipe_i', type: 'pipe' },
            { from: 'stopv_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'tconn_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_l', to: 'pmeter_pipe_i', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'ptrans_pipe_i', type: 'pipe' },
        ];

        sys.stepsArray[0] = [
            {
                msg: "1. 24V电源(+) -> 负载电阻(+)",
                act: async () => {
                    this.conns = []; // 清空现有连接
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    sys.comps['stopv'].isOpen = false;
                    sys.comps['stopv'].update();

                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[0]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[0]))
            },
            {
                msg: "2. 负载电阻(-)-> 压力变送器(+)",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[1]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[1]))
            },
            {
                msg: "3.  压力变送器(-) -> 电流表(+)",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[2]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[2]))
            },
            {
                msg: "4. 电流表(-) -> 24V电源(-)",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[3]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[3]))
            },
            {
                msg: "5. 空气瓶出口 -> 截止阀右端",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[4]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[4]))
            },
            {
                msg: "6. 截止阀左端 -> 调节阀入口",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[5]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[5]))
            },
            {
                msg: "7. 调节阀出口 -> T型管下端",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[6]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[6]))
            },
            {
                msg: "8. T型管上端 -> 压力表",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[7]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[7]))
            },
            {
                msg: "9. T型管左端 -> 压力变送器气压口",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await sys.addConnectionAnimated(autoConns[8]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[8]))
            },
            {
                msg: "10. 按下24V电源键,接通电源",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = true;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps['dcpower'].isOn === true
            },
            {
                msg: "11. 合上截止阀,变送器气压为0,电流应为4mA.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['stopv'].isOpen = true;
                    sys.comps['stopv'].update();
                    sys.comps['preg'].setPressure = 0;
                    sys.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps['stopv'].isOpen === true && sys.comps['preg'].setPressure === 0 && Math.abs(sys.comps['ampmeter'].value - 4) < 0.1
            },
            {
                msg: `12. 将压力调节到0.25 * 量程,变送器电流应为8mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['preg'].setPressure = 0.25 * sys.comps['ptrans'].max;
                    sys.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps['preg'].setPressure - 0.25 * sys.comps['ptrans'].max) < 0.05 && Math.abs(sys.comps['ampmeter'].value - 8) < 0.1
            },
            {
                msg: `13. 将压力调节到0.5 * 量程,变送器电流应为12mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps['preg'].setPressure = 0.5 * sys.comps['ptrans'].max;
                    sys.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => Math.abs(sys.comps['preg'].setPressure - 0.5 * sys.comps['ptrans'].max) < 0.05 && Math.abs(sys.comps['ampmeter'].value - 12) < 0.1
            },
            {
                msg: `14. 将压力调节到0.75 *  量程,变送器电流应为16mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps['preg'].setPressure = 0.75 * sys.comps['ptrans'].max;
                    sys.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => Math.abs(sys.comps['preg'].setPressure - 0.75 * sys.comps['ptrans'].max) < 0.05 && Math.abs(sys.comps['ampmeter'].value - 16) < 0.1
            },
            {
                msg: `15. 将压力调节到1* 量程,变送器电流应为20mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps['preg'].setPressure = sys.comps['ptrans'].max;
                    sys.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => Math.abs(sys.comps['preg'].setPressure - sys.comps['ptrans'].max) < 0.05 && Math.abs(sys.comps['ampmeter'].value - 20) < 0.1
            },
        ];
        const meterConns = [
            { from: 'multimeter_wire_com', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'multimeter_wire_v', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'ptrans_wire_n', type: 'wire' },
            { from: 'multimeter_wire_v', to: 'ptrans_wire_p', type: 'wire' },
        ];
        sys.stepsArray[1] = [
            {
                msg: '1. 接通电路和气路。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    // 使用 for...of 替代 forEach
                    for (const conn of autoConns) {
                        const exists = sys.conns.some(c => sys._connEqual(c, conn));
                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await sys.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => {
                    return autoConns.every(conn =>
                        sys.conns.some(c => sys._connEqual(c, conn))
                    );
                }
            },
            {
                msg: '2. 触发压力变送器电路断路故障。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.FAULT_CONFIG['1'].trigger();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.FAULT_CONFIG['1'].check()
            },

            {
                msg: '3. 合上电源和截止阀，观察电流表显示为0。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = true;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    sys.comps['stopv'].isOpen = true;
                    sys.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => sys.comps['dcpower'].isOn && sys.comps['stopv'].isOpen && Math.abs(sys.comps['ampmeter'].value - 0) < 0.1
            },
            {
                msg: '4. 关闭气源。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps['stopv'].isOpen = false;
                    sys.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => !sys.comps['stopv'].isOpen
            },
            {
                msg: '5. 用万用表测电压,判断电路断点。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps['multimeter'].group.position({ x: 700, y: 500 });
                    await new Promise(r => setTimeout(r, 1000));

                    sys.comps['multimeter'].mode = "DCV200";
                    sys.comps['multimeter']._updateAngleByMode('DCV200');
                    await new Promise(r => setTimeout(r, 1000));

                    await sys.addConnectionAnimated(meterConns[0]);
                    await sys.addConnectionAnimated(meterConns[1]);
                    await new Promise(r => setTimeout(r, 3000));

                    if (sys.comps['ptrans'].isBreak) {
                        sys.removeConn(meterConns[0]);
                        sys.removeConn(meterConns[1]);
                        await new Promise(r => setTimeout(r, 1000));

                        await sys.addConnectionAnimated(meterConns[2]);
                        await sys.addConnectionAnimated(meterConns[3]);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => {

                    // 如果是电源断线，multimeter 测 dcpower_wire_p 到 dcpower_wire_n 应为 0
                    if (sys.comps['dcpower'].isBreak) {
                        // 只有当万用表连接到 dcpower_wire_p 与 dcpower_wire_n 时才判断
                        return sys.conns.some(c =>sys._connEqual(c,meterConns[0])) &&
                            sys.conns.some(c => c =>sys._connEqual(c,meterConns[1])) && sys.comps['dcpower'].isOn &&(sys.comps['multimeter'].mode === 'DCV200') &&
                            Math.abs(sys.comps['multimeter'].value - 0) < 0.5;
                    }
                    // 如果是变送器内部断线，万用表可测得变送器 p/n 端电压等于电源电压
                    if (sys.comps['ptrans'].isBreak) {
                        return sys.conns.some(c =>sys._connEqual(c,meterConns[2])) &&
                            sys.conns.some(c => c =>sys._connEqual(c,meterConns[3]))&& sys.comps['dcpower'].isOn &&(sys.comps['multimeter'].mode === 'DCV200') && Math.abs(sys.comps['multimeter'].value - sys.comps['dcpower'].getValue()) < 0.5;
                    }
                    return false;
                }
            },
            {
                msg: '6. 关闭电源，修复断线故障。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    sys.FAULT_CONFIG['1'].repair();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => !sys.comps['dcpower'].isOn && !sys.FAULT_CONFIG['1'].check()
            },
            {
                msg: '7. 开启电源，确认在无气压输入情况下电流恢复为4mA。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = true;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => (sys.comps['dcpower'].isOn) && (Math.abs(sys.comps['ampmeter'].value - 4) < 0.5)
            }
        ];
        sys.stepsArray[2] = [
            {
                msg: '1. 接通电路和气路。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 100));
                    // 使用 for...of 替代 forEach
                    for (const conn of autoConns) {
                        const exists = sys.conns.some(c =>
                           sys._connEqual(c, conn)
                        );
                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await sys.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    await new Promise(r => setTimeout(r, 100));
                },
                check: () => {
                    return autoConns.every(conn =>
                        sys.conns.some(c =>
                            sys._connEqual(c, conn)
                        )
                    );
                }
            },
            {
                msg: '2. 触发压力变送器气路漏气故障。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.FAULT_CONFIG['2'].trigger();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.FAULT_CONFIG['2'].check()
            },
            {
                msg: '3. 合上电源和截止阀，观察电流表显示正常。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = true;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['stopv'].isOpen = true;
                    sys.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => sys.comps['dcpower'].isOn && sys.comps['stopv'].isOpen && Math.abs(sys.comps['ampmeter'].value - 4) < 0.1
            },
            {
                msg: `4. 将压力调节到 0.5 倍变送器量程，观察漏气现象，判断漏气点。 `,
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['preg'].setPressure = 0.5 * sys.comps['ptrans'].max;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => Math.abs((sys.comps['preg'].setPressure) - 0.5 * sys.comps['ptrans'].max) < (0.05)
            },
            {
                msg: '5. 使用 Leak Test 工具检测漏气',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const portsToCheck = ['ptrans_pipe_i', 'pmeter_pipe_i'];

                    // 1. 使用 find 找到第一个 isLeaking 为 true 的节点
                    const leakingNode = portsToCheck.reduce((foundNode, id) => {
                        if (foundNode) return foundNode; // 如果已经找到了，就不再继续查找

                        const compId = id.split('_')[0];
                        const comp = sys.comps[compId];

                        if (comp && comp.ports) {
                            const port = comp.ports.find(p => p.id === id);
                            // 检查端口是否存在，且属性是否为 true
                            if (port && port.node && port.node.getAttr('isLeaking') === true) {
                                return port.node;
                            }
                        }
                        return null;
                    }, null);

                    // 防御性检查：如果没有找到漏气点，直接结束，防止后续代码报错
                    if (!leakingNode) {
                        console.log("未检测到漏气点");
                        return;
                    }
                    // 2. 获取该节点的绝对坐标
                    const pos = leakingNode.getAbsolutePosition();

                    sys.comps['leak'].group.position({ x: pos.x - 20, y: pos.y + 30 });
                    await new Promise(r => setTimeout(r, 500));
                    sys.comps['leak'].group.position({ x: pos.x - 10, y: pos.y + 50 });
                    await new Promise(r => setTimeout(r, 500));
                    sys.comps['leak'].group.position({ x: pos.x - 20, y: pos.y + 30 });
                    await new Promise(r => setTimeout(r, 500));
                    sys.comps['leak'].group.position({ x: pos.x - 10, y: pos.y + 50 });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => (sys.comps['leak'] && sys.comps['leak'].isEmitting === true)
            },
            {
                msg: '6. 关闭电源和气源。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    sys.comps['stopv'].isOpen = false;
                    sys.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => (!sys.comps['dcpower'].isOn) && (!sys.comps['stopv'].isOpen)
            },
            {
                msg: '7. 修复漏气点。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.FAULT_CONFIG['2'].repair();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => !sys.FAULT_CONFIG['2'].check()
            },
            {
                msg: '8. 合上电源和气源，确定气压表和变送器读数接近相等。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['dcpower'].isOn = true;
                    sys.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    sys.comps['stopv'].isOpen = true;
                    sys.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));

                    sys.comps['preg'].setPressure = (0.5 * sys.comps['ptrans'].max);
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => (sys.comps['dcpower'].isOn) && (sys.comps['stopv'].isOpen) && (Math.abs((sys.comps['preg'].setPressure) - 0.5 * sys.comps['ptrans'].max)) < 0.05
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
                name: "2. 压力变送器回路断路故障",
                trigger: () => {
                    // 1: 设置开路故障
                    const choices = ['dcpower', 'ptrans'];
                    const pick = choices[Math.floor(Math.random() * choices.length)];
                    const device = sys.comps[pick];
                    if (device) {
                        device.isBreak = true; // 这里用 isBreak 来模拟开路状态，实际可以根据需要调整属性名称和逻辑
                    }
                },
                check: () => { return sys.comps['dcpower'].isBreak || sys.comps['ptrans'].isBreak },
                repair: () => {
                    if (sys.comps['dcpower'].isBreak) sys.comps['dcpower'].isBreak = false;
                    if (sys.comps['ptrans'].isBreak) sys.comps['ptrans'].isBreak = false;
                }
            },
            2: {
                id: 2,
                name: "3. 压力变送器气路漏气故障",
                trigger: () => {
                    // n=2: 设置漏气故障
                    const candidates = [];
                    const tryPush = (id) => {
                        const parts = id.split('_');
                        const compId = parts[0]; // 获取组件 ID
                        const comp = sys.comps[compId];
                        let foundPort = null;

                        for (let i = 0; i < comp.ports.length; i++) {
                            if (comp.ports[i].id === id) {
                                foundPort = comp.ports[i];
                                break; // 找到后立即停止循环
                            }
                        }
                        candidates.push(foundPort);
                    };
                    tryPush('ptrans_pipe_i');
                    tryPush('pmeter_pipe_i');
                    if (candidates.length === 0) {
                        return;
                    }
                    const idx = Math.floor(Math.random() * candidates.length);
                    const port = candidates[idx];
                    port.node.setAttr('isLeaking', true);
                },
                check: () => {
                    const portsToCheck = ['ptrans_pipe_i', 'pmeter_pipe_i'];
                    return portsToCheck.some(id => {
                        const compId = id.split('_')[0];
                        const comp = sys.comps[compId];
                        if (comp) {
                            const port = comp.ports.find(p => p.id === id);
                            return port && port.node.attrs.isLeaking;
                        }
                        return false;
                    });

                },
                repair: () => {
                    const portsToCheck = ['ptrans_pipe_i', 'pmeter_pipe_i'];
                    portsToCheck.forEach(id => {
                        const compId = id.split('_')[0];
                        const comp = sys.comps[compId];
                        if (comp) {
                            const port = comp.ports.find(p => p.id === id);
                            if (port && port.node.attrs.isLeaking) {
                                port.node.setAttr('isLeaking', false);
                            }
                        }
                    });
                }
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
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
            { from: 'varires_wire_r', to: 'ptrans_wire_p', type: 'wire' },
            { from: 'ptrans_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'cab_pipe_o', to: 'stopv_pipe_i', type: 'pipe' },
            { from: 'stopv_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'tconn_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_l', to: 'pmeter_pipe_i', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'ptrans_pipe_i', type: 'pipe' },
        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();

        sys.comps.stopv.isOpen = true;
        sys.comps.stopv.update();

    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        const varipress = sys.comps['preg'];
        if (!varipress) return;
        const isManual = false;
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
            varipress.setPressure = targetValue;
            if (typeof varipress.update === 'function') {
                varipress.update();
            }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
