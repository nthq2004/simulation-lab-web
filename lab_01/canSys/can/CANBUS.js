/**
 * CANBUS.js — CAN 总线通信管理器
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 职责：
 *   1. 维护一条虚拟 CAN 总线，所有挂载节点共享同一总线对象
 *   2. 提供 send(frame) 接口，模拟总线仲裁与广播
 *   3. 根据帧 ID 路由到订阅了该 ID 或 ID 范围的节点回调
 *   4. 统计流量、错误、负载率等诊断信息
 *   5. 支持总线错误注入（用于仿真故障）
 *   6. 提供总线监控接口（供 CentralComputer 读取）
 *
 * 帧 ID 分配规则（11 位标准帧）：
 *   Bit[10:7] = 功能码 (4 bit)    Bit[6:0] = 节点地址 (7 bit，低 4 位有效 0~15)
 *
 *   功能码：
 *     0x01 = AI 上报        0x02 = → AI 配置
 *     0x01 = AO 状态心跳    0x02 = → AO 指令
 *     0x01 = DI 上报        0x02 = → DI 配置
 *     0x01 = DO 状态心跳    0x02 = → DO 指令
 * *   0x03 = AI 回复 
 *     0x03 = AO 回复
 *     0x03 = DI 回复
 *     0x03 = DO 回复
 *     0x0F = 广播/系统帧
 *     0x00 = 管理帧
 *
 * 使用方式：
 *   const bus = new CANBus({ bitrate: 250000 });
 *   bus.attach(aiModule);    // 模块需实现 onCanReceive(frame) 和具有 nodeAddress / id 属性
 *   bus.attach(ccModule);    // 中央计算机也作为节点挂载
 *   aiModule.sys.canBus = bus;   // 通过 sys 注入给各模块
 */

// ─────────────────────────────────────────────
//  帧结构定义（JSDoc）
// ─────────────────────────────────────────────
/**
 * @typedef {Object} CANFrame
 * @property {number}   id        — 11 位帧 ID
 * @property {boolean}  extended  — 是否扩展帧（29位），本系统固定 false
 * @property {boolean}  rtr       — 远程请求帧
 * @property {number}   dlc       — 数据长度 (0~8)
 * @property {number[]} data      — 数据字节数组
 * @property {string}   sender    — 发送方模块 id
 * @property {number}   timestamp — 发送时间戳 ms
 * @property {number}   [busLoad] — 总线负载（由总线填充）
 */

// ─────────────────────────────────────────────
//  功能码常量
// ─────────────────────────────────────────────
export const CAN_FUNC = {
    FUNC_REPORT: 0x01,
    AI_REPORT: 0x01,   // AI  → 中央
    AO_STATUS: 0x01,   // AO  → 中央
    DI_REPORT: 0x01,   // DI  → 中央
    DO_STATUS: 0x01,   // DO  → 中央

    FUNC_CONFIG: 0x02,
    AI_CONFIG: 0x02,   // 中央 → AI
    AO_CMD: 0x02,   // 中央 → AO
    DI_CONFIG: 0x02,   // 中央 → DI
    DO_CMD: 0x02,   // 中央 → DO

    FUNC_REPLY: 0x03,
    AI_REPLY: 0x03,   // AI  → 中央
    AO_REPLY: 0x03,   // AO  → 中央
    DI_REPLY: 0x03,   // DI  → 中央
    DO_REPLY: 0x03,   // DO  → 中央  

    BROADCAST: 0x0F,   // 系统广播
    NMT: 0x00,   // 网络管理
};

// ─────────────────────────────────────────────
//  NMT 命令代码定义
// ─────────────────────────────────────────────
export const NMT_CMD = {
    START: 0x01,     // 启动命令：进入运行状态 (init/preop → run)
    STOP: 0x02,     // 停止命令：进入停止状态 (run → stop)
    RESET: 0x81,     // 节点复位：重新初始化 (任何状态 → init)
    RESETCOM: 0x82,     // 通信复位：重置通信计数 (任何状态，保持当前状态)
};

// ─────────────────────────────────────────────
//  NMT 节点状态定义
// ─────────────────────────────────────────────
export const NMT_STATE = {
    INIT: 'init',     // 初始化状态
    PREOP: 'preop',    // 预运行状态
    RUN: 'run',      // 运行状态
    STOP: 'stop',     // 停止状态
    RESET: 'reset',    // 复位状态
};

// ─────────────────────────────────────────────
//  帧 ID 辅助函数
// ─────────────────────────────────────────────
export const CANId = {
    /** 编码帧 ID */
    encode(funcCode, nodeAddr) {
        return ((funcCode & 0x0F) << 7) | (nodeAddr & 0x7F);
    },

    /** 解码帧 ID */
    decode(id) {
        return {
            funcCode: (id >> 7) & 0x0F,
            nodeAddr: id & 0x7F,
        };
    },

    /** 从帧 ID 提取功能码 */
    funcCode(id) { return (id >> 7) & 0x0F; },

    /** 从帧 ID 提取节点地址 */
    nodeAddr(id) { return id & 0x7F; },
};

// ─────────────────────────────────────────────
//  CAN 总线主类
// ─────────────────────────────────────────────
export class CANBus {

    /**
     * @param {Object}  [config]
     * @param {number}  [config.bitrate=250000]     — 波特率 bps（用于负载计算）
     * @param {boolean} [config.loopback=false]      — 回环模式（发送方自己也收到帧）
     * @param {boolean} [config.silent=false]        — 静默模式（只监听，不参与仲裁）
     * @param {number}  [config.maxQueueLen=64]      — 发送队列长度上限
     * @param {number}  [config.propagationDelay=0]  — 仿真传播延迟 ms（0=立即）
     * @param {boolean} [config.verbose=false]       — 控制台打印所有帧
     */
    constructor(config = {}) {
        this.bitrate = config.bitrate ?? 250000;
        this.loopback = config.loopback ?? false;
        this.silent = config.silent ?? false;
        this.maxQueueLen = config.maxQueueLen ?? 64;
        this.propagationDelay = config.propagationDelay ?? 0;
        this.verbose = config.verbose ?? false;

        // ── 节点注册表 ──
        // key: 节点 id (字符串)，value: { module, nodeAddress, subscriptions[] }
        this._nodes = new Map();

        // ── 订阅表 ──某节点调用send（），最后要根据frameID，找到发给谁，每个有效frameID，都有对应接收节点列表
        // key: 帧 ID (number) 或 '*'(全局)，value: Set<nodeId>节点id列表，
        this._subscriptions = new Map();

        // ── 统计 ──
        this._stats = {
            txFrames: 0,    // 总发送帧数
            rxFrames: 0,    // 总接收（分发）帧数
            errorFrames: 0,    // 错误帧数
            busOffCount: 0,    // 总线关闭次数
            dropped: 0,    // 丢帧数（队列溢出）
            startTime: Date.now(),
        };

        // ── 帧日志（最近 N 帧，供监控读取）──
        this._frameLog = [];
        this._maxLogLen = 100;

        // ── 错误注入 ──
        this._faultMode = false;   // true = 所有帧注入随机错误
        this._faultRate = 0;       // 0~1，错误概率
        this._busOff = false;   // 总线关闭状态

        // ── 发送队列（支持带延迟的仿真）──
        this._queue = [];
        this._queueTimer = null;

        // ── 负载监测 ──
        this._loadWindow = [];     // [{ts, bits}]
        this._busLoad = 0;      // 当前总线负载 %
        this._loadInterval = setInterval(() => this._calcBusLoad(), 1000);

        // ── 心跳广播定时器 ──
        this._heartbeatInterval = null;
    }

    // ══════════════════════════════════════════
    //  节点管理
    // ══════════════════════════════════════════

    /**
     * 挂载模块到总线
     * 模块须具备：
     *   - module.id           — 唯一字符串标识
     *   - module.nodeAddress  — CAN 节点地址 0~15（中央计算机可设为 0）
     *   - module.onCanReceive — function(frame) 接收回调（可选）
     *
     * @param {Object} module
     * @param {number[]} [extraSubscriptions] — 额外订阅的帧 ID 列表
     */
    attach(module, extraSubscriptions = []) {
        if (!module || !module.id) {
            console.warn('[CANBus] attach: 模块缺少 id 属性');
            return this;
        }
        if (this._nodes.has(module.id)) {
            console.warn(`[CANBus] 节点 ${module.id} 已挂载，跳过`);
            return this;
        }
        const addr = module.nodeAddress ?? 0;

        //    1. 推断默认订阅：根据模块类型（如 AI, AO）确定它默认需要监听哪些报文 ID
        //    并将默认订阅与传入的额外订阅合并，去重
        const defaultSubs = this._inferSubscriptions(module, addr);
        const allSubs = [...new Set([...defaultSubs, ...extraSubscriptions])];
        //    2. 注册节点信息
        //    将节点存入 Map，记录模块实例、地址、订阅列表及统计信息
        this._nodes.set(module.id, {
            module,
            nodeAddress: addr,
            subscriptions: allSubs,
            txCount: 0,
            rxCount: 0,
            lastActivity: 0,
            online: module.powerOn && module.busConnected && !module.commFault,
        });
        // 3. 注册订阅关系
        //    遍历该节点订阅的所有帧 ID，在总线的订阅列表中建立映射
        allSubs.forEach(frameId => this._subscribe(frameId, module.id));
        console.log(`[CANBus] 节点加入: ${module.id}  addr=${addr}  subs=[${allSubs.map(id => '0x' + id.toString(16)).join(', ')}]`);
        // 4. 返回当前对象以支持链式调用        
        return this;
    }

    /** 卸载节点 */
    detach(moduleId) {
        const node = this._nodes.get(moduleId);
        if (!node) return this;

        // 1. 清理订阅关系
        //    遍历该节点订阅的所有帧 ID
        node.subscriptions.forEach(frameId => {
            // 获取该帧 ID 对应的订阅者集合
            const subs = this._subscriptions.get(frameId);
            // 如果集合存在，从集合中移除该节点 ID
            if (subs) subs.delete(moduleId);
        });
        // 2. 从节点列表中彻底删除该节点
        this._nodes.delete(moduleId);
        console.log(`[CANBus] 节点下线: ${moduleId}`);
        return this;
    }

    /** 根据模块类型推断其应该接收哪些帧 ID */
    _inferSubscriptions(module, addr) {
        const subs = [];
        const type = module.type || '';

        switch (type) {
            case 'AI':
                // AI 模块需要接收来自中央计算机的配置帧（如修改量程、报警值）
                subs.push(CANId.encode(CAN_FUNC.AI_CONFIG, addr));
                subs.push(CANId.encode(CAN_FUNC.AI_REPORT, addr));
                subs.push(CANId.encode(CAN_FUNC.AI_REPLY, addr));
                break;
            case 'AO':
                // AO 模块需要接收来自中央计算机的指令帧（如设置输出值）
                subs.push(CANId.encode(CAN_FUNC.AO_CMD, addr));
                subs.push(CANId.encode(CAN_FUNC.AO_STATUS, addr));
                subs.push(CANId.encode(CAN_FUNC.AO_REPLY, addr));
                break;
            case 'DI':
                // DI 模块接收来自中央的配置帧
                subs.push(CANId.encode(CAN_FUNC.DI_CONFIG, addr));
                subs.push(CANId.encode(CAN_FUNC.DI_REPORT, addr));
                subs.push(CANId.encode(CAN_FUNC.DI_REPLY, addr));
                break;
            case 'DO':
                // DO 模块接收来自中央的指令帧
                subs.push(CANId.encode(CAN_FUNC.DO_CMD, addr));
                subs.push(CANId.encode(CAN_FUNC.DO_STATUS, addr));
                subs.push(CANId.encode(CAN_FUNC.DO_REPLY, addr));
                break;
            case 'CentralComputer':
                // 中央计算机订阅所有现场模块的上报帧（遍历可能的地址 0~15）
                for (let a = 0; a <= 4; a++) {
                    subs.push(CANId.encode(CAN_FUNC.AI_REPORT, a));
                    subs.push(CANId.encode(CAN_FUNC.AI_CONFIG, a));
                    subs.push(CANId.encode(CAN_FUNC.AI_REPLY, a));
                }
                break;
            default:
                break;
        }

        // 所有节点都接收广播帧和 NMT 帧
        subs.push(CANId.encode(CAN_FUNC.BROADCAST, 0x00));
        subs.push(CANId.encode(CAN_FUNC.NMT, 0x00));
        return subs;
    }

    /** 订阅指定帧 ID */
    _subscribe(frameId, nodeId) {
        // 1. 检查总线的订阅列表中是否已存在该帧 ID 的集合
        if (!this._subscriptions.has(frameId)) {
            this._subscriptions.set(frameId, new Set());
        }
        // 2. 将节点 ID 添加到该帧 ID 的订阅者集合中
        //    这样当总线收到该 ID 的报文时，就知道要发给谁
        this._subscriptions.get(frameId).add(nodeId);
    }

    // ══════════════════════════════════════════
    //  发送接口
    // ══════════════════════════════════════════

    /**
     * 发送一帧到总线
     * @param {CANFrame} frame
     * @throws {Error} 总线关闭时抛出
     */
    send(frame) {
        // 1. 总线状态检查
        // 如果总线已关闭（Bus-Off 状态，通常由严重错误导致），禁止发送        
        if (this._busOff) {
            this._stats.errorFrames++;
            throw new Error('[CANBus] 总线已关闭 (Bus-Off)');
        }
        // 如果处于静音模式（silent），不执行发送逻辑（用于仅监听模式）        
        if (this.silent) return;

        // 2. 时间戳填充
        // 如果帧对象中未包含时间戳，则使用当前系统时间
        frame.timestamp = frame.timestamp ?? Date.now();

        // 3. 合法性校验
        // 调用内部验证函数，如果帧格式不合法（如 ID 越界），则丢弃
        if (!this._validateFrame(frame)) {
            this._stats.errorFrames++;
            return;
        }

        // 4. 错误注入（故障模拟）
        // 如果开启了故障模式 且 随机数小于故障率，模拟丢包
        if (this._faultMode && Math.random() < this._faultRate) {
            this._stats.errorFrames++;
            if (this.verbose) console.warn(`[CANBus] 错误注入: 帧 0x${frame.id.toString(16)} 丢弃`);
            return;
        }

        // 5. 队列溢出检测
        // 如果发送队列已满（达到最大长度），丢弃新帧
        if (this._queue.length >= this.maxQueueLen) {
            this._stats.dropped++;
            if (this.verbose) console.warn(`[CANBus] 队列溢出，丢帧: 0x${frame.id.toString(16)}`);
            return;
        }

        // 6. 统计更新
        this._stats.txFrames++;
        // 获取发送方节点信息
        const node = this._nodes.get(frame.sender);
        // 节点发送计数 +1，更新节点最后活动时间
        if (node) { node.txCount++; node.lastActivity = Date.now(); }

        // 7. 负载统计（计算总线利用率）44bit 固定开销 (帧头 19 + DLC 4 + CRC 15 + ACK 2 + EOF 7 等) + 数据位
        const frameBits = 44 + (frame.dlc ?? 0) * 8;
        // 将当前帧的时间戳和比特数推入滑动窗口数组，用于计算实时负载
        this._loadWindow.push({ ts: Date.now(), bits: frameBits });

        // 8. 记录帧日志
        // 将帧信息加入历史日志数组（用于调试或回放）
        this._logFrame(frame);

        // 9. 详细日志输出
        if (this.verbose) {
            // 解析帧 ID，获取功能码和节点地址
            const { funcCode, nodeAddr } = CANId.decode(frame.id);
            // 打印发送日志：ID, 功能码, 节点地址, 数据长度, 数据内容, 发送者
            console.log(`[CANBus TX] id=0x${frame.id.toString(16).padStart(3, '0')} func=0x${funcCode.toString(16)} node=${nodeAddr} dlc=${frame.dlc} data=[${frame.data?.map(b => b.toString(16).padStart(2, '0')).join(' ')}] from=${frame.sender}`);
        }

        // 10. 分发处理（带可选延迟）
        // 如果配置了传播延迟（模拟物理传输延迟）
        if (this.propagationDelay > 0) {
            // 将帧加入队列
            this._queue.push(frame);
            if (!this._queueTimer) {
                // 如果当前没有活动的定时器（防止重复创建定时器
                this._queueTimer = setTimeout(() => {
                    // 从队列取出第一帧
                    const f = this._queue.shift();
                    // 如果取到了帧，执行分发
                    if (f) this._dispatch(f);
                    // 清空定时器引用
                    this._queueTimer = null;
                }, this.propagationDelay);
            }
        } else {
            // 无延迟，直接分发
            this._dispatch(frame);
        }
    }

    // ══════════════════════════════════════════
    //  内部分发
    // ══════════════════════════════════════════
    _dispatch(frame) {
        // 创建一个 Set 用于存储接收者 ID，自动去重
        const recipients = new Set();

        // 1. 精确匹配订阅，查找订阅了该特定帧 ID 的节点
        const exactSubs = this._subscriptions.get(frame.id);
        if (exactSubs) exactSubs.forEach(id => recipients.add(id));

        // 2. 查找订阅了通配符 '*' 的节点（通常是调试工具或总线分析仪）
        const globalSubs = this._subscriptions.get('*');
        if (globalSubs) globalSubs.forEach(id => recipients.add(id));

        // 3. 广播帧：发给所有在线节点
        const { funcCode } = CANId.decode(frame.id);
        if (funcCode === CAN_FUNC.BROADCAST || funcCode === CAN_FUNC.NMT) {
            this._nodes.forEach((node, id) => recipients.add(id));
        }

        // 4. 回环：发送方也收（可选）
        if (!this.loopback) recipients.delete(frame.sender);

        // 5. 逐节点回调
        recipients.forEach(nodeId => {
            // 获取节点对象
            const node = this._nodes.get(nodeId);
            // 节点一定要在线，才能收到消息。
            if (!node || !node.online) return;
            // 检查节点是否实现了 onCanReceive 回调函数
            if (typeof node.module.onCanReceive === 'function') {
                try {
                    // 执行回调，将帧传递给模块
                    node.module.onCanReceive(frame);
                    node.rxCount++;  // 更新统计信息
                    node.lastActivity = Date.now();
                    this._stats.rxFrames++;
                } catch (e) {
                    // 捕获回调中的异常，防止一个模块的错误导致总线崩溃
                    this._stats.errorFrames++;
                    console.error(`[CANBus] 节点 ${nodeId} 回调异常:`, e);
                }
            }
        });
        // 6. 无接收者日志
        // 如果开启了详细日志且没有接收者，打印警告（可能是 ID 配置错误）
        if (this.verbose && recipients.size === 0) {
            // console.log(`[CANBus] 帧 0x${frame.id.toString(16)} 无接收者`);
        }
    }

    // ══════════════════════════════════════════
    //  帧合法性验证
    // ══════════════════════════════════════════
    _validateFrame(frame) {
        // 1. 校验帧 ID
        // 标准 CAN 帧 ID 范围是 0x000 ~ 0x7FF (11位)
        // 如果不是数字或超出范围，视为非法        
        if (typeof frame.id !== 'number' || frame.id < 0 || frame.id > 0x7FF) {
            console.warn('[CANBus] 非法帧 ID:', frame.id);
            return false;
        }
        // 2. 校验数据域
        // 如果 data 不是数组，初始化为空数组（容错处理）        
        if (!Array.isArray(frame.data)) frame.data = [];
        // 3. 长度截断
        // CAN 帧最大数据长度为 8 字节        
        if (frame.data.length > 8) {
            console.warn('[CANBus] 数据长度超限 (>8 bytes):', frame.data.length);
            frame.data = frame.data.slice(0, 8);
        }
        // 4. 更新 DLC (Data Length Code)
        // 将实际数据长度赋值给 dlc 属性        
        frame.dlc = frame.data.length;
        // 5. 修正字节值范围
        // 确保每个数据字节的值在 0x00 ~ 0xFF 之间
        // 逻辑：取最大值 0 和 最小值 255 之间的值，并四舍五入，如果无效则为 0
        frame.data = frame.data.map(b => Math.max(0, Math.min(0xFF, Math.round(b) || 0)));
        return true;
    }

    // ══════════════════════════════════════════
    //  帧日志
    // ══════════════════════════════════════════
    _logFrame(frame) {
        this._frameLog.unshift({
            id: frame.id,
            dlc: frame.dlc,
            data: [...(frame.data ?? [])],  // 深拷贝数据数组，防止后续修改影响日志
            sender: frame.sender,
            timestamp: frame.timestamp,
            funcCode: CANId.funcCode(frame.id),
            nodeAddr: CANId.nodeAddr(frame.id),
        });
        // 如果超长，移除数组末尾的元素（即最旧的记录）
        if (this._frameLog.length > this._maxLogLen) this._frameLog.pop();
    }

    // ══════════════════════════════════════════
    //  总线负载计算
    // ══════════════════════════════════════════
    _calcBusLoad() {
        const now = Date.now();
        // 1. 定义统计窗口大小为 1000 毫秒 (1秒)
        const windowMs = 1000;

        //2. 清理 1s 之前的数据
        this._loadWindow = this._loadWindow.filter(e => now - e.ts < windowMs);
        // 3. 计算总比特数
        // 累加窗口内所有帧的比特数 (包含帧头和有效数据)
        const totalBits = this._loadWindow.reduce((s, e) => s + e.bits, 0);
        // 4. 计算负载百分比
        // 公式：(总比特数 / 波特率) * 100
        this._busLoad = Math.min(100, (totalBits / this.bitrate) * 100);
    }

    // ══════════════════════════════════════════
    //  高层发送助手（供中央计算机调用）
    // ══════════════════════════════════════════

    /**
     * 向指定模块发送配置/指令帧
     * @param {string}   senderModuleId — 发送方 id
     * @param {number}   destFuncCode   — 目标功能码（如 CAN_FUNC.AO_CMD）
     * @param {number}   destNodeAddr   — 目标节点地址
     * @param {number[]} data           — 最多 8 字节
     */
    sendCommand(senderModuleId, destFuncCode, destNodeAddr, data = []) {
        // 调用基础的 send 方法发送构造好的帧对象
        this.send({
            //   编码 ID：将功能码和节点地址组合成 CAN ID
            //    例如：(功能码 << 7) | 节点地址            
            id: CANId.encode(destFuncCode, destNodeAddr),
            extended: false,// 使用标准帧 (11位 ID)，非扩展帧
            rtr: false,// 数据帧，非远程帧 (Remote Transmission Request)
            dlc: data.length, // 数据长度代码，等于数据数组的长度
            data,  // 数据内容 (例如：设定值、配置参数)
            sender: senderModuleId,  // 记录发送者 ID
            timestamp: Date.now(), // 记录发送时间
        });
    }

    /**
     * 发送广播帧（所有节点均收到）
     * @param {string}   senderModuleId
     * @param {number[]} data
     */
    broadcast(senderModuleId, data = []) {
        this.send({
            id: CANId.encode(CAN_FUNC.BROADCAST, 0x00),
            extended: false,
            rtr: false,
            dlc: data.length,
            data,
            sender: senderModuleId,
            timestamp: Date.now(),
        });
    }

    /**
     * 发送 NMT 帧（网络管理）
     * @param {string} senderModuleId
     * @param {number} cmd   0x01=启动, 0x02=停止, 0x81=复位, 0x82=复位通信
     * @param {number} [targetAddr=0]  0=所有节点
     */
    sendNMT(senderModuleId, cmd, targetAddr = 0) {
        this.send({
            id: CANId.encode(CAN_FUNC.NMT, 0x00),
            extended: false,
            rtr: false,
            dlc: 2,
            data: [cmd & 0xFF, targetAddr & 0xFF],
            sender: senderModuleId,
            timestamp: Date.now(),
        });
    }

    // ══════════════════════════════════════════
    //  错误注入（仿真）
    // ══════════════════════════════════════════

    /**
     * 启用/禁用错误注入
     * @param {boolean} enable
     * @param {number}  [rate=0.1]  — 错误概率 0~1
     */
    setFaultMode(enable, rate = 0.1) {
        this._faultMode = enable;
        this._faultRate = Math.max(0, Math.min(1, rate));
        console.log(`[CANBus] 错误注入: ${enable ? `已启用 (rate=${(rate * 100).toFixed(0)}%)` : '已禁用'}`);
    }

    /**
     * 模拟节点掉线（网络断开）
     * @param {string}  nodeId
     * @param {boolean} offline
     */
    setNodeOffline(nodeId, offline) {
        const node = this._nodes.get(nodeId);
        if (node) {
            node.online = !offline;
            console.log(`[CANBus] 节点 ${nodeId} ${offline ? '离线' : '上线'}`);
        }
    }

    /**
     * 触发总线关闭（Bus-Off），所有发送被拒
     * @param {boolean} busOff
     */
    setBusOff(busOff) {
        this._busOff = busOff;
        if (busOff) this._stats.busOffCount++;
        console.warn(`[CANBus] Bus-Off: ${busOff}`);
    }

    // ══════════════════════════════════════════
    //  全局监听（用于总线监控/嗅探）
    // ══════════════════════════════════════════

    /**
     * 注册一个原始帧监听器（收到所有帧）* 此方法允许外部模块“旁路”监听总线上的所有通信。
 * 监听器不会接收特定 ID 的帧，而是接收所有经过总线的帧。
     * @param {string}   listenerId   — 监听器 id（不影响正常节点）
     * @param {Function} callback     — function(frame)
     */
    addSniffer(listenerId, callback) {
        // 1. 初始化全局订阅列表
        // 检查订阅列表中是否存在通配符 '*' 的集合
        // 如果不存在（即还没有任何监听器），则创建一个新的 Set
        if (!this._subscriptions.has('*')) this._subscriptions.set('*', new Set());
        // 2. 注册“伪节点”
        // 用一个伪节点承载回调
        // 如果该监听器 ID 尚未注册为节点，则创建一个虚拟节点对象
        if (!this._nodes.has(listenerId)) {
            // 模块对象：包含 ID 和接收回调
            // 这里的 onCanReceive 就是传入的 callback，用于处理收到的帧
            this._nodes.set(listenerId, {
                module: { id: listenerId, onCanReceive: callback },
                // 节点地址：设为 0xFF (255)
                // 这是一个无效的物理地址，用于标识这是一个虚拟监听节点，而非真实硬件                
                nodeAddress: 0xFF,
                subscriptions: ['*'],
                txCount: 0, rxCount: 0, lastActivity: 0, online: true,
            });
        }
        // 3. 加入全局订阅组
        // 将监听器 ID 添加到 '*' 对应的订阅者集合中
        // 这样，当总线分发 '*' 类型的帧（即所有帧）时，该监听器也会被调用        
        this._subscriptions.get('*').add(listenerId);
        // 4. 支持链式调用
        return this;
    }

    /** 移除嗅探器 */
    removeSniffer(listenerId) {
        this._subscriptions.get('*')?.delete(listenerId);
        this._nodes.delete(listenerId);
        return this;
    }

    // ══════════════════════════════════════════
    //  状态查询接口
    // ══════════════════════════════════════════

    /** 获取总线统计信息 */
    getStats() {
        const uptime = ((Date.now() - this._stats.startTime) / 1000).toFixed(0);
        return {
            ...this._stats,
            busLoad: parseFloat(this._busLoad.toFixed(1)),
            busOff: this._busOff,
            faultMode: this._faultMode,
            faultRate: this._faultRate,
            nodeCount: this._nodes.size,
            bitrate: this.bitrate,
            uptimeS: Number(uptime),
        };
    }

    /** 获取所有节点状态列表 */
    getNodeList() {
        const list = [];
        // this._nodes 是一个 Map，forEach 的参数依次是 (value, key)
        this._nodes.forEach((node, id) => {
            // 将节点信息推入数组
            list.push({
                id,// 节点的唯一字符串标识
                nodeAddress: node.nodeAddress,
                type: node.module.type ?? 'unknown', // 模块类型 (如 'AI', 'AO')，若无则显示 'unknown'
                online: node.online,
                txCount: node.txCount,
                rxCount: node.rxCount,
                lastActivity: node.lastActivity,
                subscriptions: node.subscriptions,// 该节点订阅的帧 ID 列表
            });
        });
        return list.sort((a, b) => a.nodeAddress - b.nodeAddress);
    }

    /** 获取最近帧日志（供监控画面显示）*/
    getFrameLog(maxCount = 20) {
        return this._frameLog.slice(0, maxCount);
    }

    /** 获取当前总线负载 % */
    getBusLoad() { return this._busLoad; }

    /** 是否处于 Bus-Off 状态 */
    isBusOff() { return this._busOff; }

    /** 判断某节点是否在线 */
    isNodeOnline(moduleId) {
        return this._nodes.get(moduleId)?.online ?? false;
    }
    setNodeOnline(moduleId) {
        this._nodes.get(moduleId).online = true;
    }
    resetNodeOnline(moduleId) {
        this._nodes.get(moduleId).online = false;
    }
    // ══════════════════════════════════════════
    //  动态订阅管理
    // ══════════════════════════════════════════

    /**
     * 为已挂载节点追加订阅帧 ID
     * @param {string}   moduleId，一个ID要订阅许多帧
     * @param {number[]} frameIds，帧ID列表。
     */
    subscribe(moduleId, frameIds) {
        // 1. 获取节点对象
        // 从节点列表中查找目标模块
        const node = this._nodes.get(moduleId);
        if (!node) return;
        // 2. 更新节点本地的订阅列表
        // 检查该 ID 是否已经存在于节点的订阅列表中
        frameIds.forEach(fid => {
            // 如果不存在，则添加到列表中，防止重复订阅
            if (!node.subscriptions.includes(fid)) node.subscriptions.push(fid);
            // 3. 更新总线的全局订阅映射
            // 调用内部方法，将该模块 ID 注册到总线 _subscriptions Map 中对应帧 ID 的集合里
            // 这样当总线收到 fid 帧时，就会知道要分发给这个模块            
            this._subscribe(fid, moduleId);
        });
    }

    /**
     * 为已挂载节点取消订阅帧 ID
     * @param {string}   moduleId
     * @param {number[]} frameIds
     */
    unsubscribe(moduleId, frameIds) {
        const node = this._nodes.get(moduleId);
        if (!node) return;
        frameIds.forEach(fid => {
            node.subscriptions = node.subscriptions.filter(id => id !== fid);
            this._subscriptions.get(fid)?.delete(moduleId);
        });
    }

    // ══════════════════════════════════════════
    //  心跳广播（NMT Heartbeat，可选）
    // ══════════════════════════════════════════

    /**
     * 启动心跳广播（由中央计算机或总线管理器调用）启动一个定时器，周期性地向总线发送广播帧（心跳包）。
        * 这通常由中央计算机（主站）调用，用于告知从站“主站在线且系统处于运行状态”。
        * 如果从站长时间未收到心跳，可能会触发超时保护或进入安全状态。
     * @param {string} masterNodeId — 发起方 id
     * @param {number} [intervalMs=1000]
     */
    startHeartbeat(masterNodeId, intervalMs = 1000) {
        // 1. 清除旧定时器
        // 如果已存在心跳定时器，先清除它，防止创建多个定时器导致重复发送   
        if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = setInterval(() => {
            // 2. 发送条件检查
            // 只有当总线未关闭 (Bus-Off) 且 未处于静音模式时，才发送心跳            
            if (!this._busOff && !this.silent) {
                // 3. 发送广播消息，数据为 [0x05, 0x00]
                // 0x05 通常代表 CANopen 协议中的 'Operational' (运行中) 状态
                // 0x00 可能是保留位或表示无特定错误                
                this.broadcast(masterNodeId, [0x05, 0x00]); // 0x05 = Operational
            }
        }, intervalMs);
    }

    stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    // ══════════════════════════════════════════
    //  重置 & 销毁
    // ══════════════════════════════════════════

    /** 清除统计数据 */
    resetStats() {
        this._stats = { txFrames: 0, rxFrames: 0, errorFrames: 0, busOffCount: 0, dropped: 0, startTime: Date.now() };
        this._frameLog = [];
        this._loadWindow = [];
        this._busLoad = 0;
        console.log('[CANBus] 统计数据已重置');
    }

    /** 销毁总线（清除所有定时器和节点）*/
    destroy() {
        if (this._loadInterval) clearInterval(this._loadInterval);
        if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
        if (this._queueTimer) clearTimeout(this._queueTimer);
        this._nodes.clear();
        this._subscriptions.clear();
        this._frameLog = [];
        this._queue = [];
        console.log('[CANBus] 总线已销毁');
    }
}

// ─────────────────────────────────────────────
//  帧解析工具（供各模块使用）
// ─────────────────────────────────────────────
export const CANParser = {

    /** 解析 AI 上报帧，返回4路工程量 从 CAN 帧的数据域中提取 4 路通道的原始值。
     * 数据格式：每 2 个字节表示一个通道的有符号 16 位整数。*/
    parseAIReport(frame) {
        if (!frame || frame.data.length < 8) return null;
        // 1. 定义解包辅助函数
        // 将高字节和低字节拼接成有符号 16 位整数        
        const unpack16s = (hi, lo) => {
            let v = (hi << 8) | lo;
            // 符号扩展：如果最高位是 1（负数），则减去 0x10000 转为 JS 的负数表示
            // 注意：0x8000 (32768) 应该理解为 -32768，因此用 >= 而非 >
            if (v > 0x8000) v -= 0x10000;
            return v;
        };
        return {
            //2.  通道 1 和 2：通常对应 4-20mA 或 0-10V，精度较高 (scale 100)
            ch1: { raw: unpack16s(frame.data[0], frame.data[1]), scale: 100 },
            ch2: { raw: unpack16s(frame.data[2], frame.data[3]), scale: 100 },
            // 3. 通道 3 和 4：通常对应 RTD/TC，精度较低 (scale 10)
            ch3: { raw: unpack16s(frame.data[4], frame.data[5]), scale: 10 },
            ch4: { raw: unpack16s(frame.data[6], frame.data[7]), scale: 10 },
        };
    },

    /** 解析 AO 状态心跳帧  解析 AO 模块反馈的当前输出值、百分比和故障状态*/
    parseAOStatus(frame) {
        if (!frame || frame.data.length < 4) return null;
        return {
            // 1. 通道 1 和 2：通常对应电流输出，解析为 16 位值 (单位 0.01mA )
            ch1mA100: (frame.data[0] << 8) | frame.data[1],
            ch2mA100: (frame.data[2] << 8) | frame.data[3],
            // 2. 通道 3 和 4：通常对应百分比输出 (0-100%)
            ch3Pct: frame.data[4] ?? 0,
            ch4Pct: frame.data[5] ?? 0,
            // 故障字节：每一位代表一种故障类型
            faultByte: frame.data[6] ?? 0,
        };
    },

    /** 解析 DI 上报帧 */
    parseDIReport(frame) {
        if (!frame || frame.data.length < 4) return null;
        return {
            stateByte: frame.data[0],  // 状态字节
            faultByte: frame.data[1],  // 故障字节
            alarmByte: frame.data[2],  // 报警字节
            // 解析具体的通道状态 (0或1)
            // 使用按位与 (&) 和双重非 (!!) 运算将特定位转为布尔值            
            ch1State: !!(frame.data[0] & 0x01),
            ch2State: !!(frame.data[0] & 0x02),
            ch3State: !!(frame.data[0] & 0x04),
            ch4State: !!(frame.data[0] & 0x08),
        };
    },

    /** 解析 DO 状态心跳帧 */
    parseDOStatus(frame) {
        if (!frame || frame.data.length < 4) return null;
        return {
            stateByte: frame.data[0],  // 当前输出状态
            faultByte: frame.data[1],  // 故障状态
            holdByte: frame.data[2],   // 保持状态 (用于脉冲保持)
            pulseByte: frame.data[3],  // 脉冲状态
            // 解析具体的通道状态
            ch1State: !!(frame.data[0] & 0x01),
            ch2State: !!(frame.data[0] & 0x02),
            ch3State: !!(frame.data[0] & 0x04),
            ch4State: !!(frame.data[0] & 0x08),
        };
    },

    /** 构建 AO 指令帧 Data（8字节） */
    buildAOCmd(ch1Pct, ch2Pct, ch3Pct, ch4Pct) {
        // 编码辅助函数：将单个通道的百分比转为 2 字节数组
        const enc = v => {
            // 如果值为空，返回 0xFFFF，设备收到后会忽略该通道的更新（保持原值）
            if (v === null || v === undefined) return [0xFF, 0xFF]; // Hold
            // 限制范围 0-100，放大 100 倍转为整数 (精度 0.01%)
            const raw = Math.round(Math.max(0, Math.min(100, v)) * 100);
            return [(raw >> 8) & 0xFF, raw & 0xFF];
        };
        return [...enc(ch1Pct), ...enc(ch2Pct), ...enc(ch3Pct), ...enc(ch4Pct)];
    },

    /** 构建 DO 直接控制帧 Data */
    buildDOCmd(ch1, ch2, ch3, ch4) {
        // 1. 构建掩码字节 (Data[1])
        // 用于指示哪些通道需要更新
        // 如果值不为 undefined，则对应位设为 1        
        const mask = [ch1, ch2, ch3, ch4].reduce((b, v, i) => b | (v !== undefined ? (1 << i) : 0), 0);
        // 2. 构建状态字节 (Data[2])
        // 用于指示对应通道应置为 ON (1) 或 OFF (0)        
        const state = [ch1, ch2, ch3, ch4].reduce((b, v, i) => b | ((v ? 1 : 0) << i), 0);
        // 3. 返回指令数组
        // Data[0]: 命令字 (0x01 代表直接控制)
        // Data[1]: 掩码
        // Data[2]: 状态
        // Data[3]: 保留/填充        
        return [0x01, mask, state, 0x00];
    },
};

// ─────────────────────────────────────────────
//  系统初始化助手（一键组网）
// ─────────────────────────────────────────────
/**
 * 创建并配置整套 CAN 总线系统
 *
 * @param {Object} modules — { ai, ao, di, do: doMod, cc } 各模块实例
 * @param {Object} [busConfig] — CANBus 构造参数
 * @returns {CANBus}
 *
 * @example
 * import { createCANSystem } from './CANBUS.js';
 * const bus = createCANSystem({ ai, ao, di, do: doMod, cc });
 * // 之后各模块可通过 this.sys.canBus.send(frame) 发送
 */
export function createCANSystem(modules, busConfig = {}) {
    const bus = new CANBus({ bitrate: 250000, verbose: false, ...busConfig });

    // 挂载各模块（按优先级顺序）
    if (modules.cc) bus.attach(modules.cc);
    if (modules.ai) bus.attach(modules.ai);
    if (modules.ao) bus.attach(modules.ao);
    if (modules.di) bus.attach(modules.di);
    if (modules.do) bus.attach(modules.do);

    // 将 bus 注入到各模块的 sys.canBus
    Object.values(modules).forEach(m => {
        if (m && m.sys) m.sys.canBus = bus;
    });

    // 启动心跳（若中央计算机存在）
    // if (modules.cc) {
    //     bus.startHeartbeat(modules.cc.id, 2000);
    // }

    console.log('[CANBus] 系统初始化完成，节点数:', bus.getNodeList().length);
    return bus;
}