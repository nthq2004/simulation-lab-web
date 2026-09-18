/**
 * DMMController 数字万用表控制器组件。
 *
 * 作用：这是一个用于仿真平台中的数字多功能测量控制器，主要负责接收外部开关状态并在不同功能模式下计算电流、电压、电阻、二极管、电容和电感等参数。
 * 它通过读取系统中的电压/端口信息，将不同测量模式下的数值格式化后显示在 LCD 面板中，适合用于教学演示和仪表联动调试。
 *
 * 设计特点：
 * 1. 通过 switchId 关联外部智能开关，按功能切换 DCA/DCV/R/Diode/C/L 等模式；
 * 2. 采用自动量程逻辑控制开关位置以模拟真实数字表的选档行为；
 * 3. 以 LCD 文本方式展示当前量程和测量值，增强控制与可视化反馈；
 * 4. 对电容和电感涉及的充放电过程做了状态机式处理，便于教学说明动态测量过程。
 */
import { BaseComponent } from './BaseComponent.js';

export class DMMController extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件基础能力和系统对象引用。
        super(config, sys);
        // 初始化 Konva 的静态和动态图层，后续界面元素会分别挂到不同分组中。
        this._initGroups();

        // 设置组件宽高，默认尺寸为 360×200，并允许外部配置覆盖。
        this.width  = config.width  || 360;
        this.height = config.height || 200;
        // 组件类型和缓存策略用于在仿真系统中识别和复用该图形。
        this.type = 'dmm_controller';
        this.cache = 'fixed';

        // 关联的智能开关 ID 用于从系统对象中拿到对应的开关组件，实际控制功能切换逻辑。
        this.switchId = config.switchId || 'smart_switch';
        this.switchRef = null;

        // 直流电流档位的分流电阻和名称定义，用于换档时计算对应电流。
        this._shuntValues = [4, 0.4, 0.04];
        this._rangeNames = ['50mA', '500mA', '5A'];
        this._capMeasuring = false;
        this._capDischarging = false;
        this._capStartTime = 0;
        this._capResult = null;
        this._indMethod = 'voltage';
        this._indMeasuring = false;
        this._indStartTime = 0;
        this._indResult = null;
        this._indDischarging = false;
        this._dividerRatios = [0.999, 0.0999, 0.0099, 0.001];
        this._rangeNamesDCV = ['200mV', '2V', '20V', '200V'];
        this._ohmsTestCurrents = [0.001, 0.0001, 0.00001, 0.000001];
        this._rangeNamesR = ['200Ω', '2000Ω', '20kΩ', '200kΩ'];
        this._autoRangeCooldown = 0.5;

        // 画出主体面板和 LCD 显示区，随后连接各个端口建立电气节点。
        this._drawBody();
        this._drawLCD();

        // 端口均位于组件左侧，并命名为 Vin+、Vin-、A、B，便于接线和读取电压。
        this.addPort(0, 36, 'vin_p', 'wire', 'p');
        this.addPort(0, 86, 'vin_n', 'wire');
        this.addPort(0, 140, 'a', 'wire','p');
        this.addPort(0, 190, 'b', 'wire');
    }

    _drawBody() {
        // 面板主体绘制仪表最外层外壳，并在顶部放置功能标题，模拟现实万用表外观。
        const W = this.width, H = this.height;

        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#f5f5f5', stroke: '#ccc', strokeWidth: 2, cornerRadius: 6,
        }));

        this._staticGroup.add(new Konva.Text({
            x: 120, y: 10, text: 'DMM 数字控制器', fontSize: 16,
            fill: '#333', fontStyle: 'bold',
        }));

        this._staticGroup.add(new Konva.Text({
            x: -18, y: 20, text: 'Vin+', fontSize: 11, fill: '#e74c3c',
        }));
        this._staticGroup.add(new Konva.Text({
            x: -18, y: 70, text: 'Vin-', fontSize: 11, fill: '#666',
        }));
        this._staticGroup.add(new Konva.Text({
            x: -18, y: 124, text: 'A', fontSize: 10, fill: '#1f8b4c', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: -18, y: 164, text: 'B', fontSize: 10, fill: '#1f8b4c', listening: false,
        }));
    }

    _drawLCD() {
        // LCD 区域因为会动态更新数值，因此由静态背景和动态文本节点共同构成。
        const W = this.width, H = this.height;
        const lcdX = 18, lcdW = W - 36, lcdH = 150, lcdY = 40;

        this._staticGroup.add(new Konva.Rect({
            x: lcdX, y: lcdY, width: lcdW, height: lcdH,
            fill: '#000', stroke: '#888', strokeWidth: 1, cornerRadius: 4,
        }));

        this._funcText = new Konva.Text({
            x: lcdX + 12, y: lcdY + 10, width: lcdW - 24,
            text: 'DCA', fontSize: 22, fill: '#0f0',
            fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
        });
        this._dynamicGroup.add(this._funcText);

        this._rangeText = new Konva.Text({
            x: lcdX + 12, y: lcdY + 48, width: lcdW - 24,
            text: '50mA', fontSize: 24, fill: '#0f0',
            fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
        });
        this._dynamicGroup.add(this._rangeText);

        this._valueText = new Konva.Text({
            x: lcdX + 12, y: lcdY + 88, width: lcdW - 24,
            text: '0.000', fontSize: 42, fill: '#0f0',
            fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
        });
        this._dynamicGroup.add(this._valueText);
    }

    _getSwitch() {
        // 通过缓存的 switchRef 获取关联开关实例，避免每帧反复查找组件对象。
        if (!this.switchRef) {
            this.switchRef = this.sys.comps[this.switchId];
        }
        return this.switchRef;
    }

    _formatCapValue(f) {
        // 电容显示采用工程单位格式，确保 1F、mF、μF、nF、pF 等值都能按真实仪表习惯展示。
        if (f >= 1) return f.toFixed(3) + ' F';
        if (f >= 1e-3) return (f * 1e3).toFixed(2) + ' mF';
        if (f >= 1e-6) return (f * 1e6).toFixed(1) + ' \u03BCF';
        if (f >= 1e-9) return (f * 1e9).toFixed(0) + ' nF';
        return (f * 1e12).toFixed(0) + ' pF';
    }

    _formatIndValue(f) {
        // 电感量值也遵循工程单位格式，显示为 H、mH、μH、nH 这几种常见单位。
        if (f >= 1) return f.toFixed(3) + ' H';
        if (f >= 1e-3) return (f * 1e3).toFixed(2) + ' mH';
        if (f >= 1e-6) return (f * 1e6).toFixed(1) + ' \u03BCH';
        return (f * 1e9).toFixed(0) + ' nH';
    }

    _autoRange(voltage, pos) {
        // 自动量程按阈值逻辑切换档位：电压过高时升档，过低时降档，模拟真实万用表的量程切换行为。
        if (pos === 1 && voltage > 0.18) {
            this._getSwitch()?.setPosition(2);
        } else if (pos === 2 && voltage > 0.18) {
            this._getSwitch()?.setPosition(3);
        } else if (pos === 3 && voltage > 0.18) {
            this._getSwitch()?.setPosition(4);
        } else if (pos === 2 && voltage < 0.012) {
            this._getSwitch()?.setPosition(1);
        } else if (pos === 3 && voltage < 0.012) {
            this._getSwitch()?.setPosition(2);
        } else if (pos === 4 && voltage < 0.012) {
            this._getSwitch()?.setPosition(3);
        }
    }

    tick(dt) {
        // 每个仿真步进都会读取关联开关的功能模式与端口电压，并据此更新 LCD 显示值。
        const sw = this._getSwitch();
        if (!sw) return;

        const func = sw.getFunction();

        const vp = this.id + '_wire_vin_p';
        const vn = this.id + '_wire_vin_n';
        let voltage = 0;
        try {
            voltage = this.sys.getVoltageBetween(vp, vn) || 0;
        } catch (e) { voltage = 0; }

        this._funcText.text(func);

        if (func === 'DCA') {
            const pos = sw.getPosition();
            const Rs = this._shuntValues[pos - 1] || this._shuntValues[0];
            const currentA = voltage / Rs;

            this._autoRangeCooldown -= dt;
            if (this._autoRangeCooldown <= 0) {
                this._autoRange(voltage, pos);
                this._autoRangeCooldown = 0.5;
            }

            const rangeName = this._rangeNames[pos - 1] || '';
            this._rangeText.text(rangeName);

            const current = Math.abs(currentA);
            let disp;
            if (current < 0.0005) {
                disp = '0.000';
            } else if (pos === 3) {
                disp = current.toFixed(3);
            } else {
                disp = (current * 1000).toFixed(2);
            }
            this._valueText.text(disp);
        } else if (func === 'DCV') {
            const pos = sw.getPosition();
            const ratio = this._dividerRatios[pos - 1] || this._dividerRatios[0];
            const V_mid = Math.abs(voltage);
            const V_src = V_mid / ratio;

            this._autoRangeCooldown -= dt;
            if (this._autoRangeCooldown <= 0) {
                this._autoRange(V_mid, pos);
                this._autoRangeCooldown = 0.5;
            }

            const rangeName = this._rangeNamesDCV[pos - 1] || '';
            this._rangeText.text(rangeName);

            let disp;
            if (V_src < 0.0001) {
                disp = '0.000';
            } else if (pos === 1) {
                disp = (V_src * 1000).toFixed(2);
            } else if (pos === 4) {
                disp = V_src.toFixed(1);
            } else {
                disp = V_src.toFixed(3);
            }
            this._valueText.text(disp);
        } else if (func === 'R') {
            const pos = sw.getPosition();
            const I_test = this._ohmsTestCurrents[pos - 1] || this._ohmsTestCurrents[0];
            const V_meas = Math.abs(voltage);
            const R = I_test > 0 ? V_meas / I_test : 0;

            this._autoRangeCooldown -= dt;
            if (this._autoRangeCooldown <= 0) {
                this._autoRange(V_meas, pos);
                this._autoRangeCooldown = 0.5;
            }

            this._rangeText.text(this._rangeNamesR[pos - 1] || '');

            const maxR = [200, 2000, 20000, 200000][pos - 1] || 200000;
            let disp;
            if (R < 0.001 || R !== R) {
                disp = '0.000';
            } else if (R > maxR) {
                disp = 'OL';
            } else if (pos === 1) {
                disp = R.toFixed(1) + ' Ω';
            } else if (pos === 2) {
                disp = R.toFixed(0) + ' Ω';
            } else if (pos === 3) {
                disp = (R / 1000).toFixed(2) + ' kΩ';
            } else {
                disp = (R / 1000).toFixed(1) + ' kΩ';
            }
            this._valueText.text(disp);
        } else if (func === 'Diode') {
            const V_mid = Math.abs(voltage);
            const V_diode = V_mid * 19.8;
            this._rangeText.text('二极管');

            if (V_diode > 0.9) {
                this._valueText.text('OL');
            } else if (V_diode < 0.001) {
                this._valueText.text('0.000');
            } else {
                this._valueText.text(V_diode.toFixed(3));
            }
        } else if (func === 'C') {
            if (this._capResult !== null) {
                this._rangeText.text('电容');
                this._valueText.text(this._formatCapValue(this._capResult));
                if (this._capDischarging) {
                    const v = Math.abs(voltage);
                    if (v < 0.01) {
                        this._capDischarging = false;
                        const sw = this._getSwitch();
                        if (sw) sw.setPosition(3);
                    }
                }
            } else if (this._capMeasuring) {
                const v = Math.abs(voltage);
                if (v >= 2.0) {
                    this._capMeasuring = false;
                    const solver = this.sys.voltageSolver;
                    const elapsed = solver ? solver.currentTime - this._capStartTime : 0;
                    this._capResult = elapsed > 0 ? (0.001 * elapsed / 2.0) : 0;

                    const sw = this._getSwitch();
                    if (sw) sw.setPosition(2);
                    this._capDischarging = true;

                    this._rangeText.text('电容');
                    this._valueText.text(this._formatCapValue(this._capResult));
                } else {
                    this._rangeText.text('充电');
                    this._valueText.text(v.toFixed(3) + 'V');
                }
            } else {
                this._rangeText.text('电容');
                this._valueText.text('0.000');
            }
        } else if (func === 'L') {
            const dischargeThreshold = 0.00001;
            if (this._indResult !== null) {
                this._rangeText.text('电感');
                this._valueText.text(this._formatIndValue(this._indResult));
                if (this._indDischarging) {
                    const v = Math.abs(voltage);
                    if (v < dischargeThreshold) {
                        this._indDischarging = false;
                        const sw = this._getSwitch();
                        if (sw) sw.setPosition(3);
                    }
                }
            } else if (this._indMeasuring) {
                const v = Math.abs(voltage);
                if (this._indMethod === 'voltage') {
                    if (v > 1e-9) {
                        this._indMeasuring = false;
                        const solver = this.sys.voltageSolver;
                        const dt = solver ? solver.deltaTime : 0.0001;
                        const vL = 5 - v * 1001;
                        this._indResult = Math.abs(vL * dt / v);

                        const sw = this._getSwitch();
                        if (sw) sw.setPosition(2);
                        this._indDischarging = true;

                        this._rangeText.text('电感');
                        this._valueText.text(this._formatIndValue(this._indResult));
                    } else {
                        this._rangeText.text('充电');
                        this._valueText.text(v.toFixed(6) + 'V');
                    }
                } else {
                    const n = this._indMethod === 'tau5' ? 5 : 1;
                    const vSs = 5 / 1001;
                    const threshold = vSs * (1 - Math.exp(-n));
                    if (v >= threshold) {
                        this._indMeasuring = false;
                        const solver = this.sys.voltageSolver;
                        const elapsed = solver ? Math.max(0, solver.currentTime - this._indStartTime - solver.deltaTime) : 0;
                        this._indResult = elapsed > 0 ? (1001 * elapsed / n) : 0;

                        const sw = this._getSwitch();
                        if (sw) sw.setPosition(2);
                        this._indDischarging = true;

                        this._rangeText.text('电感');
                        this._valueText.text(this._formatIndValue(this._indResult));
                    } else {
                        const pct = Math.min(99.9, v / vSs * 100);
                        this._rangeText.text('充电 ' + n + 'τ');
                        this._valueText.text(pct.toFixed(1) + '%');
                    }
                }
            } else {
                this._rangeText.text('电感');
                this._valueText.text('0.000');
            }
        } else {
            this._rangeText.text('--');
            this._valueText.text('0.000');
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        // 配置面板只暴露关联开关 ID，允许在运行前或调试时切换开关实例。
        return [
            { label: '关联开关 ID', key: 'switchId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        // 配置更新时仅重置关联开关引用，下一次读取时会重新绑定最新的开关组件。
        if (cfg.switchId !== undefined) {
            this.switchId = cfg.switchId;
            this.switchRef = null;
        }
    }

    destroy() {
        super.destroy?.();
    }
}
