import { BaseComponent } from './BaseComponent.js';

/**
 * 气动执行器（Pneumatic Valve / Positioner）仿真组件
 *
 * 概述：该组件模拟带定位器的气动阀机构，包含上部气室、膜片、弹簧、阀杆、阀芯和下部阀体，
 * 同时带有定位器（电-气转换，4-20mA 输入）与反馈机构。视觉上保留了实物细节并支持动画。
 *
 * 主要功能与行为：
 *  - 接收电流信号（4-20mA），将其转换为目标开度（0~100%），并驱动膜片/阀杆运动
 *  - 模拟气压滞后与泄漏/卡死等故障模式（`isLeaking`, `isStuck`）
 *  - 面板包含 LCD（显示输入电流与开度百分比）和气压表（MPa）作为可视化反馈
 *  - 提供若干端口：电气端口（r/l）、气源输入（i）、气输出（o）以及信号端口（s）
 *
 * 可配置项/状态（构造时或运行时可修改）：
 *  - `id`：设备标识
 *  - `dir`：正/负动作（气开/气关）
 *  - `vRms`/`freq` 等（非本组件重点，保留必要参数）
 *  - `isLeaking`：是否泄漏（布尔），影响端口属性
 *  - `isStuck`：是否卡死（布尔），影响机械位移
 *
 * 视觉结构（重要分组说明）：
 *  - `scaleGroup`：整体缩放容器（便于按原始像素比例绘制并缩放显示）
 *  - `valveGroup`：阀体相关图元
 *  - `posBox`：定位器（含 LCD、气压表、反馈机构）
 *  - `feedbackSys`：反馈连杆，用于回馈阀杆位移
 */
export class PneumaticValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 说明：原始设计基于 340x700 像素，使用缩放组进行显示缩放
        this.w = 226;            // 视觉参考宽度（原始缩放值）
        this.h = 466;            // 视觉参考高度
        this.scale = 0.8;        // 全局缩放因子（便于在画布中放置）

        // 组件类型与缓存策略
        this.type = 'resistor';  // 在系统中作为“阻抗/执行器”类型注册（兼容旧逻辑）
        this.currentResistance = 250; // 保留旧接口字段（不直接用于本文件主要逻辑）
        this.special = 'actuator';
        this.cache = 'fixed';     // 静态元素缓存，动态通过 _refreshCache 更新

        // 初始化绘图分组（BaseComponent 提供）
        this._initGroups();

        // 运行状态与故障标志
        this.dir = 'positive';    // 动作方向：'positive'=气开阀, 'negtive'=气关阀
        this.isLeaking = false;   // 泄漏故障标志
        this.isStuck = false;     // 卡死故障标志

        this.config = { id: this.id, dir: this.dir };

        // 核心物理量（用于驱动动画）
        this.travel = 0;          // 当前行程比（0..1）
        this.targetTravel = 0;    // 目标行程比
        this.strokePx = 65;       // 阀杆全行程的像素映射

        // 气压相关量（MPa 单位的视觉映射与内部状态）
        this.sourcePress = 0;     // 气源压力（仿真输入）
        this.outPress = 0;        // 输出压力（定位器输出）
        this.inPress = 0;         // 阀室内压力（实际膜片受压）

        // 初始化视觉元素与定位器位置
        this.initVisuals();
        this.initPos();

        // 添加端口：r/l 为电气输入（4-20mA 采样），s 为信号管路，o/i 为气路接口
        // 坐标基于当前组件布局，第三个参数为端口 id，第四为类型，部分端口带优先标识 'p'
        this.addPort(-10, 370, 'r', 'wire');
        this.addPort(-10, 410, 'l', 'wire', 'p');
        this.addPort(-10, 330, 's', 'pipe', 'in');
        this.addPort(40, 295, 'o', 'pipe');
        this.addPort(135, 60, 'i', 'pipe');
    }

    initVisuals() {
        /**
         * 构建视觉元素。所有原始像素坐标按 `this.scale` 缩放，
         * 使用 `scaleGroup` 收纳以便整体缩放与位置调整。
         * 本方法负责创建：
         *  - 气室外壳（housing）
         *  - 膜片与悬挂线（membrane, leftWire, rightWire 等）
         *  - 弹簧（spring）
         *  - 阀体（valveGroup）与阀芯、阀杆（stem, plug）
         *  - 填料函与耦合件（packingBox, coupling）
         */
        // 创建一个内部容器，统一缩放 2/3 (0.666)
        this.scaleGroup = new Konva.Group({
            scaleX: this.scale,
            scaleY: this.scale
        });
        this._staticGroup.add(this.scaleGroup);

        const cx = 340 / 2; // 使用原始中心点计算

        // --- 1. 气室外壳 ---
        const housing = new Konva.Path({
            x: cx, y: 100,
            data: `M -140 -20 L 140 -20 L 140 0 L 155 0 L 155 10 L 140 10 L 140 50 L 100 50 L 100 86 L 33 86 L 33 240 L -33 240 L -33 86 L -100 86 L -100 50 L -140 50 L -140 10 L -155 10 L -155 0 L -140 0 Z`,
            fill: '#f0f0f0', stroke: '#444', strokeWidth: 10
        });

        // --- 2. 膜片悬挂系统 ---
        this.leftWireL = new Konva.Line({ points: [-150, 5, -108, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.leftWire = new Konva.Line({ points: [-108, 5, -100, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.rightWire = new Konva.Line({ points: [108, 5, 100, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.rightWireR = new Konva.Line({ points: [150, 5, 108, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });

        this.membrane = new Konva.Rect({
            x: cx - 100, y: 100, width: 200, height: 15,
            fill: '#0d0ddd', cornerRadius: 2
        });

        this.spring = new Konva.Line({
            x: cx, y: 115, points: this._getSpringPoints(225),
            stroke: '#087b16', strokeWidth: 6, lineJoin: 'round'
        });

        // --- 3. 支架与定位器 ---
        const yoke = new Konva.Path({
            x: cx, y: 350,
            data: `M -3 0 L -55 0 Q -85 0 -85 30 L -85 170 Q -85 200 -55 200 L 55 200 Q 85 200 85 170 L 85 30 Q 85 0 55 0 L 3 0`,
            stroke: '#2b2fae', strokeWidth: 12, lineCap: 'round', lineJoin: 'round'
        });


        // --- 4. 阀体 ---
        const valveBaseY = 556;
        this.valveGroup = new Konva.Group({ x: cx, y: valveBaseY });
        const bodyShell = new Konva.Rect({ x: cx - 290, y: 0, width: 240, height: 163, fill: '#b0afae', stroke: '#0f3bd9' });
        this.pipe = new Konva.Rect({ x: cx - 300, y: 30, width: 260, height: 63, fill: '#c3c1f9', stroke: '#ced7f8' });
        this.valveGroup.add(bodyShell, this.pipe);

        // --- 5. 阀杆与阀芯 ---
        this.stem = new Konva.Rect({ x: cx - 4, y: 115, width: 8, height: 472, fill: '#eee', stroke: '#999' });
        this.plug = new Konva.Path({
            x: cx, y: 587,
            data: 'M -22 0 L 22 0 Q 22 65, 0 65 Q -22 65, -22 0 Z',
            fill: '#1a1a1a'
        });

        this.coupling = new Konva.Group({ x: cx, y: 350 });
        this.coupling.add(new Konva.Rect({ x: -15, y: 0, width: 30, height: 45, fill: '#444', cornerRadius: 3 }));
        this.coupling.add(new Konva.Rect({ x: -18, y: 15, width: 36, height: 15, fill: '#222' }));

        // --- 6. 填料函 ---
        this.packingBox = new Konva.Group({ x: cx - 20, y: 520 });
        this.packingBox.add(new Konva.Rect({ width: 40, height: 50, fill: '#e0e0e0', stroke: '#333' }));
        this.packingBox.add(new Konva.Path({
            data: 'M 0 10 L 40 20 M 0 20 L 40 30 M 0 30 L 40 40 M 0 40 L 40 50 M 0 50 L 40 60 M 0 60 L 40 70',
            stroke: '#999', strokeWidth: 1
        }));

        // 将所有元素添加到缩放组中
        this.scaleGroup.add(yoke, housing, this.leftWireL, this.leftWire, this.rightWire, this.rightWireR, this.spring, this.valveGroup, this.packingBox, this.stem, this.plug, this.coupling, this.membrane);
    }
    initPos() {
        // 初始化定位器面板与布局（位置器/位置反馈模块）
        const cx = 50; // 面板局部中心参考点

        // 1) 定位器外壳（posBox）——包含 LCD、气压表与反馈机构
        //    尺寸: width=120, height=160，y 值为 370 使其相对于主组件正确对齐
        this.posBox = new Konva.Group({ x: cx - 60, y: 370, id: 'positioner' });

        // 主底座（带拉丝效果的金属面板）
        this.posBox.add(new Konva.Rect({
            width: 120, height: 160,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 120, y: 160 },
            fillLinearGradientColorStops: [0, '#cfcfcf', 0.5, '#eaeaea', 1, '#cfcfcf'],
            cornerRadius: 6,
            stroke: '#888', strokeWidth: 1.5,
            shadowColor: 'black', shadowBlur: 10, shadowOffset: { x: 5, y: 5 }, shadowOpacity: 0.3
        }));

        // 前盖区域（模拟可打开的面板盖），使用虚线表示边缘
        this.posBox.add(new Konva.Rect({ x: 10, y: 10, width: 100, height: 135, fill: '#b8b8b8', cornerRadius: 4, stroke: '#888', strokeWidth: 1, dash: [5, 5] }));

        // ==========================================
        // 2. 左下角：电气接口与 LCD (输入 4-20mA)
        // ==========================================

        // LCD 屏幕背景 (保持你的原设计，深灰色)
        this.posBox.add(new Konva.Rect({
            x: 15, y: 100, width: 90, height: 40,
            fill: '#1a1a1a', cornerRadius: 2,
            stroke: '#000', strokeWidth: 1
        }));

        // LCD 文本 (输入信号显示， Courier New字体)
        this.lcd = new Konva.Text({
            x: 30, y: 105,
            text: '4.0 mA',
            fontSize: 18, fill: '#33ff33',
            fontFamily: 'Courier New',
            id: 'lcd_text',
            align: 'center'
        });
        this.posBox.add(this.lcd);

        // ==========================================
        // 3. 气路系统 Group (顶部 0.1MPa 气压表)
        // ==========================================
        this.gaugeOut = new Konva.Group({
            x: 60, // 位于定位器顶部左侧
            y: 50
        });
        this.posBox.add(this.gaugeOut);

        // 表盘外圈 (金属边框)
        this.gaugeOut.add(new Konva.Circle({
            radius: 35,
            fillLinearGradientStartPoint: { x: -20, y: -20 },
            fillLinearGradientEndPoint: { x: 20, y: 20 },
            fillLinearGradientColorStops: [0, '#f0f0f0', 1, '#999'],
            stroke: '#666',
            strokeWidth: 2
        }));

        // 白色表盘背景
        this.gaugeOut.add(new Konva.Circle({
            radius: 31,
            fill: '#ffffff'
        }));

        // 绘制刻度线 (0 - 0.1 MPa)
        for (let i = 0; i <= 10; i++) {
            // 从 150度 到 390度 (覆盖下半圆以上区域)
            const angle = 150 + i * 24;
            const rad = (angle * Math.PI) / 180;
            const isLong = i === 5; // 长刻度
            const len = isLong ? 8 : 3;

            this.gaugeOut.add(new Konva.Line({
                points: [
                    Math.cos(rad) * 30, Math.sin(rad) * 30,
                    Math.cos(rad) * (30 - len), Math.sin(rad) * (30 - len)
                ],
                stroke: '#333',
                strokeWidth: isLong ? 2.5 : 2
            }));

            // 添加 0, 0.05, 0.1 数字标注
            if (isLong) {
                const label = (i * 0.01).toFixed(2);
                this.gaugeOut.add(new Konva.Text({
                    x: Math.cos(rad) * 20 - 8,
                    y: Math.sin(rad) * 20 - 0,
                    text: label === "0.00" ? "0" : label === "0.10" ? "0.1" : "0.05",
                    fontSize: 10,
                    fill: '#000',
                    align: 'center'
                }));
            }
        }

        // 气压表单位文本
        this.gaugeOut.add(new Konva.Text({
            x: -14, y: 18,
            text: 'MPa',
            fontSize: 10,
            fill: '#220ef7',
            width: 28,
            align: 'center'
        }));

        // 气压表指针 (初始指向0)
        this.posPointer = new Konva.Line({
            points: [0, 0, Math.cos(150 * Math.PI / 180) * 21, Math.sin(150 * Math.PI / 180) * 21],
            stroke: '#ff0000',
            strokeWidth: 3,
            lineCap: 'round'
        });
        this.gaugeOut.add(this.posPointer);

        // 指针中心轴
        this.gaugeOut.add(new Konva.Circle({
            radius: 2.5,
            fill: '#333'
        }));


        // ==========================================
        // 4. 右侧反馈系统 Group (反馈杆与连杆)
        // 需要随阀门移动动画控制
        // ==========================================
        this.feedbackSys = new Konva.Group({
            x: 120, // 起始于底座右边缘
            y: 80, // 中心高度
            id: 'feedback_arm'
        });
        this.posBox.add(this.feedbackSys);

        // U型反馈杆主体 (银色金属)
        // x方向凸出，y方向有一定宽度
        this.feedbackSys.add(new Konva.Rect({
            x: 0, y: -25, // 相对于反馈系统Group中心，居中
            width: 60, height: 20,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 60, y: 20 },
            fillLinearGradientColorStops: [0, '#eaeaea', 1, '#b8b8b8'],
            cornerRadius: 2,
            stroke: '#888', strokeWidth: 1
        }));

        // U型槽 (U字型杆的中间镂空区域)
        this.feedbackSys.add(new Konva.Rect({
            x: 10, y: -19, width: 40, height: 8,
            fill: '#4a4a4a', cornerRadius: 1 // 模拟深度
        }));

        // 反馈连杆 (连接 U型杆左侧与定位器内部的传动轴)
        this.feedbackSys.add(new Konva.Line({
            points: [5, -25, 5, -5], // 垂直连杆
            stroke: '#4a4a4a', strokeWidth: 4, lineCap: 'round'
        }));
        // 连接点圆形铆钉
        this.feedbackSys.add(new Konva.Circle({ x: 5, y: -15, radius: 4, fill: '#888', stroke: '#555', strokeWidth: 1 }));

        // ==========================================
        // 5. 组装与添加
        // ==========================================

        // 如果需要随阀杆移动反馈杆，需要将反馈系统Group从主体移出
        // this.posBox.remove(this.feedbackSys);
        // 建议在全局 Group 中独立管理，这里暂按包含关系演示布局。

        this.scaleGroup.add(this.posBox);
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -28 : 28, (i / coils) * h);
        }
        return pts;
    }

    /**
     * 集中化 tick 动画（20fps）
     * 原始 setInterval 周期 500ms，使用累加器保持原定时
     *
     * 说明：
     *  - 本 tick 方法按较低频率汇总物理与视觉更新，避免每帧都做重计算
     *  - dt 单位为秒，累加到 0.5s 后执行一次更新（与原始 500ms 行为一致）
     */
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.5) return;
        this._tickAcc = 0;

        // 1. 获取电压并计算目标开度 targetPos (0-1)
        const voltage = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`);

        // 假设采样电阻 250Ω，1-5V 对应 4-20mA，对应 0-1 的开度
        this.current = Math.max(0, Math.min(0.02, voltage / 250));
        this.update(1000 * this.current);
    
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    update(inputmA) {
        // 1) 电流输入处理：限制在 0~20mA 区间并处理非数字输入
        const mA = (typeof inputmA === 'number') ? Math.max(0, Math.min(20, inputmA)) : 0;

        // 2) 电流 -> 开度 映射（4-20mA 对应 0~100%）
        //    percent = (mA - 4) / 16，注意可能出现负值或 >1 的情况，下文通过边界处理
        const percent = (mA - 4) / 16;

        // 3) 视觉联动与压力映射
        // A. 将电流映射为定位器输出气压（量程映射：4mA -> 0.02 MPa, 20mA -> 0.1 MPa）
        const currentPressure = 0.02 + (percent * 0.08);
        // 输出压力受限于气源可用压力（this.sourcePress）
        this.outPress = Math.min(this.sourcePress, currentPressure);

        // 将输出压力映射到仪表角度（表盘量程 0~0.1 MPa，对应角度 150°~390°）
        const targetAngle = 150 + (this.outPress / 0.1) * 240;
        const rad = (targetAngle * Math.PI) / 180;
        if (this.posPointer) {
            this.posPointer.points([0, 0, Math.cos(rad) * 21, Math.sin(rad) * 21]);
        }

        // B. 气压滞后与泄漏模拟
        //    - 若泄漏（isLeaking），则在端口上设置属性，外部求解器可读取并处理
        const port = this.ports.find(p => p.id === `${this.id}_pipe_i`);
        if (port && port.node) port.node.setAttr('isLeaking', !!this.isLeaking);

        // 限制 inPress 在量程内，并计算目标行程（0~1）
        this.inPress = Math.max(0.02, Math.min(0.1, this.inPress));
        this.targetTravel = (this.inPress - 0.02) / 0.08;

        // C. 卡死逻辑：若卡死则 travel 不更新；正常情况使用一阶滤波平滑过渡
        if (!this.isStuck) {
            this.travel += (this.targetTravel - this.travel) * 0.3;
        }

        // D. 更新定位器 LCD（显示 mA 与百分比）
        this.lcd.text(`${mA.toFixed(1)}mA\n${Math.max(0, this.travel * 100).toFixed(1)}%`);

        // E. 驱动机械位移（基于 travel 映射到像素移动）
        const currentMove = Math.max(0, this.travel * this.strokePx);
        this.membrane.y(100 + currentMove);
        this.leftWire.points([-108, 5, -100, 5 + currentMove]);
        this.rightWire.points([108, 5, 100, 5 + currentMove]);
        this.spring.y(115 + currentMove);
        this.spring.points(this._getSpringPoints(225 - currentMove));
        this.stem.y(115 + currentMove);
        this.plug.y(587 + currentMove);

        // F. 联动其他组件（coupling、feedbackSys 等）
        this.coupling.y(350 + currentMove);
        if (this.feedbackSys) this.feedbackSys.y(80 + currentMove);

        // 刷新缓存以触发重绘
        this._refreshCache();
    }

    // 返回配置面板字段定义（编辑器 UI 使用）
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '气开、气关选择',
                key: 'dir',
                type: 'select',
                options: [
                    { label: '气开阀', value: 'positive' },
                    { label: '气关阀', value: 'negtive' }
                ]
            }
        ];
    }

    // 当用户通过 UI 修改配置后调用，进行属性同步与视觉修正
    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        this.dir = newConfig.dir || 'positive';
        this.config = newConfig;
        // 根据方向调整阀体管路位置（视觉调整，不改变仿真逻辑）
        if (this.dir === 'positive') this.pipe.y(30);
        else this.pipe.y(98);
        // 刷新缓存以触发重绘
        this._refreshCache();        
    }

}