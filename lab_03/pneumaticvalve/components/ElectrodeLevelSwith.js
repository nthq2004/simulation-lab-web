import { BaseComponent } from './BaseComponent.js';

/**
 * 电极式液位开关仿真组件 (Electrode Level Switch)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 利用液体的导电性质。当导电液体接触电极时，电极间形成微弱电流。
 * 电子转换器检测此电流并驱动继电器触点。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_com — 继电器公共端
 * wire_no  — 继电器常开端
 * wire_nc  — 继电器常闭端
 */
export class ElectrodeLevelSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 220;
        this.height = 420;

        this.type    = 'electrode_level_switch';
        this.special = 'level';
        this.cache   = 'fixed';

        // ── 电极参数 (单位: m) ──
        this.e1_high = config.e1_high || 0.8; // 高位报警电极 (最长电极通常为参考极)
        this.e2_low  = config.e2_low  || 0.4; // 低位报警电极
        this.e3_ref  = config.e3_ref  || 1.0; // 参考/接地电极 (始终最长)
        
        // ── 状态 ──
        this.currentLevel = 0;
        this.isE1_contact = false;
        this.isE2_contact = false;
        this.relayState   = false; // 内部继电器状态

        // ── 几何布局 ──
        this._headW = 90;
        this._headH = 70;
        this._headX = (this.width - this._headW) / 2;
        this._headY = 40;

        this._rodGap = 20;
        this._maxRodH = this.height - this._headY - this._headH - 40;

        this._init();

        // 端口：模拟控制器接线
        this.addPort(this._headX, this._headY + 20, 'com', 'wire', 'COM');
        this.addPort(this._headX, this._headY + 40, 'no',  'wire', 'NO');
        this.addPort(this._headX, this._headY + 60, 'nc',  'wire', 'NC');
    }

    _init() {
        this._drawLabel();
        this._drawMounting();
        this._drawElectrodes();
        this._drawHead();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 0, width: this.width,
            text: '电极式液位开关',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 安装法兰/底座 ──────────────────────────
    _drawMounting() {
        const base = new Konva.Rect({
            x: this.width / 2 - 50, y: this._headY + this._headH,
            width: 100, height: 12,
            fill: '#78909c', stroke: '#455a64', strokeWidth: 1, cornerRadius: 2
        });
        this.group.add(base);
    }

    // ── 电极棒 ────────────────────────────────
    _drawElectrodes() {
        this._rodGroup = new Konva.Group();
        const startY = this._headY + this._headH + 12;
        const centerX = this.width / 2;

        const createRod = (id, offset, length, label) => {
            const h = (length / 1.0) * this._maxRodH; // 比例映射
            const rod = new Konva.Rect({
                x: centerX + offset - 4, y: startY,
                width: 8, height: h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 8, y: 0 },
                fillLinearGradientColorStops: [0, '#b0bec5', 0.5, '#eceff1', 1, '#90a4ae'],
                stroke: '#546e7a', strokeWidth: 0.5, cornerRadius: [0, 0, 2, 2]
            });

            const lbl = new Konva.Text({
                x: centerX + offset - 10, y: startY - 25,
                text: label, fontSize: 10, fill: '#607d8b', fontStyle: 'bold'
            });

            // 浸没高亮层 (当接触水时变蓝)
            const waterOverlay = new Konva.Rect({
                x: centerX + offset - 4, y: startY,
                width: 8, height: 0,
                fill: 'rgba(0, 184, 212, 0.4)',
                visible: false
            });

            this._rodGroup.add(rod, lbl, waterOverlay);
            return { rod, waterOverlay, length };
        };

        this.rods = {
            E1: createRod('E1', -this._rodGap, this.e1_high, 'E1'),
            E2: createRod('E2', 0,            this.e2_low,  'E2'),
            E3: createRod('E3', this._rodGap,  this.e3_ref,  'E3')
        };

        this.group.add(this._rodGroup);
    }

    // ── 电子控制头 ────────────────────────────
    _drawHead() {
        const head = new Konva.Rect({
            x: this._headX, y: this._headY,
            width: this._headW, height: this._headH,
            fill: '#37474f', stroke: '#263238', strokeWidth: 2, cornerRadius: 5
        });

        // 状态指示灯
        this._ledE1 = new Konva.Circle({ x: this._headX + 20, y: this._headY + 20, radius: 4, fill: '#1a2634', stroke: '#000' });
        this._ledE2 = new Konva.Circle({ x: this._headX + 20, y: this._headY + 35, radius: 4, fill: '#1a2634', stroke: '#000' });
        this._ledRelay = new Konva.Rect({ x: this._headX + 50, y: this._headY + 15, width: 25, height: 10, fill: '#1a2634', cornerRadius: 2 });

        const txtStyle = { fontSize: 8, fill: '#90a4ae', fontFamily: 'Arial' };
        this.group.add(
            head, 
            this._ledE1, new Konva.Text({ ...txtStyle, x: this._headX + 28, y: this._headY + 17, text: 'HIGH' }),
            this._ledE2, new Konva.Text({ ...txtStyle, x: this._headX + 28, y: this._headY + 32, text: 'LOW' }),
            this._ledRelay, new Konva.Text({ ...txtStyle, x: this._headX + 50, y: this._headY + 28, text: 'RELAY' })
        );
    }

    // ── 仿真循环 ──────────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updatePhysics();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updatePhysics() {
        // 检测各电极是否接触水面 (假设 0m 是底部，1m 是最高)
        this.isE1_contact = this.currentLevel >= (1.0 - this.e1_high);
        this.isE2_contact = this.currentLevel >= (1.0 - this.e2_low);
        const isE3_contact = this.currentLevel >= (1.0 - this.e3_ref);

        // 逻辑判断：只有 E3 (参考极) 接通时，E1/E2 才有效
        const activeE1 = this.isE1_contact && isE3_contact;
        const activeE2 = this.isE2_contact && isE3_contact;

        // 模拟典型的双位控制逻辑（如下排水控制）：
        // 到达高位(E1)继电器吸合，直到低于低位(E2)继电器才释放
        if (activeE1) {
            this.relayState = true;
        } else if (!activeE2) {
            this.relayState = false;
        }
    }

    _updateVisuals() {
        const startY = this._headY + this._headH + 12;

        // 更新电极浸没视觉效果
        Object.keys(this.rods).forEach(key => {
            const r = this.rods[key];
            const rodBottom = startY + (r.length / 1.0) * this._maxRodH;
            // 假设液位线在全局 Y 轴上表现
            // 这里简化为：根据接触状态显示覆盖层
            const isContact = key === 'E1' ? this.isE1_contact : (key === 'E2' ? this.isE2_contact : true);
            
            if (isContact) {
                r.waterOverlay.visible(true);
                // 覆盖层长度取决于液位淹没深度
                const submergedH = Math.max(0, (this.currentLevel - (1.0 - r.length)) * this._maxRodH);
                r.waterOverlay.height(submergedH);
                r.waterOverlay.y(rodBottom - submergedH);
            } else {
                r.waterOverlay.visible(false);
            }
        });

        // 更新指示灯
        this._ledE1.fill(this.isE1_contact ? '#00e5ff' : '#1a2634');
        this._ledE2.fill(this.isE2_contact ? '#00e5ff' : '#1a2634');
        this._ledRelay.fill(this.relayState ? '#66bb6a' : '#1a2634');

        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    update(press, flow, level) {
        // level 输入范围通常为 0.0 ~ 1.0
        this.currentLevel = level || 0;
    }

    getInternalConnections() {
        // 根据继电器状态返回导通路径
        return this.relayState 
            ? [{ from: 'com', to: 'no' }] 
            : [{ from: 'com', to: 'nc' }];
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: 'E1 高位长度 (0-1)', key: 'e1_high', type: 'number' },
            { label: 'E2 低位长度 (0-1)', key: 'e2_low',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.e1_high = parseFloat(cfg.e1_high) || this.e1_high;
        this.e2_low  = parseFloat(cfg.e2_low)  || this.e2_low;
        this._init(); // 重新绘图
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}