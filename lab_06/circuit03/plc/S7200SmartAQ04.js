import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-200 SMART 模拟量输出模块 AQ04 仿真组件
 *
 * ── 硬件规格 ─────────────────────────────────────────────────────
 *
 *  订货号：6ES7 288-3AQ04-0AA0
 *
 *  模拟量输出：
 *    - 4 路模拟量输出（AQ0 ~ AQ3）
 *    - 电压输出：±10V（12位分辨率，满量程 27648 / -27648）
 *    - 电流输出：0~20mA 或 4~20mA（12位，满量程 27648）
 *    - 建立时间：≤0.1ms（电压），≤2ms（电流）
 *    - 负载阻抗：电压≥1kΩ，电流≤500Ω
 *    - 输出精度：±0.5%（额定值）
 *
 *  电源：
 *    - 模块供电：来自 CPU 扩展总线（5V DC，最大 40mA）
 *    - 传感器电源：无（纯输出模块）
 *    - 外部24V DC：否（仅通过总线）
 *
 *  通信接口（仿真）：
 *    - S7-200 SMART 扩展总线连接器（右侧公头/左侧母头）
 *    - 地址映射：AQW0 ~ AQW6（4路 × 2字节 = 8字节）
 *    - CPU 梯形图通过 MOV_W 指令写入 AQWx 完成输出
 *
 *  外部接线（端子排，每路 3 针）：
 *    AQ0: M(0V) / V(电压) / I(电流)
 *    AQ1: M(0V) / V(电压) / I(电流)
 *    AQ2: M(0V) / V(电压) / I(电流)
 *    AQ3: M(0V) / V(电压) / I(电流)
 *
 * ── 与 ST20 通信机制（仿真） ─────────────────────────────────────
 *
 *  连接：
 *    AQ04 实例调用 connectToCPU(cpuInstance) 完成绑定。
 *    绑定后 AQ04 在每个 tick 从 CPU 的 AQW 存储区读取输出值。
 *
 *  数据流：
 *    CPU ST20 梯形图执行 MOV_W VW100, AQW0
 *    → AQ04 tick 读取 cpu._AQW[0..1]（16位有符号整数）
 *    → 转换为工程值（电压 / 电流）
 *    → 更新面板显示 + 驱动输出端口电气值
 *
 *  AQW 存储区（扩展到 ST20 的 _AQW 数组，由本模块初始化）：
 *    AQW0 → 通道 0（字节 0~1）
 *    AQW2 → 通道 1（字节 2~3）
 *    AQW4 → 通道 2（字节 4~5）
 *    AQW6 → 通道 3（字节 6~7）
 *    范围 -27648 ~ +27648（电压），0 ~ 27648（电流）
 *
 * ── 端口 ────────────────────────────────────────────────────────
 *  BUS_L  — 左侧扩展总线母头（连接 CPU 或上一扩展模块）
 *  BUS_R  — 右侧扩展总线公头（连接下一扩展模块）
 *  AQ0_V / AQ0_I / AQ0_M — 通道 0 电压 / 电流 / 公共端
 *  AQ1_V / AQ1_I / AQ1_M — 通道 1
 *  AQ2_V / AQ2_I / AQ2_M — 通道 2
 *  AQ3_V / AQ3_I / AQ3_M — 通道 3
 *
 * ── 可配置参数 ────────────────────────────────────────────────────
 *  label           : 位号（默认 'AQ1'）
 *  chModes         : 4路模式数组，每项 'V±10'|'I0-20'|'I4-20'（默认全'V±10'）
 *  slotAddress     : 模块槽位（默认 0，决定 AQW 起始字节偏移）
 */
export class S7200SmartAQ04 extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(120, config.width  || 160);
        this.height = Math.max(280, config.height || 360);

        this.type    = 's7200_smart_aq04';
        this.special = 'expansion';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:       this.label,
            chModes:     [...this._chModes],
            slotAddress: this._slotAddr,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 机身
        this._body = { x: 0, y: 0, w: W, h: H, rx: 3 };

        // 顶部蓝色标志带
        this._topBar = { x: 0, y: 0, w: W, h: H * 0.09 };

        // 扩展总线连接器（左侧母头）
        this._busLeft  = { x: -6, y: H * 0.15, w: 8, h: H * 0.22 };

        // 扩展总线连接器（右侧公头）
        this._busRight = { x: W - 2, y: H * 0.15, w: 8, h: H * 0.22 };

        // 状态 LED（顶部，纵向排列）
        this._statusLEDs = {
            diag: { x: W * 0.18, y: H * 0.115, r: H * 0.016 },  // DIAG（红/绿）
            sf:   { x: W * 0.38, y: H * 0.115, r: H * 0.016 },  // SF（红）
        };

        // 通道显示区（4个等高区块）
        const chAreaY = H * 0.175;
        const chH     = H * 0.155;
        const chGap   = H * 0.010;
        this._channels = Array.from({ length: 4 }, (_, i) => ({
            x: W * 0.04,
            y: chAreaY + i * (chH + chGap),
            w: W * 0.92,
            h: chH,
            idx: i,
        }));

        // 通道内 - 仪表盘区域（左侧）
        this._channels.forEach(ch => {
            ch.gauge = {
                x: ch.x + ch.w * 0.04,
                y: ch.y + ch.h * 0.12,
                w: ch.w * 0.55,
                h: ch.h * 0.76,
            };
            // 数值显示区（右侧）
            ch.display = {
                x: ch.x + ch.w * 0.62,
                y: ch.y + ch.h * 0.10,
                w: ch.w * 0.34,
                h: ch.h * 0.80,
            };
        });

        // 端子排（底部）
        this._terminals = {
            x: W * 0.03,
            y: H * 0.825,
            w: W * 0.94,
            h: H * 0.09,
        };

        // 铭牌
        this._nameplate = { x: W * 0.04, y: H * 0.922, w: W * 0.92, h: H * 0.058 };

        // DIN 导轨
        this._dinRail = { x: 0, y: H * 0.980, w: W, h: H * 0.020 };

        // 端口坐标
        this._portPos = {
            BUS_L: { x: -8, y: H * 0.26 },
            BUS_R: { x: W + 8, y: H * 0.26 },
        };
        for (let i = 0; i < 4; i++) {
            const baseX = W * (0.12 + i * 0.215);
            this._portPos[`AQ${i}_M`] = { x: baseX,           y: H };
            this._portPos[`AQ${i}_V`] = { x: baseX + W*0.06,  y: H };
            this._portPos[`AQ${i}_I`] = { x: baseX + W*0.12,  y: H };
        }
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label     = config.label       || 'AQ1';
        this._slotAddr = config.slotAddress !== undefined ? config.slotAddress : 0;

        // 4路模式：'V±10' | 'I0-20' | 'I4-20'
        this._chModes  = config.chModes
            ? [...config.chModes]
            : ['V±10', 'V±10', 'V±10', 'V±10'];

        // 数字值（AQW，范围 -27648 ~ 27648）
        this._rawValues = new Int16Array(4);  // 4路原始整数值

        // 工程值（转换后）
        this._engValues = new Float64Array(4);

        // 连接的 CPU 实例
        this._cpu = null;

        // 通信状态
        this._busConnected  = false;
        this._lastUpdate    = 0;   // 最后收到数据的时间戳（用于超时检测）
        this._commTimeout   = false;

        // 动画状态（仪表盘指针平滑）
        this._gaugeAngle    = new Float64Array(4);  // 当前指针角度（弧度）
        this._gaugeTarget   = new Float64Array(4);  // 目标角度
    }

    // ═══════════════════════════════════════════════════════
    // 与 CPU 连接 API
    // ═══════════════════════════════════════════════════════

    /**
     * 连接到 CPU ST20 实例
     * @param {S7200SmartST20} cpu  CPU 组件实例
     *
     * 调用后：
     *  1. 在 CPU 上挂载 _AQW（Uint8Array[8]）存储区（若不存在）
     *  2. 将本模块注册进 cpu._expansionModules 列表
     *  3. 标记总线已连接
     */
    connectToCPU(cpu) {
        if (!cpu) return;
        this._cpu = cpu;

        // 为 CPU 挂载 AQW 存储区（8字节，覆盖4路 × Word）
        if (!cpu._AQW) {
            cpu._AQW = new Uint8Array(64);  // 最多支持8个模块 × 4路 × 2字节
        }

        // 注册自身到 CPU 扩展模块列表
        if (!cpu._expansionModules) {
            cpu._expansionModules = [];
        }
        // 防止重复注册
        const alreadyRegistered = cpu._expansionModules.find(m => m === this);
        if (!alreadyRegistered) {
            cpu._expansionModules.push(this);
        }

        this._busConnected = true;
        this._commTimeout  = false;

        // 扩展 CPU 的 _writeWord 支持 AQW 地址
        this._patchCPUWriteWord(cpu);

        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    /**
     * 断开与 CPU 的连接
     */
    disconnectFromCPU() {
        if (this._cpu && this._cpu._expansionModules) {
            const idx = this._cpu._expansionModules.indexOf(this);
            if (idx >= 0) this._cpu._expansionModules.splice(idx, 1);
        }
        this._cpu = null;
        this._busConnected = false;
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    /**
     * 为 CPU 实例 patch _writeWord 方法，使其支持 AQWx 地址
     * 原始方法保存为 _writeWordOrig，补丁方法先检查 AQW 前缀，
     * 若匹配则写入 _AQW 存储区，否则调用原始方法。
     */
    _patchCPUWriteWord(cpu) {
        if (cpu._aqWritePatched) return;  // 只 patch 一次
        cpu._aqWritePatched = true;

        const origWriteWord = cpu._writeWord.bind(cpu);
        cpu._writeWord = function(addr, val) {
            const m = addr.match(/^AQW(\d+)$/i);
            if (m) {
                const byteOffset = parseInt(m[1]);
                val = Math.max(-32768, Math.min(32767, Math.round(val)));
                const u = val < 0 ? val + 65536 : val;
                if (cpu._AQW && byteOffset + 1 < cpu._AQW.length) {
                    cpu._AQW[byteOffset]     = (u >> 8) & 0xFF;
                    cpu._AQW[byteOffset + 1] = u & 0xFF;
                }
                return;
            }
            origWriteWord(addr, val);
        };

        // 同样 patch _readWord，支持读回 AQW
        const origReadWord = cpu._readWord.bind(cpu);
        cpu._readWord = function(addr) {
            const m = addr.match(/^AQW(\d+)$/i);
            if (m) {
                const byteOffset = parseInt(m[1]);
                if (cpu._AQW && byteOffset + 1 < cpu._AQW.length) {
                    const raw = (cpu._AQW[byteOffset] << 8) | cpu._AQW[byteOffset + 1];
                    return raw > 32767 ? raw - 65536 : raw;
                }
                return 0;
            }
            return origReadWord(addr);
        };
    }

    // ═══════════════════════════════════════════════════════
    // 数值转换
    // ═══════════════════════════════════════════════════════

    /**
     * 将 AQW 原始值（-27648 ~ 27648）转换为工程值
     * @param {number} raw   整数原始值
     * @param {string} mode  'V±10' | 'I0-20' | 'I4-20'
     * @returns {number}     工程值（V 或 mA）
     */
    _rawToEng(raw, mode) {
        const clamped = Math.max(-27648, Math.min(27648, raw));
        switch (mode) {
            case 'V±10':
                // -27648 → -10V,  +27648 → +10V
                return (clamped / 27648) * 10.0;
            case 'I0-20':
                // 0 → 0mA,  27648 → 20mA
                return Math.max(0, (clamped / 27648) * 20.0);
            case 'I4-20':
                // 0 → 4mA,  27648 → 20mA
                return 4.0 + Math.max(0, (clamped / 27648) * 16.0);
            default:
                return 0;
        }
    }

    /**
     * 工程值 → 百分比（0~1，用于仪表盘指针）
     */
    _engToPercent(eng, mode) {
        switch (mode) {
            case 'V±10':  return (eng + 10) / 20;    // -10V=0, +10V=1
            case 'I0-20': return eng / 20;            // 0mA=0, 20mA=1
            case 'I4-20': return (eng - 4) / 16;     // 4mA=0, 20mA=1
            default:      return 0;
        }
    }

    /**
     * 工程值单位字符串
     */
    _engUnit(mode) {
        return mode.startsWith('V') ? 'V' : 'mA';
    }

    /**
     * 仪表盘满量程标注
     */
    _scaleLabels(mode) {
        switch (mode) {
            case 'V±10':  return ['-10V', '0V',  '+10V'];
            case 'I0-20': return ['0mA', '10mA', '20mA'];
            case 'I4-20': return ['4mA', '12mA', '20mA'];
            default:      return ['', '', ''];
        }
    }

    // ═══════════════════════════════════════════════════════
    // 从 CPU 读取 AQW 数据
    // ═══════════════════════════════════════════════════════

    _pollCPU() {
        if (!this._cpu || !this._cpu._AQW) return;

        const base = this._slotAddr * 8;  // 每个槽位 4路 × 2字节
        for (let i = 0; i < 4; i++) {
            const off = base + i * 2;
            if (off + 1 >= this._cpu._AQW.length) break;
            const hi  = this._cpu._AQW[off];
            const lo  = this._cpu._AQW[off + 1];
            const raw = (hi << 8) | lo;
            this._rawValues[i] = raw > 32767 ? raw - 65536 : raw;
            this._engValues[i] = this._rawToEng(this._rawValues[i], this._chModes[i]);
        }
        this._lastUpdate   = Date.now();
        this._commTimeout  = false;
    }

    // ═══════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════

    _registerPorts() {
        const pp = this._portPos;
        this.addPort(pp.BUS_L.x, pp.BUS_L.y, 'BUS_L', 'bus', 'p');
        this.addPort(pp.BUS_R.x, pp.BUS_R.y, 'BUS_R', 'bus');
        for (let i = 0; i < 4; i++) {
            this.addPort(pp[`AQ${i}_M`].x, pp[`AQ${i}_M`].y, `AQ${i}_M`, 'wire');
            this.addPort(pp[`AQ${i}_V`].x, pp[`AQ${i}_V`].y, `AQ${i}_V`, 'wire');
            this.addPort(pp[`AQ${i}_I`].x, pp[`AQ${i}_I`].y, `AQ${i}_I`, 'wire');
        }
    }

    // ═══════════════════════════════════════════════════════
    // 初始化绘图
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ── 静态部件 ────────────────────────────────────────────

    _drawStaticParts() {
        this._drawBody();
        this._drawTopBar();
        this._drawBusConnectors();
        this._drawChannelFrames();
        this._drawTerminals();
        this._drawNameplate();
        this._drawDINRail();
        this._drawStaticLabels();
    }

    _drawBody() {
        const b = this._body;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#d0d4d8',
            stroke: '#909498', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 6,
            shadowOffsetX: 2, shadowOffsetY: 3,
            shadowOpacity: 0.25,
        }));
        // 左侧高光条
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 4, width: 3, height: b.h - 8,
            fill: 'rgba(255,255,255,0.30)',
            cornerRadius: [b.rx, 0, 0, b.rx],
        }));
    }

    _drawTopBar() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.09,
            fill: '#1a6fa8',
            cornerRadius: [3, 3, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: 5, y: H * 0.012,
            text: 'SIMATIC',
            fontSize: Math.max(6, H * 0.026),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#ffffff',
            letterSpacing: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 5, y: H * 0.048,
            text: 'EM AQ04',
            fontSize: Math.max(5, H * 0.022),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#b8d8f0',
        }));
    }

    _drawBusConnectors() {
        const W = this.width, H = this.height;
        // 左侧总线母头（梯形外壳）
        const bl = this._busLeft;
        this._staticGroup.add(new Konva.Rect({
            x: bl.x, y: bl.y, width: bl.w + 2, height: bl.h,
            fill: '#e8e8e0', stroke: '#888', strokeWidth: 1,
            cornerRadius: [2, 0, 0, 2],
        }));
        // 触点针孔
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: bl.x + 2,
                y: bl.y + bl.h * (0.15 + i * 0.175),
                radius: 1.5,
                fill: '#888',
            }));
        }
        // BUS_L 标签
        this._staticGroup.add(new Konva.Text({
            x: bl.x + 1, y: bl.y + bl.h + 2,
            text: 'BUS', fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Arial', fill: '#666',
        }));

        // 右侧总线公头
        const br = this._busRight;
        this._staticGroup.add(new Konva.Rect({
            x: br.x - 2, y: br.y, width: br.w + 2, height: br.h,
            fill: '#2a2a30', stroke: '#555', strokeWidth: 1,
            cornerRadius: [0, 2, 2, 0],
        }));
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: br.x + br.w - 2,
                y: br.y + br.h * (0.15 + i * 0.175),
                radius: 1.5,
                fill: '#c0c040',  // 金色针脚
            }));
        }
    }

    _drawChannelFrames() {
        this._channels.forEach(ch => {
            // 通道背景框
            this._staticGroup.add(new Konva.Rect({
                x: ch.x, y: ch.y, width: ch.w, height: ch.h,
                fill: '#1a2030',
                stroke: '#3a4a60', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 通道标题（静态）
            this._staticGroup.add(new Konva.Text({
                x: ch.x + 4, y: ch.y + 2,
                text: `AQ${ch.idx}`,
                fontSize: Math.max(7, this.height * 0.028),
                fontFamily: 'Consolas, monospace',
                fontStyle: 'bold',
                fill: '#5090c0',
            }));
        });
    }

    _drawTerminals() {
        const t = this._terminals;
        const W = this.width, H = this.height;

        this._staticGroup.add(new Konva.Rect({
            x: t.x, y: t.y, width: t.w, height: t.h,
            fill: '#2a2a2a', stroke: '#222', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 12 个端子孔（4路 × 3针：M/V/I）
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 3; j++) {
                const tx = t.x + t.w * (0.04 + (i * 3 + j) * 0.082);
                this._staticGroup.add(new Konva.Rect({
                    x: tx, y: t.y + t.h * 0.15,
                    width: t.w * 0.060, height: t.h * 0.70,
                    fill: '#888', stroke: '#666', strokeWidth: 0.5,
                    cornerRadius: 1,
                }));
            }
            // 通道标注（M/V/I）
            const labels = ['M', 'V', 'I'];
            labels.forEach((lbl, j) => {
                const tx = t.x + t.w * (0.025 + (i * 3 + j) * 0.082);
                this._staticGroup.add(new Konva.Text({
                    x: tx, y: t.y - H * 0.022,
                    text: lbl,
                    fontSize: Math.max(5, H * 0.018),
                    fontFamily: 'Arial', fill: '#6080a0',
                }));
            });
        }

        // 通道分隔线
        for (let i = 1; i < 4; i++) {
            const lx = t.x + t.w * (i * 0.25);
            this._staticGroup.add(new Konva.Line({
                points: [lx, t.y + 2, lx, t.y + t.h - 2],
                stroke: '#444', strokeWidth: 0.5,
            }));
        }
    }

    _drawNameplate() {
        const np = this._nameplate;
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fill: '#f0ece0', stroke: '#aaa', strokeWidth: 0.8,
            cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 3, y: np.y + 2,
            text: '6ES7 288-3AQ04-0AA0',
            fontSize: Math.max(4, this.height * 0.016),
            fontFamily: 'Consolas, monospace',
            fill: '#444',
        }));
    }

    _drawDINRail() {
        const dr = this._dinRail;
        this._staticGroup.add(new Konva.Rect({
            x: dr.x, y: dr.y, width: dr.w, height: dr.h,
            fill: '#b0b4b8', stroke: '#888', strokeWidth: 0.5,
            cornerRadius: [0, 0, 3, 3],
        }));
    }

    _drawStaticLabels() {
        const W = this.width, H = this.height;
        // LED 标签
        const ls = this._statusLEDs;
        ['DIAG', 'SF'].forEach((txt, i) => {
            const led = i === 0 ? ls.diag : ls.sf;
            this._staticGroup.add(new Konva.Text({
                x: led.x - 8, y: led.y + led.r + 2,
                text: txt,
                fontSize: Math.max(4, H * 0.016),
                fontFamily: 'Arial', fill: '#666',
            }));
        });
    }

    // ── 动态部件 ────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        this._drawStatusLEDs();
        this._drawBusStatus();
        this._drawChannels();
        this._drawLabelText();
    }

    _drawStatusLEDs() {
        const ls = this._statusLEDs;
        const connected = this._busConnected;
        const error     = this._commTimeout;

        // DIAG LED：绿=正常，红=错误/无连接
        const diagOK  = connected && !error;
        this._dynamicGroup.add(new Konva.Circle({
            x: ls.diag.x, y: ls.diag.y, radius: ls.diag.r,
            fill:   diagOK ? '#44cc44' : (connected ? '#ee4444' : '#333'),
            stroke: '#444', strokeWidth: 0.8,
            shadowColor:   diagOK ? '#44cc44' : 'transparent',
            shadowBlur:    diagOK ? 5 : 0,
            shadowOpacity: 0.9,
        }));

        // SF LED：红=系统错误
        this._dynamicGroup.add(new Konva.Circle({
            x: ls.sf.x, y: ls.sf.y, radius: ls.sf.r,
            fill:   error ? '#ee4444' : '#1a0000',
            stroke: '#444', strokeWidth: 0.8,
            shadowColor:   error ? '#ee4444' : 'transparent',
            shadowBlur:    error ? 5 : 0,
            shadowOpacity: 0.9,
        }));
    }

    _drawBusStatus() {
        const W = this.width, H = this.height;
        // 总线连接状态（总线母头背景颜色指示）
        const color = this._busConnected ? 'rgba(68,204,68,0.18)' : 'rgba(60,60,60,0.30)';
        const bl    = this._busLeft;
        this._dynamicGroup.add(new Konva.Rect({
            x: bl.x, y: bl.y, width: bl.w + 2, height: bl.h,
            fill: color,
            cornerRadius: [2, 0, 0, 2],
        }));

        // 连接线提示（已连接时在总线区域显示细绿线）
        if (this._busConnected) {
            this._dynamicGroup.add(new Konva.Rect({
                x: bl.x, y: bl.y + bl.h / 2 - 1,
                width: bl.w + 4, height: 2,
                fill: '#44cc44',
                opacity: 0.6,
            }));
        }
    }

    _drawChannels() {
        this._channels.forEach(ch => {
            this._drawChannel(ch);
        });
    }

    _drawChannel(ch) {
        const i    = ch.idx;
        const mode = this._chModes[i];
        const raw  = this._rawValues[i];
        const eng  = this._engValues[i];
        const pct  = this._engToPercent(eng, mode);
        const unit = this._engUnit(mode);

        // ── 模式标签 ──────────────────────────
        this._dynamicGroup.add(new Konva.Text({
            x: ch.x + ch.w * 0.55, y: ch.y + 2,
            text: mode,
            fontSize: Math.max(6, this.height * 0.022),
            fontFamily: 'Consolas, monospace',
            fill: '#6090b0',
        }));

        // ── 仪表盘（半圆弧形） ─────────────────
        this._drawGauge(ch.gauge, pct, mode, i);

        // ── 数字显示区 ────────────────────────
        this._drawChannelDisplay(ch.display, raw, eng, unit);
    }

    _drawGauge(g, pct, mode, idx) {
        const cx   = g.x + g.w / 2;
        const cy   = g.y + g.h * 0.85;   // 圆心在底部
        const r    = Math.min(g.w / 2, g.h) * 0.88;
        const rInner = r * 0.55;

        // 弧起止角度：180° ~ 0°（从左到右，下半圆）
        const ANG_START = Math.PI;       // 左 = 最小值
        const ANG_END   = 0;             // 右 = 最大值
        const ANG_RANGE = Math.PI;       // 半圆

        // 刻度背景弧（灰）
        this._dynamicGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: rInner, outerRadius: r,
            angle: 180,
            rotation: 180,
            fill: '#1a2030',
            stroke: '#2a3a50', strokeWidth: 0.5,
        }));

        // 着色弧（按比例，颜色根据值域）
        const clampedPct = Math.max(0, Math.min(1, pct));
        const fillAngle  = clampedPct * 180;
        const fillColor  = this._gaugeColor(pct, mode);

        if (fillAngle > 0.5) {
            this._dynamicGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: rInner + 1, outerRadius: r - 1,
                angle: fillAngle,
                rotation: 180,
                fill: fillColor,
                opacity: 0.85,
            }));
        }

        // 刻度线（每 30°，共6根）
        for (let tick = 0; tick <= 6; tick++) {
            const ang = Math.PI + (tick / 6) * Math.PI;
            const isMajor = tick % 2 === 0;
            const rO = isMajor ? r + 1 : r;
            const rI = isMajor ? rInner - 4 : rInner - 2;
            this._dynamicGroup.add(new Konva.Line({
                points: [
                    cx + Math.cos(ang) * rI, cy + Math.sin(ang) * rI,
                    cx + Math.cos(ang) * rO, cy + Math.sin(ang) * rO,
                ],
                stroke: isMajor ? '#8090a8' : '#50607a',
                strokeWidth: isMajor ? 1 : 0.6,
            }));
        }

        // 指针（平滑动画）
        const targetAng  = Math.PI + clampedPct * Math.PI;
        const dispAng    = this._gaugeAngle[idx];
        const pLen       = rInner * 0.85;
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx - Math.cos(dispAng) * 3, cy - Math.sin(dispAng) * 3,
                cx + Math.cos(dispAng) * pLen, cy + Math.sin(dispAng) * pLen,
            ],
            stroke: '#ffffff',
            strokeWidth: 1.5,
            lineCap: 'round',
        }));

        // 指针轴心
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 3,
            fill: '#cccccc',
            stroke: '#888', strokeWidth: 0.8,
        }));

        // 刻度标注（最小/中/最大）
        const labels = this._scaleLabels(mode);
        const lblPos = [
            { ang: Math.PI,        txt: labels[0] },
            { ang: Math.PI * 1.5,  txt: labels[1] },
            { ang: 0,              txt: labels[2] },
        ];
        lblPos.forEach(({ ang, txt }) => {
            const lx = cx + Math.cos(ang) * (r + 5);
            const ly = cy + Math.sin(ang) * (r + 5);
            this._dynamicGroup.add(new Konva.Text({
                x: lx - 12, y: ly - 5,
                text: txt,
                fontSize: Math.max(4, this.height * 0.014),
                fontFamily: 'Arial', fill: '#6070a0',
                align: 'center', width: 24,
            }));
        });
    }

    /** 根据量程和百分比返回仪表盘颜色 */
    _gaugeColor(pct, mode) {
        if (mode === 'V±10') {
            // 中间0点附近绿色，两端橙色→红色
            const dist = Math.abs(pct - 0.5) * 2;  // 0=中心，1=端点
            if (dist < 0.6) return '#44cc66';
            if (dist < 0.85) return '#f5c842';
            return '#f07040';
        }
        // 电流：绿色（正常），高值变橙
        if (pct < 0.75) return '#44aacc';
        if (pct < 0.92) return '#f5c842';
        return '#f07040';
    }

    _drawChannelDisplay(disp, raw, eng, unit) {
        // 数字显示背景
        this._dynamicGroup.add(new Konva.Rect({
            x: disp.x, y: disp.y,
            width: disp.w, height: disp.h,
            fill: '#0a0e14',
            stroke: '#1a2a3a', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 工程值（大字）
        const engStr = Math.abs(eng) < 10
            ? eng.toFixed(3)
            : eng.toFixed(2);
        this._dynamicGroup.add(new Konva.Text({
            x: disp.x + 2, y: disp.y + disp.h * 0.08,
            text: engStr,
            fontSize: Math.max(8, this.height * 0.036),
            fontFamily: 'Consolas, monospace',
            fontStyle: 'bold',
            fill: '#44ddaa',
            width: disp.w - 4,
            align: 'right',
        }));

        // 单位
        this._dynamicGroup.add(new Konva.Text({
            x: disp.x + 2, y: disp.y + disp.h * 0.50,
            text: unit,
            fontSize: Math.max(6, this.height * 0.024),
            fontFamily: 'Arial',
            fill: '#5090b0',
            width: disp.w - 4,
            align: 'right',
        }));

        // 原始值（小字）
        this._dynamicGroup.add(new Konva.Text({
            x: disp.x + 2, y: disp.y + disp.h * 0.76,
            text: `AQW:${raw}`,
            fontSize: Math.max(4, this.height * 0.016),
            fontFamily: 'Consolas, monospace',
            fill: '#3a5060',
            width: disp.w - 4,
            align: 'right',
        }));
    }

    _drawLabelText() {
        const W = this.width, H = this.height;
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.50, y: H * 0.052,
            text: this.label,
            fontSize: Math.max(7, H * 0.028),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ffffffcc',
        }));
    }

    // ── 交互绑定 ────────────────────────────────────────────

    _bindInteraction() {
        // 点击各通道区域可以手动调整 AQW 值（未连接 CPU 时）
        this._channels.forEach(ch => {
            const hitArea = new Konva.Rect({
                x: ch.x, y: ch.y, width: ch.w, height: ch.h,
                fill: 'transparent',
            });
            hitArea.on('click tap', () => {
                if (this._cpu) return;  // 已连接 CPU，不允许手动
                const cur = this._rawValues[ch.idx];
                const newVal = prompt(
                    `手动设定 AQ${ch.idx} 原始值\n(-27648 ~ 27648)\n当前: ${cur}`,
                    String(cur)
                );
                if (newVal === null) return;
                const v = parseInt(newVal);
                if (!isNaN(v)) {
                    this._rawValues[ch.idx] = Math.max(-27648, Math.min(27648, v));
                    this._engValues[ch.idx] = this._rawToEng(this._rawValues[ch.idx], this._chModes[ch.idx]);
                    this._rebuildDynamic();
                    this.markDirty();
                }
            });
            this._interactGroup.add(hitArea);
        });
    }

    // ═══════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const dtMs = dt * 1000;

        // 从 CPU 读取 AQW 数据
        if (this._busConnected && this._cpu) {
            this._pollCPU();
        }

        // 超时检测（2000ms 没有收到有效数据）
        if (this._busConnected && Date.now() - this._lastUpdate > 2000) {
            this._commTimeout = true;
        }

        // 指针平滑（以 dt 速率逼近目标角度）
        let needRedraw = false;
        for (let i = 0; i < 4; i++) {
            const pct    = this._engToPercent(this._engValues[i], this._chModes[i]);
            const target = Math.PI + Math.max(0, Math.min(1, pct)) * Math.PI;
            const diff   = target - this._gaugeAngle[i];
            if (Math.abs(diff) > 0.003) {
                this._gaugeAngle[i] += diff * Math.min(1, dt * 8);
                needRedraw = true;
            }
        }

        if (needRedraw || this._busConnected) {
            this._rebuildDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /** 手动写入通道值（模拟 CPU 输出，不连接 CPU 时使用） */
    setRawValue(channel, rawVal) {
        if (channel < 0 || channel > 3) return;
        this._rawValues[channel] = Math.max(-27648, Math.min(27648, rawVal));
        this._engValues[channel] = this._rawToEng(this._rawValues[channel], this._chModes[channel]);
    }

    /** 读取通道工程值 */
    getEngValue(channel) {
        return this._engValues[channel] ?? 0;
    }

    /** 读取通道原始值 */
    getRawValue(channel) {
        return this._rawValues[channel] ?? 0;
    }

    /** 设置通道模式 */
    setChannelMode(channel, mode) {
        if (!['V±10', 'I0-20', 'I4-20'].includes(mode)) return;
        this._chModes[channel] = mode;
        this._engValues[channel] = this._rawToEng(this._rawValues[channel], mode);
    }

    /** 是否已连接 CPU */
    isConnected() { return this._busConnected; }

    /** 获取 AQW 地址（通道对应的 CPU AQW 字地址） */
    getAQWAddress(channel) {
        return `AQW${this._slotAddr * 8 + channel * 2}`;
    }

    // ═══════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号',          key: 'label',       type: 'text'   },
            { label: '槽位地址',      key: 'slotAddress', type: 'number' },
            { label: 'AQ0 模式',      key: 'ch0mode',     type: 'select',
              options: ['V±10','I0-20','I4-20'] },
            { label: 'AQ1 模式',      key: 'ch1mode',     type: 'select',
              options: ['V±10','I0-20','I4-20'] },
            { label: 'AQ2 模式',      key: 'ch2mode',     type: 'select',
              options: ['V±10','I0-20','I4-20'] },
            { label: 'AQ3 模式',      key: 'ch3mode',     type: 'select',
              options: ['V±10','I0-20','I4-20'] },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label = cfg.label;
        if (cfg.slotAddress !== undefined) this._slotAddr = parseInt(cfg.slotAddress) || 0;
        if (cfg.ch0mode     !== undefined) this.setChannelMode(0, cfg.ch0mode);
        if (cfg.ch1mode     !== undefined) this.setChannelMode(1, cfg.ch1mode);
        if (cfg.ch2mode     !== undefined) this.setChannelMode(2, cfg.ch2mode);
        if (cfg.ch3mode     !== undefined) this.setChannelMode(3, cfg.ch3mode);

        this.config = { ...this.config,
            label: this.label,
            slotAddress: this._slotAddr,
            chModes: [...this._chModes],
        };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        this.disconnectFromCPU();
        super.destroy?.();
    }
}
