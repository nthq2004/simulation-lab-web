import { BaseComponent } from './BaseComponent.js';

/**
 * OvenSystem —— 集成烘箱组件 v2
 *
 * 布局：
 *   整体尺寸约为原始方案的 2/3，W=375, H=300
 *   顶部均分三列：[PT100(原尺寸)] [Fan(缩放)] [Heater(缩放)]
 *   全部 6 个外部接线端从顶边引出
 *
 * 外部接线端（top edge，左→右）：
 *   pt100_l  pt100_r  |  fan_l  fan_r  |  heater_l  heater_r
 */
export class CoolingSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 整体箱体尺寸（原 560×420 的 2/3）─────────────────
        this.W = config.W || 130;
        this.H = config.H || 140;
        this.title = config.title || '烘箱系统';
        this.type = 'resistor';
        this.special = 'cooling'; // 特殊标记，供系统区分对待
        this.cache = 'fixed';

        this._pt100Fault = null;    // 模拟 PT100 故障的状态变量，null=正常，'open'=断路，'short'=短路        
        this.ambientT = 20;
        this.temp = this.ambientT;
        this.sensorTemp = this.ambientT; // 传感器读数，初始等于环境温度
        this.tempBuffer = []; // 用于模拟测温延迟的温度缓冲队列
        this.currentResistance = 107.7;

        // 目标宽 = 115，原宽 160 → scale ≈ 0.72
        this._subScale = (125 - 10) / 160;  // ≈ 0.72

        this._drawShell();
        this._embedPT100();
        this._drawLCD();
        this._drawExternalPorts();

        this._phyicalTimer = setInterval(() => this.update(), 100); // 100ms 更新一次物理状态

    }

    // ═══════════════════════════════════════════════════════════
    // 1. 外壳（无分隔线）
    // ═══════════════════════════════════════════════════════════
    _drawShell() {
        this.group.add(new Konva.Rect({
            x: 0, y: 0,
            width: this.W, height: this.H,
            fill: '#f4f0e6',
            stroke: '#444', strokeWidth: 3,
            cornerRadius: 8,
            shadowColor: '#000', shadowBlur: 10, shadowOpacity: 0.18
        }));

    }

    // ═══════════════════════════════════════════════════════════
    // 2. PT100 — 忠实复刻 PT100.js 原始外观，放在第 0 列
    //    原始坐标系：探棒折线水平展开，rotate(90) 后竖向
    //    这里直接用竖向坐标画，不旋转，置于列中央
    // ═══════════════════════════════════════════════════════════
    _embedPT100() {
        const cx = this.W / 2 - 45; // 列中心 x = 62.5
        const cy = 38;     // y 平移量（让顶端线头落在 y≈28）

        const rawPts = [-10, 20, 10, 20, 20, 10, 30, 30, 40, 10, 50, 30, 60, 10, 70, 20, 90, 20];
        const g = new Konva.Group({ x: 25, y: 20 }); // 整体下移，为顶部接线端留空间

        // 探棒折线（仿电阻波形）
        const probe = new Konva.Line({
            points: rawPts,
            stroke: '#2c3e50', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const leftLead = new Konva.Line({
            points: [-10, 20, -10, -10],
            stroke: '#f10000', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const leftUp = new Konva.Line({
            points: [-10, -10, 19, -10],
            stroke: '#f10000', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const rightLead = new Konva.Line({
            points: [90, 20, 90, -10],
            stroke: '#2c3e50', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });
        const rightUp = new Konva.Line({
            points: [90, -10, 60, -10],
            stroke: '#020000', strokeWidth: 2,
            lineJoin: 'round', lineCap: 'round'
        });

        // PT100 标签
        const label = new Konva.Text({
            x: cx - 10, y: cy - 4,
            width: 56, text: 'PT100',
            fontSize: 13, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center'
        });

        g.add(probe, leftLead, leftUp, rightLead, rightUp, label);
        this.group.add(g);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. LCD 温度显示（PT100 列下半部分）
    // ═══════════════════════════════════════════════════════════
    _drawLCD() {
        const cx = this.W / 2;
        const lw = 88, lh = 52;
        const lx = cx - lw / 2;
        const ly = this.H / 2;

        // 外壳
        this.group.add(new Konva.Rect({
            x: lx - 4, y: ly, width: lw + 8, height: lh + 8,
            fill: '#222', stroke: '#111', strokeWidth: 2, cornerRadius: 5
        }));
        // LCD 背板（深绿）
        this.group.add(new Konva.Rect({
            x: lx, y: ly, width: lw, height: lh,
            fill: '#1a3a1a', stroke: '#0d2e0d', strokeWidth: 1, cornerRadius: 2
        }));
        // 标签
        this.group.add(new Konva.Text({
            x: lx, y: ly, width: lw,
            text: '温度', fontSize: 12, fill: '#4db84d',
            align: 'center', fontFamily: 'monospace'
        }));
        // 主温度数字
        this._lcdTemp = new Konva.Text({
            x: lx, y: ly + 16, width: lw,
            text: '---.-',
            fontSize: 17, fontStyle: 'bold', fill: '#39ff39',
            align: 'center', fontFamily: 'monospace'
        });
        // 底部单位
        this._lcdUnit = new Konva.Text({
            x: lx, y: ly + 40, width: lw,
            text: '°C',
            fontSize: 12, fill: '#2db32d',
            align: 'center', fontFamily: 'monospace'
        });
        this.group.add(this._lcdTemp, this._lcdUnit);
    }


    // ═══════════════════════════════════════════════════════════
    // 3. 外部接线端 —— 全部在顶边 y=0
    //
    //  列 0 (PT100) : pt100_l @ x=cx-8,  pt100_r @ x=cx+8
    //  cx 均为各列在 group 坐标系中的中心 x
    // ═══════════════════════════════════════════════════════════
    _drawExternalPorts() {
        const s = this._subScale;

        // PT100 列中心
        const pt100cx = this.W / 2;
        // Fan 列中心（缩放后器件中心 x = ox + W/2 * s）

        const portY = 0; // 顶边

        // ── PT100 ─────────────────────────────────────────────
        this._addTopPort(pt100cx - 20, portY, 'l', 'p');
        this._addTopPort(pt100cx + 20, portY, 'r');

    }

    _addTopPort(x, y, portId, polority = 'n') {
        // 引线：从器件顶部到接线端
        this.group.add(new Konva.Line({
            points: [x, y + 10, x, y],
            stroke: '#666', strokeWidth: 1.5
        }));

        // 接线端底座（小正方形）
        this.group.add(new Konva.Rect({
            x: x - 7, y: y - 14,
            width: 14, height: 14,
            fill: '#ddd6c0', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2
        }));

        // 注册到 BaseComponent（提供连线能力）
        this.addPort(x, y - 7, portId, 'wire', polority);
    }
    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════
    checkPipesReady() {
        const requiredPipes = [
            { from: 'engine_pipe_o', to: 'pump_pipe_i', type: 'pipe' },
            { from: 'pump_pipe_o', to: 'tconn_pipe_l', type: 'pipe' },
            { from: 'tconn_pipe_u', to: 'valve_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'cooler_pipe_i', type: 'pipe' },
            { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' },
            { from: 'valve_pipe_r', to: 'engine_pipe_i', type: 'pipe' }
        ];
        const currentConns = this.sys.conns;
        // 1. 辅助函数：判断两个点之间是否有管路（忽略用户拉线的先后顺序）
        const isConnected = (req) => {
            return currentConns.some(curr =>
                curr.type === 'pipe' && this.sys._connEqual(curr, req)   // 反向
            );
        };
        // 2. 检查所有必须的管路是否都已连接（无论方向）
        const allConnected = requiredPipes.every(req => isConnected(req));

        if (allConnected) {
            return true;
        }
        return false;
    }

    renerPipesFlow() {
        if (this.sys.comps.pump.pumpOn) {
            this.sys.lineLayer.find('.flow').forEach(flowLine => {
                const key = flowLine.getAttr('connKey');
                let speed = 3;      // 基础速度
                let volume = 1;     // 基础流量感（宽度/间距）
                // --- 支路流量逻辑分配 ---
                // A. 冷却器支路 (包含通往散热器和散热器出来的管子)
                if (key.includes('cooler') || key.includes('tconn_pipe_r') || key.includes('valve_pipe_l')) {
                    // 流量正比于阀门开度
                    volume = this.sys.comps.valve.currentPos;
                    speed = volume * 8; // 速度随开度加快
                }
                // B. 旁通支路 (TPipe 直接连到 Valve 的那条)
                else if (key.includes('tconn_pipe_u') && key.includes('valve_pipe_u')) {
                    // 流量反比于阀门开度
                    volume = 1 - this.sys.comps.valve.currentPos;
                    speed = volume * 8;
                }
                // C. 主干道 (水泵到三通，或调节阀回到主机)
                else {
                    volume = 1;
                    speed = 5;
                }
                // --- 应用视觉效果 ---
                // 1. 速度效果：改变 dashOffset 的步进值
                flowLine.dashOffset(flowLine.dashOffset() - speed);
                // 2. 宽度效果：流量越大，虚线越粗 (在基础4px上浮动)
                flowLine.strokeWidth(1 + volume * 5);
                // 3. 密度效果：流量越大，虚线越长越密
                // 流量小时(volume趋于0)，虚线变成很短的点；流量大时变成长条
                if (volume < 0.05) {
                    flowLine.visible(false); // 流量极小时隐藏，模拟断流
                } else {
                    flowLine.visible(true);
                    flowLine.dash([volume * 15, 10]); // 动态调整 [实线长度, 间隔]
                }
            });
        } else {
            this.sys.lineLayer.find('.flow').forEach(flowLine => {
                flowLine.visible(false);
            });
        }
    }

    update() {
        const dt = 0.1; // 物理更新步长固定为 100ms

        //1. 温度物理模型：加热产生热量，风扇和被动散热带走热量，温度随热量变化
        const heatGen = this.sys.comps.engine.engOn ? this.sys.comps.engine.fuelRate * 72 : 0; // 加热功率，0~5
        const activeCool = this.sys.comps.pump.pumpOn ? this.sys.comps.valve.currentPos * (this.temp - this.ambientT) * 1.2 : 0; // 风扇散热，0~(temp-ambientT)，与温差成正比
        const passiveCool = this.sys.comps.pump.pumpOn ? (this.temp - this.ambientT) * 0.1 : (this.temp - this.ambientT) * 0.01; // 被动散热，温差越大散热越快
        const coreInertia = 15; // 核心温度惯性，数值越大温度变化越慢
        const coolGen = activeCool + passiveCool; // 总散热
        const netHeat = heatGen - coolGen;
        this.temp += netHeat * dt / coreInertia; // 温度更新
        // 2. 模拟 PT100 测温延迟：用一个长度为 delaySteps 的数组做缓冲，每次更新时存入当前温度，取出 delaySteps 步前的温度作为传感器读数
        this.temp = Math.min(this.temp,120);
        const delaySteps = 20; // 20 步 × 100ms = 2s 延迟
        // 存入队列
        this.tempBuffer.push(this.temp);
        // 防止无限增长
        if (this.tempBuffer.length > delaySteps) {
            var delayedTemp = this.tempBuffer.shift();
        } else {
            var delayedTemp = this.temp;
        }
        //3. 传感器读数平滑：传感器读数逐渐趋近于 delayedTemp，模拟测温系统的惯性响应
        const sensorTau = 3; // 时间常数（越大越慢）
        this.sensorTemp += (delayedTemp - this.sensorTemp) * dt / sensorTau;

        this.updatePT100Resistance();

        this._lcdTemp.text(this.sensorTemp.toFixed(1));
        this.renerPipesFlow();
        // console.log(`Temp: ${this.temp.toFixed(1)}°C, Sensor: ${this.sensorTemp.toFixed(1)}°C);
        this._refreshCache(); // 强制刷新缓存，确保显示更新        
    }

    updatePT100Resistance() {
        if (this._pt100Fault === 'open') this.currentResistance = 1e9;
        else if (this._pt100Fault === 'short') this.currentResistance = 0;
        else this.currentResistance = 100 + 0.3851 * this.sensorTemp;
    }

}

