import { BaseComponent } from './BaseComponent.js'; // 假设路径

export class Resistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'resistor';
        this.cache = 'fixed'; // 用于静态缓存的特殊标识
        // 默认阻值 10kΩ
        this.value = config.value || 10000;
        this.direction = config.direction; // 'vertical' 或 'horizontal'
        this.currentResistance = this.value;

        // 简化的配置对象，只保留 ID 和当前阻值
        this.config = { 'id': this.id, 'currentResistance': this.currentResistance };

        // 定义矩形电阻体的尺寸
        this.bodyWidth = 50 * this.scale;
        this.bodyHeight = 16 * this.scale;

        // 1. 绘制引脚（金属丝效果）
        const leadL = new Konva.Line({
            points: [-40 * this.scale, 0, -this.bodyWidth / 2, 0], // 接到矩形左侧边
            stroke: '#bdc3c7',
            strokeWidth: 2 * this.scale,
            lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [this.bodyWidth / 2, 0, 40 * this.scale, 0], // 从矩形右侧边引出
            stroke: '#bdc3c7',
            strokeWidth: 2 * this.scale,
            lineCap: 'round'
        });

        // 2. 绘制电阻主体（简化为矩形）
        const body = new Konva.Rect({
            x: -this.bodyWidth / 2, // 居中
            y: -this.bodyHeight / 2, // 居中
            width: this.bodyWidth,
            height: this.bodyHeight,
            fill: '#babd8f', // 使用稍微浅一点的哑光灰色
            stroke: '#bdc3c7',
            strokeWidth: 1 * this.scale,
            cornerRadius: 2 * this.scale, // 稍微有点圆角，看起来更像器件
            shadowColor: 'black',
            shadowBlur: 3 * this.scale,
            shadowOffset: { x: 1 * this.scale, y: 1 * this.scale },
            shadowOpacity: 0.2
        });

        // 将引脚和简化的身体添加到组中
        this.group.add(leadL, leadR, body);

        // 4. 添加电气端口（左端 l，右端 r）
        this.addPort(-40 * this.scale, 0, 'l', 'wire');
        this.addPort(40 * this.scale, 0, 'r', 'wire');
        let resText = '';
        if (this.currentResistance > 1000) {
            resText = (this.currentResistance / 1000).toFixed(1) + ' kΩ';
        } else {
            resText = this.currentResistance + ' Ω';
        }
        // 如果需要显示数值文字
        this.label = new Konva.Text({
            text: `${resText} `,
            x: -this.bodyWidth / 2,
            y: this.bodyHeight / 2 + 5 * this.scale, // 文字显示在电阻下方
            fontSize: 12 * this.scale,
            fontweight: 'bold',
            fontFamily: 'Calibri',
            fill: '#2c3e50',
            align: 'center',
            width: this.bodyWidth
        });
        this.group.add(this.label);
        if (this.direction === 'vertical') {
            this.group.rotate(90); // 默认垂直放置
        } else {
            // 水平放置时，调整文字位置
            this.label.y(this.bodyHeight / 2 + 5 * this.scale);
            this.label.x(-this.label.width() / 2); // 水平居中
        }
    }

    /**
     * 覆盖父类方法，定义配置界面字段
     */
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阻值 (Ω)', key: 'currentResistance', type: 'number' }
            // 移除了误差选项
        ];
    }

    /**
     * 覆盖父类方法，处理配置更新
     */
    onConfigUpdate(newConfig) {
        this.id = newConfig.id; // 更新 ID
        this.currentResistance = parseFloat(newConfig.currentResistance);
        let resText = '';
        if (this.currentResistance > 1000) {
            resText = (this.currentResistance / 1000).toFixed(1) + ' kΩ';
        } else {
            resText = this.currentResistance + ' Ω';
        };
        // 更新阻值文本显示
        this.label.text(`${resText} `);
        this.config = newConfig; // 更新配置对象
        // 如果该组件开启了离屏缓存，需要刷新缓存以反映新的文字
        this._refreshCache();
    }

    /**
     * 获取电阻值供仿真引擎调用
     */
    getValue() {
        return this.currentResistance;
    }
}