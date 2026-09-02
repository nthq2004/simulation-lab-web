import { BaseComponent } from './BaseComponent.js'; // 导入模块或组件依赖

export class ChargeBoard extends BaseComponent { // 导出充放电板组件类，继承基础组件
    constructor(config, sys) { // 构造函数，初始化组件状态和外观
        super(config, sys); // 调用父类构造函数

        this.width  = Math.max(350, config.width  || 420); // 设置组件宽度，并保证不小于最小值
        this.height = Math.max(260, config.height || 300); // 设置组件高度，并保证不小于最小值

        this.type  = 'charge_board'; // 设置组件类型标识
        this.cache = 'fixed'; // 开启固定缓存以提升渲染性能

        this._initGroups(); // 初始化静态/动态/交互图层组
        this._recalcGeometry(); // 计算组件几何布局参数
        this._initParameters(config); // 初始化组件参数状态
        this._init(); // 启动组件绘制和交互初始化流程

        this.config = { // 保存组件配置对象，供后续读取和更新
            maxCurrent: this._maxCurrent, // 执行当前语句或设置当前状态
        }; // 执行当前语句或设置当前状态

        this.addPort(this._acL.x, this._acL.y, 'ac_l', 'wire', 'p'); // 添加电气端口到组件
        this.addPort(this._acN.x, this._acN.y, 'ac_n', 'wire', 'n'); // 添加电气端口到组件
        this.addPort(this._ch1P.x, this._ch1P.y, 'ch1_p', 'wire', 'p'); // 添加电气端口到组件
        this.addPort(this._ch1N.x, this._ch1N.y, 'ch1_n', 'wire', 'n'); // 添加电气端口到组件
        this.addPort(this._ch2P.x, this._ch2P.y, 'ch2_p', 'wire', 'p'); // 添加电气端口到组件
        this.addPort(this._ch2N.x, this._ch2N.y, 'ch2_n', 'wire', 'n'); // 添加电气端口到组件
    } // 结束当前代码块

    _recalcGeometry() { // 开始一个新的代码块
        const W = this.width, H = this.height; // 读取组件宽度用于几何计算

        this._acL  = { x: W * 0.40, y: 0 }; // 设置左侧交流输入端子坐标
        this._acN  = { x: W * 0.60, y: 0 }; // 设置交流中性线端子坐标
        this._ch1P = { x: W * 0.22, y: H - 2 }; // 设置 CH1 正极端子坐标
        this._ch1N = { x: W * 0.33, y: H - 2 }; // 设置 CH1 负极端子坐标
        this._ch2P = { x: W * 0.67, y: H - 2 }; // 设置 CH2 正极端子坐标
        this._ch2N = { x: W * 0.78, y: H - 2 }; // 设置 CH2 负极端子坐标

        this._row1Y = 14; // 计算显示行 Y 坐标
        this._row2Y = H * 0.35; // 计算显示行 Y 坐标
        this._row3Y = H * 0.70; // 计算显示行 Y 坐标
    } // 结束当前代码块

    _initParameters(config) { // 开始一个新的代码块
        this._maxCurrent = parseFloat(config.maxCurrent) || 10; // 最大输出电流 (A)
        this._ch1FloatMode  = config.ch1FloatMode !== undefined ? !!config.ch1FloatMode : true; // 初始化 CH1 浮充模式状态
        this._ch2FloatMode  = config.ch2FloatMode !== undefined ? !!config.ch2FloatMode : true; // 初始化 CH2 浮充模式状态
        this._ch1CurrentAdj = parseFloat(config.ch1CurrentAdj) || 0.5; // 初始化 CH1 电流调节值
        this._ch2CurrentAdj = parseFloat(config.ch2CurrentAdj) || 0.5; // 初始化 CH2 电流调节值
        this._ch1CCMode = false; // CH1 恒流模式（帧间切换）
        this._ch2CCMode = false; // CH2 恒流模式（帧间切换）
        this._meterSwitchPos = parseInt(config.meterSwitchPos) || 0; // -1=left, 0=center, 1=right
        this._ch1Voltage = 27; // 初始有效电压
        this._ch2Voltage = 27; // 初始有效电压
        this._ch1Current = 0; // 设置 CH1 输出电流
        this._ch2Current = 0; // 设置 CH2 输出电流
        this._acSamples = new Array(40).fill(0); // AC 电压采样缓冲区（40 点）
        this._acSampleIdx = 0; // 采样缓冲区写入索引
        this._acRms = 0; // AC 输入有效值
    } // 结束当前代码块

    getCurrentLimit(ch) { // 获取指定通道的电流限制值
        const floatMode = ch === 1 ? this._ch1FloatMode : this._ch2FloatMode; // 声明局部变量或常量
        const adj = ch === 1 ? this._ch1CurrentAdj : this._ch2CurrentAdj; // 声明局部变量或常量
        if (floatMode) return this._maxCurrent / 5; // 浮充：最大电流的1/5
        return this._maxCurrent * adj; // 均充：最大电流 × 旋钮百分数
    } // 结束当前代码块

    getOutputVoltage(ch) { // 返回目标输出电压（stamp 据此选择 CC/CV 模式）
        if (ch === 1) return this._ch1FloatMode ? 27 : 28.8; // 条件判断，根据状态选择不同逻辑分支
        return this._ch2FloatMode ? 27 : 28.8; // 返回函数结果
    } // 结束当前代码块

    isOutputEnabled(ch) { // 判断指定通道输出是否启用（需 AC 输入有效 + 选择开关匹配）
        if (this._acRms < 110) return false; // AC 输入电压不足
        if (this._meterSwitchPos === 0) return false; // 条件判断，根据状态选择不同逻辑分支
        if (ch === 1 && this._meterSwitchPos === -1) return true; // 条件判断，根据状态选择不同逻辑分支
        if (ch === 2 && this._meterSwitchPos === 1) return true; // 条件判断，根据状态选择不同逻辑分支
        return false; // 返回函数结果
    } // 结束当前代码块

    _init() { // 开始一个新的代码块
        this._drawStaticParts(); // 绘制组件静态面板和标签
        this._createDynamicNodes(); // 创建动态显示节点
    } // 结束当前代码块

    _drawStaticParts() { // 开始一个新的代码块
        const W = this.width, H = this.height; // 读取组件宽度用于几何计算

        this._staticGroup.add(new Konva.Rect({ // 向静态图层添加 Konva 图形元素
            x: 0, y: 0, width: W, height: H, // 执行当前语句或设置当前状态
            fill: '#e8eaed', stroke: '#b0b8c0', strokeWidth: 1.5, cornerRadius: 6, // 执行当前语句或设置当前状态
        })); // 调用函数或构造 Konva 节点

        this._staticGroup.add(new Konva.Rect({ // 向静态图层添加 Konva 图形元素
            x: 4, y: 4, width: W - 8, height: H - 8, // 执行当前语句或设置当前状态
            fill: '#f5f6f8', stroke: '#d0d4da', strokeWidth: 0.8, cornerRadius: 4, // 执行当前语句或设置当前状态
        })); // 调用函数或构造 Konva 节点

        const lblFs = Math.max(15, W * 0.024); // 声明局部变量或常量
        this._staticGroup.add(new Konva.Text({ // 向静态图层添加 Konva 图形元素
            x: 10, y: H - lblFs - 6, // 执行当前语句或设置当前状态
            text: '充放电板', fontSize: lblFs, fontFamily: 'Arial', fontStyle: 'bold', // 执行当前语句或设置当前状态
            fill: '#505860', width: W - 20, align: 'center', // 执行当前语句或设置当前状态
        })); // 调用函数或构造 Konva 节点
    } // 结束当前代码块

    _createDynamicNodes() { // 开始一个新的代码块
        const W = this.width, H = this.height; // 读取组件宽度用于几何计算
        const r1 = this._row1Y, r2 = this._row2Y, r3 = this._row3Y; // 声明局部变量或常量

        const lcdW = 110, lcdH = 36; // 声明局部变量或常量
        const gap = 20; // 声明局部变量或常量
        const totalW = 3 * lcdW + 2 * gap; // 声明局部变量或常量
        const startX = (W - totalW) / 2; // 声明局部变量或常量
        const lcdY = r1; // 声明局部变量或常量

        const volX = startX, acX = startX + lcdW + gap, ampX = startX + 2 * (lcdW + gap); // 声明局部变量或常量

        this._drawLCD(volX, lcdY, lcdW, lcdH, 'V', '#2c5f8a', '_voltLCD'); // 绘制 LCD 显示窗口和单位标签
        this._drawLCD(ampX, lcdY, lcdW, lcdH, 'A', '#2c5f8a', '_ampLCD'); // 绘制 LCD 显示窗口和单位标签

        this._acIndicatorBg = new Konva.Circle({ // 开始一个新的代码块
            x: acX + lcdW / 2, y: lcdY + lcdH / 2, radius: 16, // 执行当前语句或设置当前状态
            fill: '#dce0e6', stroke: '#b0b8c0', strokeWidth: 1.5, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        this._dynamicGroup.add(this._acIndicatorBg); // 向动态图层添加 Konva 图形元素

        this._acIndicatorInner = new Konva.Circle({ // 开始一个新的代码块
            x: acX + lcdW / 2, y: lcdY + lcdH / 2, radius: 11, // 执行当前语句或设置当前状态
            fill: '#c0c6ce', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        this._dynamicGroup.add(this._acIndicatorInner); // 向动态图层添加 Konva 图形元素

        this._staticGroup.add(new Konva.Text({ // 向静态图层添加 Konva 图形元素
            x: acX, y: lcdY + lcdH + 2, width: lcdW, // 执行当前语句或设置当前状态
            text: '交流电源', fontSize: Math.max(12, W * 0.021), fontFamily: 'Arial', // 执行当前语句或设置当前状态
            fill: '#505860', align: 'center', // 执行当前语句或设置当前状态
        })); // 调用函数或构造 Konva 节点

        const swY = r2 + (H * 0.10); // 声明局部变量或常量
        this._createMeterSwitch(W / 2, swY); // 创建仪表切换开关

        const ch1Fx = W * 0.10, ch2Fx = W * 0.90; // 声明局部变量或常量
        const knob1x = W * 0.32, knob2x = W * 0.68; // 声明局部变量或常量

        this._ch1FloatGroup = new Konva.Group({ x: ch1Fx, y: r3 }); // 调用函数或构造 Konva 节点
        this._interactGroup.add(this._ch1FloatGroup); // 向交互组添加 CH1 浮充开关
        this._ch2FloatGroup = new Konva.Group({ x: ch2Fx, y: r3 }); // 调用函数或构造 Konva 节点
        this._interactGroup.add(this._ch2FloatGroup); // 向交互组添加 CH2 浮充开关
        this._createFloatSwitch(this._ch1FloatGroup, 'CH1', this._ch1FloatMode, '_ch1FloatMode'); // 创建浮充/均充切换开关
        this._createFloatSwitch(this._ch2FloatGroup, 'CH2', this._ch2FloatMode, '_ch2FloatMode'); // 创建浮充/均充切换开关

        this._ch1KnobGroup = new Konva.Group({ x: knob1x, y: r3 }); // 调用函数或构造 Konva 节点
        this._interactGroup.add(this._ch1KnobGroup); // 向交互组添加 CH1 旋钮
        this._createKnob(this._ch1KnobGroup, 'CH1电流', this._ch1CurrentAdj, '_ch1CurrentAdj'); // 创建电流调节旋钮
        this._ch2KnobGroup = new Konva.Group({ x: knob2x, y: r3 }); // 调用函数或构造 Konva 节点
        this._interactGroup.add(this._ch2KnobGroup); // 向交互组添加 CH2 旋钮
        this._createKnob(this._ch2KnobGroup, 'CH2电流', this._ch2CurrentAdj, '_ch2CurrentAdj'); // 创建电流调节旋钮
    } // 结束当前代码块

    _drawLCD(x, y, w, h, unit, color, propName) { // 开始一个新的代码块
        const bg = new Konva.Rect({ // 声明局部变量或常量
            x, y, width: w, height: h, fill: '#0e1218', // 执行当前语句或设置当前状态
            stroke: '#40464e', strokeWidth: 1, cornerRadius: 3, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        this._staticGroup.add(bg); // 向静态图层添加 Konva 图形元素

        const text = new Konva.Text({ // 声明局部变量或常量
            x: x + 4, y: y + 4, width: w - 8, height: h - 8, // 执行当前语句或设置当前状态
            text: '0.00', fontSize: Math.max(16, h * 0.45), // 执行当前语句或设置当前状态
            fontFamily: 'Courier New', fontStyle: 'bold', // 执行当前语句或设置当前状态
            fill: '#7fdbff', align: 'right', // 执行当前语句或设置当前状态
            fontStyle:'bold',
        }); // 结束当前代码块
        this._dynamicGroup.add(text); // 向动态图层添加 Konva 图形元素

        const unitText = new Konva.Text({ // 声明局部变量或常量
            x: x + w - 20, y: y + h - 14, // 执行当前语句或设置当前状态
            text: unit, fontSize: Math.max(12, h * 0.25), fontFamily: 'Arial', // 执行当前语句或设置当前状态
            fill: '#7fdbff', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        this._dynamicGroup.add(unitText); // 向动态图层添加 Konva 图形元素

        this[propName] = text; // 执行当前语句或设置当前状态

        const lbl = new Konva.Text({ // 声明局部变量或常量
            x, y: y + h + 2, width: w, // 执行当前语句或设置当前状态
            text: unit === 'V' ? '直流电压表' : '直流电流表', // 执行当前语句或设置当前状态
            fontSize: Math.max(13, w * 0.085), fontFamily: 'Arial', fill: '#032b52', align: 'center', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        this._staticGroup.add(lbl); // 向静态图层添加 Konva 图形元素
    } // 结束当前代码块

    _createMeterSwitch(cx, cy) { // 开始一个新的代码块
        const group = new Konva.Group({ x: cx, y: cy }); // 声明局部变量或常量
        this._interactGroup.add(group); // 向交互图层添加 Konva 交互元素

        const positions = [-1, 0, 1]; // 声明局部变量或常量
        const labels = ['I路', '关', 'II路']; // 声明局部变量或常量

        // 开口向下的弧线（∩ 形）
        const bg = new Konva.Arc({ // 声明局部变量或常量
            x: 0, y: 0, innerRadius: 28, outerRadius: 40, // 执行当前语句或设置当前状态
            angle: 100, rotation: 220, fill: '#d0d4da', // 执行当前语句或设置当前状态
            stroke: '#a0a8b0', strokeWidth: 1, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(bg); // 调用函数或构造 Konva 节点

        const dotR = 19; // 声明局部变量或常量
        const angleLookup = { '-1': -50, '0': 0, '1': 50 }; // 弧线上三个定位点角度
        const initAngle = angleLookup[this._meterSwitchPos] || 0; // 声明局部变量或常量

        this._msKnob = new Konva.Group({ x: 0, y: 0 }); // 调用函数或构造 Konva 节点
        this._msKnob.add(new Konva.Circle({ // 开始一个新的代码块
            radius: dotR, fill: '#e8eaed', // 执行当前语句或设置当前状态
            stroke: '#707880', strokeWidth: 1.5, // 执行当前语句或设置当前状态
            fillRadialGradientStartPoint: { x: -4, y: -4 }, // 执行当前语句或设置当前状态
            fillRadialGradientEndPoint: { x: 0, y: 0 }, // 执行当前语句或设置当前状态
            fillRadialGradientStartRadius: 0, // 执行当前语句或设置当前状态
            fillRadialGradientEndRadius: dotR, // 执行当前语句或设置当前状态
            fillRadialGradientColorStops: [0, '#f8fafc', 0.5, '#e0e4e8', 1, '#b0b8c0'], // 执行当前语句或设置当前状态
        })); // 调用函数或构造 Konva 节点
        this._msKnob.add(new Konva.Line({ // 开始一个新的代码块
            points: [0, -3, 0, -dotR + 4], // 执行当前语句或设置当前状态
            stroke: '#d03030', strokeWidth: 2.5, lineCap: 'round', // 执行当前语句或设置当前状态
        })); // 调用函数或构造 Konva 节点
        this._msKnob.rotation(initAngle); // 调用函数或构造 Konva 节点
        group.add(this._msKnob); // 调用函数或构造 Konva 节点

        // 弧线上的圆点 + 弧线外的标注文字
        const arcR = (28 + 40) / 2; // 弧线中间半径 = 34
        const labelR = 52; // 文字标注在弧线外（紧贴外缘）
        this._msLabels = []; // 设置或读取组件实例属性
        positions.forEach((pos, i) => { // 开始一个新的代码块
            const angle = angleLookup[pos]; // 声明局部变量或常量
            const rad = angle * Math.PI / 180; // 声明局部变量或常量
            const dotX = Math.sin(rad) * arcR; // 圆点在弧线上
            const dotY = -Math.cos(rad) * arcR; // 圆点在弧线上
            const lblX = Math.sin(rad) * labelR; // 文字在弧线外
            const lblY = -Math.cos(rad) * labelR; // 文字在弧线外

            // 标注文字（居中在 lblX/lblY）
            const lbl = new Konva.Text({ // 声明局部变量或常量
                x: lblX - 16, y: lblY - 6, width: 32, // 执行当前语句或设置当前状态
                text: labels[i], fontSize: 12, fontFamily: 'Arial', // 执行当前语句或设置当前状态
                fill: this._meterSwitchPos === pos ? '#205080' : '#808890', // 执行当前语句或设置当前状态
                align: 'center', fontStyle: this._meterSwitchPos === pos ? 'bold' : 'normal', // 执行当前语句或设置当前状态
            }); // 结束当前代码块
            group.add(lbl); // 调用函数或构造 Konva 节点

            // 弧线上的定位圆点
            const dot = new Konva.Circle({ // 声明局部变量或常量
                x: dotX, y: dotY, radius: 4, // 执行当前语句或设置当前状态
                fill: this._meterSwitchPos === pos ? '#2060b0' : '#a0a8b0', // 执行当前语句或设置当前状态
                stroke: this._meterSwitchPos === pos ? '#205080' : '#808890', // 执行当前语句或设置当前状态
                strokeWidth: 0.5, // 执行当前语句或设置当前状态
            }); // 结束当前代码块
            group.add(dot); // 调用函数或构造 Konva 节点

            this[`_msDot${i}`] = dot; // 执行当前语句或设置当前状态
            this._msLabels.push(lbl); // 调用函数或构造 Konva 节点

            // 点击热区
            const hit = new Konva.Circle({ // 声明局部变量或常量
                x: dotX, y: dotY, radius: 16, fill: 'transparent', // 执行当前语句或设置当前状态
            }); // 结束当前代码块
            hit.on('click tap', () => { // 开始一个新的代码块
                this._meterSwitchPos = pos; // 初始化仪表切换位置
                this._updateMeterSwitch(); // 更新仪表开关显示状态
            }); // 结束当前代码块
            group.add(hit); // 调用函数或构造 Konva 节点
        }); // 结束当前代码块
    } // 结束当前代码块

    _updateMeterSwitch() { // 开始一个新的代码块
        const positions = [-1, 0, 1]; // 声明局部变量或常量
        const angleLookup = { '-1': -50, '0': 0, '1': 50 }; // 声明局部变量或常量
        const targetAngle = angleLookup[this._meterSwitchPos] || 0; // 声明局部变量或常量

        if (this._msKnob) { // 条件判断，根据状态选择不同逻辑分支
            new Konva.Tween({ // 开始一个新的代码块
                node: this._msKnob, duration: 0.15, // 执行当前语句或设置当前状态
                rotation: targetAngle, // 执行当前语句或设置当前状态
            }).play(); // 调用函数或构造 Konva 节点
        } // 结束当前代码块

        positions.forEach((pos, i) => { // 开始一个新的代码块
            const d = this[`_msDot${i}`]; // 声明局部变量或常量
            if (d) d.fill(this._meterSwitchPos === pos ? '#2060b0' : '#a0a8b0'); // 条件判断，根据状态选择不同逻辑分支
            const lbl = this._msLabels && this._msLabels[i]; // 声明局部变量或常量
            if (lbl) { // 条件判断，根据状态选择不同逻辑分支
                lbl.fill(this._meterSwitchPos === pos ? '#205080' : '#808890'); // 调用函数或构造 Konva 节点
                lbl.fontStyle(this._meterSwitchPos === pos ? 'bold' : 'normal'); // 调用函数或构造 Konva 节点
            } // 结束当前代码块
        }); // 结束当前代码块
    } // 结束当前代码块

    _createFloatSwitch(group, label, initialMode, propName) { // 开始一个新的代码块
        const knobW = 33, knobH = 18; // 声明局部变量或常量

        const track = new Konva.Rect({ // 声明局部变量或常量
            x: -22.5, y: -12, width: 45, height: 24, // 执行当前语句或设置当前状态
            fill: '#c8ccd2', stroke: '#a0a6b0', strokeWidth: 1, cornerRadius: 12, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(track); // 调用函数或构造 Konva 节点

        const knobColor = initialMode ? '#40a060' : '#d09030'; // 声明局部变量或常量
        this[`${propName.replace('_', '')}Knob`] = new Konva.Circle({ // 开始一个新的代码块
            x: initialMode ? 10.5 : -10.5, y: 0, radius: 10.5, // 执行当前语句或设置当前状态
            fill: knobColor, stroke: '#707880', strokeWidth: 1, // 执行当前语句或设置当前状态
            fillRadialGradientStartPoint: { x: -3, y: -3 }, // 执行当前语句或设置当前状态
            fillRadialGradientEndPoint: { x: 0, y: 0 }, // 执行当前语句或设置当前状态
            fillRadialGradientStartRadius: 0, // 执行当前语句或设置当前状态
            fillRadialGradientEndRadius: 10.5, // 执行当前语句或设置当前状态
            fillRadialGradientColorStops: [0, '#ffffff', 0.4, knobColor, 1, knobColor], // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(this[`${propName.replace('_', '')}Knob`]); // 调用函数或构造 Konva 节点

        const hit = new Konva.Rect({ // 声明局部变量或常量
            x: -27, y: -16.5, width: 54, height: 33, fill: 'transparent', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        hit.on('click tap', () => { // 开始一个新的代码块
            this[propName] = !this[propName]; // 执行当前语句或设置当前状态
            this._updateFloatSwitch(propName); // 更新浮充/均充开关显示状态
        }); // 结束当前代码块
        group.add(hit); // 调用函数或构造 Konva 节点

        const lbl = new Konva.Text({ // 声明局部变量或常量
            x: -27, y: 18, width: 54, // 执行当前语句或设置当前状态
            text: initialMode ? '浮充' : '均充', // 执行当前语句或设置当前状态
            fontSize: 12, fontFamily: 'Arial', fill: '#505860', align: 'center', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(lbl); // 调用函数或构造 Konva 节点
        this[`${propName.replace('_', '')}Label`] = lbl; // 执行当前语句或设置当前状态

        const title = new Konva.Text({ // 声明局部变量或常量
            x: -27, y: -36, width: 54, // 执行当前语句或设置当前状态
            text: label, fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold', // 执行当前语句或设置当前状态
            fill: '#505860', align: 'center', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(title); // 调用函数或构造 Konva 节点
    } // 结束当前代码块

    _updateFloatSwitch(propName) { // 开始一个新的代码块
        const val = this[propName]; // 声明局部变量或常量
        const knob = this[`${propName.replace('_', '')}Knob`]; // 声明局部变量或常量
        const lbl = this[`${propName.replace('_', '')}Label`]; // 声明局部变量或常量
        const color = val ? '#40a060' : '#d09030'; // 声明局部变量或常量

        if (knob) { // 条件判断，根据状态选择不同逻辑分支
            if (lbl) lbl.text(val ? '浮充' : '均充'); // 条件判断，根据状态选择不同逻辑分支
            new Konva.Tween({ // 开始一个新的代码块
                node: knob, duration: 0.12, // 执行当前语句或设置当前状态
                x: val ? 10.5 : -10.5, // 执行当前语句或设置当前状态
            }).play(); // 调用函数或构造 Konva 节点
            knob.fill(color); // 调用函数或构造 Konva 节点
            knob.fillRadialGradientColorStops([0, '#ffffff', 0.4, color, 1, color]); // 调用函数或构造 Konva 节点
        } // 结束当前代码块
    } // 结束当前代码块

    _createKnob(group, label, initialVal, propName) { // 开始一个新的代码块
        const r = 30; // 声明局部变量或常量

        // 外圈暗环
        const ring = new Konva.Circle({ // 声明局部变量或常量
            x: 0, y: 0, radius: r + 4, // 执行当前语句或设置当前状态
            fill: '#707880', stroke: '#505860', strokeWidth: 1, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(ring); // 调用函数或构造 Konva 节点

        const bg = new Konva.Circle({ // 声明局部变量或常量
            x: 0, y: 0, radius: r + 2, // 执行当前语句或设置当前状态
            fill: '#a0a8b0', stroke: '#707880', strokeWidth: 0.5, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(bg); // 调用函数或构造 Konva 节点

        const angle = -135 + initialVal * 270; // 声明局部变量或常量

        const knobBody = new Konva.Circle({ // 声明局部变量或常量
            x: 0, y: 0, radius: r, // 执行当前语句或设置当前状态
            fill: '#e0e4e8', stroke: '#707880', strokeWidth: 1, // 执行当前语句或设置当前状态
            fillRadialGradientStartPoint: { x: -4, y: -4 }, // 执行当前语句或设置当前状态
            fillRadialGradientEndPoint: { x: 0, y: 0 }, // 执行当前语句或设置当前状态
            fillRadialGradientStartRadius: 0, // 执行当前语句或设置当前状态
            fillRadialGradientEndRadius: r, // 执行当前语句或设置当前状态
            fillRadialGradientColorStops: [0, '#f8fafc', 0.5, '#d0d6dc', 1, '#a0a8b0'], // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(knobBody); // 调用函数或构造 Konva 节点

        const marker = new Konva.Line({ // 声明局部变量或常量
            points: [0, -4, 0, -r + 6], // 执行当前语句或设置当前状态
            stroke: '#d03030', strokeWidth: 3.5, lineCap: 'round', // 执行当前语句或设置当前状态
            rotation: angle, // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(marker); // 调用函数或构造 Konva 节点

        for (let i = 0; i <= 4; i++) { // 循环语句，用于遍历或重复处理
            const a = -135 + (i / 4) * 270; // 声明局部变量或常量
            const rad = a * Math.PI / 180; // 声明局部变量或常量
            const innerR = r * 0.65; // 声明局部变量或常量
            const outerR = r - 3; // 声明局部变量或常量
            const tick = new Konva.Line({ // 声明局部变量或常量
                points: [ // 执行当前语句或设置当前状态
                    Math.sin(rad) * innerR, -Math.cos(rad) * innerR, // 执行当前语句或设置当前状态
                    Math.sin(rad) * outerR, -Math.cos(rad) * outerR, // 执行当前语句或设置当前状态
                ], // 执行当前语句或设置当前状态
                stroke: '#808890', strokeWidth: i % 2 === 0 ? 1.5 : 1, // 执行当前语句或设置当前状态
                lineCap: 'round', // 执行当前语句或设置当前状态
            }); // 结束当前代码块
            group.add(tick); // 调用函数或构造 Konva 节点
        } // 结束当前代码块

        const hit = new Konva.Circle({ x: 0, y: 0, radius: r + 9, fill: 'transparent' }); // 声明局部变量或常量
        hit.on('click tap', (e) => { // 开始一个新的代码块
            const stage = hit.getStage(); // 声明局部变量或常量
            if (!stage) return; // 条件判断，根据状态选择不同逻辑分支
            const pointer = stage.getPointerPosition(); // 声明局部变量或常量
            if (!pointer) return; // 条件判断，根据状态选择不同逻辑分支
            const absPos = group.getAbsolutePosition(); // 声明局部变量或常量
            const dy = pointer.y - absPos.y; // 声明局部变量或常量
            const increment = dy < 0 ? 0.05 : -0.05; // 声明局部变量或常量
            this[propName] = Math.max(0, Math.min(1, this[propName] + increment)); // 调用函数或构造 Konva 节点
            const newAngle = -135 + this[propName] * 270; // 声明局部变量或常量
            new Konva.Tween({ node: marker, duration: 0.1, rotation: newAngle }).play(); // 调用函数或构造 Konva 节点
            if (this[`${propName.replace('_', '')}Label`]) { // 条件判断，根据状态选择不同逻辑分支
                this[`${propName.replace('_', '')}Label`].text(`${(this[propName] * 100).toFixed(0)}%`); // 调用函数或构造 Konva 节点
            } // 结束当前代码块
        }); // 结束当前代码块
        group.add(hit); // 调用函数或构造 Konva 节点

        const lbl = new Konva.Text({ // 声明局部变量或常量
            x: -22, y: r + 12, width: 44, // 执行当前语句或设置当前状态
            text: `${(initialVal * 100).toFixed(0)}%`, // 执行当前语句或设置当前状态
            fontSize: 13, fontFamily: 'Arial', fill: '#505860', align: 'center', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(lbl); // 调用函数或构造 Konva 节点
        this[`${propName.replace('_', '')}Label`] = lbl; // 执行当前语句或设置当前状态

        const title = new Konva.Text({ // 声明局部变量或常量
            x: -30, y: -r - 20, width: 60, // 执行当前语句或设置当前状态
            text: label, fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold', // 执行当前语句或设置当前状态
            fill: '#505860', align: 'center', // 执行当前语句或设置当前状态
        }); // 结束当前代码块
        group.add(title); // 调用函数或构造 Konva 节点

        this[`${propName.replace('_', '')}Marker`] = marker; // 执行当前语句或设置当前状态
    } // 结束当前代码块

    _updateKnob(propName) { // 开始一个新的代码块
        const val = this[propName]; // 声明局部变量或常量
        const marker = this[`${propName.replace('_', '')}Marker`]; // 声明局部变量或常量
        const lbl = this[`${propName.replace('_', '')}Label`]; // 声明局部变量或常量
        if (marker) { // 条件判断，根据状态选择不同逻辑分支
            const newAngle = -135 + val * 270; // 声明局部变量或常量
            new Konva.Tween({ node: marker, duration: 0.1, rotation: newAngle }).play(); // 调用函数或构造 Konva 节点
        } // 结束当前代码块
        if (lbl) lbl.text(`${(val * 100).toFixed(0)}%`); // 条件判断，根据状态选择不同逻辑分支
    } // 结束当前代码块

    tick(dt) { // 每帧刷新组件状态和显示
        const solver = this.sys?.voltageSolver; // 获取电路求解器实例
        if (solver) { // 条件判断，根据状态选择不同逻辑分支
            // 采样 AC 输入电压并计算有效值（40 点缓冲区）
            const vAcL = solver.getVoltageAtPort(`${this.id}_wire_ac_l`); // 读取 AC 左相电压
            const vAcN = solver.getVoltageAtPort(`${this.id}_wire_ac_n`); // 读取 AC 右相电压
            if (vAcL !== undefined && vAcN !== undefined && isFinite(vAcL) && isFinite(vAcN)) { // 条件判断，根据状态选择不同逻辑分支
                const vAc = vAcL - vAcN; // 瞬时 AC 电压
                this._acSamples[this._acSampleIdx] = vAc; // 写入缓冲区
                this._acSampleIdx = (this._acSampleIdx + 1) % 40; // 更新索引
                let sumSq = 0; // 声明局部变量或常量
                for (let i = 0; i < 40; i++) sumSq += this._acSamples[i] * this._acSamples[i]; // 累加平方和
                this._acRms = Math.sqrt(sumSq / 40); // 计算有效值
            } // 结束当前代码块

            const v1p = solver.getVoltageAtPort(`${this.id}_wire_ch1_p`); // 读取 CH1 正端口电压
            const v1n = solver.getVoltageAtPort(`${this.id}_wire_ch1_n`); // 读取 CH1 负端口电压
            const c1p = solver.portToCluster.get(`${this.id}_wire_ch1_p`); // 检查端口是否连接
            const c1n = solver.portToCluster.get(`${this.id}_wire_ch1_n`); // 检查端口是否连接
            if (c1p !== undefined && c1n !== undefined && v1p !== undefined && v1n !== undefined && isFinite(v1p) && isFinite(v1n)) { // 条件判断，根据状态选择不同逻辑分支
                const Vt = v1p - v1n; // 当前端子电压（实际输出）
                const v1t = this._ch1FloatMode ? 27 : 28.8; // 目标电压
                const lim1 = this.getCurrentLimit(1); // 电流上限
                const iNom = (v1t - Vt) / 0.05; // 诺顿等效电流（恒压模式）
                if (this._ch1CCMode) {
                    // 当前处于恒流模式（上帧检测到过流）
                    // 在 CC 模式下，如果端电压恢复（负载减轻），切回恒压模式
                    if (Vt >= v1t - lim1 * 0.05) {
                        this._ch1CCMode = false; // 切回恒压
                        this._ch1Current = iNom; // 显示实际诺顿电流
                    } else {
                        this._ch1Current = lim1; // 显示限流值
                    }
                } else {
                    // 恒压模式
                    this._ch1Current = iNom; // 显示实际诺顿电流
                    if (Vt < v1t && iNom > lim1) {
                        this._ch1CCMode = true; // 过流 → 下一帧切恒流
                    }
                }
                this._ch1Voltage = Math.min(Vt, v1t); // 显示电压（限压）
            } else { // 端口悬空：显示目标电压，电流为0
                this._ch1Voltage = this._ch1FloatMode ? 27 : 28.8; // 显示目标电压
                this._ch1Current = 0; // 电流为0
                this._ch1CCMode = false;
            } // 结束当前代码块
            const v2p = solver.getVoltageAtPort(`${this.id}_wire_ch2_p`); // 读取 CH2 正端口电压
            const v2n = solver.getVoltageAtPort(`${this.id}_wire_ch2_n`); // 读取 CH2 负端口电压
            const c2p = solver.portToCluster.get(`${this.id}_wire_ch2_p`); // 检查端口是否连接
            const c2n = solver.portToCluster.get(`${this.id}_wire_ch2_n`); // 检查端口是否连接
            if (c2p !== undefined && c2n !== undefined && v2p !== undefined && v2n !== undefined && isFinite(v2p) && isFinite(v2n)) { // 条件判断，根据状态选择不同逻辑分支
                const Vt = v2p - v2n; // 当前端子电压（实际输出）
                const v2t = this._ch2FloatMode ? 27 : 28.8; // 目标电压
                const lim2 = this.getCurrentLimit(2); // 电流上限
                const iNom = (v2t - Vt) / 0.05; // 诺顿等效电流（恒压模式）
                if (this._ch2CCMode) {
                    // 当前处于恒流模式（上帧检测到过流）
                    // 在 CC 模式下，如果端电压恢复（负载减轻），切回恒压模式
                    if (Vt >= v2t - lim2 * 0.05) {
                        this._ch2CCMode = false; // 切回恒压
                        this._ch2Current = iNom; // 显示实际诺顿电流
                    } else {
                        this._ch2Current = lim2; // 显示限流值
                    }
                } else {
                    // 恒压模式
                    this._ch2Current = iNom; // 显示实际诺顿电流
                    if (Vt < v2t && iNom > lim2) {
                        this._ch2CCMode = true; // 过流 → 下一帧切恒流
                    }
                }
                this._ch2Voltage = Math.min(Vt, v2t); // 显示电压（限压）
            } else { // 端口悬空：显示目标电压，电流为0
                this._ch2Voltage = this._ch2FloatMode ? 27 : 28.8; // 显示目标电压
                this._ch2Current = 0; // 电流为0
                this._ch2CCMode = false;
            } // 结束当前代码块
        } // 结束当前代码块

        this._updateDynamic(); // 更新动态节点显示内容
        this.markDirty(); // 调用函数或构造 Konva 节点
        this._refreshIfDirty(); // 调用函数或构造 Konva 节点
    } // 结束当前代码块

    _updateDynamic() { // 开始一个新的代码块
        const ch = this._meterSwitchPos; // 声明局部变量或常量
        const outputOk = this._acRms >= 110; // AC 输入有效
        if (ch === 1 && outputOk) { // 条件判断，根据状态选择不同逻辑分支
            this._voltLCD.text(this._ch2Voltage.toFixed(2)); // 调用函数或构造 Konva 节点
            this._ampLCD.text(Math.abs(this._ch2Current).toFixed(3)); // 调用函数或构造 Konva 节点
        } else if (ch === -1 && outputOk) { // 开始一个新的代码块
            this._voltLCD.text(this._ch1Voltage.toFixed(2)); // 调用函数或构造 Konva 节点
            this._ampLCD.text(Math.abs(this._ch1Current).toFixed(3)); // 调用函数或构造 Konva 节点
        } else { // 开始一个新的代码块
            this._voltLCD.text('--.--'); // 调用函数或构造 Konva 节点
            this._ampLCD.text('--.--'); // 调用函数或构造 Konva 节点
        } // 结束当前代码块

        const acPowered = this._acRms >= 110; // 声明局部变量或常量
        if (acPowered) { // 条件判断，根据状态选择不同逻辑分支
            this._acIndicatorInner.fill('#40e060'); // 调用函数或构造 Konva 节点
            this._acIndicatorInner.fillRadialGradientStartPoint({ x: -3, y: -3 }); // 调用函数或构造 Konva 节点
            this._acIndicatorInner.fillRadialGradientEndPoint({ x: 0, y: 0 }); // 调用函数或构造 Konva 节点
            this._acIndicatorInner.fillRadialGradientStartRadius(0); // 调用函数或构造 Konva 节点
            this._acIndicatorInner.fillRadialGradientEndRadius(11); // 调用函数或构造 Konva 节点
            this._acIndicatorInner.fillRadialGradientColorStops([0, '#80ffa0', 1, '#208040']); // 调用函数或构造 Konva 节点
        } else { // 开始一个新的代码块
            this._acIndicatorInner.fill('#c0c6ce'); // 调用函数或构造 Konva 节点
            this._acIndicatorInner.fillRadialGradientColorStops(undefined); // 调用函数或构造 Konva 节点
        } // 结束当前代码块

        if (this.ch1CurrentAdjLabel) this.ch1CurrentAdjLabel.text(`${(this._ch1CurrentAdj * this._maxCurrent).toFixed(1)}A`); // 条件判断，根据状态选择不同逻辑分支
        if (this.ch2CurrentAdjLabel) this.ch2CurrentAdjLabel.text(`${(this._ch2CurrentAdj * this._maxCurrent).toFixed(1)}A`); // 条件判断，根据状态选择不同逻辑分支
    } // 结束当前代码块

    getConfigFields() { // 开始一个新的代码块
        return [ // 返回函数结果
            { label: '最大输出电流 (A)', key: 'maxCurrent', type: 'number' }, // 执行当前语句或设置当前状态
        ]; // 执行当前语句或设置当前状态
    } // 结束当前代码块

    onConfigUpdate(cfg) { // 开始一个新的代码块
        if (cfg.maxCurrent !== undefined) { // 条件判断，根据状态选择不同逻辑分支
            this._maxCurrent = Math.max(1, parseFloat(cfg.maxCurrent)); // 初始化最大输出电流
        } // 结束当前代码块
        this.config = { ...this.config, ...cfg }; // 保存组件配置对象，供后续读取和更新
    } // 结束当前代码块

    destroy() { super.destroy?.(); } // 销毁组件并释放资源
} // 结束当前代码块
