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
            { id: 0, name: "1. 压力变送器功能的验证" },
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

        const conns = [
            // --- 1. 桥式电路部分 (电桥测量) ---
            // 电源正极驱动电桥顶端 (R1, R2 上端)
            { from: 'dcpower_wire_p', to: 'pt_wire_r1l', type: 'wire' },
            { from: 'dcpower_wire_p', to: 'r3_wire_l', type: 'wire' },
            // 电桥下端 (PT100, VariRes 下端) 接地形成回路
            { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd', type: 'wire' },
            { from: 'r4_wire_r', to: 'gnd0_wire_gnd', type: 'wire' },
            // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
            { from: 'pt_wire_r1r', to: 'pt_wire_r2l', type: 'wire' },
            { from: 'r3_wire_r', to: 'r4_wire_l', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gndx_wire_gnd', type: 'wire' },

            // --- 2. 仪表放大器部分 (三运放结构：amp1, amp2 为输入级，amp3 为差分级) ---
            // 输入级：将电桥左右中点信号接入 amp1 和 amp2 的同相输入端
            { from: 'r3_wire_r', to: 'amp1_wire_p', type: 'wire' }, // 右桥压 -> amp1
            { from: 'pt_wire_r2l', to: 'amp2_wire_p', type: 'wire' }, // 左桥压 -> amp2
            // 增益电阻 Rg=10k (r5k为固定的5k，r10kv是可调的10k，取中间值5k) 跨接在两个运放的反相输入端之间
            { from: 'amp1_wire_n', to: 'r10kv_wire_l', type: 'wire' },
            { from: 'r10kv_wire_r', to: 'r5k_wire_l', type: 'wire' },
            { from: 'r5k_wire_r', to: 'amp2_wire_n', type: 'wire' },
            // 增益电阻可一分为二：10k电位器分成两个5k，分别接在 amp1 和 amp2 的反相输入端，形成差分放大器的增益调节，放大倍数为 1 + 101.5k/5k = 21.3 倍
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp1的反馈
            { from: 'amp1_wire_OUT', to: 'r106k1_wire_r', type: 'wire' },
            { from: 'r106k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp2的反馈
            { from: 'amp2_wire_OUT', to: 'r106k2_wire_r', type: 'wire' },
            { from: 'r106k2_wire_l', to: 'amp2_wire_n', type: 'wire' },

            // 差分输出级 (amp3)：接收前级输出
            { from: 'amp1_wire_OUT', to: 'r5k1_wire_l', type: 'wire' },
            { from: 'r5k1_wire_r', to: 'amp3_wire_n', type: 'wire' },
            { from: 'amp2_wire_OUT', to: 'r5k2_wire_l', type: 'wire' },
            { from: 'r5k2_wire_r', to: 'amp3_wire_p', type: 'wire' },
            // amp3 反馈，输入电阻5k，反馈电阻50k，增益10倍，差分最大电压18.8mV，两级放大213倍，输出最大4V
            { from: 'amp3_wire_OUT', to: 'r50k1_wire_r', type: 'wire' },
            { from: 'r50k1_wire_l', to: 'amp3_wire_n', type: 'wire' },

            // --- 3. 偏置与加法电路 (amp4) ---
            // 电源接到两个电阻的分压电路，上电阻4k，下电阻1k，分压后得到1V的偏置电压。
            { from: 'dcpower_wire_p', to: 'r4k_wire_l', type: 'wire' },
            { from: 'r4k_wire_r', to: 'r1k_wire_l', type: 'wire' },
            { from: 'r1k_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            // 1V电压输入到amp4的同相端，利用射级跟随器结构提供低阻抗的1V偏置电压，同时将amp3的输出通过电阻送入amp4的反相端进行加法运算，实现零点偏移。
            { from: 'r1k_wire_l', to: 'amp4_wire_p', type: 'wire' },
            { from: 'amp4_wire_OUT', to: 'r50k2_wire_r', type: 'wire' },
            { from: 'r50k2_wire_r', to: 'amp4_wire_n', type: 'wire' },
            // 1V偏置电压由 amp4 提供，连接到 amp3 的同相输入端
            { from: 'r50k2_wire_l', to: 'amp3_wire_p', type: 'wire' },

            // --- 4. 电流源驱动部分 (amp5 + Transistor) ---
            // 同相端输入控制电压。1V对应4mA，5V对应20mA。
            { from: 'amp3_wire_OUT', to: 'r100k2_wire_l', type: 'wire' },
            { from: 'r100k2_wire_r', to: 'amp5_wire_p', type: 'wire' },
            // 放大器输出通过三极管进行电流放大。集电极由24V供电，发射极驱动定值250欧姆电阻产生电流。
            // { from: 'dcpower2_wire_p', to: 'transistor_wire_c', type: 'wire' },
            { from: 'amp5_wire_OUT', to: 'transistor_wire_b', type: 'wire' },
            { from: 'transistor_wire_e', to: 'r250_wire_l', type: 'wire' },
            //从三极管发射极进行负反馈，正反馈在定值电阻左端，因此能形成深度负反馈，放大器工作在线性状态。
            { from: 'r250_wire_l', to: 'r100k3_wire_r', type: 'wire' },
            { from: 'r100k3_wire_l', to: 'r100k1_wire_r', type: 'wire' },
            { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
            { from: 'r100k1_wire_r', to: 'amp5_wire_n', type: 'wire' },
            // 从定值电阻右端进行正反馈，形成电流采样回路，确保输出电流与控制电压成线性关系。
            { from: 'r250_wire_r', to: 'r100k4_wire_r', type: 'wire' },
            { from: 'r100k4_wire_l', to: 'amp5_wire_p', type: 'wire' },

            // (1)使用500欧姆负载rload,电流表与负载电阻串联，监测输出电流大小，同时负载电阻形成电流回路的闭合。
            { from: 'r250_wire_r', to: 'ampmeter_wire_p', type: 'wire' },
            // { from: 'ampmeter_wire_n', to: 'rload_wire_l', type: 'wire' },
            // { from: 'rload_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
            // (2)PID输入回路，三极管由pid_wire_pi1供电，4-20mA电流通过电流表监测后进入pid_wire_ni1，形成闭环控制。
            { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'transistor_wire_c', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 5. 各级测量监测 (万用表) ---
            // 万用表1监测电桥输出差压
            // { from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'r2_wire_r', type: 'wire' },
            //万用表1监测一级放大输出，验证前置放大器的放大倍数是否正确。
            // { from: 'multimeter_wire_v', to: 'amp2_wire_OUT', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'amp1_wire_OUT', type: 'wire' },
            // 万用表1监测仪表放大器的输出
            { from: 'multimeter_wire_v', to: 'amp3_wire_OUT', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' },
            // 万用表1监测PT100输出电压
            { from: 'multimeter2_wire_v', to: 'pt_wire_l', type: 'wire' },
            { from: 'multimeter2_wire_com', to: 'gnd_wire_gnd', type: 'wire' },

        ];
        sys.stepsArray[0] = [
            // 1. 电桥供电基础回路
            {
                msg: "步骤 1：建立电桥供电与接地回路（R1, R2, PT100, VariRes）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'dcpower_wire_p', to: 'pt_wire_r1l', type: 'wire' },
                        { from: 'dcpower_wire_p', to: 'r3_wire_l', type: 'wire' },
                        // 电桥下端 (PT100, VariRes 下端) 接地形成回路
                        { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd', type: 'wire' },
                        { from: 'r4_wire_r', to: 'gnd0_wire_gnd', type: 'wire' },
                        // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
                        { from: 'pt_wire_r1r', to: 'pt_wire_r2l', type: 'wire' },
                        { from: 'r3_wire_r', to: 'r4_wire_l', type: 'wire' },
                        { from: 'dcpower_wire_n', to: 'gndx_wire_gnd', type: 'wire' },
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('pt', '1. 压力传感器电桥连接', { color: '#2ecc71' });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const required = [
                        // 电源正极驱动电桥顶端 (R1, R2 上端)
                        { from: 'dcpower_wire_p', to: 'pt_wire_r1l' },
                        { from: 'dcpower_wire_p', to: 'r3_wire_l' },
                        // 电桥下端 (PT100, VariRes 下端) 接地形成回路
                        { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd' },
                        { from: 'r4_wire_r', to: 'gnd0_wire_gnd' },
                        // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
                        { from: 'pt_wire_r1r', to: 'pt_wire_r2l' },
                        { from: 'r3_wire_r', to: 'r4_wire_l' },
                        { from: 'dcpower_wire_n', to: 'gndx_wire_gnd' },
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 2. 仪表放大器前级输入与增益网络
            {
                msg: "步骤 2：连接电桥差分输出至仪表放大器前级（Amp1, Amp2）及增益电阻网络。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'r3_wire_r', to: 'amp1_wire_p', type: 'wire' }, // 右桥压 -> amp1
                        { from: 'pt_wire_r2l', to: 'amp2_wire_p', type: 'wire' }, // 左桥压 -> amp2
                        { from: 'amp2_wire_n', to: 'r5k_wire_r', type: 'wire' },
                        { from: 'r5k_wire_l', to: 'r10kv_wire_r', type: 'wire' },
                        { from: 'r10kv_wire_l', to: 'amp1_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('r10kv', '2. 仪表放大器前端增益调节网络', { color: '#2ecc71' });
                },
                check: () => {
                    const required = [
                        { from: 'r3_wire_r', to: 'amp1_wire_p' }, // 右桥压 -> amp1
                        { from: 'pt_wire_r2l', to: 'amp2_wire_p' }, // 左桥压 -> amp2
                        { from: 'amp1_wire_n', to: 'r10kv_wire_l' },
                        { from: 'r10kv_wire_r', to: 'r5k_wire_l' },
                        { from: 'r5k_wire_r', to: 'amp2_wire_n' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 3. 前级负反馈
            {
                msg: "步骤 3：建立 Amp1 和 Amp2 的闭环负反馈回路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'amp1_wire_OUT', to: 'r106k1_wire_r', type: 'wire' },
                        { from: 'r106k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
                        { from: 'amp2_wire_OUT', to: 'r106k2_wire_r', type: 'wire' },
                        { from: 'r106k2_wire_l', to: 'amp2_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('r106k1', '3. 放大器1负反馈', { color: '#2ecc71' });
                    sys.showComp.showTooltip('r106k2', '3. 放大器2负反馈', { color: '#2ecc71' });
                },
                check: () => {
                    const required = [
                        { from: 'amp1_wire_OUT', to: 'r106k1_wire_r' },
                        { from: 'r106k1_wire_l', to: 'amp1_wire_n' },
                        { from: 'amp2_wire_OUT', to: 'r106k2_wire_r' },
                        { from: 'r106k2_wire_l', to: 'amp2_wire_n' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 4. 差分输出级 Amp3
            {
                msg: "步骤 4：连接差分放大级 Amp3反相输入、同相输入 及其负反馈回路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'amp1_wire_OUT', to: 'r5k1_wire_l', type: 'wire' },
                        { from: 'r5k1_wire_r', to: 'amp3_wire_n', type: 'wire' },
                        { from: 'amp2_wire_OUT', to: 'r5k2_wire_l', type: 'wire' },
                        { from: 'r5k2_wire_r', to: 'amp3_wire_p', type: 'wire' },
                        { from: 'amp3_wire_OUT', to: 'r50k1_wire_r', type: 'wire' },
                        { from: 'r50k1_wire_l', to: 'amp3_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('r50k1', '4. 放大器3负反馈', { color: '#2ecc71' });

                },
                check: () => {
                    const required = [
                        { from: 'amp1_wire_OUT', to: 'r5k1_wire_l' },
                        { from: 'r5k1_wire_r', to: 'amp3_wire_n' },
                        { from: 'amp2_wire_OUT', to: 'r5k2_wire_l' },
                        { from: 'r5k2_wire_r', to: 'amp3_wire_p' },
                        { from: 'amp3_wire_OUT', to: 'r50k1_wire_r' },
                        { from: 'r50k1_wire_l', to: 'amp3_wire_n' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 5. 偏置电压产生与注入 (Amp4)
            {
                msg: "步骤 5：建立偏置电路（1V 参考电压）并注入 Amp3同相端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'dcpower_wire_p', to: 'r4k_wire_l', type: 'wire' },
                        { from: 'r4k_wire_r', to: 'r1k_wire_l', type: 'wire' },
                        { from: 'r1k_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
                        { from: 'r1k_wire_l', to: 'amp4_wire_p', type: 'wire' },
                        { from: 'amp4_wire_OUT', to: 'r50k2_wire_r', type: 'wire' },
                        { from: 'r50k2_wire_r', to: 'amp4_wire_n', type: 'wire' },
                        { from: 'r50k2_wire_l', to: 'amp3_wire_p', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('amp4', '5.amp4提供 1V 零点偏置', { color: '#f32d2d' });
                },
                check: () => {
                    const required = [
                        { from: 'dcpower_wire_p', to: 'r4k_wire_l' },
                        { from: 'r4k_wire_r', to: 'r1k_wire_l' },
                        { from: 'r1k_wire_r', to: 'gnd_wire_gnd' },
                        { from: 'r1k_wire_l', to: 'amp4_wire_p' },
                        { from: 'amp4_wire_OUT', to: 'r50k2_wire_r' },
                        { from: 'r50k2_wire_r', to: 'amp4_wire_n' },
                        { from: 'r50k2_wire_l', to: 'amp3_wire_p' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 6. 电流源预驱动 (Amp5)
            {
                msg: "步骤 6：连接V/I转换电路：Amp3 输出驱动 Amp5 同相端，Amp5输出驱动三极管基极，射极跟随输出。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'amp3_wire_OUT', to: 'r100k2_wire_l', type: 'wire' },
                        { from: 'r100k2_wire_r', to: 'amp5_wire_p', type: 'wire' },
                        { from: 'amp5_wire_OUT', to: 'transistor_wire_b', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('transistor', '6.三极管电流放大', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'amp3_wire_OUT', to: 'r100k2_wire_l' },
                        { from: 'r100k2_wire_r', to: 'amp5_wire_p' },
                        { from: 'amp5_wire_OUT', to: 'transistor_wire_b' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 7. PID 供电与电流源主回路
            {
                msg: "步骤 7：PID 供电，由 PID 输入回路提供 24V 至三极管集电极。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
                        { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' },
                        { from: 'pid_wire_pi1', to: 'transistor_wire_c', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('r100k3', '7. PID向三极管提供24V', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'dcpower2_wire_p', to: 'pid_wire_vcc' },
                        { from: 'dcpower2_wire_n', to: 'pid_wire_gnd' },
                        { from: 'pid_wire_pi1', to: 'transistor_wire_c' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 8. 电流源负反馈 (R250 左端)
            {
                msg: "步骤 8：建立amp5负反馈（三极管发射极、R250 左端）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'transistor_wire_e', to: 'r250_wire_l', type: 'wire' },
                        { from: 'r250_wire_l', to: 'r100k3_wire_r', type: 'wire' },
                        { from: 'r100k3_wire_l', to: 'r100k1_wire_r', type: 'wire' },
                        { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
                        { from: 'r100k1_wire_r', to: 'amp5_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('gnd3', '8. 放大器5负反馈', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'transistor_wire_e', to: 'r250_wire_l' },
                        { from: 'r250_wire_l', to: 'r100k3_wire_r' },
                        { from: 'r100k3_wire_l', to: 'r100k1_wire_r' },
                        { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd' },
                        { from: 'r100k1_wire_r', to: 'amp5_wire_n' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 9. 电流源正反馈 (R250 右端)
            {
                msg: "步骤 9：建立电流源正反馈（R250 右端），正反馈小于负反馈强度，整体呈现负反馈。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'r250_wire_r', to: 'r100k4_wire_r', type: 'wire' },
                        { from: 'r100k4_wire_l', to: 'amp5_wire_p', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('r100k4', '9. 放大器5正反馈', { color: '#e65111' });
                },
                check: () => {
                    const required = [
                        { from: 'r250_wire_r', to: 'r100k4_wire_r' },
                        { from: 'r100k4_wire_l', to: 'amp5_wire_p' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 10. 回路闭合至 PID 输入
            {
                msg: "步骤 10：连接电流表监测并将 4-20mA 信号反馈至 PID 输入端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'r250_wire_r', to: 'ampmeter_wire_p', type: 'wire' },
                        { from: 'ampmeter_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('ampmeter', '10. 4-20mA电流', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'r250_wire_r', to: 'ampmeter_wire_p' },
                        { from: 'ampmeter_wire_n', to: 'pid_wire_ni1' }
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'wire' })));
                }
            },
            // 11. 气路连接
            {
                msg: "步骤 11：完成气路连接：空气瓶--》调压阀--》压力传感器。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'cab_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
                        { from: 'preg_pipe_o', to: 'pt_pipe_i', type: 'pipe' },
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);
                    sys.showComp.showTooltip('ampmeter', '11. 完成气路连接', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'cab_pipe_o', to: 'preg_pipe_i' },
                        { from: 'preg_pipe_o', to: 'pt_pipe_i' },
                    ];
                    return required.every(req => sys.conns.some(c => sys._connEqual(c, { ...req, type: 'pipe' })));
                }
            },
            // 12. 万用表监测连接
            {
                msg: "步骤 11：连接万用表监测电桥输出、仪表放大器输出。仪表放大器放大倍数约213倍，电桥满量程输出约18.8mV，放大后约4V，加上偏置电压1V，最终输出满量程电压5V。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    sys.comps.multimeter.mode = 'DCV20'; // 设置万用表1为电压档
                    sys.comps.multimeter._updateAngleByMode(); // 更新指针角度
                    sys.comps.multimeter2.mode = 'DCVmv'; // 设置万用表2为电压档
                    sys.comps.multimeter2._updateAngleByMode(); // 更新指针角度
                    const path = [
                        { from: 'multimeter_wire_v', to: 'amp3_wire_OUT', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' },
                        { from: 'multimeter2_wire_v', to: 'pt_wire_l', type: 'wire' },
                        { from: 'multimeter2_wire_com', to: 'varires_wire_l', type: 'wire' }
                    ];
                    for (let c of path) await sys.addConnectionAnimated(c);

                    await new Promise(r => setTimeout(r, 4000));
                },
                check: () => sys.comps.dcpower.isOn === true && sys.comps.dcpower2.isOn === true
            },
            // 13. 接通电源
            {
                msg: "步骤 12：接通电桥5V电源，接通变送器24V电源。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    sys.comps.dcpower.isOn = true; // 
                    sys.comps.dcpower2.isOn = true; // 接通24V电源
                    sys.comps.dcpower.update();
                    sys.comps.dcpower2.update();

                    await new Promise(r => setTimeout(r, 4000));
                },
                check: () => sys.comps.dcpower.isOn === true && sys.comps.dcpower2.isOn === true
            },
            // 修正后的步骤 14
            {
                msg: "步骤 14：调压至0.5MPa气压。观察输出电流（预期 12mA）及 PID PV显示值（0.5）。",
                act: async () => {
                    // 1. 设置状态
                    sys.comps.preg.setPressure = 0.5;
                    sys.comps.preg.update();

                    // 2. 显示反馈

                    // 确保 ID 传递准确
                    sys.showComp.showTooltip('preg', '产生0.5Mpa气压 ', { color: '#e82f0e' });

                    // 3. 等待时间增加一定的缓冲
                    await new Promise(r => setTimeout(r, 4000));
                    // 建议：如果还有残留，可以检查是否叠加了多个 Tooltip
                    // 可以在 show 之前先 remove 一次防止堆叠
                },
                check: () => Math.abs(sys.comps.pt.currentP - 0.5) < 0.1
            },

            // 15. 100度性能验证
            {
                msg: "步骤 15：产生1Mpa气压。观察输出电流（预期 20mA）及 PID PV显示值(1)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    sys.comps.preg.setPressure = 1;
                    sys.comps.preg.update(); // 触发组件状态更新
                    sys.showComp.showTooltip('pt', '产生1MPa气压', { color: '#e82f0e' });
                    await new Promise(r => setTimeout(r, 4000));
                    sys.showComp.clearAllTooltips(); // 演示结束，恢复视角
                },
                check: () => Math.abs(sys.comps.pt.currentP - 1) < 0.1
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
                name: "本项目无故障设置. ",
                trigger: () => { },
                check: () => { },
                repair: () => { }
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
        // 1. 定义预设连接关系
        sys.conns = [
            // --- 1. 桥式电路部分 (电桥测量) ---
            // 电源正极驱动电桥顶端 (R1, R2 上端)
            { from: 'dcpower_wire_p', to: 'pt_wire_r1l', type: 'wire' },
            { from: 'dcpower_wire_p', to: 'r3_wire_l', type: 'wire' },
            // 电桥下端 (PT100, VariRes 下端) 接地形成回路
            { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd', type: 'wire' },
            { from: 'r4_wire_r', to: 'gnd0_wire_gnd', type: 'wire' },
            // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
            { from: 'pt_wire_r1r', to: 'pt_wire_r2l', type: 'wire' },
            { from: 'r3_wire_r', to: 'r4_wire_l', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gndx_wire_gnd', type: 'wire' },

            // --- 2. 仪表放大器部分 (三运放结构：amp1, amp2 为输入级，amp3 为差分级) ---
            // 输入级：将电桥左右中点信号接入 amp1 和 amp2 的同相输入端
            { from: 'r3_wire_r', to: 'amp1_wire_p', type: 'wire' }, // 右桥压 -> amp1
            { from: 'pt_wire_r2l', to: 'amp2_wire_p', type: 'wire' }, // 左桥压 -> amp2
            // 增益电阻 Rg=10k (r5k为固定的5k，r10kv是可调的10k，取中间值5k) 跨接在两个运放的反相输入端之间
            { from: 'amp1_wire_n', to: 'r10kv_wire_l', type: 'wire' },
            { from: 'r10kv_wire_r', to: 'r5k_wire_l', type: 'wire' },
            { from: 'r5k_wire_r', to: 'amp2_wire_n', type: 'wire' },
            // 增益电阻可一分为二：10k电位器分成两个5k，分别接在 amp1 和 amp2 的反相输入端，形成差分放大器的增益调节，放大倍数为 1 + 101.5k/5k = 21.3 倍
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp1的反馈
            { from: 'amp1_wire_OUT', to: 'r106k1_wire_r', type: 'wire' },
            { from: 'r106k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp2的反馈
            { from: 'amp2_wire_OUT', to: 'r106k2_wire_r', type: 'wire' },
            { from: 'r106k2_wire_l', to: 'amp2_wire_n', type: 'wire' },

            // 差分输出级 (amp3)：接收前级输出
            { from: 'amp1_wire_OUT', to: 'r5k1_wire_l', type: 'wire' },
            { from: 'r5k1_wire_r', to: 'amp3_wire_n', type: 'wire' },
            { from: 'amp2_wire_OUT', to: 'r5k2_wire_l', type: 'wire' },
            { from: 'r5k2_wire_r', to: 'amp3_wire_p', type: 'wire' },
            // amp3 反馈，输入电阻5k，反馈电阻50k，增益10倍，差分最大电压18.8mV，两级放大213倍，输出最大4V
            { from: 'amp3_wire_OUT', to: 'r50k1_wire_r', type: 'wire' },
            { from: 'r50k1_wire_l', to: 'amp3_wire_n', type: 'wire' },

            // --- 3. 偏置与加法电路 (amp4) ---
            // 电源接到两个电阻的分压电路，上电阻4k，下电阻1k，分压后得到1V的偏置电压。
            { from: 'dcpower_wire_p', to: 'r4k_wire_l', type: 'wire' },
            { from: 'r4k_wire_r', to: 'r1k_wire_l', type: 'wire' },
            { from: 'r1k_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            // 1V电压输入到amp4的同相端，利用射级跟随器结构提供低阻抗的1V偏置电压，同时将amp3的输出通过电阻送入amp4的反相端进行加法运算，实现零点偏移。
            { from: 'r1k_wire_l', to: 'amp4_wire_p', type: 'wire' },
            { from: 'amp4_wire_OUT', to: 'r50k2_wire_r', type: 'wire' },
            { from: 'r50k2_wire_r', to: 'amp4_wire_n', type: 'wire' },
            // 1V偏置电压由 amp4 提供，连接到 amp3 的同相输入端
            { from: 'r50k2_wire_l', to: 'amp3_wire_p', type: 'wire' },

            // --- 4. 电流源驱动部分 (amp5 + Transistor) ---
            // 同相端输入控制电压。1V对应4mA，5V对应20mA。
            { from: 'amp3_wire_OUT', to: 'r100k2_wire_l', type: 'wire' },
            { from: 'r100k2_wire_r', to: 'amp5_wire_p', type: 'wire' },
            // 放大器输出通过三极管进行电流放大。集电极由24V供电，发射极驱动定值250欧姆电阻产生电流。
            // { from: 'dcpower2_wire_p', to: 'transistor_wire_c', type: 'wire' },
            { from: 'amp5_wire_OUT', to: 'transistor_wire_b', type: 'wire' },
            { from: 'transistor_wire_e', to: 'r250_wire_l', type: 'wire' },
            //从三极管发射极进行负反馈，正反馈在定值电阻左端，因此能形成深度负反馈，放大器工作在线性状态。
            { from: 'r250_wire_l', to: 'r100k3_wire_r', type: 'wire' },
            { from: 'r100k3_wire_l', to: 'r100k1_wire_r', type: 'wire' },
            { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
            { from: 'r100k1_wire_r', to: 'amp5_wire_n', type: 'wire' },
            // 从定值电阻右端进行正反馈，形成电流采样回路，确保输出电流与控制电压成线性关系。
            { from: 'r250_wire_r', to: 'r100k4_wire_r', type: 'wire' },
            { from: 'r100k4_wire_l', to: 'amp5_wire_p', type: 'wire' },

            // (1)使用500欧姆负载rload,电流表与负载电阻串联，监测输出电流大小，同时负载电阻形成电流回路的闭合。
            { from: 'r250_wire_r', to: 'ampmeter_wire_p', type: 'wire' },
            // { from: 'ampmeter_wire_n', to: 'rload_wire_l', type: 'wire' },
            { from: 'rload_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
            // (2)PID输入回路，三极管由pid_wire_pi1供电，4-20mA电流通过电流表监测后进入pid_wire_ni1，形成闭环控制。
            { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'transistor_wire_c', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 5. 各级测量监测 (万用表) ---
            // 万用表1监测电桥输出差压
            // { from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'r2_wire_r', type: 'wire' },
            //万用表1监测一级放大输出，验证前置放大器的放大倍数是否正确。
            // { from: 'multimeter_wire_v', to: 'amp2_wire_OUT', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'amp1_wire_OUT', type: 'wire' },
            // 万用表1监测仪表放大器的输出
            // 万用表1监测仪表放大器的输出
            { from: 'multimeter_wire_v', to: 'amp3_wire_OUT', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' },
            // 万用表1监测PT100输出电压
            { from: 'multimeter2_wire_v', to: 'pt_wire_r1r', type: 'wire' },
            { from: 'multimeter2_wire_com', to: 'r3_wire_r', type: 'wire' },

            //--- 6. 气路连接 ---
            { from: 'cab_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'pt_pipe_i', type: 'pipe' },
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {

        sys.comps.multimeter.mode = 'DCV20';
        sys.comps.multimeter._updateAngleByMode();
        sys.comps.multimeter2.mode = 'DCVmv';
        sys.comps.multimeter2._updateAngleByMode();
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
        sys.comps.dcpower2.isOn = true;
        sys.comps.dcpower2.update();
        sys.comps.pid.mode = 'AUTO';
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        // const pid = sys.comps['pid'];
        const pid = sys.comps['pid'];
        const preg = sys.comps['preg'];

        if (!pid || !preg) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = false;

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [25, 50, 75, 100, 0]                   // 手动模式：PID 输出百分比 (%)
            : [0.25, 0.5, 0.75, 1.0, 0]; // 自动模式：Pt100 电阻值 (Ω)


        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            // --- 手动模式逻辑 ---
            // 设置 PID 的手动输出值
            pid.OUT = targetValue;

        } else {
            // 设置可变电阻值 (模拟 Pt100)
            preg.setPressure = targetValue;
            if (typeof preg.update === 'function') {
                preg.update();
            }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
