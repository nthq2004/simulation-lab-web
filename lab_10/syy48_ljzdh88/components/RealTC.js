import { BaseComponent } from './BaseComponent.js';

/**
 * RealTC — 实物风格热电偶（Thermocouple）传感器组件
 *
 * 说明：
 * - 提供热电偶探头的视觉模型与简化参数（`alpha`、`r0` 等），支持 `temp` / `currentVoltage` 状态；
 * - 可创建尾部接线端并配置交互，适用于与校验仪器或录入系统联动演示。
 */
export class RealTC extends BaseComponent {
    /**
     * @param {Object} config - 配置参数
     * @param {number} config.scale - 缩放比例 (默认 1)
     * @param {number} config.r0 - 0°C 时的基准电阻 (默认 100)
     * @param {Object} sys - 系统引用
     */
    constructor(config, sys) {
        super(config, sys);

        // ===== 参数配置 =====
        this.scale =  1.6;
        this.alpha = 0.000041;        // 热电偶温度系数

        // 核心状态
        this.type = 'tc';
        this.cache = 'fixed';

        this._initGroups();
        this.temp = 20;
        this.currentResistance = 0.5;
        this.currentVoltage = 0;
        this.isOpen = false;

        // 标准基准尺寸 (用于缩放计算)
        this.baseW = 120;
        this.baseH = 80;

        // ===== 初始化绘制 =====
        this._drawSensorModel();
        this._createTailPorts();
        this._setupInteractions();
        this._registerParts();
        this.group.rotate(90);
    }

    /**
     * 注册可识别部件：探头（指向插入水槽的操作）与尾部两根引线端子。
     * 坐标为组件本地坐标，getClickablePartCenter 会自动计入 rotate(90)/scale。
     */
    _registerParts() {
        const s = this.scale;
        this.addClickablePart('probe', 40 * s, -6 * s, 70 * s, 12 * s);
        this.addClickablePart('tail', -66 * s, 6 * s, 20 * s, 75 * s);
    }

    /**
     * 绘制传感器实物模型
     */
    _drawSensorModel() {
        const s = this.scale;

        // 1. 不锈钢探棒 (右侧前端，无端口)
        this.probe = new Konva.Rect({
            x: 40 * s, y: -5 * s,
            width: 70 * s, height: 10 * s,
            fillLinearGradientStartPoint: { x: 0, y: -3 * s },
            fillLinearGradientEndPoint: { x: 0, y: 3 * s },
            fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#ffffff', 1, '#95a5a6'],
            cornerRadius: [0, 3 * s, 3 * s, 0]
        });

        // 2. 六角安装螺母与螺纹
        const hexNut = new Konva.Rect({
            x: 30 * s, y: -10 * s, width: 10 * s, height: 20 * s,
            fill: '#7f8c8d', stroke: '#2c3e50', strokeWidth: 1 * s, cornerRadius: 1 * s
        });

        // 3. 柔性金属屏蔽线 (尾部连接部分)
        const wirePath = new Konva.Line({
            points: [
                30 * s, 0,
                10 * s, 0,
                0, 10 * s,
                -10 * s, 30 * s,
                -30 * s, 40 * s
            ],
            stroke: '#bdc3c7',
            strokeWidth: 5 * s,
            tension: 0.5,
            shadowBlur: 2 * s,
            shadowColor: '#000'
        });

        // 4. 三线制分线头 (尾端)
        const tailY = 40 * s;
        const tailX = -30 * s;

        // 绘制三根彩色引线 (红、蓝、蓝)
        const colors = ['#e74c3c', '#3498db'];
        colors.forEach((color, i) => {
            const offset = (2 * i - 1) * 30 * s;
            this._staticGroup.add(new Konva.Line({
                points: [tailX, tailY, tailX - 20 * s, tailY + offset],
                stroke: color,
                strokeWidth: 4 * s
            }));

            // 绘制末端冷压端子
            this._staticGroup.add(new Konva.Rect({
                x: tailX - 36 * s, y: tailY + offset - 5 * s,
                width: 20 * s, height: 10 * s,
                fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 0.5 * s
            }));
        });

        this._staticGroup.add(wirePath, hexNut, this.probe);

        // 故障指示（断路时探棒描红并标注）— 动态层，随故障状态显隐
        this.faultMark = new Konva.Rect({
            x: 38 * s, y: -7 * s, width: 74 * s, height: 14 * s,
            stroke: '#e74c3c', strokeWidth: 2.5, cornerRadius: 2,
            visible: false, listening: false,
        });
        this.faultText = new Konva.Text({
            x: 40 * s, y: -20 * s, rotation: -90, width: 80,
            text: '', fontSize: 12, fontStyle: 'bold', fill: '#e74c3c',
            listening: false,
        });
        this._dynamicGroup.add(this.faultMark, this.faultText);

        // 5. 数据文本（组件整体旋转 90°，文字再回转 -90° 保持水平可读）
        this.resText = new Konva.Text({
            x: -40 * s, y: -15 * s,
            rotation: -90,
            text: `K型 tc`,
            fontSize: 12 * s,
            fontStyle: 'bold',
            fill: '#2c3e50',
            align: 'center'
        });
        this._staticGroup.add(this.resText);
    }

    /**
     * 在尾端引出 3 个电气接口
     */
    _createTailPorts() {
        const s = this.scale;
        const tailX = -56 * s; // 接口相对于组件中心的位置
        const tailY = 40 * s;

        // 三线制接口：L (Line), R (Return), T (Third/Compensation)
        this.addPort(tailX, tailY - 30 * s, 'r', 'wire', 'p'); // 蓝色线2
        this.addPort(tailX, tailY + 30 * s, 'l', 'wire'); // 红色线
    }

    /**
     * 更新物理电阻值
     * @param {number} temp - 输入温度
     */
    update(temp) {
        // 计算标准电阻
        // 故障逻辑
        this.temp = temp;
        this.currentVoltage = this.alpha * temp;
        if (this.isOpen) {
            this.currentResistance = 1e9;
            this.currentVoltage = 0;
        }
        else {
            this.currentResistance = 0.5;
        }
        if (this.faultMark) {
            this.faultMark.visible(!!this.isOpen);
            this.faultText.text(this.isOpen ? '断路' : '');
            if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
        }
    }

    /** 设置断路故障（供故障设置界面调用） */
    setOpenFault(on) {
        this.isOpen = !!on;
        this.update(this.temp);
    }

    _setupInteractions() {
        this.group.on('dblclick', () => {
            this.isOpen = false;
            this.update(this.temp);
        });
    }


    destroy() {
        super.destroy?.();
    }
}
