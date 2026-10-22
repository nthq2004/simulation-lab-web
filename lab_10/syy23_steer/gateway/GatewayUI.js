/**
 * GatewayUI - 硬件网关配置面板
 *
 * 提供图形界面让用户：
 * 1. 选择通信方式（Serial / WebSocket）
 * 2. 连接/断开串口或 WebSocket
 * 3. 查看连接状态
 * 4. 监控原始数据帧日志
 *
 * GatewayController 管理 SerialGateway / WebSocketGateway / ProtocolAdapter 的生命周期。
 */
import { SerialGateway } from './SerialGateway.js';
import { WebSocketGateway } from './WebSocketGateway.js';
import { ProtocolAdapter } from './ProtocolAdapter.js';

export { SerialGateway, WebSocketGateway, ProtocolAdapter };

/**
 * GatewayController — 管理网关生命周期
 *
 * 整合 SerialGateway / WebSocketGateway / ProtocolAdapter 的创建、
 * 连接、断开和事件路由。
 */
export class GatewayController {
    /**
     * @param {import('../tools/EquipmentPool.js').EquipmentPool} pool - 设备对象池
     * @param {import('../tools/EventBus.js').EventBus} [eventBus] - 事件总线
     * @param {object} [options]
     * @param {number} [options.baudRate=115200] - 串口默认波特率
     * @param {string} [options.wsUrl=''] - WebSocket 默认 URL
     */
    constructor(pool, eventBus, options = {}) {
        this._pool = pool;
        this._eventBus = eventBus;
        this._baudRate = options.baudRate || 115200;
        this._wsUrl = options.wsUrl || '';

        // 懒加载模块
        this._serialGateway = null;
        this._wsGateway = null;

        // 网关状态
        this._activeType = null; // 'serial' | 'websocket' | null
        this._dataLog = [];
        this._maxLogEntries = 500;

        // 日志回调
        this._onLog = null;
        this._onStatusChange = null;

        // 初始化协议适配器（直接构造，轻量无副作用）
        this._protocolAdapter = new ProtocolAdapter(this._pool, this._eventBus);

        // 绑定事件总线监听 — 将仿真设备状态变化推送到物理硬件
        this._bindStateChangeForwarding();
    }

    /**
     * 使用 Serial 方式连接
     * @param {object} [filters] - USB 设备过滤器
     * @returns {Promise<boolean>}
     */
    async connectSerial(filters) {
        if (this._activeType) await this.disconnect();

        this._serialGateway = new SerialGateway({ baudRate: this._baudRate });

        this._serialGateway.onData((data) => {
            this._handleIncomingData(data, 'serial');
        });
        this._serialGateway.onError((err) => {
            this._log('error', `串口错误: ${err.message}`);
            this._updateStatus('error', `串口错误: ${err.message}`);
        });

        try {
            const ok = await this._serialGateway.connect(filters);
            if (ok) {
                this._activeType = 'serial';
                this._log('info', `串口已连接 (${this._baudRate} baud)`);
                this._updateStatus('connected', '串口已连接');
                return true;
            }
            return false;
        } catch (err) {
            this._log('error', `串口连接失败: ${err.message}`);
            this._updateStatus('disconnected', '串口连接失败');
            throw err;
        }
    }

    /**
     * 使用 WebSocket 方式连接
     * @param {string} url - WebSocket URL
     * @returns {Promise<boolean>}
     */
    async connectWebSocket(url) {
        if (this._activeType) await this.disconnect();

        this._wsGateway = new WebSocketGateway(url || this._wsUrl);

        this._wsGateway.onData((data) => {
            this._handleIncomingData(data, 'websocket');
        });
        this._wsGateway.onError((err) => {
            this._log('error', `WebSocket 错误: ${err.message || err}`);
            this._updateStatus('error', `WebSocket 错误: ${err.message || err}`);
        });

        try {
            await this._wsGateway.connect(url);
            this._activeType = 'websocket';
            this._log('info', `WebSocket 已连接: ${this._wsGateway.url}`);
            this._updateStatus('connected', 'WebSocket 已连接');
            return true;
        } catch (err) {
            this._log('error', `WebSocket 连接失败: ${err.message}`);
            this._updateStatus('disconnected', 'WebSocket 连接失败');
            throw err;
        }
    }

    /**
     * 断开当前连接
     */
    async disconnect() {
        if (this._activeType === 'serial' && this._serialGateway) {
            await this._serialGateway.disconnect();
            this._serialGateway = null;
            this._log('info', '串口已断开');
        } else if (this._activeType === 'websocket' && this._wsGateway) {
            this._wsGateway.disconnect();
            this._wsGateway = null;
            this._log('info', 'WebSocket 已断开');
        }
        this._activeType = null;
        this._updateStatus('disconnected', '已断开');
    }

    /**
     * 将数据发送到外部硬件
     * @param {string} devId - 设备 ID
     * @param {string} key   - 状态键
     * @param {*}      value - 值
     */
    sendToHardware(devId, key, value) {
        if (!this._activeType) return;

        // 使用协议适配器构造帧
        const frame = this._protocolAdapter.toFieldbusFrame(devId, key, value);
        if (!frame) return;

        const payload = frame.data || new Uint8Array();
        this._log('tx', `TX [CAN 0x${frame.id.toString(16).padStart(3, '0')}] ${this._bytesToHex(payload)}`);

        if (this._activeType === 'serial' && this._serialGateway) {
            this._serialGateway.send(payload).catch(err => {
                this._log('error', `串口发送失败: ${err.message}`);
            });
        } else if (this._activeType === 'websocket' && this._wsGateway) {
            this._wsGateway.send(payload);
        }
    }

    /** 当前是否已连接 */
    get connected() {
        if (this._activeType === 'serial') return this._serialGateway ? this._serialGateway.connected : false;
        if (this._activeType === 'websocket') return this._wsGateway ? this._wsGateway.connected : false;
        return false;
    }

    /** 当前激活的网关类型 */
    get activeType() { return this._activeType; }

    /** 获取协议适配器实例 */
    get protocolAdapter() { return this._protocolAdapter; }

    /** 获取数据日志副本 */
    getDataLog() { return [...this._dataLog]; }

    /** 清除日志 */
    clearLog() {
        this._dataLog = [];
        if (this._onLog) this._onLog('clear', null);
    }

    /**
     * 注册日志回调
     * @param {Function} cb
     */
    onLog(cb) { this._onLog = cb; }

    /**
     * 注册状态变更回调
     * @param {Function} cb
     */
    onStatusChange(cb) { this._onStatusChange = cb; }

    // ── 私有方法 ──

    /**
     * 处理从外部硬件接收的数据
     */
    _handleIncomingData(data, source) {
        this._log('rx', `RX [${source}] ${this._bytesToHex(data)}`);

        // 通过协议适配器解析并更新设备状态
        if (data instanceof Uint8Array && data.byteLength >= 4) {
            // 尝试解析为简化 CAN 帧格式：
            // Bytes 0-3: CAN ID (uint32, little-endian)
            // Bytes 4+:  数据负载
            if (data.byteLength >= 5) {
                const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
                const canId = view.getUint32(0, true);
                const payload = data.slice(4);

                this._protocolAdapter.onFieldbusData({
                    id: canId,
                    data: payload,
                });
            } else {
                this._log('rx', `短帧 (${data.byteLength} 字节)，跳过解析`);
            }
        } else if (typeof data === 'string') {
            // 文本协议 — 尝试 JSON 解析
            try {
                const msg = JSON.parse(data);
                if (msg.canId != null) {
                    this._protocolAdapter.onFieldbusData({
                        id: msg.canId,
                        data: msg.data ? new Uint8Array(msg.data) : new Uint8Array(0),
                        slaveAddress: msg.slaveAddress,
                    });
                }
            } catch (e) {
                this._log('rx', `文本: ${data}`);
            }
        }
    }

    /**
     * 记录日志条目
     */
    _log(type, message) {
        const entry = {
            type,
            message,
            timestamp: Date.now(),
        };
        this._dataLog.push(entry);
        if (this._dataLog.length > this._maxLogEntries) {
            this._dataLog.shift();
        }
        if (this._onLog) this._onLog(type, entry);
    }

    /**
     * 更新状态
     */
    _updateStatus(status, message) {
        if (this._onStatusChange) this._onStatusChange(status, message);
    }

    /**
     * 将字节数组转为 Hex 字符串
     */
    _bytesToHex(bytes) {
        if (!bytes || bytes.byteLength === 0) return '(empty)';
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }

    /**
     * 绑定事件总线，将设备状态变化转发到硬件
     */
    _bindStateChangeForwarding() {
        if (!this._eventBus) return;
        this._eventBus.on('equipment:stateChange', (payload) => {
            if (!this._activeType) return;
            if (payload && payload.id && payload.key != null) {
                this.sendToHardware(payload.id, payload.key, payload.value);
            }
        });
    }
}

/**
 * GatewayPanel — 构建网关配置面板的 DOM
 *
 * 提供静态方法 createPanel() 创建面板 HTML，
 * 以及 bindEvents(controller) 绑定事件。
 */
export class GatewayPanel {
    /**
     * 创建网关配置面板的 HTML 字符串
     * @returns {string}
     */
    static createPanel() {
        return `
            <div class="gateway-panel">
                <div class="gateway-header">
                    <span>硬件网关配置</span>
                    <span class="gateway-status" id="gwyStatus">未连接</span>
                </div>

                <div class="gateway-section">
                    <div class="gateway-section-title">通信方式</div>
                    <div class="gateway-radio-group">
                        <label class="gateway-radio">
                            <input type="radio" name="gwyMode" value="serial" checked>
                            <span>串口 (Web Serial API)</span>
                        </label>
                        <label class="gateway-radio">
                            <input type="radio" name="gwyMode" value="websocket">
                            <span>WebSocket</span>
                        </label>
                    </div>
                </div>

                <div class="gateway-section" id="gwySerialConfig">
                    <div class="gateway-section-title">串口配置</div>
                    <div class="gateway-field">
                        <label>波特率:</label>
                        <select id="gwyBaudRate" class="gateway-select">
                            <option value="9600">9600</option>
                            <option value="19200">19200</option>
                            <option value="38400">38400</option>
                            <option value="57600">57600</option>
                            <option value="115200" selected>115200</option>
                            <option value="230400">230400</option>
                        </select>
                    </div>
                    <button id="gwySerialConnect" class="gateway-btn gateway-btn-primary">连接串口</button>
                </div>

                <div class="gateway-section" id="gwyWsConfig" style="display:none;">
                    <div class="gateway-section-title">WebSocket 配置</div>
                    <div class="gateway-field">
                        <label>URL:</label>
                        <input type="text" id="gwyWsUrl" class="gateway-input"
                               placeholder="ws://192.168.1.100:8080"
                               value="ws://localhost:8080">
                    </div>
                    <button id="gwyWsConnect" class="gateway-btn gateway-btn-primary">连接 WebSocket</button>
                </div>

                <div class="gateway-section">
                    <div class="gateway-section-title">操作</div>
                    <button id="gwyDisconnect" class="gateway-btn gateway-btn-danger" disabled>断开连接</button>
                    <button id="gwyClearLog" class="gateway-btn" style="margin-left:6px;">清除日志</button>
                </div>

                <div class="gateway-section">
                    <div class="gateway-section-title">调试日志</div>
                    <div class="gateway-log" id="gwyLog">
                        <div class="gateway-log-empty">等待数据...</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 绑定 UI 事件到 GatewayController
     * @param {GatewayController} controller
     */
    static bindEvents(controller) {
        // 通信方式切换
        const modeRadios = document.querySelectorAll('input[name="gwyMode"]');
        const serialConfig = document.getElementById('gwySerialConfig');
        const wsConfig = document.getElementById('gwyWsConfig');

        modeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'serial') {
                    serialConfig.style.display = 'block';
                    wsConfig.style.display = 'none';
                } else {
                    serialConfig.style.display = 'none';
                    wsConfig.style.display = 'block';
                }
            });
        });

        // 连接串口
        const btnSerial = document.getElementById('gwySerialConnect');
        btnSerial.addEventListener('click', async () => {
            btnSerial.disabled = true;
            btnSerial.textContent = '连接中...';
            try {
                await controller.connectSerial();
                btnSerial.textContent = '已连接';
            } catch (err) {
                console.error('[GatewayUI] 串口连接失败:', err);
                btnSerial.textContent = '连接串口';
                btnSerial.disabled = false;
            }
        });

        // 连接 WebSocket
        const btnWs = document.getElementById('gwyWsConnect');
        const wsUrlInput = document.getElementById('gwyWsUrl');
        btnWs.addEventListener('click', async () => {
            btnWs.disabled = true;
            btnWs.textContent = '连接中...';
            try {
                await controller.connectWebSocket(wsUrlInput.value);
                btnWs.textContent = '已连接';
            } catch (err) {
                console.error('[GatewayUI] WebSocket 连接失败:', err);
                btnWs.textContent = '连接 WebSocket';
                btnWs.disabled = false;
            }
        });

        // 断开连接
        const btnDisconnect = document.getElementById('gwyDisconnect');
        btnDisconnect.addEventListener('click', async () => {
            await controller.disconnect();
        });

        // 清除日志
        document.getElementById('gwyClearLog').addEventListener('click', () => {
            controller.clearLog();
            const logEl = document.getElementById('gwyLog');
            logEl.innerHTML = '<div class="gateway-log-empty">等待数据...</div>';
        });

        // 状态变更回调 — 更新 UI
        controller.onStatusChange((status, message) => {
            const statusEl = document.getElementById('gwyStatus');
            const btnDis = document.getElementById('gwyDisconnect');
            const btnSer = document.getElementById('gwySerialConnect');
            const btnWsEl = document.getElementById('gwyWsConnect');

            if (status === 'connected') {
                statusEl.textContent = message;
                statusEl.className = 'gateway-status connected';
                btnDis.disabled = false;
                btnSer.disabled = true;
                btnWsEl.disabled = true;
            } else {
                statusEl.textContent = message || '未连接';
                statusEl.className = 'gateway-status';
                btnDis.disabled = true;
                btnSer.disabled = false;
                btnSer.textContent = '连接串口';
                btnWsEl.disabled = false;
                btnWsEl.textContent = '连接 WebSocket';
            }
        });

        // 日志回调
        controller.onLog((type, entry) => {
            const logEl = document.getElementById('gwyLog');
            if (type === 'clear') return;

            // 移除空占位
            const empty = logEl.querySelector('.gateway-log-empty');
            if (empty) empty.remove();

            const line = document.createElement('div');
            line.className = `gateway-log-line gateway-log-${entry.type}`;
            const ts = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
            line.textContent = `[${ts}] ${entry.message}`;
            logEl.appendChild(line);
            logEl.scrollTop = logEl.scrollHeight;
        });
    }
}
