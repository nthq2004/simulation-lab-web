import { BaseComponent } from './BaseComponent.js';

/**
 * PID 控制器组件
 *
 * 说明：
 * - 此组件模拟常见的工业 PID 调节器界面与控制逻辑，包含显示面板、按键菜单、报警、双路输出（CH1/CH2）等；
 * - 支持手动/自动切换、回差（DIFF）双位控制、PID 三项（P/I/D）、分程（Split Range）和输出限幅；
 * - 输入以 4-20mA 表示被测量值（PV），通过 `update(inputmA)` 调用来更新内部状态并计算输出；
 * - 输出可以映射为 4-20mA 或 PWM，占空比通过 `heatPWM` / `coolPWM` 表示；
 * - 视图使用 Konva 绘制，状态通过 `this.markDirty()` + `this._refreshIfDirty()` 刷新到画布。
 *
 * 注：本文件仅加入注释和小的文档化调整，不改变原有算法和控制流程。
 */
export class PIDController extends BaseComponent {
    /**
     * 构造器：创建组件并初始化状态
     * @param {Object} config - 场景传入的配置
     * @param {Object} sys - 全局系统对象（用于获取电源等）
     */
    constructor(config, sys) {
        super(config, sys);

        this.type = 'PID';
        this.cache = 'fixed'; // 用于静态缓存的特殊标识

        // 遵循新组件模板：_initGroups → _recalcGeometry → _initParameters → _init
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);

        // 可识别部件：A/M、SET、▲、▼ 按键与 PV/SV 显示区（供自动演示箭头精确定位）。
        // 注意：必须在创建按键之前注册，否则命中区会覆盖在按键之上、导致按键无法操作。
        // 坐标使用 _interactGroup 的局部坐标（与按键一致，随 _interactGroup 一起缩放）。
        this.addClickablePart('am', 10 + 1 * 62, 215, 55, 45);
        this.addClickablePart('set', 10 + 2 * 62, 215, 55, 45);
        this.addClickablePart('up', 10 + 3 * 62, 215, 55, 45);
        this.addClickablePart('down', 10 + 4 * 62, 215, 55, 45);
        this.addClickablePart('display', 10, 10, this.w - 20, 75);

        this._init();

        this.config = {
            id: this.id, sv: this.SV, p: this.P, i: this.I, d: this.D,
            lrv: this.LRV, urv: this.URV, split: this.APP === 'SPLIT',
        };

        // 左面板：4-20mA 输入 (AI)
        this.addPort(-20 * this.scale, 50 * this.scale, 'pi1', 'wire', 'p');
        this.addPort(-20 * this.scale, 100 * this.scale, 'ni1', 'wire');
        // 右面板：电源 (DC24V) + RS485
        this.addPort(this.w * this.scale + 20 * this.scale, 50 * this.scale, 'vcc', 'wire', 'p');
        this.addPort(this.w * this.scale + 20 * this.scale, 100 * this.scale, 'gnd', 'wire');
        this.addPort(this.w * this.scale + 20 * this.scale, 180 * this.scale, 'a1', 'wire', 'p');
        this.addPort(this.w * this.scale + 20 * this.scale, 230 * this.scale, 'b1', 'wire');

        // 下面板：双路输出 (CH1 / CH2)
        this.addPort(60 * this.scale, this.h * this.scale + 20 * this.scale, 'po1', 'wire', 'p');
        this.addPort(110 * this.scale, this.h * this.scale + 20 * this.scale, 'no1', 'wire');
        this.addPort(220 * this.scale, this.h * this.scale + 20 * this.scale, 'po2', 'wire', 'p');
        this.addPort(270 * this.scale, this.h * this.scale + 20 * this.scale, 'no2', 'wire');
    }

    // ═══════════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = 320;
        this.h = 280;
        this.scale = 1.1;
    }

    _initParameters(config) {
        this.powerOn = false;

        // --- 核心参数 ---
        this.mode = "MAN";
        // 分程控制（Split-Range）为可选功能：split:true → 分程，false → Normal
        this.APP = config.split ? "SPLIT" : "NORMAL";
        this.direction = "DIR";
        this.atActive = false;
        this.PV = 0;
        this.SV = config.SV !== undefined ? config.SV : 50;
        this.DIFF = 10;
        this.OUT = 50.0;
        this.P = 4;
        this.I = 0;
        this.D = 0;
        this.OL = 0;
        this.OH = 100;
        // 量程可由工程配置传入（须与被测温度量程一致，如 0~100℃）
        this.LRV = config.LRV !== undefined ? config.LRV : -20;
        this.URV = config.URV !== undefined ? config.URV : 120;
        this.alarmStatus = "----";
        this.alarm = { HH: 95, H: 90, L: 30, LL: 10 };
        this.out1Fault = false;
        this.out2Fault = false;
        // --- 内部 PID 运算状态 ---
        this.lastError = 0;    // 上一次的误差
        this.integral = 0;     // 积分累加值
        this.lastTime = Date.now(); // 上一次执行的时间戳
        this._tickAcc = 0;

        // --- 输出逻辑参数 ---
        this.outSelection = "CH1"; // 可选: "CH1", "CH2", "BOTH"
        this.outModes = { CH1: "4-20mA", CH2: "4-20mA" };

        // 每一路实际的物理输出值
        this.heatPWM = 0;
        this.output1mA = 4;
        this.output2mA = 4;
        this.coolPWM = 0;
        this.pwmPhase = 0;
        this.PERIOD = 5;
        this.heatInstantOn = 0;
        this.coolInstantOn = 0;

        // 输入回路判定阈值（V / mA）：
        //   FEED_PRESENT_V —— pi1 端口电压高于此值视为 24V 馈电存在（≈24V）
        //   OPEN_CIRCUIT_V —— 采样电压低于此值且馈电存在但电流近乎为 0，判为开路
        //   OPEN_CURRENT_MA —— 回路电流低于此值视为开路
        this.FEED_PRESENT_V = config.feedPresentV !== undefined ? config.feedPresentV : 12;
        this.OPEN_CIRCUIT_V = config.openCircuitV !== undefined ? config.openCircuitV : 12;
        this.OPEN_CURRENT_MA = config.openCurrentMA !== undefined ? config.openCurrentMA : 0.4;
        this.pi1Open = false;

        // 菜单系统（按键菜单状态机）
        this.menu = new IndustrialMenuSystem(this);
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }
    // ═══════════════════════════════════════════════════════════
    // 静态部件（机箱、面板、屏幕底板、参数框底板、辅助标注）
    // ═══════════════════════════════════════════════════════════

    _drawStaticParts() {
        // 所有元素按 scale 缩放绘制，统一放入静态层
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this._staticGroup.add(this.scaleGroup);

        const sidePanelAttr = { width: 20, height: this.h, fill: '#b5aeae', stroke: '#444', strokeWidth: 2, cornerRadius: 2 };
        const leftPanel = new Konva.Rect({ x: -20, y: 0, ...sidePanelAttr });
        const rightPanel = new Konva.Rect({ x: this.w, y: 0, ...sidePanelAttr });

        const body = new Konva.Rect({
            width: this.w, height: this.h,
            fill: '#1a1a1a', stroke: '#333', strokeWidth: 4, cornerRadius: 4
        });

        // 主显示区底板（PV/SV 文字在动态层）
        const mainScreen = new Konva.Rect({ x: 10, y: 10, width: this.w - 20, height: 75, fill: '#050505', cornerRadius: 2 });

        this.scaleGroup.add(leftPanel, rightPanel, body, mainScreen);

        // 参数框底板与标签（数值在动态层）
        const paramLayout = [
            { id: 'P', x: 10, y: 95, label: 'P' },
            { id: 'I', x: 88, y: 95, label: 'I' },
            { id: 'D', x: 166, y: 95, label: 'D' },
            { id: 'AL', x: 244, y: 95, label: 'AL' },
            { id: 'OL', x: 10, y: 140, label: 'OL' },
            { id: 'OH', x: 88, y: 140, label: 'OH' },
            { id: 'URV', x: 166, y: 140, label: 'URV' },
            { id: 'OUT', x: 244, y: 140, label: 'OUT' }
        ];
        paramLayout.forEach(p => {
            const group = new Konva.Group({ x: p.x, y: p.y });
            group.add(new Konva.Rect({ width: 70, height: 38, fill: '#000', stroke: '#444', strokeWidth: 1 }));
            group.add(new Konva.Text({ x: 4, y: 4, text: p.label, fontSize: 10, fill: '#ffffff', fontStyle: 'bold' }));
            this.scaleGroup.add(group);
        });

        // 下侧面板
        this._bottomPanel = new Konva.Rect({
            x: 0, y: this.h, width: this.w, height: 20,
            fill: '#b5aeae', stroke: '#444', strokeWidth: 2
        });
        this.scaleGroup.add(this._bottomPanel);

        // 辅助标注 (让接线一目了然)
        [[-40, 70, 'IN: 4-20mA'], [this.w + 20, 70, 'POWER'], [this.w + 20, 200, 'RS485'],
         [65, this.h + 5, 'OUT: CH1'], [225, this.h + 5, 'OUT: CH2']].forEach(a =>
            this.scaleGroup.add(new Konva.Text({ x: a[0], y: a[1], text: a[2], fontSize: 9, fill: '#0d05f2' })));
    }

    // ═══════════════════════════════════════════════════════════
    // 动态节点（PV/SV 显示、LED、参数数值、闪烁点）
    // ═══════════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 动态层整体按 scale 缩放，与静态层坐标一致
        this._dynamicGroup.scale({ x: this.scale, y: this.scale });

        // PV / SV 主显示（in-place 更新文字与颜色）
        this.pvDisplay = this._createDigit(25, 18, '00.0', 38, '#ff3333');
        this.svDisplay = this._createDigit(175, 18, '80.0', 38, '#33ff33');
        const pvLable = this._createDigit(10, 5, 'PV', 12, '#ff3333');
        const svLable = this._createDigit(160, 5, 'SV', 12, '#33ff33');
        this._dynamicGroup.add(this.pvDisplay, this.svDisplay, pvLable, svLable);

        // SV 编辑闪烁点
        this.editDot = new Konva.Circle({ x: 300, y: 45, radius: 3, fill: '#33ff33', visible: false });
        this._dynamicGroup.add(this.editDot);

        // 状态指示灯
        this.lights = {
            AUTO: this._createLED(20, 65, '#00ff00', 'AUTO'),
            MAN: this._createLED(65, 65, '#ffcc00', 'MAN'),
            AT: this._createLED(110, 65, '#ff00ff', 'AT'),
            AL: this._createLED(155, 65, '#ff3333', 'AL'),
            DIR: this._createLED(205, 65, '#00ffff', 'DIR'),
            REV: this._createLED(255, 65, '#00ffff', 'REV')
        };

        // 参数数值文本
        this.boxes = {};
        const paramVals = [
            { id: 'P', x: 10, y: 95 }, { id: 'I', x: 88, y: 95 }, { id: 'D', x: 166, y: 95 },
            { id: 'AL', x: 244, y: 95, color: '#ff3333' }, { id: 'OL', x: 10, y: 140 },
            { id: 'OH', x: 88, y: 140 }, { id: 'URV', x: 166, y: 140 }, { id: 'OUT', x: 244, y: 140, color: '#ffcc00' }
        ];
        paramVals.forEach(p => {
            const val = new Konva.Text({
                x: p.x, y: p.y + 18, text: '---', fontSize: 16, fontFamily: 'Courier New',
                fill: p.color || '#33ff33', width: 66, align: 'right'
            });
            this.boxes[p.id] = val;
            this._dynamicGroup.add(val);
        });

        // 按键（交互层）：AT / A/M / SET / ▲ / ▼
        this._interactGroup.scale({ x: this.scale, y: this.scale });
        const btnLabels = ['AT', 'A/M', 'SET', '▲', '▼'];
        this.btnObjs = {};
        btnLabels.forEach((label, i) => {
            const btn = this._createButton(10 + i * 62, 215, label);
            this.btnObjs[label] = btn;
            this._interactGroup.add(btn);
        });
    }

    _createDigit(x, y, txt, size, color) {
        return new Konva.Text({ x, y, text: txt, fontSize: size, fontFamily: 'Courier New', fontStyle: 'bold', fill: color });
    }

    _createLED(x, y, color, label) {
        const ledGroup = new Konva.Group({ scaleX: 1, scaleY: 1 });
        const dot = new Konva.Circle({ x, y: y + 4, radius: 4, fill: '#222', stroke: '#000', strokeWidth: 1 });
        const txt = new Konva.Text({ x: x + 8, y: y, text: label, fontSize: 10, fill: '#ddd', fontStyle: 'bold' });
        ledGroup.add(dot, txt);
        this._dynamicGroup.add(ledGroup);
        return dot;
    }

    _createButton(x, y, txt) {
        const g = new Konva.Group({ x, y, name: 'btn_' + txt });
        g.add(new Konva.Rect({ width: 55, height: 45, fill: '#444', stroke: '#000', cornerRadius: 3 }));
        g.add(new Konva.Text({ width: 55, y: 16, text: txt, align: 'center', fill: '#fff', fontSize: 13, fontStyle: 'bold' }));
        return g;
    }

    // ═══════════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════════

    _bindInteraction() {
        // 绑定按键事件处理：短按/长按区分、上下改变参数、SET 用于进入/保存
        Object.keys(this.btnObjs).forEach(label => {
            const btn = this.btnObjs[label];
            btn.on('mousedown', () => {
                btn.findOne('Rect').fill('#0f7e4a');
                if (label === 'AT') this.toggleAT();
                if (label === 'A/M') this.menu.pressRUN();
                if (label === '▲') this.menu.pressUP();
                if (label === '▼') this.menu.pressDOWN();
                if (label === 'SET') this.pressTimer = Date.now();
                this.markDirty(); this._refreshIfDirty();
            });
            btn.on('mouseup mouseleave', () => {
                btn.findOne('Rect').fill('#444');
                if (label === 'SET' && this.pressTimer) {
                    const dur = Date.now() - this.pressTimer;
                    this.menu.pressSET(dur > 1000);
                    this.pressTimer = null;
                }
                this.markDirty(); this._refreshIfDirty();
            });
            btn.on('dblclick', (e) => e.cancelBubble = true);
        });

        // 双击下侧面板清除输出故障
        this._bottomPanel.on('dblclick', (e) => {
            e.cancelBubble = true;
            if (this.outFault) this.outFault = false;
            this.markDirty(); this._refreshIfDirty();
        });
    }

    // ── 可识别部件中心（供自动演示箭头精确定位）──
    getClickablePartCenter(partId) {
        const b = this.btnObjs || {};
        const nodeMap = {
            am: b['A/M'], set: b['SET'], up: b['▲'], down: b['▼'],
            at: b['AT'], display: this.pvDisplay,
        };
        const node = nodeMap[partId];
        if (node) { const c = this.getNodeCenter(node); if (c) return c; }
        return super.getClickablePartCenter(partId);
    }

    toggleAT() {
        // 切换自动调整（Auto-Tune）活动标志，AT 常在自动模式下启用
        this.atActive = !this.atActive;
        if (this.atActive) this.mode = "AUTO"; // AT通常在自动模式下运行
    }

    /**
     * 集中化 tick 动画（20fps）
     * 原始 setInterval 周期 100ms，使用累加器保持原定时
     */
    tick(dt) {
        // 以近似 100ms（10Hz）节拍触发一次界面刷新、电源检测与输入采样
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.1) return;
        this._tickAcc = 0;

        // 电源存在判定：24V 线路高于 18V 视为上电
        this.powerOn = this.sys.getVoltageBetween('pid_wire_vcc', 'pid_wire_gnd') > 18;

        // 4~20mA 输入：由 pi1/ni1 端口的 250Ω 采样电阻实测电压换算，非硬编码
        this.update(this._readInputCurrent());

        this.markDirty(); this._refreshIfDirty();
    }

    /**
     * 实测 4~20mA 输入回路电流（mA）。
     * 原理：pi1 由内部 24V 馈电，ni1 端经 250Ω 采样电阻到地，回路电流 I = V(ni1)/250Ω。
     *  - 未上电 → 0mA；
     *  - pi1 无馈电（未接线/未上电）→ 0mA；
     *  - 回路开路：pi1 有 24V 馈电但回路电流近乎为 0（ni1 电压远低于正常工作时），
     *    即馈电存在而无电流流过采样电阻 → 视为开路（pi1Open），返回 0mA。
     * @returns {number} 输入电流（mA），范围 0~25
     */
    _readInputCurrent() {
        this.pi1Open = false;   // 输入回路开路标志（供监控主机读取报警）
        if (!this.powerOn) return 0;
        if (typeof this.sys.getVoltageAtPort !== 'function') return 0;

        const vPi1 = this.sys.getVoltageAtPort(`${this.id}_wire_pi1`);
        const vNi1 = this.sys.getVoltageAtPort(`${this.id}_wire_ni1`);
        if (vPi1 === undefined || vNi1 === undefined) return 0;

        // I = V(ni1) / 250Ω → 换算为 mA
        const mA = (vNi1 / 250) * 1000;

        // 开路判定：pi1 有馈电（≥ 馈电阈值）但采样电压过低（回路电流近乎为 0），
        // 说明回路断开、无电流流过 250Ω 采样电阻。
        if (vPi1 >= this.FEED_PRESENT_V && vNi1 < this.OPEN_CIRCUIT_V) {
            if (mA < this.OPEN_CURRENT_MA) { this.pi1Open = true; return 0; }
        }
        return Math.max(0, Math.min(25, mA));
    }

    destroy() {
        super.destroy?.();
    }
    update(inputmA) {
        /**
         * 核心更新/控制函数（每个仿真步调用）
         * - 输入为 4-20mA（或缺失时使用 4mA 默认为最小量程）
         * - 计算 dt（秒），执行 PID 或双位控制逻辑，更新 OUT、heatPWM/coolPWM、outputXmA 等输出
         * - 更新报警状态与显示文本
         */
        // 1. 获取时间增量 dt (秒)
        const now = performance.now();
        const dt = (now - this.lastTime) / 1000;
        this.lastTime = now;       
        if (dt <= 0) return;
        // 1. 更新 PWM 相位累加
        this.pwmPhase += dt;
        if (this.pwmPhase >= this.PERIOD) {
            this.pwmPhase -= this.PERIOD; // 周期复位
        }
        // 断电清屏逻辑

        if (this.powerOn === false) {
            try {
                this.pvDisplay.text('');
                this.svDisplay.text('');
                this.pvDisplay.fill('#000');
                this.svDisplay.fill('#000');
                Object.keys(this.lights).forEach(k => this.lights[k].fill('#222'));
                Object.keys(this.boxes).forEach(k => this.boxes[k].text(''));
                this.OUT = 50;
                this.heatPWM = 0; // 清除输出
                this.coolPWM = 0;
                this.output1mA = 0;
                this.output2mA = 0;
            } catch (e) { }
            this.markDirty(); this._refreshIfDirty();
            return;
        }


        // 2. 信号输入映射
        const validmA = (typeof inputmA === 'number' && !isNaN(inputmA)) ? inputmA : 4;
        this.PV = this.LRV + ((validmA - 4) / 16) * (this.URV - this.LRV);

        // 3. 计算误差
        let error = (this.SV - this.PV) / (this.URV - this.LRV) * 100; // 归一化误差到百分比
        if (this.direction === "REV") error = -error;

        if (this.mode === "AUTO") {
            if (this.P === 0) {
                // --- 双位控制 (On-Off Control) 逻辑 ---
                // 这里的 diff 即回差/死区
                const deadband = this.DIFF || 10;

                if (this.PV > this.SV + deadband) {
                    // 测量值超过设定值+回差，彻底关闭输出
                    this.OUT = 0;
                } else if (this.PV < this.SV) {
                    // 测量值低于设定值，全功率输出
                    this.OUT = 100;
                }
                // 注意：在 SV 和 SV + deadband 之间时，保持上一时刻的状态 (磁滞特性)

                // 双位模式下重置 PID 相关中间变量，防止切换回 PID 时发生突变
                this.integral = 0;
                this.lastError = error;

            } else {            // --- PID 核心算法 ---
                const P_out = this.P * error; // 归一化误差到 0-100% 范围

                if (this.I > 0) {
                    this.integral += error * (1 / this.I) * dt;
                } else {
                    this.integral = 0;
                }

                // 积分抗饱和 (针对 0-100% 范围)
                this.integral = Math.max(-20, Math.min(20, this.integral));

                const derivative = (error - this.lastError) / dt;
                const D_out = this.D * derivative;

                // 合并输出 (50为偏置基准，即 50% 处不加热也不冷却)
                this.OUT = 50 + P_out + this.integral + D_out;

                // 4. 限制总输出范围 (0-100)
                this.OUT = Math.max(0, Math.min(100, this.OUT));

                this.lastError = error;
            }
        }

        // ── 输出通道 ──
        // SPLIT（分程控制，本温控系统配置开启）：CH1/CH2 均为 PWM 开关量输出，
        //   以 50% 为中性点，占空比与偏差成正比、覆盖全量程（无死区），
        //   可直接驱动加/减继电器线圈：
        //     · OUT: 50→100%  heatPWM: 0→100%（OUT=100% 时连续 100% 输出）
        //     · OUT: 50→0%    coolPWM: 0→100%
        //     · OUT = 50%     加热/冷却均无输出
        // NORMAL（默认，其它工程沿用原逻辑）：按 outSelection 输出 4~20mA 或 PWM。
        if (this.APP === 'SPLIT') {
            this.outSelection = 'BOTH';
            this.outModes = { CH1: 'PWM', CH2: 'PWM' };
            const center = 50.0;
            if (this.OUT > center) {
                this.heatPWM = (this.OUT - center) / (100 - center);
                this.coolPWM = 0;
            } else if (this.OUT < center) {
                this.coolPWM = (center - this.OUT) / center;
                this.heatPWM = 0;
            } else {
                this.heatPWM = 0;
                this.coolPWM = 0;
            }
            this.output1mA = 4 + this.heatPWM * 16;
            this.output2mA = 4 + this.coolPWM * 16;
        } else {
            if (this.outSelection === 'CH1') {
                this.output1mA = 4 + (this.OUT / 100) * 16;
                this.heatPWM = this.OUT / 100;
                this.output2mA = 0;
                this.coolPWM = 0;
            } else if (this.outSelection === 'CH2') {
                this.output2mA = 4 + (this.OUT / 100) * 16;
                this.coolPWM = this.OUT / 100;
                this.output1mA = 0;
                this.heatPWM = 0;
            } else {
                const val = this.OUT / 100;
                this.heatPWM = val;
                this.coolPWM = val;
                this.output1mA = 4 + val * 16;
                this.output2mA = 4 + val * 16;
            }
        }
        if(this.out1Fault){
            this.heatPWM =0;
            this.output1mA =0;
        }
        if(this.out2Fault){
            this.coolPWM =0;
            this.output2mA =0;
        }
        // 2. 计算瞬时开关状态 (布尔值)
        // 如果当前相位在 (周期 * 占空比) 之内，则为开启
        this.heatInstantOn = this.pwmPhase < (this.PERIOD * this.heatPWM);
        this.coolInstantOn = this.pwmPhase < (this.PERIOD * this.coolPWM);

        // 报警逻辑
        if (this.PV > this.alarm.HH) this.alarmStatus = "HH";
        else if (this.PV > this.alarm.H) this.alarmStatus = "H";
        else if (this.PV < this.alarm.LL) this.alarmStatus = "LL";
        else if (this.PV < this.alarm.L) this.alarmStatus = "L";
        else this.alarmStatus = "----";

        // 更新指示灯
        this.lights.AUTO.fill(this.mode === "AUTO" ? "#00ff00" : "#222");
        this.lights.MAN.fill(this.mode === "MAN" ? "#ffcc00" : "#222");
        this.lights.AT.fill(this.atActive ? "#ff00ff" : "#222");
        this.lights.AL.fill(this.alarmStatus !== "----" ? "#ff0000" : "#222");
        this.lights.DIR.fill(this.direction === "DIR" ? "#00ffff" : "#222");
        this.lights.REV.fill(this.direction === "REV" ? "#00ffff" : "#222");

        // 更新显示
        const menuText = this.menu.getMenuText();
        if (menuText) {
            const parts = menuText.split(':');
            this.pvDisplay.text(parts[0]);
            this.svDisplay.text(parts[1] || "");
            this.pvDisplay.fill('#3498db');
        } else {

            if (this.PV > this.URV + 2) {
                this.pvDisplay.text('HHHH'.padStart(5, ' '));
            }
            else if (this.PV < this.LRV - 2) {
                this.pvDisplay.text('LLLL'.padStart(5, ' '));
            }
            else {
                this.pvDisplay.text(this.PV.toFixed(2).padStart(5, ' '));
            }
            this.svDisplay.text(this.SV.toFixed(2).padStart(5, ' '));
            this.pvDisplay.fill('#ff3333');
            this.svDisplay.fill('#19f1a2');
        }

        this.boxes.P.text(this.P.toFixed(1));
        this.boxes.I.text(this.I.toString());
        this.boxes.D.text(this.D.toFixed(1));
        this.boxes.AL.text(this.alarmStatus);
        this.boxes.OL.text(this.OL + "%");
        this.boxes.OH.text(this.OH + "%");
        this.boxes.URV.text(this.URV.toString());
        this.boxes.OUT.text(this.OUT.toFixed(1));
        this.markDirty(); this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════════

    getConfigFields() {
        const num = (label, key, get) => ({ label, key, type: 'number', get });
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text', get: c => c.id },
            num('设定值 SV', 'sv', c => c.SV),
            num('比例 P', 'p', c => c.P),
            num('积分 I', 'i', c => c.I),
            num('微分 D', 'd', c => c.D),
            num('量程下限 LRV', 'lrv', c => c.LRV),
            num('量程上限 URV', 'urv', c => c.URV),
            num('报警上限 HH', 'alarmHH', c => c.alarm.HH),
            // 控制方式：读取实时 APP（面板菜单 / 参数界面均可动态修改，二者保持同步）。
            // 只显示 Normal / Split，不加 PWM / 4-20mA 前缀（输出模式由运行逻辑动态决定）。
            {
                label: '控制方式', key: 'app', type: 'select', get: c => c.APP,
                options: [
                    { label: 'Normal', value: 'NORMAL' },
                    { label: 'Split', value: 'SPLIT' },
                ],
            },
        ];
    }

    onConfigUpdate(cfg) {
        // 仅处理参数配置界面暴露的字段（id/sv/p/i/d/lrv/urv/alarmHH/app）。
        // 运行模式 mode 由面板 A/M 按键操作，不属于本配置参数。
        if (cfg.id) this.id = cfg.id;
        if (cfg.sv !== undefined) this.SV = parseFloat(cfg.sv);
        if (cfg.p !== undefined) this.P = parseFloat(cfg.p);
        if (cfg.i !== undefined) this.I = parseFloat(cfg.i);
        if (cfg.d !== undefined) this.D = parseFloat(cfg.d);
        if (cfg.lrv !== undefined) this.LRV = parseFloat(cfg.lrv);
        if (cfg.urv !== undefined) this.URV = parseFloat(cfg.urv);
        if (cfg.alarmHH !== undefined) this.alarm.HH = parseFloat(cfg.alarmHH);
        if (cfg.app !== undefined) this.APP = (cfg.app === 'SPLIT') ? 'SPLIT' : 'NORMAL';
        // 控制方式同步进 config，保证参数界面再次打开时显示当前值
        this.syncAppToConfig();
        this.markDirty(); this._refreshIfDirty();
    }

    /** 把实时 APP（控制方式）同步进 config.split，保持菜单与参数界面一致 */
    syncAppToConfig() {
        this.config = {
            ...this.config, id: this.id, sv: this.SV,
            p: this.P, i: this.I, d: this.D, lrv: this.LRV, urv: this.URV,
            split: this.APP === 'SPLIT',
        };
    }
}

class IndustrialMenuSystem {
    constructor(pid) {
        this.pid = pid;
        this.level = 0;
        this.groupIndex = 0;
        this.paramIndex = 0;

        // --- 新增：参数确认逻辑变量 ---
        this.pendingValue = null;   // 存储修改中但未确认的值
        this.isModified = false;    // 标识当前参数是否被动过
        this.lastActionTime = 0;    // 用于 5 秒超时还原
        this.dotVisible = false;    // 用于圆点闪烁控制
        this.flashTimer = 0;        // 闪烁频率计时

        this.lastMenuActivity = 0; // 新增：用于 20s 菜单自动返回

        this.groups = [
            { name: "PID", params: ["P", "I", "D", "OL", "OH", "DIFF"] },
            { name: "ALARM", params: ["HH", "H", "L", "LL"] },
            { name: "RANGE", params: ["SV", "LRV", "URV"] },
            { name: "SYS", params: ["mode", "DIR", "APP", "OUTSEL", "CH1M", "CH2M"] }
        ];
    }
    // 每次按键都刷新 20s 计时
    refreshMenuTimer() {
        this.lastMenuActivity = Date.now();
    }
    pressUP() {
        this.refreshMenuTimer();
        if (this.level === 0) {
            if (this.pid.mode === "AUTO") this.pid.SV += 1*this.pid.URV/100;
            else this.pid.OUT = Math.min(this.pid.OH, this.pid.OUT + 1);
        } else if (this.level === 1) {
            this.groupIndex = (this.groupIndex + 1) % this.groups.length;
        } else if (this.level === 2) this.changeValue(1);
    }

    pressDOWN() {
        this.refreshMenuTimer();
        if (this.level === 0) {
            if (this.pid.mode === "AUTO") this.pid.SV -= 1*this.pid.URV/100;
            else this.pid.OUT = Math.max(this.pid.OL, this.pid.OUT - 1);
        } else if (this.level === 1) {
            this.groupIndex = (this.groupIndex - 1 + this.groups.length) % this.groups.length;
        } else if (this.level === 2) this.changeValue(-1);
    }

    pressSET(longPress) {
        this.refreshMenuTimer();
        if (this.level === 2 && !longPress && this.isModified) {
            // --- 关键：只有在修改状态按下 SET 才真正保存 ---
            const p = this.groups[this.groupIndex].params[this.paramIndex];
            this._commitValue(p, this.pendingValue);
            this.isModified = false; // 保存后清除修改状态
            return;
        }

        // 基础菜单跳转逻辑
        if (this.level === 0 && longPress) this.level = 1;
        else if (this.level === 1) { this.level = 2; this.paramIndex = 0; }
        else if (this.level === 2) {
            if (longPress) { this.level = 0; this.isModified = false; }
            else {
                this.paramIndex = (this.paramIndex + 1) % this.groups[this.groupIndex].params.length;
                this.isModified = false; // 切换参数时放弃未保存的修改
            }
        }
    }

    pressRUN() { this.pid.mode = this.pid.mode === "AUTO" ? "MAN" : "AUTO"; }


    changeValue(step) {
        const p = this.groups[this.groupIndex].params[this.paramIndex];

        // 如果是首次修改，备份当前值到 pendingValue
        if (!this.isModified) {
            this.pendingValue = this._getRealValue(p);
            this.isModified = true;
        }

        this.lastActionTime = Date.now(); // 更新操作时间

        // 修改逻辑
        if (typeof this.pendingValue === 'number') {
            this.pendingValue += step;
        } else {
            // 枚举类型切换逻辑 (DIR, OUT-S 等)
            this.pendingValue = this._getNextEnum(p, this.pendingValue);
        }
    }

    // 内部：获取当前参数真实值
    _getRealValue(p) {
        // 建立短代码与实际属性的映射表
        const map = {
            "DIR": this.pid.direction,
            "OUTSEL": this.pid.outSelection,
            "CH1M": this.pid.outModes.CH1,
            "CH2M": this.pid.outModes.CH2,
            "mode": this.pid.mode
        };

        if (map[p] !== undefined) return map[p];

        // 如果是数字参数（如 P, I, D 或 alarm 对象里的值）
        return this.pid[p] !== undefined ? this.pid[p] : this.pid.alarm[p];
    }

    // 内部：写入参数到 PID 实例
    _commitValue(p, val) {
        if (p === "DIR") this.pid.direction = val;
        else if (p === "OUTSEL") this.pid.outSelection = val;
        else if (p === "CH1M") this.pid.outModes.CH1 = val;
        else if (p === "CH2M") this.pid.outModes.CH2 = val;
        else if (p === "mode") this.pid.mode = val;
        else if (p === "APP") { this.pid.APP = val; this.pid.syncAppToConfig && this.pid.syncAppToConfig(); }
        else if (this.pid[p] !== undefined) this.pid[p] = val;
        else if (this.pid.alarm[p] !== undefined) this.pid.alarm[p] = val;
    }
    /**
  * 内部辅助方法：处理非数字枚举值的循环切换
  * @param {string} p - 参数键名 (如 "DIR", "OUTSEL")
  * @param {string} current - 当前显示的临时值
  * @returns {string} 下一个枚举值
  */
    _getNextEnum(p, current) {
        // 1. 定义每个短参数名对应的可选值列表
        const enumMaps = {
            "mode": ["AUTO", "MAN"],             // 运行模式：自动/手动
            "DIR": ["DIR", "REV"],             // 控制方向：正向/反向
            "APP": ["SPLIT", "NORMAL"],
            "OUTSEL": ["CH1", "CH2", "BOTH"],     // 输出通道选择
            "CH1M": ["4-20mA", "PWM"],          // 通道1输出模式
            "CH2M": ["4-20mA", "PWM"]         // 通道2输出模式           
        };

        // 2. 获取该参数对应的列表
        const list = enumMaps[p];

        // 3. 如果不在列表中（例如误传了数字参数），则直接返回原值
        if (!list) return current;

        // 4. 计算下一个值的索引，实现循环切换
        let idx = list.indexOf(current);

        // 如果当前值由于某种原因不在列表中（例如初始化错误），从第一个开始
        if (idx === -1) return list[0];

        // 核心逻辑：(当前索引 + 1) 对 列表长度 取模
        return list[(idx + 1) % list.length];
    }



    getMenuText() {
        if (this.level === 0) {
            this.pid.editDot.visible(false); // 回到主界面关闭圆点
            return null;
        }

        const now = Date.now();

        // --- 新增：20s 自动返回主界面逻辑 ---
        if (now - this.lastMenuActivity > 20000) {
            this.level = 0;
            this.isModified = false;
            this.pid.editDot.visible(false);
            console.log("Menu timeout: returning to main screen");
            return null;
        }

        // --- 5秒超时还原逻辑 ---
        if (this.isModified && (Date.now() - this.lastActionTime > 5000)) {
            this.isModified = false; // 放弃修改，跳回原值
            this.pendingValue = null;
            // 注意：这里只还原数值，不退出菜单            
        }

        if (this.level === 1) return "GRP:" + this.groups[this.groupIndex].name;

        const p = this.groups[this.groupIndex].params[this.paramIndex];
        const val = this.isModified ? this.pendingValue : this._getRealValue(p);

        // --- 圆点闪烁控制 ---
        if (this.isModified) {
            if (Date.now() - this.flashTimer > 300) {
                this.pid.editDot.visible(!this.pid.editDot.visible());
                this.flashTimer = Date.now();
            }
        } else {
            this.pid.editDot.visible(false);
        }

        // 返回短名称和当前值
        let displayVal = val;
        return p.substring(0, 6) + ":" + displayVal;
    }
}