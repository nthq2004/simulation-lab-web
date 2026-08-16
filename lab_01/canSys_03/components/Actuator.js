import { BaseComponent } from './BaseComponent.js';

export class PneumaticValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 原始尺寸是 340x700，缩小 2/3 约为 226x466
        this.w = 226;
        this.h = 466;
        this.scale = 0.8;
        this.type = 'resistor';
        this.currentResistance = 250;
        this.special = 'actuator';
        this.dir = 'positive';
        this.isLeaking = false;
        this.isStuck = false;

        this.config = { 'id': this.id, 'dir': this.dir };

        // 核心物理状态 (保持原始像素逻辑，依靠 scale 映射视觉)
        this.travel = 0;
        this.targetTravel = 0;
        this.strokePx = 65;

        this.sourcePress = 0;
        this.outPress = 0;
        this.inPress = 0;

        this.initVisuals();
        this.initPos();

        // 信号端口 (坐标也需要按 2/3 调整)
        this.addPort(-10, 370, 'r', 'wire');
        this.addPort(-10, 410, 'l', 'wire', 'p');
        this.addPort(-10, 330, 's', 'pipe', 'in');
        this.addPort(40, 295, 'o', 'pipe');
        this.addPort(135, 60, 'i', 'pipe');
        this._startLoop();
    }

    initVisuals() {
        // 创建一个内部容器，统一缩放 2/3 (0.666)
        this.scaleGroup = new Konva.Group({
            scaleX: this.scale,
            scaleY: this.scale
        });
        this.group.add(this.scaleGroup);

        const cx = 340 / 2; // 使用原始中心点计算

        // --- 1. 气室外壳 ---
        const housing = new Konva.Path({
            x: cx, y: 100,
            data: `M -140 -20 L 140 -20 L 140 0 L 155 0 L 155 10 L 140 10 L 140 50 L 100 50 L 100 86 L 33 86 L 33 240 L -33 240 L -33 86 L -100 86 L -100 50 L -140 50 L -140 10 L -155 10 L -155 0 L -140 0 Z`,
            fill: '#f0f0f0', stroke: '#444', strokeWidth: 10
        });

        // --- 2. 膜片悬挂系统 ---
        this.leftWireL = new Konva.Line({ points: [-150, 5, -108, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.leftWire = new Konva.Line({ points: [-108, 5, -100, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.rightWire = new Konva.Line({ points: [108, 5, 100, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.rightWireR = new Konva.Line({ points: [150, 5, 108, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });

        this.membrane = new Konva.Rect({
            x: cx - 100, y: 100, width: 200, height: 15,
            fill: '#0d0ddd', cornerRadius: 2
        });

        this.spring = new Konva.Line({
            x: cx, y: 115, points: this._getSpringPoints(225),
            stroke: '#087b16', strokeWidth: 6, lineJoin: 'round'
        });

        // --- 3. 支架与定位器 ---
        const yoke = new Konva.Path({
            x: cx, y: 350,
            data: `M -3 0 L -55 0 Q -85 0 -85 30 L -85 170 Q -85 200 -55 200 L 55 200 Q 85 200 85 170 L 85 30 Q 85 0 55 0 L 3 0`,
            stroke: '#2b2fae', strokeWidth: 12, lineCap: 'round', lineJoin: 'round'
        });


        // --- 4. 阀体 ---
        const valveBaseY = 556;
        this.valveGroup = new Konva.Group({ x: cx, y: valveBaseY });
        const bodyShell = new Konva.Rect({ x: cx - 290, y: 0, width: 240, height: 163, fill: '#b0afae', stroke: '#0f3bd9' });
        this.pipe = new Konva.Rect({ x: cx - 300, y: 30, width: 260, height: 63, fill: '#c3c1f9', stroke: '#ced7f8' });
        this.valveGroup.add(bodyShell, this.pipe);

        // --- 5. 阀杆与阀芯 ---
        this.stem = new Konva.Rect({ x: cx - 4, y: 115, width: 8, height: 472, fill: '#eee', stroke: '#999' });
        this.plug = new Konva.Path({
            x: cx, y: 587,
            data: 'M -22 0 L 22 0 Q 22 65, 0 65 Q -22 65, -22 0 Z',
            fill: '#1a1a1a'
        });

        this.coupling = new Konva.Group({ x: cx, y: 350 });
        this.coupling.add(new Konva.Rect({ x: -15, y: 0, width: 30, height: 45, fill: '#444', cornerRadius: 3 }));
        this.coupling.add(new Konva.Rect({ x: -18, y: 15, width: 36, height: 15, fill: '#222' }));

        // --- 6. 填料函 ---
        this.packingBox = new Konva.Group({ x: cx - 20, y: 520 });
        this.packingBox.add(new Konva.Rect({ width: 40, height: 50, fill: '#e0e0e0', stroke: '#333' }));
        this.packingBox.add(new Konva.Path({
            data: 'M 0 10 L 40 20 M 0 20 L 40 30 M 0 30 L 40 40 M 0 40 L 40 50 M 0 50 L 40 60 M 0 60 L 40 70',
            stroke: '#999', strokeWidth: 1
        }));

        // 将所有元素添加到缩放组中
        this.scaleGroup.add(yoke, housing, this.leftWireL, this.leftWire, this.rightWire, this.rightWireR, this.spring, this.valveGroup, this.packingBox, this.stem, this.plug, this.coupling, this.membrane);
    }
    initPos() {
        const cx = 50; // 假设中心位置

        // ==========================================
        // 1. 全局 Group (底座与外壳)
        // 尺寸: 宽120, 高160
        // cx - 60 确保中心对齐
        // ==========================================
        this.posBox = new Konva.Group({
            x: cx - 60,
            y: 370, // 调整位置，给顶部压力表留出空间
            id: 'positioner'
        });

        // 主底座 (灰色金属感)
        this.posBox.add(new Konva.Rect({
            width: 120, height: 160,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 120, y: 160 },
            fillLinearGradientColorStops: [0, '#cfcfcf', 0.5, '#eaeaea', 1, '#cfcfcf'], // 模拟拉丝铝
            cornerRadius: 6,
            stroke: '#888', strokeWidth: 1.5,
            shadowColor: 'black', shadowBlur: 10, shadowOffset: { x: 5, y: 5 }, shadowOpacity: 0.3
        }));

        // 前盖（模拟实物图中可以打开的区域，稍微深一点的灰色）
        this.posBox.add(new Konva.Rect({
            x: 10, y: 10, width: 100, height: 135,
            fill: '#b8b8b8', cornerRadius: 4,
            stroke: '#888', strokeWidth: 1,
            dash: [5, 5] // 模拟密封条边缘
        }));

        // ==========================================
        // 2. 左下角：电气接口与 LCD (输入 4-20mA)
        // ==========================================

        // LCD 屏幕背景 (保持你的原设计，深灰色)
        this.posBox.add(new Konva.Rect({
            x: 15, y: 100, width: 90, height: 40,
            fill: '#1a1a1a', cornerRadius: 2,
            stroke: '#000', strokeWidth: 1
        }));

        // LCD 文本 (输入信号显示， Courier New字体)
        this.lcd = new Konva.Text({
            x: 30, y: 105,
            text: '4.0 mA',
            fontSize: 18, fill: '#33ff33',
            fontFamily: 'Courier New',
            id: 'lcd_text',
            align: 'center'
        });
        this.posBox.add(this.lcd);

        // ==========================================
        // 3. 气路系统 Group (顶部 0.1MPa 气压表)
        // ==========================================
        this.gaugeOut = new Konva.Group({
            x: 60, // 位于定位器顶部左侧
            y: 50
        });
        this.posBox.add(this.gaugeOut);

        // 表盘外圈 (金属边框)
        this.gaugeOut.add(new Konva.Circle({
            radius: 35,
            fillLinearGradientStartPoint: { x: -20, y: -20 },
            fillLinearGradientEndPoint: { x: 20, y: 20 },
            fillLinearGradientColorStops: [0, '#f0f0f0', 1, '#999'],
            stroke: '#666',
            strokeWidth: 2
        }));

        // 白色表盘背景
        this.gaugeOut.add(new Konva.Circle({
            radius: 31,
            fill: '#ffffff'
        }));

        // 绘制刻度线 (0 - 0.1 MPa)
        for (let i = 0; i <= 10; i++) {
            // 从 150度 到 390度 (覆盖下半圆以上区域)
            const angle = 150 + i * 24;
            const rad = (angle * Math.PI) / 180;
            const isLong = i === 5; // 长刻度
            const len = isLong ? 8 : 3;

            this.gaugeOut.add(new Konva.Line({
                points: [
                    Math.cos(rad) * 30, Math.sin(rad) * 30,
                    Math.cos(rad) * (30 - len), Math.sin(rad) * (30 - len)
                ],
                stroke: '#333',
                strokeWidth: isLong ? 2.5 : 2
            }));

            // 添加 0, 0.05, 0.1 数字标注
            if (isLong) {
                const label = (i * 0.01).toFixed(2);
                this.gaugeOut.add(new Konva.Text({
                    x: Math.cos(rad) * 20 - 8,
                    y: Math.sin(rad) * 20 - 0,
                    text: label === "0.00" ? "0" : label === "0.10" ? "0.1" : "0.05",
                    fontSize: 10,
                    fill: '#000',
                    align: 'center'
                }));
            }
        }

        // 气压表单位文本
        this.gaugeOut.add(new Konva.Text({
            x: -14, y: 18,
            text: 'MPa',
            fontSize: 10,
            fill: '#220ef7',
            width: 28,
            align: 'center'
        }));

        // 气压表指针 (初始指向0)
        this.posPointer = new Konva.Line({
            points: [0, 0, Math.cos(150 * Math.PI / 180) * 21, Math.sin(150 * Math.PI / 180) * 21],
            stroke: '#ff0000',
            strokeWidth: 3,
            lineCap: 'round'
        });
        this.gaugeOut.add(this.posPointer);

        // 指针中心轴
        this.gaugeOut.add(new Konva.Circle({
            radius: 2.5,
            fill: '#333'
        }));


        // ==========================================
        // 4. 右侧反馈系统 Group (反馈杆与连杆)
        // 需要随阀门移动动画控制
        // ==========================================
        this.feedbackSys = new Konva.Group({
            x: 120, // 起始于底座右边缘
            y: 80, // 中心高度
            id: 'feedback_arm'
        });
        this.posBox.add(this.feedbackSys);

        // U型反馈杆主体 (银色金属)
        // x方向凸出，y方向有一定宽度
        this.feedbackSys.add(new Konva.Rect({
            x: 0, y: -25, // 相对于反馈系统Group中心，居中
            width: 60, height: 20,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 60, y: 20 },
            fillLinearGradientColorStops: [0, '#eaeaea', 1, '#b8b8b8'],
            cornerRadius: 2,
            stroke: '#888', strokeWidth: 1
        }));

        // U型槽 (U字型杆的中间镂空区域)
        this.feedbackSys.add(new Konva.Rect({
            x: 10, y: -19, width: 40, height: 8,
            fill: '#4a4a4a', cornerRadius: 1 // 模拟深度
        }));

        // 反馈连杆 (连接 U型杆左侧与定位器内部的传动轴)
        this.feedbackSys.add(new Konva.Line({
            points: [5, -25, 5, -5], // 垂直连杆
            stroke: '#4a4a4a', strokeWidth: 4, lineCap: 'round'
        }));
        // 连接点圆形铆钉
        this.feedbackSys.add(new Konva.Circle({ x: 5, y: -15, radius: 4, fill: '#888', stroke: '#555', strokeWidth: 1 }));

        // ==========================================
        // 5. 组装与添加
        // ==========================================

        // 如果需要随阀杆移动反馈杆，需要将反馈系统Group从主体移出
        // this.posBox.remove(this.feedbackSys);
        // 建议在全局 Group 中独立管理，这里暂按包含关系演示布局。

        this.scaleGroup.add(this.posBox);
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -28 : 28, (i / coils) * h);
        }
        return pts;
    }

    _startLoop() {
        if (this._loopTimer) clearInterval(this._loopTimer);

        this._loopTimer = setInterval(() => {
            // 1. 获取电压并计算目标开度 targetPos (0-1)
            const voltage = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`);

            // 假设采样电阻 250Ω，1-5V 对应 4-20mA，对应 0-1 的开度
            const current = Math.max(0, Math.min(0.02, voltage / 250));
            this.update(1000 * current);

        }, 500);
    }

    update(inputmA) {
        // 1. 电流限制与死区处理 (4-20mA)
        const mA = (typeof inputmA === 'number') ? Math.max(0, Math.min(20, inputmA)) : 0;

        // 2. 核心转换逻辑：电流 -> 目标开度
        const percent = (mA - 4) / 16;

        // --- 3. 视觉联动逻辑 ---
        // A. 更新输出气压表 (量程映射：4mA->0.02, 20mA->0.1)
        // 计算当前电流对应的气压值 (MPa)
        const currentPressure = 0.02 + (percent * 0.08);
        this.outPress = Math.min(this.sourcePress, currentPressure);

        // 将气压值映射到表盘角度：
        // 气压表量程是 0-0.1，对应角度 150-390 (总行程 240度)
        // 0.02MPa 对应的角度起始点 = 150 + (0.02 / 0.1) * 240 = 198度
        const targetAngle = 150 + (this.outPress / 0.1) * 240;
        const rad = (targetAngle * Math.PI) / 180;

        if (this.posPointer) {
            this.posPointer.points([0, 0, Math.cos(rad) * 21, Math.sin(rad) * 21]);
        }

        // 3. 模拟气压升高的滞后效应 (惯性环节)
        // 0.15 是响应速度因子，模拟膜头充气的物理延迟
        const LeakFactor = 0.3 + Math.random() * 0.5;
        this.inPress = this.isLeaking ? LeakFactor * this.inPress : this.inPress;
        this.targetTravel = (this.inPress - 0.02) / 0.08;

        // --- 核心改动：卡死逻辑判断 ---
        if (this.isStuck) {
            // 如果卡死了，travel 不随 targetTravel 更新
            // 保持当前 this.travel 不变
            // 此时可以添加一些视觉反馈，比如 LCD 闪烁提示
        } else {
            // 正常状态：平滑移向目标位置
            this.travel += (this.targetTravel - this.travel) * 0.3;
        }
        // B. 更新定位器 LCD 屏幕 (显示电流与百分比)
        this.lcd.text(`${mA.toFixed(1)}mA\n${Math.max(0, this.travel * 100).toFixed(1)}%`);

        // C. 驱动阀杆机构移动 (机械动作)
        const currentMove = Math.max(0, this.travel * this.strokePx);
        this.membrane.y(100 + currentMove);
        this.leftWire.points([-108, 5, -100, 5 + currentMove]);
        this.rightWire.points([108, 5, 100, 5 + currentMove]);
        this.spring.y(115 + currentMove);
        this.spring.points(this._getSpringPoints(225 - currentMove));
        this.stem.y(115 + currentMove);
        this.plug.y(587 + currentMove);

        // D. 阀杆连接块 (Coupling) 跟随移动
        this.coupling.y(350 + currentMove);

        // E. 反馈杆回馈 (关键环节！)
        // 反馈杆安装在阀杆连接块上，它会随着阀杆的上下移动而摆动或平移
        // 这里的 80 是 initPos 中设定的初始 y 坐标，加上阀杆的位移量
        if (this.feedbackSys) {
            this.feedbackSys.y(80 + currentMove);
        }
    }
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '气开、气关选择',
                key: 'dir',
                type: 'select',
                options: [
                    { label: '气开阀', value: 'positive' },
                    { label: '气关阀', value: 'negtive' }
                ]
            }
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        this.dir = newConfig.dir || 'positive';
        this.config = newConfig;
        if (this.dir === 'positive') this.pipe.y(30);
        else this.pipe.y(98);

    }

}