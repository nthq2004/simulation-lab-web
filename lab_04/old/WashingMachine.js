import { BaseComponent } from './BaseComponent.js';

/**
 * 全自动滚筒洗衣机仿真组件（DD直驱电机）
 * WashingMachine Simulation Component
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件仿真一台全自动DD直驱滚筒洗衣机的完整工作循环，
 *  包含以下传感器与执行机构：
 *
 *  【传感器系统】
 *  1. 压力传感器（Pressure Sensor）
 *     - 原理：压阻效应（Piezoresistive Effect）
 *     - 量程：0~30 kPa（对应水位 0~60 cm）
 *     - 作用：检测滚筒内水位，控制进水/排水阀
 *     - 输出：4~20 mA 电流信号 → ADC → 水位 cm
 *
 *  2. NTC 热敏电阻（NTC Thermistor）
 *     - 原理：电阻随温度升高而降低（负温度系数）
 *     - 材质：Mn-Co-Ni 复合氧化物
 *     - 量程：0~95℃（R25=10kΩ，B=3950K）
 *     - 作用：检测洗涤水温，驱动加热管 PID 控制
 *     - 公式：R(T) = R25 × exp[B×(1/T - 1/T25)]
 *
 *  3. MEMS 加速度计（MEMS Accelerometer）
 *     - 原理：电容式（差分电容检测微小位移）
 *     - 量程：±16g，分辨率 0.001g
 *     - 三轴：X（左右）/ Y（前后）/ Z（上下振动）
 *     - 作用：检测滚筒振动烈度，判断衣物不平衡量
 *             脱水转速超阈值时保护停机
 *     - 输出：振动 RMS（g）→ 报警阈值 2.5g
 *
 *  4. 电流传感器（Current Sensor）
 *     - 原理：霍尔效应（Hall Effect）+ 分流电阻双路冗余
 *     - 量程：0~50 A（DD 电机峰值）
 *     - 作用：检测 DD 直驱电机相电流 → 计算实时转矩
 *             过流保护（>42A 停机）
 *     - 输出：mV/A → 霍尔 IC → ADC 采样
 *
 *  5. 门锁开关（Door Lock Switch）
 *     - 原理：机械触点（PTC 热锁+微动开关）
 *     - 状态：Open（开门）/ Locked（锁门）/ Unlocked（解锁中）
 *     - 作用：门未锁禁止启动；洗涤中禁止开门
 *             水温>45℃ 或转速>60 rpm 时不解锁
 *
 *  6. 光电传感器（Photoelectric Sensor）
 *     - 原理：光电效应（发射 850nm 红外，接收反射光）
 *     - 安装：门玻璃内侧，检测筒内泡沫高度
 *     - 作用：泡沫过多时暂停洗涤，触发额外漂洗
 *             泡沫等级：None / Low / Medium / High / Overflow
 *
 *  7. 应变片（Strain Gauge）
 *     - 原理：电阻应变效应（标距伸长→电阻增大）
 *     - 桥式：惠斯通全桥（4片组合，温度补偿）
 *     - 量程：0~15 kg（有效衣物重量）
 *     - 作用：启动前称重，自动匹配水量/转速/时长程序
 *             输出：称重精度 ±100g
 *
 *  【DD 直驱电机（Direct Drive Motor）】
 *  - 类型：外转子永磁同步电机（PMSM）
 *  - 极数：36 极（18 对极）
 *  - 控制：矢量控制（FOC）+ 编码器反馈
 *  - 转速范围：0~1400 rpm（洗涤 40~60，脱水 400~1400）
 *  - 额定功率：850 W
 *  - 特点：无皮带/减速箱传动，直接驱动滚筒轴
 *           低速大转矩（15 N·m @ 45 rpm）
 *           振动噪声极低（<45 dB）
 *
 *  【程序流程】
 *  ┌─ 预洗 PreWash（可选）──────────────────────────────────┐
 *  │  进水→加热→低速滚洗（正反转 45rpm）→排水              │
 *  └────────────────────────────────────────────────────────┘
 *  ┌─ 主洗 MainWash ─────────────────────────────────────┐
 *  │  进水→加热至设定温度→滚洗→检测泡沫→排水            │
 *  └──────────────────────────────────────────────────────┘
 *  ┌─ 漂洗×N Rinse ──────────────────────────────────────┐
 *  │  进水→冷水滚洗→脱水→[循环 N 次]                     │
 *  └──────────────────────────────────────────────────────┘
 *  ┌─ 脱水 Spin ──────────────────────────────────────────┐
 *  │  加速（0→1400rpm，阶梯升速）→高速脱水→减速停止       │
 *  └──────────────────────────────────────────────────────┘
 *  ┌─ 烘干 Dry（可选）────────────────────────────────────┐
 *  │  进冷风→加热管加热→低速滚动→排湿→冷风冷却→完成      │
 *  └──────────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  power_in     — 电源输入（L/N）
 *  data_out     — 传感器数据总线输出（JSON 快照）
 *  alarm_out    — 报警输出（高=有报警）
 *  remote_in    — 远程控制输入（程序选择 / 启停）
 *
 * ── 使用方法 ──────────────────────────────────────────────────
 *  const wm = new WashingMachine({
 *    x: 50, y: 30,
 *    width: 500, height: 580,
 *    label: 'WM-01',
 *    program: 'cotton',    // cotton / synthetic / delicate / quick / spin / dry
 *    washTemp: 40,         // ℃
 *    spinSpeed: 1200,      // rpm
 *    simSpeed: 60,         // 仿真加速倍率
 *  }, sys);
 */
export class WashingMachine extends BaseComponent {

    // ────────────────────────────────────────────────────────
    constructor(config, sys) {
        super(config, sys);

        this._initGroups();
        this.width   = Math.max(460, config.width  || 520);
        this.height  = Math.max(540, config.height || 600);
        this.type    = 'washing_machine';
        this.cache   = 'none';
        this.label   = config.label || 'WM-01';

        // ── 程序参数 ──
        this._program   = config.program   || 'cotton';  // 当前程序
        this._washTemp  = config.washTemp  ?? 40;        // ℃ 洗涤温度
        this._spinSpeed = config.spinSpeed ?? 1200;      // rpm 最高转速
        this._simSpeed  = config.simSpeed  ?? 60;        // 仿真加速倍率

        // ── 程序库 ──
        this._programs = {
            cotton:    { name:'棉质',    washTemp:40, spinRpm:1200, rinseN:3, prewash:false, dry:false, washTime:2400 },
            synthetic: { name:'化纤',    washTemp:30, spinRpm:900,  rinseN:2, prewash:false, dry:false, washTime:1800 },
            delicate:  { name:'精细',    washTemp:30, spinRpm:600,  rinseN:2, prewash:false, dry:false, washTime:1500 },
            quick:     { name:'快速',    washTemp:30, spinRpm:1000, rinseN:1, prewash:false, dry:false, washTime:900  },
            spin:      { name:'单脱水',  washTemp:0,  spinRpm:1400, rinseN:0, prewash:false, dry:false, washTime:0    },
            cotton_dry:{ name:'棉质+烘', washTemp:40, spinRpm:1200, rinseN:3, prewash:false, dry:true,  washTime:2400 },
        };

        // ── 状态机 ──
        // phases: idle → prewash → mainwash → rinse(N) → spin → dry → done
        this._phase       = 'idle';   // 当前阶段
        this._phaseTimer  = 0;        // 当前阶段计时 s（仿真秒）
        this._phaseTarget = 0;        // 当前阶段目标时长
        this._rinseCount  = 0;        // 已完成漂洗次数
        this._running     = false;
        this._paused      = false;
        this._simTime     = 0;

        // 子阶段（进水/加热/洗涤/排水等）
        this._subPhase    = '';
        this._subTimer    = 0;

        // ── DD 直驱电机 ──
        this._motor = {
            rpm:        0,
            targetRpm:  0,
            direction:  1,      // +1 正转，-1 反转
            dirTimer:   0,      // 方向切换计时（正反交替）
            torque:     0,      // N·m
            power:      0,      // W
            current:    0,      // A（相电流）
            peakCurrent:0,
            state:      'stop', // stop / accel / run / decel / brake
            accelRate:  80,     // rpm/s 加速率
            decelRate:  120,    // rpm/s 减速率（含反接制动）
            encAngle:   0,      // 编码器累计角度 °
        };

        // ── 传感器 ──
        this._sensors = {
            // 压力传感器
            pressure: { raw: 0, voltage: 0.5, waterLevel: 0, unit: 'cm', ok: true },
            // NTC 热敏电阻
            ntc:      { resistance: 10000, tempC: 20, unit: '℃', ok: true },
            // MEMS 加速度计
            accel:    { x: 0, y: 0, z: 0, rms: 0, unit: 'g', ok: true },
            // 电流传感器
            current:  { hall: 0, shunt: 0, motorA: 0, unit: 'A', ok: true },
            // 门锁开关
            doorLock: { doorOpen: false, locked: false, lockState: 'unlocked', ok: true },
            // 光电传感器（泡沫）
            photo:    { adcRaw: 0, foamLevel: 'none', foamPct: 0, ok: true },
            // 应变片（称重）
            strain:   { bridgeVoltage: 0, weightKg: 0, unit: 'kg', measured: false, ok: true },
        };

        // ── 物理状态 ──
        this._waterLevel  = 0;     // cm 水位
        this._waterTemp   = 20;    // ℃ 水温
        this._foamLevel   = 0;     // 0~1 泡沫量
        this._clothWeight = 0;     // kg 衣物重量
        this._drumAngle   = 0;     // ° 滚筒当前角度（显示用）
        this._isHeating   = false; // 加热管状态
        this._valveIn     = false; // 进水阀
        this._valveDrain  = false; // 排水泵
        this._fanOn       = false; // 烘干风机
        this._vibration   = 0;     // 振动 g

        // 目标水位
        this._targetWaterLevel = 0;

        // ── 报警 ──
        this._alarms = {
            doorOpen:    false,  // 运行中门打开
            overCurrent: false,  // 电机过流
            overVibration: false,// 振动过大
            foamOverflow:false,  // 泡沫溢出
            waterTimeout:false,  // 进水超时
            tempFault:   false,  // 温度传感器故障
            unbalanced:  false,  // 衣物不平衡
        };

        // ── 历史数据 ──
        this._history = {
            rpm: [], temp: [], waterLevel: [], current: [],
            maxLen: 180,
        };

        // ── 布局 ──
        this._L = this._calcLayout();

        this._init();

        // ── 端口 ──
        const L = this._L;
        this.addPort(L.bodyX,                   L.bodyY + L.bodyH * 0.8, 'power_in',  'wire', 'L/N');
        this.addPort(L.bodyX + L.bodyW,          L.bodyY + L.bodyH * 0.3, 'data_out',  'wire', 'DATA');
        this.addPort(L.bodyX + L.bodyW,          L.bodyY + L.bodyH * 0.6, 'alarm_out', 'wire', 'ALM');
        this.addPort(L.bodyX + L.bodyW * 0.5,   L.bodyY - 8,             'remote_in', 'wire', 'CTRL');
    }

    // ═══════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        const PAD = 6;

        // 洗衣机主体外壳
        const bodyW = W * 0.58;
        const bodyH = H * 0.85;
        const bodyX = PAD;
        const bodyY = H * 0.06;

        // 滚筒（内部圆形，占主体中央）
        const drumCX = bodyX + bodyW * 0.5;
        const drumCY = bodyY + bodyH * 0.46;
        const drumR  = Math.min(bodyW * 0.36, bodyH * 0.28);

        // 控制面板区域（右侧）
        const panelX = bodyX + bodyW + 10;
        const panelW = W - panelX - PAD;
        const panelH = H - 12;

        // 底部机械区
        const mechY  = bodyY + bodyH + 6;
        const mechH  = H - mechY - PAD;

        return {
            W, H, PAD,
            bodyX, bodyY, bodyW, bodyH,
            drumCX, drumCY, drumR,
            panelX, panelW, panelH,
            mechY, mechH,
        };
    }

    // ═══════════════════════════════════════════════════════
    _init() {
        this._drawCabinetShell();
        this._drawDoorPorthole();
        this._drawTopPanel();
        this._drawDrumInner();
        this._drawValvePipes();
        this._drawDDMotorSymbol();
        this._drawSensorMounts();
        this._createDynGroup();
        this._drawControlPanel();
        this._drawLabel();
        this._bindInteraction();
    }

    // ── 机身外壳 ─────────────────────────────────────
    _drawCabinetShell() {
        const L = this._L;
        // 外壳（白色家电钢板）
        this._staticGroup.add(new Konva.Rect({
            x: L.bodyX, y: L.bodyY,
            width: L.bodyW, height: L.bodyH,
            fill: '#e8edf2',
            stroke: '#b8c0cc', strokeWidth: 1.5,
            cornerRadius: [12, 12, 4, 4],
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.12,
        }));
        // 面板顶部（深灰色控制面板条）
        this._staticGroup.add(new Konva.Rect({
            x: L.bodyX + 1, y: L.bodyY + 1,
            width: L.bodyW - 2, height: L.bodyH * 0.12,
            fill: '#1a2030',
            cornerRadius: [11, 11, 0, 0],
        }));
        // 侧面板竖线装饰
        this._staticGroup.add(new Konva.Line({
            points: [L.bodyX + 4, L.bodyY + L.bodyH * 0.12,
                     L.bodyX + 4, L.bodyY + L.bodyH - 4],
            stroke: '#d0d8e0', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [L.bodyX + L.bodyW - 4, L.bodyY + L.bodyH * 0.12,
                     L.bodyX + L.bodyW - 4, L.bodyY + L.bodyH - 4],
            stroke: '#d0d8e0', strokeWidth: 1,
        }));
        // 底部脚垫
        [-0.15, 0.85].forEach(rx => {
            this._staticGroup.add(new Konva.Rect({
                x: L.bodyX + L.bodyW * 0.2 + rx * 10,
                y: L.bodyY + L.bodyH - 6,
                width: L.bodyW * 0.18, height: 8,
                fill: '#555', stroke: '#333', strokeWidth: 0.5,
                cornerRadius: [0, 0, 3, 3],
            }));
            this._staticGroup.add(new Konva.Rect({
                x: L.bodyX + L.bodyW * 0.6 + rx * 10,
                y: L.bodyY + L.bodyH - 6,
                width: L.bodyW * 0.18, height: 8,
                fill: '#555', stroke: '#333', strokeWidth: 0.5,
                cornerRadius: [0, 0, 3, 3],
            }));
        });
    }

    // ── 舷窗门 ─────────────────────────────────────
    _drawDoorPorthole() {
        const L = this._L;
        const cx = L.drumCX, cy = L.drumCY, r = L.drumR;

        // 门框外圈（银色金属圈）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 18,
            fillLinearGradientStartPoint:  { x: -(r+18), y: -(r+18) },
            fillLinearGradientEndPoint:    { x:  (r+18), y:  (r+18) },
            fillLinearGradientColorStops: [0,'#d0d5dc', 0.4,'#eef1f5', 0.6,'#c8cdd5', 1,'#a0a8b4'],
            stroke: '#8898a8', strokeWidth: 1,
        }));
        // 橡胶密封圈
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: r + 4,
            outerRadius: r + 14,
            fill: '#1a1a1a',
            stroke: '#2a2a2a', strokeWidth: 0.5,
        }));
        // 门玻璃（深色蓝灰）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 3,
            fill: '#1e2840',
            stroke: '#0a0e1a', strokeWidth: 1.5,
        }));
        // 玻璃高光
        this._staticGroup.add(new Konva.Arc({
            x: cx - r * 0.2, y: cy - r * 0.3,
            innerRadius: r * 0.4,
            outerRadius: r * 0.72,
            angle: 90, rotation: -60,
            fill: 'rgba(255,255,255,0.06)',
        }));
        // 铰链
        [-1, 1].forEach(s => {
            this._staticGroup.add(new Konva.Rect({
                x: cx - 4, y: cy + s * (r + 14) - 5,
                width: 8, height: 10,
                fill: '#888', stroke: '#666', strokeWidth: 0.5, cornerRadius: 2,
            }));
        });
        // 门把手
        this._staticGroup.add(new Konva.Rect({
            x: cx + r + 10, y: cy - 14,
            width: 6, height: 28,
            fill: '#d0d5dc', stroke: '#a0a8b4', strokeWidth: 0.8, cornerRadius: 3,
        }));
        // 记录滚筒范围
        this._drumR  = r;
        this._drumCX = cx;
        this._drumCY = cy;
    }

    // ── 顶部操控条 ─────────────────────────────────
    _drawTopPanel() {
        const L = this._L;
        const tx = L.bodyX + 8;
        const ty = L.bodyY + 4;
        const tw = L.bodyW - 16;
        const th = L.bodyH * 0.11;
        // 电源指示灯
        this._staticGroup.add(new Konva.Circle({
            x: tx + 12, y: ty + th * 0.5, radius: 5,
            fill: '#111', stroke: '#333', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: tx + 20, y: ty + th * 0.5 - 4,
            text: 'POWER', fontSize: 7, fill: '#557', fontStyle: 'bold',
        }));
        // 程序旋钮占位
        this._staticGroup.add(new Konva.Circle({
            x: tx + tw - 20, y: ty + th * 0.5, radius: 9,
            fill: '#2a3040', stroke: '#445', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [tx + tw - 20, ty + th * 0.5,
                     tx + tw - 20, ty + th * 0.5 - 7],
            stroke: '#c0c8d0', strokeWidth: 1.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Text({
            x: tx + tw - 36, y: ty + th - 5,
            text: 'PROG', fontSize: 6, fill: '#6678', fontStyle: 'bold',
        }));
    }

    // ── 滚筒内部 ─────────────────────────────────
    _drawDrumInner() {
        const cx = this._drumCX, cy = this._drumCY, r = this._drumR;
        // 滚筒外壁（不锈钢圆筒）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0,'#d8dce0', 0.5,'#b0b8c0', 1,'#8090a0'],
            stroke: '#889', strokeWidth: 1,
        }));
        // 内壁
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r - 4,
            fill: '#c0c8d4',
            stroke: '#a0aab4', strokeWidth: 0.5,
        }));
        // 提升筋（3条，120°间隔）
        for (let i = 0; i < 3; i++) {
            const a = (i * 120) * Math.PI / 180;
            const ix = cx + (r - 8) * Math.cos(a);
            const iy = cy + (r - 8) * Math.sin(a);
            this._staticGroup.add(new Konva.Rect({
                x: ix - 4, y: iy - 14,
                width: 8, height: 28,
                fill: '#8898a8', stroke: '#6678', strokeWidth: 0.5,
                cornerRadius: 4,
                rotation: (i * 120) + 90,
                offsetX: 0, offsetY: 0,
            }));
        }
        // 滚筒孔（散点效果，表示透水孔）
        for (let i = 0; i < 24; i++) {
            const a = (i * 15) * Math.PI / 180;
            const pr = r - 10;
            this._staticGroup.add(new Konva.Circle({
                x: cx + pr * Math.cos(a),
                y: cy + pr * Math.sin(a),
                radius: 1.5,
                fill: '#6878a0',
                opacity: 0.6,
            }));
        }
        // 中心轴（DD 电机轴）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 6,
            fill: '#c0c0c0', stroke: '#888', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 2.5,
            fill: '#333',
        }));
        this._drumInnerGroup = this.group; // 标记（动态层会重绘内容）
    }

    // ── 进排水管路 ────────────────────────────────
    _drawValvePipes() {
        const L = this._L;
        const bx = L.bodyX, by = L.bodyY, bw = L.bodyW, bh = L.bodyH;

        // 进水管（顶部左侧）
        this._staticGroup.add(new Konva.Rect({
            x: bx + 12, y: by - 12, width: 10, height: 16,
            fill: '#778899', stroke: '#556', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: bx + 6, y: by - 18,
            text: 'IN', fontSize: 7, fill: '#8899aa', fontStyle: 'bold',
        }));
        // 进水电磁阀标志
        this._staticGroup.add(new Konva.Rect({
            x: bx + 8, y: by + 4, width: 18, height: 10,
            fill: '#2a3040', stroke: '#445', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: bx + 9, y: by + 5,
            text: 'SV1', fontSize: 6, fill: '#6688aa', fontStyle: 'bold',
        }));
        this._svInPos = { x: bx + 17, y: by + 9 };

        // 排水泵（底部右侧）
        const drainX = bx + bw * 0.7;
        const drainY = by + bh - 10;
        this._staticGroup.add(new Konva.Rect({
            x: drainX - 12, y: drainY, width: 24, height: 10,
            fill: '#2a3040', stroke: '#445', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: drainX - 10, y: drainY + 1,
            text: 'PUMP', fontSize: 6, fill: '#6688aa', fontStyle: 'bold',
        }));
        this._pumpPos = { x: drainX, y: drainY };

        // 加热管标志
        const heatX = bx + bw * 0.3, heatY = by + bh - 28;
        this._staticGroup.add(new Konva.Rect({
            x: heatX - 18, y: heatY, width: 36, height: 10,
            fill: '#2a2020', stroke: '#554', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: heatX - 16, y: heatY + 1,
            text: 'HEATER', fontSize: 6, fill: '#aa6644', fontStyle: 'bold',
        }));
        this._heaterPos = { x: heatX, y: heatY + 5 };
    }

    // ── DD 电机符号（机身后部）──────────────────────
    _drawDDMotorSymbol() {
        const L  = this._L;
        const cx = L.drumCX + L.drumR + 14;
        const cy = L.drumCY;
        const r  = 14;
        // 定子外圈
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#1e2838', stroke: '#3a4858', strokeWidth: 1.5,
        }));
        // 线圈示意（6个短矩形）
        for (let i = 0; i < 6; i++) {
            const a = (i * 60) * Math.PI / 180;
            const ex = cx + (r - 5) * Math.cos(a);
            const ey = cy + (r - 5) * Math.sin(a);
            this._staticGroup.add(new Konva.Rect({
                x: ex - 2, y: ey - 4,
                width: 4, height: 8,
                fill: '#c87030', cornerRadius: 1,
                rotation: i * 60,
                offsetX: 0, offsetY: 0,
            }));
        }
        // 转子内圈
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.55,
            fill: '#2a3848', stroke: '#4a5868', strokeWidth: 1,
        }));
        // 永磁体极（红/蓝交替）
        for (let i = 0; i < 4; i++) {
            const a = (i * 90 + 45) * Math.PI / 180;
            this._staticGroup.add(new Konva.Circle({
                x: cx + r * 0.32 * Math.cos(a),
                y: cy + r * 0.32 * Math.sin(a),
                radius: 2.5,
                fill: i % 2 === 0 ? '#e03030' : '#3070e0',
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: cx - 8, y: cy + r + 3,
            text: 'DD-MOT', fontSize: 6, fill: '#5a7090', fontStyle: 'bold',
        }));
        this._ddMotorPos = { x: cx, y: cy, r };
    }

    // ── 传感器安装位置标记 ────────────────────────
    _drawSensorMounts() {
        const L = this._L;
        const bx = L.bodyX, by = L.bodyY, bw = L.bodyW, bh = L.bodyH;
        const cx = L.drumCX, cy = L.drumCY, r = L.drumR;

        // 记录各传感器安装坐标
        this._sensorPos = {
            pressure: { x: bx + 22,          y: by + bh * 0.68 }, // 压力传感器（机身左下）
            ntc:      { x: bx + bw * 0.25,   y: by + bh - 22   }, // NTC（底部水槽）
            accel:    { x: bx + bw * 0.5,    y: by + bh * 0.88 }, // MEMS（后板）
            current:  { x: cx + r + 28,      y: cy + 10        }, // 电流传感器（电机旁）
            doorLock: { x: cx + r + 4,       y: cy - r * 0.8   }, // 门锁（门缘）
            photo:    { x: cx - r + 10,      y: cy - r + 10    }, // 光电（门玻璃内）
            strain:   { x: bx + bw * 0.75,   y: by + bh - 32   }, // 应变片（底座）
        };

        // 各传感器标记（静态圆点+标签）
        const cfg = [
            { key:'pressure', color:'#ff9800', sym:'P',  label:'PRES'  },
            { key:'ntc',      color:'#f44336', sym:'T',  label:'NTC'   },
            { key:'accel',    color:'#9c27b0', sym:'A',  label:'MEMS'  },
            { key:'current',  color:'#2196f3', sym:'I',  label:'HALL'  },
            { key:'doorLock', color:'#4caf50', sym:'D',  label:'LOCK'  },
            { key:'photo',    color:'#ffeb3b', sym:'L',  label:'PHOTO' },
            { key:'strain',   color:'#00bcd4', sym:'W',  label:'STRN'  },
        ];
        cfg.forEach(c => {
            const p = this._sensorPos[c.key];
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: 5,
                fill: c.color + '44', stroke: c.color, strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: p.x - 3, y: p.y - 4,
                text: c.sym, fontSize: 7, fill: c.color, fontStyle: 'bold',
            }));
            this._staticGroup.add(new Konva.Text({
                x: p.x + 7, y: p.y - 4,
                text: c.label, fontSize: 6, fill: c.color, fontStyle: 'bold',
            }));
        });
    }

    // ── 动态层 ──────────────────────────────────────
    _createDynGroup() {
        this._dynGroup = new Konva.Group();
        this._staticGroup.add(this._dynGroup);
        this._rebuildDyn();
    }

    _rebuildDyn() {
        this._dynGroup.destroyChildren();
        this._drawWaterLevel();
        this._drawDrumRotation();
        this._drawFoamLayer();
        this._drawHeaterGlow();
        this._drawValveFlow();
        this._drawSensorReadouts();
        this._drawAlarmOverlay();
        this._drawPhaseInfo();
        this._drawDDMotorAnim();
    }

    // 水位显示
    _drawWaterLevel() {
        const cx = this._drumCX, cy = this._drumCY, r = this._drumR;
        const wLevel = this._waterLevel;
        if (wLevel <= 0) return;

        const wFraction = Math.min(1, wLevel / 45);
        const wH = r * 2 * wFraction;
        const wY = cy + r - wH;
        const wW = Math.sqrt(Math.max(0, r * r - Math.pow(r - wH, 2))) * 2 + 1;

        // 剪裁路径（圆内水面）
        this._dynGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: 0, outerRadius: r - 4,
            angle: 180,
            rotation: 180 + Math.asin(Math.max(-1, Math.min(1, (r - wH) / (r - 4)))) * 180 / Math.PI,
            fill: `rgba(${30 + this._waterTemp * 2},${140 - this._waterTemp}, 220, 0.35)`,
        }));

        // 水位线
        this._dynGroup.add(new Konva.Line({
            points: [cx - wW / 2, wY, cx + wW / 2, wY],
            stroke: `rgba(100,200,255,0.6)`,
            strokeWidth: 1.5,
            dash: [4, 2],
        }));

        // 水位刻度标注
        this._dynGroup.add(new Konva.Text({
            x: cx - r - 28, y: wY - 4,
            text: `${wLevel.toFixed(0)}cm`,
            fontSize: 8, fill: '#64c8ff', fontStyle: 'bold',
        }));
        // 刻度箭头
        this._dynGroup.add(new Konva.Line({
            points: [cx - r - 8, wY, cx - r - 2, wY],
            stroke: '#64c8ff', strokeWidth: 1, lineCap: 'round',
        }));
    }

    // 滚筒旋转动画
    _drawDrumRotation() {
        const cx = this._drumCX, cy = this._drumCY, r = this._drumR;
        const angle = this._drumAngle;
        const motor  = this._motor;

        if (motor.rpm < 1) return;

        // 旋转的提升筋
        for (let i = 0; i < 3; i++) {
            const a = ((angle + i * 120) % 360) * Math.PI / 180;
            const lx1 = cx + (r - 12) * Math.cos(a);
            const ly1 = cy + (r - 12) * Math.sin(a);
            const lx2 = cx + (r - 24) * Math.cos(a);
            const ly2 = cy + (r - 24) * Math.sin(a);
            this._dynGroup.add(new Konva.Line({
                points: [lx1, ly1, lx2, ly2],
                stroke: '#8898a8', strokeWidth: 4, lineCap: 'round',
            }));
        }

        // 高速时的运动模糊弧线
        if (motor.rpm > 200) {
            const numArcs = Math.min(8, Math.floor(motor.rpm / 80));
            const alpha   = Math.min(0.5, motor.rpm / 3000);
            for (let i = 0; i < numArcs; i++) {
                const startA = (angle + i * (360 / numArcs)) * Math.PI / 180;
                this._dynGroup.add(new Konva.Arc({
                    x: cx, y: cy,
                    innerRadius: r - 20,
                    outerRadius: r - 8,
                    angle: 30,
                    rotation: (angle + i * (360 / numArcs)),
                    fill: `rgba(180,200,220,${alpha * (1 - i / numArcs)})`,
                }));
            }
        }

        // 衣物（低速时可见）
        if (motor.rpm < 150 && this._clothWeight > 0) {
            const clothCount = Math.min(6, Math.ceil(this._clothWeight / 1.5));
            for (let i = 0; i < clothCount; i++) {
                const a   = ((angle + i * (360 / clothCount) + 180) % 360) * Math.PI / 180;
                const cr  = (r - 18) * 0.6;
                const ccx = cx + cr * Math.cos(a);
                const ccy = cy + cr * Math.sin(a) + (r - 18) * 0.3; // 重力下沉
                const clothColors = ['#e8d0a0','#a0c0e8','#e8a0a0','#a0e8a0','#c0a0e8','#e8c0a0'];
                this._dynGroup.add(new Konva.Ellipse({
                    x: ccx, y: ccy,
                    radiusX: 10 + Math.random() * 4,
                    radiusY: 7  + Math.random() * 3,
                    fill: clothColors[i % clothColors.length],
                    opacity: 0.7,
                    rotation: a * 180 / Math.PI,
                }));
            }
        }
    }

    // 泡沫层
    _drawFoamLayer() {
        const cx = this._drumCX, cy = this._drumCY, r = this._drumR;
        const foam = this._foamLevel;
        if (foam < 0.1) return;

        const numBubbles = Math.floor(foam * 60);
        const foamY = cy + r * (1 - foam * 0.8);

        for (let i = 0; i < numBubbles; i++) {
            const bx  = cx + (Math.random() - 0.5) * r * 1.6;
            const by  = foamY + Math.random() * (cy + r - foamY);
            const bRad = 2 + Math.random() * 4;
            const dist = Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2);
            if (dist > r - 8) continue;
            this._dynGroup.add(new Konva.Circle({
                x: bx, y: by, radius: bRad,
                fill: 'rgba(240,248,255,0.6)',
                stroke: 'rgba(200,230,255,0.4)',
                strokeWidth: 0.5,
            }));
        }
        // 泡沫等级标注
        const fLabel = foam > 0.85 ? '⚠泡沫溢出' : foam > 0.6 ? '泡沫:多' : foam > 0.3 ? '泡沫:中' : '泡沫:少';
        const fColor = foam > 0.85 ? '#f44336' : foam > 0.6 ? '#ff9800' : '#64c8ff';
        this._dynGroup.add(new Konva.Text({
            x: cx - 30, y: cy - r + 6,
            text: fLabel, fontSize: 8, fill: fColor, fontStyle: 'bold',
        }));
    }

    // 加热管辉光
    _drawHeaterGlow() {
        if (!this._isHeating) return;
        const hp = this._heaterPos;
        if (!hp) return;
        const t     = (this._animFrame % 20) / 20;
        const gAlpha = 0.3 + 0.2 * Math.sin(t * Math.PI * 2);
        this._dynGroup.add(new Konva.Rect({
            x: hp.x - 22, y: hp.y - 6,
            width: 44, height: 12,
            fill: `rgba(255,100,30,${gAlpha})`,
            cornerRadius: 3,
            shadowColor: '#ff4400',
            shadowBlur: 8,
            shadowOpacity: gAlpha,
        }));
    }

    // 进排水流动动画
    _drawValveFlow() {
        const phase = (this._animFrame * 2) % 20;

        if (this._valveIn && this._svInPos) {
            const p = this._svInPos;
            this._dynGroup.add(new Konva.Line({
                points: [p.x, p.y, p.x, p.y + 40, this._drumCX, p.y + 40],
                stroke: `rgba(100,180,255,0.6)`,
                strokeWidth: 2,
                dash: [5, 3], dashOffset: -phase,
                lineJoin: 'round',
            }));
        }
        if (this._valveDrain && this._pumpPos) {
            const p = this._pumpPos;
            this._dynGroup.add(new Konva.Line({
                points: [this._drumCX, p.y - 20, p.x, p.y - 20, p.x, p.y],
                stroke: `rgba(100,180,100,0.5)`,
                strokeWidth: 2,
                dash: [5, 3], dashOffset: phase,
                lineJoin: 'round',
            }));
        }
    }

    // 传感器气泡读数
    _drawSensorReadouts() {
        const s = this._sensors;
        const reads = [
            { pos: this._sensorPos.pressure, color:'#ff9800',
              text: `${s.pressure.waterLevel.toFixed(0)}cm\n${(s.pressure.voltage).toFixed(2)}V` },
            { pos: this._sensorPos.ntc,      color:'#f44336',
              text: `${s.ntc.tempC.toFixed(1)}℃\n${(s.ntc.resistance/1000).toFixed(1)}kΩ` },
            { pos: this._sensorPos.accel,    color:'#9c27b0',
              text: `${s.accel.rms.toFixed(2)}g\nX:${s.accel.x.toFixed(1)} Z:${s.accel.z.toFixed(1)}` },
            { pos: this._sensorPos.current,  color:'#2196f3',
              text: `${s.current.motorA.toFixed(1)}A\n${this._motor.torque.toFixed(1)}N·m` },
            { pos: this._sensorPos.doorLock, color:'#4caf50',
              text: s.doorLock.locked ? '锁门\nLOCKED' : s.doorLock.doorOpen ? '开门\nOPEN' : '关门\nUNLOCK' },
            { pos: this._sensorPos.photo,    color:'#ffeb3b',
              text: `泡沫:${s.photo.foamLevel}\n${s.photo.foamPct.toFixed(0)}%` },
            { pos: this._sensorPos.strain,   color:'#00bcd4',
              text: `${s.strain.weightKg.toFixed(2)}kg\n${(s.strain.bridgeVoltage*1000).toFixed(1)}mV` },
        ];

        reads.forEach(rd => {
            if (!rd.pos) return;
            const lines = rd.text.split('\n');
            const bW = 46, bH = 22;
            this._dynGroup.add(new Konva.Rect({
                x: rd.pos.x - 2, y: rd.pos.y + 8,
                width: bW, height: bH,
                fill: 'rgba(8,12,24,0.88)',
                stroke: rd.color + '55',
                strokeWidth: 0.5, cornerRadius: 3,
            }));
            lines.forEach((line, i) => {
                this._dynGroup.add(new Konva.Text({
                    x: rd.pos.x, y: rd.pos.y + 10 + i * 11,
                    text: line, fontSize: 7.5, fontStyle: 'bold',
                    fill: i === 0 ? rd.color : rd.color + 'bb',
                    width: bW - 4,
                }));
            });
        });
    }

    // 报警叠加层
    _drawAlarmOverlay() {
        const alms = this._alarms;
        const hasAlarm = Object.values(alms).some(v => v);
        if (!hasAlarm) return;
        const t = (this._animFrame % 12) / 12;
        const alpha = 0.5 + 0.35 * Math.sin(t * Math.PI * 2);
        const L = this._L;
        this._dynGroup.add(new Konva.Rect({
            x: L.bodyX + 2, y: L.bodyY + 2,
            width: L.bodyW - 4, height: L.bodyH * 0.11,
            fill: `rgba(220,50,30,${alpha * 0.2})`,
            cornerRadius: [10, 10, 0, 0],
        }));
        this._dynGroup.add(new Konva.Text({
            x: L.bodyX + 6, y: L.bodyY + 6,
            text: '⚠ ALARM',
            fontSize: 11, fontStyle: 'bold',
            fill: `rgba(255,80,60,${alpha})`,
        }));
    }

    // 当前阶段信息
    _drawPhaseInfo() {
        const L = this._L;
        const cx = this._drumCX, cy = this._drumCY, r = this._drumR;
        const ph = this._phase;
        const phaseInfo = {
            idle:     { text:'待机 IDLE',      color:'#546e7a' },
            prewash:  { text:'预洗 PRE-WASH',   color:'#1976d2' },
            mainwash: { text:'主洗 MAIN WASH',  color:'#0288d1' },
            rinse:    { text:`漂洗 RINSE ${this._rinseCount}/${this._programs[this._program]?.rinseN||0}`, color:'#00838f' },
            spin:     { text:'脱水 SPIN',       color:'#6a1b9a' },
            dry:      { text:'烘干 DRY',        color:'#e65100' },
            done:     { text:'完成 DONE ✓',     color:'#2e7d32' },
        };
        const info = phaseInfo[ph] || { text: ph, color: '#888' };

        // 阶段标签（门玻璃上方）
        this._dynGroup.add(new Konva.Text({
            x: cx - 60, y: cy - r - 20,
            text: info.text,
            fontSize: 11, fontStyle: 'bold',
            fill: info.color,
            width: 120, align: 'center',
        }));

        // 阶段进度弧（滚筒外圈）
        if (ph !== 'idle' && ph !== 'done' && this._phaseTarget > 0) {
            const pct = Math.min(1, this._phaseTimer / this._phaseTarget);
            this._dynGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: r + 6, outerRadius: r + 11,
                angle: pct * 360,
                rotation: -90,
                fill: info.color,
                opacity: 0.7,
            }));
        }

        // 子阶段说明
        if (this._subPhase) {
            const subInfo = {
                fill:    '进水中…', heat: '加热中…',
                wash:    '洗涤中…', drain:'排水中…',
                spinup:  '升速中…', spinhold:'高速脱水…',
                spindown:'减速中…', dryrun:'烘干中…',
                cooldown:'冷却中…',
            };
            this._dynGroup.add(new Konva.Text({
                x: cx - 50, y: cy + r + 14,
                text: subInfo[this._subPhase] || this._subPhase,
                fontSize: 9, fill: '#8899aa',
                width: 100, align: 'center',
            }));
        }

        // 转速与温度显示（滚筒内叠加）
        if (this._motor.rpm > 1) {
            this._dynGroup.add(new Konva.Text({
                x: cx - 28, y: cy - 9,
                text: `${this._motor.rpm.toFixed(0)}rpm`,
                fontSize: 12, fontStyle: 'bold',
                fill: this._motor.rpm > 800
                    ? `rgba(180,150,255,0.85)`
                    : `rgba(180,220,255,0.70)`,
                width: 56, align: 'center',
            }));
        }
        if (this._waterLevel > 2) {
            this._dynGroup.add(new Konva.Text({
                x: cx - 20, y: cy + 6,
                text: `${this._waterTemp.toFixed(0)}℃`,
                fontSize: 10, fontStyle: 'bold',
                fill: this._isHeating
                    ? `rgba(255,140,60,0.85)`
                    : `rgba(100,200,255,0.70)`,
                width: 40, align: 'center',
            }));
        }
    }

    // DD 电机动画
    _drawDDMotorAnim() {
        const mp = this._ddMotorPos;
        if (!mp || this._motor.rpm < 1) return;
        const angle = (this._animFrame * this._motor.rpm / 30) % 360;
        this._dynGroup.add(new Konva.Circle({
            x: mp.x, y: mp.y,
            radius: mp.r * 0.4,
            fill: 'none',
            stroke: `rgba(200,160,80,${0.2 + 0.3 * (this._motor.rpm / 1400)})`,
            strokeWidth: 1.5,
        }));
        // 转子旋转指示
        const ra = angle * Math.PI / 180;
        this._dynGroup.add(new Konva.Line({
            points: [mp.x, mp.y,
                     mp.x + mp.r * 0.35 * Math.cos(ra),
                     mp.y + mp.r * 0.35 * Math.sin(ra)],
            stroke: '#e0b060', strokeWidth: 1.5, lineCap: 'round',
        }));
    }

    // ── 控制面板（右侧）──────────────────────────────
    _drawControlPanel() {
        const L = this._L;
        const px = L.panelX, pw = L.panelW, py = 4, ph = L.H - 8;

        // 面板背景
        this._staticGroup.add(new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#0d1117',
            stroke: '#1c2230', strokeWidth: 1, cornerRadius: 6,
        }));
        this._staticGroup.add(new Konva.Text({
            x: px, y: py + 4, width: pw,
            text: '控 制 面 板', fontSize: 9, fontStyle: 'bold',
            fill: '#3d4a5a', align: 'center',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: px + 4, y: py + 16, width: pw - 8, height: 0.5,
            fill: '#1e2a38',
        }));

        this._panelDyn = new Konva.Group();
        this._staticGroup.add(this._panelDyn);
        this._rebuildPanel();
    }

    _rebuildPanel() {
        this._panelDyn.destroyChildren();
        const L  = this._L;
        const px = L.panelX, pw = L.panelW;
        const py = 4;
        const bW = pw - 8;

        // 工具函数
        const row = (y, label, value, color) => {
            this._panelDyn.add(new Konva.Text({
                x: px + 2, y, width: pw - 4,
                text: label, fontSize: 7.5, fill: '#37474f',
            }));
            this._panelDyn.add(new Konva.Text({
                x: px + 2, y: y + 9, width: pw - 4,
                text: value, fontSize: 8.5, fontStyle: 'bold', fill: color || '#c9d1d9',
            }));
        };
        const bar = (y, pct, color) => {
            this._panelDyn.add(new Konva.Rect({
                x: px + 4, y, width: bW, height: 3,
                fill: '#1a2030', cornerRadius: 1,
            }));
            if (pct > 0) {
                this._panelDyn.add(new Konva.Rect({
                    x: px + 4, y, width: bW * Math.min(1, pct), height: 3,
                    fill: color, cornerRadius: 1,
                }));
            }
        };

        let cy = py + 20;

        // 程序 & 阶段
        row(cy, '当前程序', this._programs[this._program]?.name || this._program, '#58a6ff');
        cy += 20;
        const phaseNames = { idle:'待机',prewash:'预洗',mainwash:'主洗',rinse:'漂洗',spin:'脱水',dry:'烘干',done:'完成' };
        row(cy, '运行阶段', (phaseNames[this._phase]||this._phase) + (this._subPhase ? ' / '+this._subPhase : ''), '#79c0ff');
        cy += 20;

        // 总进度
        row(cy, '阶段进度', `${this._phaseTarget>0 ? (100*this._phaseTimer/this._phaseTarget).toFixed(0) : 0}%`, '#3fb950');
        cy += 10;
        bar(cy, this._phaseTarget > 0 ? this._phaseTimer / this._phaseTarget : 0, '#3fb950');
        cy += 8;

        this._panelDyn.add(new Konva.Line({
            points: [px + 4, cy, px + pw - 4, cy],
            stroke: '#1a2438', strokeWidth: 0.5,
        }));
        cy += 5;

        // DD 电机
        row(cy, 'DD电机转速', `${this._motor.rpm.toFixed(0)} rpm`, '#a78bfa');
        cy += 10;
        bar(cy, this._motor.rpm / 1400, '#7c3aed');
        cy += 8;
        row(cy, '相电流 / 转矩',
            `${this._sensors.current.motorA.toFixed(1)}A  /  ${this._motor.torque.toFixed(1)}N·m`,
            '#60a5fa');
        cy += 18;
        row(cy, '电机状态',
            { stop:'停机', accel:'加速', run:'恒速', decel:'减速', brake:'制动' }[this._motor.state] || this._motor.state,
            this._motor.state === 'run' ? '#34d399' : this._motor.state === 'accel' ? '#fbbf24' : '#9ca3af');
        cy += 18;

        this._panelDyn.add(new Konva.Line({
            points: [px + 4, cy, px + pw - 4, cy],
            stroke: '#1a2438', strokeWidth: 0.5,
        }));
        cy += 5;

        // 传感器组
        const srow = (y, sym, label, val, unit, color) => {
            this._panelDyn.add(new Konva.Circle({
                x: px + 7, y: y + 5, radius: 3,
                fill: color, shadowColor: color, shadowBlur: 3, shadowOpacity: 0.7,
            }));
            this._panelDyn.add(new Konva.Text({
                x: px + 12, y, width: pw - 16,
                text: `${label}: ${val} ${unit}`,
                fontSize: 8, fill: color,
            }));
        };

        srow(cy, 'P', '压力/水位', this._sensors.pressure.waterLevel.toFixed(1), 'cm', '#ff9800'); cy += 13;
        srow(cy, 'T', 'NTC水温',   this._sensors.ntc.tempC.toFixed(1),            '℃', '#f44336'); cy += 13;
        srow(cy, 'A', 'MEMS振动',  this._sensors.accel.rms.toFixed(3),            'g',  '#9c27b0'); cy += 13;
        srow(cy, 'I', '电流霍尔',  this._sensors.current.motorA.toFixed(1),       'A',  '#2196f3'); cy += 13;
        srow(cy, 'D', '门锁状态',  this._sensors.doorLock.lockState,              '',   '#4caf50'); cy += 13;
        srow(cy, 'L', '光电泡沫',  this._sensors.photo.foamLevel,                 `(${this._sensors.photo.foamPct.toFixed(0)}%)`, '#ffc107'); cy += 13;
        srow(cy, 'W', '应变称重',  this._sensors.strain.weightKg.toFixed(2),      'kg', '#00bcd4'); cy += 15;

        this._panelDyn.add(new Konva.Line({
            points: [px + 4, cy, px + pw - 4, cy],
            stroke: '#1a2438', strokeWidth: 0.5,
        }));
        cy += 5;

        // 阀与执行机构
        const aRow = (y, label, active, color) => {
            this._panelDyn.add(new Konva.Rect({
                x: px + 4, y, width: pw - 8, height: 11,
                fill: active ? color + '22' : 'transparent',
                cornerRadius: 2,
            }));
            this._panelDyn.add(new Konva.Circle({
                x: px + 9, y: y + 5.5, radius: 3,
                fill: active ? color : '#1e2838',
                stroke: color, strokeWidth: 0.8,
                shadowColor: active ? color : 'transparent',
                shadowBlur: active ? 4 : 0,
            }));
            this._panelDyn.add(new Konva.Text({
                x: px + 14, y: y + 1,
                text: label + (active ? '  ◀ ON' : '  OFF'),
                fontSize: 8, fill: active ? color : '#37474f',
                fontStyle: active ? 'bold' : 'normal',
            }));
        };

        aRow(cy,     '进水阀 SV1',    this._valveIn,    '#58a6ff'); cy += 13;
        aRow(cy,     '排水泵 PUMP',   this._valveDrain, '#34d399'); cy += 13;
        aRow(cy,     '加热管 HEATER', this._isHeating,  '#f97316'); cy += 13;
        aRow(cy,     '烘干风机 FAN',  this._fanOn,      '#e879f9'); cy += 13;

        this._panelDyn.add(new Konva.Line({
            points: [px + 4, cy, px + pw - 4, cy],
            stroke: '#1a2438', strokeWidth: 0.5,
        }));
        cy += 5;

        // 报警
        const almRow = (y, label, active, color) => {
            this._panelDyn.add(new Konva.Circle({
                x: px + 7, y: y + 5, radius: 3,
                fill: active ? color : '#1a2030',
                stroke: active ? color : '#2a3040',
                shadowColor: active ? color : 'transparent',
                shadowBlur: active ? 5 : 0,
            }));
            this._panelDyn.add(new Konva.Text({
                x: px + 12, y, width: pw - 16,
                text: label,
                fontSize: 7.5,
                fill: active ? color : '#2a3848',
                fontStyle: active ? 'bold' : 'normal',
            }));
        };

        const alms = this._alarms;
        almRow(cy, '过流保护',   alms.overCurrent,   '#f85149'); cy += 12;
        almRow(cy, '振动报警',   alms.overVibration, '#f97316'); cy += 12;
        almRow(cy, '泡沫溢出',   alms.foamOverflow,  '#fbbf24'); cy += 12;
        almRow(cy, '门未关闭',   alms.doorOpen,      '#60a5fa'); cy += 12;
        almRow(cy, '衣物不平衡', alms.unbalanced,    '#a78bfa'); cy += 12;
    }

    // ── 标签 ─────────────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 0, width: this._L.bodyW,
            text: `${this.label}  DD直驱全自动洗衣机仿真`,
            fontSize: 9, fontStyle: 'bold', fill: '#3d4a5a', align: 'center',
        }));
    }

    // ── 交互 ─────────────────────────────────────────
    _bindInteraction() {
        const L = this._L;
        // 点击门把手区域：开/关门
        const doorHit = new Konva.Rect({
            x: L.drumCX + L.drumR + 5, y: L.drumCY - 18,
            width: 18, height: 36,
            fill: 'transparent', listening: true,
        });
        doorHit.on('click tap', () => {
            if (!this._running || this._phase === 'idle' || this._phase === 'done') {
                const ds = this._sensors.doorLock;
                ds.doorOpen = !ds.doorOpen;
                if (!ds.doorOpen) {
                    ds.locked = false;
                    ds.lockState = 'unlocked';
                } else {
                    ds.locked = false;
                    ds.lockState = 'open';
                }
                this._rebuildDyn();
                this._rebuildPanel();
            }
        });
        this._interactGroup.add(doorHit);
    }

    // ════════════════════════════════════════════════════
    // 核心 tick（由 sys._tickAll 约 20fps 调用）
    // ════════════════════════════════════════════════════
    tick(dt) {
        if (!this._running || this._paused) {
            this._animFrame = (this._animFrame || 0) + 1;
            this._tickMotor(dt * this._simSpeed);
            this._tickSensors();
            this._rebuildDyn();
            this._rebuildPanel();
            this._refreshCache();
            return;
        }

        const sdt = dt * this._simSpeed;
        this._simTime      += sdt;
        this._phaseTimer   += sdt;
        this._animFrame     = (this._animFrame || 0) + 1;

        this._tickStateMachine(sdt);
        this._tickMotor(sdt);
        this._tickWater(sdt);
        this._tickTemperature(sdt);
        this._tickFoam(sdt);
        this._tickSensors();
        this._tickAlarms();
        this._updateDrum(dt);

        if (this._animFrame % 4 === 0) this._pushHistory();

        this._rebuildDyn();
        this._rebuildPanel();
        this._refreshCache();
    }

    _animFrame = 0;

    // ── 状态机 ──────────────────────────────────────
    _tickStateMachine(dt) {
        const prog = this._programs[this._program] || this._programs.cotton;

        switch (this._phase) {
            case 'idle': break;

            case 'prewash':
                this._doWashPhase(dt, 20, 40, prog.washTime * 0.3);
                break;

            case 'mainwash':
                this._doWashPhase(dt, this._washTemp, 50, prog.washTime);
                break;

            case 'rinse':
                this._doWashPhase(dt, 20, 45, prog.washTime * 0.4);
                if (this._phaseTimer >= this._phaseTarget) {
                    this._rinseCount++;
                    if (this._rinseCount < prog.rinseN) {
                        this._enterPhase('rinse');
                    } else {
                        this._enterPhase('spin');
                    }
                }
                return;

            case 'spin':
                this._doSpinPhase(dt, prog.spinRpm);
                break;

            case 'dry':
                this._doDryPhase(dt);
                break;

            case 'done':
                if (this._motor.state !== 'stop') this._motor.targetRpm = 0;
                break;
        }

        // 阶段超时推进
        if (this._phaseTarget > 0 && this._phaseTimer >= this._phaseTarget) {
            this._advancePhase(prog);
        }
    }

    _doWashPhase(dt, targetTemp, maxRpm, totalTime) {
        this._phaseTarget = totalTime;
        const elapsed = this._phaseTimer;

        // 子阶段：进水
        if (elapsed < totalTime * 0.12) {
            this._subPhase = 'fill';
            this._valveIn   = true;
            this._valveDrain = false;
            const wl = this._programs[this._program]?.washTemp > 0
                ? this._clothWeight * 3.5 + 8
                : this._clothWeight * 3.0 + 6;
            this._targetWaterLevel = Math.min(40, wl);
            this._motor.targetRpm  = 0;
        }
        // 子阶段：加热
        else if (elapsed < totalTime * 0.25 && this._waterTemp < targetTemp - 2) {
            this._subPhase = 'heat';
            this._valveIn  = false;
            this._isHeating = (targetTemp > 25);
            this._motor.targetRpm = 20;
        }
        // 子阶段：洗涤（正反转）
        else if (elapsed < totalTime * 0.85) {
            this._subPhase = 'wash';
            this._isHeating = this._waterTemp < targetTemp - 1;
            this._valveIn   = false;
            // 正反转逻辑
            this._motor.dirTimer -= dt;
            if (this._motor.dirTimer <= 0) {
                this._motor.direction *= -1;
                this._motor.dirTimer   = 15; // 每15s切换方向
            }
            this._motor.targetRpm = maxRpm;
        }
        // 子阶段：排水
        else {
            this._subPhase    = 'drain';
            this._isHeating   = false;
            this._valveDrain  = true;
            this._valveIn     = false;
            this._motor.targetRpm = 30; // 排水时低速辅助甩水
            this._targetWaterLevel = 0;
        }
    }

    _doSpinPhase(dt, maxRpm) {
        this._phaseTarget = 240; // 4分钟脱水
        const elapsed = this._phaseTimer;
        this._valveDrain = true; // 脱水始终排水

        if (elapsed < 20) {
            this._subPhase = 'spinup';
            this._motor.targetRpm = maxRpm * 0.3;
            // 检查平衡
            if (this._sensors.accel.rms > 1.5) {
                this._alarms.unbalanced = true;
                this._motor.targetRpm = 0;
            }
        } else if (elapsed < 30) {
            this._subPhase = 'spinup';
            this._motor.targetRpm = maxRpm * 0.6;
        } else if (elapsed < 180) {
            this._subPhase = 'spinhold';
            this._motor.targetRpm = maxRpm;
            this._alarms.unbalanced = false;
        } else {
            this._subPhase = 'spindown';
            this._motor.targetRpm = 0;
        }
    }

    _doDryPhase(dt) {
        this._phaseTarget = 3600; // 60分钟烘干（仿真秒）
        const elapsed = this._phaseTimer;
        this._fanOn = true;
        this._motor.targetRpm = 40; // 低速滚动翻动衣物

        if (elapsed < 60) {
            this._subPhase = 'dryrun';
            this._isHeating = true;
        } else if (elapsed < 3500) {
            this._subPhase = 'dryrun';
            this._isHeating = this._waterTemp < 65;
        } else {
            this._subPhase = 'cooldown';
            this._isHeating = false;
        }
    }

    _advancePhase(prog) {
        const seq = this._buildSeq(prog);
        const idx = seq.indexOf(this._phase);
        const next = seq[idx + 1];
        if (next) {
            this._enterPhase(next);
        } else {
            this._enterPhase('done');
        }
    }

    _buildSeq(prog) {
        const s = [];
        if (prog.prewash) s.push('prewash');
        s.push('mainwash');
        if (prog.rinseN > 0) s.push('rinse');
        s.push('spin');
        if (prog.dry) s.push('dry');
        return s;
    }

    _enterPhase(phase) {
        this._phase      = phase;
        this._phaseTimer = 0;
        this._subPhase   = '';

        // 阶段初始化
        if (phase === 'spin' || phase === 'done') {
            this._isHeating = false;
            this._valveIn   = false;
        }
        if (phase === 'done') {
            this._running     = false;
            this._valveDrain  = false;
            this._fanOn       = false;
            this._motor.targetRpm = 0;
            this._sensors.doorLock.locked = false;
            this._sensors.doorLock.lockState = 'unlocked';
        }
        if (phase === 'rinse') {
            this._targetWaterLevel = 0;
        }
    }

    // ── 电机仿真 ─────────────────────────────────────
    _tickMotor(dt) {
        const m = this._motor;
        const err = m.targetRpm - m.rpm;

        if (Math.abs(err) < 0.5) {
            m.rpm   = m.targetRpm;
            m.state = m.rpm < 1 ? 'stop' : 'run';
        } else if (err > 0) {
            m.rpm  += m.accelRate * dt;
            m.rpm   = Math.min(m.rpm, m.targetRpm);
            m.state = 'accel';
        } else {
            m.rpm  -= m.decelRate * dt;
            m.rpm   = Math.max(m.rpm, m.targetRpm);
            m.state = m.rpm < 1 ? 'stop' : 'decel';
        }
        m.rpm = Math.max(0, m.rpm);

        // 转矩（低速大转矩特性）
        const load = (this._clothWeight / 10) + (this._waterLevel / 40) * 0.5;
        m.torque  = m.rpm < 100
            ? (15 * load + m.rpm * 0.02)
            : (5 * load + m.rpm * 0.004);
        m.power   = m.torque * m.rpm * Math.PI / 30; // W
        m.current = m.rpm > 0 ? Math.min(50, m.power / 220) : 0;
        m.peakCurrent = Math.max(m.peakCurrent, m.current);

        // 编码器角度
        m.encAngle = (m.encAngle + m.direction * m.rpm / 60 * 360 * dt) % 360;
    }

    _updateDrum(realDt) {
        this._drumAngle = (this._drumAngle + this._motor.direction * this._motor.rpm / 60 * 360 * realDt * this._simSpeed) % 360;
    }

    // ── 水位仿真 ─────────────────────────────────────
    _tickWater(dt) {
        const fill_rate  = 1.5; // cm/s
        const drain_rate = 2.5; // cm/s

        if (this._valveIn && this._waterLevel < this._targetWaterLevel) {
            this._waterLevel = Math.min(
                this._targetWaterLevel,
                this._waterLevel + fill_rate * dt
            );
        }
        if (this._valveDrain && this._waterLevel > 0) {
            this._waterLevel = Math.max(0, this._waterLevel - drain_rate * dt);
            if (this._waterLevel <= 0) this._valveDrain = false;
        }
        if (!this._valveIn && !this._valveDrain) {
            // 自然蒸发（烘干时加快）
            const evap = this._fanOn ? 0.005 : 0.0005;
            this._waterLevel = Math.max(0, this._waterLevel - evap * dt);
        }
    }

    // ── 温度仿真 ─────────────────────────────────────
    _tickTemperature(dt) {
        const ambient = 20;
        const heaterPower = 2000; // W
        const thermalMass = 8000; // J/K（水 + 滚筒）

        if (this._isHeating && this._waterLevel > 5) {
            this._waterTemp += (heaterPower / thermalMass) * dt;
        }
        // 自然散热
        this._waterTemp += (ambient - this._waterTemp) * 0.001 * dt;
        this._waterTemp  = Math.max(ambient, Math.min(95, this._waterTemp));

        // 无水时快速冷却
        if (this._waterLevel < 2) {
            this._waterTemp += (ambient - this._waterTemp) * 0.02 * dt;
        }
    }

    // ── 泡沫仿真 ──────────────────────────────────────
    _tickFoam(dt) {
        if (this._subPhase === 'wash' && this._waterLevel > 5) {
            const foamGen = 0.002 * dt * (this._motor.rpm / 50);
            this._foamLevel = Math.min(1, this._foamLevel + foamGen);
        } else if (this._subPhase === 'drain' || this._subPhase === 'fill') {
            this._foamLevel = Math.max(0, this._foamLevel - 0.005 * dt);
        } else {
            this._foamLevel = Math.max(0, this._foamLevel - 0.001 * dt);
        }
        // 泡沫过多时暂停洗涤
        if (this._foamLevel > 0.88 && this._subPhase === 'wash') {
            this._alarms.foamOverflow = true;
            this._motor.targetRpm = 0;
            this._valveDrain = true; // 排水去泡沫
        } else if (this._foamLevel < 0.5) {
            this._alarms.foamOverflow = false;
        }
    }

    // ── 传感器更新 ────────────────────────────────────
    _tickSensors() {
        const noise = (n) => (Math.random() - 0.5) * n;

        // 压力传感器（压阻效应）
        // P = ρgh = 1000 × 9.8 × h(m) Pa
        const pressurePa = 1000 * 9.8 * (this._waterLevel / 100);
        const pressureVoltage = 0.5 + (pressurePa / 3000) * 3.5 + noise(0.01); // 0.5~4.0V
        this._sensors.pressure = {
            raw:        Math.round(pressureVoltage / 5 * 4095), // 12-bit ADC
            voltage:    pressureVoltage,
            waterLevel: this._waterLevel + noise(0.3),
            unit: 'cm', ok: true,
        };

        // NTC 热敏电阻
        // R(T) = R25 × exp[B × (1/T - 1/T25)]，T in Kelvin
        const T_K   = this._waterTemp + 273.15;
        const T25_K = 298.15;
        const B     = 3950;
        const R_NTC = 10000 * Math.exp(B * (1 / T_K - 1 / T25_K));
        this._sensors.ntc = {
            resistance: R_NTC + noise(R_NTC * 0.002),
            tempC:      this._waterTemp + noise(0.3),
            unit: '℃', ok: true,
        };

        // MEMS 加速度计（电容式）
        const baseVib = this._motor.rpm > 0
            ? (this._motor.rpm / 1400) * 0.8 + this._clothWeight * 0.04
            : 0;
        const imbalance = this._alarms.unbalanced ? 2.0 : 0;
        const ax = baseVib * 0.3 + imbalance * 0.5 + noise(0.02);
        const ay = baseVib * 0.2 + noise(0.02);
        const az = baseVib * 0.9 + imbalance + noise(0.03);
        const rms = Math.sqrt((ax*ax + ay*ay + az*az) / 3);
        this._sensors.accel = {
            x: ax, y: ay, z: az, rms,
            unit: 'g', ok: true,
        };
        this._vibration = rms;

        // 电流传感器（霍尔 + 分流）
        const motorA = this._motor.current + noise(0.1);
        this._sensors.current = {
            hall:   motorA + noise(0.05),    // 霍尔法
            shunt:  motorA + noise(0.08),    // 分流电阻法（稍大噪声）
            motorA: motorA,
            unit: 'A', ok: true,
        };

        // 门锁开关（机械触点）
        const dl  = this._sensors.doorLock;
        if (this._running && !dl.doorOpen) {
            dl.locked    = true;
            dl.lockState = 'locked';
        } else if (!this._running && dl.locked) {
            // 解锁条件：水温<45℃ 且 转速<60rpm
            if (this._waterTemp < 45 && this._motor.rpm < 60) {
                dl.locked    = false;
                dl.lockState = 'unlocked';
            }
        }

        // 光电传感器（泡沫检测，850nm 红外反射）
        const foamPct = this._foamLevel * 100;
        const foamLevelStr = foamPct < 15 ? 'none'
                           : foamPct < 35 ? 'low'
                           : foamPct < 60 ? 'medium'
                           : foamPct < 85 ? 'high'
                           : 'overflow';
        this._sensors.photo = {
            adcRaw:    Math.round((1 - this._foamLevel * 0.9) * 4095), // 反射光量：泡沫越多越少
            foamLevel: foamLevelStr,
            foamPct:   foamPct + noise(0.5),
            ok: true,
        };

        // 应变片（惠斯通全桥，电阻应变效应）
        // V_out = V_exc × GF × ε / 4（全桥）
        const V_exc = 5.0;
        const GF    = 2.1; // 灵敏系数
        const strain_eps = this._clothWeight / 15 * 500e-6; // 应变量（με）
        const bridgeV = V_exc * GF * strain_eps / 4 + noise(0.00005);
        this._sensors.strain = {
            bridgeVoltage: bridgeV,
            weightKg:      this._clothWeight + noise(0.05),
            unit: 'kg',
            measured:      this._sensors.strain.measured,
            ok: true,
        };
    }

    // ── 报警逻辑 ──────────────────────────────────────
    _tickAlarms() {
        this._alarms.overCurrent  = this._sensors.current.motorA > 42;
        this._alarms.overVibration = this._sensors.accel.rms > 2.5;
        this._alarms.doorOpen     = this._running && this._sensors.doorLock.doorOpen;

        // 过流停机
        if (this._alarms.overCurrent) {
            this._motor.targetRpm = 0;
        }
        // 振动停机（高速时）
        if (this._alarms.overVibration && this._motor.rpm > 400) {
            this._motor.targetRpm = Math.min(this._motor.targetRpm, 200);
        }
    }

    // ── 历史数据 ───────────────────────────────────────
    _pushHistory() {
        const max = this._history.maxLen;
        const push = (k, v) => {
            this._history[k].push(v);
            if (this._history[k].length > max) this._history[k].shift();
        };
        push('rpm',        this._motor.rpm);
        push('temp',       this._waterTemp);
        push('waterLevel', this._waterLevel);
        push('current',    this._motor.current);
    }

    // ════════════════════════════════════════════════════
    // 公开 API
    // ════════════════════════════════════════════════════

    /** 启动洗涤程序 */
    start(clothWeightKg) {
        if (this._running) return;
        if (this._sensors.doorLock.doorOpen) return; // 门未关

        this._clothWeight = Math.max(0.5, Math.min(15, clothWeightKg ?? this._clothWeight));
        this._sensors.strain.weightKg    = this._clothWeight;
        this._sensors.strain.measured    = true;
        this._sensors.doorLock.locked    = true;
        this._sensors.doorLock.lockState = 'locked';

        const prog = this._programs[this._program] || this._programs.cotton;
        this._washTemp  = prog.washTemp;
        this._spinSpeed = prog.spinRpm;
        this._running   = true;
        this._paused    = false;
        this._rinseCount = 0;
        this._simTime    = 0;

        const seq = this._buildSeq(prog);
        this._enterPhase(seq[0] || 'mainwash');
    }

    /** 暂停 */
    pause() { this._paused = !this._paused; }

    /** 停止（紧急）*/
    stop() {
        this._running     = false;
        this._paused      = false;
        this._phase       = 'idle';
        this._subPhase    = '';
        this._motor.targetRpm = 0;
        this._isHeating   = false;
        this._valveIn     = false;
        this._valveDrain  = true; // 紧急排水
        this._fanOn       = false;
        Object.keys(this._alarms).forEach(k => this._alarms[k] = false);
    }

    /** 设置程序 */
    setProgram(prog) {
        if (!this._running) {
            this._program = Object.keys(this._programs).includes(prog) ? prog : this._program;
        }
    }

    /** 手动设置衣物重量（称重功能）*/
    setClothWeight(kg) {
        this._clothWeight = Math.max(0, Math.min(15, kg));
        this._sensors.strain.weightKg = this._clothWeight;
    }

    /** 设置仿真加速倍率 */
    setSimSpeed(s) { this._simSpeed = Math.max(1, Math.min(3600, s)); }

    /** 打开/关闭舱门（非运行时）*/
    toggleDoor() {
        if (this._running && this._sensors.doorLock.locked) return;
        const dl = this._sensors.doorLock;
        dl.doorOpen = !dl.doorOpen;
        dl.lockState = dl.doorOpen ? 'open' : 'unlocked';
    }

    /** 清除报警 */
    clearAlarms() { Object.keys(this._alarms).forEach(k => this._alarms[k] = false); }

    /** 获取完整状态快照 */
    getState() {
        return {
            phase:       this._phase,
            subPhase:    this._subPhase,
            running:     this._running,
            simTime:     this._simTime,
            motor: {
                rpm:      this._motor.rpm,
                current:  this._motor.current,
                torque:   this._motor.torque,
                state:    this._motor.state,
            },
            sensors:     { ...this._sensors },
            waterLevel:  this._waterLevel,
            waterTemp:   this._waterTemp,
            foamLevel:   this._foamLevel,
            clothWeight: this._clothWeight,
            alarms:      { ...this._alarms },
        };
    }

    isRunning()    { return this._running; }
    getAlarms()    { return { ...this._alarms }; }
    getHistory()   { return { ...this._history }; }
    getMotorRpm()  { return this._motor.rpm; }
    getWaterTemp() { return this._waterTemp; }

    // ════════════════════════════════════════════════════
    update(state) {
        if (typeof state === 'object') {
            if (state.program     !== undefined) this.setProgram(state.program);
            if (state.simSpeed    !== undefined) this.setSimSpeed(state.simSpeed);
            if (state.clothWeight !== undefined) this.setClothWeight(state.clothWeight);
            if (state.start       === true)      this.start();
            if (state.stop        === true)      this.stop();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',       type: 'text'   },
            { label: '洗涤程序',           key: 'program',     type: 'text',  hint:'cotton/synthetic/delicate/quick/spin/cotton_dry' },
            { label: '洗涤温度 (℃)',       key: 'washTemp',    type: 'number' },
            { label: '脱水转速 (rpm)',      key: 'spinSpeed',   type: 'number' },
            { label: '衣物重量 (kg)',       key: 'clothWeight', type: 'number' },
            { label: '仿真加速倍率',        key: 'simSpeed',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)       this.label = cfg.label;
        if (cfg.program)     this.setProgram(cfg.program);
        if (cfg.washTemp     !== undefined) this._washTemp  = parseFloat(cfg.washTemp);
        if (cfg.spinSpeed    !== undefined) this._spinSpeed = parseFloat(cfg.spinSpeed);
        if (cfg.clothWeight  !== undefined) this.setClothWeight(parseFloat(cfg.clothWeight));
        if (cfg.simSpeed     !== undefined) this.setSimSpeed(parseFloat(cfg.simSpeed));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        this._dynGroup?.destroy();
        this._panelDyn?.destroy();
        super.destroy?.();
    }
}
