import { BaseComponent } from './BaseComponent.js';

/**
 * WaterBath — 恒温水浴 (Water Bath) 可视化组件
 *
 * 说明：
 * - 模拟带控制面板的恒温水浴，包含加热盘管与液位显示，用于教学演示温度控制与响应；
 * - 内部状态：`currentTemp`、`targetTemp`、`isHeating`、`waterLevel`，并在 `tick` 中做近似物理更新；
 * - 视觉使用 Konva 绘制，静态元素启用缓存以提升渲染性能。
 *
 * 注：仅添加文档注释，不改变原有逻辑。
 */
export class WaterBath extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.scale = 1.0;
        this.W = 260 * this.scale; // 稍微加宽以容纳左侧面板
        this.H = 180 * this.scale;

        // 核心物理状态
        this.ambientTemp = 20;
        this.currentTemp = 20;
        // 设定温度可由布局配置给出（20~100 ℃），默认 50 ℃
        this.targetTemp = (config && typeof config.targetTemp === 'number')
            ? Math.min(100, Math.max(20, config.targetTemp)) : 50;
        this.isHeating = false;
        this.waterLevel = 0.75;
        this.type = 'thermostat';
        this.cache = 'fixed';

        this._initGroups();
        this._drawChamber();       // 绘制外壳与水
        this._drawSpiralHeater();  // 绘制圆形盘管加热器
        this._drawLeftPanel();     // 绘制左侧控制面板
        this._registerParts();     // 注册可识别/可点击部件（旋钮、电源开关、LCD、水槽）
    }

    // ═══════════════════════════════════════════════════════
    // 可点击部件（自动演示"箭头指到部件 → 模拟点击"用）
    // 温度设定旋钮是方向性部件：左半区 -5 ℃、右半区 +5 ℃，
    // 必须拆成两个独立热区（合成点击没有指针位置，无法判断左右半）。
    // ═══════════════════════════════════════════════════════
    _registerParts() {
        const inc = this.addClickablePart('knob-inc', 40, 76, 18, 36);   // 旋钮右半区：升温
        if (inc) {
            inc.on('click tap', () => this._onKnobClick(+5));
            this._bindKnobDrag(inc);
        }

        const dec = this.addClickablePart('knob-dec', 22, 76, 18, 36);   // 旋钮左半区：降温
        if (dec) {
            dec.on('click tap', () => this._onKnobClick(-5));
            this._bindKnobDrag(dec);
        }

        const sw = this.addClickablePart('power', 25, 140, 30, 20);      // 加热电源开关
        if (sw) sw.on('click tap', () => this.toggle());

        this.addClickablePart('lcd', 10, 15, 60, 30);                    // 温度显示
        this.addClickablePart('water', 80, 50, 170, 120);                // 恒温水槽（探头插入区）
    }

    /** 点击旋钮半区：步进 ±5℃（刚拖动过则不重复步进） */
    _onKnobClick(dir) {
        if (this._knobDragged) { this._knobDragged = false; return; }
        this.adjustTargetTemp(dir);
    }

    /**
     * 旋钮拖拽调温（上下拖动改变设定值），绑定到热区节点上。
     * 由于热区覆盖了旋钮本体，旋钮本体的 mousedown 被热区挡住，故热区也要能拖动。
     */
    _bindKnobDrag(node) {
        if (!node) return;
        node.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const evt = e.evt || {};
            const startY = (evt.clientY != null) ? evt.clientY
                : (evt.touches && evt.touches[0] ? evt.touches[0].clientY : null);
            if (startY == null) return;
            this._knobDragged = false;
            const startTemp = this.targetTemp;
            const handleMove = (ev) => {
                const curY = (ev.clientY != null) ? ev.clientY
                    : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : null);
                if (curY == null) return;
                if (Math.abs(curY - startY) > 2) this._knobDragged = true;
                this.setTargetTemp(startTemp + (startY - curY) * 0.5);
            };
            const handleUp = () => {
                window.removeEventListener('mousemove', handleMove);
                window.removeEventListener('mouseup', handleUp);
            };
            window.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleUp);
        });
    }

    /** 设定目标温度（20~100 ℃），并同步旋钮指针与设定值文字 */
    setTargetTemp(t) {
        const v = Math.min(100, Math.max(20, Number(t)));
        if (!isFinite(v)) return;
        this.targetTemp = v;
        if (this.knobGroup) this.knobGroup.rotation((v - 20) / 80 * 270 - 135);
        if (this.setDisplay) this.setDisplay.text(`设定温度 ${v.toFixed(0)}℃`);
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 在当前设定值上增减（旋钮左/右半区点击） */
    adjustTargetTemp(delta) {
        this.setTargetTemp(this.targetTemp + (Number(delta) || 0));
    }

    /** 直接设置加热状态（true=通电加热） */
    setHeating(on) {
        if (!!on !== !!this.isHeating) this.toggle();
    }

    /** @param {number} dt 帧间隔时间（秒） */
    tick(dt) {
        if (!this._acc) this._acc = 0;
        this._acc += dt;
        const interval = 0.5;
        if (this._acc < interval) return;
        this._acc -= interval;
        const dtSim = 0.5;
        const heatingActive = (this.isHeating && this.currentTemp < this.targetTemp);

        // 加热盘管视觉反馈（用描边粗细/颜色表达，不用 shadow 三件套）
        this.heaterWire.stroke(heatingActive ? '#ff4d4d' : '#555');
        this.heaterWire.strokeWidth(heatingActive ? 4.5 * this.scale : 3 * this.scale);

        const heatInput = heatingActive ? 1.6 : 0;
        const cooling = 0.006 * (this.currentTemp - this.ambientTemp);
        this.currentTemp += (heatInput - cooling) * dtSim;
        this.currentTemp = Math.max(this.ambientTemp, Math.min(100, this.currentTemp));

        if (this.tempDisplay) this.tempDisplay.text(this.currentTemp.toFixed(1));
        this._refreshCache();

        // PT100 耦合
        if (this.sys?.comps) {
            const waterClientRect = this.waterRect.getClientRect();

            Object.values(this.sys.comps).forEach(comp => {
                if (comp.special === 'pt100' && comp.update) {
                    const probeNode = comp.probe;
                    const probeClientRect = probeNode.getClientRect();

                    const isIntersecting = !(
                        probeClientRect.x > waterClientRect.x + waterClientRect.width ||
                        probeClientRect.x + probeClientRect.width < waterClientRect.x ||
                        probeClientRect.y > waterClientRect.y + waterClientRect.height ||
                        probeClientRect.y + probeClientRect.height < waterClientRect.y
                    );

                    comp.update(isIntersecting ? this.currentTemp : this.ambientTemp);
                }
                if (comp.type === 'tc' && comp.update) {
                    const probeNode = comp.probe;
                    const probeClientRect = probeNode.getClientRect();

                    const isIntersecting = !(
                        probeClientRect.x > waterClientRect.x + waterClientRect.width ||
                        probeClientRect.x + probeClientRect.width < waterClientRect.x ||
                        probeClientRect.y > waterClientRect.y + waterClientRect.height ||
                        probeClientRect.y + probeClientRect.height < waterClientRect.y
                    );

                    comp.update(isIntersecting ? this.currentTemp - this.ambientTemp : 0);
                }
            });
        }
    }

    destroy() {
        super.destroy?.();
    }

    /**
     * 绘制水槽主体和 3/4 水位
     */
    _drawChamber() {
        const s = this.scale;
        // 槽体
        this._staticGroup.add(new Konva.Rect({
            width: this.W, height: this.H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.W, y: this.H },
            fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#ffffff', 1, '#95a5a6'],
            stroke: '#333', strokeWidth: 2 * s, cornerRadius: 5 * s
        }));

        // 水位区域 (避开左侧面板空间)
        const waterX = 80 * s;
        const waterW = this.W - waterX - 10 * s;
        const waterHeight = (this.H - 20 * s) * this.waterLevel;

        this.waterRect = new Konva.Rect({
            x: waterX, y: this.H - waterHeight - 10 * s,
            width: waterW, height: waterHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: waterHeight },
            fillLinearGradientColorStops: [0, '#a2d9ff', 1, '#3498db'],
            cornerRadius: 2 * s,
            opacity: 0.8
        });
        this._staticGroup.add(this.waterRect);

        // 设备名称（放在槽体下方，避免探头插入后被线缆遮挡）
        this._staticGroup.add(new Konva.Text({
            x: 60 * s, y: (this.H + 8) * s, width: 200 * s,
            text: '恒温水浴（恒温槽）', fontSize: 13 * s,
            fontStyle: 'bold', fill: '#2c3e50',
        }));
    }

    /**
     * 绘制圆形盘管加热器 (位于水槽底部中心)
     */
    _drawSpiralHeater() {
        const s = this.scale;
        const startX = 90 * s;
        const endX = this.W - 20 * s;
        const baseY = this.H - 25 * s;

        // 创建波浪路径模拟加热丝
        let pathData = `M ${startX} ${baseY}`;
        for (let x = startX + 10 * s; x <= endX; x += 15 * s) {
            pathData += ` L ${x} ${baseY - 5 * s} L ${x + 7 * s} ${baseY + 5 * s}`;
        }

        this.heaterWire = new Konva.Path({
            data: pathData,
            stroke: '#555',
            strokeWidth: 3 * s,
            lineCap: 'round',
            lineJoin: 'round'
        });
        // 加热丝颜色随通断变化 → 必须放动态层（静态层只缓存一次，改了不刷新）
        this._dynamicGroup.add(this.heaterWire);
    }

    /**
     * 绘制左侧控制面板 (集成 LCD、旋钮、开关)
     */
    _drawLeftPanel() {
        const s = this.scale;
        const panel = new Konva.Group({ x: 5 * s, y: 5 * s });

        // 面板底色
        panel.add(new Konva.Rect({
            width: 70 * s, height: this.H - 10 * s,
            fill: '#ecf0f1', stroke: '#7f8c8d', cornerRadius: 3 * s
        }));

        // 1. 液晶显示屏 (顶部)
        // ... (保持你原有的 LCD 代码不变) ...
        const lcd = new Konva.Group({ x: 5 * s, y: 10 * s });
        lcd.add(new Konva.Rect({
            width: 60 * s, height: 30 * s,
            fill: '#2c3e50', stroke: '#000', cornerRadius: 2 * s
        }));
        this.tempDisplay = new Konva.Text({
            x: 0, y: 8 * s, width: 60 * s,
            text: '20.0', fontSize: 14 * s, fontStyle: 'bold',
            fill: '#00ff00', align: 'center', fontFamily: 'monospace'
        });
        lcd.add(this.tempDisplay);
        panel.add(lcd);

        // --- 2. 调温旋钮与刻度 (中间) ---
        const knobX = 35 * s;
        const knobY = 90 * s; // 稍微下移一点点给LCD留空间

        // 绘制刻度线
        const minTemp = 20;
        const maxTemp = 100;
        const startAngle = 135; // 对应 20度 (左下方)
        const sweepAngle = 270; // 总跨度
        const radiusInner = 20 * s; // 刻度线起点
        const radiusOuter = 24 * s; // 刻度线终点
        const radiusText = 30 * s;  // 文字位置

        for (let t = minTemp; t <= maxTemp; t += 10) {
            // 计算当前温度对应的角度 (弧度)
            const angleDeg = startAngle + ((t - minTemp) / (maxTemp - minTemp)) * sweepAngle;
            const angleRad = (angleDeg * Math.PI) / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);

            // 区分大刻度(带文字)和小刻度
            const isMajor = t % 20 === 0;
            const currentOuter = isMajor ? radiusOuter : (radiusOuter - 2 * s);

            // 绘制线条
            panel.add(new Konva.Line({
                points: [
                    knobX + radiusInner * cos, knobY + radiusInner * sin,
                    knobX + currentOuter * cos, knobY + currentOuter * sin
                ],
                stroke: '#7f8c8d',
                strokeWidth: isMajor ? 1.5 * s : 1 * s
            }));

            // 绘制文字标识 (20, 40, 60, 80, 100)
            if (isMajor) {
                panel.add(new Konva.Text({
                    x: knobX + radiusText * cos - 10 * s,
                    y: knobY + radiusText * sin - 5 * s,
                    width: 20 * s,
                    text: t.toString(),
                    fontSize: 8 * s,
                    align: 'center',
                    fill: '#34495e',
                    fontStyle: 'bold'
                }));
            }
        }

        const knobGroup = new Konva.Group({ x: knobX, y: knobY, cursor: 'pointer' });
        knobGroup.add(new Konva.Circle({ radius: 16 * s, fill: '#7f8c8d', stroke: '#2c3e50' }));
        const pointer = new Konva.Rect({ x: -2 * s, y: -16 * s, width: 4 * s, height: 8 * s, fill: '#e74c3c', cornerRadius: 1 });
        knobGroup.add(pointer);
        this.knobGroup = knobGroup;
        this.knobPointer = pointer;

        // 初始化旋钮角度
        knobGroup.rotation(((this.targetTemp - minTemp) / (maxTemp - minTemp)) * sweepAngle - startAngle);

        // 旋钮交互：拖动调温（热区上也绑定了同一逻辑，见 _registerParts）
        this._bindKnobDrag(knobGroup);

        panel.add(knobGroup);
        panel.add(new Konva.Text({ x: 0, y: knobY + 28 * s, width: 70 * s, text: "温度设定", fontSize: 11 * s, align: 'center', fontStyle: 'bold' }));

        // 设定值显示（SV）：放在槽体名称下方，不与旋钮、电源开关、插入的探头重叠
        this.setDisplay = new Konva.Text({
            x: 60 * s, y: (this.H + 25) * s, width: 200 * s,
            text: `设定温度 ${this.targetTemp.toFixed(0)}℃`,
            fontSize: 11 * s, fill: '#c0392b', fontStyle: 'bold',
        });
        this._dynamicGroup.add(this.setDisplay);

        // 3. 加热开关 (底部)
        const switchY = 145 * s;
        const switchGroup = new Konva.Group({ x: 35 * s, y: switchY, cursor: 'pointer' });
        switchGroup.add(new Konva.Rect({ x: -15 * s, y: -10 * s, width: 30 * s, height: 20 * s, fill: '#bdc3c7', cornerRadius: 3 * s }));
        this.switchKnob = new Konva.Circle({ x: -8 * s, radius: 7 * s, fill: '#c0392b' });
        switchGroup.add(this.switchKnob);

        switchGroup.on('click', () => {
            this.toggle();
        });

        panel.add(switchGroup);
        panel.add(new Konva.Text({ x: 0, y: switchY + 12 * s, width: 70 * s, text: "电源", fontSize: 11 * s, align: 'center', fontStyle: 'bold' }));
        this.powerSwitch = switchGroup;

        // 控制面板含 LCD 读数、旋钮指针、电源开关等动态内容 → 放动态层，
        // 否则被静态位图缓存后"温度/设定值/开关位置"不再刷新
        this._dynamicGroup.add(panel);
    }

    toggle() {
        const s = this.scale;
        this.isHeating = !this.isHeating;
        new Konva.Tween({
            node: this.switchKnob, duration: 0.1,
            x: this.isHeating ? 8 * s : -8 * s,
            fill: this.isHeating ? '#27ae60' : '#c0392b'
        }).play();
        this._refreshCache();
    }
}