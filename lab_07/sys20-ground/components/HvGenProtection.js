import { BaseComponent } from './BaseComponent.js';

/**
 * HvGenProtection.js — 高压发电机微机综合保护装置
 *
 * 直接读取关联对象（电流互感器 I_primary、发电机 _rmsI/_rmsV/_pwr）实现保护，
 * 无需新增求解器 stamp。
 *
 * 保护功能（6 种，config 可整定，默认按 In=218.7A / Un=6600V / Pn=2000kW）：
 *   差动：每相机端侧 CT（出口）vs 中性点侧 CT（入口）瞬时差流 → 0.2s 确认跳闸
 *   短路：A相出口（机端侧）电流瞬时峰值 > shortMult×In×√2 → 瞬时
 *   过载：A相出口（机端侧）电流 > overloadMult×In 持续 overloadTime → 延时
 *   接地：中性点 CT 电流 > groundMult×In 持续 groundTime → 延时
 *   欠压：三相相电压 < uvRatio×Un 持续 uvTime → 延时
 *   逆功率：gen._pwr < -revRatio×Pn 持续 revTime → 延时
 *
 * 跳闸动作：① 断路器 qf.tryTrip() 分闸 ② 置 _tripped（遥控面板故障灯亮）③ 需复位。
 * 复位：复用遥控面板复位按钮（面板复位时调用本装置 reset()）。
 *
 * 显示：大液晶屏 + F1/F2/F3 三按钮。
 *   正常时三屏轮换（每屏 10s）：
 *     F1：3相入口（中性点侧）电流 / 3相出口（机端侧）电流 / 接地电流
 *     F2：3相相电压 / 中性点电位偏移
 *     F3：有功功率 / 功率因数
 *   故障时自动切到故障界面：故障原因 / 延时倒计时 / 跳闸状态（延时中·已跳闸）。
 *
 * 接口：
 *   左：cta_out_s1/s2（A相出口CT）、cta_in_s1/s2（A相入口CT）、ctn_s1/s2（中性点CT）、pt_a/pt_b（PT电压）
 *   右：prot_a/prot_b（保护通信→遥控面板）、p24_p/p24_n（24V 电源）
 */
export class HvGenProtection extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);
        this.type = 'hv_gen_protection';
        this.cache = 'fixed';
        this.genId = config.genId || '';
        this.qfId  = config.qfId || '';
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this._addPorts();
    }

    _recalcGeometry() {
        this.width  = 360;
        this.height = 300;
        // 液晶屏区域
        this._lcd = { x: 18, y: 34, w: 324, h: 190 };
        // 五个功能按钮 F0-F4
        this._btnF = [
            { x: 44,  y: 252, label: 'F0' },
            { x: 111, y: 252, label: 'F1' },
            { x: 178, y: 252, label: 'F2' },
            { x: 245, y: 252, label: 'F3' },
            { x: 312, y: 252, label: 'F4' },
        ];
        // 端口
        this._portLeft = {
            ctaOutS1: 34, ctaOutS2: 58,
            ctaInS1:  82, ctaInS2:  106,
            ctNS1:    130, ctNS2:    154,
            ptA:      178, ptB:      202,
        };
        this._portRight = { protA: 120, protB: 144, p24P: 176, p24N: 200 };
    }

    _initParameters(config) {
        this.function = '微机综合保护装置';
        // 整定（基于额定 In/Un/Pn）
        this.In  = parseFloat(config.In)  || 218.7;   // 额定电流 A（2000kW/6600V/cos0.8）
        this.Un  = parseFloat(config.Un)  || 6600;    // 额定线电压 V
        this.Pn  = parseFloat(config.Pn)  || 2000;    // 额定功率 kW
        this.diffRatio      = config.diffRatio      !== undefined ? config.diffRatio      : 0.2;   // ×In
        this.shortMult      = config.shortMult      !== undefined ? config.shortMult      : 6;     // ×In
        this.overloadMult   = config.overloadMult   !== undefined ? config.overloadMult   : 1.2;   // ×In
        this.overloadTime   = config.overloadTime   !== undefined ? config.overloadTime   : 10;    // s
        this.groundMult     = config.groundMult     !== undefined ? config.groundMult     : 0.1;   // ×In
        this.groundTime     = config.groundTime     !== undefined ? config.groundTime     : 1;     // s
        this.uvRatio        = config.uvRatio        !== undefined ? config.uvRatio        : 0.85;  // ×Un
        this.uvTime         = config.uvTime         !== undefined ? config.uvTime         : 2;     // s
        this.revRatio       = config.revRatio       !== undefined ? config.revRatio       : 0.08;  // ×Pn
        this.revTime        = config.revTime        !== undefined ? config.revTime        : 5;     // s
        this.autoScreenS    = config.autoScreenS    !== undefined ? config.autoScreenS    : 10;    // 正常屏轮换时间 s

        this._powered = false;
        this._powerTimer = 0;
        // 保护状态
        this._tripped = false;       // 已跳闸（需复位）
        this._active = 'normal';     // normal | diff | short | overload | ground | uv | rev
        this._phase = 'idle';        // idle | delay(延时中) | trip(已跳闸)
        this._delayT = 0;            // 延时倒计时
        this._delayRaw = 0;          // 进入延时时的原始延时定值（记录用，s）
        this._tripReason = '';
        // 采样与 RMS
        this._Iout = 0; this._Iin = 0; this._I0 = 0;   // 出口/入口/中性点电流 RMS
        this._tripIin = 0; this._tripIout = 0;          // 跳闸当刻入口/出口快照（跳闸后分流滑窗衰减）
        this._I3 = 0;                                    // 三相最大电流 RMS（gen._rmsI）
        this._Iu = 0; this._Iv = 0; this._Iw = 0;        // 三相相电流 RMS（gen 三相缓冲）
        this._V3 = 0;                                    // 三相相电压 RMS（gen._rmsV）
        this._Vu = 0; this._Vv = 0; this._Vw = 0;        // 三相相电压 RMS（gen 三相缓冲）
        this._Vn0 = 0;                                  // 中性点对地电压 RMS（V）
        this._Pkw = 0; this._cos = 0;                    // 有功/功率因数
        this._unbal = 0;                                 // 中性点电压偏移（对额定相电压 %UN）
        // 滑动窗（按系统频率 50Hz，40 样本/周期）
        this._win = [];
        this._diffWin = [];             // 差动判据短窗（4 帧 ≈80ms，避免 40 帧滑窗爬升过慢）
        this._diffInst = 0;             // 差动判据值（短窗 RMS）
        this._outWin = [];              // 三相出口（机端侧）电流峰值短窗（4 帧瞬时）：短路速断判据
        this._outMaxInst = 0;           // 短路判据值（三相出口瞬时最大峰值，>6In×√2 → 短路）
        this._overAccMs = 0;            // 过载前置确认累计（≥1000ms 才进入"过载 延时"，避免故障爬升期抢先显示）
        this._buf = { out: [], in: [], n: [], i3: [], v3: [], p: [], u: [], v: [], w: [], vu: [], vv: [], vw: [], vn: [], pa: [], pb: [], pc: [],
            inU: [], outU: [], inV: [], outV: [], inW: [], outW: [] };
        this._lastIter = undefined;
        // 屏幕：默认 F0（报警/故障屏）；点击 F1-F4 切换；仅故障触发才自动回 F0
        this._screen = 0;
        this._screenT = 0;           // 当前屏停留时间（无轮换，仅记录）
        // 报警/故障记录（F0 屏，FIFO 最多 7 条：原因 / 状态 / 时间）
        this._alarmLog = [];
        // 首次发电机起动前视为正常（不记录报警、不触发故障）
        this._startedEver = false;
        // 起动稳定期：每次起动后 3s 内不判定故障（避免建压过程误判欠压/过载）
        this._stableT = 0;
        this._prevGenOn = false;   // 发电机运行边沿检测（停机→运行）
        this._prevLineFault = '';
        this._prevFaultPhase = 'idle';
        // 三相功率（kW）
        this._Pa = 0; this._Pb = 0; this._Pc = 0;
        // 线路完整性：左边 4 对接线（3×CT + PT）任一断开 → 报警
        this._lineFault = '';        // 断开的线路名称（如 'A相出口CT'），空=全部接好
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ─────────────────────────── 静态绘制 ───────────────────────────
    _drawStaticParts() {
        const W = this.width, H = this.height;
        // 面板底
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#dde3ea', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 5, width: W, text: '微机综合保护装置',
            fontSize: 14, fontStyle: 'bold', fill: '#1a252f', align: 'center',
        }));
        // 液晶屏外框
        const l = this._lcd;
        this._staticGroup.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h,
            fill: '#0a0e12', cornerRadius: 3, stroke: '#3a4a55', strokeWidth: 1.5,
        }));
        // 三个功能按钮
        this._btnF.forEach(b => {
            this._staticGroup.add(new Konva.Rect({
                x: b.x - 20, y: b.y - 13, width: 40, height: 26,
                fill: '#cdd8e0', cornerRadius: 4, stroke: '#5a6a75', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: b.x - 20, y: b.y - 7, width: 40, text: b.label,
                fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center',
            }));
        });
    }

    // ─────────────────────────── 动态节点 ───────────────────────────
    _createDynamicNodes() {
        // 电源/跳闸指示灯（右上角小圆点）
        this._powLed = new Konva.Circle({
            x: this.width - 14, y: 14, radius: 5, fill: '#3a3a3a', listening: false,
        });
        this._tripLed = new Konva.Circle({
            x: this.width - 30, y: 14, radius: 5, fill: '#3a3a3a', listening: false,
        });
        this._dynamicGroup.add(this._powLed, this._tripLed);
        // 液晶屏文本（7 行：F0 报警屏用满 7 行，F1-F3 用前 4 行）
        const l = this._lcd;
        this._lcdLines = [];
        for (let i = 0; i < 7; i++) {
            const t = new Konva.Text({
                x: l.x + 10, y: l.y + 6 + i * 25, width: l.w - 20,
                fontSize: 14, fontFamily: 'monospace', fontStyle: 'bold',
                fill: '#00ff88', text: '',
            });
            this._dynamicGroup.add(t);
            this._lcdLines.push(t);
        }
        this._screenText = new Konva.Text({
            x: l.x + 10, y: l.y + l.h - 22, width: l.w - 20,
            fontSize: 12, fontFamily: 'monospace', fill: '#7dd3ff',
            text: '', listening: false,
        });
        this._dynamicGroup.add(this._screenText);
        // F4 配电屏单线模拟图
        this._createOneLineDiagram();
    }

    // ─────────────────────────── F4 配电屏单线模拟图 ───────────────────────────
    _createOneLineDiagram() {
        const l = this._lcd;
        const g = new Konva.Group({ x: 0, y: 0, listening: false });
        const c = '#00ff88';
        const cx = l.x + l.w / 2;          // LCD 中心 x
        // 汇流排横线
        g.add(new Konva.Line({ points: [l.x + 30, l.y + 34, l.x + l.w - 30, l.y + 34], stroke: c, strokeWidth: 3 }));
        g.add(new Konva.Text({ x: l.x + 4, y: l.y + 26, text: '汇流排', fontSize: 10, fill: c }));
        // 竖线：汇流排 → 断路器
        g.add(new Konva.Line({ points: [cx, l.y + 34, cx, l.y + 58], stroke: c, strokeWidth: 2 }));
        // 断路器（竖直单刀开关）：竖线上、下固定触点 + 可动刀（无外框）
        this._cbCx = cx; this._cbBotY = l.y + 74; this._cbTopY = l.y + 58;
        g.add(new Konva.Line({ points: [cx - 5, l.y + 58, cx + 5, l.y + 58], stroke: c, strokeWidth: 2.5 }));   // 上触点
        g.add(new Konva.Line({ points: [cx - 5, l.y + 74, cx + 5, l.y + 74], stroke: c, strokeWidth: 2.5 }));   // 下触点
        this._cbLine = new Konva.Line({ points: [cx, l.y + 74, cx, l.y + 58], stroke: c, strokeWidth: 2 });
        g.add(this._cbLine);
        g.add(new Konva.Text({ x: cx + 13, y: l.y + 60, text: 'QF', fontSize: 9, fill: c }));
        // 竖线：断路器 → 分叉点
        g.add(new Konva.Line({ points: [cx, l.y + 74, cx, l.y + 104], stroke: c, strokeWidth: 2 }));
        // 右支 → 接地开关（常开触头形式）
        const gx = cx + 62;
        g.add(new Konva.Line({ points: [cx, l.y + 104, gx, l.y + 104], stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [gx - 8, l.y + 100, gx - 8, l.y + 108], stroke: c, strokeWidth: 2.5 }));
        g.add(new Konva.Line({ points: [gx + 8, l.y + 100, gx + 8, l.y + 108], stroke: c, strokeWidth: 2.5 }));
        this._gsCx = gx; this._gsCy = l.y + 104;
        this._gsLine = new Konva.Line({ points: [gx - 8, l.y + 104, gx + 8, l.y + 104], stroke: c, strokeWidth: 2 });
        g.add(this._gsLine);
        g.add(new Konva.Text({ x: gx - 14, y: l.y + 114, text: '接地开关', fontSize: 9, fill: c }));
        // 地引线：接地开关右端 → 右侧标准地符号（竖线 + 三横线 + "地"）
        const ex = gx + 40;
        g.add(new Konva.Line({ points: [gx + 8, l.y + 104, ex, l.y + 104], stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [ex, l.y + 104, ex, l.y + 120], stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [ex - 8, l.y + 124, ex + 8, l.y + 124], stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [ex - 5, l.y + 130, ex + 5, l.y + 130], stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [ex - 2, l.y + 136, ex + 2, l.y + 136], stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Text({ x: ex - 5, y: l.y + 114, text: '地', fontSize: 9, fill: c }));
        // 主支：分叉点 → 发电机
        g.add(new Konva.Line({ points: [cx, l.y + 104, cx, l.y + 150], stroke: c, strokeWidth: 2 }));
        // 发电机符号（圆，运行绿色填充）+ 文字居中于圆中心
        this._genCircle = new Konva.Circle({
            x: cx, y: l.y + 166, radius: 16, stroke: c, strokeWidth: 2, fill: 'rgba(255,240,0,0)',
        });
        g.add(this._genCircle);
        g.add(new Konva.Text({
            x: cx - 20, y: l.y + 166 - 5, width: 40, align: 'center',
            text: '发电机', fontSize: 9, fill: c,
        }));
        this._oneLine = g;
        this._oneLine.visible(false);
        this._dynamicGroup.add(g);
    }

    // ─────────────────────────── 交互绑定 ───────────────────────────
    _bindInteraction() {
        // F0-F4 手动切换显示屏并重置该屏计时（故障时也可查看，新故障自动回 F0）。
        //   热区复用 addClickablePart（顺带记录 lastClickedPartId，供工作流 find 步骤识别部件
        //   ——如 find target:'prot1' subTarget:'f1' 即"按下 F1 键"）。
        this._btnF.forEach((b, i) => {
            const hit = this.addClickablePart(b.label.toLowerCase(), b.x - 20, b.y - 13, 40, 26);
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this._screen = i;
                this._screenT = 0;
            });
        });
    }

    // ─────────────────────────── 端口 ───────────────────────────
    _addPorts() {
        const l = this._portLeft, r = this._portRight;
        this.addPort(2, l.ctaOutS1, 'cta_out_s1', 'wire');
        this.addPort(2, l.ctaOutS2, 'cta_out_s2', 'wire');
        this.addPort(2, l.ctaInS1,  'cta_in_s1',  'wire');
        this.addPort(2, l.ctaInS2,  'cta_in_s2',  'wire');
        this.addPort(2, l.ctNS1,    'ctn_s1',     'wire');
        this.addPort(2, l.ctNS2,    'ctn_s2',     'wire');
        this.addPort(2, l.ptA,      'pt_a',       'wire', 'p');
        this.addPort(2, l.ptB,      'pt_b',       'wire');
        const h = this.height - 2, w = this.width - 2;
        this.addPort(w, r.protA, 'prot_a', 'wire');
        this.addPort(w, r.protB, 'prot_b', 'wire');
        this.addPort(w, r.p24P,  'p24_p',  'wire', 'p');
        this.addPort(w, r.p24N,  'p24_n',  'wire');
    }

    // ─────────────────────────── 引用与采样 ───────────────────────────
    _gen()  { return (this.genId  && this.sys && this.sys.comps) ? this.sys.comps[this.genId]  : null; }
    _qf()   { return (this.qfId   && this.sys && this.sys.comps) ? this.sys.comps[this.qfId]   : null; }

    _sensePower() {
        const v = this.sys && this.sys.getVoltageBetween
            ? this.sys.getVoltageBetween(`${this.id}_wire_p24_p`, `${this.id}_wire_p24_n`) : undefined;
        if (v !== undefined && isFinite(v) && v > 1) this._powerTimer = Math.min(3, this._powerTimer + 1);
        else this._powerTimer = 0;
        this._powered = this._powerTimer >= 3;
    }

    /** 每物理帧采样（求解器推进时才采），滑动窗求 RMS */
    _sample() {
        const vs = this.sys && this.sys.voltageSolver;
        if (!vs || vs.globalIterCount === this._lastIter) return;
        this._lastIter = vs.globalIterCount;

        const gen = this._gen();
        // 直接从发电机对象读取（不再经外部 CT 组件）：
        //   三相电流 = 三相最大相电流 _rmsI；三相相电压 = _rmsV；有功 = _pwr
        const i3  = gen ? (gen._rmsI || 0) : 0;
        const v3  = gen ? (gen._rmsV || 0) : 0;
        const pkw = gen ? (gen._pwr  || 0) : 0;
        // 三相相电流（从发电机三相缓冲求各相 RMS；无缓冲时用三相最大近似）
        const rmsBuf = (buf) => (Array.isArray(buf) && buf.length)
            ? Math.sqrt(buf.reduce((a, b) => a + b, 0) / buf.length) : 0;
        const iU = gen ? rmsBuf(gen._curBufU) : 0;
        const iV = gen ? rmsBuf(gen._curBufV) : 0;
        const iW = gen ? rmsBuf(gen._curBufW) : 0;
        // 三相相电压（从发电机三相电压缓冲求各相 RMS）
        const vU = gen ? rmsBuf(gen._vBufU) : 0;
        const vV = gen ? rmsBuf(gen._vBufV) : 0;
        const vW = gen ? rmsBuf(gen._vBufW) : 0;
        // 中性点对地电压（经 500Ω 接地电阻，中性点对地电位；对称时≈0）
        const vN0 = (gen && this.sys && this.sys.getVoltageBetween)
            ? Math.abs(this.sys.getVoltageBetween(`${gen.id}_wire_n`, 'gnd_coil2_wire_gnd') || 0) : 0;
        // ── 三相电流自算（绕过发电机测量窗过滤，短路/单相接地均准确）──
        //   相电流 = (相电动势 − 相端对中性点电压) / 内阻
        const nodeV = (pId) => {
            const c = vs.portToCluster.get(pId);
            return c !== undefined ? (vs.nodeVoltages.get(c) || 0) : 0;
        };
        const rOn = (gen && (gen._rOnEff || gen.rOn)) || 2;
        const tNow = vs.currentTime || 0;
        const emfOf = (ph) => gen ? gen.getPhaseVoltage(ph, tNow) : 0;
        const emfU = emfOf('u');
        const emfV = emfOf('v');
        const emfW = emfOf('w');
        const vN = gen ? nodeV(`${gen.id}_wire_n`) : 0;
        // 绕组中点抽头是否参与电路（=发电机被切成“首端段+中性段”两段模型，与求解器 stamp 一致；
        //   故障短接 u_mid↔v_mid 等内部短路时会使其入簇）
        const hasMid = (ph) => {
            if (!gen) return false;
            const cP = vs.portToCluster.get(`${gen.id}_wire_${ph}`);
            const cN = vs.portToCluster.get(`${gen.id}_wire_n`);
            const cM = vs.portToCluster.get(`${gen.id}_wire_${ph}_mid`);
            return cM !== undefined && cM !== cP && cM !== cN;
        };
        // 首端段电流 = 机端侧 CT（流经绕组首端↔中点段）
        const i1Of = (ph) => {
            const emf = emfOf(ph);
            const vPh = nodeV(`${gen.id}_wire_${ph}`);
            if (!hasMid(ph)) return (emf - (vPh - vN)) / rOn;    // 单段模型：等效 = 全绕组电流
            const vM = nodeV(`${gen.id}_wire_${ph}_mid`);
            return (emf / 2 - (vPh - vM)) * 2 / rOn;
        };
        // 中性段电流 = 中性点侧 CT（流经绕组中点↔中性点段）
        const i2Of = (ph) => {
            const emf = emfOf(ph);
            if (!hasMid(ph)) return i1Of(ph);                    // 单段：两侧 CT 电流相同
            const vM = nodeV(`${gen.id}_wire_${ph}_mid`);
            return (emf / 2 - (vM - vN)) * 2 / rOn;
        };
        // 各相首端段电流（机端侧/出口 CT）与中性段电流（中性点侧/入口 CT）
        const i1U = gen ? i1Of('u') : 0;
        const i1V = gen ? i1Of('v') : 0;
        const i1W = gen ? i1Of('w') : 0;
        const i2U = gen ? i2Of('u') : 0;
        const i2V = gen ? i2Of('v') : 0;
        const i2W = gen ? i2Of('w') : 0;
        // 相电流显示值（机端侧）
        const iUc = i1U, iVc = i1V, iWc = i1W;
        // 接地电流：中性点经 500Ω 接地电阻的实际电流 = 中性点对地电压 / 500
        const iNc = vN0 / 500;
        // 差动 = 每相两段（机端侧 i1 与中性点侧 i2）电流之差：
        //   外部（出口）相间短路：电流穿过整个绕组 → 每相中性点侧≈机端侧，差流≈0 → 短路保护动作；
        //   绕组中点内部短路：两相中点短接，内部环流只流经中性段（三相共中性点成回路），
        //      A/B 相入口电流幅值相等、方向相反（i2V ≈ −i2U）→ 各相差流均大 → 差动保护动作
        const iIn  = gen ? Math.abs(i2U) : 0;       // A 相入口（中性点侧 CT）
        const iOut = gen ? Math.abs(i1U) : 0;       // A 相出口（机端侧 CT）
        const iDiff = gen
            ? Math.max(Math.abs(i1U - i2U), Math.abs(i1V - i2V), Math.abs(i1W - i2W))
            : 0;

        const push = (arr, v) => { arr.push(v * v); if (arr.length > 40) arr.shift(); };
        // 三相瞬时功率（kW）：瞬时相电压 × 瞬时相电流，滑窗平均 = 各相有功
        const phU = gen ? (nodeV(`${gen.id}_wire_u`) - vN) : 0;
        const phV = gen ? (nodeV(`${gen.id}_wire_v`) - vN) : 0;
        const phW = gen ? (nodeV(`${gen.id}_wire_w`) - vN) : 0;
        const pw = (arr, v) => { arr.push(v / 1000); if (arr.length > 40) arr.shift(); };
        pw(this._buf.pa, phU * iUc);
        pw(this._buf.pb, phV * iVc);
        pw(this._buf.pc, phW * iWc);
        push(this._buf.out, iOut);
        push(this._buf.in,  iIn);
        push(this._buf.n,   iNc);
        push(this._buf.i3,  i3);
        push(this._buf.v3,  v3);
        push(this._buf.p,   pkw);
        push(this._buf.u,   iUc);
        push(this._buf.v,   iVc);
        push(this._buf.w,   iWc);
        push(this._buf.vu,  vU);
        push(this._buf.vv,  vV);
        push(this._buf.vw,  vW);
        push(this._buf.vn,  vN0);
        push(this._buf.inU,  i2U); push(this._buf.outU, i1U);   // 入口=中性点侧、出口=机端侧
        push(this._buf.inV,  i2V); push(this._buf.outV, i1V);
        push(this._buf.inW,  i2W); push(this._buf.outW, i1W);
        this._diffSq = (this._diffSq || 0) + iDiff * iDiff;
        if (this._win.push(iDiff) > 40) this._win.shift();
        if (this._diffWin.push(iDiff) > 4) this._diffWin.shift();
        // 三相出口（机端侧）瞬时最大电流 → 4 帧峰值短窗（短路速断判据，即时响应）
        const iOutMaxInst = gen ? Math.max(Math.abs(i1U), Math.abs(i1V), Math.abs(i1W)) : 0;
        if (this._outWin.push(iOutMaxInst) > 4) this._outWin.shift();
        this._outMaxInst = this._outWin.length ? Math.max(...this._outWin) : 0;

        const avg = (a) => (a.length ? Math.sqrt(a.reduce((x, y) => x + y, 0) / a.length) : 0);
        // 三相入口（中性点侧/中性段）/ 出口（机端侧/首端段）电流
        this._IinA  = avg(this._buf.inU);  this._IoutA = avg(this._buf.outU);
        this._IinB  = avg(this._buf.inV);  this._IoutB = avg(this._buf.outV);
        this._IinC  = avg(this._buf.inW);  this._IoutC = avg(this._buf.outW);
        this._Iout  = this._IoutA;          // A 相出口（机端侧 CT）
        this._Iin   = this._IinA;           // A 相入口（中性点侧 CT）
        this._I0   = avg(this._buf.n);
        this._I3   = avg(this._buf.i3);
        this._Iu   = this._IoutA;           // 机端相电流（出口=机端侧 CT）
        this._Iv   = this._IoutB;
        this._Iw   = this._IoutC;
        this._Vu   = avg(this._buf.vu);
        this._Vv   = avg(this._buf.vv);
        this._Vw   = avg(this._buf.vw);
        this._Vn0  = avg(this._buf.vn);
        this._V3   = avg(this._buf.v3);
        this._Pkw  = avg(this._buf.p);
        const diffRms = avg(this._win);
        this._diff = diffRms;
        // 差动判据用最近 4 帧峰值：内部短路瞬时差流（线电压/内阻，峰值数千 A），
        // 峰值立即反映短路严重度（>2×In），且跳闸瞬间快照不会因停机归零被稀释
        this._diffInst = this._diffWin.length ? Math.max(...this._diffWin) : 0;
        // 三相功率（kW）：各相瞬时功率滑窗平均
        const avgP = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        this._Pa = avgP(this._buf.pa);
        this._Pb = avgP(this._buf.pb);
        this._Pc = avgP(this._buf.pc);
        // 中性点电压偏移：中性点对地电压 RMS 相对额定相电压的百分比（%UN）
        const unPh = this.Un > 0 ? this.Un / Math.sqrt(3) : 0;
        this._unbal = (unPh > 0 && this._Vn0 > 0) ? (this._Vn0 / unPh) * 100 : 0;
        // 功率因数：由 gen 提供或按 P/S 折算
        this._cos = (this._I3 > 0 && this._V3 > 0)
            ? Math.max(0, Math.min(1, (Math.abs(this._Pkw) * 1000) / (Math.sqrt(3) * Math.sqrt(3) * this._V3 * this._I3)))
            : 0;
    }

    /** 左边 4 对接线完整性检测：保护装置端口须与发电机对应端口连通（同簇）。
     *  任一对接线断开（未接好/断线）→ 记录断开线路名，LCD 报警"线路断开"。 */
    _checkLineIntegrity() {
        const vs = this.sys && this.sys.voltageSolver;
        const gen = this._gen();
        this._lineFault = '';
        if (!vs || !vs.portToCluster || !gen) return;
        const pairs = [
            ['cta_out_s1', 'cta_out_s2', 'A相出口CT'],
            ['cta_in_s1',  'cta_in_s2',  'A相入口CT'],
            ['ctn_s1',     'ctn_s2',     '中性点CT'],
            ['pt_a',       'pt_b',       'PT电压'],
        ];
        for (const [a, b, name] of pairs) {
            const cA1 = vs.portToCluster.get(`${this.id}_wire_${a}`);
            const cG1 = vs.portToCluster.get(`${gen.id}_wire_${a}`);
            const cA2 = vs.portToCluster.get(`${this.id}_wire_${b}`);
            const cG2 = vs.portToCluster.get(`${gen.id}_wire_${b}`);
            const ok = cA1 !== undefined && cA1 === cG1
                && cA2 !== undefined && cA2 === cG2;
            if (!ok) { this._lineFault = name; break; }
        }
        // 线路断开事件：首次发电机起动后才记录报警并自动回 F0（起动前视为正常）
        if (this._lineFault && this._lineFault !== this._prevLineFault) {
            if (this._startedEver) {
                this._logAlarm(this._lineFault, 0, 0, '报警闭锁');
                this._screen = 0;
                this._screenT = 0;
            }
        }
        this._prevLineFault = this._lineFault;
    }

    // ─────────────────────────── 保护逻辑 ───────────────────────────
    /** 判定当前保护动作优先级最高的故障；返回 {active, time(延时s)} 或 null
     *  注意：差动为主保护，优先于短路判据——发电机内部相间短路时 A/B 相电流
     *  同时远超短断定值，但差动（AB 相差流短窗）能准确区分内部故障，故优先判差动。 */
    _evaluateFault() {
        const In = this.In, Un = this.Un, Pn = this.Pn;
        // 短路/过载按三相出口（机端侧 CT）电流中最大一相计：外部短路时 A/B 相幅值相等；
        //   内部中点短路时机端侧≈0（环流走中性段）→ 不误动短路/过载，只由差动动作
        const iOutMax = Math.max(this._IoutA, this._IoutB, this._IoutC);
        // 差动：判据用最近 4 帧瞬时差流峰值（内部短路立即识别），
        //   但带 0.2s 确认时间再跳闸（使差流 RMS 滑窗爬升到接近故障稳态值，
        //   报警记录"参数"列显示真实差流而非跳闸瞬间的过渡值）
        if (this._diffInst > this.diffRatio * In) return { active: 'diff', time: 0.2 };
        // 短路速断：三相出口（机端侧）瞬时峰值 > 6In×√2（峰值整定）→ 即时跳闸。
        //   用瞬时峰值判定可避免 40 帧 RMS 滑窗爬升过程中先越过过载区、误现"过载 延时中"
        if (this._outMaxInst > this.shortMult * In * Math.SQRT2) return { active: 'short', time: 0 };
        // 过载：先累计 1s 前置确认（故障电流爬升期短路/差动即时跳闸会先动作，
        //   从而屏蔽"过载 延时中"的抢先显示）；期间电流回落则按帧退减
        if (iOutMax > this.overloadMult * In) {
            this._overAccMs = Math.min(this._overAccMs + 50, 1500);
            if (this._overAccMs >= 1000) return { active: 'overload', time: this.overloadTime };
        } else {
            this._overAccMs = Math.max(this._overAccMs - 50, 0);
        }
        if (this._I0 > this.groundMult * In) return { active: 'ground', time: this.groundTime };
        if (this._V3 > 0 && this._V3 < this.uvRatio * (Un / Math.sqrt(3))) return { active: 'uv', time: this.uvTime };
        if (this._Pkw < -this.revRatio * Pn) return { active: 'rev', time: this.revTime };
        return null;
    }

    _faultName(a) {
        return { diff: '差动', short: '短路', overload: '过载', ground: '接地', uv: '欠压', rev: '逆功率' }[a] || a;
    }

    /** 跳闸动作名（报警记录"原因"列显示，如"差动跳闸"） */
    _actionName(a) {
        return { diff: '差动跳闸', short: '短路跳闸', overload: '过载跳闸', ground: '接地跳闸', uv: '欠压跳闸', rev: '逆功率跳闸' }[a] || '';
    }

    /** 复位（遥控面板复位按钮联动调用）；故障源消失后才允许解除跳闸 */
    reset() {
        if (this._evaluateFault() !== null) return;   // 故障仍存在，不可复位
        this._tripped = false;
        this._active = 'normal';
        this._phase = 'idle';
        this._delayT = 0;
        this._delayRaw = 0;
        this._tripReason = '';
        this._diffWin = [];                 // 清空差动短窗，避免残留峰值
        this._diffInst = 0;
        this._outWin = [];                  // 清空短路峰值短窗，避免残留峰值
this._outMaxInst = 0;
        this._overAccMs = 0;            // 过载前置确认累计清零
    }

    // ─────────────────────────── 仿真主循环 ───────────────────────────
    tick(dt) {
        this._sensePower();
        this._sample();
        this._checkLineIntegrity();

        // 每次发电机起动（停机→运行边沿）重置稳定期：
        //   起动建压过程（电压滑窗 2s 爬升）不判定故障，避免误判欠压/过载
        const gStart = this._gen();
        const gOn = !!(gStart && gStart.isOn);
        if (gOn && !this._prevGenOn) {
            this._startedEver = true;   // 首次起动后启用报警/故障判定
            this._stableT = 0;          // 每次起动都重新进入稳定期
        }
        if (gOn) this._stableT += dt;
        this._prevGenOn = gOn;

        // 仅发电机运行中且稳定期后判定：停机过渡（滑窗残留旧值）不误判欠压/过载
        if (this._powered && !this._tripped && this._startedEver && gOn && this._stableT > 3) {
            const fault = this._evaluateFault();
            if (fault) {
                if (this._phase === 'idle') {
                    // 进入延时中：实时显示延时计时（F0 屏顶部），不写入报警记录；跳闸后才记录
                    this._active = fault.active;
                    this._phase = 'delay';
                    this._delayT = fault.time;
                    this._delayRaw = fault.time;
                    this._tripReason = this._faultName(fault.active);
                    this._screen = 0;
                    this._screenT = 0;
                } else if (this._phase === 'delay') {
                    // 延时中每帧重新评估：仅当出现【优先级更高】的瞬时故障（如过载延时中发现短路）
                    // 才改判并立即跳闸；差动（0.5s 确认）优先级最高，不被短路/过载抢占
                    const PRIO = { diff: 0, short: 1, overload: 2, ground: 3, uv: 4, rev: 5 };
                    if (fault.time === 0 && (PRIO[fault.active] < (PRIO[this._active] ?? 9))) {
                        this._active = fault.active;
                        this._delayT = 0;
                        this._delayRaw = 0;
                        this._tripReason = this._faultName(fault.active);
                        this._doTrip();
                        return;
                    }
                    // 瞬时保护（time=0）立即跳闸
                    if (this._delayT <= 0 || fault.time === 0) {
                        this._doTrip();
                    } else {
                        this._delayT -= dt;
                        if (this._delayT <= 0) this._doTrip();
                    }
                }
            } else {
                // 故障消失且尚未跳闸 → 复位延时
                if (this._phase === 'delay') {
                    this._phase = 'idle';
                    this._active = 'normal';
                    this._delayT = 0;
                }
            }
        }

        // 无屏幕轮换：默认 F0，仅手动点击切换；故障触发时在保护逻辑中自动回 F0

        this._updateDisplay();
        this._updateLeds();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 执行跳闸：断路器分闸 + 置 tripped + 锁定故障界面（此时才写入报警记录，含数值与延时） */
    _doTrip() {
        this._tripped = true;
        this._phase = 'trip';
        // 跳闸当刻电流快照（跳闸后 qf1 分闸→机组联动停机，滑窗会快速衰减，读数失真）
        this._tripIin = this._Iin;
        this._tripIout = this._Iout;
        this._tripIinA = this._IinA;  this._tripIoutA = this._IoutA;
        this._tripIinB = this._IinB;  this._tripIoutB = this._IoutB;
        this._tripIinC = this._IinC;  this._tripIoutC = this._IoutC;
        const action = this._actionName(this._active);
        if (action) this._tripReason = action;   // 记录/顶部显示"差动跳闸"等动作名
        this._logAlarm(this._tripReason || '保护动作', this._valueText(this._active), this._delayRaw, '已跳闸');
        const qf = this._qf();
        if (qf && typeof qf.tryTrip === 'function') {
            try { qf.tryTrip(); } catch (e) { /* ignore */ }
        }
    }

    // ─────────────────────────── 显示 ───────────────────────────
    _updateLeds() {
        if (this._powLed) this._powLed.fill(this._powered ? '#7dffb0' : '#3a3a3a');
        if (this._tripLed) this._tripLed.fill(this._tripped ? '#ff5555' : '#3a3a3a');
    }

    _updateDisplay() {
        if (!this._lcdLines) return;
        const clear = () => this._lcdLines.forEach(t => t.text(''));
        const lines = this._lcdLines;
        lines.forEach(t => t.fill('#00ff88'));
        // F4 单线图显隐（仅 F4 屏显示图形，其余屏隐藏）
        if (this._oneLine) this._oneLine.visible(this._screen === 4);

        if (this._screen === 0) {
            // ── F0 报警/故障显示屏：5 列 = 原因 | 参数 | 延时时间 | 状态 | 触发时间 ──
            //    延时中不写入记录（仅顶部实时显示延时计时），跳闸后才记录
            clear();
            let top = '';
            if (this._phase === 'delay' && this._tripReason) {
                // 延时中：实时显示 原因 数值 延时剩余（不写入记录表）
                top = `${this._tripReason} ${this._valueText(this._active)} 延时${Math.max(0, this._delayT).toFixed(1)}s`;
            } else if (this._tripped) {
                // 已跳闸：顶部高亮（数值取记录中的跳闸值，避免卸载后归零漂移）
                const a0 = this._alarmLog[0];
                top = (a0 && a0.status === '已跳闸')
                    ? `${a0.reason} ${a0.value} ${a0.delay} ${a0.status}`
                    : (this._tripReason ? `${this._tripReason} 已跳闸` : '');
            }
            if (top) {
                lines[0].text(top);
                lines[0].fill('#ff5555');
            }
            if (this._alarmLog.length === 0 && !top) {
                lines[0].text('无报警/故障记录');
            } else {
                // 记录列表：顶部占用 1 行时最多 5 条，否则 6 条（避开底部注释行）
                const n = top ? 5 : 6;
                this._alarmLog.slice(0, n).forEach((al, i) => {
                    const r = top ? i + 1 : i;
                    let s = `${al.reason} ${al.value || '-'} ${al.delay} ${al.status} ${al.time}`;
                    if (s.length > 33) s = s.slice(0, 33);
                    lines[r].text(s);
                    lines[r].fill(al.status === '报警闭锁' ? '#ffaa00' : '#00ff88');
                });
            }
            if (this._screenText) {
                this._screenText.text(this._tripped ? '按遥控面板复位解除'
                    : (this._phase === 'delay' ? '保护延时中' : '报警/故障记录'));
            }
            return;
        }
        if (this._screen === 1) {          // F1：三相入口/出口电流 + 接地电流
            clear();
            // 跳闸后显示跳闸当刻快照（避免跳闸停机后滑窗衰减失真）
            const sA = this._tripped ? [this._tripIinA, this._tripIoutA] : [this._IinA, this._IoutA];
            const sB = this._tripped ? [this._tripIinB, this._tripIoutB] : [this._IinB, this._IoutB];
            const sC = this._tripped ? [this._tripIinC, this._tripIoutC] : [this._IinC, this._IoutC];
            lines[0].text(`A相入口 ${this._fmt(sA[0])}A  A相出口 ${this._fmt(sA[1])}A`);
            lines[1].text(`B相入口 ${this._fmt(sB[0])}A  B相出口 ${this._fmt(sB[1])}A`);
            lines[2].text(`C相入口 ${this._fmt(sC[0])}A  C相出口 ${this._fmt(sC[1])}A`);
            lines[3].text(`接地电流 ${this._fmt(this._I0)}A`);
            if (this._screenText) this._screenText.text(`F1 三相差动电流、接地电流`);
            return;
        }
        if (this._screen === 2) {          // F2：三相相电压 + 中性点电压偏移
            clear();
            lines[0].text(`A相电压 ${this._fmt(this._Vu)}V`);
            lines[1].text(`B相电压 ${this._fmt(this._Vv)}V`);
            lines[2].text(`C相电压 ${this._fmt(this._Vw)}V`);
            lines[3].text(`中性点电压偏移 ${this._unbal.toFixed(1)}%UN`);
            if (this._screenText) this._screenText.text(`F2  三相相电压、中性点电压`);
            return;
        }
        if (this._screen === 3) {          // F3：三相功率 + 功率因数
            clear();
            lines[0].text(`A相功率 ${this._fmt(this._Pa)}kW`);
            lines[1].text(`B相功率 ${this._fmt(this._Pb)}kW`);
            lines[2].text(`C相功率 ${this._fmt(this._Pc)}kW`);
            lines[3].text(`功率因数 ${this._cos.toFixed(2)}`);
            if (this._screenText) this._screenText.text(`F3  三相功率、总功率因数`);
            return;
        }
        if (this._screen === 4) {          // F4：配电屏单线模拟图
            clear();
            this._updateOneLine();
            if (this._screenText) this._screenText.text('F4  配电屏单线图');
            return;
        }
    }

    /** F4 单线图状态更新：断路器/接地开关开合（常开触头：分闸中间线隐藏）、发电机运行着色 */
    _updateOneLine() {
        if (!this._oneLine) return;
        const qf = this._qf(), gen = this._gen();
        // 断路器：合闸=中间连线可见（触点闭合），分闸=隐藏（常开触头分离）
        const closed = qf ? qf.isClosed() : false;
        if (this._cbLine) {
            // 竖直单刀开关：闭合=刀竖直搭接（连接上下触点），断开=刀绕下触点旋转 15°
            this._cbLine.points(closed
                ? [this._cbCx, this._cbBotY, this._cbCx, this._cbTopY]
                : [this._cbCx, this._cbBotY, this._cbCx - 9.2, this._cbBotY - 13.1]);
            this._cbLine.visible(true);
        }
        // 接地开关：闭合=连线可见，断开=隐藏（常开触头分离）
        const grd = qf ? qf.isGrounded() : false;
        if (this._gsLine) {
            // 单刀单掷开关：闭合=水平搭接，断开=刀绕左端旋转 15°（上翘）
            this._gsLine.points(grd
                ? [this._gsCx - 8, this._gsCy, this._gsCx + 8, this._gsCy]
                : [this._gsCx - 8, this._gsCy, this._gsCx + 5.1, this._gsCy - 9.2]);
            this._gsLine.visible(true);
        }
        // 发电机：运行 → 亮黄色填充；停机 → 透明
        if (this._genCircle) {
            this._genCircle.fill(gen && gen.isOn ? 'rgba(255,240,0,0.6)' : 'rgba(255,240,0,0)');
        }
    }

    /** 记录报警/故障事件（FIFO，最多 7 条，旧的截断）：5 字段 = 原因 参数 延时时间 状态 触发时间 */
    _logAlarm(reason, value, delay, status) {
        const now = new Date();
        const p = (n) => String(n).padStart(2, '0');
        const timeStr = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
        this._alarmLog.unshift({ reason, value, delay: this._fmtDelay(delay), status, time: timeStr });
        if (this._alarmLog.length > 7) this._alarmLog.pop();
    }

    /** 延时时间格式化：0 → '0s'（瞬时），<10 → '1.0s'，其余 → '10s' */
    _fmtDelay(d) {
        return (typeof d === 'number' && isFinite(d))
            ? (d <= 0 ? '0s' : (d < 10 ? d.toFixed(1) + 's' : d.toFixed(0) + 's'))
            : '0s';
    }

    /** 保护动作数值文本：过载/逆功率→功率(kW)，短路/差动/接地→电流(A)，欠压→电压(V)
     *  差动用判据短窗值 _diffInst（跳闸时刻即达阈值的真实差流），不用 40 帧慢滑窗 */
    _valueText(a) {
        const m = {
            short:    `${this._fmt(this._outMaxInst / Math.SQRT2)}A`,
            diff:     `${this._fmt(this._diffInst / Math.SQRT2)}A`,
            overload: `${this._fmt(this._Pkw)}kW`,
            ground:   `${this._fmt(this._I0)}A`,
            uv:       `${this._fmt(this._V3)}V`,
            rev:      `${this._fmt(this._Pkw)}kW`,
        }[a];
        return m !== undefined ? m : '-';
    }

    _fmt(v) { return (typeof v === 'number' && isFinite(v)) ? (Math.abs(v) > 100 ? v.toFixed(0) : v.toFixed(1)) : '0'; }

    // ─────────────────────────── 公开 API ───────────────────────────
    isPowered()      { return this._powered; }
    isTripped()      { return this._tripped; }
    getActiveFault() { return this._active; }
    getTripReason()  { return this._tripReason; }
    getMeas() { return { Iout: this._Iout, Iin: this._Iin, I0: this._I0, I3: this._I3, V3: this._V3, P: this._Pkw, cos: this._cos }; }

    getConfigFields() {
        return [
            { label: '发电机 ID', key: 'genId', type: 'text' },
            { label: '真空断路器 ID', key: 'qfId', type: 'text' },
            { label: '额定电流 In(A)', key: 'In', type: 'number' },
            { label: '短路倍数 (×In)', key: 'shortMult', type: 'number' },
            { label: '过载倍数 (×In)', key: 'overloadMult', type: 'number' },
            { label: '过载延时 (s)', key: 'overloadTime', type: 'number' },
            { label: '接地倍数 (×In)', key: 'groundMult', type: 'number' },
            { label: '欠压比例 (×Un)', key: 'uvRatio', type: 'number' },
            { label: '逆功率比例 (×Pn)', key: 'revRatio', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        ['genId','qfId'].forEach(k => { if (cfg[k] !== undefined) this[k] = cfg[k]; });
        ['In','shortMult','overloadMult','overloadTime','groundMult','uvRatio','revRatio'].forEach(k => {
            if (cfg[k] !== undefined) this[k] = parseFloat(cfg[k]);
        });
        this.config = { ...this.config, ...cfg };
    }

    destroy() {
        super.destroy?.();
    }
}
