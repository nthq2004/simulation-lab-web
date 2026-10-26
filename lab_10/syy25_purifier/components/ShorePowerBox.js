import { BaseComponent } from './BaseComponent.js';

/**
 * ShorePowerBox - 岸电箱仿真组件
 * 左：操作面板（3 圆形金属环指示灯并行 + 相序旋钮 + 合/分闸按钮）
 * 右：原理界面（进线检测支路不接地 + K/M 换相 + 空气断路器刀片式）
 * 电气：type='ShorePowerBox'，stampShorePowerBoxes 求解。
 *   相序1：in1→t1,in2→t2,in3→t3；相序2：in1→t1,in2→t3,in3→t2。
 */
export class ShorePowerBox extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = Math.max(300, config.width || 320);
        this.height = Math.max(280, config.height || 320);
        this.type = 'ShorePowerBox';
        this.special = 'ShorePowerBox';
        this.cache = 'fixed';
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this.config = {
            id: this.id, label: this.label, lineSeq: this._lineSeq,
            knob: this._knob, breakerOn: this._breakerOn, animDur: this._animDur
        };
        this.addPort(this._inXs[0], 2, 'in1', 'wire');
        this.addPort(this._inXs[1], 2, 'in2', 'wire');
        this.addPort(this._inXs[2], 2, 'in3', 'wire');
        this.addPort(this._inXs[0], this.height - 2, 't1', 'wire', 'p');
        this.addPort(this._inXs[1], this.height - 2, 't2', 'wire', 'p');
        this.addPort(this._inXs[2], this.height - 2, 't3', 'wire', 'p');
        // ── 右侧船体/中线接线柱 N（对接岸电电源中性线）──
        this.addPort(this._portN.x, this._portN.y, 'n', 'wire');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._panelW = Math.min(170, Math.round(W * 0.5));
        this._divX = this._panelW;

        const r0 = this._divX + 8, r1 = W - 8;
        const xc = (r0 + r1) / 2;
        this._inXs = [-1, 0, 1].map(i => Math.round(xc + i * 34));

        // 换相区（上），检测支路（挂 M 线，下），断路器（最下）——整体紧凑
        this._yK = 58;
        this._yM = 118;
        this._detYs = [146, 168, 190];
        this._detCX = this._inXs[2] + 16;         // 三元件同一 x 对齐（面板加宽后右区收窄，稍内收）
        this._detVX = this._detCX + 9 + 20;       // 元件右端引线 20px → 公共竖线
        this._detNTop = this._detYs[0] - 10;
        this._detNBot = this._detYs[2] + 16;
        this._brInY = 224;
        this._brOutY = 252;
        this._brBot = 266;
        // 右侧船体/中线接线柱（检测公共点 N 一侧，靠下空白区）
        this._portN = { x: this.width - 3, y: 240 };

        this._lampD = 26;
        this._ringD = 32;
        this._lampCX = [26, 80, 134];     // 灯距加大（160 宽面板内对称）
        this._lampCY = 96;                // 指示灯（LCD 下方）
        this._lcd = { x: 12, y: 36, w: 136, h: 22 };   // 液晶屏（黑底）
        this._knobCX = 80;
        this._knobCY = 190;
        this._knobR = 32;
        this._btnYL = 268;
        this._btnCX = [50, 110];          // 按钮距加大
        this._btnR = 17;            // 圆形按钮半径
    }

    _initParameters(config) {
        this.label = config.label || '岸电箱';
        this.function = '岸电箱';
        this._lineSeq = (config.lineSeq || 'pos').toLowerCase() === 'neg' ? 'neg' : 'pos';
        this._knob = config.knob !== undefined ? (config.knob === 2 ? 2 : (config.knob === 1 ? 1 : 0)) : 0;
        this._breakerOn = !!config.breakerOn;
        this._animDur = config.animDur !== undefined ? config.animDur : 0.12;
        this._iBuf = new Array(40).fill(0);
        this._iBufSum = 0;
        this._iBufIdx = 0;
        this._iBufCount = 0;
        this._inRms = 0;
        this._freq = 50;
        // 实时相序检测：进线相序由算法判定（初值取配置 lineSeq，有电后算法覆盖）
        this._phase = this._lineSeq === 'neg' ? 'neg' : 'pos';
        this._p12 = 0;          // 上一帧 v12（L1-L2）
        this._p23 = 0;          // 上一帧 v23（L2-L3）
        this._seqAcc = 0;       // 叉积累加
        this._seqN = 0;         // 参与累计的帧数
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        this._drawPanel();
        this._drawLampsBase();
        this._drawKnobBase();
        this._drawButtons();
        this._drawMainsRoute();
        this._drawTitle();
    }

    _drawPanel() {
        const s = this._staticGroup;
        s.add(new Konva.Rect({
            x: 0, y: 0, width: this._divX, height: this.height,
            fill: '#dfe5f0', stroke: '#8898b0', strokeWidth: 1.5
        }));
        s.add(new Konva.Line({
            points: [this._divX, 6, this._divX, this.height - 6],
            stroke: '#8898b0', strokeWidth: 1.5, dash: [5, 3]
        }));
        s.add(new Konva.Rect({
            x: this._divX + 1, y: 2, width: this.width - this._divX - 3, height: this.height - 4,
            fill: 'rgba(255,255,255,0.35)'
        }));
        // 液晶屏（黑底，位于指示灯上方）
        const lc = this._lcd;
        s.add(new Konva.Rect({
            x: lc.x - 2, y: lc.y - 2, width: lc.w + 4, height: lc.h + 4,
            fill: '#2a2e36', stroke: '#1a1e24', strokeWidth: 1, cornerRadius: 4, listening: false
        }));
        s.add(new Konva.Rect({
            x: lc.x, y: lc.y, width: lc.w, height: lc.h,
            fill: '#05070a', listening: false
        }));
        ['电源', '正序', '负序'].forEach((t, i) => {
            s.add(new Konva.Text({
                x: this._lampCX[i] - 16, y: this._lampCY + this._ringD / 2 + 5, width: 32,
                text: t, fontSize: 12, fontStyle: 'bold', fill: '#3a4a6a', align: 'center', listening: false
            }));
        });
        s.add(new Konva.Text({
            x: this._knobCX - 62, y: this._knobCY - 38, text: '相序1',
            fontSize: 12, fill: '#02780a', width: 48, align: 'center', listening: false
        }));
        s.add(new Konva.Text({
            x: this._knobCX - 18, y: this._knobCY - 50, width: 36, text: 'OFF',
            fontSize: 12, fontStyle: 'bold', fill: '#0a0a0a', align: 'center', listening: false
        }));
        s.add(new Konva.Text({
            x: this._knobCX + 20, y: this._knobCY - 38, text: '相序2',
            fontSize: 12, fill: '#f96306', width: 48, align: 'center', listening: false
        }));
        s.add(new Konva.Text({
            x: this._knobCX - 30, y: this._knobCY + 38, width: 60, text: '相序转换',
            fontSize: 12, fontStyle: 'bold', fill: '#3a4a6a', align: 'center', listening: false
        }));
    }

    /** 圆形金属环灯（一排三个） */
    _drawLampsBase() {
        const s = this._staticGroup;
        for (let i = 0; i < 3; i++) {
            const cx = this._lampCX[i], cy = this._lampCY;
            const g = new Konva.Group({ x: cx, y: cy, listening: false });
            g.add(new Konva.Circle({
                x: 0, y: 0, radius: this._ringD / 2, fill: '#3c4350',
                stroke: '#9aa2ac', strokeWidth: 2
            }));
            g.add(new Konva.Circle({
                x: 0, y: 0, radius: this._lampD / 2 + 1, fill: '#565e6c',
                stroke: '#a8adb6', strokeWidth: 1.5
            }));
            g.add(new Konva.Circle({
                x: 0, y: 0, radius: this._lampD / 2 - 1, fill: '#232a36',
                stroke: '#0e1218', strokeWidth: 1
            }));
            this._staticGroup.add(g);
        }
    }

    /** 相序旋钮底盘（加大半径） */
    _drawKnobBase() {
        const s = this._staticGroup, cx = this._knobCX, cy = this._knobCY, R = this._knobR;
        s.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#e8eaee', stroke: '#7a7f8a', strokeWidth: 2 }));
        s.add(new Konva.Circle({ x: cx, y: cy, radius: R - 6, fill: '#f4f5f8', stroke: '#a0a5ae', strokeWidth: 1 }));
    }

    /** 出口断路器 合闸带灯 / 分闸带灯按钮：圆形 + 白色金属环（亮/暗色由动态 LED 圆片叠加） */
    _drawButtons() {
        const s = this._staticGroup;
        const mk = (cx, label) => {
            const R = this._btnR;
            // 外圈：银色金属环
            s.add(new Konva.Circle({
                x: cx, y: this._btnYL, radius: R + 3,
                fill: '#8a8f98', stroke: '#5a6068', strokeWidth: 1
            }));
            // 内圈：白色环
            s.add(new Konva.Circle({
                x: cx, y: this._btnYL, radius: R,
                fill: '#fbfbfa', stroke: '#b9bdc4', strokeWidth: 1.5
            }));
            // 灯罩（深暗圆，亮/暗色由动态 LED 覆盖）
            s.add(new Konva.Circle({
                x: cx, y: this._btnYL, radius: R - 4,
                fill: '#3a3f46', stroke: '#20242a', strokeWidth: 1
            }));
            // 按钮下方文字标签
            s.add(new Konva.Text({
                x: cx - this._btnR * 2, y: this._btnYL + this._btnR + 6,
                width: this._btnR * 4, text: label, fontSize: 12, fontStyle: 'bold',
                fill: '#3a4a6a', align: 'center', listening: false
            }));
        };
        mk(this._btnCX[0], '合闸');
        mk(this._btnCX[1], '分闸');
    }

    /** 右原理区静态：进线→K/M 换相区(仅接线柱圆点)→检测支路→断路器→输出(T与端口重合) */
    _drawMainsRoute() {
        const s = this._staticGroup;
        const cols = ['#e03030', '#20a030', '#2050e0'];
        const xs = this._inXs;
        const dCx = this._detCX;

        for (let i = 0; i < 3; i++) {
            const x = xs[i], detY = this._detYs[i];
            // 进线竖线：顶部 → K 接线柱（短进线段）
            s.add(new Konva.Line({ points: [x, 10, x, this._yK], stroke: cols[i], strokeWidth: 2.2, listening: false }));
            s.add(new Konva.Text({
                x: x - 12, y: 6, text: ['L1', 'L2', 'L3'][i], fontSize: 12,
                fontStyle: 'bold', fill: cols[i], listening: false
            }));
            // K / M 接线柱（仅圆点，无引线、无文字标注）
            s.add(new Konva.Circle({ x: x, y: this._yK, radius: 4, fill: '#e8c86a', stroke: '#6a5a28', strokeWidth: 1, listening: false }));
            s.add(new Konva.Circle({ x: x, y: this._yM, radius: 4, fill: '#e8c86a', stroke: '#6a5a28', strokeWidth: 1, listening: false }));
            // M 竖线：经检测区 → 断路器上端
            s.add(new Konva.Line({ points: [x, this._yM + 5, x, this._brInY], stroke: cols[i], strokeWidth: 2.2, listening: false }));
            // 检测支路：M 竖线向右接 电容 / 灯泡（三元件同一 x 对齐，右端引线 20px 到公共线）
            s.add(new Konva.Line({ points: [x + 3, detY, dCx - 9, detY], stroke: '#9aa0a8', strokeWidth: 1.3, listening: false }));
            if (i === 0) {
                // 电容（加大：两竖条 ±5）
                s.add(new Konva.Line({ points: [dCx - 3, detY - 5, dCx - 3, detY + 5], stroke: '#e03030', strokeWidth: 3.5, listening: false }));
                s.add(new Konva.Line({ points: [dCx + 1, detY - 5, dCx + 1, detY + 5], stroke: '#e03030', strokeWidth: 3.5, listening: false }));
                s.add(new Konva.Text({ x: dCx - 3, y: detY - 14, text: 'C', fontSize: 10, fontStyle: 'bold', fill: '#3a3e44', listening: false }));
            } else {
                // 灯泡（加大 r=9）：第 2 个绿灯 / 第 3 个红灯
                const lampCol = i === 1 ? '#20a030' : '#e03030';
                s.add(new Konva.Circle({ x: dCx, y: detY, radius: 9, fill: '#f7f8fa', stroke: '#7a7f8a', strokeWidth: 1.2, listening: false }));
                s.add(new Konva.Line({ points: [dCx - 4, detY - 4, dCx + 4, detY + 4], stroke: lampCol, strokeWidth: 1.6, listening: false }));
                s.add(new Konva.Line({ points: [dCx - 4, detY + 4, dCx + 4, detY - 4], stroke: lampCol, strokeWidth: 1.6, listening: false }));
            }
            // 元件右端引线（20px）→ 公共竖线
            s.add(new Konva.Line({ points: [dCx + 9, detY, this._detVX, detY], stroke: '#8a8f98', strokeWidth: 1.2, listening: false }));
            // 断路器下段 → 输出端子
            s.add(new Konva.Line({ points: [x, this._brOutY, x, this._brBot], stroke: cols[i], strokeWidth: 2.2, listening: false }));
            const tY = this.height - 2;      // T 端子与端口重合
            s.add(new Konva.Line({ points: [x, this._brBot + 3, x, tY - 3], stroke: cols[i], strokeWidth: 2.2, listening: false }));
            s.add(new Konva.Circle({ x: x, y: tY, radius: 5.5, fill: '#d4aa52', stroke: '#6a5a28', strokeWidth: 1, listening: false }));
            s.add(new Konva.Text({
                x: x - 12, y: tY - 20, text: ['T1', 'T2', 'T3'][i], fontSize: 12,
                fontStyle: 'bold', fill: cols[i], listening: false
            }));
            // 断路器上/下静触点（× 与圆）
            s.add(new Konva.Line({ points: [x - 4, this._brInY - 4, x + 4, this._brInY + 4], stroke: cols[i], strokeWidth: 2, listening: false }));
            s.add(new Konva.Line({ points: [x - 4, this._brInY + 4, x + 4, this._brInY - 4], stroke: cols[i], strokeWidth: 2, listening: false }));
            s.add(new Konva.Circle({ x: x, y: this._brOutY, radius: 4, fill: '#e8c86a', stroke: '#6a5a28', strokeWidth: 1, listening: false }));
        }

        // 检测公共竖线（悬空中性点，不接地）
        s.add(new Konva.Line({
            points: [this._detVX, this._detNTop, this._detVX, this._detNBot],
            stroke: '#8a8f98', strokeWidth: 1.4, listening: false
        }));
        const nx = this._detVX, ny = this._detNBot;
        s.add(new Konva.Circle({ x: nx, y: ny, radius: 3, fill: '#8a8f98', listening: false }));
        s.add(new Konva.Text({
            x: nx + 6, y: ny - 8, text: 'N', fontSize: 10, fontStyle: 'bold',
            fill: '#3a4a6a', listening: false
        }));
    }

    _drawTitle() {
        this._staticGroup.add(new Konva.Rect({
            x: 5, y: 5, width: this._divX - 10, height: 22,
            fill: '#3a4a5a', cornerRadius: 3
        }));
        this._staticGroup.add(new Konva.Text({
            x: 5, y: 8, width: this._divX - 10, align: 'center',
            text: this.label, fontSize: 14, fontStyle: 'bold', fill: '#f0f4f8', listening: false
        }));
    }

    _createDynamicNodes() {
        this._createLampGlows();
        this._createKnobIndicator();
        this._createSwitchLines();
        this._createBreakerBlades();
        this._createBtnLeds();
        this._createLCD();
    }

    /** 液晶屏文字（黑底亮绿粗体）：主值行 + 箱号行；无电显示 ---V ---Hz */
    _createLCD() {
        const lc = this._lcd;
        this._lcdMain = new Konva.Text({
            x: lc.x + 2, y: lc.y + 2, width: lc.w - 4,
            text: '---V,---Hz', fontSize: 16, fontStyle: 'bold',
            fontFamily: 'Consolas, monospace', fill: '#3dff6e', align: 'center', listening: false
        });
        this._dynamicGroup.add(this._lcdMain);
        this._lcdCache = '';
    }

    /** 液晶屏刷新：有电显示实际电压/频率，无电显示 ---V ---Hz */
    _updateLCDText() {
        if (!this._lcdMain) return;
        const txt = this._inPowered()
            ? `${Math.round(this._inRms)}V,${this._freq}Hz`
            : '---V,---Hz';
        if (txt !== this._lcdCache) {
            this._lcdCache = txt;
            this._lcdMain.text(txt);
            if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
        }
    }

    /** 指示灯发光片（圆形，叠在灯罩上） */
    _createLampGlows() {
        this._lampGlows = [];
        const colors = ['#f4f7fa', '#35c04a', '#e03838'];
        for (let i = 0; i < 3; i++) {
            const glow = new Konva.Circle({
                x: this._lampCX[i],
                y: this._lampCY,
                radius: this._lampD / 2 - 2,
                fill: colors[i],
                opacity: 0.92,
                visible: false,
                listening: false
            });
            this._dynamicGroup.add(glow);
            this._lampGlows.push(glow);
        }
    }

    /** 旋钮指示条：一根黑色矩形长条，绕中心旋转指向档位 */
    _createKnobIndicator() {
        this._knobInd = new Konva.Group({
            x: this._knobCX,
            y: this._knobCY,
            rotation: this._knobAngle(),
            listening: false
        });
        this._knobInd.add(new Konva.Rect({
            x: -4,
            y: -this._knobR + 4,
            width: 8,
            height: this._knobR - 10,
            fill: '#1a1f26',
            stroke: '#0e1218',
            strokeWidth: 1,
            cornerRadius: 1
        }));
        this._knobInd.add(new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#1a1f26', stroke: '#0e1218', strokeWidth: 1 }));
        this._dynamicGroup.add(this._knobInd);
    }

    _knobAngle() { return this._knob === 1 ? -45 : (this._knob === 2 ? 45 : 0); }

    /** 换相区动态连线：相序1 直连组 / 相序2 交叉组（K2↔M3、K3↔M2 交叉） */
    _createSwitchLines() {
        const cols = ['#e03030', '#20a030', '#2050e0'];
        const xs = this._inXs, yTop = this._yK, yBot = this._yM;
        const D = this._dynamicGroup;
        const direct = new Konva.Group({ listening: false });
        for (let i = 0; i < 3; i++) {
            direct.add(new Konva.Line({
                points: [xs[i], yTop + 6, xs[i], yBot - 6],
                stroke: cols[i], strokeWidth: 2.4, lineCap: 'round'
            }));
            direct.add(new Konva.Circle({ x: xs[i], y: (yTop + yBot) / 2, radius: 3, fill: cols[i] }));
        }
        D.add(direct);

        const cross = new Konva.Group({ listening: false });
        const yL = yTop + 6, yH = yBot - 6;
        // 相序2：直接画斜向直线交叉（K1→M1 竖线、K2→M3 斜线、K3→M2 斜线）
        const mkLine = (x1, x2, color) => {
            cross.add(new Konva.Line({
                points: [x1, yL, x2, yH],
                stroke: color, strokeWidth: 2, lineCap: 'round'
            }));
        };
        mkLine(xs[0], xs[0], cols[0]);
        mkLine(xs[1], xs[2], cols[1]);
        mkLine(xs[2], xs[1], cols[2]);
        D.add(cross);
        this._switchDirect = direct;
        this._switchCross = cross;
        this._updateSwitchLines();
    }

    _updateSwitchLines() {
        if (!this._switchDirect || !this._switchCross) return;
        this._switchDirect.visible(this._knob === 1);
        this._switchCross.visible(this._knob === 2);
    }

    /** 空气断路器：刀片式三极（参照 DiagramThreePhaseACB） */
    _createBreakerBlades() {
        const xs = this._inXs;
        const yBase = this._brOutY;
        const len = this._brOutY - this._brInY + 6;
        this._brBlades = [];
        for (let i = 0; i < 3; i++) {
            const color = ['#e03030', '#20a030', '#2050e0'][i];
            const g = new Konva.Group({ x: xs[i], y: yBase, rotation: this._breakerOn ? 0 : -45, listening: false });
            g.add(new Konva.Line({
                points: [0, 0, 0, -len], stroke: color, strokeWidth: 5,
                lineCap: 'round'
            }));
            g.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#e8c86a', stroke: '#6a5a28', strokeWidth: 1.5 }));
            this._dynamicGroup.add(g);
            this._brBlades.push(g);
        }
    }

    /** 合/分闸按钮内状态 LED：亮绿🟢/暗绿 / 亮红🔴/暗红，由线路供电且开关非 OFF 时点亮 */
    _createBtnLeds() {
        this._btnLeds = [];
        // 合闸 LED（i=0，绿）、分闸 LED（i=1，红）
        for (let i = 0; i < 2; i++) {
            const led = new Konva.Circle({
                x: this._btnCX[i],
                y: this._btnYL,
                radius: this._btnR - 5,
                fill: i === 0 ? '#1a5c24' : '#5c1d14',
                visible: false,
                listening: false
            });
            this._dynamicGroup.add(led);
            this._btnLeds.push(led);
        }
    }

    /**
     * LED 亮/暗驱动：
     *  有电（进线带电且相序开关非 OFF）时：
     *    合闸灯：合闸→亮绿，分闸→暗绿
     *    分闸灯：分闸→亮红，合闸→暗红
     *  线路无电 或 相序开关为 OFF：两灯全部熄灭
     */
    _updateBtnLeds() {
        const powered = this._inPowered() && this._knob !== 0;
        const closeLed = this._btnLeds[0], openLed = this._btnLeds[1];
        if (!closeLed || !openLed) return;
        if (!powered) {
            closeLed.visible(false);
            openLed.visible(false);
            return;
        }
        closeLed.visible(true);
        openLed.visible(true);
        closeLed.fill(this._breakerOn ? '#33c94a' : '#145c22');
        openLed.fill(this._breakerOn ? '#5c1d14' : '#ff5040');
    }

    // ═══════════════════════════════
    // 交互
    // ═══════════════════════════════
    _bindInteraction() {
        this._interactGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: 'transparent'
        }));

        const mkHover = (h, cur) => {
            h.on('mouseenter', () => { document.body.style.cursor = cur || 'pointer'; });
            h.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        };
        const redraw = () => {
            if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
        };
        // 三档热区互不重叠（左=相序1 / 上=OFF / 右=相序2），修复“无法切到相序1”
        const setKnob = (v, partId) => {
            this._knob = v;
            this.sys.lastClickedId = this.id;
            this.sys.lastClickedPartId = this.id + '/' + partId;
            this._updateSwitchLines();
            this._knobInd.rotation(this._knobAngle());
            redraw();
        };
        const L = this._knobR + 14;
        const leftHit = new Konva.Rect({
            x: this._knobCX - L, y: this._knobCY - 14,
            width: L - 10, height: 28, fill: 'transparent'
        });
        leftHit.on('click tap', (e) => { e.cancelBubble = true; setKnob(1, 'knob-pos1'); });
        mkHover(leftHit);
        this._interactGroup.add(leftHit);

        const offHit = new Konva.Rect({
            x: this._knobCX - 14, y: this._knobCY - L,
            width: 28, height: L - 10, fill: 'transparent'
        });
        offHit.on('click tap', (e) => { e.cancelBubble = true; setKnob(0, 'knob-off'); });
        mkHover(offHit);
        this._interactGroup.add(offHit);

        const rightHit = new Konva.Rect({
            x: this._knobCX + 10, y: this._knobCY - 14,
            width: L - 10, height: 28, fill: 'transparent'
        });
        rightHit.on('click tap', (e) => { e.cancelBubble = true; setKnob(2, 'knob-pos2'); });
        mkHover(rightHit);
        this._interactGroup.add(rightHit);

        const btnHit = (idx, doClose, partId) => {
            const h = new Konva.Circle({
                x: this._btnCX[idx], y: this._btnYL,
                radius: this._btnR + 5, fill: 'transparent'
            });
            h.on('click tap', (e) => {
                e.cancelBubble = true;
                this.sys.lastClickedId = this.id;
                this.sys.lastClickedPartId = this.id + '/' + partId;
                doClose();
            });
            mkHover(h);
            this._interactGroup.add(h);
        };
        btnHit(0, () => this.tryCloseBreaker(), 'btn-close');
        btnHit(1, () => this.tryOpenBreaker(), 'btn-open');

        // ── 部件识别热区（供工作流“识别”步骤使用，须置于透明整板之后以置顶）──
        // 相序指示灯（左面板三圆灯区域）
        this.addClickablePart('phase-lamps', 6, 74, 152, 46);
        // 空气开关（右原理区刀片式断路器及输出端子区域）
        this.addClickablePart('breaker', 198, 215, 84, 103);
    }

    // ═══════════════════════════════
    // tick
    // ═══════════════════════════════
    tick() {
        this._updateInPower();
        this._updateSeqPhase();
        this._updateLamps();
        this._updateBtnLeds();
        this._updateLCDText();
        // 失压保护：出口断路器合闸中，只要进线失电 或 相序转换开关打到 OFF → 自动跳闸（断开）
        if (this._breakerOn && (!this._inPowered() || this._knob === 0)) {
            this._breakerOn = false;
            this._updateBlades();
            if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
        }
        this._refreshIfDirty();
    }

    /** 进线带电检测：L1↔L2 线电压 RMS（40 点滑动窗口） */
    _updateInPower() {
        if (!this.sys || typeof this.sys.getVoltageBetween !== 'function') return;
        const v = this.sys.getVoltageBetween(`${this.id}_wire_in1`, `${this.id}_wire_in2`) || 0;
        const i2 = v * v;
        const old = this._iBuf[this._iBufIdx];
        this._iBuf[this._iBufIdx] = i2;
        this._iBufSum = this._iBufSum - old + i2;
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;
        this._inRms = this._iBufCount >= 5 ? Math.sqrt(this._iBufSum / Math.min(this._iBufCount, 40)) : 0;
    }

    _inPowered() { return this._inRms > 40; }

    /**
     * 实时相序检测（李萨如旋转方向）：
     *  记 v12=L1−L2、v23=L2−L3 的瞬时值，叉积 d = v12_prev·v23 − v23_prev·v12。
     *  推演（正序 Va≈sinωt, Vb≈sin(ωt−120°)）：v12=√3 sin(ωt+30°), v23=√3 sin(ωt−90°)，
     *  d = 3ω·sin120° > 0 恒定为正；负序（两根火线对调）时 d < 0 恒定。
     *  因此无需精确过零采样，累计 30 帧叉积符号即可鲁棒判定进线相序。
     */
    _updateSeqPhase() {
        if (!this.sys || typeof this.sys.getVoltageBetween !== 'function') return;
        const v12 = this.sys.getVoltageBetween(`${this.id}_wire_in1`, `${this.id}_wire_in2`) || 0;
        const v23 = this.sys.getVoltageBetween(`${this.id}_wire_in2`, `${this.id}_wire_in3`) || 0;
        const d = this._p12 * v23 - this._p23 * v12;
        this._p12 = v12;
        this._p23 = v23;
        if (!this._inPowered()) return;          // 无电不判（保持上次结果）
        if (Math.abs(d) < 5) return;             // 忽略近零叉积（幅值过小/采样恰在波峰前沿）
        this._seqAcc += d;
        this._seqN++;
        if (this._seqN >= 20) {
            // 实测（该工程交流源相位基准）：正序 → 累计叉积 < 0；负序 → > 0
            this._phase = this._seqAcc < 0 ? 'pos' : 'neg';
            this._seqAcc = 0;
            this._seqN = 0;
        }
    }

    _updateLamps() {
        const live = this._inPowered();
        const powered = live && this._knob !== 0;
        // 检测的是转换开关之后的输出相序（M 侧）：
        //   输出正序 ⇔ (进线为正序 _phase) ≠ (开关处于相序2 换相)
        //   因此“相序1 为负序 ⇔ 相序2 为正序”，两者必互补。
        const outPos = (this._phase === 'pos') !== (this._knob === 2);
        // 电源灯（白）：进线有电亮 / 无电灭
        if (this._lampGlows[0]) this._lampGlows[0].visible(live);
        // 正序灯（绿）：有电且输出为正相序 → 亮绿；否则（无电/负序/OFF）→ 暗绿
        if (this._lampGlows[1]) {
            this._lampGlows[1].visible(true);
            this._lampGlows[1].fill(powered && outPos ? '#33c94a' : '#145c22');
        }
        // 负序灯（红）：有电且输出为负相序 → 亮红；否则（无电/正序/OFF）→ 暗红
        if (this._lampGlows[2]) {
            this._lampGlows[2].visible(true);
            this._lampGlows[2].fill(powered && !outPos ? '#ff5040' : '#5c1d14');
        }
    }

    // ═══════════════════════════════
    // 公开 API
    // ═══════════════════════════════
    getKnob() { return this._knob; }
    getBreakerOn() { return this._breakerOn; }
    isConducting() { return this._knob !== 0 && !!this._breakerOn; }
    knobName() { return ['OFF', '相序1', '相序2'][this._knob] || 'OFF'; }

    tryCloseBreaker() {
        if (this._breakerOn) return;
        this._breakerOn = true;
        this._updateBlades();
        if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
    }

    tryOpenBreaker() {
        if (!this._breakerOn) return;
        this._breakerOn = false;
        this._updateBlades();
        if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
    }

    _updateBlades() {
        (this._brBlades || []).forEach((blade, i) => {
            blade.rotation(this._breakerOn ? 0 : -45);
        });
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '进线相序 (pos/neg)', key: 'lineSeq', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.lineSeq !== undefined) {
            this._lineSeq = String(cfg.lineSeq).toLowerCase() === 'neg' ? 'neg' : 'pos';
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
