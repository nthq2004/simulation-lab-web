import { BaseComponent } from './BaseComponent.js';

/**
 * 旋转式绝对光电编码器仿真组件
 * （Rotary Absolute Optical Encoder）
 *
 * ── 工作原理 ─────────────────────────────────────────────────
 *  绝对式编码器的码盘上刻有多圈同心光栅码道，
 *  每条码道由透光区（1）和遮光区（0）组成。
 *
 *  光源（LED）发出的光经码盘透过/遮挡后，
 *  被对应的光电探测器（光敏二极管/晶体管）接收，
 *  各码道同时给出一个完整的 n 位数字码字，
 *  唯一对应当前轴的绝对角度位置。
 *
 *  格雷码（Gray Code）优势：
 *    相邻码字之间只有 1 位发生变化，
 *    消除了普通二进制码在码字跳变时的"毛刺误差"。
 *
 *    格雷码 ↔ 二进制转换：
 *      G[n] = B[n] XOR B[n+1]    （二进制 → 格雷码）
 *      B[n] = G[n] XOR G[n+1] XOR ...  （格雷码 → 二进制）
 *
 *  分辨率：
 *    N 位编码器有 2^N 个唯一位置
 *    角度分辨率 = 360° / 2^N
 *
 *  本仿真实现 12 位格雷码绝对编码器（4096 个位置，分辨率 ≈ 0.088°）
 *
 * ── 输出接口 ─────────────────────────────────────────────────
 *  ① 并行输出（Parallel）：12 位 TTL 电平直接输出
 *  ② SSI（同步串行接口）：CLK + DATA，时钟驱动移位输出
 *  ③ 格雷码 / 二进制码切换显示
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 码盘（最内层=MSB，最外层=LSB），可拖拽旋转
 *  ② 光电读头（发射/接收阵列，逐位亮灭）
 *  ③ 码字寄存器（12 位格雷码 + 转换后二进制）
 *  ④ 角度位置仪表盘
 *  ⑤ SSI 时序波形示波器
 *  ⑥ 实时位置角度 + 圈数计数
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_vcc  — 电源
 *  wire_gnd  — 地
 *  wire_clk  — SSI 时钟输入
 *  wire_data — SSI 数据输出
 */
export class AbsoluteEncoder extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 380);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'absolute_encoder';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 编码器参数 ──
        this.bits        = config.bits        || 12;      // 位数（分辨率）
        this.steps       = 1 << this.bits;                // 总步数 2^N
        this.resolution  = 360 / this.steps;              // 角度分辨率 °
        this.maxRpm      = config.maxRpm      || 3000;    // 最大转速
        this.ssiFreqKHz  = config.ssiFreqKHz  || 1000;    // SSI 时钟频率 kHz
        this.codeType    = config.codeType    || 'gray';  // 'gray' | 'binary'
        this.targetId    = config.targetId    || null;

        // ── 状态 ──
        this.angle        = config.initAngle  || 0;       // 当前角度 °（0~360）
        this.turns        = 0;                            // 累计圈数
        this._prevAngle   = 0;
        this.rpm          = 0;
        this.direction    = 1;   // 1=正转 -1=反转
        this._manualAngle = config.initAngle || 0;
        this._manualRpm   = 0;
        this.isBreak      = false;
        this.powered      = true;

        // ── 码字 ──
        this.position    = 0;    // 当前步数（0 ~ 2^N-1）
        this.grayCode    = 0;    // 当前格雷码
        this.binaryCode  = 0;    // 等效二进制
        this.grayBits    = new Uint8Array(this.bits);   // 逐位格雷码
        this.binBits     = new Uint8Array(this.bits);   // 逐位二进制

        // ── SSI 模拟 ──
        this._ssiPhase    = 0;     // SSI 时钟相位 rad
        this._ssiClkState = 0;
        this._ssiDataBit  = 0;    // 当前正在输出的位（0=MSB）
        this._ssiPeriod   = 1 / (this.ssiFreqKHz * 1000); // s
        this._ssiTimer    = 0;
        this._ssiShiftReg = 0;    // SSI 移位寄存器
        this._ssiDataOut  = 0;    // 当前 DATA 引脚电平
        this._ssiBitCount = 0;

        // ── SSI 波形缓冲 ──
        this._ssiWavLen   = 200;
        this._ssiWavClk   = new Uint8Array(this._ssiWavLen).fill(0);
        this._ssiWavData  = new Uint8Array(this._ssiWavLen).fill(0);
        this._ssiWavAcc   = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartX  = 0;
        this._dragStartY  = 0;
        this._dragStartAngle = 0;

        // ── 动画 ──
        this._knobAngle   = 0;
        this._animAngle   = 0;    // 平滑动画角度
        this._lastTs      = null;
        this._animId      = null;
        this.knobs        = {};

        // ── 几何布局 ──
        // 码盘（核心，居中偏左）
        this._diskCX = Math.round(this.width  * 0.33);
        this._diskCY = Math.round(this.height * 0.36);
        this._diskR  = Math.round(Math.min(this.width, this.height) * 0.26);

        // 读头阵列（右侧，垂直排列）
        this._headX  = this._diskCX + this._diskR + 20;
        this._headY  = this._diskCY - this.bits * 9;

        // 码字寄存器（读头下方）
        this._regX   = this._headX - 4;
        this._regY   = this._diskCY + this._diskR * 0.5;
        this._regW   = this.width - this._regX - 8;

        // 仪表盘（右上角）
        this._dialX  = this._headX;
        this._dialY  = 14;
        this._dialW  = this.width - this._headX - 8;
        this._dialH  = this._diskCY - this._diskR - 24;

        // SSI 波形（底部）
        this._ssiX   = 6;
        this._ssiY   = Math.round(this.height * 0.71);
        this._ssiW   = this.width - 12;
        this._ssiH   = Math.round(this.height * 0.24);

        this.config = {
            id: this.id, bits: this.bits,
            maxRpm: this.maxRpm, ssiFreqKHz: this.ssiFreqKHz,
        };

        this._init();

        this.addPort(this.width, this._dialY + 10, 'vcc',  'wire', 'VCC');
        this.addPort(this.width, this._dialY + 28, 'gnd',  'wire', 'GND');
        this.addPort(this.width, this._dialY + 46, 'clk',  'wire', 'CLK');
        this.addPort(this.width, this._dialY + 64, 'data', 'wire', 'DATA');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawDiskBackground();
        this._diskLayer      = new Konva.Group();   // 旋转码盘
        this._highlightLayer = new Konva.Group();   // 读头高亮扇区
        this.group.add(this._diskLayer, this._highlightLayer);
        this._drawReadHead();
        this._drawShaft();
        this._drawInstrDial();
        this._drawCodeRegisters();
        this._drawSSIWaveform();
        this._drawBottomPanel();
        this._setupDragRotation();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `绝对光电编码器（${this.bits}位 格雷码 · ${this.steps}位置）`,
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 码盘背景（外壳 + 固定装饰）─────────
    _drawDiskBackground() {
        const cx = this._diskCX, cy = this._diskCY, R = this._diskR;

        // 外壳边框
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R + 14, fill: '#37474f', stroke: '#263238', strokeWidth: 2.5 }));
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R + 14, fill: 'none', stroke: '#546e7a', strokeWidth: 0.5, dash: [4,4] }));

        // 安装孔
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const bx = cx + (R+9) * Math.cos(a), by = cy + (R+9) * Math.sin(a);
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4.5, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.8 }));
            this.group.add(new Konva.Circle({ x: bx-1, y: by-1, radius: 1.4, fill: 'rgba(255,255,255,0.28)' }));
        }

        // 读头安装板（右侧凹口）
        const headGap = new Konva.Arc({
            x: cx, y: cy, innerRadius: R - 2, outerRadius: R + 14,
            angle: 14, rotation: -7,
            fill: '#2c3e50',
        });
        this.group.add(headGap);

        // 外圈高光
        this.group.add(new Konva.Arc({
            x: cx, y: cy, innerRadius: R+8, outerRadius: R+14,
            angle: 60, rotation: -150,
            fill: 'rgba(255,255,255,0.06)',
        }));
    }

    // ── 旋转码盘（动态，每帧重绘）──────────
    _rebuildDisk() {
        this._diskLayer.destroyChildren();
        const cx = 0, cy = 0;     // 以旋转组原点为中心
        const R  = this._diskR;
        const N  = this.bits;

        // 码盘基底
        this._diskLayer.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#f5f5f5', stroke: '#ccc', strokeWidth: 0.5 }));

        // 每一位对应一圈码道（由内到外 = MSB to LSB）
        for (let bit = 0; bit < N; bit++) {
            const innerR = R * (0.14 + bit * 0.80 / N);
            const outerR = R * (0.14 + (bit + 1) * 0.80 / N);
            const sectors = 1 << (bit + 1);            // 该码道扇区数

            // Gray code 在该位上的分布
            for (let sec = 0; sec < sectors; sec++) {
                const gray = this._binToGray(sec);
                const bitVal = (gray >> (N - 1 - bit)) & 1;
                // 不使用bitVal因为这是sector-to-bit的映射
                // 正确方式：第bit位的码道，在角度sec/sectors处的值
                const grayVal = (sec >> 0) & 1;   // 基础交替

                // 真正的 Gray code 码道：第bit位，一共 2^(bit+1) 个扇区，每个扇区交替
                // Gray code 第 k 位码道：在位置 n (0..2^(k+1)-1) 处的值
                // = floor(n / 2^k) mod 2 ... 根据格雷码定义
                const gVal = this._grayBitAtSector(bit, sec, sectors);
                const startAngle = (sec / sectors) * 360 - 90;
                const sweepAngle = 360 / sectors;

                this._diskLayer.add(new Konva.Arc({
                    x: cx, y: cy,
                    innerRadius: innerR + 0.5, outerRadius: outerR - 0.5,
                    angle: sweepAngle - 0.3,
                    rotation: startAngle,
                    fill: gVal ? '#0a0a0a' : '#f0f0f0',
                    stroke: '#888', strokeWidth: 0.15,
                }));
            }
        }

        // 轴承盖（中心小圆）
        this._diskLayer.add(new Konva.Circle({ x: cx, y: cy, radius: R * 0.13, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5 }));
        this._diskLayer.add(new Konva.Circle({ x: cx, y: cy, radius: R * 0.07, fill: '#37474f' }));
        // 键槽标记（角度=0 的参考线）
        this._diskLayer.add(new Konva.Line({
            points: [0, -R*0.07, 0, -R*0.13],
            stroke: '#ffeb3b', strokeWidth: 1.5, lineCap: 'round',
        }));
    }

    // 获取第 bit 位码道在第 sec 扇区处的灰码值
    _grayBitAtSector(bit, sec, totalSectors) {
        // 码道 bit（0=MSB）对应 2^(bit+1) 个独立扇区
        // 在 totalSectors 个扇区中，每个重复块包含 totalSectors/(2^(bit+1)) 个格
        const blockSize = totalSectors >> (bit + 1);    // 每个1或0段的扇区数
        const blockIdx  = Math.floor(sec / blockSize);  // 当前块编号
        // 格雷码第 bit 位 = 两位格雷码中间位 → 每隔 2 块翻转一次（MSB 变换慢）
        return Math.floor(blockIdx / 2) % 2 === 0 ? (blockIdx % 2) : (1 - blockIdx % 2);
    }

    // 二进制 → 格雷码
    _binToGray(n) { return n ^ (n >> 1); }

    // 格雷码 → 二进制（逐位 XOR）
    _grayToBin(g) {
        let b = 0, mask = g;
        while (mask) { b ^= mask; mask >>= 1; }
        return b;
    }

    // ── 读头阵列（固定，不随码盘旋转）──────
    _drawReadHead() {
        const cx = this._diskCX, cy = this._diskCY, R = this._diskR;
        const N  = this.bits;

        // 读头背板
        const headBg = new Konva.Rect({
            x: cx + R - 4, y: cy - N * 9.5,
            width: 14, height: N * 19,
            fill: '#1a2634', stroke: '#0d1520', strokeWidth: 1, cornerRadius: 2,
        });
        this.group.add(headBg);

        this._readLeds = [];
        for (let bit = 0; bit < N; bit++) {
            // 每条码道对应一个 LED 读头（MSB在上）
            const innerR = R * (0.14 + bit * 0.80 / N);
            const outerR = R * (0.14 + (bit + 1) * 0.80 / N);
            const trackR = (innerR + outerR) / 2;

            // 读头探针（水平线，指向码道）
            this.group.add(new Konva.Line({
                points: [cx + R - 4, cy - N*9.5 + bit*19 + 9, cx + trackR, cy],
                stroke: 'rgba(100,150,200,0.12)', strokeWidth: 0.6, dash: [2,3],
            }));

            // 发光 LED 探头
            const led = new Konva.Circle({
                x: cx + R, y: cy - N*9.5 + bit*19 + 9,
                radius: 4.5,
                fill: '#1a1a1a', stroke: '#263238', strokeWidth: 0.8,
            });
            this._readLeds.push(led);
            this.group.add(led);

            // 位号标注
            this.group.add(new Konva.Text({
                x: cx + R + 7, y: cy - N*9.5 + bit*19 + 5,
                text: `B${N-1-bit}`,
                fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#546e7a',
            }));
        }

        // 标注
        this.group.add(new Konva.Text({
            x: cx + R - 4, y: cy - N*9.5 - 14,
            text: '光电读头', fontSize: 9, fontStyle: 'bold', fill: '#4fc3f7',
        }));

        // 读头高亮指示扇形
        this._readAngleIndicator = new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R * 0.12, outerRadius: R,
            angle: 3, rotation: -90 - 1.5,
            fill: 'rgba(79,195,247,0.12)',
            stroke: 'rgba(79,195,247,0.6)', strokeWidth: 0.8,
        });
        this.group.add(this._readAngleIndicator);
    }

    // ── 转轴 ─────────────────────────────────
    _drawShaft() {
        const cx = this._diskCX, cy = this._diskCY;
        // 转轴延伸到外壳下方
        this.group.add(new Konva.Line({ points: [cx, cy + this._diskR + 14, cx, cy + this._diskR + 36], stroke: '#78909c', strokeWidth: 6, lineCap: 'round' }));
        this.group.add(new Konva.Line({ points: [cx - 8, cy + this._diskR + 36, cx + 8, cy + this._diskR + 36], stroke: '#546e7a', strokeWidth: 2 }));
        this.group.add(new Konva.Text({ x: cx - 18, y: cy + this._diskR + 40, text: '输入轴', fontSize: 9, fill: '#607d8b' }));
        // 拖拽提示
        this.group.add(new Konva.Text({ x: cx - 26, y: cy + this._diskR + 56, text: '⟳ 拖动旋转', fontSize: 9, fill: '#546e7a' }));
    }

    // ── 角度仪表盘（右上）────────────────────
    _drawInstrDial() {
        const dx = this._dialX, dy = this._dialY;
        const dw = this._dialW, dh = this._dialH;

        const bg = new Konva.Rect({ x: dx, y: dy, width: dw, height: dh, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        this.group.add(new Konva.Text({ x: dx+2, y: dy+3, width: dw-4, text: `绝对编码器  ${this.bits}bit  ÷${this.steps}`, fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        this._dialAngle = new Konva.Text({
            x: dx + 4, y: dy + 16, width: dw - 8,
            text: '000.000°', fontSize: 20,
            fontFamily: 'Courier New, monospace', fontStyle: 'bold',
            fill: '#00e5ff', align: 'center',
        });
        this._dialTurns = new Konva.Text({
            x: dx + 4, y: dy + 38, width: dw - 8,
            text: '圈数: 0', fontSize: 10,
            fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'center',
        });
        this._dialPos = new Konva.Text({
            x: dx + 4, y: dy + 52, width: dw - 8,
            text: `位置: 0 / ${this.steps}`, fontSize: 9,
            fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center',
        });
        this._dialRes = new Konva.Text({
            x: dx + 4, y: dy + 65, width: dw - 8,
            text: `分辨率: ${this.resolution.toFixed(4)}°`, fontSize: 8.5,
            fontFamily: 'Courier New, monospace', fill: '#263238', align: 'center',
        });

        this.group.add(bg, this._dialAngle, this._dialTurns, this._dialPos, this._dialRes);
    }

    // ── 码字寄存器显示 ───────────────────────
    _drawCodeRegisters() {
        const rx = this._regX, ry = this._regY;
        const rw = this.width - rx - 6;
        const N  = this.bits;

        const bg = new Konva.Rect({ x: rx, y: ry, width: rw, height: 80, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.2, cornerRadius: 3 });
        this.group.add(new Konva.Text({ x: rx + 4, y: ry + 3, text: '码字寄存器', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7' }));

        // 格雷码标题
        this.group.add(new Konva.Text({ x: rx + 4, y: ry + 16, text: 'GRAY:', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#80cbc4' }));
        // 二进制标题
        this.group.add(new Konva.Text({ x: rx + 4, y: ry + 40, text: 'BIN: ', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#ffd54f' }));
        // 十六进制
        this.group.add(new Konva.Text({ x: rx + 4, y: ry + 62, text: 'HEX: ', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#a5d6a7' }));

        // 逐位 LED 指示（格雷码）
        this._grayLeds   = [];
        this._binLeds    = [];
        const bitW = Math.min(12, (rw - 50) / N);
        for (let bit = 0; bit < N; bit++) {
            const bx = rx + 40 + bit * bitW;

            // 格雷码 LED
            const gLed = new Konva.Rect({ x: bx, y: ry + 14, width: bitW - 1, height: 10, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 0.5, cornerRadius: 1 });
            this._grayLeds.push(gLed);
            this.group.add(gLed);

            // 二进制 LED
            const bLed = new Konva.Rect({ x: bx, y: ry + 38, width: bitW - 1, height: 10, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 0.5, cornerRadius: 1 });
            this._binLeds.push(bLed);
            this.group.add(bLed);
        }

        // 十六进制值标签
        this._hexLabel = new Konva.Text({ x: rx + 40, y: ry + 62, text: '0x000', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#a5d6a7' });
        this._decLabel = new Konva.Text({ x: rx + 80, y: ry + 62, text: '(0)', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#37474f' });

        this.group.add(bg, this._hexLabel, this._decLabel);
    }

    // ── SSI 时序波形 ────────────────────────
    _drawSSIWaveform() {
        const { _ssiX: sx, _ssiY: sy, _ssiW: sw, _ssiH: sh } = this;

        const bg = new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: sx, y: sy, width: sw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: sx+4, y: sy+2, width: sw-8, text: `SSI 同步串行接口  CLK=${this.ssiFreqKHz}kHz  DATA=格雷码`, fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [sx, sy+sh*i/3, sx+sw, sy+sh*i/3], stroke: 'rgba(79,195,247,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 5; i++) this.group.add(new Konva.Line({ points: [sx+sw*i/5, sy, sx+sw*i/5, sy+sh], stroke: 'rgba(79,195,247,0.05)', strokeWidth: 0.5 }));

        this._ssiMidClk  = sy + sh * 0.24;
        this._ssiMidData = sy + sh * 0.72;

        [this._ssiMidClk, this._ssiMidData].forEach(my => {
            this.group.add(new Konva.Line({ points: [sx+2, my, sx+sw-2, my], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._ssiLineClk  = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.6, lineJoin: 'miter', lineCap: 'square' });
        this._ssiLineData = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.6, lineJoin: 'miter', lineCap: 'square' });

        this.group.add(new Konva.Text({ x: sx+4, y: sy+16, text: 'CLK', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7' }));
        this.group.add(new Konva.Text({ x: sx+4, y: sy+sh/2+4, text: 'DATA', fontSize: 8, fontStyle: 'bold', fill: '#ff8f00' }));

        this._ssiPositionLbl = new Konva.Text({ x: sx+sw-110, y: sy+16, width: 106, text: 'POS=0', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#00e5ff', align: 'right' });
        this._ssiBitLbl      = new Konva.Text({ x: sx+sw-110, y: sy+26, width: 106, text: 'BIT=--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'right' });

        this.group.add(bg, titleBg, this._ssiLineClk, this._ssiLineData, this._ssiPositionLbl, this._ssiBitLbl);
    }

    // ── 底部面板 ─────────────────────────────
    _drawBottomPanel() {
        // pass（面板文字由 _tickDisplay 动态更新，在 canvas 底部）
    }

    // ── 拖拽旋转 ─────────────────────────────
    _setupDragRotation() {
        const cx = this._diskCX, cy = this._diskCY, R = this._diskR;
        const hitZone = new Konva.Circle({ x: cx, y: cy, radius: R + 14, fill: 'transparent', listening: true });

        hitZone.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const pos = this._getEventPos(e);
            this._dragStartX = pos.x - cx;
            this._dragStartY = pos.y - cy;
            this._dragStartAngle = this._manualAngle;
            this._dragActive = true;
        });

        const onMove = (e) => {
            if (!this._dragActive) return;
            const pos = this._getEventPos(e);
            const dx  = pos.x - cx, dy = pos.y - cy;
            const startA = Math.atan2(this._dragStartY, this._dragStartX) * 180 / Math.PI;
            const currA  = Math.atan2(dy, dx) * 180 / Math.PI;
            let delta = currA - startA;
            // 更新拖拽起点，实现连续旋转
            this._dragStartX = dx; this._dragStartY = dy;
            this._manualAngle = ((this._manualAngle + delta) % 360 + 360) % 360;
        };

        const onUp = () => { this._dragActive = false; };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('mouseup',   onUp);
        window.addEventListener('touchend',  onUp);

        this.group.add(hitZone);
    }

    _getEventPos(e) {
        const stage = this.group.getStage?.();
        if (!stage) return { x: e.evt?.clientX ?? 0, y: e.evt?.clientY ?? 0 };
        return stage.getPointerPosition() ?? { x: 0, y: 0 };
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickDiskRender();
                this._tickCodeUpdate();
                this._tickReadLeds();
                this._tickSSI(dt);
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 物理更新 ─────────────────────────────
    _tickPhysics(dt) {
        // 来自外部绑定
        let targetAngle = this._manualAngle;
        if (this.targetId && this.sys?.comps?.[this.targetId]) {
            const tgt = this.sys.comps[this.targetId];
            if (typeof tgt.angle === 'number') targetAngle = tgt.angle;
        }

        // 如果有 rpm，自动旋转
        if (this._manualRpm > 0 && !this._dragActive) {
            const dps = (this._manualRpm / 60) * 360 * this.direction;
            this._manualAngle = ((this._manualAngle + dps * dt) % 360 + 360) % 360;
            targetAngle = this._manualAngle;
        }

        const prevAngle = this.angle;
        this.angle = ((targetAngle % 360) + 360) % 360;

        // 圈数计数（越过0°）
        const delta = this.angle - prevAngle;
        if (delta < -180)       this.turns += this.direction;
        else if (delta >  180)  this.turns -= this.direction;

        // 位置码（0 ~ 2^N-1）
        this.position = Math.floor((this.angle / 360) * this.steps) % this.steps;

        // 格雷码
        this.grayCode   = this._binToGray(this.position);
        this.binaryCode = this.position;

        // 逐位提取
        for (let i = 0; i < this.bits; i++) {
            const bitIdx = this.bits - 1 - i;    // MSB first
            this.grayBits[i] = (this.grayCode   >> bitIdx) & 1;
            this.binBits[i]  = (this.binaryCode >> bitIdx) & 1;
        }

        // 读头指示线更新
        if (this._readAngleIndicator) {
            this._readAngleIndicator.rotation(this.angle - 90 - 1.5);
        }
    }

    // ── 码盘渲染（旋转组） ────────────────────
    _tickDiskRender() {
        // 重建码盘（首次或每帧仅更新旋转角）
        if (!this._diskBuilt) {
            this._diskBuilt = true;
            this._diskLayer.x(this._diskCX);
            this._diskLayer.y(this._diskCY);
            this._rebuildDisk();
        }
        // 旋转码盘组
        this._diskLayer.rotation(this.angle);

        // 更新读头高亮扇形：当前读取的扇区（蓝色扇形）
        this._highlightLayer.destroyChildren();
        const cx = this._diskCX, cy = this._diskCY, R = this._diskR;
        const secAngle = 360 / this.steps;
        // 在码盘（旋转）坐标系里，读头位置在 0°（右侧），
        // 码盘旋转了 this.angle，所以读头在码盘坐标系中在 -this.angle
        const readAngleInDisk = -this.angle;
        this._highlightLayer.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R * 0.12, outerRadius: R * 0.98,
            angle: secAngle + 1,
            rotation: readAngleInDisk - secAngle / 2 - 90,
            fill: 'rgba(79,195,247,0.08)',
            stroke: 'rgba(79,195,247,0.4)', strokeWidth: 0.8,
        }));
    }

    // ── 码字更新 ─────────────────────────────
    _tickCodeUpdate() {
        // 更新格雷码 LED
        for (let i = 0; i < this.bits; i++) {
            const g = this.grayBits[i];
            const b = this.binBits[i];
            if (this._grayLeds[i]) this._grayLeds[i].fill(g ? '#00e5ff' : '#0a1520');
            if (this._binLeds[i])  this._binLeds[i].fill(b  ? '#ffd54f' : '#0a1520');
        }
        // 十六进制
        if (this._hexLabel) this._hexLabel.text(`0x${this.grayCode.toString(16).toUpperCase().padStart(3, '0')}`);
        if (this._decLabel) this._decLabel.text(`(${this.position})`);
    }

    // ── 读头 LED（光强随对应码道透光变化）────
    _tickReadLeds() {
        for (let bit = 0; bit < this.bits; bit++) {
            if (!this._readLeds[bit]) continue;
            const gBit = this.grayBits[bit];   // 当前格雷码该位
            if (this.isBreak) {
                this._readLeds[bit].fill('#1a1a1a');
            } else {
                this._readLeds[bit].fill(gBit ? '#00e5ff' : '#1a2634');
            }
        }
    }

    // ── SSI 接口模拟 ──────────────────────────
    _tickSSI(dt) {
        // SSI 自动循环输出
        this._ssiTimer += dt;
        const halfPeriod = this._ssiPeriod / 2;

        // 帧首：载入移位寄存器
        const bitsPerFrame = this.bits + 2;   // + 2 bit 间隔
        const frameTime    = this._ssiPeriod * bitsPerFrame;
        const framePhase   = (this._ssiTimer % frameTime) / frameTime;
        const bitPhase     = Math.floor(framePhase * bitsPerFrame);

        if (bitPhase < this.bits) {
            this._ssiDataOut  = this.grayBits[bitPhase] ?? 0;
            this._ssiClkState = Math.floor((framePhase * bitsPerFrame * 2) % 2);
            this._ssiBitCount = bitPhase;
        } else {
            this._ssiDataOut  = 0;
            this._ssiClkState = 0;
            this._ssiBitCount = -1;
        }

        // 波形缓冲滚动
        this._ssiWavAcc += 1.5 * dt * this._ssiWavLen;
        const steps = Math.floor(this._ssiWavAcc);
        this._ssiWavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._ssiWavClk  = new Uint8Array([...this._ssiWavClk.slice(1),  this._ssiClkState]);
            this._ssiWavData = new Uint8Array([...this._ssiWavData.slice(1), this._ssiDataOut]);
        }

        // 绘制 SSI 波形
        const sx = this._ssiX + 3, sy = this._ssiY;
        const sw = this._ssiW - 6, sh = this._ssiH;
        const n  = this._ssiWavLen, dx = sw / n;
        const hiC = this._ssiMidClk  - sh * 0.11;
        const loC = this._ssiMidClk  + sh * 0.11;
        const hiD = this._ssiMidData - sh * 0.11;
        const loD = this._ssiMidData + sh * 0.11;

        const clkPts = [], datPts = [];
        let prevC = this._ssiWavClk[0],  prevD = this._ssiWavData[0];
        clkPts.push(sx, prevC ? hiC : loC);
        datPts.push(sx, prevD ? hiD : loD);

        for (let i = 1; i < n; i++) {
            const vc = this._ssiWavClk[i], vd = this._ssiWavData[i];
            const x  = sx + i * dx;
            const yc = vc ? hiC : loC, yd = vd ? hiD : loD;
            if (vc !== prevC) { clkPts.push(x, prevC ? hiC : loC); clkPts.push(x, yc); }
            else clkPts.push(x, yc);
            if (vd !== prevD) { datPts.push(x, prevD ? hiD : loD); datPts.push(x, yd); }
            else datPts.push(x, yd);
            prevC = vc; prevD = vd;
        }

        if (this._ssiLineClk)  this._ssiLineClk.points(clkPts);
        if (this._ssiLineData) this._ssiLineData.points(datPts);

        if (this._ssiPositionLbl) this._ssiPositionLbl.text(`POS=${this.position}`);
        if (this._ssiBitLbl) this._ssiBitLbl.text(this._ssiBitCount >= 0 ? `B${this.bits-1-this._ssiBitCount}=${this._ssiDataOut}` : 'IDLE');
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        if (this._dialAngle) this._dialAngle.text(`${this.angle.toFixed(3)}°`);
        if (this._dialTurns) this._dialTurns.text(`圈数: ${this.turns}`);
        if (this._dialPos)   this._dialPos.text(`位置: ${this.position} / ${this.steps}`);

        // 仪表盘颜色
        if (this._dialAngle) {
            this._dialAngle.fill(this.isBreak ? '#ef5350' : '#00e5ff');
        }
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(angle, rpm) {
        if (typeof angle === 'number') this._manualAngle = ((angle % 360) + 360) % 360;
        if (typeof rpm   === 'number') this._manualRpm   = Math.max(0, rpm);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'id',          type: 'text'   },
            { label: '编码位数 N',        key: 'bits',        type: 'number' },
            { label: 'SSI 时钟频率(kHz)', key: 'ssiFreqKHz',  type: 'number' },
            { label: '最大转速 (rpm)',    key: 'maxRpm',      type: 'number' },
            { label: '绑定轴组件 ID',     key: 'targetId',    type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.ssiFreqKHz = parseFloat(cfg.ssiFreqKHz) || this.ssiFreqKHz;
        this.maxRpm     = parseFloat(cfg.maxRpm)     || this.maxRpm;
        this.targetId   = cfg.targetId   || null;
        this.config     = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}
