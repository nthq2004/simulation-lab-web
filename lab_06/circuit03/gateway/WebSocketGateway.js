/**
 * WebSocketGateway - WebSocket 网关桥接
 *
 * 作为 SerialGateway 的备选方案，通过 WebSocket 连接外部硬件网关，
 * 适用于无法直接使用 Web Serial API 的环境。
 */
export class WebSocketGateway {
    constructor(url) {
        this.url = url || '';
        this.ws = null;
        this._onData = null;
        this._onError = null;
        this._connected = false;
        this._reconnectTimer = null;
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 5;
        this._reconnectDelay = 3000;
    }

    /**
     * 建立 WebSocket 连接
     * @param {string} [url] - WebSocket 服务端 URL，如 ws://192.168.1.100:8080
     * @returns {Promise<boolean>}
     */
    async connect(url) {
        if (this._connected) {
            console.warn('[WebSocketGateway] 已连接，请先断开');
            return false;
        }

        const targetUrl = url || this.url;
        if (!targetUrl) {
            throw new Error('[WebSocketGateway] 未指定 WebSocket URL');
        }
        this.url = targetUrl;

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(targetUrl);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    console.log(`[WebSocketGateway] 已连接到 ${targetUrl}`);
                    this._connected = true;
                    this._reconnectAttempts = 0;
                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    let data;

                    if (event.data instanceof ArrayBuffer) {
                        data = new Uint8Array(event.data);
                    } else if (typeof event.data === 'string') {
                        data = event.data;
                    } else {
                        // Blob 或其他类型，尝试转为 ArrayBuffer
                        try {
                            data = event.data;
                        } catch (e) {
                            console.warn('[WebSocketGateway] 未知的消息类型:', typeof event.data);
                            return;
                        }
                    }

                    if (this._onData) {
                        this._onData(data);
                    }
                };

                this.ws.onerror = (err) => {
                    console.error('[WebSocketGateway] WebSocket 错误:', err);
                    if (this._onError) this._onError(err);
                    if (!this._connected) {
                        reject(new Error(`[WebSocketGateway] 连接失败: ${targetUrl}`));
                    }
                };

                this.ws.onclose = (event) => {
                    console.log(`[WebSocketGateway] 连接已关闭 (code=${event.code})`);
                    this._connected = false;
                    this.ws = null;

                    // 非正常关闭时尝试重连
                    if (event.code !== 1000 && this._reconnectAttempts < this._maxReconnectAttempts) {
                        this._scheduleReconnect();
                    }
                };

                // 连接超时处理
                setTimeout(() => {
                    if (!this._connected && this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                        this.ws.close();
                        reject(new Error('[WebSocketGateway] 连接超时'));
                    }
                }, 10000);

            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 断开 WebSocket 连接
     */
    disconnect() {
        this._clearReconnect();
        if (this.ws) {
            try {
                this.ws.close(1000, '用户主动断开');
            } catch (e) { /* ignore */ }
            this.ws = null;
        }
        this._connected = false;
        console.log('[WebSocketGateway] 已断开');
    }

    /**
     * 发送数据
     * @param {string|ArrayBuffer|Uint8Array} data - 要发送的数据
     */
    send(data) {
        if (!this._connected || !this.ws) {
            throw new Error('[WebSocketGateway] 未连接，无法发送数据');
        }

        try {
            let payload;
            if (data instanceof Uint8Array) {
                // Uint8Array 的底层 buffer 可能比实际数据大，需要复制
                if (data.byteLength === data.buffer.byteLength) {
                    payload = data.buffer;
                } else {
                    payload = data.slice().buffer;
                }
            } else {
                payload = data;
            }
            this.ws.send(payload);
        } catch (err) {
            console.error('[WebSocketGateway] 发送失败:', err);
            if (this._onError) this._onError(err);
        }
    }

    /**
     * 注册数据接收回调
     * @param {Function} callback
     */
    onData(callback) {
        this._onData = callback;
    }

    /**
     * 注册错误回调
     * @param {Function} callback
     */
    onError(callback) {
        this._onError = callback;
    }

    /** 是否已连接 */
    get connected() {
        return this._connected;
    }

    // ── 私有方法 ──

    _scheduleReconnect() {
        this._clearReconnect();
        this._reconnectAttempts++;
        const delay = this._reconnectDelay * Math.min(this._reconnectAttempts, 3);

        console.log(
            `[WebSocketGateway] 将在 ${delay}ms 后尝试第 ${this._reconnectAttempts} 次重连`
        );

        this._reconnectTimer = setTimeout(() => {
            if (!this._connected) {
                this.connect().catch(err => {
                    console.warn('[WebSocketGateway] 重连失败:', err.message);
                });
            }
        }, delay);
    }

    _clearReconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
}
