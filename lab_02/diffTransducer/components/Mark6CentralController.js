// MARK6CentralController.js
import { BaseComponent } from './BaseComponent.js';

/**
 * MARK 6 油雾浓度中央控制器
 * (MARK 6 Central Controller for Oil Mist Detection System)
 *
 * ── 功能概述 ──────────────────────────────────────────────────
 *  集中监控多达 8 个 MARK 6 油雾浓度探测器
 *  通过 CAN 总线接收探测器数据
 *  提供全局报警和停机逻辑
 *  记录历史数据和事件日志
 *
 * ── CAN 总线接口 ─────────────────────────────────────────────
 *  标准 CAN 2.0B，波特率 250 kbps
 *  接收的 CAN ID：
 *    0x100 + node_id  — 状态帧（每秒）
 *    0x200 + node_id  — 测量数据帧（500ms）
 *    0x300 + node_id  — 报警/故障帧（事件触发）
 *
 * ── 报警等级（整机报警逻辑）────────────────────────────────
 *  任何探测器 PRE-ALARM  → 系统预警（黄色）
 *  任何探测器 ALARM      → 系统主报警（红色 → 建议停机）
 *  任何探测器 FAULT      → 系统故障（橙色）
 *  多个探测器同时报警    → 紧急停机（红色闪烁）
 *
 * ── 数据记录 ────────────────────────────────────────────────
 *  • 每个探测器实时浓度（%LEL）
 *  • 历史趋势（最近 60 秒）
 *  • 事件日志（报警/恢复/故障）
 *
 * ── 视觉组件 ────────────────────────────────────────────────
 *  ① 8 通道探测器面板（每个显示浓度 + 状态灯 + CAN 状态）
 *  ② 系统全局报警状态栏
 *  ③ 趋势图表（多通道叠加或选中通道）
 *  ④ 事件日志面板
 *  ⑤ 最高浓度指示器（最高通道高亮）
 *  ⑥ 模拟量输出指示（4-20mA 对应 0-10%LEL）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_can_h   — CAN-H 总线输入
 *  wire_can_l   — CAN-L 总线输入
 *  wire_vcc     — 电源 24V
 *  wire_gnd     — 地
 *  wire_stop    — 联锁停机输出（干接点）
 *  wire_warn    — 预警输出
 *  wire_alarm   — 主报警输出
 */

export class MARK6CentralController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(560, config.width  || 680);
        this.height = Math.max(480, config.height || 520);

        this.type    = 'mark6_central';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 系统参数 ──
        this.maxDetectors   = config.maxDetectors   || 8;      // 最大探测器数量
        this.canBaudrate    = config.canBaudrate    || 250;    // kbps
        this.systemId       = config.systemId       || 'M6-CON-01';
        this.autoStopDelay  = config.autoStopDelay  || 3;      // 报警确认后停机延时秒数
        this.historySeconds = config.historySeconds || 60;     // 历史数据记录时长

        // ── 探测器数据存储 ──
        this.detectors = [];
        this._initDetectors();

        // ── 系统状态 ──
        this.systemStatus = 'NORMAL';        // NORMAL, PRE_ALARM, ALARM, FAULT, EMERGENCY
        this.highestConc  = 0;               // 最高浓度
        this.highestNode  = null;            // 最高浓度节点
        this.stopOutput   = false;            // 联锁停机输出
        this.warnOutput   = false;            // 预警输出
        this.alarmOutput  = false;            // 主报警输出

        // ── 时间相关 ──
        this._alarmTimer   = 0;               // 报警计时器
        this._lastTimestamp = null;
        this._stopTriggered = false;          // 是否已触发停机

        // ── 数据记录 ──
        this._historyData  = [];               // { timestamp, values: [] }
        this._eventLog     = [];
        this._maxLogEntries = 50;

        // ── 动画状态 ──
        this._canActivity   = 0;               // CAN 总线活动动画
        this._scanPhase     = 0;               // 扫描动画
        this._selectedChannel = 0;              // 选中的通道（用于详细显示）

        // ── 模拟量输出 ──
        this.analogOutput   = 0;               // 4-20mA 对应最高通道浓度

        // ── 布局参数（动态计算）─
        this._updateLayout();

        // 配置参数
        this.config = {
            id: this.id,
            systemId: this.systemId,
            maxDetectors: this.maxDetectors,
            canBaudrate: this.canBaudrate,
            autoStopDelay: this.autoStopDelay,
        };

        this._init();
    }

    _initDetectors() {
        for (let i = 0; i < this.maxDetectors; i++) {
            this.detectors.push({
                nodeId: i + 1,
                enabled: true,
                concentration: 0,           // %LEL
                ch1Value: 0,
                ch2Value: 0,
                status: 'NORMAL',           // NORMAL, PRE_ALARM, ALARM, FAULT, OFFLINE
                lastSeen: Date.now(),
                ledIntensity: 255,
                temperature: 45,
                canErrors: 0,
                faultCode: null,
            });
        }
    }

    _updateLayout() {
        // 主面板布局
        this._headerH    = 44;
        this._panelX     = 8;
        this._panelY     = this._headerH + 4;
        this._panelW     = this.width - 16;
        
        // 探测器网格 (8个位置，2行 x 4列 或 根据数量调整)
        const cols = Math.min(4, Math.ceil(this.maxDetectors / 2));
        const rows = Math.ceil(this.maxDetectors / cols);
        this._detGridCols = cols;
        this._detGridRows = rows;
        this._detCellW    = (this._panelW - 20) / cols;
        this._detCellH    = 78;
        this._detGridH    = rows * (this._detCellH + 6) + 8;
        
        this._chartX     = this._panelX;
        this._chartY     = this._panelY + this._detGridH + 10;
        this._chartW     = Math.round(this._panelW * 0.62);
        this._chartH     = 180;
        
        this._logX       = this._chartX + this._chartW + 8;
        this._logY       = this._chartY;
        this._logW       = this._panelW - this._chartW - 16;
        this._logH       = this._chartH;
        
        this._statusBarY = this._chartY + this._chartH + 10;
        this._statusBarH = 48;
    }

    // ═══════════════════════════════════════════
    //  初始化图形界面
    // ═══════════════════════════════════════════
    _init() {
        this._drawHeader();
        this._drawDetectorPanel();
        this._drawTrendChart();
        this._drawEventLog();
        this._drawStatusBar();
        this._drawConfigButtons();
        this._startAnimation();
    }

    _drawHeader() {
        // 标题栏
        const headerBg = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this._headerH,
            fill: '#0d1f2f', stroke: '#1a3048', strokeWidth: 2,
        });
        
        this._titleText = new Konva.Text({
            x: 10, y: 6, width: 300,
            text: 'MARK 6 油雾浓度中央控制器',
            fontSize: 14, fontStyle: 'bold', fill: '#4dd0e1',
        });
        
        this._sysIdText = new Konva.Text({
            x: 10, y: 24, width: 200,
            text: this.systemId,
            fontSize: 9, fill: '#78909c',
        });
        
        this._canStatusText = new Konva.Text({
            x: this.width - 160, y: 8, width: 150,
            text: `CAN ${this.canBaudrate}kbps ● 在线`,
            fontSize: 9, fill: '#66bb6a', align: 'right',
        });
        
        this._timeText = new Konva.Text({
            x: this.width - 160, y: 24, width: 150,
            text: this._getTimeString(),
            fontSize: 9, fill: '#90a4ae', align: 'right',
        });
        
        // CAN 总线活动指示条
        this._canActivityBar = new Konva.Rect({
            x: this.width - 170, y: 36, width: 14, height: 4,
            fill: '#66bb6a', cornerRadius: 2,
        });
        
        this.group.add(headerBg, this._titleText, this._sysIdText, 
                       this._canStatusText, this._timeText, this._canActivityBar);
        
        // 分隔线
        this.group.add(new Konva.Line({
            points: [0, this._headerH, this.width, this._headerH],
            stroke: '#1a3048', strokeWidth: 1,
        }));
    }

    _drawDetectorPanel() {
        const panelBg = new Konva.Rect({
            x: this._panelX, y: this._panelY,
            width: this._panelW, height: this._detGridH,
            fill: '#0a1118', stroke: '#1a2a38', strokeWidth: 1, cornerRadius: 6,
        });
        this.group.add(panelBg);
        
        // 面板标题
        this.group.add(new Konva.Text({
            x: this._panelX + 8, y: this._panelY + 4,
            text: '探测器状态监控',
            fontSize: 10, fontStyle: 'bold', fill: '#4dd0e1',
        }));
        
        this._detectorCards = [];
        
        for (let i = 0; i < this.maxDetectors; i++) {
            const col = i % this._detGridCols;
            const row = Math.floor(i / this._detGridCols);
            const cardX = this._panelX + 8 + col * (this._detCellW + 2);
            const cardY = this._panelY + 22 + row * (this._detCellH + 4);
            
            const det = this.detectors[i];
            const isSelected = (this._selectedChannel === i);
            
            // 卡片背景
            const cardBg = new Konva.Rect({
                x: cardX, y: cardY,
                width: this._detCellW - 2, height: this._detCellH - 4,
                fill: '#11171f', stroke: isSelected ? '#4dd0e1' : '#1a2a38',
                strokeWidth: isSelected ? 2 : 1, cornerRadius: 4,
            });
            
            // 节点标签
            const nodeLabel = new Konva.Text({
                x: cardX + 4, y: cardY + 4,
                text: `NODE ${det.nodeId}`,
                fontSize: 10, fontStyle: 'bold', fill: '#80cbc4',
            });
            
            // 浓度显示（大数字）
            const concText = new Konva.Text({
                x: cardX + 4, y: cardY + 24,
                text: `${det.concentration.toFixed(1)}`,
                fontSize: 22, fontFamily: 'Courier New, monospace',
                fontStyle: 'bold', fill: '#4dd0e1',
            });
            
            const unitText = new Konva.Text({
                x: cardX + 60, y: cardY + 32,
                text: '%LEL',
                fontSize: 8, fill: '#546e7a',
            });
            
            // 状态指示灯
            const statusColor = this._getStatusColor(det.status);
            const statusLed = new Konva.Circle({
                x: cardX + this._detCellW - 14, y: cardY + 10,
                radius: 5, fill: statusColor,
            });
            
            // 状态文字
            const statusText = new Konva.Text({
                x: cardX + 4, y: cardY + 52,
                text: det.status,
                fontSize: 8, fill: statusColor, width: this._detCellW - 8, align: 'center',
            });
            
            // CH1/CH2 小字
            const chText = new Konva.Text({
                x: cardX + 4, y: cardY + 62,
                text: `CH1:${det.ch1Value.toFixed(2)} CH2:${det.ch2Value.toFixed(2)}`,
                fontSize: 7, fill: '#546e7a', width: this._detCellW - 8, align: 'center',
            });
            
            // CAN 通信指示
            const canLed = new Konva.Circle({
                x: cardX + this._detCellW - 14, y: cardY + 28,
                radius: 3, fill: det.lastSeen > Date.now() - 3000 ? '#66bb6a' : '#f44336',
            });
            
            this.group.add(cardBg, nodeLabel, concText, unitText, 
                           statusLed, statusText, chText, canLed);
            
            // 存储引用以便更新
            this._detectorCards.push({
                nodeId: det.nodeId,
                bg: cardBg,
                concText: concText,
                statusLed: statusLed,
                statusText: statusText,
                chText: chText,
                canLed: canLed,
                cardX, cardY,
                nodeLabel: nodeLabel,
            });
            
            // 添加点击选择功能
            const hitArea = new Konva.Rect({
                x: cardX, y: cardY,
                width: this._detCellW - 2, height: this._detCellH - 4,
                fill: 'transparent', listening: true,
            });
            hitArea.on('click tap', () => {
                this._selectedChannel = i;
                this._refreshCache();
            });
            this.group.add(hitArea);
        }
    }

    _getStatusColor(status) {
        const colors = {
            'NORMAL': '#66bb6a',
            'PRE_ALARM': '#ffd54f',
            'ALARM': '#ef5350',
            'FAULT': '#ff9800',
            'OFFLINE': '#78909c',
        };
        return colors[status] || '#78909c';
    }

    _drawTrendChart() {
        const chartBg = new Konva.Rect({
            x: this._chartX, y: this._chartY,
            width: this._chartW, height: this._chartH,
            fill: '#010a12', stroke: '#1a2a38', strokeWidth: 1, cornerRadius: 6,
        });
        
        this.group.add(new Konva.Text({
            x: this._chartX + 8, y: this._chartY + 4,
            text: `浓度趋势 - ${this._selectedChannel + 1 <= this.maxDetectors ? 
                  `NODE ${this._selectedChannel + 1}` : '未选择'}`,
            fontSize: 9, fontStyle: 'bold', fill: '#4dd0e1',
        }));
        
        this._chartGridLines = [];
        
        // 网格线（水平）
        for (let i = 0; i <= 5; i++) {
            const y = this._chartY + 28 + i * (this._chartH - 40) / 5;
            const line = new Konva.Line({
                points: [this._chartX + 4, y, this._chartX + this._chartW - 4, y],
                stroke: 'rgba(77,208,225,0.08)', strokeWidth: 0.5,
            });
            this.group.add(line);
            
            // Y轴刻度标签
            const val = (5 - i);
            this.group.add(new Konva.Text({
                x: this._chartX + 2, y: y - 4,
                text: `${val}%`,
                fontSize: 6, fill: '#546e7a',
            }));
        }
        
        // 趋势线
        this._trendLine = new Konva.Line({
            points: [], stroke: '#42a5f5', strokeWidth: 1.5,
            lineJoin: 'round', lineCap: 'round',
        });
        
        // 报警阈值线
        this._preAlarmLine = new Konva.Line({
            points: [this._chartX + 4, this._chartY + 28 + (2.5/5)*(this._chartH - 40),
                     this._chartX + this._chartW - 4, this._chartY + 28 + (2.5/5)*(this._chartH - 40)],
            stroke: 'rgba(255,213,79,0.4)', strokeWidth: 0.8, dash: [4, 4],
        });
        
        this._alarmLine = new Konva.Line({
            points: [this._chartX + 4, this._chartY + 28 + (5/5)*(this._chartH - 40),
                     this._chartX + this._chartW - 4, this._chartY + 28 + (5/5)*(this._chartH - 40)],
            stroke: 'rgba(239,83,80,0.4)', strokeWidth: 0.8, dash: [4, 4],
        });
        
        this.group.add(chartBg, this._trendLine, this._preAlarmLine, this._alarmLine);
    }

    _drawEventLog() {
        const logBg = new Konva.Rect({
            x: this._logX, y: this._logY,
            width: this._logW, height: this._logH,
            fill: '#010a12', stroke: '#1a2a38', strokeWidth: 1, cornerRadius: 6,
        });
        
        this.group.add(new Konva.Text({
            x: this._logX + 8, y: this._logY + 4,
            text: '事件日志',
            fontSize: 9, fontStyle: 'bold', fill: '#4dd0e1',
        }));
        
        // 清空日志按钮
        const clearBtn = new Konva.Text({
            x: this._logX + this._logW - 50, y: this._logY + 4,
            text: '[清除]', fontSize: 8, fill: '#546e7a',
        });
        clearBtn.on('click tap', () => {
            this._eventLog = [];
            this._refreshCache();
        });
        
        this._logEntries = [];
        for (let i = 0; i < 8; i++) {
            const logText = new Konva.Text({
                x: this._logX + 4, y: this._logY + 18 + i * 18,
                text: '', fontSize: 7.5, fill: '#78909c',
                width: this._logW - 8, fontFamily: 'Courier New, monospace',
            });
            this._logEntries.push(logText);
            this.group.add(logText);
        }
        
        this.group.add(logBg, clearBtn);
    }

    _drawStatusBar() {
        const barBg = new Konva.Rect({
            x: this._panelX, y: this._statusBarY,
            width: this._panelW, height: this._statusBarH,
            fill: '#0d1a24', stroke: '#1a2a38', strokeWidth: 1, cornerRadius: 6,
        });
        
        // 系统状态指示灯（大）
        this._sysStatusLed = new Konva.Circle({
            x: this._panelX + 20, y: this._statusBarY + 24,
            radius: 12, fill: '#66bb6a',
        });
        
        this._sysStatusText = new Konva.Text({
            x: this._panelX + 40, y: this._statusBarY + 18,
            text: '系统状态: 正常',
            fontSize: 12, fontStyle: 'bold', fill: '#66bb6a',
        });
        
        // 最高浓度指示
        this._highestText = new Konva.Text({
            x: this._panelX + 200, y: this._statusBarY + 12,
            text: '最高浓度',
            fontSize: 9, fill: '#78909c',
        });
        
        this._highestValueText = new Konva.Text({
            x: this._panelX + 200, y: this._statusBarY + 28,
            text: '-- %LEL (NODE --)',
            fontSize: 11, fontStyle: 'bold', fill: '#4dd0e1',
        });
        
        // 模拟量输出指示
        this._analogText = new Konva.Text({
            x: this._panelX + 400, y: this._statusBarY + 12,
            text: '模拟输出',
            fontSize: 9, fill: '#78909c',
        });
        
        this._analogValueText = new Konva.Text({
            x: this._panelX + 400, y: this._statusBarY + 28,
            text: '4.00 mA',
            fontSize: 11, fontStyle: 'bold', fill: '#ffd54f',
        });
        
        // 输出状态指示
        this._warnLed = new Konva.Circle({
            x: this._panelX + this._panelW - 80, y: this._statusBarY + 16,
            radius: 6, fill: '#333',
        });
        this._warnText = new Konva.Text({
            x: this._panelX + this._panelW - 70, y: this._statusBarY + 12,
            text: '预警', fontSize: 8, fill: '#aaa',
        });
        
        this._alarmLed = new Konva.Circle({
            x: this._panelX + this._panelW - 40, y: this._statusBarY + 16,
            radius: 6, fill: '#333',
        });
        this._alarmText = new Konva.Text({
            x: this._panelX + this._panelW - 30, y: this._statusBarY + 12,
            text: '报警', fontSize: 8, fill: '#aaa',
        });
        
        this._stopLed = new Konva.Circle({
            x: this._panelX + this._panelW - 80, y: this._statusBarY + 36,
            radius: 6, fill: '#333',
        });
        this._stopText = new Konva.Text({
            x: this._panelX + this._panelW - 70, y: this._statusBarY + 32,
            text: '停机', fontSize: 8, fill: '#aaa',
        });
        
        this.group.add(barBg, this._sysStatusLed, this._sysStatusText,
                       this._highestText, this._highestValueText,
                       this._analogText, this._analogValueText,
                       this._warnLed, this._warnText,
                       this._alarmLed, this._alarmText,
                       this._stopLed, this._stopText);
    }

    _drawConfigButtons() {
        // 配置按钮（右上角）
        const btnX = this.width - 40;
        const settingsBtn = new Konva.Text({
            x: btnX - 20, y: 10,
            text: '⚙', fontSize: 20, fill: '#546e7a',
        });
        settingsBtn.on('click tap', () => {
            this._showConfigDialog();
        });
        this.group.add(settingsBtn);
    }

    _showConfigDialog() {
        // 配置对话框（简化实现）
        console.log('Open config dialog for MARK 6 Central Controller');
    }

    _getTimeString() {
        const now = new Date();
        return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTimestamp !== null) {
                const dt = Math.min((ts - this._lastTimestamp) / 1000, 0.05);
                this._tickSystem(dt);
                this._tickUI(dt);
            }
            this._lastTimestamp = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
    }

    _tickSystem(dt) {
        // 更新最高浓度
        let maxConc = 0;
        let maxNode = null;
        let hasAlarm = false;
        let hasPreAlarm = false;
        let hasFault = false;
        
        for (const det of this.detectors) {
            if (det.concentration > maxConc) {
                maxConc = det.concentration;
                maxNode = det.nodeId;
            }
            if (det.status === 'ALARM') hasAlarm = true;
            if (det.status === 'PRE_ALARM') hasPreAlarm = true;
            if (det.status === 'FAULT') hasFault = true;
        }
        
        this.highestConc = maxConc;
        this.highestNode = maxNode;
        
        // 系统状态判定
        if (hasAlarm) {
            this.systemStatus = 'ALARM';
            this.alarmOutput = true;
            this.warnOutput = true;
            
            // 停机延时逻辑
            if (!this._stopTriggered) {
                this._alarmTimer += dt;
                if (this._alarmTimer >= this.autoStopDelay) {
                    this.stopOutput = true;
                    this._stopTriggered = true;
                    this._addEventLog('EMERGENCY', `系统停触发 - 报警超过${this.autoStopDelay}秒`);
                }
            }
        } else if (hasPreAlarm) {
            this.systemStatus = 'PRE_ALARM';
            this.alarmOutput = false;
            this.warnOutput = true;
            this._stopTriggered = false;
            this._alarmTimer = 0;
            if (this.stopOutput) {
                this.stopOutput = false;
                this._addEventLog('RECOVERY', '系统停机解除');
            }
        } else if (hasFault) {
            this.systemStatus = 'FAULT';
            this.alarmOutput = false;
            this.warnOutput = false;
        } else {
            this.systemStatus = 'NORMAL';
            this.alarmOutput = false;
            this.warnOutput = false;
            this._stopTriggered = false;
            this._alarmTimer = 0;
            if (this.stopOutput) {
                this.stopOutput = false;
                this._addEventLog('RECOVERY', '系统停机解除');
            }
        }
        
        // 模拟量输出 (4-20mA 对应 0-10% LEL)
        this.analogOutput = 4 + (this.highestConc / 10) * 16;
        this.analogOutput = Math.min(20, Math.max(4, this.analogOutput));
        
        // CAN 总线活动衰减
        this._canActivity = Math.max(0, this._canActivity - dt * 2);
        
        // 扫描动画相位
        this._scanPhase += dt * 2;
        
        // 更新历史数据
        this._updateHistory(dt);
    }

    _updateHistory(dt) {
        this._historyData.push({
            timestamp: Date.now(),
            values: this.detectors.map(d => d.concentration),
        });
        
        // 保留指定时长数据
        const cutoff = Date.now() - this.historySeconds * 1000;
        this._historyData = this._historyData.filter(h => h.timestamp > cutoff);
    }

    _tickUI(dt) {
        // 更新时间显示
        if (this._timeText) {
            this._timeText.text(this._getTimeString());
        }
        
        // 更新CAN状态指示灯
        if (this._canActivityBar) {
            const width = Math.min(14, this._canActivity * 14);
            this._canActivityBar.width(width);
            const hue = this._canActivity > 0.5 ? '#66bb6a' : '#ffd54f';
            this._canActivityBar.fill(hue);
        }
        
        // 更新探测器卡片
        for (let i = 0; i < this.detectors.length && i < this._detectorCards.length; i++) {
            const det = this.detectors[i];
            const card = this._detectorCards[i];
            
            card.concText.text(`${det.concentration.toFixed(1)}`);
            
            const statusColor = this._getStatusColor(det.status);
            card.statusLed.fill(statusColor);
            card.statusText.text(det.status);
            card.statusText.fill(statusColor);
            
            if (det.status === 'ALARM') {
                // 报警闪烁效果
                const blink = Math.abs(Math.sin(this._scanPhase * 5)) > 0.5;
                card.bg.stroke(blink ? '#ef5350' : '#1a2a38');
            } else if (det.status === 'PRE_ALARM') {
                const blink = Math.abs(Math.sin(this._scanPhase * 3)) > 0.5;
                card.bg.stroke(blink ? '#ffd54f' : '#1a2a38');
            } else {
                if (i === this._selectedChannel) {
                    card.bg.stroke('#4dd0e1');
                } else {
                    card.bg.stroke('#1a2a38');
                }
            }
            
            card.chText.text(`CH1:${det.ch1Value.toFixed(2)} CH2:${det.ch2Value.toFixed(2)}`);
            card.canLed.fill(det.lastSeen > Date.now() - 3000 ? '#66bb6a' : '#f44336');
        }
        
        // 更新趋势图
        this._updateTrendChart();
        
        // 更新事件日志显示
        this._updateEventLogDisplay();
        
        // 更新状态栏
        this._updateStatusBar();
        
        // 更新趋势图标题
        const titleText = `浓度趋势 - NODE ${this._selectedChannel + 1}`;
        const titleObj = this.group.find('.trend-title');
        if (titleObj.length) titleObj[0].text(titleText);
    }

    _updateTrendChart() {
        if (!this._trendLine) return;
        
        const w = this._chartW - 8;
        const h = this._chartH - 40;
        const startX = this._chartX + 4;
        const baseY = this._chartY + 28;
        
        // 只显示选中的通道
        const selectedIdx = this._selectedChannel;
        if (selectedIdx >= 0 && selectedIdx < this.maxDetectors) {
            const points = [];
            const historyLen = this._historyData.length;
            
            for (let i = 0; i < historyLen; i++) {
                const x = startX + (i / Math.max(1, historyLen - 1)) * w;
                const conc = this._historyData[i].values[selectedIdx] || 0;
                const y = baseY + (1 - conc / 10) * h;
                points.push(x, Math.min(baseY + h, Math.max(baseY, y)));
            }
            
            this._trendLine.points(points);
            
            if (points.length > 0) {
                // 根据报警状态改变线条颜色
                const det = this.detectors[selectedIdx];
                if (det.status === 'ALARM') this._trendLine.stroke('#ef5350');
                else if (det.status === 'PRE_ALARM') this._trendLine.stroke('#ffd54f');
                else this._trendLine.stroke('#42a5f5');
            }
        }
    }

    _updateEventLogDisplay() {
        if (!this._logEntries.length) return;
        
        // 显示最近的事件
        const recentEvents = this._eventLog.slice(-this._logEntries.length);
        for (let i = 0; i < this._logEntries.length; i++) {
            const event = recentEvents[i];
            if (event) {
                const color = event.type === 'ALARM' ? '#ef9a9a' :
                            event.type === 'PRE_ALARM' ? '#ffd54f' :
                            event.type === 'FAULT' ? '#ffab91' :
                            event.type === 'RECOVERY' ? '#81c784' : '#b0bec5';
                this._logEntries[i].text(`${event.time} ${event.message}`);
                this._logEntries[i].fill(color);
            } else {
                this._logEntries[i].text('');
            }
        }
    }

    _updateStatusBar() {
        // 系统状态灯和文字
        const statusColors = {
            'NORMAL': '#66bb6a',
            'PRE_ALARM': '#ffd54f',
            'ALARM': '#ef5350',
            'FAULT': '#ff9800',
            'EMERGENCY': '#f44336',
        };
        const statusTexts = {
            'NORMAL': '系统状态: 正常',
            'PRE_ALARM': '系统状态: 预警',
            'ALARM': '系统状态: 报警 - 建议停机',
            'FAULT': '系统状态: 故障',
            'EMERGENCY': '系统状态: 紧急停机',
        };
        
        const color = statusColors[this.systemStatus] || '#78909c';
        this._sysStatusLed.fill(color);
        
        // 报警闪烁
        if (this.systemStatus === 'ALARM') {
            const blink = Math.abs(Math.sin(this._scanPhase * 6)) > 0.5;
            if (blink) this._sysStatusLed.fill('#ff4444');
        }
        
        this._sysStatusText.text(statusTexts[this.systemStatus] || '系统状态: 未知');
        this._sysStatusText.fill(color);
        
        // 最高浓度
        const highestNodeStr = this.highestNode ? `NODE ${this.highestNode}` : '--';
        this._highestValueText.text(`${this.highestConc.toFixed(2)} %LEL (${highestNodeStr})`);
        
        // 模拟量输出
        this._analogValueText.text(`${this.analogOutput.toFixed(2)} mA`);
        
        // 输出状态
        const blinkWarn = this.warnOutput && Math.abs(Math.sin(this._scanPhase * 4)) > 0.5;
        this._warnLed.fill(this.warnOutput ? (blinkWarn ? '#ffd54f' : '#ff9800') : '#333');
        this._warnText.fill(this.warnOutput ? '#ffd54f' : '#aaa');
        
        const blinkAlarm = this.alarmOutput && Math.abs(Math.sin(this._scanPhase * 5)) > 0.5;
        this._alarmLed.fill(this.alarmOutput ? (blinkAlarm ? '#ef5350' : '#f44336') : '#333');
        this._alarmText.fill(this.alarmOutput ? '#ef5350' : '#aaa');
        
        const blinkStop = this.stopOutput && Math.abs(Math.sin(this._scanPhase * 3)) > 0.5;
        this._stopLed.fill(this.stopOutput ? (blinkStop ? '#f44336' : '#d32f2f') : '#333');
        this._stopText.fill(this.stopOutput ? '#f44336' : '#aaa');
    }

    _addEventLog(type, message) {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        
        this._eventLog.unshift({
            time: timeStr,
            type: type,
            message: message,
        });
        
        // 保留最多记录
        if (this._eventLog.length > this._maxLogEntries) {
            this._eventLog.pop();
        }
        
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    //  外部接口 - 接收 CAN 数据
    // ═══════════════════════════════════════════
    
    /**
     * 接收探测器数据
     * @param {number} canId CAN ID
     * @param {Uint8Array} data 8字节数据帧
     */
    receiveCanData(canId, data) {
        if (!data || data.length < 8) return;
        
        // 解析节点 ID (CAN ID 低8位)
        const nodeId = canId & 0xFF;
        const frameType = canId & 0xF00;
        
        const detector = this.detectors.find(d => d.nodeId === nodeId);
        if (!detector || !detector.enabled) return;
        
        // 更新最后接收时间
        detector.lastSeen = Date.now();
        
        // CAN 总线活动动画
        this._canActivity = 1.0;
        
        // 解析数据帧
        if (frameType === 0x100) { // 状态帧
            const statusByte = data[0];
            // 可解析状态位，暂不处理
        } 
        else if (frameType === 0x200) { // 测量数据帧
            const statusByte = data[0];
            const ch1Int = (data[1] << 8) | data[2];
            const ch2Int = (data[3] << 8) | data[4];
            
            detector.ch1Value = ch1Int / 10.0;
            detector.ch2Value = ch2Int / 10.0;
            detector.concentration = detector.ch1Value;  // 测量通道浓度
            detector.ledIntensity = data[5];
            detector.temperature = data[6];
            
            // 更新探测器状态
            const oldStatus = detector.status;
            
            if (statusByte & 0x04) {
                detector.status = 'FAULT';
            } else if (statusByte & 0x02) {
                detector.status = 'ALARM';
            } else if (statusByte & 0x01) {
                detector.status = 'PRE_ALARM';
            } else {
                detector.status = 'NORMAL';
            }
            
            // 状态变化时记录事件
            if (oldStatus !== detector.status) {
                this._addEventLog(detector.status, `NODE ${detector.nodeId} 状态变更: ${oldStatus} → ${detector.status} (${detector.concentration.toFixed(2)}%LEL)`);
            }
            
            // 日志记录
            if (detector.status === 'ALARM') {
                this._addEventLog('ALARM', `NODE ${detector.nodeId} 油雾报警: ${detector.concentration.toFixed(2)}%LEL`);
            } else if (detector.status === 'PRE_ALARM') {
                this._addEventLog('PRE_ALARM', `NODE ${detector.nodeId} 油雾预警: ${detector.concentration.toFixed(2)}%LEL`);
            }
        }
        else if (frameType === 0x300) { // 报警/故障帧
            // 事件触发帧
            this._addEventLog('EVENT', `NODE ${nodeId} 触发事件帧`);
            
            // 解析故障码
            if ((data[0] & 0x04)) {
                detector.faultCode = data[5];
                this._addEventLog('FAULT', `NODE ${nodeId} 故障码: 0x${detector.faultCode.toString(16)}`);
            }
        }
        
        this._refreshCache();
    }
    
    /**
     * 获取系统状态摘要
     */
    getSystemSummary() {
        return {
            status: this.systemStatus,
            highestConc: this.highestConc,
            highestNode: this.highestNode,
            stopOutput: this.stopOutput,
            analogOutput: this.analogOutput,
            detectors: this.detectors.map(d => ({
                nodeId: d.nodeId,
                concentration: d.concentration,
                status: d.status,
                online: d.lastSeen > Date.now() - 5000,
            })),
        };
    }
    
    /**
     * 手动触发报警清除
     */
    clearAlarm() {
        if (this.systemStatus === 'ALARM' || this.systemStatus === 'PRE_ALARM') {
            this._addEventLog('ACTION', '手动清除报警');
            this._stopTriggered = false;
            this._alarmTimer = 0;
            
            // 重置探测器状态
            for (const det of this.detectors) {
                if (det.status === 'ALARM' || det.status === 'PRE_ALARM') {
                    if (det.concentration < 2.0) {
                        det.status = 'NORMAL';
                    }
                }
            }
        }
    }
    
    /**
     * 获取配置字段
     */
    getConfigFields() {
        return [
            { label: '系统位号', key: 'systemId', type: 'text' },
            { label: '最大探测器数 (1-8)', key: 'maxDetectors', type: 'number' },
            { label: 'CAN 波特率 (kbps)', key: 'canBaudrate', type: 'number' },
            { label: '停机延时 (秒)', key: 'autoStopDelay', type: 'number' },
        ];
    }
    
    onConfigUpdate(cfg) {
        this.systemId = cfg.systemId || this.systemId;
        this.maxDetectors = Math.min(8, Math.max(1, parseInt(cfg.maxDetectors) || this.maxDetectors));
        this.canBaudrate = parseInt(cfg.canBaudrate) || this.canBaudrate;
        this.autoStopDelay = parseFloat(cfg.autoStopDelay) || this.autoStopDelay;
        
        if (this._sysIdText) this._sysIdText.text(this.systemId);
        if (this._canStatusText) this._canStatusText.text(`CAN ${this.canBaudrate}kbps ● 在线`);
        
        this._refreshCache();
    }
    
    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}