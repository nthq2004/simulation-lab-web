import { BaseComponent } from './BaseComponent.js';

/**
 * SolenoidValve — 电磁阀组件（线圈 + 截止阀）
 *
 * 视觉（参照 IEC 符号）：
 * - 左侧：线圈矩形框，上下各引出一段短导线，导线末端为电气端口（a=上 / b=下）；
 * - 线圈与阀体之间用虚线（机械联动）连接；
 * - 右侧：截止阀画得较大（上下两个三角形，尖对尖），上下各引出一段短管路，
 *   管路末端为 pipe 端口（pipe_u=上口 / pipe_d=下口）。
 *
 * 电气行为：
 * - 线圈内阻 500Ω，串联在电路中恒为 500Ω 电阻；
 * - 线圈电流 > 30mA 时电磁阀吸合导通（isOpen = true）；
 * - 电流 < 20mA 时截止（迟滞，避免临界抖动）；
 * - 导通时两个三角形阀体填充蓝色，且上下管路口连通（PneumaticSolver 处理）。
 *
 * 求解器接入：
 * - CircuitSolver._buildDeviceCache → svDevs（type==='solenoid_valve'）；
 * - DeviceStamps.stampSolenoidValves 填充 500Ω 电阻并用上次迭代解计算线圈电流，
 *   调用 dev._updateStateByCurrent(I) 完成吸合/释放判断。
 */
export class SolenoidValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(140, config.width || 160);
        this.height = Math.max(120, config.height || 140);

        this.type = 'solenoid_valve';
        this.cache = 'fixed';
        this.scale = config.scale || 2;

        // 参数
        this.coilResistance = 500;   // 线圈内阻 Ω
        this.onCurrent = 0.030;      // 吸合电流 A
        this.offCurrent = 0.020;     // 释放电流 A

        // 运行状态
        this.isOpen = false;         // 阀是否导通
        this.coilCurrent = 0;        // 线圈电流 A

        this._initGroups();
        this._initParameters(config);
        this.initVisuals();
        this.initPorts();

        this.config = { id: this.id, coilResistance: this.coilResistance };
    }

    _initParameters(config) {
        if (config.coilResistance !== undefined) this.coilResistance = config.coilResistance;
    }

    initPorts() {
        const s = this.scale;
        // 电气端口：线圈导线末端（上正 / 下负）
        this.addPort(-40 * s, -52 * s, 'a', 'wire', 'p');
        this.addPort(-40 * s, 52 * s, 'b', 'wire', 'n');
        // 管路端口：截止阀上下管路末端
        this.addPort(30 * s, -56 * s, 'pipe_u', 'pipe');
        this.addPort(30 * s, 56 * s, 'pipe_d', 'pipe');
    }

    initVisuals() {
        const s = this.scale;
        const stroke = '#000000';
        const sw = 2 * s;

        // ── 线圈 ──
        // 上导线（端口 → 线圈顶边）
        this._staticGroup.add(new Konva.Line({
            points: [-40 * s, -52 * s, -40 * s, -16 * s],
            stroke, strokeWidth: sw,
        }));
        // 下导线
        this._staticGroup.add(new Konva.Line({
            points: [-40 * s, 16 * s, -40 * s, 52 * s],
            stroke, strokeWidth: sw,
        }));
        // 线圈矩形（通电时填充红色/加粗，动态更新）
        this._coilRect = new Konva.Rect({
            x: -60 * s, y: -16 * s,
            width: 40 * s, height: 32 * s,
            fill: '#ffffff', stroke, strokeWidth: sw,
        });
        this._staticGroup.add(this._coilRect);

        // ── 机械联动虚线（线圈右侧 → 截止阀中心）──
        this._staticGroup.add(new Konva.Line({
            points: [-20 * s, 0, 30 * s, 0],
            stroke: '#888888', strokeWidth: sw, dash: [6 * s, 4 * s],
        }));

        // ── 截止阀（画大一点：上下两个三角形，尖对尖）──
        const hx = 30 * s, hw = 26 * s, hh = 34 * s;
        // 上三角（顶边在上，尖朝下）
        this._triTop = new Konva.Line({
            points: [hx - hw, -hh, hx + hw, -hh, hx, 0],
            closed: true,
            fill: '#ffffff', stroke, strokeWidth: sw,
        });
        // 下三角（底边在下，尖朝上）
        this._triBottom = new Konva.Line({
            points: [hx, 0, hx + hw, hh, hx - hw, hh],
            closed: true,
            fill: '#ffffff', stroke, strokeWidth: sw,
        });
        this._staticGroup.add(this._triTop, this._triBottom);

        // ── 管路 ──
        this._staticGroup.add(new Konva.Line({
            points: [hx, -hh, hx, -56 * s],
            stroke, strokeWidth: sw,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [hx, hh, hx, 56 * s],
            stroke, strokeWidth: sw,
        }));

        // ── 动态节点 ──
        this._stateText = new Konva.Text({
            x: -78 * s, y: 46 * s,
            text: '',
            fontSize: 12 * s,
            fontStyle: 'bold',
            listening: false,
        });
        this._dynamicGroup.add(this._stateText);
        this._lastVisOpen = null;
    }

    /** 求解器回调：按线圈电流更新吸合状态（迟滞） */
    _updateStateByCurrent(current) {
        this.coilCurrent = current;
        if (!this.isOpen && current > this.onCurrent) this.isOpen = true;
        else if (this.isOpen && current < this.offCurrent) this.isOpen = false;
        return this.isOpen;
    }

    /** 空 tick：仅当通电状态变化时刷新线圈样式与阀体填充色 */
    tick(dt) {
        if (this.isOpen !== this._lastVisOpen) {
            this._lastVisOpen = this.isOpen;
            const fill = this.isOpen ? '#2f6fd8' : '#ffffff';
            this._triTop.fill(fill);
            this._triBottom.fill(fill);
            // 线圈：吸合时外框变红变粗（3px），填充保持白色
            this._coilRect.fill('#ffffff');
            this._coilRect.stroke(this.isOpen ? '#ff2200' : '#000000');
            this._coilRect.strokeWidth(this.isOpen ? 3 : this.scale * 2);
            this._stateText.text(this.isOpen ? '吸合' : '释放');
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    /** 端子电流（A）：流入电路为正（供外部显示） */
    getTerminalCurrent(vA, vB) {
        return (vA - vB) / this.coilResistance;
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '线圈内阻 (Ω)', key: 'coilResistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.config = cfg;
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.coilResistance !== undefined) this.coilResistance = Number(cfg.coilResistance) || 500;
    }

    destroy() {
        super.destroy?.();
    }
}
