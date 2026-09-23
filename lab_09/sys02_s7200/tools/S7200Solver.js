/**
 * S7200Solver — 西门子 S7-200 SMART 指令表（STL）解释器与扫描周期引擎
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  仿真对象：CPU SR40（24 DI / 16 DO / 2 AI / 1 AO）
 *
 *  执行模型（与真实 PLC 一致的扫描周期）：
 *    1. 读取物理输入（DI 端口电平、AI 端口电压）→ 刷新过程映像输入 I
 *    2. 执行用户程序（指令表逐条解释，RLO 累加器 + 位/字操作）
 *    3. 刷新过程映像输出 Q → 写入物理 DO 端口状态
 *    4. 系统管理与通信（此处从简：更新扫描计数/看门狗）
 *
 *  支持的指令（STL）：
 *    位逻辑： LD  LDN  A  AN  O  ON  NOT  =  S  R  SI  RI  EU  ED
 *    置位/复位：S（置位 N 位）、R（复位 N 位）
 *    定时器：  TON  TOF  TONR（T37~T255，时基 1ms/10ms/100ms）
 *    计数器：  CTU  CTD  CTUD（C0~C255）
 *    比较：    =I  <>I  >I  <I  >=I  <=I（及 B/W/D 变体简化为整数）
 *    传送：    MOV_B  MOV_W  MOV_DW
 *    算术：    +I  -I  *I  /I  INC_W  DEC_W
 *    逻辑：    AND_W  OR_W  XOR_W
 *    移位/转换：SLW  SRW  BTI  ITB
 *    跳转：    JMP  LBL  FOR  NEXT
 *    程序控制：STOP  END（END 正常结束扫描 / STOP 进入停止模式）
 *    空操作：  NOP
 *
 *  操作数：
 *    I0.0~I3.7（输入位）      Q0.0~Q1.7（输出位）      M0.0~M31.7（位存储）
 *    SM0.0~SM0.5（特殊存储）  T0~T255 / C0~C255（定时器/计数器，当前值 + 位）
 *    AIW0/AIW1（模拟量输入字） AQW0（模拟量输出字）
 *    VB/VW/VD（变量存储）     IW/QW/MW（字）
 *    SMB/SMW（特殊存储字节/字）
 *
 *  仿真量纲：定时器时基 TON/TOF 当前值以 100ms/10ms/1ms 计（整数，与实物一致）；
 *            AIW 按 0~10V 线性映射到 0~27648。
 * ═══════════════════════════════════════════════════════════════════════════
 */

const T_BASE = {
    // S7-200 SMART 定时器编号 → 时基（ms）
    ms1: [32, 33, 34, 35, 36, 37, 38, 39, 40, 41],
    ms10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
};

function timerBase(tn) {
    if (T_BASE.ms1.includes(tn)) return 1;
    return 100; // T33~T255 中 T33~T36 为 10ms，其余 100ms；教学用统一 100ms
}

export class S7200Solver {
    constructor(sys) {
        this.sys = sys;
        this._plcs = new Map();        // plcId → 运行时上下文
        this.defaultScanMs = 15;       // 单扫描周期目标（模拟 CPU 扫描）
    }

    // ═══════════════════════════════════════════════════════
    // 发现 & 生命周期
    // ═══════════════════════════════════════════════════════
    _discoverPLCs() {
        if (!this.sys || !this.sys.comps) return [];
        return Object.values(this.sys.comps).filter(c => c && c.type === 'plc_s7200');
    }

    _createContext(plc) {
        return {
            plc,
            scanCount: 0,
            // 过程映像 + 内部存储
            I: new Array(64).fill(false),   // I0.0~I7.7
            Q: new Array(64).fill(false),   // Q0.0~Q7.7
            M: new Array(256).fill(false),  // M0.0~M31.7
            SM: new Array(64).fill(false),  // SM0.0~SM7.7
            T: Array.from({ length: 256 }, () => ({ bit: false, cur: 0, base: 0, type: null, preset: 0, run: false })),
            C: Array.from({ length: 256 }, () => ({ bit: false, cur: 0, preset: 0, type: null })),
            AIW: [0, 0, 0, 0, 0, 0, 0, 0],
            AQW: [0, 0, 0, 0, 0, 0, 0, 0],
            V: new Array(4096).fill(0),     // V 存储区（字节）
            SMB: new Array(64).fill(0),
            SMW: new Array(64).fill(0),
            // 指令解释器状态
            compiled: null,
            rlo: false,
            rloInStack: [],
            firstScan: true,
            lastScan: false,
            errorFlag: false,
            retval: 0,
            labels: {},
            jmp: null,
            // 特殊存储位默认值
            _prev: { I: new Array(64).fill(false) },
        };
    }

    resetPLC(plcId) {
        const plc = this.sys.comps[plcId];
        if (!plc) return;
        const ctx = this._createContext(plc);
        if (plc._programText) this._compile(ctx, plc._programText);
        this._plcs.set(plcId, ctx);
    }

    reloadProgram(plcId) {
        const plc = this.sys.comps[plcId];
        const ctx = this._plcs.get(plcId);
        if (!plc || !ctx) { this.resetPLC(plcId); return; }
        ctx.compiled = null;
        this._compile(ctx, plc._programText || '');
        ctx.errorFlag = false;
    }

    getDiagnostics(plcId) {
        const ctx = this._plcs.get(plcId);
        if (!ctx) return null;
        return {
            scanCount: ctx.scanCount,
            error: ctx.errorFlag,
            mode: this.sys.comps[plcId] ? this.sys.comps[plcId].mode : 'STOP',
            compiledLines: ctx.compiled ? ctx.compiled.lines.length : 0,
        };
    }

    // ═══════════════════════════════════════════════════════
    // 编译（STL 文本 → 指令数组）
    // ═══════════════════════════════════════════════════════
    _compile(ctx, text) {
        const lines = [];
        const labels = {};
        const raw = String(text || '').split(/\r?\n/);

        for (let ln of raw) {
            // 去掉注释 //... 与首尾空白
            ln = ln.replace(/\/\/.*$/, '').trim();
            if (!ln) continue;
            // 标签  LABEL:  或  标签行
            let m = ln.match(/^([A-Za-z_]\w*)\s*:\s*(.*)$/);
            if (m) {
                labels[m[1].toUpperCase()] = lines.length;
                ln = m[2].trim();
                if (!ln) continue;
            }
            lines.push({ text: ln, op: null, srcLine: lines.length + 1 });
        }

        // 解析每条指令
        lines.forEach(rec => { rec.op = this._parse(rec.text); });

        ctx.compiled = { lines, labels };
        ctx.labels = labels;
        return ctx.compiled;
    }

    _parse(text) {
        const parts = text.split(/\s+/);
        const mnem = parts[0].toUpperCase();
        let operand = parts.slice(1).join(' ').trim();
        // 参数用逗号分隔
        const args = operand ? operand.split(',').map(s => s.trim()).filter(Boolean) : [];
        return { mnem, args, operand };
    }

    // ═══════════════════════════════════════════════════════
    // 扫描周期
    // ═══════════════════════════════════════════════════════
    update(deltaTime) {
        const plcs = this._discoverPLCs();
        for (const plc of plcs) {
            let ctx = this._plcs.get(plc.id);
            if (!ctx) {
                ctx = this._createContext(plc);
                if (plc._programText) this._compile(ctx, plc._programText);
                this._plcs.set(plc.id, ctx);
            }
            if (plc.mode !== 'RUN') {
                this._syncDisplay(plc, ctx);
                continue;
            }
            this._scan(plc, ctx, deltaTime);
            this._syncDisplay(plc, ctx);
        }
    }

    _scan(plc, ctx, dt) {
        // ── 1. 读取物理输入 → 过程映像 I ──
        this._readInputs(plc, ctx);
        // ── 更新特殊存储位 ──
        ctx._elapsed = (ctx._elapsed || 0) + dt;
        this._updateSM(ctx);

        // 上一扫描的 I 备份（用于 EU/ED）
        ctx._prev.I = ctx.I.slice();

        // ── 2. 执行用户程序 ──
        ctx.rlo = false;
        ctx.jmp = null;
        if (ctx.compiled) {
            const code = ctx.compiled.lines;
            for (let pc = 0; pc < code.length; pc++) {
                if (ctx.errorFlag) break;
                try {
                    this._exec(ctx, code[pc], code, pc, dt);
                } catch (e) {
                    ctx.errorFlag = String(e && e.message || e);
                    break;
                }
                if (ctx.jmp !== null) { pc = ctx.jmp - 1; ctx.jmp = null; }
            }
        }

        // ── 3. 刷新过程映像 Q → 物理输出 ──
        this._writeOutputs(plc, ctx);

        ctx.scanCount++;
        ctx.firstScan = false;
        ctx.lastScan = true;
    }

    _updateSM(ctx) {
        // SM0.0 始终为 1
        ctx.SM[0 * 8 + 0] = true;
        // SM0.1 首次扫描为 1
        ctx.SM[0 * 8 + 1] = ctx.firstScan;
        // SM0.2 保持性数据丢失：始终 0
        ctx.SM[0 * 8 + 2] = false;
        // SM0.3 上电后进入 RUN：首次扫描为 1
        ctx.SM[0 * 8 + 3] = ctx.firstScan;
        // SM0.4 60s 时钟（30s 通 / 30s 断）
        const sec = ctx._elapsed || 0;
        ctx.SM[0 * 8 + 4] = (Math.floor(sec) % 60) < 30;
        // SM0.5 1s 时钟（0.5s 通 / 0.5s 断）
        ctx.SM[0 * 8 + 5] = (Math.floor(sec * 2) % 2) === 0;
    }

    // ═══════════════════════════════════════════════════════
    // 物理 I/O 读写
    // ═══════════════════════════════════════════════════════
    _readInputs(plc, ctx) {
        const s = this.sys.voltageSolver;
        const getV = (pid) => {
            if (!s || !s.portToCluster) return null;
            const c = s.portToCluster.get(`${plc.id}_wire_${pid}`);
            return c === undefined ? null : (s.nodeVoltages.get(c) || 0);
        };
        const same = (a, b) => {
            if (!s || !s.portToCluster) return false;
            const ca = s.portToCluster.get(`${plc.id}_wire_${a}`);
            const cb = s.portToCluster.get(`${plc.id}_wire_${b}`);
            return ca !== undefined && cb !== undefined && ca === cb;
        };

        // 公共端参考：1M 为 DI0.x~1.x 组公共端，2M 为 DI1.4~2.7 组公共端
        const v1m = getV('1m');
        const v2m = getV('2m');
        const ref1 = v1m !== null ? v1m : 0;
        const ref2 = v2m !== null ? v2m : ref1;

        // 传感器电源 24V，用于判定 DI 是否被拉到高电平
        const v24 = getV('24v');
        const v0  = getV('v0');
        const vGnd = getV('mm');
        const lowRef = (v0 !== null ? v0 : (vGnd !== null ? vGnd : 0));
        const hasSupply = v24 !== null;
        const SUPPLY = hasSupply ? v24 : lowRef;

        // DI 判定：输入端口相对公共端（1M/2M）电压 > 阈值即视为 ON。
        // 同时兼顾源型（接 24V）与漏型（接 0V）两种接法：
        //   - 节点电压接近 24V 供电 → ON
        //   - 节点与 24V 同簇（导线直连）→ ON
        // 悬空节点电压≈0，判为 OFF。
        for (const pin of plc.diPins) {
            const v = getV(pin);
            const bit = pinToBit(pin);
            const ref = bit <= 11 ? ref1 : ref2;
            let on = false;
            if (same(pin, '24v')) {
                on = true;
            } else if (v !== null) {
                // 相对公共端高于约 12V（半幅）判为高电平
                const relPublic = Math.abs(v - ref);
                // 相对地高于约 12V 且接近 24V 供电（源型接法）
                const relLow = Math.abs(v - lowRef);
                on = relPublic > 12 && (relLow > 12);
            }
            ctx.I[bit] = on;
        }

        // AI 输入（AIW0/AIW1）：0~10V 线性映射 0~27648
        const va0 = getV('ai0'), va1 = getV('ai1');
        ctx.AIW[0] = clampWord(((va0 !== null ? va0 : 0)) / 10 * 27648);
        ctx.AIW[1] = clampWord(((va1 !== null ? va1 : 0)) / 10 * 27648);
    }

    _writeOutputs(plc, ctx) {
        // 把 Q 位写入组件供渲染，并由拓扑层读取触点状态
        plc._qBits = ctx.Q.slice();
        plc._aqw0 = ctx.AQW[0];
        // DO 输出端口由组件 tick 读取 _qBits 决定是否与 0V/24V 内部导通
        // （见 CircuitTopology 中 plc_s7200 分支）
    }

    _syncDisplay(plc, ctx) {
        plc._display = {
            scanCount: ctx.scanCount,
            error: ctx.errorFlag,
            di: ctx.I.slice(0, 24),
            dq: ctx.Q.slice(0, 16),
        };
    }

    // ═══════════════════════════════════════════════════════
    // 指令执行
    // ═══════════════════════════════════════════════════════
    _exec(ctx, inst, code, pc, dt) {
        const { mnem, args } = inst.op;
        const rlo = ctx.rlo;

        switch (mnem) {
            // ── 位逻辑 ──
            case 'LD':  ctx.rlo = this._bit(ctx, args[0]); break;
            case 'LDN': ctx.rlo = !this._bit(ctx, args[0]); break;
            case 'A':   ctx.rlo = rlo && this._bit(ctx, args[0]); break;
            case 'AN':  ctx.rlo = rlo && !this._bit(ctx, args[0]); break;
            case 'O':   ctx.rlo = rlo || this._bit(ctx, args[0]); break;
            case 'ON':  ctx.rlo = rlo || !this._bit(ctx, args[0]); break;
            case 'NOT': ctx.rlo = !rlo; break;
            case '=':   this._setBit(ctx, args[0], rlo); break;
            case 'S':
                if (!rlo) break;
                if (this._resetTimerCounter(ctx, args[0], true)) break;
                this._setBit(ctx, args[0], true);
                if (args[1] !== undefined) this._setBitsRange(ctx, args[0], parseInt(args[1]), true);
                break;
            case 'R':
                if (!rlo) break;
                if (this._resetTimerCounter(ctx, args[0], false)) break;
                this._setBit(ctx, args[0], false);
                if (args[1] !== undefined) this._setBitsRange(ctx, args[0], parseInt(args[1]), false);
                break;
            case 'SI': if (rlo) this._setBitImm(ctx, args[0], true); break;   // 立即置位
            case 'RI': if (rlo) this._setBitImm(ctx, args[0], false); break;
            case 'EU': ctx.rlo = rlo && !ctx._euState; ctx._euState = rlo; break;
            case 'ED': ctx.rlo = rlo && ctx._euState; ctx._euState = rlo; break;

            // ── 定时器 ──
            case 'TON':  this._timer(ctx, args, 'TON', dt); break;
            case 'TOF':  this._timer(ctx, args, 'TOF', dt); break;
            case 'TONR': this._timer(ctx, args, 'TONR', dt); break;
            case 'R_T' : this._resetTimer(ctx, args[0]); break;

            // ── 计数器 ──
            case 'CTU':  this._counter(ctx, args, 'CTU'); break;
            case 'CTD':  this._counter(ctx, args, 'CTD'); break;
            case 'CTUD': this._counter(ctx, args, 'CTUD'); break;

            // ── 比较（整数）──
            case '=I': case '==I': ctx.rlo = rlo && (this._word(ctx, args[0]) === this._word(ctx, args[1])); break;
            case '<>I': ctx.rlo = rlo && (this._word(ctx, args[0]) !== this._word(ctx, args[1])); break;
            case '>I':  ctx.rlo = rlo && (this._word(ctx, args[0]) >  this._word(ctx, args[1])); break;
            case '<I':  ctx.rlo = rlo && (this._word(ctx, args[0]) <  this._word(ctx, args[1])); break;
            case '>=I': ctx.rlo = rlo && (this._word(ctx, args[0]) >= this._word(ctx, args[1])); break;
            case '<=I': ctx.rlo = rlo && (this._word(ctx, args[0]) <= this._word(ctx, args[1])); break;

            // ── 传送 ──
            case 'MOV_B':  this._mov(ctx, args, 1); break;
            case 'MOV_W':  this._mov(ctx, args, 2); break;
            case 'MOV_DW': this._mov(ctx, args, 4); break;
            case 'MOV':    this._mov(ctx, args, 2); break;

            // ── 算术（整数）──
            case '+I': this._arith(ctx, args, (a, b) => a + b); break;
            case '-I': this._arith(ctx, args, (a, b) => a - b); break;
            case '*I': this._arith(ctx, args, (a, b) => a * b); break;
            case '/I': this._arith(ctx, args, (a, b) => b === 0 ? 0 : Math.trunc(a / b)); break;
            case 'INC_W': this._arith(ctx, [args[0], '1'], (a, b) => a + b); break;
            case 'DEC_W': this._arith(ctx, [args[0], '1'], (a, b) => a - b); break;
            case 'AND_W': this._arith(ctx, args, (a, b) => a & b); break;
            case 'OR_W':  this._arith(ctx, args, (a, b) => a | b); break;
            case 'XOR_W': this._arith(ctx, args, (a, b) => a ^ b); break;

            // ── 移位 ──
            case 'SLW': this._shift(ctx, args, 'l'); break;
            case 'SRW': this._shift(ctx, args, 'r'); break;

            // ── 转换 ──
            case 'BTI': this._wordWrite(ctx, args[1], this._byte(ctx, args[0])); break;
            case 'ITB': this._byteWrite(ctx, args[1], this._word(ctx, args[0]) & 0xFF); break;

            // ── 跳转 ──
            case 'JMP':
                if (ctx.rlo) {
                    const lab = String(args[0]).toUpperCase();
                    if (ctx.labels[lab] !== undefined) ctx.jmp = ctx.labels[lab];
                }
                break;
            case 'LBL': break;

            // ── 程序控制 ──
            case 'STOP': ctx.plc.mode = 'STOP'; ctx.jmp = code.length; break;
            case 'END':  ctx.jmp = code.length; break;
            case 'NOP':  break;

            default:
                // 未识别指令：记录但不中断（容错）
                break;
        }
    }

    // ── 位读写 ──
    _bit(ctx, operand) {
        const a = parseAddr(operand);
        if (!a) return false;
        switch (a.area) {
            case 'I': return !!ctx.I[a.idx];
            case 'Q': return !!ctx.Q[a.idx];
            case 'M': return !!ctx.M[a.idx];
            case 'SM': return !!ctx.SM[a.idx];
            case 'T': return ctx.T[a.num] ? ctx.T[a.num].bit : false;
            case 'C': return ctx.C[a.num] ? ctx.C[a.num].bit : false;
            case 'V': return (((ctx.V[a.off] || 0) >> a.bit) & 1) === 1;
            default: return false;
        }
    }

    _setBit(ctx, operand, val) {
        const a = parseAddr(operand);
        if (!a) return;
        switch (a.area) {
            case 'I': ctx.I[a.idx] = val; break;   // 程序中写 I 仅改映像
            case 'Q': ctx.Q[a.idx] = val; break;
            case 'M': ctx.M[a.idx] = val; break;
            case 'SM': ctx.SM[a.idx] = val; break;
            case 'T': if (ctx.T[a.num]) ctx.T[a.num].bit = val; break;
            case 'C': if (ctx.C[a.num]) ctx.C[a.num].bit = val; break;
            case 'V':
                if (val) ctx.V[a.off] = (ctx.V[a.off] || 0) | (1 << a.bit);
                else ctx.V[a.off] = (ctx.V[a.off] || 0) & ~(1 << a.bit);
                break;
        }
    }

    _setBitImm(ctx, operand, val) {
        this._setBit(ctx, operand, val);
        // 立即输出：同时刷新物理输出
        const a = parseAddr(operand);
        if (a && a.area === 'Q' && val) {
            const plc = ctx.plc;
            if (plc && plc._qBits) plc._qBits[a.idx] = true;
        }
    }

    _setBitsRange(ctx, startOperand, count, val) {
        const a = parseAddr(startOperand);
        if (!a) return;
        const n = Math.max(1, count | 0);
        for (let i = 0; i < n; i++) {
            const idx = a.idx + i;
            this._setBit(ctx, `${a.area}${Math.floor(idx / 8)}.${idx % 8}`, val);
        }
    }

    // ── 定时器 ──
    _timer(ctx, args, type, dt) {
        const tRef = String(args[0]).toUpperCase();        // 如 T37
        const m = tRef.match(/^T(\d+)$/);
        if (!m) return;
        const num = parseInt(m[1]);
        const preset = this._word(ctx, args[1]);
        const t = ctx.T[num];
        if (!t) return;

        const base = timerBase(num);
        const dtMs = dt * 1000;
        const inc = Math.max(1, Math.round(dtMs / base));   // 本次扫描应增加的计数值

        if (type === 'TON') {
            if (ctx.rlo) {
                if (t.cur < preset) {
                    t.cur = Math.min(preset, t.cur + inc);
                    t.bit = t.cur >= preset;
                } else t.bit = true;
            } else {
                t.cur = 0; t.bit = false;
            }
        } else if (type === 'TOF') {
            if (ctx.rlo) { t.bit = true; t.cur = 0; }
            else {
                if (t.bit) {
                    t.cur = Math.min(preset, t.cur + inc);
                    if (t.cur >= preset) t.bit = false;
                }
            }
        } else if (type === 'TONR') {
            if (ctx.rlo) {
                if (t.cur < preset) {
                    t.cur = Math.min(preset, t.cur + inc);
                    t.bit = t.cur >= preset;
                } else t.bit = true;
            }
            // 断开时保持当前值（保持型）
        }
        t.base = base; t.preset = preset; t.type = type;
    }

    _resetTimer(ctx, operand) {
        const m = String(operand).toUpperCase().match(/^T(\d+)$/);
        if (!m) return;
        const t = ctx.T[parseInt(m[1])];
        if (t) { t.cur = 0; t.bit = false; }
    }

    // S/R 作用于定时器或计数器：复位当前值；返回 true 表示已处理
    _resetTimerCounter(ctx, operand, isSet) {
        const s = String(operand).toUpperCase();
        let m = s.match(/^T(\d+)$/);
        if (m) {
            const t = ctx.T[parseInt(m[1])];
            if (t) { t.cur = 0; t.bit = false; }
            return true;
        }
        m = s.match(/^C(\d+)$/);
        if (m) {
            const c = ctx.C[parseInt(m[1])];
            if (c) { c.cur = 0; c.bit = false; }
            return true;
        }
        return false;
    }

    // ── 计数器 ──
    //   S7-200 语法：RLO 为计数脉冲输入；复位用独立的 LD <R位> / R Cx, 1 实现。
    //   为便于教学，额外支持 "CTU Cx, PV, R位" 三元写法（第三参非零即复位）。
    _counter(ctx, args, type) {
        const cRef = String(args[0]).toUpperCase();
        const m = cRef.match(/^C(\d+)$/);
        if (!m) return;
        const num = parseInt(m[1]);
        const preset = this._word(ctx, args[1]);
        const c = ctx.C[num];
        if (!c) return;

        const reset = (args[2] !== undefined) && (this._word(ctx, args[2]) !== 0);

        if (type === 'CTU') {
            if (reset) c.cur = 0;
            else if (ctx.rlo && !c._prevRlo) c.cur = Math.min(32767, c.cur + 1);
            c.bit = c.cur >= preset;
        } else if (type === 'CTD') {
            if (reset) c.cur = preset;
            else if (ctx.rlo && !c._prevRlo) c.cur = Math.max(0, c.cur - 1);
            c.bit = c.cur <= 0;
        } else if (type === 'CTUD') {
            if (reset) c.cur = 0;
            else {
                if (ctx.rlo && !c._prevRlo) c.cur++;
                const cd = (args[2] !== undefined) ? this._word(ctx, args[2]) : 0;
                if (cd && !c._prevCd) c.cur--;
            }
            c.bit = c.cur >= preset;
            c._prevCd = (args[2] !== undefined) ? this._word(ctx, args[2]) : 0;
        }
        c._prevRlo = ctx.rlo;
        c.preset = preset; c.type = type;
    }

    // ── 字/字节读写 ──
    _word(ctx, operand) {
        if (operand === undefined || operand === null || operand === '') return 0;
        const a = parseAddr(operand);
        if (!a) {
            const n = Number(operand);
            return isFinite(n) ? n : 0;
        }
        switch (a.area) {
            case 'AIW': return ctx.AIW[a.num] || 0;
            case 'AQW': return ctx.AQW[a.num] || 0;
            case 'IW':  return this._readWordBits(ctx.I, a.num * 16);
            case 'QW':  return this._readWordBits(ctx.Q, a.num * 16);
            case 'MW':  return this._readWordBits(ctx.M, a.num * 16);
            case 'SMW': return ctx.SMW[a.num] || 0;
            case 'T':   return ctx.T[a.num] ? ctx.T[a.num].cur : 0;
            case 'C':   return ctx.C[a.num] ? ctx.C[a.num].cur : 0;
            case 'VW':  return (ctx.V[a.off] | (ctx.V[a.off + 1] << 8));
            case 'VD':  return (ctx.V[a.off] | (ctx.V[a.off + 1] << 8) | (ctx.V[a.off + 2] << 16) | (ctx.V[a.off + 3] << 24));
            case 'V':   return ctx.V[a.off] || 0;
            case 'I': case 'Q': case 'M': case 'SM':
                // 位地址用作字时按位值 0/1
                return this._bit(ctx, operand) ? 1 : 0;
            default:
                return 0;
        }
    }

    _byte(ctx, operand) {
        return this._word(ctx, operand) & 0xFF;
    }

    _wordWrite(ctx, destOperand, value) {
        const a = parseAddr(destOperand);
        if (!a) return;
        value = clampWord(value);
        switch (a.area) {
            case 'AQW': if (ctx.AQW[a.num] !== undefined) ctx.AQW[a.num] = value; break;
            case 'QW':  this._writeWordBits(ctx.Q, a.num * 16, value, 'Q'); break;
            case 'MW':  this._writeWordBits(ctx.M, a.num * 16, value, 'M'); break;
            case 'SMW': ctx.SMW[a.num] = value; break;
            case 'VW':
                ctx.V[a.off] = value & 0xFF;
                ctx.V[a.off + 1] = (value >> 8) & 0xFF;
                break;
            case 'VD':
                ctx.V[a.off] = value & 0xFF;
                ctx.V[a.off + 1] = (value >> 8) & 0xFF;
                ctx.V[a.off + 2] = (value >> 16) & 0xFF;
                ctx.V[a.off + 3] = (value >> 24) & 0xFF;
                break;
            case 'V': ctx.V[a.off] = value & 0xFF; break;
            case 'AIW': case 'AQW_OK': break;
            default: break;
        }
    }

    _byteWrite(ctx, destOperand, value) {
        this._wordWrite(ctx, destOperand, value & 0xFF);
    }

    _readWordBits(arr, baseBit) {
        let v = 0;
        for (let i = 0; i < 16; i++) {
            if (arr[baseBit + i]) v |= (1 << i);
        }
        return v < 32768 ? v : v - 65536;
    }

    _writeWordBits(arr, baseBit, value, area) {
        const u = value & 0xFFFF;
        for (let i = 0; i < 16; i++) {
            arr[baseBit + i] = ((u >> i) & 1) === 1;
        }
    }

    _mov(ctx, args, size) {
        if (!ctx.rlo) return;
        const src = this._word(ctx, args[0]);
        this._wordWrite(ctx, args[1], src);
    }

    _arith(ctx, args, fn) {
        if (!ctx.rlo) return;
        const a = this._word(ctx, args[0]);
        const b = this._word(ctx, args[1]);
        const r = fn(a, b);
        this._wordWrite(ctx, args[1], r);
    }

    _shift(ctx, args, dir) {
        if (!ctx.rlo) return;
        const n = Math.max(0, Math.min(15, this._word(ctx, args[1])));
        const v = this._word(ctx, args[0]);
        const r = dir === 'l' ? (v << n) : (v >> n);
        // S7-200：IN 与 OUT 可相同；此处把结果写入第二个操作数
        this._wordWrite(ctx, args[1], r);
    }
}

// ═══════════════════════════════════════════════════════════
// 操作数解析
// ═══════════════════════════════════════════════════════════
function parseAddr(operand) {
    if (!operand) return null;
    const s = String(operand).trim().toUpperCase();

    // 定时器 / 计数器
    let m = s.match(/^T(\d+)$/); if (m) return { area: 'T', num: parseInt(m[1]) };
    m = s.match(/^C(\d+)$/); if (m) return { area: 'C', num: parseInt(m[1]) };

    // 模拟量字
    m = s.match(/^AIW(\d+)$/); if (m) return { area: 'AIW', num: parseInt(m[1]) };
    m = s.match(/^AQW(\d+)$/); if (m) return { area: 'AQW', num: parseInt(m[1]) };

    // 位地址：I/Q/M/SM + byte.bit
    m = s.match(/^(I|Q|M|SM)(\d+)\.(\d+)$/);
    if (m) {
        const area = m[1], byte = parseInt(m[2]), bit = parseInt(m[3]);
        return { area, byte, bit, idx: byte * 8 + bit };
    }

    // 字地址：IW/QW/MW/SMW
    m = s.match(/^(IW|QW|MW|SMW)(\d+)$/);
    if (m) return { area: m[1], num: parseInt(m[2]) };

    // V 区：VB/VW/VD n
    m = s.match(/^VB(\d+)$/); if (m) return { area: 'V', off: parseInt(m[1]), bit: 0 };
    m = s.match(/^VW(\d+)$/); if (m) return { area: 'VW', off: parseInt(m[1]) };
    m = s.match(/^VD(\d+)$/); if (m) return { area: 'VD', off: parseInt(m[1]) };

    // 特殊存储位：SMB/SMW 已含字；SM 位上面已处理
    m = s.match(/^SMB(\d+)$/); if (m) return { area: 'V', off: parseInt(m[1]), bit: 0 };
    m = s.match(/^MB(\d+)$/); if (m) return { area: 'V', off: parseInt(m[1]), bit: 0 };

    return null;
}

function pinToBit(pin) {
    // di00 → I0.0 ... di27 → I2.7（连续映射）
    const m = String(pin).match(/^di(\d)(\d)$/);
    if (!m) return 0;
    const hi = parseInt(m[1]), lo = parseInt(m[2]);
    return hi * 8 + lo;
}

function clampWord(v) {
    v = Math.round(v || 0);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    return v;
}

export default S7200Solver;
