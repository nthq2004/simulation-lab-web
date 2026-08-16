import { BaseComponent } from './BaseComponent.js';

/**
 * 感温包驱动温度开关仿真组件 (Capillary Temperature Switch)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 感温包受热 -> 内部介质压力升高 -> 压力通过毛细管传至波纹管 -> 
 * 波纹管伸长推动杠杆 -> 克服设定弹簧力 -> 触发微动开关。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_com — 继电器公共端
 * wire_no  — 继电器常开端 (高于设定温度时闭合)
 * wire_nc  — 继电器常闭端 (高于设定温度时断开)
 */
export class CapillaryTempSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 300;
        this.height = 200;

        this.type = 'temp_switch';
        this.special = 'temperature'; // 关联温度求解器
        this.cache = 'fixed';

        // ── 温控参数 ──
        this.setPoint = config.setPoint || 60;   // 设定值 (℃)
        this.deadBand = config.deadBand || 5;    // 死区/回差 (℃)
        this.maxTemp  = config.maxTemp  || 120;  // 满量程参考 (℃)

        // ── 状态 ──
        this.currentTemp = 25;   // 实时温度
        this.isTriggered = false; // 触点状态
        this.bellowsPos  = 0;    // 波纹管伸长位移 (0-1)

        // ── 几何布局 ──
        this._boxX = 20;
        this._boxY = 40;
        this._boxW = 120;
        this._boxH = 100;
        
        this._bulbX = 240;
        this._bulbY = 120;
        this._bulbR = 12;

        this._init();

        // 端口设置：位于接线盒右侧
        this.addPort(this._boxX + this._boxW, this._boxY + 20, 'com', 'wire', 'COM');
        this.addPort(this._boxX + this._boxW, this._boxY + 50, 'no',  'wire', 'NO');
        this.addPort(this._boxX + this._boxW, this._boxY + 80, 'nc',  'wire', 'NC');
    }

    _init() {
        this._drawLabel();
        this._drawBulbAndCapillary(); // 绘制感温包和毛细管
        this._drawControllerBox();    // 绘制温控器主体
        this._drawMechanism();        // 绘制内部波纹管机构
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 0, width: this.width,
            text: '压力式温度开关 (感温包驱动)',
            fontSize: 13, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 感温包与毛细管 ────────────────────────
    _drawBulbAndCapillary() {
        // 1. 毛细管 (蛇形曲线)
        this._capillary = new Konva.Line({
            points: [
                this._boxX + 20, this._boxY + this._boxH,
                this._boxX + 20, this._boxY + this._boxH + 30,
                240, this._boxY + this._boxH + 30,
                240, this._bulbY
            ],
            stroke: '#b08d57', // 铜色
            strokeWidth: 3,
            lineCap: 'round',
            lineJoin: 'round',
            tension: 0.5
        });

        // 2. 感温包 (探头)
        const bulb = new Konva.Rect({
            x: this._bulbX - 8, y: this._bulbY,
            width: 16, height: 60,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 16, y: 0 },
            fillLinearGradientColorStops: [0, '#8d6e63', 0.5, '#d7ccc8', 1, '#5d4037'],
            stroke: '#4e342e', strokeWidth: 1, cornerRadius: 4
        });

        this.group.add(this._capillary, bulb);
    }

    // ── 温控器控制盒 ──────────────────────────
    _drawControllerBox() {
        const casing = new Konva.Rect({
            x: this._boxX, y: this._boxY,
            width: this._boxW, height: this._boxH,
            fill: '#eceff1', stroke: '#455a64', strokeWidth: 2, cornerRadius: 5
        });

        // 设定值调节旋钮
        const knob = new Konva.Circle({
            x: this._boxX + this._boxW / 2, y: this._boxY + 30,
            radius: 15, fill: '#cfd8dc', stroke: '#546e7a'
        });
        
        const pointer = new Konva.Line({
            points: [0, 0, 0, -12], stroke: '#d32f2f', strokeWidth: 2,
            x: this._boxX + this._boxW / 2, y: this._boxY + 30
        });

        this._setLabel = new Konva.Text({
            x: this._boxX, y: this._boxY + 50, width: this._boxW,
            text: `SET: ${this.setPoint}℃`, fontSize: 10, fill: '#37474f', align: 'center'
        });

        this.group.add(casing, knob, pointer, this._setLabel);
    }

    // ── 内部波纹管与杠杆机构 ──────────────────
    _drawMechanism() {
        this._mechGroup = new Konva.Group({ x: this._boxX + 20, y: this._boxY + this._boxH - 10 });

        // 1. 波纹管 (简化为矩形堆叠)
        this._bellows = new Konva.Group();
        for(let i=0; i<4; i++) {
            this._bellows.add(new Konva.Rect({
                x: -10, y: -i*6, width: 20, height: 5,
                fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 0.5, cornerRadius: 1
            }));
        }

        // 2. 触点指示器
        this._contactLed = new Konva.Circle({
            x: 80, y: -40, radius: 5, fill: '#ef5350', stroke: '#b71c1c'
        });

        this._mechGroup.add(this._bellows, this._contactLed);
        this.group.add(this._mechGroup);
    }

    // ── 仿真循环 ──────────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updateLogic();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updateLogic() {
        // 1. 滞回/死区逻辑
        if (!this.isTriggered && this.currentTemp > this.setPoint) {
            this.isTriggered = true;
        } else if (this.isTriggered && this.currentTemp < (this.setPoint - this.deadBand)) {
            this.isTriggered = false;
        }

        // 2. 计算波纹管物理位移 (模拟压力膨胀)
        const targetPos = Math.min(1.5, this.currentTemp / this.maxTemp);
        this.bellowsPos += (targetPos - this.bellowsPos) * 0.1;
    }

    _updateVisuals() {
        // 1. 波纹管伸缩动画：通过缩放 Y 轴模拟压力
        this._bellows.scaleY(1 + this.bellowsPos * 0.5);
        this._bellows.y(-this.bellowsPos * 5);

        // 2. 状态灯
        this._contactLed.fill(this.isTriggered ? '#66bb6a' : '#ef5350');
        this._contactLed.stroke(this.isTriggered ? '#2e7d32' : '#b71c1c');

        // 3. 标签更新
        this._setLabel.text(`SET: ${this.setPoint}℃\nPV: ${this.currentTemp.toFixed(1)}℃`);

        this._refreshCache();
    }

    // ── 外部求解器接口 ────────────────────────
    /**
     * @param {number} temp 来自过程环境的实时温度
     */
    update(temp) {
        if (typeof temp === 'number') {
            this.currentTemp = temp;
        }
    }

    /**
     * 电路映射
     */
    getInternalConnections() {
        return this.isTriggered 
            ? [{ from: 'com', to: 'no' }] 
            : [{ from: 'com', to: 'nc' }];
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '设定温度 (℃)', key: 'setPoint', type: 'number' },
            { label: '回差 (℃)', key: 'deadBand', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.id = cfg.id || this.id;
        this.setPoint = parseFloat(cfg.setPoint) || this.setPoint;
        this.deadBand = parseFloat(cfg.deadBand) || this.deadBand;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}