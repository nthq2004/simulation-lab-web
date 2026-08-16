import { BaseComponent } from './BaseComponent.js';

/**
 * 电动执行机构完整仿真组件
 * （Electric Actuator — Full Assembly Simulation）
 *
 * ── 六大子系统 ────────────────────────────────────────────────
 *
 *  ① 电机（Motor）          — 三相异步电动机，驱动整个执行链
 *  ② 减速机构（Gearbox）    — 多级行星齿轮减速，扭矩放大
 *  ③ 位置反馈（Feedback）   — 多圈电位器 / 编码器，输出 4~20mA
 *  ④ 控制单元（Control）    — 伺服放大器，PID 闭环调节
 *  ⑤ 输出机构（Output）     — 角行程输出轴 + 阀杆/碟板
 *  ⑥ 保护装置（Protection） — 过力矩、限位、缺相、热保护
 *
 * ── 整机布局（纵向剖面视图）──────────────────────────────────
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  ④ 控制单元（顶部面板）— LED / 数显 / 按键 / 表盘        │
 *  ├─────────────────────────────────────────────────────────┤
 *  │  ① 电机腔（Motor Chamber）                               │
 *  │     三相异步电机示意：定子绕组 + 转子 + 风叶             │
 *  │     动画：通电时转子旋转，风叶送风                       │
 *  ├────────────────────────┬────────────────────────────────┤
 *  │  ② 减速机构腔          │  ⑥ 保护装置腔                  │
 *  │     行星齿轮组示意      │     限位开关 + 力矩保护          │
 *  │     动画：齿轮啮合旋转  │     动画：限位触发指示          │
 *  ├────────────────────────┴────────────────────────────────┤
 *  │  ③ 位置反馈腔                                            │
 *  │     多圈电位器 + 4~20mA 变送器示意                       │
 *  │     动画：指针随开度转动                                  │
 *  ├─────────────────────────────────────────────────────────┤
 *  │  ⑤ 输出机构（Output Shaft）                              │
 *  │     角行程输出轴（0°~90°）+ 蝶阀碟板截面                 │
 *  │     动画：碟板随开度实时旋转                              │
 *  └─────────────────────────────────────────────────────────┘
 *        │端子排─ L1/L2/L3/PE  AI/FB/AO  DO1/DO2  U/V/W │
 *
 * ── 工作原理（完整闭环）──────────────────────────────────────
 *
 *  DCS 给出 4~20mA 指令 → ④ 控制单元接收，换算为 SP（0~100%）
 *  → 与 ③ 位置反馈 PV 比较，计算偏差 e = SP - PV
 *  → |e| > 死区（默认 1%）时：
 *       e > 0 → 控制单元输出正转信号 → ① 电机正转
 *       e < 0 → 控制单元输出反转信号 → ① 电机反转
 *  → ① 电机输出轴旋转 → ② 减速机构减速增矩 → ⑤ 输出轴转动
 *  → ⑤ 带动阀门/碟板改变开度 → ③ 位置反馈检测新开度 → 闭环
 *  → ⑥ 保护装置全程监测：到位限位、过力矩、缺相、过热
 *  → 到位后：电机停机，⑥ 限位开关触发，④ 输出 DO 信号
 *
 * ── 六大子系统详细说明 ───────────────────────────────────────
 *
 *  ① 电机（Motor）
 *     - 类型：三相鼠笼式异步电动机（TEFC 全封闭风冷）
 *     - 额定：380VAC / 50Hz，功率 config.motorPower（默认 1.5kW）
 *     - 仿真：定子磁场旋转动画（三相彩色旋转磁场）+ 转子跟随
 *     - 状态：停机（灰）/ 正转（绿色旋转）/ 反转（橙色旋转）/ 故障（红色脉冲）
 *
 *  ② 减速机构（Gearbox）
 *     - 类型：两级行星齿轮减速器，总传动比 config.gearRatio（默认 200:1）
 *     - 结构：太阳轮 + 3×行星轮 + 齿圈（两级串联）
 *     - 仿真：行星齿轮公转 + 自转动画，速度与电机联动
 *     - 扭矩：T_out = T_motor × gearRatio × η（效率默认 0.85）
 *
 *  ③ 位置反馈（Position Feedback）
 *     - 类型：导电塑料多圈电位器 + 4~20mA 变送模块
 *     - 精度：±0.5% FS（仿真精度）
 *     - 仿真：旋转刷臂随实际位置实时更新 + 4~20mA 数值显示
 *     - 输出：4mA = 0%，20mA = 100%，线性关系
 *
 *  ④ 控制单元（Control Unit / Servo Amplifier）
 *     - 功能：信号接收、偏差计算、PID 运算、驱动输出
 *     - 面板：LED 三色指示、开度数显、SP/PV/ERR 显示
 *     - 通讯：4~20mA 模拟量 + 可选 HART/Modbus
 *     - 参数：死区 deadband、全行程时间 fullTravelT
 *
 *  ⑤ 输出机构（Output Mechanism）
 *     - 类型：角行程（0°~90°），配蝶阀/球阀/挡板
 *     - 扭矩：额定输出扭矩 config.torqueNm（默认 100 N·m）
 *     - 仿真：碟阀截面实时旋转，管道流量可视化（流线动画）
 *     - 显示：开度角度（°）+ 等效 Cv 值估算
 *
 *  ⑥ 保护装置（Protection）
 *     - 限位开关：全开（LS_OPEN）/ 全关（LS_CLOSE）机械限位
 *     - 力矩保护：超力矩脱扣（torque > ratedTorque × 1.3 时保护）
 *     - 热保护：电机绕组温度超限（PTC 热敏电阻）
 *     - 缺相保护：三相不平衡检测
 *     - 失电保护：断电维持最后位置（弹簧复位可选）
 *     - 仿真：保护触发时对应指示灯闪烁 + 故障代码显示
 *
 * ── 仿真状态机 ────────────────────────────────────────────────
 *
 *  POWERING  — 上电自检（600ms，所有 LED 循环点亮）
 *  IDLE      — 停机到位（|SP-PV| ≤ deadband，电机停止）
 *  OPENING   — 正向运行（电机正转，开度增大）
 *  CLOSING   — 反向运行（电机反转，开度减小）
 *  FAULT     — 故障停机（电机锁定，故障代码显示）
 *  STALL     — 堵转保护（力矩超限但位置未变化）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  l1 / l2 / l3  — 三相电源输入（380VAC）
 *  pe            — 保护接地
 *  ai_cmd        — 指令输入（4~20mA，来自 DCS）
 *  fb_out        — 位置反馈输出（4~20mA，送往 DCS）
 *  do_open       — 全开限位输出（无源常开触点）
 *  do_close      — 全关限位输出（无源常开触点）
 *  output_shaft  — 输出轴（连接阀门/负载）
 */
export class ElectricActuator extends BaseComponent {

    // ── 状态枚举 ──────────────────────────────
    static STATE = {
        POWERING: 'powering',
        IDLE:     'idle',
        OPENING:  'opening',
        CLOSING:  'closing',
        FAULT:    'fault',
        STALL:    'stall',
    };

    // ── 故障码 ────────────────────────────────
    static FAULT_CODES = {
        PHASE_LOSS:   '缺相保护',
        OVERLOAD:     '过载保护',
        OVER_TORQUE:  '超力矩保护',
        OVER_TEMP:    '过温保护',
        FB_BROKEN:    '反馈断线',
        STALL:        '堵转保护',
    };

    constructor(config, sys) {
        super(config, sys);

        // 整体尺寸（纵向剖面视图，较高）
        this.width  = Math.max(360, config.width  || 480);
        this.height = Math.max(560, config.height || 720);

        this.type    = 'electric_actuator';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──────────────────────────
        this.label        = config.label        || 'EA-100';
        this.motorPower   = config.motorPower   || 1.5;     // kW
        this.supplyV      = config.supplyV      || 380;     // VAC
        this.ratedCurrent = config.ratedCurrent || 3.8;     // A
        this.gearRatio    = config.gearRatio    || 200;     // 传动比
        this.gearEff      = config.gearEff      || 0.85;    // 齿轮效率
        this.torqueNm     = config.torqueNm     || 100;     // N·m 额定输出扭矩
        this.deadband     = config.deadband     || 1.0;     // % 死区
        this.fullTravelT  = config.fullTravelT  || 60;      // s 全行程时间
        this.travelAngle  = config.travelAngle  || 90;      // ° 行程角度

        // ── 控制变量 ──────────────────────────
        this._sp          = config.initSP !== undefined ? +config.initSP : 50.0;
        this._pv          = config.initPV !== undefined ? +config.initPV : 50.0;
        this._pvSmooth    = this._pv;
        this._pvMoveSpd   = 100 / this.fullTravelT;  // %/s
        this._mode        = 'auto';  // 'auto' | 'manual'
        this._state       = ElectricActuator.STATE.POWERING;
        this._faultCode   = null;

        // ── 物理量仿真 ────────────────────────
        this._motorRpm    = 0;       // rpm（仿真）
        this._motorCurrent= 0;       // A
        this._motorTemp   = 25;      // ℃（绕组温度）
        this._outputTorque= 0;       // N·m
        this._outputAngle = (this._pv / 100) * this.travelAngle; // ° 当前角度

        // ── 动画变量 ──────────────────────────
        this._powerT      = 0;
        this._powerDur    = 0.6;
        this._blinkT      = 0;
        this._blinkState  = true;
        this._motorRotT   = 0;       // 电机转子角度
        this._motorRotSpd = 0;       // 旋转速度 rad/s
        this._gearRotT    = [0, 0];  // 两级行星组相位
        this._flowT       = 0;       // 流线动画相位
        this._potAngle    = (this._pv / 100) * 270 - 135; // 电位器刷臂角度

        // ── 保护状态 ──────────────────────────
        this._lsOpen      = this._pv >= 99.5;
        this._lsClose     = this._pv <= 0.5;
        this._torqueTrip  = false;
        this._tempTrip    = false;


        // ── 布局划分（从上到下）──────────────
        const W = this.width, H = this.height;
        const pad = W * 0.04;

        // 外壳总边界
        this._bodyX = pad;
        this._bodyY = H * 0.02;
        this._bodyW = W - pad * 2;
        this._bodyH = H * 0.94;

        // 六个腔室 Y 起点（归一化比例）
        this._zones = {
            control:   { y: 0.000, h: 0.220 },  // ④ 控制单元
            motor:     { y: 0.225, h: 0.180 },  // ① 电机
            gear:      { y: 0.410, h: 0.155 },  // ② 减速机构（左）
            protection:{ y: 0.410, h: 0.155 },  // ⑥ 保护（右）
            feedback:  { y: 0.570, h: 0.130 },  // ③ 位置反馈
            output:    { y: 0.705, h: 0.180 },  // ⑤ 输出机构
            terminal:  { y: 0.890, h: 0.100 },  // 端子排
        };

        this._init();

        // 端口
        this._buildPorts();
    }

    _zoneRect(name) {
        const z = this._zones[name];
        return {
            x: this._bodyX,
            y: this._bodyY + z.y * this._bodyH,
            w: this._bodyW,
            h: z.h * this._bodyH,
        };
    }

    _zoneRectHalf(name, side) {
        const z = this._zones[name];
        const fullW = this._bodyW;
        return {
            x: side === 'left'  ? this._bodyX : this._bodyX + fullW * 0.52,
            y: this._bodyY + z.y * this._bodyH,
            w: fullW * (side === 'left' ? 0.50 : 0.48),
            h: z.h * this._bodyH,
        };
    }

    _buildPorts() {
        const W = this.width;
        const tz = this._zoneRect('terminal');
        const portY = tz.y + tz.h - 4;
        const defs = [
            { id:'l1',       x: W*0.09 },
            { id:'l2',       x: W*0.16 },
            { id:'l3',       x: W*0.23 },
            { id:'pe',       x: W*0.30 },
            { id:'ai_cmd',   x: W*0.40 },
            { id:'fb_out',   x: W*0.48 },
            { id:'do_open',  x: W*0.58 },
            { id:'do_close', x: W*0.66 },
            { id:'output_shaft', x: W*0.78 },
        ];
        defs.forEach(d => this.addPort(d.x, portY, d.id, 'wire', d.id.toUpperCase()));
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawOuterShell();       // 机壳与铭牌
        this._drawZoneDividers();     // 腔室分隔线
        // 各腔室静态底图
        this._drawControlZone();      // ④ 控制单元
        this._drawMotorZone();        // ① 电机
        this._drawGearZone();         // ② 减速机构
        this._drawProtectionZone();   // ⑥ 保护装置
        this._drawFeedbackZone();     // ③ 位置反馈
        this._drawOutputZone();       // ⑤ 输出机构
        this._drawTerminalZone();     // 端子排
        // 动态层
        this._drawDynMotor();         // 电机动态
        this._drawDynGear();          // 齿轮动态
        this._drawDynFeedback();      // 反馈动态
        this._drawDynOutput();        // 输出动态
        this._drawDynControl();       // 控制单元动态
        this._drawDynProtection();    // 保护动态
        
    }

    // ── 机壳外形与铭牌 ───────────────────────
    _drawOuterShell() {
        const bx = this._bodyX, by = this._bodyY;
        const bw = this._bodyW, bh = this._bodyH;

        // 主体金属机箱
        this._staticGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:bw, y:bh },
            fillLinearGradientColorStops: [
                0,'#3a4048', 0.3,'#2e343c', 0.7,'#282e36', 1,'#32383e'
            ],
            stroke: '#1c2028', strokeWidth: 2,
            cornerRadius: 6,
            shadowColor:'#000', shadowBlur:12, shadowOffsetY:4, shadowOpacity:0.45,
        }));
        // 顶部倒角高光
        this._staticGroup.add(new Konva.Line({
            points:[bx+6,by+1,bx+bw-6,by+1],
            stroke:'rgba(255,255,255,0.18)', strokeWidth:1.5, lineCap:'round',
        }));
        // 四角螺钉
        [[bx+10,by+10],[bx+bw-10,by+10],[bx+10,by+bh-10],[bx+bw-10,by+bh-10]].forEach(([cx,cy])=>{
            this._staticGroup.add(new Konva.Circle({ x:cx,y:cy,radius:5,
                fillLinearGradientStartPoint:{x:-2,y:-2},fillLinearGradientEndPoint:{x:2,y:2},
                fillLinearGradientColorStops:[0,'#606468',1,'#303438'],
                stroke:'#181c20',strokeWidth:0.6 }));
            this._staticGroup.add(new Konva.Line({ points:[cx-3,cy,cx+3,cy],
                stroke:'rgba(0,0,0,0.5)',strokeWidth:1,lineCap:'round'}));
        });
        // 顶部品牌 + 型号
        this._staticGroup.add(new Konva.Text({
            x:0, y:-20, width:this.width,
            text:`${this.label}  电动执行机构  ${this.motorPower}kW / ${this.torqueNm}N·m`,
            fontSize:10, fontStyle:'bold', fill:'#546e7a', align:'center',
        }));
    }

    // ── 腔室分隔线与标签 ─────────────────────
    _drawZoneDividers() {
        const bx = this._bodyX + 6, bw = this._bodyW - 12;
        const labels = [
            { name:'control',    side:'full', label:'④ 控制单元  Control Unit',    color:'#1a3050' },
            { name:'motor',      side:'full', label:'① 电机  Motor',               color:'#1e2a1a' },
            { name:'feedback',   side:'full', label:'③ 位置反馈  Position Feedback',color:'#201a30' },
            { name:'output',     side:'full', label:'⑤ 输出机构  Output Mechanism', color:'#1a2020' },
            { name:'terminal',   side:'full', label:'端子排  Terminal Block',       color:'#141820' },
        ];
        const splitLabels = [
            { name:'gear',       side:'left',  label:'② 减速机构',  color:'#1a2030' },
            { name:'protection', side:'right', label:'⑥ 保护装置',  color:'#2a1a1a' },
        ];

        labels.forEach(({ name, label, color }) => {
            const z = this._zoneRect(name);
            this._staticGroup.add(new Konva.Rect({
                x:bx, y:z.y, width:bw, height:z.h,
                fill:color, stroke:'#283040', strokeWidth:0.8, cornerRadius:2,
            }));
            this._staticGroup.add(new Konva.Text({
                x:bx+6, y:z.y+4, text:label,
                fontSize:8, fontStyle:'bold', fill:'#607888',
            }));
        });

        splitLabels.forEach(({ name, side, label, color }) => {
            const z = this._zoneRectHalf(name, side);
            this._staticGroup.add(new Konva.Rect({
                x:z.x, y:z.y, width:z.w, height:z.h,
                fill:color, stroke:'#283040', strokeWidth:0.8, cornerRadius:2,
            }));
            this._staticGroup.add(new Konva.Text({
                x:z.x+5, y:z.y+4, text:label,
                fontSize:8, fontStyle:'bold', fill:'#607888',
            }));
        });
    }

    // ══════════ ④ 控制单元静态底图 ═══════════
    _drawControlZone() {
        const z = this._zoneRect('control');
        const cx = z.x + z.w/2, cy = z.y + z.h*0.55;
        const W = z.w, bx = z.x;

        // 面板区
        this._staticGroup.add(new Konva.Rect({
            x:bx+8, y:z.y+16, width:W-16, height:z.h-24,
            fill:'#111820', stroke:'#1e2c3a', strokeWidth:0.8, cornerRadius:3,
        }));

        // 表盘背景（小型开度表）
        const mr = Math.min(z.h*0.32, W*0.14);
        const mx = bx + W*0.50, my = z.y + z.h*0.52;
        this._staticGroup.add(new Konva.Circle({
            x:mx, y:my, radius:mr,
            fillRadialGradientStartPoint:{x:0,y:-mr*0.3},fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientStartRadius:0,fillRadialGradientEndRadius:mr,
            fillRadialGradientColorStops:[0,'#1a2830',0.7,'#111e28',1,'#0c1418'],
            stroke:'#2a3848',strokeWidth:1.2,
        }));

        // 表盘刻度
        for (let i=0; i<=10; i++) {
            const a = (-135 + i*27) * Math.PI/180;
            const r0 = i%2===0 ? mr*0.72 : mr*0.80;
            this._staticGroup.add(new Konva.Line({
                points:[mx+r0*Math.cos(a),my+r0*Math.sin(a),mx+mr*0.88*Math.cos(a),my+mr*0.88*Math.sin(a)],
                stroke: i%2===0?'#6090a8':'#304050', strokeWidth:i%2===0?1.2:0.7, lineCap:'round',
            }));
        }
        this._staticGroup.add(new Konva.Text({x:mx-mr,y:my+mr*0.55,text:'CLOSE',fontSize:6.5,fill:'#405868',width:mr,align:'center'}));
        this._staticGroup.add(new Konva.Text({x:mx,y:my+mr*0.55,text:'OPEN',fontSize:6.5,fill:'#405868',width:mr,align:'center'}));

        // 存表盘参数供动态层用
        this._ctrlMX=mx; this._ctrlMY=my; this._ctrlMR=mr;

        // 三个 LED 区（左侧）
        const ledDefs=[
            {id:'pwr',label:'PWR',x:bx+W*0.12,color:'#20e840'},
            {id:'run',label:'RUN',x:bx+W*0.12,yOff:1,color:'#20e840'},
            {id:'flt',label:'FLT',x:bx+W*0.12,yOff:2,color:'#e82020'},
        ];
        const ledY0=z.y+z.h*0.28, ledStep=z.h*0.20;
        this._ctrlLeds={};
        ledDefs.forEach((d,i)=>{
            const lx=bx+W*0.12, ly=ledY0+i*ledStep;
            this._staticGroup.add(new Konva.Circle({x:lx,y:ly,radius:5,
                fillLinearGradientStartPoint:{x:-2,y:-2},fillLinearGradientEndPoint:{x:2,y:2},
                fillLinearGradientColorStops:[0,'#606468',1,'#303438'],
                stroke:'#181c20',strokeWidth:0.8}));
            const led=new Konva.Circle({x:lx,y:ly,radius:4,fill:this._darken(d.color,0.5)});
            this._staticGroup.add(led);
            this._ctrlLeds[d.id]={node:led,onColor:d.color,offColor:this._darken(d.color,0.5)};
            this._staticGroup.add(new Konva.Text({x:lx+7,y:ly-5,text:d.label,fontSize:7.5,fontStyle:'bold',fill:'#50686a'}));
        });

        // 数值显示区（右侧）
        const dispX=bx+W*0.60, dispY=z.y+z.h*0.22, dispW=W*0.32, lineH=z.h*0.17;
        const dispItems=[
            {id:'sp',label:'SP',color:'#20e860'},
            {id:'pv',label:'PV',color:'#20c0ff'},
            {id:'er',label:'ER',color:'#ffa020'},
        ];
        this._ctrlDisplays={};
        dispItems.forEach((d,i)=>{
            this._staticGroup.add(new Konva.Text({x:dispX,y:dispY+i*lineH,text:d.label+':',fontSize:8,fontStyle:'bold',fill:this._darken(d.color,0.2)}));
            const vt=new Konva.Text({x:dispX+22,y:dispY+i*lineH,
                text:'--.-',fontSize:9,fontFamily:'monospace',fontStyle:'bold',fill:d.color,
                shadowColor:d.color,shadowBlur:3,shadowOpacity:0.5,width:dispW-22});
            this._staticGroup.add(vt);
            this._ctrlDisplays[d.id]=vt;
        });

        // 模式/状态文字
        this._ctrlModeText=new Konva.Text({
            x:bx+W*0.22,y:z.y+z.h*0.80,
            text:'AUTO | IDLE', fontSize:8, fontStyle:'bold',
            fill:'#30a860',width:W*0.46,align:'center',
        });
        this._staticGroup.add(this._ctrlModeText);

        // 按键（简化）
        const btnDefs=[{label:'◄',x:bx+W*0.25},{label:'►',x:bx+W*0.72}];
        btnDefs.forEach(({label,x})=>{
            const btn=new Konva.Rect({x:x-14,y:z.y+z.h*0.78,width:28,height:16,
                fill:'#1e3040',stroke:'#2a4060',strokeWidth:0.8,cornerRadius:2});
            this._interactGroup.add(btn);
            this._staticGroup.add(new Konva.Text({x:x-14,y:z.y+z.h*0.782,text:label,
                fontSize:10,fontStyle:'bold',fill:'#6090b0',width:28,align:'center'}));
            btn.on('click tap',()=>this._onPanelClick(label));
            btn.listening(true);
        });
    }

    _onPanelClick(label) {
        if (this._state===ElectricActuator.STATE.FAULT||this._state===ElectricActuator.STATE.POWERING) return;
        if (label==='◄') this._sp=Math.max(0,this._sp-10);
        if (label==='►') this._sp=Math.min(100,this._sp+10);
        this._refreshCache();
    }

    // ══════════ ① 电机静态底图 ═══════════════
    _drawMotorZone() {
        const z = this._zoneRect('motor');
        const cx=z.x+z.w/2, cy=z.y+z.h/2;
        const r=Math.min(z.h*0.42,z.w*0.18);

        // 电机外壳（圆柱端面）
        this._staticGroup.add(new Konva.Ellipse({
            x:cx,y:cy,radiusX:r*1.1,radiusY:r*0.45,
            fill:'#282e30',stroke:'#3a4248',strokeWidth:1.0,
        }));
        this._staticGroup.add(new Konva.Circle({
            x:cx,y:cy,radius:r,
            fillRadialGradientStartPoint:{x:-r*0.2,y:-r*0.2},fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientStartRadius:0,fillRadialGradientEndRadius:r,
            fillRadialGradientColorStops:[0,'#404850',0.6,'#303840',1,'#202830'],
            stroke:'#3a4248',strokeWidth:1.2,
        }));

        // 定子槽（8 个方向）
        for(let i=0;i<8;i++){
            const a=i*Math.PI/4;
            const x0=cx+r*0.55*Math.cos(a),y0=cy+r*0.55*Math.sin(a);
            const x1=cx+r*0.92*Math.cos(a),y1=cy+r*0.92*Math.sin(a);
            this._staticGroup.add(new Konva.Rect({
                x:x0-3,y:y0-3,width:6,height:6,
                fill:'#1a2028',rotation:i*45+45,
                offsetX:3,offsetY:3,
            }));
            const colIdx=i%3;
            const statorColors=['#b03020','#2050c0','#208040'];
            this._staticGroup.add(new Konva.Line({
                points:[x0,y0,x1,y1],
                stroke:statorColors[colIdx],strokeWidth:2.5,lineCap:'round',opacity:0.70,
            }));
        }

        // 转子外圈
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:r*0.48,
            fill:'transparent',stroke:'#506070',strokeWidth:1.0,dash:[3,3]}));

        // 转子铁心
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:r*0.40,
            fillRadialGradientStartPoint:{x:-r*0.1,y:-r*0.1},fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientStartRadius:0,fillRadialGradientEndRadius:r*0.40,
            fillRadialGradientColorStops:[0,'#505860',0.6,'#383e48',1,'#282e38'],
            stroke:'#404850',strokeWidth:0.8}));

        // 轴
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:r*0.08,
            fill:'#a0a8b0',stroke:'#707880',strokeWidth:0.6}));

        // 风叶（右侧）
        const fanX=z.x+z.w*0.82, fanY=cy;
        this._staticGroup.add(new Konva.Circle({x:fanX,y:fanY,radius:r*0.42,
            fill:'#1c2228',stroke:'#2a3240',strokeWidth:0.8}));
        for(let i=0;i<4;i++){
            const fa=i*Math.PI/2;
            this._staticGroup.add(new Konva.Line({
                points:[fanX,fanY,fanX+r*0.38*Math.cos(fa),fanY+r*0.38*Math.sin(fa)],
                stroke:'#404858',strokeWidth:2.5,lineCap:'round',
            }));
        }

        // 参数标注
        this._staticGroup.add(new Konva.Text({x:z.x+z.w*0.04,y:z.y+z.h*0.75,
            text:`${this.motorPower}kW  ${this.supplyV}V  ${this.ratedCurrent}A`,
            fontSize:8,fill:'#506878',fontStyle:'bold'}));

        // 存坐标供动态层
        this._motorCX=cx; this._motorCY=cy; this._motorR=r;
        this._fanCX=fanX; this._fanCY=fanY; this._fanR=r*0.38;
    }

    // ══════════ ② 减速机构静态底图 ══════════
    _drawGearZone() {
        const z=this._zoneRectHalf('gear','left');
        const cx=z.x+z.w*0.50, cy=z.y+z.h*0.54;
        const r=Math.min(z.h*0.36,z.w*0.32);

        // 两级行星齿轮示意（简化侧视）
        const stage=[
            {cx:z.x+z.w*0.30,cy,r:r,label:'第一级'},
            {cx:z.x+z.w*0.74,cy,r:r*0.72,label:'第二级'},
        ];

        stage.forEach(({cx:scx,cy:scy,r:sr,label},si)=>{
            // 齿圈（外环）
            this._staticGroup.add(new Konva.Circle({x:scx,y:scy,radius:sr,
                fill:'transparent',stroke:'#3a5060',strokeWidth:2.5}));
            // 齿圈齿牙
            for(let i=0;i<16;i++){
                const a=i*Math.PI/8;
                this._staticGroup.add(new Konva.Line({
                    points:[scx+(sr-1)*Math.cos(a),scy+(sr-1)*Math.sin(a),
                            scx+(sr+3)*Math.cos(a),scy+(sr+3)*Math.sin(a)],
                    stroke:'#3a5060',strokeWidth:1.5,lineCap:'round',
                }));
            }
            // 太阳轮
            const sunR=sr*0.22;
            this._staticGroup.add(new Konva.Circle({x:scx,y:scy,radius:sunR,
                fillLinearGradientStartPoint:{x:-sunR,y:-sunR},fillLinearGradientEndPoint:{x:sunR,y:sunR},
                fillLinearGradientColorStops:[0,'#607888',1,'#304050'],
                stroke:'#80a0b0',strokeWidth:0.8}));
            // 3 个行星轮
            for(let i=0;i<3;i++){
                const a=i*Math.PI*2/3;
                const pr=sr*0.28, pd=sr*0.60;
                const px=scx+pd*Math.cos(a), py=scy+pd*Math.sin(a);
                this._staticGroup.add(new Konva.Circle({x:px,y:py,radius:pr,
                    fillLinearGradientStartPoint:{x:-pr,y:-pr},fillLinearGradientEndPoint:{x:pr,y:pr},
                    fillLinearGradientColorStops:[0,'#506070',1,'#283038'],
                    stroke:'#607080',strokeWidth:0.8}));
                // 行星轮齿牙（简化）
                for(let j=0;j<8;j++){
                    const ja=j*Math.PI/4;
                    this._staticGroup.add(new Konva.Line({
                        points:[px+(pr-0.5)*Math.cos(ja),py+(pr-0.5)*Math.sin(ja),
                                px+(pr+2)*Math.cos(ja),py+(pr+2)*Math.sin(ja)],
                        stroke:'#607080',strokeWidth:1,lineCap:'round',
                    }));
                }
                this._staticGroup.add(new Konva.Circle({x:px,y:py,radius:2,fill:'#a0b0b8'}));
            }
            // 标注
            this._staticGroup.add(new Konva.Text({x:scx-20,y:scy+sr+6,text:label,
                fontSize:7,fill:'#406070',width:40,align:'center'}));
        });

        // 传动比标注
        this._staticGroup.add(new Konva.Text({x:z.x+3,y:z.y+z.h*0.88,
            text:`i=${this.gearRatio}:1  η=${this.gearEff}`,fontSize:7.5,fill:'#406070',fontStyle:'bold'}));

        this._gearStages=stage;
    }

    // ══════════ ⑥ 保护装置静态底图 ══════════
    _drawProtectionZone() {
        const z=this._zoneRectHalf('protection','right');
        const bx=z.x, by=z.y, bw=z.w, bh=z.h;

        // 四种保护模块背景块
        const items=[
            {id:'ls_open', label:'全开限位\nLS-OPEN',  y:0.10, color:'#203828'},
            {id:'ls_close',label:'全关限位\nLS-CLOSE', y:0.36, color:'#203828'},
            {id:'torque',  label:'力矩保护\nTorque',   y:0.62, color:'#382018'},
            {id:'thermal', label:'热保护\nThermal',    y:0.80, color:'#382818'},
        ];
        this._protItems={};
        items.forEach(({id,label,y:ry,color})=>{
            const iy=by+bh*ry, iw=bw*0.88, ih=bh*0.18;
            const ix=bx+(bw-iw)/2;
            const bg=new Konva.Rect({x:ix,y:iy,width:iw,height:ih,
                fill:color,stroke:'#283040',strokeWidth:0.6,cornerRadius:2});
            this._staticGroup.add(bg);
            const txt=new Konva.Text({x:ix+2,y:iy+2,text:label,
                fontSize:6.5,fill:'#508070',lineHeight:1.3,width:iw*0.55});
            this._staticGroup.add(txt);
            const dot=new Konva.Circle({x:ix+iw*0.80,y:iy+ih*0.5,radius:5,
                fill:'#1a2820',stroke:'#283040',strokeWidth:0.6});
            this._staticGroup.add(dot);
            this._protItems[id]={bg,dot,normalColor:color,
                onColor:id.includes('ls')?'#20c060':'#e82020'};
        });
    }

    // ══════════ ③ 位置反馈静态底图 ══════════
    _drawFeedbackZone() {
        const z=this._zoneRect('feedback');
        const cx=z.x+z.w*0.22, cy=z.y+z.h*0.54;
        const r=Math.min(z.h*0.38,z.w*0.10);

        // 多圈电位器外壳
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:r,
            fillRadialGradientStartPoint:{x:-r*0.2,y:-r*0.2},fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientStartRadius:0,fillRadialGradientEndRadius:r,
            fillRadialGradientColorStops:[0,'#505860',0.6,'#383e48',1,'#282e38'],
            stroke:'#4a5260',strokeWidth:1.2}));
        // 电阻轨道弧
        this._staticGroup.add(new Konva.Arc({x:cx,y:cy,innerRadius:r*0.60,outerRadius:r*0.80,
            angle:270,rotation:-225,fill:'#604020',stroke:'#806040',strokeWidth:0.5}));
        // 电位器轴
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:r*0.15,
            fill:'#909898',stroke:'#707878',strokeWidth:0.6}));

        // 4~20mA 变送模块
        const tmX=z.x+z.w*0.42, tmY=z.y+z.h*0.20;
        const tmW=z.w*0.20, tmH=z.h*0.60;
        this._staticGroup.add(new Konva.Rect({x:tmX,y:tmY,width:tmW,height:tmH,
            fill:'#1a2830',stroke:'#2a3848',strokeWidth:0.8,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:tmX,y:tmY+4,text:'4~20mA\nTX',
            fontSize:7,fill:'#406878',width:tmW,align:'center',lineHeight:1.4}));
        // 芯片
        this._staticGroup.add(new Konva.Rect({x:tmX+tmW*0.20,y:tmY+tmH*0.45,
            width:tmW*0.60,height:tmH*0.30,fill:'#101820',stroke:'#203040',strokeWidth:0.5,cornerRadius:1}));

        // 连接线示意（电位器 → 变送器）
        this._staticGroup.add(new Konva.Line({
            points:[cx+r,cy,tmX,cy],stroke:'#305048',strokeWidth:1.5,lineCap:'round',
        }));

        // 输出信号显示
        this._fbCurrentText=new Konva.Text({
            x:z.x+z.w*0.66,y:z.y+z.h*0.35,
            text:'12.0mA', fontSize:10, fontFamily:'monospace',fontStyle:'bold',
            fill:'#40c0ff',shadowColor:'#40c0ff',shadowBlur:4,shadowOpacity:0.5,
        });
        this._staticGroup.add(this._fbCurrentText);
        this._staticGroup.add(new Konva.Text({x:z.x+z.w*0.66,y:z.y+z.h*0.62,
            text:'PV=50.0%',fontSize:9,fontFamily:'monospace',fill:'#20c0ff',
        }));
        this._fbPvText=new Konva.Text({x:z.x+z.w*0.66,y:z.y+z.h*0.62,
            text:'PV= 50.0%',fontSize:9,fontFamily:'monospace',fill:'#20c0ff'});
        // 替换上面的静态文字：
        this._staticGroup.add(new Konva.Text({x:z.x+z.w*0.66,y:z.y+z.h*0.78,
            text:'0~5V / 4~20mA',fontSize:6.5,fill:'#305878'}));

        // 存坐标
        this._fbCX=cx; this._fbCY=cy; this._fbR=r;
        this._fbTmX=tmX+tmW/2; this._fbTmY=tmY+tmH/2;
    }

    // ══════════ ⑤ 输出机构静态底图 ══════════
    _drawOutputZone() {
        const z=this._zoneRect('output');
        const cx=z.x+z.w*0.50, cy=z.y+z.h*0.50;
        const pipeR=Math.min(z.h*0.40,z.w*0.22);

        // 管道截面（圆环）
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:pipeR,
            fill:'transparent',stroke:'#405870',strokeWidth:pipeR*0.18}));
        // 管道内壁
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:pipeR*0.82,
            fill:'transparent',stroke:'#283848',strokeWidth:1.0}));
        // 管道流体背景
        this._staticGroup.add(new Konva.Circle({x:cx,y:cy,radius:pipeR*0.80,
            fill:'#081828',stroke:'transparent',strokeWidth:0}));

        // 输出轴（左侧连接）
        const shaftX=z.x+z.w*0.20, shaftY=cy;
        this._staticGroup.add(new Konva.Line({
            points:[shaftX,shaftY,cx-pipeR*0.85,shaftY],
            stroke:'#708090',strokeWidth:6,lineCap:'square',
        }));
        // 轴联结法兰
        this._staticGroup.add(new Konva.Rect({x:cx-pipeR-8,y:shaftY-8,width:8,height:16,
            fill:'#607080',stroke:'#405060',strokeWidth:0.8,cornerRadius:1}));

        // 角度刻度环（0°~90°）
        for(let i=0;i<=9;i++){
            const a=(-90+i*10)*Math.PI/180;
            this._staticGroup.add(new Konva.Line({
                points:[cx+(pipeR+2)*Math.cos(a),cy+(pipeR+2)*Math.sin(a),
                        cx+(pipeR+7)*Math.cos(a),cy+(pipeR+7)*Math.sin(a)],
                stroke:i%3===0?'#608090':'#304050',strokeWidth:i%3===0?1.2:0.7,lineCap:'round',
            }));
        }
        this._staticGroup.add(new Konva.Text({x:cx-6,y:cy-pipeR-18,text:'0°',fontSize:7,fill:'#406080',align:'center',width:12}));
        this._staticGroup.add(new Konva.Text({x:cx+pipeR+2,y:cy-6,text:'90°',fontSize:7,fill:'#406080'}));

        // 参数标注
        this._staticGroup.add(new Konva.Text({
            x:z.x+6,y:z.y+z.h*0.85,
            text:`额定扭矩: ${this.torqueNm}N·m  行程: ${this.travelAngle}°`,
            fontSize:8,fill:'#406878',fontStyle:'bold',
        }));

        this._outCX=cx; this._outCY=cy; this._outPipeR=pipeR;
    }

    // ══════════ 端子排静态 ════════════════════
    _drawTerminalZone() {
        const z=this._zoneRect('terminal');
        const W=this.width;
        const by=z.y, bh=z.h;

        const terms=[
            {label:'L1',x:W*0.09,color:'#d02020',desc:'380V'},
            {label:'L2',x:W*0.16,color:'#2050d0',desc:'380V'},
            {label:'L3',x:W*0.23,color:'#c0c020',desc:'380V'},
            {label:'PE',x:W*0.30,color:'#20c020',desc:'GND'},
            {label:'AI+',x:W*0.40,color:'#40c0e0',desc:'CMD'},
            {label:'FB+',x:W*0.48,color:'#c060e0',desc:'POS'},
            {label:'DO1',x:W*0.58,color:'#40e080',desc:'OPEN'},
            {label:'DO2',x:W*0.66,color:'#e08040',desc:'CLOS'},
            {label:'SHF',x:W*0.78,color:'#80c0b0',desc:'SHFT'},
        ];
        terms.forEach(({label,x,color,desc})=>{
            const cy=by+bh*0.38;
            this._staticGroup.add(new Konva.Circle({x,y:cy,radius:bh*0.20,
                fillLinearGradientStartPoint:{x:-3,y:-3},fillLinearGradientEndPoint:{x:3,y:3},
                fillLinearGradientColorStops:[0,'#485060',1,'#282c34'],
                stroke:this._darken(color,0.1),strokeWidth:1.2}));
            this._staticGroup.add(new Konva.Line({points:[x-3,cy,x+3,cy],
                stroke:'rgba(0,0,0,0.5)',strokeWidth:1,lineCap:'round'}));
            this._staticGroup.add(new Konva.Text({x:x-10,y:by+bh*0.62,text:label,
                fontSize:6.5,fontStyle:'bold',fill:'#608090',align:'center',width:20}));
            this._staticGroup.add(new Konva.Text({x:x-10,y:by+bh*0.80,text:desc,
                fontSize:5.5,fill:'#405060',align:'center',width:20}));
        });
    }

    // ══════════ 动态层初始化 ═════════════════

    _drawDynMotor() {
        this._dynMotorGroup=new Konva.Group();
        this._staticGroup.add(this._dynMotorGroup);
    }
    _drawDynGear() {
        this._dynGearGroup=new Konva.Group();
        this._staticGroup.add(this._dynGearGroup);
    }
    _drawDynFeedback() {
        this._dynFbGroup=new Konva.Group();
        this._staticGroup.add(this._dynFbGroup);
    }
    _drawDynOutput() {
        this._dynOutGroup=new Konva.Group();
        this._staticGroup.add(this._dynOutGroup);
    }
    _drawDynControl() {
        this._dynCtrlGroup=new Konva.Group();
        this._staticGroup.add(this._dynCtrlGroup);
        this._rebuildCtrlDynamic();
    }
    _drawDynProtection() {
        this._dynProtGroup=new Konva.Group();
        this._staticGroup.add(this._dynProtGroup);
    }

    // ══════════ 动态重绘方法 ══════════════════

    _rebuildMotorDynamic() {
        this._dynMotorGroup.destroyChildren();
        const cx=this._motorCX, cy=this._motorCY, r=this._motorR;
        const spd=this._motorRotSpd;
        const t=this._motorRotT;
        const isOn=spd>0.1;
        const dir=this._state===ElectricActuator.STATE.OPENING?1:-1;

        // 旋转磁场（三相彩色）
        if(isOn){
            const colors=['#c03030','#3060c0','#30a050'];
            colors.forEach((col,i)=>{
                const phase=t+i*Math.PI*2/3;
                const intensity=0.4+0.4*Math.sin(phase);
                this._dynMotorGroup.add(new Konva.Arc({
                    x:cx,y:cy,innerRadius:r*0.50,outerRadius:r*0.92,
                    angle:70,rotation:(t*180/Math.PI+i*120)*dir,
                    fill:this._rgba(col,intensity*0.55),
                }));
            }); 
        }

        // 转子旋转标记线（4 根）
        for(let i=0;i<4;i++){
            const a=t*dir+i*Math.PI/2;
            const alpha=isOn?(0.3+0.3*Math.abs(Math.sin(a))):0.15;
            this._dynMotorGroup.add(new Konva.Line({
                points:[cx+r*0.12*Math.cos(a),cy+r*0.12*Math.sin(a),
                        cx+r*0.42*Math.cos(a),cy+r*0.42*Math.sin(a)],
                stroke:isOn?(dir>0?'#30e060':'#e07030'):'#404850',
                strokeWidth:2,lineCap:'round',opacity:alpha,
            }));
        }

        // 风叶旋转
        const fx=this._fanCX, fy=this._fanCY, fr=this._fanR;
        for(let i=0;i<4;i++){
            const a=t*dir*1.5+i*Math.PI/2;
            this._dynMotorGroup.add(new Konva.Line({
                points:[fx,fy,fx+fr*Math.cos(a),fy+fr*Math.sin(a)],
                stroke:isOn?'#60a0c0':'#404858',
                strokeWidth:2.5,lineCap:'round',
                opacity:isOn?0.8:0.4,
            }));
        }

        // 热量粒子（运行中从风叶飘出）
        if(isOn&&this._motorTemp>40){
            for(let i=0;i<3;i++){
                const a=(t*3+i*2.1)*dir;
                const d=fr*(1.2+i*0.3);
                const alpha=Math.max(0,(1-i*0.3)*0.4);
                this._dynMotorGroup.add(new Konva.Circle({
                    x:fx+d*Math.cos(a),y:fy+d*Math.sin(a),radius:2,
                    fill:this._rgba('#ff6020',alpha),
                }));
            }
        }

        // 电机参数动态显示
        const z=this._zoneRect('motor');
        this._dynMotorGroup.add(new Konva.Text({
            x:this._motorCX+this._motorR+8,y:z.y+z.h*0.30,
            text:`n: ${Math.round(this._motorRpm)} rpm\nI: ${this._motorCurrent.toFixed(1)} A\nT: ${this._motorTemp.toFixed(0)} °C`,
            fontSize:8,fill:'#508090',lineHeight:1.6,fontFamily:'monospace',
        }));
    }

    _rebuildGearDynamic() {
        this._dynGearGroup.destroyChildren();
        if(!this._gearStages) return;
        const spd=this._motorRotSpd;
        const dir=this._state===ElectricActuator.STATE.OPENING?1:-1;

        this._gearStages.forEach(({cx:scx,cy:scy,r:sr},si)=>{
            const gearSpd=spd/(si+1);
            const t=this._gearRotT[si]||0;
            // 行星轮公转高亮
            for(let i=0;i<3;i++){
                const a=i*Math.PI*2/3+t*dir*0.5;
                const pd=sr*0.60;
                const px=scx+pd*Math.cos(a), py=scy+pd*Math.sin(a);
                const pr=sr*0.28;
                if(spd>0.05){
                    this._dynGearGroup.add(new Konva.Circle({
                        x:px,y:py,radius:pr,
                        fill:'transparent',stroke:dir>0?'#20a060':'#a06020',
                        strokeWidth:1.5,opacity:0.55,
                    }));
                    // 自转方向弧
                    this._dynGearGroup.add(new Konva.Arc({
                        x:px,y:py,innerRadius:pr*0.5,outerRadius:pr*0.90,
                        angle:120,rotation:(-t*dir*180/Math.PI*2+i*120)%360,
                        fill:this._rgba(dir>0?'#20d080':'#d06020',0.35),
                    }));
                }
            }
            // 太阳轮旋转标记
            const sunR=sr*0.22;
            if(spd>0.05){
                const a=t*dir*3;
                this._dynGearGroup.add(new Konva.Line({
                    points:[scx,scy,scx+sunR*0.8*Math.cos(a),scy+sunR*0.8*Math.sin(a)],
                    stroke:'#80b0c0',strokeWidth:2,lineCap:'round',opacity:0.7,
                }));
            }
        });

        // 扭矩显示
        const z=this._zoneRectHalf('gear','left');
        this._dynGearGroup.add(new Konva.Text({
            x:z.x+4,y:z.y+z.h*0.72,
            text:`T: ${this._outputTorque.toFixed(0)} N·m`,
            fontSize:8,fill:'#508090',fontFamily:'monospace',fontStyle:'bold',
        }));
    }

    _rebuildFeedbackDynamic() {
        this._dynFbGroup.destroyChildren();
        const cx=this._fbCX, cy=this._fbCY, r=this._fbR;

        // 刷臂（随 PV 转动）
        const angle=(this._pvSmooth/100)*270-135;
        const a=angle*Math.PI/180;
        const brushLen=r*0.72;
        this._dynFbGroup.add(new Konva.Line({
            points:[cx,cy,cx+brushLen*Math.cos(a),cy+brushLen*Math.sin(a)],
            stroke:'#e0a020',strokeWidth:2,lineCap:'round',
        }));
        this._dynFbGroup.add(new Konva.Circle({
            x:cx+brushLen*Math.cos(a),y:cy+brushLen*Math.sin(a),radius:3,
            fill:'#ffc030',stroke:'#c08010',strokeWidth:0.6,
        }));
        this._dynFbGroup.add(new Konva.Circle({x:cx,y:cy,radius:r*0.10,
            fill:'#c0a060',stroke:'#906030',strokeWidth:0.6}));

        // 变送器指示（小矩形闪光）
        const tmOn=this._state!==ElectricActuator.STATE.POWERING;
        if(tmOn){
            this._dynFbGroup.add(new Konva.Circle({
                x:this._fbTmX,y:this._fbTmY,radius:3,
                fill:'#20c0ff',shadowColor:'#20c0ff',shadowBlur:5,shadowOpacity:0.8,
            }));
        }

        // 更新电流文字
        const ma=(this._pvSmooth/100)*16+4;
        if(this._fbCurrentText){
            this._fbCurrentText.text(`${ma.toFixed(1)} mA`);
        }
        // PV 文字（重新加到动态层以便更新）
        this._dynFbGroup.add(new Konva.Text({
            x:this._fbCX+this._fbR*1.2,y:this._fbCY-4,
            text:`PV=${this._pvSmooth.toFixed(1)}%`,
            fontSize:9,fontFamily:'monospace',fontStyle:'bold',fill:'#20c0ff',
        }));
    }

    _rebuildOutputDynamic() {
        this._dynOutGroup.destroyChildren();
        const cx=this._outCX, cy=this._outCY, r=this._outPipeR;

        // 蝶板（随开度旋转，0%=关=水平，100%=开=垂直）
        const angle=(this._pvSmooth/100)*this.travelAngle;  // 0~90°
        const ra=angle*Math.PI/180;
        const diskLen=r*0.75;

        // 流线（开度越大流线越亮）
        const flowAlpha=this._pvSmooth/100*0.5;
        if(flowAlpha>0.05){
            for(let i=0;i<5;i++){
                const offset=((this._flowT+i*0.2)%1)*r*1.6-r*0.8;
                const lineAlpha=flowAlpha*(1-Math.abs(offset/r)*0.6);
                this._dynOutGroup.add(new Konva.Line({
                    points:[cx-r*0.78,cy+offset,cx+r*0.78,cy+offset],
                    stroke:this._rgba('#2080e0',lineAlpha),
                    strokeWidth:1.5,lineCap:'round',
                }));
            }
        }

        // 碟板
        this._dynOutGroup.add(new Konva.Line({
            points:[
                cx-diskLen*Math.cos(ra)+diskLen*0.18*Math.sin(ra),
                cy-diskLen*Math.sin(ra)-diskLen*0.18*Math.cos(ra),
                cx+diskLen*Math.cos(ra)+diskLen*0.18*Math.sin(ra),
                cy+diskLen*Math.sin(ra)-diskLen*0.18*Math.cos(ra),
                cx+diskLen*Math.cos(ra)-diskLen*0.18*Math.sin(ra),
                cy+diskLen*Math.sin(ra)+diskLen*0.18*Math.cos(ra),
                cx-diskLen*Math.cos(ra)-diskLen*0.18*Math.sin(ra),
                cy-diskLen*Math.sin(ra)+diskLen*0.18*Math.cos(ra),
            ],
            closed:true,
            fillLinearGradientStartPoint:{x:-diskLen,y:0},
            fillLinearGradientEndPoint:  {x: diskLen,y:0},
            fillLinearGradientColorStops:[0,'#506878',0.4,'#708898',0.6,'#809aa8',1,'#506878'],
            stroke:'#8090a0',strokeWidth:1.0,
        }));

        // 阀杆（中心轴穿过碟板）
        this._dynOutGroup.add(new Konva.Line({
            points:[cx,cy-r*0.80,cx,cy+r*0.80],
            stroke:'#a0b0b8',strokeWidth:2.5,lineCap:'round',opacity:0.6,
        }));

        // 角度 + 开度文字
        const z=this._zoneRect('output');
        this._dynOutGroup.add(new Konva.Text({
            x:z.x+z.w*0.73,y:z.y+z.h*0.25,
            text:`${angle.toFixed(1)}°\n${this._pvSmooth.toFixed(1)}%`,
            fontSize:11,fontFamily:'monospace',fontStyle:'bold',
            fill:'#40d0a0',shadowColor:'#40d0a0',shadowBlur:4,shadowOpacity:0.5,
            lineHeight:1.5,
        }));

        // Cv 估算（蝶阀近似：Cv = Cv_max × sin²(θ/2 × π/180)）
        const cvPct=Math.sin(ra/2)*Math.sin(ra/2);
        const cvMax=this.torqueNm*0.8; // 粗略估算
        this._dynOutGroup.add(new Konva.Text({
            x:z.x+z.w*0.73,y:z.y+z.h*0.58,
            text:`Cv≈${(cvMax*cvPct).toFixed(0)}`,
            fontSize:8,fill:'#307080',
        }));
    }

    _rebuildCtrlDynamic() {
        this._dynCtrlGroup.destroyChildren();

        // 更新表盘指针
        if(this._ctrlMX){
            const cx=this._ctrlMX, cy=this._ctrlMY, r=this._ctrlMR;
            const angle=(-135+(this._pvSmooth/100)*270)*Math.PI/180;
            // 指针
            this._dynCtrlGroup.add(new Konva.Line({
                points:[cx+r*0.10*Math.cos(angle+Math.PI),cy+r*0.10*Math.sin(angle+Math.PI),
                        cx+r*0.80*Math.cos(angle),cy+r*0.80*Math.sin(angle)],
                stroke:'#e05020',strokeWidth:2,lineCap:'round',
            }));
            this._dynCtrlGroup.add(new Konva.Circle({x:cx,y:cy,radius:r*0.08,
                fill:'#c0a060',stroke:'#906030',strokeWidth:0.6}));
        }

        // 更新数值显示
        if(this._ctrlDisplays){
            this._ctrlDisplays.sp&&this._ctrlDisplays.sp.text(`${this._sp.toFixed(1).padStart(5)}%`);
            this._ctrlDisplays.pv&&this._ctrlDisplays.pv.text(`${this._pvSmooth.toFixed(1).padStart(5)}%`);
            const er=this._sp-this._pvSmooth;
            this._ctrlDisplays.er&&this._ctrlDisplays.er.text(`${(er>=0?'+':'')}${er.toFixed(1).padStart(5)}%`);
        }

        // 更新模式/状态文字
        if(this._ctrlModeText){
            const stateMap={
                powering:'自检中...',idle:'IDLE 到位',
                opening:'OPENING ►',closing:'◄ CLOSING',
                fault:'⚠ FAULT',stall:'⚠ STALL',
            };
            const s=stateMap[this._state]||this._state.toUpperCase();
            const col=this._state===ElectricActuator.STATE.FAULT||this._state===ElectricActuator.STATE.STALL
                ?'#e04030':(this._state===ElectricActuator.STATE.IDLE?'#30a860':'#20c0e0');
            this._ctrlModeText.text(`${this._mode.toUpperCase()} | ${s}`);
            this._ctrlModeText.fill(col);
        }
    }

    _rebuildProtectionDynamic() {
        this._dynProtGroup.destroyChildren();
        if(!this._protItems) return;

        const setState=(id,active,blink)=>{
            const item=this._protItems[id];
            if(!item) return;
            const showActive=active&&(blink?this._blinkState:true);
            item.dot.fill(showActive?item.onColor:'#1a2820');
            if(showActive){
                item.dot.shadowColor(item.onColor);
                item.dot.shadowBlur(6);
                item.dot.shadowOpacity(0.9);
            } else {
                item.dot.shadowBlur(0);
            }
        };

        setState('ls_open',  this._lsOpen,   false);
        setState('ls_close', this._lsClose,  false);
        setState('torque',   this._torqueTrip,true);
        setState('thermal',  this._tempTrip,  true);

        // 故障代码显示
        if(this._faultCode){
            const z=this._zoneRectHalf('protection','right');
            this._dynProtGroup.add(new Konva.Text({
                x:z.x+4,y:z.y+z.h*0.85,
                text:`ERR: ${ElectricActuator.FAULT_CODES[this._faultCode]||this._faultCode}`,
                fontSize:7,fill:this._blinkState?'#e03020':'#602010',fontStyle:'bold',
            }));
        }
    }

    _updateLeds() {
        if(!this._ctrlLeds) return;
        const s=this._state;
        const isPow=s===ElectricActuator.STATE.POWERING;
        const isRun=s===ElectricActuator.STATE.OPENING||s===ElectricActuator.STATE.CLOSING;
        const isFlt=s===ElectricActuator.STATE.FAULT||s===ElectricActuator.STATE.STALL;

        const setLed=(id,on,color)=>{
            const led=this._ctrlLeds[id];
            if(!led) return;
            if(on){
                led.node.fill(color);
                led.node.shadowColor(color);
                led.node.shadowBlur(8);
                led.node.shadowOpacity(0.9);
            } else {
                led.node.fill(led.offColor);
                led.node.shadowBlur(0);
            }
        };
        setLed('pwr', isPow?this._blinkState:(!isFlt), '#20e840');
        setLed('run', isPow?this._blinkState:(isRun?this._blinkState:false), '#20e840');
        setLed('flt', isFlt?this._blinkState:false, '#e82020');
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }

    _tickAnimation(dt) {
        // ── 上电自检 ──
        if(this._state===ElectricActuator.STATE.POWERING){
            this._powerT+=dt;
            this._blinkT+=dt;
            if(this._blinkT>0.12){this._blinkT=0;this._blinkState=!this._blinkState;}
            if(this._powerT>=this._powerDur){
                this._state=ElectricActuator.STATE.IDLE;
                this._blinkState=true;
            }
        }

        // ── 闪烁时钟 ──
        this._blinkT+=dt;
        if(this._blinkT>0.5){this._blinkT=0;this._blinkState=!this._blinkState;}

        // ── 控制逻辑 ──
        if(this._state!==ElectricActuator.STATE.POWERING&&
           this._state!==ElectricActuator.STATE.FAULT&&
           this._state!==ElectricActuator.STATE.STALL){

            const err=this._sp-this._pv;
            if(Math.abs(err)>this.deadband){
                const dir=err>0?1:-1;
                const spd=Math.min(1,Math.abs(err)/20);
                this._pv+=dir*this._pvMoveSpd*dt;
                this._pv=Math.max(0,Math.min(100,this._pv));
                this._state=dir>0?ElectricActuator.STATE.OPENING:ElectricActuator.STATE.CLOSING;
                this._motorRotSpd=spd*20;
                this._motorRpm=Math.round(1450*spd);
                this._motorCurrent=this.ratedCurrent*0.7*spd;
                this._outputTorque=this.torqueNm*0.6*spd;
                this._motorTemp=Math.min(80,this._motorTemp+dt*spd*3);
            } else {
                this._state=ElectricActuator.STATE.IDLE;
                this._motorRotSpd=Math.max(0,this._motorRotSpd-dt*15);
                this._motorRpm=Math.round(this._motorRpm*0.85);
                this._motorCurrent=Math.max(0,this._motorCurrent-dt*2);
                this._outputTorque=Math.max(0,this._outputTorque-dt*20);
                this._motorTemp=Math.max(25,this._motorTemp-dt*0.8);
            }
        } else if(this._state===ElectricActuator.STATE.FAULT||this._state===ElectricActuator.STATE.STALL){
            this._motorRotSpd=0;
            this._motorRpm=0;
            this._motorCurrent=0;
            this._outputTorque=0;
        }

        // ── 限位检测 ──
        this._lsOpen  = this._pv >= 99.5;
        this._lsClose = this._pv <= 0.5;

        // ── 温度保护 ──
        this._tempTrip=this._motorTemp>75;

        // ── 物理动画更新 ──
        const dir=this._state===ElectricActuator.STATE.OPENING?1:-1;
        this._motorRotT+=dt*this._motorRotSpd*dir;
        this._gearRotT[0]+=dt*this._motorRotSpd*dir*0.5;
        this._gearRotT[1]+=dt*this._motorRotSpd*dir*0.25;
        this._flowT+=dt*(this._pvSmooth/100+0.1)*0.3;
        this._pvSmooth+=(this._pv-this._pvSmooth)*Math.min(1,dt*5);
        this._outputAngle=(this._pvSmooth/100)*this.travelAngle;
        this._potAngle=(this._pvSmooth/100)*270-135;

        // ── 重绘所有动态层 ──
        this._updateLeds();
        this._rebuildMotorDynamic();
        this._rebuildGearDynamic();
        this._rebuildFeedbackDynamic();
        this._rebuildOutputDynamic();
        this._rebuildCtrlDynamic();
        this._rebuildProtectionDynamic();
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    // ── 公共 API ──────────────────────────────

    setSetpoint(sp)    { this._sp=Math.max(0,Math.min(100,+sp)); this._refreshCache(); }
    setFeedback(pv)    { this._pv=Math.max(0,Math.min(100,+pv)); this._refreshCache(); }
    setMode(m)         { this._mode=m==='manual'?'manual':'auto'; }

    injectFault(code='OVERLOAD') {
        this._state=ElectricActuator.STATE.FAULT;
        this._faultCode=code;
        this._refreshCache();
    }
    clearFault() {
        if(this._state===ElectricActuator.STATE.FAULT||this._state===ElectricActuator.STATE.STALL){
            this._state=ElectricActuator.STATE.IDLE;
            this._faultCode=null;
            this._torqueTrip=false;
            this._tempTrip=false;
        }
        this._refreshCache();
    }
    reset() {
        this._state=ElectricActuator.STATE.POWERING;
        this._powerT=0; this._faultCode=null;
        this._motorRotSpd=0; this._motorRpm=0; this._motorCurrent=0;
        this._outputTorque=0; this._motorTemp=25;
        this._refreshCache();
    }

    getState()    { return this._state; }
    getSetpoint() { return this._sp;    }
    getFeedback() { return this._pv;    }
    getAngle()    { return this._outputAngle; }
    isFault()     { return this._state===ElectricActuator.STATE.FAULT; }

    update(v) {
        if(typeof v==='number') { this.setSetpoint(v); return; }
        if(typeof v==='object'&&v){
            if(v.sp!==undefined)    this.setSetpoint(v.sp);
            if(v.pv!==undefined)    this.setFeedback(v.pv);
            if(v.mode!==undefined)  this.setMode(v.mode);
            if(v.fault!==undefined) this.injectFault(v.fault);
            if(v.reset)             this.reset();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            {label:'型号',          key:'label',        type:'text'},
            {label:'电机功率(kW)',  key:'motorPower',   type:'number'},
            {label:'供电电压(V)',   key:'supplyV',      type:'number'},
            {label:'额定电流(A)',   key:'ratedCurrent', type:'number'},
            {label:'传动比',        key:'gearRatio',    type:'number'},
            {label:'齿轮效率',      key:'gearEff',      type:'number'},
            {label:'额定扭矩(N·m)',key:'torqueNm',     type:'number'},
            {label:'死区(%)',       key:'deadband',     type:'number'},
            {label:'全行程时间(s)', key:'fullTravelT',  type:'number'},
            {label:'行程角度(°)',   key:'travelAngle',  type:'number'},
            {label:'初始设定值(%)', key:'initSP',       type:'number'},
        ];
    }

    onConfigUpdate(cfg) {
        const n=k=>parseFloat(cfg[k]);
        if(cfg.label)        this.label=cfg.label;
        if(cfg.motorPower)   this.motorPower=n('motorPower');
        if(cfg.supplyV)      this.supplyV=n('supplyV');
        if(cfg.ratedCurrent) this.ratedCurrent=n('ratedCurrent');
        if(cfg.gearRatio)    this.gearRatio=n('gearRatio');
        if(cfg.gearEff)      this.gearEff=n('gearEff');
        if(cfg.torqueNm)     this.torqueNm=n('torqueNm');
        if(cfg.deadband)     this.deadband=n('deadband');
        if(cfg.fullTravelT){ this.fullTravelT=n('fullTravelT'); this._pvMoveSpd=100/this.fullTravelT; }
        if(cfg.travelAngle)  this.travelAngle=n('travelAngle');
        if(cfg.initSP!==undefined) this.setSetpoint(n('initSP'));
        this.config={...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    // ── 颜色工具 ─────────────────────────────
    _rgba(hex,alpha) {
        const h=hex.replace('#','');
        return `rgba(${parseInt(h.substring(0,2),16)},${parseInt(h.substring(2,4),16)},${parseInt(h.substring(4,6),16)},${(+alpha).toFixed(3)})`;
    }
    _lighten(hex,a){ return this._adjustBr(hex, a); }
    _darken (hex,a){ return this._adjustBr(hex,-a); }
    _adjustBr(hex,a){
        const h=hex.replace('#','');
        return '#'+[0,2,4].map(i=>{
            return Math.min(255,Math.max(0,Math.round(parseInt(h.substring(i,i+2),16)+255*a))).toString(16).padStart(2,'0');
        }).join('');
    }
}