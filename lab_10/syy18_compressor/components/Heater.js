import { BaseComponent } from "./BaseComponent.js";

/**
 * Heater - 加热器组件（视觉与简易控制模型）
 *
 * 说明：
 * - 本组件用于教学演示加热器的外观与功率/温度近似表现。
 * - 支持两种控制模式：`local`（面板按钮直接控制）和 `remote`（外部 PWM/信号控制）。
 * - 关键变量：
 *     - `power`：当前实际输出（0-1），用于控制视觉效果（发热丝颜色、阴影等）。
 *     - `targetPower`：目标功率，根据模式由按钮或外部信号设置。
 * - 热惯性建模：`_updateElectricalState` 使用不同的上升/下降系数模拟加热/冷却慢速响应。
 * - 注意：此为教学可视化组件，不代表真实热力学仿真，仅近似模拟响应与视觉反馈。
 */

export class Heater extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 标准尺寸
        this.cache = 'fixed';
        this._initGroups();
        this.W = 160;
        this.H = 200;

        // ===== 核心状态 =====
        // 控制模式：'local'（面板）或 'remote'（外部信号）
        this.mode = "local";
        // 是否处于运行状态（用于指示灯/按钮反馈）
        this.running = false;
        // 当前实际输出（0-1），受热惯性影响平滑到 targetPower
        this.power = 0;
        // 目标功率（0-1），remote 模式下由外部 pwm 设定，local 模式由按钮设置为 0 或 1
        this.targetPower = 0;

        // ===== 初始化绘制 =====
        this._drawShell();
        this._drawPowerInput();
        this._drawTopPanel();
        this._drawHeater();
        this._createPorts();
    }

    /**
     * 核心受控更新函数
     * @param {number} pwm - 远程模式下的输入功率 (0-1)
     * @param {number} dt - 主程序传入的两帧间隔时间 (秒)
     */
    update(pwm) {
        // 1. 模式逻辑处理
        if (this.mode === "remote") {
            // 在远程模式下，pwm（0-1）映射为目标功率
            this.targetPower = Math.max(0, Math.min(1, pwm || 0));
            this.running = this.targetPower > 0.05; // 加入小阈值避免噪声
        } else {
            // 本地模式下，targetPower 由面板的 start/stop 按钮设置为 1 或 0
        }
    }

    /**
     * 集中化 tick 动画（20fps）
     * 原始 setInterval 周期 500ms，使用累加器保持原定时
     */
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.5) return;
        this._tickAcc = 0;
        // 每 500ms 更新一次热状态（保持与原始实现一致）
        this._updateElectricalState(0.5);

        // 仅在有视觉更新时刷新缓存（BaseComponent 提供 _refreshCache/_refreshIfDirty）
        this._refreshCache();
    }

    _updateElectricalState(dt){
        // 2. 模拟热惯性（上升比下降快或慢）：
        //    当目标大于当前值时使用较大的上升系数（加热较快），否则使用较小的冷却系数
        const inertia = this.targetPower > this.power ? 0.5 : 0.2;
        // 将 dt 纳入计算并放大（原实现使用 dt*10），以保持响应速度与原版一致
        this.power += (this.targetPower - this.power) * inertia * dt * 10;

        // 边界修正，避免数值漂移
        if (this.power < 0.01) this.power = 0;
        if (this.power > 0.99) this.power = 1;

        // 3. 执行视觉更新（根据 this.power 改变加热丝颜色与阴影）
        this._renderVisuals();
    }

    /**
     * 视觉刷新逻辑
     * 仅修改现有 Konva 节点的属性，不创建新节点
     */
    _renderVisuals() {
        // A. 颜色计算：由暗灰到亮红再到橙黄色，依据 power 调整 RGB
        const r = Math.floor(58 + (255 - 58) * this.power);
        const g = this.power > 0.7 ? Math.floor((this.power - 0.7) * 400) : 0; // 超过 70% 时过渡到橙色
        const color = `rgb(${r}, ${Math.min(220, g)}, 0)`;

        // B. 更新加热丝外观：线条颜色与阴影随功率增强
        //    注意：shadowBlur / shadowOpacity 会增加渲染开销，若遇到性能问题可考虑移除
        this.coils.forEach((coil) => {
            coil.stroke(color);
            coil.shadowBlur(this.power * 15);
            coil.shadowOpacity(this.power * 0.8);
        });

        // C. 控制面板按钮视觉反馈
        this.startBtn.fill(this.running ? "#00ff00" : "#0da30d");
        this.stopBtn.fill(!this.running ? "#ff0000" : "#9a0f0f");
        this.startBtn.shadowOpacity(this.running ? 0.6 : 0);
        this.stopBtn.shadowOpacity(!this.running ? 0.6 : 0);
    }

    _drawShell() {
        this._staticGroup.add(new Konva.Rect({
            width: this.W,
            height: this.H,
            stroke: "#333",
            strokeWidth: 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.W, y: this.H },
            fillLinearGradientColorStops: [0, '#e8e8e8', 1, '#bcbcbc'],
            cornerRadius: 4,
            shadowBlur: 8,
            shadowOpacity: 0.2
        }));
    }

    _drawPowerInput() {
        const inputGroup = new Konva.Group({ x: 0, y: 10 });
        const colors = ["#8B4513", "#4169E1"];
        [1, 2].forEach((i) => {
            const lineY = i * 15;
            inputGroup.add(new Konva.Line({
                points: [-25, lineY, 0, lineY],
                stroke: "#555",
                strokeWidth: 3
            }));
            inputGroup.add(new Konva.Circle({
                x: 0, y: lineY, radius: 4,
                fill: colors[i - 1], stroke: "#333", strokeWidth: 1
            }));
            inputGroup.add(new Konva.Text({
                x: 5, y: lineY - 5,
                text: i === 1 ? "L" : "N",
                fontSize: 9, fill: "#666", fontStyle: "bold"
            }));
        });
        this._staticGroup.add(inputGroup);
    }

    _drawTopPanel() {
        // 面板背景
        this._staticGroup.add(new Konva.Rect({
            width: this.W,
            height: 60,
            fill: "#cfcfcf",
            stroke: "#333",
            strokeWidth: 1,
            cornerRadius: { topLeft: 4, topRight: 4 }
        }));

        // 模式切换文字
        const selectorGroup = new Konva.Group({ x: 35, y: 32 });
        selectorGroup.add(new Konva.Text({ x: -22, y: -24, text: "LOC", fontSize: 9, fontStyle: 'bold' }));
        selectorGroup.add(new Konva.Text({ x: 8, y: -24, text: "REM", fontSize: 9, fontStyle: 'bold' }));

        // 旋钮
        this.knob = new Konva.Group({ cursor: 'pointer' });
        this.knob.add(new Konva.Circle({
            radius: 14,
            fillLinearGradientColorStops: [0, '#666', 1, '#111'],
            stroke: "#000", strokeWidth: 1
        }));
        this.knob.add(new Konva.Rect({ x: -2, y: -14, width: 4, height: 14, fill: "#fff", cornerRadius: 1 }));

        // 设置初始角度
        this.knob.rotation(this.mode === "local" ? -45 : 45);

        this.knob.on("click", () => {
            this.mode = this.mode === "local" ? "remote" : "local";
            this.targetPower = 0; // 切换时重置状态
            this.running = false;
            this._updateSelectorUI();
        });
        selectorGroup.add(this.knob);
        this._staticGroup.add(selectorGroup);

        // 控制按钮
        const btnY = 32;
        this.startBtn = new Konva.Circle({
            x: 95, y: btnY, radius: 14,
            fill: "#0a810a", stroke: "#000", strokeWidth: 2,
            shadowColor: "#00ff00", cursor: 'pointer'
        });
        this.startBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = true;
                this.targetPower = 1.0;
                this.startBtn.y(btnY + 2);
            }
        });
        this.startBtn.on("mouseup mouseleave", () => this.startBtn.y(btnY));

        this.stopBtn = new Konva.Circle({
            x: 135, y: btnY, radius: 14,
            fill: "#871212", stroke: "#000", strokeWidth: 2,
            shadowColor: "#ff0000", cursor: 'pointer'
        });
        this.stopBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = false;
                this.targetPower = 0;
                this.stopBtn.y(btnY + 2);
            }
        });
        this.stopBtn.on("mouseup mouseleave", () => this.stopBtn.y(btnY));

        this._interactGroup.add(this.startBtn, this.stopBtn);
    }

    _updateSelectorUI() {
        const targetAngle = this.mode === "local" ? -45 : 45;
        new Konva.Tween({ node: this.knob, duration: 0.15, rotation: targetAngle }).play();
    }

    _drawHeater() {
        const centerX = this.W / 2;
        const centerY = 130;

        // 加热底座
        this._staticGroup.add(new Konva.Circle({
            x: centerX, y: centerY, radius: 55,
            fill: "#222", stroke: "#444", strokeWidth: 2
        }));

        this.coils = [];
        // 绘制 5 圈同心圆加热丝
        for (let i = 0; i < 5; i++) {
            const coil = new Konva.Circle({
                x: centerX,
                y: centerY,
                radius: 12 + i * 9,
                stroke: "#3a3a3a",
                strokeWidth: 4,
                shadowColor: "red"
            });
            this.coils.push(coil);
            this._staticGroup.add(coil);
        }
    }

    _createPorts() {
        // 复用 BaseComponent 的接口
        this.addPort(50, 0, "l", "wire");
        this.addPort(110, 0, "r", "wire");
    }

    destroy() {
        super.destroy();
    }
}