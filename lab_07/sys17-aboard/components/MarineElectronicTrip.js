import { BaseComponent } from './BaseComponent.js';

/**
 * MarineElectronicTrip 船用主开关电子脱扣器
 * 尺寸 420×300，面板式结构：
 *  - 第一排 5 个整定旋钮（特大短路 / 短路 / 过载 / 欠压 / 逆功率）
 *  - 第二排 5 个时间旋钮（特大短路为“瞬时”空旋钮，其余 4 个可调）
 *  - 第三排 3 行 LCD（电压/频率、线电流/有功功率、保护状态）
 *  - 8 个电气端口：左侧 I+ I- U+ U-（测量），顶部 t1 t2（脱扣输出）+ vp vn（24V 电源）
 * 求解器类型 tripRelay：I+↔I- 注入分流电阻测电流，脱扣时 t1↔t2 触点闭合。
 */
export class MarineElectronicTrip extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(330, config.width  || 370);
        this.height = Math.max(264, config.height || 286);

        this.type    = 'tripRelay';
        this.special = 'ETUnit';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:   this.label,
            In:      this._In,
            Un:      this._Un,
            phase:   this._phase,
            cosPhi:  this._cosPhi,
            Rshunt:  this._Rshunt,
        };

        // 左侧测量端口（I-/I+/U-/U+，间隔加大）
        this._portLYs.forEach((y, i) => {
            this.addPort(2, y, ['i-', 'i+', 'u-', 'u+'][i], 'wire', i % 2 ? 'p' : null);
        });
        // 顶部端口（脱扣输出 t1/t2 + 24V 电源 vp/vn）
        this._portTXs.forEach((x, i) => {
            this.addPort(x, 2, ['t1', 't2', 'vp', 'vn'][i], 'wire', i % 2 == 0 ? 'p' : null);
        });
        // 右侧分励脱扣输出端口（两路，每路 2 端：f1a/f1b、f2a/f2b）
        this._portRYs.forEach((y, i) => {
            this.addPort(this.width - 2, y, ['f1a', 'f1b', 'f2a', 'f2b'][i], 'wire', i % 2 == 0 ? 'p' : null);
        });
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        // 5 个旋钮左右对称分布（避开左侧端口区），两排共用同一组 X（尺寸放大 1.1 倍）
        this._knobXs   = [50, 121, 192, 263, 334];
        this._knobRow1 = 92;
        this._knobRow2 = 174;
        this._knobR    = 18;

        // 标题区
        this._titleY = 40;
        this._title2Y = 61;

        // 端口端子坐标（左侧 I-/I+/U-/U+，间隔加大）
        this._portLYs = [55, 104, 153, 202];
        this._portTXs = [70, 140, 210, 280];
        // 右侧分励脱扣输出端口（两路：f1a/f1b、f2a/f2b，沿右缘垂直排列）
        this._portRYs = [70, 118, 166, 214];

        // LCD 区（底部，两行）
        this._lcdRect = { x: 20, y: 230, width: this.width - 40, height: 50 };
        this._lcdTexts = [
            { x: 28, y: 232 },
            { x: 28, y: 256 },
        ];

        // 复位按钮（右上角）
        this._resetBtn = { x: this.width - 32, y: 32, r: 14 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || 'ET';
        this.function = '船用主开关电子脱扣器';

        // 额定值
        this._In     = config.In     !== undefined ? parseFloat(config.In)     : 100;
        this._Un     = config.Un     !== undefined ? parseFloat(config.Un)     : 380;
        this._phase  = (config.phase || '3') === '1' ? 1 : 3;
        this._cosPhi = config.cosPhi !== undefined ? parseFloat(config.cosPhi) : 0.8;
        this._Rshunt = config.Rshunt !== undefined ? parseFloat(config.Rshunt) : 0.01;
        // 电压来源：指定关联发电机 id（否则自动解析与 u+ 端口同簇的发电机）
        this._genId = config.genId || null;
        this._gen = null;
        // RMS 测量窗口（固定样本数）：solver 步长 0.5ms，50Hz 周期 20ms = 40 样本
        // 必须覆盖整数个完整周期，否则 RMS 随窗口相位滑动波动（同同步发电机 measWin）
        this._measWin = Math.max(10, Math.round(parseFloat(config.measWin) || 40));

        // 旋钮档位定义：第一排整定值，第二排时间（特大短路为瞬时空旋钮）
        this._knobDefs = [
            // 第一排 整定值
            { key: 'extremeMult',  row: 0, label: '特大短路', unit: '×In', values: [5, 6, 8, 10, 12],        idx: 0 },
            { key: 'shortMult',    row: 0, label: '短路',     unit: '×In', values: [1.5, 2, 3, 4, 5],        idx: 1 },
            { key: 'overloadMult', row: 0, label: '过载',     unit: '×In', values: [1.05, 1.2, 1.35, 1.5, 2], idx: 2 },
            { key: 'uvPercent',    row: 0, label: '欠压',     unit: '%Un', values: [70, 75, 80, 85, 90],     idx: 1 },
            { key: 'revPercent',   row: 0, label: '逆功率',   unit: '%Pr', values: [8, 10, 12, 15, 20],      idx: 1 },
            // 第二排 时间
            { key: 'extremeTime',  row: 1, label: '特大短时', unit: '瞬时', values: [0], idx: 0, dummy: true },
            { key: 'shortTime',    row: 1, label: '短路时间', unit: 's',   values: [0.1, 0.2, 0.4, 0.6, 1.0], idx: 2 },
            { key: 'overloadTime', row: 1, label: '过载时间', unit: 's',   values: [3, 5, 10, 15, 30],        idx: 3 },
            { key: 'uvTime',       row: 1, label: '欠压时间', unit: 's',   values: [0.5, 1, 2, 3, 5],        idx: 3 },
            { key: 'revTime',      row: 1, label: '逆功率时', unit: 's',   values: [3, 5, 7, 8, 10],         idx: 3 },
        ];
        this._knobDefs.forEach(def => {
            this['_' + def.key] = def.values[Math.min(def.idx, def.values.length - 1)];
        });
        // 允许配置覆盖整定值（如工作流需要短路整定 ≥4×In 以演示分级卸载）
        const overridable = ['extremeMult', 'shortMult', 'overloadMult', 'uvPercent',
            'revPercent', 'shortTime', 'overloadTime', 'uvTime', 'revTime'];
        overridable.forEach(k => {
            if (config[k] !== undefined) this['_' + k] = parseFloat(config[k]);
        });

        // 保护状态
        this._tripped   = false;
        this._timer     = 0;
        this._active    = null;
        this._tripReason = null; // 脱扣原因（中文），具体到调整项

        // 过载分励脱扣输出：过载持续 5s → 第 1 路输出；持续 10s → 第 2 路输出
        this._shuntTimer = 0;       // 过载持续时间累计
        this._shuntOut1  = false;   // 第 1 路分励输出（过载 ≥5s）
        this._shuntOut2  = false;   // 第 2 路分励输出（过载 ≥10s）
        this._shunt1Time = 5;       // 第 1 路过载脱扣延时（s）
        this._shunt2Time = 10;      // 第 2 路过载脱扣延时（s）

        // 参数整定故障（失调）
        this._faultUvMisSet      = false; // 欠压整定失调：电压低于 400×90% 即触发欠压延时
        this._faultOverloadMisSet = false; // 过载整定失调：电流大于 0.7In 即触发过载延时

        // 供电状态：vp/vn 有电才点亮 LCD 并允许脱扣
        this._powered = false;
        this._powerTimer = 0; // 连续有电帧计数，防误判
        // 稳定状态：电压/电流稳定后过流/欠压才投入
        this._stable = false;
        this._stableFrames = 0;
        this._prevU = 0;
        this._prevI = 0;

        // 电流采样（由求解器 0V 电压源回填，参照 ElecMeter/Wattmeter）
        this.currentIdx   = undefined;
        this.physCurrent  = 0;

        // 有效值（RMS）滑动窗口采样：电压与电流（约一个工频周期）
        this._rmsBufU = [];
        this._rmsBufI = [];
        this._rmsU    = 0;
        this._rmsI    = 0;
        this._rmsWin  = 40;
        this._lastSolverIter = undefined;

        // 瞬时功率滑动窗口（求平均有功功率，用于逆功率检测）
        // 窗口 = 一个工频周期（与 RMS 窗口一致），保证反接后功率符号快速翻转
        this._bufP  = new Float64Array(40);
        this._bufPIdx = 0;
        this._bufPCount = 0;
        this._sumP = 0;
        this._Pavg = 0;
        this._Pinst = 0;
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        const s = this._staticGroup;

        // 面板 - 参照同步发电机左侧面板（浅灰蓝底 + 深描边）
        s.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#e8eef4', cornerRadius: 4,
            stroke: '#1a252f', strokeWidth: 2,
        }));
        s.add(new Konva.Rect({
            x: 3, y: 3, width: this.width - 6, height: this.height - 6,
            fill: '#dfe7ee', cornerRadius: 3,
            stroke: '#5a6a75', strokeWidth: 1,
        }));

        // 标题 - 深色文字
        s.add(new Konva.Text({
            x: 80, y: this._titleY, fontSize: 18, fontStyle: 'bold',
            fill: '#1a252f', text: '船用主开关电子脱扣器',
        }));

        // 旋钮刻度底盘（灰蓝）
        this._knobDefs.forEach((def, i) => {
            const x = this._knobXs[i % 5];
            const y = def.row === 0 ? this._knobRow1 : this._knobRow2;
            s.add(new Konva.Circle({
                x, y, radius: this._knobR + 4,
                fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1,
            }));
        });

        // 端口文字标签（静态，无修饰矩形框）
        this._portLYs.forEach((y, i) => {
            s.add(new Konva.Text({ x: 8, y: y-18 , fontSize: 16, fontStyle: 'bold', fill: '#1a252f', text: ['i-', 'i+', 'u-', 'u+'][i] }));
        });
        this._portTXs.forEach((x, i) => {
            s.add(new Konva.Text({ x: x - 10, y: 10, fontSize: 16, fontStyle: 'bold', fill: '#1a252f', text: ['t1', 't2', 'vp', 'vn'][i] }));
        });
        s.add(new Konva.Text({ x: 90, y: 8, fontSize: 13, fill: '#5a6a75', text: '脱扣' }));
        s.add(new Konva.Text({ x: 232, y: 8, fontSize: 13, fill: '#5a6a75', text: '电源' }));
        // 右侧分励脱扣输出标签
        this._portRYs.forEach((y, i) => {
            s.add(new Konva.Text({ x: this.width - 42, y: y - 8, fontSize: 13, fontStyle: 'bold', fill: '#1a252f', text: ['F1+', 'F1-', 'F2+', 'F2-'][i] }));
        });
        s.add(new Konva.Text({ x: this.width - 66, y: 42, fontSize: 12, fill: '#5a6a75', text: '分励输出', listening: false }));

        // LCD 屏（黑色背板 + 绿/黄数码管）
        s.add(new Konva.Rect({
            ...this._lcdRect,
            fill: '#000000', cornerRadius: 4,
            stroke: '#3a4a55', strokeWidth: 2,
        }));

        // 复位按钮衬底
        s.add(new Konva.Circle({
            x: this._resetBtn.x, y: this._resetBtn.y, radius: this._resetBtn.r + 3,
            fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1,
        }));

        // 离线缓存静态层
        if (this.cache === 'fixed') {
            try {
                const r = this._staticGroup.getClientRect({ relativeTo: this._staticGroup });
                if (r && r.width > 0 && r.height > 0) {
                    this._staticGroup.cache({
                        x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height),
                    });
                }
            } catch (e) { /* ignore */ }
        }
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 旋钮（动态：指针角度 + 中心档位 + 标签值）
        this._knobNodes = this._knobDefs.map((def, i) => {
            const x = this._knobXs[i % 5];
            const y = def.row === 0 ? this._knobRow1 : this._knobRow2;
            const g = new Konva.Group({ x, y });

            const pointer = new Konva.Line({
                points: [0, 0, 0, -this._knobR + 5],
                stroke: '#ffffff', strokeWidth: 2.5, lineCap: 'round',
            });
            const center = new Konva.Text({
                x: -10, y: -9, width: 20, align: 'center',
                fontSize: 14, fontStyle: 'bold', fill: '#1a252f', text: '',
            });
            const label1 = new Konva.Text({
                x: -30, y: this._knobR + 6, width: 60, align: 'center',
                fontSize: 13, fill: '#1a252f', text: def.label,
            });
            const label2 = new Konva.Text({
                x: -30, y: this._knobR + 21, width: 60, align: 'center',
                fontSize: 12, fill: '#1565c0', text: '',
            });

            const disc = new Konva.Circle({ radius: this._knobR, fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 2 });

            g.add(disc, pointer, center, label1, label2);
            d.add(g);

            // 交互（hit 区用放大透明圆）
            const hit = new Konva.Circle({ radius: this._knobR + 2, fill: 'transparent' });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this._cycleKnob(i);
            });
            g.add(hit);

            return { def, group: g, pointer, center, label1, label2 };
        });

        // LCD 文字：行1 = 电压频率 + 状态（状态紧跟频率后、颜色动态）；行2 = 电流功率
        const mk = (x, y, fill) => {
            const t = new Konva.Text({
                x, y, fontSize: 16, fontFamily: 'monospace',fontStyle: 'bold',
                fill, text: '',
            });
            d.add(t);
            return t;
        };
        this._lcdUfText  = mk(this._lcdTexts[0].x, this._lcdTexts[0].y, '#00ff88');
        this._lcdStateText = mk(this._lcdTexts[0].x + 150, this._lcdTexts[0].y+12, '#00ff88');
        this._lcdIpText  = mk(this._lcdTexts[1].x, this._lcdTexts[1].y, '#00ff88');
        this._lcdTextNodes = [this._lcdUfText, this._lcdStateText, this._lcdIpText];

        // 复位按钮（交互，灰蓝按钮面 + 白字）
        const resetHit = new Konva.Circle({
            x: this._resetBtn.x, y: this._resetBtn.y, radius: this._resetBtn.r,
            fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 2,
        });
        resetHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this.reset();
        });
        this._resetLabel = new Konva.Text({
            x: this._resetBtn.x - 20, y: this._resetBtn.y - 8, width: 40, align: 'center',
            fontSize: 13, fontStyle: 'bold', fill: '#ffffff', text: '复位',
            listening: false,  // 文字不拦截点击，命中穿透到按钮圆
        });
        d.add(resetHit, this._resetLabel);
        this._resetNode = resetHit;

        this._syncKnobNodes();
    }

    _bindInteraction() { /* 旋钮/复位事件已在 _createDynamicNodes 绑定 */ }

    // ═══════════════════════════════════════════
    // 交互：旋钮档位循环 / 复位
    // ═══════════════════════════════════════════

    _cycleKnob(i) {
        const def = this._knobDefs[i];
        if (def.dummy) return; // 特大短时空旋钮
        def.idx = (def.idx + 1) % def.values.length;
        this['_' + def.key] = def.values[def.idx];
        this._syncKnobNodes();
        this.markDirty();
    }

    _syncKnobNodes() {
        this._knobNodes.forEach(({ def, group, pointer, center, label1, label2 }) => {
            const n = def.values.length;
            const angle = n > 1 ? (-120 + (def.idx / (n - 1)) * 240) : 0;
            pointer.rotation(angle);
            center.text(def.dummy ? ' ' : String(def.idx + 1));
            label2.text(def.dummy ? '瞬时' : `${this['_' + def.key]}${def.unit}`);
        });
    }

    /**
     * 解析关联发电机：优先用 config.genId 显式指定；否则遍历系统组件，
     * 找到任一相端口（u/v/w）与本机 u+（或 i+）测量端口处于同一电压簇的
     * 同步发电机（source_3p）。电压显示直接读取该发电机的实测_ rmsV。
     */
    _resolveGen() {
        if (!this.sys) return;
        this._gen = null;
        if (this._genId && this.sys.comps[this._genId]) {
            this._gen = this.sys.comps[this._genId];
            return;
        }
        const vs = this.sys.voltageSolver;
        if (!vs || !vs.portToCluster) return;
        const cU = vs.portToCluster.get(`${this.id}_wire_u+`);
        const cI = vs.portToCluster.get(`${this.id}_wire_i+`);
        for (const comp of Object.values(this.sys.comps)) {
            if (comp.type !== 'source_3p' || comp === this) continue;
            for (const ph of ['u', 'v', 'w']) {
                const cGen = vs.portToCluster.get(`${comp.id}_wire_${ph}`);
                if ((cU !== undefined && cGen === cU) || (cI !== undefined && cGen === cI)) {
                    this._gen = comp;
                    return;
                }
            }
        }
    }

    reset() {
        this._tripped = false;
        this._timer   = 0;
        this._active  = null;
        this._tripReason = null;
        this._stableFrames = 0;
        this._stable = false;
        this._shuntTimer = 0;
        this._shuntOut1  = false;
        this._shuntOut2  = false;
        this._updateLcd();
        this.markDirty();
    }

    /** 设置欠压整定故障（失调：电压低于 400×90% 即触发欠压延时） */
    setUvMisSet(v) {
        this._faultUvMisSet = !!v;
    }

    /** 设置过载整定故障（失调：电流大于 0.7In 即触发过载延时） */
    setOverloadMisSet(v) {
        this._faultOverloadMisSet = !!v;
    }

    // ═══════════════════════════════════════════
    // 仿真循环
    // ═══════════════════════════════════════════

    tick(dt) {
        if (this.sys && this.sys.voltageSolver) {
            const vs = this.sys.voltageSolver;
            const getPD = (a, b) => {
                const v = vs.getPD(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`);
                return typeof v === 'number' && isFinite(v) ? v : 0;
            };

            this._freq = vs._systemFreq || 50;

            // 供电检测：vp/vn 之间应有 24V 电源，连续多帧有电才点亮
            const vpVn = Math.abs(getPD('vp', 'vn'));
            if (vpVn > 1) this._powerTimer++;
            else this._powerTimer = 0;
            this._powered = this._powerTimer >= 3;

            // ── 仅当求解器实际推进（globalIterCount 变化）时才采样，避免跳帧重复 ──
            const solverAdvanced = vs.globalIterCount !== this._lastSolverIter;
            if (!solverAdvanced) {
                // 求解器未推进：跳过采样，保持当前 RMS 与显示
                if (this._lastSolverIter !== undefined) {
                    this._updateLcd();
                    if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
                    return;
                }
            }
            this._lastSolverIter = vs.globalIterCount;

            // 电压直接读取关联发电机实测 RMS（发电机已做三相平均/整周期滑动窗，
            // 比在本机端口上自行采样更稳定）；未关联到时回退为本机采样
            if (!this._gen || !this.sys.comps[this._gen.id]) {
                this._resolveGen();
            }
            const uInst = getPD('u+', 'u-');
            // 电流由求解器 0V 电压源注入测得（参照 ElecMeter/Wattmeter）
            const iInst = (typeof this.physCurrent === 'number' && isFinite(this.physCurrent)) ? this.physCurrent : 0;

            // 滑动窗口 RMS：窗口 = 一个工频周期内的求解步数
            // solver 步长 deltaTime=0.5ms，50Hz 周期 20ms → 40 步采样
            // 窗口随实际系统频率自适应（浮点长度）：带载下垂调频后频率可能
            // 偏离 50Hz（如 49.186Hz），固定整数窗口会覆盖非整数个周期，
            // sumSq 随窗口相位滑动波动。用整数部分 n + 最旧样本小数权重 frac
            // 使窗口总权重 = per（恰好一个完整周期），RMS 不再随相位波动。
            const per = 2000 / Math.max(20, this._freq || 50);
            const n = Math.floor(per), frac = per - n;
            // 窗口缓冲长度：per 整数时 n 个（frac=0 无需额外样本），否则 n+1 个
            this._rmsWin = n + (frac > 1e-6 ? 1 : 0);
            const maxLen = this._rmsWin;
            const pushWin = (buf, v) => {
                buf.push(v);
                while (buf.length > maxLen) buf.shift();
            };
            // 电压：优先取关联发电机实测相电压 RMS（三相平均，更稳定）；未关联时本机采样
            let rmsU;
            if (this._gen && typeof this._gen._rmsV === 'number' && this._gen._rmsV > 0) {
                rmsU = this._gen._rmsV;
                this._rmsBufU.length = 0;
            } else {
                pushWin(this._rmsBufU, uInst * uInst);
                const len = this._rmsBufU.length;
                const s = (len < maxLen || frac < 1e-6)
                    ? this._rmsBufU.reduce((a, b) => a + b, 0)
                    : this._rmsBufU[0] * frac + this._rmsBufU.slice(1).reduce((a, b) => a + b, 0);
                rmsU = Math.sqrt(s / per);
            }
            // 电流：始终走本机采样滑动窗口
            pushWin(this._rmsBufI, iInst * iInst);
            const lenI = this._rmsBufI.length;
            const sI = (lenI < maxLen || frac < 1e-6)
                ? this._rmsBufI.reduce((a, b) => a + b, 0)
                : this._rmsBufI[0] * frac + this._rmsBufI.slice(1).reduce((a, b) => a + b, 0);
            this._rmsU = rmsU;
            this._rmsI = Math.sqrt(sI / per);

            // 测量的是相电压（W 相），换算为线电压供显示与保护判断
            this._U = this._phase === 3 ? this._rmsU * 1.732 : this._rmsU;
            this._I = this._rmsI;
            // 三相总功率：线电压 × √3 × I × cosφ
            this._Pkw = this._phase === 3
                ? 1.732 * this._U * this._I * this._cosPhi / 1000
                : this._U * this._I * this._cosPhi / 1000;
            this._Prkw = this._phase === 3
                ? 1.732 * this._Un * this._In * this._cosPhi / 1000
                : this._Un * this._In * this._cosPhi / 1000;
            // 瞬时功率（带符号）：三相总功率 = 3 × 单相瞬时功率（平衡三相）
            const pInst = this._phase === 3
                ? 3 * uInst * iInst / 1000
                : uInst * iInst / 1000;
            this._Pinst = pInst;
            // 滑动窗口平均有功功率：交流下瞬时功率正负交替，取平均才是有功功率（含方向）
            this._sumP -= this._bufP[this._bufPIdx];
            this._bufP[this._bufPIdx] = pInst;
            this._sumP += pInst;
            this._bufPIdx = (this._bufPIdx + 1) % this._bufP.length;
            if (this._bufPCount < this._bufP.length) this._bufPCount++;
            this._Pavg = this._bufPCount > 0 ? this._sumP / this._bufPCount : 0;

            // 稳定判定：电压、电流的 RMS 连续多帧变化很小后才投入保护
            this._updateStability();
        }

        // 未供电时：不脱扣、无输出
        if (!this._powered) {
            this._tripped = false;
            this._active = null;
            this._timer = 0;
        }

        this._evaluateProtection(dt);
        this._updateLcd();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ── 稳定判定：过流/欠压保护在电压电流稳定后才投入 ──
    _updateStability() {
        // 电压：关联发电机实测 _rmsV 有效（>0）即代表已建立稳定电压；
        // 电流窗口未覆盖完整周期前不算稳定（防止初始 0 值误判）
        const genOk = this._gen ? this._gen._rmsV > 0 : this._rmsBufU.length >= this._rmsWin;
        if (!genOk || this._rmsBufI.length < this._rmsWin) {
            this._stableFrames = 0;
            this._stable = false;
            this._prevU = this._U;
            this._prevI = this._I;
            return;
        }
        const dU = Math.abs(this._U - this._prevU);
        const dI = Math.abs(this._I - this._prevI);
        const tolU = Math.max(0.5, this._U * 0.02);
        const tolI = Math.max(0.02, this._I * 0.05);
        if (dU <= tolU && dI <= tolI) {
            this._stableFrames++;
        } else {
            this._stableFrames = 0;
        }
        this._prevU = this._U;
        this._prevI = this._I;
        this._stable = this._stableFrames >= 6;
    }

    _evaluateProtection(dt) {
        // 未供电或电压电流未稳定：保护不投入
        if (!this._powered || !this._stable) {
            this._active = null;
            this._timer = 0;
            return;
        }
        if (this._tripped) { this._active = 'tripped'; return; }

        const I = this._I || 0;
        const U = this._U || 0;
        // 逆功率用平均有功功率（含方向），不用瞬时功率（交流下正负交替会误判）
        const P = this._Pavg !== undefined ? this._Pavg : 0;

        let active = null;
        if (I >= this._extremeMult * this._In) {
            active = 'extreme';
        } else if (I >= this._shortMult * this._In) {
            active = 'short';
        } else if (I >= (this._faultOverloadMisSet ? 0.7 : this._overloadMult) * this._In) {
            active = 'overload';
        } else if (U < (this._faultUvMisSet ? 400 * 0.9 : (this._uvPercent / 100) * this._Un)) {
            active = 'uv';
        } else if (P < -(this._revPercent / 100) * this._Prkw) {
            active = 'rev';
        }

        if (active === 'extreme') {
            // 特大短路：瞬时脱扣
            this._tripped   = true;
            this._active    = 'tripped';
            this._tripReason = '特大短路脱扣';
            this._timer     = 0;
            return;
        }

        if (active) {
            const delay = {
                short:    this._shortTime,
                overload: this._overloadTime,
                uv:       this._uvTime,
                rev:      this._revTime,
            }[active];
            if (this._active !== active) { this._active = active; this._timer = 0; }
            this._timer += dt;
            if (this._timer >= delay) {
                const reason = {
                    short:    '短路脱扣',
                    overload: '过载脱扣',
                    uv:       '欠压脱扣',
                    rev:      '逆功率脱扣',
                }[active];
                this._tripped   = true;
                this._active    = 'tripped';
                this._tripReason = reason;
                this._timer     = 0;
            }
        } else {
            this._active = null;
            this._timer  = 0;
        }

        // ── 过载分励脱扣输出：过载持续 5s → 第1路；持续 10s → 第2路 ──
        if (active === 'overload' && !this._tripped) {
            this._shuntTimer += dt;
        } else {
            this._shuntTimer = 0;
        }
        this._shuntOut1 = this._shuntTimer >= this._shunt1Time;
        this._shuntOut2 = this._shuntTimer >= this._shunt2Time;
    }

    // ═══════════════════════════════════════════
    // LCD 显示
    // ═══════════════════════════════════════════

    _updateLcd() {
        if (!this._lcdUfText) return;

        // 未供电：液晶熄灭，不显示任何内容
        if (!this._powered) {
            this._lcdUfText.text('');
            this._lcdStateText.text('');
            this._lcdIpText.text('');
            return;
        }

        const U = this._U || 0;
        const f = this._freq || 0;
        const I = this._I || 0;
        // 功率用实测平均三相功率（_Pavg，含方向），与电子功率计一致
        const P = this._Pavg || 0;

        let stateText;
        let stateColor = '#00ff88';
        if (this._tripped) {
            stateText = this._tripReason || '脱扣';
            stateColor = '#e74c3c';
        } else if (this._active) {
            const name = {
                short:    '短路',
                overload: '过载',
                uv:       '欠压',
                rev:      '逆功率',
            }[this._active] || '保护';
            stateText = `${name}延时${this._timer.toFixed(1)}s`;
            if (this._active === 'overload') {
                stateText += this._shuntOut1 ? ' 1路脱扣' : this._shuntOut2 ? ' 2路脱扣' : '';
            }
            stateColor = '#f4d744';
        } else {
            stateText = '正常';
            stateColor = '#00ff88';
        }

        // 无电压时不显示频率；有电压时显示发电机的频率
        if (U > 1) {
            this._lcdUfText.text(`U=${U.toFixed(1)}V f=${f.toFixed(1)}Hz`);
        } else {
            this._lcdUfText.text(`U=${U.toFixed(1)}V`);
        }
        this._lcdStateText.text(` 状态:${stateText}`);
        this._lcdStateText.fill(stateColor);
        this._lcdIpText.text(`I=${I.toFixed(1)}A P=${P.toFixed(1)}kW`);
    }

    // ═══════════════════════════════════════════
    // 配置对话框
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称',    key: 'label',  type: 'text' },
            { label: '关联发电机 id（电压来源）', key: 'genId', type: 'text' },
            { label: '额定电流 In (A)', key: 'In', type: 'number' },
            { label: '额定电压 Un (V)', key: 'Un', type: 'number' },
            { label: '相数 1/3',      key: 'phase', type: 'text' },
            { label: '功率因数 cosφ', key: 'cosPhi', type: 'number', step: 0.01 },
            { label: '电流采样分流电阻 (Ω)', key: 'Rshunt', type: 'number', step: 0.001 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label   !== undefined) this.label = cfg.label;
        if (cfg.genId   !== undefined) { this._genId = cfg.genId; this._gen = null; }
        if (cfg.In      !== undefined) this._In = parseFloat(cfg.In);
        if (cfg.Un      !== undefined) this._Un = parseFloat(cfg.Un);
        if (cfg.phase   !== undefined) this._phase = String(cfg.phase) === '1' ? 1 : 3;
        if (cfg.cosPhi  !== undefined) this._cosPhi = parseFloat(cfg.cosPhi);
        if (cfg.Rshunt  !== undefined) this._Rshunt = parseFloat(cfg.Rshunt);
    }

    // ─── 供工作流/故障系统查询的状态接口 ───────────────────
    isTripped()    { return !!this._tripped; }
    getProtection() { return this._active; }
    getShuntOut1()  { return !!this._shuntOut1; }
    getShuntOut2()  { return !!this._shuntOut2; }
    getShuntTimer() { return this._shuntTimer; }
    getMeasured() {
        return {
            U: this._U || 0,
            I: this._I || 0,
            f: this._freq || 0,
            P: this._Pavg || 0,
        };
    }
}
