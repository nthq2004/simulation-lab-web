/**
 * PLC.js — 可编程逻辑控制器（网关设备）
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 功能：
 *   1. TCP Client 连接 IAS Server
 *   2. RTU Master 轮询现场从站设备
 *   3. 协议桥接（TCP ↔ RTU）
 *   4. 寄存器缓存与通信超时检测
 *
 * 网络位置：
 *   [IAS Server] ←→ Modbus TCP ←→ [PLC] ←→ RS485 Modbus RTU ←→ [现场设备]
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { ModbusTCPClient } from './ModbusTCP.js';
import { applyPLCMixin } from './dpu/PLC.mixin.js';

class PLC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = config.width || 180;
        this.height = config.height || 260;
        this.type = 'plc_gateway';
        this.special = 'modbus';
        this.cache = 'fixed';

        // ── TCP 客户端 ──
        this.tcpClient = new ModbusTCPClient({ timeout: 1000 });

        // ── 运行状态 ──
        this.isRunning = true;
        this.powerOn = true;
        this.moduleFault = false;

        // ── 初始化 PLC 协议状态（mixin）──
        this._initPLCProtocol();

        // ── 绘制图形 ──
        this._drawVisuals();
        this._addPorts();

        // ── 启动内部循环 ──
        this._startLoop();
    }

    _addPorts() {
        // 电源
        this.addPort(5, 10, 'vcc', 'wire', 'p');
        this.addPort(5, 40, 'gnd', 'wire');

        // RS485 A/B
        this.addPort(20, this.height, 'rs485a', 'wire', 'p');
        this.addPort(50, this.height, 'rs485b', 'wire');

        // 以太网（示意）
        this.addPort(this.width - 5, 10, 'eth', 'wire', 'p');
    }

    // ══════════════════════════════════════════
    //  图形绘制
    // ══════════════════════════════════════════

    _drawVisuals() {
        // 外壳
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 3, cornerRadius: 6,
        }));

        // 顶部标签
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: 30,
            fill: '#3498db', cornerRadius: [6, 6, 0, 0],
        }));

        this.group.add(new Konva.Text({
            x: 10, y: 6, text: 'PLC 控制站', fontSize: 14,
            fill: '#fff', fontStyle: 'bold',
        }));

        // 状态指示灯区
        this.group.add(new Konva.Rect({
            x: 10, y: 38, width: this.width - 20, height: 50,
            fill: '#34495e', cornerRadius: 3,
        }));

        const ledConfigs = [
            { id: 'power', x: 25, label: 'PWR', color: '#00b894' },
            { id: 'run', x: 65, label: 'RUN', color: '#00b894' },
            { id: 'comm', x: 105, label: 'COM', color: '#fdcb6e' },
            { id: 'fault', x: 145, label: 'FLT', color: '#ff4757' },
        ];

        this.leds = {};
        ledConfigs.forEach(cfg => {
            const led = new Konva.Circle({ x: cfg.x, y: 46, radius: 6, fill: '#636e72' });
            this.group.add(led);
            this.group.add(new Konva.Text({
                x: cfg.x - 10, y: 56, text: cfg.label, fontSize: 8,
                fill: '#b2bec3', align: 'center',
            }));
            this.leds[cfg.id] = led;
        });

        // 从站设备列表区
        this.group.add(new Konva.Rect({
            x: 10, y: 96, width: this.width - 20, height: this.height - 140,
            fill: '#34495e', cornerRadius: 3,
        }));

        this.group.add(new Konva.Text({
            x: 15, y: 100, text: '— 从站设备 —', fontSize: 10,
            fill: '#74b9ff',
        }));

        this.slaveListText = new Konva.Text({
            x: 15, y: 115, text: '', fontSize: 9,
            fill: '#dfe6e9',
        });
        this.group.add(this.slaveListText);

        // 通信计数
        this.statsText = new Konva.Text({
            x: 15, y: this.height - 35, text: '轮询: 0 | 成功: 0 | 失败: 0',
            fontSize: 9, fill: '#b2bec3',
        });
        this.group.add(this.statsText);

        // 底部标签
        this.group.add(new Konva.Text({
            x: this.width / 2 - 40, y: this.height - 18,
            text: 'Modbus TCP/RTU', fontSize: 9, fill: '#636e72',
        }));
    }

    // ══════════════════════════════════════════
    //  内部循环
    // ══════════════════════════════════════════

    _startLoop() {
        this._loopTimer = setInterval(() => {
            try {
                this._tick();
            } catch (e) {
                console.warn('[PLC] tick error:', e);
            }
        }, 200); // 200ms 周期
    }

    _tick() {
        if (!this.powerOn || this.moduleFault) {
            this._updateLEDs({ power: false, run: false, comm: false, fault: true });
            this._updateUI();
            this._refreshCache();
            return;
        }

        // 更新 LED
        this._updateLEDs({
            power: true,
            run: this.isRunning,
            comm: Date.now() - this.stats.lastPollTime < 1000,
            fault: this.stats.failedPolls > 5,
        });

        // 更新从站列表显示
        this._updateUI();
        this._refreshCache();
    }

    _updateLEDs(states) {
        if (this.leds.power) this.leds.power.fill(states.power ? '#00b894' : '#636e72');
        if (this.leds.run) this.leds.run.fill(states.run ? '#00b894' : '#636e72');
        if (this.leds.comm) this.leds.comm.fill(states.comm ? '#fdcb6e' : '#636e72');
        if (this.leds.fault) this.leds.fault.fill(states.fault ? '#ff4757' : '#636e72');
    }

    _updateUI() {
        // 更新从站列表
        const lines = this.slaves.map(s => {
            const cache = this.slaveCache[s.slaveId];
            const online = cache ? cache.online : false;
            return `${s.slaveId}:${s.name} ${online ? '●' : '○'}`;
        });
        this.slaveListText.text(lines.join('\n'));

        // 更新统计
        this.statsText.text(`轮询: ${this.stats.totalPolls} | 成功: ${this.stats.successfulPolls} | 失败: ${this.stats.failedPolls}`);
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════

    /**
     * 连接 IAS Server
     */
    connectToServer(iasServer) {
        this.tcpClient.connect(iasServer.tcpServer);
        // 注册 PLC 的 TCP 请求处理器到 IAS
        iasServer.setPLCHandler((unitId, fnCode, data) => {
            return this.handleTCPRequest(unitId, fnCode, data);
        });
        console.log('[PLC] 已连接到 IAS Server');
    }

    /**
     * 重启 PLC
     */
    reset() {
        this.stats.totalPolls = 0;
        this.stats.successfulPolls = 0;
        this.stats.failedPolls = 0;
        this.isRunning = true;
        this.moduleFault = false;
        console.log('[PLC] 复位完成');
    }

    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
    }
}

applyPLCMixin(PLC.prototype);
export { PLC };
