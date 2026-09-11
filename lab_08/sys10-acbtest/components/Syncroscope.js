import { BaseComponent } from './BaseComponent.js';

/**
 * 船舶数字同步表（Digital Synchronoscope）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  同步表用于并联前检查待并发电机与已运行汇流排的电压相位关系，
 *  是船舶电站并车操作的核心指示仪表。
 *  本组件为数字式：面板上 24 个 LED 组成一个圆环，
 *  点亮位置指示当前待并机与汇流排 A 相电压的相位差：
 *    - 12 点钟方向  → 相位差 0°（同相，可并列）
 *    - 6  点钟方向  → 相位差 180°
 *  相位差随频差随时间线性变化，使点亮 LED 沿圆环转动：
 *    - 待并机频率 > 汇流排频率 → 相位差增大 → 顺时针旋转
 *    - 待并机频率 < 汇流排频率 → 相位差减小 → 逆时针旋转
 *    - 频差越大转动越快（频差 0.5Hz ≈ 2 秒一圈）
 *  中央数字区实时显示频差 Δf 与相位差 Δφ；准同步时（频差、相位差
 *  均在允许范围）顶部 LED 变绿指示"可合闸"。
 *
 * ═══ 相位/频率测量 ════════════════════════════════════════════════════
 *  两个 A 相端口（bus / gen）与接地端（gnd）均不参与电路计算（纯测量，
 *  高阻抗，无 MNA stamp），仅从求解结果读取节点电压。
 *  每帧采样 bus、gen 相对 gnd 的瞬时电压，做带线性插值的上升沿过零
 *  检测：相邻过零间隔给出频率，最近过零时刻给出相位，
 *  相位差 = φgen − φbus（弧度，归一化到 [0, 2π)）。
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  bus — 上端，汇流排 A 相
 *  gen — 左端，待并发电机 A 相
 *  gnd — 下端，接地（求解器并入 gnd 簇，作为电压参考）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  id : 组件名称
 */
export class Syncroscope extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 240);
        this.height = Math.max(240, config.height || 280);

        this.type  = 'syncroscope';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id };

        this.addPort(this._portBus.x, this._portBus.y, 'bus', 'wire', 'p');
        this.addPort(this._portGen.x, this._portGen.y, 'gen', 'wire', 'p');
        this.addPort(this._portGnd.x, this._portGnd.y, 'gnd', 'wire');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W / 2;
        this._cy = H * 0.52;
        this._R  = Math.min(W * 0.46, H * 0.44);
        this._ledRingR = this._R - 16;
        this._ledR = Math.max(5, Math.min(8, this._ledRingR * 0.11));
        this._portBus = { x: this._cx/2, y: 3 };
        this._portGen = { x: 3, y: this._cy/2 };
        this._portGnd = { x: this._cx/2, y: H - 3 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this._fBus      = 50;          // 汇流排频率 Hz（直读母线在网发电机）
        this._fGen      = 50;          // 待并机频率 Hz（直读待并发电机）
        this._phaseDiff = 0;           // 相位差 φgen−φbus（rad，[0,2π)，按频率差×真实时间积分）
        this._activeLED = 0;           // 当前点亮的 LED 索引（0=12点，顺时针）
        this._inSync    = false;       // 是否处于准同步
        this._hasVolt   = false;       // 是否有有效测量电压
        this._parallel  = false;       // 是否已并联（主开关合闸，两端口同一导电簇）
        this._off       = false;       // 选择开关 OFF 档：无待并机接入，同步表关闭
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
        const { _cx: cx, _cy: cy, _R: R, _ledRingR: ringR } = this;
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
            x: 0, y: 10, width: W,
            text: '同步表', fontSize: 13, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#1a252f', align: 'center',
        }));

        // 表盘外圈（旋钮/按钮底座同款配色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 3,
            fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1,
        }));

        // 表盘面（浅色，与发电机面板底色一致）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fill: '#dfe7ee', stroke: '#5a6a75', strokeWidth: 1,
        }));

        // LED 定位环
        this._drawRing(cx, cy, ringR, 'rgba(90,100,115,0.45)', 1);

        // 12点 / 6点 主刻度线（相位差 0°/180°）
        [-90, 90].forEach(deg => {
            const a = deg * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + (R - 4) * Math.cos(a), cy + (R - 4) * Math.sin(a),
                    cx + (ringR + 14) * Math.cos(a), cy + (ringR + 14) * Math.sin(a),
                ],
                stroke: '#e74c3c', strokeWidth: 2, lineCap: 'round',
            }));
        });

        // 刻度文字
        const fs = Math.max(10, R * 0.09);
        this._staticGroup.add(new Konva.Text({
            x: cx - fs * 1.4, y: cy - R + 6,
            text: '0°', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#1a252f', width: fs * 2.8, align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - fs * 1.6, y: cy + R - fs - 2,
            text: '180°', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#1a252f', width: fs * 3.2, align: 'center',
        }));

        // 快 / 慢 方向标记（快 = 顺时针，待并机高于母线频率）
        const fs2 = Math.max(13, R * 0.11);
        this._staticGroup.add(new Konva.Text({
            x: cx + ringR/2 + 30, y: cy/2 - 30,
            text: '快', fontSize: fs2, fontFamily: 'Arial',
            fill: '#e74c3c', width: fs2, align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - ringR/2 - 40, y: cy/2 - 30,
            text: '慢', fontSize: fs2, fontFamily: 'Arial',
            fill: '#1565c0', width: fs2, align: 'center', fontStyle: 'bold',
        }));

        // 中心 LCD 信息区（黑底，与发电机面板 LCD 同款）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.42,
            fill: '#0a0e12', stroke: '#3a4a55', strokeWidth: 1,
        }));
        const titleFs = Math.max(13, R * 0.11);
        this._staticGroup.add(new Konva.Text({
            x: cx - R * 0.40, y: cy - R * 0.42 + 4,
            text: '同步表', fontSize: titleFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#f4d744', width: R * 0.80, align: 'center',
        }));

        // 端口引线（虚线，从表盘边缘引出到组件边缘端口）
        this._drawPortLead(cx, cy - R, this._portBus.x, this._portBus.y, '#5a6a75');
        this._drawPortLead(cx - R, cy, this._portGen.x, this._portGen.y, '#5a6a75');
        this._drawPortLead(cx, cy + R, this._portGnd.x, this._portGnd.y, '#8a93a2');

        // 端口标签
        const lFs = Math.max(10, W * 0.035);
        this._staticGroup.add(new Konva.Text({
            x: cx/2 -20, y: cy - R -20,
            text: '汇流排A', fontSize: lFs, fontFamily: 'Arial', fill: '#5a6a75',fontStyle:'bold'
        }));
        this._staticGroup.add(new Konva.Text({
            x: 4, y: cy/2 ,
            text: '待并机A', fontSize: lFs, fontFamily: 'Arial', fill: '#5a6a75',fontStyle:'bold'
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx + 6, y: cy + R + 6,
            text: 'GND', fontSize: lFs, fontFamily: 'Arial', fontStyle: 'bold', fill: '#8a93a2',
        }));
    }

    _drawRing(cx, cy, r, stroke, sw) {
        const steps = 64;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * 2 * Math.PI;
            pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke, strokeWidth: sw, listening: false,
        }));
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
        const { _cx: cx, _cy: cy, _ledRingR: ringR, _ledR: ledR } = this;

        // 24 个 LED 组成圆环，索引 0 在 12 点方向，顺时针递增（每 15°）
        this._leds = [];
        for (let i = 0; i < 24; i++) {
            const a = (-90 + i * 15) * Math.PI / 180;
            const led = new Konva.Circle({
                x: cx + ringR * Math.cos(a),
                y: cy + ringR * Math.sin(a),
                radius: ledR,
                fill: '#c9d2db',
                stroke: '#8a97a3', strokeWidth: 1,
                perfectDrawEnabled: false,
                listening: false,
            });
            this._dynamicGroup.add(led);
            this._leds.push(led);
        }

        const fs = Math.max(11, this._R * 0.095);
        this._deltaText = new Konva.Text({
            x: cx - this._R * 0.40, y: cy + 6,
            text: 'Δf 0.00Hz', fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff88', width: this._R * 0.80, align: 'center',
        });
        this._dynamicGroup.add(this._deltaText);

        this._phaseText = new Konva.Text({
            x: cx - this._R * 0.40, y: cy + fs + 12,
            text: 'Δφ 0°', fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#7dd3ff', width: this._R * 0.80, align: 'center',
        });
        this._dynamicGroup.add(this._phaseText);
    }

    // ═══════════════════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const sv = this.sys && this.sys.voltageSolver;
        if (sv) {
            const cBus = sv.portToCluster.get(`${this.id}_wire_bus`);
            const cGen = sv.portToCluster.get(`${this.id}_wire_gen`);
            const cGnd = sv.portToCluster.get(`${this.id}_wire_gnd`);
            if (cBus !== undefined && cGen !== undefined) {
                // ── 频率直接读取：按端口簇匹配在网发电机的实际输出频率。
                //    旋钮调速即时反映（真实时间尺度），不受仿真慢放 / 过零多周期延迟影响。
                const src = this._readSourceFreq(sv, cBus, cGen);
                // 选择开关 OFF 档（无待并机接入）或待并机停机时，同步表关闭
                this._off = src.fGen === null;
                if (src.fBus !== null) this._fBus = src.fBus;
                if (src.fGen !== null) this._fGen = src.fGen;
                // 并联检测：主开关合闸后待并发电机进入并联运行（_peers 非空）。
                // 注意：ACB 主触头以电阻桥接实现，两端口簇不会合并，故用发电机自身并联状态判定。
                const genComp = src.genComp;
                this._parallel = !!(genComp && Array.isArray(genComp._peers) && genComp._peers.length > 0);

                // 有效电压幅度阈值（抑制未建压时的噪声触发）
                const vG  = cGnd !== undefined ? (sv.nodeVoltages.get(cGnd) || 0) : 0;
                const vB  = (sv.nodeVoltages.get(cBus) || 0) - vG;
                const vGt = (sv.nodeVoltages.get(cGen) || 0) - vG;
                this._hasVolt = Math.max(Math.abs(vB), Math.abs(vGt)) > 5;
            }
        }

        const dF = this._fGen - this._fBus;
        if (this._off) {
            // 选择开关 OFF 档：同步表关闭，LED 全部熄灭、无相位计算
            this._parallel  = false;
            this._hasVolt   = false;
            this._inSync    = false;
            this._phaseDiff = 0;
            this._activeLED = -1;
        } else if (this._parallel) {
            // 已并联：两台机并入同一母线，电气上同相，相位差锁定为 0，LED 停止转动
            this._phaseDiff = 0;
            this._activeLED = 0;
        } else if (this._hasVolt) {
            // ── 相位差：按频率差 × 真实时间步长积分（与调速旋钮同尺度）。
            //    差频 1Hz → LED 每秒转过一圈（真实时间），不受仿真时间慢放限制。
            const step = (dt || 0.05);
            const ph = this._phaseDiff + 2 * Math.PI * dF * step;
            this._phaseDiff = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            this._activeLED = Math.round(this._phaseDiff / (2 * Math.PI) * 24) % 24;
        }

        // 准同步判定：频差 |Δf|<0.1Hz 且相位差接近 0°
        const deg = this._phaseDiff * 180 / Math.PI;
        this._inSync = !this._off
            && this._hasVolt
            && Math.abs(dF) < 0.1
            && (deg < 8 || deg > 352);

        this._updateLEDs();
        this._updateTexts(dF, deg);
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /**
     * 从端口簇匹配在网同步发电机的实际输出频率（_freqOut），
     * 返回 { fBus, fGen }；无匹配时为 null。
     */
    _readSourceFreq(sv, cBus, cGen) {
        let fBus = null, fGen = null, genComp = null;
        for (const id in this.sys.comps) {
            const c = this.sys.comps[id];
            if (!c || c.type !== 'source_3p' || !c.isOn) continue;
            const cU = sv.portToCluster.get(`${id}_wire_u`);
            if (cU === undefined) continue;
            const f = c._freqOut ?? c.freq;
            if (f === undefined || f === null) continue;
            // 待并机：与待并机端口的 u 端口同簇
            if (cU === cGen) {
                if (fGen === null) { fGen = f; genComp = c; }
            }
            // 母线源：直接接母线，或经闭合主开关（ACB）桥接接入母线
            if (fBus === null && this._isOnBus(sv, cU, cBus)) fBus = f;
        }
        return { fBus, fGen, genComp };
    }

    /**
     * 判断发电机 u 端口簇是否与母线簇电气连通。
     * 母线端口与母线同簇；发电机经主开关（ACB）合闸时，t1 侧与电源同簇、l1 侧与母线同簇，
     * 故闭合 ACB 即为桥接。等效电阻模型（isPortConnected）不含 ACB 建模，故此处直接按开关状态判定。
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
    // 视觉更新（in-place）
    // ═══════════════════════════════════════════════════════

    _updateLEDs() {
        const active = this._activeLED;
        for (let i = 0; i < 24; i++) {
            const led = this._leds[i];
            if (this._off) {
                // 关闭状态：无点亮灯，但灯仍保持可见
                led.fill('#c9d2db');
                led.opacity(0.5);
            } else if (this._inSync && i === 0) {
                led.fill('#2cff6a');
                led.opacity(1);
            } else if (i === active) {
                led.fill(this._hasVolt ? '#ff3020' : '#c9a94a');
                led.opacity(1);
            } else {
                led.fill('#c9d2db');
                led.opacity(0.5);
            }
        }
    }

    _updateTexts(dF, deg) {
        if (this._off) {
            this._deltaText.text('OFF');
            this._deltaText.fill('#5a6a75');
            this._phaseText.text('--');
            this._phaseText.fill('#5a6a75');
            return;
        }
        this._deltaText.text(`${dF >= 0 ? '+' : ''}${dF.toFixed(2)}Hz`);
        this._deltaText.fill(this._inSync ? '#2cff6a' : '#00ff88');
        this._phaseText.text(`Δφ ${Math.round(deg)}°`);
        this._phaseText.fill(this._inSync ? '#2cff6a' : '#7dd3ff');
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '组件名称 (ID)', key: 'id', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        this.config = { ...this.config, ...cfg };
    }
}
