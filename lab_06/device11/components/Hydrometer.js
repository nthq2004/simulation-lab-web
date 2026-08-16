import { BaseComponent } from './BaseComponent.js'; // 导入基础组件基类

export class Hydrometer extends BaseComponent { // 声明比重计组件类，继承自 BaseComponent
    constructor(config, sys) { // 构造函数
        super(config, sys); // 调用基类构造函数

        this.width  = Math.max(50, config.width  || 100); // 容器最小宽度限制
        this.height = Math.max(200, config.height || 420); // 容器最小高度限制

        this.type  = 'hydrometer'; // 组件类型标识
        this.cache = 'fixed'; // 启用固定缓存

        this._initGroups(); // 初始化静态/动态/交互图层
        this._recalcGeometry(); // 计算几何尺寸参数
        this._initParameters(config); // 初始化状态参数
        this._init(); // 绘制组件

        this.config = { // 保存配置对象
            specificGravity: this._sg, // 初始比重值
        };
    }

    _recalcGeometry() { // 根据组件尺寸重新计算关键几何参数
        const W = this.width, H = this.height; // 读取当前组件尺寸
        this._tubeX = W / 2; // 玻璃管中心 x 坐标
        this._tubeTop = 30; // 玻璃管顶部 y 坐标
        this._tubeBot = H - 30; // 玻璃管底部 y 坐标
        this._tubeH = this._tubeBot - this._tubeTop; // 玻璃管高度
        this._tubeW = Math.max(40, W * 0.6); // 玻璃管宽度

        this._bulbR = Math.max(24, W * 0.36); // 灌胶球半径（4倍面积 = 2倍半径）
        this._bulbY = this._tubeTop - this._bulbR; // 球心在玻璃管顶部正上方（底部与管顶相接）
        this._rubberY = this._tubeBot; // 橡胶塞顶部在玻璃管底部（向下延伸）
        this._rubberW = Math.max(8, W * 0.14); // 橡胶塞宽度
    }

    _initParameters(config) { // 初始化组件状态参数
        this._sg = Math.max(1.10, Math.min(1.35, parseFloat(config.specificGravity) || 1.25)); // 限制比重范围
        this._bulbPressed = false; // 灌胶球是否被按压
        this._animating = false; // 是否正在播放动画
        this._animProgress = 0; // 动画进度
        this._filling = false; // 是否正在充注电解液
        this._fillProgress = 0; // 充注进度 0~1
        this._fillStartSG = this._sg; // 充注起始比重
        this._fillTargetSG = this._sg; // 充注目标比重
        this._floatProgress = 0; // 浮子独立上升/下降进度 0~1
    }

    setSpecificGravity(v) { // 外部设置比重值
        this._sg = Math.max(1.10, Math.min(1.35, parseFloat(v) || 1.25)); // 限制比重范围
    }

    getSpecificGravity() { return this._sg; } // 返回当前比重值

    _init() { // 初始化绘制和交互逻辑
        this._drawStaticParts(); // 绘制静态部件
        this._createDynamicNodes(); // 创建动态节点
        this._bindInteraction(); // 绑定交互事件
    }

    _drawStaticParts() { // 绘制静态外观
        const W = this.width, H = this.height; // 读取尺寸
        const tx = this._tubeX, tt = this._tubeTop, tb = this._tubeBot, tw = this._tubeW; // 读取管子几何参数

        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, // 背景区域
            fill: 'transparent', listening: true, // 透明且不可交互
        }));

        const grad = new Konva.Rect({
            x: tx - tw / 2, y: tt, width: tw, height: tb - tt,
            fill: 'rgba(220,235,240,0.35)', stroke: 'rgba(180,200,210,0.7)', strokeWidth: 1.5,
            cornerRadius: [tw / 4, tw / 4, tw / 4, tw / 4],
            listening: false,
        });
        this._staticGroup.add(grad);
        grad.moveToTop();

        const innerW = tw * 0.35;



        // — 3. 底部吸管（从玻璃管底向下延伸） —
        const tubeLen = Math.max(48, H * 0.165); // 3 倍长度
        this._staticGroup.add(new Konva.Rect({
            x: tx - this._rubberW / 2, y: this._rubberY,
            width: this._rubberW, height: tubeLen,
            fill: '#606870', stroke: '#404850', strokeWidth: 1,
            cornerRadius: 2, listening: false,
        }));
        // 吸管尖端
        this._staticGroup.add(new Konva.Rect({
            x: tx - this._rubberW * 0.4, y: this._rubberY + tubeLen,
            width: this._rubberW * 0.8, height: Math.max(8, H * 0.03),
            fill: '#505860', stroke: '#303840', strokeWidth: 0.8,
            cornerRadius: [0, 0, 2, 2], listening: false,
        }));
    }

    _createDynamicNodes() { // 创建动态浮子和配重
        const tx = this._tubeX, tt = this._tubeTop, tb = this._tubeBot; // 读取管子参数

        const floatH = this._tubeH * 0.5; // 浮子总高度 = 外管一半
        const maxTop = tt + 10; // SG 最高时浮子顶 y
        const minTop = tb - floatH; // SG 最低时铅粒触底
        const sgRange = 1.30 - 1.15;
        const sgNorm = Math.max(0, Math.min(1, (this._sg - 1.15) / sgRange));
        const floatY = maxTop + (minTop - maxTop) * (1 - sgNorm);

        this._floatGroup = new Konva.Group({ x: tx, y: floatY, listening: false });
        const innerW = this._tubeW * 0.35;

        // 浮子结构比例（从顶到底）
        const topStemH = floatH * 0.10; // 上玻璃管柄高
        const bodyH    = floatH * 0.50; // 颜色刻度体高
        const leadR    = floatH * 0.10 / 3; // 铅粒半径（直径 1/3）
        const botStemH = floatH - topStemH - bodyH - 2 * leadR; // 下管柄延伸到铅粒顶部
        const stemW    = innerW * 0.8;   // 管柄宽度（比原来宽）
        const bodyY    = topStemH;

        // 顶部玻璃管柄
        this._floatGroup.add(new Konva.Rect({
            x: -stemW / 2, y: 0,
            width: stemW, height: topStemH,
            fill: 'rgba(200,220,230,0.35)', stroke: 'rgba(160,190,210,0.5)', strokeWidth: 0.5,
            cornerRadius: 1, listening: false,
        }));

        // 颜色刻度体（3 段：上红 中绿 下黄）
        const segH = bodyH / 3;
        this._colorRects = [];
        [
            { color: '#d03020' },
            { color: '#20a040' },
            { color: '#d0a020' },
        ].forEach((seg, i) => {
            const r = new Konva.Rect({
                x: -innerW / 2, y: bodyY + i * segH,
                width: innerW, height: segH,
                fill: seg.color, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 0.3,
                listening: false,
            });
            this._floatGroup.add(r);
            this._colorRects.push(r);
        });

        // SG 刻度标注在浮子右侧（4 个边界：从顶到底 1.15 → 1.30）
        const sgMarks = [
            { text: '1.15', fill: '#d03020' },
            { text: '1.20', fill: '#d06030' },
            { text: '1.25', fill: '#50a840' },
            { text: '1.30', fill: '#d0a020' },
        ];
        const fs = Math.max(10, this._tubeW * 0.28);
        sgMarks.forEach((m, i) => {
            const my = bodyY + i * segH;
            this._floatGroup.add(new Konva.Text({
                x: innerW / 2 + 3, y: my - fs * 0.35,
                text: m.text, fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
                fill: m.fill, listening: false,
            }));
        });

        // 底部玻璃管柄（连接到铅粒顶部）
        this._floatGroup.add(new Konva.Rect({
            x: -stemW / 2, y: bodyY + bodyH,
            width: stemW, height: botStemH,
            fill: 'rgba(200,220,230,0.35)', stroke: 'rgba(160,190,210,0.5)', strokeWidth: 0.5,
            cornerRadius: 1, listening: false,
        }));

        // 底部铅粒（底部与外玻璃管底面接触）
        this._floatGroup.add(new Konva.Circle({
            x: 0, y: floatH - leadR,
            radius: leadR, fill: '#404850', stroke: '#303840', strokeWidth: 0.5,
            listening: false,
        }));

        // — 电解液液面（淡蓝色，与外玻璃管等宽，最高到一半） —
        const tw = this._tubeW;
        this._liquidFill = new Konva.Rect({
            x: tx - tw / 2, y: tb,
            width: tw, height: 0,
            fill: '#a0d8ef', cornerRadius: 2,
            listening: false, opacity: 0.55,
        });
        this._dynamicGroup.add(this._liquidFill);

        this._dynamicGroup.add(this._floatGroup);
        this._floatMaxTop = maxTop;
        this._floatMinTop = minTop;

        // — 按压球（橡胶球，动态实现按压变形） —
        this._bulbGroup = new Konva.Group({ x: tx, y: this._bulbY, listening: false });
        this._bulbGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: this._bulbR,
            fill: '#cc4444', stroke: '#992222', strokeWidth: 1.5,
            listening: false,
        }));
        this._bulbGroup.add(new Konva.Circle({
            x: -this._bulbR * 0.25, y: -this._bulbR * 0.25,
            radius: this._bulbR * 0.35,
            fill: 'rgba(255,255,255,0.25)', listening: false,
        }));
        this._dynamicGroup.add(this._bulbGroup);
    }

    _bindInteraction() { // 绑定交互事件
        const tx = this._tubeX, br = this._bulbR, by = this._bulbY; // 灌胶球位置参数

        const hit = new Konva.Circle({
            x: tx, y: by, radius: br + 4, fill: 'transparent', // 点击热区
        });
        hit.on('click tap', () => {
            this._bulbPressed = !this._bulbPressed;
            if (this._bulbPressed) {
                // 按下：球体压扁，浮子下沉
                this._animating = true;
                this._filling = false;
                // 若有液体则 _fillProgress 自然递减（排出动画），无液体保持 0
            } else {
                // 松开：球体复原，查找下方电池吸取电解液
                this._animating = false;
                const bat = this._findTargetBattery();
                if (bat) {
                    this._fillStartSG = this._sg;
                    this._fillTargetSG = bat.getSpecificGravity() || 1.25;
                    this._filling = true;
                    // _fillProgress 从当前值继续（若刚排出中途则继续充回）
                }
                // 若无电池或电池无开口，_filling 保持 false
            }
        });
        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; }); // 鼠标悬停时变成指针
        hit.on('mouseleave', () => { document.body.style.cursor = 'default'; }); // 鼠标离开恢复默认
        this._interactGroup.add(hit); // 添加交互热区
    }

    tick(dt) { // 每帧更新函数
        this._updateDynamic(); // 更新动态显示
        this.markDirty(); // 标记组件需要重绘
        this._refreshIfDirty(); // 如果需要则刷新
    }

    _updateDynamic() { // 动态更新浮子位置和动画进度
        // — 按压动画 —
        if (this._animating && this._bulbPressed) {
            this._animProgress = Math.min(1, this._animProgress + 0.05);
        } else if (!this._bulbPressed) {
            this._animProgress = Math.max(0, this._animProgress - 0.03);
        }

        // — 电解液充注/排出进度（~2s 完成） —
        if (this._filling) {
            this._fillProgress = Math.min(1, this._fillProgress + 0.025);
            if (this._fillProgress >= 1) {
                this._filling = false;
                this._fillProgress = 1;
            }
        } else if (this._bulbPressed && this._fillProgress > 0) {
            // 按压且有液体 → 缓慢排出
            this._fillProgress = Math.max(0, this._fillProgress - 0.025);
        }
        this._sg = this._fillStartSG + (this._fillTargetSG - this._fillStartSG) * this._fillProgress;

        // — 液面高度（最高到外玻璃管的一半） —
        const maxLiquidH = this._tubeH * 0.5;
        const fillH = maxLiquidH * this._fillProgress;
        this._liquidFill.visible(fillH > 0);
        if (fillH > 0) {
            this._liquidFill.height(fillH);
            this._liquidFill.y(this._tubeBot - fillH);
        }

        // — 浮子独立上升/下降进度（~2s） —
        if (this._bulbPressed) {
            // 按压：浮子缓慢下降
            this._floatProgress = Math.max(0, this._floatProgress - 0.025);
        } else if (this._filling) {
            // 充注：浮子缓慢上升
            this._floatProgress = Math.min(1, this._floatProgress + 0.025);
        } else if (this._fillProgress <= 0) {
            this._floatProgress = 0; // 无液体时停在底部
        }

        // 浮子最终位置：液面最高处对准 SG 刻度
        const sgRange = 1.30 - 1.15;
        const sgNorm = Math.max(0, Math.min(1, (this._sg - 1.15) / sgRange));
        const lsY_final = this._tubeBot - maxLiquidH;
        const markY = this._tubeH * 0.5 * (0.10 + sgNorm * 0.50);
        const finalFloatY = lsY_final - markY;
        const displayY = this._floatMinTop + (finalFloatY - this._floatMinTop) * this._floatProgress;
        this._floatGroup.y(displayY);

        // — 按压球变形 —
        const s = this._animProgress;
        const scaleX = 1 - s * 0.4;
        this._bulbGroup.scaleX(scaleX);
        this._bulbGroup.scaleY(1);
    }

    _findTargetBattery() {
        const H = this.height;
        const tubeLen = Math.max(48, H * 0.165);
        const tipH = Math.max(8, H * 0.03);
        const tipX = this.group.x() + this._tubeX;
        const tipY = this.group.y() + this._rubberY + tubeLen + tipH;
        if (!this.sys) return null;
        const comps = this.sys.comps || {};
        for (const id in comps) {
            const c = comps[id];
            if (c.type === 'leadacid_battery' && c._lastOpenIdx !== undefined && c._lastOpenIdx >= 0) {
                const bx = c.group.x();
                const by = c.group.y();
                const holeX = bx + c._cellCx[c._lastOpenIdx];
                const holeY = by + (c._bodyTop || 0) + ((c._bodyH || 0) / 2);
                if (Math.hypot(tipX - holeX, tipY - holeY) < 12) {
                    return c;
                }
            }
        }
        return null;
    }

    getConfigFields() { // 配置面板字段定义
        return [
            { label: '比重值 (1.10~1.35)', key: 'specificGravity', type: 'number' }, // 比重配置字段
        ];
    }

    onConfigUpdate(cfg) { // 当配置面板更新时调用
        if (cfg.specificGravity !== undefined) {
            this._sg = Math.max(1.10, Math.min(1.35, parseFloat(cfg.specificGravity))); // 更新并限制比重值
        }
        this.config = { ...this.config, ...cfg }; // 同步配置对象
    }

    destroy() { super.destroy?.(); } // 销毁时调用基类销毁方法
}
