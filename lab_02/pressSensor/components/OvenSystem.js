import { BaseComponent } from './BaseComponent.js';

/**
 * OvenSystem —— 集成烘箱组件 v2
 *
 * 布局：
 *   整体尺寸约为原始方案的 2/3，W=375, H=300
 *   顶部均分三列：[PT100(原尺寸)] [Fan(缩放)] [Heater(缩放)]
 *   全部 6 个外部接线端从顶边引出
 *
 * 外部接线端（top edge，左→右）：
 *   pt100_l  pt100_r  |  fan_l  fan_r  |  heater_l  heater_r
 */
export class OvenSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 整体箱体尺寸（原 560×420 的 2/3）─────────────────
        this.W = config.W || 375;
        this.H = config.H || 300;
        this.title = config.title || '烘箱系统';
        this.type = 'resistor';
        this.special = 'oven';
        this.cache = 'fixed';
        this.ambientT = 20;
        this.temp = this.ambientT;
        this.sensorTemp = this.ambientT; // 传感器读数，初始等于环境温度
        this.tempBuffer = []; // 用于模拟测温延迟的温度缓冲队列
        this.currentResistance = 107.7;

        // 三列等宽，各列宽 = W/3 = 125
        this.COL_W = Math.floor(this.W / 3);   // 125

        // Fan / Heater 缩放比（原 160×200 → 放入 COL_W-10 内）
        // 目标宽 = 115，原宽 160 → scale ≈ 0.72
        this._subScale = (this.COL_W - 10) / 160;  // ≈ 0.72

        this._drawShell();
        this._embedPT100();
        this._drawLCD();
        this._embedFan();
        this._embedHeater();
        this._drawExternalPorts();

        this._phyicalTimer = setInterval(() => this.update(), 100); // 100ms 更新一次物理状态

        // 定时器，500ms 更新一次状态
        this._UITimer = setInterval(() => this._tick(), 500);
    }

    // ═══════════════════════════════════════════════════════════
    // 1. 外壳（无分隔线）
    // ═══════════════════════════════════════════════════════════
    _drawShell() {
        this.group.add(new Konva.Rect({
            x: 0, y: 0,
            width: this.W, height: this.H,
            fill: '#f4f0e6',
            stroke: '#444', strokeWidth: 3,
            cornerRadius: 8,
            shadowColor: '#000', shadowBlur: 10, shadowOpacity: 0.18
        }));

        // 内衬虚线框
        this.group.add(new Konva.Rect({
            x: 6, y: 6,
            width: this.W - 12, height: this.H - 12,
            fill: 'transparent',
            stroke: '#ccc', strokeWidth: 1,
            cornerRadius: 5, dash: [5, 4]
        }));

        // 底部标题
        this.group.add(new Konva.Text({
            x: 0, y: this.H - 20,
            width: this.W,
            text: this.title,
            fontSize: 18, fontStyle: 'bold',
            fill: '#555', align: 'center'
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 2. PT100 — 忠实复刻 PT100.js 原始外观，放在第 0 列
    //    原始坐标系：探棒折线水平展开，rotate(90) 后竖向
    //    这里直接用竖向坐标画，不旋转，置于列中央
    // ═══════════════════════════════════════════════════════════
    _embedPT100() {
        const cx = this.COL_W / 2 - 45; // 列中心 x = 62.5
        const cy = 38;     // y 平移量（让顶端线头落在 y≈28）

        const rawPts = [-10, 20, 10, 20, 20, 10, 30, 30, 40, 10, 50, 30, 60, 10, 70, 20, 90, 20];
        const g = new Konva.Group({ x: 25, y: 20 }); // 整体下移，为顶部接线端留空间

        // 探棒折线（仿电阻波形）
        const probe = new Konva.Line({
            points: rawPts,
            stroke: '#2c3e50', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const leftLead = new Konva.Line({
            points: [-10, 20, -10, -10],
            stroke: '#f10000', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const leftUp = new Konva.Line({
            points: [-10, -10, 18, -10],
            stroke: '#f10000', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const rightLead = new Konva.Line({
            points: [90, 20, 90, -10],
            stroke: '#2c3e50', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const rightUp = new Konva.Line({
            points: [90, -10, 58, -10],
            stroke: '#020000', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });

        // PT100 标签
        const label = new Konva.Text({
            x: cx, y: cy,
            width: 56, text: 'PT100',
            fontSize: 13, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center'
        });

        g.add(probe, leftLead, leftUp, rightLead, rightUp, label);
        this.group.add(g);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. LCD 温度显示（PT100 列下半部分）
    // ═══════════════════════════════════════════════════════════
    _drawLCD() {
        const cx = this.COL_W / 2;
        const lw = 88, lh = 52;
        const lx = cx - lw / 2;
        const ly = this.H / 2 - 60;

        // 外壳
        this.group.add(new Konva.Rect({
            x: lx - 4, y: ly - 4, width: lw + 8, height: lh + 8,
            fill: '#222', stroke: '#111', strokeWidth: 2, cornerRadius: 5
        }));
        // LCD 背板（深绿）
        this.group.add(new Konva.Rect({
            x: lx, y: ly, width: lw, height: lh,
            fill: '#1a3a1a', stroke: '#0d2e0d', strokeWidth: 1, cornerRadius: 2
        }));
        // 标签
        this.group.add(new Konva.Text({
            x: lx, y: ly, width: lw,
            text: '温度', fontSize: 12, fill: '#4db84d',
            align: 'center', fontFamily: 'monospace'
        }));
        // 主温度数字
        this._lcdTemp = new Konva.Text({
            x: lx, y: ly + 16, width: lw,
            text: '---.-',
            fontSize: 17, fontStyle: 'bold', fill: '#39ff39',
            align: 'center', fontFamily: 'monospace'
        });
        // 底部阻值
        this._lcdUnit = new Konva.Text({
            x: lx, y: ly + 40, width: lw,
            text: '°C',
            fontSize: 12, fill: '#2db32d',
            align: 'center', fontFamily: 'monospace'
        });
        this.group.add(this._lcdTemp, this._lcdUnit);
    }

    // ═══════════════════════════════════════════════════════════
    // 4. Fan — 缩放后放入第 1 列
    // ═══════════════════════════════════════════════════════════
    _embedFan() {
        const s = this._subScale;            // ≈ 0.72
        const ox = this.COL_W * 2 + 3;
        const oy = 10;


        this._fan = { mode: 'local', running: false, power: 0, targetPower: 0 };

        const g = new Konva.Group({ x: ox, y: oy, scaleX: s, scaleY: s });
        const W = 160, H = 200; // 原始尺寸坐标系（在 g 内部）

        // 外壳
        g.add(new Konva.Rect({
            width: W, height: H,
            stroke: '#333', strokeWidth: 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: H },
            fillLinearGradientColorStops: [0, '#e8e8e8', 1, '#bcbcbc'],
            cornerRadius: 4, shadowBlur: 6, shadowOpacity: 0.15
        }));

        // 顶部面板
        g.add(new Konva.Rect({
            width: W, height: 60, fill: '#cfcfcf',
            stroke: '#333', strokeWidth: 1,
            cornerRadius: 4
        }));

        // LOC / REM 文字
        const selG = new Konva.Group({ x: 35, y: 32 });
        selG.add(new Konva.Text({ x: -22, y: -28, text: 'LOC', fontSize: 11, fontStyle: 'bold' }));
        selG.add(new Konva.Text({ x: 8, y: -28, text: 'REM', fontSize: 11, fontStyle: 'bold' }));

        // 旋钮
        this._fanKnob = new Konva.Group({ cursor: 'pointer' });
        this._fanKnob.add(new Konva.Circle({
            radius: 16,
            fillLinearGradientColorStops: [0, '#666', 1, '#111'],
            stroke: '#000', strokeWidth: 1
        }));
        this._fanKnob.add(new Konva.Rect({ x: -2, y: -14, width: 4, height: 14, fill: '#fff', cornerRadius: 1 }));
        this._fanKnob.rotation(-45);
        this._fanKnob.on('click', () => {
            this._fan.mode = this._fan.mode === 'local' ? 'remote' : 'local';
            this._fan.targetPower = 0; this._fan.running = false;
            this._fanKnob.rotation(this._fan.mode === 'local' ? -45 : 45);
            this._refreshCache(); // 模式切换时强制刷新缓存，确保按钮状态更新
        });
        selG.add(this._fanKnob);
        g.add(selG);

        // 启/停按钮
        const btnY = 32;
        this._fanStartBtn = new Konva.Circle({ x: 95, y: btnY, radius: 16, fill: '#0a810a', stroke: '#000', strokeWidth: 2, shadowColor: '#00ff00', cursor: 'pointer' });
        this._fanStartBtn.on('mousedown', () => {
            if (this._fan.mode === 'local') {
                this._fan.running = true;
                this._fan.targetPower = 1;
                this._fanStartBtn.y(btnY + 2);
            }
        });
        this._fanStartBtn.on('mouseup mouseleave', () => {
            this._fanStartBtn.y(btnY);
        });

        this._fanStopBtn = new Konva.Circle({ x: 135, y: btnY, radius: 16, fill: '#871212', stroke: '#000', strokeWidth: 2, shadowColor: '#ff0000', cursor: 'pointer' });
        this._fanStopBtn.on('mousedown', () => {
            if (this._fan.mode === 'local') {
                this._fan.running = false;
                this._fan.targetPower = 0;
                this._fanStopBtn.y(btnY + 2);
            }
        });
        this._fanStopBtn.on('mouseup mouseleave', () => {
            this._fanStopBtn.y(btnY);
        });

        g.add(this._fanStartBtn, this._fanStopBtn);

        // 风扇
        const cx = W / 2, cy = 126;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: 55, stroke: '#bbb', strokeWidth: 1, dash: [4, 4] }));
        this._fanGroup = new Konva.Group({ x: cx, y: cy });
        for (let i = 0; i < 3; i++) {
            this._fanGroup.add(new Konva.Ellipse({ radiusX: 12, radiusY: 30, fill: '#222', stroke: '#000', strokeWidth: 1, rotation: i * 120, offsetY: 26, opacity: 0.9 }));
        }
        this._fanGroup.add(new Konva.Circle({ radius: 10, fillRadialGradientEndRadius: 10, fillRadialGradientColorStops: [0, '#eee', 0.4, '#888', 1, '#333'] }));
        g.add(this._fanGroup);

        // 标签
        g.add(new Konva.Text({ x: 0, y: H - 16, width: W, text: '冷却风机', fontSize: 15, fill: '#0d09fc', align: 'center' }));

        this.group.add(g);
        this._fanInnerW = W; // 原始坐标系宽，用于计算接线端口 x
        this._fanOx = ox; this._fanS = s;
    }

    // ═══════════════════════════════════════════════════════════
    // 5. Heater — 缩放后放入第 2 列
    // ═══════════════════════════════════════════════════════════
    _embedHeater() {
        const s = this._subScale;
        const ox = this.COL_W + 5;            // 列起始 x
        const oy = 10;                        // 顶部留给接线端

        this._heater = { mode: 'local', running: false, power: 0, targetPower: 0 };

        const g = new Konva.Group({ x: ox, y: oy, scaleX: s, scaleY: s });
        const W = 160, H = 200;

        g.add(new Konva.Rect({
            width: W, height: H, stroke: '#333', strokeWidth: 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: H },
            fillLinearGradientColorStops: [0, '#e8e8e8', 1, '#bcbcbc'],
            cornerRadius: 4, shadowBlur: 6, shadowOpacity: 0.15
        }));

        g.add(new Konva.Rect({
            width: W, height: 60, fill: '#cfcfcf',
            stroke: '#333', strokeWidth: 1,
            cornerRadius: 4
        }));

        const selG = new Konva.Group({ x: 35, y: 32 });
        selG.add(new Konva.Text({ x: -22, y: -28, text: 'LOC', fontSize: 11, fontStyle: 'bold' }));
        selG.add(new Konva.Text({ x: 8, y: -28, text: 'REM', fontSize: 11, fontStyle: 'bold' }));

        this._heaterKnob = new Konva.Group({ cursor: 'pointer' });
        this._heaterKnob.add(new Konva.Circle({ radius: 16, fillLinearGradientColorStops: [0, '#666', 1, '#111'], stroke: '#000', strokeWidth: 1 }));
        this._heaterKnob.add(new Konva.Rect({ x: -2, y: -14, width: 4, height: 14, fill: '#fff', cornerRadius: 1 }));
        this._heaterKnob.rotation(-45);
        this._heaterKnob.on('click', () => {
            this._heater.mode = this._heater.mode === 'local' ? 'remote' : 'local';
            this._heater.targetPower = 0; this._heater.running = false;
            this._heaterKnob.rotation(this._heater.mode === 'local' ? -45 : 45);
            this._refreshCache(); // 模式切换时强制刷新缓存，确保按钮状态更新            
        });
        selG.add(this._heaterKnob);
        g.add(selG);

        const btnY = 32;
        this._heaterStartBtn = new Konva.Circle({ x: 95, y: btnY, radius: 16, fill: '#0a810a', stroke: '#000', strokeWidth: 2, shadowColor: '#00ff00', cursor: 'pointer' });
        this._heaterStartBtn.on('mousedown', () => {
            if (this._heater.mode === 'local') {
                this._heater.running = true;
                this._heater.targetPower = 1;
                this._heaterStartBtn.y(btnY + 2);
            }
        });
        this._heaterStartBtn.on('mouseup mouseleave', () => {
            this._heaterStartBtn.y(btnY);
        });

        this._heaterStopBtn = new Konva.Circle({ x: 135, y: btnY, radius: 16, fill: '#871212', stroke: '#000', strokeWidth: 2, shadowColor: '#ff0000', cursor: 'pointer' });
        this._heaterStopBtn.on('mousedown', () => {
            if (this._heater.mode === 'local') {
                this._heater.running = false;
                this._heater.targetPower = 0;
                this._heaterStopBtn.y(btnY + 2);
            }
        });
        this._heaterStopBtn.on('mouseup mouseleave', () => {
            this._heaterStopBtn.y(btnY);
        });

        g.add(this._heaterStartBtn, this._heaterStopBtn);

        const cx = W / 2, cy = 122;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: 55, fill: '#222', stroke: '#444', strokeWidth: 2 }));

        this._heaterCoils = [];
        for (let i = 0; i < 5; i++) {
            // 不设置 shadowColor，彻底避免 GPU shadow 渲染开销
            const coil = new Konva.Circle({
                x: cx, y: cy, radius: 12 + i * 9, stroke: '#3a3a3a', strokeWidth: 4
            });
            this._heaterCoils.push(coil);
            g.add(coil);
        }

        g.add(new Konva.Text({ x: 0, y: H - 16, width: W, text: '加热器', fontSize: 15, fill: '#f00e0e', align: 'center' }));

        this.group.add(g);
        this._heaterOx = ox; this._heaterS = s;
    }


    // ═══════════════════════════════════════════════════════════
    // 6. 外部接线端 —— 全部在顶边 y=0
    //
    //  列 0 (PT100) : pt100_l @ x=cx-8,  pt100_r @ x=cx+8
    //  列 1 (Fan)   : fan_l   @ x=fanCx-10, fan_r @ x=fanCx+10
    //  列 2 (Heater): heater_l@ x=htrCx-10, heater_r@ x=htrCx+10
    //  cx 均为各列在 group 坐标系中的中心 x
    // ═══════════════════════════════════════════════════════════
    _drawExternalPorts() {
        const s = this._subScale;

        // PT100 列中心
        const pt100cx = this.COL_W / 2;
        // Fan 列中心（缩放后器件中心 x = ox + W/2 * s）
        const fanCx = this._fanOx + (this._fanInnerW / 2) * s;
        // Heater 列中心
        const htrCx = this._heaterOx + (160 / 2) * s;

        const portY = 0; // 顶边

        // ── PT100 ─────────────────────────────────────────────
        this._addTopPort(pt100cx - 20, portY, 'l', 'p');
        this._addTopPort(pt100cx + 20, portY, 'r');

        // ── Fan ───────────────────────────────────────────────
        this._addTopPort(fanCx - 20, portY, 'fanl', 'p');
        this._addTopPort(fanCx + 20, portY, 'fanr');

        // ── Heater ────────────────────────────────────────────
        this._addTopPort(htrCx - 20, portY, 'heaterl', 'p');
        this._addTopPort(htrCx + 20, portY, 'heaterr');
    }

    _addTopPort(x, y, portId, polority = 'n') {
        // 引线：从器件顶部到接线端
        this.group.add(new Konva.Line({
            points: [x, y + 10, x, y],
            stroke: '#666', strokeWidth: 1.5
        }));

        // 接线端底座（小正方形）
        this.group.add(new Konva.Rect({
            x: x - 7, y: y - 14,
            width: 14, height: 14,
            fill: '#ddd6c0', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2
        }));

        // 注册到 BaseComponent（提供连线能力）
        this.addPort(x, y - 7, portId, 'wire', polority);
    }
    // ═══════════════════════════════════════════════════════════
    // 统一 tick（500ms）
    // ═══════════════════════════════════════════════════════════
    _tick() {
        const dt = 0.5;

        // ── Fan 惯性平滑 ──────────────────────────────────────
        const f = this._fan;
        const ls = f.targetPower > f.power ? 0.8 : 0.5;
        f.power += (f.targetPower - f.power) * ls * dt;
        if (f.power < 0.01) f.power = 0;
        if (f.power > 0.99) f.power = 1;
        // 按钮和指示环：仅在 running 状态改变时更新
        if (f.running !== f._prevRunning) {
            f._prevRunning = f.running;
            this._fanStartBtn.fill(f.running ? '#00ff00' : '#0da30d');
            this._fanStopBtn.fill(!f.running ? '#ff0000' : '#9a0f0f');
        }

        // ── Heater 惯性平滑 ───────────────────────────────────
        const h = this._heater;
        const inertia = h.targetPower > h.power ? 0.6 : 0.3;
        h.power += (h.targetPower - h.power) * inertia * dt;
        if (h.power < 0.01) h.power = 0;
        if (h.power > 0.99) h.power = 1;

        // 加热丝颜色：脏检测，仅颜色变化时才批量写入
        const r = Math.floor(58 + (255 - 58) * h.power);
        const g2 = h.power > 0.7 ? Math.floor((h.power - 0.7) * 400) : 0;
        const color = `rgb(${r},${Math.min(220, g2)},0)`;
        if (color !== h._prevColor) {
            h._prevColor = color;
            for (let i = 0; i < this._heaterCoils.length; i++) {
                this._heaterCoils[i].stroke(color);
            }
        }

        // 按钮：仅 running 状态改变时更新
        if (h.running !== h._prevRunning) {
            h._prevRunning = h.running;
            this._heaterStartBtn.fill(h.running ? '#00ff00' : '#0da30d');
            this._heaterStopBtn.fill(!h.running ? '#ff0000' : '#9a0f0f');
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════
    update() {
        const dt = 0.1; // 物理更新步长固定为 100ms
        if (this._fan.mode === 'remote') {
            this._fan.targetPower = this.sys.isPortConnected(`${this.id}_wire_fanl`, `${this.id}_wire_fanr`) ? 1 : 0;
            this._fan.running = this._fan.targetPower === 1;
        }
        if (this._heater.mode === 'remote') {
            this._heater.targetPower = this.sys.isPortConnected(`${this.id}_wire_heaterl`, `${this.id}_wire_heaterr`) ? 1 : 0;
            this._heater.running = this._heater.targetPower === 1;
        }
        //1. 温度物理模型：加热产生热量，风扇和被动散热带走热量，温度随热量变化
        const heatGen = this._heater.power * 10; // 加热功率，0~5
        const activeCool = Math.max(0, this._fan.power * (this.temp - this.ambientT))*0.4; // 风扇散热，0~(temp-ambientT)，与温差成正比
        const passiveCool = Math.max(0, this.temp - this.ambientT) * 0.002; // 被动散热，温差越大散热越快
        const coreInertia = 10; // 核心温度惯性，数值越大温度变化越慢
        const coolGen = activeCool + passiveCool; // 总散热
        const netHeat = heatGen - coolGen;
        this.temp += netHeat * dt / coreInertia; // 温度更新
        // 2. 模拟 PT100 测温延迟：用一个长度为 delaySteps 的数组做缓冲，每次更新时存入当前温度，取出 delaySteps 步前的温度作为传感器读数
        const delaySteps = 20; // 20 步 × 100ms = 2s 延迟
        // 存入队列
        this.tempBuffer.push(this.temp);
        // 防止无限增长
        if (this.tempBuffer.length > delaySteps) {
            var delayedTemp = this.tempBuffer.shift();
        } else {
            var delayedTemp = this.temp;
        }
        //3. 传感器读数平滑：传感器读数逐渐趋近于 delayedTemp，模拟测温系统的惯性响应
        const sensorTau = 3; // 时间常数（越大越慢）
        this.sensorTemp += (delayedTemp - this.sensorTemp) * dt / sensorTau;

        this.updatePT100Resistance();
        if (this._fan.power > 0.1) this._fanGroup.rotate(this._fan.power * 400 * dt);
        this._lcdTemp.text(this.sensorTemp.toFixed(1));
        // console.log(`Temp: ${this.temp.toFixed(1)}°C, Sensor: ${this.sensorTemp.toFixed(1)}°C, Heater: ${(this._heater.power * 100).toFixed(0)}%, Fan: ${(this._fan.power * 100).toFixed(0)}%`);
        this._refreshCache(); // 强制刷新缓存，确保显示更新        
    }

    updatePT100Resistance() {
        if (this._pt100Fault === 'open') this.currentResistance = 1e9;
        if (this._pt100Fault === 'short') this.currentResistance = 0;
        this.currentResistance = 100 + 0.3851 * this.sensorTemp;
    }

    destroy() {
        if (this._fanTimer) clearInterval(this._fanTimer);
        if (this._heaterTimer) clearInterval(this._heaterTimer);
    }
}

export default OvenSystem;