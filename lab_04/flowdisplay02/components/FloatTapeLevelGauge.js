import { BaseComponent } from './BaseComponent.js';

/**
 * 浮子钢带液位计仿真组件（完整机械结构版）
 *
 * ── 系统组成 ──
 *  ① 浮子（Float）       — 空心金属浮球，浮于液面
 *  ② 穿孔钢带 + 链轮     — 将直线位移转为旋转运动
 *  ③ 导向管 + 导向轮     — 引导钢带垂直运行
 *  ④ 恒力重锤            — 保持钢带恒张力，消除回差
 *  ⑤ 磁耦合装置          — 隔离密封传递旋转
 *  ⑥ 指示机构            — 指针盘 + 数字计数器 + LCD 数显
 *
 * ── 联锁动态 ──
 *  液位↑ → 浮子↑ → 左钢带↑ → 链轮↻ → 右钢带↓ → 重锤↓
 *                                    ↓
 *                             磁耦合↻ → 计数器↗ + 指针↻
 *
 *  液位↓ → 浮子↓ → 左钢带↓ → 链轮↺ → 右钢带↑ → 重锤↑
 */
export class FloatTapeLevelGauge extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 尺寸：总宽比原来略宽以容纳全部机构，液箱宽度与原设计相当 ──
        this.width  = Math.max(350, config.width  || 360);
        this.height = Math.max(480, config.height || 500);

        this.type    = 'float_tape_gauge';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 仪表参数 ──
        this.totalRange    = config.totalRange   || 2000;
        this.hiAlarm       = config.hiAlarm      || 85;
        this.loAlarm       = config.loAlarm      || 15;
        this.label         = config.label        || 'LT-201';

        // ── 液位状态 ──
        this.liquidLevel   = config.initLevel    || 40;
        this._manualLevel  = config.initLevel    || 40;
        this._displayLevel = config.initLevel    || 40;
        this.levelMM       = 0;
        this.alarmHi       = false;
        this.alarmLo       = false;
        this._surfPhase    = 0;

        // ── 机械位置（由 tick 计算）──
        this._floatY       = 0;
        this._weightY      = 0;
        this._sprocketAngle= 0;
        this._couplingAngle= 0;
        this._pointerAngle = -135;
        this._pulleyL      = 0;
        this._pulleyR      = 0;
        this._counterDigits= [0,0,0,0,0];
        this._prevLevel    = -1;

        // ── 拖拽 ──
        this._dragActive   = false;
        this._dragStartY   = 0;
        this._dragStartL   = 0;

        // ═══════════════════════════════════════════
        //  几何布局定义
        // ═══════════════════════════════════════════
        const W = this.width;
        const H = this.height;

        // 标签条
        this._labelH = 22;
        // 测量头区域
        this._headY  = 28;
        this._headH  = 80;
        // 主体区域
        this._bodyY  = this._headY + this._headH + 4;  // 112
        this._bodyH  = H - this._bodyY - 22;            // ~366

        const bY = this._bodyY;
        const bH = this._bodyH;

        // ── 刻度尺（左侧最外）──
        this._scaleX   = 4;
        this._scaleY   = bY + 4;
        this._scaleW   = 24;
        this._scaleH   = bH - 8;

        // ── 液腔（宽 140px，与原设计一致）──
        this._chamberX = 32;
        this._chamberY = bY + 4;
        this._chamberW = 140;
        this._chamberH = bH - 8;

        // ── 导向管（液腔右侧，保护钢带）──
        this._pX       = this._chamberX + this._chamberW + 6;  // 178
        this._pipeW    = 8;
        this._pipeX    = this._pX - 2;                          // 176

        // ── 钢带路径坐标 ──
        this._tapeLX   = this._pX + 2;   // 180，左侧钢带（浮子→链轮）
        this._tapeRX   = this._pX + 24;  // 202，右侧钢带（链轮→重锤）

        // ── 重锤（液腔外部右侧）──
        this._weightX  = this._tapeRX - 10;  // 192
        this._weightW  = 26;

        // ── 底部导向轮 ──
        this._pulleyR  = 7;
        this._pulleyBY = bY + bH - 16;

        // ── 测量头内部（链轮→磁耦合→指针盘→计数器，自左向右排列）──
        this._sprocketCX = this._tapeLX;     // 180 — 与左钢带对齐
        this._sprocketCY = this._headY + this._headH / 2;  // ~68
        this._sprocketR  = 16;

        this._coupleCX   = this._sprocketCX + 34;  // 214
        this._coupleCY   = this._sprocketCY;
        this._coupleR    = 11;

        this._dialCX     = this._coupleCX + 40;    // 254
        this._dialCY     = this._sprocketCY;
        this._dialR      = 22;

        this._counterX   = this._dialCX + 34;      // 288
        this._counterY   = this._headY + 4;
        this._counterW   = W - this._counterX - 8;  // ~64
        this._counterH   = this._headH - 8;

        // ── 存储配置 ──
        this.config = {
            id: this.id, totalRange: this.totalRange,
            hiAlarm: this.hiAlarm, loAlarm: this.loAlarm,
        };

        this._init();
        this._initPositions();
        this.addPort(
            this._chamberX + this._chamberW, this._chamberY + 6,
            'hi', 'pipe', 'HI'
        );
        this.addPort(
            this._chamberX + this._chamberW, this._chamberY + this._chamberH - 6,
            'lo', 'pipe', 'LO'
        );
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawHeadShell();
        this._drawChamber();
        this._drawScale();
        this._drawGuidePipes();
        this._drawLiquid();
        this._drawFloat();
        this._drawWeight();
        this._drawTape();
        this._drawPulleys();
        this._drawSprocket();
        this._drawMagneticCoupling();
        this._drawPointerDial();
        this._drawCounter();
        this._drawDigitalDisplay();
        this._drawBottomFlange();
        this._setupDrag();
    }

    _initPositions() {
        this._calcPositions(this._displayLevel);
    }

    /** 根据液位计算浮子和重锤位置 */
    _calcPositions(lv) {
        const ch = this._chamberH - 8;
        const lh = (lv / 100) * ch;

        // 浮子位于液面（液位↑ → 浮子↑ → Y 值减小）
        this._floatY = this._chamberY + 6 + ch - lh;

        // 重锤与浮子反向运动（液位↑ → 浮子↑ → 重锤↓ → Y 值增大）
        const trackH = this._bodyH - 44;
        this._weightY = this._bodyY + 16 + lh;
    }

    // ═══════════════════════════════════════════
    //  Konva 绘图
    // ═══════════════════════════════════════════

    _drawLabel() {
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this._labelH,
            fill: '#1a237e', cornerRadius: [4,4,0,0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: 6, y: 3, width: this.width - 12,
            text: `${this.label}  浮子钢带液位计`,
            fontSize: 10, fontStyle: 'bold', fill: '#e8eaf6',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 6, y: 14, width: this.width - 12,
            text: 'Float & Perforated Tape Level Gauge',
            fontSize: 6.5, fill: '#9fa8da',
        }));
    }

    _drawHeadShell() {
        // 测量头外壳
        this._staticGroup.add(new Konva.Rect({
            x: 6, y: this._headY, width: this.width - 12, height: this._headH,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5,
            cornerRadius: [3,3,0,0],
        }));
        // 顶盖板
        this._staticGroup.add(new Konva.Rect({
            x: 3, y: this._headY - 3, width: this.width - 6, height: 6,
            fill: '#455a64', stroke: '#263238', strokeWidth: 1,
            cornerRadius: [3,3,0,0],
        }));
        // 功能区竖线分隔
        const hY = this._headY;
        const hH = this._headH;
        [
            this._coupleCX - 6,
            this._dialCX - 6,
            this._counterX - 4,
        ].forEach(x => {
            this._staticGroup.add(new Konva.Line({
                points: [x, hY + 4, x, hY + hH - 4],
                stroke: '#546e7a', strokeWidth: 0.5, dash: [2, 3],
            }));
        });
        // 功能区文字标签
        [
            { text: '传动', x: this._sprocketCX - 8, y: hY + hH - 10 },
            { text: '磁耦合', x: this._coupleCX - 14, y: hY + hH - 10 },
            { text: '指示', x: this._dialCX - 8, y: hY + hH - 10 },
            { text: '计数器', x: this._counterX + 4, y: hY + hH - 10 },
        ].forEach(l => {
            this._staticGroup.add(new Konva.Text({
                x: l.x, y: l.y, text: l.text,
                fontSize: 6, fill: '#78909c',
            }));
        });
    }

    _drawChamber() {
        const bY = this._bodyY, bH = this._bodyH;
        // 主体外壳
        this._staticGroup.add(new Konva.Rect({
            x: 6, y: bY, width: this.width - 12, height: bH,
            fill: '#e8edf2', stroke: '#607d8b', strokeWidth: 1.5,
            cornerRadius: [0,0,3,3],
        }));
        // 液腔区域（白色底）
        this._staticGroup.add(new Konva.Rect({
            x: this._chamberX - 2, y: this._chamberY - 2,
            width: this._chamberW + 4, height: this._chamberH + 4,
            fill: 'rgba(255,255,255,0.5)', stroke: '#90a4ae', strokeWidth: 0.5,
        }));
        // 标题
        this._staticGroup.add(new Konva.Text({
            x: this._chamberX, y: bY - 10, width: this._chamberW,
            text: '▽ 液位检测腔', fontSize: 7.5, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));
        // 重锤轨道标注
        this._staticGroup.add(new Konva.Text({
            x: this._weightX - 4, y: bY - 10, width: this._weightW + 8,
            text: '▽ 恒力重锤', fontSize: 7, fontStyle: 'bold',
            fill: '#5d4037', align: 'center',
        }));
    }

    _drawScale() {
        const sx = this._scaleX, sy = this._scaleY;
        const sw = this._scaleW, sh = this._scaleH;

        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.8, cornerRadius: 1,
        }));
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const ly    = sy + sh * (i / steps);
            const value = this.totalRange * (1 - i / steps);
            const isMaj = i % 2 === 0;
            this._staticGroup.add(new Konva.Line({
                points: [sx + (isMaj ? 1 : 4), ly, sx + sw - 2, ly],
                stroke: '#546e7a', strokeWidth: isMaj ? 1.2 : 0.7,
            }));
            if (isMaj) {
                this._staticGroup.add(new Konva.Text({
                    x: sx - 18, y: ly - 5, width: 18,
                    text: Math.round(value).toString(),
                    fontSize: 7, fill: '#37474f', align: 'right',
                }));
            }
        }
        this._staticGroup.add(new Konva.Text({
            x: sx - 20, y: sy - 13, text: 'mm', fontSize: 7.5, fill: '#78909c',
        }));
        // 报警线
        const hiY = sy + sh * (1 - this.hiAlarm / 100);
        const loY = sy + sh * (1 - this.loAlarm / 100);
        this._staticGroup.add(new Konva.Line({
            points: [sx - 1, hiY, 6 + this.width - 12, hiY],
            stroke: '#ef5350', strokeWidth: 0.8, dash: [4, 3], opacity: 0.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [sx - 1, loY, 6 + this.width - 12, loY],
            stroke: '#ffa726', strokeWidth: 0.8, dash: [4, 3], opacity: 0.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx + sw - 10, y: hiY - 7, text: 'HH', fontSize: 6.5, fill: '#ef5350',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx + sw - 10, y: loY + 1, text: 'LL', fontSize: 6.5, fill: '#ffa726',
        }));
    }

    _drawGuidePipes() {
        // 左侧导向管（保护从浮子到链轮的钢带）
        this._staticGroup.add(new Konva.Rect({
            x: this._pipeX, y: this._chamberY,
            width: this._pipeW, height: this._chamberH,
            fill: '#90a4ae', stroke:'#78909c', strokeWidth:0.8, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._pipeX + 2, y: this._chamberY + 2,
            width: 2, height: this._chamberH - 4,
            fill: 'rgba(255,255,255,0.2)',
        }));
    }

    _drawLiquid() {
        this._liquidRect = new Konva.Rect({
            x: this._chamberX + 2, y: this._chamberY + this._chamberH,
            width: this._chamberW - 4, height: 0,
            fill: '#1565c0', opacity: 0.65,
        });
        this._liquidSurf = new Konva.Line({
            points: [], stroke: 'rgba(255,255,255,0.45)',
            strokeWidth: 1.5, tension: 0.3,
        });
        this._staticGroup.add(this._liquidRect, this._liquidSurf);
    }

    _drawFloat() {
        const cx = this._chamberX + this._chamberW / 2;
        this._floatGroup = new Konva.Group({ x: cx, y: this._chamberY });

        const fr = 12;
        // 浮球
        this._floatGroup.add(new Konva.Circle({
            x:0, y:0, radius:fr,
            fill:'#ff8f00', stroke:'#e65100', strokeWidth:1.5,
        }));
        // 高光
        this._floatGroup.add(new Konva.Circle({
            x:-4, y:-4, radius:4,
            fill:'rgba(255,255,255,0.3)',
        }));
        // 挂钩耳（钢带连接点）
        this._floatGroup.add(new Konva.Arc({
            x:0, y:-fr+2, innerRadius:1.5, outerRadius:4,
            angle:180, rotation:90,
            fill:'transparent', stroke:'#78909c', strokeWidth:1.2,
        }));
        // 标注
        this._floatGroup.add(new Konva.Text({
            x:-fr-2, y:-fr-12, text:'浮子', fontSize:6.5,
            fill:'#e65100', align:'center',
        }));
        // 上下限线
        this._floatLimLine = new Konva.Line({
            points:[cx-16,0,cx+16,0],
            stroke:'#ff8f00', strokeWidth:0.5, dash:[2,2],
        });
        this._staticGroup.add(this._floatGroup, this._floatLimLine);
    }

    _drawWeight() {
        const wx = this._weightX;
        this._weightGroup = new Konva.Group({ x: wx, y: this._bodyY });

        // 锤体
        this._weightGroup.add(new Konva.Rect({
            x:0, y:-14, width:this._weightW, height:28,
            fill:'#5d4037', stroke:'#3e2723', strokeWidth:1.5, cornerRadius:3,
        }));
        // 高光
        this._weightGroup.add(new Konva.Rect({
            x:3, y:-11, width:4, height:22,
            fill:'rgba(255,255,255,0.12)', cornerRadius:1,
        }));
        // 吊环
        this._weightGroup.add(new Konva.Circle({
            x:this._weightW/2, y:-18, radius:4,
            fill:'transparent', stroke:'#78909c', strokeWidth:1.5,
        }));
        // 标注
        this._weightGroup.add(new Konva.Text({
            x:0, y:-5, width:this._weightW,
            text:'重锤', fontSize:7, fontStyle:'bold', fill:'#d7ccc8', align:'center',
        }));
        this._staticGroup.add(this._weightGroup);
    }

    _drawTape() {
        const spY = this._sprocketCY;

        // 左侧钢带（浮子 → 链轮）
        this._tapeLeft = new Konva.Line({
            points:[], stroke:'#78909c', strokeWidth:4, lineCap:'round',
        });
        this._tapeLeftE1 = new Konva.Line({
            points:[], stroke:'#90a4ae', strokeWidth:0.6,
        });
        this._tapeLeftE2 = new Konva.Line({
            points:[], stroke:'#90a4ae', strokeWidth:0.6,
        });

        // 右侧钢带（链轮 → 重锤）
        this._tapeRight = new Konva.Line({
            points:[], stroke:'#78909c', strokeWidth:4, lineCap:'round',
        });
        this._tapeRightE1 = new Konva.Line({
            points:[], stroke:'#90a4ae', strokeWidth:0.6,
        });
        this._tapeRightE2 = new Konva.Line({
            points:[], stroke:'#90a4ae', strokeWidth:0.6,
        });

        // 穿孔（小圆孔）
        this._leftHoles = [];
        this._rightHoles = [];
        for (let i = 0; i < 42; i++) {
            const cL = new Konva.Circle({ radius: 1.2, fill:'#37474f' });
            const cR = new Konva.Circle({ radius: 1.2, fill:'#37474f' });
            this._leftHoles.push(cL);
            this._rightHoles.push(cR);
            this._staticGroup.add(cL, cR);
        }

        this._staticGroup.add(
            this._tapeLeft, this._tapeLeftE1, this._tapeLeftE2,
            this._tapeRight, this._tapeRightE1, this._tapeRightE2,
        );

        // 链轮顶部弧形包络（钢带绕过链轮）
        this._tapeTopArc = new Konva.Arc({
            x: this._sprocketCX, y: this._sprocketCY,
            innerRadius: this._sprocketR - 2,
            outerRadius: this._sprocketR + 2,
            angle: 180, rotation: 180,
            fill:'#78909c', stroke:'#546e7a', strokeWidth:0.5,
        });
        this._staticGroup.add(this._tapeTopArc);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: this._pipeX - 4, y: this._bodyY + 4,
            text: '← 钢带 ↑ →', fontSize: 6, fill: '#607d8b',
        }));
    }

    _drawPulleys() {
        const pR = this._pulleyR;
        const py = this._pulleyBY;

        // 左导向轮
        this._pulleyLeftGrp = new Konva.Group({ x: this._tapeLX, y: py });
        this._pulleyLeftGrp.add(new Konva.Circle({
            radius:pR, fill:'#546e7a', stroke:'#37474f', strokeWidth:1,
        }));
        this._pulleyLeftGrp.add(new Konva.Circle({
            radius:pR-3, fill:'#78909c', stroke:'#546e7a', strokeWidth:0.5,
        }));
        this._pulleyLeftGrp.add(new Konva.Circle({ radius:2, fill:'#263238' }));
        for (let i=0; i<4; i++) {
            const a=i*90*Math.PI/180;
            this._pulleyLeftGrp.add(new Konva.Line({
                points:[0,0,(pR-3)*Math.cos(a),(pR-3)*Math.sin(a)],
                stroke:'#455a64', strokeWidth:0.5,
            }));
        }
        this._staticGroup.add(this._pulleyLeftGrp);

        // 右导向轮
        this._pulleyRightGrp = new Konva.Group({ x: this._tapeRX, y: py });
        this._pulleyRightGrp.add(new Konva.Circle({
            radius:pR, fill:'#546e7a', stroke:'#37474f', strokeWidth:1,
        }));
        this._pulleyRightGrp.add(new Konva.Circle({
            radius:pR-3, fill:'#78909c', stroke:'#546e7a', strokeWidth:0.5,
        }));
        this._pulleyRightGrp.add(new Konva.Circle({ radius:2, fill:'#263238' }));
        for (let i=0; i<4; i++) {
            const a=i*90*Math.PI/180;
            this._pulleyRightGrp.add(new Konva.Line({
                points:[0,0,(pR-3)*Math.cos(a),(pR-3)*Math.sin(a)],
                stroke:'#455a64', strokeWidth:0.5,
            }));
        }
        this._staticGroup.add(this._pulleyRightGrp);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x:this._tapeLX-8, y:py+pR+2, text:'导向轮', fontSize:6, fill:'#78909c',
        }));
        this._staticGroup.add(new Konva.Text({
            x:this._tapeRX-8, y:py+pR+2, text:'导向轮', fontSize:6, fill:'#78909c',
        }));
    }

    _drawSprocket() {
        const cx=this._sprocketCX, cy=this._sprocketCY, R=this._sprocketR;
        this._sprocketGrp = new Konva.Group({ x:cx, y:cy });

        // 12 齿
        for (let i=0; i<12; i++) {
            const a=i*30*Math.PI/180;
            const tx=(R+2)*Math.cos(a);
            const ty=(R+2)*Math.sin(a);
            const tooth = new Konva.Rect({
                x:tx-2.5, y:ty-4, width:5, height:8,
                fill:'#546e7a', stroke:'#37474f', strokeWidth:0.5,
                rotation:i*30+15,
            });
            this._sprocketGrp.add(tooth);
        }
        this._sprocketGrp.add(new Konva.Circle({
            radius:R, fill:'#607d8b', stroke:'#455a64', strokeWidth:1.5,
        }));
        this._sprocketGrp.add(new Konva.Circle({
            radius:R-4, fill:'#78909c', stroke:'#546e7a', strokeWidth:0.5,
        }));
        this._sprocketGrp.add(new Konva.Circle({ radius:4, fill:'#37474f' }));
        this._sprocketGrp.add(new Konva.Line({
            points:[-R-4,0,R+4,0], stroke:'#455a64', strokeWidth:3,
        }));
        this._staticGroup.add(this._sprocketGrp);

        this._staticGroup.add(new Konva.Text({
            x:cx-26, y:cy+R+4, text:'▾ 链轮(12齿)', fontSize:6.5, fill:'#37474f',
        }));
    }

    _drawMagneticCoupling() {
        const cx=this._coupleCX, cy=this._coupleCY, R=this._coupleR;
        this._couplingGrp = new Konva.Group({ x:cx, y:cy });

        this._couplingGrp.add(new Konva.Circle({
            radius:R+4, fill:'#455a64', stroke:'#263238', strokeWidth:1,
        }));
        this._couplingGrp.add(new Konva.Circle({
            radius:R-1, fill:'transparent', stroke:'#546e7a', strokeWidth:0.8, dash:[2,2],
        }));

        this._couplingInner = new Konva.Group();
        this._couplingInner.add(new Konva.Rect({
            x:-5, y:-R+3, width:10, height:8,
            fill:'#ef5350', cornerRadius:2,
        }));
        this._couplingInner.add(new Konva.Rect({
            x:-5, y:R-11, width:10, height:8,
            fill:'#42a5f5', cornerRadius:2,
        }));
        this._couplingInner.add(new Konva.Text({
            x:-3, y:-R+4, text:'N', fontSize:6, fontStyle:'bold', fill:'#fff',
        }));
        this._couplingInner.add(new Konva.Text({
            x:-3, y:R-10, text:'S', fontSize:6, fontStyle:'bold', fill:'#fff',
        }));
        this._couplingInner.add(new Konva.Circle({ radius:3, fill:'#263238' }));
        this._couplingGrp.add(this._couplingInner);

        // 磁感线
        for (let i=0; i<6; i++) {
            const a=(i*60+15)*Math.PI/180;
            this._couplingGrp.add(new Konva.Line({
                points:[(R-2)*Math.cos(a),(R-2)*Math.sin(a),(R+3)*Math.cos(a),(R+3)*Math.sin(a)],
                stroke:'#4fc3f7', strokeWidth:0.4, dash:[1,2],
            }));
        }
        this._staticGroup.add(this._couplingGrp);

        // 连轴示意线
        this._staticGroup.add(new Konva.Line({
            points:[this._sprocketCX+this._sprocketR, this._sprocketCY,
                    this._coupleCX-this._coupleR-4, this._coupleCY],
            stroke:'#546e7a', strokeWidth:1.5, dash:[3,3],
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-18, y:cy+R+6, text:'磁耦合', fontSize:6.5, fill:'#37474f',
        }));
    }

    _drawPointerDial() {
        const cx=this._dialCX, cy=this._dialCY, R=this._dialR;
        this._dialGroup = new Konva.Group({ x:cx, y:cy });

        this._dialGroup.add(new Konva.Circle({
            radius:R, fill:'#eceff1', stroke:'#546e7a', strokeWidth:1.5,
        }));
        this._dialGroup.add(new Konva.Circle({
            radius:R-3, fill:'transparent', stroke:'#b0bec5', strokeWidth:0.5,
        }));
        // 刻度 -135° ~ +135°
        for (let i=0; i<=10; i++) {
            const pct=i/10;
            const angle=-135+pct*270;
            const rad=angle*Math.PI/180;
            const isMaj=i%5===0||i===0||i===10;
            const r1=isMaj?R-8:R-5;
            const r2=R-2;
            this._dialGroup.add(new Konva.Line({
                points:[r1*Math.cos(rad),r1*Math.sin(rad),r2*Math.cos(rad),r2*Math.sin(rad)],
                stroke:'#37474f', strokeWidth:isMaj?1:0.5,
            }));
            if (isMaj) {
                const lr=R-13;
                this._dialGroup.add(new Konva.Text({
                    x:lr*Math.cos(rad)-5, y:lr*Math.sin(rad)-4,
                    text:(i*10).toString(), fontSize:5.5, fill:'#37474f',
                }));
            }
        }
        // 指针
        this._ptrGroup = new Konva.Group();
        this._ptrGroup.add(new Konva.Line({
            points:[-10,0,R-5,0], stroke:'#c62828', strokeWidth:2.5, lineCap:'round',
        }));
        this._ptrGroup.add(new Konva.Line({
            points:[R-5,0,R-1,-3,R-1,3],
            closed:true, fill:'#c62828', stroke:'none',
        }));
        this._ptrGroup.add(new Konva.Circle({ radius:3, fill:'#37474f', stroke:'#263238', strokeWidth:0.5 }));
        this._dialGroup.add(this._ptrGroup);
        this._dialGroup.add(new Konva.Text({
            x:R-6, y:R-12, text:'%', fontSize:5.5, fill:'#546e7a',
        }));
        this._staticGroup.add(this._dialGroup);
        this._staticGroup.add(new Konva.Text({
            x:cx-14, y:cy+R+6, text:'指针盘', fontSize:6.5, fill:'#37474f',
        }));
    }

    _drawCounter() {
        const cx=this._counterX, cy=this._counterY;
        const cw=this._counterW, ch=this._counterH;
        this._counterGroup = new Konva.Group({ x:cx, y:cy });

        this._counterGroup.add(new Konva.Rect({
            x:0, y:0, width:cw, height:ch,
            fill:'#1a1a2e', stroke:'#34495e', strokeWidth:1.5, cornerRadius:3,
        }));
        this._counterGroup.add(new Konva.Text({
            x:0, y:2, width:cw,
            text:'计数器', fontSize:6.5, fontStyle:'bold', fill:'#546e7a', align:'center',
        }));

        const digitW=12, digitH=18;
        const totalW=5*digitW+4;
        const startX=(cw-totalW)/2;
        const digitY=13;
        this._digitRects=[];
        this._digitTexts=[];

        for (let i=0; i<5; i++) {
            const dx=startX+i*(digitW+1);
            const rect=new Konva.Rect({
                x:dx, y:digitY, width:digitW, height:digitH,
                fill:'#020c14', stroke:'#1a3040', strokeWidth:0.8, cornerRadius:1,
            });
            const txt=new Konva.Text({
                x:dx, y:digitY+2, width:digitW,
                text:'0', fontSize:12, fontFamily:'Courier New, monospace',
                fontStyle:'bold', fill:'#66bb6a', align:'center',
            });
            this._digitRects.push(rect);
            this._digitTexts.push(txt);
            this._counterGroup.add(rect, txt);
        }
        this._counterGroup.add(new Konva.Text({
            x:startX+totalW+1, y:digitY+2, text:'mm', fontSize:6.5, fill:'#546e7a',
        }));
        this._staticGroup.add(this._counterGroup);
    }

    _drawDigitalDisplay() {
        const cx=this._counterX, cy=this._counterY;
        const cw=this._counterW;
        const lcdY=cy+this._counterH+4;

        this._lcdBg=new Konva.Rect({
            x:cx+2, y:lcdY, width:cw-4, height:16,
            fill:'#020c14', stroke:'#1a3040', strokeWidth:0.8, cornerRadius:2,
        });
        this._lcdPct=new Konva.Text({
            x:cx+2, y:lcdY+1, width:cw-4,
            text:'40.0 %', fontSize:7.5, fontFamily:'Courier New, monospace',
            fontStyle:'bold', fill:'#66bb6a', align:'center',
        });
        this._lcdAlarm=new Konva.Text({
            x:cx+2, y:lcdY+9, width:cw-4,
            text:'● 正常', fontSize:5.5, fill:'#66bb6a', align:'center',
        });
        this._staticGroup.add(this._lcdBg, this._lcdPct, this._lcdAlarm);
    }

    _drawBottomFlange() {
        const bY=this._bodyY, bH=this._bodyH;
        // 液腔底部法兰
        const cx=this._chamberX+this._chamberW/2;
        const by=bY+bH;
        this._staticGroup.add(new Konva.Rect({
            x:cx-20, y:by, width:40, height:10,
            fill:'#607d8b', stroke:'#37474f', strokeWidth:1.5, cornerRadius:2,
        }));
        [-10,10].forEach(dx=>{
            this._staticGroup.add(new Konva.Circle({
                x:cx+dx, y:by+5, radius:2.5, fill:'#37474f',
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x:cx-30, y:by+13, text:'▽ 过程连接 | DN50 PN16', fontSize:6, fill:'#90a4ae',
        }));
    }

    _setupDrag() {
        const hit=new Konva.Rect({
            x:this._chamberX, y:this._chamberY,
            width:this._chamberW, height:this._chamberH,
            fill:'transparent', listening:true,
        });
        hit.on('mousedown touchstart', e=>{
            e.cancelBubble=true;
            this._dragStartY=e.evt.clientY??e.evt.touches?.[0]?.clientY??0;
            this._dragStartL=this._manualLevel;
            this._dragActive=true;
        });
        const mv=e=>{
            if(!this._dragActive) return;
            const cy=e.clientY??e.touches?.[0]?.clientY??0;
            this._manualLevel=Math.max(0,Math.min(100,this._dragStartL+(this._dragStartY-cy)/this._chamberH*100));
        };
        const up=()=>{ this._dragActive=false; };
        window.addEventListener('mousemove',mv);
        window.addEventListener('touchmove',mv,{passive:true});
        window.addEventListener('mouseup',up);
        window.addEventListener('touchend',up);
        this._interactGroup.add(hit);
    }

    // ═══════════════════════════════════════════
    //  动画主循环 (20fps)
    // ═══════════════════════════════════════════
    tick(dt) {
        this._tickPhysics(dt);
        this._tickPositions(dt);
        this._tickLiquid();
        this._tickFloat();
        this._tickWeight();
        this._tickTape();
        this._tickPulleys();
        this._tickSprocket();
        this._tickCoupling();
        this._tickPointer();
        this._tickCounter();
        this._tickDisplay();
    
        this._refreshCache();
    }

    _tickPhysics(dt) {
        this.liquidLevel = this._manualLevel;
        this._displayLevel += (this.liquidLevel-this._displayLevel)*Math.min(1,dt*5);
        this.levelMM=(this._displayLevel/100)*this.totalRange;
        this.alarmHi=this.liquidLevel>this.hiAlarm;
        this.alarmLo=this.liquidLevel<this.loAlarm;
        this._surfPhase+=dt*3;
    }

    _tickPositions(dt) {
        const lv=this._displayLevel;
        this._calcPositions(lv);

        const ch=this._chamberH-8;
        const lh=(lv/100)*ch;
        const prev=this._prevLevel;
        const prevLh=prev<0?lh:(prev/100)*ch;
        const floatOffset=lh-prevLh;

        // 链轮角度累积
        this._sprocketAngle+=floatOffset*0.8;
        this._couplingAngle=this._sprocketAngle*0.6;
        this._pointerAngle=-135+(lv/100)*270;
        this._pulleyL+=floatOffset*0.5;
        this._pulleyR+=floatOffset*0.5;

        // 计数器数值
        const mmVal=Math.round(this.levelMM);
        this._counterDigits=[
            Math.floor(mmVal/10000)%10,
            Math.floor(mmVal/1000)%10,
            Math.floor(mmVal/100)%10,
            Math.floor(mmVal/10)%10,
            mmVal%10,
        ];
        this._prevLevel=lv;
    }

    _tickLiquid() {
        const ch=this._chamberH-8;
        const lh=(this._displayLevel/100)*ch;
        const top=this._chamberY+6+ch-lh;

        this._liquidRect.y(top);
        this._liquidRect.height(Math.max(0,lh));

        const fr=this._displayLevel/100;
        this._liquidRect.fill(`rgba(${Math.round(21+fr*12)},${Math.round(101+fr*30)},${Math.round(192+fr*20)},0.70)`);

        if(lh>3) {
            const pts=[];
            for(let i=0;i<=6;i++) {
                const x=this._chamberX+2+(this._chamberW-4)*i/6;
                pts.push(x,top+Math.sin(this._surfPhase+i*1.0)*1.0);
            }
            this._liquidSurf.points(pts);
        } else this._liquidSurf.points([]);
    }

    _tickFloat() {
        const cx=this._chamberX+this._chamberW/2;
        if(this._floatGroup) {
            this._floatGroup.x(cx);
            this._floatGroup.y(this._floatY);
        }
        if(this._floatLimLine) {
            this._floatLimLine.y(this._floatY+14);
            this._floatLimLine.visible(this._displayLevel>1);
        }
    }

    _tickWeight() {
        if(this._weightGroup) this._weightGroup.y(this._weightY);
    }

    _tickTape() {
        const spY=this._sprocketCY;
        // 浮子：钢带从浮子挂钩耳（浮子顶部）引出
        const floatTop=this._floatY-10;
        // 重锤：钢带连接至重锤吊环顶部
        const weightTop=this._weightY-18;

        // 左钢带：链轮→浮子
        this._tapeLeft.points([this._tapeLX,spY,this._tapeLX,floatTop]);
        this._tapeLeftE1.points([this._tapeLX-2,spY,this._tapeLX-2,floatTop]);
        this._tapeLeftE2.points([this._tapeLX+2,spY,this._tapeLX+2,floatTop]);

        // 右钢带：链轮→重锤
        this._tapeRight.points([this._tapeRX,spY,this._tapeRX,weightTop]);
        this._tapeRightE1.points([this._tapeRX-2,spY,this._tapeRX-2,weightTop]);
        this._tapeRightE2.points([this._tapeRX+2,spY,this._tapeRX+2,weightTop]);

        this._tapeTopArc.x(this._sprocketCX);
        this._tapeTopArc.y(this._sprocketCY);

        // 穿孔（从链轮沿钢带向下排列）
        const pitch=7;
        const nL=Math.floor((floatTop-spY)/pitch);
        const nR=Math.floor((weightTop-spY)/pitch);

        for(let i=0;i<this._leftHoles.length;i++) {
            if(i<nL) {
                const hy=spY+i*pitch+pitch/2;
                if(hy<=floatTop && hy>=spY) {
                    this._leftHoles[i].x(this._tapeLX);
                    this._leftHoles[i].y(hy);
                    this._leftHoles[i].visible(true);
                } else this._leftHoles[i].visible(false);
            } else this._leftHoles[i].visible(false);
        }
        for(let i=0;i<this._rightHoles.length;i++) {
            if(i<nR) {
                const hy=spY+i*pitch+pitch/2;
                if(hy<=weightTop && hy>=spY) {
                    this._rightHoles[i].x(this._tapeRX);
                    this._rightHoles[i].y(hy);
                    this._rightHoles[i].visible(true);
                } else this._rightHoles[i].visible(false);
            } else this._rightHoles[i].visible(false);
        }
    }

    _tickPulleys() {
        if(this._pulleyLeftGrp) this._pulleyLeftGrp.rotation(this._pulleyL);
        if(this._pulleyRightGrp) this._pulleyRightGrp.rotation(this._pulleyR);
    }

    _tickSprocket() {
        if(this._sprocketGrp) this._sprocketGrp.rotation(this._sprocketAngle);
    }

    _tickCoupling() {
        if(this._couplingInner) this._couplingInner.rotation(this._couplingAngle);
    }

    _tickPointer() {
        if(this._ptrGroup) this._ptrGroup.rotation(this._pointerAngle);
    }

    _tickCounter() {
        for(let i=0;i<5;i++) {
            if(this._digitTexts[i]) this._digitTexts[i].text(this._counterDigits[i].toString());
        }
    }

    _tickDisplay() {
        const mc=this.alarmHi?'#ef5350':this.alarmLo?'#ffa726':'#66bb6a';
        if(this._lcdPct) {
            this._lcdPct.text(`${this._displayLevel.toFixed(1)} %`);
            this._lcdPct.fill(mc);
        }
        if(this._lcdAlarm) {
            this._lcdAlarm.text(this.alarmHi?'⬆ 高液位报警':this.alarmLo?'⬇ 低液位报警':'● 正常');
            this._lcdAlarm.fill(mc);
        }
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(level) {
        if(typeof level==='number') this._manualLevel=Math.max(0,Math.min(100,level));
    }

    getConfigFields() {
        return [
            { label:'位号/名称',     key:'id',         type:'text'   },
            { label:'量程 (mm)',      key:'totalRange', type:'number' },
            { label:'高报阈值 (%)',   key:'hiAlarm',    type:'number' },
            { label:'低报阈值 (%)',   key:'loAlarm',    type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         =cfg.id         ||this.id;
        this.totalRange =parseFloat(cfg.totalRange)||this.totalRange;
        this.hiAlarm    =parseFloat(cfg.hiAlarm)   ??this.hiAlarm;
        this.loAlarm    =parseFloat(cfg.loAlarm)   ??this.loAlarm;
        this.config={...this.config,...cfg};
    }

    destroy() {
        super.destroy?.();
    }
}
