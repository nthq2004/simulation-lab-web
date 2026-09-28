import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-200 SMART 模拟量输入模块 AI04 仿真组件
 *
 * ── 硬件规格 ─────────────────────────────────────────────────────
 *
 *  订货号：6ES7 288-3AE04-0AA0
 *
 *  模拟量输入：
 *    - 4 路模拟量输入（AI0 ~ AI3）
 *    - 电压输入：±10V / 0~10V / 0~5V（12位分辨率）
 *    - 电流输入：0~20mA / 4~20mA（12位分辨率）
 *    - 转换时间：≤625μs / 通道
 *    - 输入阻抗：电压≥9MΩ，电流约250Ω
 *    - 精度：±0.5%（额定值，25°C）
 *    - 共模抑制：≥40dB（DC~60Hz）
 *    - 满量程数字值：27648（单极性）/ ±27648（双极性）
 *    - 超量程值：32767；欠量程值：-32768
 *
 *  电源：
 *    - 模块供电：来自 CPU 扩展总线（5V DC，最大 60mA）
 *    - 传感器电源：需外部 24V DC（通过 L+/M 端子）
 *
 *  通信接口（仿真）：
 *    - S7-200 SMART 扩展总线连接器（左侧母头 / 右侧公头）
 *    - 地址映射：AIW0 ~ AIW6（4路 × 2字节 = 8字节）
 *    - CPU 梯形图通过 MOV_W AIWx, VWx 读取模拟量输入值
 *
 *  外部接线（端子排，每路 3 针）：
 *    AI0: A+(正) / B-(负/屏蔽) / M(公共端)
 *    AI1: A+ / B- / M
 *    AI2: A+ / B- / M
 *    AI3: A+ / B- / M
 *    传感器电源：L+(24V) / M(0V)
 *
 * ── 与 ST20 通信机制（仿真） ─────────────────────────────────────
 *
 *  连接：
 *    AI04 实例调用 connectToCPU(cpuInstance) 完成绑定。
 *    绑定后 AI04 在每个 tick 将仿真输入值写入 CPU 的 AIW 存储区，
 *    CPU 梯形图下一次扫描时即可读取最新值。
 *
 *  数据流（与 AQ04 相反）：
 *    外部信号（传感器模拟 / 手动输入）
 *    → AI04 _engValues[i]（工程值）
 *    → 转换为 AIW 原始整数（-27648 ~ 27648）
 *    → 写入 cpu._AIW[byteOffset]（大端 16 位有符号整数）
 *    → CPU 梯形图执行 MOV_W AIW0, VW100 读取
 *    → 梯形图比较/运算使用该值
 *
 *  AIW 存储区（挂载在 ST20 实例上）：
 *    AIW0 → 通道 0（字节 0~1）
 *    AIW2 → 通道 1（字节 2~3）
 *    AIW4 → 通道 2（字节 4~5）
 *    AIW6 → 通道 3（字节 6~7）
 *    多模块：槽位 slotAddress × 8 决定字节偏移
 *
 * ── 信号仿真模式 ─────────────────────────────────────────────────
 *
 *  每通道独立设置：
 *    'manual'   — 手动设定工程值（滑块/数值输入）
 *    'sine'     — 正弦波（可设频率 Hz、幅值、偏置）
 *    'ramp'     — 锯齿波斜坡（可设周期 s）
 *    'square'   — 方波（可设周期 s、占空比 %）
 *    'noise'    — 随机噪声叠加（可设幅值）
 *    'const'    — 固定常量
 *
 * ── 端口 ────────────────────────────────────────────────────────
 *  BUS_L  — 左侧扩展总线母头（连接 CPU 或上一扩展模块）
 *  BUS_R  — 右侧扩展总线公头（连接下一扩展模块）
 *  PWR_L  — 传感器电源 L+(24V DC)
 *  PWR_M  — 传感器电源 M(0V)
 *  AI0_A / AI0_B / AI0_M — 通道 0 正端 / 负端 / 公共端
 *  AI1_A / AI1_B / AI1_M — 通道 1
 *  AI2_A / AI2_B / AI2_M — 通道 2
 *  AI3_A / AI3_B / AI3_M — 通道 3
 *
 * ── 可配置参数 ────────────────────────────────────────────────────
 *  label         : 位号（默认 'AI1'）
 *  chModes       : 4路量程模式数组，每项 'V±10'|'V0-10'|'V0-5'|'I0-20'|'I4-20'
 *  chSigModes    : 4路信号仿真模式数组，每项 'manual'|'sine'|'ramp'|'square'|'noise'|'const'
 *  chSigParams   : 4路信号参数对象数组 { freq, amp, offset, period, duty, noiseAmp, constVal }
 *  slotAddress   : 模块槽位（默认 0，AIW 起始偏移 = slotAddress × 8）
 */
export class S7200SmartAI04 extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(130, config.width  || 170);
        this.height = Math.max(290, config.height || 370);

        this.type    = 's7200_smart_ai04';
        this.special = 'expansion';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:       this.label,
            chModes:     [...this._chModes],
            chSigModes:  [...this._chSigModes],
            chSigParams: this._chSigParams.map(p => ({ ...p })),
            slotAddress: this._slotAddr,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._body = { x: 0, y: 0, w: W, h: H, rx: 3 };
        this._topBar = { x: 0, y: 0, w: W, h: H * 0.085 };

        // 扩展总线连接器
        this._busLeft  = { x: -6, y: H * 0.14, w: 8, h: H * 0.20 };
        this._busRight = { x: W - 2, y: H * 0.14, w: 8, h: H * 0.20 };

        // 状态 LED（DIAG / SF）
        this._statusLEDs = {
            diag: { x: W * 0.16, y: H * 0.108, r: H * 0.015 },
            sf:   { x: W * 0.36, y: H * 0.108, r: H * 0.015 },
        };

        // 传感器电源 LED（L+ 指示）
        this._pwrLED = { x: W * 0.60, y: H * 0.108, r: H * 0.015 };

        // 4 路通道区域（竖排，均等高度）
        const chAreaY = H * 0.168;
        const chH     = H * 0.160;
        const chGap   = H * 0.008;
        this._channels = Array.from({ length: 4 }, (_, i) => ({
            x:   W * 0.04,
            y:   chAreaY + i * (chH + chGap),
            w:   W * 0.92,
            h:   chH,
            idx: i,
        }));

        // 每通道子区域
        this._channels.forEach(ch => {
            // 信号波形迷你图（左 56%）
            ch.waveArea = {
                x: ch.x + ch.w * 0.03,
                y: ch.y + ch.h * 0.28,
                w: ch.w * 0.52,
                h: ch.h * 0.60,
            };
            // 数值显示区（右 40%）
            ch.display = {
                x: ch.x + ch.w * 0.59,
                y: ch.y + ch.h * 0.08,
                w: ch.w * 0.38,
                h: ch.h * 0.84,
            };
        });

        // 端子排（底部）
        this._terminals = {
            x: W * 0.03,
            y: H * 0.830,
            w: W * 0.94,
            h: H * 0.088,
        };

        // 传感器电源端子（端子排上方右侧）
        this._pwrTerminals = {
            x: W * 0.68,
            y: H * 0.795,
            w: W * 0.28,
            h: H * 0.032,
        };

        // 铭牌
        this._nameplate = { x: W * 0.04, y: H * 0.924, w: W * 0.92, h: H * 0.055 };
        // DIN 导轨
        this._dinRail = { x: 0, y: H * 0.982, w: W, h: H * 0.018 };

        // 端口坐标
        this._portPos = {
            BUS_L: { x: -8, y: H * 0.24 },
            BUS_R: { x: W + 8, y: H * 0.24 },
            PWR_L: { x: W * 0.76, y: H },
            PWR_M: { x: W * 0.88, y: H },
        };
        for (let i = 0; i < 4; i++) {
            const bx = W * (0.06 + i * 0.215);
            this._portPos[`AI${i}_A`] = { x: bx,           y: H };
            this._portPos[`AI${i}_B`] = { x: bx + W*0.07,  y: H };
            this._portPos[`AI${i}_M`] = { x: bx + W*0.13,  y: H };
        }
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label     = config.label       || 'AI1';
        this._slotAddr = config.slotAddress !== undefined ? config.slotAddress : 0;

        // 量程模式
        this._chModes = config.chModes
            ? [...config.chModes]
            : ['V±10', 'V±10', 'V±10', 'V±10'];

        // 信号仿真模式
        this._chSigModes = config.chSigModes
            ? [...config.chSigModes]
            : ['manual', 'manual', 'manual', 'manual'];

        // 信号参数（每通道默认值）
        const defParam = () => ({
            freq:     1.0,    // 正弦/方波频率 Hz
            amp:      5.0,    // 正弦幅值（工程值单位）
            offset:   0.0,    // 偏置（工程值单位）
            period:   5.0,    // 锯齿波周期 s
            duty:     50,     // 方波占空比 %
            noiseAmp: 0.5,    // 噪声幅值
            constVal: 0.0,    // 常量值（工程值单位）
            manualVal:0.0,    // 手动设定值
        });
        this._chSigParams = config.chSigParams
            ? config.chSigParams.map(p => ({ ...defParam(), ...p }))
            : Array.from({ length: 4 }, defParam);

        // 当前工程值（转换后的实际物理量）
        this._engValues  = new Float64Array(4);
        // AIW 原始整数值（写入 CPU）
        this._rawValues  = new Int16Array(4);

        // 信号发生器内部时间（每通道独立）
        this._sigTime    = new Float64Array(4);

        // 波形历史（用于迷你图，每通道保留最近 40 点）
        this._waveHist   = Array.from({ length: 4 }, () => new Float64Array(40));
        this._wavePtr    = new Uint8Array(4);  // 循环缓冲区指针

        // 连接状态
        this._cpu          = null;
        this._busConnected = false;
        this._commTimeout  = false;
        this._lastPush     = 0;

        // 传感器电源状态（仿真：连接后即为 ON）
        this._pwrOn = false;

        // 滤波系数（仿真一阶低通，0=不滤波，0.9=强滤波）
        this._filterAlpha = new Float64Array(4).fill(0.0);

        // 量程溢出标志
        this._overRange  = new Uint8Array(4);
        this._underRange = new Uint8Array(4);
    }

    // ═══════════════════════════════════════════════════════
    // 与 CPU 连接 API
    // ═══════════════════════════════════════════════════════

    /**
     * 连接到 CPU ST20 实例
     *  1. 在 CPU 上挂载 _AIW（Uint8Array[64]）存储区
     *  2. Patch CPU 的 _readWord/_writeWord 支持 AIWx 地址
     *  3. 将本模块注册到 cpu._expansionModules
     */
    connectToCPU(cpu) {
        if (!cpu) return;
        this._cpu = cpu;

        if (!cpu._AIW) {
            cpu._AIW = new Uint8Array(64);
        }
        if (!cpu._expansionModules) {
            cpu._expansionModules = [];
        }
        if (!cpu._expansionModules.includes(this)) {
            cpu._expansionModules.push(this);
        }

        this._busConnected = true;
        this._commTimeout  = false;
        this._pwrOn        = true;

        this._patchCPUAIW(cpu);

        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    disconnectFromCPU() {
        if (this._cpu?._expansionModules) {
            const idx = this._cpu._expansionModules.indexOf(this);
            if (idx >= 0) this._cpu._expansionModules.splice(idx, 1);
        }
        this._cpu          = null;
        this._busConnected = false;
        this._pwrOn        = false;
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    /**
     * Patch CPU：扩展 _readWord / _writeWord 支持 AIWx 地址
     * AIWx 对 CPU 而言是只读输入映像（只 patch _readWord）；
     * 同时允许外部写入（供 AI04 tick 推数据用）。
     */
    _patchCPUAIW(cpu) {
        if (cpu._aiwReadPatched) return;
        cpu._aiwReadPatched = true;

        const origRead = cpu._readWord.bind(cpu);
        cpu._readWord = function(addr) {
            const m = addr.match(/^AIW(\d+)$/i);
            if (m) {
                const off = parseInt(m[1]);
                if (cpu._AIW && off + 1 < cpu._AIW.length) {
                    const raw = (cpu._AIW[off] << 8) | cpu._AIW[off + 1];
                    return raw > 32767 ? raw - 65536 : raw;
                }
                return 0;
            }
            return origRead(addr);
        };

        // 允许梯形图用 MOV_W 将常量写入 AIW（不常见但合法）
        const origWrite = cpu._writeWord ? cpu._writeWord.bind(cpu) : null;
        if (origWrite && !cpu._aiwWritePatched) {
            cpu._aiwWritePatched = true;
            const prevWrite = cpu._writeWord.bind(cpu);
            cpu._writeWord = function(addr, val) {
                const m = addr.match(/^AIW(\d+)$/i);
                if (m) {
                    const off = parseInt(m[1]);
                    val = Math.max(-32768, Math.min(32767, Math.round(val)));
                    const u = val < 0 ? val + 65536 : val;
                    if (cpu._AIW && off + 1 < cpu._AIW.length) {
                        cpu._AIW[off]     = (u >> 8) & 0xFF;
                        cpu._AIW[off + 1] = u & 0xFF;
                    }
                    return;
                }
                prevWrite(addr, val);
            };
        }
    }

    // ═══════════════════════════════════════════════════════
    // 数值转换
    // ═══════════════════════════════════════════════════════

    /**
     * 量程模式下工程值对应的最小/最大值
     */
    _modeRange(mode) {
        switch (mode) {
            case 'V±10':  return { min: -10,  max: 10   };
            case 'V0-10': return { min: 0,    max: 10   };
            case 'V0-5':  return { min: 0,    max: 5    };
            case 'I0-20': return { min: 0,    max: 20   };
            case 'I4-20': return { min: 4,    max: 20   };
            default:      return { min: 0,    max: 10   };
        }
    }

    _modeUnit(mode) {
        return mode.startsWith('I') ? 'mA' : 'V';
    }

    /**
     * 工程值 → AIW 原始整数（-27648 ~ 27648）
     */
    _engToRaw(eng, mode) {
        const { min, max } = this._modeRange(mode);
        const span = max - min;
        if (span === 0) return 0;
        const pct    = Math.max(0, Math.min(1, (eng - min) / span));
        const rawPct = mode === 'V±10'
            ? ((eng - min) / span) * 2 - 1          // 双极性 -1~+1
            : (eng - min) / span;                    // 单极性  0~1

        if (mode === 'V±10') {
            return Math.round(rawPct * 27648);
        } else {
            return Math.round(rawPct * 27648);
        }
    }

    /**
     * AIW 原始整数 → 工程值
     */
    _rawToEng(raw, mode) {
        const { min, max } = this._modeRange(mode);
        if (mode === 'V±10') {
            return (raw / 27648) * 10.0;
        } else {
            return min + (Math.max(0, raw) / 27648) * (max - min);
        }
    }

    /**
     * 工程值 → 百分比（0~1，用于进度条）
     */
    _engToPercent(eng, mode) {
        const { min, max } = this._modeRange(mode);
        return Math.max(0, Math.min(1, (eng - min) / (max - min)));
    }

    // ═══════════════════════════════════════════════════════
    // 信号发生器
    // ═══════════════════════════════════════════════════════

    /**
     * 按当前信号模式计算通道 i 的工程值（dt 单位：秒）
     */
    _generateSignal(i, dt) {
        const mode    = this._chSigModes[i];
        const param   = this._chSigParams[i];
        const range   = this._modeRange(this._chModes[i]);
        const mid     = (range.max + range.min) / 2;
        const halfSpan = (range.max - range.min) / 2;

        this._sigTime[i] += dt;
        const t = this._sigTime[i];

        let eng = 0;
        switch (mode) {
            case 'manual':
                eng = param.manualVal;
                break;
            case 'const':
                eng = param.constVal;
                break;
            case 'sine': {
                const omega = 2 * Math.PI * param.freq;
                const eff_amp = Math.min(param.amp, halfSpan);
                eng = param.offset + eff_amp * Math.sin(omega * t);
                break;
            }
            case 'ramp': {
                const T   = Math.max(0.1, param.period);
                const pos = (t % T) / T;              // 0~1
                eng = range.min + pos * (range.max - range.min);
                break;
            }
            case 'square': {
                const T    = Math.max(0.1, param.period);
                const duty = Math.max(0, Math.min(100, param.duty)) / 100;
                const pos  = (t % T) / T;
                const eff_amp = Math.min(Math.abs(param.amp), halfSpan);
                eng = pos < duty ? (param.offset + eff_amp) : (param.offset - eff_amp);
                break;
            }
            case 'noise': {
                const base  = param.constVal || mid;
                const noise = (Math.random() * 2 - 1) * param.noiseAmp;
                eng = base + noise;
                break;
            }
            default:
                eng = 0;
        }

        // 钳制到量程范围（超量程用特殊值标记）
        if (eng > range.max * 1.0723) {
            this._overRange[i]  = 1;
            this._underRange[i] = 0;
            eng = range.max;
        } else if (eng < range.min * (mode === 'V±10' ? 1.0723 : 1) - (mode !== 'V±10' ? 0 : 0)) {
            this._underRange[i] = (eng < range.min) ? 1 : 0;
            this._overRange[i]  = 0;
        } else {
            this._overRange[i]  = 0;
            this._underRange[i] = 0;
        }
        eng = Math.max(range.min, Math.min(range.max, eng));

        // 一阶低通滤波
        const alpha = this._filterAlpha[i];
        if (alpha > 0) {
            eng = alpha * this._engValues[i] + (1 - alpha) * eng;
        }

        return eng;
    }

    /**
     * 将工程值写入 CPU AIW 存储区
     */
    _pushToCPU() {
        if (!this._cpu?._AIW) return;
        const base = this._slotAddr * 8;
        for (let i = 0; i < 4; i++) {
            const raw = this._engToRaw(this._engValues[i], this._chModes[i]);
            this._rawValues[i] = Math.max(-32768, Math.min(32767, raw));

            // 超量程使用特殊值
            let writeVal = this._rawValues[i];
            if (this._overRange[i])  writeVal = 32767;
            if (this._underRange[i]) writeVal = -32768;

            const u   = writeVal < 0 ? writeVal + 65536 : writeVal;
            const off = base + i * 2;
            if (off + 1 < this._cpu._AIW.length) {
                this._cpu._AIW[off]     = (u >> 8) & 0xFF;
                this._cpu._AIW[off + 1] = u & 0xFF;
            }
        }
        this._lastPush = Date.now();
    }

    // ═══════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════

    _registerPorts() {
        const pp = this._portPos;
        this.addPort(pp.BUS_L.x, pp.BUS_L.y, 'BUS_L', 'bus', 'p');
        this.addPort(pp.BUS_R.x, pp.BUS_R.y, 'BUS_R', 'bus');
        this.addPort(pp.PWR_L.x, pp.PWR_L.y, 'PWR_L', 'wire', 'p');
        this.addPort(pp.PWR_M.x, pp.PWR_M.y, 'PWR_M', 'wire', 'p');
        for (let i = 0; i < 4; i++) {
            this.addPort(pp[`AI${i}_A`].x, pp[`AI${i}_A`].y, `AI${i}_A`, 'wire', 'p');
            this.addPort(pp[`AI${i}_B`].x, pp[`AI${i}_B`].y, `AI${i}_B`, 'wire', 'p');
            this.addPort(pp[`AI${i}_M`].x, pp[`AI${i}_M`].y, `AI${i}_M`, 'wire', 'p');
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
            fill: '#c8ccd4',
            stroke: '#8890a0', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 7,
            shadowOffsetX: 2, shadowOffsetY: 3, shadowOpacity: 0.28,
        }));
        // 左侧高光
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 4, width: 3, height: b.h - 8,
            fill: 'rgba(255,255,255,0.28)',
            cornerRadius: [b.rx, 0, 0, b.rx],
        }));
        // 右侧阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.w - 4, y: 4, width: 3, height: b.h - 8,
            fill: 'rgba(0,0,0,0.08)',
            cornerRadius: [0, b.rx, b.rx, 0],
        }));
    }

    _drawTopBar() {
        const W = this.width, H = this.height;
        // 顶部色带（与 AQ04 同款蓝色，区别在副标题）
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.085,
            fill: '#1a6fa8',
            cornerRadius: [3, 3, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: 5, y: H * 0.010,
            text: 'SIMATIC',
            fontSize: Math.max(6, H * 0.025),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold', fill: '#ffffff', letterSpacing: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 5, y: H * 0.044,
            text: 'EM AI04',
            fontSize: Math.max(5, H * 0.022),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#b8d8f0',
        }));
    }

    _drawBusConnectors() {
        const H = this.height;
        const bl = this._busLeft;
        // 左侧母头（浅灰，有针孔）
        this._staticGroup.add(new Konva.Rect({
            x: bl.x, y: bl.y, width: bl.w + 2, height: bl.h,
            fill: '#e8e8e0', stroke: '#888', strokeWidth: 1,
            cornerRadius: [2, 0, 0, 2],
        }));
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: bl.x + 2, y: bl.y + bl.h * (0.15 + i * 0.175),
                radius: 1.5, fill: '#888',
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: bl.x + 1, y: bl.y + bl.h + 2,
            text: 'BUS', fontSize: Math.max(5, H * 0.016),
            fontFamily: 'Arial', fill: '#666',
        }));

        // 右侧公头（深色，金色针脚）
        const br = this._busRight;
        this._staticGroup.add(new Konva.Rect({
            x: br.x - 2, y: br.y, width: br.w + 2, height: br.h,
            fill: '#2a2a30', stroke: '#555', strokeWidth: 1,
            cornerRadius: [0, 2, 2, 0],
        }));
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: br.x + br.w - 2, y: br.y + br.h * (0.15 + i * 0.175),
                radius: 1.5, fill: '#c8b040',
            }));
        }
    }

    _drawChannelFrames() {
        this._channels.forEach(ch => {
            this._staticGroup.add(new Konva.Rect({
                x: ch.x, y: ch.y, width: ch.w, height: ch.h,
                fill: '#111820',
                stroke: '#2a3a50', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 通道名（静态文本）
            this._staticGroup.add(new Konva.Text({
                x: ch.x + 4, y: ch.y + 2,
                text: `AI${ch.idx}`,
                fontSize: Math.max(7, this.height * 0.026),
                fontFamily: 'Consolas, monospace',
                fontStyle: 'bold', fill: '#3a8abd',
            }));
        });
    }

    _drawTerminals() {
        const W = this.width, H = this.height;
        const t = this._terminals;

        // 端子排主体
        this._staticGroup.add(new Konva.Rect({
            x: t.x, y: t.y, width: t.w, height: t.h,
            fill: '#2a2a2a', stroke: '#222', strokeWidth: 1, cornerRadius: 2,
        }));

        // 4 路 × 3 针（A+/B-/M）
        for (let i = 0; i < 4; i++) {
            const lbls = ['A', 'B', 'M'];
            for (let j = 0; j < 3; j++) {
                const tx = t.x + t.w * (0.04 + (i * 3 + j) * 0.079);
                this._staticGroup.add(new Konva.Rect({
                    x: tx, y: t.y + t.h * 0.15,
                    width: t.w * 0.058, height: t.h * 0.70,
                    fill: '#888', stroke: '#666', strokeWidth: 0.5, cornerRadius: 1,
                }));
                // 端子标签
                this._staticGroup.add(new Konva.Text({
                    x: tx - 1, y: t.y - H * 0.022,
                    text: lbls[j],
                    fontSize: Math.max(4, H * 0.016),
                    fontFamily: 'Arial', fill: '#5080a0',
                }));
            }
            // 通道分隔线
            if (i < 3) {
                const lx = t.x + t.w * ((i + 1) * 0.25 + 0.01);
                this._staticGroup.add(new Konva.Line({
                    points: [lx, t.y + 1, lx, t.y + t.h - 1],
                    stroke: '#444', strokeWidth: 0.5,
                }));
            }
        }

        // 传感器电源端子（L+/M，右上角）
        const pt = this._pwrTerminals;
        this._staticGroup.add(new Konva.Rect({
            x: pt.x, y: pt.y, width: pt.w, height: pt.h,
            fill: '#2a2820', stroke: '#554', strokeWidth: 0.8, cornerRadius: 1,
        }));
        ['L+', 'M'].forEach((lbl, j) => {
            const tx = pt.x + pt.w * (0.12 + j * 0.52);
            this._staticGroup.add(new Konva.Rect({
                x: tx, y: pt.y + pt.h * 0.1,
                width: pt.w * 0.28, height: pt.h * 0.80,
                fill: '#a08040', stroke: '#706030', strokeWidth: 0.5, cornerRadius: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: tx - 1, y: pt.y - H * 0.020,
                text: lbl, fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Arial', fill: '#a09060',
            }));
        });

        // "24V" 标签
        this._staticGroup.add(new Konva.Text({
            x: pt.x - 2, y: pt.y - H * 0.042,
            text: '24V DC',
            fontSize: Math.max(4, H * 0.015),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#807040',
        }));
    }

    _drawNameplate() {
        const np = this._nameplate;
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fill: '#f0ece0', stroke: '#aaa', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 3, y: np.y + 2,
            text: '6ES7 288-3AE04-0AA0',
            fontSize: Math.max(4, this.height * 0.015),
            fontFamily: 'Consolas, monospace', fill: '#444',
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
        const H = this.height;
        const ls = this._statusLEDs;
        ['DIAG', 'SF', '24V'].forEach((txt, i) => {
            const led = i === 0 ? ls.diag : (i === 1 ? ls.sf : this._pwrLED);
            this._staticGroup.add(new Konva.Text({
                x: led.x - 7, y: led.y + led.r + 2,
                text: txt, fontSize: Math.max(4, H * 0.015),
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
        const conn = this._busConnected;
        const err  = this._commTimeout;

        // DIAG：绿=正常，红=错误
        const diagOK = conn && !err;
        this._dynamicGroup.add(new Konva.Circle({
            x: ls.diag.x, y: ls.diag.y, radius: ls.diag.r,
            fill:  diagOK ? '#44cc44' : (conn ? '#ee4444' : '#1a1a1a'),
            stroke: '#444', strokeWidth: 0.8,
            shadowColor: diagOK ? '#44cc44' : 'transparent',
            shadowBlur: diagOK ? 5 : 0, shadowOpacity: 0.9,
        }));

        // SF：红=系统故障
        this._dynamicGroup.add(new Konva.Circle({
            x: ls.sf.x, y: ls.sf.y, radius: ls.sf.r,
            fill:  err ? '#ee4444' : '#0a0000',
            stroke: '#444', strokeWidth: 0.8,
            shadowColor: err ? '#ee4444' : 'transparent',
            shadowBlur: err ? 5 : 0, shadowOpacity: 0.9,
        }));

        // 24V PWR LED：黄绿=电源正常
        const pwrLED = this._pwrLED;
        this._dynamicGroup.add(new Konva.Circle({
            x: pwrLED.x, y: pwrLED.y, radius: pwrLED.r,
            fill:  this._pwrOn ? '#aadd22' : '#1a1a00',
            stroke: '#444', strokeWidth: 0.8,
            shadowColor: this._pwrOn ? '#aadd22' : 'transparent',
            shadowBlur: this._pwrOn ? 5 : 0, shadowOpacity: 0.9,
        }));
    }

    _drawBusStatus() {
        const bl    = this._busLeft;
        const color = this._busConnected
            ? 'rgba(68,204,68,0.20)' : 'rgba(60,60,60,0.25)';
        this._dynamicGroup.add(new Konva.Rect({
            x: bl.x, y: bl.y, width: bl.w + 2, height: bl.h,
            fill: color, cornerRadius: [2, 0, 0, 2],
        }));
        if (this._busConnected) {
            this._dynamicGroup.add(new Konva.Rect({
                x: bl.x, y: bl.y + bl.h / 2 - 1,
                width: bl.w + 4, height: 2,
                fill: '#44cc44', opacity: 0.55,
            }));
        }
    }

    _drawChannels() {
        this._channels.forEach(ch => this._drawChannel(ch));
    }

    _drawChannel(ch) {
        const i    = ch.idx;
        const mode = this._chModes[i];
        const eng  = this._engValues[i];
        const raw  = this._rawValues[i];
        const pct  = this._engToPercent(eng, mode);
        const unit = this._modeUnit(mode);
        const sig  = this._chSigModes[i];
        const over = this._overRange[i];
        const under= this._underRange[i];

        // ── 量程 / 信号模式标签 ─────────────────────────
        this._dynamicGroup.add(new Konva.Text({
            x: ch.x + ch.w * 0.43, y: ch.y + 2,
            text: mode,
            fontSize: Math.max(6, this.height * 0.021),
            fontFamily: 'Consolas, monospace', fill: '#4080a0',
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: ch.x + ch.w * 0.68, y: ch.y + 2,
            text: sig.toUpperCase(),
            fontSize: Math.max(5, this.height * 0.018),
            fontFamily: 'Consolas, monospace', fill: '#3a6040',
        }));

        // ── AIW 地址标签 ────────────────────────────────
        const aiwAddr = `AIW${this._slotAddr * 8 + i * 2}`;
        this._dynamicGroup.add(new Konva.Text({
            x: ch.x + ch.w * 0.03, y: ch.y + ch.h - this.height * 0.022,
            text: aiwAddr,
            fontSize: Math.max(5, this.height * 0.018),
            fontFamily: 'Consolas, monospace', fill: '#2a4a60',
        }));

        // ── 迷你波形图 ──────────────────────────────────
        this._drawWaveform(ch.waveArea, i, mode);

        // ── 数值显示区 ──────────────────────────────────
        this._drawChannelDisplay(ch.display, eng, raw, unit, pct, over, under);
    }

    _drawWaveform(area, idx, mode) {
        const range = this._modeRange(mode);
        const { x, y, w, h } = area;

        // 背景
        this._dynamicGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#070c12', stroke: '#1a2a3a', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 中轴线（0 位置，仅双极性量程）
        if (mode === 'V±10') {
            const midY = y + h / 2;
            this._dynamicGroup.add(new Konva.Line({
                points: [x + 2, midY, x + w - 2, midY],
                stroke: '#1a3040', strokeWidth: 0.5,
            }));
        }

        // 波形折线
        const hist    = this._waveHist[idx];
        const ptr     = this._wavePtr[idx];
        const nPoints = hist.length;
        const pts     = [];

        for (let k = 0; k < nPoints; k++) {
            const histIdx = (ptr + k) % nPoints;
            const val     = hist[histIdx];
            const px      = x + (k / (nPoints - 1)) * (w - 4) + 2;
            const normVal = (val - range.min) / (range.max - range.min);
            const py      = y + h - 2 - normVal * (h - 4);
            pts.push(px, py);
        }

        if (pts.length >= 4) {
            this._dynamicGroup.add(new Konva.Line({
                points: pts,
                stroke: '#44ccaa',
                strokeWidth: 1.2,
                lineCap: 'round',
                lineJoin: 'round',
                tension: 0.3,
            }));
        }

        // 当前值点（最新点高亮）
        if (pts.length >= 2) {
            const lx = pts[pts.length - 2];
            const ly = pts[pts.length - 1];
            this._dynamicGroup.add(new Konva.Circle({
                x: lx, y: ly, radius: 2.5,
                fill: '#44ffcc',
                shadowColor: '#44ffcc', shadowBlur: 4, shadowOpacity: 0.9,
            }));
        }
    }

    _drawChannelDisplay(disp, eng, raw, unit, pct, over, under) {
        const { x, y, w, h } = disp;

        // 背景
        this._dynamicGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#080c14', stroke: '#182838', strokeWidth: 1, cornerRadius: 2,
        }));

        // 溢出标志
        if (over || under) {
            this._dynamicGroup.add(new Konva.Text({
                x: x + 2, y: y + 3,
                text: over ? 'OVR' : 'UNR',
                fontSize: Math.max(6, this.height * 0.020),
                fontFamily: 'Consolas, monospace', fontStyle: 'bold',
                fill: '#ff6644',
                width: w - 4, align: 'center',
            }));
        }

        // 工程值（大字）
        const engStr = (Math.abs(eng) < 10 ? eng.toFixed(3) : eng.toFixed(2));
        this._dynamicGroup.add(new Konva.Text({
            x: x + 2, y: y + h * 0.10,
            text: engStr,
            fontSize: Math.max(8, this.height * 0.034),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: '#44ddaa',
            width: w - 4, align: 'right',
        }));

        // 单位
        this._dynamicGroup.add(new Konva.Text({
            x: x + 2, y: y + h * 0.50,
            text: unit,
            fontSize: Math.max(6, this.height * 0.022),
            fontFamily: 'Arial', fill: '#4890b0',
            width: w - 4, align: 'right',
        }));

        // 进度条
        const barY = y + h * 0.72, barH = h * 0.10, barW = w - 6;
        const fillW = Math.max(0, pct) * barW;
        const barColor = over ? '#ff6644' : (pct > 0.9 ? '#f5c842' : '#44aacc');
        this._dynamicGroup.add(new Konva.Rect({
            x: x + 3, y: barY, width: barW, height: barH,
            fill: '#0a1a28', stroke: '#1a3040', strokeWidth: 0.5, cornerRadius: 1,
        }));
        if (fillW > 0) {
            this._dynamicGroup.add(new Konva.Rect({
                x: x + 3, y: barY, width: fillW, height: barH,
                fill: barColor, cornerRadius: 1,
            }));
        }

        // AIW 原始值
        this._dynamicGroup.add(new Konva.Text({
            x: x + 2, y: y + h * 0.84,
            text: `${raw}`,
            fontSize: Math.max(4, this.height * 0.015),
            fontFamily: 'Consolas, monospace', fill: '#2a4a60',
            width: w - 4, align: 'right',
        }));
    }

    _drawLabelText() {
        const W = this.width, H = this.height;
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.48, y: H * 0.048,
            text: this.label,
            fontSize: Math.max(7, H * 0.026),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: 'rgba(255,255,255,0.90)',
        }));
    }

    // ── 交互绑定 ────────────────────────────────────────────

    _bindInteraction() {
        this._channels.forEach(ch => {
            const hit = new Konva.Rect({
                x: ch.x, y: ch.y, width: ch.w, height: ch.h,
                fill: 'transparent',
            });
            hit.on('click tap', () => this._onChannelClick(ch.idx));
            this._interactGroup.add(hit);
        });
    }

    _onChannelClick(idx) {
        if (this._chSigModes[idx] !== 'manual') return;
        const cur = this._engValues[idx];
        const range = this._modeRange(this._chModes[idx]);
        const unit  = this._modeUnit(this._chModes[idx]);
        const val = prompt(
            `手动设定 AI${idx} 工程值\n范围：${range.min} ~ ${range.max} ${unit}\n当前：${cur.toFixed(3)}`,
            cur.toFixed(3)
        );
        if (val === null) return;
        const v = parseFloat(val);
        if (!isNaN(v)) {
            this._chSigParams[idx].manualVal = Math.max(range.min, Math.min(range.max, v));
        }
    }

    // ═══════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const dtS  = dt;          // dt 单位：秒
        const dtMs = dt * 1000;

        // 更新超时状态
        if (this._busConnected && Date.now() - this._lastPush > 2000) {
            this._commTimeout = true;
        } else {
            this._commTimeout = false;
        }

        // 更新每通道信号值
        for (let i = 0; i < 4; i++) {
            const eng = this._generateSignal(i, dtS);
            this._engValues[i] = eng;
            this._rawValues[i] = Math.max(-32768, Math.min(32767,
                this._engToRaw(eng, this._chModes[i])));

            // 更新波形历史（每 tick 追加一点，循环缓冲）
            this._waveHist[i][this._wavePtr[i]] = eng;
            this._wavePtr[i] = (this._wavePtr[i] + 1) % this._waveHist[i].length;
        }

        // 推数据到 CPU AIW 存储区
        if (this._busConnected && this._cpu) {
            this._pushToCPU();
        }

        this._rebuildDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /** 手动设定通道工程值（仅 manual 模式） */
    setEngValue(channel, val) {
        if (channel < 0 || channel > 3) return;
        const range = this._modeRange(this._chModes[channel]);
        this._chSigParams[channel].manualVal = Math.max(range.min, Math.min(range.max, val));
    }

    /** 读取通道当前工程值 */
    getEngValue(channel) { return this._engValues[channel] ?? 0; }

    /** 读取通道当前原始 AIW 值 */
    getRawValue(channel) { return this._rawValues[channel] ?? 0; }

    /** 设置通道量程模式 */
    setChannelMode(channel, mode) {
        if (!['V±10','V0-10','V0-5','I0-20','I4-20'].includes(mode)) return;
        this._chModes[channel] = mode;
    }

    /** 设置信号仿真模式 */
    setSignalMode(channel, sigMode) {
        if (!['manual','sine','ramp','square','noise','const'].includes(sigMode)) return;
        this._chSigModes[channel] = sigMode;
        this._sigTime[channel] = 0;
    }

    /** 设置信号参数 */
    setSignalParam(channel, key, val) {
        if (this._chSigParams[channel]) {
            this._chSigParams[channel][key] = val;
        }
    }

    /** 设置滤波系数（0=不滤波，0.99=强滤波） */
    setFilter(channel, alpha) {
        this._filterAlpha[channel] = Math.max(0, Math.min(0.99, alpha));
    }

    /** 获取 AIW 地址字符串 */
    getAIWAddress(channel) {
        return `AIW${this._slotAddr * 8 + channel * 2}`;
    }

    isConnected() { return this._busConnected; }

    // ═══════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号',        key: 'label',       type: 'text'   },
            { label: '槽位地址',    key: 'slotAddress', type: 'number' },
            { label: 'AI0 量程',    key: 'ch0mode',     type: 'select',
              options: ['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label: 'AI1 量程',    key: 'ch1mode',     type: 'select',
              options: ['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label: 'AI2 量程',    key: 'ch2mode',     type: 'select',
              options: ['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label: 'AI3 量程',    key: 'ch3mode',     type: 'select',
              options: ['V±10','V0-10','V0-5','I0-20','I4-20'] },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label = cfg.label;
        if (cfg.slotAddress !== undefined) this._slotAddr = parseInt(cfg.slotAddress) || 0;
        ['ch0mode','ch1mode','ch2mode','ch3mode'].forEach((k, i) => {
            if (cfg[k] !== undefined) this.setChannelMode(i, cfg[k]);
        });
        this.config = {
            ...this.config,
            label:       this.label,
            slotAddress: this._slotAddr,
            chModes:     [...this._chModes],
        };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        this.disconnectFromCPU();
        super.destroy?.();
    }
}
