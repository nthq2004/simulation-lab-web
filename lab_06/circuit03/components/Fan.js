import { BaseComponent } from "./BaseComponent.js";

/**
 * CoolingFan - 风扇组件（视觉 + 简单控制逻辑）
 *
 * 说明：
 * - 此组件绘制一个带控制面板的风扇，包括本地/远程模式、启动/停止按钮与转速可视化。
 * - 控制模式：`local`（本地面板控制）或 `remote`（外部 PWM/信号控制）。
 * - 变量说明：
 *     - `mode`: 控制模式，"local" 或 "remote"。
 *     - `running`: 运行开关（布尔）。
 *     - `power`: 当前实际转速（0-1），受惯性影响平滑变化。
 *     - `targetPower`: 目标转速（0-1），在 `remote` 模式由外部输入设定，`local` 模式由按钮直接控制。
 * - 动画与惯性：`_updateElectricalState` 模拟电机的加速/减速惯性，`_renderVisuals` 根据 `power` 更新旋转与视觉效果。
 *
 * 注意：此组件为教学/演示用途的视觉控件，不做真实电机热/电流仿真。
 */

export class CoolingFan extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 标准尺寸
        this.cache = 'fixed';
        this._initGroups();
        this.W = 160;
        this.H = 200;

        // ===== 核心状态 =====
        // 控制模式：'local'（面板控制）或 'remote'（外部 PWM/信号）
        this.mode = "local";
        // 运行开关（布尔），true 表示正在运行
        this.running = false;
        // 当前实际转速（0-1），由惯性/摩擦模型平滑到目标转速
        this.power = 0;
        // 目标转速（0-1）：remote 模式下由外部传入，local 模式由面板按钮直接设置
        this.targetPower = 0;

        // ===== 初始化绘制 =====
        this._drawShell();
        this._drawPowerInput();
        this._drawTopPanel();
        this._drawFan();
        this._createPorts();
    }

    /**
     * 核心受控更新函数
     * @param {number} pwm - 远程模式下的输入转速 (0-1)
     * @param {number} dt - 主程序传入的两帧间隔时间 (秒)
     */
    update(pwm) {
        // 主要更新逻辑（外部调用或系统调度）
        // 参数说明：pwm（0-1）仅在 remote 模式有效，用于设置目标转速
        // 1. 模式处理：remote 模式下把外部 pwm 限幅到 [0,1] 并设置运行标志
        if (this.mode === "remote") {
            this.targetPower = Math.max(0, Math.min(1, pwm || 0));
            // 小于阈值视为停止（避免死区噪声触发）
            this.running = this.targetPower > 0.05;
        } else {
            // local 模式：targetPower 由按钮事件设置（startBtn/stopBtn 回调中处理）
        }
    }

    /**
     * 集中化 tick 动画（20fps）
     * 原始 setInterval 周期 500ms，使用累加器保持原定时
     */
    tick(dt) {
        // 累加器使 tick 保持原始的 500ms 周期（约 2fps）；这里传入累加区间给状态更新
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.5) return;
        this._tickAcc = 0;
        this._updateElectricalState(0.5);

        // 仅在需要时刷新缓存/重绘
        this._refreshCache();
    }

    _updateElectricalState(dt) {
        // 模拟电机惯性：根据目标与当前值插值（简单一阶线性滞后）
        // lerpSpeed 在加速时大一些（更快到达目标），减速时较小以模拟摩擦
        const lerpSpeed = this.targetPower > this.power ? 3.0 : 1.0;
        this.power += (this.targetPower - this.power) * lerpSpeed * dt;

        // 数值边界修正，避免漂移
        if (this.power < 0.001) this.power = 0;
        if (this.power > 0.999) this.power = 1;

        // 根据当前 power 执行视觉更新（旋转、叶片透明度、按钮光效等）
        this._renderVisuals(dt);
    }

    /**
     * 视觉刷新逻辑
     * @param {number} dt - 时间增量，用于计算旋转角度
     */
    _renderVisuals(dt) {
        // A. 计算叶片旋转量：power=1 对应每秒 maxRotationSpeed 度
        const maxRotationSpeed = 100;
        const rotationAmount = this.power * maxRotationSpeed * dt;
        this.fanGroup.rotate(rotationAmount);

        // B. 视觉模糊/残影：转速越高叶片越透明以模拟模糊感
        this.fanGroup.opacity(Math.max(0.5, 1 - this.power * 0.4));

        // C. 控制面板反馈：根据运行状态改变按钮填充色与阴影，增强可视性
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
        this._staticGroup.add(new Konva.Rect({
            width: this.W,
            height: 60,
            fill: "#cfcfcf",
            stroke: "#333",
            strokeWidth: 1,
            cornerRadius: { topLeft: 4, topRight: 4 }
        }));

        const selectorGroup = new Konva.Group({ x: 35, y: 32 });
        selectorGroup.add(new Konva.Text({ x: -22, y: -24, text: "LOC", fontSize: 9, fontStyle: 'bold' }));
        selectorGroup.add(new Konva.Text({ x: 8, y: -24, text: "REM", fontSize: 9, fontStyle: 'bold' }));

        this.knob = new Konva.Group({ cursor: 'pointer' });
        this.knob.add(new Konva.Circle({
            radius: 14,
            fillLinearGradientColorStops: [0, '#666', 1, '#111'],
            stroke: "#000", strokeWidth: 1
        }));
        this.knob.add(new Konva.Rect({ x: -2, y: -14, width: 4, height: 14, fill: "#fff", cornerRadius: 1 }));

        this.knob.rotation(this.mode === "local" ? -45 : 45);

        this.knob.on("click", () => {
            this.mode = this.mode === "local" ? "remote" : "local";
            this.targetPower = 0;
            this.running = false;
            this._updateSelectorUI();
        });
        selectorGroup.add(this.knob);
        this._staticGroup.add(selectorGroup);

        const btnY = 32;
        this.startBtn = new Konva.Circle({
            x: 95, y: btnY, radius: 14,
            fill: "#0a810a", stroke: "#000", strokeWidth: 2,
            shadowColor: "#00ff00", cursor: 'pointer'
        });
        this.startBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = true;
                this.targetPower = 1.0; // 本地控制转速为 1
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

    _drawFan() {
        const centerX = this.W / 2;
        const centerY = 130;

        // 保护网罩
        this._staticGroup.add(new Konva.Circle({
            x: centerX, y: centerY, radius: 55,
            stroke: "#bbb", strokeWidth: 1, dash: [4, 4]
        }));

        this.fanGroup = new Konva.Group({ x: centerX, y: centerY });

        // 3 片叶子
        for (let i = 0; i < 3; i++) {
            this.fanGroup.add(new Konva.Ellipse({
                radiusX: 12, radiusY: 30,
                fill: "#222", stroke: "#000", strokeWidth: 1,
                rotation: i * 120,
                offsetY: 26,
                opacity: 0.9
            }));
        }

        // 中心轴
        this.fanGroup.add(new Konva.Circle({
            radius: 10,
            fillRadialGradientEndRadius: 10,
            fillRadialGradientColorStops: [0, '#eee', 0.4, '#888', 1, '#333']
        }));

        this._staticGroup.add(this.fanGroup);
    }

    _createPorts() {
        this.addPort(50, 0, "l", "wire");
        this.addPort(110, 0, "r", "wire");
    }

    destroy() {
        super.destroy();
    }
}