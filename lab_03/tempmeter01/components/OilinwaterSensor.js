import { BaseComponent } from './BaseComponent.js';

/**
 * 水中含油量超声波检测传感器 仿真组件
 * （Ultrasonic Oil-in-Water Detection Sensor）
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * 结构说明（参照图片）：
 *
 *  整体为插入式探头结构，从左至右分为：
 *
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  [传感器探头外壳]              [电缆接头/螺纹段] [控制单元]  │
 *  │  ┌──────────────────────┐  ╔═══╗  ┌──────────┐             │
 *  │  │ ▐█▌   ~~~wave~~~  ▐█▌│  ║///║  │ 控制单元 │→ 继电器    │
 *  │  │发射  超声波传播路径 接收│  ║///║  └──────────┘             │
 *  │  │晶体               晶体│  ╚═══╝       ↕ 同轴电缆          │
 *  │  └──────────────────────┘                                    │
 *  │         ↑                                                    │
 *  │     液体介质（水/含油水）                                    │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  1. 控制单元产生高频电信号（典型 1~5 MHz）
 *  2. 通过同轴电缆传送至发射压电晶体
 *  3. 发射晶体将电信号转换为超声波振荡，穿越液体介质
 *  4. 接收晶体将接收到的超声波转换回电信号
 *  5. 控制单元比较发射信号与接收信号的幅值衰减量：
 *     - 纯水：衰减小 → 接收信号强 → 正常
 *     - 含油水：衰减大 → 接收信号弱/消失 → 触发报警
 *  6. 报警阈值：接收信号强度低于参考值的 30% 时输出报警
 *  7. 继电器输出：常开→报警时闭合，联锁停炉保护
 *
 * ── 超声波衰减模型 ────────────────────────────────────────────
 *
 *  接收信号强度：
 *    I = I₀ · exp(−α · L)
 *    I₀  — 发射信号强度（归一化为 1.0）
 *    α   — 衰减系数（dB/cm），与含油量正相关
 *    L   — 声程（两晶体间距，固定值约 20mm）
 *
 *  衰减系数模型：
 *    α_water  ≈ 0.002 dB/cm（纯水，极小衰减）
 *    α_oil    ≈ 0.15  dB/cm（含油10%时）
 *    α_emuls  ≈ 0.35  dB/cm（乳状液，严重）
 *    α(C) = α_water + (α_oil - α_water) × C_oil / 100
 *    C_oil — 含油体积百分比（0~100%）
 *
 *  报警判据：
 *    I < I_alarm（默认 0.30，即衰减超过 70%）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *  • 超声波从发射晶体向接收晶体传播的动态波纹
 *  • 波纹振幅随接收信号强度变化（含油多时波纹衰减消失）
 *  • 液体介质颜色随含油量变化（清澈→浑浊黄褐色）
 *  • 控制单元信号强度柱状指示
 *  • 继电器状态动态显示
 *  • 报警时红色闪烁
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_coax_tx   — 同轴电缆发射端（高频激励信号输出）
 *  port_coax_rx   — 同轴电缆接收端（衰减信号输入）
 *  port_relay_no  — 继电器常开触点
 *  port_relay_nc  — 继电器常闭触点
 *  port_alarm_out — 报警信号（4~20mA 或数字量）
 */
export class OilInWaterSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 面板尺寸（横向，参照图片比例约 5:3）──
        this.width  = Math.max(480, config.width  || 580);
        this.height = Math.max(290, config.height || 350);

        this.type    = 'oil_in_water_sensor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌 ──
        this.label   = config.label || 'OIL-DET-01';
        this.model   = config.model || 'USO-200';

        // ── 传感器参数 ──
        this.soundPath  = config.soundPath || 20;    // mm，声程（两晶体间距）
        this.freq       = config.freq      || 2.0;   // MHz，超声波频率
        this.alarmLevel = config.alarmLevel!== undefined ? config.alarmLevel : 0.30; // 报警阈值（信号强度比）

        // ── 衰减系数 ──
        this._alphaWater = 0.002;  // dB/cm 纯水
        this._alphaOil   = 0.150;  // dB/cm 油膜
        this._alphaMax   = 0.400;  // dB/cm 乳状液/高浓度

        // ── 运行状态 ──
        this._powered      = config.powered !== false; // 默认上电
        this._oilContent   = config.initOil !== undefined ? config.initOil : 0; // % 初始含油量
        this._signalTx     = 1.0;   // 发射信号强度（归一化）
        this._signalRx     = 1.0;   // 接收信号强度（归一化，动态计算）
        this._attenuation  = 0.0;   // 当前衰减系数
        this._alarming     = false;  // 报警状态
        this._relayOn      = false;  // 继电器状态（报警时闭合）
        this._ackPending   = false;  // 待确认报警

        // ── 含油量仿真 ──
        this._oilTarget    = this._oilContent;  // 目标含油量（仿真慢变化）
        this._oilTau       = 8;    // s，含油量变化惯性

        // ── 动画参数 ──
        this._wavePhase    = 0;    // 超声波动画相位
        this._waveSpeed    = 3.0;  // rad/s
        this._blinkPhase   = 0;

        // ── 同轴电缆信号历史（用于示波器波形）──
        this._txHistory    = new Array(60).fill(0);
        this._rxHistory    = new Array(60).fill(0);
        this._histIdx      = 0;
        this._histTimer    = 0;

        this._computeLayout();
        this._init();
        this._addPorts();
    }

    // ═══════════════════════════════════════════
    _computeLayout() {
        const W = this.width, H = this.height;
        const pad = 8;

        // 标题栏
        this._titleH = H * 0.08;

        // 主视图区（传感器探头截面图）
        this._probeX = pad;
        this._probeY = this._titleH + pad;
        this._probeW = W * 0.56;
        this._probeH = H * 0.52;

        // 液体介质区（探头内部液腔）
        const px = this._probeX, py = this._probeY;
        const pw = this._probeW, ph = this._probeH;
        this._liquidX = px + pw * 0.08;
        this._liquidY = py + ph * 0.20;
        this._liquidW = pw * 0.78;
        this._liquidH = ph * 0.60;

        // 两个晶体位置
        const crystalW = pw * 0.09;
        const crystalH = ph * 0.42;
        this._txCrystalX = this._liquidX + pw * 0.01;
        this._rxCrystalX = this._liquidX + this._liquidW - crystalW - pw * 0.01;
        this._crystalY   = this._liquidY + (this._liquidH - crystalH) / 2;
        this._crystalW   = crystalW;
        this._crystalH   = crystalH;

        // 超声波传播路径
        this._waveStartX = this._txCrystalX + crystalW;
        this._waveEndX   = this._rxCrystalX;
        this._waveCY     = this._liquidY + this._liquidH / 2;

        // 螺纹/电缆接头区域（探头右侧）
        this._cableX     = px + pw * 0.87;
        this._cableY     = py + ph * 0.15;
        this._cableW     = pw * 0.18;
        this._cableH     = ph * 0.70;

        // 控制单元（右上）
        this._ctrlX      = W * 0.60;
        this._ctrlY      = this._probeY;
        this._ctrlW      = W * 0.37;
        this._ctrlH      = H * 0.38;

        // 信号强度显示区（控制单元内部）
        this._sigBarX    = this._ctrlX + this._ctrlW * 0.10;
        this._sigBarY    = this._ctrlY + this._ctrlH * 0.28;
        this._sigBarW    = this._ctrlW * 0.80;
        this._sigBarH    = this._ctrlH * 0.32;

        // 继电器区域（控制单元右侧）
        this._relayX     = W * 0.92;
        this._relayY     = this._ctrlY + this._ctrlH * 0.15;

        // 波形显示区（下方）
        this._scopeX     = pad;
        this._scopeY     = this._probeY + this._probeH + pad;
        this._scopeW     = W - pad * 2;
        this._scopeH     = H - this._scopeY - pad;

        // 含油量调节区（波形区右侧）
        this._sliderX    = W * 0.72;
        this._sliderY    = this._scopeY;
        this._sliderW    = W * 0.26;
        this._sliderH    = this._scopeH;
    }

    // ── 全量初始化 ────────────────────────────
    _init() {
        this._drawBackground();
        this._drawTitle();
        this._drawProbeCrossSection();
        this._drawControlUnit();
        this._drawWaveformScope();
        this._drawOilSlider();
        
    }

    // ── 背景 ─────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        this.group.add(new Konva.Rect({
            x: 3, y: 3, width: W, height: H,
            fill: 'rgba(0,0,0,0.3)', cornerRadius: 5,
        }));
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: W, y: H },
            fillLinearGradientColorStops: [0, '#1c2a38', 0.5, '#182230', 1, '#101820'],
            stroke: '#0a1420', strokeWidth: 2, cornerRadius: 4,
        }));
    }

    // ── 标题栏 ───────────────────────────────
    _drawTitle() {
        const W = this.width;
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: this._titleH,
            fill: 'rgba(0,180,255,0.10)', cornerRadius: [4, 4, 0, 0],
        }));
        this.group.add(new Konva.Text({
            x: 0, y: 2, width: W * 0.55,
            text: '水中含油量检测传感器',
            fontSize: 11, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial, sans-serif',
            fill: '#60d0ff', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: W * 0.55, y: 2, width: W * 0.22,
            text: this.model,
            fontSize: 10, fontFamily: 'Arial, sans-serif',
            fill: '#4090b0', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: W * 0.77, y: 2, width: W * 0.22,
            text: this.label,
            fontSize: 10, fontStyle: 'bold', fontFamily: 'Arial',
            fill: '#40c0a0', align: 'center',
        }));
    }

    // ── 探头横截面视图 ───────────────────────
    _drawProbeCrossSection() {
        const px = this._probeX, py = this._probeY;
        const pw = this._probeW, ph = this._probeH;

        // 探头外壳背景
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw * 0.90, height: ph,
            fill: '#1a2838', stroke: '#2a5070', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 探头外壳框（不锈钢感）
        this.group.add(new Konva.Rect({
            x: px + 2, y: py + ph * 0.08,
            width: pw * 0.85, height: ph * 0.84,
            fill: 'transparent',
            stroke: '#4a7a9a', strokeWidth: 2, cornerRadius: 2,
        }));

        // ── 液体介质区 ──
        const lx = this._liquidX, ly = this._liquidY;
        const lw = this._liquidW, lh = this._liquidH;

        // 液体背景（初始为水色，后动态更新）
        this._liquidRect = new Konva.Rect({
            x: lx, y: ly, width: lw, height: lh,
            fill: '#1a4060',
            stroke: '#2a6080', strokeWidth: 0.8,
        });
        this.group.add(this._liquidRect);

        // 液面波纹（3条静态水平线，仿水面纹理）
        this._waterLines = [];
        for (let i = 0; i < 3; i++) {
            const wly = ly + lh * (0.25 + i * 0.25);
            const wl = new Konva.Line({
                points: this._buildWaterLinePoints(lx, lx + lw, wly, 0),
                stroke: 'rgba(80,180,220,0.25)',
                strokeWidth: 0.8, tension: 0.4, listening: false,
            });
            this.group.add(wl);
            this._waterLines.push({ line: wl, baseY: wly });
        }

        // ── 发射晶体（左侧黑色矩形块）──
        const txX = this._txCrystalX;
        const ryC = this._crystalY;
        const cw  = this._crystalW, ch = this._crystalH;

        // 晶体座（灰色金属）
        this.group.add(new Konva.Rect({
            x: txX - 4, y: ryC - 2, width: cw + 4, height: ch + 4,
            fill: '#304050', stroke: '#203040', strokeWidth: 1,
        }));
        // 晶体面（深黑色压电陶瓷）
        this._txCrystalShape = new Konva.Rect({
            x: txX, y: ryC, width: cw, height: ch,
            fill: '#101820',
            stroke: '#1a5080', strokeWidth: 1.2,
        });
        this.group.add(this._txCrystalShape);
        // 发射状态高光
        this._txGlow = new Konva.Rect({
            x: txX + cw - 2, y: ryC + 2, width: 3, height: ch - 4,
            fill: 'rgba(0,200,255,0)',
        });
        this.group.add(this._txGlow);
        // 标注
        this.group.add(new Konva.Text({
            x: txX - 2, y: ryC + ch + 4,
            text: '发射\n晶体', fontSize: 7,
            fill: '#60a0c0', fontFamily: 'SimHei, Arial',
            align: 'center', width: cw + 4,
        }));

        // ── 接收晶体（右侧）──
        const rxX = this._rxCrystalX;
        this.group.add(new Konva.Rect({
            x: rxX, y: ryC - 2, width: cw + 4, height: ch + 4,
            fill: '#304050', stroke: '#203040', strokeWidth: 1,
        }));
        this._rxCrystalShape = new Konva.Rect({
            x: rxX, y: ryC, width: cw, height: ch,
            fill: '#101820',
            stroke: '#1a5080', strokeWidth: 1.2,
        });
        this.group.add(this._rxCrystalShape);
        this._rxGlow = new Konva.Rect({
            x: rxX - 1, y: ryC + 2, width: 3, height: ch - 4,
            fill: 'rgba(0,255,160,0)',
        });
        this.group.add(this._rxGlow);
        this.group.add(new Konva.Text({
            x: rxX - 2, y: ryC + ch + 4,
            text: '接收\n晶体', fontSize: 7,
            fill: '#60a0c0', fontFamily: 'SimHei, Arial',
            align: 'center', width: cw + 4,
        }));

        // ── 超声波传播路径标注（虚线框）──
        this.group.add(new Konva.Rect({
            x: txX + cw, y: ly + lh * 0.15,
            width: rxX - txX - cw, height: lh * 0.70,
            fill: 'transparent',
            stroke: 'rgba(100,200,255,0.20)',
            strokeWidth: 0.8, dash: [4, 3],
        }));

        // 路径文字标注（上方）
        this.group.add(new Konva.Text({
            x: px, y: py + 4, width: pw * 0.80,
            text: '超声波束可以传递至接收晶体',
            fontSize: 7.5, fill: 'rgba(120,200,240,0.70)',
            fontFamily: 'SimHei, Arial', align: 'center',
        }));

        // ── 超声波动画波形（动态绘制，占位层）──
        this._waveLines = [];
        const waveCount = 8;
        for (let i = 0; i < waveCount; i++) {
            const wl = new Konva.Line({
                points: [this._waveStartX, this._waveCY, this._waveEndX, this._waveCY],
                stroke: 'rgba(0,200,255,0.6)',
                strokeWidth: 1.2, tension: 0.5, listening: false,
            });
            this.group.add(wl);
            this._waveLines.push(wl);
        }

        // ── 螺纹接头（探头右侧，仿图片螺纹外形）──
        this._drawCableConnector();

        // ── 同轴电缆连线（从控制单元到晶体）──
        this._drawCoaxCables(px, py, pw, ph);
    }

    // ── 螺纹电缆接头（图片右侧弹簧螺旋段）────
    _drawCableConnector() {
        const cx = this._cableX, cy = this._cableY;
        const cw = this._cableW, ch = this._cableH;

        // 接头外壳
        this.group.add(new Konva.Rect({
            x: cx, y: cy, width: cw * 1.2, height: ch,
            fill: '#283848', stroke: '#3a6080', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 螺旋纹（10圈）
        const coilCount = 10;
        const coilH     = ch / coilCount;
        for (let i = 0; i < coilCount; i++) {
            const oy = cy + i * coilH;
            this.group.add(new Konva.Line({
                points: [
                    cx, oy + coilH * 0.5,
                    cx + cw * 0.3,  oy,
                    cx + cw * 0.9,  oy,
                    cx + cw * 1.2,  oy + coilH * 0.5,
                    cx + cw * 0.9,  oy + coilH,
                    cx + cw * 0.3,  oy + coilH,
                    cx, oy + coilH * 0.5,
                ],
                stroke: '#4a7090', strokeWidth: 0.9,
                closed: false, tension: 0.3, listening: false,
            }));
        }

        // 端盖
        this.group.add(new Konva.Rect({
            x: cx + cw * 1.2, y: cy + ch * 0.15,
            width: cw * 0.15, height: ch * 0.70,
            fill: '#3a5868', stroke: '#2a4858', strokeWidth: 1,
        }));
    }

    // ── 同轴电缆连线 ─────────────────────────
    _drawCoaxCables(px, py, pw, ph) {
        const ctrlMidX = this._ctrlX + this._ctrlW / 2;
        const ctrlBotY = this._ctrlY + this._ctrlH;
        const txTopY   = this._crystalY - 4;
        const rxTopY   = this._crystalY - 4;
        const txMidX   = this._txCrystalX + this._crystalW / 2;
        const rxMidX   = this._rxCrystalX + this._crystalW / 2;

        // TX 同轴电缆（控制单元 → 发射晶体）
        this.group.add(new Konva.Line({
            points: [
                ctrlMidX - 15, ctrlBotY,
                ctrlMidX - 15, py + ph * 0.90,
                txMidX,        py + ph * 0.90,
                txMidX,        txTopY,
            ],
            stroke: '#4080a0', strokeWidth: 1.5,
            lineJoin: 'round', lineCap: 'round',
        }));
        this.group.add(new Konva.Text({
            x: txMidX - 16, y: py + ph * 0.91,
            text: 'TX', fontSize: 6.5,
            fill: '#4080a0', fontFamily: 'Arial',
        }));

        // RX 同轴电缆（接收晶体 → 控制单元）
        this.group.add(new Konva.Line({
            points: [
                rxMidX,        rxTopY,
                rxMidX,        py + ph * 0.84,
                ctrlMidX + 15, py + ph * 0.84,
                ctrlMidX + 15, ctrlBotY,
            ],
            stroke: '#40c080', strokeWidth: 1.5,
            lineJoin: 'round', lineCap: 'round', dash: [4, 2],
        }));
        this.group.add(new Konva.Text({
            x: rxMidX + 2, y: py + ph * 0.85,
            text: 'RX', fontSize: 6.5,
            fill: '#40c080', fontFamily: 'Arial',
        }));

        // 箭头
        [[ctrlMidX - 15, txTopY + 6, true], [ctrlMidX + 15, ctrlBotY - 6, false]].forEach(([ax, ay, down]) => {
            this.group.add(new Konva.Line({
                points: down
                    ? [ax - 4, ay - 6, ax, ay, ax + 4, ay - 6]
                    : [ax - 4, ay + 6, ax, ay, ax + 4, ay + 6],
                stroke: down ? '#4080a0' : '#40c080',
                strokeWidth: 1.2, lineJoin: 'round',
            }));
        });
    }

    // ── 控制单元面板 ─────────────────────────
    _drawControlUnit() {
        const cx = this._ctrlX, cy = this._ctrlY;
        const cw = this._ctrlW, ch = this._ctrlH;

        // 控制单元外壳
        this.group.add(new Konva.Rect({
            x: cx - 2, y: cy - 2, width: cw + 4, height: ch + 4,
            fill: '#101820', stroke: '#2a4860', strokeWidth: 0.8, cornerRadius: 3,
        }));
        this.group.add(new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: cw, y: ch },
            fillLinearGradientColorStops: [0, '#2a3848', 0.5, '#202e3c', 1, '#1a2430'],
            stroke: '#3a6080', strokeWidth: 1.2, cornerRadius: 2,
        }));

        // 标题
        this.group.add(new Konva.Text({
            x: cx, y: cy + 4, width: cw,
            text: '控制单元', fontSize: 9, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#60c0e0', align: 'center',
        }));

        // ── 信号强度指示条 ──
        const bx = this._sigBarX, by = this._sigBarY;
        const bw = this._sigBarW, bh = this._sigBarH;

        // 标签行
        this.group.add(new Konva.Text({
            x: bx, y: by - 12, width: bw / 2,
            text: 'TX', fontSize: 7.5, fill: '#4080c0',
            fontFamily: 'Arial', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: bx + bw / 2, y: by - 12, width: bw / 2,
            text: 'RX', fontSize: 7.5, fill: '#40c080',
            fontFamily: 'Arial', align: 'center',
        }));

        // TX 信号棒（固定满格）
        this.group.add(new Konva.Rect({
            x: bx + 2, y: by, width: bw * 0.42, height: bh,
            fill: '#0a1828', stroke: '#2a5070', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this._txBar = new Konva.Rect({
            x: bx + 2, y: by + bh * (1 - 1.0),
            width: bw * 0.42, height: bh * 1.0,
            fill: '#2060c0', cornerRadius: 1,
        });
        this.group.add(this._txBar);

        // RX 信号棒（动态，随含油量变化）
        this.group.add(new Konva.Rect({
            x: bx + bw * 0.52, y: by, width: bw * 0.42, height: bh,
            fill: '#0a1828', stroke: '#2a5070', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this._rxBar = new Konva.Rect({
            x: bx + bw * 0.52, y: by + bh,
            width: bw * 0.42, height: 0,
            fill: '#20c060', cornerRadius: 1,
        });
        this.group.add(this._rxBar);

        // 报警阈值线
        this.group.add(new Konva.Line({
            points: [bx, by + bh * (1 - this.alarmLevel), bx + bw, by + bh * (1 - this.alarmLevel)],
            stroke: '#ff4422', strokeWidth: 0.8, dash: [3, 2],
        }));
        this.group.add(new Konva.Text({
            x: bx + bw + 2, y: by + bh * (1 - this.alarmLevel) - 4,
            text: `ALM\n${(this.alarmLevel * 100).toFixed(0)}%`,
            fontSize: 6, fill: '#ff4422', fontFamily: 'Arial',
        }));

        // 信号强度数值
        this._rxValueText = new Konva.Text({
            x: cx, y: by + bh + 4, width: cw,
            text: `接收强度: 100%`,
            fontSize: 7.5, fill: '#40c080',
            fontFamily: 'Arial, SimHei', align: 'center',
        });
        this.group.add(this._rxValueText);

        // ── 频率和声程参数 ──
        this.group.add(new Konva.Text({
            x: cx + 4, y: cy + ch - 20,
            text: `频率: ${this.freq} MHz   声程: ${this.soundPath} mm`,
            fontSize: 6.5, fill: '#3a6888',
            fontFamily: 'Arial, SimHei',
        }));

        // ── 继电器（右侧）──
        this._drawRelay();

        // 控制单元→继电器连线（带箭头，参照图片右侧连线）
        const relX = this._relayX, relY = this._relayY;
        const ctrlRight = cx + cw;
        const ctrlMidY  = cy + ch * 0.35;
        this.group.add(new Konva.Line({
            points: [ctrlRight, ctrlMidY, relX - 2, ctrlMidY],
            stroke: '#4a8090', strokeWidth: 1.2,
        }));
        // 箭头
        this.group.add(new Konva.Line({
            points: [relX - 8, ctrlMidY - 4, relX - 2, ctrlMidY, relX - 8, ctrlMidY + 4],
            stroke: '#4a8090', strokeWidth: 1.2, lineJoin: 'round',
        }));
        this.group.add(new Konva.Text({
            x: ctrlRight + 2, y: ctrlMidY - 8,
            text: '→继电器', fontSize: 7,
            fill: '#4a8090', fontFamily: 'SimHei, Arial',
        }));
    }

    // ── 继电器符号 ───────────────────────────
    _drawRelay() {
        const rx = this._relayX, ry = this._relayY;
        const rw = 28, rh = 50;

        // 线圈（矩形）
        this.group.add(new Konva.Rect({
            x: rx, y: ry, width: rw, height: rh * 0.45,
            fill: '#1a2838', stroke: '#3a6080', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: rx, y: ry + 3, width: rw,
            text: 'RELAY', fontSize: 6,
            fill: '#4a90b0', fontFamily: 'Arial', align: 'center',
        }));

        // 线圈符号（波浪）
        const coilY = ry + rh * 0.22;
        for (let i = 0; i < 4; i++) {
            const cx2 = rx + 4 + i * 5;
            this.group.add(new Konva.Line({
                points: [cx2, coilY, cx2 + 2, coilY - 3, cx2 + 4, coilY, cx2 + 2, coilY + 1],
                stroke: '#4a90b0', strokeWidth: 0.8, tension: 0.4,
            }));
        }

        // 触点（动态，报警时闭合）
        const contY = ry + rh * 0.55;
        // 固定触点
        this.group.add(new Konva.Line({
            points: [rx + 4, contY, rx + 14, contY],
            stroke: '#4a90b0', strokeWidth: 1.5,
        }));
        // 动触点（动态角度）
        this._relayArm = new Konva.Line({
            points: [rx + 14, contY, rx + 24, contY - 8],
            stroke: '#40c080', strokeWidth: 1.5,
        });
        this.group.add(this._relayArm);
        // 接收触点
        this.group.add(new Konva.Line({
            points: [rx + 18, contY, rx + 28, contY],
            stroke: '#4a90b0', strokeWidth: 1.5, dash: [1, 2],
        }));

        // NO/NC 标注
        this.group.add(new Konva.Text({
            x: rx - 2, y: ry + rh * 0.88,
            text: 'NO', fontSize: 6, fill: '#40c080', fontFamily: 'Arial',
        }));
        this.group.add(new Konva.Text({
            x: rx + 18, y: ry + rh * 0.88,
            text: 'NC', fontSize: 6, fill: '#c08040', fontFamily: 'Arial',
        }));

        // 报警状态文字
        this._relayStatusText = new Konva.Text({
            x: rx - 4, y: ry + rh * 0.70,
            text: 'OPEN', fontSize: 7, fontStyle: 'bold',
            fill: '#40c080', fontFamily: 'Arial',
        });
        this.group.add(this._relayStatusText);
    }

    // ── 波形示波器区（下方）─────────────────
    _drawWaveformScope() {
        const sx = this._scopeX, sy = this._scopeY;
        const sw = this._scopeW * 0.68, sh = this._scopeH;

        // 背景
        this.group.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#0a1420', stroke: '#1a4060', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: sx + 4, y: sy + 2,
            text: '信号波形监测', fontSize: 7.5, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#4090b0',
        }));

        // 格线（4×2）
        for (let i = 1; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [sx + sw * i / 4, sy + 10, sx + sw * i / 4, sy + sh - 4],
                stroke: '#1a3040', strokeWidth: 0.5,
            }));
        }
        this.group.add(new Konva.Line({
            points: [sx + 4, sy + sh / 2, sx + sw - 4, sy + sh / 2],
            stroke: '#1a3040', strokeWidth: 0.5,
        }));

        // TX 波形标签
        this.group.add(new Konva.Text({
            x: sx + 4, y: sy + sh * 0.12,
            text: 'TX', fontSize: 7, fill: '#4080c0', fontFamily: 'Arial',
        }));
        // RX 波形标签
        this.group.add(new Konva.Text({
            x: sx + 4, y: sy + sh * 0.62,
            text: 'RX', fontSize: 7, fill: '#40c080', fontFamily: 'Arial',
        }));

        // 动态波形占位（后续 _refreshWaveform 更新）
        this._scopeTxLine = new Konva.Line({
            points: [sx + 16, sy + sh * 0.30, sx + sw - 4, sy + sh * 0.30],
            stroke: '#4080c0', strokeWidth: 1.2, listening: false,
        });
        this._scopeRxLine = new Konva.Line({
            points: [sx + 16, sy + sh * 0.78, sx + sw - 4, sy + sh * 0.78],
            stroke: '#40c080', strokeWidth: 1.2, listening: false,
        });
        this.group.add(this._scopeTxLine);
        this.group.add(this._scopeRxLine);
    }

    // ── 含油量调节滑块（交互）────────────────
    _drawOilSlider() {
        const sx = this._sliderX, sy = this._sliderY;
        const sw = this._sliderW, sh = this._sliderH;

        // 背景
        this.group.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#0e1c28', stroke: '#1a4060', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: sx, y: sy + 2, width: sw,
            text: '含油量仿真', fontSize: 7.5, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#e0a040', align: 'center',
        }));

        // 含油量滑轨（竖向）
        const trackX  = sx + sw * 0.30;
        const trackY1 = sy + sh * 0.14;
        const trackY2 = sy + sh * 0.86;
        const trackH  = trackY2 - trackY1;

        this.group.add(new Konva.Rect({
            x: trackX - 3, y: trackY1, width: 6, height: trackH,
            fill: '#1a3050', stroke: '#2a5070', strokeWidth: 0.8, cornerRadius: 3,
        }));

        // 刻度（0% 10% 30% 50% 100%）
        [0, 10, 30, 50, 100].forEach(pct => {
            const ky = trackY2 - trackH * pct / 100;
            this.group.add(new Konva.Line({
                points: [trackX + 4, ky, trackX + 10, ky],
                stroke: '#3a6080', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({
                x: trackX + 11, y: ky - 4,
                text: `${pct}%`, fontSize: 6.5,
                fill: '#3a7090', fontFamily: 'Arial',
            }));
        });

        // 滑块（动态位置）
        const initY = trackY2 - trackH * this._oilContent / 100;
        this._sliderKnob = new Konva.Rect({
            x: trackX - 8, y: initY - 5,
            width: 16, height: 10,
            fill: '#e09030', stroke: '#c07020', strokeWidth: 1,
            cornerRadius: 2, draggable: true,
            dragBoundFunc: pos => ({
                x: trackX - 8,
                y: Math.max(trackY1 - 5, Math.min(trackY2 - 5, pos.y)),
            }),
        });
        this._sliderKnob.on('dragmove', () => {
            const ky = this._sliderKnob.y() + 5;
            const pct = Math.max(0, Math.min(100, (1 - (ky - trackY1) / trackH) * 100));
            this._oilTarget = pct;
            this._refreshCache();
        });
        this.group.add(this._sliderKnob);

        this._sliderTrackY1 = trackY1;
        this._sliderTrackY2 = trackY2;
        this._sliderTrackH  = trackH;
        this._sliderTrackX  = trackX;

        // 含油量数值
        this._oilValueText = new Konva.Text({
            x: sx, y: sy + sh * 0.88, width: sw,
            text: `含油: ${this._oilContent.toFixed(1)}%`,
            fontSize: 9, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial',
            fill: '#e09030', align: 'center',
        });
        this.group.add(this._oilValueText);

        // 报警状态文字
        this._alarmText = new Konva.Text({
            x: sx, y: sy + sh * 0.72, width: sw,
            text: '●  正  常',
            fontSize: 9, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial',
            fill: '#22dd44', align: 'center',
        });
        this.group.add(this._alarmText);

        // 快速测试按钮：模拟注油（增加10%）
        const btnY = sy + sh * 0.50;
        [{ label: '注油 +10%', delta: 10 }, { label: '清水 −10%', delta: -10 }].forEach((bd, i) => {
            const btnH = sh * 0.10;
            const btnX = sx + sw * 0.10;
            const btnW = sw * 0.80;
            const btn = new Konva.Rect({
                x: btnX, y: btnY + i * (btnH + 4), width: btnW, height: btnH,
                fill: i === 0 ? '#5a3010' : '#103050',
                stroke: i === 0 ? '#c06020' : '#2080c0', strokeWidth: 1, cornerRadius: 2,
            });
            this.group.add(btn);
            this.group.add(new Konva.Text({
                x: btnX, y: btnY + i * (btnH + 4) + btnH * 0.15,
                width: btnW, text: bd.label,
                fontSize: 8, fontFamily: 'SimHei, Arial',
                fill: i === 0 ? '#e09030' : '#40c0e0', align: 'center',
            }));
            btn.on('mouseenter', () => { btn.opacity(0.75); this._refreshCache(); });
            btn.on('mouseleave', () => { btn.opacity(1.0);  this._refreshCache(); });
            btn.on('click tap', () => {
                this._oilTarget = Math.max(0, Math.min(100, this._oilTarget + bd.delta));
                this._refreshCache();
            });
        });
    }

    // ═══════════════════════════════════════════
    // 动画主循环
    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._simulate(dt);
        this._refreshDisplay();
    }
    // ── 物理仿真 ─────────────────────────────
    _simulate(dt) {
        if (!this._powered) {
            this._signalRx = 0;
            this._alarming = false;
            this._relayOn  = false;
            return;
        }

        // 含油量慢速跟踪目标值
        this._oilContent += ((this._oilTarget - this._oilContent) / this._oilTau) * dt;
        this._oilContent  = Math.max(0, Math.min(100, this._oilContent));

        // 衰减系数计算（线性插值 + 高浓度乳状液非线性增强）
        const C = this._oilContent / 100;  // 0~1
        const emulsionFactor = C > 0.3 ? 1 + (C - 0.3) * 2 : 1; // 高浓度非线性
        this._attenuation = this._alphaWater + (this._alphaMax - this._alphaWater) * C * emulsionFactor;

        // 接收信号强度（Beer-Lambert 指数衰减）
        // I = I₀ · exp(−α · L)，L 以 cm 为单位
        const L = this.soundPath / 10;  // mm → cm
        this._signalRx = Math.exp(-this._attenuation * L);
        this._signalRx = Math.max(0, Math.min(1, this._signalRx));

        // 报警判断
        this._alarming = this._signalRx < this.alarmLevel;
        this._relayOn  = this._alarming;

        // 动画相位
        this._wavePhase += this._waveSpeed * dt;
        this._blinkPhase += dt;

        // 波形历史记录（每 0.05s 采样一次）
        this._histTimer += dt;
        if (this._histTimer >= 0.05) {
            this._histTimer = 0;
            this._txHistory[this._histIdx] = 1.0;
            this._rxHistory[this._histIdx] = this._signalRx;
            this._histIdx = (this._histIdx + 1) % this._txHistory.length;
        }
    }

    // ── 刷新全部显示 ─────────────────────────
    _refreshDisplay() {
        this._updateLiquidColor();
        this._updateWaveAnimation();
        this._updateCrystalGlow();
        this._updateSignalBars();
        this._updateWaveformScope();
        this._updateRelayDisplay();
        this._updateSliderPosition();
        this._updateStatusTexts();
        this._refreshCache();
    }

    // 液体颜色（清澈→浑浊黄褐）
    _updateLiquidColor() {
        if (!this._liquidRect) return;
        const C = this._oilContent / 100;
        // 水色(#1a4060) → 浑浊油色(#4a3010)，线性插值
        const r = Math.round(0x1a + (0x4a - 0x1a) * C);
        const g = Math.round(0x40 + (0x30 - 0x40) * C);
        const b = Math.round(0x60 + (0x10 - 0x60) * C);
        const col = `rgb(${r},${g},${b})`;
        this._liquidRect.fill(col);

        // 水面波纹颜色也跟随
        this._waterLines?.forEach(wl => {
            const alpha = 0.25 * (1 - C * 0.7);
            wl.line.stroke(`rgba(80,${Math.round(180 * (1-C))},${Math.round(220 * (1-C))},${alpha})`);
        });
    }

    // 超声波传播动画（波纹从左向右传播，振幅随信号强度衰减）
    _updateWaveAnimation() {
        if (!this._waveLines?.length) return;
        const waveCount = this._waveLines.length;
        const sx = this._waveStartX, ex = this._waveEndX;
        const cy = this._waveCY;
        const totalW = ex - sx;

        this._waveLines.forEach((wl, i) => {
            const phase   = this._wavePhase - (i / waveCount) * Math.PI * 2;
            const pts = [];
            const steps   = 32;

            for (let j = 0; j <= steps; j++) {
                const x = sx + (j / steps) * totalW;
                // 传播方向上的位置分数
                const xFrac = j / steps;
                // 衰减：从发射端（强）到接收端（随含油量衰减）
                const localAmp = this._signalRx * 0.5 + (1 - xFrac) * (1 - this._signalRx) * 0.3;
                const amp = localAmp * 6 * (this._powered ? 1 : 0);
                const y = cy + amp * Math.sin(phase + xFrac * Math.PI * 4);
                pts.push(x, y);
            }

            wl.points(pts);
            // 波纹颜色：无油=蓝，含油=橙，严重=红
            const C = this._oilContent / 100;
            const r2 = Math.round(0 + 255 * C);
            const g2 = Math.round(200 * (1 - C * 0.8));
            const b2 = Math.round(255 * (1 - C));
            const alpha = 0.3 + this._signalRx * 0.5;
            wl.stroke(`rgba(${r2},${g2},${b2},${alpha})`);
        });
    }

    // 晶体发光效果
    _updateCrystalGlow() {
        if (!this._txGlow || !this._rxGlow) return;
        const blink = Math.sin(this._wavePhase * 3) > 0;
        const txAlpha = this._powered && blink ? 0.7 : 0.1;
        const rxAlpha = this._powered ? this._signalRx * 0.8 : 0;
        this._txGlow.fill(`rgba(0,200,255,${txAlpha})`);
        this._rxGlow.fill(`rgba(0,255,160,${rxAlpha})`);
        // 晶体边框颜色
        this._txCrystalShape?.stroke(this._powered ? '#2080c0' : '#1a3040');
        this._rxCrystalShape?.stroke(this._signalRx > this.alarmLevel ? '#20a060' : '#c04020');
    }

    // 信号强度棒
    _updateSignalBars() {
        if (!this._rxBar || !this._sigBarH) return;
        const h = this._sigBarH * this._signalRx;
        this._rxBar.y(this._sigBarY + this._sigBarH - h);
        this._rxBar.height(h);
        // 颜色：绿→黄→红
        const C = 1 - this._signalRx;
        const r3 = Math.round(32  + (200 - 32)  * C);
        const g3 = Math.round(192 + (40  - 192) * C);
        this._rxBar.fill(`rgb(${r3},${g3},40)`);
    }

    // 示波器波形
    _updateWaveformScope() {
        if (!this._scopeTxLine || !this._scopeRxLine) return;
        const sx = this._scopeX, sy = this._scopeY;
        const sw = this._scopeW * 0.68, sh = this._scopeH;
        const plotW = sw - 20, startX = sx + 16;
        const n = this._txHistory.length;

        const txPts = [], rxPts = [];
        for (let i = 0; i < n; i++) {
            const idx = (this._histIdx + i) % n;
            const x = startX + (i / n) * plotW;
            const txV = this._txHistory[idx];
            const rxV = this._rxHistory[idx];
            const amp = sh * 0.16;
            txPts.push(x, sy + sh * 0.30 - txV * amp * Math.sin((i / n) * Math.PI * 12 + this._wavePhase));
            rxPts.push(x, sy + sh * 0.78 - rxV * amp * Math.sin((i / n) * Math.PI * 12 + this._wavePhase));
        }
        this._scopeTxLine.points(txPts);
        this._scopeRxLine.points(rxPts);
    }

    // 继电器动触点
    _updateRelayDisplay() {
        if (!this._relayArm) return;
        const rx = this._relayX;
        const ry = this._relayY;
        const sh = 50;
        const contY = ry + sh * 0.55;
        if (this._relayOn) {
            // 闭合：动触点水平
            this._relayArm.points([rx + 14, contY, rx + 24, contY]);
            this._relayArm.stroke('#ff4422');
        } else {
            // 断开：动触点斜上
            this._relayArm.points([rx + 14, contY, rx + 24, contY - 8]);
            this._relayArm.stroke('#40c080');
        }
        if (this._relayStatusText) {
            this._relayStatusText.text(this._relayOn ? 'CLOSE' : 'OPEN');
            this._relayStatusText.fill(this._relayOn ? '#ff4422' : '#40c080');
        }
    }

    // 滑块位置跟随含油量
    _updateSliderPosition() {
        if (!this._sliderKnob) return;
        const ky = this._sliderTrackY2 - this._sliderTrackH * this._oilContent / 100;
        this._sliderKnob.y(ky - 5);
    }

    // 状态文字更新
    _updateStatusTexts() {
        if (this._oilValueText) {
            this._oilValueText.text(`含油: ${this._oilContent.toFixed(1)}%`);
        }
        if (this._rxValueText) {
            this._rxValueText.text(`接收强度: ${(this._signalRx * 100).toFixed(1)}%`);
            this._rxValueText.fill(this._alarming ? '#ff4422' : '#40c080');
        }
        if (this._alarmText) {
            if (this._alarming) {
                const blink = Math.floor(this._blinkPhase * 2) % 2 === 0;
                this._alarmText.text(blink ? '⚠  含油报警！' : '');
                this._alarmText.fill('#ff3322');
            } else {
                const C = this._oilContent;
                const status = C < 0.5 ? '●  正  常' : C < 5 ? '△  微量油迹' : '▲  含油偏高';
                const col    = C < 0.5 ? '#22dd44' : C < 5 ? '#ffaa22' : '#ff8822';
                this._alarmText.text(status);
                this._alarmText.fill(col);
            }
        }
    }

    // ── 水面波形点数组生成 ───────────────────
    _buildWaterLinePoints(x1, x2, baseY, phase) {
        const pts = [];
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const x = x1 + (i / steps) * (x2 - x1);
            const y = baseY + 2 * Math.sin(phase + i * 0.8);
            pts.push(x, y);
        }
        return pts;
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════
    _addPorts() {
        const W = this.width, H = this.height;
        this.addPort(W * 0.20, H, 'port_coax_tx',   'wire', 'TX');
        this.addPort(W * 0.35, H, 'port_coax_rx',   'wire', 'RX');
        this.addPort(W * 0.55, H, 'port_relay_no',  'wire', 'NO');
        this.addPort(W * 0.68, H, 'port_relay_nc',  'wire', 'NC');
        this.addPort(W * 0.82, H, 'port_alarm_out', 'wire', 'ALM');
    }

    // ═══════════════════════════════════════════
    // 公共 API
    // ═══════════════════════════════════════════

    /** 获取当前含油量（%）*/
    getOilContent()  { return this._oilContent;  }

    /** 获取接收信号强度（0~1）*/
    getSignalRx()    { return this._signalRx;     }

    /** 获取衰减系数（dB/cm）*/
    getAttenuation() { return this._attenuation;  }

    /** 是否报警 */
    isAlarming()     { return this._alarming;      }

    /** 继电器是否闭合 */
    isRelayOn()      { return this._relayOn;       }

    /** 外部设置含油量（用于仿真注入，0~100%）*/
    setOilContent(pct) {
        this._oilTarget  = Math.max(0, Math.min(100, pct));
    }

    /** 外部设置报警阈值（信号强度比，0~1）*/
    setAlarmLevel(level) {
        this.alarmLevel = Math.max(0.05, Math.min(0.95, level));
    }

    /** 上电/断电 */
    setPower(on) {
        this._powered = !!on;
        if (!on) {
            this._signalRx = 0;
            this._alarming = false;
            this._relayOn  = false;
        }
    }

    update(state) {
        if (!state) return;
        if (state.oil   !== undefined) this.setOilContent(state.oil);
        if (state.alarm !== undefined) this.setAlarmLevel(state.alarm);
        if (state.power !== undefined) this.setPower(state.power);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',              key: 'label',       type: 'text'   },
            { label: '型号',              key: 'model',       type: 'text'   },
            { label: '超声波频率 (MHz)',  key: 'freq',        type: 'number' },
            { label: '声程 (mm)',         key: 'soundPath',   type: 'number' },
            { label: '报警阈值 (0~1)',    key: 'alarmLevel',  type: 'number' },
            { label: '初始含油量 (%)',    key: 'initOil',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label      ) this.label       = cfg.label;
        if (cfg.model      ) this.model       = cfg.model;
        if (cfg.freq       !== undefined) this.freq        = parseFloat(cfg.freq)        || this.freq;
        if (cfg.soundPath  !== undefined) this.soundPath   = parseFloat(cfg.soundPath)   || this.soundPath;
        if (cfg.alarmLevel !== undefined) this.setAlarmLevel(parseFloat(cfg.alarmLevel));
        if (cfg.initOil    !== undefined) this.setOilContent(parseFloat(cfg.initOil));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}