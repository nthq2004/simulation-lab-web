import { BaseComponent } from './BaseComponent.js';

/**
 * 压力变送器（两线制）组件
 *
 * 功能概述：
 * - 模拟常见的 2-wire 压力变送器外观与显示逻辑：接收变送器输出电流（4-20mA），将其映射为压力值并在 LCD 上显示；
 * - 支持零点/满度旋钮微调（`zeroAdj` / `spanAdj`），支持开路/断电故障时的黑屏或故障显示；
 * - 提供 `update(state)` 接口：`state` 包含 `powered` 与 `transCurrent`（mA），用于实时更新显示；
 * - 可配置量程（`min` / `max`）与显示单位（`MPa` / `Bar`）。
 *
 * 视图说明：使用 Konva 构建外壳、LCD 与旋钮等视觉元素，静态元素添加到 `_staticGroup` 并使用缓存以提升性能。
 */
export class PressTransmitter extends BaseComponent {
    /**
     * 构造器：初始化尺寸、量程与视觉组件
     * @param {Object} config - 支持 width, height, min, max, unit 等配置
     * @param {Object} sys - 全局系统对象（用于回调与重绘）
     */
    constructor(config, sys) {
        super(config, sys);
        // 动态尺寸设置：最小宽140, 最小高180
        this.width = Math.max(140, Math.min(config.width || 140, 200));
        this.height = Math.max(180, Math.min(config.height || 180, 240));

        this.type = 'transmitter_2wire';
        this.special = 'press';
        this.cache = 'fixed';
        this._initGroups();
        this.zeroAdj = 0;
        this.spanAdj = 1.0;
        this.min = 0;
        this.max = 1;
        this.unit = 'MPa'
        this.config = {id:this.id,min:this.min,max:this.max,unit:this.unit};

        this.press = 0;
        this.isBreak = false; // 默认电路闭合（正常）    

        this.knobs = [];
        // 构建视觉部件（外壳、LCD、旋钮等）
        this._init();

        // this.group.add();
        this.addPort(70, 168, 'i', 'pipe', 'in');
        this.addPort(140, 18, 'p', 'wire', 'p');
        this.addPort(140, 48, 'n', 'wire');

    }

    _init() {
        // 依次绘制外壳、显示屏与旋钮
        this._drawEnclosure();      // 绘制主体外壳和接线盒
        this._drawLCD();            // 绘制 LCD 背景与文本对象
        this._drawKnobs();          // 绘制零点/满度旋钮并绑定交互


    }
    _drawEnclosure() {
        const centerX = this.width / 2;

        // 1. 顶部 T 型横梁 (Junction Box)
        const labelText = new Konva.Text({ x: 22, y: -10, width: this.w, text: '压力变送器', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });
        const tBar = new Konva.Rect({
            x: 20, y: 10,
            width: this.width - 40, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5
        });

        // 左右金属密封盖 (模拟图片两侧的六角螺帽)
        const leftCap = new Konva.Rect({ x: 0, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });
        const rightCap = new Konva.Rect({ x: this.width - 20, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });

        // 2. 圆形表头与防滑旋盖 (深绿色)
        const outerRadius = 55;
        const outerCover = new Konva.Circle({
            x: centerX, y: 85, radius: outerRadius,
            fill: '#2f3542', // 底色
            stroke: '#1e272e', strokeWidth: 1
        });

        // 深绿色旋盖 (带凹槽纹理)
        const greenCover = new Konva.Circle({
            x: centerX, y: 85, radius: 52,
            fill: '#27ae60', // 图片中的深绿色
            stroke: '#1e8449', strokeWidth: 4
        });

        // 3. 底部金属丝扣接口
        const stem = new Konva.Rect({ x: centerX - 10, y: 140, width: 20, height: 30, fill: '#ced6e0', stroke: '#747d8c' });

        // 将静态外观元素加入组件的静态组，使用缓存以减少重绘开销
        this._staticGroup.add(tBar, leftCap, rightCap, outerCover, greenCover, stem, labelText);
        this.lcdCenterY = 85; // 记录 LCD 中心 Y 以便后续布局使用
    }

    _drawLCD() {
        const centerX = this.width / 2;
        const lcdRadius = 38;

        // LCD 背景 (图片中是弧形顶部的绿色屏幕)
        this.lcdBg = new Konva.Circle({
            x: centerX, y: this.lcdCenterY,
            radius: lcdRadius,
            fill: '#000' // 默认黑屏
        });

        this.lcdText = new Konva.Text({
            x: centerX - 30, y: this.lcdCenterY - 10,
            width: 60,
            text: '',
            fontSize: 18,
            fontFamily: 'Digital-7, monospace',
            fill: '#00ff00',
            align: 'center',
            fontStyle: 'bold'
        });

        const unit = new Konva.Text({
            x: centerX - 15, y: this.lcdCenterY + 12,
            text: 'MPa', fontSize: 10, fill: '#1a1a1a', opacity: 0
        });
        this.unitText = unit;

        // LCD 相关对象（文本与背景）放入静态组，但文本内容会动态改变
        this._staticGroup.add(this.lcdBg, this.lcdText, unit);
    }

    _drawKnobs() {
        // 旋钮放在顶部 T 型梁上，模拟隐藏盖板下的调节孔
        const knobConfigs = [
            { id: 'zero', x: 50, label: 'Z' },
            { id: 'span', x: this.width - 50, label: 'S' }
        ];

        knobConfigs.forEach(k => {
            const knobGroup = new Konva.Group({ x: k.x, y: 32 });
            const base = new Konva.Circle({ radius: 11, fill: '#dfe4ea', stroke: '#747d8c' });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#2f3542', strokeWidth: 3 }));

            knobGroup.add(base, rotor);
            this.knobs[k.id] = rotor; // 存储旋钮对象

            // 绑定旋钮拖动交互：鼠标/触摸移动改变旋钮旋转角度，映射为零点/满度校正值
            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    // 零点旋钮旋转对应约 +/-0.8 MPa 的零点修正
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.8;
                    else this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.5;
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    window.removeEventListener('touchend', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup', onUp);
                window.addEventListener('touchend', onUp);
            });
            this._staticGroup.add(knobGroup);
        });
    }
    update(state) {
        // state: { powered: bool, transCurrent: number }
        // --- 核心修改：开路故障检查 ---
        // 如果开路被设置，或者 state 明确表示断电
        // 处理开路或断电情况：显示黑屏或空白
        if (this.isBreak || !state || !state.powered) {
            try {
                this.lcdText.text('');
                this.unitText.text('');
                this.lcdBg.fill('#000'); // 黑屏
                this.unitText.opacity(0);
            } catch (e) { }

            this._refreshCache();
            return;
        }

        // 1. 获取输入电流值
        // 1) 获取变送器回路电流（mA）并映射为压力
        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;
        // const iFix = inCurrent * this.spanAdj+this.zeroAdj;产生电流的时候修正，这里不处理。

        // 2. 根据电流推算原始温度 (4-20mA -> 0-rangeMax)

        // 2) 4-20mA 映射到量程：4mA -> min, 20mA -> max
        const press = ((inCurrent - 4) / 16) * this.max + this.min;
        // 根据显示单位调整（Bar = MPa * 10）并设置小数位数
        const pressDisp = this.unit === 'MPa' ? press : press * 10;
        const pricision = this.unit === 'MPa' ? 3 : 2;


        // 4. 处理显示逻辑与输出电流
        let displayText = "";
        let isFault = false;

        // 3) 故障检测：超量程或欠量程显示特殊文本
        if (inCurrent < 3.8) {
            // 小于 4mA 显示 LLLL
            displayText = "LLLL";
            isFault = true;
        } else if (inCurrent > 20.5) {
            // 大于 20mA 显示 HHHH
            displayText = "HHHH";
            isFault = true;
        } else {
            // 正常量程内：显示数值
            displayText = pressDisp.toFixed(pricision);
            // 变送器输出跟随输入电流（或根据修正后的温度重新映射）
            isFault = false;
        }

        // 5. 更新 UI 表现
        // 4) 根据是否故障修改显示样式（颜色、单位可见性、背景色）
        if (isFault) {
            this.lcdText.fill('#ff4757'); // 故障显示红色
            this.lcdText.text(displayText);
            this.unitText.opacity(0);      // 故障时不显示单位
            this.lcdBg.fill('#2f3542');    // 背景变暗
        } else {
            this.lcdText.fill('#1a1a1a');  // 正常显示黑色
            this.lcdText.text(displayText);
            this.unitText.opacity(1);
            this.unitText.text(this.unit);
            this.lcdBg.fill('#2ed573');    // 正常显示翠绿色
        }

        // 5) 刷新缓存以触发重绘
        this._refreshCache();
    }

    /**
         * 定义配置界面所需的字段结构
         */
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '测量最小值 (Min)', key: 'min', type: 'number' },
            { label: '测量最大值 (Max)', key: 'max', type: 'number' },
            {
                label: '显示单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'MPa', value: 'MPa' },
                    { label: 'Bar', value: 'Bar' }
                ]
            }
        ];
    }

    onConfigUpdate(newConfig) {
        // 接收编辑器传入的配置并解析为内部属性（注意数值转换）
        this.id = newConfig.id || this.id;
        this.min = parseFloat(newConfig.min);
        this.max = parseFloat(newConfig.max);
        this.unit = newConfig.unit || 'MPa';
        this.config = newConfig;
    }


    destroy() {
        super.destroy?.();
    }
}
