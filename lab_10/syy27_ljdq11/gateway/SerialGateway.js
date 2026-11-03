/**
 * SerialGateway - Web Serial API 包装器
 *
 * 通过 USB 转串口适配器连接物理硬件设备。
 * 提供 connect/disconnect/send 以及数据接收回调。
 *
 * 注意：Web Serial API 目前仅在 Chrome/Edge 等基于 Chromium 的浏览器中可用。
 * 使用前请检查 navigator.serial 是否存在。
 */
export class SerialGateway {
    constructor(options = {}) {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this._onData = null;
        this._onError = null;
        this._baudRate = options.baudRate || 115200;
        this._dataBits = options.dataBits || 8;
        this._stopBits = options.stopBits || 1;
        this._parity = options.parity || 'none';
        this._flowControl = options.flowControl || 'none';
        this._connected = false;
        this._reading = false;
        this._buffer = new Uint8Array(0); // 粘包缓冲区
    }

    /**
     * 请求用户选择串口并建立连接
     * @param {object} [filters] - 可选的端口过滤器，例如 { usbVendorId: 0x1234 }
     * @returns {Promise<boolean>} 连接是否成功
     */
    async connect(filters) {
        if (this._connected) {
            console.warn('[SerialGateway] 已连接，请先断开');
            return false;
        }

        // 检查 Web Serial API 可用性
        if (!navigator.serial) {
            throw new Error(
                'Web Serial API 不可用。请使用 Chrome/Edge 等基于 Chromium 的浏览器，'
                + '并确保页面通过 HTTPS 或 localhost 访问。'
            );
        }

        try {
            // 请求用户选择串口
            this.port = await navigator.serial.requestPort(filters ? { filters } : undefined);

            // 打开端口
            await this.port.open({
                baudRate: this._baudRate,
                dataBits: this._dataBits,
                stopBits: this._stopBits,
                parity: this._parity,
                flowControl: this._flowControl,
            });

            this._connected = true;
            this._reading = true;

            // 获取 writer
            this.writer = this.port.writable.getWriter();

            // 启动读取循环
            this._startReading().catch(err => {
                console.error('[SerialGateway] 读取循环异常:', err);
                if (this._onError) this._onError(err);
            });

            console.log(`[SerialGateway] 串口已连接 (${this._baudRate} baud)`);
            return true;
        } catch (err) {
            this._connected = false;
            this.port = null;
            // 用户取消选择时不视为错误
            if (err.name === 'NotFoundError') {
                console.log('[SerialGateway] 用户取消了端口选择');
                return false;
            }
            console.error('[SerialGateway] 连接失败:', err);
            throw err;
        }
    }

    /**
     * 断开串口连接
     */
    async disconnect() {
        this._reading = false;

        try {
            // 释放 writer
            if (this.writer) {
                try {
                    await this.writer.close();
                } catch (e) {
                    // writer 可能已关闭
                }
                this.writer = null;
            }

            // 释放 reader
            if (this.reader) {
                try {
                    await this.reader.cancel();
                } catch (e) {
                    // reader 可能已取消
                }
                this.reader = null;
            }

            // 关闭端口
            if (this.port) {
                try {
                    await this.port.close();
                } catch (e) {
                    // 端口可能已关闭
                }
                this.port = null;
            }
        } catch (err) {
            console.error('[SerialGateway] 断开连接时出错:', err);
        }

        this._connected = false;
        this._buffer = new Uint8Array(0);
        console.log('[SerialGateway] 串口已断开');
    }

    /**
     * 发送数据到串口
     * @param {Uint8Array|ArrayBuffer|number[]} data - 要发送的数据
     */
    async send(data) {
        if (!this._connected || !this.writer) {
            throw new Error('[SerialGateway] 未连接，无法发送数据');
        }

        let bytes;
        if (data instanceof Uint8Array) {
            bytes = data;
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else if (Array.isArray(data)) {
            bytes = new Uint8Array(data);
        } else {
            throw new Error('[SerialGateway] 不支持的数据类型，请使用 Uint8Array/ArrayBuffer/number[]');
        }

        try {
            await this.writer.write(bytes);
        } catch (err) {
            console.error('[SerialGateway] 发送失败:', err);
            if (this._onError) this._onError(err);
            throw err;
        }
    }

    /**
     * 内部读取循环
     * 持续从串口读取数据并通过回调传递
     */
    async _startReading() {
        if (!this.port) return;

        try {
            this.reader = this.port.readable.getReader();

            while (this._reading) {
                try {
                    const { value, done } = await this.reader.read();

                    if (done) {
                        // 流已结束
                        console.log('[SerialGateway] 读取流已结束');
                        break;
                    }

                    if (value && value.byteLength > 0) {
                        // 粘包处理：累积到缓冲区
                        this._buffer = this._concatBuffer(this._buffer, value);

                        // 如果有回调，传递原始数据
                        if (this._onData) {
                            this._onData(value);
                        }
                    }
                } catch (err) {
                    if (!this._reading) break; // 主动断开，忽略错误
                    console.error('[SerialGateway] 读取错误:', err);
                    if (this._onError) this._onError(err);
                    break;
                }
            }
        } catch (err) {
            console.error('[SerialGateway] 读取循环初始化失败:', err);
        } finally {
            // 清理 reader
            if (this.reader) {
                try {
                    this.reader.releaseLock();
                } catch (e) { /* ignore */ }
                this.reader = null;
            }
            this._connected = false;
        }
    }

    /**
     * 连接两个 Uint8Array
     */
    _concatBuffer(a, b) {
        const result = new Uint8Array(a.length + b.length);
        result.set(a);
        result.set(b, a.length);
        return result;
    }

    /**
     * 注册数据接收回调
     * @param {Function} callback - 接收 Uint8Array 数据的回调
     */
    onData(callback) {
        this._onData = callback;
    }

    /**
     * 注册错误回调
     * @param {Function} callback - 接收 Error 对象的回调
     */
    onError(callback) {
        this._onError = callback;
    }

    /** 是否已连接 */
    get connected() {
        return this._connected;
    }
}
