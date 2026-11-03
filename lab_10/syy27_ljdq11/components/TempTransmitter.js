import { BaseComponent } from './BaseComponent.js';

/**
 * TempTransmitter — 温度变送器（两线制）组件
 *
 * 说明：
 * - 模拟 4-20mA 两线制温度变送器：接收回路电流并把其映射为温度显示在 LCD 上；
 * - 支持 `zeroAdj` / `spanAdj` 旋钮微调、开路/短路故障显示与最小/最大量程配置；
 * - 遵循新组件规范（BaseComponent 模板）：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`；
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`；
 *   静态件位图缓存一次，动态件（LCD 文本/底色）in-place 更新，不刷新缓存、无阴影。
 */
export class TempTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'transmitter_2wire';
        this.special = 'temp';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, min: this.min, max: this.max,
            temp: this.temp, zeroAdj: this.zeroAdj, spanAdj: this.spanAdj,
        };

        // 输入侧（PT100 三线制 l/m/r）与输出侧（p/n）
        this.addPort(40, 168, 'l', 'wire', 'p');
        this.addPort(70, 168, 'm', 'wire');
        this.addPort(100, 168, 'r', 'wire');
        this.addPort(140, 18, 'p', 'wire', 'p');
        this.addPort(140, 48, 'n', 'wire');
    }

    // ═══════════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.width = Math.max(140, Math.min(config.width || 140, 200));
        this.height = Math.max(180, Math.min(config.height || 180, 240));
        this._lcdCenterY = 85;
    }

    _initParameters(config) {
        this.zeroAdj = 0;
        this.spanAdj = 1.0;
        this.temp = 20;
        this.min = config.min !== undefined ? config.min : 0;
        this.max = config.max !== undefined ? config.max : 100;
        this.isBreak = false;   // 输出回路开路标志
        this.isShort = false;   // 变送器短路标志（回路电流上冲 >30mA）

        // 由 CircuitUtils.calcTransmitterCurrent() 每帧写入：
        // _sensorTemp = 输入 PT100 电阻对应的真实温度（℃），
        // _ptFault    = 传感器/接线故障（'open' 断路 / 'short' 短路 / null 正常）。
        // 本地 LCD 直接用 _sensorTemp 显示，不经过 4~20mA 输出环节，
        // 从而不受零点/量程校准及输出钳位影响，始终反映输入电阻对应的温度。
        this._sensorTemp = undefined;
        this._ptFault = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════════

    _drawStaticParts() {
        const centerX = this.width / 2;
        const cy = this._lcdCenterY;

        // 顶部 T 型横梁（接线仓）
        this._staticGroup.add(new Konva.Rect({
            x: 20, y: 10, width: this.width - 40, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 22, y: -10, width: this.width, text: '温度变送器',
            fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold',
        }));

        // 左右金属密封盖
        this._staticGroup.add(new Konva.Rect({ x: 0, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 }));
        this._staticGroup.add(new Konva.Rect({ x: this.width - 20, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 }));

        // 圆形表头 + 深绿色旋盖
        this._staticGroup.add(new Konva.Circle({ x: centerX, y: cy, radius: 55, fill: '#2f3542', stroke: '#1e272e', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Circle({ x: centerX, y: cy, radius: 52, fill: '#27ae60', stroke: '#1e8449', strokeWidth: 4 }));

        // 底部丝扣接口
        this._staticGroup.add(new Konva.Rect({ x: centerX - 10, y: 140, width: 20, height: 10, fill: '#ced6e0', stroke: '#747d8c' }));
        this._staticGroup.add(new Konva.Rect({ x: centerX - 45, y: 150, width: 90, height: 20, fill: '#747d8c', cornerRadius: 2 }));

        // 可识别部件
        this.addClickablePart('lcd', centerX - 38, cy - 38, 76, 76);
        this.addClickablePart('zero', 50 - 11, 32 - 11, 22, 22);
        this.addClickablePart('span', this.width - 50 - 11, 32 - 11, 22, 22);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════════

    _createDynamicNodes() {
        const centerX = this.width / 2;
        const cy = this._lcdCenterY;

        // LCD 背景 + 数值 + 单位
        this.lcdBg = new Konva.Circle({ x: centerX, y: cy, radius: 38, fill: '#000' });
        this.lcdText = new Konva.Text({
            x: centerX - 30, y: cy - 10, width: 60, text: '',
            fontSize: 18, fontFamily: 'Digital-7, monospace', fill: '#00ff00',
            align: 'center', fontStyle: 'bold',
        });
        this.unitText = new Konva.Text({
            x: centerX - 15, y: cy + 12, text: '°C', fontSize: 10, fill: '#1a1a1a', opacity: 0,
        });
        this._interactGroup.add(this.lcdBg, this.lcdText, this.unitText);

        // 拟物旋钮（零点 Z / 量程 S），隐藏盖板下的调节孔
        this.knobs = {};
        [{ id: 'zero', x: 50, label: 'Z' }, { id: 'span', x: this.width - 50, label: 'S' }].forEach(k => {
            const knobGroup = new Konva.Group({ x: k.x, y: 32 });
            knobGroup.add(new Konva.Circle({ radius: 11, fill: '#dfe4ea', stroke: '#747d8c' }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#2f3542', strokeWidth: 3 }));
            knobGroup.add(rotor);
            this.knobs[k.id] = rotor;
            this._interactGroup.add(knobGroup);

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cyy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    rotor.rotation(startRot + (startY - cyy) * 2);
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
        });
    }

    _bindInteraction() {
        // 双击 LCD 清除输出开路故障
        this.lcdBg.on('dblclick', (e) => { e.cancelBubble = true; if (this.isBreak) this.isBreak = false; });
    }

    // ═══════════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════════

    update(state) {
        // state: { powered: bool, transCurrent: number(mA) }
        if (this.isBreak || !state || !state.powered) {
            this.lcdText.text('');
            this.unitText.text('');
            this.unitText.opacity(0);
            this.lcdBg.fill('#000');
            this.markDirty();
            this._refreshIfDirty();
            return;
        }

        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;

        // ── 本地 LCD 显示策略 ──────────────────────────────────────────
        // 变送器本体始终显示「输入电阻值对应的真实温度」：
        //   * 不叠加零点(Z)/量程(S)校准，也不经过 4~20mA 输出环节，
        //     因此不会因输出电流钳位（3.8/20.5mA）而失真；
        //   * _sensorTemp / _ptFault 由 CircuitUtils.calcTransmitterCurrent() 每帧写入。
        const fault = this._ptFault;
        const sensorTemp = this._sensorTemp;

        if (this.isShort || fault === 'open') {
            // 变送器短路 / 变送器开路 / PT100 断路 / 输入接线错误 → 上冲显示
            this.lcdText.text('HHHH');
            this.lcdText.fill('#ff4757');
            this.unitText.opacity(0);
            this.lcdBg.fill('#2f3542');
        } else if (fault === 'short') {
            // PT100 短路 → 低于下限
            this.lcdText.text('LLLL');
            this.lcdText.fill('#ff4757');
            this.unitText.opacity(0);
            this.lcdBg.fill('#2f3542');
        } else if (typeof sensorTemp === 'number' && isFinite(sensorTemp)) {
            this.temp = sensorTemp;
            this.lcdText.text(sensorTemp.toFixed(1));
            this.lcdText.fill('#1a1a1a');
            this.unitText.text('°C');
            this.unitText.opacity(1);
            this.lcdBg.fill('#2ed573');
        } else {
            // 兜底：暂无真实温度信息时，退回按回路电流估算（保持旧行为）
            const tempDisp = ((inCurrent - 4 - this.zeroAdj) / (16 * this.spanAdj)) * (this.max - this.min) + this.min;
            this.temp = tempDisp;
            if (inCurrent < 3.8) {
                this.lcdText.text('LLLL');
                this.lcdText.fill('#ff4757');
                this.unitText.opacity(0);
                this.lcdBg.fill('#2f3542');
            } else if (inCurrent > 20.5) {
                this.lcdText.text('HHHH');
                this.lcdText.fill('#ff4757');
                this.unitText.opacity(0);
                this.lcdBg.fill('#2f3542');
            } else {
                this.lcdText.text(tempDisp.toFixed(1));
                this.lcdText.fill('#1a1a1a');
                this.unitText.text('°C');
                this.unitText.opacity(1);
                this.lcdBg.fill('#2ed573');
            }
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 电源输入引脚 p、n 是否都已接线：任一悬空 → 变送器不显示、不工作 */
    _powerPinsConnected() {
        const sys = this.sys;
        if (!sys || !Array.isArray(sys.conns)) return false;
        const hasWire = (pid) => sys.conns.some(c => c.from === pid || c.to === pid);
        return hasWire(`${this.id}_wire_p`) && hasWire(`${this.id}_wire_n`);
    }

    tick() {
        // 两个电源输入引脚任一端悬空即视为未得电：不显示、无输出电流
        const wired = this._powerPinsConnected();
        this.update({
            powered: wired && (this._lastVDiff || 0) > 10,
            transCurrent: wired ? (this.physCurrent || 0) * 1000 : 0,
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════════

    // ── 可识别部件中心（供自动演示箭头精确定位）──
    getClickablePartCenter(partId) {
        const node = {
            lcd: this.lcdBg,
            zero: this.knobs && this.knobs.zero,
            span: this.knobs && this.knobs.span,
        }[partId];
        if (node) { const c = this.getNodeCenter(node); if (c) return c; }
        return super.getClickablePartCenter(partId);
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '下限值', key: 'min', type: 'number' },
            { label: '上限值', key: 'max', type: 'number' },
            { label: '温度值', key: 'temp', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.min !== undefined) this.min = parseFloat(cfg.min);
        if (cfg.max !== undefined) this.max = parseFloat(cfg.max);
        if (cfg.temp !== undefined) this.temp = parseFloat(cfg.temp);
        this.config = { ...this.config, id: this.id, min: this.min, max: this.max, temp: this.temp };
    }

    destroy() {
        super.destroy?.();
    }
}

export default TempTransmitter;
