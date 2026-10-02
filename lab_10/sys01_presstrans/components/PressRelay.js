import { BaseComponent } from './BaseComponent.js';

/**
 * 压力继电器组件（PressRelay）
 *
 * 功能概述：
 * - 模拟机械式压力继电器（波纹管、杠杆、刀形触点等机械传动链）的外观与动作逻辑；
 * - 根据输入压力与设定给定值/幅差计算触点通断（`isEnergized`），并以动画表现杠杆、
 *   波纹管、动静触点等变化；
 * - 支持通过螺钉交互调整给定值（`setPoint`）与幅差（`differential`）；
 * - 内部单位和参数：给定值以百分比表示（0-100），低/高量程等使用 MPa 相关映射。
 *
 * 遵循新组件模板：
 *  - 构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`（最后 `addPort`）；
 *  - `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`；
 *  - 静态部件入 `_staticGroup` 一次缓存，动态机构入 `_dynamicGroup` in-place 更新，
 *    运行时不再刷新静态缓存（不使用 shadow）。
 */
export class PressRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.scale = 0.8;
        this.width  = 340 * this.scale;
        this.height = 420 * this.scale;

        this.type    = 'relay';
        this.special = 'pressrelay';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, model: this.model,
            lowStart: this.lowStart, lowEnd: this.lowEnd,
            diffStart: this.diffStart, diffEnd: this.diffEnd,
            lowSet: this.lowSet, highSet: this.highSet,
        };

        // 接线端子（右上方，自上而下 NC / NO / COM）与气压输入口（下方）
        this.addPort(this.w + 5 * this.scale, 10 * this.scale, 'NC', 'wire');
        this.addPort(this.w + 5 * this.scale, 60 * this.scale, 'NO', 'wire');
        this.addPort(this.w + 5 * this.scale, 110 * this.scale, 'COM', 'wire');
        this.addPort(this.w - 45 * this.scale, this.h + 5 * this.scale, 'i', 'pipe', 'in');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = 340 * this.scale;
        this.h = 420 * this.scale;
        this._viewX = 5;
        this._viewY = 5;
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.model = config.model || 'YT1226';

        // 核心物理状态
        this.pressure = 0;
        this.setPoint = config.setPoint || 50;         // 给定值百分比
        this.differential = config.differential || 50; // 幅差百分比
        this.isEnergized = true;
        this.setValueStep = 2;   // 给定值螺钉每格步长（%）
        this.diffStep = 2;       // 幅差螺钉每格步长（%）

        this.lowStart = config.lowStart || 0.0;
        this.lowEnd = config.lowEnd || 0.2;
        this.diffStart = config.diffStart || 0.07;
        this.diffEnd = config.diffEnd || 0.25;

        this.lowSet = this.lowStart + (this.lowEnd - this.lowStart) * this.setPoint / 100;
        this.highSet = this.lowSet + this.diffStart + (this.diffEnd - this.diffStart) * this.differential / 100;

        this.scaleTextElements = [];
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._updateDynamic();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        this.viewGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale, x: this._viewX, y: this._viewY });
        this._staticGroup.add(this.viewGroup);

        const bx = 340, by = 420;

        // 1. 背景外壳
        this.viewGroup.add(new Konva.Rect({
            width: bx, height: by - 80, fill: '#f8f9fa', stroke: '#333', strokeWidth: 2, cornerRadius: 4,
        }));

        // 2. 给定值刻度指示牌（静态）
        const scaleGroup = new Konva.Group({ x: 85, y: 40 });
        scaleGroup.add(new Konva.Rect({ width: 30, height: 40, fill: '#eee', stroke: '#ccc', strokeWidth: 1 }));
        for (let i = 0; i <= 10; i++) {
            const yPos = 40 - (i * 4);
            const isLong = i % 5 === 0;
            scaleGroup.add(new Konva.Line({
                points: [0, yPos, isLong ? 10 : 6, yPos], stroke: '#333', strokeWidth: 1,
            }));
            if (isLong) {
                const t = new Konva.Text({
                    x: 12, y: yPos - 5,
                    text: (this.lowStart + (i / 10) * (this.lowEnd - this.lowStart)).toFixed(1),
                    fontSize: 10, fill: '#666',
                });
                scaleGroup.add(t);
                this.scaleTextElements.push(t);
            }
        }
        this.viewGroup.add(scaleGroup);

        // 3. 杠杆支点底座
        this.viewGroup.add(new Konva.Path({ x: 220, y: 280, data: 'M -10 15 L 10 15 L 0 0 Z', fill: '#333' }));

        // 4. 幅差机构外罩（静态）
        this.viewGroup.add(new Konva.Rect({ x: 105 - 40, y: 340, width: 80, height: 80, stroke: '#444', strokeWidth: 2, fill: '#eee' }));

        // 5. 波纹管外罩（静态）
        this.viewGroup.add(new Konva.Rect({ x: 290 - 34, y: 340, width: 70, height: 78, stroke: '#444', strokeWidth: 2, fill: '#eee' }));

        // 6. 触点系统（静触点/连接线/动触点颜色随通断变化，统一放入动态组绘制）

        // 7. 铭牌标题（静态）
        this.title = new Konva.Text({
            x: 100, y: 100,
            text: `型号：${this.model}\n调节范围：${this.lowStart}~${this.lowEnd} MPa\n切换差：${this.diffStart}~${this.diffEnd}MPa`,
            fontSize: 15, fontFamily: 'Calibri', fill: '#0930f2',
            width: 200, align: 'left', lineHeight: 1.2,
        });
        this.viewGroup.add(this.title);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 与静态 viewGroup 同变换的动态视图组
        this._dynView = new Konva.Group({ scaleX: this.scale, scaleY: this.scale, x: this._viewX, y: this._viewY });
        this._dynamicGroup.add(this._dynView);

        // 1. 给定值螺钉 + 指针 + 主弹簧
        this.setScrew = new Konva.Rect({ x: 15, y: -20, width: 40, height: 80, fill: '#0c7b08', stroke: '#333' });
        this.screwPointer = new Konva.Line({ points: [55, 40, 90, 40], stroke: '#ff0000', strokeWidth: 2 });
        this.mainSpring = new Konva.Line({ x: 47, y: 60, points: this._getSpringPoints(215), stroke: '#444', strokeWidth: 4 });
        this._dynView.add(this.setScrew, this.screwPointer, this.mainSpring);

        // 2. 幅差机构（螺钉、弹簧、顶板、刻度牌、指针）
        const diffGroup = new Konva.Group({ x: 105, y: 340 });
        this.diffScrew = new Konva.Rect({ x: -30, y: 60, width: 60, height: 40, fill: '#077d59' });
        this.diffSpring = new Konva.Line({ x: 0, y: 0, points: this._getSpringPoints(60), stroke: '#888', strokeWidth: 2 });
        this.diffTop = new Konva.Rect({ x: -30, y: 0, width: 60, height: 10, fill: '#555' });

        this.diffScalePlate = new Konva.Group({ x: -40, y: 100 });
        this.diffScalePlate.add(new Konva.Rect({ width: 80, height: 20, fill: '#a7a5e8', cornerRadius: 2 }));
        this.diffNumbers = new Konva.Group({ y: 3 });
        // 预建 11 个数字节点，运行时 in-place 更新（不销毁重建）
        this._diffNumTexts = [];
        for (let i = 0; i <= 10; i++) {
            const t = new Konva.Text({ x: 40, y: 0, text: i.toString(), fontSize: 14, fill: '#fff' });
            this.diffNumbers.add(t);
            this._diffNumTexts.push(t);
        }
        this.diffScalePlate.add(this.diffNumbers);

        this.diffPointer = new Konva.Line({ points: [0, 0, 0, 20], stroke: 'red', strokeWidth: 4, x: 0, y: 75 });

        diffGroup.add(this.diffScrew, this.diffSpring, this.diffTop, this.diffScalePlate, this.diffPointer);
        this._dynView.add(diffGroup);
        this.diffGroup = diffGroup;

        // 3. 主杠杆（绕支点转动）
        this.leverGroup = new Konva.Group({ x: 220, y: 280 });
        this.leverBar = new Konva.Line({ points: [-185, 0, 65, 0], stroke: '#8b4513', strokeWidth: 10, lineCap: 'round' });
        this.limitBolt = new Konva.Rect({ x: -122.5, y: 0, width: 15, height: 45, fill: '#999', stroke: '#333' });

        // 刀型片：用 evenodd 填充规则在单条路径中挖出镂空窗口（避免 destination-out 破坏下层）
        this.knifeBlade = new Konva.Path({
            data: 'M 0 -5 L 55 -5 L 55 -105 L 15 -105 L 15 -80 L 0 -80 Z M 25 -70 L 45 -70 L 45 -15 L 25 -15 Z',
            fill: '#c0c0c0', stroke: '#444', strokeWidth: 2, fillRule: 'evenodd',
        });
        this.elasticPlate = new Konva.Line({ x: 40, y: 0, points: [0, -107, 0, -197], stroke: '#979dc7', strokeWidth: 4, lineCap: 'round' });
        this.leverGroup.add(this.leverBar, this.limitBolt, this.knifeBlade, this.elasticPlate);
        this._dynView.add(this.leverGroup);

        // 4. 输入波纹管（可动波纹体）
        this.bellowsBody = new Konva.Path({
            data: 'M -25 0 L 25 0 L 20 5 L 25 10 L 20 15 L 25 20 L 20 25 L 25 30 L -25 30 L -20 25 L -25 20 L -20 15 L -25 10 L -20 5 Z',
            fill: '#90caf9', stroke: '#1565c0', strokeWidth: 1.5, scaleY: 1.5, x: 290, y: 340,
        });
        this._dynView.add(this.bellowsBody);

        // 5. 触点系统动态部分（静触点、连线、动触点、动触点连杆、弯曲簧片——颜色随通断变化）
        const swDyn = new Konva.Group({ x: 260, y: 0 });
        this.contactNC = new Konva.Circle({ x: -30, y: 55, radius: 6, fill: '#7d7c78', stroke: '#333' });
        this.contactNO = new Konva.Circle({ x: 30, y: 55, radius: 6, fill: '#777', stroke: '#333' });
        this.wireCOM = new Konva.Line({ x: 0, y: 105, points: [0, 0, 80, 0], stroke: '#555', strokeWidth: 4 });
        this.wireCOMBase = new Konva.Rect({ x: -5, y: 100, width: 10, height: 10, stroke: '#444', strokeWidth: 2, fill: '#141212' });
        this.wireNO = new Konva.Line({ x: 35, y: 55, points: [0, 0, 50, 0], stroke: '#8b8a89', strokeWidth: 4 });
        this.wireNC = new Konva.Line({ x: -29, y: 5, points: [0, 0, 104, 0], stroke: '#848985', strokeWidth: 4 });
        this.wireNCUp = new Konva.Line({ x: -29, y: 50, points: [0, 0, 0, -47], stroke: '#848985', strokeWidth: 4 });
        this.movingContact = new Konva.Circle({ x: 0, y: 55, radius: 5.5, fill: '#858382', stroke: '#000' });
        this.movingRod = new Konva.Line({ x: 0, y: 0, points: [0, 105, 25, 55], stroke: '#555', strokeWidth: 4 });
        this.toggleSpring = new Konva.Path({ stroke: '#4c08f8', strokeWidth: 4, lineCap: 'round' });
        swDyn.add(this.contactNC, this.contactNO, this.wireCOM, this.wireCOMBase, this.wireNO, this.wireNC, this.wireNCUp,
                  this.movingContact, this.movingRod, this.toggleSpring);
        this._dynView.add(swDyn);

        // 6. 传动杆（波纹管底部 → 杠杆末端）
        this.connectingRod = new Konva.Line({ stroke: '#333', strokeWidth: 4, lineCap: 'round' });
        this._dynView.add(this.connectingRod);
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -15 : 15, (i / coils) * h);
        }
        return pts;
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        // 给定值螺钉：上/下半部点击 ±1 格
        this.setScrew.on('mousedown touchstart', (e) => {
            const pos = this.setScrew.getRelativePointerPosition();
            const halfHeight = this.setScrew.height() / 2;
            this.turnSetScrew(pos.y < halfHeight ? 1 : -1);
        });
        this.setScrew.on('dblclick', (e) => { e.cancelBubble = true; });
        this.setScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.setScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));

        // 幅差螺钉：左/右半部点击 ±1 格
        this.diffScrew.on('mousedown touchstart', (e) => {
            const pos = this.diffScrew.getRelativePointerPosition();
            const halfWidth = this.diffScrew.width() / 2;
            this.turnDiffScrew(pos.x > halfWidth ? 1 : -1);
        });
        this.diffScrew.on('dblclick', (e) => { e.cancelBubble = true; });
        this.diffScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.diffScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新（in-place）
    // ═══════════════════════════════════════════════════════

    _updateDynamic() {
        // 1. 杠杆受力平衡微位移（绕支点 220,280 旋转）
        const forceEffect = (this.pressure - this.lowSet) / (this.highSet - this.lowSet) * 4;
        const targetRot = Math.max(-10, Math.min(10, forceEffect));
        this.leverGroup.rotation(-targetRot);

        // 2. 波纹管压缩（pressure 0→拉伸 scaleY=2，1→scaleY=1.2）
        const safeP = Math.max(0, Math.min(1, this.pressure));
        const bScaleY = 2 - (safeP * 0.8);
        this.bellowsBody.scaleY(bScaleY);

        // 3. 机械传动链——弹性片顶点
        const drift = -targetRot * 3.5;
        const epTopX = (40 + drift) + (220 - 260);
        const epTopY = -197 + 280 + 5;

        // 4. 动触点位置（励磁→左/NC 侧，释放→右/NO 侧）
        const contactX = this.isEnergized ? -20 : 20;
        this.movingContact.x(contactX);
        this.movingRod.points([0, 105, contactX, 55]);

        const rodPointX = contactX * 0.75;
        const rodPointY = 105 + (55 - 105) * 0.75;
        const midX = (epTopX + rodPointX) / 2;
        const midY = (epTopY + rodPointY) / 2;
        const bendAmount = this.isEnergized ? 30 : -30;
        this.toggleSpring.data(`M ${epTopX} ${epTopY} Q ${midX + bendAmount} ${midY} ${rodPointX} ${rodPointY}`);

        // 5. 传动杆（波纹管底部 → 杠杆末端）
        const bellowsBottomY = 340 + (30 * bScaleY);
        const rad = (targetRot * Math.PI) / 180;
        const leverEndX = 220 + 70 * Math.cos(rad);
        const leverEndY = 280 - 70 * Math.sin(rad);
        this.connectingRod.points([290, bellowsBottomY, leverEndX, leverEndY]);

        // 6. 颜色与视觉反馈（低压励磁：NC 侧绿；高压释放：NO 侧红）
        if (this.isEnergized) {
            this.contactNO.fill('#a8a4a4'); this.wireNO.stroke('#a8a4a4');
            this.contactNC.fill('#08f818'); this.movingContact.fill('#08f818');
            this.movingRod.stroke('#08f818'); this.wireCOM.stroke('#08f818');
            this.wireNC.stroke('#08f818'); this.wireNCUp.stroke('#08f818');
        } else {
            this.contactNO.fill('#f40a0a'); this.wireNO.stroke('#f40a0a');
            this.contactNC.fill('#7e807e'); this.movingContact.fill('#f40a0a');
            this.movingRod.stroke('#f40a0a'); this.wireCOM.stroke('#f40a0a');
            this.wireNC.stroke('#a8a4a4'); this.wireNCUp.stroke('#a8a4a4');
        }

        // 7. 给定值螺钉与主弹簧随动
        const screwBottomY = -20 + 80 - (this.setPoint - 50) * 0.4;
        this.setScrew.y(-20 - (this.setPoint - 50) * 0.4);
        this.screwPointer.y(screwBottomY - 40);
        const leverLeftY = 280 + 185 * Math.sin(rad);
        const springLen = leverLeftY - screwBottomY;
        this.mainSpring.x(47);
        this.mainSpring.y(screwBottomY);
        this.mainSpring.points(this._getSpringPoints(springLen));

        // 8. 幅差机构随动
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
            const currentSpringH = 60 - topCurrentY;
            this.diffTop.y(-diffBaseY + topCurrentY);
            this.diffSpring.y(-diffBaseY + topCurrentY);
            this.diffSpring.points(this._getSpringPoints(currentSpringH));
        }

        // 9. 幅差刻度数字（预建节点 in-place 更新）
        const currentVal = this.differential / 10;
        const spacing = 40;
        this._diffNumTexts.forEach((t, i) => {
            const xOffset = (i - currentVal) * spacing;
            const inWindow = Math.abs(xOffset) < 60;
            t.visible(inWindow);
            if (inWindow) {
                t.x(40 + xOffset - 5);
                const nearCenter = Math.abs(xOffset) < 5;
                t.fill(nearCenter ? 'red' : '#fff');
                t.fontStyle(nearCenter ? 'bold' : 'normal');
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    // 更新
    // ═══════════════════════════════════════════════════════

    update(p) {
        if (p !== undefined) this.pressure = p;

        // 由给定值与幅差实时换算动作上/下限
        this.lowSet = this.lowStart + (this.lowEnd - this.lowStart) * this.setPoint / 100;
        this.highSet = this.lowSet + this.diffStart + (this.diffEnd - this.diffStart) * this.differential / 100;
        if (this.config) {
            this.config.lowSet = this.lowSet.toFixed(3);
            this.config.highSet = this.highSet.toFixed(3);
        }

        // 双位滞后：低于下限励磁、高于上限释放，中间保持
        if (this.pressure < this.lowSet) this.isEnergized = true;
        else if (this.pressure > this.highSet) this.isEnergized = false;

        this._updateDynamic();
        this.sys.requestRedraw();
    }

    tick() {
        // 继电器无自主动画，状态由求解器经 update() 驱动
    }

    // ═══════════════════════════════════════════════════════
    // 螺钉程序化调节（供工作流自动演示）
    // ═══════════════════════════════════════════════════════

    /** 调节给定值螺钉：dir=+1 增大，dir=-1 减小（步长 setValueStep） */
    turnSetScrew(dir) {
        this.setPoint = Math.max(0, Math.min(100, this.setPoint + dir * this.setValueStep));
        this.update(this.pressure);
    }

    /** 调节幅差螺钉：dir=+1 增大，dir=-1 减小（步长 diffStep） */
    turnDiffScrew(dir) {
        this.differential = Math.max(0, Math.min(100, this.differential + dir * this.diffStep));
        this.update(this.pressure);
    }

    // ═══════════════════════════════════════════════════════
    // 定位辅助
    // ═══════════════════════════════════════════════════════

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    /** viewGroup 局部坐标 → 舞台绝对坐标（计入 viewGroup 偏移与缩放） */
    _vAbs(vx, vy) {
        return this._toAbs(this._viewX + vx * this.scale, this._viewY + vy * this.scale);
    }

    /** 返回部件中心的世界坐标（供工作流箭头定位） */
    getClickablePartCenter(partId) {
        switch (partId) {
            case 'setscrew':   return this._vAbs(35, 20 - (this.setPoint - 50) * 0.4);
            case 'scale':      return this._vAbs(100, 60);
            case 'diffscrew':  return this._vAbs(105, 420 - this.differential * 0.2);
            case 'diffscale':  return this._vAbs(105, 450);
            case 'lever':      return this._vAbs(220, 280);
            case 'bellows':    return this._vAbs(290, 340);
            case 'contact':    return this._vAbs(260, 55);
            case 'no':         return this._toAbs(this.w + 5 * this.scale, 60 * this.scale);
            case 'nc':         return this._toAbs(this.w + 5 * this.scale, 10 * this.scale);
            case 'com':        return this._toAbs(this.w + 5 * this.scale, 110 * this.scale);
            case 'i':          return this._toAbs(this.w - 45 * this.scale, this.h + 5 * this.scale);
            default:           return null;
        }
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '器件型号', key: 'model', type: 'text' },
            { label: '给定值下限', key: 'lowStart', type: 'number' },
            { label: '给定值上限', key: 'lowEnd', type: 'number' },
            { label: '幅差下限', key: 'diffStart', type: 'number' },
            { label: '幅差上限', key: 'diffEnd', type: 'number' },
            { label: '压力下限', key: 'lowSet', type: 'number' },
            { label: '压力上限', key: 'highSet', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.model) this.model = newConfig.model;
        if (newConfig.lowStart !== undefined) this.lowStart = newConfig.lowStart;
        if (newConfig.lowEnd !== undefined) this.lowEnd = newConfig.lowEnd;
        if (newConfig.diffStart !== undefined) this.diffStart = newConfig.diffStart;
        if (newConfig.diffEnd !== undefined) this.diffEnd = newConfig.diffEnd;

        this.config = newConfig;

        // 重建静态视觉（刻度标签、铭牌）与动态机构
        this._rebuild();
    }

    _rebuild() {
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this.scaleTextElements = [];
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._updateDynamic();
    }

    destroy() {
        super.destroy?.();
    }
}
