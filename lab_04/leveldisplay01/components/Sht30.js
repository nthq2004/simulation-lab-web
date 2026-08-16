import { BaseComponent } from './BaseComponent.js';

/**
 * SHT30 数字式温湿度传感器仿真组件
 * （SHT30 Digital Temperature & Humidity Sensor）
 *
 * ── 器件说明 ──────────────────────────────────────────────────
 *
 *  SHT30 是 Sensirion 公司推出的高精度数字温湿度传感器，
 *  采用 8-pin DFN（2.5×2.5mm）封装。主要特性：
 *
 *  · 温度精度：±0.2 °C（0~65 °C）
 *  · 湿度精度：±2 %RH（10~90 %RH）
 *  · 接口：I²C（Fast Mode 400 kHz，地址可选 0x44/0x45）
 *  · 供电：2.4 V ~ 5.5 V
 *  · 内置线性化与温度补偿
 *
 * ── 封装引脚（DFN-8，正视图）────────────────────────────────
 *
 *           ┌────────────────┐
 *   SDA  1 ─┤                ├─ 8  VDD
 *   ADDR 2 ─┤   SHT30        ├─ 7  nRESET
 *   ALERT 3 ─┤                ├─ 6  SCL
 *   GND  4 ─┤                ├─ 5  R（未用，接GND）
 *           └────────────────┘
 *
 * ── I²C 通信协议仿真 ─────────────────────────────────────────
 *
 *  支持单次采集（Single Shot）模式：
 *
 *  1. START → 写地址（0x44/0x45）→ 写命令高字节 → 写命令低字节
 *  2. 等待测量完成（高重复度约 15ms）
 *  3. START → 读地址 → 读 6 字节数据：
 *       [Temp_MSB][Temp_LSB][CRC_T][Hum_MSB][Hum_LSB][CRC_H]
 *  4. STOP
 *
 *  数据转换：
 *    温度(°C) = -45 + 175 × rawT / 65535
 *    湿度(%RH) = 100 × rawH / 65535
 *
 * ── 仿真状态机 ───────────────────────────────────────────────
 *
 *  IDLE → CMD_RECEIVED → MEASURING → DATA_READY → IDLE
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pin_sda    — SDA（数据线，1号引脚）
 *  pin_scl    — SCL（时钟线，6号引脚）
 *  pin_vdd    — VDD（电源，8号引脚）
 *  pin_gnd    — GND（地，4号引脚）
 *  pin_addr   — ADDR（地址选择，2号引脚）
 *  pin_nreset — nRESET（复位，7号引脚）
 *  pin_alert  — ALERT（报警输出，3号引脚）
 */
export class SHT30 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(200, config.height || 260);

        this.type    = 'sht30';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 器件参数 ──
        this.label          = config.label       || 'U1';
        this.i2cAddr        = config.addrPin     ? 0x45 : 0x44;  // ADDR引脚决定地址
        this.supplyVoltage  = config.vdd         || 3.3;          // V

        // ── 传感器数值（仿真值）──
        this._temperature   = config.initTemp    !== undefined ? config.initTemp    : 25.0;  // °C
        this._humidity      = config.initHumidity !== undefined ? config.initHumidity : 50.0; // %RH
        this._tempNoise     = config.tempNoise   || 0.05;  // 温度随机噪声幅度
        this._humNoise      = config.humNoise    || 0.10;  // 湿度随机噪声幅度

        // ── ALERT 阈值 ──
        this._alertTempHigh = config.alertTempHigh || 80.0;   // °C
        this._alertTempLow  = config.alertTempLow  || -10.0;  // °C
        this._alertHumHigh  = config.alertHumHigh  || 90.0;   // %RH
        this._alertHumLow   = config.alertHumLow   || 5.0;    // %RH

        // ── I²C 状态机 ──
        // 状态：'idle' | 'cmd_received' | 'measuring' | 'data_ready'
        this._i2cState      = 'idle';
        this._measureTimer  = 0;       // 测量倒计时（s）
        this._measureDur    = 0.015;   // 高重复度测量时间 15ms
        this._lastCmd       = null;    // 最后接收的命令字
        this._txBuffer      = [];      // 待发送缓冲（6字节）
        this._opsCount      = 0;       // 通信次数
        this._measuring     = false;
        this._dataReady     = false;
        this._alertActive   = false;

        // ── 动画状态 ──
        this._scanY         = 0;       // 扫描线 Y 偏移（显示屏动画）
        this._scanDir       = 1;
        this._blinkT        = 0;       // LED 闪烁计时
        this._i2cPulseT     = 0;       // I²C 总线脉冲动画
        this._measPulseT    = 0;       // 测量进度动画


        // ── 布局常量 ──
        const W = this.width, H = this.height;
        const PAD = 12;

        // 芯片本体
        this._chip = {
            x: W * 0.18, y: H * 0.18,
            w: W * 0.64, h: H * 0.42,
            rx: 6,
        };

        // 显示区（芯片内上半部分）
        this._display = {
            x: this._chip.x + 8,  y: this._chip.y + 10,
            w: this._chip.w - 16, h: this._chip.h * 0.55,
            rx: 4,
        };

        // 左侧引脚 x 起点 / 右侧引脚 x 起点
        this._pinLX = PAD;
        this._pinRX = W - PAD;

        // 引脚区垂直范围（和芯片对齐）
        this._pinTop    = this._chip.y + 10;
        this._pinSpacingL = (this._chip.h - 20) / 3;  // 左侧 4 根：1/2/3/4
        this._pinSpacingR = (this._chip.h - 20) / 3;  // 右侧 4 根：5/6/7/8

        this._init();

        // ── 端口注册 ──
        // 左侧引脚（从上到下：1=SDA, 2=ADDR, 3=ALERT, 4=GND）
        const lx = 0;
        for (let i = 0; i < 4; i++) {
            const py = this._pinTop + i * this._pinSpacingL;
            const names = ['pin_sda', 'pin_addr', 'pin_alert', 'pin_gnd'];
            const labels = ['SDA', 'ADDR', 'ALERT', 'GND'];
            this.addPort(lx, py, names[i], 'wire', labels[i]);
        }
        // 右侧引脚（从下到上：5=R, 6=SCL, 7=nRESET, 8=VDD）
        for (let i = 0; i < 4; i++) {
            const py = this._pinTop + (3 - i) * this._pinSpacingR;
            const names = ['pin_r', 'pin_scl', 'pin_nreset', 'pin_vdd'];
            const labels = ['R', 'SCL', 'nRST', 'VDD'];
            this.addPort(this.width, py, names[i], 'wire', labels[i]);
        }
    }

    // ══════════════════════════════════════════════════════════
    _init() {
        this._drawPCBBackground();
        this._drawChipBody();
        this._drawPins();
        this._buildDisplayLayer();
        this._drawChipMarkings();
        this._drawLabel();
        this._buildStatusLayer();
        this._buildI2CBusLayer();
        
        this._bindInteraction();
    }

    // ── PCB 底板 ─────────────────────────────────────────────
    _drawPCBBackground() {
        const W = this.width, H = this.height;
        // PCB 主体（深绿色）
        this.group.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: H - 4,
            fill: '#1a3a2a', stroke: '#0d2a1a', strokeWidth: 1.5,
            cornerRadius: 8,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.5,
        }));
        // 板面纹理：铜箔走线（横向细线）
        for (let y = 20; y < H - 20; y += 18) {
            this.group.add(new Konva.Line({
                points: [8, y, W - 8, y],
                stroke: 'rgba(180,130,40,0.06)', strokeWidth: 1,
            }));
        }
        // 板面高光（顶边）
        this.group.add(new Konva.Rect({
            x: 4, y: 4, width: W - 8, height: 6,
            fill: 'rgba(100,200,120,0.06)', cornerRadius: [6, 6, 0, 0],
        }));
        // 定位孔（四角）
        const holes = [[10, 10], [W-10, 10], [10, H-10], [W-10, H-10]];
        holes.forEach(([hx, hy]) => {
            this.group.add(new Konva.Circle({
                x: hx, y: hy, radius: 3.5,
                fill: '#0a1a10', stroke: '#2a4a30', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Circle({
                x: hx, y: hy, radius: 1.5,
                fill: '#c8a030', // 铜圈
            }));
        });
    }

    // ── 芯片本体 ─────────────────────────────────────────────
    _drawChipBody() {
        const c = this._chip;
        // 芯片阴影
        this.group.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 4,
            width: c.w, height: c.h,
            fill: 'rgba(0,0,0,0.45)', cornerRadius: c.rx,
        }));
        // 芯片主体（深灰陶瓷封装）
        this.group.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: c.h },
            fillLinearGradientColorStops: [
                0,   '#3a3a3e',
                0.4, '#2e2e32',
                0.7, '#28282c',
                1,   '#222226',
            ],
            stroke: '#4a4a50', strokeWidth: 1.2,
            cornerRadius: c.rx,
        }));
        // 顶面高光（模拟封装反光）
        this.group.add(new Konva.Rect({
            x: c.x + 4, y: c.y + 2,
            width: c.w - 8, height: c.h * 0.12,
            fill: 'rgba(255,255,255,0.07)', cornerRadius: [c.rx, c.rx, 0, 0],
        }));
        // 1号引脚标记（左上角小圆点）
        this.group.add(new Konva.Circle({
            x: c.x + 10, y: c.y + 10, radius: 2.5,
            fill: '#aaaaaa',
        }));
    }

    // ── 引脚 ─────────────────────────────────────────────────
    _drawPins() {
        const c  = this._chip;
        const lx = this._pinLX;
        const rx = this._pinRX;

        // 左侧引脚定义
        const leftPins = [
            { name: 'SDA',   color: '#4fc3f7', funcColor: '#0288d1' },
            { name: 'ADDR',  color: '#ce93d8', funcColor: '#7b1fa2' },
            { name: 'ALERT', color: '#ffb74d', funcColor: '#e65100' },
            { name: 'GND',   color: '#78909c', funcColor: '#37474f' },
        ];
        // 右侧引脚定义（从下到上绘制）
        const rightPins = [
            { name: 'VDD',    color: '#ef9a9a', funcColor: '#c62828' },
            { name: 'nRESET', color: '#a5d6a7', funcColor: '#2e7d32' },
            { name: 'SCL',    color: '#80cbc4', funcColor: '#00695c' },
            { name: 'R/NC',   color: '#546e7a', funcColor: '#37474f' },
        ];

        // 绘制左侧 4 根引脚（从上到下：pin 1~4）
        leftPins.forEach((pin, i) => {
            const pinNum = i + 1;
            const py = this._pinTop + i * this._pinSpacingL;
            this._drawOnePinLeft(lx, py, c.x, pin, pinNum);
        });

        // 绘制右侧 4 根引脚（从下到上：pin 5~8）
        rightPins.forEach((pin, i) => {
            const pinNum = 5 + i;
            const py = this._pinTop + (3 - i) * this._pinSpacingR;
            this._drawOnePinRight(c.x + c.w, py, rx, pin, pinNum);
        });
    }

    _drawOnePinLeft(fromX, py, chipEdgeX, pin, pinNum) {
        const W = this.width;
        // 铜箔走线（从板边到芯片边缘）
        this.group.add(new Konva.Line({
            points: [fromX + 2, py, chipEdgeX, py],
            stroke: '#c8a030', strokeWidth: 2.5, lineCap: 'round',
        }));
        // 焊盘
        this.group.add(new Konva.Rect({
            x: chipEdgeX - 6, y: py - 4,
            width: 6, height: 8,
            fill: '#d4a832', stroke: '#a07820', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 板边焊盘
        this.group.add(new Konva.Rect({
            x: fromX, y: py - 5,
            width: 8, height: 10,
            fill: '#d4a832', stroke: '#a07820', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 引脚编号
        this.group.add(new Konva.Text({
            x: fromX + 10, y: py - 7,
            text: `${pinNum}`, fontSize: 7, fill: '#80988a',
        }));
        // 引脚名称
        this.group.add(new Konva.Text({
            x: fromX + 10, y: py + 1,
            text: pin.name, fontSize: 7, fontStyle: 'bold',
            fill: pin.color,
        }));
    }

    _drawOnePinRight(chipEdgeX, py, toX, pin, pinNum) {
        // 铜箔走线
        this.group.add(new Konva.Line({
            points: [chipEdgeX, py, toX - 2, py],
            stroke: '#c8a030', strokeWidth: 2.5, lineCap: 'round',
        }));
        // 焊盘（芯片侧）
        this.group.add(new Konva.Rect({
            x: chipEdgeX, y: py - 4,
            width: 6, height: 8,
            fill: '#d4a832', stroke: '#a07820', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 板边焊盘
        this.group.add(new Konva.Rect({
            x: toX - 8, y: py - 5,
            width: 8, height: 10,
            fill: '#d4a832', stroke: '#a07820', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 引脚编号
        this.group.add(new Konva.Text({
            x: toX - 32, y: py - 7,
            text: `${pinNum}`, fontSize: 7, fill: '#80988a',
        }));
        // 引脚名称
        this.group.add(new Konva.Text({
            x: toX - 32, y: py + 1,
            text: pin.name, fontSize: 7, fontStyle: 'bold',
            fill: pin.color,
        }));
    }

    // ── 芯片面部标注 ─────────────────────────────────────────
    _drawChipMarkings() {
        const c = this._chip;
        const cx = c.x + c.w / 2;
        // 型号（中间偏下）
        this.group.add(new Konva.Text({
            x: c.x, y: c.y + c.h * 0.66,
            width: c.w, text: 'SHT30',
            fontSize: 13, fontStyle: 'bold', fill: '#ccc', align: 'center',
        }));
        // 制造商
        this.group.add(new Konva.Text({
            x: c.x, y: c.y + c.h * 0.78,
            width: c.w, text: 'Sensirion',
            fontSize: 8, fill: '#888', align: 'center',
        }));
        // 批号/版本
        this.group.add(new Konva.Text({
            x: c.x, y: c.y + c.h * 0.88,
            width: c.w, text: `A ${this.i2cAddr.toString(16).toUpperCase()}h`,
            fontSize: 7, fill: '#606060', align: 'center',
        }));
    }

    // ── 位号标注 ─────────────────────────────────────────────
    _drawLabel() {
        const W = this.width, H = this.height;
        // 位号
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  SHT30  I²C 0x${this.i2cAddr.toString(16).toUpperCase()}`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // VDD 电压标注
        this.group.add(new Konva.Text({
            x: 0, y: H + 4, width: W,
            text: `VDD = ${this.supplyVoltage} V`,
            fontSize: 8, fill: '#4a6a50', align: 'center',
        }));
    }

    // ── 显示层（温湿度数字显示）─────────────────────────────
    _buildDisplayLayer() {
        this._dispGroup = new Konva.Group();
        this.group.add(this._dispGroup);
        this._rebuildDisplay();
    }

    _rebuildDisplay() {
        this._dispGroup.destroyChildren();
        const d = this._display;

        // 显示屏背景（OLED风格）
        this._dispGroup.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: '#050d10', stroke: '#1a3a40', strokeWidth: 1,
            cornerRadius: d.rx,
        }));
        // 屏幕内边框
        this._dispGroup.add(new Konva.Rect({
            x: d.x + 2, y: d.y + 2, width: d.w - 4, height: d.h - 4,
            fill: 'transparent', stroke: '#0a3040', strokeWidth: 0.5,
            cornerRadius: d.rx,
        }));

        // 温度行
        const tempLabel = new Konva.Text({
            x: d.x + 6, y: d.y + 6,
            text: 'TEMP', fontSize: 7, fill: '#4fc3f7', letterSpacing: 1,
        });
        const tempValue = new Konva.Text({
            x: d.x + 6, y: d.y + 14,
            text: this._formatTemp(this._temperature),
            fontSize: 16, fontStyle: 'bold', fontFamily: 'monospace',
            fill: '#e0f7fa',
        });
        const tempUnit = new Konva.Text({
            x: d.x + d.w - 22, y: d.y + 16,
            text: '°C', fontSize: 10, fill: '#80deea',
        });

        // 分隔线
        const divider = new Konva.Line({
            points: [d.x + 6, d.y + d.h * 0.50, d.x + d.w - 6, d.y + d.h * 0.50],
            stroke: '#0d3040', strokeWidth: 0.8,
        });

        // 湿度行
        const humLabel = new Konva.Text({
            x: d.x + 6, y: d.y + d.h * 0.52,
            text: 'HUM', fontSize: 7, fill: '#80cbc4', letterSpacing: 1,
        });
        const humValue = new Konva.Text({
            x: d.x + 6, y: d.y + d.h * 0.60,
            text: this._formatHumidity(this._humidity),
            fontSize: 16, fontStyle: 'bold', fontFamily: 'monospace',
            fill: '#e0f2f1',
        });
        const humUnit = new Konva.Text({
            x: d.x + d.w - 26, y: d.y + d.h * 0.62,
            text: '%RH', fontSize: 9, fill: '#80cbc4',
        });

        this._dispGroup.add(
            tempLabel, tempValue, tempUnit,
            divider,
            humLabel, humValue, humUnit,
        );

        // 扫描线动画（模拟 OLED 刷新感）
        const scanLine = new Konva.Rect({
            x: d.x + 1, y: d.y + 1 + this._scanY % (d.h - 2),
            width: d.w - 2, height: 2,
            fill: 'rgba(100,220,255,0.04)',
            cornerRadius: 1,
        });
        this._dispGroup.add(scanLine);

        // 若正在测量，显示进度条
        if (this._measuring) {
            const progress = Math.min(this._measPulseT / this._measureDur, 1);
            this._dispGroup.add(new Konva.Rect({
                x: d.x + 2, y: d.y + d.h - 6,
                width: (d.w - 4) * progress, height: 4,
                fill: '#00acc1', cornerRadius: 2,
            }));
            this._dispGroup.add(new Konva.Rect({
                x: d.x + 2, y: d.y + d.h - 6,
                width: d.w - 4, height: 4,
                fill: 'transparent', stroke: '#006064', strokeWidth: 0.5,
                cornerRadius: 2,
            }));
        }
    }

    // ── 状态指示层 ───────────────────────────────────────────
    _buildStatusLayer() {
        this._statusGroup = new Konva.Group();
        this.group.add(this._statusGroup);
        this._rebuildStatus();
    }

    _rebuildStatus() {
        this._statusGroup.destroyChildren();
        const c = this._chip;
        const W = this.width;

        // ── I²C 状态 LED（左下角）──
        const ledX = c.x + 6;
        const ledY = c.y + c.h + 10;
        const i2cColors = {
            'idle':         { fill: '#37474f', stroke: '#263238', glow: 0 },
            'cmd_received': { fill: '#ffb300', stroke: '#f57f17', glow: 6 },
            'measuring':    { fill: '#00bcd4', stroke: '#006064', glow: 8 },
            'data_ready':   { fill: '#66bb6a', stroke: '#2e7d32', glow: 10 },
        };
        const lc = i2cColors[this._i2cState] || i2cColors['idle'];
        const blinkOpacity = this._measuring
            ? 0.5 + 0.5 * Math.sin(this._blinkT * Math.PI * 8)
            : 1.0;

        this._statusGroup.add(new Konva.Circle({
            x: ledX, y: ledY, radius: 4.5,
            fill: lc.fill, stroke: lc.stroke, strokeWidth: 0.8,
            shadowColor: lc.fill, shadowBlur: lc.glow,
            shadowOpacity: blinkOpacity,
            opacity: blinkOpacity,
        }));
        this._statusGroup.add(new Konva.Text({
            x: ledX + 8, y: ledY - 5,
            text: this._i2cStateLabel(),
            fontSize: 7, fontStyle: 'bold',
            fill: lc.fill,
        }));

        // ── ALERT LED（右侧）──
        const alertX = c.x + c.w - 16;
        const alertFill = this._alertActive ? '#ef5350' : '#37474f';
        this._statusGroup.add(new Konva.Circle({
            x: alertX, y: ledY, radius: 4,
            fill: alertFill, stroke: this._alertActive ? '#c62828' : '#263238',
            strokeWidth: 0.8,
            shadowColor: alertFill, shadowBlur: this._alertActive ? 8 : 0,
            shadowOpacity: 0.8,
        }));
        this._statusGroup.add(new Konva.Text({
            x: alertX - 20, y: ledY - 5,
            text: this._alertActive ? 'ALERT!' : 'ALERT',
            fontSize: 7, fontStyle: 'bold',
            fill: alertFill,
        }));

        // ── 采集次数 ──
        this._statusGroup.add(new Konva.Text({
            x: 0, y: c.y + c.h + 6,
            width: W,
            text: `采集次数：${this._opsCount}`,
            fontSize: 8, fill: '#4a6a50', align: 'center',
        }));
    }

    // ── I²C 总线动画层 ───────────────────────────────────────
    _buildI2CBusLayer() {
        this._busGroup = new Konva.Group();
        this.group.add(this._busGroup);
    }

    _rebuildI2CBus() {
        this._busGroup.destroyChildren();
        if (this._i2cPulseT <= 0) return;

        const progress = Math.min(this._i2cPulseT / 0.3, 1.0);
        const alpha    = (1 - progress) * 0.9;
        const c        = this._chip;

        // SDA 总线脉冲（横向流动点）
        const sdaY = this._pinTop + 0 * this._pinSpacingL;
        for (let i = 0; i < 8; i++) {
            const px = this._pinLX + (c.x - this._pinLX) * ((progress + i/8) % 1);
            this._busGroup.add(new Konva.Circle({
                x: px, y: sdaY, radius: 1.5,
                fill: `rgba(79,195,247,${alpha * (1 - i/8)})`,
            }));
        }

        // SCL 总线脉冲（波形点）
        const sclY = this._pinTop + (3 - 1) * this._pinSpacingR;  // pin6 = SCL，右侧第2根
        for (let i = 0; i < 8; i++) {
            const px = this._pinRX - (this._pinRX - c.x - c.w) * ((progress + i/8) % 1);
            this._busGroup.add(new Konva.Circle({
                x: px, y: sclY, radius: 1.5,
                fill: `rgba(128,203,196,${alpha * (1 - i/8)})`,
            }));
        }
    }

    // ── 动画主循环 ───────────────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        let needRefresh = false;

        // 扫描线
        this._scanY += dt * 28;
        if (this._scanY > this._display.h) this._scanY = 0;

        // 测量倒计时
        if (this._measuring) {
            this._measPulseT += dt;
            this._blinkT     += dt;
            if (this._measPulseT >= this._measureDur) {
                this._completeMeasurement();
            }
            needRefresh = true;
        }

        // I²C 脉冲动画衰减
        if (this._i2cPulseT > 0) {
            this._i2cPulseT -= dt;
            if (this._i2cPulseT < 0) this._i2cPulseT = 0;
            needRefresh = true;
        }

        // 显示屏持续刷新（扫描线）
        this._rebuildDisplay();
        this._rebuildI2CBus();

        if (needRefresh) {
            this._rebuildStatus();
            this._refreshCache();
        }
    }

    // ── 测量完成 ─────────────────────────────────────────────
    _completeMeasurement() {
        // 加入随机噪声，模拟真实传感器
        this._temperature += (Math.random() - 0.5) * 2 * this._tempNoise;
        this._humidity    += (Math.random() - 0.5) * 2 * this._humNoise;
        this._humidity     = Math.max(0, Math.min(100, this._humidity));

        // 构建 6 字节读取缓冲 [T_MSB, T_LSB, CRC_T, H_MSB, H_LSB, CRC_H]
        const rawT = Math.round((this._temperature + 45) / 175 * 65535);
        const rawH = Math.round(this._humidity / 100 * 65535);
        const clampedT = Math.max(0, Math.min(65535, rawT));
        const clampedH = Math.max(0, Math.min(65535, rawH));
        this._txBuffer = [
            (clampedT >> 8) & 0xFF,   // Temp MSB
            clampedT & 0xFF,           // Temp LSB
            this._crc8([clampedT >> 8, clampedT & 0xFF]),  // CRC_T
            (clampedH >> 8) & 0xFF,   // Hum MSB
            clampedH & 0xFF,           // Hum LSB
            this._crc8([clampedH >> 8, clampedH & 0xFF]),  // CRC_H
        ];

        // 检查 ALERT
        this._alertActive = (
            this._temperature > this._alertTempHigh ||
            this._temperature < this._alertTempLow  ||
            this._humidity    > this._alertHumHigh  ||
            this._humidity    < this._alertHumLow
        );

        this._measuring      = false;
        this._measPulseT     = 0;
        this._dataReady      = true;
        this._i2cState       = 'data_ready';
        this._opsCount++;
    }

    // ── CRC-8 校验（Sensirion 多项式 0x31）────────────────────
    _crc8(bytes) {
        let crc = 0xFF;
        for (const byte of bytes) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) {
                crc = (crc & 0x80) ? ((crc << 1) ^ 0x31) & 0xFF : (crc << 1) & 0xFF;
            }
        }
        return crc;
    }

    // ── 格式化显示 ───────────────────────────────────────────
    _formatTemp(t)     { return t >= 0 ? ` ${t.toFixed(1)}` : `${t.toFixed(1)}`; }
    _formatHumidity(h) { return `${h.toFixed(1)}`; }

    _i2cStateLabel() {
        return {
            'idle':         'IDLE',
            'cmd_received': 'CMD',
            'measuring':    'MEAS...',
            'data_ready':   'READY',
        }[this._i2cState] || 'IDLE';
    }

    // ── 交互绑定 ─────────────────────────────────────────────
    _bindInteraction() {
        // 点击芯片本体：触发一次模拟 I²C 采集（单次测量命令 0x2C06）
        this.group.on('click tap', (e) => {
            e.cancelBubble = true;
            this.triggerSingleShot();
        });
        this.group.listening(true);
    }

    // ══════════════════════════════════════════════════════════
    // 公开 API（供仿真系统或上层控制器调用）
    // ══════════════════════════════════════════════════════════

    /**
     * 发送 I²C 命令（模拟主机写操作）
     * @param {number} cmd  命令字（如 0x2C06 = 单次高重复度）
     */
    sendI2CCommand(cmd) {
        if (this._measuring) return false;
        this._lastCmd   = cmd;
        this._i2cState  = 'cmd_received';
        this._i2cPulseT = 0.3;

        // 支持常用命令
        const SINGLE_SHOT_CMDS = [0x2C06, 0x2C0D, 0x2C10];   // 高/中/低重复度
        const SOFT_RESET_CMD   = 0x30A2;
        const HEATER_ON_CMD    = 0x306D;
        const HEATER_OFF_CMD   = 0x3066;

        if (SINGLE_SHOT_CMDS.includes(cmd)) {
            this._startMeasurement();
        } else if (cmd === SOFT_RESET_CMD) {
            this._softReset();
        } else if (cmd === HEATER_ON_CMD) {
            this._heaterOn = true;
            this._temperature += 2.5;  // 加热器使温度略升
        } else if (cmd === HEATER_OFF_CMD) {
            this._heaterOn = false;
            this._temperature -= 2.5;
        }
        this._rebuildStatus();
        this._refreshCache();
        return true;
    }

    /**
     * 读取 I²C 数据（模拟主机读操作）
     * @returns {number[]|null}  6 字节数组，或 null（数据未就绪）
     */
    readI2CData() {
        if (!this._dataReady) return null;
        this._dataReady = false;
        this._i2cState  = 'idle';
        this._i2cPulseT = 0.3;
        this._rebuildStatus();
        this._refreshCache();
        return [...this._txBuffer];
    }

    /**
     * 触发一次单次采集（0x2C06 高重复度命令）
     */
    triggerSingleShot() {
        this.sendI2CCommand(0x2C06);
    }

    /**
     * 直接设置仿真温湿度值（用于测试场景驱动）
     * @param {number} temp  温度 °C
     * @param {number} hum   湿度 %RH
     */
    setValues(temp, hum) {
        this._temperature = Math.max(-40, Math.min(125, temp));
        this._humidity    = Math.max(0,   Math.min(100, hum));
        this._rebuildDisplay();
        this._rebuildStatus();
        this._refreshCache();
    }

    /** 读取当前温度（°C） */
    getTemperature() { return this._temperature; }

    /** 读取当前湿度（%RH） */
    getHumidity()    { return this._humidity; }

    /** 是否数据就绪 */
    isDataReady()    { return this._dataReady; }

    /** 当前 I²C 状态 */
    getI2CState()    { return this._i2cState; }

    /** 获取原始数据帧（用于协议层分析） */
    getRawFrame()    { return [...this._txBuffer]; }

    // ── 内部辅助 ─────────────────────────────────────────────
    _startMeasurement() {
        this._measuring      = true;
        this._measPulseT     = 0;
        this._dataReady      = false;
        this._i2cState       = 'measuring';
    }

    _softReset() {
        this._measuring      = false;
        this._dataReady      = false;
        this._i2cState       = 'idle';
        this._txBuffer       = [];
        this._alertActive    = false;
        this._heaterOn       = false;
        this._measPulseT     = 0;
        this._rebuildDisplay();
        this._rebuildStatus();
    }

    // ══════════════════════════════════════════════════════════
    update(state) {
        if (state && typeof state === 'object') {
            if (state.temperature !== undefined || state.humidity !== undefined) {
                this.setValues(
                    state.temperature ?? this._temperature,
                    state.humidity    ?? this._humidity,
                );
            }
            if (state.cmd !== undefined) {
                this.sendI2CCommand(state.cmd);
            }
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',          type: 'text'   },
            { label: 'ADDR引脚(0=0x44)',   key: 'addrPin',        type: 'number' },
            { label: '供电电压 (V)',        key: 'vdd',            type: 'number' },
            { label: '初始温度 (°C)',       key: 'initTemp',       type: 'number' },
            { label: '初始湿度 (%RH)',      key: 'initHumidity',   type: 'number' },
            { label: '温度噪声幅度',        key: 'tempNoise',      type: 'number' },
            { label: '湿度噪声幅度',        key: 'humNoise',       type: 'number' },
            { label: 'ALERT 温度上限 (°C)', key: 'alertTempHigh',  type: 'number' },
            { label: 'ALERT 温度下限 (°C)', key: 'alertTempLow',   type: 'number' },
            { label: 'ALERT 湿度上限 (%)',  key: 'alertHumHigh',   type: 'number' },
            { label: 'ALERT 湿度下限 (%)',  key: 'alertHumLow',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label             = cfg.label          || this.label;
        this.supplyVoltage     = parseFloat(cfg.vdd) || this.supplyVoltage;
        this._tempNoise        = parseFloat(cfg.tempNoise)    || this._tempNoise;
        this._humNoise         = parseFloat(cfg.humNoise)     || this._humNoise;
        this._alertTempHigh    = parseFloat(cfg.alertTempHigh) ?? this._alertTempHigh;
        this._alertTempLow     = parseFloat(cfg.alertTempLow)  ?? this._alertTempLow;
        this._alertHumHigh     = parseFloat(cfg.alertHumHigh)  ?? this._alertHumHigh;
        this._alertHumLow      = parseFloat(cfg.alertHumLow)   ?? this._alertHumLow;

        if (cfg.initTemp      !== undefined) this._temperature = parseFloat(cfg.initTemp);
        if (cfg.initHumidity  !== undefined) this._humidity    = parseFloat(cfg.initHumidity);
        if (cfg.addrPin       !== undefined) this.i2cAddr = cfg.addrPin ? 0x45 : 0x44;

        this.config = { ...this.config, ...cfg };
        this._rebuildDisplay();
        this._rebuildStatus();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}