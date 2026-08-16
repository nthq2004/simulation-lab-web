import { BaseComponent } from './BaseComponent.js';

/**
 * FUJI ST3 系列时间继电器仿真组件
 * （FUJI ST3 Series Timer Relay）
 *
 * ── 产品概述 ──────────────────────────────────────────────────
 *  FUJI ST3 是一款多功能电子式时间继电器，广泛应用于
 *  工业自动化控制系统中，用于实现定时控制、延时启动/停止等功能。
 *
 * ── 主要特性 ──────────────────────────────────────────────────
 *  • 多种延时模式可选（拨码开关或旋钮）
 *  • 宽时间设定范围：0.1s ~ 100h（多档位）
 *  • 高精度定时 ±0.5% 满量程
 *  • 输出触点形式：2C（两组转换触点）
 *  • LED 指示灯显示通电及延时状态
 *  • 宽工作电压：AC/DC 24~240V
 *
 * ── 延时模式 (Mode) ──────────────────────────────────────────
 *  MODE A: 通电延时 (On-delay)           — 通电后开始延时，到达设定值后触点动作
 *  MODE B: 断电延时 (Off-delay)          — 断电后开始延时，到达设定值后触点复位
 *  MODE C: 间隔定时 (Interval)           — 通电后触点瞬时动作，延时后复位
 *  MODE D: 星-三角转换延时 (Star-Delta)   — 通电后延时，转换触点
 *  MODE E: 闪烁断开启动 (Flicker OFF)    — 周期性断开启动
 *  MODE F: 闪烁接通启动 (Flicker ON)     — 周期性接通启动
 *
 * ── 时间范围 (Range) ──────────────────────────────────────────
 *  档位     范围        最小设定单位
 *  1        0.1~1.2s    0.1s
 *  2        1~12s       1s
 *  3        0.1~1.2min  0.1min
 *  4        1~12min     1min
 *  5        0.1~1.2h    0.1h
 *  6        1~12h       1h
 *  7        10~120h     10h
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  power_in    — 电源输入（L/N 或 A1/A2）
 *  power_out   — 电源输出（用于串联控制）
 *  contact_11  — 转换触点公共端（触点1）
 *  contact_12  — 常闭触点（触点1）
 *  contact_14  — 常开触点（触点1）
 *  contact_21  — 转换触点公共端（触点2）
 *  contact_22  — 常闭触点（触点2）
 *  contact_24  — 常开触点（触点2）
 */
export class TimerRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 200);
        this.height = Math.max(220, config.height || 260);

        this.type    = 'timer_relay';
        this.special = 'fuji_st3';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 产品标识 ──────────────────────────────────────────
        this.productName   = 'FUJI ST3';
        this.productSeries = 'ST3P';
        
        // ── 工作状态 ──────────────────────────────────────────
        this.powered        = false;          // 电源是否接通
        this.powerVoltage   = config.powerVoltage || 220;  // 电源电压 AC/DC
        this.timerRunning   = false;          // 定时器是否正在计时
        this.timerComplete  = false;          // 定时器是否完成（触点动作）
        this.elapsedTime    = 0;              // 已计时时间 (秒)
        
        // ── 定时器设定参数 ────────────────────────────────────
        this.mode           = config.mode || 'A';   // 延时模式 A~F
        this.rangeIndex     = config.rangeIndex || 3; // 时间档位 1~7
        this.setValue       = config.setValue || 50;   // 设定值百分比 0-100%
        this.delayTime      = 0;                     // 实际延时时间 (秒)
        this._updateDelayTime();
        
        // ── 辅助参数 ──────────────────────────────────────────
        this.manualReset    = false;          // 手动复位输入
        this.gateInput      = false;          // 门控输入（外部控制）
        this.powerIndicator = false;           // 电源指示灯
        this.timerIndicator = false;           // 计时指示灯
        
        // ── 触点状态 (两组转换触点) ────────────────────────────
        // 触点1 (11-12-14)
        this.contact1_12 = false;   // 常闭触点：true=闭合，false=断开
        this.contact1_14 = false;   // 常开触点：true=闭合，false=断开
        // 触点2 (21-22-24)
        this.contact2_22 = false;
        this.contact2_24 = false;
        
        // 触点状态别名（方便外部引用）
        this.contactNC1 = true;      // 未通电/未动作时闭合
        this.contactNO1 = false;
        this.contactNC2 = true;
        this.contactNO2 = false;
        
        // ── 动画状态 ──────────────────────────────────────────
        this._animationTimer = 0;
        this._flashPhase = 0;
        this._lastTimestamp = null;
        
        // ── 时间档位映射表 ────────────────────────────────────
        this.rangeMap = {
            1: { min: 0.1, max: 1.2, unit: 's', step: 0.1, label: '0.1-1.2s' },
            2: { min: 1.0, max: 12.0, unit: 's', step: 1.0, label: '1-12s' },
            3: { min: 0.1, max: 1.2, unit: 'min', step: 0.1, label: '0.1-1.2min' },
            4: { min: 1.0, max: 12.0, unit: 'min', step: 1.0, label: '1-12min' },
            5: { min: 0.1, max: 1.2, unit: 'h', step: 0.1, label: '0.1-1.2h' },
            6: { min: 1.0, max: 12.0, unit: 'h', step: 1.0, label: '1-12h' },
            7: { min: 10.0, max: 120.0, unit: 'h', step: 10.0, label: '10-120h' }
        };
        
        // ── 模式说明 ──────────────────────────────────────────
        this.modeInfo = {
            'A': { name: '通电延时', desc: 'ON-DELAY', defaultNC: true },
            'B': { name: '断电延时', desc: 'OFF-DELAY', defaultNC: true },
            'C': { name: '间隔定时', desc: 'INTERVAL', defaultNC: false },
            'D': { name: '星三角延时', desc: 'STAR-DELTA', defaultNC: true },
            'E': { name: '闪烁断开', desc: 'FLICKER OFF', defaultNC: true },
            'F': { name: '闪烁接通', desc: 'FLICKER ON', defaultNC: false }
        };
        
        // ── 几何布局 ──────────────────────────────────────────
        this._bodyX = 12;
        this._bodyY = 30;
        this._bodyW = this.width - 24;
        this._bodyH = this.height - 45;
        
        // 面板区域
        this._panelX = this._bodyX + 8;
        this._panelY = this._bodyY + 8;
        this._panelW = this._bodyW - 16;
        this._panelH = this._bodyH - 16;
        
        this._init();
        
        // ── 端口 ──────────────────────────────────────────────
        // 电源端口
        this.addPort(this._bodyX + 18, this._bodyY + this._bodyH - 12, 'power_in', 'wire', 'L');
        this.addPort(this._bodyX + this._bodyW - 18, this._bodyY + this._bodyH - 12, 'power_out', 'wire', 'N');
        
        // 触点端口 - 第一组
        this.addPort(this._bodyX + 25, this._bodyY + this._bodyH + 8, 'contact_11', 'wire', 'COM1');
        this.addPort(this._bodyX + 55, this._bodyY + this._bodyH + 8, 'contact_12', 'wire', 'NC1');
        this.addPort(this._bodyX + 85, this._bodyY + this._bodyH + 8, 'contact_14', 'wire', 'NO1');
        
        // 触点端口 - 第二组
        this.addPort(this._bodyX + 115, this._bodyY + this._bodyH + 8, 'contact_21', 'wire', 'COM2');
        this.addPort(this._bodyX + 145, this._bodyY + this._bodyH + 8, 'contact_22', 'wire', 'NC2');
        this.addPort(this._bodyX + 175, this._bodyY + this._bodyH + 8, 'contact_24', 'wire', 'NO2');
    }
    
    // ═══════════════════════════════════════════════════════════
    // 初始化图形界面
    // ═══════════════════════════════════════════════════════════
    
    _init() {
        this._drawLabel();
        this._drawBody();
        this._drawPanel();
        this._drawModeDial();
        this._drawRangeDial();
        this._drawTimeDial();
        this._drawIndicatorLights();
        this._drawTerminalStrip();
        this._drawContactSymbols();
        this._drawProductInfo();
        this._setupInteractions();
        
    }
    
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -8, width: this.width,
            text: 'FUJI ST3 时间继电器 (Timer Relay)',
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }
    
    // ── 继电器外壳 ──────────────────────────────────────────
    _drawBody() {
        // 外壳主体
        const body = new Konva.Rect({
            x: this._bodyX, y: this._bodyY,
            width: this._bodyW, height: this._bodyH,
            fill: '#d0d5d8', stroke: '#8a9aaa', strokeWidth: 1.5,
            cornerRadius: 6,
        });
        this._staticGroup.add(body);
        
        // 外壳卡扣（顶部和底部）
        this._staticGroup.add(new Konva.Rect({
            x: this._bodyX - 2, y: this._bodyY + 15,
            width: 4, height: 20,
            fill: '#b0b5b8', stroke: '#8a9aaa', strokeWidth: 1,
            cornerRadius: [2, 0, 0, 2],
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._bodyX + this._bodyW - 2, y: this._bodyY + 15,
            width: 4, height: 20,
            fill: '#b0b5b8', stroke: '#8a9aaa', strokeWidth: 1,
            cornerRadius: [0, 2, 2, 0],
        }));
        
        // 型号铭牌
        this._staticGroup.add(new Konva.Rect({
            x: this._bodyX + 5, y: this._bodyY + 3,
            width: 60, height: 14,
            fill: '#1e2a36', cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._bodyX + 8, y: this._bodyY + 5,
            text: 'ST3P',
            fontSize: 10, fontStyle: 'bold', fill: '#ffd54f',
        }));
    }
    
    // ── 前面板 ──────────────────────────────────────────────
    _drawPanel() {
        // 面板底板
        const panel = new Konva.Rect({
            x: this._panelX, y: this._panelY,
            width: this._panelW, height: this._panelH,
            fill: '#e8e6e0', stroke: '#b0a890', strokeWidth: 1,
            cornerRadius: 4,
        });
        this._staticGroup.add(panel);
        
        // 面板高光
        this._staticGroup.add(new Konva.Rect({
            x: this._panelX + 2, y: this._panelY + 2,
            width: this._panelW - 4, height: 3,
            fill: 'rgba(255,255,255,0.6)',
            cornerRadius: 2,
        }));
    }
    
    // ── 模式选择拨盘 ────────────────────────────────────────
    _drawModeDial() {
        const dialX = this._panelX + 30;
        const dialY = this._panelY + 30;
        const dialR = 28;
        
        // 拨盘底座
        this._staticGroup.add(new Konva.Circle({
            x: dialX, y: dialY,
            radius: dialR + 3,
            fill: '#c0c5c8', stroke: '#8a9aaa', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: dialX, y: dialY,
            radius: dialR,
            fill: '#f0f0f0', stroke: '#aaa', strokeWidth: 1,
        }));
        
        // 模式刻度标记
        const modes = ['A', 'B', 'C', 'D', 'E', 'F'];
        const angleStep = (2 * Math.PI) / modes.length;
        const startAngle = -Math.PI / 2;
        
        modes.forEach((mode, idx) => {
            const angle = startAngle + idx * angleStep;
            const x = dialX + (dialR - 5) * Math.cos(angle);
            const y = dialY + (dialR - 5) * Math.sin(angle);
            this._staticGroup.add(new Konva.Text({
                x: x - 5, y: y - 6,
                text: mode,
                fontSize: 10, fontStyle: 'bold',
                fill: '#555', align: 'center',
            }));
        });
        
        // 模式指针
        this._modePointer = new Konva.Group({ x: dialX, y: dialY });
        this._modePointer.add(new Konva.Line({
            points: [0, 0, dialR - 8, 0],
            stroke: '#d32f2f', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._modePointer.add(new Konva.Circle({
            radius: 4, fill: '#d32f2f', stroke: '#b71c1c', strokeWidth: 1,
        }));
        this._staticGroup.add(this._modePointer);
        
        // 模式显示标签
        this._modeLabel = new Konva.Text({
            x: dialX - 20, y: dialY + 35,
            width: 40,
            text: 'MODE',
            fontSize: 8, fill: '#666', align: 'center',
        });
        this._staticGroup.add(this._modeLabel);
        
        this._modeDialX = dialX;
        this._modeDialY = dialY;
        this._modeAngleStep = angleStep;
        this._modeStartAngle = startAngle;
        this._modes = modes;
        
        // 更新模式指针角度
        this._updateModePointer();
    }
    
    // ── 时间档位拨盘 ────────────────────────────────────────
    _drawRangeDial() {
        const dialX = this._panelX + 100;
        const dialY = this._panelY + 30;
        const dialR = 28;
        
        // 拨盘底座
        this._staticGroup.add(new Konva.Circle({
            x: dialX, y: dialY,
            radius: dialR + 3,
            fill: '#c0c5c8', stroke: '#8a9aaa', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: dialX, y: dialY,
            radius: dialR,
            fill: '#f0f0f0', stroke: '#aaa', strokeWidth: 1,
        }));
        
        // 档位数字
        const ranges = [1, 2, 3, 4, 5, 6, 7];
        const angleStep = (2 * Math.PI) / ranges.length;
        const startAngle = -Math.PI / 2;
        
        ranges.forEach((range, idx) => {
            const angle = startAngle + idx * angleStep;
            const x = dialX + (dialR - 5) * Math.cos(angle);
            const y = dialY + (dialR - 5) * Math.sin(angle);
            this._staticGroup.add(new Konva.Text({
                x: x - 4, y: y - 6,
                text: range.toString(),
                fontSize: 10, fontStyle: 'bold',
                fill: '#555', align: 'center',
            }));
        });
        
        // 档位指针
        this._rangePointer = new Konva.Group({ x: dialX, y: dialY });
        this._rangePointer.add(new Konva.Line({
            points: [0, 0, dialR - 8, 0],
            stroke: '#1565c0', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._rangePointer.add(new Konva.Circle({
            radius: 4, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1,
        }));
        this._staticGroup.add(this._rangePointer);
        
        // 档位显示
        this._rangeLabel = new Konva.Text({
            x: dialX - 20, y: dialY + 35,
            width: 40,
            text: 'RANGE',
            fontSize: 8, fill: '#666', align: 'center',
        });
        this._staticGroup.add(this._rangeLabel);
        
        this._rangeDialX = dialX;
        this._rangeDialY = dialY;
        this._rangeAngleStep = angleStep;
        this._rangeStartAngle = startAngle;
        this._ranges = ranges;
        
        this._updateRangePointer();
        
        // 档位值显示
        this._rangeValueText = new Konva.Text({
            x: dialX - 25, y: dialY + 48,
            width: 50,
            text: this.rangeMap[this.rangeIndex].label,
            fontSize: 7, fill: '#1565c0', align: 'center',
        });
        this._staticGroup.add(this._rangeValueText);
    }
    
    // ── 时间调节旋钮 (电位器) ────────────────────────────────
    _drawTimeDial() {
        const dialX = this._panelX + this._panelW - 45;
        const dialY = this._panelY + 55;
        const dialR = 32;
        
        // 刻度盘
        this._staticGroup.add(new Konva.Circle({
            x: dialX, y: dialY,
            radius: dialR + 3,
            fill: '#c0c5c8', stroke: '#8a9aaa', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: dialX, y: dialY,
            radius: dialR,
            fill: '#f5f5f0', stroke: '#aaa', strokeWidth: 1,
        }));
        
        // 刻度线
        for (let i = 0; i <= 10; i++) {
            const angle = -Math.PI / 2 + (i / 10) * Math.PI * 2;
            const innerR = dialR - 6;
            const outerR = dialR - 2;
            const x1 = dialX + innerR * Math.cos(angle);
            const y1 = dialY + innerR * Math.sin(angle);
            const x2 = dialX + outerR * Math.cos(angle);
            const y2 = dialY + outerR * Math.sin(angle);
            const isMajor = i % 2 === 0;
            this._staticGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#666', strokeWidth: isMajor ? 1.5 : 1,
            }));
        }
        
        // 百分比数字
        for (let i = 0; i <= 10; i += 2) {
            const angle = -Math.PI / 2 + (i / 10) * Math.PI * 2;
            const labelR = dialR - 12;
            const x = dialX + labelR * Math.cos(angle);
            const y = dialY + labelR * Math.sin(angle);
            this._staticGroup.add(new Konva.Text({
                x: x - 6, y: y - 5,
                text: (i * 10).toString(),
                fontSize: 7, fill: '#888', align: 'center',
            }));
        }
        
        // 旋钮指针
        this._timePointer = new Konva.Group({ x: dialX, y: dialY });
        this._timePointer.add(new Konva.Line({
            points: [0, 0, dialR - 8, 0],
            stroke: '#e65100', strokeWidth: 3, lineCap: 'round',
        }));
        this._timePointer.add(new Konva.Circle({
            radius: 5, fill: '#e65100', stroke: '#bf360c', strokeWidth: 1,
        }));
        this._staticGroup.add(this._timePointer);
        
        // 时间显示标签
        this._timeDisplayLabel = new Konva.Text({
            x: dialX - 25, y: dialY + 45,
            width: 50,
            text: 'TIME',
            fontSize: 8, fill: '#666', align: 'center',
        });
        this._staticGroup.add(this._timeDisplayLabel);
        
        // 实际延时值显示
        this._delayValueLabel = new Konva.Text({
            x: dialX - 55, y: dialY - 15,
            width: 110,
            text: this._formatDelayTime(),
            fontSize: 9, fontStyle: 'bold', fill: '#e65100', align: 'center', fontFamily: 'monospace',
        });
        this._staticGroup.add(this._delayValueLabel);
        
        this._timeDialX = dialX;
        this._timeDialY = dialY;
        this._timeDialR = dialR;
    }
    
    // ── 指示灯 ──────────────────────────────────────────────
    _drawIndicatorLights() {
        const ledX = this._panelX + this._panelW - 70;
        const ledY = this._panelY + 12;
        
        // 电源指示灯
        this._powerLED = new Konva.Circle({
            x: ledX, y: ledY,
            radius: 5,
            fill: '#555', stroke: '#333', strokeWidth: 0.5,
        });
        this._staticGroup.add(this._powerLED);
        this._staticGroup.add(new Konva.Text({
            x: ledX - 25, y: ledY - 4,
            text: 'POWER',
            fontSize: 7, fill: '#888',
        }));
        
        // 定时指示灯
        this._timerLED = new Konva.Circle({
            x: ledX, y: ledY + 14,
            radius: 5,
            fill: '#555', stroke: '#333', strokeWidth: 0.5,
        });
        this._staticGroup.add(this._timerLED);
        this._staticGroup.add(new Konva.Text({
            x: ledX - 25, y: ledY + 10,
            text: 'TIMER',
            fontSize: 7, fill: '#888',
        }));
        
        // 输出指示灯
        this._outputLED = new Konva.Circle({
            x: ledX, y: ledY + 28,
            radius: 5,
            fill: '#555', stroke: '#333', strokeWidth: 0.5,
        });
        this._staticGroup.add(this._outputLED);
        this._staticGroup.add(new Konva.Text({
            x: ledX - 25, y: ledY + 24,
            text: 'OUT',
            fontSize: 7, fill: '#888',
        }));
    }
    
    // ── 接线端子示意 ────────────────────────────────────────
    _drawTerminalStrip() {
        const stripY = this._bodyY + this._bodyH - 8;
        const stripH = 12;
        
        this._staticGroup.add(new Konva.Rect({
            x: this._bodyX, y: stripY,
            width: this._bodyW, height: stripH,
            fill: '#2a3a48', stroke: '#1a2a38', strokeWidth: 1,
            cornerRadius: [0, 0, 4, 4],
        }));
        
        // 端子编号
        const labels = ['A1', 'A2', '11', '12', '14', '21', '22', '24'];
        const spacing = this._bodyW / (labels.length + 1);
        
        labels.forEach((label, idx) => {
            const x = this._bodyX + (idx + 1) * spacing;
            this._staticGroup.add(new Konva.Text({
                x: x - 5, y: stripY - 14,
                text: label,
                fontSize: 7, fontStyle: 'bold', fill: '#aaa',
            }));
        });
    }
    
    // ── 触点状态符号 ────────────────────────────────────────
    _drawContactSymbols() {
        const cx = this._panelX + 60;
        const cy = this._panelY + 115;
        
        // 触点1符号
        this._contact1Symbol = new Konva.Text({
            x: cx - 25, y: cy - 5,
            text: '⚡',
            fontSize: 14, fill: '#555',
        });
        this._staticGroup.add(this._contact1Symbol);
        
        // 触点2符号
        this._contact2Symbol = new Konva.Text({
            x: cx + 10, y: cy - 5,
            text: '⚡',
            fontSize: 14, fill: '#555',
        });
        this._staticGroup.add(this._contact2Symbol);
        
        // 状态文字（NO/NC）
        this._contact1Status = new Konva.Text({
            x: cx - 30, y: cy + 8,
            text: 'NC',
            fontSize: 8, fontStyle: 'bold', fill: '#4caf50',
        });
        this._staticGroup.add(this._contact1Status);
        
        this._contact2Status = new Konva.Text({
            x: cx + 5, y: cy + 8,
            text: 'NC',
            fontSize: 8, fontStyle: 'bold', fill: '#4caf50',
        });
        this._staticGroup.add(this._contact2Status);
    }
    
    // ── 产品信息 ────────────────────────────────────────────
    _drawProductInfo() {
        this._staticGroup.add(new Konva.Text({
            x: this._panelX + 15, y: this._panelY + this._panelH - 28,
            text: 'Universal Timer',
            fontSize: 7, fill: '#999',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._panelX + 15, y: this._panelY + this._panelH - 20,
            text: 'AC/DC 24-240V',
            fontSize: 7, fill: '#999',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._panelX + this._panelW - 70, y: this._panelY + this._panelH - 28,
            text: '2C 5A 250VAC',
            fontSize: 7, fill: '#999',
        }));
    }
    
    // ── 交互设置 ────────────────────────────────────────────
    _setupInteractions() {
        // 模式拨盘点击区域
        const modeHit = new Konva.Circle({
            x: this._modeDialX, y: this._modeDialY,
            radius: 30, fill: 'transparent', listening: true, cursor: 'pointer',
        });
        modeHit.on('click', () => {
            this._nextMode();
        });
        this._interactGroup.add(modeHit);
        
        // 档位拨盘点击区域
        const rangeHit = new Konva.Circle({
            x: this._rangeDialX, y: this._rangeDialY,
            radius: 30, fill: 'transparent', listening: true, cursor: 'pointer',
        });
        rangeHit.on('click', () => {
            this._nextRange();
        });
        this._interactGroup.add(rangeHit);
        
        // 时间旋钮拖拽
        const timeHit = new Konva.Circle({
            x: this._timeDialX, y: this._timeDialY,
            radius: this._timeDialR + 5, fill: 'transparent', listening: true, cursor: 'grab',
        });
        
        let dragActive = false;
        let dragStartAngle = 0;
        let dragStartValue = 0;
        
        const getAngleFromMouse = (e) => {
            const rect = timeHit.getAbsolutePosition();
            let clientX = e.clientX;
            let clientY = e.clientY;
            if (e.touches) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            }
            const dx = clientX - rect.x;
            const dy = clientY - rect.y;
            let angle = Math.atan2(dy, dx) * 180 / Math.PI;
            angle = (angle + 90 + 360) % 360;
            return angle;
        };
        
        timeHit.on('mousedown touchstart', (e) => {
            dragActive = true;
            dragStartAngle = getAngleFromMouse(e);
            dragStartValue = this.setValue;
            e.cancelBubble = true;
        });
        
        const onMove = (e) => {
            if (!dragActive) return;
            const angle = getAngleFromMouse(e);
            let delta = angle - dragStartAngle;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            let newValue = dragStartValue + (delta / 3.6);
            newValue = Math.max(0, Math.min(100, newValue));
            this.setValue = Math.round(newValue);
            this._updateDelayTime();
            this._updateTimePointer();
            this._refreshCache();
        };
        
        const onUp = () => {
            dragActive = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };
        
        timeHit.on('mousedown', (e) => {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
        timeHit.on('touchstart', (e) => {
            window.addEventListener('touchmove', onMove);
            window.addEventListener('touchend', onUp);
        });
        
        this._interactGroup.add(timeHit);
    }
    
    // ── 辅助方法 ────────────────────────────────────────────
    _nextMode() {
        const idx = this._modes.indexOf(this.mode);
        this.mode = this._modes[(idx + 1) % this._modes.length];
        this._updateModePointer();
        this._resetTimerState();
        this._refreshCache();
    }
    
    _nextRange() {
        const idx = this._ranges.indexOf(this.rangeIndex);
        this.rangeIndex = this._ranges[(idx + 1) % this._ranges.length];
        this._updateDelayTime();
        this._updateRangePointer();
        if (this._rangeValueText) {
            this._rangeValueText.text(this.rangeMap[this.rangeIndex].label);
        }
        this._resetTimerState();
        this._refreshCache();
    }
    
    _updateDelayTime() {
        const range = this.rangeMap[this.rangeIndex];
        if (!range) return;
        const minVal = range.min;
        const maxVal = range.max;
        this.delayTime = minVal + (this.setValue / 100) * (maxVal - minVal);
        if (this._delayValueLabel) {
            this._delayValueLabel.text(this._formatDelayTime());
        }
    }
    
    _formatDelayTime() {
        const range = this.rangeMap[this.rangeIndex];
        if (!range) return '---';
        let value = this.delayTime;
        if (range.unit === 'min') {
            if (value >= 1) return `${value.toFixed(1)} min`;
            return `${(value * 60).toFixed(0)} s`;
        } else if (range.unit === 'h') {
            if (value >= 1) return `${value.toFixed(1)} h`;
            return `${(value * 60).toFixed(0)} min`;
        } else {
            return `${value.toFixed(1)} s`;
        }
    }
    
    _updateModePointer() {
        if (!this._modePointer) return;
        const idx = this._modes.indexOf(this.mode);
        const angle = this._modeStartAngle + idx * this._modeAngleStep;
        this._modePointer.rotation(angle * 180 / Math.PI);
    }
    
    _updateRangePointer() {
        if (!this._rangePointer) return;
        const idx = this._ranges.indexOf(this.rangeIndex);
        const angle = this._rangeStartAngle + idx * this._rangeAngleStep;
        this._rangePointer.rotation(angle * 180 / Math.PI);
    }
    
    _updateTimePointer() {
        if (!this._timePointer) return;
        const angle = -90 + (this.setValue / 100) * 360;
        this._timePointer.rotation(angle);
    }
    
    // ── 状态更新 ────────────────────────────────────────────
    _updateContactStates() {
        const modeInfo = this.modeInfo[this.mode];
        const isTimedOut = this.timerComplete;
        const isPowered = this.powered;
        
        switch (this.mode) {
            case 'A': // 通电延时
                this.contact1_14 = isPowered && isTimedOut;
                this.contact2_24 = isPowered && isTimedOut;
                this.contact1_12 = isPowered && !isTimedOut;
                this.contact2_22 = isPowered && !isTimedOut;
                break;
            case 'B': // 断电延时
                this.contact1_14 = isPowered;
                this.contact2_24 = isPowered;
                this.contact1_12 = !isPowered && !isTimedOut;
                this.contact2_22 = !isPowered && !isTimedOut;
                break;
            case 'C': // 间隔定时
                this.contact1_14 = isPowered && !isTimedOut;
                this.contact2_24 = isPowered && !isTimedOut;
                this.contact1_12 = isPowered && isTimedOut;
                this.contact2_22 = isPowered && isTimedOut;
                break;
            case 'D': // 星三角延时
                this.contact1_14 = isPowered && !isTimedOut;
                this.contact2_24 = isPowered && isTimedOut;
                this.contact1_12 = !this.contact1_14;
                this.contact2_22 = !this.contact2_24;
                break;
            case 'E': // 闪烁断开
            case 'F': // 闪烁接通
                const flash = Math.floor(this._animationTimer / 0.5) % 2 === 0;
                if (this.mode === 'E') {
                    this.contact1_14 = isPowered && !flash;
                    this.contact2_24 = isPowered && !flash;
                } else {
                    this.contact1_14 = isPowered && flash;
                    this.contact2_24 = isPowered && flash;
                }
                this.contact1_12 = !this.contact1_14;
                this.contact2_22 = !this.contact2_24;
                break;
        }
        
        // 更新别名
        this.contactNC1 = this.contact1_12;
        this.contactNO1 = this.contact1_14;
        this.contactNC2 = this.contact2_22;
        this.contactNO2 = this.contact2_24;
        
        // 更新端口值
        if (this.ports['contact_12']) this.ports['contact_12'].closed = this.contact1_12;
        if (this.ports['contact_14']) this.ports['contact_14'].closed = this.contact1_14;
        if (this.ports['contact_22']) this.ports['contact_22'].closed = this.contact2_22;
        if (this.ports['contact_24']) this.ports['contact_24'].closed = this.contact2_24;
    }
    
    _updateLEDs() {
        if (this._powerLED) {
            this._powerLED.fill(this.powered ? '#4caf50' : '#555');
            const pulse = 0.5 + 0.5 * Math.sin(this._flashPhase * 8);
            if (this.powered) this._powerLED.opacity(0.7 + pulse * 0.3);
        }
        if (this._timerLED) {
            if (this.timerRunning) {
                const pulse = 0.5 + 0.5 * Math.sin(this._flashPhase * 12);
                this._timerLED.fill(`rgba(255, 152, 0, ${0.7 + pulse * 0.3})`);
            } else {
                this._timerLED.fill('#555');
            }
            this._timerLED.opacity(1);
        }
        if (this._outputLED) {
            const active = this.contact1_14 || this.contact2_24;
            this._outputLED.fill(active ? '#ef5350' : '#555');
            if (active) {
                const pulse = 0.5 + 0.5 * Math.sin(this._flashPhase * 10);
                this._outputLED.opacity(0.8 + pulse * 0.2);
            }
        }
        
        // 触点状态显示
        if (this._contact1Status) {
            this._contact1Status.text(this.contact1_14 ? 'NO' : 'NC');
            this._contact1Status.fill(this.contact1_14 ? '#ef5350' : '#4caf50');
        }
        if (this._contact2Status) {
            this._contact2Status.text(this.contact2_24 ? 'NO' : 'NC');
            this._contact2Status.fill(this.contact2_24 ? '#ef5350' : '#4caf50');
        }
        if (this._contact1Symbol) {
            this._contact1Symbol.fill(this.contact1_14 ? '#ef5350' : '#888');
        }
        if (this._contact2Symbol) {
            this._contact2Symbol.fill(this.contact2_24 ? '#ef5350' : '#888');
        }
    }
    
    _resetTimerState() {
        this.timerRunning = false;
        this.timerComplete = false;
        this.elapsedTime = 0;
        this._updateContactStates();
    }
    
    // ═══════════════════════════════════════════════════════════
    // 物理仿真更新
    // ═══════════════════════════════════════════════════════════
    
    _updatePhysics(dt) {
        const actualDt = Math.min(dt, 0.1);
        
        // 根据电源状态更新定时器
        if (this.powered) {
            // 模式 B（断电延时）在通电时计时器不运行，触点保持通电状态
            if (this.mode === 'B') {
                this.timerRunning = false;
                this.timerComplete = false;
                this.elapsedTime = 0;
            } 
            // 模式 E/F（闪烁）持续计时
            else if (this.mode === 'E' || this.mode === 'F') {
                if (!this.timerRunning) {
                    this.timerRunning = true;
                    this.elapsedTime = 0;
                }
                this.elapsedTime += actualDt;
                if (this.elapsedTime >= this.delayTime) {
                    this.elapsedTime = 0;
                }
                this.timerComplete = true;
            }
            // 其他模式需要触发信号
            else if (!this.timerRunning && this._triggerInput) {
                this.timerRunning = true;
                this.elapsedTime = 0;
            }
            
            if (this.timerRunning && this.mode !== 'E' && this.mode !== 'F') {
                this.elapsedTime += actualDt;
                if (this.elapsedTime >= this.delayTime) {
                    this.timerComplete = true;
                    this.timerRunning = false;
                }
            }
        } else {
            // 断电延时模式（B）
            if (this.mode === 'B' && !this.powered) {
                if (!this.timerRunning && !this.timerComplete) {
                    this.timerRunning = true;
                    this.elapsedTime = 0;
                }
                if (this.timerRunning) {
                    this.elapsedTime += actualDt;
                    if (this.elapsedTime >= this.delayTime) {
                        this.timerComplete = true;
                        this.timerRunning = false;
                    }
                }
            } else {
                this.timerRunning = false;
                this.timerComplete = false;
                this.elapsedTime = 0;
            }
        }
        
        this._updateContactStates();
        this._animationTimer += actualDt;
        this._flashPhase += actualDt * 10;
    }
    
    // ═══════════════════════════════════════════════════════════
    // 动画循环
    // ═══════════════════════════════════════════════════════════
    
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._updatePhysics(dt);
        this._updateLEDs();
        this._refreshCache();
    }
    
    // ═══════════════════════════════════════════════════════════
    // 外部接口
    // ═══════════════════════════════════════════════════════════
    
    /**
     * 设置电源状态
     * @param {boolean} on 是否通电
     */
    setPower(on) {
        const wasPowered = this.powered;
        this.powered = on;
        if (!wasPowered && on) {
            // 通电瞬间，对于 A/C/D 模式，启动定时器
            if (this.mode !== 'B') {
                this._triggerInput = true;
            }
        }
        if (wasPowered && !on && this.mode === 'B') {
            this._triggerInput = true;
        }
    }
    
    /**
     * 外部触发输入（用于启动定时器）
     * @param {boolean} trigger 触发信号
     */
    setTrigger(trigger) {
        this._triggerInput = trigger;
        if (!trigger) return;
        if (this.mode !== 'B' && this.powered && !this.timerRunning && !this.timerComplete) {
            this.timerRunning = true;
            this.elapsedTime = 0;
        }
    }
    
    /**
     * 复位定时器
     */
    reset() {
        this._resetTimerState();
        this._triggerInput = false;
    }
    
    /**
     * 设置延时模式
     * @param {string} mode 'A'~'F'
     */
    setMode(mode) {
        if (this._modes.includes(mode)) {
            this.mode = mode;
            this._updateModePointer();
            this._resetTimerState();
        }
    }
    
    /**
     * 设置时间档位
     * @param {number} range 1~7
     */
    setRange(range) {
        if (this._ranges.includes(range)) {
            this.rangeIndex = range;
            this._updateDelayTime();
            this._updateRangePointer();
        }
    }
    
    /**
     * 设置延时值百分比
     * @param {number} percent 0-100
     */
    setTimeValue(percent) {
        this.setValue = Math.max(0, Math.min(100, percent));
        this._updateDelayTime();
        this._updateTimePointer();
    }
    
    /**
     * 获取触点状态
     * @returns {object} 触点状态对象
     */
    getContactState() {
        return {
            contact1: { NC: this.contact1_12, NO: this.contact1_14, COM: '11' },
            contact2: { NC: this.contact2_22, NO: this.contact2_24, COM: '21' }
        };
    }
    
    /**
     * 获取定时器状态
     * @returns {object} 定时器状态
     */
    getTimerState() {
        return {
            powered: this.powered,
            running: this.timerRunning,
            completed: this.timerComplete,
            elapsed: this.elapsedTime,
            delay: this.delayTime,
            mode: this.mode,
            range: this.rangeIndex,
            valuePercent: this.setValue
        };
    }
    
    update(power) {
        if (typeof power === 'boolean') {
            this.setPower(power);
        }
        this._refreshCache();
    }
    
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '延时模式', key: 'mode', type: 'select', options: ['A', 'B', 'C', 'D', 'E', 'F'] },
            { label: '时间档位', key: 'rangeIndex', type: 'select', options: [1, 2, 3, 4, 5, 6, 7] },
            { label: '时间设定 (%)', key: 'setValue', type: 'number', min: 0, max: 100 },
        ];
    }
    
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.mode !== undefined) this.setMode(cfg.mode);
        if (cfg.rangeIndex !== undefined) this.setRange(cfg.rangeIndex);
        if (cfg.setValue !== undefined) this.setTimeValue(cfg.setValue);
        this.config = { ...this.config, ...cfg };
    }
    
    destroy() {
        super.destroy?.();
    }
}

export default TimerRelay;