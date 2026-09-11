import { BaseComponent } from './BaseComponent.js';

/**
 * 灯光旋转法并车指示器（Lamp Rotation Synchronizer）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  灯光旋转法是船舶电站手动准同步并车的经典频差/相位差检测方法：
 *  三盏同步指示灯沿表盘圆周对称分布（12 点 / 4 点 / 8 点，间隔 120°），
 *  灯与端子按相序位置一一对应：
 *    - 12 点灯接在上边第 1 相（busL1）与右边第 1 相（genP1）之间
 *    - 4 点灯接在上边第 2 相（busL2）与右边第 2 相（genP2）之间
 *    - 8 点灯接在上边第 3 相（busL3）与右边第 3 相（genP3）之间
 *  上端三相端口依次接汇流排 L1/L2/L3；右侧三相端子接待并机，
 *  相序交叉与否由外部接线决定：
 *    - 交叉接线（第1相→发电机L1、第2相→发电机L3、第3相→发电机L2）
 *      → 三灯熄灭点 0°/120°/240°，明暗沿圆周旋转（灯光旋转法）；
 *    - 若第2相接了发电机的 L2、第3相接了 L3（直连）→ 三灯熄灭点重合，
 *      三灯亮度总是相同（退化为灯光明暗法），LCD 显示"接线错误"警告。
 *  无论哪盏灯，只要有一端未连线（汇流排侧或待并机侧），该灯即熄灭，
 *  LCD 显示"接线断开"警告。
 *  每盏灯的熄灭点与最亮点严格相差 180°，亮度在熄灭点→最亮点之间
 *  线性渐变（由最暗变到最亮，过最亮点后再由最亮变到最暗）。
 *  旋转方向由频差符号决定（相位差读取自数字同步表，随真实 Δf 积分）：
 *    - 正频差（待并机快）：明暗沿圆周顺时针旋转（12→4→8）
 *    - 负频差（待并机慢）：12 点灯规律不变，明暗反向旋转（12→8→4）
 *
 *  使能条件（同步表选择开关）：只有选择开关切到待并机组档位（2/3 档）
 *  且回路有电压时，灯泡才按规律变化；选择开关 OFF 档（或两侧均无电压）
 *  时三灯全部熄灭。一侧有电压另一侧无电压时三灯全亮（灯承受单侧相电压）。
 *  中央 LCD 实时显示频差 Δf 与运行状态；准同步（|Δf|<0.1Hz 且相位差
 *  接近 0°、12 点灯熄灭）时显示"可合闸"。
 *
 * ═══ 相位/频率测量 ════════════════════════════════════════════════════
 *  相位差、频差直接读取数字同步表（syncScopeId，默认 sync1）的计算结果，
 *  保证两表显示完全一致；同步表关闭（选择开关 OFF 档 / 待并机停机）或不
 *  存在时，回退为自行测量积分（同款逻辑）。
 *  六个端口均不参与电路计算（纯测量，高阻抗，无 MNA stamp）：每帧按端
 *  口簇读取三相电压幅值（有电判定），按端口簇匹配在网发电机实际输出频率。
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  busL1 / busL2 / busL3 — 上端，汇流排 L1/L2/L3 三相（第1/2/3相）
 *  genP1 / genP2 / genP3 — 右侧，待并机第1/2/3相端子（交叉与否由接线决定）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  id : 组件名称
 */
export class LampRotationSync extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 面板尺寸为数字同步表（240×280）的 2/3
        this.width  = Math.max(130, config.width  || 160);
        this.height = Math.max(150, config.height || 187);

        this.type  = 'lampRotationSync';
        this.cache = 'fixed';
        this._syncScopeId = config.syncScopeId || 'sync1';   // 读取相位差的数字同步表组件 ID

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id };

        // 上端三相端口（从左到右，第1/2/3相接汇流排 L1/L2/L3）
        this.addPort(this._portBusL1.x, this._portBusL1.y, 'busL1', 'wire', 'p');
        this.addPort(this._portBusL2.x, this._portBusL2.y, 'busL2', 'wire', 'p');
        this.addPort(this._portBusL3.x, this._portBusL3.y, 'busL3', 'wire', 'p');
        // 右侧三相端子（从上到下为第1/2/3相；12/4/8 点灯分别接上边与右边的第1/2/3相之间）
        this.addPort(this._portGenP1.x, this._portGenP1.y, 'genP1', 'wire', 'p');
        this.addPort(this._portGenP2.x, this._portGenP2.y, 'genP2', 'wire', 'p');
        this.addPort(this._portGenP3.x, this._portGenP3.y, 'genP3', 'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W * 0.42;                       // 盘心略左移，给右侧待并机端口留出空间
        this._cy = H * 0.55;
        this._R  = Math.min(W * 0.38, H * 0.33);
        this._lampRingR = this._R - 13;
        this._lampR = Math.max(8, this._R * 0.17);
        // 上端三相端口（从左到右）
        this._portBusL1 = { x: W * 0.25, y: 3 };
        this._portBusL2 = { x: W * 0.50, y: 3 };
        this._portBusL3 = { x: W * 0.75, y: 3 };
        // 右侧三相端子（从上到下为第1/2/3相）
        const gy = [this._cy - this._R * 0.95, this._cy, this._cy + this._R * 0.95];
        this._portGenP1 = { x: W - 3, y: gy[0] };
        this._portGenP2 = { x: W - 3, y: gy[1] };
        this._portGenP3 = { x: W - 3, y: gy[2] };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this._fBus      = 50;          // 汇流排频率 Hz（直读母线在网发电机）
        this._fGen      = 50;          // 待并机频率 Hz（直读待并发电机）
        this._phaseDiff = 0;           // 相位差 φgen−φbus（rad，[0,2π)，按真实 Δf 积分）
        this._inSync    = false;       // 是否处于准同步（可合闸）
        this._hasVolt   = false;       // 两侧是否均有有效电压（旋转条件）
        this._hasVoltBus = false;      // 汇流排侧是否带电
        this._hasVoltGen = false;      // 待并机侧是否带电
        this._selOff    = false;       // 同步表选择开关处于 OFF 档
        this._parallel  = false;       // 是否已并联（主开关合闸，两机同相锁定）
        this._off       = false;       // 指示器关闭（OFF 档或两侧均无电压）
        this._darkPoints = [0, 120, 240]; // 三灯熄灭点（由实际接线推导，默认为正确交叉）
        this._crossError = false;      // 接线检测：第2/3相交叉接反（直连）时为 true
        this._lampWired = [true, true, true]; // 三灯两端接线状态（任一端断线该灯熄灭）
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const { _cx: cx, _cy: cy, _R: R, _lampRingR: ringR, _lampR: lampR } = this;
        const W = this.width, H = this.height;

        // 表体外框（浅灰蓝工业面板风，与同步发电机面板一致）
        this._staticGroup.add(new Konva.Rect({
            x: 1, y: 1, width: W - 2, height: H - 2,
            fill: '#e8eef4', cornerRadius: 3,
            stroke: '#1a252f', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 4, y: 4, width: W - 8, height: H - 8,
            fill: '#dfe7ee', cornerRadius: 2,
            stroke: '#5a6a75', strokeWidth: 1,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 8, width: W,
            text: '灯光旋转法并车', fontSize: 11, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#1a252f', align: 'center',
        }));

        // 表盘外圈 / 盘面（与数字同步表同款配色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 3,
            fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fill: '#dfe7ee', stroke: '#5a6a75', strokeWidth: 1,
        }));

        // 三灯方位角（屏幕角度）：12 点 / 4 点 / 8 点，沿圆周对称分布
        const lampAngles = [-90, 30, 150];

        // 灯座（暗色底圈，增强观感）
        lampAngles.forEach(deg => {
            const a = deg * Math.PI / 180;
            this._staticGroup.add(new Konva.Circle({
                x: cx + ringR * Math.cos(a),
                y: cy + ringR * Math.sin(a),
                radius: lampR + 3,
                fill: '#1a252f',
                stroke: '#5a6a75', strokeWidth: 1,
                listening: false,
            }));
        });

        // 灯位刻度线（从灯环指向盘缘，红色）
        lampAngles.forEach(deg => {
            const a = deg * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + (ringR + lampR + 5) * Math.cos(a), cy + (ringR + lampR + 5) * Math.sin(a),
                    cx + (R - 3) * Math.cos(a), cy + (R - 3) * Math.sin(a),
                ],
                stroke: '#e74c3c', strokeWidth: 2, lineCap: 'round',
            }));
        });

        // 相位差标注（各灯对应的熄灭点相位差，置于盘缘外侧、避开端口引线）
        const fs = Math.max(8, R * 0.13);
        const lbl = ['0°', '120°', '240°'];
        const lblR = R + 6;
        lampAngles.forEach((deg, i) => {
            const a = deg * Math.PI / 180;
            let lx = cx + lblR * Math.cos(a);
            let ly = cy + lblR * Math.sin(a);
            if (i === 0) lx -= fs * 1.5;           // 12 点标注左移，避开汇流排 L2 端口引线
            if (i === 1) lx += fs * 0.4;           // 4 点标注稍右
            if (i === 2) lx -= fs * 0.4;           // 8 点标注稍左
            this._staticGroup.add(new Konva.Text({
                x: lx - fs * 1.6, y: ly - fs * 0.6,
                text: lbl[i], fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#1a252f', width: fs * 3.2, align: 'center',
            }));
        });

        // 快 / 慢 方向标记（正频差明暗顺时针转 = 快；负频差逆时针转 = 慢）
        const fs2 = Math.max(10, R * 0.16);
        this._staticGroup.add(new Konva.Text({
            x: cx + ringR * 0.30, y: cy - ringR * 0.72 - fs2 * 0.4,
            text: '快', fontSize: fs2, fontFamily: 'Arial',
            fill: '#e74c3c', width: fs2, align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - ringR * 0.30 - fs2, y: cy - ringR * 0.72 - fs2 * 0.4,
            text: '慢', fontSize: fs2, fontFamily: 'Arial',
            fill: '#1565c0', width: fs2, align: 'center', fontStyle: 'bold',
        }));

        // 中央 LCD 信息区（黑底，与发电机面板 LCD 同款；显示 Δf / Δφ / 状态，与数字同步表一致）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.50,
            fill: '#0a0e12', stroke: '#3a4a55', strokeWidth: 1,
        }));

        // 端口引线（虚线：上端三相从盘缘上弧引出，右侧三相从盘缘右弧引出）
        const aDeg = { busL1: -118, busL2: -90, busL3: -62, genP1: -44, genP3: 0, genP2: 44 };
        const lead = (name, px, py) => {
            const a = aDeg[name] * Math.PI / 180;
            this._drawPortLead(cx + R * Math.cos(a), cy + R * Math.sin(a), px, py, '#5a6a75');
        };
        lead('busL1', this._portBusL1.x, this._portBusL1.y);
        lead('busL2', this._portBusL2.x, this._portBusL2.y);
        lead('busL3', this._portBusL3.x, this._portBusL3.y);
        lead('genP1', this._portGenP1.x, this._portGenP1.y);
        lead('genP3', this._portGenP3.x, this._portGenP3.y);
        lead('genP2', this._portGenP2.x, this._portGenP2.y);

        // 端口标签：上端 = 汇流排相序 L1/L2/L3；右侧 = 第1/2/3相端子序号
        const lFs = Math.max(8, W * 0.055);
        [['L1', this._portBusL1], ['L2', this._portBusL2], ['L3', this._portBusL3]].forEach(([t, p]) => {
            this._staticGroup.add(new Konva.Text({
                x: p.x - lFs * 0.7, y: p.y + 7,
                text: t, fontSize: lFs, fontFamily: 'Arial', fill: '#5a6a75', fontStyle: 'bold'
            }));
        });
        [['1', this._portGenP1], ['2', this._portGenP2], ['3', this._portGenP3]].forEach(([t, p]) => {
            this._staticGroup.add(new Konva.Text({
                x: p.x - lFs * 1.9, y: p.y - lFs * 0.85,
                text: t, fontSize: lFs, fontFamily: 'Arial', fill: '#5a6a75', fontStyle: 'bold'
            }));
        });
    }

    _drawPortLead(x0, y0, x1, y1, color) {
        this._staticGroup.add(new Konva.Line({
            points: [x0, y0, x1, y1],
            stroke: color, strokeWidth: 1.5, dash: [4, 3],
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const { _cx: cx, _cy: cy, _lampRingR: ringR, _lampR: lampR } = this;

        // 3 盏同步指示灯：索引 0 = 12 点（第1相，熄灭点 0°）、1 = 4 点（第2相，熄灭点 120°）、
        // 2 = 8 点（第3相，熄灭点 240°）
        const angles = [-90, 30, 150];
        this._lamps = [];
        this._hlights = [];
        angles.forEach(deg => {
            const a = deg * Math.PI / 180;
            const lx = cx + ringR * Math.cos(a);
            const ly = cy + ringR * Math.sin(a);
            const lamp = new Konva.Circle({
                x: lx, y: ly,
                radius: lampR,
                fill: '#c9d2db',
                opacity: 0.5,
                listening: false,
            });
            this._dynamicGroup.add(lamp);
            this._lamps.push(lamp);
            // 灯心高光小圆：亮度越高越明显，增强"点亮"观感
            const hl = new Konva.Circle({
                x: lx - lampR * 0.28, y: ly - lampR * 0.28,
                radius: lampR * 0.34,
                fill: '#ffffff',
                opacity: 0.1,
                listening: false,
            });
            this._dynamicGroup.add(hl);
            this._hlights.push(hl);
        });

        // 中央 LCD：三行显示——频差 Δf、相位差 Δφ（与数字同步表一致）、运行状态
        const fs = Math.max(8, this._R * 0.14);
        const tw = this._R * 0.94;
        this._deltaText = new Konva.Text({
            x: cx - tw / 2, y: cy - fs * 1.95,
            text: 'Δf 0.00Hz', fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff88', width: tw, align: 'center',
        });
        this._dynamicGroup.add(this._deltaText);

        this._phaseText = new Konva.Text({
            x: cx - tw / 2, y: cy - fs * 0.45,
            text: 'Δφ 0°', fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#7dd3ff', width: tw, align: 'center',
        });
        this._dynamicGroup.add(this._phaseText);

        this._stateText = new Konva.Text({
            x: cx - tw / 2, y: cy + fs * 1.05,
            text: '--', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#7dd3ff', width: tw, align: 'center',
        });
        this._dynamicGroup.add(this._stateText);
    }

    // ═══════════════════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const sv = this.sys && this.sys.voltageSolver;
        if (sv) {
            // ── 三相电压幅值（有电判定）：六个端口均不参与电路计算，仅读簇电压
            const vMax = names => Math.max(...names.map(n => {
                const c = sv.portToCluster.get(`${this.id}_wire_${n}`);
                return c !== undefined ? Math.abs(sv.nodeVoltages.get(c) || 0) : 0;
            }));
            this._hasVoltBus = vMax(['busL1', 'busL2', 'busL3']) > 5;
            this._hasVoltGen = vMax(['genP1', 'genP2', 'genP3']) > 5;
            this._hasVolt = this._hasVoltBus && this._hasVoltGen;

            // ── 连接检测：按实际接线推导三灯熄灭点（交叉错误检测）
            this._updateWiring(sv);
        }

        // ── 相位差/频率：优先直接读取数字同步表（syncScopeId）的计算结果，
        //    保证两表显示完全一致；同步表关闭（待并机未接入/停机）、未接线
        //    （被勾选框删除接线）或不存在时，回退为自行测量积分（逻辑与同步表对齐）。
        const sc = this.sys && this.sys.comps ? this.sys.comps[this._syncScopeId] : null;
        // 同步表必须已接线（bus/gen 端口在拓扑中）且未关闭才可读取，
        // 否则其内部状态为僵死残留值（tick 在未接线时整体跳过）
        const scWired = !!(sv && sc &&
            sv.portToCluster.get(`${sc.id}_wire_bus`) !== undefined &&
            sv.portToCluster.get(`${sc.id}_wire_gen`) !== undefined);
        const scActive = !!(scWired && sc && !sc._off && typeof sc._phaseDiff === 'number');
        if (scActive) {
            this._phaseDiff = sc._phaseDiff;
            if (typeof sc._fBus === 'number') this._fBus = sc._fBus;
            if (typeof sc._fGen === 'number') this._fGen = sc._fGen;
            this._parallel = !!sc._parallel;
        } else {
            let fGenNull = true;
            if (sv) {
                const src = this._readSourceFreq(sv);
                fGenNull = src.fGen === null;
                if (src.fBus !== null) this._fBus = src.fBus;
                if (src.fGen !== null) { this._fGen = src.fGen; this._genComp = src.genComp; }
                const genComp = src.genComp || this._genComp || null;
                this._parallel = !!(genComp && Array.isArray(genComp._peers) && genComp._peers.length > 0);
            }
            const dF0 = this._fGen - this._fBus;
            if (fGenNull) {
                // 待并机未接入/停机：相位差复位（与同步表关闭行为一致）
                this._phaseDiff = 0;
            } else if (this._parallel) {
                this._phaseDiff = 0;
            } else if (this._hasVoltBus || this._hasVoltGen) {
                const step = (dt || 0.05);
                const ph = this._phaseDiff + 2 * Math.PI * dF0 * step;
                this._phaseDiff = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            }
        }

        // ── 使能判定（灯显示）：同步表选择开关 OFF 档，或两侧均无电压 → 三灯全灭
        const sel = this.sys && this.sys.comps ? this.sys.comps.sync_sel : null;
        this._selOff = !!(sel && typeof sel.getPosition === 'function' && sel.getPosition() === 1);
        this._off = this._selOff || (!this._hasVoltBus && !this._hasVoltGen);

        // 准同步判定：频差 |Δf|<0.1Hz 且相位差接近 0°（12 点灯熄灭位置）
        const dF = this._fGen - this._fBus;
        const deg = this._phaseDiff * 180 / Math.PI;
        this._inSync = !this._off
            && this._hasVolt
            && Math.abs(dF) < 0.1
            && (deg < 8 || deg > 352);

        this._updateLamps(dF);
        this._updateTexts(dF, deg);
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /**
     * 从端口簇匹配在网同步发电机的实际输出频率（_freqOut），
     * 返回 { fBus, fGen, genComp }；无匹配时为 null。
     * bus 侧：任一 busL* 端口簇与母线在网发电机连通；
     * gen 侧：任一 genP* 端子簇与待并发电机 u 端口同簇。
     */
    _readSourceFreq(sv) {
        let fBus = null, fGen = null, genComp = null;
        const busClusters = ['busL1', 'busL2', 'busL3']
            .map(n => sv.portToCluster.get(`${this.id}_wire_${n}`))
            .filter(c => c !== undefined);
        const genClusters = ['genP1', 'genP2', 'genP3']
            .map(n => sv.portToCluster.get(`${this.id}_wire_${n}`))
            .filter(c => c !== undefined);
        for (const id in this.sys.comps) {
            const c = this.sys.comps[id];
            if (!c || c.type !== 'source_3p' || !c.isOn) continue;
            const cU = sv.portToCluster.get(`${id}_wire_u`);
            if (cU === undefined) continue;
            const f = c._freqOut ?? c.freq;
            if (f === undefined || f === null) continue;
            // 待并机：u 端口簇与任一待并机端口同簇
            if (fGen === null && genClusters.includes(cU)) { fGen = f; genComp = c; }
            // 母线源：直接接母线，或经闭合主开关（ACB）桥接接入母线
            if (fBus === null && busClusters.some(bc => this._isOnBus(sv, cU, bc))) fBus = f;
        }
        return { fBus, fGen, genComp };
    }

    /**
     * 判断发电机 u 端口簇是否与母线簇电气连通（与 Syncroscope 同款逻辑）。
     * 母线端口与母线同簇；发电机经主开关（ACB）合闸时桥接接入母线。
     */
    _isOnBus(sv, cGenU, cBus) {
        if (cGenU === cBus) return true;   // 直接接母线
        for (const id in this.sys.comps) {
            const m = this.sys.comps[id];
            if (!m || m.type !== 'ACB' || m._state !== 'on') continue;
            const cT = sv.portToCluster.get(`${id}_wire_t1`);
            const cL = sv.portToCluster.get(`${id}_wire_l1`);
            if (cT === undefined || cL === undefined) continue;
            if (cT === cGenU && cL === cBus) return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════
    // 连接检测：按实际接线推导三灯熄灭点
    // ═══════════════════════════════════════════════════════

    /**
     * 连接检测：读取右侧三个端子（genP1/P2/P3，即第1/2/3相）实际接到的
     * 发电机相（u=L1、v=L2、w=L3），推导每盏灯的电压差熄灭点（灯两端
     * 同相的位置）。灯与端子按相序位置对应：
     *   灯 1（12 点）＝ busL1 ↔ genP1；灯 2（4 点）＝ busL2 ↔ genP2；
     *   灯 3（8 点）＝ busL3 ↔ genP3。
     * 灯 i 熄灭点 = 汇流排相偏移 − 发电机相偏移（mod 360°）。
     * 汇流排相偏移：busL1=0°、busL2=−120°、busL3=+120°；
     * 发电机相偏移：L1=0°、L2=−120°、L3=+120°。
     *   - 正确交叉（第1相→L1、第2相→L3、第3相→L2）：
     *     熄灭点 0°/120°/240° → 三灯明暗沿圆周旋转（旋转法）；
     *   - 若第2相接了发电机的 L2、第3相接了 L3（直连）：
     *     三灯熄灭点重合于 0° → 三灯亮度总是相同（退化为灯光明暗法），
     *     同时置 _crossError = true，LCD 显示"接线错误"警告。
     * 同时检测断线：任一灯的任一端（汇流排侧或待并机侧）未连线，
     * 该灯熄灭（_lampWired[i] = false），LCD 显示"接线断开"警告。
     */
    _updateWiring(sv) {
        const GEN_OFF = { L1: 0, L2: -120, L3: 120 };
        const clusterOf = portName => sv.portToCluster.get(`${this.id}_wire_${portName}`);
        // 查询某端子实际接到的发电机相
        const phaseOf = portName => {
            const c = clusterOf(portName);
            if (c === undefined) return null;
            for (const id in this.sys.comps) {
                const g = this.sys.comps[id];
                if (!g || g.type !== 'source_3p') continue;
                if (sv.portToCluster.get(`${id}_wire_u`) === c) return 'L1';
                if (sv.portToCluster.get(`${id}_wire_v`) === c) return 'L2';
                if (sv.portToCluster.get(`${id}_wire_w`) === c) return 'L3';
            }
            return null;
        };
        const p1 = phaseOf('genP1');   // 第1相端子（12 点灯）
        const p2 = phaseOf('genP2');   // 第2相端子（4 点灯）
        const p3 = phaseOf('genP3');   // 第3相端子（8 点灯）
        const norm = d => ((d % 360) + 360) % 360;
        // 未接线/未匹配的端子按默认正确相处理（该灯随后因断线检测而熄灭，不影响显示）
        const dark1 = norm(0 - GEN_OFF[p1 || 'L1']);
        const dark2 = norm(-120 - GEN_OFF[p2 || 'L3']);
        const dark3 = norm(120 - GEN_OFF[p3 || 'L2']);
        this._darkPoints = [dark1, dark2, dark3];
        // 接线检测：第2相接了发电机的 L2、第3相接了 L3（直连明暗法）
        this._crossError = p2 !== null && p3 !== null && p2 === 'L2' && p3 === 'L3';
        // 断线检测：任一灯的任一端（汇流排侧 / 待并机侧）未连线 → 该灯熄灭
        const busWired = n => clusterOf(`bus${n}`) !== undefined;
        const genWired = n => clusterOf(`genP${n}`) !== undefined;
        this._lampWired = [
            busWired('L1') && genWired('1'),
            busWired('L2') && genWired('2'),
            busWired('L3') && genWired('3'),
        ];
    }

    // ═══════════════════════════════════════════════════════
    // 灯光亮度计算
    // ═══════════════════════════════════════════════════════

    /**
     * 圆周角距：a、b 两角度的最小间隔（0 ~ 180）。
     */
    _angDist(a, b) {
        let d = Math.abs(a - b) % 360;
        if (d < 0) d += 360;
        return d > 180 ? 360 - d : d;
    }

    /**
     * 单灯亮度（0 ~ 1，线性三角波规律）：
     * 以该灯熄灭点 darkDeg 为最暗（0，角距 0），沿圆周线性渐变到对侧
     * （相差恰好 180° 的位置）最亮（1，角距 180°），再线性渐暗回熄灭点。
     * 即：0°→180° 由最暗匀速变到最亮，180°→360° 由最亮匀速变到最暗。
     */
    _lampLevel(phiDeg, darkDeg) {
        return this._angDist(phiDeg, darkDeg) / 180;
    }

    /**
     * 三灯亮度更新（in-place 修改节点属性）。
     * 每盏灯熄灭点由实际接线推导（_darkPoints，默认 0°/120°/240°），
     * 最亮点恒在熄灭点对侧（相差 180°）：
     *   - 正确交叉接线：三灯熄灭点 0°/120°/240°，明暗沿圆周旋转（旋转法）；
     *   - 第2/3相交叉接反（直连）：三灯熄灭点重合，亮度总是相同（明暗法）。
     * 指示器关闭（OFF 档 / 两侧无电压）→ 三灯全灭；
     * 仅一侧带电（灯承受单侧相电压）→ 三灯全亮。
     */
    _updateLamps(dF) {
        let levels;
        if (this._off) {
            levels = [0, 0, 0];
        } else if (!this._hasVolt) {
            // 一侧带电另一侧无电：三灯全亮
            levels = [1, 1, 1];
        } else {
            const phiDeg = this._phaseDiff * 180 / Math.PI;
            levels = this._darkPoints.map(dk => this._lampLevel(phiDeg, dk));
        }
        for (let i = 0; i < 3; i++) {
            const lamp = this._lamps[i];
            // 断线检测：任一端未连线的灯强制熄灭
            const t = this._lampWired[i] ? Math.max(0, Math.min(1, levels[i])) : 0;
            // 颜色插值：熄灭灰 #c9d2db → 点亮亮红 #ff5537（高亮度）
            const r = Math.round(201 + (255 - 201) * t);
            const g = Math.round(210 + (85 - 210) * t);
            const b = Math.round(219 + (55 - 219) * t);
            lamp.fill(`rgb(${r},${g},${b})`);
            lamp.opacity(this._off ? 0.5 : (this._lampWired[i] ? 0.6 + 0.4 * t : 0.5));
            // 灯心高光随亮度增强
            this._hlights[i].opacity((this._off || !this._lampWired[i]) ? 0.05 : 0.1 + 0.5 * t);
        }
    }

    _updateTexts(dF, deg) {
        if (this._off) {
            this._deltaText.text('OFF');
            this._deltaText.fill('#5a6a75');
            this._phaseText.text('Δφ --');
            this._phaseText.fill('#5a6a75');
            this._stateText.text(this._selOff ? '未投入' : '无电压');
            this._stateText.fill('#5a6a75');
            return;
        }
        if (!this._hasVolt) {
            // 一侧带电另一侧无电：三灯全亮
            this._deltaText.text('----');
            this._deltaText.fill('#c9a94a');
            this._phaseText.text('Δφ --');
            this._phaseText.fill('#c9a94a');
            this._stateText.text(this._hasVoltGen ? '母线无电' : '待并机无电');
            this._stateText.fill('#c9a94a');
            return;
        }
        // 频差 + 相位差（与数字同步表显示内容一致）
        this._deltaText.text(`Δf ${dF >= 0 ? '+' : ''}${dF.toFixed(2)}Hz`);
        this._phaseText.text(`Δφ ${Math.round(((deg % 360) + 360) % 360)}°`);
        if (this._crossError) {
            // 连接检测：第2/3相直连（未交叉），三灯亮度总是相同
            this._deltaText.fill('#ffb340');
            this._phaseText.fill('#ffb340');
            this._stateText.text('接线错误');
            this._stateText.fill('#ffb340');
        } else if (this._lampWired && this._lampWired.some(w => !w)) {
            // 连接检测：有灯的任一端未连线，该灯熄灭
            this._deltaText.fill('#ffb340');
            this._phaseText.fill('#ffb340');
            this._stateText.text('接线断开');
            this._stateText.fill('#ffb340');
        } else if (this._inSync) {
            this._deltaText.fill('#2cff6a');
            this._phaseText.fill('#2cff6a');
            this._stateText.text('可合闸');
            this._stateText.fill('#2cff6a');
        } else {
            this._deltaText.fill('#00ff88');
            this._phaseText.fill('#7dd3ff');
            this._stateText.text(dF >= 0 ? '待并机快' : '待并机慢');
            this._stateText.fill('#7dd3ff');
        }
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '组件名称 (ID)', key: 'id', type: 'text' },
            { label: '同步表 ID（读取其相位差，留空用默认 sync1）', key: 'syncScopeId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.syncScopeId !== undefined) this._syncScopeId = String(cfg.syncScopeId || 'sync1');
        this.config = { ...this.config, ...cfg };
    }
}
