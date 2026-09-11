import { BaseComponent } from './BaseComponent.js';

/**
 * 工业上位机 SCADA/HMI 仿真组件
 * （Industrial SCADA / HMI Workstation）
 *
 * ── 外观描述 ────────────────────────────────────────────────────────
 *
 *  参考西门子 SIMATIC IPC477E / WinCC SCADA 工作站外观：
 *
 *  1. 机箱主体（Chassis）
 *     - 标准工业塔式机箱，深灰色铝合金面板
 *     - 顶部散热格栅（竖条纹）
 *     - 前面板：电源按钮（蓝色 LED）、硬盘指示灯（橙色）、USB 接口、光驱槽
 *     - 品牌铭牌（SIMATIC IPC）
 *
 *  2. 工业显示器（Monitor）
 *     - 15" 工业级触摸屏，附于机箱上方
 *     - 黑色金属边框，前面板指示灯（电源绿色）
 *     - 屏幕内容：SCADA 画面（动态刷新）
 *       · 标题栏：项目名 + 连接状态 + 时钟
 *       · 数值显示区：6个数值框（I/Q/AIW/AQW/VD/报警）
 *       · 迷你趋势图（实时曲线，最近60秒）
 *       · 状态指示灯行（I0.0~Q0.7 位图）
 *       · 报警条（滚动）
 *
 *  3. 工业键盘（Keyboard）
 *     - 防水防尘薄膜键盘，位于显示器下方机箱前面板
 *
 *  4. 以太网端口（ETH）
 *     - RJ45 接口 × 2，位于机箱背面（组件底部标注）
 *     - 连接指示灯（Link/ACT）
 *
 *  5. 通信电缆动画
 *     - 以太网线（bus 类型端口）
 *     - 连接时显示数据流动粒子动画
 *
 * ── SCADA 软件引擎 ──────────────────────────────────────────────────
 *
 *  ConnectManager（连接管理）：
 *    - 连接/断开 CPU ST20（通过 connectToCPU / disconnectFromCPU）
 *    - 仿真以太网握手延迟（300~600ms）
 *    - 通信状态：在线/离线/错误/超时
 *    - 数据轮询（每扫描周期同步 I/Q/M/V/AIW/AQW/T/C）
 *    - 收发帧计数、PING 延迟测量
 *
 *  ProgramEditor（梯形图编辑器）：
 *    - 保存/加载 JSON 格式梯形图程序
 *    - 下载程序到 CPU（仿真握手+写入+校验，约 1~3 秒）
 *    - 上传 CPU 当前程序
 *    - 在线监控（能流着色：绿=通，灰=断）
 *    - 在线/离线程序对比（差异检测）
 *
 *  WatchTable（监控表）：
 *    - 最多 32 个监控点
 *    - 实时读取 CPU 存储区（BOOL/INT/REAL/TIMER）
 *    - 强制写入（在线时有效）
 *    - 表格数据导出（CSV blob）
 *
 *  SCADAView（SCADA 画面）：
 *    - 可视化过程对象（水箱、电机、阀门、仪表、指示灯、开关）
 *    - 对象绑定到 CPU 地址，实时刷新
 *    - 支持操作（点击切换 Q/M 位）
 *
 *  AlarmManager（报警管理）：
 *    - 报警规则配置（超限、通信中断、CPU 错误）
 *    - 报警列表（时间、级别、信息、确认状态）
 *    - 声音报警模拟（屏幕闪烁）
 *
 *  TrendRecorder（趋势记录）：
 *    - 最多 8 通道，每通道 600 个采样点
 *    - 采样间隔与轮询周期同步
 *    - 画面内迷你趋势图（Canvas SVG）
 *
 *  PIDMonitor（PID 监控）：
 *    - 读取 CPU VD 存储区 PID 参数表
 *    - 实时显示 PV/SP/MX 趋势
 *    - 支持在线修改 SP/Kc/Ti/Td
 *
 * ── 与 ST20 通信机制（仿真） ─────────────────────────────────────────
 *
 *  connectToCPU(cpuInstance)：
 *    建立连接，自动 patch CPU 的 _readWord / _writeWord（若需要），
 *    启动数据轮询，握手延迟后 _connected = true。
 *
 *  disconnectFromCPU()：
 *    断开连接，停止轮询，清除数据镜像。
 *
 *  _pollCPU()（每 tick 调用）：
 *    从 CPU 实例读取所有存储区 → 更新 _mirror。
 *    触发报警检查、趋势采样、屏幕刷新。
 *
 *  _writeToC PU(addr, val)：
 *    写入 CPU 存储区（强制写入 / SCADA 操作 / PID SP 修改）。
 *    同时更新本地镜像。
 *
 *  downloadProgram(prog)：
 *    将编辑器程序 JSON 写入 CPU.program，
 *    仿真下载步骤（停止→清除→传输→校验→重启，1.5~3s）。
 *
 * ── 端口 ─────────────────────────────────────────────────────────────
 *  ETH0  — 以太网端口 0（bus 类型，连接 ST20 ETH 口）
 *  ETH1  — 以太网端口 1（bus 类型，备用 / 连接交换机）
 *
 * ── 可配置参数 ────────────────────────────────────────────────────────
 *  label          : 位号/名称（默认 'SCADA-1'）
 *  projectName    : 工程名称（默认 'SIMATIC WinCC 工程'）
 *  pcIP           : 本机 IP（默认 '192.168.1.100'）
 *  plcIP          : PLC IP（默认 '192.168.1.1'）
 *  pollIntervalMs : 轮询间隔 ms（默认 100）
 *  initConnected  : 初始是否已连接（默认 false）
 *  ladderProgram  : 初始梯形图程序 JSON（可选）
 */
export class SCADAWorkstation extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        // 组件尺寸：工业塔式机 + 显示器
        this.width  = Math.max(280, config.width  || 340);
        this.height = Math.max(420, config.height || 520);

        this.type    = 'scada_workstation';
        this.special = 'hmi';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initSCADAEngine();
        this._init();

        this.config = {
            label:         this.label,
            projectName:   this._projectName,
            pcIP:          this._pcIP,
            plcIP:         this._plcIP,
            pollIntervalMs:this._pollIntervalMs,
            initConnected: this._connected,
            ladderProgram: JSON.stringify(this._editorProgram),
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 显示器 ──────────────────────────────────────────────
        const monH  = H * 0.44;   // 显示器占总高度 44%
        const monW  = W * 0.92;
        const monX  = W * 0.04;
        const monY  = H * 0.02;

        this._monitor = {
            x: monX, y: monY, w: monW, h: monH,
            borderR: 4,
        };

        // 屏幕内容区（留出边框）
        this._screen = {
            x: monX + monW * 0.025,
            y: monY + monH * 0.045,
            w: monW * 0.95,
            h: monH * 0.86,
        };

        // 显示器底座连接柄
        this._monStand = {
            x: W * 0.40, y: monY + monH,
            w: W * 0.20, h: H * 0.025,
        };

        // ── 机箱主体 ─────────────────────────────────────────────
        const chassisY  = monY + monH + H * 0.025;
        const chassisH  = H - chassisY - H * 0.02;
        const chassisW  = W * 0.88;
        const chassisX  = W * 0.06;

        this._chassis = {
            x: chassisX, y: chassisY,
            w: chassisW, h: chassisH,
            borderR: 3,
        };

        // 机箱前面板分区
        const fp = this._chassis;

        // 品牌铭牌区（顶部）
        this._nameplate = {
            x: fp.x + fp.w * 0.04, y: fp.y + fp.h * 0.04,
            w: fp.w * 0.92,        h: fp.h * 0.15,
        };

        // 散热格栅（铭牌下方）
        this._ventGrill = {
            x: fp.x + fp.w * 0.04, y: fp.y + fp.h * 0.22,
            w: fp.w * 0.56,        h: fp.h * 0.22,
        };

        // 电源按钮
        this._powerBtn = {
            x: fp.x + fp.w * 0.68,
            y: fp.y + fp.h * 0.28,
            r: fp.h * 0.065,
        };

        // 硬盘 LED
        this._hddLED = {
            x: fp.x + fp.w * 0.78,
            y: fp.y + fp.h * 0.30,
            r: fp.h * 0.025,
        };

        // USB 接口（两个）
        this._usbPorts = [
            { x: fp.x + fp.w * 0.68, y: fp.y + fp.h * 0.50, w: fp.w * 0.06, h: fp.h * 0.07 },
            { x: fp.x + fp.w * 0.68, y: fp.y + fp.h * 0.60, w: fp.w * 0.06, h: fp.h * 0.07 },
        ];

        // 光驱槽
        this._dvdSlot = {
            x: fp.x + fp.w * 0.04, y: fp.y + fp.h * 0.50,
            w: fp.w * 0.56,        h: fp.h * 0.08,
        };

        // 以太网接口（底部，背面标注）
        this._ethPorts = [
            { x: fp.x + fp.w * 0.04, y: fp.y + fp.h * 0.75, w: fp.w * 0.20, h: fp.h * 0.12 },
            { x: fp.x + fp.w * 0.28, y: fp.y + fp.h * 0.75, w: fp.w * 0.20, h: fp.h * 0.12 },
        ];

        // 端口连接点（组件底部）
        const portY = H - 4;
        this._portPos = {
            ETH0: { x: fp.x + fp.w * 0.14, y: portY },
            ETH1: { x: fp.x + fp.w * 0.38, y: portY },
        };

        // 屏幕内部布局分区
        const sc = this._screen;
        this._screenLayout = {
            // 标题栏（顶部 12%）
            titleBar: { x: sc.x, y: sc.y, w: sc.w, h: sc.h * 0.12 },
            // 数值显示区（14%~38%，左右分3列2行）
            valGrid:  { x: sc.x, y: sc.y + sc.h * 0.13, w: sc.w, h: sc.h * 0.24 },
            // 趋势图（38%~65%）
            trendArea:{ x: sc.x, y: sc.y + sc.h * 0.38, w: sc.w, h: sc.h * 0.27 },
            // I/O 位图行（65%~78%）
            ioRow:    { x: sc.x, y: sc.y + sc.h * 0.66, w: sc.w, h: sc.h * 0.12 },
            // 报警条（78%~88%）
            alarmBar: { x: sc.x, y: sc.y + sc.h * 0.79, w: sc.w, h: sc.h * 0.10 },
            // 状态栏（88%~100%）
            statusBar:{ x: sc.x, y: sc.y + sc.h * 0.90, w: sc.w, h: sc.h * 0.10 },
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label           = config.label          || 'SCADA-1';
        this._projectName    = config.projectName    || 'SIMATIC WinCC 工程';
        this._pcIP           = config.pcIP           || '192.168.1.100';
        this._plcIP          = config.plcIP          || '192.168.1.1';
        this._pollIntervalMs = config.pollIntervalMs !== undefined ? config.pollIntervalMs : 100;
        this._connected      = false;
        this._connecting     = false;
        this._connError      = false;
        this._connErrorMsg   = '';
        this._cpu            = null;

        // 通信统计
        this._txCount        = 0;
        this._rxCount        = 0;
        this._pingMs         = 0;
        this._lastPollTs     = 0;
        this._uptimeStart    = 0;
        this._accumPollMs    = 0;

        // 数据粒子动画
        this._particles      = [];
        this._particleTimer  = 0;

        // 梯形图编辑器程序
        try {
            this._editorProgram = config.ladderProgram
                ? (typeof config.ladderProgram === 'string'
                    ? JSON.parse(config.ladderProgram)
                    : config.ladderProgram)
                : this._defaultProgram();
        } catch (e) {
            this._editorProgram = this._defaultProgram();
        }

        // 在线程序（最后下载到CPU的版本，用于对比）
        this._onlineProgramJson = null;
        this._lastDownloadTime  = null;
        this._programDirty      = false;   // 编辑器与在线版本不一致
        this._downloading       = false;
        this._downloadProgress  = 0;
        this._downloadStep      = 0;
        this._downloadStepTimer = 0;

        // 数据镜像（从 CPU 读取的副本）
        this._mirror = {
            I:   new Uint8Array(10),
            Q:   new Uint8Array(5),
            M:   new Uint8Array(32),
            V:   new Uint8Array(5000),
            AIW: new Uint8Array(64),
            AQW: new Uint8Array(64),
            T:   Array.from({length: 16}, () => ({ cv: 0, pv: 0, bit: false })),
            C:   Array.from({length: 16}, () => ({ cv: 0, pv: 0, bit: false })),
            running:    false,
            errorState: false,
            errorMsg:   '',
            scanCount:  0,
        };

        // 监控表
        this._watchPoints = [
            { addr:'I0.0',  type:'BOOL', comment:'启动按钮' },
            { addr:'I0.1',  type:'BOOL', comment:'停止按钮' },
            { addr:'Q0.0',  type:'BOOL', comment:'电机运行' },
            { addr:'Q0.7',  type:'BOOL', comment:'闪烁灯'   },
            { addr:'AIW0',  type:'INT',  comment:'AI0 原始值'},
            { addr:'AQW0',  type:'INT',  comment:'AQ0 输出值'},
            { addr:'VD0',   type:'REAL', comment:'PV 过程量' },
            { addr:'VD4',   type:'REAL', comment:'SP 设定值' },
            { addr:'VD8',   type:'REAL', comment:'MX PID输出'},
        ];

        // 趋势数据（每通道最多 120 个点）
        this._trendChannels = [
            { addr:'VD0', color:'#44ddaa', label:'PV',  data:[], scale:[0,10]  },
            { addr:'VD4', color:'#f5c842', label:'SP',  data:[], scale:[0,10]  },
            { addr:'VD8', color:'#9060e0', label:'MX%', data:[], scale:[0,1]   },
        ];
        this._trendMaxPts = 120;

        // 报警
        this._alarms       = [];
        this._alarmBlink   = false;
        this._alarmBlinkT  = 0;

        // 当前显示的活跃标签（'scada'|'ladder'|'watch'|'trend'|'alarm'）
        this._activeView   = 'scada';

        // SCADA 画面状态（内部软件状态机）
        this._scadaState = {
            motor:  false,  // Q0.0
            valve:  false,  // Q0.1
            lamp:   false,  // Q0.7
            PV:     0,
            SP:     5.0,
            MX:     0,
            aiw0:   0,
            aqw0:   0,
            scanCount: 0,
        };

        // 操作历史（最近10条）
        this._opLog = [];

        // 屏幕刷新计数（用于动画帧控制）
        this._screenFrame  = 0;
        this._needRedraw   = true;
        this._prevViewStr  = '';  // 屏幕内容摘要，变化时才重绘
    }

    // ═══════════════════════════════════════════════════════════════
    // SCADA 引擎初始化
    // ═══════════════════════════════════════════════════════════════

    _initSCADAEngine() {
        // 报警规则（函数，每次轮询执行）
        this._alarmRules = [
            { id:'ovr_pv',  label:'PV 超量程', level:'warn',
              check: () => this._mirror.running && this._readMirrorReal('VD0') > 9.5 },
            { id:'pid_sat', label:'PID 输出饱和', level:'warn',
              check: () => this._mirror.running && this._readMirrorReal('VD8') >= 0.999 },
            { id:'cpu_err', label:'CPU 错误',  level:'crit',
              check: () => this._mirror.errorState },
            { id:'no_conn', label:'通信中断',  level:'crit',
              check: () => !this._connected && !this._connecting },
        ];
        this._alarmActive = {};  // { ruleId: boolean }

        // 下载步骤定义
        this._dlSteps = [
            { label: '停止 CPU', dur: 0.20 },
            { label: '清除程序区', dur: 0.15 },
            { label: '传输程序块 (OB1)', dur: 0.40 },
            { label: '校验 CRC', dur: 0.10 },
            { label: '写入符号表', dur: 0.10 },
            { label: '重启 CPU (RUN)', dur: 0.20 },
            { label: '验证在线一致性', dur: 0.15 },
        ];
        this._dlTotalDur = this._dlSteps.reduce((s,x)=>s+x.dur, 0);
    }

    // ═══════════════════════════════════════════════════════════════
    // 镜像数据读取
    // ═══════════════════════════════════════════════════════════════

    _readMirrorBit(addr) {
        if (addr === 'SM0.0') return true;
        const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
        if (m) {
            const z=m[1].toUpperCase(), b=+m[2], bit=+m[3], mask=1<<bit;
            if (z==='I') return !!(this._mirror.I[b]  & mask);
            if (z==='Q') return !!(this._mirror.Q[b]  & mask);
            if (z==='M') return !!(this._mirror.M[b]  & mask);
        }
        const tc = addr.match(/^([TC])(\d+)$/);
        if (tc) {
            const n=+tc[2];
            return tc[1]==='T' ? (this._mirror.T[n]?.bit||false)
                               : (this._mirror.C[n]?.bit||false);
        }
        return false;
    }

    _readMirrorWord(addr) {
        const aw = addr.match(/^AIW(\d+)$/i);
        if (aw) { const off=+aw[1]; const r=(this._mirror.AIW[off]<<8)|this._mirror.AIW[off+1]; return r>32767?r-65536:r; }
        const qw = addr.match(/^AQW(\d+)$/i);
        if (qw) { const off=+qw[1]; const r=(this._mirror.AQW[off]<<8)|this._mirror.AQW[off+1]; return r>32767?r-65536:r; }
        const m  = addr.match(/^([A-Za-z]+)W?(\d+)$/i);
        if (!m) return 0;
        const z=m[1].toUpperCase(), b=+m[2];
        const rA = arr => { const r=(arr[b]<<8)|arr[b+1]; return r>32767?r-65536:r; };
        if (z==='V') return rA(this._mirror.V);
        if (z==='M') return rA(this._mirror.M);
        const tv = addr.match(/^T(\d+)$/i);
        if (tv) return this._mirror.T[+tv[1]]?.cv||0;
        return 0;
    }

    _readMirrorReal(addr) {
        const m = addr.match(/^VD(\d+)$/i);
        if (!m) return parseFloat(addr)||0;
        const b=+m[1];
        if (b+3 >= this._mirror.V.length) return 0;
        const buf = new ArrayBuffer(4), dv = new DataView(buf);
        dv.setUint8(0,this._mirror.V[b]); dv.setUint8(1,this._mirror.V[b+1]);
        dv.setUint8(2,this._mirror.V[b+2]); dv.setUint8(3,this._mirror.V[b+3]);
        return dv.getFloat32(0, false);
    }

    // ═══════════════════════════════════════════════════════════════
    // CPU 连接 / 断开 / 轮询
    // ═══════════════════════════════════════════════════════════════

    /**
     * 连接到 CPU ST20 实例
     * @param {object} cpu  CPU 仿真对象（S7200SmartST20 实例或兼容对象）
     */
    connectToCPU(cpu) {
        if (this._connected || this._connecting) return;
        if (!cpu) return;

        this._cpu          = cpu;
        this._connecting   = true;
        this._connError    = false;
        this._connErrorMsg = '';
        this._needRedraw   = true;
        this._rebuildDynamic();
        this.markDirty();

        this._addAlarm('info', '网络', `连接 ${this._plcIP}…`);

        // 仿真握手延迟
        this._connectTimer = 400 + Math.random() * 300;
    }

    _completeConnect() {
        this._connecting     = false;
        this._connected      = true;
        this._uptimeStart    = performance.now();
        this._lastPollTs     = performance.now();
        this._addAlarm('info', '网络', `已连接到 CPU ST20 (${this._plcIP})`);

        // 同步编辑器程序到 CPU
        if (this._cpu && this._cpu.program && !this._onlineProgramJson) {
            // 第一次连接：上传 CPU 当前程序到编辑器
            try {
                const cpuProg = this._cpu.program;
                if (cpuProg?.networks?.length) {
                    this._editorProgram = JSON.parse(JSON.stringify(cpuProg));
                    this._onlineProgramJson = JSON.stringify(cpuProg);
                    this._programDirty = false;
                }
            } catch (e) {}
        }

        this._needRedraw = true;
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    disconnectFromCPU() {
        this._connected      = false;
        this._connecting     = false;
        this._connectTimer   = 0;
        this._cpu            = null;
        this._downloading    = false;
        this._addAlarm('warn', '网络', '连接已断开');
        this._needRedraw = true;
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    _pollCPU() {
        if (!this._connected || !this._cpu) return;
        const cpu = this._cpu;

        try {
            // 同步存储区到镜像
            this._mirror.I   = new Uint8Array((cpu._I   || cpu.I   || new Uint8Array(10)).slice(0,10));
            this._mirror.Q   = new Uint8Array((cpu._Q   || cpu.Q   || new Uint8Array(5)).slice(0,5));
            this._mirror.M   = new Uint8Array((cpu._M   || cpu.M   || new Uint8Array(32)).slice(0,32));
            this._mirror.V   = new Uint8Array((cpu._V   || cpu.V   || new Uint8Array(5000)).slice(0,5000));
            this._mirror.AIW = new Uint8Array((cpu._AIW || cpu.AIW || new Uint8Array(64)).slice(0,64));
            this._mirror.AQW = new Uint8Array((cpu._AQW || cpu.AQW || new Uint8Array(64)).slice(0,64));

            // 定时器/计数器
            const srcT = cpu._T || cpu.T || [];
            const srcC = cpu._C || cpu.C || [];
            for (let i = 0; i < 16; i++) {
                if (srcT[i]) this._mirror.T[i] = { cv: srcT[i].cv, pv: srcT[i].pv, bit: srcT[i].bit };
                if (srcC[i]) this._mirror.C[i] = { cv: srcC[i].cv, pv: srcC[i].pv, bit: srcC[i].bit };
            }

            this._mirror.running    = !!cpu._running  ?? !!cpu.running;
            this._mirror.errorState = !!cpu._errorState ?? !!cpu.errorState;
            this._mirror.errorMsg   = cpu._errorMsg  || cpu.errorMsg  || '';
            this._mirror.scanCount  = cpu._scanCount || cpu.scanCount || 0;

            // 更新 SCADA 状态
            this._scadaState.motor  = this._readMirrorBit('Q0.0');
            this._scadaState.valve  = this._readMirrorBit('Q0.1');
            this._scadaState.lamp   = this._readMirrorBit('Q0.7');
            this._scadaState.PV     = this._readMirrorReal('VD0');
            this._scadaState.SP     = this._readMirrorReal('VD4');
            this._scadaState.MX     = this._readMirrorReal('VD8');
            this._scadaState.aiw0   = this._readMirrorWord('AIW0');
            this._scadaState.aqw0   = this._readMirrorWord('AQW0');
            this._scadaState.scanCount = this._mirror.scanCount;

            // 趋势采样
            this._trendChannels.forEach(ch => {
                let v;
                if (ch.addr.startsWith('VD'))     v = this._readMirrorReal(ch.addr);
                else if (ch.addr.startsWith('AIW') || ch.addr.startsWith('AQW'))
                                                   v = this._readMirrorWord(ch.addr);
                else                               v = this._readMirrorBit(ch.addr) ? 1 : 0;
                ch.data.push(v);
                if (ch.data.length > this._trendMaxPts) ch.data.shift();
            });

            this._rxCount++;
            this._pingMs = 0.5 + Math.random() * 2.0;
            this._needRedraw = true;

        } catch (e) {
            this._connError    = true;
            this._connErrorMsg = e.message || '轮询错误';
        }

        // 报警检查
        this._checkAlarms();
    }

    _writeToC PU(addr, val) {
        if (!this._connected || !this._cpu) return;
        const cpu = this._cpu;
        // 选择正确的写方法
        try {
            if (typeof val === 'boolean' || (val === 0 || val === 1)) {
                if (addr.match(/^\w+\d+\.\d+$/)) {
                    (cpu._writeBit || cpu.writeBit)?.call(cpu, addr, !!val);
                } else {
                    (cpu._writeWord || cpu.writeWord)?.call(cpu, addr, val ? 1 : 0);
                }
            } else if (addr.startsWith('VD')) {
                (cpu._writeReal || cpu.writeReal)?.call(cpu, addr, parseFloat(val)||0);
            } else {
                (cpu._writeWord || cpu.writeWord)?.call(cpu, addr, Math.round(val)||0);
            }
            this._txCount++;
            this._addAlarm('info', '写入', `${addr} ← ${val}`);
        } catch (e) {}
    }

    _writeToCPU(addr, val) {
        this._writeToC PU(addr, val);
    }

    // ═══════════════════════════════════════════════════════════════
    // 下载程序
    // ═══════════════════════════════════════════════════════════════

    downloadProgram() {
        if (!this._connected || this._downloading) return;
        this._downloading      = true;
        this._downloadProgress = 0;
        this._downloadStep     = 0;
        this._downloadStepTimer= 0;
        this._addAlarm('info', '下载', `开始下载程序到 ${this._plcIP}…`);
        this._needRedraw = true;
    }

    _tickDownload(dtS) {
        if (!this._downloading) return;
        const step = this._dlSteps[this._downloadStep];
        if (!step) {
            // 下载完成
            this._downloading = false;
            if (this._cpu) {
                try {
                    this._cpu.loadProgram?.(this._editorProgram);
                    if (!this._cpu.loadProgram) {
                        this._cpu.program = JSON.parse(JSON.stringify(this._editorProgram));
                        if (this._cpu._firstScan !== undefined) this._cpu._firstScan = true;
                        if (this._cpu._running !== undefined) this._cpu._running = true;
                    }
                } catch (e) {}
            }
            this._onlineProgramJson  = JSON.stringify(this._editorProgram);
            this._lastDownloadTime   = new Date().toLocaleTimeString();
            this._programDirty       = false;
            this._downloadProgress   = 1;
            this._addAlarm('info', '下载', `程序下载成功（${this._editorProgram.networks?.length || 0} 个网络）`);
            this._needRedraw = true;
            return;
        }
        this._downloadStepTimer += dtS;
        this._downloadProgress   = (this._downloadStep / this._dlSteps.length)
            + (this._downloadStepTimer / step.dur) / this._dlSteps.length;
        this._downloadProgress = Math.min(this._downloadProgress,
            (this._downloadStep + 1) / this._dlSteps.length - 0.01);

        if (this._downloadStepTimer >= step.dur) {
            this._downloadStepTimer = 0;
            this._downloadStep++;
        }
        this._needRedraw = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // 报警管理
    // ═══════════════════════════════════════════════════════════════

    _checkAlarms() {
        this._alarmRules.forEach(rule => {
            let triggered = false;
            try { triggered = rule.check(); } catch(e) {}
            if (triggered && !this._alarmActive[rule.id]) {
                this._alarmActive[rule.id] = true;
                this._addAlarm(rule.level, '自动', rule.label);
            } else if (!triggered && this._alarmActive[rule.id]) {
                this._alarmActive[rule.id] = false;
                this._addAlarm('info', '自动', `${rule.label} 已恢复`);
            }
        });
    }

    _addAlarm(level, source, msg) {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        this._alarms.unshift({ level, source, msg, time, ack: false });
        if (this._alarms.length > 50) this._alarms.pop();
        if (level === 'crit') this._alarmBlink = true;
        this._needRedraw = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // 数据包粒子动画
    // ═══════════════════════════════════════════════════════════════

    _spawnParticle() {
        if (!this._connected) return;
        const isUp  = Math.random() > 0.5;
        const ethPt = this._portPos.ETH0;
        this._particles.push({
            x:  ethPt.x,
            y:  ethPt.y,
            vx: 0,
            vy: -1.5 - Math.random(),
            life: 1.0,
            up:  isUp,
        });
    }

    _tickParticles(dtS) {
        if (!this._connected) { this._particles = []; return; }
        this._particleTimer += dtS;
        if (this._particleTimer > 0.12) {
            this._particleTimer = 0;
            this._spawnParticle();
        }
        this._particles = this._particles.filter(p => {
            p.y  += p.vy;
            p.life -= dtS * 1.5;
            return p.life > 0 && p.y > this._screen.y;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════════════

    _registerPorts() {
        const pp = this._portPos;
        this.addPort(pp.ETH0.x, pp.ETH0.y, 'ETH0', 'bus');
        this.addPort(pp.ETH1.x, pp.ETH1.y, 'ETH1', 'bus');
    }

    // ═══════════════════════════════════════════════════════════════
    // 初始化绘图
    // ═══════════════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ─────────────────────────────────────────────────────────────
    // 静态部件（绘制一次）
    // ─────────────────────────────────────────────────────────────

    _drawStaticParts() {
        this._drawChassis();
        this._drawMonitorBody();
        this._drawMonitorStand();
        this._drawVentGrill();
        this._drawDVDSlot();
        this._drawUSBPorts();
        this._drawEthPortBodies();
        this._drawNameplate();
        this._drawStaticLabels();
    }

    _drawChassis() {
        const c = this._chassis;
        const W = this.width;

        // 机箱主体（深灰色，铝合金质感）
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint:  { x: 0,   y: 0 },
            fillLinearGradientEndPoint:    { x: c.w, y: 0 },
            fillLinearGradientColorStops:  [0,'#3a3f4a', 0.15,'#4a505c', 0.85,'#3e434f', 1,'#2e3340'],
            stroke: '#555a68', strokeWidth: 1.5,
            cornerRadius: c.borderR,
            shadowColor: '#000', shadowBlur: 10,
            shadowOffsetX: 3, shadowOffsetY: 4,
            shadowOpacity: 0.4,
        }));

        // 机箱面板分隔线（水平浅槽）
        this._staticGroup.add(new Konva.Line({
            points: [c.x + 6, c.y + c.h * 0.20, c.x + c.w - 6, c.y + c.h * 0.20],
            stroke: '#2a2e38', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [c.x + 6, c.y + c.h * 0.48, c.x + c.w - 6, c.y + c.h * 0.48],
            stroke: '#2a2e38', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [c.x + 6, c.y + c.h * 0.73, c.x + c.w - 6, c.y + c.h * 0.73],
            stroke: '#2a2e38', strokeWidth: 0.8,
        }));

        // 机箱右侧竖纹（装饰性）
        for (let i = 0; i < 4; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [
                    c.x + c.w * 0.78 + i * c.w * 0.045, c.y + 4,
                    c.x + c.w * 0.78 + i * c.w * 0.045, c.y + c.h - 4,
                ],
                stroke: '#28303a', strokeWidth: 1,
            }));
        }

        // 机箱顶部高光边
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: 3,
            fill: 'rgba(255,255,255,0.12)',
            cornerRadius: [c.borderR, c.borderR, 0, 0],
        }));
    }

    _drawMonitorBody() {
        const m = this._monitor;
        const sc = this._screen;

        // 显示器外框（黑色金属）
        this._staticGroup.add(new Konva.Rect({
            x: m.x, y: m.y, width: m.w, height: m.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: m.w, y: m.h },
            fillLinearGradientColorStops: [0,'#1a1e26', 0.5,'#22262e', 1,'#1a1e26'],
            stroke: '#555', strokeWidth: 1.5,
            cornerRadius: m.borderR,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.35,
        }));

        // 屏幕区域背景（深黑，等待内容填充）
        this._staticGroup.add(new Konva.Rect({
            x: sc.x, y: sc.y, width: sc.w, height: sc.h,
            fill: '#050810',
            cornerRadius: 2,
        }));

        // 屏幕内边框光晕
        this._staticGroup.add(new Konva.Rect({
            x: sc.x - 1, y: sc.y - 1, width: sc.w + 2, height: sc.h + 2,
            fill: 'transparent',
            stroke: 'rgba(40,100,180,0.3)', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 显示器底部铭牌区
        this._staticGroup.add(new Konva.Rect({
            x: m.x + m.w * 0.35, y: m.y + m.h * 0.93,
            width: m.w * 0.30, height: m.h * 0.05,
            fill: '#1a1e26', stroke: '#333', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: m.x + m.w * 0.38, y: m.y + m.h * 0.938,
            text: 'SIMATIC HMI',
            fontSize: Math.max(5, this.height * 0.013),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#667',
        }));
    }

    _drawMonitorStand() {
        const s  = this._monStand;
        const c  = this._chassis;
        const mB = this._monitor.y + this._monitor.h;

        // 连接柄
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fill: '#2a2e38', stroke: '#444', strokeWidth: 1,
        }));

        // 显示器到机箱的连接区域底部过渡
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: s.y + s.h, width: c.w, height: c.y - s.y - s.h + 1,
            fill: '#3a3f4a',
        }));
    }

    _drawVentGrill() {
        const g = this._ventGrill;
        // 格栅背景
        this._staticGroup.add(new Konva.Rect({
            x: g.x, y: g.y, width: g.w, height: g.h,
            fill: '#2a2e38', stroke: '#222', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 竖条格栅
        const slotW  = g.w * 0.022;
        const slotGap = g.w * 0.038;
        const count  = Math.floor(g.w / (slotW + slotGap));
        for (let i = 0; i < count; i++) {
            const sx = g.x + 4 + i * (slotW + slotGap);
            this._staticGroup.add(new Konva.Rect({
                x: sx, y: g.y + 3, width: slotW, height: g.h - 6,
                fill: '#1a1e28', cornerRadius: 1,
            }));
        }
    }

    _drawDVDSlot() {
        const d = this._dvdSlot;
        this._staticGroup.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: '#252830', stroke: '#1a1e28', strokeWidth: 1,
            cornerRadius: 1,
        }));
        // 光驱按钮
        this._staticGroup.add(new Konva.Circle({
            x: d.x + d.w - 8, y: d.y + d.h / 2,
            radius: d.h * 0.30,
            fill: '#2a2e38', stroke: '#3a4050', strokeWidth: 0.8,
        }));
        // 槽缝
        this._staticGroup.add(new Konva.Rect({
            x: d.x + 4, y: d.y + d.h * 0.38,
            width: d.w * 0.85, height: d.h * 0.24,
            fill: '#1a1a1a', cornerRadius: 0.5,
        }));
    }

    _drawUSBPorts() {
        this._usbPorts.forEach(u => {
            this._staticGroup.add(new Konva.Rect({
                x: u.x, y: u.y, width: u.w, height: u.h,
                fill: '#1a1e28', stroke: '#3a4050', strokeWidth: 0.8,
                cornerRadius: 1,
            }));
            // USB 内部金属条
            this._staticGroup.add(new Konva.Rect({
                x: u.x + u.w * 0.15, y: u.y + u.h * 0.2,
                width: u.w * 0.70, height: u.h * 0.60,
                fill: '#4a5060',
            }));
        });
    }

    _drawEthPortBodies() {
        this._ethPorts.forEach((e, i) => {
            // RJ45 外框
            this._staticGroup.add(new Konva.Rect({
                x: e.x, y: e.y, width: e.w, height: e.h,
                fill: '#1a1e28', stroke: '#3a4050', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 插孔内部
            this._staticGroup.add(new Konva.Rect({
                x: e.x + e.w * 0.12, y: e.y + e.h * 0.15,
                width: e.w * 0.76, height: e.h * 0.60,
                fill: '#0a0e14', cornerRadius: 1,
            }));
            // 金属触点（8针）
            for (let k = 0; k < 8; k++) {
                this._staticGroup.add(new Konva.Rect({
                    x: e.x + e.w * (0.14 + k * 0.092), y: e.y + e.h * 0.22,
                    width: e.w * 0.060, height: e.h * 0.45,
                    fill: '#c8c060',
                }));
            }
            // 端口标签
            this._staticGroup.add(new Konva.Text({
                x: e.x + 2, y: e.y + e.h + 2,
                text: `ETH${i}`,
                fontSize: Math.max(5, this.height * 0.016),
                fontFamily: 'Consolas, monospace',
                fill: '#5a8aa0',
            }));
        });
    }

    _drawNameplate() {
        const np = this._nameplate;
        // 铭牌背景
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fillLinearGradientStartPoint: { x: 0,    y: 0 },
            fillLinearGradientEndPoint:   { x: np.w, y: 0 },
            fillLinearGradientColorStops: [0,'#1a6fa8', 0.15,'#2a9fd8', 0.85,'#1a6fa8', 1,'#134e7a'],
            cornerRadius: 2,
        }));
        // SIMATIC 文字
        this._staticGroup.add(new Konva.Text({
            x: np.x + 6, y: np.y + np.h * 0.12,
            text: 'SIMATIC',
            fontSize: Math.max(8, this.height * 0.030),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#ffffff',
            letterSpacing: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 6, y: np.y + np.h * 0.56,
            text: 'IPC WinCC SCADA',
            fontSize: Math.max(5, this.height * 0.018),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#b8d8f0',
        }));
    }

    _drawStaticLabels() {
        const c = this._chassis;
        const H = this.height;

        // 电源按钮标签
        this._staticGroup.add(new Konva.Text({
            x: this._powerBtn.x - 10, y: this._powerBtn.y + this._powerBtn.r + 4,
            text: 'POWER',
            fontSize: Math.max(4, H * 0.013),
            fontFamily: 'Arial', fill: '#667', align: 'center', width: 30,
        }));

        // IP 地址标注（机箱底部）
        this._staticGroup.add(new Konva.Text({
            x: c.x + 4, y: c.y + c.h - H * 0.025,
            text: `PC: ${this._pcIP}`,
            fontSize: Math.max(5, H * 0.015),
            fontFamily: 'Consolas, monospace',
            fill: '#4a6070',
        }));
    }

    // ─────────────────────────────────────────────────────────────
    // 动态部件（每 tick 重建）
    // ─────────────────────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawScreenContent();
        this._drawPowerButton();
        this._drawHDDLED();
        this._drawEthLEDs();
        this._drawParticles();
        this._drawDownloadOverlay();
        this._drawConnectingIndicator();
    }

    _drawPowerButton() {
        const k   = this._powerBtn;
        const on  = this._connected || this._connecting;
        this._dynamicGroup.add(new Konva.Circle({
            x: k.x, y: k.y, radius: k.r,
            fillRadialGradientStartPoint:   { x: -k.r*0.3, y: -k.r*0.3 },
            fillRadialGradientEndRadius:    k.r * 1.2,
            fillRadialGradientColorStops:   [0, on?'#2a4a6a':'#2a2a2a', 1, on?'#0a1a2a':'#1a1a1a'],
            stroke: on ? '#1a6fa8' : '#3a3a3a', strokeWidth: 1,
        }));
        // 电源图标（圆圈+竖线）
        this._dynamicGroup.add(new Konva.Arc({
            x: k.x, y: k.y, innerRadius: k.r*0.35, outerRadius: k.r*0.60,
            angle: 260, rotation: -130,
            stroke: on ? '#44aadd' : '#666', strokeWidth: 1.5,
        }));
        this._dynamicGroup.add(new Konva.Line({
            points: [k.x, k.y - k.r*0.20, k.x, k.y - k.r*0.65],
            stroke: on ? '#44aadd' : '#666', strokeWidth: 1.5, lineCap: 'round',
        }));
        // 电源 LED
        this._dynamicGroup.add(new Konva.Circle({
            x: k.x + k.r * 0.70, y: k.y - k.r * 0.70,
            radius: k.r * 0.22,
            fill:  on ? '#44aaff' : '#1a1a1a',
            shadowColor: on ? '#44aaff' : 'transparent',
            shadowBlur:  on ? 4 : 0, shadowOpacity: 0.9,
        }));
    }

    _drawHDDLED() {
        const led    = this._hddLED;
        const active = this._connected && (this._mirror.scanCount % 3 < 1);
        this._dynamicGroup.add(new Konva.Circle({
            x: led.x, y: led.y, radius: led.r,
            fill:   active ? '#f07030' : '#1a0a00',
            shadowColor:   active ? '#f07030' : 'transparent',
            shadowBlur:    active ? 4 : 0, shadowOpacity: 0.9,
        }));
    }

    _drawEthLEDs() {
        this._ethPorts.forEach((e, i) => {
            const linkOn = (i === 0) ? this._connected || this._connecting : false;
            const actOn  = linkOn && (this._mirror.scanCount % 5 < 2);
            // Link LED（绿色，左）
            this._dynamicGroup.add(new Konva.Circle({
                x: e.x + e.w * 0.15, y: e.y + e.h * 0.12,
                radius: e.h * 0.12,
                fill:  linkOn ? '#44cc44' : '#1a1a1a',
                shadowColor: linkOn ? '#44cc44' : 'transparent',
                shadowBlur:  linkOn ? 3 : 0, shadowOpacity: 0.9,
            }));
            // ACT LED（橙色，右）
            this._dynamicGroup.add(new Konva.Circle({
                x: e.x + e.w * 0.85, y: e.y + e.h * 0.12,
                radius: e.h * 0.12,
                fill:  actOn ? '#f07030' : '#1a0a00',
                shadowColor: actOn ? '#f07030' : 'transparent',
                shadowBlur:  actOn ? 3 : 0, shadowOpacity: 0.9,
            }));
        });
    }

    _drawParticles() {
        this._particles.forEach(p => {
            this._dynamicGroup.add(new Konva.Circle({
                x: p.x, y: p.y,
                radius: 2,
                fill: p.up ? '#44ddaa' : '#2a9fd8',
                opacity: p.life,
            }));
        });
    }

    _drawConnectingIndicator() {
        if (!this._connecting) return;
        const c   = this._chassis;
        const W   = this.width, H = this.height;
        const t   = (performance.now() / 500) % 1;
        const r   = c.h * 0.030;
        const cx  = c.x + c.w * 0.78;
        const cy  = c.y + c.h * 0.28;
        for (let i = 0; i < 8; i++) {
            const a   = (i / 8) * Math.PI * 2;
            const age = ((i / 8) - t + 1) % 1;
            this._dynamicGroup.add(new Konva.Circle({
                x: cx + Math.cos(a) * r * 2.2,
                y: cy + Math.sin(a) * r * 2.2,
                radius: r * 0.35,
                fill: `rgba(42,159,216,${age * 0.9})`,
            }));
        }
    }

    _drawDownloadOverlay() {
        if (!this._downloading) return;
        const sc = this._screen;
        const W  = sc.w, H = sc.h;
        const x  = sc.x, y = sc.y;

        // 半透明遮罩
        this._dynamicGroup.add(new Konva.Rect({
            x, y, width: W, height: H,
            fill: 'rgba(5,8,20,0.85)',
            cornerRadius: 2,
        }));

        // 标题
        const titleFontSize = Math.max(8, H * 0.060);
        this._dynamicGroup.add(new Konva.Text({
            x: x + W*0.05, y: y + H*0.14,
            text: '⬇  下载程序',
            fontSize: titleFontSize,
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#2a9fd8',
            width: W*0.90, align: 'center',
        }));

        // 进度条背景
        const barX = x + W*0.08, barY = y + H*0.30;
        const barW = W*0.84, barH = H*0.055;
        this._dynamicGroup.add(new Konva.Rect({
            x: barX, y: barY, width: barW, height: barH,
            fill: '#0a0e18', stroke: '#2a3a50', strokeWidth: 1,
            cornerRadius: barH/2,
        }));
        // 进度条填充
        const fillW = barW * Math.min(1, this._downloadProgress);
        if (fillW > 0) {
            this._dynamicGroup.add(new Konva.Rect({
                x: barX, y: barY, width: fillW, height: barH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: fillW, y: 0 },
                fillLinearGradientColorStops: [0,'#1a6fa8', 0.5,'#2a9fd8', 1,'#44ddaa'],
                cornerRadius: barH/2,
            }));
        }
        // 百分比
        this._dynamicGroup.add(new Konva.Text({
            x: barX, y: barY + barH + 3,
            text: `${(this._downloadProgress*100).toFixed(0)}%`,
            fontSize: Math.max(6, H*0.045),
            fontFamily: 'Consolas, monospace',
            fill: '#44ddaa', width: barW, align: 'right',
        }));

        // 步骤列表
        const stepFontSize = Math.max(5, H * 0.038);
        this._dlSteps.forEach((step, i) => {
            const isDone   = i < this._downloadStep;
            const isActive = i === this._downloadStep;
            const sy       = y + H * 0.42 + i * (H * 0.07);
            const icon     = isDone ? '✓' : isActive ? '▶' : '○';
            const col      = isDone ? '#44cc66' : isActive ? '#ffffff' : '#3a4a60';
            this._dynamicGroup.add(new Konva.Text({
                x: x + W*0.08, y: sy,
                text: `${icon}  ${step.label}`,
                fontSize: stepFontSize,
                fontFamily: 'Consolas, monospace',
                fill: col,
            }));
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 屏幕内容（核心显示区域）
    // ─────────────────────────────────────────────────────────────

    _drawScreenContent() {
        const sc = this._screen;
        if (!sc) return;

        this._drawScreenBg();
        this._drawTitleBar();
        this._drawViewTabs();

        switch (this._activeView) {
            case 'scada':  this._drawSCADAView();  break;
            case 'ladder': this._drawLadderView(); break;
            case 'watch':  this._drawWatchView();  break;
            case 'trend':  this._drawTrendView();  break;
            case 'alarm':  this._drawAlarmView();  break;
        }

        this._drawStatusBar();
    }

    _drawScreenBg() {
        const sc = this._screen;
        // 屏幕背景
        this._dynamicGroup.add(new Konva.Rect({
            x: sc.x, y: sc.y, width: sc.w, height: sc.h,
            fill: '#060a10',
            cornerRadius: 2,
        }));
        // 扫描线效果（细横纹）
        for (let i = 0; i < Math.floor(sc.h / 3); i++) {
            this._dynamicGroup.add(new Konva.Rect({
                x: sc.x, y: sc.y + i * 3,
                width: sc.w, height: 1,
                fill: 'rgba(0,20,40,0.15)',
                listening: false,
            }));
        }
    }

    _drawTitleBar() {
        const layout = this._screenLayout.titleBar;
        const { x, y, w, h } = layout;
        const H = this.height;

        // 标题栏背景
        this._dynamicGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: w, y: 0 },
            fillLinearGradientColorStops: [0,'#0e1a28', 0.5,'#132234', 1,'#0e1a28'],
            stroke: 'rgba(42,159,216,0.3)', strokeWidth: 0.5,
        }));

        // 项目名
        this._dynamicGroup.add(new Konva.Text({
            x: x + 6, y: y + h * 0.18,
            text: this._projectName,
            fontSize: Math.max(6, H * 0.022),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#c0d4e8',
        }));

        // 连接状态标记
        const connColor = this._connected ? '#44cc66' : this._connecting ? '#f5c842' : '#ee4444';
        const connText  = this._connected ? '在线' : this._connecting ? '连接中' : '离线';
        this._dynamicGroup.add(new Konva.Circle({
            x: x + w * 0.62, y: y + h * 0.50,
            radius: h * 0.22,
            fill: connColor,
            shadowColor: connColor, shadowBlur: 4, shadowOpacity: 0.8,
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: x + w * 0.64, y: y + h * 0.20,
            text: connText,
            fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: connColor,
        }));

        // 时钟
        const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        this._dynamicGroup.add(new Konva.Text({
            x: x + w * 0.78, y: y + h * 0.18,
            text: timeStr,
            fontSize: Math.max(6, H * 0.022),
            fontFamily: 'Consolas, monospace',
            fill: '#7090b0',
        }));

        // 报警标记（有报警时红色闪烁）
        const hasCrit = this._alarms.some(a => !a.ack && a.level === 'crit');
        if (hasCrit) {
            const blinkOn = (Math.floor(performance.now() / 400) % 2 === 0);
            this._dynamicGroup.add(new Konva.Text({
                x: x + w * 0.50, y: y + h * 0.18,
                text: '⚠ ALARM',
                fontSize: Math.max(5, H * 0.018),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: blinkOn ? '#ee4444' : '#880000',
            }));
        }
    }

    _drawViewTabs() {
        // 底部标签栏（直接在屏幕底部）
        const sc    = this._screen;
        const tabs  = ['scada','ladder','watch','trend','alarm'];
        const tLabels = ['SCADA','梯形图','监控表','趋势','报警'];
        const tabW  = sc.w / tabs.length;
        const tabY  = sc.y + sc.h - Math.max(12, this.height * 0.036);
        const tabH  = Math.max(10, this.height * 0.030);
        const H     = this.height;

        tabs.forEach((tab, i) => {
            const tx    = sc.x + i * tabW;
            const isAct = this._activeView === tab;
            this._dynamicGroup.add(new Konva.Rect({
                x: tx, y: tabY, width: tabW - 1, height: tabH,
                fill: isAct ? '#1a3050' : '#0a0e18',
                stroke: isAct ? '#2a9fd8' : '#1a2030', strokeWidth: 0.5,
            }));
            // 活跃标签顶部高亮线
            if (isAct) {
                this._dynamicGroup.add(new Konva.Rect({
                    x: tx, y: tabY, width: tabW - 1, height: 1.5,
                    fill: '#2a9fd8',
                }));
            }
            this._dynamicGroup.add(new Konva.Text({
                x: tx, y: tabY + tabH * 0.18,
                text: tLabels[i],
                fontSize: Math.max(5, H * 0.016),
                fontFamily: 'Arial', fontStyle: isAct ? 'bold' : 'normal',
                fill: isAct ? '#a0c8e8' : '#405060',
                width: tabW, align: 'center',
            }));
        });
    }

    _drawStatusBar() {
        const sb = this._screenLayout.statusBar;
        const H  = this.height;
        this._dynamicGroup.add(new Konva.Rect({
            x: sb.x, y: sb.y, width: sb.w, height: sb.h,
            fill: 'rgba(10,14,24,0.8)',
        }));
        // CPU 状态
        const cpuState = this._mirror.running
            ? (this._mirror.errorState ? 'ERR' : 'RUN')
            : 'STOP';
        const cpuColor = this._mirror.running
            ? (this._mirror.errorState ? '#ff8800' : '#44cc66')
            : '#ee4444';
        const infoStr  = `CPU:${cpuState}  扫描:${this._mirror.scanCount}  ↑${this._txCount} ↓${this._rxCount}  PING:${this._pingMs.toFixed(1)}ms`;
        this._dynamicGroup.add(new Konva.Text({
            x: sb.x + 4, y: sb.y + sb.h * 0.15,
            text: infoStr,
            fontSize: Math.max(4, H * 0.014),
            fontFamily: 'Consolas, monospace',
            fill: '#4a6070',
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: sb.x + sb.w - 30, y: sb.y + sb.h * 0.15,
            text: cpuState,
            fontSize: Math.max(5, H * 0.016),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: cpuColor,
        }));
    }

    // ── SCADA 画面 ────────────────────────────────────────────────────

    _drawSCADAView() {
        const sc  = this._screen;
        const H   = this.height;
        const sl  = this._screenLayout;
        const s   = this._scadaState;

        // ─ 过程值数值框（2行×3列）
        const vg  = sl.valGrid;
        const cols = 3, rows = 2;
        const cW  = vg.w / cols, cH = vg.h / rows;
        const items = [
            { label:'PV',   val: s.PV.toFixed(3) + 'V',  color:'#44ddaa' },
            { label:'SP',   val: s.SP.toFixed(3) + 'V',  color:'#f5c842' },
            { label:'MX',   val: (s.MX*100).toFixed(1)+'%', color:'#9060e0' },
            { label:'AIW0', val: String(s.aiw0),          color:'#44aacc' },
            { label:'AQW0', val: String(s.aqw0),          color:'#f07030' },
            { label:'SCAN', val: String(s.scanCount),     color:'#2a9fd8' },
        ];
        items.forEach((item, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const bx  = vg.x + col * cW, by = vg.y + row * cH;
            const bW  = cW - 1, bH = cH - 1;

            this._dynamicGroup.add(new Konva.Rect({
                x: bx, y: by, width: bW, height: bH,
                fill: '#060e18', stroke: '#1a2a3a', strokeWidth: 0.8,
                cornerRadius: 1,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: bx + 3, y: by + bH * 0.10,
                text: item.label,
                fontSize: Math.max(4, H * 0.016),
                fontFamily: 'Arial', fill: '#4a6070',
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: bx + 2, y: by + bH * 0.38,
                text: item.val,
                fontSize: Math.max(6, H * 0.028),
                fontFamily: 'Consolas, monospace', fontStyle: 'bold',
                fill: item.color,
                width: bW - 4, align: 'right',
            }));
        });

        // ─ 迷你趋势图
        const ta  = sl.trendArea;
        this._drawMiniTrend(ta.x, ta.y, ta.w, ta.h);

        // ─ I/O 位图行
        const ir  = sl.ioRow;
        const bW2 = ir.w / 12, bH2 = ir.h;
        // I0.0~I0.7 / I1.0~I1.3 快速指示
        for (let i = 0; i < 8; i++) {
            const on  = !!(this._mirror.I[0] & (1 << i));
            const bx  = ir.x + i * bW2;
            this._dynamicGroup.add(new Konva.Rect({
                x: bx, y: ir.y, width: bW2 - 0.5, height: bH2,
                fill: on ? 'rgba(245,200,66,.20)' : 'rgba(10,14,24,.8)',
                stroke: on ? '#a08020' : '#1a2030', strokeWidth: 0.5,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: bx, y: ir.y + bH2 * 0.08,
                text: `I0.${i}`, fontSize: Math.max(4, H * 0.014),
                fontFamily: 'Consolas', fill: on ? '#f5c842' : '#2a3a4a',
                width: bW2, align: 'center',
            }));
        }
        // Q0.0~Q0.7
        for (let i = 0; i < 8; i++) {
            const on  = !!(this._mirror.Q[0] & (1 << i));
            const bx  = ir.x + (4 + i) * bW2;
            this._dynamicGroup.add(new Konva.Rect({
                x: bx, y: ir.y, width: bW2 - 0.5, height: bH2,
                fill: on ? 'rgba(240,112,48,.20)' : 'rgba(10,14,24,.8)',
                stroke: on ? '#804020' : '#1a2030', strokeWidth: 0.5,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: bx, y: ir.y + bH2 * 0.08,
                text: `Q0.${i}`, fontSize: Math.max(4, H * 0.014),
                fontFamily: 'Consolas', fill: on ? '#f07030' : '#2a3a4a',
                width: bW2, align: 'center',
            }));
        }

        // ─ 报警滚动条
        const ab  = sl.alarmBar;
        const latestAlarm = this._alarms[0];
        const hasCrit = this._alarms.some(a=>!a.ack&&a.level==='crit');
        this._dynamicGroup.add(new Konva.Rect({
            x: ab.x, y: ab.y, width: ab.w, height: ab.h,
            fill: hasCrit ? 'rgba(238,68,68,.08)' : 'rgba(10,14,24,.6)',
            stroke: hasCrit ? 'rgba(238,68,68,.30)' : '#1a2030',
            strokeWidth: 0.5,
        }));
        if (latestAlarm) {
            const aColor = latestAlarm.level==='crit' ? '#ee4444' : latestAlarm.level==='warn' ? '#f5c842' : '#44cc66';
            this._dynamicGroup.add(new Konva.Text({
                x: ab.x + 3, y: ab.y + ab.h * 0.12,
                text: `${latestAlarm.time} [${latestAlarm.source}] ${latestAlarm.msg}`,
                fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Consolas, monospace',
                fill: aColor,
                width: ab.w - 6,
            }));
        }
    }

    _drawMiniTrend(x, y, w, h) {
        // 背景
        this._dynamicGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#040810', stroke: '#1a2030', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 网格线
        for (let i = 1; i < 4; i++) {
            const gy = y + h * i / 4;
            this._dynamicGroup.add(new Konva.Line({
                points: [x+1, gy, x+w-1, gy],
                stroke: '#0e1a28', strokeWidth: 0.5, listening: false,
            }));
        }

        // 绘制趋势曲线
        this._trendChannels.forEach(ch => {
            const data = ch.data;
            if (data.length < 2) return;
            const [lo, hi] = ch.scale;
            const span = hi - lo || 1;
            const norm  = v => Math.max(0, Math.min(1, (v - lo) / span));
            const pts   = [];
            const step  = w / (data.length - 1);
            data.forEach((v, i) => {
                pts.push(x + i * step);
                pts.push(y + h - 1 - norm(v) * (h - 2));
            });
            this._dynamicGroup.add(new Konva.Line({
                points: pts,
                stroke: ch.color, strokeWidth: 1.2,
                lineCap: 'round', lineJoin: 'round',
                tension: 0.3,
                listening: false,
            }));
        });

        // 图例
        const H = this.height;
        this._trendChannels.forEach((ch, i) => {
            const lx = x + 3 + i * w * 0.34;
            this._dynamicGroup.add(new Konva.Line({
                points: [lx, y + 4, lx + 10, y + 4],
                stroke: ch.color, strokeWidth: 1.5,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: lx + 12, y: y + 1,
                text: ch.label,
                fontSize: Math.max(4, H * 0.014),
                fontFamily: 'Consolas', fill: ch.color,
            }));
        });

        // 趋势图标题
        this._dynamicGroup.add(new Konva.Text({
            x: x + w * 0.78, y: y + 1,
            text: `${this._trendMaxPts}点`,
            fontSize: Math.max(4, this.height * 0.014),
            fontFamily: 'Consolas', fill: '#2a3a50',
        }));
    }

    // ── 梯形图视图 ────────────────────────────────────────────────────

    _drawLadderView() {
        const sc   = this._screen;
        const H    = this.height;
        const prog = this._editorProgram;
        const y0   = sc.y + sc.h * 0.13;
        const tabH = Math.max(10, H * 0.030);
        const avH  = sc.h * 0.72 - tabH;
        const x0   = sc.x + 2;
        const cW   = sc.w - 4;
        const isDl = this._downloading;

        if (!prog?.networks) return;

        // 程序状态标志
        const dirty = this._programDirty;
        const syncColor  = dirty ? '#f5c842' : (this._onlineProgramJson ? '#44cc66' : '#4a6070');
        const syncText   = dirty ? '⚠ 已修改' : (this._onlineProgramJson ? '✓ 一致' : '未下载');

        this._dynamicGroup.add(new Konva.Text({
            x: x0, y: y0,
            text: `程序: ${prog.name||'OB1'}  [${prog.networks.length}个网络]`,
            fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Consolas', fill: '#4a6080',
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: x0 + cW - 50, y: y0,
            text: syncText,
            fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Consolas', fontStyle: 'bold',
            fill: syncColor,
        }));

        // 绘制前4个网络（屏幕放不下更多）
        let curY = y0 + H * 0.028;
        const maxNets = 3;

        prog.networks.slice(0, maxNets).forEach((net, ni) => {
            if (curY + H * 0.05 > y0 + avH) return;

            // 网络头
            this._dynamicGroup.add(new Konva.Rect({
                x: x0, y: curY, width: cW, height: H * 0.026,
                fill: '#0e1a28', stroke: '#1a2a3a', strokeWidth: 0.5,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: x0 + 3, y: curY + H * 0.006,
                text: `N${ni+1}  ${(net.comment||'').slice(0,28)}`,
                fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Consolas', fill: '#4a6080',
            }));
            curY += H * 0.028;

            // 绘制前两条梯级
            const rungs = net.rungs || [];
            rungs.slice(0, 2).forEach((rung, ri) => {
                if (curY + H * 0.040 > y0 + avH) return;
                this._drawMiniRung(rung, x0, curY, cW, H * 0.038);
                curY += H * 0.040;
            });
        });

        if (prog.networks.length > maxNets) {
            this._dynamicGroup.add(new Konva.Text({
                x: x0, y: curY,
                text: `... 还有 ${prog.networks.length - maxNets} 个网络`,
                fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Consolas', fill: '#2a3a50',
            }));
        }
    }

    _drawMiniRung(rung, x, y, w, h) {
        const H = this.height;
        // 母线
        this._dynamicGroup.add(new Konva.Rect({
            x, y: y + h*0.3, width: 3, height: h*0.4,
            fill: '#1a3050',
        }));
        this._dynamicGroup.add(new Konva.Rect({
            x: x+w-3, y: y+h*0.3, width: 3, height: h*0.4,
            fill: '#1a3050',
        }));
        // 导线
        this._dynamicGroup.add(new Konva.Line({
            points: [x+3, y+h*0.5, x+w-3, y+h*0.5],
            stroke: '#1a2a3a', strokeWidth: 1.2,
        }));

        let cx = x + 6;
        const elemW = Math.min((w - 12) / Math.max(rung.length, 1), w * 0.14);

        rung.slice(0, 8).forEach(inst => {
            const op  = inst.op.toUpperCase();
            const isOutput = ['=','S','R'].includes(op);
            const isTimed  = ['TON','TOF'].includes(op);
            const isPID    = ['PID','PIDX'].includes(op);
            const isFunc   = ['+R','*R','MOV_W','MOV_R','DTR','TRUNC'].includes(op);

            const on = this._connected ? this._evalInstFlow(inst) : false;
            const color = on ? '#44cc66' : '#2a3a50';
            const fill  = on ? '#0a1a0a' : '#060a0e';

            if (isOutput) {
                // 线圈：圆圈
                const cr = h * 0.25;
                this._dynamicGroup.add(new Konva.Circle({
                    x: cx + cr, y: y + h*0.5,
                    radius: cr,
                    fill: on ? 'rgba(240,112,48,.2)' : fill,
                    stroke: on ? '#f07030' : '#2a3a50', strokeWidth: 0.8,
                }));
                cx += cr * 2 + 3;
            } else if (isTimed || isPID || isFunc) {
                // 指令框
                const bw = elemW * 1.3;
                this._dynamicGroup.add(new Konva.Rect({
                    x: cx, y: y + h*0.18, width: bw, height: h*0.64,
                    fill, stroke: isPID?'#6040a0':isFunc?'#2a5040':color,
                    strokeWidth: 0.8, cornerRadius: 1,
                }));
                this._dynamicGroup.add(new Konva.Text({
                    x: cx, y: y + h*0.28, text: op,
                    fontSize: Math.max(4, H*0.014),
                    fontFamily: 'Consolas',
                    fill: isPID?'#8060c0':isFunc?'#44aa80':color,
                    width: bw, align: 'center',
                }));
                cx += bw + 3;
            } else {
                // 触点：竖线+横线
                this._dynamicGroup.add(new Konva.Line({
                    points: [cx, y+h*0.2, cx, y+h*0.8],
                    stroke: color, strokeWidth: 1,
                }));
                cx += elemW * 0.3;
                this._dynamicGroup.add(new Konva.Line({
                    points: [cx, y+h*0.2, cx, y+h*0.8],
                    stroke: color, strokeWidth: 1,
                }));
                cx += elemW * 0.3;
            }
        });
    }

    _evalInstFlow(inst) {
        const op = inst.op.toUpperCase(), addr = inst.addr || '';
        if (['LD','A'].includes(op))  return this._readMirrorBit(addr);
        if (['LDN','AN'].includes(op)) return !this._readMirrorBit(addr);
        if (op === '=') return this._readMirrorBit(addr);
        return true;
    }

    // ── 监控表视图 ────────────────────────────────────────────────────

    _drawWatchView() {
        const sc  = this._screen;
        const H   = this.height;
        const y0  = sc.y + sc.h * 0.13;
        const x0  = sc.x + 2;
        const cW  = sc.w - 4;
        const tabH = Math.max(10, H * 0.030);
        const avH  = sc.h * 0.72 - tabH;
        const rowH = avH / Math.min(this._watchPoints.length + 1, 10);

        // 表头
        this._dynamicGroup.add(new Konva.Rect({
            x: x0, y: y0, width: cW, height: rowH * 0.85,
            fill: '#0e1a28',
        }));
        const cols = ['地址','类型','当前值','注释'];
        const colW = [0.22, 0.16, 0.26, 0.36];
        let hx = x0 + 2;
        cols.forEach((col, i) => {
            this._dynamicGroup.add(new Konva.Text({
                x: hx, y: y0 + rowH * 0.12,
                text: col, fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Consolas', fontStyle: 'bold',
                fill: '#4a6080',
            }));
            hx += cW * colW[i];
        });

        // 数据行
        this._watchPoints.slice(0, 9).forEach((wp, idx) => {
            const ry = y0 + rowH * (idx + 1) * 0.88;
            const bg = idx % 2 === 0 ? '#060a10' : '#080c14';
            this._dynamicGroup.add(new Konva.Rect({
                x: x0, y: ry, width: cW, height: rowH * 0.82,
                fill: bg,
            }));

            let valStr = '--', valColor = '#4a6070';
            if (this._connected) {
                switch (wp.type) {
                    case 'BOOL': {
                        const v = this._readMirrorBit(wp.addr);
                        valStr = v ? 'TRUE' : 'FALSE';
                        valColor = v ? '#44cc66' : '#3a5040';
                        break;
                    }
                    case 'INT': {
                        valStr = String(this._readMirrorWord(wp.addr));
                        valColor = '#44ddaa';
                        break;
                    }
                    case 'REAL': {
                        valStr = this._readMirrorReal(wp.addr).toFixed(4);
                        valColor = '#9060e0';
                        break;
                    }
                    case 'TIMER': {
                        const t = this._mirror.T[parseInt(wp.addr.replace(/\D/g,''))||0];
                        valStr = `${t.cv}/${t.pv}`;
                        valColor = t.bit ? '#44cc66' : '#4a6070';
                        break;
                    }
                }
            }

            let rx = x0 + 2;
            [wp.addr, wp.type, valStr, wp.comment||''].forEach((txt, ci) => {
                const col = ci===0?'#44aacc':ci===1?'#4a6070':ci===2?valColor:'#2a3a50';
                this._dynamicGroup.add(new Konva.Text({
                    x: rx, y: ry + rowH * 0.12,
                    text: txt, fontSize: Math.max(4, H * 0.015),
                    fontFamily: 'Consolas',
                    fill: col,
                }));
                rx += cW * colW[ci];
            });
        });
    }

    // ── 趋势视图 ──────────────────────────────────────────────────────

    _drawTrendView() {
        const sc  = this._screen;
        const H   = this.height;
        const y0  = sc.y + sc.h * 0.13;
        const tabH = Math.max(10, H * 0.030);
        const avH  = sc.h * 0.72 - tabH;
        this._drawMiniTrend(sc.x + 2, y0, sc.w - 4, avH);
    }

    // ── 报警视图 ──────────────────────────────────────────────────────

    _drawAlarmView() {
        const sc  = this._screen;
        const H   = this.height;
        const y0  = sc.y + sc.h * 0.13;
        const x0  = sc.x + 2;
        const cW  = sc.w - 4;
        const tabH = Math.max(10, H * 0.030);
        const avH  = sc.h * 0.72 - tabH;
        const rowH = avH / 8;

        this._alarms.slice(0, 7).forEach((a, i) => {
            const ry  = y0 + i * rowH;
            const col = a.level==='crit' ? '#ee4444' : a.level==='warn' ? '#f5c842' : '#44cc66';
            const bg  = a.ack ? '#060a0e' : (a.level==='crit' ? 'rgba(238,68,68,.06)' : '#060a0e');

            this._dynamicGroup.add(new Konva.Rect({
                x: x0, y: ry, width: cW, height: rowH - 1,
                fill: bg, stroke: '#0e1828', strokeWidth: 0.5,
            }));
            this._dynamicGroup.add(new Konva.Circle({
                x: x0 + 5, y: ry + rowH * 0.50,
                radius: rowH * 0.22,
                fill: a.ack ? '#1a1a1a' : col,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: x0 + 11, y: ry + rowH * 0.12,
                text: `${a.time} [${a.source}] ${a.msg}`,
                fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Consolas',
                fill: a.ack ? '#2a3a50' : col,
                width: cW - 12,
            }));
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 交互绑定
    // ─────────────────────────────────────────────────────────────

    _bindInteraction() {
        const sc  = this._screen;
        const H   = this.height;
        const tabs = ['scada','ladder','watch','trend','alarm'];

        // 屏幕底部标签栏点击
        const tabH = Math.max(10, H * 0.030);
        const tabW = sc.w / tabs.length;
        const tabY = sc.y + sc.h - tabH;

        tabs.forEach((tab, i) => {
            const hit = new Konva.Rect({
                x: sc.x + i * tabW, y: tabY,
                width: tabW - 1, height: tabH,
                fill: 'transparent',
            });
            hit.on('click tap', () => {
                this._activeView = tab;
                this._needRedraw = true;
                this._rebuildDynamic();
                this.markDirty();
            });
            this._interactGroup.add(hit);
        });

        // 电源按钮（点击连接/断开）
        const k   = this._powerBtn;
        const hitPwr = new Konva.Circle({
            x: k.x, y: k.y, radius: k.r * 2.5,
            fill: 'transparent',
        });
        hitPwr.on('click tap', () => {
            if (this._connected) this.disconnectFromCPU();
            else if (!this._connecting && this._cpu) this.connectToCPU(this._cpu);
        });
        this._interactGroup.add(hitPwr);

        // SCADA 画面上的 I/O 位图点击（强制写 Q/I 位）
        const ir   = this._screenLayout.ioRow;
        const bW2  = ir.w / 12;
        // Q0.0~Q0.7 点击（后8列）
        for (let i = 0; i < 8; i++) {
            const hitQ = new Konva.Rect({
                x: ir.x + (4 + i) * bW2, y: ir.y,
                width: bW2, height: ir.h,
                fill: 'transparent',
            });
            const bit = i;
            hitQ.on('click tap', () => {
                if (!this._connected) return;
                const cur = !!(this._mirror.Q[0] & (1 << bit));
                this._writeToCPU(`Q0.${bit}`, !cur);
                this._addAlarm('info', 'SCADA', `Q0.${bit} ← ${!cur ? 1 : 0}`);
            });
            this._interactGroup.add(hitQ);
        }

        // 下载按钮区域（屏幕梯形图视图中点击触发下载）
        const dlHit = new Konva.Rect({
            x: sc.x + sc.w * 0.70, y: sc.y + sc.h * 0.90,
            width: sc.w * 0.28, height: sc.h * 0.08,
            fill: 'transparent',
        });
        dlHit.on('click tap', () => {
            if (this._connected && this._activeView === 'ladder') {
                this.downloadProgram();
            }
        });
        this._interactGroup.add(dlHit);

        // 报警确认（屏幕报警视图中点击确认第一条）
        const ackHit = new Konva.Rect({
            x: sc.x, y: sc.y + sc.h * 0.13,
            width: sc.w, height: sc.h * 0.70,
            fill: 'transparent',
        });
        ackHit.on('click tap', () => {
            if (this._activeView === 'alarm' && this._alarms.length > 0) {
                this._alarms[0].ack = true;
                this._needRedraw = true;
            }
        });
        this._interactGroup.add(ackHit);
    }

    // ═══════════════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════════════

    tick(dt) {
        const dtMs = dt * 1000;
        const dtS  = dt;

        // 连接握手倒计时
        if (this._connecting && this._connectTimer > 0) {
            this._connectTimer -= dtMs;
            if (this._connectTimer <= 0) {
                this._completeConnect();
            }
        }

        // 数据轮询（每 pollIntervalMs）
        if (this._connected) {
            this._accumPollMs += dtMs;
            if (this._accumPollMs >= this._pollIntervalMs) {
                this._accumPollMs = 0;
                this._pollCPU();
            }
        }

        // 下载进度
        if (this._downloading) {
            this._tickDownload(dtS);
        }

        // 粒子动画
        this._tickParticles(dtS);

        // 报警闪烁
        this._alarmBlinkT += dtS;
        if (this._alarmBlinkT > 0.4) {
            this._alarmBlinkT = 0;
            this._alarmBlink  = !this._alarmBlink;
            this._needRedraw  = true;
        }

        // 重建动态层
        if (this._needRedraw || this._particles.length > 0 || this._downloading || this._connecting) {
            this._needRedraw = false;
            this._rebuildDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════

    /** 连接/断开 CPU */
    connectToCPU(cpu) {
        this._connectToCPU_impl(cpu);
    }

    _connectToCPU_impl(cpu) {
        if (this._connected || this._connecting) return;
        if (!cpu) return;
        this._cpu          = cpu;
        this._connecting   = true;
        this._connError    = false;
        this._connectTimer = 400 + Math.random() * 300;
        this._addAlarm('info', '网络', `正在连接 ${this._plcIP}…`);
        this._needRedraw = true;
        this._rebuildDynamic();
        this.markDirty();
    }

    disconnectFromCPU() {
        this._connected    = false;
        this._connecting   = false;
        this._connectTimer = 0;
        this._cpu          = null;
        this._downloading  = false;
        this._addAlarm('warn', '网络', '连接已断开');
        this._needRedraw = true;
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    /** 下载程序到 PLC */
    downloadProgram() {
        if (!this._connected || this._downloading) return;
        this._downloading      = true;
        this._downloadProgress = 0;
        this._downloadStep     = 0;
        this._downloadStepTimer= 0;
        this._addAlarm('info', '下载', '开始下载程序…');
        this._needRedraw = true;
    }

    /** 加载梯形图程序 */
    loadProgram(prog) {
        try {
            this._editorProgram = typeof prog === 'string' ? JSON.parse(prog) : JSON.parse(JSON.stringify(prog));
            this._programDirty  = !!this._onlineProgramJson &&
                JSON.stringify(this._editorProgram) !== this._onlineProgramJson;
            this.config.ladderProgram = JSON.stringify(this._editorProgram);
            this._needRedraw = true;
        } catch (e) {
            this._addAlarm('crit', '程序', `加载失败: ${e.message}`);
        }
    }

    /** 切换屏幕视图 */
    setView(view) {
        const valid = ['scada','ladder','watch','trend','alarm'];
        if (valid.includes(view)) {
            this._activeView = view;
            this._needRedraw = true;
        }
    }

    /** 强制写入 CPU 存储区 */
    writeToC PU(addr, val) {
        this._writeToCPU(addr, val);
    }

    forceCPURun()  { if (this._cpu) { this._cpu._running = true;  this._addAlarm('info','控制','CPU → RUN');  } }
    forceCPUStop() { if (this._cpu) { this._cpu._running = false; this._addAlarm('info','控制','CPU → STOP'); } }

    /** 添加监控点 */
    addWatchPoint(addr, type, comment) {
        if (this._watchPoints.length >= 32) return;
        this._watchPoints.push({ addr, type: type||'BOOL', comment: comment||'' });
        this._needRedraw = true;
    }

    /** 清除趋势数据 */
    clearTrend() {
        this._trendChannels.forEach(ch => ch.data = []);
        this._needRedraw = true;
    }

    /** 获取数据镜像快照 */
    getMirrorSnapshot() {
        return {
            I:   Array.from(this._mirror.I.slice(0,4)),
            Q:   Array.from(this._mirror.Q.slice(0,2)),
            AIW: Array.from(this._mirror.AIW.slice(0,8)),
            AQW: Array.from(this._mirror.AQW.slice(0,8)),
            PV:  this._readMirrorReal('VD0'),
            SP:  this._readMirrorReal('VD4'),
            MX:  this._readMirrorReal('VD8'),
        };
    }

    isConnected()    { return this._connected; }
    isConnecting()   { return this._connecting; }
    isDownloading()  { return this._downloading; }
    getAlarms()      { return this._alarms; }
    getActiveView()  { return this._activeView; }

    // ═══════════════════════════════════════════════════════════════
    // 默认程序
    // ═══════════════════════════════════════════════════════════════

    _defaultProgram() {
        return {
            name: 'SCADA_OB1',
            networks: [
                { comment: 'Network 1 · 启保停（I0.0启 I0.1停 Q0.0运行）',
                  rungs: [[{op:'LD',addr:'I0.0'},{op:'O',addr:'Q0.0'},{op:'AN',addr:'I0.1'},{op:'=',addr:'Q0.0'}]] },
                { comment: 'Network 2 · AI0→VD0(PV)',
                  rungs: [
                    [{op:'LD',addr:'SM0.0'},{op:'MOV_W',addr:'AIW0',addr2:'VW100'}],
                    [{op:'LD',addr:'SM0.0'},{op:'DTR',addr:'VW100',addr2:'VD0'}],
                    [{op:'LD',addr:'SM0.0'},{op:'*R',addr:'0.000362',addr2:'VD0'}],
                  ]},
                { comment: 'Network 3 · PID Loop0（Q0.0使能）',
                  rungs: [[{op:'LD',addr:'Q0.0'},{op:'PID',addr:'0',addr2:'0',loop:0,table:0}]] },
                { comment: 'Network 4 · PID输出→AQW0',
                  rungs: [
                    [{op:'LD',addr:'SM0.0'},{op:'MOV_R',addr:'VD8',addr2:'VD200'}],
                    [{op:'LD',addr:'SM0.0'},{op:'*R',addr:'27648.0',addr2:'VD200'}],
                    [{op:'LD',addr:'SM0.0'},{op:'TRUNC',addr:'VD200',addr2:'VW200'}],
                    [{op:'LD',addr:'SM0.0'},{op:'MOV_W',addr:'VW200',addr2:'AQW0'}],
                  ]},
                { comment: 'Network 5 · SM0.5 闪烁灯 Q0.7',
                  rungs: [[{op:'LD',addr:'SM0.5'},{op:'A',addr:'Q0.0'},{op:'=',addr:'Q0.7'}]] },
            ]
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号',           key: 'label',          type: 'text'     },
            { label: '工程名',         key: 'projectName',    type: 'text'     },
            { label: '本机 IP',        key: 'pcIP',           type: 'text'     },
            { label: 'PLC IP',         key: 'plcIP',          type: 'text'     },
            { label: '轮询间隔 (ms)',   key: 'pollIntervalMs', type: 'number'   },
            { label: '梯形图程序(JSON)',key: 'ladderProgram',  type: 'textarea' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label          !== undefined) this.label           = cfg.label;
        if (cfg.projectName    !== undefined) this._projectName    = cfg.projectName;
        if (cfg.pcIP           !== undefined) this._pcIP           = cfg.pcIP;
        if (cfg.plcIP          !== undefined) this._plcIP          = cfg.plcIP;
        if (cfg.pollIntervalMs !== undefined) this._pollIntervalMs = Math.max(10, parseFloat(cfg.pollIntervalMs)||100);
        if (cfg.ladderProgram  !== undefined) this.loadProgram(cfg.ladderProgram);

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        this.disconnectFromCPU();
        super.destroy?.();
    }
}
