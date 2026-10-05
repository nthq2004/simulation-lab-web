import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * HvGroundMonitor 高压接地监视仪
 *
 * 外观：深色面板框（包含全部组件）——
 *      上端 3 个电气接口（L1/L2/L3）骑在面板上边缘，接电网汇流排（本工程接汇流排1 第 4 口）；
 *      中部液晶显示屏，三行分别显示 A相 / B相 / C相 绝缘电阻（MΩ）；
 *      下部报警区：报警灯 + 蜂鸣器 + 确认按钮 + 复位按钮。
 *
 * 绝缘电阻计算（单相绝缘下降近似算法）：
 *   数据来源：微机综合保护装置（prot1, HvGenProtection）——
 *       _I0  接地电流（中性点 CT 电流，A）
 *       _Vn0 中性点对地电压（V）
 *       _Vu / _Vv / _Vw  三相相电压 RMS（V）
 *   原理：
 *       三相中性点经 500Ω 接地电阻接地（IT / 高阻接地系统）。
 *       某相绝缘电阻下降 → 泄漏电流增大（该相占主导）→ 流过中性点
 *       接地电阻：Ig = E0/(Rins + Rn)（E0 为额定相电动势，Rn 为接地电阻），
 *       且中性点位移电压 Un = Ig × Rn。
 *       由 Ig 与 Un 反推故障相绝缘电阻：Rins = (E0 - Un) / Ig。
 *   精度修正：Rins = (E0 − Un)/Ig − rOn（扣除发电机内阻，金属接地时 →0）。
 *   判定：
 *       Ig ≤ 0 → 三相绝缘良好，全部显示 ---MΩ；
 *       否则取三相相电压最低相为故障相（该相绝缘下降、对地电压被拉低），
 *       其余两相显示 ---MΩ。
 *       E0 取三相平均相电压（动态追踪带载压降，比固定额定值更接近实际电动势）。
 *   显示：<0.01MΩ → 0.00MΩ；0.01~0.99MΩ → 两位小数；1~19.9MΩ → 一位小数；
 *         ≥20MΩ 或绝缘良好 → --MΩ。
 *
 * 声光报警（绝缘电阻最小值 < 1MΩ 触发）：
 *   - 报警触发：报警灯红色闪烁 + 蜂鸣器鸣叫（锁存记忆 _latched）
 *   - 按确认：消音消闪（蜂鸣停、灯转常亮）
 *   - 故障消失自动消音消闪（灯保持常亮，等待复位）
 *   - 故障消失后按复位：警报灯熄灭；故障未消失时按复位无效（灯保持常亮）
 */
export class HvGroundMonitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = 130;
        this.height = 152;
        this.type  = 'hv_ground_monitor';
        this.cache = 'fixed';
        this._initGroups();
        this._init();

        // 上端 3 个电气接口：沿设备上边缘排列（左贴边 / 居中 / 右贴边）
        this.addPort(8,  0, 'l1', 'wire');
        this.addPort(65, 0, 'l2', 'wire');
        this.addPort(122, 0, 'l3', 'wire');

        // 报警状态机
        this._fault   = false;   // 当前故障（绝缘最小值 < 1MΩ）
        this._latched = false;   // 报警锁存（故障记忆，复位前保持）
        this._ack     = false;   // 已确认（消音消闪）
        this._buzzOn  = false;   // 蜂鸣器实际鸣叫状态
        this._flashT  = 0;       // 闪烁计时
        this._minInsul = Infinity;
        this._igFilt = 0;      // 接地电流 EMA 滤波器状态
        this._audioCtx = null;
        this._osc = null;
        this._gain = null;

        this._lastTexts = ['', '', ''];
        this.config = {};
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        // 面板外框：包含全部组件（端子引线、显示屏、报警区）
        s.add(new Konva.Rect({ x: 2, y: 2, width: 126, height: 150, fill: '#1d2a24', stroke: '#3b4b40', strokeWidth: 2, cornerRadius: 4 }));
        // 上端 3 个电气接口端子：骑在面板上边缘（左贴边 / 居中 / 右贴边）
        const termX = [8, 65, 122];
        termX.forEach((x, i) => {
            s.add(new Konva.Circle({ x, y: 3, radius: 4, fill: '#c8ccd0', stroke: '#2c3a45', strokeWidth: 1.2 }));
            s.add(new Konva.Line({ points: [x, 7, x, 19], stroke: '#9aa4ad', strokeWidth: 2 }));
            s.add(new Konva.Text({ x: x - 12, y: 20, width: 24, text: ['L1', 'L2', 'L3'][i], fontSize: 8, fill: '#8a929a', align: 'center', listening: false }));
        });
        // 屏幕（深绿底）
        s.add(new Konva.Rect({ x: 8, y: 31, width: 114, height: 88, fill: '#0a2a1c', stroke: '#1e4b33', strokeWidth: 1, cornerRadius: 2 }));
        // 标题
        s.add(new Konva.Text({ x: 8, y: 30, width: 114, text: '接地监视仪', fontSize: 15, fill: '#9fe8a8', align: 'center', listening: false }));
        // 分隔线
        s.add(new Konva.Line({ points: [12, 47, 118, 47], stroke: '#1e4b33', strokeWidth: 1 }));
        // 三行相标签
        ['A相', 'B相', 'C相'].forEach((label, i) => {
            s.add(new Konva.Text({ x: 16, y: 60 + i * 18, width: 30, text: label, fontSize: 14, fill: '#7fd6a0', fontStyle: 'bold', listening: false }));
            s.add(new Konva.Text({ x: 46, y: 60 + i * 18, width: 36, text: '：', fontSize: 14, fill: '#5fae8f', listening: false }));
        });

        // ── 报警区（显示屏下方，均包含在面板内）──
        // 报警灯底座环
        s.add(new Konva.Circle({ x: 18, y: 133, radius: 10, fill: '#241010', stroke: '#4a2020', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: 4, y: 142, width: 26, text: '报警', fontSize: 7, fill: '#c0a0a0', align: 'center', listening: false }));
        // 蜂鸣器（喇叭主体 + 喇叭口，整体左移避开确认按钮）
        s.add(new Konva.Rect({ x: 36, y: 128, width: 8, height: 10, fill: '#3a3f47', cornerRadius: 1 }));
        s.add(new Konva.Line({ points: [44, 129, 48, 127, 48, 139, 44, 137], closed: true, fill: '#3a3f47', stroke: '#1a252f', strokeWidth: 0.8 }));
        s.add(new Konva.Text({ x: 27, y: 142, width: 28, text: '蜂鸣', fontSize: 7, fill: '#c0c4c8', align: 'center', listening: false }));
        // 确认按钮（加大 30×18）
        s.add(new Konva.Rect({ x: 62, y: 126, width: 30, height: 18, fill: '#1d3a2a', stroke: '#3fbf6f', strokeWidth: 1.4, cornerRadius: 2 }));
        s.add(new Konva.Text({ x: 62, y: 129, width: 30, text: '确认', fontSize: 11, fill: '#8ff0b0', align: 'center', listening: false }));
        // 复位按钮（加大 30×18）
        s.add(new Konva.Rect({ x: 94, y: 126, width: 30, height: 18, fill: '#1d2c3a', stroke: '#3f9fdf', strokeWidth: 1.4, cornerRadius: 2 }));
        s.add(new Konva.Text({ x: 94, y: 129, width: 30, text: '复位', fontSize: 11, fill: '#90c8f0', align: 'center', listening: false }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        // 三相绝缘电阻显示（荧光绿，右对齐）
        this._valTexts = [];
        for (let i = 0; i < 3; i++) {
            const t = new Konva.Text({ x: 62, y: 59 + i * 18, width: 56, text: '--MΩ', fontSize: 14, fill: '#b8ffc0', fontStyle: 'bold', align: 'right', listening: false });
            d.add(t);
            this._valTexts.push(t);
        }
        // 报警灯（红色，动态：灭 / 闪烁 / 常亮）
        this._alarmLed = new Konva.Circle({ x: 18, y: 133, radius: 7, fill: '#4a1010', stroke: '#8a3030', strokeWidth: 1 });
        d.add(this._alarmLed);
        // 蜂鸣器声波（动态：鸣叫时红色闪烁，紧贴喇叭口不进入按钮区）
        this._waveArcs = [];
        [4, 6, 8].forEach((r, i) => {
            const a = new Konva.Arc({
                x: 35, y: 133, innerRadius: r, outerRadius: r + 1.5,
                angle: 90, rotation: -40, fill: '#c03030', visible: false,
            });
            d.add(a);
            this._waveArcs.push(a);
        });
    }

    /** 确认：消音消闪（灯转常亮） */
    _onAck() {
        if (this._latched) this._ack = true;
    }

    /** 复位：仅故障消失后有效，熄灭警报灯；否则保持常亮 */
    _onReset() {
        if (this._latched && !this._fault) {
            this._latched = false;
            this._ack = false;
        }
    }

    _bindInteraction() {
        const ackHit = this.addClickablePart('ack', 62, 126, 30, 18);
        ackHit.on('click tap', (e) => { e.cancelBubble = true; this._onAck(); });
        const rstHit = this.addClickablePart('reset', 94, 126, 30, 18);
        rstHit.on('click tap', (e) => { e.cancelBubble = true; this._onReset(); });
    }

    /** 读微机综合保护装置（prot1）的电气量 */
    _readProt() {
        const prot = (this.sys && this.sys.comps) ? this.sys.comps.prot1 : null;
        if (!prot) return null;
        return {
            ig: prot._I0 || 0,       // 接地电流 A
            un: prot._Vn0 || 0,      // 中性点对地电压 V
            ua: prot._Vu || 0,       // A相相电压 V
            ub: prot._Vv || 0,
            uc: prot._Vw || 0,
            unNom: (prot.Un || 6600) / Math.sqrt(3),   // 额定相电压 V
        };
    }

    /** 计算三相绝缘电阻（MΩ），绝缘良好返回 null */
    _calcInsul(d) {
        if (!d) return [null, null, null];
        const { ig, un, ua, ub, uc, unNom } = d;
        // 无泄漏电流 → 三相绝缘良好（null 即显示 ---MΩ）
        if (ig <= 0) return [null, null, null];
        // 故障相判定：优先按绝缘支路实际接入相（微弱泄漏时相电压差异仅存于噪声，
        //   取"最低相压"会随求解抖动在 A/B/C 间跳变）；推断失败才回退取最低相压。
        const idx = this._faultPhaseIdx({ ua, ub, uc });
        // Rins = (E0 - Un) / Ig − rOn（扣除发电机内阻，金属接地时 →0，提高精度）
        // E0 采用三相平均相电压（等效实际电动势，动态追踪带载压降比额定值更准）
        const gen = (this.sys && this.sys.comps) ? this.sys.comps.gen_hv : null;
        const rOn = (gen && (gen._rOnEff || gen.rOn)) || 2;
        const e0 = ((ua + ub + uc) / 3) || unNom;   // 三相平均相电压，无电压时回退额定
        const r = Math.max(0, (e0 - un) / ig - rOn);   // Ω
        const out = [null, null, null];
        out[idx] = r / 1e6;                               // MΩ
        return out;
    }

    /**
     * 故障相下标（0/1/2）：
     * 1) 若存在绝缘电阻组件 r_insul，按其高压端连线所接的汇流排相端口推断（l1→A，l2→B，l3→C）；
     * 2) 否则回退：三相相电压最低相。
     */
    _faultPhaseIdx({ ua, ub, uc }) {
        const sys = this.sys;
        if (sys && sys.conns && sys.comps && sys.comps.r_insul) {
            const comp = sys.comps.r_insul;
            const wire = comp.id + '_wire_l';                      // 绝缘电阻高压端
            const link = sys.conns.find(c => c.from === wire || c.to === wire);
            if (link) {
                const other = link.from === wire ? link.to : link.from;
                const m = /_wire_l([123])_/.exec(other);
                if (m) return parseInt(m[1], 10) - 1;              // l1→A(0), l2→B(1), l3→C(2)
            }
        }
        const vals = [ua, ub, uc];
        return vals.indexOf(Math.min(ua, ub, uc));
    }

    /** 显示格式：<0.01MΩ → 0.00MΩ；0.01~0.99 → 2 位小数；1~19.9 → 1 位小数；≥20 或绝缘良好 → --MΩ */
    _fmt(r) {
        if (r === null) return '--MΩ';
        if (r < 0.01) return '0.00MΩ';
        if (r < 1) return r.toFixed(2) + 'MΩ';
        if (r >= 20) return '--MΩ';
        return r.toFixed(1) + 'MΩ';
    }

    /** 启动蜂鸣（1.8kHz 方波） */
    _beepStart() {
        try {
            if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this._osc) return;
            const ctx = this._audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            this._osc = ctx.createOscillator();
            this._gain = ctx.createGain();
            this._osc.type = 'square';
            this._osc.frequency.value = 1800;
            this._gain.gain.value = 0.04;
            this._osc.connect(this._gain);
            this._gain.connect(ctx.destination);
            this._osc.start();
        } catch (e) { /* 忽略音频错误 */ }
    }

    /** 停止蜂鸣并清理音频节点 */
    _beepStop() {
        try {
            if (this._osc) { this._osc.stop(); this._osc.disconnect(); this._osc = null; }
            if (this._gain) { this._gain.disconnect(); this._gain = null; }
        } catch (e) { /* 忽略 */ }
    }

    tick(dt) {
        const d = this._readProt();
        if (d) {
            // 接地电流 EMA 平滑：10MΩ 级微弱泄漏（~0.4mA）易受求解噪声扰动，
            // 平滑后可避免阻值显示抖动/与 "--MΩ" 之间闪断
            this._igFilt = this._igFilt * 0.55 + d.ig * 0.45;
            d.ig = this._igFilt;
        }
        const res = this._calcInsul(d);
        // 绝缘电阻显示
        const texts = res.map(r => this._fmt(r));
        for (let i = 0; i < 3; i++) {
            if (this._valTexts[i] && this._valTexts[i].text() !== texts[i]) {
                this._valTexts[i].text(texts[i]);
            }
        }

        // ── 声光报警状态机 ──
        const valid = res.filter(r => r !== null);
        this._minInsul = valid.length ? Math.min(...valid) : Infinity;
        this._fault = this._minInsul < 1;          // 绝缘电阻最小值 < 1MΩ → 故障
        if (this._fault) this._latched = true;     // 锁存报警记忆
        // 鸣叫/闪烁：仅锁存 + 未确认 + 故障仍存在（故障消失自动消音消闪，灯转常亮）
        const buzz = this._latched && !this._ack && this._fault;
        if (buzz && !this._buzzOn) this._beepStart();
        if (!buzz && this._buzzOn) this._beepStop();
        this._buzzOn = buzz;
        // 报警灯：灭 / 闪烁（鸣叫时）/ 常亮（确认或故障消失后）
        if (!this._latched) {
            this._alarmLed.fill('#4a1010');
            this._flashT = 0;
        } else if (buzz) {
            this._flashT += dt;
            this._alarmLed.fill((Math.floor(this._flashT * 4) % 2 === 0) ? '#ff3020' : '#a01515');
        } else {
            this._alarmLed.fill('#ff3020');
        }
        // 蜂鸣器声波弧：鸣叫时红色闪烁
        const waveOn = buzz && (Math.floor(this._flashT * 4) % 2 === 0);
        this._waveArcs.forEach((a, i) => {
            a.visible(waveOn);
            a.fill(waveOn ? ['#c03030', '#e05040', '#ff6050'][i] : '#c03030');
        });

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() { return []; }
}