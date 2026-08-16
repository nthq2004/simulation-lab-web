import { BaseComponent } from './BaseComponent.js';

/**
 * 差压式流量变送器（孔板/节流原理）
 *
 * 物理原理：
 *   伯努利方程 + 连续性方程 → Q = Cd · A₂ · √(2·ΔP / ρ·(1-β⁴))
 *   简化为: Q = K · √(ΔP)，K 为仪表系数（由量程和节流比决定）
 *
 * 端口：
 *   pipe_h  — 高压取压口（节流件上游）
 *   pipe_l  — 低压取压口（节流件下游）
 *   wire_p  — 电源正极 24VDC
 *   wire_n  — 电源负极 / 4-20mA 输出
 *
 * 与气路求解器集成：
 *   special = 'diff'  → 求解器自动计算 device.press = P_h - P_l
 *   update(deltaP) 被求解器调用，完成流量计算→电流输出→LCD 刷新
 */
export class DiffPressFlowTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, Math.min(config.width  || 180, 220));
        this.height = Math.max(200, Math.min(config.height || 220, 260));

        // ── 类型标识（与气路求解器约定）──
        this.type    = 'dp_flow_transmitter';
        this.special = 'diff';   // 告知求解器注入差压值
        this.cache   = 'fixed';

        // ── 量程参数 ──
        this.minFlow    = 0;                          // 流量下限 (m³/h)
        this.maxFlow    = config.maxFlow    || 100;   // 流量上限 (m³/h)
        this.maxDeltaP  = config.maxDeltaP  || 0.1;  // 满量程差压 (MPa)
        this.unit       = config.unit       || 'm³/h';
        this.betaRatio  = config.betaRatio  || 0.65;  // 孔板节流比 d/D

        // ── 零点/量程微调（旋钮驱动）──
        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        // ── 运行状态 ──
        this.press      = 0;    // 当前差压 (MPa)，由求解器注入
        this.flow       = 0;    // 计算得到的瞬时流量
        this.outCurrent = 4;    // 4-20mA 输出电流
        this.isBreak    = false;
        this.powered    = false;

        this.config = {
            id: this.id, maxFlow: this.maxFlow,
            maxDeltaP: this.maxDeltaP, unit: this.unit, betaRatio: this.betaRatio,
        };

        this.knobs = {};
        this._init();

        // 端口布局：H/L 压口在底部两侧，电气接线在顶部右侧
        const cx = this.width / 2;
        this.addPort(cx - 28, this.height,      'h', 'pipe', 'H');  // 高压口
        this.addPort(cx + 28, this.height,      'l', 'pipe', 'L');  // 低压口
        this.addPort(this.width, 22,            'p', 'wire', 'P');  // 电源+
        this.addPort(this.width, 48,            'n', 'wire', 'N');  // 4-20mA
    }

    // ═══════════════════════════════════════
    //  绘制入口
    // ═══════════════════════════════════════
    _init() {
        this._drawEnclosure();
        this._drawSensor();
        this._drawLCD();
        this._drawKnobs();
        this._drawPipeTaps();
    }

    // ── 外壳主体 ──────────────────────────
    _drawEnclosure() {
        const W = this.width, cx = W / 2;

        // 标签
        this._labelText = new Konva.Text({
            x: 0, y: -20, width: W,
            text: '差压流量变送器',
            fontSize: 14, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center',
        });

        // 接线盒（顶部矩形）
        const jbox = new Konva.Rect({
            x: 16, y: 8, width: W - 32, height: 50,
            fill: '#ecf0f1', stroke: '#95a5a6', strokeWidth: 1, cornerRadius: 4,
        });
        // 接线盒左右封盖
        const lcap = new Konva.Rect({ x: 0,    y: 12, width: 16, height: 40, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1, cornerRadius: 2 });
        const rcap = new Konva.Rect({ x: W-16, y: 12, width: 16, height: 40, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1, cornerRadius: 2 });

        // 主传感器圆筒（深蓝灰色，工业感）
        const capsuleY = 62;
        this._capsuleY = capsuleY;
        const outerBody = new Konva.Rect({
            x: 12, y: capsuleY, width: W - 24, height: 100,
            fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 6,
        });
        // 传感器体高光线
        const sheen = new Konva.Rect({
            x: 14, y: capsuleY + 2, width: 6, height: 96,
            fill: 'rgba(255,255,255,0.07)', cornerRadius: 3,
        });
        // 铭牌区（白色哑光贴纸）
        this._nameplate = new Konva.Rect({
            x: cx - 42, y: capsuleY + 14, width: 84, height: 32,
            fill: '#f8f9fa', stroke: '#dee2e6', strokeWidth: 0.5, cornerRadius: 2,
        });
        this._tagText = new Konva.Text({
            x: cx - 40, y: capsuleY + 18,
            width: 80, text: this.id || 'FT-001',
            fontSize: 10, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        });
        this._typeText = new Konva.Text({
            x: cx - 40, y: capsuleY + 30,
            width: 80, text: '4~20mA  HART',
            fontSize: 9, fill: '#7f8c8d', align: 'center',
        });

        // 底部膜盒（差压测量腔，两个对称鼓包）
        const memY = capsuleY + 100;
        this._memY = memY;
        const memBox = new Konva.Rect({
            x: 8, y: memY, width: W - 16, height: 58,
            fill: '#34495e', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: [0, 0, 6, 6],
        });
        // 高压腔标记
        const hLabel = new Konva.Text({ x: 14,     y: memY + 6, text: 'H', fontSize: 10, fontStyle: 'bold', fill: '#e74c3c' });
        const lLabel = new Konva.Text({ x: W - 22, y: memY + 6, text: 'L', fontSize: 10, fontStyle: 'bold', fill: '#3498db' });

        // 膜盒分隔线
        const divider = new Konva.Line({
            points: [cx, memY + 2, cx, memY + 56],
            stroke: '#1a252f', strokeWidth: 1, dash: [3, 2],
        });

        // 膜片（敏感元件，椭圆形）
        this._diaphragm = new Konva.Ellipse({
            x: cx, y: memY + 30,
            radiusX: 18, radiusY: 22,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1,
        });

        this.group.add(
            this._labelText, jbox, lcap, rcap,
            outerBody, sheen,
            this._nameplate, this._tagText, this._typeText,
            memBox, hLabel, lLabel, divider, this._diaphragm,
        );
    }

    // ── 传感器模组（圆形视窗 + LCD）──────
    _drawSensor() {
        const cx = this.width / 2;
        const viewY = this._capsuleY + 55;   // 圆形视窗中心 Y

        // 外圈金属环
        const outerRing = new Konva.Circle({
            x: cx, y: viewY, radius: 42,
            fill: '#1a252f', stroke: '#0d1b2a', strokeWidth: 1,
        });
        // 防滑纹（模拟工业旋盖滚花）
        const gripRing = new Konva.Circle({
            x: cx, y: viewY, radius: 40,
            fill: '#2c3e50', stroke: '#3d566e', strokeWidth: 3,
        });
        // 视窗玻璃底色
        this._lcdBg = new Konva.Circle({
            x: cx, y: viewY, radius: 32,
            fill: '#000d1a',
        });

        this._viewY = viewY;
        this.group.add(outerRing, gripRing, this._lcdBg);
    }

    // ── LCD 显示层 ────────────────────────
    _drawLCD() {
        const cx = this.width / 2;
        const vy = this._viewY;

        // 主数值
        this._lcdMain = new Konva.Text({
            x: cx - 32, y: vy - 16,
            width: 64, text: '',
            fontSize: 17,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: '#00e676', align: 'center',
        });

        // 单位
        this._lcdUnit = new Konva.Text({
            x: cx - 24, y: vy + 6,
            width: 48, text: '',
            fontSize: 10, fill: '#80cbc4', align: 'center',
            opacity: 0,
        });

        // 差压小字（右下角）
        this._lcdDp = new Konva.Text({
            x: cx - 30, y: vy + 18,
            width: 60, text: '',
            fontSize: 9, fill: '#546e7a', align: 'center',
            opacity: 0,
        });

        // 电流输出小字
        this._lcdmA = new Konva.Text({
            x: cx - 30, y: vy - 28,
            width: 60, text: '',
            fontSize: 9, fill: '#b0bec5', align: 'center',
            opacity: 0,
        });

        this.group.add(this._lcdMain, this._lcdUnit, this._lcdDp, this._lcdmA);
    }

    // ── 零点/量程旋钮（与 PressTransmitter 一致）──
    _drawKnobs() {
        const knobDefs = [
            { id: 'zero', x: 36,             label: 'Z', title: '零点' },
            { id: 'span', x: this.width - 36, label: 'S', title: '量程' },
        ];

        knobDefs.forEach(k => {
            const g = new Konva.Group({ x: k.x, y: 33 });
            const base  = new Konva.Circle({ radius: 12, fill: '#dfe4ea', stroke: '#747d8c', strokeWidth: 1 });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 9, fill: '#ecf0f1', stroke: '#2f3542', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0, -8, 0, 8], stroke: '#2f3542', strokeWidth: 2.5, lineCap: 'round' }));
            const lbl = new Konva.Text({ x: -5, y: 14, text: k.label, fontSize: 10, fontStyle: 'bold', fill: '#636e72' });

            g.add(base, rotor, lbl);
            this.knobs[k.id] = rotor;

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.05;
                    else                 this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.3;
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup',   onUp);
                    window.removeEventListener('touchend',  onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup',   onUp);
                window.addEventListener('touchend',  onUp);
            });
            this.group.add(g);
        });
    }

    // ── 底部取压管接头 ────────────────────
    _drawPipeTaps() {
        const cx = this.width / 2;
        const tapY = this._memY + 56;

        // 高压接头（左）
        const hTap = new Konva.Group({ x: cx - 28, y: tapY });
        hTap.add(
            new Konva.Rect({ x: -8, y: 0, width: 16, height: 18, fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 1, cornerRadius: 2 }),
            new Konva.Rect({ x: -5, y: 18, width: 10, height: 8,  fill: '#c0392b', stroke: '#922b21', strokeWidth: 0.5 }),
            new Konva.Text({ x: -6, y: 3, text: 'H', fontSize: 10, fontStyle: 'bold', fill: '#fff' }),
        );

        // 低压接头（右）
        const lTap = new Konva.Group({ x: cx + 28, y: tapY });
        lTap.add(
            new Konva.Rect({ x: -8, y: 0, width: 16, height: 18, fill: '#3498db', stroke: '#2980b9', strokeWidth: 1, cornerRadius: 2 }),
            new Konva.Rect({ x: -5, y: 18, width: 10, height: 8,  fill: '#2980b9', stroke: '#1a6fa3', strokeWidth: 0.5 }),
            new Konva.Text({ x: -6, y: 3, text: 'L', fontSize: 10, fontStyle: 'bold', fill: '#fff' }),
        );

        this.group.add(hTap, lTap);
    }

    // ═══════════════════════════════════════
    //  核心物理计算
    // ═══════════════════════════════════════
    /**
     * 差压→流量：基于平方根关系（孔板/喷嘴/文丘里管通用）
     *   Q = Qmax · √(ΔP / ΔPmax)
     * 含零点/量程微调
     */
    _calcFlow(deltaP) {
        if (deltaP <= 0 || this.maxDeltaP <= 0) return 0;
        const dpNorm = Math.min(1, deltaP / this.maxDeltaP);
        const flowRaw = this.maxFlow * Math.sqrt(dpNorm);
        return Math.max(0, (flowRaw + this.zeroAdj * this.maxFlow) * this.spanAdj);
    }

    /**
     * 流量→4-20mA 电流
     */
    _flowToCurrent(flow) {
        const ratio = Math.max(0, Math.min(1, (flow - this.minFlow) / (this.maxFlow - this.minFlow)));
        return 4 + ratio * 16;
    }

    // ═══════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════
    /**
     * 由气路求解器调用
     * special='diff' 时求解器注入 device.press = P_h - P_l，然后调用 update()
     * @param {number} deltaP  高低压差 (MPa)
     */
    update(deltaP) {
        this.press = typeof deltaP === 'number' ? deltaP : (this.press || 0);

        // 断电/故障处理
        if (this.isBreak || !this.powered) {
            this._renderOff();
            this._refreshCache();
            return;
        }

        const dp = Math.max(0, this.press);
        this.flow       = this._calcFlow(dp);
        this.outCurrent = this._flowToCurrent(this.flow);

        this._renderNormal(dp);
        this._refreshCache();
    }

    // ═══════════════════════════════════════
    //  显示渲染
    // ═══════════════════════════════════════
    _renderOff() {
        this._lcdBg.fill('#000d1a');
        this._lcdMain.text('');
        this._lcdUnit.opacity(0);
        this._lcdDp.opacity(0);
        this._lcdmA.opacity(0);
        this._diaphragm.fill('#95a5a6');
    }

    _renderNormal(dp) {
        const current   = this.outCurrent;
        const flowDisp  = this.flow;
        const precision = this.unit === 'm³/h' ? 2 : 3;

        // 膜片偏移动画：差压越大，椭圆越扁（模拟膜片变形）
        const deform = Math.min(0.4, dp / this.maxDeltaP * 0.4);
        this._diaphragm.radiusX(18 + deform * 20);
        this._diaphragm.radiusY(22 - deform * 12);
        this._diaphragm.fill(dp > 0 ? '#b0bec5' : '#95a5a6');

        let displayText, isFault = false;
        if (current < 3.8) {
            displayText = 'LLLL'; isFault = true;
        } else if (current > 20.5) {
            displayText = 'HHHH'; isFault = true;
        } else {
            displayText = flowDisp.toFixed(precision);
        }

        if (isFault) {
            this._lcdBg.fill('#1a0505');
            this._lcdMain.fill('#e74c3c');
            this._lcdMain.text(displayText);
            this._lcdUnit.opacity(0);
            this._lcdDp.opacity(0);
            this._lcdmA.opacity(0);
        } else {
            // 颜色随流量百分比变化：低流量青色→正常绿色→高流量橙色
            const ratio = flowDisp / this.maxFlow;
            let mainColor;
            if      (ratio < 0.1)  mainColor = '#00bcd4';
            else if (ratio < 0.85) mainColor = '#00e676';
            else                   mainColor = '#ff9800';

            this._lcdBg.fill('#000d1a');
            this._lcdMain.fill(mainColor);
            this._lcdMain.text(displayText);

            this._lcdUnit.text(this.unit);
            this._lcdUnit.opacity(1);

            this._lcdDp.text(`ΔP ${(dp * 1000).toFixed(1)} kPa`);
            this._lcdDp.opacity(1);

            this._lcdmA.text(`${current.toFixed(2)} mA`);
            this._lcdmA.opacity(1);
        }
    }

    // ═══════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'id',        type: 'text'   },
            { label: '满量程流量',              key: 'maxFlow',   type: 'number' },
            { label: '满量程差压 (MPa)',        key: 'maxDeltaP', type: 'number' },
            { label: '节流比 β (0.3~0.75)',     key: 'betaRatio', type: 'number' },
            {
                label: '流量单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'm³/h',  value: 'm³/h'  },
                    { label: 'Nm³/h', value: 'Nm³/h' },
                    { label: 'kg/h',  value: 'kg/h'  },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id         = newConfig.id         || this.id;
        this.maxFlow    = parseFloat(newConfig.maxFlow)    || this.maxFlow;
        this.maxDeltaP  = parseFloat(newConfig.maxDeltaP)  || this.maxDeltaP;
        this.betaRatio  = parseFloat(newConfig.betaRatio)  || this.betaRatio;
        this.unit       = newConfig.unit       || this.unit;
        this.config     = { ...this.config, ...newConfig };

        // 同步铭牌显示
        if (this._tagText)  this._tagText.text(this.id);
        this._refreshCache();
    }
}