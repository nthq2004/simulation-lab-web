import { BaseComponent } from './BaseComponent.js';

/**
 * 玻璃板液位计仿真组件
 * （Glass Plate Level Gauge / Reflex Level Gauge）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  玻璃板液位计是一种直读式液位测量仪表，由以下部分构成：
 *
 *  1. 金属主体（Metal Body）：
 *     承压壳体，包含液体通道，上下端有法兰接口
 *
 *  2. 玻璃视窗（Glass Window）：
 *     在金属主体正面开槽，嵌入钢化玻璃板
 *     利用光学原理——液体侧呈暗色，气体侧呈亮色
 *     形成明显分界线
 *
 *  3. 刻度标尺（Scale Plate）：
 *     沿视窗边缘安装标尺，直接读取液位高度
 *
 *  4. 上下连接法兰：
 *     上法兰（气相）、下法兰（液相），与储罐连通
 *
 *  5. 排污阀（Drain Valve）：
 *     底部排污或取样
 *
 *  读数原理：
 *     直接观察玻璃中液面位置，对照标尺读取液位高度
 *     汽相段呈银白色（反射光），液相段呈暗灰色（吸收光）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_hi  — 上联通管（与储罐上部连通）
 *  pipe_lo  — 下联通管（与储罐下部连通）
 */
export class GlassPlateLevelGauge extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(100, config.width  || 200);
        this.height = Math.max(380, config.height || 420);

        this.type    = 'glass_plate_gauge';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 仪表参数 ──
        this.totalRange    = config.totalRange   || 1000;   // 量程 mm
        this.hiAlarm       = config.hiAlarm      || 85;     // 高报 %
        this.loAlarm       = config.loAlarm      || 15;     // 低报 %
        this.label         = config.label        || 'LG-101';

        // ── 状态 ──
        this.liquidLevel   = config.initLevel    || 0;     // %（0~100）
        this._manualLevel  = config.initLevel    || 0;
        this._displayLevel = config.initLevel    || 0;     // 平滑显示液位
        this.levelMM       = 0;
        this.alarmHi       = false;
        this.alarmLo       = false;

        // ── 液面波动 ──
        this._surfPhase    = 0;

        // ── 几何布局 ──
        this._padL = 40;    // 左侧留白（刻度尺）
        this._padR = 20;    // 右侧留白
        this._padT = 50;    // 顶部留白
        this._padB = 30;    // 底部留白

        // 玻璃视窗区域
        this._glassX = this._padL;
        this._glassY = this._padT;
        this._glassW = this.width - this._padL - this._padR;
        this._glassH = this.height - this._padT - this._padB;

        // 刻度尺区域
        this._scaleX = 8;
        this._scaleY = this._glassY;
        this._scaleW = this._padL - 12;
        this._scaleH = this._glassH;

        this.config = {
            id: this.id, totalRange: this.totalRange,
            hiAlarm: this.hiAlarm, loAlarm: this.loAlarm,
        };

        this._init();

        // 端口
        const loY = this._glassY + this._glassH;
        const hiY = this._glassY;
        this.addPort(this._glassX + this._glassW+20, hiY + 8,  'hi', 'pipe', 'in');
        this.addPort(this._glassX + this._glassW+20, loY - 8,  'lo', 'pipe');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawMetalBody();
        this._drawGlassWindow();
        this._drawLiquidLayer();
        this._drawScaleRuler();
        this._drawLabelPlate();
        this._drawFlanges();
        this._drawDrainValve();
        this._setupDrag();
    }

    // ── 金属主体 ─────────────────────────────
    _drawMetalBody() {
        // 主体外壳
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#78909c', stroke: '#546e7a', strokeWidth: 2,
            cornerRadius: [4, 4, 4, 4],
        }));

        // 内部凹槽（视觉凹陷）
        this._staticGroup.add(new Konva.Rect({
            x: this._glassX - 4, y: this._glassY - 4,
            width: this._glassW + 8, height: this._glassH + 8,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5,
            cornerRadius: 2,
        }));

        // 固定螺栓（四角）
        const boltPos = [
            [12, 12], [this.width - 12, 12],
            [12, this.height - 12], [this.width - 12, this.height - 12],
        ];
        boltPos.forEach(([bx, by]) => {
            this._staticGroup.add(new Konva.Circle({
                x: bx, y: by, radius: 4,
                fill: '#455a64', stroke: '#37474f', strokeWidth: 1,
            }));
        });

        // 侧面固定螺栓（沿玻璃两侧）
        for (let i = 0; i < 4; i++) {
            const y = this._glassY + 10 + i * (this._glassH - 20) / 3;
            [-1, 1].forEach(side => {
                this._staticGroup.add(new Konva.Circle({
                    x: this._glassX + (side < 0 ? -6 : this._glassW + 6),
                    y: y, radius: 3,
                    fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.8,
                }));
            });
        }
    }

    // ── 玻璃视窗 ─────────────────────────────
    _drawGlassWindow() {
        // 玻璃背景
        this._glassBg = new Konva.Rect({
            x: this._glassX, y: this._glassY,
            width: this._glassW, height: this._glassH,
            fill: '#dce7f0', stroke: '#90a4ae', strokeWidth: 1,
        });

        // 玻璃高光（纵向渐变条）
        this._staticGroup.add(new Konva.Rect({
            x: this._glassX + 6, y: this._glassY + 4,
            width: 8, height: this._glassH - 8,
            fill: 'rgba(255,255,255,0.30)',
            cornerRadius: [2, 0, 0, 2],
        }));

        // 玻璃反光（右侧）
        this._staticGroup.add(new Konva.Rect({
            x: this._glassX + this._glassW - 10, y: this._glassY + 4,
            width: 4, height: this._glassH - 8,
            fill: 'rgba(255,255,255,0.15)',
            cornerRadius: [0, 2, 2, 0],
        }));

        this._staticGroup.add(this._glassBg);
    }

    // ── 液体层（动态）────────────────────────
    _drawLiquidLayer() {
        this._liquidRect = new Konva.Rect({
            x: this._glassX + 1, y: this._glassY + this._glassH,
            width: this._glassW - 2, height: 0,
            fill: '#1565c0', opacity: 0.85,
        });

        // 液面波动线
        this._liquidSurf = new Konva.Line({
            points: [], stroke: 'rgba(255,255,255,0.5)',
            strokeWidth: 2, tension: 3.5,
        });

        this._liquidGlint = new Konva.Rect({
            x: this._glassX + 3, y: 0,
            width: this._glassW - 6, height: 2,
            fill: 'rgba(255,255,255,0.20)',
        });

        this._staticGroup.add(this._liquidRect, this._liquidSurf, this._liquidGlint);
    }

    // ── 刻度标尺 ─────────────────────────────
    _drawScaleRuler() {
        const sx = this._scaleX, sy = this._scaleY;
        const sw = this._scaleW, sh = this._scaleH;

        // 标尺背景
        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.8,
            cornerRadius: 1,
        }));

        // 刻度线和标注
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const ly    = sy + sh * i / steps;
            const value = this.totalRange * (1 - i / steps);
            const isMaj = i % 2 === 0;

            this._staticGroup.add(new Konva.Line({
                points: [sx + (isMaj ? 3 : 6), ly, sx + sw - 2, ly],
                stroke: '#546e7a', strokeWidth: isMaj ? 1.2 : 0.7,
            }));

            if (isMaj) {
                this._staticGroup.add(new Konva.Text({
                    x: sx - 35, y: ly - 5, width: 24,
                    text: Math.round(value).toString(),
                    fontSize: 10.5, fill: '#37474f', align: 'right',
                }));
            }
        }

        // 单位
        this._staticGroup.add(new Konva.Text({
            x: sx - 30, y: sy - 18, text: 'mm', fontSize: 11, fill: '#78909c',
        }));

        // 高/低报警线
        const hiY = sy + sh * (1 - this.hiAlarm / 100);
        const loY = sy + sh * (1 - this.loAlarm / 100);

        this._scaleHiLine = new Konva.Line({
            points: [sx - 2, hiY, sx + sw + 14, hiY],
            stroke: '#ef5350', strokeWidth: 1, dash: [4, 3], opacity: 0.6,
        });
        this._scaleLoLine = new Konva.Line({
            points: [sx - 2, loY, sx + sw + 14, loY],
            stroke: '#ffa726', strokeWidth: 1, dash: [4, 3], opacity: 0.6,
        });
        this._staticGroup.add(new Konva.Text({
            x: sx + sw + 4, y: hiY - 8, text: 'HH', fontSize:12, fill: '#ef5350',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx + sw + 4, y: loY + 1, text: 'LL', fontSize: 12, fill: '#ffa726',
        }));
        this._staticGroup.add(this._scaleHiLine, this._scaleLoLine);
    }

    // ── 位号标牌 ─────────────────────────────
    _drawLabelPlate() {
        // 标牌背景
        this._staticGroup.add(new Konva.Rect({
            x: this._glassX + 10, y: 8,
            width: this._glassW - 20, height: 28,
            fill: '#1a237e', cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._glassX + 10, y: 10,
            width: this._glassW - 20,
            text: this.label + '  玻璃板液位计',
            fontSize: 11, fontStyle: 'bold', fill: '#e8eaf6', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._glassX + 10, y: 22,
            width: this._glassW - 20,
            text: 'Glass Plate Level Gauge',
            fontSize: 10, fill: '#09b63d', align: 'center',
        }));
    }

    // ── 上下法兰 ─────────────────────────────
    _drawFlanges() {
    }

    // ── 排污阀 ─────────────────────────────
    _drawDrainValve() {
        const cx = this._glassX + this._glassW / 2;
        const cy = this._glassY + this._glassH + 16;

        // 阀体
        this._staticGroup.add(new Konva.Rect({
            x: cx - 8, y: cy, width: 16, height: 12,
            fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5,
            cornerRadius: 2,
        }));
        // 阀杆
        this._staticGroup.add(new Konva.Rect({
            x: cx - 2, y: cy - 8, width: 4, height: 10,
            fill: '#78909c', stroke: '#546e7a', strokeWidth: 1,
        }));
        // 手轮
        this._staticGroup.add(new Konva.Rect({
            x: cx - 8, y: cy - 12, width: 16, height: 5,
            fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1,
            cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 14, y: cy + 14,
            text: '排污阀', fontSize: 10.5, fill: '#ea5f08',
        }));
    }

    // ── 拖拽设置 ─────────────────────────────
    _setupDrag() {
        // 玻璃区域可拖拽调节液位
        const hit = new Konva.Rect({
            x: this._glassX, y: this._glassY,
            width: this._glassW, height: this._glassH,
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
            this._manualLevel = Math.max(0, Math.min(100,
                this._dragStartL + (this._dragStartY - cy) / this._glassH * 100));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this._interactGroup.add(hit);
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    tick(dt) {
        this._tickPhysics(dt);
        this._tickLiquid();
        this._tickDisplay();
        this._refreshCache();
    }

    _tickPhysics(dt) {
        this.liquidLevel = this._manualLevel;

        // 平滑液位
        this._displayLevel += (this.liquidLevel - this._displayLevel) * Math.min(1, dt * 5);

        this.levelMM  = (this._displayLevel / 100) * this.totalRange;
        this.alarmHi  = this.liquidLevel > this.hiAlarm;
        this.alarmLo  = this.liquidLevel < this.loAlarm;

        this._surfPhase += dt * 3;
    }

    _tickLiquid() {
        const gh  = this._glassH;
        const lh  = (this._displayLevel / 100) * gh;
        const top = this._glassY + gh - lh;

        // 液体矩形
        this._liquidRect.y(top);
        this._liquidRect.height(lh);

        // 液面颜色随液位微变
        const fr = this._displayLevel / 100;
        const r = Math.round(21 + fr * 10);
        const g = Math.round(101 + fr * 30);
        const b = Math.round(192 + fr * 20);
        this._liquidRect.fill(`rgba(${r},${g},${b},0.82)`);

        // 液面波动线
        if (lh > 3) {
            const pts = [];
            const nSeg = 8;
            for (let i = 0; i <= nSeg; i++) {
                const x = this._glassX + 1 + ((this._glassW - 2) * i / nSeg);
                const y = top + Math.sin(this._surfPhase + i * 0.9) * 1.0;
                pts.push(x, y);
            }
            this._liquidSurf.points(pts);
        } else {
            this._liquidSurf.points([]);
        }

        // 液面高光跟随
        if (lh > 4) {
            this._liquidGlint.y(top + 2);
            this._liquidGlint.visible(true);
        } else {
            this._liquidGlint.visible(false);
        }
    }

    _tickDisplay() {
        const mc = this.alarmHi ? '#ef5350' : this.alarmLo ? '#ffa726' : '#66bb6a';
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
            { label: '位号/名称',     key: 'id',         type: 'text'   },
            { label: '量程 (mm)',      key: 'totalRange', type: 'number' },
            { label: '高报阈值 (%)',   key: 'hiAlarm',    type: 'number' },
            { label: '低报阈值 (%)',   key: 'loAlarm',    type: 'number' },
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

    destroy() {
        super.destroy?.();
    }
}
