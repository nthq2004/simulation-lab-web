import { BaseComponent } from './BaseComponent.js';

const PHASE_COLORS = ['#e03030', '#20a030', '#2050e0'];
const SLOT_GRAY = '#b6b6bc';

// 视觉减速比：真实同步速（4 极 25 转/秒）远超 20fps 渲染与人眼可分辨范围，
// 若按真实角速度绘制会出现频闪（走样/跳变）。统一按 VIS_SCALE 减速后，
// 旋转磁场与转子呈现平滑连续的真实转动，且各极数之间的相对转速与转向关系保持不变。
const VIS_SCALE = 0.03;

// 端口"有电"判据：滑窗 RMS 包络阈值（V）与窗口长度（帧，20fps）。
// 用包络而非瞬时值，避免交流过零造成极数抖动（见 _updateDynamic 说明）。
// 阈值取 60V：真实相电压约 220V，而悬空/感应端子通常远低于此值。
const VOLT_TH = 60;
const VWIN = 8;
// 线电压滑窗长度：20fps 采 50Hz 时短窗 RMS 走样严重（8 帧时正常三相会算出
// [494,355,242] 这种严重不平衡值），取 25 帧(1.25s)才能得到真实线电压。
const LLWIN = 25;

/**
 * VariablePoleMotor — 可变极三相异步电动机（三速：16 / 8 / 4 极）
 *
 * ═══ 设计要点 ═══════════════════════════════════════════════
 *  1. 外观参照 InductionMotor2：转子居中、定子铁心环 + 齿槽绕组。
 *  2. 在原有内圈定子绕组之外、仍在定子铁心内部，再画一圈"可变极绕组"
 *     （定子外径与常规三相异步电动机保持一致）。
 *  3. 电路上仅作为"被动三相负载"（等效电阻，星/三角不接中性点，
 *     此处按 Δ 等效），不注入旋转电动势；电机状态（极数、转向、转速）
 *     完全由端口的连接关系与端口电压检测决定。
 *  4. 9 个端子：
 *       左侧 16D1/16D2/16D3 —— 变极绕组引出端（低速 16 极）
 *       上侧 8D1 /8D2 /8D3  —— 变极绕组引出端（中速 8 极）
 *       右侧 4D1 /4D2 /4D3  —— 高速绕组（4 极）
 *     · 8D 接三相电源 + 16D 三端短接 → 8 极，中速
 *     · 16D 接三相电源 + 8D 悬空       → 16 极，低速
 *     · 4D 接三相电源                  → 4 极，高速
 *  5. 视觉激活：
 *       4 极（高速）     → 内圈定子绕组着色，外圈绕组灰
 *       8 / 16 极（低中速）→ 外圈绕组着色，内圈定子绕组灰
 *
 * ═══ 渲染原则 ═══════════════════════════════════════════════
 *  · 动态元素 in-place 更新（fill / rotation / visible / text）
 *  · 不使用 shadow 三件套
 *  · 静态部件仅 init 时缓存
 */
export class VariablePoleMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(280, config.width  || 280);
        this.height = Math.max(280, config.height || 280);

        this.type  = 'vp_motor';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id:     this.id,
            label:  this.label,
            ratedCurrent:  this.ratedCurrent,
            loadRate:      this.loadRate,
            J: this.J,
            B: this.B,
        };

        const t = this._tp;
        Object.keys(t).forEach(name => {
            this.addPort(t[name].x, t[name].y, name, 'wire', 'p');
        });
    }

    // ═══════════════════════════════════════════
    // 几何 / 参数 / 初始化
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const cx = W / 2, cy = H / 2;
        this._cx = cx;
        this._cy = cy;

        // 定子铁心（外径与常规三相异步电动机一致：0.95R）
        const R = Math.min(W, H) * 0.30;
        this._R          = R;
        this._coreInner  = R * 0.55;
        this._coreOuter  = R * 0.95;
        // 转子 / 气隙旋转磁场（紧贴转子）
        this._rotorR     = R * 0.50;
        this._fieldR0    = R * 0.56;
        this._fieldR1    = R * 0.66;
        // 内圈定子绕组（高速 4 极绕组）
        this._slotR0     = R * 0.70;
        this._slotR1     = R * 0.77;
        // 外圈可变极绕组（仍在定子铁心内部、位于内圈绕组之外）
        this._outerR0    = R * 0.83;
        this._outerR1    = R * 0.92;

        this._termR = 4.5;

        // 端子沿 9 个方向布置在半径 termRadius 的圆上。termRadius 取
        // "端子到绕组环距离的一半"所对应的值，使引出线明显缩短，但仍与电机相连。
        const termRadius = R * 1.30;
        const A = 24.8;   // 同组相邻端子夹角（度）
        const termAngles = {
            // 16D1/16D3 位置互换（16D1 在下、16D3 在上）
            '16d1': 180 - A, '16d2': 180, '16d3': 180 + A,
            // 8D1/8D3 位置互换（8D1 在左、8D3 在右）
            '8d1':  -90 - A, '8d2': -90,  '8d3':  -90 + A,
            '4d1':  -A,      '4d2': 0,    '4d3': A,
        };
        this._tp = {};
        Object.keys(termAngles).forEach(name => {
            const a = termAngles[name] * Math.PI / 180;
            this._tp[name] = {
                x: cx + termRadius * Math.cos(a),
                y: cy + termRadius * Math.sin(a),
            };
        });

        this._termColors = {
            '16d1': PHASE_COLORS[0], '16d2': PHASE_COLORS[1], '16d3': PHASE_COLORS[2],
            '8d1':  PHASE_COLORS[0], '8d2':  PHASE_COLORS[1], '8d3':  PHASE_COLORS[2],
            '4d1':  PHASE_COLORS[0], '4d2':  PHASE_COLORS[1], '4d3':  PHASE_COLORS[2],
        };

        // 引线：由端子径向引向对应绕组环（16D/8D → 可变极绕组；4D → 内圈高速绕组）
        this._wirePaths = {};
        Object.keys(this._tp).forEach(name => {
            const tp = this._tp[name];
            const isOuter = name.startsWith('16') || name.startsWith('8');
            const rr = isOuter
                ? (this._outerR0 + this._outerR1) / 2
                : (this._slotR0 + this._slotR1) / 2;

            const dx = cx - tp.x, dy = cy - tp.y;
            const dist = Math.hypot(dx, dy) || 1;
            const k = Math.max(0, (dist - rr) / dist);
            this._wirePaths[name] = [
                tp.x, tp.y,
                tp.x + dx * k, tp.y + dy * k,
            ];
        });
    }

    _initParameters(config) {
        this.label    = config.label || 'M';
        this.function = config.function || '可变极三相异步电动机';

        // 额定电流（A）与负荷率（%）：0=空载（30% 额定电流）、100=满载（100% 额定电流）、
        // >100 为过载（电流 = 过载系数 × 额定电流）。等效相电阻由负荷率反推注入。
        this.ratedCurrent    = config.ratedCurrent !== undefined ? config.ratedCurrent : 75.9;
        this.loadRate        = config.loadRate     !== undefined ? config.loadRate     : 100;
        this.ratedLineVoltage = config.ratedLineVoltage !== undefined ? config.ratedLineVoltage : 380;

        this.J = config.J !== undefined ? config.J : 0.12;
        this.B = config.B !== undefined ? config.B : 0.01;

        // 当前等效相电阻（Δ 接法每支路，Ω）与实际线电流（A）
        this._dynBranchR = 1e9;
        this.lineCurrent = 0;

        // 制动器（抱闸检测）与堵转/缺相状态
        this.brakeId = config.brakeId || 'zdq';
        this.effLoadRate = this.loadRate;
        this._phaseLost = false;
        this._braked = false;
        this._brkStall = false;
        this._brkT = 0;
        this._brkW0 = 0;
        this._fieldPulse = 0;
        this._liveIdx = [];      // 工作绕组中有电的相索引
        this._plPair = null;     // 缺相时剩余两相的端口名
        // 判定去抖（连续 N 帧一致才采用）
        this._candN = 0;
        this._candPoles = undefined;
        this._candPhase = undefined;
        this._candGroup = undefined;
        this._stablePoles = undefined;
        this._stablePhase = false;
        this._stableGroup = undefined;
        this._stableLive = [];
        this._activeWinding = null;   // 锁存的激活绕组（'4'/'8'/'16'，缺相时保持不变）
        // 各套绕组对应的接通接触器（方案 A：据此判定工作绕组）
        this.windingContactors = config.windingContactors || { '16': '1C', '8': '2C1', '4': '3C' };
        this._stablePair = null;
        this._stablePlV = 0;
        this._missingPhase = -1;

        this._freq = config.freq || 50;

        // 机械 / 磁场状态
        this._poles      = 0;      // 当前极数（0 = 停止）
        this._polePairs  = 2;
        this._omega_m    = 0;
        this._omega_sync = 0;
        this._theta_m    = 0;
        this._visTheta   = 0;
        this._fieldAngle = 0;
        this.rpm         = 0;
        this.slip        = 1;

        // 相序检测（滞回）
        this._seq       = 1;
        this._seqVotes  = 0;
        this._vPrev = { a: 0, b: 0, c: 0 };

        // 视觉状态缓存（避免每帧重复写属性）
        this._visInner  = null;
        this._visOuter  = null;
        this._visPoles  = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawCore();
        this._drawWires();
        this._drawTerminals();
    }

    _drawCore() {
        // 定子铁心环（内圈）
        this._staticGroup.add(new Konva.Ring({
            x: this._cx, y: this._cy,
            innerRadius: this._coreInner, outerRadius: this._coreOuter,
            fillLinearGradientStartPoint: { x: -this._R, y: 0 },
            fillLinearGradientEndPoint:   { x:  this._R, y: 0 },
            fillLinearGradientColorStops: [
                0, '#b0b0b8', 0.3, '#c8c8d0', 0.5, '#d0d0d8', 0.7, '#c8c8d0', 1, '#b0b0b8',
            ],
            stroke: '#909098', strokeWidth: 0.8,
        }));
    }

    _drawTerminals() {
        const R = this._termR;
        const labels = {
            '16d1': '16D1', '16d2': '16D2', '16d3': '16D3',
            '8d1':  '8D1',  '8d2':  '8D2',  '8d3':  '8D3',
            '4d1':  '4D1',  '4d2':  '4D2',  '4d3':  '4D3',
        };
        Object.keys(this._tp).forEach(name => {
            const p = this._tp[name];
            const color = this._termColors[name];

            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R,
                fillLinearGradientStartPoint: { x: -R, y: -R },
                fillLinearGradientEndPoint:   { x:  R, y:  R },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R * 0.42,
                fill: color, stroke: '#666', strokeWidth: 0.5,
            }));

            // 标签置于端子正上方（避开电机本体与引线）
            this._staticGroup.add(new Konva.Text({
                x: p.x - 23, y: p.y - 22, width: 46,
                text: labels[name],
                fontSize: 13, fontStyle: 'bold', fill: color,
                align: 'center',
            }));
        });
    }

    _drawWires() {
        Object.keys(this._wirePaths).forEach(name => {
            this._staticGroup.add(new Konva.Line({
                points: this._wirePaths[name],
                stroke: this._termColors[name],
                strokeWidth: 3.4, lineCap: 'round',
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createInnerSlots();
        this._createOuterCoils();
        this._createFieldGroup();
        this._createRotorGroup();
    }

    /** 内圈定子齿槽（12 槽，对应 4 极高速绕组） */
    _createInnerSlots() {
        const cx = this._cx, cy = this._cy;
        const slotCount = 12;
        const stepAngle = Math.PI * 2 / slotCount;
        const halfWidth = stepAngle * 0.25;
        const rI = this._slotR0, rO = this._slotR1;
        this._slotNodes = [];
        for (let i = 0; i < slotCount; i++) {
            const a = i * stepAngle;
            const a1 = a - halfWidth, a2 = a + halfWidth;
            const pts = [
                cx + rI * Math.cos(a1), cy + rI * Math.sin(a1),
                cx + rO * Math.cos(a1), cy + rO * Math.sin(a1),
                cx + rO * Math.cos(a2), cy + rO * Math.sin(a2),
                cx + rI * Math.cos(a2), cy + rI * Math.sin(a2),
            ];
            const slot = new Konva.Line({
                points: pts, closed: true,
                fill: SLOT_GRAY, stroke: '#606060', strokeWidth: 0.4,
            });
            this._dynamicGroup.add(slot);
            this._slotNodes.push(slot);
        }
    }

    /** 外圈可变极绕组（12 组线圈，代表变极绕组） */
    _createOuterCoils() {
        const n = 12;
        const step = 360 / n;
        this._outerCoilNodes = [];
        for (let i = 0; i < n; i++) {
            const coil = new Konva.Arc({
                x: this._cx, y: this._cy,
                innerRadius: this._outerR0, outerRadius: this._outerR1,
                angle: step * 0.72,
                rotation: i * step,
                fill: SLOT_GRAY,
                stroke: '#8a8a90', strokeWidth: 0.8,
            });
            this._dynamicGroup.add(coil);
            this._outerCoilNodes.push(coil);
        }
        // 可变极绕组轮廓（定子铁心内部的一圈绕组边界）
        this._dynamicGroup.add(new Konva.Ring({
            x: this._cx, y: this._cy,
            innerRadius: this._outerR0 - 1.5, outerRadius: this._outerR1 + 1.5,
            stroke: '#9a9aa2', strokeWidth: 0.8,
            fillEnabled: false,
            listening: false,
        }));
    }

    _createFieldGroup() {
        this._fieldGroup = new Konva.Group({
            x: this._cx, y: this._cy,
            rotation: 0, listening: false, visible: false,
        });
        this._dynamicGroup.add(this._fieldGroup);
    }

    /** 依据极数重建旋转磁场的 N/S 磁极弧 */
    _rebuildField(poles) {
        this._fieldGroup.destroyChildren();
        if (poles <= 0) return;
        const arcAngle = 360 / poles;
        for (let i = 0; i < poles; i++) {
            const isN = i % 2 === 0;
            this._fieldGroup.add(new Konva.Arc({
                x: 0, y: 0,
                innerRadius: this._fieldR0, outerRadius: this._fieldR1,
                angle: arcAngle * 0.82,
                rotation: i * arcAngle,
                fill: isN ? '#e03030' : '#303030',
                stroke: isN ? '#c02020' : '#202020',
                strokeWidth: 1,
                opacity: 0.85,
            }));
        }
    }

    _createRotorGroup() {
        this._rotorGroup = new Konva.Group({
            x: this._cx, y: this._cy,
            rotation: 0, listening: false,
        });

        const r = this._rotorR;
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#b8b8c0', 0.35, '#d0d0d8', 0.65, '#c8c8d0', 1, '#b0b0b8'],
            stroke: '#909098', strokeWidth: 1,
        }));

        const barCount = 12;
        const barR = Math.max(2, r * 0.09);
        for (let k = 0; k < barCount; k++) {
            const a = (k / barCount) * Math.PI * 2;
            const br = r - barR - 1;
            this._rotorGroup.add(new Konva.Circle({
                x: br * Math.cos(a), y: br * Math.sin(a),
                radius: barR,
                fillLinearGradientStartPoint: { x: -barR, y: -barR },
                fillLinearGradientEndPoint:   { x:  barR, y:  barR },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 0.6,
            }));
        }
        this._dynamicGroup.add(this._rotorGroup);

        const shaftR = r * 0.20;
        this._dynamicGroup.add(new Konva.Circle({
            x: this._cx, y: this._cy, radius: shaftR,
            fill: '#c0c4c8', stroke: '#909898', strokeWidth: 1, listening: false,
        }));
    }

    // ═══════════════════════════════════════════
    // 电路接口（被动负载，不注入旋转电动势）
    // ═══════════════════════════════════════════

    /** 返回绕组的端口与等效电阻，供 DeviceStamps 注入 */
    getWindings() {
        const R = this._dynBranchR > 0 ? this._dynBranchR : 1e9;
        // 缺相：只在剩余两相之间注入单相等效电阻（其余一相已失电）
        if (this._phaseLost && Array.isArray(this._plPair) && this._plPair.length === 2) {
            return [{ key: 'pl', ports: this._plPair.slice(), R }];
        }
        return [
            { key: '16', ports: ['16d1', '16d2', '16d3'], R },
            { key: '8',  ports: ['8d1',  '8d2',  '8d3'],  R },
            { key: '4',  ports: ['4d1',  '4d2',  '4d3'],  R },
        ];
    }

    // ═══════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════

    /** 读取某端口对地（参考节点）电压的瞬时值 */
    _readPortV(port) {
        const solver = this.sys?.voltageSolver;
        if (!solver) return 0;
        const ci = solver.portToCluster.get(`${this.id}_wire_${port}`);
        return ci !== undefined ? (solver.nodeVoltages.get(ci) || 0) : 0;
    }

    _updateDynamic(dt = 1 / 20) {
        const raw = {
            '16': ['16d1', '16d2', '16d3'].map(p => this._readPortV(p)),
            '8':  ['8d1',  '8d2',  '8d3'].map(p => this._readPortV(p)),
            '4':  ['4d1',  '4d2',  '4d3'].map(p => this._readPortV(p)),
        };

        // 端口电压包络（滑窗 RMS）。交流端口电压为瞬时值，每周期要过零两次，
        // 若直接用瞬时值判定"三相都有电"，会在过零附近瞬间判为失电，使极数
        // 在 0 与 16/8/4 之间逐帧抖动 → 绕组着色与旋转磁场出现闪烁。
        // 故"有电"一律以滑窗 RMS 包络为判据；相序检测仍用瞬时值。
        if (!this._vWin) this._vWin = {};
        const rmsOf = (port, v) => {
            let arr = this._vWin[port];
            if (!arr) arr = this._vWin[port] = new Array(VWIN).fill(0);
            arr.push(v); arr.shift();
            let s = 0;
            for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
            return Math.sqrt(s / arr.length);
        };
        const rmsV = {
            '16': ['16d1', '16d2', '16d3'].map((p, i) => rmsOf(p, raw['16'][i])),
            '8':  ['8d1',  '8d2',  '8d3'].map((p, i) => rmsOf(p, raw['8'][i])),
            '4':  ['4d1',  '4d2',  '4d3'].map((p, i) => rmsOf(p, raw['4'][i])),
        };
        const allE = arr => arr.every(v => v > VOLT_TH);

        // 16D 三端"已短接（作 8 极运行时的星点）"判定：
        // 16D 已接入拓扑、但未被外接三相电源 → 三端由 2C2 短接为同一节点。
        // 说明：平台 isPortConnected 依赖等效电阻试探法，对"经 2C2 的 0.001Ω 触头
        //       + l1-l2-l3 短接线"这条并联路径会误判为未连通（实测 16D1–16D2 为 false，
        //       而 16D2–16D3 为 true），故此处改用"端口拓扑存在性 + 电压包络"作为判据。
        const solver = this.sys?.voltageSolver;
        const connected16 = ['16d1', '16d2', '16d3']
            .every(p => solver?.portToCluster.get(`${this.id}_wire_${p}`) !== undefined);
        const short16 = connected16 && !allE(rmsV['16']);

        // ── 工作绕组判定（方案 A）：由"该套绕组对应接触器是否吸合"决定 ──
        //  不能用端电压选择：未通电绕组会被带电母线经断开工位弱耦合抬到同等级电压，
        //  三组几乎一样，无法区分。
        const engaged = (cid) => {
            if (!cid) return false;
            const dev = this.sys?.deviceManager?.get?.(cid);   // cid 为接触器"设备 id"（如 '1C'）
            return !!(dev && typeof dev.isPickup === 'function' && dev.isPickup());
        };
        const wc = this.windingContactors || {};
        let groupKey = null;
        if (engaged(wc['4'])) groupKey = '4';
        else if (engaged(wc['8'])) groupKey = '8';
        else if (engaged(wc['16'])) groupKey = '16';

        // 该绕组的三个线电压滑窗 RMS（a-b, b-c, c-a）
        if (!this._llWin) this._llWin = { '16': [[], [], []], '8': [[], [], []], '4': [[], [], []] };
        const lineRms = [0, 0, 0];
        if (groupKey) {
            const [a2, b2, c2] = raw[groupKey];
            const w = this._llWin[groupKey];
            const d = [a2 - b2, b2 - c2, c2 - a2];
            for (let i = 0; i < 3; i++) {
                w[i].push(d[i]);
                if (w[i].length > LLWIN) w[i].shift();
                lineRms[i] = Math.sqrt(w[i].reduce((s, x) => s + x * x, 0) / Math.max(1, w[i].length));
            }
        }

        // ── 缺相判定（基于线电压，不用相电压）──
        //  三相齐全：三条线电压近似相等；
        //  缺一相  ：只剩"不含该相的那一条"线电压保持额定（另两条明显下降）；
        //  无线电压：无电 → 不显示磁场。
        //  （相电压对参考点会因中性点位移而严重不平衡，不能作判据）
        let poles = 0;
        let phaseLoss = false;
        let liveIdx = [];
        let plPair = null;
        let plV = 0;
        if (groupKey) {
            const nominal = groupKey === '4' ? 4 : (groupKey === '8' ? 8 : 16);
            const maxLine = Math.max(lineRms[0], lineRms[1], lineRms[2]);
            // 明显偏低的线电压：低于最强线的 75%。
            //  实测：健康三相最小/最大 ≈ 0.85；缺一相时两条受影响线电压 ≈ 0.5~0.65，
            //  故 0.75 可稳定区分（0.6 太紧，会把 0.64 的受影响线误判为正常）。
            const low = [0, 1, 2].filter(i => lineRms[i] < maxLine * 0.75);
            if (maxLine < VOLT_TH) {
                poles = 0;                                        // 无电
            } else if (low.length <= 1) {
                if (groupKey !== '8' || short16) poles = nominal;  // 三相齐全（中速需 16D 短接）
            } else if (low.length === 2) {
                const hp = [0, 1, 2].find(i => !low.includes(i));   // 唯一健康的那条线电压
                const pair = (hp === 0) ? [0, 1] : (hp === 1 ? [1, 2] : [2, 0]);
                const names = groupKey === '4' ? ['4d1', '4d2', '4d3']
                    : (groupKey === '8' ? ['8d1', '8d2', '8d3'] : ['16d1', '16d2', '16d3']);
                phaseLoss = true;
                poles = nominal;
                liveIdx = pair.slice();
                plPair = [names[pair[0]], names[pair[1]]];
                plV = lineRms[hp];
                this._missingPhase = [0, 1, 2].find(i => !pair.includes(i));
            }
        }
        this._liveIdx = liveIdx;

        // ── 判定结果去抖：极数/绕组 与 缺相 各自独立计数（连续 4 帧一致才采用）──
        //   合并成一个 key 时，只要缺相标志在阈值附近翻转就会把计数器清零，
        //   极数永远无法采纳（曾导致电机不转、无磁场）。
        if (this._candPoles === poles && this._candGroup === groupKey) {
            this._candN = (this._candN || 0) + 1;
        } else {
            this._candPoles = poles; this._candGroup = groupKey; this._candN = 1;
        }
        if (this._candPhase === phaseLoss) {
            this._candPN = (this._candPN || 0) + 1;
        } else {
            this._candPhase = phaseLoss; this._candPN = 1;
        }

        if (this._candN >= 4) {
            this._stablePoles = poles;
            this._stableGroup = groupKey;
            this._stableLive = liveIdx.slice();
        } else {
            poles = (this._stablePoles !== undefined) ? this._stablePoles : 0;
            groupKey = (this._stableGroup !== undefined) ? this._stableGroup : null;
            liveIdx = (this._stableLive || []).slice();
        }
        if (this._candPN >= 4) {
            this._stablePhase = phaseLoss;
            this._stablePair = plPair ? plPair.slice() : null;
            this._stablePlV = plV;
        } else {
            phaseLoss = !!this._stablePhase;
            plPair = this._stablePair || null;
            plV = this._stablePlV || 0;
        }

        // 绕组激活状态：判定稳定后才更新并锁存。
        // 缺相期间保持原激活绕组（不随波动改变）→ 绕组着色不闪烁。
        if (this._candN >= 4) {
            if (poles > 0 && groupKey) this._activeWinding = groupKey;   // '4' / '8' / '16'
            else if (poles === 0) this._activeWinding = null;
        }

        // ── 抱闸检测：制动器（ZDQ）失电 → 抱闸 → 堵转 ──
        const brakeComp = this.sys?.comps?.[this.brakeId || 'zdq'];
        const brakeReleased = brakeComp?.deviceRef ? !!brakeComp.deviceRef.isPickup() : true;
        const braked = !brakeReleased;

        // ── 有效负荷率 ──
        //  缺相起动 → 300%（与设定无关）；运行中缺相 → 设定 ×3；抱闸堵转 → 500%
        const running = Math.abs(this._omega_m) > 5;
        let effLoad;
        if (braked) effLoad = 500;
        else if (phaseLoss) effLoad = running ? (this.loadRate * 3) : 300;
        else effLoad = this.loadRate;
        this.effLoadRate = effLoad;

        // ── 由有效负荷率反推注入电阻 ──
        //  三相齐全：Δ 接法三支路，R = √3·V_line / I_line
        //  缺相    ：只在剩余两相之间注入单相等效电阻，R = V_line(该两相) / I_line
        const L = Math.max(0, effLoad);
        const kI = (L <= 100) ? (0.30 + 0.70 * L / 100) : (L / 100);
        const Iline = Math.max(0.001, this.ratedCurrent * kI);
        this.lineCurrent = Iline;

        if (phaseLoss && Array.isArray(plPair) && plPair.length === 2) {
            // 缺相：在剩余两相之间单相注入（线电压取该两相之间的实测 RMS）
            const vPair = plV > 50 ? plV : this.ratedLineVoltage;
            this._dynBranchR = vPair / Iline;                 // I_line = V_line / R
            this._plPair = plPair.slice();
        } else {
            const vLine = (lineRms[0] + lineRms[1] + lineRms[2]) / 3;
            const vRef = vLine > 50 ? vLine : this.ratedLineVoltage;
            this._dynBranchR = Math.sqrt(3) * vRef / Iline;   // Δ 接法：I_line = √3·V_line / R
            this._plPair = null;
        }

        // ── 相序检测（3 帧滞回；缺相时锁存方向，不更新）──
        if (groupKey && !phaseLoss) {
            const [Va, Vb, Vc] = raw[groupKey];
            const seq = Va * (this._vPrev.b - this._vPrev.c)
                      + Vb * (this._vPrev.c - this._vPrev.a)
                      + Vc * (this._vPrev.a - this._vPrev.b);
            const det = seq >= 0 ? 1 : -1;
            const cur = this._seqVotes > 0 ? 1 : this._seqVotes < 0 ? -1 : 0;
            if (cur === 0 || cur === det) {
                this._seqVotes += det;
                if (cur === 0) this._seqVotes = det;
            } else {
                this._seqVotes = 0;
            }
            if (Math.abs(this._seqVotes) >= 3) this._seq = this._seqVotes > 0 ? 1 : -1;
            this._vPrev = { a: Va, b: Vb, c: Vc };
        } else {
            this._seqVotes = 0;
            this._vPrev = { a: 0, b: 0, c: 0 };
        }

        // ── 机械状态（同步速 / 转速 / 转角）──
        const freq = this.sys?.voltageSolver?._systemFreq || this._freq || 50;
        if (poles > 0) {
            this._polePairs  = poles / 2;
            this._omega_sync = (2 * Math.PI * freq / this._polePairs) * this._seq;

            if (braked) {
                // 抱闸堵转：起动时立即堵转；运行中 0.3s 内线性降到 0
                if (!this._brkStall) { this._brkStall = true; this._brkT = 0; this._brkW0 = this._omega_m; }
                this._brkT += dt;
                this._omega_m = (this._brkT >= 0.3) ? 0 : this._brkW0 * Math.max(0, 1 - this._brkT / 0.3);
            } else {
                this._brkStall = false;
                if (phaseLoss) {
                    // 缺相：脉动磁场不产生起动转矩 → 不能起转；运行中逐渐停转
                    if (Math.abs(this._omega_m) < 5) this._omega_m = 0;
                    else this._omega_m -= this._omega_m * Math.min(1, dt / 1.0);
                } else {
                    const target = this._omega_sync * 0.96;   // 约 4% 转差
                    const k = Math.min(1, dt / 0.8);           // 一阶惯性，时间常数 ≈0.8s
                    this._omega_m += (target - this._omega_m) * k;
                }
            }

            this.slip = Math.abs(this._omega_sync) > 1e-6
                ? (this._omega_sync - this._omega_m) / this._omega_sync : 1;
            // 旋转磁场以同步速旋转（缺相时为脉动磁场，不旋转，见 _updateField）
            if (!phaseLoss) {
                this._fieldAngle = (this._fieldAngle + this._omega_sync * VIS_SCALE * dt) % (2 * Math.PI);
            }
        } else {
            this._brkStall = false;
            this._omega_sync = 0;
            // 失电：自由滑行
            this._omega_m -= this._omega_m * Math.min(1, dt / 3.0);
            if (Math.abs(this._omega_m) < 0.5) this._omega_m = 0;
        }
        this._poles = poles;
        this._phaseLost = phaseLoss;
        this._braked = braked;
        this._theta_m += this._omega_m * dt;            // 真实机械转角（物理量）
        this._visTheta += this._omega_m * VIS_SCALE * dt; // 视觉转角（与磁场同一减速比）
        this.rpm = this._omega_m * 60 / (2 * Math.PI);

        // ── 视觉更新（绕组着色只跟锁存的激活绕组，缺相时保持不变）──
        this._updateWindings(this._activeWinding);
        this._updateField(poles, phaseLoss, dt);

        this._rotorGroup.rotation((this._visTheta * 180 / Math.PI) % 360);
    }

    /** 绕组激活着色：'4' 极点亮内圈；'8'/'16' 极点亮相外圈；null 全灰
     *  （用锁存的激活绕组而非每帧极数，避免缺相/波动时闪烁） */
    _updateWindings(winding) {
        const innerActive = (winding === '4');
        const outerActive = (winding === '8' || winding === '16');

        if (this._visInner !== innerActive) {
            this._visInner = innerActive;
            this._slotNodes.forEach((node, i) => {
                node.fill(innerActive ? PHASE_COLORS[i % 3] : SLOT_GRAY);
            });
        }
        if (this._visOuter !== outerActive) {
            this._visOuter = outerActive;
            this._outerCoilNodes.forEach((node, i) => {
                node.fill(outerActive ? PHASE_COLORS[i % 3] : SLOT_GRAY);
            });
        }
    }

    _updateField(poles, phaseLoss = false, dt = 1 / 20) {
        if (this._visPoles !== poles) {
            this._visPoles = poles;
            this._rebuildField(poles);
            this._fieldGroup.visible(poles > 0);
        }
        if (poles <= 0) return;

        if (phaseLoss) {
            // 缺相 → 脉动磁场：不旋转，幅值约 3Hz 周期性明暗脉动
            this._fieldPulse = (this._fieldPulse || 0) + dt * 2 * Math.PI * 3;
            if (this._fieldPulse > 1e6) this._fieldPulse = 0;
            this._fieldGroup.opacity(0.15 + 0.85 * (0.5 + 0.5 * Math.sin(this._fieldPulse)));
        } else {
            this._fieldPulse = 0;
            this._fieldGroup.opacity(1);
            this._fieldGroup.rotation(this._fieldAngle * 180 / Math.PI);
        }
    }

    /** 当前实际负荷率（%）：正常=设定值；缺相 300% 或 设定×3；抱闸堵转 500% */
    getEffLoadRate() { return this.effLoadRate !== undefined ? this.effLoadRate : this.loadRate; }

    /** 是否处于缺相状态 */
    isPhaseLost() { return !!this._phaseLost; }

    /** 是否处于抱闸（ZDQ 失电）状态 */
    isBraked() { return !!this._braked; }

    tick(dt) {
        this._updateDynamic(dt || (1 / 20));
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 工作流定位支持
    // ═══════════════════════════════════════════

    getClickablePartCenter(partId) {
        let pt = { x: this._cx, y: this._cy };
        if (this._tp && this._tp[partId]) pt = this._tp[partId];
        else if (partId === 'inner') pt = { x: this._cx, y: this._cy };
        else if (partId === 'outer') pt = { x: this._cx, y: this._cy - this._outerR1 };

        const abs = this.group.getAbsoluteTransform().point({ x: pt.x, y: pt.y });
        return { x: abs.x, y: abs.y };
    }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称',            key: 'label',        type: 'text'   },
            { label: '额定电流 (A)',         key: 'ratedCurrent', type: 'number' },
            { label: '负荷率 (%)',           key: 'loadRate',     type: 'number' },
            { label: '额定线电压 (V)',       key: 'ratedLineVoltage', type: 'number' },
            { label: '制动器 id (抱闸检测)', key: 'brakeId',     type: 'text'   },
            { label: '转动惯量 J (kg·m²)',   key: 'J',            type: 'number' },
            { label: '粘滞系数 B (N·m·s)',   key: 'B',            type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.loadRate !== undefined) this.loadRate = parseFloat(cfg.loadRate);
        if (cfg.ratedLineVoltage !== undefined) this.ratedLineVoltage = parseFloat(cfg.ratedLineVoltage);
        if (cfg.brakeId !== undefined) this.brakeId = cfg.brakeId;
        if (cfg.J !== undefined) this.J = parseFloat(cfg.J);
        if (cfg.B !== undefined) this.B = parseFloat(cfg.B);

        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._visInner = this._visOuter = this._visPoles = null;
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;
    `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
        };

        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));

        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    destroy() { super.destroy?.(); }
}
