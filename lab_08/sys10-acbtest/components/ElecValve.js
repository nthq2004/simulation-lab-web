import { BaseComponent } from './BaseComponent.js';

/**
 * ElecValve - 三通电动执行机构（视觉+控制逻辑）
 *
 * 说明：
 * - 本组件实现三通阀的可视化与简单控制逻辑（手动/远程两种模式），包含：
 *   - 阀体腔体（由三段弧构成，代表三通口）
 *   - 旋转阀板（Wedge）用于阻断/导通不同通道
 *   - 电机图标与手轮用于交互（手轮在 MANUAL 模式下可点击微调）
 *   - LCD 显示当前开度百分比
 * - 控制模式：`REMOTE`（远程）或 `MANUAL`（手动）。远程模式下通过总线/电压计算目标开度，
 *   手动模式下由手轮控制 `manualPos`。组件维护 `currentPos` 并通过 `tick` 平滑过渡到目标值。
 * - 电气接口：右侧有 `p`、`n` 两个线端（电机电源/信号），底部/侧面三个 `pipe` 端口为三通流体接口。
 *
 * 注意：本文件以教学/演示为主，非精细物理仿真；电流/电压与实际流量/压力之间的映射由上层系统决定。
 */

export class ElecValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 初始化图层组（BaseComponent 提供 _staticGroup/_dynamicGroup/_interactGroup）
        this._initGroups();
        this.radius = 60; // 阀体腔体主半径（像素单位）

        // --- 状态与控制变量 ---
        this.special = 'actuator';
        // 控制模式：'MANUAL' 或 'REMOTE'（默认 REMOTE）
        this.controlMode = 'REMOTE';
        // 缓存策略：当为 'fixed' 时，静态图形会被缓存以提高绘制性能
        this.cache = 'fixed';

        // 手动/远程设定与实际位置（0.0 - 1.0）
        this.manualPos = 0;    // 手动模式下由手轮调整
        this.remotePos = 0;    // 远程模式下由系统或电压计算得到
        this.currentPos = 0;   // 实际当前开度，tick 中平滑逼近目标
        this.isStuck = false;  // 卡死故障标志，true 时拒绝位置更新

        // 绘制各个子部件
        this.initValveChamber();
        this.initActuator();
        this.initRotaryVane();
        this.initHandwheel();
        this.initLCD();
        this.initModeSwitch();

        // 简单电气/仿真参数（用于把电压映射为电流，再计算目标开度）
        this.type = 'resistor';
        this.currentResistance = 250; // 电阻值（Ω），用于从电压估算电流（教学近似）

        // --- 端口定义 ---
        // 三通流体端口（位置与腔体对应）
        this.addPort(60, -10, 'r', 'pipe');    // 上口
        this.addPort(-10, 60, 'u', 'pipe', 'in'); // 左口
        this.addPort(60, 130, 'l', 'pipe', 'in'); // 下口

        // 电气端口：用于从系统读取电压/电流以驱动电机（教学近似）
        this.addPort(175, 40, 'l', 'wire', 'p');  // 电机正极（p）
        this.addPort(175, 80, 'r', 'wire');       // 电机负极（n）
    }

    /**
     * 1. 绘制三段弧组成的腔体
     */
    initValveChamber() {
        this.chamberGroup = new Konva.Group({ x: 60, y: 60 });
        const arcStroke = '#2c3e50';
        const strokeW = 15;

        // 第1段：右侧 (正上到正下) -> -90度 到 90度
        const arc1 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 140, rotation: -70, // 留出上下开口的间隙
            stroke: arcStroke, strokeWidth: strokeW
        });
        // 管道上接口
        const arcup = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: -110, // 留出上下开口的间隙
            stroke: '#f1c7c7', strokeWidth: strokeW + 6
        });
        const arcup2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: -110, // 留出上下开口的间隙
            stroke: '#bdc2cb', strokeWidth: strokeW - 4
        });

        // 第2段：左上 (正上到正左) -> 180度 到 270度
        const arc2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 50, rotation: 200, // 留出上口和左口间隙
            stroke: arcStroke, strokeWidth: strokeW
        });
        // 管道左接口
        const arcleft = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 160, // 留出上下开口的间隙
            stroke: '#f1c7c7', strokeWidth: strokeW + 6
        });
        const arcleft2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 160, // 留出上下开口的间隙
            stroke: '#e2e5ed', strokeWidth: strokeW - 4
        });
        // 第3段：左下 (正左到正下) -> 90度 到 180度
        const arc3 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 50, rotation: 110, // 留出左口和下口间隙
            stroke: arcStroke, strokeWidth: strokeW
        });
        // 管道下接口
        const arcdown = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 70, // 留出上下开口的间隙
            stroke: '#f1c7c7', strokeWidth: strokeW + 6
        });
        const arcdown2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 70, // 留出上下开口的间隙
            stroke: '#e2e5ed', strokeWidth: strokeW - 4
        });
        this.chamberGroup.add(arc1, arcup, arcup2, arc2, arcleft, arcleft2, arc3, arcdown, arcdown2);
        this._staticGroup.add(this.chamberGroup);
    }

    /**
     * 2. 绘制电机驱动机构
     */
    initActuator() {
        const box = new Konva.Rect({
            x: 115, y: 20, width: 60, height: 80,
            fill: '#34495e', stroke: '#000', cornerRadius: 5
        });

        // 电机矢量符号 (圆圈 + M)
        this.motorIcon = new Konva.Circle({ x: 145, y: 60, radius: 20, fill: '#ecf0f1', stroke: '#2c3e50' });
        const mText = new Konva.Text({ x: 138, y: 54, text: 'M', fontSize: 18, fontStyle: 'bold' });
        const labelText = new Konva.Text({ x: 100, y: 118, text: '三通调节阀', fontSize: 18, fontStyle: 'bold' })
        // 双击清除卡死故障
        this.motorIcon.on('dblclick', (e) => {
            e.cancelBubble = true;
            if (this.isStuck) this.isStuck = false;
        });
        this._interactGroup.add(box, this.motorIcon, mText, labelText);
    }

    /**
     * 3. 绘制旋转扇形阀板
     */
    initRotaryVane() {
        // vaneGroup 的旋转角度控制阀板遮挡哪个腔口
        // rotation 值（度）映射到视觉上的开度，与 update 中的映射保持一致
        // 阀板容器，中心点在 (60, 60)
        this.vaneGroup = new Konva.Group({ x: 60, y: 60 });

        // 扇形阀板 (橙色)
        // 跨度90度，正好可以遮住一个象限的开口
        this.vane = new Konva.Wedge({
            x: 0, y: 0,
            radius: this.radius - 10,
            angle: 90,
            fill: '#06a844',
            stroke: '#d35400',
            strokeWidth: 1,
            rotation: 100 // 初始位置
        });

        // 中心轴
        const pivot = new Konva.Circle({ radius: 8, fill: '#7f8c8d', stroke: '#000' });
        this.vaneGroup.add(this.vane, pivot);
        this._staticGroup.add(this.vaneGroup);
    }

    /**
     * 4. 绘制液晶显示屏 (LCD)
     */
    initLCD() {
        const lcdX = 35;
        const lcdY = 15; // 位于中心上方一点

        // 液晶屏背景框
        const lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY,
            width: 50, height: 22,
            fill: '#1a1a1a',
            stroke: '#7f8c8d',
            strokeWidth: 1,
            cornerRadius: 2
        });

        // 液晶屏数字显示
        this.lcdText = new Konva.Text({
            x: lcdX, y: lcdY + 4,
            width: 50,
            text: '100%',
            fontSize: 14,
            fontFamily: 'Courier New', // 模拟数码管感
            fontStyle: 'bold',
            fill: '#00ff00', // 荧光绿
            align: 'center',
            shadowColor: '#00ff00',
            shadowBlur: 5,
            shadowOpacity: 0.5
        });

        this._staticGroup.add(lcdBg, this.lcdText);
    }

    /**
     * 新增：绘制手轮并绑定拖拽旋转逻辑
     */
    initHandwheel() {
        this.wheelGroup = new Konva.Group({ x: 60, y: 60 });

        // 绘制手轮 (保持原样)
        const wheelRim = new Konva.Circle({ radius: 25, stroke: '#95a5a6', strokeWidth: 5, fill: '#bdc3c7' });
        const spoke1 = new Konva.Line({ points: [0, -20, 0, 20], stroke: '#7f8c8d', strokeWidth: 3 });
        const spoke2 = new Konva.Line({ points: [-20, 0, 20, 0], stroke: '#7f8c8d', strokeWidth: 3 });
        const knob = new Konva.Circle({ x: 18, y: 0, radius: 3, fill: '#e74c3c' });

        this.wheelGroup.add(wheelRim, spoke1, spoke2, knob);
        this._staticGroup.add(this.wheelGroup);
        this.wheelGroup.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // --- 点击交互逻辑 ---
        this.wheelGroup.on('click', (e) => {
            e.cancelBubble = true;
            if (this.controlMode !== 'MANUAL') return;

            // 获取鼠标点击相对于手轮中心 (0,0) 的相对坐标
            const pointer = this.wheelGroup.getRelativePointerPosition();

            // y < 0 为上半部分，y > 0 为下半部分
            if (pointer.y < 0) {
                // 点击上半部分：顺时针旋转，开度增大
                this.manualPos = Math.min(1.0, this.manualPos + 0.05);
            } else {
                // 点击下半部分：逆时针旋转，开度减小
                this.manualPos = Math.max(0.0, this.manualPos - 0.05);
            }

            this.update(); // 触发 UI 更新
        });
    }

    /**
     * 新增：手动/远程切换开关
     */
    initModeSwitch() {
        const swGroup = new Konva.Group({ x: 127, y: 0 });
        const base = new Konva.Rect({ width: 40, height: 20, fill: '#2c3e50', cornerRadius: 10 });
        this.toggleHandle = new Konva.Circle({ x: 30, y: 10, radius: 8, fill: '#0bf555' });
        this.modeLabel = new Konva.Text({ x: -4, y: -12, text: 'REMOTE', fontSize: 10, fill: '#2d09f8', fontstyle: 'bold', width: 50, align: 'center' });

        swGroup.add(base, this.toggleHandle, this.modeLabel);
        this._interactGroup.add(swGroup);

        swGroup.on('click', (e) => {
            e.cancelBubble = true;
            if (this.controlMode === 'REMOTE') {
                // --- 远程转手动 ---
                this.controlMode = 'MANUAL';
                // 保持同步：手动模式的初始值等于当前的远程值
                this.manualPos = this.remotePos;

                this.toggleHandle.x(10);
                this.toggleHandle.fill('#f1c40f');
                this.modeLabel.text('MANUAL');
            } else {
                // --- 手动转远程 ---
                this.controlMode = 'REMOTE';
                // 保持同步：将手动的最后开度同步给远程逻辑（视控制系统逻辑而定，这里确保位置一致）
                this.remotePos = this.manualPos;

                this.toggleHandle.x(30);
                this.toggleHandle.fill('#0dfd49');
                this.modeLabel.text('REMOTE');
            }
            this.update();
        });
    }
    updateModeText(mode) {
        if (mode === 'MANUAL') {
            this.toggleHandle.x(10);
            this.toggleHandle.fill('#f1c40f');
            this.modeLabel.text('MANUAL');
        } else {
            this.toggleHandle.x(30);
            this.toggleHandle.fill('#0dfd49');
            this.modeLabel.text('REMOTE');
        }
    }

    /**
     * 集中化 tick 动画（20fps）
     * 原始 setInterval 周期 200ms，使用累加器保持原定时
     */
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.2) return;
        this._tickAcc = 0;

        // 记录当前的逻辑开度，用于平滑过渡 (0-1)
        this.currentPos = this.currentPos || 0;

        // 设定滞后参数：每次循环（200ms）允许改变的最大百分比
        // 0.05 表示每 200ms 最多移动 5% 的行程，即完成全行程需要 4 秒
        const maxStep = 0.05;

        // 1. 获取电压并计算目标开度 targetPos (0-1)
        const voltage = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`);

        let targetPos;
        if (voltage > 0.1) {
            // 有有效电压信号时，从 4-20mA 换算目标开度
            const current = Math.max(0.004, Math.min(0.02, voltage / this.currentResistance));
            targetPos = (1000 * current - 4) / 16;
            // 注意：这里使用电压除以电阻估算电流（I=V/R），并将安培转换为 mA 后按 4-20mA 线性映射。
            // 教学注意事项：此处为近似做法，真实系统应使用专用传感/驱动电路。
            this._refreshCache();
        } else {
            // 无电压信号时，直接使用远程/手动设置的开度
            targetPos = (this.controlMode === 'MANUAL') ? this.manualPos : this.remotePos;
        }

        // 2. 滞后逻辑处理：计算当前值向目标值的逼近
        const diff = targetPos - this.currentPos;

        if (Math.abs(diff) <= maxStep) {
            // 如果差距小于步进，直接到达
            this.currentPos = targetPos;
        } else {
            // 否则按最大步进向目标移动
            this.currentPos += diff > 0 ? maxStep : -maxStep;
        }

        // 3. 执行物理/视觉更新
        this.update(this.currentPos);
    }

    destroy() {
        super.destroy?.();
    }
    /**
     * 更新阀门位置
     * @param {number} pos 0.0 - 1.0
     */
    update(inputPos) {

        if (this.isStuck) {
            // 如果卡死，无论外部传入什么 inputPos，都不更新 currentPos
            // 液晶屏可以闪烁显示当前开度以示异常
            this.lcdText.fill(Math.floor(Date.now() / 500) % 2 ? '#ff0000' : '#7f8c8d');
            this._refreshCache();
            return;
        }
        // 1. 如果是远程模式且有外部输入，更新远程值
        if (this.controlMode === 'REMOTE' && typeof inputPos === 'number') {
            this.remotePos = inputPos;
        }

        // 2. 确定当前实际显示的开度
        this.currentPos = (this.controlMode === 'MANUAL') ? this.manualPos : this.remotePos;

        const safePos = Math.max(0, Math.min(1, this.currentPos));
        const percent = Math.round(safePos * 100);

        // 3. 旋转角度映射 (阀板与手轮同步旋转)
        const startRotation = 110;
        const endRotation = 70;
        const currentRotation = endRotation + (safePos * (startRotation - endRotation));

        this.vane.rotation(currentRotation);
        this.wheelGroup.rotation(currentRotation * 5.5); // 手轮旋转角度可以设大一点，增加操作感

        // 4. LCD 与 颜色反馈
        this.lcdText.text(percent + "%");
        this.lcdText.fill(percent > 10 ? '#00ff00' : '#ff3300');

        const color = safePos > 0.1 ? '#11ed65' : '#fa3b25';
        this.vane.fill(color);

        this._refreshCache();
    }
}