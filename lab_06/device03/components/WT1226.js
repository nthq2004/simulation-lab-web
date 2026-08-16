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
        this.model = config.model || 'WT1226';

        // 核心物理状态：使用温度 (摄氏度)
        this.temperature = 0; // 当前温度，单位 °C
        this.setPoint = config.setPoint || 50; // 给定值 (相当于压力继电器的低压设定)，单位 °C
        this.differential = config.differential || 50; // 切换差 (百分数)，代表幅差占量程的百分比

        // 温度调节范围 (取代原来的压力范围)
        this.tempMin = config.tempMin || 0.0;   // 温度下限 (如 0°C)
        this.tempMax = config.tempMax || 100.0; // 温度上限 (如 100°C)
        this.diffMin = config.diffMin || 5.0;   // 最小切换差 (如 5°C)
        this.diffMax = config.diffMax || 30.0;  // 最大切换差 (如 30°C)

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
                this.scaleTextElements.push(textElement);
            }
        }

        // --- 设定螺钉交互 ---
        this.setScrew.on('mousedown touchstart', (e) => {
            const pos = this.setScrew.getRelativePointerPosition();
            const halfHeight = this.setScrew.height() / 2;
            if (pos.y < halfHeight) {
                this.setPoint = Math.min(100, this.setPoint + 2);
            } else {
                this.setPoint = Math.max(0, this.setPoint - 2);
            }
            this.update(this.temperature);
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
        this.diffScrew.on('mousedown touchstart', (e) => {
            const pos = this.diffScrew.getRelativePointerPosition();
            const halfWidth = this.diffScrew.width() / 2;
            if (pos.x > halfWidth) {
                this.differential = Math.min(100, this.differential + 2);
            } else {
                this.differential = Math.max(0, this.differential - 2);
            }
            this.update(this.temperature);
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
            fontSize: 10,
            fill: '#1565c0',
            fontStyle: 'bold'
        });
        this.bellows.add(this.bellowsCover, this.bellowsBody, bellowLabel);

        // 传动杆 (波纹管顶部 -> 杠杆右端)
        this.connectingRod = new Konva.Line({ stroke: '#333', strokeWidth: 4, lineCap: 'round' });

        // --- 7. 新增：独立感温包 (通过毛细管连接到波纹管) ---
        // 感温包主体：位于设备外壳外部，画在右下角更靠下的位置
        this.bulbGroup = new Konva.Group({ x: 270, y: 390 });
        // 感温包外壳 (铜色圆角矩形)
        const bulbBody = new Konva.Rect({
            x: -20, y: 0,
            width: 60, height: 40,
            fill: '#d4a373',
            stroke: '#8b5a2b',
            strokeWidth: 2,
            cornerRadius: 6
        });
        // 感温包内部波纹 (装饰)
        const bulbRibbon = new Konva.Line({
            points: [-15, 10, 15, 10, -15, 20, 15, 20, -15, 30, 15, 30],
            stroke: '#b8834a',
            strokeWidth: 2,
            tension: 0.5
        });
        // 感温包标签
        const bulbLabel = new Konva.Text({
            x: -10, y: 12,
            text: '感温包',
            fontSize: 12,
            fill: '#fff',
            fontStyle: 'bold'
        });
        this.bulbGroup.add(bulbBody, bulbRibbon, bulbLabel);
        this.viewGroup.add(this.bulbGroup);

        // 毛细管：从感温包顶部连接到波纹管的气压输入口 (即波纹管底部中心偏左的位置)
        // 使用一条平滑的曲线，模拟毛细管
        this.capillaryTube = new Konva.Line({
            points: [
                270, 390, // 感温包顶部中心
                300, 370, // 中间过渡点
                290, 360  // 波纹管底部输入口位置
            ],
            stroke: '#b87333',
            strokeWidth: 3,
            tension: 0.4,
            lineCap: 'round',
            lineJoin: 'round'
        });
        this.viewGroup.add(this.capillaryTube);

        // 在毛细管连接处添加一个小圆点表示接头
        const joint = new Konva.Circle({
            x: 290, y: 360,
            radius: 4,
            fill: '#b87333',
            stroke: '#8b5a2b',
            strokeWidth: 1
        });
        this.viewGroup.add(joint);

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

        // ----- 1. 波纹管压缩 (保留原有的压力驱动逻辑) -----
        // 波纹管仍然由模拟压力值驱动，保持其原有的机械动态
        const bScaleY = 1.2 + pressureSim * 0.8;
        this.bellowsBody.scaleY(bScaleY);

        // ----- 2. 感温包膨胀 (新增独立动画) -----
        // 感温包随温度变化而膨胀/收缩，与波纹管同步动作，但视觉上独立
        // 温度越高，感温包越膨胀 (scaleX, scaleY 同时变化)
        const bulbScale = 0.8 + pressureSim * 0.4; // 范围 0.8 ~ 1.2
        this.bulbGroup.scaleX(bulbScale);
        this.bulbGroup.scaleY(bulbScale);

        // 毛细管随感温包位置微调 (保持连接)
        // 由于感温包缩放，其中心位置会略微偏移，微调毛细管端点
        const bulbCenterX = 270 + (bulbScale - 1) * 10; // 近似补偿
        const bulbCenterY = 390 + (bulbScale - 1) * 8;
        this.capillaryTube.points([
            bulbCenterX, bulbCenterY,
            300, 370,
            290, 360
        ]);

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

    // 配置字段
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '器件型号', key: 'model', type: 'text' },
            { label: '温度下限 (°C)', key: 'tempMin', type: 'number' },
            { label: '温度上限 (°C)', key: 'tempMax', type: 'number' },
            { label: '切换差下限 (°C)', key: 'diffMin', type: 'number' },
            { label: '切换差上限 (°C)', key: 'diffMax', type: 'number' },
            { label: '动作下限 (计算值)', key: 'lowSet', type: 'number', readonly: true },
            { label: '动作上限 (计算值)', key: 'highSet', type: 'number', readonly: true }
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

        this.lowSet = this.tempMin + (this.tempMax - this.tempMin) * (this.setPoint / 100);
        this.highSet = this.lowSet + this.diffMin + (this.diffMax - this.diffMin) * (this.differential / 100);

        this.config = {
            ...this.config,
            ...newConfig,
            lowSet: this.lowSet,
            highSet: this.highSet
        };

        this.scaleTextElements.forEach((textElement, index) => {
            if (index < 11) {
                const tempValue = this.tempMin + index * (this.tempMax - this.tempMin) / 10;
                textElement.text(tempValue.toFixed(0));
            }
        });

        this.title.text(
            `型号：${this.config.model}\n温度范围：${this.config.tempMin}~${this.config.tempMax} °C\n切换差：${this.config.diffMin}~${this.config.diffMax} °C`
        );

        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}