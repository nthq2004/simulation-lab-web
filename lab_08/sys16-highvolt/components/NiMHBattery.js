/**
 * NiMHBattery 镍氢电池组件。
 *
 * 该组件用于仿真镍氢电池的基本电气行为和可视化状态。电池模型由开路电压、
 * 内阻以及极化电阻/极化电容组成，并通过荷电状态 SOC 查表得到随容量变化的
 * 电压。仿真过程中，组件读取正负端子电压，计算端口电流、极化电压和 SOC，
 * 同时在电池图形上显示 SOC 进度、电压和电流。
 *
 * 主要功能：
 * 1. 提供正极 p 和负极 n 两个电气端口；
 * 2. 使用 SOC-电压分段线性表估算镍氢电池的开路电压；
 * 3. 使用内阻和极化 RC 支路计算端电压与动态电流；
 * 4. 根据电流积分更新 SOC，并用颜色区分电量高、中、低状态；
 * 5. 支持容量、初始 SOC、内阻、极化参数和初始极化电压配置。
 */
import { BaseComponent } from './BaseComponent.js';

export class NiMHBattery extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);

        // 限制电池图形的最小尺寸，确保铭牌和动态读数清晰可见。
        this.width  = Math.max(60, config.width  || 80);
        this.height = Math.max(100, config.height || 130);

        // 设置组件类型，供电路求解器识别为镍氢电池。
        this.type  = 'nimh_battery';
        // 使用固定缓存保存不随仿真状态变化的电池外壳和铭牌。
        this.cache = 'fixed';

        // 按组件生命周期初始化图层、几何尺寸、模型参数和图形节点。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 保存电池模型配置，便于配置面板和外部系统读取。
        this.config = {
            id: this.id,
            capacity:   this._capacity,
            initialSOC: this._soc,
            rOn:        this._rOn,
            rp:         this._rp,
            cp:         this._cp,
            initVP:     this._initVP,
        };

        // 在电池顶部和底部创建正负电气端口。
        this.addPort(this._portP.x, this._portP.y, 'p', 'wire', 'p');
        this.addPort(this._portN.x, this._portN.y, 'n', 'wire', 'n');
    }

    _recalcGeometry() {
        // 根据组件尺寸计算电池主体、正极端子和负极端子的几何位置。
        const W = this.width, H = this.height;
        this._cx = W * 0.50;

        this._termH  = Math.max(6,  H * 0.06);
        this._bodyTop = this._termH + 4;
        this._bodyBot = H - this._termH - 4;
        this._bodyH   = this._bodyBot - this._bodyTop;
        this._bodyW   = Math.max(30, W * 0.70);

        // 正极位于顶部中心，负极位于靠近底部的位置。
        this._portP = { x: this._cx, y: 0 };
        this._portN = { x: this._cx, y: H - 8 };
    }

    _initParameters(config) {
        // 读取容量参数，默认容量为 100mAh。
        this._capacity    = parseFloat(config.capacity)   || 100;
        // 将初始 SOC 限制在 0~1 范围内，默认初始电量为 80%。
        this._soc         = Math.max(0, Math.min(1, parseFloat(config.initialSOC) || 0.8));
        // 设置电池等效内阻。
        this._rOn         = parseFloat(config.rOn)        || 0.05;
        // 设置极化支路的电阻。
        this._rp          = parseFloat(config.rp)         || 1.0;
        // 设置极化支路的电容。
        this._cp          = parseFloat(config.cp)         || 0.33;
        // 设置极化电压的初始值。
        this._initVP      = parseFloat(config.initVP)     || -0.15;
        // 计算极化 RC 支路的时间常数。
        this._tau         = this._rp * this._cp;
        // 保存当前极化电压状态。
        this._vp          = this._initVP;
        // 根据初始 SOC 计算当前电池开路电压。
        this._voltage     = this._socToVoltage(this._soc);
        // 初始化端口电流。
        this._current     = 0;
    }

    _socToVoltage(s) {
        // 先将输入 SOC 限制在有效范围，避免查表插值越界。
        const soc = Math.max(0, Math.min(1, s));
        // 使用分段离散数据描述 SOC 与镍氢电池开路电压之间的关系。
        const table = [
            [0.00, 1.00], [0.05, 1.10], [0.15, 1.15],
            [0.30, 1.18], [0.60, 1.20], [0.85, 1.22],
            [0.95, 1.25], [1.00, 1.25],
        ];
        // 在相邻两个采样点之间进行线性插值。
        for (let i = 1; i < table.length; i++) {
            if (soc <= table[i][0]) {
                const t = (soc - table[i-1][0]) / (table[i][0] - table[i-1][0]);
                return table[i-1][1] + t * (table[i][1] - table[i-1][1]);
            }
        }
        // 输入达到表格上限时返回最后一个电压值。
        return table[table.length - 1][1];
    }

    _init() {
        // 初始化电池静态外观和动态状态显示节点。
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        // 绘制正极端子、电池外壳和 NiMH 铭牌。
        const cx = this._cx, W = this.width, H = this.height;
        const tH = this._termH, bT = this._bodyTop, bH = this._bodyH;
        const bW = this._bodyW;

        // 正极端子
        this._staticGroup.add(new Konva.Rect({
            x: cx - bW * 0.18, y: 0,
            width: bW * 0.36, height: tH+4,
            fill: '#f88a05', stroke: '#303438', strokeWidth: 1, cornerRadius: [2, 2, 0, 0],
        }));

        // 电池主体：使用横向渐变模拟电池外壳的立体效果。
        this._staticGroup.add(new Konva.Rect({
            x: cx - bW / 2, y: bT,
            width: bW, height: bH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bW, y: 0 },
            fillLinearGradientColorStops: [0, '#3a4048', 0.3, '#505860', 0.7, '#505860', 1, '#3a4048'],
            stroke: '#202428', strokeWidth: 1.5, cornerRadius: 3,
        }));

        // 铭牌：显示镍氢电池类型。
        const lFs = Math.max(10, bW * 0.11);
        this._staticGroup.add(new Konva.Text({
            x: cx - bW / 2 + 4, y: bT + 4,
            text: 'NiMH', fontSize: lFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#0fd40f',
        }));
    }

    _createDynamicNodes() {
        // 创建 SOC 进度条以及电量、电压、电流三个动态文本节点。
        const cx = this._cx;
        const bW = this._bodyW, bT = this._bodyTop, bH = this._bodyH;
        const dFs = Math.max(12, bW * 0.11);

        // SOC 进度条背景
        const barW = bW * 0.55, barH = bH * 0.08;
        const barX = cx ;
        const barY = bT + bH * 0.22;
        this._barBg = new Konva.Rect({
            x: barX-15 , y: barY, width: barW, height: barH,
            fill: '#202428', cornerRadius: 2,
        });
        this._dynamicGroup.add(this._barBg);

        // SOC 进度条填充：宽度与当前 SOC 成正比。
        this._barFill = new Konva.Rect({
            x: barX-15 , y: barY + 1,
            width: Math.max(0, (barW - 2) * this._soc),
            height: barH - 2,
            fill: '#30b868', cornerRadius: 1,
        });
        this._dynamicGroup.add(this._barFill);

        // SOC 文字
        this._socText = new Konva.Text({
            x: cx - bW / 2+ 6, y: bT + bH * 0.46,
            text: `${(this._soc * 100).toFixed(2)}%`,
            fontSize: dFs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#e0e8e0',
        });
        this._dynamicGroup.add(this._socText);

        // 电压文字
        this._voltText = new Konva.Text({
            x: cx - bW / 2 + 6, y: bT + bH * 0.62,
            text: `${this._voltage.toFixed(3)}V`,
            fontSize: dFs, fontFamily: 'Courier New',
            fill: '#f0d050',
        });
        this._dynamicGroup.add(this._voltText);

        // 电流文字：负号表示电流方向与默认放电方向相反。
        this._curText = new Konva.Text({
            x: cx - bW / 2 + 6, y: bT + bH * 0.78,
            text: `${this._current >= 0 ? '' : '-'}${Math.abs(this._current).toFixed(2)}A`,
            fontSize: dFs, fontFamily: 'Courier New',
            fill: '#60b0f0',
        });
        this._dynamicGroup.add(this._curText);
    }

    tick(dt) {
        // 每个仿真步从电压求解器读取电池正负端子所在节点的电压。
        const solver = this.sys?.voltageSolver;
        if (solver) {
            const cP = solver.portToCluster.get(`${this.id}_wire_p`);
            const cN = solver.portToCluster.get(`${this.id}_wire_n`);
            if (cP !== undefined && cN !== undefined) {
                // 计算端子电压和包含极化电压后的等效电源电压。
                const vP = solver.nodeVoltages.get(cP) || 0;
                const vN = solver.nodeVoltages.get(cN) || 0;
                const vTerminal = vP - vN;
                const vSrc = this._voltage - this._vp;
                // 根据端电压差和内阻计算当前电流。
                this._current = (vSrc - vTerminal) / this._rOn;

                // 使用指数离散形式更新极化电压，使 RC 动态具有平滑响应。
                const expFactor = Math.exp(-dt / this._tau);
                this._vp = this._vp * expFactor + this._current * this._rp * (1 - expFactor);

                // 将电流积分换算为 SOC 变化，电流为正时按当前约定减少 SOC。
                const dSOC = (this._current * dt) / (this._capacity * 3.6);
                this._soc = Math.max(0, Math.min(1, this._soc - dSOC));
                // SOC 变化后重新查表得到电池开路电压。
                this._voltage = this._socToVoltage(this._soc);
            }
        }

        // 刷新电池图形上的动态数值和进度条。
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateDynamic() {
        // 根据当前模型状态更新 SOC 进度条、SOC 文字、电压文字和电流文字。
        const bW = this._bodyW, bT = this._bodyTop, bH = this._bodyH;
        const barW = bW * 0.55, barH = bH * 0.08;
        const barX = this._cx + bW * 0.12 + 1;
        const barY = bT + bH * 0.22 + 1;

        // 进度条宽度与 SOC 成比例，并保证不会出现负宽度。
        this._barFill.width(Math.max(0, (barW - 2) * this._soc));
        this._socText.text(`${(this._soc * 100).toFixed(2)}%`);

        // 显示扣除极化电压后的等效端电压。
        const vSrc = this._voltage - this._vp;
        this._voltText.text(`${vSrc.toFixed(3)}V`);

        // 根据电流方向决定是否显示负号。
        const sign = this._current >= 0 ? '' : '-';
        this._curText.text(`${sign}${Math.abs(this._current).toFixed(2)}A`);

        // 按 SOC 区间切换进度条颜色：绿色表示充足，橙色表示偏低，红色表示很低。
        const socPct = this._soc;
        if (socPct > 0.3) {
            this._barFill.fill('#30b868');
        } else if (socPct > 0.15) {
            this._barFill.fill('#e0a030');
        } else {
            this._barFill.fill('#d04030');
        }
    }

    getValue() {
        // 返回包含极化影响的当前等效电池端电压。
        return this._voltage - this._vp;
    }

    // 返回当前荷电状态，范围为 0~1。
    getSOC() { return this._soc; }
    setSOC(v) {
        // 设置并限制 SOC，然后同步更新开路电压。
        this._soc = Math.max(0, Math.min(1, parseFloat(v) || 0));
        this._voltage = this._socToVoltage(this._soc);
    }

    getConfigFields() {
        // 配置面板开放容量、SOC、内阻和极化模型参数。
        return [
            { label: '容量 mAh',        key: 'capacity',   type: 'number' },
            { label: '初始 SOC (0~1)',   key: 'initialSOC', type: 'number' },
            { label: '内阻 Ω',          key: 'rOn',        type: 'number' },
            { label: '极化电阻 Ω',      key: 'rp',         type: 'number' },
            { label: '极化电容 F',      key: 'cp',         type: 'number' },
            { label: '初始极化电压 V',  key: 'initVP',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 按配置内容更新电池模型参数。
        if (cfg.capacity   !== undefined) this._capacity = parseFloat(cfg.capacity);
        if (cfg.initialSOC !== undefined) this.setSOC(parseFloat(cfg.initialSOC));
        if (cfg.rOn        !== undefined) this._rOn = parseFloat(cfg.rOn);
        // 极化电阻或电容变化后重新计算 RC 时间常数。
        if (cfg.rp         !== undefined) { this._rp = parseFloat(cfg.rp); this._tau = this._rp * this._cp; }
        if (cfg.cp         !== undefined) { this._cp = parseFloat(cfg.cp); this._tau = this._rp * this._cp; }
        if (cfg.initVP     !== undefined) this._vp = parseFloat(cfg.initVP);
        // 合并并保存最新配置。
        this.config = { ...this.config, ...cfg };
    }

    // 调用父类销毁逻辑，释放电池图形和相关资源。
    destroy() { super.destroy?.(); }
}
