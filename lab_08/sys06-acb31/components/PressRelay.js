import { BaseComponent } from './BaseComponent.js';

/**
 * 压力继电器组件（PressRelay）
 *
 * 功能概述：
 * - 模拟机械式压力继电器（带波纹管、杠杆、刀形触点等机械传动链）的外观与动作逻辑；
 * - 根据输入压力与设定给定值/幅差计算触点通断（`isEnergized`），并通过视觉动画表现杠杆、波纹管、动静触点等变化；
 * - 支持通过螺钉交互调整给定值（`setPoint`）与幅差（`differential`），并通过 `getConfigFields` / `onConfigUpdate` 暴露可编辑字段；
 * - 内部单位和参数：给定值以百分比表示（0-100），低量程/高量程等使用 MPa 相关的百分比映射。
 *
 * 注：此文件仅添加文档注释以便维护，未修改核心仿真/动画逻辑。
 */
export class PressRelay extends BaseComponent {
    /**
     * 构造器：初始化尺寸、状态、可视元素并注册端口
     * @param {Object} config - 配置对象，可含 model, setPoint, differential, lowStart/lowEnd/diffStart/diffEnd 等
     * @param {Object} sys - 全局系统对象（用于回调与重绘）
     */
    constructor(config, sys) {
        super(config, sys);
        this.scale = 0.8;
        this.w = 340 * this.scale;
        this.h = 420 * this.scale;

        this.type = 'relay';
        this.special = 'pressrelay';
        this.cache = 'fixed';
        this._initGroups();
        this.model = config.model || 'YT1226';

        // 核心物理状态
        this.pressure = 0;
        this.setPoint =config.setPoint || 50;
        this.differential = config.differential || 50;
        this.isEnergized = true;

        this.lowStart = config.lowStart ||0.0;
        this.lowEnd = config.lowEnd ||0.2;
        this.diffStart = config.diffStart ||0.07;
        this.diffEnd = config.diffEnd ||0.25;

        this.lowSet = this.lowEnd*this.setPoint/100;
        this.highSet = this.lowSet+this.diffStart+(this.diffEnd-this.diffStart)*this.differential/100;

        this.config = {id:this.id,model:this.model,lowStart:this.lowStart,lowEnd:this.lowEnd,diffStart:this.diffStart,diffEnd:this.diffEnd,lowSet:this.lowSet,highSet:this.highSet};

        this.scaleTextElements = [];

        this.initVisuals();

        // 端口设置 (3个接线端子位于右上方)
        this.addPort(this.w + 5* this.scale, 10 * this.scale, 'NO', 'wire');
        // this.addPort(this.w + 5, 60, 'nc', 'wire');
        this.addPort(this.w + 5* this.scale, 110 * this.scale, 'COM', 'wire');
        this.addPort(this.w - 45 * this.scale, this.h + 5* this.scale, 'i', 'pipe','in');

        this.update(0);
    }

    initVisuals() {
        // 构建静态视觉元素：外壳、弹簧、手轮/螺钉、杠杆、波纹管与触点系统
        // 将这些静态元素加入 `_staticGroup`，利用组件缓存提升渲染性能
        this.viewGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale, x: 5, y: 5 });
        this._staticGroup.add(this.viewGroup);

        const bx = 340, by = 420;

        // --- 1. 背景外壳 ---
        this.viewGroup.add(new Konva.Rect({
            width: bx, height: by - 80, fill: '#f8f9fa', stroke: '#333', strokeWidth: 2, cornerRadius: 4
        }));

        // --- 2. 左侧：给定弹簧机构 (拉动弹簧) ---
        this.setScrew = new Konva.Rect({ x: 15, y: -20, width: 40, height: 80, fill: '#0c7b08', stroke: '#333' });
        // 红色指针 (属于 setScrew，随螺钉移动)
        this.screwPointer = new Konva.Line({
            points: [55, 40, 90, 40], // 从螺钉中心指向右侧刻度
            stroke: '#ff0000', strokeWidth: 2
        });

        this.mainSpring = new Konva.Line({ x: 47, y: 60, points: this._getSpringPoints(215), stroke: '#444', strokeWidth: 4 });
        // --- 8. 设定值指示系统 ---
        this.scaleGroup = new Konva.Group({ x: 85, y: 40 }); // 位于螺钉右侧

        // 指示牌底色
        const plate = new Konva.Rect({
            width: 30, height: 40, fill: '#eee', stroke: '#ccc', strokeWidth: 1
        });
        this.scaleGroup.add(plate);

        // 生成 10 个刻度线 (0 到 0.2 MPa)
        for (let i = 0; i <= 10; i++) {
            const yPos = 40 - (i * 4); // 从下往上画
            const isLong = i % 5 === 0;

            // 刻度线
            this.scaleGroup.add(new Konva.Line({
                points: [0, yPos, isLong ? 10 : 6, yPos],
                stroke: '#333', strokeWidth: 1
            }));

            // 文字标注 (只在 0, 0.1, 0.2 标注)
            // 把这里的三个 Konva.Text进行存储，用于后续更新
            let textElement;
            if (isLong) {
                textElement = new Konva.Text({
                    x: 12, y: yPos - 5,
                    text: (this.lowStart + (i / 10) * (this.lowEnd - this.lowStart)).toFixed(1),
                    fontSize: 10, fill: '#666'
                });
                this.scaleGroup.add(textElement);
                this.scaleTextElements.push(textElement);
            }
        }

        // --- 设定螺钉点击交互 ---
        this.setScrew.on('mousedown touchstart', (e) => {
            // 获取点击位置相对于螺钉顶部的偏移
            const pos = this.setScrew.getRelativePointerPosition();
            const halfHeight = this.setScrew.height() / 2;

            if (pos.y < halfHeight) {
                // 点击上半部分：增加 1% (假设量程 100)
                this.setPoint = Math.min(100, this.setPoint + 2);
            } else {
                // 点击下半部分：减少 1%
                this.setPoint = Math.max(0, this.setPoint - 2);
            }
            // 立即同步更新视觉
            this.update(this.pressure);


        });
        this.setScrew.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // 设置鼠标指针样式
        this.setScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.setScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));


        // --- 3. 左下：幅差调节与限位螺钉 ---
        this.diffGroup = new Konva.Group({ x: 105, y: 340 });
        this.diffScrew = new Konva.Rect({ x: -30, y: 60, width: 60, height: 40, fill: '#077d59' });
        this.diffSpring = new Konva.Line({ x: 0, y: 0, points: this._getSpringPoints(60), stroke: '#888', strokeWidth: 2 });
        this.diffTop = new Konva.Rect({ x: -30, y: 0, width: 60, height: 10, fill: '#555' });
        this.diffCover = new Konva.Rect({ x: -40, y: 0, width: 80, height: 80, stroke: '#444', strokeWidth: 2, fill: '#eee' });

        // 增加：幅差指示牌 (放在螺钉下方)
        this.diffScalePlate = new Konva.Group({ x: -40, y: 100 }); // 指示牌位置
        const plateBg = new Konva.Rect({
            width: 80, height: 20, fill: '#a7a5e8', cornerRadius: 2
        });
        // 指示窗口剪裁（可选，为了美观）
        this.diffScalePlate.add(plateBg);
        // 动态数字组 (我们将根据 diff 移动这个组)
        this.diffNumbers = new Konva.Group({ y: 3 });
        this.diffScalePlate.add(this.diffNumbers);

        // 红色指示指针 (固定在螺钉中心下方的窗口中心)
        this.diffPointer = new Konva.Line({
            points: [0, 0, 0, 20],
            stroke: 'red', strokeWidth: 4,
            x: 0, y: 75 // 指向指示牌中心
        });

        this.diffGroup.add(this.diffCover, this.diffScrew, this.diffSpring, this.diffTop, this.diffScalePlate, this.diffPointer);
        this.diffScrew.on('mousedown touchstart', (e) => {
            // 获取点击位置相对于螺钉顶部的偏移
            const pos = this.diffScrew.getRelativePointerPosition();
            const halfWidth = this.diffScrew.width() / 2;

            if (pos.x > halfWidth) {
                // 点击上半部分：增加 10% (假设量程 100)
                this.differential = Math.min(100, this.differential + 2);
            } else {
                // 点击下半部分：减少 10%
                this.differential = Math.max(0, this.differential - 2);
            }

            // 立即同步更新视觉
            this.update(this.pressure);

        });
        this.diffScrew.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // 设置鼠标指针样式
        this.diffScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.diffScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));



        // --- 4. 核心：主杠杆 (绕支点转动) ---
        // 支点固定在 (220, 280)
        this.leverGroup = new Konva.Group({ x: 220, y: 280 });
        this.leverBar = new Konva.Line({
            points: [-185, 0, 65, 0], stroke: '#8b4513', strokeWidth: 10, lineCap: 'round'
        });
        // 限位螺钉 (作用螺钉) - 位于杠杆下方
        this.limitBolt = new Konva.Rect({ x: -122.5, y: 0, width: 15, height: 45, fill: '#999', stroke: '#333' });

        // 刀型片：位于杠杆右端上方
        this.knifeBlade = new Konva.Group({ x: 0, y: 0, rotation: 0 }); // 初始化在支点位置
        // 外部 L 型刚性实体 (灰色)
        const bladePath = new Konva.Path({
            data: 'M 0 -5 L 55 -5 L 55 -105 L 15 -105 L 15 -80 L 0 -80 Z', // 刚性L型，顶部带刀型尖
            fill: '#c0c0c0', stroke: '#444', strokeWidth: 2
        });
        // 矩形镂空窗口
        const windowCutter = new Konva.Rect({
            x: 25, y: -70, // 镂空位置
            width: 20, height: 55, // 镂空大小
            fill: 'black', globalCompositeOperation: 'destination-out' // 剪裁模式
        });
        this.knifeBlade.add(bladePath, windowCutter);

        // 红色弹性片：被刀型片左右拨动
        this.elasticPlate = new Konva.Line({
            x: 40, y: 0, points: [0, -107, 0, -197], stroke: '#979dc7', strokeWidth: 4, lineCap: 'round'
        });

        this.leverGroup.add(this.leverBar, this.limitBolt, this.knifeBlade, this.elasticPlate);
        const pivotBase = new Konva.Path({ x: 220, y: 280, data: 'M -10 15 L 10 15 L 0 0 Z', fill: '#333' });

        // --- 5. 右下：输入波纹管 ---
        this.bellows = new Konva.Group({ x: 290, y: 340 });
        // 波纹管外罩 (固定)
        this.bellowsCover = new Konva.Rect({ x: -34, y: 0, width: 70, height: 78, stroke: '#444', strokeWidth: 2, fill: '#eee' });

        // 金属传动杆 (连接杠杆和波纹管底部)
        this.connectingRod = new Konva.Line({ stroke: '#333', strokeWidth: 4, lineCap: 'round' });
        this.bellowsBody = new Konva.Path({
            data: 'M -25 0 L 25 0 L 20 5 L 25 10 L 20 15 L 25 20 L 20 25 L 25 30 L -25 30 L -20 25 L -25 20 L -20 15 L -25 10 L -20 5 Z',
            fill: '#90caf9', stroke: '#1565c0', strokeWidth: 1.5, scaleY: 1.5
        });
        this.bellows.add(this.bellowsCover, this.bellowsBody);



        // --- 6. 右上：触点系统与输出端口 ---
        this.switchBox = new Konva.Group({ x: 260, y: 0 });
        // 静触点
        this.contactNC = new Konva.Circle({ x: -30, y: 55, radius: 6, fill: '#7d7c78', stroke: '#333' });
        this.contactNO = new Konva.Circle({ x: 30, y: 55, radius: 6, fill: '#777', stroke: '#333' });
        // 动触点 (挂在弹性片末端)
        this.movingContact = new Konva.Circle({ x: 0, y: 55, radius: 5.5, fill: '#858382', stroke: '#000' });
        this.movingRod = new Konva.Line({ x: 0, y: 0, points: [0, 105, 25, 55], stroke: '#555', strokeWidth: 4 });
        // 三根输出连线 (COM, NC, NO)

        this.wireCOM = new Konva.Line({ x: 0, y: 105, points: [0, 0, 80, 0], stroke: '#555', strokeWidth: 4 });
        this.wireCOMBase = new Konva.Rect({ x: -5, y: 100, width: 10, height: 10, stroke: '#444', strokeWidth: 2, fill: '#141212' });
        this.wireNO = new Konva.Line({ x: 35, y: 55, points: [0, 0, 50, 0], stroke: '#8b8a89', strokeWidth: 4 });
        this.wireNC = new Konva.Line({ x: -29, y: 5, points: [0, 0, 104, 0], stroke: '#848985', strokeWidth: 4 });
        this.wireNCUp = new Konva.Line({ x: -29, y: 50, points: [0, 0, 0, -47], stroke: '#848985', strokeWidth: 4 });

        // 增加：弯曲簧片 (弓形弹簧)
        this.toggleSpring = new Konva.Path({
            stroke: '#4c08f8',
            strokeWidth: 4,
            lineCap: 'round'
        });

        this.switchBox.add(this.contactNC, this.contactNO, this.wireCOM, this.movingContact, this.movingRod, this.wireCOMBase, this.wireNC, this.wireNCUp, this.wireNO, this.toggleSpring);

        const NOPort = new Konva.Circle({ x: 340, y: 55, radius: 6, fill: '#dee2e7', stroke: '#b3b6b9', strokeWidth: 1, });
        this.title = new Konva.Text({
            x: 100,
            y: 100,
            text: `型号：${this.config.model}\n调节范围：${this.config.lowStart}~${this.config.lowEnd} MPa\n切换差：${this.config.diffStart}~${this.config.diffEnd}MPa`, // 使用 \n 换行
            fontSize: 15,
            fontFamily: 'Calibri',
            fill: '#0930f2',
            width: 200,        // 设置宽度以便查看对齐效果
            align: 'left',    // 居中对齐：'left', 'center', 'right'
            lineHeight: 1.2     // 行间距，1.2 表示 1.2 倍字号高度
        });

        this.viewGroup.add(
            this.setScrew, this.screwPointer, this.scaleGroup, this.mainSpring, pivotBase, 
            this.diffGroup, this.leverGroup,this.bellows, this.switchBox, this.connectingRod, NOPort, this.title
        );
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -15 : 15, (i / coils) * h);
        }
        return pts;
    }

    update(p) {
        // 可选的输入参数 p（MPa），用于外部调用时直接设置当前压力
        if (p !== undefined) this.pressure = p;

        // 根据当前压力判断继电器是否励磁：
        // - 当 pressure < lowSet 时励磁
        // - 当 pressure > highSet 时退磁
        if (this.pressure < this.lowSet) {
            this.isEnergized = true;
        } else if (this.pressure > this.highSet) {
            this.isEnergized = false;
        }
        // 1. 杠杆受力平衡微位移 (绕支点 220, 280 旋转)
        // 1. 杠杆受力平衡微位移（把压力差映射为小角度旋转以表现机械位移）
        const forceEffect = (this.pressure - this.lowSet) / (this.highSet - this.lowSet) * 4;
        const targetRot = Math.max(-10, Math.min(10, forceEffect));
        this.leverGroup.rotation(-targetRot);

        // 2. 波纹管压缩
        // 2. 波纹管压缩：限制 pressure 到 [0,1] 范围，用于视觉缩放计算
        const safeP = Math.max(0, Math.min(1, this.pressure));

        // 计算缩放比例：pressure 为 0 时波纹管拉伸（scaleY=2），为 1 时接近原始（scaleY=1.2）
        const bScaleY = 2 - (safeP * 0.8);
        this.bellowsBody.scaleY(bScaleY);


        // 3. 机械传动链动画
        // --- a. 红色弹性片顶点坐标计算 (相对于 switchBox 坐标系) ---
        const drift = -targetRot * 3.5;
        // 弹性片在 leverGroup 中坐标 x:40, 顶点 y:-197
        // switchBox 在 viewGroup 坐标 (260, 0), leverGroup 在 (220, 280)
        const epTopX = (40 + drift) + (220 - 260);
        const epTopY = -197 + 280 + 5;

        // --- b. 动触点连杆 (movingRod) 运动与 3/4 点计算 ---
        // 3. 触点系统：根据 isEnergized 改变动触点位置（左右切换）
        const contactX = this.isEnergized ? -20 : 20;
        this.movingContact.x(contactX);

        // 连杆起点 (0, 105), 终点 (contactX, 55)
        this.movingRod.points([0, 105, contactX, 55]);

        // 计算连杆 3/4 处的点 (靠近终点端)
        // 插值公式: P = Start + (End - Start) * 0.75
        // 计算连杆上靠近动触点的 3/4 处点用于绘制弯曲簧片
        const rodPointX = 0 + (contactX - 0) * 0.75;
        const rodPointY = 105 + (55 - 105) * 0.75; // 结果为 67.5

        // --- c. 绘制弯曲簧片 (Toggle Spring) ---
        // 计算弯曲簧片的中间控制点并根据状态改变弯曲方向以模拟弹性形变
        const midX = (epTopX + rodPointX) / 2;
        const midY = (epTopY + rodPointY) / 2;

        const bendAmount = this.isEnergized ? 30 : -30;
        this.toggleSpring.data(`M ${epTopX} ${epTopY} Q ${midX + bendAmount} ${midY} ${rodPointX} ${rodPointY}`);

        // 4. 更新传动杆线段杠杆右端点在 leverGroup 坐标系中是 (70, 0)
        // 映射到 viewGroup 坐标系：
        // 起点 (x1, y1)：波纹管底部中心
        // 4. 传动杆连接：计算波纹管底部到杠杆末端的直线用于显示连接杆位置
        const bellowsX = 290;
        const bellowsBottomY = 340 + (30 * bScaleY);
        const rad = (targetRot * Math.PI) / 180;
        const leverEndX = 220 + 70 * Math.cos(rad);
        const leverEndY = 280 - 70 * Math.sin(rad);
        this.connectingRod.points([bellowsX, bellowsBottomY, leverEndX, leverEndY]);



        // 5. 颜色反馈
        // 5. 颜色与视觉反馈：不同状态下触点与连线的颜色变化
        if (this.isEnergized) {
            this.contactNO.fill('#a8a4a4'); // 绿色接通，低压启动。
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
            this.contactNC.fill('#7e807e'); // 红色接通，高压停止
            this.movingRod.stroke('#f40a0a');
            this.wireCOM.stroke('#f40a0a');
            this.wireNC.stroke('#a8a4a4');
            this.wireNCUp.stroke('#a8a4a4');
            this.wireNO.stroke('#f40a0a');
        }

        // 6. 螺钉与弹簧随动 更新设定弹簧 (核心逻辑)
        // 螺钉下端坐标
        // 6. 螺钉与弹簧随动：根据设定值移动螺钉位置和主弹簧的起点
        const screwBottomY = -20 + 80 - (this.setPoint - 50) * 0.4;
        this.setScrew.y(-20 - (this.setPoint - 50) * 0.4);
        this.screwPointer.y(screwBottomY - 40);

        // 杠杆左端点坐标 (相对于支点 220, 280 的位置是 -185, 0)
        // const leverLeftX = 220 - 185 * Math.cos(rad);
        const leverLeftY = 280 + 185 * Math.sin(rad);

        // 重新绘制弹簧线段
        // 重新计算弹簧长度并更新弹簧路径
        const springLen = leverLeftY - screwBottomY;
        this.mainSpring.x(47);
        this.mainSpring.y(screwBottomY);
        this.mainSpring.points(this._getSpringPoints(springLen));

        //7.幅差机构动态逻辑 (重点) ---

        // A. 设定导致的位移：增加时向上移动 (Y减小)
        // 假设设定值为0时在最下面，设定值为100时向上移动40像素
        // 7. 幅差机构动态逻辑：根据 differential 移动幅差螺钉与弹簧位置
        const diffBaseY = this.differential * 0.2;
        this.diffScrew.y(60 - diffBaseY);
        this.diffTop.y(-diffBaseY);
        this.diffSpring.y(-diffBaseY);

        // B. 计算限位螺钉(limitBolt)底部的全局 Y 坐标
        // limitBolt 在 leverGroup 中的 x 是 -122.5, height 是 40
        const boltRelX = -122.5 + 7.5; // 中心点
        const boltRelY = 45;
        const boltGlobalY = 280 + boltRelX * Math.sin(-rad) + boltRelY * Math.cos(rad);

        // C. 碰撞检测与弹簧压缩
        // diffTop 在 diffGroup 内部的原始 Y 是 0
        const topStaticY = -diffBaseY + 340;
        let topCurrentY = 0; // 相对于 diffGroup
        let currentSpringH = 60; // 默认弹簧高

        if (boltGlobalY > topStaticY) {
            // 如果杠杆限位螺钉压到了顶部
            topCurrentY = boltGlobalY - topStaticY;
            currentSpringH = 60 - topCurrentY; // 弹簧被压缩
            this.diffTop.y(- diffBaseY + topCurrentY);
            this.diffSpring.y(- diffBaseY + topCurrentY);
            this.diffSpring.points(this._getSpringPoints(currentSpringH));
        }
        // --- 幅差刻度动态生成 ---
        // 修改 update 方法中的幅差数字逻辑
        const currentVal = this.differential / 10; // 可能是 5.5
        const spacing = 40; // 两个数字间的像素距离

        this.diffNumbers.destroyChildren();

        for (let i = 0; i <= 10; i++) {
            // 计算每个数字相对于中心指针的偏移
            const xOffset = (i - currentVal) * spacing;

            // 只渲染在窗口可见范围内的数字
            if (Math.abs(xOffset) < 60) {
                this.diffNumbers.add(new Konva.Text({
                    x: 40 + xOffset - 5, // 40 是窗口中心
                    y: 0,
                    text: i.toString(),
                    fontSize: 14,
                    fill: Math.abs(xOffset) < 5 ? 'red' : '#fff', // 接近中心时变红
                    fontStyle: Math.abs(xOffset) < 5 ? 'bold' : 'normal'
                }));
            }
        }
        this._refreshCache();

    }
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '器件型号', key: 'model', type: 'text' },
            { label: '给定值下限', key: 'lowStart', type: 'number' },
            { label: '给定值上限', key: 'lowEnd', type: 'number' },
            { label: '幅差下限', key: 'diffStart', type: 'number' },
            { label: '幅差上限', key: 'diffEnd', type: 'number' },                        
            { label: '压力下限', key: 'lowSet', type: 'number' },
            { label: '压力上限', key: 'highSet', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        // 处理配置更新：同步属性并重新计算 lowSet/highSet
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.model) this.model = newConfig.model;

        if (newConfig.lowStart !== undefined) this.lowStart = newConfig.lowStart;
        if (newConfig.lowEnd !== undefined) this.lowEnd = newConfig.lowEnd;

        if (newConfig.diffStart !== undefined) this.diffStart = newConfig.diffStart;
        if (newConfig.diffEnd !== undefined) this.diffEnd = newConfig.diffEnd;

        this.config = newConfig;
        // 重新计算实际的低压触发与高压触发阈值（MPa）
        this.lowSet = (this.lowStart + (this.lowEnd - this.lowStart) * this.setPoint / 100);
        this.highSet = this.diffStart + (this.diffEnd - this.diffStart) * this.differential / 100 + this.lowSet;
        this.config.lowSet = this.lowSet.toFixed(3);
        this.config.highSet = this.highSet.toFixed(3);

        // 更新刻度文本（供编辑器实时反馈）
        this.scaleTextElements.forEach((textElement, index) => {
            if (index < 11) {
                textElement.text((this.lowStart + index * (this.lowEnd - this.lowStart) / 2).toFixed(1));
            }
        });

        // 更新右上角标题信息并刷新缓存
        this.title.text(`型号：${this.config.model}\n调节范围：${this.config.lowStart}~${this.config.lowEnd} MPa\n切换差：${this.config.diffStart}~${this.config.diffEnd}MPa`);
        this._refreshCache();


    }
    destroy() {
        super.destroy?.();
    }
}