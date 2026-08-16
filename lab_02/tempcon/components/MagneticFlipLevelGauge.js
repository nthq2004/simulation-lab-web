import { BaseComponent } from './BaseComponent.js';

/**
 * 磁翻板式液位计仿真组件
 * （Magnetic Flip Indicator Level Gauge）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  磁翻板式液位计由三部分构成：
 *
 *  1. 主腔（储液腔）：
 *     侧面联通管与储罐连通，液位与储罐完全同步
 *
 *  2. 磁性浮子（Float with Magnet）：
 *     浮子内置永磁铁，随液面升降
 *
 *  3. 翻转显示柱（Indicator Column）：
 *     安装在主腔外侧，由若干双色翻板（Flip Chip）组成
 *     每块翻板一面为红色（液面以下），另一面为白色（液面以上）
 *     浮子永磁铁经过翻板时，翻板受磁力驱动翻转
 *
 *  读数原理：
 *     红/白分界线即为当前液位位置
 *
 *  磁传感器变送器（可选）：
 *     沿显示柱安装磁敏传感器阵列，输出 4-20mA
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 储液主腔（带液体填充动画）
 *  ② 磁性浮子（随液面平滑运动，带磁场辉光）
 *  ③ 翻转显示柱（左侧并联柱，逐片翻转动画）
 *  ④ 翻板状态（红色=液面以下，白色=液面以上）
 *  ⑤ 量程刻度尺
 *  ⑥ 4-20mA 变送器模块（可选，带两个电气接口）
 *  ⑦ 上下联通管法兰
 *  ⑧ 排污阀（底部）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_hi  — 上联通管（与储罐上部连通）
 *  pipe_lo  — 下联通管（与储罐下部连通）
 *  wire_p   — 变送器信号正极（4-20mA）
 *  wire_n   — 变送器信号负极
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
        this.flipCount     = config.flipCount    || 30;     // 翻板数量
        this.withTransmitter = config.withTransmitter !== false; // 是否带变送器
        this.hiAlarm       = config.hiAlarm      || 85;     // 高报 %
        this.loAlarm       = config.loAlarm      || 15;     // 低报 %
        this.mediumType    = config.mediumType   || 'water';// 介质类型

        // ── 状态 ──
        this.liquidLevel   = config.initLevel    || 40;     // %（0~100）
        this._manualLevel  = config.initLevel    || 40;
        this._displayLevel = config.initLevel    || 40;     // 平滑显示液位
        this.levelMM       = 0;
        this.outCurrent    = 4;
        this.alarmHi       = false;
        this.alarmLo       = false;

        // ── 翻板动画状态 ──
        // 每块翻板的当前翻转角度（0=白面，180=红面完全翻过来）
        this._flipAngles   = new Float32Array(this.flipCount).fill(0);
        // 目标状态（0=白，1=红）
        this._flipTarget   = new Uint8Array(this.flipCount).fill(0);

        // ── 浮子 ──
        this._floatY       = 0;   // 当前浮子 Y（像素，主腔坐标）
        this._floatGlow    = 0;   // 磁场辉光强度
        this._floatPhase   = 0;   // 浮子微浮动相位

        // ── 液面波动 ──
        this._surfPhase    = 0;

        // ── 拖拽 ──
        this._dragActive   = false;
        this._dragStartY   = 0;
        this._dragStartL   = 0;

        // ── 几何布局 ──
        // 翻板显示柱（左侧）
        this._colX     = 14;
        this._colY     = 52;
        this._colW     = 28;
        this._colH     = Math.round(this.height * 0.72);
        this._chipH    = Math.max(6, Math.floor(this._colH / this.flipCount));

        // 主腔（右接翻板柱）
        this._chamX    = this._colX + this._colW + 14;
        this._chamY    = this._colY;
        this._chamW    = 46;
        this._chamH    = this._colH;

        // 刻度尺（翻板柱左侧）
        this._scaleX   = this._colX - 28;
        this._scaleY   = this._colY;
        this._scaleH   = this._colH;

        // 变送器模块（主腔右侧）
        this._txX      = this._chamX + this._chamW + 16;
        this._txY      = Math.round(this.height * 0.25);
        this._txW      = this.width - this._txX - 10;
        this._txH      = Math.round(this.height * 0.42);

        // 仪表盘（变送器上方）
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
    //  初始化
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
        this._drawTransmitter();
        this._drawMeterDisplay();
        this._drawDrainValve();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '磁翻板式液位计（Float Magnet · Flip Indicator）',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 刻度尺 ───────────────────────────────
    _drawScaleRuler() {
        const sx = this._scaleX, sy = this._scaleY, sh = this._scaleH;
        const tw = 14;

        // 刻度尺背景
        this.group.add(new Konva.Rect({
            x: sx - 2, y: sy, width: tw + 4, height: sh,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.8, cornerRadius: 1,
        }));

        // 刻度线 + 标注
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
        // 单位
        this.group.add(new Konva.Text({
            x: sx - 28, y: sy - 14, text: 'mm', fontSize: 8, fill: '#78909c',
        }));

        // 高/低报警线
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

        // 外壳框架（铝合金导槽）
        const frame = new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: '#eceff1', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: 2,
        });
        // 顶底端盖
        const topCap = new Konva.Rect({ x: cx - 2, y: cy - 6, width: cw + 4, height: 8, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: 2 });
        const botCap = new Konva.Rect({ x: cx - 2, y: cy + ch - 2, width: cw + 4, height: 8, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: 2 });

        // 左右边轨
        this.group.add(new Konva.Rect({ x: cx, y: cy, width: 4, height: ch, fill: '#cfd8dc' }));
        this.group.add(new Konva.Rect({ x: cx + cw - 4, y: cy, width: 4, height: ch, fill: '#cfd8dc' }));

        // 标注
        this.group.add(new Konva.Text({ x: cx, y: cy - 18, width: cw, text: '翻板柱', fontSize: 8.5, fontStyle: 'bold', fill: '#37474f', align: 'center' }));

        this.group.add(frame, topCap, botCap);
    }

    // ── 主液腔（玻璃管外观）──────────────────
    _drawMainChamber() {
        const cx = this._chamX, cy = this._chamY, cw = this._chamW, ch = this._chamH;

        // 外管（金属色）
        const outer = new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#78909c', stroke: '#546e7a', strokeWidth: 2, cornerRadius: [3, 3, 3, 3] });
        // 内腔（透明玻璃感）
        this._innerChamX = cx + 6;
        this._innerChamY = cy + 4;
        this._innerChamW = cw - 12;
        this._innerChamH = ch - 8;
        const inner = new Konva.Rect({
            x: this._innerChamX, y: this._innerChamY,
            width: this._innerChamW, height: this._innerChamH,
            fill: '#e8f4f8', stroke: '#b0d4e0', strokeWidth: 0.5,
        });
        // 玻璃高光
        this.group.add(new Konva.Rect({
            x: cx + 7, y: cy + 4, width: 5, height: ch - 8,
            fill: 'rgba(255,255,255,0.40)',
        }));

        // 标注
        this.group.add(new Konva.Text({ x: cx, y: cy - 18, width: cw, text: '主腔', fontSize: 8.5, fontStyle: 'bold', fill: '#37474f', align: 'center' }));

        this.group.add(outer, inner);
    }

    // ── 上下联通管法兰 ───────────────────────
    _drawConnectingFlanges() {
        const cx = this._chamX, cw = this._chamW;
        const cy = this._chamY, ch = this._chamH;

        // 上联通管
        const topFlange = new Konva.Rect({ x: cx + 2, y: cy - 10, width: cw - 4, height: 12, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 });
        const topBolt1  = new Konva.Circle({ x: cx + 8, y: cy - 4, radius: 3, fill: '#37474f' });
        const topBolt2  = new Konva.Circle({ x: cx + cw - 8, y: cy - 4, radius: 3, fill: '#37474f' });
        // 上管（往右延伸）
        const topPipe = new Konva.Rect({ x: cx + cw, y: cy + 2, width: 22, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });

        // 下联通管
        const botFlange = new Konva.Rect({ x: cx + 2, y: cy + ch - 2, width: cw - 4, height: 12, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 });
        const botBolt1  = new Konva.Circle({ x: cx + 8, y: cy + ch + 6, radius: 3, fill: '#37474f' });
        const botBolt2  = new Konva.Circle({ x: cx + cw - 8, y: cy + ch + 6, radius: 3, fill: '#37474f' });
        // 下管
        const botPipe = new Konva.Rect({ x: cx + cw, y: cy + ch - 10, width: 22, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });

        this.group.add(topFlange, topBolt1, topBolt2, topPipe);
        this.group.add(botFlange, botBolt1, botBolt2, botPipe);
    }

    // ── 液体层（动态）────────────────────────
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
        // 浮子体（圆柱形，深蓝色）
        const body = new Konva.Rect({ x: -fw/2, y: -fh/2, width: fw, height: fh, fill: '#1a237e', stroke: '#0d47a1', strokeWidth: 1.5, cornerRadius: 3 });
        // 浮子磁铁区（金色，中央）
        const magnet = new Konva.Rect({ x: -fw/2+3, y: -4, width: fw-6, height: 8, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 0.8, cornerRadius: 2 });
        // N/S 极标注
        const nPole = new Konva.Text({ x: -fw/2+3, y: -3, text: 'N', fontSize: 7, fontStyle: 'bold', fill: '#ef5350' });
        const sPole = new Konva.Text({ x: fw/2-10, y: -3, text: 'S', fontSize: 7, fontStyle: 'bold', fill: '#42a5f5' });
        // 高光
        const glint = new Konva.Rect({ x: -fw/2+2, y: -fh/2+2, width: 3, height: fh-4, fill: 'rgba(255,255,255,0.25)', cornerRadius: 1 });
        // 磁场辉光（动态）
        this._floatGlowCircle = new Konva.Ellipse({ radiusX: fw/2+10, radiusY: 14, fill: 'rgba(255,213,79,0.12)' });

        this._floatGroup.add(this._floatGlowCircle, body, magnet, nPole, sPole, glint);
        this.group.add(this._floatGroup);
    }

    // ── 翻板（动态创建，由 Konva.Rect 组成）──
    _drawFlipChips() {
        this._flipChips = [];
        const cx = this._colX + 4, cw = this._colW - 8;
        const ch = this._chipH - 1;

        for (let i = 0; i < this.flipCount; i++) {
            const y = this._colY + i * this._chipH;
            // 翻板本体
            const chip = new Konva.Rect({
                x: cx, y: y + 0.5,
                width: cw, height: ch,
                fill: '#ffffff', stroke: '#e0e0e0', strokeWidth: 0.5,
            });
            // 翻板文字（%标注，每5片一个）
            this._flipChips.push(chip);
            this.group.add(chip);
        }

        // 当前液位指示箭头
        this._levelArrow = new Konva.Line({
            points: [this._colX + this._colW + 2, this._colY, this._colX + this._colW + 8, this._colY, this._colX + this._colW + 6, this._colY + 4],
            closed: true, fill: '#ef5350', stroke: 'none',
        });
        this.group.add(this._levelArrow);
    }

    // ── 变送器模块（右侧）────────────────────
    _drawTransmitter() {
        if (!this.withTransmitter) return;

        const tx = this._txX, ty = this._txY, tw = this._txW, th = this._txH;

        // 变送器外壳
        const body = new Konva.Rect({ x: tx, y: ty, width: tw, height: th, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: 4 });
        // 顶部标牌
        const nameBg = new Konva.Rect({ x: tx, y: ty, width: tw, height: 20, fill: '#283593', stroke: '#1a237e', strokeWidth: 0.5, cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: tx+2, y: ty+4, width: tw-4, text: '差压变送器', fontSize: 8.5, fontStyle: 'bold', fill: '#e8eaf6', align: 'center' }));
        this.group.add(new Konva.Text({ x: tx+2, y: ty+13, width: tw-4, text: '4~20mA', fontSize: 7, fill: '#9fa8da', align: 'center' }));

        // 接线端子区
        const termY = ty + th - 50;
        this.group.add(new Konva.Rect({ x: tx+4, y: termY, width: tw-8, height: 46, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 }));

        [['I+', '#ffd54f', termY+10], ['I−', '#90a4ae', termY+28]].forEach(([lbl, col, ly]) => {
            this.group.add(new Konva.Rect({ x: tx+6, y: ly-6, width: tw-12, height: 13, fill: 'rgba(255,255,255,0.03)', cornerRadius: 1 }));
            this.group.add(new Konva.Text({ x: tx+9, y: ly-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        // 液晶显示
        this._txLcd = new Konva.Rect({ x: tx+6, y: ty+24, width: tw-12, height: 30, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
        this._txCurrText = new Konva.Text({ x: tx+6, y: ty+27, width: tw-12, text: '4.00 mA', fontSize: 12, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });
        this._txPctText  = new Konva.Text({ x: tx+6, y: ty+41, width: tw-12, text: '0.0 %', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'center' });

        // 连接管（变送器到主腔）
        const connY = ty + th / 2;
        this.group.add(new Konva.Line({
            points: [this._chamX + this._chamW, connY, tx, connY],
            stroke: '#37474f', strokeWidth: 3, lineCap: 'round',
        }));
        this.group.add(new Konva.Circle({ x: this._chamX + this._chamW, y: connY, radius: 4, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1 }));

        this.group.add(body, nameBg, this._txLcd, this._txCurrText, this._txPctText);
    }

    // ── 仪表数字显示（翻板柱右上）────────────
    _drawMeterDisplay() {
        const mx = this._meterX, my = this._meterY;
        const mw = this._meterW, mh = this._meterH;
        if (mh < 20) return;

        const bg = new Konva.Rect({ x: mx, y: my, width: mw, height: mh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        this.group.add(new Konva.Text({ x: mx+2, y: my+4, width: mw-4, text: '液位读数', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        this._meterLvPct = new Konva.Text({ x: mx+4, y: my+16, width: mw-8, text: '0.0 %', fontSize: 14, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#66bb6a', align: 'center' });
        this._meterLvMM  = new Konva.Text({ x: mx+4, y: my+34, width: mw-8, text: '0 mm', fontSize: 10, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center' });
        this._meterAlarm = new Konva.Text({ x: mx+4, y: my+mh-14, width: mw-8, text: '● 正常', fontSize: 8, fill: '#66bb6a', align: 'center' });

        this.group.add(bg, this._meterLvPct, this._meterLvMM, this._meterAlarm);
    }

    // ── 排污阀（底部）────────────────────────
    _drawDrainValve() {
        const cx = this._chamX + this._chamW / 2;
        const cy = this._chamY + this._chamH + 10;

        // 阀体
        const valve = new Konva.Rect({ x: cx-10, y: cy, width: 20, height: 14, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 });
        // 阀杆
        const stem  = new Konva.Rect({ x: cx-3, y: cy-10, width: 6, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });
        const hand  = new Konva.Rect({ x: cx-10, y: cy-14, width: 20, height: 5, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 1 });
        this.group.add(new Konva.Text({ x: cx-16, y: cy+16, text: '排污阀', fontSize: 7.5, fill: '#78909c' }));
        this.group.add(valve, stem, hand);
    }

    // ── 拖拽设置 ─────────────────────────────
    _setupDrag() {
        // 翻板柱 + 主腔区域可拖拽
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

    // ── 物理更新 ─────────────────────────────
    _tickPhysics(dt) {
        this.liquidLevel = this._manualLevel;

        // 平滑液位（一阶滤波）
        this._displayLevel += (this.liquidLevel - this._displayLevel) * Math.min(1, dt * 5);

        this.levelMM   = (this._displayLevel / 100) * this.totalRange;
        this.outCurrent= 4 + (this._displayLevel / 100) * 16;
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

        // 液体矩形
        this._liquidRect.y(top);
        this._liquidRect.height(lh);

        // 液面颜色
        const fr = this._displayLevel / 100;
        this._liquidRect.fill(`rgba(${Math.round(20+fr*12)},${Math.round(100+fr*50)},${Math.round(210+fr*20)},0.78)`);

        // 波动液面线
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

    // ── 浮子跟随液面 ─────────────────────────
    _tickFloat(dt) {
        if (!this._floatGroup) return;
        const ih  = this._innerChamH;
        const lh  = (this._displayLevel / 100) * ih;
        const top = this._innerChamY + ih - lh;
        // 浮子中心位于液面处（上下微浮动）
        const bob = Math.sin(this._floatPhase) * 1.5;
        const fy  = top + bob;

        this._floatGroup.y(fy);
        // 磁场辉光随液面闪烁
        if (this._floatGlowCircle) {
            this._floatGlowCircle.fill(`rgba(255,213,79,${this._floatGlow})`);
        }
    }

    // ── 翻板逐片翻转动画 ──────────────────────
    _tickFlipChips(dt) {
        const N    = this.flipCount;
        const lv   = this._displayLevel / 100;  // 0~1
        const speed= dt * 12;  // 每帧翻转速度（弧度）

        for (let i = 0; i < N; i++) {
            // 第 i 片翻板对应的液位范围
            // i=0 在顶端（100%），i=N-1 在底端（0%）
            const chipTopFrac = 1 - i / N;       // 上边 fraction
            const chipBotFrac = 1 - (i+1) / N;   // 下边 fraction

            // 液位在此翻板中心以下 → 红色（1）；以上 → 白色（0）
            const chipCenterFrac = (chipTopFrac + chipBotFrac) / 2;
            const target = lv > chipBotFrac ? 1 : 0;  // 液面在翻板下边界以上=红
            this._flipTarget[i] = target;

            // 平滑翻转（角度 0°~180°，90° = 翻转中）
            const targetAngle = target === 1 ? 180 : 0;
            const diff = targetAngle - this._flipAngles[i];
            if (Math.abs(diff) > 0.5) {
                // 距液面近的翻板翻转更快（制造波浪效果）
                const distToLevel = Math.abs(lv - chipCenterFrac);
                const localSpeed  = speed * (1 + Math.max(0, 0.5 - distToLevel) * 8);
                this._flipAngles[i] += Math.sign(diff) * Math.min(Math.abs(diff), localSpeed * 180 / Math.PI);
            }

            // 绘制翻板颜色
            const angle = this._flipAngles[i];
            // 0→90°: 从白渐变到侧边（灰色过渡）
            // 90→180°: 从侧边渐变到红色
            const chip = this._flipChips[i];
            if (!chip) continue;

            if (angle <= 90) {
                // 白色 → 灰（侧面）
                const t = angle / 90;
                const g = Math.round(255 - t * 80);
                chip.fill(`rgb(${g},${g},${g})`);
                chip.width(Math.max(2, (this._colW - 8) * Math.cos(angle * Math.PI / 180)));
                chip.x(this._colX + 4 + (this._colW - 8) * (1 - Math.cos(angle * Math.PI / 180)) / 2);
            } else {
                // 灰（侧面）→ 红色
                const t = (angle - 90) / 90;
                const r = Math.round(175 + t * 65);
                const g2 = Math.round(60 - t * 60);
                chip.fill(`rgb(${r},${g2},${g2})`);
                chip.width(Math.max(2, (this._colW - 8) * Math.abs(Math.cos(angle * Math.PI / 180))));
                chip.x(this._colX + 4 + (this._colW - 8) * (1 - Math.abs(Math.cos(angle * Math.PI / 180))) / 2);
            }

            // 边框颜色
            chip.stroke(angle > 90 ? '#b71c1c' : '#e0e0e0');
        }

        // 液位指示箭头
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

    // ── 显示更新 ─────────────────────────────
    _tickDisplay() {
        const lv = this._displayLevel;
        const mc = this.alarmHi ? '#ef5350' : this.alarmLo ? '#ffa726' : '#66bb6a';

        if (this._meterLvPct)  { this._meterLvPct.text(`${lv.toFixed(1)} %`); this._meterLvPct.fill(mc); }
        if (this._meterLvMM)   this._meterLvMM.text(`${Math.round(this.levelMM)} mm`);
        if (this._meterAlarm) {
            const st = this.alarmHi ? '⬆ 高液位' : this.alarmLo ? '⬇ 低液位' : '● 正常';
            this._meterAlarm.text(st); this._meterAlarm.fill(mc);
        }
        if (this._txCurrText)  this._txCurrText.text(`${this.outCurrent.toFixed(2)} mA`);
        if (this._txPctText)   this._txPctText.text(`${lv.toFixed(1)} %`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(level) {
        if (typeof level === 'number') this._manualLevel = Math.max(0, Math.min(100, level));
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',          type: 'text'   },
            { label: '量程 (mm)',          key: 'totalRange',  type: 'number' },
            { label: '翻板数量',           key: 'flipCount',   type: 'number' },
            { label: '高报阈值 (%)',       key: 'hiAlarm',     type: 'number' },
            { label: '低报阈值 (%)',       key: 'loAlarm',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.totalRange  = parseFloat(cfg.totalRange) || this.totalRange;
        this.hiAlarm     = parseFloat(cfg.hiAlarm)    ?? this.hiAlarm;
        this.loAlarm     = parseFloat(cfg.loAlarm)    ?? this.loAlarm;
        this.config      = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}