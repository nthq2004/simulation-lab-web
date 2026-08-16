import { BaseComponent } from './BaseComponent.js'; // 导入基本组件基类

// 铅酸蓄电池组件，模拟 12V 蓄电池的电压、SOC、极化行为和比重显示
export class LeadAcidBattery extends BaseComponent { // 声明组件类
    constructor(config, sys) { // 构造函数
        super(config, sys); // 调用基类构造函数

        // 组件最小尺寸保护，避免过小导致显示错乱
        this.width  = Math.max(200, config.width  || 350); // 宽度
        this.height = Math.max(160, config.height || 280); // 高度

        this.type  = 'leadacid_battery'; // 组件类型标识
        this.cache = 'fixed'; // 启用固定缓存

        this._initGroups(); // 初始化图层组
        this._recalcGeometry(); // 计算几何数据
        this._initParameters(config); // 初始化参数
        this._init(); // 初始化图形

        // 保留当前配置值，便于配置面板读取和更新
        this.config = {
            id: this.id,
            capacity:    this._capacity, // 电池容量
            initialSOC:  this._soc, // 初始荷电状态
            rOn:         this._rOn, // 内阻
            rp:          this._rp, // 极化电阻
            cp:          this._cp, // 极化电容
        };

        // 为 6 节电池串联单元创建端口，奇偶单元极性交替
        for (let i = 1; i <= 6; i++) { // 遍历 6 个电池单元
            const cx = this._cellCx[i - 1]; // 当前单元中心 x
            const isOdd = i % 2 === 1; // 判断奇偶单元
            const topY = 8; // 顶部端子 y 坐标
            const botY = this.height - 8; // 底部端子 y 坐标
            if (isOdd) {
                this.addPort(cx, topY, `cell${i}_p`, 'wire', 'p'); // 奇数单元顶部正极
                this.addPort(cx, botY, `cell${i}_n`, 'wire', 'n'); // 奇数单元底部负极
            } else {
                this.addPort(cx, topY, `cell${i}_n`, 'wire', 'n'); // 偶数单元顶部负极
                this.addPort(cx, botY, `cell${i}_p`, 'wire', 'p'); // 偶数单元底部正极
            }
        }
    }

    // 根据组件尺寸计算外观布局参数
    _recalcGeometry() {
        const W = this.width, H = this.height; // 读取组件尺寸
        this._termH = Math.max(5, H * 0.045); // 计算端子高度
        this._bodyTop = this._termH + 3; // 主体顶部 y
        this._bodyBot = H - this._termH - 3; // 主体底部 y
        this._bodyH = this._bodyBot - this._bodyTop; // 主体高度

        const cellW = Math.max(14, W * 0.14); // 单元宽度
        const spacing = Math.max(10, (W - cellW) / 5.5); // 单元间距
        this._cellW = cellW; // 保存单元宽度

        const startX = (W - (5 * spacing + cellW)) / 2 + cellW / 2; // 第一个单元中心 x
        this._cellCx = []; // 存储每个单元中心 x
        for (let i = 0; i < 6; i++) { // 遍历 6 个单元
            this._cellCx.push(startX + i * spacing); // 计算单元中心位置
        }
    }

    // 初始化状态参数，包含 SOC、内阻、极化参数以及电压和比重
    _initParameters(config) {
        this._capacity = parseFloat(config.capacity) || 56; // 电池容量 Ah
        this._soc  = Math.max(0, Math.min(1, parseFloat(config.initialSOC) || 0.8)); // 初始 SOC
        this._rOn  = parseFloat(config.rOn) || 0.006; // 内阻（56Ah 电池）
        this._rp   = parseFloat(config.rp)  || 0.1; // 极化电阻（56Ah 电池）
        this._cp   = parseFloat(config.cp)  || 2.3; // 极化电容（56Ah 电池）
        this._tau  = this._rp * this._cp; // 极化时间常数
        this._vp   = 0; // 初始极化电压
        this._voltage = 6 * this._socToCellVoltage(this._soc); // 开路电压
        this._current = 0; // 初始电流
        this._sg = this._socToSG(this._soc); // 比重
        this._cellVoltages = [0, 0, 0, 0, 0, 0]; // 单体电压数组
    }

    // 根据 SOC 插值计算单节铅酸电池的开路电压
    _socToCellVoltage(s) {
        const soc = Math.max(0, Math.min(1, s)); // 限制 SOC 范围
        const table = [ // 插值表
            [0.00, 1.75], [0.10, 1.82], [0.25, 1.90],
            [0.50, 1.96], [0.75, 2.02], [0.90, 2.07],
            [1.00, 2.10],
        ];
        for (let i = 1; i < table.length; i++) { // 查找区间
            if (soc <= table[i][0]) {
                const t = (soc - table[i-1][0]) / (table[i][0] - table[i-1][0]); // 计算插值比
                return table[i-1][1] + t * (table[i][1] - table[i-1][1]); // 返回插值电压
            }
        }
        return table[table.length - 1][1]; // 最后一个值
    }

    // 根据 SOC 计算电解液比重的简化关系
    _socToSG(s) {
        return 1.15 + s * 0.15; // 简化的线性比重模型
    }

    _init() { // 初始化组件显示
        this._drawStaticParts(); // 绘制静态部分
        this._createDynamicNodes(); // 创建动态节点
    }

    // 绘制不随时间变化的静态图形部分
    _drawStaticParts() {
        const W = this.width, H = this.height; // 读取组件宽高
        const tH = this._termH, bT = this._bodyTop, bH = this._bodyH; // 计算几何参数
        const cellW = this._cellW; // 电池单元宽度

        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: H - 4, // 外框位置和尺寸
            fill: '#d0d8e0', stroke: '#808890', strokeWidth: 1, cornerRadius: 4, // 外框样式
        }));

        for (let i = 0; i < 6; i++) { // 绘制 6 个电池单元
            const cx = this._cellCx[i]; // 当前单元中心 x
            const isOdd = i % 2 === 0; // 区分奇偶单元
            const topTermColor = isOdd ? '#d03020' : '#6a849f'; // 顶端端子颜色
            const botTermColor = isOdd ? '#627384' : '#d03020'; // 底端端子颜色

            // 电池单元外壳
            this._staticGroup.add(new Konva.Rect({
                x: cx - cellW / 2, y: bT, // 单元主体位置
                width: cellW, height: bH, // 单元主体尺寸
                fillLinearGradientStartPoint: { x: 0, y: 0 }, // 渐变起点
                fillLinearGradientEndPoint:   { x: cellW, y: 0 }, // 渐变终点
                fillLinearGradientColorStops: [0, '#c8d0d8', 0.3, '#e0e8f0', 0.7, '#e0e8f0', 1, '#c8d0d8'], // 渐变色
                stroke: '#404850', strokeWidth: 0.8, cornerRadius: 2, // 轮廓样式
            }));

            // 顶部端子
            this._staticGroup.add(new Konva.Rect({
                x: cx - cellW * 0.25, y: 0, // 顶部端子位置
                width: cellW * 0.5, height: tH + 2, // 端子尺寸
                fill: topTermColor, stroke: '#202428', strokeWidth: 0.6, cornerRadius: [1, 1, 0, 0], // 端子样式
            }));

            // 底部端子
            this._staticGroup.add(new Konva.Rect({
                x: cx - cellW * 0.25, y: H - tH - 2, // 底部端子位置
                width: cellW * 0.5, height: tH + 2, // 端子尺寸
                fill: botTermColor, stroke: '#202428', strokeWidth: 0.6, cornerRadius: [0, 0, 1, 1], // 端子样式
            }));

            // 注液孔装饰圈（孔洞本身在 _createDynamicNodes 中创建）
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: bT + bH / 2, radius: 13,
                fill: '#2a3038', stroke: '#1a2028', strokeWidth: 0.5,
            }));

            const fs = Math.max(10, cellW * 0.3); // 正负号字体尺寸
            // 正负极标记
            this._staticGroup.add(new Konva.Text({
                x: cx - cellW / 2, y: isOdd ? bT + 2 : bT + bH - fs - 2, // 正号位置
                text: '+', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold', // 正号样式
                fill: '#d03020', width: cellW, align: 'center', // 正号对齐
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - cellW / 2, y: isOdd ? bT + bH - fs - 2 : bT + 2, // 负号位置
                text: '\u2212', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold', // 负号样式
                fill: '#303438', width: cellW, align: 'center', // 负号对齐
            }));
        }

        // 串联连接条
        for (let i = 0; i < 5; i++) { // 绘制连接条
            const cx1 = this._cellCx[i], cx2 = this._cellCx[i + 1]; // 相邻单元中心 x
            const isOdd = i % 2 === 0; // 奇偶判断
            const y = isOdd ? H - tH - 2 : 0; // 连接条 y 坐标
            this._staticGroup.add(new Konva.Rect({
                x: cx1-6, y: y + (isOdd ? tH - 6 : 6), // 连接条位置
                width: cx2 - cx1+12, height: 3, // 连接条尺寸
                fill: '#4080c8', stroke: '#3060a0', strokeWidth:12, // 连接条样式
            }));
        }

        const tFs = Math.max(12, W * 0.055); // 标题字体大小
        this._staticGroup.add(new Konva.Text({
            x: 4, y: H - 60, // 标题位置
            text: '12V 铅酸蓄电池', fontSize: tFs, fontFamily: 'Arial', fontStyle: 'bold', // 标题文本
            fill: '#303840', width: W - 8, align: 'center', // 标题样式
        }));
    }

    // 创建运行时需要更新的动态显示节点
    _createDynamicNodes() {
        const W = this.width; // 当前组件宽度
        const barX = W/2 - 46; // SOC 条位置 x

        this._barBg = new Konva.Rect({ x: barX, y: 40, width: 80, height: 10, fill: '#202428', cornerRadius: 2 }); // SOC 背景条
        this._dynamicGroup.add(this._barBg); // 添加背景条

        this._barFill = new Konva.Rect({ x: barX , y: 40, width: Math.max(0, 80 * this._soc), height: 10, fill: '#30b868', cornerRadius: 1 }); // SOC 填充条
        this._dynamicGroup.add(this._barFill); // 添加填充条

        this._pctText = new Konva.Text({ x: barX + 84, y: 40, text: '', fontSize: 15, fontFamily: 'Courier New', fill: '#fa0202', width: 64, align: 'left', fontStyle: 'bold' });
        this._dynamicGroup.add(this._pctText);

        this._capNodes = [];
        this._lastOpenIdx = -1;
        const holeR = 10;
        const capR = 12;
        const bT = this._bodyTop, bH = this._bodyH;
        for (let i = 0; i < 6; i++) {
            const cx = this._cellCx[i];
            const cy = bT + bH / 2;

            const hole = new Konva.Circle({ x: cx, y: cy, radius: holeR, fill: '#0a0e12' });
            this._dynamicGroup.add(hole);

            const cap = new Konva.Group({ x: cx, y: cy });
            const capCircle = new Konva.Circle({ x: 0, y: 0, radius: capR, fill: '#3890d0', stroke: '#2860a0', strokeWidth: 1.2 });
            cap.add(capCircle);
            cap.add(new Konva.Line({ points: [-5, -5, 5, 5], stroke: '#60a0d0', strokeWidth: 2, lineCap: 'round' }));
            cap.add(new Konva.Line({ points: [5, -5, -5, 5], stroke: '#60a0d0', strokeWidth: 2, lineCap: 'round' }));
            const idx = i;
            cap.on('click tap', () => {
                if (this._lastOpenIdx === idx) {
                    this._lastOpenIdx = -1;
                    cap.to({ x: cx, duration: 0.15 });
                } else if (this._lastOpenIdx === -1) {
                    this._lastOpenIdx = idx;
                    cap.to({ x: cx + 24, duration: 0.15 });
                }
            });
            capCircle.hitStrokeWidth(30);
            this._interactGroup.add(cap);
            this._capNodes.push(cap);
        }

        const fs = 16; // 文本字体大小
        const ix = barX; // 文本 x 坐标
        this._voltText = new Konva.Text({ x: ix, y: 60, text: '', fontSize: fs, fontFamily: 'Courier New', fill: '#817202', width: 160, align: 'left', fontStyle: 'bold' }); // 电压文本
        this._dynamicGroup.add(this._voltText); // 添加电压文本
        this._curText = new Konva.Text({ x: ix, y: 80, text: '', fontSize: fs, fontFamily: 'Courier New', fill: '#0689f3', width: 160, align: 'left', fontStyle: 'bold' }); // 电流文本
        this._dynamicGroup.add(this._curText); // 添加电流文本
        this._sgText = new Konva.Text({ x: ix, y: 100, text: '', fontSize: fs, fontFamily: 'Courier New', fill: '#048f04', width: 160, align: 'left', fontStyle: 'bold' }); // 比重文本
        this._dynamicGroup.add(this._sgText); // 添加比重文本
    }

    tick(dt) { // 仿真更新函数
        const solver = this.sys?.voltageSolver; // 获取电压求解器
        if (solver) {
            const cP = solver.portToCluster.get(`${this.id}_wire_cell1_p`); // 正极集群 ID
            const cN = solver.portToCluster.get(`${this.id}_wire_cell6_n`); // 负极集群 ID
            if (cP !== undefined && cN !== undefined) {
                // 读取端子电压并计算电池端电压和电流
                const vP = solver.nodeVoltages.get(cP); // 正极节点电压
                const vN = solver.nodeVoltages.get(cN); // 负极节点电压
                if (vP === undefined || vN === undefined || !isFinite(vP) || !isFinite(vN)) return;
                const vTerminal = vP - vN; // 端子电压
                // MNA 已包含 _vp 参与求解，直接计算电流即可稳定
                const expFactor = isFinite(dt / this._tau) ? Math.exp(-dt / this._tau) : 0;
                this._current = (this._voltage - this._vp - vTerminal) / this._rOn;
                this._vp = this._vp * expFactor + this._current * this._rp * (1 - expFactor);
                // 限制极化电压不超过开路电压的 15%，避免大电流下 _vp 失控导致电流反号
                const vpMax = Math.max(1, this._voltage * 0.15);
                this._vp = Math.max(-vpMax, Math.min(vpMax, this._vp));

                // 更新 SOC，正向电流表示放电
                const cap = this._capacity || 12; // 容量保护
                const dSOC = cap > 0 ? (this._current * dt) / (cap * 3600) : 0; // SOC 变化量
                if (isFinite(dSOC)) { // 过滤非有限值
                    this._soc = Math.max(0, Math.min(1, this._soc - dSOC)); // 约束 SOC 范围
                }
                this._voltage = 6 * this._socToCellVoltage(this._soc); // 更新开路电压
                this._sg = this._socToSG(this._soc); // 更新比重
            } else {
                // 未接线时：极化电压自然衰减，电流归零
                const expFactor = isFinite(dt / this._tau) ? Math.exp(-dt / this._tau) : 0;
                this._vp *= expFactor;
                this._current = 0;
            }

            // 更新每节电池的单体电压，用于精细诊断或显示
            for (let i = 1; i <= 6; i++) {
                const cCellP = solver.portToCluster.get(`${this.id}_wire_cell${i}_p`); // 单节正极集群
                const cCellN = solver.portToCluster.get(`${this.id}_wire_cell${i}_n`); // 单节负极集群
                if (cCellP !== undefined && cCellN !== undefined) {
                    this._cellVoltages[i - 1] = (solver.nodeVoltages.get(cCellP) || 0) - (solver.nodeVoltages.get(cCellN) || 0); // 计算单体电压
                }
            }
        }

        this._updateDynamic(); // 更新动态显示
        this.markDirty(); // 标记脏
        this._refreshIfDirty(); // 刷新图形
    }

    // 更新动态显示元素，包括 SOC 条、电压、电流和比重文本
    _updateDynamic() {
        const soc = this._soc || 0; // 当前 SOC
        this._barFill.width(Math.max(0, 80 * soc)); // 修改 SOC 填充宽度
        if (soc > 0.3) this._barFill.fill('#30b868'); // 高 SOC 绿色
        else if (soc > 0.15) this._barFill.fill('#e0a030'); // 中等 SOC 黄色
        else this._barFill.fill('#d04030'); // 低 SOC 红色
        this._pctText.text(`${(soc * 100).toFixed(2)}%`);

        const vDisplay = (this._voltage || 0) - (this._vp || 0); // 计算显示电压
        this._voltText.text(`V:${vDisplay.toFixed(2)}`); // 更新电压文本
        const cur = this._current || 0; // 当前电流
        const sign = cur >= 0 ? '' : '-'; // 电流符号
        this._curText.text(`I:${sign}${Math.abs(cur).toFixed(2)}A`); // 更新电流文本
        this._sgText.text(`SG:${(this._sg || 1.25).toFixed(3)}`); // 更新比重文本
    }

    getValue() { return this._voltage - this._vp; } // 获取电池端电压
    getSOC() { return this._soc; } // 获取 SOC
    setSOC(v) {
        this._soc = Math.max(0, Math.min(1, parseFloat(v) || 0)); // 设置 SOC 并约束范围
        this._voltage = 6 * this._socToCellVoltage(this._soc); // 更新开路电压
        this._sg = this._socToSG(this._soc); // 更新比重
    }
    getSpecificGravity() { return this._sg; } // 获取比重

    getConfigFields() {
        return [ // 配置面板字段列表
            { label: '容量 Ah',       key: 'capacity',   type: 'number' }, // 容量字段
            { label: '初始 SOC (0~1)', key: 'initialSOC', type: 'number' }, // 初始 SOC 字段
            { label: '内阻 Ω',        key: 'rOn',        type: 'number' }, // 内阻字段
            { label: '极化电阻 Ω',    key: 'rp',         type: 'number' }, // 极化电阻字段
            { label: '极化电容 F',    key: 'cp',         type: 'number' }, // 极化电容字段
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.capacity   !== undefined) this._capacity = parseFloat(cfg.capacity); // 更新容量
        if (cfg.initialSOC !== undefined) this.setSOC(parseFloat(cfg.initialSOC)); // 更新 SOC
        if (cfg.rOn        !== undefined) this._rOn = parseFloat(cfg.rOn); // 更新内阻
        if (cfg.rp !== undefined) { this._rp = parseFloat(cfg.rp); this._tau = this._rp * this._cp; } // 更新极化电阻
        if (cfg.cp !== undefined) { this._cp = parseFloat(cfg.cp); this._tau = this._rp * this._cp; } // 更新极化电容
        this.config = { ...this.config, ...cfg }; // 同步配置对象
    }

    destroy() { super.destroy?.(); } // 调用基类销毁方法
}
