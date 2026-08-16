import { BaseComponent } from './BaseComponent.js';

/**
 * 直流测速发电机仿真组件
 *（DC Tachogenerator）
 *
 * ── 工作原理 ─────────────────────────────────────────────────
 *
 *  直流测速发电机是一种将机械转速转换为电压信号的测量装置
 *  当转子旋转时，电枢切割磁感线产生感应电动势：
 *    E = Ke · ω
 *  
 *  其中：
 *    Ke —— 反电动势常数（V/(rad/s) 或 V/krpm）
 *    ω —— 机械角速度（rad/s）
 *
 *  实际输出电压还需考虑：
 *    - 电枢电阻压降：Uout = E - Ia·Ra
 *    - 负载效应：负载电流会导致输出非线性
 *    - 纹波：换向器引起的电压脉动
 *    - 温度系数：磁通量随温度变化
 *
 * ── 输出特性 ─────────────────────────────────────────────────
 *
 *  理想特性：Uout = Kt·ω（Kt 为灵敏度，单位 V/(rad/s) 或 V/rpm）
 *  
 *  实际输出：
 *    Uout = Kt·ω / (1 + Ra/RL) - ΔU_ripple
 *  
 *  其中 RL 为负载电阻，Ra 为电枢电阻
 *
 * ── 技术规格（典型 10V/krpm 测速发电机）──
 *  灵敏度       10 V/krpm（或 0.0955 V/(rad/s)）
 *  电枢电阻     50~200 Ω
 *  电枢电感     5~20 mH
 *  额定转速     0~5000 rpm
 *  线性度       0.1%~0.5%
 *  纹波         1%~3%（峰峰值）
 *  温度系数     -0.02%/°C（约为 -0.01~0.05%/°C）
 *  工作温度     -20~80°C
 *
 * ── 测速发电机与直流电机的区别 ──────────────────────────────
 *
 *  相同点：
 *    - 结构相似（永磁励磁、电枢、换向器、电刷）
 *  
 *  不同点：
 *    - 测速发电机：输出端接高阻抗负载（电压信号）
 *    - 直流电机：输出端接低阻抗负载（功率输出）
 *    - 测速发电机：要求线性度高、纹波小
 *    - 测速发电机：不需要大转矩，转动惯量小
 *    - 测速发电机：最高转速通常高于同体积电机
 *
 * ── 应用场景 ─────────────────────────────────────────────────
 *
 *  ① 伺服系统速度反馈（模拟量闭环）
 *  ② 转速显示仪表
 *  ③ 速度积分器（角位置测量）
 *  ④ 速率陀螺仪中的阻尼信号
 *  ⑤ 间接测量角加速度（微分输出）
 *
 * ── 组件功能 ─────────────────────────────────────────────────
 *
 *  ① 测速发电机纵截面图（同直流电机结构）
 *  ② 输出特性曲线（Uout vs ω）
 *  ③ 实时转速/电压表
 *  ④ 纹波电压展示
 *  ⑤ 温度影响显示
 *  ⑥ 负载效应展示
 *  ⑦ 历史波形记录（电压 vs 时间）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *
 *  shaft_in   — 输入轴（被测旋转输入）
 *  out_pos    — 输出电压正极（速度信号+）
 *  out_neg    — 输出电压负极（速度信号-）
 */
export class DCTachogenerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(500, config.width  || 560);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'dc_tachogenerator';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 测速发电机额定参数 ──
        this.sensitivity    = config.sensitivity    || 10;        // V/krpm（灵敏度）
        this.maxSpeed       = config.maxSpeed       || 5000;      // rpm
        this.maxVoltage     = (this.sensitivity * this.maxSpeed / 1000);  // V
        this.linearity      = config.linearity      || 0.2;       // %（线性度误差）
        
        // ── 电气参数 ──
        this.Ra             = config.Ra             || 100;       // Ω（电枢电阻）
        this.La             = config.La             || 10e-3;     // H（电枢电感）
        this.ripplePct      = config.ripplePct      || 2.0;       // %（纹波峰峰值百分比）
        
        // ── 负载条件 ──
        this.loadResistance = config.loadResistance || 10000;     // Ω（负载电阻，高阻输入）
        
        // ── 温度特性 ──
        this.tempCoef       = config.tempCoef       || -0.02;     // %/°C（温度系数，典型 -0.02）
        this._temp          = config.temp           || 25;        // °C（当前温度）
        
        // ── 永磁体参数 ──
        this.magnetField    = config.magnetField    || 1.0;       // 标幺值（1.0 = 额定磁通）
        
        // ── 机械参数 ──
        this.inertia        = config.inertia        || 1e-5;      // kg·m²（转子转动惯量，很小）
        this.friction       = config.friction       || 1e-6;      // N·m·s/rad（轴承摩擦）
        
        // ── 输入状态（从外部接入的转速） ──
        this._omega         = 0;           // 输入角速度（rad/s）
        this._omegaRpm      = 0;           // 输入转速（rpm）
        this._theta         = 0;           // 累计角度（rad）
        
        // ── 输出状态 ──
        this._outputVoltage = 0;           // 输出电压（V）
        this._idealVoltage  = 0;           // 理想输出电压（无负载、无纹波）
        this._rippleVoltage = 0;           // 纹波电压（V）
        this._current       = 0;           // 输出电流（μA级别）
        
        // ── 历史数据（用于波形显示）──
        this._wavLen    = 300;
        this._wavOmega  = new Float32Array(this._wavLen).fill(0);   // 转速波形
        this._wavUout   = new Float32Array(this._wavLen).fill(0);   // 输出电压波形
        this._wavUideal = new Float32Array(this._wavLen).fill(0);   // 理想电压波形
        
        // ── 控制状态 ──
        this._enabled       = true;        // 使能（模拟信号输出）
        this._manualSpeed   = 0;           // 手动模拟转速（rpm）
        this._mode          = 'external';  // 'external' 或 'manual'
        
        // ── 配置 ──
        this.config = {
            id: this.id,
            sensitivity: this.sensitivity,
            maxSpeed: this.maxSpeed,
            maxVoltage: this.maxVoltage,
            Ra: this.Ra,
            ripplePct: this.ripplePct,
        };
        
        // ── 几何布局 ──
        this._csX  = Math.round(this.width * 0.03);
        this._csY  = Math.round(this.height * 0.04);
        this._csW  = Math.round(this.width * 0.35);
        this._csH  = Math.round(this.height * 0.50);
        this._csCX = this._csX + this._csW / 2;
        this._csCY = this._csY + this._csH / 2;
        
        this._charX = this._csX + this._csW + 12;
        this._charY = this._csY;
        this._charW = this.width - this._charX - Math.round(this.width * 0.03);
        this._charH = Math.round(this.height * 0.30);
        
        this._meterX = this._charX;
        this._meterY = this._charY + this._charH + 6;
        this._meterW = this._charW;
        this._meterH = Math.round(this.height * 0.24);
        
        this._wavX   = this._csX;
        this._wavY   = this._meterY + this._meterH + 6;
        this._wavW   = this.width - this._csX * 2;
        this._wavH   = this.height - this._wavY - 12;
        
        
        this._init();
        
        // 端口
        const shaftX = this._csCX;
        const shaftY = this._csY + this._csH + 6;
        this.addPort(shaftX, shaftY, 'shaft_in', 'pipe', '转速输入轴');
        
        const outX = this._csX + this._csW + 8;
        const outY = this._csCY + 20;
        this.addPort(outX, outY, 'out_pos', 'wire', 'Uout+');
        this.addPort(outX, outY + 20, 'out_neg', 'wire', 'Uout-');
    }
    
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCrossSection();
        this._drawOutputCharacteristic();
        this._drawMeterPanel();
        this._drawWaveform();
        
    }
    
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `直流测速发电机  ${this.sensitivity}V/krpm  ${this.maxSpeed}rpm  Ra=${this.Ra}Ω  ` +
                  `纹波${this.ripplePct}%  温度系数${Math.abs(this.tempCoef).toFixed(2)}%/°C`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }
    
    // ── 测速发电机纵截面图 ──
    _drawCrossSection() {
        const { _csX: ex, _csY: ey, _csW: ew, _csH: eh, _csCX: ecx, _csCY: ecy } = this;
        
        this._staticGroup.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '直流测速发电机 纵截面图', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));
        
        // 电机壳体（小型化）
        const mLeft  = ex + Math.round(ew * 0.10);
        const mRight = ex + ew - Math.round(ew * 0.10);
        const mTop   = ey + Math.round(eh * 0.12);
        const mBot   = ey + eh - Math.round(eh * 0.12);
        const mW     = mRight - mLeft;
        const mH     = mBot - mTop;
        const mCX    = (mLeft + mRight) / 2;
        const mCY    = (mTop + mBot) / 2;
        
        this._staticGroup.add(new Konva.Rect({ x: mLeft, y: mTop, width: mW, height: mH, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 }));
        
        // 永磁定子（两对极示意）
        const poleW = 8, poleH = mH * 0.55;
        const poleY = mCY - poleH/2;
        this._staticGroup.add(new Konva.Rect({ x: mLeft+4, y: poleY, width: poleW, height: poleH, fill: '#e53935', stroke: '#b71c1c', strokeWidth: 0.8, opacity: 0.8 }));
        this._staticGroup.add(new Konva.Text({ x: mLeft+4, y: poleY+poleH/2-4, width: poleW, text: 'N', fontSize: 8, fill: '#fff', align: 'center' }));
        this._staticGroup.add(new Konva.Rect({ x: mRight-12, y: poleY, width: poleW, height: poleH, fill: '#1e88e5', stroke: '#0d47a1', strokeWidth: 0.8, opacity: 0.8 }));
        this._staticGroup.add(new Konva.Text({ x: mRight-12, y: poleY+poleH/2-4, width: poleW, text: 'S', fontSize: 8, fill: '#fff', align: 'center' }));
        
        // 电枢铁芯（小惯量）
        const rR = Math.round(mH * 0.28);
        this._rotorR = rR;
        this._staticGroup.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: rR*0.95, radiusY: rR*0.28, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        
        // 电枢绕组（示意）
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            const wx = mCX + (rR * 0.65) * Math.cos(angle);
            const wy = mCY + (rR * 0.65) * Math.sin(angle) * 0.28;
            this._staticGroup.add(new Konva.Circle({ x: wx, y: wy, radius: 3, fill: '#ffb74d', stroke: '#e65100', strokeWidth: 0.5 }));
        }
        
        // 换向器（示意）
        const commY = mBot - 8;
        const commW = 14;
        this._staticGroup.add(new Konva.Rect({ x: mCX-commW/2, y: commY-3, width: commW, height: 6, fill: '#d4a017', stroke: '#8d6e63', strokeWidth: 0.8, cornerRadius: 1 }));
        
        // 电刷（碳刷，信号输出）
        this._staticGroup.add(new Konva.Rect({ x: mCX-commW/2-6, y: commY-1.5, width: 6, height: 3, fill: '#3e2723', stroke: '#1b0f0a', strokeWidth: 0.5 }));
        this._staticGroup.add(new Konva.Rect({ x: mCX+commW/2, y: commY-1.5, width: 6, height: 3, fill: '#3e2723', stroke: '#1b0f0a', strokeWidth: 0.5 }));
        
        // 气隙
        this._staticGroup.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: rR*0.96, radiusY: rR*0.28, fill: '#06101a', stroke: '#1a3040', strokeWidth: 0.3 }));
        
        // 输出端子
        const termX = mRight + 6;
        const termY = mCY;
        this._staticGroup.add(new Konva.Circle({ x: termX, y: termY-8, radius: 4, fill: '#ef5350' }));
        this._staticGroup.add(new Konva.Text({ x: termX+4, y: termY-12, text: 'U+', fontSize: 7, fill: '#ef5350', fontStyle: 'bold' }));
        this._staticGroup.add(new Konva.Circle({ x: termX, y: termY+8, radius: 4, fill: '#90caf9' }));
        this._staticGroup.add(new Konva.Text({ x: termX+4, y: termY+4, text: 'U-', fontSize: 7, fill: '#90caf9', fontStyle: 'bold' }));
        
        // 导线
        const outX = this._csX + this._csW + 8;
        this._staticGroup.add(new Konva.Line({ points: [termX, termY-8, outX, this._csCY+20], stroke: '#ef5350', strokeWidth: 1.2, dash: [3,3] }));
        this._staticGroup.add(new Konva.Line({ points: [termX, termY+8, outX, this._csCY+40], stroke: '#90caf9', strokeWidth: 1.2, dash: [3,3] }));
        
        // 输入轴（较细）
        this._staticGroup.add(new Konva.Rect({ x: mCX-2.5, y: mBot, width: 5, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 0.8 }));
        
        this._mCX = mCX; this._mCY = mCY; this._mBot = mBot;
    }
    
    // ── 输出特性曲线（Uout vs ω）──
    _drawOutputCharacteristic() {
        const { _charX: cx, _charY: cy, _charW: cw, _charH: ch } = this;
        
        this._staticGroup.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this._staticGroup.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x: cx+4, y: cy+2, width: cw-8, text: '输出电压特性曲线 Uout = f(ω)', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
        
        const ox = cx + 35, oy = cy + ch - 18, aw = cw - 50, ah = ch - 35;
        
        // 坐标轴
        this._staticGroup.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this._staticGroup.add(new Konva.Text({ x: ox-18, y: oy-ah-3, text: 'Uout (V)', fontSize: 7, fill: '#80cbc4', rotation: -90 }));
        this._staticGroup.add(new Konva.Text({ x: ox+aw-10, y: oy+5, text: 'ω (rpm)', fontSize: 7, fill: '#80cbc4' }));
        
        // 刻度和标签
        const maxV = this.maxVoltage;
        const maxRpm = this.maxSpeed;
        for (let i = 0; i <= 4; i++) {
            const rpm = i * maxRpm / 4;
            const v = rpm * this.sensitivity / 1000;
            const x = ox + (rpm / maxRpm) * aw;
            const y = oy - (v / maxV) * ah;
            this._staticGroup.add(new Konva.Line({ points: [x, oy-2, x, oy+2], stroke: '#546e7a', strokeWidth: 0.5 }));
            if (i % 2 === 0) {
                this._staticGroup.add(new Konva.Text({ x: x-5, y: oy+3, text: `${Math.round(rpm)}`, fontSize: 6, fill: '#546e7a' }));
            }
            this._staticGroup.add(new Konva.Line({ points: [ox-2, y, ox+2, y], stroke: '#546e7a', strokeWidth: 0.5 }));
            if (i % 2 === 0) {
                this._staticGroup.add(new Konva.Text({ x: ox-20, y: y-4, text: `${v.toFixed(0)}`, fontSize: 6, fill: '#546e7a', align: 'right' }));
            }
        }
        
        // 理想特性线（直线）
        const idealPts = [];
        for (let i = 0; i <= 100; i++) {
            const rpm = (i / 100) * maxRpm;
            const v = rpm * this.sensitivity / 1000;
            const x = ox + (rpm / maxRpm) * aw;
            const y = oy - (v / maxV) * ah;
            idealPts.push(x, y);
        }
        this._idealLine = new Konva.Line({ points: idealPts, stroke: '#64b5f6', strokeWidth: 1.5, dash: [6,4] });
        this._staticGroup.add(this._idealLine);
        
        // 实际特性线（考虑负载和温度）
        this._actualLine = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 2 });
        this._staticGroup.add(this._actualLine);
        
        // 当前工作点
        this._opPoint = new Konva.Circle({ x: ox, y: oy, radius: 6, fill: '#ff7043', stroke: '#fff', strokeWidth: 1.5 });
        this._staticGroup.add(this._opPoint);
        
        // 图例
        this._staticGroup.add(new Konva.Line({ points: [cx+10, cy+25, cx+30, cy+25], stroke: '#64b5f6', strokeWidth: 1.5, dash: [6,4] }));
        this._staticGroup.add(new Konva.Text({ x: cx+33, y: cy+21, text: '理想特性', fontSize: 7, fill: '#64b5f6' }));
        this._staticGroup.add(new Konva.Line({ points: [cx+10, cy+35, cx+30, cy+35], stroke: '#ffd54f', strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Text({ x: cx+33, y: cy+31, text: '实际特性', fontSize: 7, fill: '#ffd54f' }));
        this._staticGroup.add(new Konva.Circle({ x: cx+20, y: cy+47, radius: 4, fill: '#ff7043' }));
        this._staticGroup.add(new Konva.Text({ x: cx+33, y: cy+43, text: '当前工作点', fontSize: 7, fill: '#ff7043' }));
        
        this._charOx = ox; this._charOy = oy; this._charAw = aw; this._charAh = ah;
        this._charMaxRpm = maxRpm; this._charMaxV = maxV;
    }
    
    // ── 仪表面板（转速/电压/温度/负载）──
    _drawMeterPanel() {
        const { _meterX: mx, _meterY: my, _meterW: mw, _meterH: mh } = this;
        
        this._staticGroup.add(new Konva.Rect({ x: mx, y: my, width: mw, height: mh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this._staticGroup.add(new Konva.Rect({ x: mx, y: my, width: mw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x: mx+4, y: my+2, width: mw-8, text: '测速仪表 | 实时监测', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
        
        // 大号数字仪表
        const cellW = (mw - 20) / 3;
        const cells = [
            { label: '转速', id: 'rpm', unit: 'rpm', color: '#4fc3f7', formatter: v => Math.round(v).toString() },
            { label: '输出电压', id: 'volt', unit: 'V', color: '#ef5350', formatter: v => v.toFixed(3) },
            { label: '理想电压', id: 'ideal', unit: 'V', color: '#64b5f6', formatter: v => v.toFixed(3) },
            { label: '电流', id: 'curr', unit: 'μA', color: '#80cbc4', formatter: v => (v*1e6).toFixed(1) },
            { label: '温度', id: 'temp', unit: '°C', color: '#ffa726', formatter: v => v.toFixed(0) },
            { label: '负载电阻', id: 'load', unit: 'kΩ', color: '#ffd54f', formatter: v => (v/1000).toFixed(1) },
        ];
        
        this._meterCells = {};
        cells.forEach(({ label, id, unit, color, formatter }, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = mx + 8 + col * cellW;
            const y = my + 18 + row * 52;
            
            this._staticGroup.add(new Konva.Rect({ x, y, width: cellW-6, height: 46, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 3 }));
            this._staticGroup.add(new Konva.Text({ x, y: y+4, width: cellW-6, text: label, fontSize: 8, fill: '#546e7a', align: 'center' }));
            
            const valText = new Konva.Text({
                x, y: y+14, width: cellW-6,
                text: '0', fontSize: 18, fontFamily: 'Courier New, monospace',
                fontStyle: 'bold', fill: color, align: 'center',
            });
            this._staticGroup.add(valText);
            
            this._staticGroup.add(new Konva.Text({ x, y: y+36, width: cellW-6, text: unit, fontSize: 7, fill: '#37474f', align: 'center' }));
            
            this._meterCells[id] = { text: valText, formatter };
        });
        
        // 状态指示
        const statusX = mx + mw - 80;
        const statusY = my + mh - 20;
        this._statusIndicator = new Konva.Circle({ x: statusX, y: statusY, radius: 5, fill: '#2e7d32' });
        this._statusText = new Konva.Text({ x: statusX+8, y: statusY-4, text: '信号输出中', fontSize: 7, fill: '#66bb6a' });
        this._staticGroup.add(this._statusIndicator, this._statusText);
        
        // 手动/外部选择提示
        this._modeText = new Konva.Text({ x: mx+8, y: my+mh-18, text: '模式: 外部输入', fontSize: 7, fill: '#546e7a' });
        this._staticGroup.add(this._modeText);
    }
    
    // ── 波形显示区 ──
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 40) return;
        
        this._staticGroup.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this._staticGroup.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '输出电压波形 (Uout)    转速波形 (ω)', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
        
        const ox = wx + 20, oy = wy + wh - 18, aw = ww - 40, ah = wh - 48;
        
        // 坐标轴
        this._staticGroup.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this._staticGroup.add(new Konva.Text({ x: ox-14, y: oy-ah, text: 'U(V)', fontSize: 7, fill: '#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x: ox+aw-10, y: oy+5, text: 't(s)', fontSize: 7, fill: '#80cbc4' }));
        
        // 电压波形线
        this._waveVoltage = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 1.5 });
        // 转速波形线
        this._waveSpeed = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.2 });
        
        this._staticGroup.add(this._waveVoltage, this._waveSpeed);
        
        // 图例
        this._staticGroup.add(new Konva.Line({ points: [wx+10, wy+20, wx+25, wy+20], stroke: '#ef5350', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Text({ x: wx+28, y: wy+16, text: '输出电压', fontSize: 7, fill: '#ef5350' }));
        this._staticGroup.add(new Konva.Line({ points: [wx+85, wy+20, wx+100, wy+20], stroke: '#4fc3f7', strokeWidth: 1.2 }));
        this._staticGroup.add(new Konva.Text({ x: wx+103, y: wy+16, text: '转速', fontSize: 7, fill: '#4fc3f7' }));
        
        this._wavOx = ox; this._wavOy = oy; this._wavAw = aw; this._wavAh = ah;
    }
    
    // ═══════════════════════════════════════════ 物理仿真
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickVisuals();
        this._refreshCache();
    }
    
    _stopAnimation() {
        if (this._animId) {
            cancelAnimationFrame(this._animId);
        }
    }
    
    // ── 物理仿真：计算输出电压 ──
    _tickPhysics(dt) {
        // 获取输入转速（外部或手动）
        if (this._mode === 'manual') {
            this._omegaRpm = this._manualSpeed;
        } else {
            // 外部输入：从端口获取
            const shaftPort = this.getPort('shaft_in');
            if (shaftPort && shaftPort.connectedComponent) {
                // 假设连接的组件有 getSpeed 方法
                const extSpeed = shaftPort.connectedComponent.getSpeed?.() || 0;
                this._omegaRpm = extSpeed;
            }
        }
        
        // 限制转速范围
        this._omegaRpm = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, this._omegaRpm));
        this._omega = this._omegaRpm * 2 * Math.PI / 60;
        this._theta += this._omega * dt;
        
        // 理想输出电压（无负载、无纹波）
        const tempFactor = 1 + this.tempCoef / 100 * (this._temp - 25);
        const magnetFactor = this.magnetField;
        this._idealVoltage = this._omegaRpm * this.sensitivity / 1000 * tempFactor * magnetFactor;
        
        // 负载效应（分压）
        const loadFactor = this.loadResistance / (this.loadResistance + this.Ra);
        let actualVoltage = this._idealVoltage * loadFactor;
        
        // 线性度误差（仿真非线性）
        const linearityErr = this._idealVoltage * this.linearity / 100 * Math.sin(this._omega * 0.1);
        actualVoltage += linearityErr;
        
        // 换向纹波（频率与转速成正比）
        const commutatorSegments = 12;  // 12 片换向片
        const rippleFreq = commutatorSegments * Math.abs(this._omegaRpm) / 60;  // Hz
        const rippleAmp = this._idealVoltage * this.ripplePct / 100;
        let ripple = 0;
        if (rippleFreq > 0.1) {
            ripple = rippleAmp * Math.sin(2 * Math.PI * rippleFreq * Date.now() / 1000);
        }
        this._rippleVoltage = ripple;
        actualVoltage += ripple;
        
        // 输出电流
        this._current = actualVoltage / this.loadResistance;
        
        // 滤波（一阶低通模拟电枢电感效应）
        const tau = this.La / (this.Ra + this.loadResistance);
        if (tau > 0) {
            const alpha = dt / (tau + dt);
            this._outputVoltage = this._outputVoltage * (1 - alpha) + actualVoltage * alpha;
        } else {
            this._outputVoltage = actualVoltage;
        }
        
        // 更新波形缓冲
        this._wavOmega = new Float32Array([...this._wavOmega.slice(1), this._omegaRpm]);
        this._wavUout = new Float32Array([...this._wavUout.slice(1), this._outputVoltage]);
        this._wavUideal = new Float32Array([...this._wavUideal.slice(1), this._idealVoltage]);
    }
    
    // ── 可视化更新 ──
    _tickVisuals() {
        // 更新仪表
        if (this._meterCells) {
            this._meterCells.rpm.text.text(this._meterCells.rpm.formatter(this._omegaRpm));
            this._meterCells.volt.text.text(this._meterCells.volt.formatter(this._outputVoltage));
            this._meterCells.ideal.text.text(this._meterCells.ideal.formatter(this._idealVoltage));
            this._meterCells.curr.text.text(this._meterCells.curr.formatter(this._current));
            this._meterCells.temp.text.text(this._meterCells.temp.formatter(this._temp));
            this._meterCells.load.text.text(this._meterCells.load.formatter(this.loadResistance));
        }
        
        // 更新状态指示
        if (this._statusIndicator) {
            const enabled = this._enabled && Math.abs(this._outputVoltage) > 0.1;
            this._statusIndicator.fill(enabled ? '#2e7d32' : '#c62828');
            this._statusText.text(enabled ? '信号输出中' : '无信号');
            this._statusText.fill(enabled ? '#66bb6a' : '#ef5350');
        }
        
        if (this._modeText) {
            this._modeText.text(`模式: ${this._mode === 'manual' ? '手动模拟' : '外部输入'}  |  ` +
                               `灵敏度: ${this.sensitivity}V/krpm  |  纹波: ${this.ripplePct}%`);
        }
        
        // 更新特性曲线上的工作点
        if (this._opPoint && this._charOx) {
            const rpmNorm = Math.min(1, Math.max(0, Math.abs(this._omegaRpm) / this._charMaxRpm));
            const vNorm = Math.min(1, Math.max(0, Math.abs(this._outputVoltage) / this._charMaxV));
            const x = this._charOx + rpmNorm * this._charAw;
            const y = this._charOy - vNorm * this._charAh;
            this._opPoint.x(x);
            this._opPoint.y(y);
            
            // 更新实际特性曲线
            const pts = [];
            for (let i = 0; i <= 100; i++) {
                const rpm = (i / 100) * this._charMaxRpm;
                // 模拟实际特性（负载效应 + 线性度）
                let v_actual = rpm * this.sensitivity / 1000;
                v_actual *= this.loadResistance / (this.loadResistance + this.Ra);
                v_actual += v_actual * this.linearity / 100 * Math.sin(i * 0.1);
                const x = this._charOx + (rpm / this._charMaxRpm) * this._charAw;
                const y = this._charOy - (v_actual / this._charMaxV) * this._charAh;
                pts.push(x, y);
            }
            this._actualLine.points(pts);
        }
        
        // 更新波形
        if (this._wavOx) {
            const n = this._wavLen;
            const dx = this._wavAw / n;
            const maxVoltage = Math.max(0.1, Math.abs(this.maxVoltage * 1.2));
            const maxRpm = this.maxSpeed;
            
            const ptsV = [];
            const ptsS = [];
            for (let i = 0; i < n; i++) {
                const x = this._wavOx + i * dx;
                const vNorm = Math.min(1, Math.abs(this._wavUout[i]) / maxVoltage);
                const rpmNorm = Math.min(1, Math.abs(this._wavOmega[i]) / maxRpm);
                ptsV.push(x, this._wavOy - vNorm * (this._wavAh - 2));
                ptsS.push(x, this._wavOy - rpmNorm * (this._wavAh - 2) * 0.7);
            }
            this._waveVoltage.points(ptsV);
            this._waveSpeed.points(ptsS);
        }
    }
    
    // ═══════════════════════════════════════════ 公共接口
    
    /**
     * 设置输入转速（手动模式）
     * @param {number} rpm - 转速（rpm）
     */
    setSpeed(rpm) {
        this._manualSpeed = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, rpm));
        if (this._mode === 'manual') {
            this._omegaRpm = this._manualSpeed;
        }
    }
    
    /**
     * 获取当前输出电压
     * @returns {number} 输出电压（V）
     */
    getVoltage() {
        return this._outputVoltage;
    }
    
    /**
     * 获取当前输入转速
     * @returns {number} 转速（rpm）
     */
    getSpeed() {
        return this._omegaRpm;
    }
    
    /**
     * 获取理想输出电压（无负载、无纹波）
     * @returns {number} 理想电压（V）
     */
    getIdealVoltage() {
        return this._idealVoltage;
    }
    
    /**
     * 设置负载电阻
     * @param {number} resistance - 负载电阻（Ω）
     */
    setLoadResistance(resistance) {
        this.loadResistance = Math.max(100, resistance);
        this._refreshCache();
    }
    
    /**
     * 设置工作温度
     * @param {number} temp - 温度（°C）
     */
    setTemperature(temp) {
        this._temp = Math.max(-20, Math.min(80, temp));
    }
    
    /**
     * 设置使能状态
     * @param {boolean} enabled - 是否使能输出
     */
    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled) {
            this._outputVoltage = 0;
        }
    }
    
    /**
     * 设置工作模式
     * @param {string} mode - 'external' 或 'manual'
     */
    setMode(mode) {
        if (mode === 'external' || mode === 'manual') {
            this._mode = mode;
        }
    }
    
    /**
     * 获取灵敏度
     * @returns {number} 灵敏度（V/krpm）
     */
    getSensitivity() {
        return this.sensitivity;
    }
    
    /**
     * 更新配置
     * @param {Object} cfg - 配置参数
     */
    update(cfg = {}) {
        if (cfg.speed !== undefined) this.setSpeed(cfg.speed);
        if (cfg.load !== undefined) this.setLoadResistance(cfg.load);
        if (cfg.temp !== undefined) this.setTemperature(cfg.temp);
        if (cfg.mode !== undefined) this.setMode(cfg.mode);
        if (cfg.enabled !== undefined) this.setEnabled(cfg.enabled);
        this._refreshCache();
    }
    
    /**
     * 获取配置字段列表
     */
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '灵敏度 (V/krpm)', key: 'sensitivity', type: 'number', step: 0.5, min: 1, max: 100 },
            { label: '最高转速 (rpm)', key: 'maxSpeed', type: 'number', step: 500, min: 1000, max: 10000 },
            { label: '电枢电阻 (Ω)', key: 'Ra', type: 'number', step: 10, min: 10, max: 500 },
            { label: '电枢电感 (mH)', key: 'La', type: 'number', step: 1, min: 1, max: 50 },
            { label: '纹波 (%)', key: 'ripplePct', type: 'number', step: 0.5, min: 0.5, max: 5 },
            { label: '线性度 (%)', key: 'linearity', type: 'number', step: 0.05, min: 0.1, max: 1 },
            { label: '温度系数 (%/°C)', key: 'tempCoef', type: 'number', step: 0.01, min: -0.05, max: 0.05 },
            { label: '负载电阻 (kΩ)', key: 'loadResistance', type: 'number', step: 1, min: 1, max: 100 },
            { label: '转动惯量 (kg·m² × 1e-6)', key: 'inertia', type: 'number', step: 1, min: 1, max: 100 },
        ];
    }
    
    /**
     * 配置更新回调
     */
    onConfigUpdate(cfg) {
        const n = k => parseFloat(cfg[k]);
        if (cfg.id) this.id = cfg.id;
        if (cfg.sensitivity) {
            this.sensitivity = n('sensitivity');
            this.maxVoltage = this.sensitivity * this.maxSpeed / 1000;
        }
        if (cfg.maxSpeed) {
            this.maxSpeed = n('maxSpeed');
            this.maxVoltage = this.sensitivity * this.maxSpeed / 1000;
        }
        if (cfg.Ra) this.Ra = n('Ra');
        if (cfg.La) this.La = n('La') * 1e-3;
        if (cfg.ripplePct) this.ripplePct = n('ripplePct');
        if (cfg.linearity) this.linearity = n('linearity');
        if (cfg.tempCoef) this.tempCoef = n('tempCoef');
        if (cfg.loadResistance) this.loadResistance = n('loadResistance') * 1000;
        if (cfg.inertia) this.inertia = n('inertia') * 1e-6;
        
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }
    
    destroy() {
        super.destroy?.();
    }
}