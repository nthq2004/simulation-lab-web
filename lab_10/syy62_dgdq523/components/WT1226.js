import { BaseComponent } from './BaseComponent.js';

export class WT1226 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.scale = 0.8;
        this.w = 340 * this.scale;
        this.h = 420 * this.scale;

        this.type = 'relay';
        this.special = 'wtrelay';
        this.cache = 'fixed';
        this._initGroups();

        // --- 1. 型号与核心参数：温度相关 ---
        this.model = config.model || 'WTZK-50-C';

        // 核心物理状态：使用温度 (摄氏度)
        this.temperature = 0; // 当前温度，单位 °C
        this.setPoint = config.setPoint || 50; // 给定值 (相当于压力继电器的低压设定)，单位 °C
        this.differential = config.differential || 50; // 切换差 (百分数)，代表幅差占量程的百分比

        // 温度调节范围 (取代原来的压力范围)
        this.tempMin = config.tempMin !== undefined ? config.tempMin : -40;
        this.tempMax = config.tempMax !== undefined ? config.tempMax : 40;
        this.diffMin = config.diffMin !== undefined ? config.diffMin : 1;
        this.diffMax = config.diffMax !== undefined ? config.diffMax : 6;

        // 设定值（动作下限）手动调节范围与步长（℃）：-20~20℃，每点击一次变化 1℃
        this.setValueMin = config.setValueMin !== undefined ? config.setValueMin : -20;
        this.setValueMax = config.setValueMax !== undefined ? config.setValueMax : 20;
        this.setValueStep = config.setValueStep !== undefined ? config.setValueStep : 1;
        // 幅差（切换差）手动调节步长（百分比），每点击一次变化 2%
        this.diffStep = config.diffStep !== undefined ? config.diffStep : 2;

        // 计算实际动作点 (基于温度和幅差百分比)
        this.lowSet = this.tempMin + (this.tempMax - this.tempMin) * (this.setPoint / 100);
        this.highSet = this.lowSet + this.diffMin + (this.diffMax - this.diffMin) * (this.differential / 100);

        // 保存配置供外部调用
        this.config = {
            id: this.id,
            model: this.model,
            tempMin: this.tempMin,
            tempMax: this.tempMax,
            diffMin: this.diffMin,
            diffMax: this.diffMax,
            lowSet: this.lowSet,   // 动作下限 (温度)
            highSet: this.highSet  // 动作上限 (温度)
        };

        // 继电器状态 (true=闭合/低压启动, false=断开/高压停止)
        this.isEnergized = true;

        // 存储刻度文字元素以便更新
        this.scaleTextElements = [];

        this.initVisuals();
        this.update(0); // 初始更新

        // 电气端口（位于右上角接线端子处）
        this.addPort(277, 8, 'NC', 'wire');
        this.addPort(277, 49, 'NO', 'wire','p');
        this.addPort(277, 89, 'COM', 'wire');
    }

    initVisuals() {
        // --- 视觉初始化，整体结构与压力继电器一致 ---
        this.viewGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale, x: 5, y: 5 });
        this._staticGroup.add(this.viewGroup);

        const bx = 340, by = 420;

        // 1. 背景外壳
        this.viewGroup.add(new Konva.Rect({
            width: bx, height: by - 80, fill: '#f8f9fa', stroke: '#333', strokeWidth: 2, cornerRadius: 4
        }));

        // --- 2. 左侧：温度设定机构 (弹簧) ---
        this.setScrew = new Konva.Rect({ x: 15, y: -20, width: 40, height: 80, fill: '#0c7b08', stroke: '#333' });
        this.screwPointer = new Konva.Line({
            points: [55, 40, 90, 40],
            stroke: '#ff0000', strokeWidth: 2
        });

        this.mainSpring = new Konva.Line({ x: 47, y: 60, points: this._getSpringPoints(215), stroke: '#444', strokeWidth: 4 });

        // --- 3. 左侧刻度盘：显示温度值 (0~100°C) ---
        this.scaleGroup = new Konva.Group({ x: 85, y: 40 });
        const plate = new Konva.Rect({
            width: 30, height: 40, fill: '#eee', stroke: '#ccc', strokeWidth: 1
        });
        this.scaleGroup.add(plate);

        // 生成 10 个刻度线 (对应 0 到 100°C)
        for (let i = 0; i <= 10; i++) {
            const yPos = 40 - (i * 4);
            const isLong = i % 5 === 0;
            this.scaleGroup.add(new Konva.Line({
                points: [0, yPos, isLong ? 10 : 6, yPos],
                stroke: '#333', strokeWidth: 1
            }));

            let textElement;
            if (isLong) {
                const tempValue = this.tempMin + (i / 10) * (this.tempMax - this.tempMin);
                textElement = new Konva.Text({
                    x: 12, y: yPos - 5,
                    text: tempValue.toFixed(0),
                    fontSize: 10, fill: '#666'
                });
                this.scaleGroup.add(textElement);
                this.scaleTextElements.push({ el: textElement, i });
            }
        }

        // --- 设定螺钉交互 ---
        this.setScrew.on('mousedown touchstart', () => {
            const pos = this.setScrew.getRelativePointerPosition();
            this.turnSetScrew(pos.y < this.setScrew.height() / 2 ? 1 : -1);
        });
        this.setScrew.on('dblclick', (e) => e.cancelBubble = true);
        this.setScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.setScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));

        // --- 4. 左下：切换差 (幅差) 调节机构 ---
        this.diffGroup = new Konva.Group({ x: 105, y: 340 });
        this.diffScrew = new Konva.Rect({ x: -30, y: 60, width: 60, height: 40, fill: '#077d59' });
        this.diffSpring = new Konva.Line({ x: 0, y: 0, points: this._getSpringPoints(60), stroke: '#888', strokeWidth: 2 });
        this.diffTop = new Konva.Rect({ x: -30, y: 0, width: 60, height: 10, fill: '#555' });
        this.diffCover = new Konva.Rect({ x: -40, y: 0, width: 80, height: 80, stroke: '#444', strokeWidth: 2, fill: '#eee' });

        // 幅差指示牌
        this.diffScalePlate = new Konva.Group({ x: -40, y: 100 });
        const plateBg = new Konva.Rect({
            width: 80, height: 20, fill: '#a7a5e8', cornerRadius: 2
        });
        this.diffScalePlate.add(plateBg);
        this.diffNumbers = new Konva.Group({ y: 3 });
        this.diffScalePlate.add(this.diffNumbers);

        this.diffPointer = new Konva.Line({
            points: [0, 0, 0, 20],
            stroke: 'red', strokeWidth: 4,
            x: 0, y: 75
        });

        this.diffGroup.add(this.diffCover, this.diffScrew, this.diffSpring, this.diffTop, this.diffScalePlate, this.diffPointer);
        
        // 幅差螺钉交互
        this.diffScrew.on('mousedown touchstart', () => {
            const pos = this.diffScrew.getRelativePointerPosition();
            this.turnDiffScrew(pos.x > this.diffScrew.width() / 2 ? 1 : -1);
        });
        this.diffScrew.on('dblclick', (e) => e.cancelBubble = true);
        this.diffScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.diffScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));

        // --- 5. 核心：主杠杆 ---
        this.leverGroup = new Konva.Group({ x: 220, y: 280 });
        this.leverBar = new Konva.Line({
            points: [-185, 0, 65, 0], stroke: '#8b4513', strokeWidth: 10, lineCap: 'round'
        });
        this.limitBolt = new Konva.Rect({ x: -122.5, y: 0, width: 15, height: 45, fill: '#999', stroke: '#333' });

        this.knifeBlade = new Konva.Group({ x: 0, y: 0, rotation: 0 });
        const bladePath = new Konva.Path({
            data: 'M 0 -5 L 55 -5 L 55 -105 L 15 -105 L 15 -80 L 0 -80 Z',
            fill: '#c0c0c0', stroke: '#444', strokeWidth: 2
        });
        const windowCutter = new Konva.Rect({
            x: 25, y: -70, width: 20, height: 55,
            fill: 'black', globalCompositeOperation: 'destination-out'
        });
        this.knifeBlade.add(bladePath, windowCutter);

        this.elasticPlate = new Konva.Line({
            x: 40, y: 0, points: [0, -107, 0, -197], stroke: '#979dc7', strokeWidth: 4, lineCap: 'round'
        });

        this.leverGroup.add(this.leverBar, this.limitBolt, this.knifeBlade, this.elasticPlate);
        const pivotBase = new Konva.Path({ x: 220, y: 280, data: 'M -10 15 L 10 15 L 0 0 Z', fill: '#333' });

        // --- 6. 右下：波纹管机构 (保留不变) ---
        this.bellows = new Konva.Group({ x: 290, y: 340 });
        this.bellowsCover = new Konva.Rect({ x: -34, y: 0, width: 70, height: 78, stroke: '#444', strokeWidth: 2, fill: '#eee' });

        // 波纹管主体 (保持原来的蓝色)
        this.bellowsBody = new Konva.Path({
            data: 'M -25 0 L 25 0 L 20 5 L 25 10 L 20 15 L 25 20 L 20 25 L 25 30 L -25 30 L -20 25 L -25 20 L -20 15 L -25 10 L -20 5 Z',
            fill: '#90caf9',
            stroke: '#1565c0',
            strokeWidth: 1.5,
            scaleY: 1.5
        });
        // 添加"波纹管"标签 (可选)
        const bellowLabel = new Konva.Text({
            x: -20, y: 5,
            text: '波纹管',
            fontSize: 12,
            fill: '#1565c0',
            fontStyle: 'bold'
        });
        this.bellows.add(this.bellowsCover, this.bellowsBody, bellowLabel);

        // 传动杆 (波纹管顶部 -> 杠杆右端)
        this.connectingRod = new Konva.Line({ stroke: '#333', strokeWidth: 4, lineCap: 'round' });

        // --- 7. 独立感温包 (放大，下移) ---
        // 感温包：位于外壳右下下方
        this.bulbGroup = new Konva.Group({ x: 430, y: 450 });
        // 感温包外壳 (铜色圆角矩形，加大)
        const bulbBody = new Konva.Rect({
            x: -30, y: 0,
            width: 60, height: 65,
            fill: '#d4a373',
            stroke: '#8b5a2b',
            strokeWidth: 2.5,
            cornerRadius: 10
        });
        // 感温包内部波纹 (装饰，加长)
        const bulbRibbon = new Konva.Line({
            points: [-20, 12, 20, 12, -20, 22, 20, 22, -20, 32, 20, 32, -20, 42, 20, 42],
            stroke: '#b8834a',
            strokeWidth: 2.5,
            tension: 0.5
        });
        // 感温包标签
        const bulbLabel = new Konva.Text({
            x: -20, y: 44,
            text: '感温包',
            fontSize: 14,
            fill: '#fff',
            fontStyle: 'bold'
        });
        // 顶部接嘴（出口）
        const nozzle = new Konva.Rect({
            x: -6, y: -12,
            width: 12, height: 12,
            fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1.5, cornerRadius: 2
        });
        this.bulbGroup.add(bulbBody, bulbRibbon, bulbLabel, nozzle);
        this.viewGroup.add(this.bulbGroup);

        // 多圈毛细管：从感温包顶部出口绕多圈后连到波纹管底部入口
        this.capillaryTube = new Konva.Line({
            points: [
                430, 438,        // 感温包顶部出口 (x=430)
                410, 426, 390, 434,  // 第1圈
                370, 424, 350, 432,  // 第2圈
                330, 422, 310, 428,  // 第3圈
                295, 424, 285, 418,  // 接近波纹管底部
            ],
            stroke: '#b87333',
            strokeWidth: 3,
            tension: 0.35,
            lineCap: 'round',
            lineJoin: 'round'
        });
        this.viewGroup.add(this.capillaryTube);

        // 毛细管标注
        this.viewGroup.add(new Konva.Text({
            x: 340, y: 425,
            text: '毛细管',
            fontSize: 16, fontStyle: 'bold', fill: '#8b5a2b'
        }));

        // 波纹管底部气体入口矩形
        this.bellowsInlet = new Konva.Rect({
            x: 278, y: 413,
            width: 14, height: 10,
            fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1.5, cornerRadius: 2
        });
        this.viewGroup.add(this.bellowsInlet);

        // --- 8. 右上：触点系统与输出端口 ---
        this.switchBox = new Konva.Group({ x: 260, y: 0 });
        this.contactNC = new Konva.Circle({ x: -30, y: 55, radius: 6, fill: '#7d7c78', stroke: '#333' });
        this.contactNO = new Konva.Circle({ x: 30, y: 55, radius: 6, fill: '#777', stroke: '#333' });
        this.movingContact = new Konva.Circle({ x: 0, y: 55, radius: 5.5, fill: '#858382', stroke: '#000' });
        this.movingRod = new Konva.Line({ x: 0, y: 0, points: [0, 105, 25, 55], stroke: '#555', strokeWidth: 4 });

        this.wireCOM = new Konva.Line({ x: 0, y: 105, points: [0, 0, 80, 0], stroke: '#555', strokeWidth: 4 });
        this.wireCOMBase = new Konva.Rect({ x: -5, y: 100, width: 10, height: 10, stroke: '#444', strokeWidth: 2, fill: '#141212' });
        this.wireNO = new Konva.Line({ x: 35, y: 55, points: [0, 0, 50, 0], stroke: '#8b8a89', strokeWidth: 4 });
        this.wireNC = new Konva.Line({ x: -29, y: 5, points: [0, 0, 104, 0], stroke: '#848985', strokeWidth: 4 });
        this.wireNCUp = new Konva.Line({ x: -29, y: 50, points: [0, 0, 0, -47], stroke: '#848985', strokeWidth: 4 });

        this.toggleSpring = new Konva.Path({
            stroke: '#4c08f8',
            strokeWidth: 4,
            lineCap: 'round'
        });

        this.switchBox.add(this.contactNC, this.contactNO, this.wireCOM, this.movingContact, this.movingRod, 
                           this.wireCOMBase, this.wireNC, this.wireNCUp, this.wireNO, this.toggleSpring);

        const NOPort = new Konva.Circle({ x: 340, y: 55, radius: 6, fill: '#dee2e7', stroke: '#b3b6b9', strokeWidth: 1 });

        // --- 9. 标题信息 ---
        this.title = new Konva.Text({
            x: 100,
            y: 100,
            text: `型号：${this.config.model}\n温度范围：${this.config.tempMin}~${this.config.tempMax} °C\n切换差：${this.config.diffMin}~${this.config.diffMax} °C`,
            fontSize: 15,
            fontFamily: 'Calibri',
            fill: '#0930f2',
            width: 200,
            align: 'left',
            lineHeight: 1.2
        });

        this.viewGroup.add(
            this.setScrew, this.screwPointer, this.scaleGroup, this.mainSpring, pivotBase,
            this.diffGroup, this.leverGroup, this.bellows, this.switchBox, this.connectingRod, NOPort, this.title
        );

        // --- 10. 标注文字 ---
        const labelOpts = { fontSize: 16, fontStyle: 'bold', fill: '#333' };
        this.viewGroup.add(new Konva.Text({ x: 60, y: 5, text: '设定值调节', ...labelOpts }));
        this.viewGroup.add(new Konva.Text({ x: 0, y: 400, text: '幅差调节', ...labelOpts }));
        this.viewGroup.add(new Konva.Text({ x: 320, y: -20, text: 'NC', ...labelOpts }));
        this.viewGroup.add(new Konva.Text({ x: 315, y: 40, text: 'NO', ...labelOpts }));
        this.viewGroup.add(new Konva.Text({ x: 310, y: 116, text: 'COM', ...labelOpts }));
    }

    // 辅助函数：生成弹簧点
    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -15 : 15, (i / coils) * h);
        }
        return pts;
    }

    // --- update 函数：输入为温度，感温包膨胀，波纹管随动 ---
    update(temp) {
        if (temp !== undefined) this.temperature = temp;

        // 根据当前 setPoint/differential 重算动作限值
        this.lowSet = this.tempMin + (this.tempMax - this.tempMin) * (this.setPoint / 100);
        this.highSet = this.lowSet + this.diffMin + (this.diffMax - this.diffMin) * (this.differential / 100);

        // 同步更新配置对话框（如已打开）
        const lowEl = document.getElementById('diag_lowSet');
        const highEl = document.getElementById('diag_highSet');
        if (lowEl) lowEl.value = this.lowSet.toFixed(1);
        if (highEl) highEl.value = this.highSet.toFixed(1);

        // ----- 核心逻辑：温度 -> 模拟压力 -----
        let pressureSim = 0;
        if (this.tempMax > this.tempMin) {
            pressureSim = (this.temperature - this.tempMin) / (this.tempMax - this.tempMin);
        }
        pressureSim = Math.max(0, Math.min(1, pressureSim));

        // 双位逻辑 (滞回)
        if (this.temperature < this.lowSet) {
            this.isEnergized = true;
        } else if (this.temperature > this.highSet) {
            this.isEnergized = false;
        }

        // 杠杆位移
        const forceEffect = (pressureSim - 0.5) * 8;
        const targetRot = Math.max(-10, Math.min(10, forceEffect));
        this.leverGroup.rotation(-targetRot);

        // ----- 1. 波纹管压缩：温度升高→气压升高→波纹管被压缩 -----
        const bScaleY = 2.0 - pressureSim * 0.8;
        this.bellowsBody.scaleY(bScaleY);

        // ----- 2. 感温包膨胀 (新增独立动画) -----
        // 感温包随温度变化而膨胀/收缩，与波纹管同步动作，但视觉上独立
        // 温度越高，感温包越膨胀 (scaleX, scaleY 同时变化)
        const bulbScale = 0.8 + pressureSim * 0.4; // 范围 0.8 ~ 1.2
        this.bulbGroup.scaleX(bulbScale);
        this.bulbGroup.scaleY(bulbScale);

        // 毛细管固定连接感温包出口和波纹管入口，不做动画

        // 机械传动链 (与原代码一致)
        const drift = -targetRot * 3.5;
        const epTopX = (40 + drift) + (220 - 260);
        const epTopY = -197 + 280 + 5;

        const contactX = this.isEnergized ? -20 : 20;
        this.movingContact.x(contactX);
        this.movingRod.points([0, 105, contactX, 55]);

        const rodPointX = 0 + (contactX - 0) * 0.75;
        const rodPointY = 105 + (55 - 105) * 0.75;

        const midX = (epTopX + rodPointX) / 2;
        const midY = (epTopY + rodPointY) / 2;
        const bendAmount = this.isEnergized ? 30 : -30;

        this.toggleSpring.data(
            `M ${epTopX} ${epTopY} Q ${midX + bendAmount} ${midY} ${rodPointX} ${rodPointY}`
        );

        // 传动杆: 波纹管顶部 -> 杠杆右端
        const bellowsX = 290;
        const bellowsBottomY = 340 + (30 * bScaleY);
        const rad = (targetRot * Math.PI) / 180;
        const leverEndX = 220 + 70 * Math.cos(rad);
        const leverEndY = 280 - 70 * Math.sin(rad);
        this.connectingRod.points([bellowsX, bellowsBottomY, leverEndX, leverEndY]);

        // 触点颜色反馈
        if (this.isEnergized) {
            this.contactNO.fill('#a8a4a4');
            this.wireNO.stroke('#a8a4a4');
            this.movingContact.fill('#08f818');
            this.contactNC.fill('#08f818');
            this.movingRod.stroke('#08f818');
            this.wireCOM.stroke('#08f818');
            this.wireNC.stroke('#08f818');
            this.wireNCUp.stroke('#08f818');
        } else {
            this.contactNO.fill('#f40a0a');
            this.movingContact.fill('#f40a0a');
            this.contactNC.fill('#7e807e');
            this.movingRod.stroke('#f40a0a');
            this.wireCOM.stroke('#f40a0a');
            this.wireNC.stroke('#a8a4a4');
            this.wireNCUp.stroke('#a8a4a4');
            this.wireNO.stroke('#f40a0a');
        }

        // 给定弹簧随动
        const screwBottomY = -20 + 80 - (this.setPoint - 50) * 0.4;
        this.setScrew.y(-20 - (this.setPoint - 50) * 0.4);
        this.screwPointer.y(screwBottomY - 40);

        const leverLeftY = 280 + 185 * Math.sin(rad);
        const springLen = leverLeftY - screwBottomY;
        this.mainSpring.x(47);
        this.mainSpring.y(screwBottomY);
        this.mainSpring.points(this._getSpringPoints(springLen));

        // 幅差机构
        const diffBaseY = this.differential * 0.2;
        this.diffScrew.y(60 - diffBaseY);
        this.diffTop.y(-diffBaseY);
        this.diffSpring.y(-diffBaseY);

        const boltRelX = -122.5 + 7.5;
        const boltRelY = 45;
        const boltGlobalY = 280 + boltRelX * Math.sin(-rad) + boltRelY * Math.cos(rad);

        const topStaticY = -diffBaseY + 340;
        if (boltGlobalY > topStaticY) {
            const topCurrentY = boltGlobalY - topStaticY;
            this.diffTop.y(-diffBaseY + topCurrentY);
            this.diffSpring.y(-diffBaseY + topCurrentY);
            this.diffSpring.points(this._getSpringPoints(60 - topCurrentY));
        }

        // 幅差刻度
        const currentVal = this.differential / 10;
        const spacing = 40;
        this.diffNumbers.destroyChildren();

        for (let i = 0; i <= 10; i++) {
            const xOffset = (i - currentVal) * spacing;
            if (Math.abs(xOffset) < 60) {
                this.diffNumbers.add(new Konva.Text({
                    x: 40 + xOffset - 5,
                    y: 0,
                    text: i.toString(),
                    fontSize: 14,
                    fill: Math.abs(xOffset) < 5 ? 'red' : '#fff',
                    fontStyle: Math.abs(xOffset) < 5 ? 'bold' : 'normal'
                }));
            }
        }

        this._refreshCache();
    }

    /**
     * 模拟转动「设定值调节」螺钉（与鼠标点击螺钉逻辑一致）。
     * @param {number} dir >0 增大、<0 减小；每次变化 setValueStep℃（默认 1℃）
     * 设定值限幅在 [setValueMin, setValueMax]（默认 -20~20℃）
     */
    turnSetScrew(dir) {
        const range = this.tempMax - this.tempMin;
        if (range <= 0) return;
        const delta = (dir >= 0 ? 1 : -1) * this.setValueStep;
        const low = Math.max(this.setValueMin, Math.min(this.setValueMax, this.lowSet + delta));
        this.setPoint = ((low - this.tempMin) / range) * 100;
        this.update(this.temperature);
    }

    /**
     * 模拟转动「幅差调节」螺钉（与鼠标点击螺钉逻辑一致）。
     * @param {number} dir >0 增大、<0 减小；每次变化 diffStep%（默认 2%）
     */
    turnDiffScrew(dir) {
        const step = this.diffStep !== undefined ? this.diffStep : 2;
        this.differential = Math.max(0, Math.min(100, this.differential + (dir >= 0 ? step : -step)));
        this.update(this.temperature);
    }

    // 配置字段
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '器件型号', key: 'model', type: 'text' },
            { label: '量程下限 (°C)', key: 'tempMin', type: 'number' },
            { label: '量程上限 (°C)', key: 'tempMax', type: 'number' },
            { label: '切换差范围下限 (°C)', key: 'diffMin', type: 'number' },
            { label: '切换差范围上限 (°C)', key: 'diffMax', type: 'number' },
            { label: '动作下限 (°C)', key: 'lowSet', type: 'number', min: this.setValueMin, max: this.setValueMax, step: this.setValueStep, get: c => +(+c.lowSet).toFixed(1) },
            { label: '幅差 (°C)', key: 'diffTemp', type: 'number', get: c => +(c.highSet - c.lowSet).toFixed(1) },
            { label: '动作上限 (°C)', key: 'highSet', type: 'number', get: c => +(+c.highSet).toFixed(1) }
        ];
    }

    // 配置更新处理
    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.model) this.model = newConfig.model;

        if (newConfig.tempMin !== undefined) this.tempMin = newConfig.tempMin;
        if (newConfig.tempMax !== undefined) this.tempMax = newConfig.tempMax;
        if (newConfig.diffMin !== undefined) this.diffMin = newConfig.diffMin;
        if (newConfig.diffMax !== undefined) this.diffMax = newConfig.diffMax;

        const range = this.tempMax - this.tempMin;
        const diffSpan = this.diffMax - this.diffMin;

        // 「动作下限(℃)」→ 反算给定值百分比
        if (newConfig.lowSet !== undefined && !Number.isNaN(newConfig.lowSet) && range > 0) {
            const sp = ((newConfig.lowSet - this.tempMin) / range) * 100;
            this.setPoint = Math.max(0, Math.min(100, sp));
        }
        // 「幅差(℃)」→ 反算切换差百分比
        if (newConfig.diffTemp !== undefined && !Number.isNaN(newConfig.diffTemp) && diffSpan > 0) {
            const d = ((newConfig.diffTemp - this.diffMin) / diffSpan) * 100;
            this.differential = Math.max(0, Math.min(100, d));
        }

        this.lowSet = this.tempMin + range * (this.setPoint / 100);
        this.highSet = this.lowSet + this.diffMin + diffSpan * (this.differential / 100);

        this.config = {
            ...this.config,
            ...newConfig,
            setPoint: this.setPoint,
            differential: this.differential,
            lowSet: this.lowSet,
            highSet: this.highSet
        };

        this.scaleTextElements.forEach(item => {
            const tempValue = this.tempMin + item.i * (this.tempMax - this.tempMin) / 10;
            item.el.text(tempValue.toFixed(0));
        });

        this.title.text(
            `型号：${this.config.model}\n温度范围：${this.config.tempMin}~${this.config.tempMax} °C\n切换差：${this.config.diffMin}~${this.config.diffMax} °C`
        );

        // 按新的动作限值立即刷新触点状态
        this.update(this.temperature);
        this._refreshCache();
    }

    // 返回部件中心的世界坐标（供工作流箭头定位）
    getClickablePartCenter(partId) {
        const gx = this.group.x(), gy = this.group.y();
        switch (partId) {
            case 'setscrew':   return { x: gx + 33,  y: gy + 21 };     // 设定值调节螺钉
            case 'diffscrew':  return { x: gx + 89,  y: gy + 341 };    // 幅差调节螺钉
            case 'nc':         return { x: gx + 277, y: gy + 8 };      // NC 接线端子
            case 'no':
            case 'contact-no': return { x: gx + 277, y: gy + 49 };     // NO 接线端子/触点
            case 'com':        return { x: gx + 277, y: gy + 89 };     // COM 接线端子
            case 'bulb':       return { x: gx + 349, y: gy + 365 };    // 感温包
            case 'scale':      return { x: gx + 97,  y: gy + 49 };     // 刻度盘
            default:           return null;
        }
    }

    destroy() {
        super.destroy?.();
    }
}