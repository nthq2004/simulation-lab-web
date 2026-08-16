import { BaseComponent } from './BaseComponent.js';

/**
 * 磁翻板式液位计仿真组件
 * （Magnetic Flip Indicator Level Gauge）
 * 
 * 远传功能：干簧管阵列 + 精密电阻网络 → 4-20mA
 * 
 * ── 干簧管远传原理 ──────────────────────────────────────────
 *  沿翻板柱安装 N 个干簧管（Reed Switch），每个并联精密电阻
 *  浮子内置永磁铁 → 干簧管闭合 → 对应电阻接入电路
 *  总电阻 R_total = R_base + Σ(R_i) → I_out = 4 + 16*(R_total - R_min)/(R_max - R_min)
 * 
 *  读数原理：
 *     红/白分界线即为当前液位位置
 *     同时输出 4-20mA 标准信号
 */
export class MagneticFlipLevelGauge extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 340);
        this.height = Math.max(380, config.height || 420);

        this.type    = 'magnetic_flip_gauge';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.totalRange    = config.totalRange   || 1000;   // 量程 mm
        this.flipCount     = config.flipCount    || 30;     // 翻板数量（=干簧管数量）
        this.withTransmitter = config.withTransmitter !== false; // 是否带变送器
        this.hiAlarm       = config.hiAlarm      || 85;     // 高报 %
        this.loAlarm       = config.loAlarm      || 15;     // 低报 %
        this.mediumType    = config.mediumType   || 'water';// 介质类型

        // ── 干簧管远传参数 ──
        this.reedResistorBase = config.reedResistorBase || 100;    // 基础电阻 (Ω)
        this.reedResistorStep = config.reedResistorStep || 20;     // 每级电阻增量 (Ω)
        // 实际电阻值：R_i = base + i * step
        // 当第 i 个干簧管闭合时，该级电阻接入
        
        // ── 状态 ──
        this.liquidLevel   = config.initLevel    || 40;     // %（0~100）
        this._manualLevel  = config.initLevel    || 40;
        this._displayLevel = config.initLevel    || 40;     // 平滑显示液位
        this.levelMM       = 0;
        this.outCurrent    = 4;
        this.alarmHi       = false;
        this.alarmLo       = false;

        // ── 干簧管状态 ──
        // closedReeds: 当前闭合的干簧管索引（从底部0开始）
        // 注意：干簧管从底部安装，第0个对应0%液位，第N-1个对应100%
        this._closedReedIndex = -1;   // 当前闭合的干簧管索引
        this._totalResistance  = 0;    // 当前总电阻 (Ω)
        this._lastClosedIndex  = -1;   // 上一次闭合索引（用于变化检测）

        // ── 翻板动画状态 ──
        this._flipAngles   = new Float32Array(this.flipCount).fill(0);
        this._flipTarget   = new Uint8Array(this.flipCount).fill(0);

        // ── 浮子 ──
        this._floatY       = 0;
        this._floatGlow    = 0;
        this._floatPhase   = 0;

        // ── 液面波动 ──
        this._surfPhase    = 0;

        // ── 拖拽 ──
        this._dragActive   = false;
        this._dragStartY   = 0;
        this._dragStartL   = 0;

        // ── 几何布局 ──
        this._colX     = 14;
        this._colY     = 52;
        this._colW     = 28;
        this._colH     = Math.round(this.height * 0.72);
        this._chipH    = Math.max(6, Math.floor(this._colH / this.flipCount));

        this._chamX    = this._colX + this._colW + 14;
        this._chamY    = this._colY;
        this._chamW    = 46;
        this._chamH    = this._colH;

        this._scaleX   = this._colX - 28;
        this._scaleY   = this._colY;
        this._scaleH   = this._colH;

        this._txX      = this._chamX + this._chamW + 16;
        this._txY      = Math.round(this.height * 0.25);
        this._txW      = this.width - this._txX - 10;
        this._txH      = Math.round(this.height * 0.42);

        this._meterX   = this._txX;
        this._meterY   = this._colY;
        this._meterW   = this._txW;
        this._meterH   = this._txY - this._colY - 8;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, totalRange: this.totalRange,
            flipCount: this.flipCount, hiAlarm: this.hiAlarm, loAlarm: this.loAlarm,
            reedResistorBase: this.reedResistorBase, reedResistorStep: this.reedResistorStep,
        };

        this._init();

        // 端口
        const loY = this._chamY + this._chamH - 10;
        const hiY = this._chamY + 10;
        this.addPort(this._chamX + this._chamW, hiY,  'hi', 'pipe', 'HI');
        this.addPort(this._chamX + this._chamW, loY,  'lo', 'pipe', 'LO');
        if (this.withTransmitter) {
            this.addPort(this.width, this._txY + 18, 'p', 'wire', 'I+');
            this.addPort(this.width, this._txY + 38, 'n', 'wire', 'I−');
        }
    }

    // ═══════════════════════════════════════════
    //  干簧管远传核心算法
    // ═══════════════════════════════════════════
    
    /**
     * 根据液位计算闭合的干簧管索引
     * @param {number} levelPercent 液位百分比 0-100
     * @returns {number} 闭合的干簧管索引（-1 表示无闭合）
     */
    _computeClosedReedIndex(levelPercent) {
        if (levelPercent <= 0) return -1;      // 无干簧管闭合（最底部）
        if (levelPercent >= 100) return this.flipCount - 1; // 顶部干簧管闭合
        
        // 线性映射：液位 -> 干簧管索引
        // 0%液位：无闭合 (-1)
        // 1%~(100/N)%：第0个闭合
        // (100/N)%~(200/N)%：第1个闭合
        // ...
        const stepPercent = 100 / this.flipCount;
        const index = Math.floor(levelPercent / stepPercent);
        
        // 边界处理：当液位正好落在分界线上时，按高索引处理（更准确反映浮子位置）
        if (Math.abs(levelPercent % stepPercent) < 0.01 && levelPercent > 0) {
            return Math.min(index, this.flipCount - 1);
        }
        return Math.min(index, this.flipCount - 1);
    }
    
    /**
     * 计算当前总电阻（干簧管阵列 + 基础电阻）
     * 原理：每个干簧管并联一个精密电阻，浮子磁性使对应干簧管闭合
     *       闭合的干簧管将对应电阻接入电路，形成分压网络
     * 
     * @param {number} closedIndex 闭合的干簧管索引
     * @returns {number} 总电阻 (Ω)
     */
    _computeTotalResistance(closedIndex) {
        // 无干簧管闭合：仅基础电阻
        if (closedIndex < 0) {
            return this.reedResistorBase;
        }
        
        // 有干簧管闭合：基础电阻 + 从第0个到闭合索引的累加电阻
        // 电阻值随液位上升而增加，形成线性关系
        let sumResistance = this.reedResistorBase;
        for (let i = 0; i <= closedIndex; i++) {
            sumResistance += (this.reedResistorBase + i * this.reedResistorStep);
        }
        
        return sumResistance;
    }
    
    /**
     * 根据总电阻计算输出电流 (4-20mA)
     * 采用线性映射：R_min → 4mA, R_max → 20mA
     * 
     * @param {number} resistance 总电阻 (Ω)
     * @returns {number} 输出电流 (mA)
     */
    _computeOutputCurrent(resistance) {
        // 计算理论最小和最大电阻
        const R_min = this.reedResistorBase;  // 0%液位：仅基础电阻
        let R_max = this.reedResistorBase;
        for (let i = 0; i < this.flipCount; i++) {
            R_max += (this.reedResistorBase + i * this.reedResistorStep);
        }
        
        // 防止除零
        if (R_max <= R_min) return 4;
        
        // 线性映射：R_min → 4mA, R_max → 20mA
        const ratio = (resistance - R_min) / (R_max - R_min);
        const current = 4 + ratio * 16;
        
        // 限制在 3.8-20.5mA（符合NAMUR NE43标准）
        return Math.min(20.5, Math.max(3.8, current));
    }
    
    /**
     * 更新干簧管远传状态（基于当前液位）
     * 这是干簧管远传的核心更新函数
     */
    _updateReedTransmitter() {
        // 1. 根据液位确定闭合的干簧管
        const newClosedIndex = this._computeClosedReedIndex(this._displayLevel);
        
        // 2. 更新闭合索引（带迟滞，避免抖动）
        if (newClosedIndex !== this._closedReedIndex) {
            // 模拟干簧管的机械迟滞特性：需要一定的磁场强度变化才切换
            const levelDiff = Math.abs(this._displayLevel - this._lastLevelForReed);
            if (levelDiff > 0.5 || newClosedIndex === -1 || newClosedIndex === this.flipCount - 1) {
                this._closedReedIndex = newClosedIndex;
                this._lastLevelForReed = this._displayLevel;
                
                // 触发干簧管切换事件（可用于动画效果或日志）
                this._onReedSwitch(this._lastClosedIndex, this._closedReedIndex);
                this._lastClosedIndex = this._closedReedIndex;
            }
        }
        
        // 3. 计算总电阻
        this._totalResistance = this._computeTotalResistance(this._closedReedIndex);
        
        // 4. 计算输出电流
        this.outCurrent = this._computeOutputCurrent(this._totalResistance);
        
        // 5. 验证线性度
        this._verifyLinearity();
    }
    
    /**
     * 干簧管切换时的回调（用于动画和日志）
     */
    _onReedSwitch(oldIndex, newIndex) {
        if (oldIndex === newIndex) return;
        
        // 可以在这里添加干簧管吸合的视觉反馈
        // 例如：闪烁对应的翻板或显示吸合指示
        if (this._reedFlashTimer) {
            clearTimeout(this._reedFlashTimer);
        }
        this._reedFlashIndex = newIndex;
        this._reedFlashRemaining = 0.15; // 闪烁150ms
        
        // 可选：输出到控制台（调试用）
        // console.log(`[Reed Switch] Index: ${oldIndex} → ${newIndex}, Level: ${this._displayLevel.toFixed(1)}%, Current: ${this.outCurrent.toFixed(2)}mA`);
    }
    
    /**
     * 验证输出电流的线性度（诊断用）
     */
    _verifyLinearity() {
        // 理论电流值（基于液位的线性）
        const theoreticalCurrent = 4 + (this._displayLevel / 100) * 16;
        const error = Math.abs(this.outCurrent - theoreticalCurrent);
        
        // 记录最大非线性误差（用于调试）
        if (error > (this._maxNonlinearity || 0)) {
            this._maxNonlinearity = error;
            // 如果误差超过0.1mA，在控制台输出警告（调试用）
            if (error > 0.1 && this._displayLevel > 0 && this._displayLevel < 100) {
                // console.warn(`非线性误差: ${error.toFixed(3)}mA at ${this._displayLevel.toFixed(1)}%`);
            }
        }
    }
    
    /**
     * 获取干簧管阵列的详细信息（用于外部调试）
     * @returns {Object} 干簧管远传状态
     */
    getReedStatus() {
        return {
            closedIndex: this._closedReedIndex,
            totalResistance: this._totalResistance,
            outputCurrent: this.outCurrent,
            levelPercent: this._displayLevel,
            linearityError: this._maxNonlinearity || 0,
        };
    }

    // ═══════════════════════════════════════════
    //  初始化渲染
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawScaleRuler();
        this._drawIndicatorColumn();
        this._drawMainChamber();
        this._drawConnectingFlanges();
        this._drawLiquidLayer();
        this._drawFloatMagnet();
        this._drawFlipChips();
        this._drawReedArray();        // 新增：绘制干簧管阵列
        this._drawTransmitter();
        this._drawMeterDisplay();
        this._drawDrainValve();
        this._setupDrag();
        this._startAnimation();
        
        // 初始化干簧管状态
        this._lastLevelForReed = this._displayLevel;
        this._maxNonlinearity = 0;
        this._reedFlashIndex = -1;
        this._reedFlashRemaining = 0;
        this._updateReedTransmitter();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '磁翻板式液位计（干簧管远传 · 4-20mA）',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 刻度尺 ───────────────────────────────
    _drawScaleRuler() {
        const sx = this._scaleX, sy = this._scaleY, sh = this._scaleH;
        const tw = 14;

        this.group.add(new Konva.Rect({
            x: sx - 2, y: sy, width: tw + 4, height: sh,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.8, cornerRadius: 1,
        }));

        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const ly    = sy + sh * i / steps;
            const value = this.totalRange * (1 - i / steps);
            const isMaj = i % 2 === 0;
            this.group.add(new Konva.Line({
                points: [sx + (isMaj ? 4 : 8), ly, sx + tw, ly],
                stroke: '#546e7a', strokeWidth: isMaj ? 1.2 : 0.7,
            }));
            if (isMaj) {
                this.group.add(new Konva.Text({
                    x: sx - 26, y: ly - 5, width: 22,
                    text: Math.round(value).toString(),
                    fontSize: 7.5, fill: '#37474f', align: 'right',
                }));
            }
        }
        this.group.add(new Konva.Text({
            x: sx - 28, y: sy - 14, text: 'mm', fontSize: 8, fill: '#78909c',
        }));

        const hiY = sy + sh * (1 - this.hiAlarm / 100);
        const loY = sy + sh * (1 - this.loAlarm / 100);
        this._scaleHiLine = new Konva.Line({ points: [sx - 2, hiY, sx + tw + 30, hiY], stroke: '#ef5350', strokeWidth: 1, dash: [4, 3], opacity: 0.6 });
        this._scaleLoLine = new Konva.Line({ points: [sx - 2, loY, sx + tw + 30, loY], stroke: '#ffa726', strokeWidth: 1, dash: [4, 3], opacity: 0.6 });
        this.group.add(new Konva.Text({ x: sx + tw + 4, y: hiY - 8, text: 'HH', fontSize: 7, fill: '#ef5350' }));
        this.group.add(new Konva.Text({ x: sx + tw + 4, y: loY + 1, text: 'LL', fontSize: 7, fill: '#ffa726' }));
        this.group.add(this._scaleHiLine, this._scaleLoLine);
    }

    // ── 翻板显示柱（外框）─────────────────────
    _drawIndicatorColumn() {
        const cx = this._colX, cy = this._colY, cw = this._colW, ch = this._colH;

        const frame = new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: '#eceff1', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: 2,
        });
        const topCap = new Konva.Rect({ x: cx - 2, y: cy - 6, width: cw + 4, height: 8, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: 2 });
        const botCap = new Konva.Rect({ x: cx - 2, y: cy + ch - 2, width: cw + 4, height: 8, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: 2 });

        this.group.add(new Konva.Rect({ x: cx, y: cy, width: 4, height: ch, fill: '#cfd8dc' }));
        this.group.add(new Konva.Rect({ x: cx + cw - 4, y: cy, width: 4, height: ch, fill: '#cfd8dc' }));

        this.group.add(new Konva.Text({ x: cx, y: cy - 18, width: cw, text: '翻板柱', fontSize: 8.5, fontStyle: 'bold', fill: '#37474f', align: 'center' }));

        this.group.add(frame, topCap, botCap);
    }

    // ── 主液腔 ────────────────────────────────
    _drawMainChamber() {
        const cx = this._chamX, cy = this._chamY, cw = this._chamW, ch = this._chamH;

        const outer = new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#78909c', stroke: '#546e7a', strokeWidth: 2, cornerRadius: [3, 3, 3, 3] });
        this._innerChamX = cx + 6;
        this._innerChamY = cy + 4;
        this._innerChamW = cw - 12;
        this._innerChamH = ch - 8;
        const inner = new Konva.Rect({
            x: this._innerChamX, y: this._innerChamY,
            width: this._innerChamW, height: this._innerChamH,
            fill: '#e8f4f8', stroke: '#b0d4e0', strokeWidth: 0.5,
        });
        this.group.add(new Konva.Rect({
            x: cx + 7, y: cy + 4, width: 5, height: ch - 8,
            fill: 'rgba(255,255,255,0.40)',
        }));

        this.group.add(new Konva.Text({ x: cx, y: cy - 18, width: cw, text: '主腔', fontSize: 8.5, fontStyle: 'bold', fill: '#37474f', align: 'center' }));

        this.group.add(outer, inner);
    }

    // ── 上下联通管法兰 ───────────────────────
    _drawConnectingFlanges() {
        const cx = this._chamX, cw = this._chamW;
        const cy = this._chamY, ch = this._chamH;

        const topFlange = new Konva.Rect({ x: cx + 2, y: cy - 10, width: cw - 4, height: 12, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 });
        const topBolt1  = new Konva.Circle({ x: cx + 8, y: cy - 4, radius: 3, fill: '#37474f' });
        const topBolt2  = new Konva.Circle({ x: cx + cw - 8, y: cy - 4, radius: 3, fill: '#37474f' });
        const topPipe = new Konva.Rect({ x: cx + cw, y: cy + 2, width: 22, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });

        const botFlange = new Konva.Rect({ x: cx + 2, y: cy + ch - 2, width: cw - 4, height: 12, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 });
        const botBolt1  = new Konva.Circle({ x: cx + 8, y: cy + ch + 6, radius: 3, fill: '#37474f' });
        const botBolt2  = new Konva.Circle({ x: cx + cw - 8, y: cy + ch + 6, radius: 3, fill: '#37474f' });
        const botPipe = new Konva.Rect({ x: cx + cw, y: cy + ch - 10, width: 22, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });

        this.group.add(topFlange, topBolt1, topBolt2, topPipe);
        this.group.add(botFlange, botBolt1, botBolt2, botPipe);
    }

    // ── 干簧管阵列（显示在翻板柱右侧）──────────
    _drawReedArray() {
        if (!this.withTransmitter) return;
        
        const rx = this._colX + this._colW + 2;
        const ry = this._colY;
        const rw = 6;
        const rh = this._colH;
        
        // 干簧管阵列外壳
        const reedHousing = new Konva.Rect({
            x: rx, y: ry, width: rw, height: rh,
            fill: '#2c3e2f', stroke: '#1a3a1a', strokeWidth: 0.8, cornerRadius: 1,
        });
        this.group.add(reedHousing);
        
        // 干簧管标注
        this.group.add(new Konva.Text({
            x: rx, y: ry - 14, width: rw,
            text: '干簧管', fontSize: 6, fill: '#2e7d32', align: 'center',
        }));
        
        // 存储干簧管视觉元素，用于动画反馈
        this._reedIndicators = [];
        
        // 绘制每个干簧管（小圆点表示）
        const stepH = this._chipH;
        for (let i = 0; i < this.flipCount; i++) {
            const yPos = ry + i * stepH + stepH / 2 - 3;
            const isBottom = i === 0;      // 底部干簧管对应0%液位
            const isTop = i === this.flipCount - 1;
            
            const reedDot = new Konva.Circle({
                x: rx + rw/2, y: yPos, radius: 2.5,
                fill: isBottom || isTop ? '#444' : '#555',
                stroke: '#2a5a2a', strokeWidth: 0.5,
            });
            this.group.add(reedDot);
            this._reedIndicators.push(reedDot);
        }
        
        // 添加说明文字
        this.group.add(new Konva.Text({
            x: rx + 2, y: ry + rh - 12, width: rw + 10,
            text: 'R', fontSize: 7, fill: '#5d8c48', align: 'left',
        }));
    }

    // ── 液体层 ────────────────────────────────
    _drawLiquidLayer() {
        this._liquidRect = new Konva.Rect({
            x: this._innerChamX, y: this._innerChamY,
            width: this._innerChamW, height: 0,
            fill: '#1e88e5', opacity: 0.75,
        });
        this._liquidSurf = new Konva.Line({ points: [], stroke: 'rgba(255,255,255,0.4)', strokeWidth: 2 });
        this.group.add(this._liquidRect, this._liquidSurf);
    }

    // ── 磁性浮子 ─────────────────────────────
    _drawFloatMagnet() {
        const cx = this._chamX + this._chamW / 2;

        this._floatGroup = new Konva.Group({ x: cx, y: this._innerChamY });

        const fw = this._innerChamW - 4, fh = 18;
        const body = new Konva.Rect({ x: -fw/2, y: -fh/2, width: fw, height: fh, fill: '#1a237e', stroke: '#0d47a1', strokeWidth: 1.5, cornerRadius: 3 });
        const magnet = new Konva.Rect({ x: -fw/2+3, y: -4, width: fw-6, height: 8, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 0.8, cornerRadius: 2 });
        const nPole = new Konva.Text({ x: -fw/2+3, y: -3, text: 'N', fontSize: 7, fontStyle: 'bold', fill: '#ef5350' });
        const sPole = new Konva.Text({ x: fw/2-10, y: -3, text: 'S', fontSize: 7, fontStyle: 'bold', fill: '#42a5f5' });
        const glint = new Konva.Rect({ x: -fw/2+2, y: -fh/2+2, width: 3, height: fh-4, fill: 'rgba(255,255,255,0.25)', cornerRadius: 1 });
        this._floatGlowCircle = new Konva.Ellipse({ radiusX: fw/2+10, radiusY: 14, fill: 'rgba(255,213,79,0.12)' });

        this._floatGroup.add(this._floatGlowCircle, body, magnet, nPole, sPole, glint);
        this.group.add(this._floatGroup);
    }

    // ── 翻板 ─────────────────────────────────
    _drawFlipChips() {
        this._flipChips = [];
        const cx = this._colX + 4, cw = this._colW - 8;
        const ch = this._chipH - 1;

        for (let i = 0; i < this.flipCount; i++) {
            const y = this._colY + i * this._chipH;
            const chip = new Konva.Rect({
                x: cx, y: y + 0.5,
                width: cw, height: ch,
                fill: '#ffffff', stroke: '#e0e0e0', strokeWidth: 0.5,
            });
            this._flipChips.push(chip);
            this.group.add(chip);
        }

        this._levelArrow = new Konva.Line({
            points: [this._colX + this._colW + 2, this._colY, this._colX + this._colW + 8, this._colY, this._colX + this._colW + 6, this._colY + 4],
            closed: true, fill: '#ef5350', stroke: 'none',
        });
        this.group.add(this._levelArrow);
    }

    // ── 变送器模块（带干簧管电路示意）──────────
    _drawTransmitter() {
        if (!this.withTransmitter) return;

        const tx = this._txX, ty = this._txY, tw = this._txW, th = this._txH;

        const body = new Konva.Rect({ x: tx, y: ty, width: tw, height: th, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: 4 });
        const nameBg = new Konva.Rect({ x: tx, y: ty, width: tw, height: 20, fill: '#283593', stroke: '#1a237e', strokeWidth: 0.5, cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: tx+2, y: ty+4, width: tw-4, text: '干簧管远传变送器', fontSize: 8.5, fontStyle: 'bold', fill: '#e8eaf6', align: 'center' }));
        this.group.add(new Konva.Text({ x: tx+2, y: ty+13, width: tw-4, text: 'Reed Array · 4~20mA', fontSize: 7, fill: '#9fa8da', align: 'center' }));

        // 电路示意图区域
        const circuitY = ty + 52;
        this.group.add(new Konva.Rect({ x: tx+4, y: circuitY, width: tw-8, height: 44, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 }));
        
        // 电阻网络示意图
        this.group.add(new Konva.Text({ x: tx+8, y: circuitY+4, text: '精密电阻网络', fontSize: 6.5, fill: '#8bc34a' }));
        this.group.add(new Konva.Text({ x: tx+8, y: circuitY+16, text: 'R1 ─┬─ R2 ─┬─ R3 ─┬─ ...', fontSize: 7, fill: '#ffd54f', fontFamily: 'monospace' }));
        this.group.add(new Konva.Text({ x: tx+8, y: circuitY+28, text: '    ↓     ↓     ↓', fontSize: 6, fill: '#ef5350' }));
        this.group.add(new Konva.Text({ x: tx+8, y: circuitY+38, text: ' [簧]   [簧]   [簧]', fontSize: 6, fill: '#4fc3f7' }));

        // 接线端子区
        const termY = ty + th - 42;
        this.group.add(new Konva.Rect({ x: tx+4, y: termY, width: tw-8, height: 38, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 }));

        [['I+ (4-20mA)', '#ffd54f', termY+8], ['COM (-)', '#90a4ae', termY+24]].forEach(([lbl, col, ly]) => {
            this.group.add(new Konva.Rect({ x: tx+6, y: ly-5, width: tw-12, height: 12, fill: 'rgba(255,255,255,0.03)', cornerRadius: 1 }));
            this.group.add(new Konva.Text({ x: tx+9, y: ly-2, text: lbl, fontSize: 7.5, fontStyle: 'bold', fill: col }));
        });

        // 液晶显示
        this._txLcd = new Konva.Rect({ x: tx+6, y: ty+24, width: tw-12, height: 26, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
        this._txCurrText = new Konva.Text({ x: tx+6, y: ty+27, width: tw-12, text: '4.00 mA', fontSize: 11, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });
        this._txPctText  = new Konva.Text({ x: tx+6, y: ty+40, width: tw-12, text: '0.0 %', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'center' });
        
        // 电阻值显示
        this._txResText = new Konva.Text({ x: tx+6, y: circuitY+4, width: tw-8, text: `R=${this._totalResistance.toFixed(0)}Ω`, fontSize: 6, fill: '#ffa726', align: 'right' });

        // 连接管
        const connY = ty + th / 2;
        this.group.add(new Konva.Line({
            points: [this._chamX + this._chamW, connY, tx, connY],
            stroke: '#37474f', strokeWidth: 3, lineCap: 'round',
        }));
        this.group.add(new Konva.Circle({ x: this._chamX + this._chamW, y: connY, radius: 4, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1 }));

        this.group.add(body, nameBg, this._txLcd, this._txCurrText, this._txPctText, this._txResText);
    }

    // ── 仪表数字显示 ─────────────────────────
    _drawMeterDisplay() {
        const mx = this._meterX, my = this._meterY;
        const mw = this._meterW, mh = this._meterH;
        if (mh < 20) return;

        const bg = new Konva.Rect({ x: mx, y: my, width: mw, height: mh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        this.group.add(new Konva.Text({ x: mx+2, y: my+4, width: mw-4, text: '干簧管远传读数', fontSize: 7.5, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        this._meterLvPct = new Konva.Text({ x: mx+4, y: my+16, width: mw-8, text: '0.0 %', fontSize: 13, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#66bb6a', align: 'center' });
        this._meterLvMM  = new Konva.Text({ x: mx+4, y: my+32, width: mw-8, text: '0 mm', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center' });
        this._meterCurrent = new Konva.Text({ x: mx+4, y: my+46, width: mw-8, text: '4.00 mA', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'center' });
        this._meterAlarm = new Konva.Text({ x: mx+4, y: my+mh-12, width: mw-8, text: '● 正常', fontSize: 7.5, fill: '#66bb6a', align: 'center' });

        this.group.add(bg, this._meterLvPct, this._meterLvMM, this._meterCurrent, this._meterAlarm);
    }

    // ── 排污阀 ───────────────────────────────
    _drawDrainValve() {
        const cx = this._chamX + this._chamW / 2;
        const cy = this._chamY + this._chamH + 10;

        const valve = new Konva.Rect({ x: cx-10, y: cy, width: 20, height: 14, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 });
        const stem  = new Konva.Rect({ x: cx-3, y: cy-10, width: 6, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });
        const hand  = new Konva.Rect({ x: cx-10, y: cy-14, width: 20, height: 5, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 1 });
        this.group.add(new Konva.Text({ x: cx-16, y: cy+16, text: '排污阀', fontSize: 7.5, fill: '#78909c' }));
        this.group.add(valve, stem, hand);
    }

    // ── 拖拽设置 ─────────────────────────────
    _setupDrag() {
        const hitX = this._colX, hitW = (this._chamX + this._chamW) - this._colX;
        const hit = new Konva.Rect({
            x: hitX, y: this._colY,
            width: hitW, height: this._colH,
            fill: 'transparent', listening: true,
        });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartL = this._manualLevel;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualLevel = Math.max(0, Math.min(100, this._dragStartL + (this._dragStartY - cy) / this._colH * 100));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickLiquid();
                this._tickFloat(dt);
                this._tickFlipChips(dt);
                this._tickReedIndicators(dt);  // 干簧管指示器动画
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 物理更新（集成干簧管计算）──────────────
    _tickPhysics(dt) {
        this.liquidLevel = this._manualLevel;

        this._displayLevel += (this.liquidLevel - this._displayLevel) * Math.min(1, dt * 5);

        this.levelMM   = (this._displayLevel / 100) * this.totalRange;
        
        // 核心：干簧管远传计算（替换原有的简单4-20mA映射）
        this._updateReedTransmitter();
        
        this.alarmHi   = this.liquidLevel > this.hiAlarm;
        this.alarmLo   = this.liquidLevel < this.loAlarm;

        this._surfPhase   += dt * 3;
        this._floatPhase  += dt * 2;
        this._floatGlow    = 0.12 + 0.08 * Math.abs(Math.sin(this._floatPhase * 1.5));
    }

    // ── 液面动画 ─────────────────────────────
    _tickLiquid() {
        const ih  = this._innerChamH;
        const lh  = (this._displayLevel / 100) * ih;
        const top = this._innerChamY + ih - lh;

        this._liquidRect.y(top);
        this._liquidRect.height(lh);

        const fr = this._displayLevel / 100;
        this._liquidRect.fill(`rgba(${Math.round(20+fr*12)},${Math.round(100+fr*50)},${Math.round(210+fr*20)},0.78)`);

        if (lh > 2) {
            const pts = [];
            const nSeg = 6;
            for (let i = 0; i <= nSeg; i++) {
                const x = this._innerChamX + (this._innerChamW * i / nSeg);
                const y = top + Math.sin(this._surfPhase + i * 1.2) * 1.2;
                pts.push(x, y);
            }
            this._liquidSurf.points(pts);
        } else {
            this._liquidSurf.points([]);
        }
    }

    // ── 浮子动画 ─────────────────────────────
    _tickFloat(dt) {
        if (!this._floatGroup) return;
        const ih  = this._innerChamH;
        const lh  = (this._displayLevel / 100) * ih;
        const top = this._innerChamY + ih - lh;
        const bob = Math.sin(this._floatPhase) * 1.5;
        const fy  = top + bob;

        this._floatGroup.y(fy);
        if (this._floatGlowCircle) {
            this._floatGlowCircle.fill(`rgba(255,213,79,${this._floatGlow})`);
        }
    }

    // ── 翻板逐片翻转动画 ──────────────────────
    _tickFlipChips(dt) {
        const N    = this.flipCount;
        const lv   = this._displayLevel / 100;
        const speed= dt * 12;

        for (let i = 0; i < N; i++) {
            const chipTopFrac = 1 - i / N;
            const chipBotFrac = 1 - (i+1) / N;
            const chipCenterFrac = (chipTopFrac + chipBotFrac) / 2;
            const target = lv > chipBotFrac ? 1 : 0;
            this._flipTarget[i] = target;

            const targetAngle = target === 1 ? 180 : 0;
            const diff = targetAngle - this._flipAngles[i];
            if (Math.abs(diff) > 0.5) {
                const distToLevel = Math.abs(lv - chipCenterFrac);
                const localSpeed  = speed * (1 + Math.max(0, 0.5 - distToLevel) * 8);
                this._flipAngles[i] += Math.sign(diff) * Math.min(Math.abs(diff), localSpeed * 180 / Math.PI);
            }

            const angle = this._flipAngles[i];
            const chip = this._flipChips[i];
            if (!chip) continue;

            if (angle <= 90) {
                const t = angle / 90;
                const g = Math.round(255 - t * 80);
                chip.fill(`rgb(${g},${g},${g})`);
                chip.width(Math.max(2, (this._colW - 8) * Math.cos(angle * Math.PI / 180)));
                chip.x(this._colX + 4 + (this._colW - 8) * (1 - Math.cos(angle * Math.PI / 180)) / 2);
            } else {
                const t = (angle - 90) / 90;
                const r = Math.round(175 + t * 65);
                const g2 = Math.round(60 - t * 60);
                chip.fill(`rgb(${r},${g2},${g2})`);
                chip.width(Math.max(2, (this._colW - 8) * Math.abs(Math.cos(angle * Math.PI / 180))));
                chip.x(this._colX + 4 + (this._colW - 8) * (1 - Math.abs(Math.cos(angle * Math.PI / 180))) / 2);
            }

            chip.stroke(angle > 90 ? '#b71c1c' : '#e0e0e0');
        }

        if (this._levelArrow) {
            const arrowY = this._colY + (1 - this._displayLevel / 100) * this._colH;
            this._levelArrow.points([
                this._colX + this._colW + 2, arrowY,
                this._colX + this._colW + 10, arrowY - 4,
                this._colX + this._colW + 10, arrowY + 4,
            ]);
            this._levelArrow.fill(this.alarmHi ? '#ef5350' : this.alarmLo ? '#ffa726' : '#66bb6a');
        }
    }
    
    // ── 干簧管指示器动画（显示哪个干簧管被激活）──
    _tickReedIndicators(dt) {
        if (!this._reedIndicators) return;
        
        // 更新闪烁效果
        if (this._reedFlashRemaining > 0) {
            this._reedFlashRemaining -= dt;
        }
        
        for (let i = 0; i < this.flipCount; i++) {
            const dot = this._reedIndicators[i];
            if (!dot) continue;
            
            // 当前闭合的干簧管高亮显示
            const isActive = (i === this._closedReedIndex);
            // 闪烁效果：刚切换时短暂闪烁
            const isFlashing = (this._reedFlashRemaining > 0 && i === this._reedFlashIndex);
            
            if (isFlashing) {
                // 闪烁：交替亮色
                const flashBright = Math.sin(Date.now() * 0.03) > 0;
                dot.fill(flashBright ? '#4caf50' : '#ffd54f');
                dot.radius(3);
            } else if (isActive) {
                dot.fill('#4caf50');  // 激活：亮绿色
                dot.radius(3);
            } else {
                dot.fill('#555');      // 未激活：暗色
                dot.radius(2.5);
            }
        }
    }

    // ── 显示更新（包含干簧管信息）──────────────
    _tickDisplay() {
        const lv = this._displayLevel;
        const mc = this.alarmHi ? '#ef5350' : this.alarmLo ? '#ffa726' : '#66bb6a';

        if (this._meterLvPct)  { this._meterLvPct.text(`${lv.toFixed(1)} %`); this._meterLvPct.fill(mc); }
        if (this._meterLvMM)   this._meterLvMM.text(`${Math.round(this.levelMM)} mm`);
        if (this._meterCurrent) this._meterCurrent.text(`${this.outCurrent.toFixed(2)} mA`);
        if (this._meterAlarm) {
            const st = this.alarmHi ? '⬆ 高液位报警' : this.alarmLo ? '⬇ 低液位报警' : '● 正常';
            this._meterAlarm.text(st); this._meterAlarm.fill(mc);
        }
        if (this._txCurrText)  this._txCurrText.text(`${this.outCurrent.toFixed(2)} mA`);
        if (this._txPctText)   this._txPctText.text(`${lv.toFixed(1)} %`);
        if (this._txResText)   this._txResText.text(`R=${this._totalResistance.toFixed(0)}Ω`);
        
        // 更新变送器LCD背景色（报警时变色）
        if (this._txLcd) {
            this._txLcd.fill(this.alarmHi || this.alarmLo ? '#2a0a0a' : '#020c14');
        }
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    
    /**
     * 更新液位
     * @param {number} level 液位百分比 0-100
     */
    update(level) {
        if (typeof level === 'number') this._manualLevel = Math.max(0, Math.min(100, level));
        this._refreshCache();
    }
    
    /**
     * 获取当前远传信号
     * @returns {number} 输出电流 (mA)
     */
    getOutputCurrent() {
        return this.outCurrent;
    }
    
    /**
     * 获取当前电阻值
     * @returns {number} 总电阻 (Ω)
     */
    getTotalResistance() {
        return this._totalResistance;
    }
    
    /**
     * 获取闭合的干簧管索引
     * @returns {number} 索引（-1表示无闭合）
     */
    getClosedReedIndex() {
        return this._closedReedIndex;
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',          type: 'text'   },
            { label: '量程 (mm)',          key: 'totalRange',  type: 'number' },
            { label: '翻板/干簧管数量',    key: 'flipCount',   type: 'number' },
            { label: '高报阈值 (%)',       key: 'hiAlarm',     type: 'number' },
            { label: '低报阈值 (%)',       key: 'loAlarm',     type: 'number' },
            { label: '基础电阻 (Ω)',       key: 'reedResistorBase', type: 'number', help: '干簧管阵列基础电阻值' },
            { label: '电阻步进 (Ω)',       key: 'reedResistorStep', type: 'number', help: '每级电阻增量' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.totalRange  = parseFloat(cfg.totalRange) || this.totalRange;
        this.hiAlarm     = parseFloat(cfg.hiAlarm)    ?? this.hiAlarm;
        this.loAlarm     = parseFloat(cfg.loAlarm)    ?? this.loAlarm;
        if (cfg.reedResistorBase !== undefined) this.reedResistorBase = parseFloat(cfg.reedResistorBase);
        if (cfg.reedResistorStep !== undefined) this.reedResistorStep = parseFloat(cfg.reedResistorStep);
        this.config      = { ...this.config, ...cfg };
        
        // 重新计算远传状态
        this._updateReedTransmitter();
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}