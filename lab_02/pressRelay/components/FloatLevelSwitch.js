import { BaseComponent } from './BaseComponent.js';

/**
 * 浮球式液位开关仿真组件 (Float Level Switch - On/Off)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 1. 浮球随液位升降绕支点转动。
 * 2. 浮球连杆末端的磁钢与开关壳体内的磁钢产生排斥或吸引力。
 * 3. 驱动微动开关（Micro-switch）切换接点状态（常开 NO / 常闭 NC）。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_com — 公共端
 * wire_no  — 常开端 (液位高时闭合)
 * wire_nc  — 常闭端 (液位高时断开)
 */
export class FloatLevelSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 240;
        this.height = 160;

        this.type    = 'float_level_switch';
        this.special = 'level'; // 关联液位求解器
        this.cache   = 'fixed';

        // ── 开关参数 ──
        this.triggerLevel = config.triggerLevel || 0.5; // 触发高度 (m)
        this.hysteresis   = config.hysteresis   || 0.02;  // 迟滞/死区 (m)
        this.isHigh       = false; // 当前是否处于高位触发状态

        // ── 状态 ──
        this.currentLevel = 0;
        this.angle        = 0;    // 浮球连杆旋转角度
        
        // ── 几何布局 ──
        this._pivotX = 80;        // 旋转支点 X
        this._pivotY = this.height / 2;
        this._armLen = 100;       // 连杆长度
        this._floatR = 25;        // 浮球半径

        this._init();

        // 端口设置：模拟接线盒位置
        this.addPort(20, this.height / 2 - 20, 'com', 'wire', 'COM');
        this.addPort(20, this.height / 2,      'no',  'wire', 'NO');
        this.addPort(20, this.height / 2 + 20, 'nc',  'wire', 'NC');
    }

    _init() {
        this._drawLabel();
        this._drawCasing();
        this._drawMechanism();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -20, width: this.width,
            text: '浮球液位开关 (侧装)',
            fontSize: 13, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 外部壳体（法兰与接线盒） ────────────────
    _drawCasing() {
        // 法兰盘
        const flange = new Konva.Rect({
            x: 65, y: this.height / 2 - 40,
            width: 15, height: 80,
            fill: '#78909c', stroke: '#455a64', strokeWidth: 1, cornerRadius: 2
        });

        // 接线盒本体
        const box = new Konva.Rect({
            x: 10, y: this.height / 2 - 35,
            width: 55, height: 70,
            fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 1.5, cornerRadius: 4
        });

        // 内部微动开关示意
        this._contactLed = new Konva.Circle({
            x: 40, y: this.height / 2,
            radius: 5, fill: '#ef5350', stroke: '#b71c1c', strokeWidth: 1
        });

        this.group.add(flange, box, this._contactLed);
    }

    // ── 机械结构（连杆与浮球） ──────────────────
    _drawMechanism() {
        this._mechGroup = new Konva.Group({ x: this._pivotX, y: this._pivotY });

        // 连杆
        this._arm = new Konva.Line({
            points: [0, 0, this._armLen, 0],
            stroke: '#90a4ae', strokeWidth: 6, lineCap: 'round'
        });

        // 浮球 (不锈钢材质感)
        this._float = new Konva.Circle({
            x: this._armLen, y: 0,
            radius: this._floatR,
            fillLinearGradientStartPoint: { x: -15, y: -15 },
            fillLinearGradientEndPoint: { x: 15, y: 15 },
            fillLinearGradientColorStops: [0, '#eceff1', 0.5, '#b0bec5', 1, '#78909c'],
            stroke: '#546e7a', strokeWidth: 1
        });

        // 支点销钉
        const bolt = new Konva.Circle({
            x: 0, y: 0, radius: 4, fill: '#37474f'
        });

        this._mechGroup.add(this._arm, this._float, bolt);
        this.group.add(this._mechGroup);
    }

    // ── 动画与逻辑刷新 ────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updateLogic();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updateLogic() {
        // 带迟滞的开关逻辑
        if (!this.isHigh && this.currentLevel > (this.triggerLevel + this.hysteresis)) {
            this.isHigh = true;
            this.onTrigger?.(true); // 触发外部回调
        } else if (this.isHigh && this.currentLevel < (this.triggerLevel - this.hysteresis)) {
            this.isHigh = false;
            this.onTrigger?.(false);
        }

        // 角度计算：模拟浮球在水面的浮动 (限制在 ±25度)
        const diff = this.currentLevel - this.triggerLevel;
        const targetAngle = Math.max(-25, Math.min(25, -diff * 100)); 
        this.angle += (targetAngle - this.angle) * 0.1; // 平滑过渡
    }

    _updateVisuals() {
        // 更新连杆旋转
        this._mechGroup.rotation(this.angle);

        // 更新指示灯：红色代表释放，绿色代表触发
        this._contactLed.fill(this.isHigh ? '#66bb6a' : '#ef5350');
        this._contactLed.stroke(this.isHigh ? '#2e7d32' : '#b71c1c');

        // 更新缓存状态
        this._refreshCache();
    }

    // ── 外部求解器接口 ────────────────────────
    update(press, flow, level) {
        this.currentLevel = level || 0;
    }

    /**
     * 获取拓扑连接状态（供电路求解器使用）
     * 只有当 isHigh 为 true 时，COM-NO 连通；否则 COM-NC 连通
     */
    getInternalConnections() {
        return this.isHigh 
            ? [{ from: 'com', to: 'no' }] 
            : [{ from: 'com', to: 'nc' }];
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '动作液位 (m)', key: 'triggerLevel', type: 'number' },
            { label: '回差/迟滞 (m)', key: 'hysteresis', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.id = cfg.id || this.id;
        this.triggerLevel = parseFloat(cfg.triggerLevel) || this.triggerLevel;
        this.hysteresis = parseFloat(cfg.hysteresis) || this.hysteresis;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}