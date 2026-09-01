import { BaseComponent } from './BaseComponent.js';

/**
 * HvGenRemotePanel.js — 高压发电机遥控面板（type='gen_remote_panel'，复用求解器/拓扑 stamp）
 *
 * ┌ 面板布局 ─────────────────────────────────────────────────────┐
 * │ 第一排 7 个方形指示灯：                                        │
 * │   电源(白) 自动(白) READY FOR START(白) 运行(白)               │
 * │   接地合(绿) 接地开(红) 故障(红)                               │
 * │ 第二排：手动/自动转换开关 · 起停自复位开关 · 合分闸自复位开关   │
 * │         复位按钮 · 同步表开关(OFF/ON) · 同步表                 │
 * │ 第三排：高压带电显示器（黄/绿/红三相指示灯 + 自检按钮）         │
 * └───────────────────────────────────────────────────────────────┘
 *
 * 接口：
 *   左边界：发电机组起动/停止/调速（接发电机 rm_* / freq_in_*，约定同遥控面板）
 *   底边界：合闸 close_a/b → 断路器 c1/c2；分闸 open_a/b → 分励 fla/flb；
 *           灭磁 demag_a/b → 发电机 mc_a/mc_b（触点式：闭合即同簇灭磁）
 *   右边界：自动控制通信 auto_a/b（双面板组网预留）、保护通信 prot_a/b、24V 电源 p24_p/n
 *
 * 控制逻辑：
 *   · 24V 上电（连续 3 帧 >1V）→ 电源灯亮、全面板逻辑工作；
 *   · 手动/自动开关：右 45°=自动（自动指示灯亮，自动机：停电自起动→自动调频→延时自动合闸）；
 *   · READY FOR START：面板供电 + 发电机遥控位 + 未运行 + 无故障；
 *   · 运行灯：发电机运行；接地合绿灯/接地开红灯随断路器内接地开关状态；
 *   · 故障灯：断路器保护动作（欠压/过载）或发电机原动机故障 → 锁存常亮，
 *     故障源消失后按【复位】熄灭；
 *   · 高压带电显示：断路器 T1-T3 任一线电压 >60V → 黄/绿/红三灯常亮；
 *     无压时按【自检】→ 三灯亮 3s 自检后熄灭。
 */
export class HvGenRemotePanel extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);
        this.type = 'gen_remote_panel';   // 复用遥控面板的拓扑触点与电压源 stamp
        this.cache = 'fixed';
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this._addPorts();
    }

    _recalcGeometry() {
        // 宽度 = 故障指示灯右缘(390) + 30；高度 = 带电显示下边界(180) + 30
        this.width  = 420;
        this.height = 210;

        // 第一排：7 个方形指示灯（中心 x，y 为灯顶）
        this._lampXs = [42, 98, 154, 210, 266, 322, 378];
        this._lampY = 10;
        this._lampSize = 24;

        // 第二排控件
        this._row2 = {
            swMode:  { x: 42,  y: 90 },   // 手动/自动转换开关
            swStart: { x: 98, y: 90 },   // 起停自复位转换开关
            swClose: { x: 154, y: 90 },   // 合分闸自复位转换开关
            reset:   { x: 210, y: 90, r: 15 },
            swSync:  { x: 266, y: 93 },   // 同步表开关
            sync:    { x: 350, y: 120, r: 34 },
        };

        // 第三排高压带电显示器
        this._live = {
            box:  { x: 26, y: 140, w: 230, h: 40 },
            lamps: [
                { x: 106,  y: 162, c: '#e0c020' },   // 黄 A相
                { x: 146, y: 162, c: '#20a030' },   // 绿 B相
                { x: 186, y: 162, c: '#e03030' },   // 红 C相
            ],
            test:  { x: 228, y: 160, r: 14 },
        };

        // 端口坐标
        this._portLeft  = { startA: 26, startB: 58, stopA: 90, stopB: 122, spdP: 154, spdN: 186 };
        this._portBottom = { closeA: 70, closeB: 110, openA: 160, openB:200, demagA: 250, demagB: 290 };
        this._portRight = { autoA: 26, autoB: 58, protA: 90, protB: 122, p24P: 154, p24N: 186 };
    }

    _initParameters(config) {
        this.function = '高压发电机遥控面板';
        this.genId = config.genId || '';
        this.qfId  = config.qfId  || '';
        this.protId = config.protId || '';   // 关联的微机综合保护装置 ID
        this.busId = config.busId || 'bus1';   // 电网基准汇流排（同步表电网侧）

        this.mode = 'manual';          // manual | auto
        this._syncOn = false;          // 同步表开关 ON/OFF
        this._powered = false;
        this._powerTimer = 0;

        // 自复位转换开关命令（按住为 true，松手复位）
        this._startCmd = false;
        this._stopCmd = false;
        this._closeCmd = false;
        this._openCmd = false;
        this._resetReq = false;
        this._selfTestT = 0;           // 带电自检倒计时 s

        // 输出通道状态（供求解器 stamp / 拓扑 union 读取）
        this._spdVolt = 0;
        this._startPressed = false;    // ← CircuitTopology 按此字段做 start_a/b 同簇
        this._stopPressed = false;     // ← stop_a/b 同簇
        this._closePressed = false;    // ← stampGenRemotePanels 据此输出 24V
        this._openPressed = false;
        this._demagClosed = false;     // ← 拓扑据此做 demag_a/b 同簇（灭磁触点）

        // 自动模式状态机
        this._autoState = 'idle';      // idle | starting | regulating | closing
        this._autoTimer = 0;

        // 故障锁存
        this._faultLatched = false;

        // 同步表
        this._synPhase = 0;
        this._lastTSide = null;
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
            fill: '#e3e9f0', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W, text: '高压发电机遥控面板',
            fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center',
        }));

        // ── 第一排：7 个方形指示灯 + 标签 ──
        const lampLabels = [['电源'], ['自动'], ['就绪'], ['运行'], ['接地合'], ['接地开'], ['故障']];
        const lampLit = ['#ffffff', '#ffffff', '#7dffb0', '#ffffff', '#1fdc38', '#d93b29', '#e1210c'];
        this._lampXs.forEach((cx, i) => {
            const s = this._lampSize, y = this._lampY;
            this._staticGroup.add(new Konva.Rect({
                x: cx - s / 2 - 2, y: y - 2, width: s + 4, height: s + 4,
                fill: '#cdd8e0', cornerRadius: 3, stroke: '#5a6a75', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 30, y: y + s + 6, width: 60, align: 'center',
                text: lampLabels[i].join('\n'), fontSize: 11, fill: '#333', lineHeight: 1.1,
            }));
        });

        // ── 第二排：转换开关底座与标签 ──
        const swBase = (x, y, label) => {
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: 17, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: x - 32, y: y + 24, width: 64, text: label,
                fontSize: 11, fill: '#333', align: 'center',
            }));
        };
        swBase(this._row2.swMode.x,  this._row2.swMode.y,  '手动·自动');
        swBase(this._row2.swStart.x, this._row2.swStart.y, '起 · 停');
        swBase(this._row2.swClose.x, this._row2.swClose.y, '合 · 分');
        // 复位按钮底座
        this._staticGroup.add(new Konva.Circle({
            x: this._row2.reset.x, y: this._row2.reset.y, radius: this._row2.reset.r + 3,
            fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._row2.reset.x - 30, y: this._row2.reset.y + 25, width: 52,
            text: '复位', fontSize: 11, fill: '#333', align: 'center',
        }));
        // 同步表开关底座
        this._staticGroup.add(new Konva.Circle({
            x: this._row2.swSync.x, y: this._row2.swSync.y, radius: 15,
            fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._row2.swSync.x - 28, y: this._row2.swSync.y - 28, width: 56,
            text: 'OFF    ON', fontSize: 10, fill: '#333', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._row2.swSync.x - 28, y: this._row2.swSync.y + 22, width: 56,
            text: '同步表开关', fontSize: 11, fill: '#333', align: 'center',
        }));
        // 同步表表盘
        const sy = this._row2.sync;
        this._staticGroup.add(new Konva.Circle({
            x: sy.x, y: sy.y, radius: sy.r + 5, fill: '#0d1420',
            stroke: '#5a6a75', strokeWidth: 2,
        }));
        // 顶部同步刻度亮区（绿色扇形，±10°）
        this._staticGroup.add(new Konva.Arc({
            x: sy.x, y: sy.y, innerRadius: sy.r - 7, outerRadius: sy.r - 1,
            angle: 24, rotation: -102, fill: '#20a030',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sy.x - sy.r, y: sy.y + sy.r + 8, width: sy.r * 2,
            text: '同步表', fontSize: 11, fill: '#333', align: 'center',
        }));

        // ── 第三排：带电显示器 ──
        const lv = this._live;
        this._staticGroup.add(new Konva.Rect({
            x: lv.box.x, y: lv.box.y, width: lv.box.w, height: lv.box.h,
            fill: '#d5dde5', cornerRadius: 4, stroke: '#5a6a75', strokeWidth: 1,
        }));
        // "带电显示"标题：位于指示灯前方（左侧），与三灯水平居中对齐
        this._staticGroup.add(new Konva.Text({
            x: lv.box.x + 4, y: lv.lamps[0].y - 7, width: 58,
            text: '带电显示', fontSize: 11, fontStyle: 'bold', fill: '#333',
            align: 'center', listening: false,
        }));
    }

    // ─────────────────────────── 动态节点 ───────────────────────────
    _createDynamicNodes() {
        // 第一排指示灯（默认熄灭灰）
        this._lampEls = this._lampXs.map((cx, i) => {
            const el = new Konva.Rect({
                x: cx - this._lampSize / 2, y: this._lampY,
                width: this._lampSize, height: this._lampSize,
                cornerRadius: 2, fill: '#5a6068', listening: false,
                stroke: '#333', strokeWidth: 0.6,
            });
            this._dynamicGroup.add(el);
            return el;
        });

        // 第二排转换开关拨杆（垂直向上为 0°）
        const mkLever = (x, y) => {
            const g = new Konva.Group({ x, y });
            g.add(new Konva.Line({ points: [0, 0, 0, -15], stroke: '#2c3a45', strokeWidth: 5, lineCap: 'round' }));
            g.add(new Konva.Circle({ x: 0, y: 0, radius: 9, fill: '#2c3a45', stroke: '#161d23', strokeWidth: 1.5 }));
            g.rotation(0);
            this._dynamicGroup.add(g);
            return g;
        };
        this._swModeLever  = mkLever(this._row2.swMode.x,  this._row2.swMode.y);
        this._swStartLever = mkLever(this._row2.swStart.x, this._row2.swStart.y);
        this._swCloseLever = mkLever(this._row2.swClose.x, this._row2.swClose.y);
        this._swSyncLever  = mkLever(this._row2.swSync.x,  this._row2.swSync.y);
        this._swModeLever.rotation(-45);   // 初始手动
        // 复位按钮面
        this._resetFace = new Konva.Circle({
            x: this._row2.reset.x, y: this._row2.reset.y, radius: this._row2.reset.r,
            fill: '#e67e22', stroke: '#a05a10', strokeWidth: 1, cursor: 'pointer',
        });
        this._resetTxt = new Konva.Text({
            x: this._row2.reset.x - this._row2.reset.r, y: this._row2.reset.y - 7,
            width: this._row2.reset.r * 2, text: '复位', fontSize: 11, fontStyle: 'bold',
            fill: '#fff', align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._resetFace, this._resetTxt);

        // 同步表指针（单向：自中心指向表盘边缘）
        const sy = this._row2.sync;
        this._synPtr = new Konva.Group({ x: sy.x, y: sy.y });
        this._synPtr.add(new Konva.Line({
            points: [0, 6, 0, -(sy.r - 12)],
            stroke: '#f4d744', strokeWidth: 3, lineCap: 'round',
        }));
        this._synPtr.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#cfd8df' }));
        this._dynamicGroup.add(this._synPtr);

        // 第三排带电显示三灯（默认熄灭灰）
        this._liveLampEls = this._live.lamps.map(l => {
            const el = new Konva.Circle({
                x: l.x, y: l.y, radius: 10, fill: '#4a5058',
                stroke: '#2c3038', strokeWidth: 1, listening: false,
            });
            this._dynamicGroup.add(el);
            return el;
        });
        // 自检按钮面
        this._testFace = new Konva.Circle({
            x: this._live.test.x, y: this._live.test.y, radius: this._live.test.r,
            fill: '#3498db', stroke: '#1a5a8a', strokeWidth: 1, cursor: 'pointer',
        });
        this._testTxt = new Konva.Text({
            x: this._live.test.x - this._live.test.r, y: this._live.test.y - 7,
            width: this._live.test.r * 2, text: '自检', fontSize: 11, fontStyle: 'bold',
            fill: '#fff', align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._testFace, this._testTxt);
    }

    // ─────────────────────────── 交互绑定 ───────────────────────────
    _bindInteraction() {
        const hold = (node, onDown, onUp) => {
            node.on('mousedown touchstart', (e) => { e.cancelBubble = true; onDown(); });
            const up = () => { if (onUp) onUp(); };
            node.on('mouseup touchend mouseleave', up);
            window.addEventListener('mouseup', up);
            window.addEventListener('touchend', up);
        };

        // 手动/自动转换开关（持久档位）
        this._resetFace.on('click tap', (e) => { e.cancelBubble = true; this._resetReq = true; });
        this._switchKnobProxy = this._swModeLever;
        this._swModeHit = new Konva.Circle({
            x: this._row2.swMode.x, y: this._row2.swMode.y, radius: 18, fill: 'transparent', cursor: 'pointer',
        });
        this._swModeHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this.mode = (this.mode === 'auto') ? 'manual' : 'auto';
            if (this.mode === 'manual') { this._autoState = 'idle'; this._autoTimer = 0; }
        });
        this._interactGroup.add(this._swModeHit);

        // 起停自复位开关：左半=起动，右半=停机，松手回垂直
        const selfTest = () => { this._selfTestT = 3; };   // 带电自检按钮共用句柄见下
        const mkSelfReset = (x, y, setCmd) => {
            const hit = new Konva.Rect({
                x: x - 20, y: y - 20, width: 40, height: 40, fill: 'transparent', cursor: 'pointer',
            });
            hit.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const stage = this.group.getStage();
                const ptr = stage && stage.getPointerPosition();
                const abs = hit.getAbsolutePosition();
                // 以命中矩形中心为界：点左半 → 左转45°，右半 → 右转45°
                const centerX = abs.x + hit.width() / 2;
                setCmd(ptr && ptr.x > centerX ? 1 : -1);
            });
            const rel = () => setCmd(0);
            hit.on('mouseup touchend mouseleave', rel);
            window.addEventListener('mouseup', rel);
            window.addEventListener('touchend', rel);
            this._interactGroup.add(hit);
            return hit;
        };
        mkSelfReset(this._row2.swStart.x, this._row2.swStart.y, (d) => {
            if (d > 0) this._stopCmd = true; else if (d < 0) this._startCmd = true;
            if (d === 0) { this._startCmd = false; this._stopCmd = false; }
        });
        mkSelfReset(this._row2.swClose.x, this._row2.swClose.y, (d) => {
            if (d > 0) this._openCmd = true; else if (d < 0) this._closeCmd = true;
            if (d === 0) { this._closeCmd = false; this._openCmd = false; }
        });

        // 同步表开关（OFF/ON 持久档位）
        const syncHit = new Konva.Circle({
            x: this._row2.swSync.x, y: this._row2.swSync.y, radius: 17, fill: 'transparent', cursor: 'pointer',
        });
        syncHit.on('click tap', (e) => { e.cancelBubble = true; this._syncOn = !this._syncOn; });
        this._interactGroup.add(syncHit);

        // 自检按钮：按住期间持续触发自检计时
        hold(this._testFace,
            () => { if (!this._tSideLive()) this._selfTestT = 3; },
            null);
    }

    // ─────────────────────────── 端口 ───────────────────────────
    _addPorts() {
        const l = this._portLeft, b = this._portBottom, r = this._portRight;
        const h = this.height - 2, w = this.width - 2;
        // 左：发电机组起动 / 停止 / 调速（端口名与求解器 stamp / 拓扑触点约定一致）
        this.addPort(2, l.startA, 'start_a', 'wire');
        this.addPort(2, l.startB, 'start_b', 'wire');
        this.addPort(2, l.stopA,  'stop_a',  'wire');
        this.addPort(2, l.stopB,  'stop_b',  'wire');
        this.addPort(2, l.spdP,   'spd_p',   'wire', 'p');
        this.addPort(2, l.spdN,   'spd_n',   'wire', 'n');
        // 下：合闸 / 分闸 / 灭磁
        this.addPort(b.closeA, h, 'close_a', 'wire', 'p');
        this.addPort(b.closeB, h, 'close_b', 'wire');
        this.addPort(b.openA,  h, 'open_a',  'wire', 'p');
        this.addPort(b.openB,  h, 'open_b',  'wire');
        this.addPort(b.demagA, h, 'demag_a', 'wire', 'p');
        this.addPort(b.demagB, h, 'demag_b', 'wire');
        // 右：自动控制通信 / 保护通信 / 24V 电源
        this.addPort(w, r.autoA, 'auto_a', 'wire');
        this.addPort(w, r.autoB, 'auto_b', 'wire');
        this.addPort(w, r.protA, 'prot_a', 'wire');
        this.addPort(w, r.protB, 'prot_b', 'wire');
        this.addPort(w, r.p24P,  'p24_p',  'wire', 'p');
        this.addPort(w, r.p24N,  'p24_n',  'wire');
    }

    // ─────────────────────────── 引用与检测 ───────────────────────────
    _gen() { return (this.genId && this.sys && this.sys.comps) ? this.sys.comps[this.genId] : null; }
    _qf()  { return (this.qfId  && this.sys && this.sys.comps) ? this.sys.comps[this.qfId]  : null; }
    _prot(){ return (this.protId && this.sys && this.sys.comps) ? this.sys.comps[this.protId] : null; }

    _sensePower() {
        const v = this.sys && this.sys.getVoltageBetween
            ? this.sys.getVoltageBetween(`${this.id}_wire_p24_p`, `${this.id}_wire_p24_n`) : undefined;
        if (v !== undefined && isFinite(v) && v > 1) this._powerTimer = Math.min(3, this._powerTimer + 1);
        else this._powerTimer = 0;
        this._powered = this._powerTimer >= 3;
    }

    /** 断路器 T1-T3 是否带电（任一线电压 >60V） */
    _tSideLive() {
        const qf = this._qf(), sys = this.sys;
        if (!qf || !sys || !sys.getVoltageBetween) return false;
        const pairs = [['t1', 't2'], ['t2', 't3'], ['t3', 't1']];
        for (const [a, b] of pairs) {
            const v = sys.getVoltageBetween(`${qf.id}_wire_${a}`, `${qf.id}_wire_${b}`);
            if (typeof v === 'number' && isFinite(v) && Math.abs(v) > 60) return true;
        }
        return false;
    }

    /** 故障源：微机保护装置跳闸 + 断路器保护动作标志 + 发电机原动机故障 */
    _hasFaultSource() {
        const qf = this._qf(), gen = this._gen(), prot = this._prot();
        let f = false;
        if (prot && typeof prot.isTripped === 'function' && prot.isTripped()) f = true;
        if (qf && (qf._uvTrip || qf._overloadTrip)) f = true;
        if (gen) {
            const ef = typeof gen.getEngineFaults === 'function' ? gen.getEngineFaults() : null;
            if (ef && (ef.overspeed || ef.oilPress || ef.coolantTemp)) f = true;
        }
        return f;
    }

    /** 自动模式简化状态机：停电自起动 → 自动调频 → 建压延时自动合闸
     *  （参照船舶电站自动控制模块的自动起动/并车功能的教学化子集） */
    _runAuto(dt) {
        if (this.mode !== 'auto' || !this._powered) { this._autoState = 'idle'; return; }
        const gen = this._gen(), qf = this._qf();
        if (!gen || !qf) return;
        switch (this._autoState) {
            case 'idle':
                if (!gen.isOn && !this._faultLatched && gen.mode === 'remote') {
                    this._autoState = 'starting';
                }
                break;
            case 'starting':
                if (gen.isOn) this._autoState = 'regulating';
                break;
            case 'regulating': {
                const df = (gen._freqOut ?? gen.freq) - 50;
                if (Math.abs(df) > 0.25) this._spdVolt = df > 0 ? -1 : 1;
                else this._spdVolt = 0;
                const vOk = gen._rmsV * Math.sqrt(3) > gen.ratedVoltage * 0.9;
                if (vOk && !qf.isClosed()) {
                    this._autoTimer += dt;
                    if (this._autoTimer >= 2) { this._autoTimer = 0; this._autoState = 'closing'; }
                } else {
                    this._autoTimer = 0;
                }
                break;
            }
            case 'closing':
                if (qf.isClosed()) this._autoState = 'on';
                else this._closeCmd = true;
                break;
            case 'on':
                if (!qf.isClosed()) this._autoState = 'idle';
                break;
        }
    }

    // ─────────────────────────── 仿真主循环 ───────────────────────────
    tick(dt) {
        this._sensePower();

        // 自动模式状态机先合成命令（手动开关命令优先）
        const autoStartSave = this._startCmd, autoStopSave = this._stopCmd,
              autoCloseSave = this._closeCmd, autoSpdSave = this._spdVolt;
        this._runAuto(dt);
        const inAuto = this.mode === 'auto' && this._powered;
        const startCmd = this._startCmd || (inAuto ? autoStartSave : false);
        const stopCmd  = this._stopCmd  || (inAuto ? autoStopSave : false);
        let closeCmd   = this._closeCmd || (inAuto ? autoCloseSave : false);
        let spdVolt    = this._userSpd ?? (inAuto ? autoSpdSave : 0);

        const gen = this._gen(), qf = this._qf();

        // 复位请求：先联动复位保护装置（其内部自检故障源，仅故障消失才解除跳闸）
        if (this._resetReq && this._powered) {
            const prot = this._prot();
            if (prot && typeof prot.reset === 'function') prot.reset();
        }
        // 故障锁存：任一故障源出现即锁存；故障源全部消失后按复位解除
        if (this._hasFaultSource()) this._faultLatched = true;
        else if (this._resetReq && this._powered) this._faultLatched = false;

        // 输出通道合成（仅上电且非灭磁优先级冲突时有效）
        this._startPressed = this._powered && (this._startCmd || (inAuto && this._autoState === 'starting'));
        this._stopPressed  = this._powered && stopCmd;
        // 遥控合闸联锁：电网有电 且 同步表未打开 → 禁止合闸（防不经同步误并网）
        const gridLive = this._gridLive();
        const syncGuard = gridLive && !this._syncOn;
        this._closePressed = this._powered && closeCmd && !(qf && qf.isClosed()) && !syncGuard;
        this._openPressed  = this._powered && this._openCmd && !(qf && !qf.isClosed());
        // 调速电压输出：±1V
        this._spdVolt = this._powered ? spdVolt : 0;
        // 灭磁触点：面板供电且发电机已停机 → 持续发出灭磁指令（停机即灭磁）
        this._demagClosed = this._powered && !!gen && !gen.isOn;

        // 高压带电显示
        const live = this._tSideLive();
        this._lastTSide = live;
        if (!live && this._selfTestT > 0) this._selfTestT -= dt;

        // 同步表：待并机(genId=发电机1) vs 电网(汇流排1 busId)
        //   指针角速度 ∝ 频差（滑差）；指针角度 = 两源相位差（滑差相位累积）
        //   防误并网：频差 > 0.5Hz 或 相位差 30°~300°（危险区）→ 所有真空断路器跳闸 + 同步表自动复位
        const grid = this._gridBus();
        if (this._syncOn && this._powered && gen && gen.isOn && grid.live) {
            const fGen  = (gen._freqOut ?? gen.freq) || 50;
            const dF = fGen - grid.freq;
            this._synPhase += 2 * Math.PI * dF * dt;
            const degNow = ((this._synPhase * 180 / Math.PI) % 360 + 360) % 360;
            // 并车失败：频差 > 0.5Hz 或 相位差落入危险区（30°~300°）
            //   → 1号断路器（待并机）跳闸不并入；母联断路器保持合闸（电网互联不受影响）
            if (Math.abs(dF) > 0.5 || (degNow >= 30 && degNow <= 300)) {
                this._tripMainBreaker();
            }
        }
        const deg = ((this._synPhase * 180 / Math.PI) % 360 + 360) % 360;
        this._synPtr.rotation(deg);

        this._updateVisuals({ live });
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 电网参数（汇流排1）：{ live 是否有电, freq 电网频率 }
     *  有电：汇流排 A 相电压（对地）滑窗 RMS > 100V
     *  频率：汇流排供电源 —— qf1 合闸 → genId 发电机；vcbs2 合闸 → gen_s（简化发电机） */
    _gridBus() {
        const sys = this.sys;
        if (!sys || !sys.comps) return { live: false, freq: 50 };
        const bus = sys.comps[this.busId];
        let live = false;
        if (bus && typeof sys.getVoltageBetween === 'function') {
            const v = Math.abs(sys.getVoltageBetween(`${bus.id}_wire_l1_1`, 'gnd_coil2_wire_gnd') || 0);
            if (!this._busVWin) this._busVWin = [];
            this._busVWin.push(v * v);
            if (this._busVWin.length > 40) this._busVWin.shift();
            const rms = Math.sqrt(this._busVWin.reduce((a, b) => a + b, 0) / this._busVWin.length);
            live = rms > 100;
        }
        // 电网频率：汇流排供电源
        let freq = 50;
        const g1 = sys.comps[this.genId];
        const qf = this.qfId ? sys.comps[this.qfId] : null;
        const v2 = sys.comps['vcbs2'];
        if (qf && qf.isClosed && qf.isClosed() && g1) {
            freq = (g1._freqOut ?? g1.freq) || 50;
        } else if (v2 && v2.isClosed && v2.isClosed() && sys.comps.gen_s) {
            freq = (sys.comps.gen_s._freqOut ?? sys.comps.gen_s.freq) || 50;
        }
        return { live, freq };
    }

    /** 电网是否有电（汇流排1 相电压） */
    _gridLive() {
        return this._gridBus().live;
    }

    /** 并车失败：1号断路器（qfId，待并机）跳闸不并入 —— 母联断路器不受影响 */
    _tripMainBreaker() {
        if (!this.sys || !this.sys.comps || !this.qfId) return;
        const qf = this.sys.comps[this.qfId];
        if (qf && typeof qf.tryTrip === 'function') {
            try { qf.tryTrip(); } catch (e) { /* ignore */ }
        }
    }

    _updateVisuals(st) {
        // 第一排指示灯
        const gen = this._gen();
        const lit = [
            this._powered,                                                    // 电源
            this._powered && this.mode === 'auto',                            // 自动
            this._powered && !!gen && gen.mode === 'remote' && !gen.isOn
                && !this._faultLatched && !this._hasFaultSource(),            // READY FOR START
            this._powered && !!gen && gen.isOn,                               // 运行
            this._powered && !!(this._qf() && this._qf().isGrounded()),       // 接地合（绿）
            this._powered && !!(this._qf() && !this._qf().isGrounded()),      // 接地开（红）
            this._powered && this._faultLatched,                              // 故障
        ];
        const litColors = ['#ffffff', '#ffffff', '#7dffb0', '#ffffff', '#20a030', '#e03030', '#e03030'];
        lit.forEach((on, i) => this._lampEls[i].fill(on ? litColors[i] : '#5a6068'));

        // 开关拨杆角度
        this._swModeLever.rotation(this.mode === 'auto' ? 45 : -45);
        this._swSyncLever.rotation(this._syncOn ? 30 : -30);
        this._swStartLever.rotation(this._startCmd ? -45 : (this._stopCmd ? 45 : 0));
        this._swCloseLever.rotation(this._closeCmd ? -45 : (this._openCmd ? 45 : 0));

        // 第三排带电显示：三相带电常亮；自检期间三灯亮 3s
        const selfTestOn = this._selfTestT > 0;
        const on = st.live || selfTestOn;
        this._liveLampEls.forEach((el, i) => el.fill(on ? this._live.lamps[i].c : '#4a5058'));
    }

    // ─────────────────────────── 公开 API ───────────────────────────
    isPowered()      { return this._powered; }
    isFaultLatched() { return this._faultLatched; }
    getAutoState()   { return this.mode === 'auto' ? this._autoState : 'manual'; }

    // ─────────────────────────── 配置 ───────────────────────────
    getConfigFields() {
        return [
            { label: '发电机 ID', key: 'genId', type: 'text' },
            { label: '真空断路器 ID', key: 'qfId', type: 'text' },
            { label: '微机保护装置 ID', key: 'protId', type: 'text' },
            { label: '电网基准汇流排 ID（同步表）', key: 'busId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.genId !== undefined) this.genId = cfg.genId;
        if (cfg.qfId  !== undefined) this.qfId  = cfg.qfId;
        if (cfg.protId !== undefined) this.protId = cfg.protId;
        if (cfg.busId !== undefined) this.busId = cfg.busId;
        this.config = { ...this.config, ...cfg };
    }

    destroy() {
        super.destroy?.();
    }
}
