import { BaseComponent } from './BaseComponent.js'; // 从 BaseComponent 模块导入基类

export class SingleLeadAcidBattery extends BaseComponent { // 导出单节铅酸电池组件类，继承自 BaseComponent
    constructor(config, sys) { // 构造函数：接收配置和系统引用
        super(config, sys); // 调用父类构造
        this.width = Math.max(400, config.width || 600); // 设定组件宽度，取最小限 400
        this.height = Math.max(350, config.height || 430); // 设定组件高度，取最小限 350
        this.type = 'single_leadacid_battery'; // 组件类型标识
        this.cache = 'fixed'; // 启用固定缓存模式
        this._initGroups(); // 初始化 Konva 分组
        this._recalcGeometry(); // 计算几何尺寸
        this._initParameters(config); // 根据配置初始化参数
        this._init(); // 绘制静态部分并创建动态节点
        this.config = { // 保存当前配置快照
            capacity: this._capacity, initialSOC: this._soc,
            rOn: this._rOn, rp: this._rp, cp: this._cp,
            cellColor: this._cellColor,
        };
        this.addPort(this.width * 0.2, 2, 'p', 'wire', 'p'); // 添加正极端口
        this.addPort(this.width * 0.8, 2, 'n', 'wire', 'n'); // 添加负极端口
    }
    _recalcGeometry() { // 重新计算几何相关的辅助值
        this._cellW = Math.max(20, this.width / 10); // 单个单元宽度
        this._totalItems = 9; // 单节内部分成的单元数
    }
    _initParameters(config) { // 根据传入配置初始化内部电池参数
        this._capacity = parseFloat(config.capacity) || 56; // 容量（Ah）
        this._soc = Math.max(0, Math.min(1, parseFloat(config.initialSOC) || 0.8)); // 初始荷电状态 SOC
        this._rOn = parseFloat(config.rOn) || 0.001; // 内阻
        this._rp = parseFloat(config.rp) || 0.017; // 极化电阻
        this._cp = parseFloat(config.cp) || 13.8; // 极化电容
        this._tau = this._rp * this._cp; // 极化时间常数
        this._vp = 0; // 极化电压初始值
        this._voltage = this._socToCellVoltage(this._soc); // 根据 SOC 计算开路电压
        this._current = 0; // 电流初始值
        this._sg = this._socToSG(this._soc); // 比重
        this._cellColor = config.cellColor || '#FFFACD'; // 电解液颜色
        this._negPlates = [0, 4, 8]; // 负极板位置索引
        this._posPlates = [2, 6]; // 正极板位置索引
        this._separatorPositions = [1, 3, 5, 7]; // 隔板位置索引
        this._bodyTop = 40; // 电池主体顶部位置
        this._bodyH = this.height - 12; // 电池主体高度
        this._cellCx = [this.width * 0.5]; // 单元中心 x 坐标数组（备用）
        this._lastOpenIdx = -1; // 交互状态：上次打开的索引
        this._faultSulfation = false; // 硫化故障标志
        this._faultLowElectrolyte = false; // 电解液低警告标志
        this._dischargeTimer = 0;
        this._chargeTimer = 0;
        this._animType = 'none'; // 'none'|'discharge'|'charge'
        this._animPhase = 0; // 0=idle; 放电:1-6; 充电:11-18
        this._animPhaseTime = 0;
        this._animFlashCount = 0;
        this._animWaypoints = [];
        this._animElectronProgress = [0, 0.05];
        this._animStarted = false;
        this._animParticleNodes = {};
    }
    _socToCellVoltage(s) { // 根据 SOC 插值计算单体电压
        const soc = Math.max(0, Math.min(1, s)); // 限制 SOC 在 [0,1]
        const tbl = [[0.00, 1.75], [0.10, 1.82], [0.25, 1.90], [0.50, 1.96], [0.75, 2.02], [0.90, 2.07], [1.00, 2.10]]; // SOC->电压表
        for (let i = 1; i < tbl.length; i++) { // 在表中查找区间并线性插值
            if (soc <= tbl[i][0]) {
                const t = (soc - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0]); // 区间比例
                return tbl[i - 1][1] + t * (tbl[i][1] - tbl[i - 1][1]); // 插值结果
            }
        }
        return tbl[tbl.length - 1][1]; // 超出则返回最大电压
    }
    _socToSG(s) { return 1.15 + s * 0.15; } // 根据 SOC 估算比重
    _init() { this._drawStaticParts(); this._createDynamicNodes(); this._addClickableParts(); } // 初始化：绘制静态部分并创建动态节点

    _addClickableParts() {
        var W = this.width, H = this.height;
        var cellW = W / this._totalItems;
        var pT = 60, bT = 40, bot = H - 2;
        var pw = cellW * 0.4;
        // 正极板（单元格 2）
        var cx = (2 + 0.5) * cellW;
        this.addClickablePart('pos-plate', cx - pw / 2, pT, pw, bot - pT);
        // 负极板（单元格 0）
        cx = (0 + 0.5) * cellW;
        this.addClickablePart('neg-plate', cx - pw / 2, pT, pw, bot - pT);
        // 隔板（单元格 1）
        cx = (1 + 0.5) * cellW;
        var sw = cellW * 0.25;
        this.addClickablePart('separator', cx - sw / 2, bT, sw, bot - bT);
    }
    _drawStaticParts() { // 绘制静态图形部件（仅绘制一次并缓存）
        const W = this.width, H = this.height; // 局部宽高变量
        const bT = 40; // 电池主体顶部偏移
        const bot = H - 2; // 底部位置
        const eT = bT + 10; // 电解液顶部
        const pT = eT + 10; // 极板顶部
        const cellW = W / this._totalItems; // 每个单元宽度

        this._staticGroup.add(new Konva.Rect({ x: 2, y: 2, width: W - 4, height: H - 4, fill: "#e8edf2", stroke: "#607080", strokeWidth: 2, cornerRadius: 4 })); // 背景框
        var _this = this; // 保存 this 引用用于回调内部
        var pPortX = W * 0.2, nPortX = W * 0.8, portY = 2; // 端口位置
        [0, 4, 8].forEach(function (idx) { // 为负极相关位置绘制连线
            var cx = (idx + 0.5) * cellW;
            _this._staticGroup.add(new Konva.Line({ points: [cx, pT, cx, 8, nPortX, 8, nPortX, portY], stroke: "#303438", strokeWidth: 2, lineCap: "round" }));
        });
        [2, 6].forEach(function (idx) { // 为正极相关位置绘制连线
            var cx = (idx + 0.5) * cellW;
            _this._staticGroup.add(new Konva.Line({ points: [cx, pT, cx, 16, pPortX, 16, pPortX, portY], stroke: "#d03020", strokeWidth: 2, lineCap: "round" }));
        });


        for (let i = 0; i < this._totalItems; i++) { // 遍历每个单元绘制隔板或电极板
            const cx = (i + 0.5) * cellW;
            if (this._separatorPositions.includes(i)) { // 绘制隔板
                const sW = cellW * 0.25;
                this._staticGroup.add(new Konva.Rect({ x: cx - sW / 2, y: bT, width: sW, height: bot - bT, fill: "#d0d8e0", stroke: "#8090a0", strokeWidth: 1, cornerRadius: 1 }));
                for (let r = 0; r < 6; r++) {
                    for (let c = 0; c < 2; c++) {
                        this._staticGroup.add(new Konva.Rect({ x: cx - sW / 2 + 4 + c * 8, y: bT + 6 + r * 60, width: 4, height: 4, fill: "#a0b0c0" })); // 隔板细节
                    }
                }
            } else if (this._negPlates.includes(i)) { // 绘制负极板
                const nW = cellW * 0.4;
                this._staticGroup.add(new Konva.Rect({ x: cx - nW / 2, y: pT, width: nW, height: bot - pT, fill: "#4a5a6a", stroke: "#3a4a5a", strokeWidth: 1.5, cornerRadius: 2 }));
                for (let j = 0; j < 4; j++) {
                    this._staticGroup.add(new Konva.Rect({ x: cx - nW / 2 + 4 + j * 12, y: pT + 10 + j * 75, width: 6, height: 10, fill: "#607080", opacity: 0.6 })); // 负极板竖条纹
                }
                for (let j = 0; j < 6; j++) { // 随机点阵效果
                    const dot = new Konva.Circle({ x: cx - nW / 2 + 4 + Math.random() * (nW - 8), y: pT + 15 + Math.random() * ((bot - pT) - 30), radius: 2 + Math.random() * 3, fill: "#8a9aaa", opacity: 0.4 });
                    this._staticGroup.add(dot);
                }
            } else if (this._posPlates.includes(i)) { // 绘制正极板
                const pW = cellW * 0.4;
                this._staticGroup.add(new Konva.Rect({ x: cx - pW / 2, y: pT, width: pW, height: bot - pT, fill: "#6a5a4a", stroke: "#5a4a3a", strokeWidth: 1.5, cornerRadius: 2 }));
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 2; c++) {
                        this._staticGroup.add(new Konva.Rect({ x: cx - pW / 2 + 6 + c * 14, y: pT + 10 + r * 40, width: 10, height: 14, fill: "#8a7a5a", stroke: "#7a6a4a", strokeWidth: 0.5 })); // 正极板细节
                    }
                }
            }
        }
    }
    _drawElectrolyte() { // 绘制电解液区域和装饰文本
        const W = this.width, H = this.height; // 局部宽高
        const bT = 40; // 主体顶部
        const bot = H - 2; // 底部
        const eT = bT + 10; // 电解液顶部
        this._electrolyteRect = new Konva.Rect({ x: 4, y: eT, width: W - 8, height: bot - eT, fill: this._cellColor, opacity: 0.2, listening: false }); // 电解液矩形
        this._dynamicGroup.add(this._electrolyteRect); // 加入动态组以便更新
        for (let i = 0; i < 12; i++) { // 绘制多个 H+ 文本作为视觉粒子
            this._dynamicGroup.add(new Konva.Text({ x: 10 + Math.random() * (W - 50), y: eT + 10 + Math.random() * (bot - eT - 20), text: 'H+', fontSize: 16, fontFamily: 'Arial', fill: '#8B0000', fontStyle: 'bold', opacity: 0.7 }));
        }
        for (let i = 0; i < 6; i++) { // 绘制多个 SO4 2- 文本作为视觉粒子
            this._dynamicGroup.add(new Konva.Text({ x: 10 + Math.random() * (W - 50), y: eT + 10 + Math.random() * (bot - eT - 20), text: 'SO4 2-', fontSize: 16, fontFamily: 'Arial', fill: '#00CC00', fontStyle: 'bold', opacity: 0.7 }));
        }
        const tFs = Math.max(14, W * 0.035); // 标题字体大小
        this._staticGroup.add(new Konva.Text({ x: 8, y:  - 22, text: '2V 铅酸电池', fontSize: tFs, fontFamily: 'Arial', fontStyle: 'bold', fill: '#303840', width: W - 16, align: 'center' })); // 标题文本
        
    }
    _createDynamicNodes() { // 创建动态节点（会在 tick 时更新）
        this._drawElectrolyte(); // 先绘制电解液区域
        this._electronGroup = new Konva.Group({ x: 0, y: 0 }); // 电子粒子组
        this._dynamicGroup.add(this._electronGroup);
        this._electronNodes = []; // 电子节点数组
        for (let i = 0; i < 8; i++) { // 创建若干电子粒子
            const e = new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#ffdd00', stroke: '#cc9900', strokeWidth: 0.5, opacity: 0 });
            this._electronGroup.add(e);
            this._electronNodes.push({ node: e, active: false, progress: 0, startX: 0, startY: 0, endX: 0, endY: 0 }); // 记录动画状态
        }
        this._ionNodes = []; // 离子节点占位（未显式存储文本数组）
        const holeX = this.width * 0.5; // 电池中心 x
        const capY = this._bodyTop + this._bodyH / 2 + 30; // 电池中心 y（下移 30px）
        const hole = new Konva.Circle({ x: holeX, y: capY, radius: 10, fill: '#0a0e12' }); // 中央装饰圆
        this._dynamicGroup.add(hole);
        this._capGroup = new Konva.Group({ x: holeX, y: capY }); // 可交互帽子组（下移 30px）
        const capCircle = new Konva.Circle({ x: 0, y: 0, radius: 12, fill: '#3890d0', stroke: '#2860a0', strokeWidth: 1.2 });
        this._capGroup.add(capCircle);
        this._capGroup.add(new Konva.Line({ points: [-5, -5, 5, 5], stroke: '#60a0d0', strokeWidth: 2, lineCap: 'round' }));
        this._capGroup.add(new Konva.Line({ points: [5, -5, -5, 5], stroke: '#60a0d0', strokeWidth: 2, lineCap: 'round' }));

        this._lastOpenIdx = -1; // 交互开关初始值
        this._capGroup.on('click tap', () => { // 点击帽子实现位移动画
            if (this._lastOpenIdx === 0) {
                this._lastOpenIdx = -1;
                this._capGroup.to({ x: holeX, duration: 0.15 });
            } else {
                this._lastOpenIdx = 0;
                this._capGroup.to({ x: holeX + 24, duration: 0.15 });
            }
        });
        capCircle.hitStrokeWidth(30); // 提高命中区域
        this._interactGroup.add(this._capGroup); // 添加到交互组

        this._sulfationLayer = new Konva.Rect({ x: 0, y: 0, width: 0, height: 0, fill: '#606060', opacity: 0, listening: false }); // 硫化效果层
        this._dynamicGroup.add(this._sulfationLayer);
        this._voltText = new Konva.Text({ x: 50, y: 22, text: '', fontSize: 18, fontFamily: 'Courier New', fill: '#3b3d01', fontStyle: 'bold' }); // 电压显示文本
        this._dynamicGroup.add(this._voltText);
        this._curText = new Konva.Text({ x: 180, y: 22, text: '', fontSize: 18, fontFamily: 'Courier New', fill: '#0080ff', fontStyle: 'bold' }); // 电流显示文本
        this._dynamicGroup.add(this._curText);
        this._socText = new Konva.Text({ x: 450, y: 22, text: '', fontSize: 18, fontFamily: 'Courier New', fill: '#048504', fontStyle: 'bold' }); // SOC 显示文本
        this._dynamicGroup.add(this._socText);
        this._createPlateTexts();
        this._createAnimParticleNodes();
    }
    _createPlateTexts() {
        var W = this.width, H = this.height;
        var cellW = W / this._totalItems;
        var pT = 60, bot = H - 2;
        var g = this._dynamicGroup;
        this._plateTexts = [];
        this._negPlates.forEach(function (idx) {
            var cx = (idx + 0.5) * cellW;
            for (var p = 0; p < 3; p++) {
                var y = p === 0 ? pT + (bot - pT) / 6 - 8 : (p === 1 ? pT + (bot - pT) / 2 - 8 : pT + 5 * (bot - pT) / 6 - 8);
                var t = new Konva.Text({ x: cx - 30, y: y, width: 60, height: 16, text: 'Pb', fontSize: 16, fontFamily: 'Arial', fill: '#FFFF00', fontStyle: 'bold', align: 'center' });
                g.add(t);
                this._plateTexts.push({ node: t, isNeg: true, plateIdx: idx, posIdx: p });
            }
        }, this);
        this._posPlates.forEach(function (idx) {
            var cx = (idx + 0.5) * cellW;
            for (var p = 0; p < 3; p++) {
                var y = p === 0 ? pT + (bot - pT) / 6 - 8 : (p === 1 ? pT + (bot - pT) / 2 - 8 : pT + 5 * (bot - pT) / 6 - 8);
                var t = new Konva.Text({ x: cx - 30, y: y, width: 60, height: 16, text: 'PbO2', fontSize: 16, fontFamily: 'Arial', fill: '#FF3333', fontStyle: 'bold', align: 'center' });
                g.add(t);
                this._plateTexts.push({ node: t, isNeg: false, plateIdx: idx, posIdx: p });
            }
        }, this);
    }
    _createAnimParticleNodes() {
        const W = this.width, H = this.height;
        const cellW = W / this._totalItems;
        const pT = 60, bot = H - 2;
        const nW = cellW * 0.4;
        const g = this._dynamicGroup;
        this._animParticleNodes = {};
        // 覆盖层：idx=8 最上方 Pb
        var cx = (8 + 0.5) * cellW;
        this._animParticleNodes.pbCoverNeg = new Konva.Rect({ x: cx - 30, y: pT + (bot - pT) / 6 - 8, width: 60, height: 16, fill: '#4a5a6a', opacity: 0, listening: false });
        g.add(this._animParticleNodes.pbCoverNeg);
        this._animParticleNodes.pb2TextNeg = new Konva.Text({ x: cx - 30, y: pT + (bot - pT) / 6 - 8, width: 60, height: 16, text: 'Pb2+', fontSize: 16, fontFamily: 'Arial', fill: '#FFFF00', fontStyle: 'bold', align: 'center', opacity: 0 });
        g.add(this._animParticleNodes.pb2TextNeg);
        // 覆盖层：idx=2 最上方 PbO₂
        cx = (2 + 0.5) * cellW;
        this._animParticleNodes.pbo2CoverPos = new Konva.Rect({ x: cx - 30, y: pT + (bot - pT) / 6 - 8, width: 60, height: 16, fill: '#6a5a4a', opacity: 0, listening: false });
        g.add(this._animParticleNodes.pbo2CoverPos);
        this._animParticleNodes.pb2TextPos = new Konva.Text({ x: cx - 30, y: pT + (bot - pT) / 6 - 8, width: 60, height: 16, text: 'Pb2+', fontSize: 16, fontFamily: 'Arial', fill: '#FF3333', fontStyle: 'bold', align: 'center', opacity: 0 });
        g.add(this._animParticleNodes.pb2TextPos);
        // 两个电子（圆圈⊖）
        this._animParticleNodes.electrons = [];
        for (var i = 0; i < 2; i++) {
            var eg = new Konva.Group({ x: 0, y: 0, opacity: 0 });
            eg.add(new Konva.Circle({ radius: 8, stroke: '#ff0000', strokeWidth: 2, fill: '#ff4444' }));
            eg.add(new Konva.Text({ text: '−', fontSize: 14, fontFamily: 'Arial', fill: '#fff', fontStyle: 'bold', x: -5, y: -9, width: 10, height: 14, align: 'center' }));
            g.add(eg);
            this._animParticleNodes.electrons.push(eg);
        }
        // O²⁻ (2 个)
        this._animParticleNodes.o2minus = [];
        for (var i = 0; i < 2; i++) {
            var t = new Konva.Text({ x: 0, y: 0, text: 'O2-', fontSize: 14, fontFamily: 'Arial', fill: '#00aaff', fontStyle: 'bold', opacity: 0 });
            g.add(t);
            this._animParticleNodes.o2minus.push(t);
        }
        // PbSO₄ (2 个)
        this._animParticleNodes.pbso4 = [];
        for (var i = 0; i < 2; i++) {
            var t = new Konva.Text({ x: 0, y: 0, text: 'PbSO4', fontSize: 20, fontFamily: 'Arial', fill: '#ff3333', fontStyle: 'bold', opacity: 0 });
            g.add(t);
            this._animParticleNodes.pbso4.push(t);
        }
        // H₂O (2 个)
        this._animParticleNodes.h2o = [];
        for (var i = 0; i < 2; i++) {
            var t = new Konva.Text({ x: 0, y: 0, text: 'H2O', fontSize: 20, fontFamily: 'Arial', fill: '#3399ff', fontStyle: 'bold', opacity: 0 });
            g.add(t);
            this._animParticleNodes.h2o.push(t);
        }
        // 专用 H⁺ 离子（4 个）
        this._animParticleNodes.hplus = [];
        for (var i = 0; i < 4; i++) {
            var t = new Konva.Text({ x: 0, y: 0, text: 'H+', fontSize: 15, fontFamily: 'Arial', fill: '#8B0000', fontStyle: 'bold', opacity: 0 });
            g.add(t);
            this._animParticleNodes.hplus.push(t);
        }
        // ===== 充电专用粒子 =====
        // Pb⁴⁺（正极板 idx=2 最上方）
        cx = (2 + 0.5) * cellW;
        this._animParticleNodes.chgPb4plus = new Konva.Text({ x: cx - 30, y: pT + (bot - pT) / 6 - 8, width: 60, height: 16, text: 'Pb4+', fontSize: 16, fontFamily: 'Arial', fill: '#FF3333', fontStyle: 'bold', align: 'center', opacity: 0 });
        g.add(this._animParticleNodes.chgPb4plus);
        // 最终 PbO₂（正极板 idx=2 最上方，充电完成后）
        this._animParticleNodes.chgFinalPbO2 = new Konva.Text({ x: cx - 30, y: pT + (bot - pT) / 6 - 8, width: 60, height: 16, text: 'PbO2', fontSize: 16, fontFamily: 'Arial', fill: '#FF3333', fontStyle: 'bold', align: 'center', opacity: 0 });
        g.add(this._animParticleNodes.chgFinalPbO2);
        // 两个大 H₂O（正极板 idx=2 附近电解液区域）
        this._animParticleNodes.chgLargeH2O = [];
        for (var i = 0; i < 2; i++) {
            var t2 = new Konva.Text({ x: 0, y: 0, text: 'H2O', fontSize: 22, fontFamily: 'Arial', fill: '#3399ff', fontStyle: 'bold', opacity: 0 });
            g.add(t2);
            this._animParticleNodes.chgLargeH2O.push(t2);
        }
        // 充电专用的 O²⁻（H₂O 分解产物）
        this._animParticleNodes.chgO2 = [];
        for (var i = 0; i < 2; i++) {
            var t3 = new Konva.Text({ x: 0, y: 0, text: 'O2-', fontSize: 16, fontFamily: 'Arial', fill: '#00aaff', fontStyle: 'bold', opacity: 0 });
            g.add(t3);
            this._animParticleNodes.chgO2.push(t3);
        }
    }
    tick(dt) { // 每帧求解函数：处理电气行为并更新动态显示
        const solver = this.sys?.voltageSolver; // 获取电压求解器引用
        if (solver) {
            const cP = solver.portToCluster.get(this.id + '_wire_p'); // 正端簇
            const cN = solver.portToCluster.get(this.id + '_wire_n'); // 负端簇
            if (cP !== undefined && cN !== undefined) { // 两端都连接到网络则计算电流和 SOC
                const vP = solver.nodeVoltages.get(cP) || 0;
                const vN = solver.nodeVoltages.get(cN) || 0;
                const vTerminal = vP - vN; // 端子电压
                const expFactor = isFinite(dt / this._tau) ? Math.exp(-dt / this._tau) : 0; // 指数衰减因子
                this._current = (this._voltage - this._vp - vTerminal) / this._rOn; // 欧姆定律计算电流
                this._vp = this._vp * expFactor + this._current * this._rp * (1 - expFactor); // 极化电压一阶响应
                const vpMax = Math.max(1, this._voltage * 0.15); // 极化电压限制
                this._vp = Math.max(-vpMax, Math.min(vpMax, this._vp)); // 限制极化电压
                const cap = this._capacity || 56; // 容量保护
                const dSOC = cap > 0 ? (this._current * dt) / (cap * 3600) : 0; // SOC 变化量（A*s 转 Ah）
                if (isFinite(dSOC)) { this._soc = Math.max(0, Math.min(1, this._soc - dSOC)); } // 更新 SOC
                this._voltage = this._socToCellVoltage(this._soc); // 更新电压
                this._sg = this._socToSG(this._soc); // 更新比重
            } else { // 若未连接外部簇，则仅让极化电压衰减
                const expFactor = isFinite(dt / this._tau) ? Math.exp(-dt / this._tau) : 0;
                this._vp *= expFactor;
                this._current = 0;
            }
        }
        this._updateDynamic(dt); // 更新动画和显示
        this.markDirty(); // 标记需要刷新显示
        this._refreshIfDirty(); // 如有变化则刷新
    }
    _updateDynamic(dt) { // 更新动态视觉元素（电子、离子、文本、故障层等）
        var soc = this._soc || 0; // 当前 SOC
        var vDisp = (this._voltage || 0) - (this._vp || 0); // 显示电压（扣除极化）
        this._voltText.text("V:" + vDisp.toFixed(2)); // 更新电压文本
        var sv = this.sys && this.sys.voltageSolver; // 本地求解器引用
        if (sv) {
            var cP = sv.portToCluster.get(this.id + "_wire_p");
            var cN = sv.portToCluster.get(this.id + "_wire_n");
            if (cP !== void 0 && cN !== void 0) {
                var vP = sv.nodeVoltages.get(cP) || 0;
                var vN = sv.nodeVoltages.get(cN) || 0;
                var tV = vP - vN; // 端子电压
                var R = this._rOn || 0.001; // 内阻保护
                this._current = (this._voltage - (this._vp || 0) - tV) / R; // 计算电流
            }
        }
        var cur = this._current || 0; // 当前电流
        var sign = cur >= 0 ? "" : "-"; // 电流符号
        this._curText.text("I:" + sign + Math.abs(cur).toFixed(3) + "A"); // 更新电流文本
        this._socText.text("SOC:" + (soc * 100).toFixed(2) + "%"); // 更新 SOC 文本
        this._updatePlateMaterials(soc);
        var isDischarging = cur > 0, isCharging = cur < 0, absCur = Math.abs(cur);
        var isIdle = this._animPhase === 0;
        // 稳态放电检测：电流 > 0.5A 持续超过 5s
        if (isDischarging && absCur > 0.5 && isIdle) {
            this._dischargeTimer += dt;
            this._chargeTimer = 0;
            if (this._dischargeTimer > 5) {
                this._animType = 'discharge';
                this._calcAnimWaypoints();
                this._animPhase = 1;
                this._animPhaseTime = 0;
                this._animFlashCount = 0;
            }
        // 稳态充电检测：电流 < -0.5A 持续超过 5s
        } else if (isCharging && absCur > 0.5 && isIdle) {
            this._chargeTimer += dt;
            this._dischargeTimer = 0;
            if (this._chargeTimer > 5) {
                this._animType = 'charge';
                this._calcChargeWaypoints();
                this._animPhase = 11;
                this._animPhaseTime = 0;
                this._animFlashCount = 0;
            }
        } else if (isIdle) {
            this._dischargeTimer = Math.max(0, this._dischargeTimer - dt * 2);
            this._chargeTimer = Math.max(0, this._chargeTimer - dt * 2);
        }
        if (this._animPhase > 0) {
            if (this._animType === 'discharge') {
                this._runDischargeAnimation(dt);
            } else if (this._animType === 'charge') {
                this._runChargeAnimation(dt);
            }
        }
        // 隐藏原有的简单电子动画，用放电动画替代
        this._electronGroup.visible(false);
        if (this._faultSulfation) { // 若有硫化故障则显示覆盖层并闪烁
            this._sulfationLayer.x(this.width * 0.1); this._sulfationLayer.y(this.height * 0.12);
            this._sulfationLayer.width(this.width / this._totalItems * 0.4); this._sulfationLayer.height(this.height * 0.75);
            this._sulfationLayer.opacity(0.4 + 0.3 * Math.sin(Date.now() * 0.003));
        } else { this._sulfationLayer.opacity(0); } // 否则隐藏
    }
    _updatePlateMaterials(soc) {
        for (var i = 0; i < this._plateTexts.length; i++) {
            var pt = this._plateTexts[i];
            var topCount = 0;
            if (soc > 0.9) {
                topCount = 0;
            } else if (soc >= 0.5) {
                topCount = 1;
            } else if (soc >= 0.1) {
                topCount = 2;
            } else {
                topCount = 3;
            }
            if (pt.posIdx < topCount) {
                pt.node.text('PbSO4');
                pt.node.fill('#fc0606');
            } else if (pt.isNeg) {
                pt.node.text('Pb');
                pt.node.fill('#FFFF00');
            } else {
                pt.node.text('PbO2');
                pt.node.fill('#f50909');
            }
        }
    }
    _getPortLocal(portId, bx, by) {
        var sys = this.sys;
        if (!sys) return null;
        var parts = portId.split('_wire_');
        var comp = sys.comps[parts[0]];
        if (!comp || typeof comp.getAbsPortPos !== 'function') return null;
        var pos = comp.getAbsPortPos(portId);
        return pos ? { x: pos.x - bx, y: pos.y - by } : null;
    }
    _calcAnimWaypoints() {
        var W = this.width, H = this.height, wps = [];
        var cellW = W / this._totalItems;
        var pT = 60, bot = H - 2;
        var nPortX = W * 0.8, pPortX = W * 0.2;
        var cx8 = (8 + 0.5) * cellW, cx2 = (2 + 0.5) * cellW;
        var topY = pT + (bot - pT) / 6;
        // 内段：负板 idx=8 → 负极端子
        wps.push([cx8, topY]);
        wps.push([cx8, pT]);
        wps.push([cx8, 8]);
        wps.push([nPortX, 8]);
        wps.push([nPortX, 2]);
        // 外段：严格按连线端口走
        var bx = this.group.x(), by = this.group.y();
        var seq = [
            this.id + '_wire_n',
            'lamp_wire_r', 'lamp_wire_l',
            'sw2_wire_r', 'sw2_wire_l',
            this.id + '_wire_p'
        ];
        for (var i = 0; i < seq.length; i++) {
            var p = this._getPortLocal(seq[i], bx, by);
            if (p) wps.push([p.x, p.y]);
        }
        // 内段：正极端子 → 正板 idx=2
        wps.push([pPortX, 16]);
        wps.push([cx2, 16]);
        wps.push([cx2, pT]);
        wps.push([cx2, topY]);
        this._animWaypoints = wps;
    }
    _calcChargeWaypoints() {
        var W = this.width, H = this.height, wps = [];
        var cellW = W / this._totalItems;
        var pT = 60, bot = H - 2;
        var nPortX = W * 0.8, pPortX = W * 0.2;
        var cx2 = (2 + 0.5) * cellW, cx8 = (8 + 0.5) * cellW;
        var topY = pT + (bot - pT) / 6;
        // 内段：正板 idx=2 → 正极端子
        wps.push([cx2, topY]);
        wps.push([cx2, pT]);
        wps.push([pPortX, 16]);
        wps.push([pPortX, 2]);
        // 外段：严格按连线端口走
        var bx = this.group.x(), by = this.group.y();
        var seq = [
            this.id + '_wire_p',
            'sw_wire_r', 'sw_wire_l',
            'ccsrc_wire_i1',
            'ccsrc_wire_com',
            'r10_wire_r', 'r10_wire_l',
            this.id + '_wire_n'
        ];
        for (var i = 0; i < seq.length; i++) {
            var p = this._getPortLocal(seq[i], bx, by);
            if (p) wps.push([p.x, p.y]);
        }
        // 内段：负极端子 → 负板 idx=8
        wps.push([nPortX, 8]);
        wps.push([cx8, 8]);
        wps.push([cx8, pT]);
        wps.push([cx8, topY]);
        this._animWaypoints = wps;
    }
    _runDischargeAnimation(dt) {
        var t = this._animPhaseTime;
        var ns = this._animParticleNodes;
        var W = this.width, H = this.height;
        var cellW = W / this._totalItems;
        var pT = 60, bot = H - 2;
        var nPortX = W * 0.8, pPortX = W * 0.2;
        switch (this._animPhase) {
            case 1: { // Pb 闪烁 3 次
                var cycle = 1.0;
                if (t > cycle * 3) {
                    this._animPhase = 2;
                    this._animPhaseTime = 0;
                    this._animFlashCount = 0;
                    break;
                }
                var cycleIdx = Math.floor(t / cycle);
                var ct = (t - cycleIdx * cycle) / cycle;
                var visible = ct < 0.5;
                var cx = (8 + 0.5) * cellW;
                var py = pT + (bot - pT) / 6 - 8;
                // 覆盖闪烁效果
                ns.pbCoverNeg.opacity(visible ? 1 : 0);
                this._animFlashCount = cycleIdx;
                break;
            }
            case 2: { // Pb → Pb²⁻ + 2个电子沿路径移动
                if (t < 0.5) {
                    ns.pbCoverNeg.opacity(1);
                    ns.pb2TextNeg.opacity(Math.min(1, t * 4));
                }
                var wps = this._animWaypoints;
                if (wps.length < 4) { this._animPhase = 6; break; }
                var pathLen = 0;
                for (var i = 1; i < wps.length; i++) {
                    pathLen += Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1]);
                }
                var speed = 0.3;
                var dur = pathLen * speed / 40;
                var startDelay = 1.0;
                if (t > startDelay) {
                    for (var ei = 0; ei < 2; ei++) {
                        var offset = startDelay + ei * 0.2;
                        var et = Math.max(0, Math.min(1, (t - offset) / dur));
                        if (et > 0 && et < 1) {
                            var totalDist = et * pathLen;
                            var acc = 0;
                            for (var i = 1; i < wps.length; i++) {
                                var seg = Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1]);
                                if (acc + seg >= totalDist) {
                                    var frac = (totalDist - acc) / (seg || 1);
                                    var x = wps[i - 1][0] + (wps[i][0] - wps[i - 1][0]) * frac;
                                    var y = wps[i - 1][1] + (wps[i][1] - wps[i - 1][1]) * frac;
                                    ns.electrons[ei].x(x);
                                    ns.electrons[ei].y(y);
                                    ns.electrons[ei].opacity(0.9);
                                    break;
                                }
                                acc += seg;
                            }
                        } else if (et >= 1) {
                            ns.electrons[ei].opacity(0.9);
                        } else {
                            ns.electrons[ei].opacity(0);
                        }
                    }
                }
                if (t > startDelay + dur + 0.5) {
                    // 两个电子到达 PbO₂
                    this._animPhase = 3;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 3: { // 电子在 PbO₂ 上闪烁 2 次
                var cycle2 = 0.4;
                var cx2 = (2 + 0.5) * cellW;
                var py = pT + (bot - pT) / 6 - 8;
                var maxFlash = 2;
                if (t > cycle2 * maxFlash) {
                    this._animPhase = 4;
                    this._animPhaseTime = 0;
                    break;
                }
                var ci = Math.floor(t / cycle2);
                var ct = (t - ci * cycle2) / cycle2;
                var vis = ct < 0.5;
                ns.electrons[0].x(cx2 + (ci === 0 ? -10 : 10));
                ns.electrons[0].y(py);
                ns.electrons[0].opacity(vis ? 0.9 : 0);
                ns.electrons[1].x(cx2 + (ci === 0 ? 10 : -10));
                ns.electrons[1].y(py);
                ns.electrons[1].opacity(vis ? 0.9 : 0);
                break;
            }
            case 4: { // 电子消失，PbO₂ 闪烁后分解为 Pb²⁻ + 2O²⁻
                for (var ei = 0; ei < 2; ei++) {
                    ns.electrons[ei].opacity(0);
                }
                var cx2 = (2 + 0.5) * cellW;
                var py = pT + (bot - pT) / 6 - 8;
                if (t < 1.2) {
                    var flashVis = Math.sin(t * Math.PI * 6) > 0;
                    ns.pbo2CoverPos.opacity(flashVis ? 1 : 0);
                }
                if (t > 0.8) {
                    ns.pb2TextPos.opacity(1);
                    var o2t = Math.min(1, (t - 0.8) * 3);
                    for (var i = 0; i < 2; i++) {
                        var ox = cx2 + (i === 0 ? -40 : 40);
                        var oy = py + 30;
                        ns.o2minus[i].x(ox);
                        ns.o2minus[i].y(oy);
                        ns.o2minus[i].opacity(o2t);
                    }
                }
                if (t > 2.0) {
                    this._animPhase = 5;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 5: { // 离子反应：先生成正极 PbSO₄ → 再生成负极 PbSO₄ → 再生成 H₂O
                var cx2 = (2 + 0.5) * cellW;
                var cx8 = (8 + 0.5) * cellW;
                var py = pT + (bot - pT) / 6 - 8;
                // ---- 1. 正极 PbSO₄ (t=0~4s) ----
                if (t < 4.5) {
                    var s1t = Math.min(1, t / 3.5);
                    var s1x = cx2 + 60 + (cx2 - (cx2 + 80)) * s1t;
                    var s1y = py + 20 * s1t-20;
                    ns.pbso4[0].x(s1x);
                    ns.pbso4[0].y(s1y);
                    ns.pbso4[0].text('SO4 2-');
                    ns.pbso4[0].fill('#08fd08');
                    ns.pbso4[0].opacity(s1t);
                    if (s1t >= 1) {
                        ns.pbso4[0].text('PbSO4');
                        ns.pbso4[0].fill('#f80404');
                        ns.pbso4[0].opacity(1);
                        ns.pb2TextPos.opacity(0);
                    }
                }
                // ---- 2. 负极 PbSO₄ (t=4~8.5s, 正极 PbSO₄ 生成完后开始) ----
                if (t > 4.0 && t < 9.0) {
                    var st2 = Math.min(1, (t - 4.0) / 3.5);
                    var s2x = cx8 - 100 + (cx8 - (cx8 - 80)) * st2;
                    var s2y = py + 20 * st2-20;
                    ns.pbso4[1].x(s2x);
                    ns.pbso4[1].y(s2y);
                    ns.pbso4[1].text('SO4 2-');
                    ns.pbso4[1].fill('#06f706');
                    ns.pbso4[1].opacity(st2);
                    if (st2 >= 1) {
                        ns.pbso4[1].text('PbSO4');
                        ns.pbso4[1].fill('#ff3333');
                        ns.pbso4[1].opacity(1);
                        ns.pb2TextNeg.opacity(0);
                    }
                }
                // ---- 3. 4 H⁺ → 2 O²⁻ → 2 H₂O (t=8~13s, 负极 PbSO₄ 生成完后开始) ----
                if (t > 8.0 && t < 14.0) {
                    var o2cy = py + 30;
                    var o2cxs = [cx2 - 40, cx2 + 40];
                    for (var hi = 0; hi < 4; hi++) {
                        var targetOi = hi < 2 ? 0 : 1;
                        var off = hi % 2 === 0 ? -25 : 25;
                        var ht = Math.min(1, (t - 8.0 - hi * 0.5) / 1.8);
                        if (ht > 0 && ht < 1) {
                            var hx = o2cxs[targetOi] + off * (1 - ht);
                            var hy = py - 40 + (o2cy - (py - 40)) * ht;
                            ns.hplus[hi].x(hx);
                            ns.hplus[hi].y(hy);
                            ns.hplus[hi].opacity(ht);
                        } else if (ht >= 1) {
                            ns.hplus[hi].opacity(0);
                        }
                    }
                    if (t > 10.5) {
                        var h2ot = Math.min(1, (t - 10.5) * 2);
                        for (var i = 0; i < 2; i++) {
                            ns.h2o[i].x(o2cxs[i]);
                            ns.h2o[i].y(o2cy + 10);
                            ns.h2o[i].opacity(h2ot);
                            ns.o2minus[i].opacity(0);
                        }
                    }
                }
                if (t > 13.0) {
                    this._animPhase = 6;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 6: // 完成
                break;
        }
        this._animPhaseTime += dt;
    }
    _runChargeAnimation(dt) {
        var t = this._animPhaseTime;
        var ns = this._animParticleNodes;
        var W = this.width, H = this.height;
        var cellW = W / this._totalItems;
        var pT = 60, bot = H - 2;
        var nPortX = W * 0.8, pPortX = W * 0.2;
        var cx2 = (2 + 0.5) * cellW, cx8 = (8 + 0.5) * cellW;
        var py = pT + (bot - pT) / 6 - 8;
        switch (this._animPhase) {
            case 11: { // 正极板 PbSO₄ 闪烁 3 次 → Pb⁴⁺ + SO₄²⁻
                var cycle = 1.0;
                if (t > cycle * 3) {
                    this._animPhase = 12;
                    this._animPhaseTime = 0;
                    break;
                }
                var ci = Math.floor(t / cycle);
                var ct = (t - ci * cycle) / cycle;
                ns.pbo2CoverPos.opacity(ct < 0.5 ? 1 : 0);
                break;
            }
            case 12: { // Pb⁴⁺ 闪烁 2 次，SO₄²⁻ 缓慢移走
                ns.pbo2CoverPos.opacity(1);
                if (t < 2.0) {
                    var flash = Math.sin(t * Math.PI * 2) > 0;
                    ns.chgPb4plus.opacity(flash ? 1 : 0.3);
                } else {
                    ns.chgPb4plus.opacity(1);
                }
                var so4t = Math.min(1, t / 4.0);
                ns.pbso4[0].text('SO4 2-');
                ns.pbso4[0].fill('#08f908');
                ns.pbso4[0].x(cx2 + 40 + so4t * 60);
                ns.pbso4[0].y(py);
                ns.pbso4[0].opacity(so4t);
                if (t > 3.0) {
                    this._animPhase = 13;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 13: { // 生成 2 个电子沿路径移动
                ns.chgPb4plus.opacity(1);
                var wps = this._animWaypoints;
                if (wps.length < 4) { this._animPhase = 18; break; }
                var pathLen = 0;
                for (var i = 1; i < wps.length; i++) {
                    pathLen += Math.hypot(wps[i][0] - wps[i-1][0], wps[i][1] - wps[i-1][1]);
                }
                var speed = 0.25;
                var dur = pathLen * speed / 40;
                var startDelay = 1.0;
                if (t > startDelay) {
                    for (var ei = 0; ei < 2; ei++) {
                        var off = startDelay + ei * 0.2;
                        var et = Math.max(0, Math.min(1, (t - off) / dur));
                        if (et > 0 && et < 1) {
                            var totalDist = et * pathLen;
                            var acc = 0;
                            for (var i = 1; i < wps.length; i++) {
                                var seg = Math.hypot(wps[i][0] - wps[i-1][0], wps[i][1] - wps[i-1][1]);
                                if (acc + seg >= totalDist) {
                                    var frac = (totalDist - acc) / (seg || 1);
                                    ns.electrons[ei].x(wps[i-1][0] + (wps[i][0] - wps[i-1][0]) * frac);
                                    ns.electrons[ei].y(wps[i-1][1] + (wps[i][1] - wps[i-1][1]) * frac);
                                    ns.electrons[ei].opacity(0.9);
                                    break;
                                }
                                acc += seg;
                            }
                        } else if (et >= 1) {
                            ns.electrons[ei].opacity(0.9);
                        } else {
                            ns.electrons[ei].opacity(0);
                        }
                    }
                }
                if (t > startDelay + dur + 0.5) {
                    this._animPhase = 14;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 14: { // 电子在负极 PbSO₄ 上闪烁 2 次
                var maxFlash = 2;
                var c2 = 0.4;
                if (t > c2 * maxFlash) {
                    this._animPhase = 15;
                    this._animPhaseTime = 0;
                    break;
                }
                var ci = Math.floor(t / c2);
                var ct = (t - ci * c2) / c2;
                var vis = ct < 0.5;
                ns.electrons[0].x(cx8 + (ci === 0 ? -10 : 10));
                ns.electrons[0].y(py);
                ns.electrons[0].opacity(vis ? 0.9 : 0);
                ns.electrons[1].x(cx8 + (ci === 0 ? 10 : -10));
                ns.electrons[1].y(py);
                ns.electrons[1].opacity(vis ? 0.9 : 0);
                break;
            }
            case 15: { // 电子消失，PbSO₄ 先消失 → 再出现 Pb，SO₄²⁻ 移走
                for (var ei = 0; ei < 2; ei++) ns.electrons[ei].opacity(0);
                if (t < 1.0) {
                    ns.pbCoverNeg.opacity(Math.sin(t * Math.PI * 4) > 0 ? 1 : 0);
                } else {
                    ns.pbCoverNeg.opacity(1);
                    var pbFade = Math.min(1, (t - 1.0) * 4);
                    ns.pb2TextNeg.text('Pb');
                    ns.pb2TextNeg.fill('#FFFF00');
                    ns.pb2TextNeg.opacity(pbFade);
                }
                var so4t2 = Math.min(1, Math.max(0, (t - 1.0) / 3.0));
                ns.pbso4[1].text('SO4 2-');
                ns.pbso4[1].fill('#06f706');
                ns.pbso4[1].x(cx8 - 50 - so4t2 * 70);
                ns.pbso4[1].y(py);
                ns.pbso4[1].opacity(so4t2);
                if (t > 3.5) {
                    this._animPhase = 16;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 16: { // 正极附近出现两个大 H₂O，闪烁 2 次 → O²⁻ + 2H⁺
                var h2ox = [cx2 - 50, cx2 + 50];
                var h2oy = py + 50;
                for (var i = 0; i < 2; i++) {
                    ns.chgLargeH2O[i].x(h2ox[i]);
                    ns.chgLargeH2O[i].y(h2oy);
                }
                if (t < 2.0) {
                    var vis = Math.sin(t * Math.PI * 2) > 0;
                    for (var i = 0; i < 2; i++) ns.chgLargeH2O[i].opacity(vis ? 1 : 0);
                }
                if (t > 1.5) {
                    for (var i = 0; i < 2; i++) {
                        ns.chgLargeH2O[i].opacity(0);
                        ns.chgO2[i].x(h2ox[i]);
                        ns.chgO2[i].y(h2oy);
                        ns.chgO2[i].opacity(Math.min(1, (t - 1.5) * 2));
                    }
                    for (var hi = 0; hi < 4; hi++) {
                        var targetI = hi < 2 ? 0 : 1;
                        var dir = hi % 2 === 0 ? -1 : 1;
                        var ht = Math.min(1, Math.max(0, (t - 1.8 - hi * 0.3) / 1.2));
                        var hx = h2ox[targetI] + dir * 20 + dir * ht * 50;
                        var hy = h2oy - ht * 30;
                        ns.hplus[hi].x(hx);
                        ns.hplus[hi].y(hy);
                        ns.hplus[hi].opacity(ht > 0 && ht < 1 ? ht : ht >= 1 ? 0 : 0);
                    }
                }
                if (t > 3.5) {
                    this._animPhase = 17;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 17: { // O²⁻ 缓慢移向 Pb⁴⁺ → 结合 → PbO₂，闪烁后完成
                var o2endX = cx2, o2endY = py;
                var o2startX = [cx2 - 50, cx2 + 50];
                var o2startY = [py + 50, py + 50];
                // t=0~3.5s: O²⁻ 缓慢移动
                if (t < 3.5) {
                    var ot = Math.min(1, t / 3.0);
                    for (var i = 0; i < 2; i++) {
                        var ox = o2startX[i] + (o2endX - o2startX[i]) * ot;
                        var oy = o2startY[i] + (o2endY - o2startY[i]) * ot;
                        ns.chgO2[i].x(ox);
                        ns.chgO2[i].y(oy);
                        ns.chgO2[i].opacity(1);
                    }
                }
                // t=3.0~3.5s: O²⁻ 到达，与 Pb⁴⁺ 重叠，开始结合
                if (t > 3.0 && t < 4.0) {
                    var flash = Math.sin(t * Math.PI * 6) > 0;
                    for (var i = 0; i < 2; i++) {
                        ns.chgO2[i].opacity(flash ? 0.8 : 0);
                    }
                    ns.chgPb4plus.opacity(flash ? 0.8 : 0);
                }
                // t=3.0s 起 Pb⁴⁺ 先保持可见，O²⁻ 到位后它们一起闪烁结合
                if (t < 3.0) ns.chgPb4plus.opacity(1);
                // t=3.5s 以后：PbO₂ 闪烁出现
                if (t > 3.5) {
                    for (var i = 0; i < 2; i++) ns.chgO2[i].opacity(0);
                    ns.chgPb4plus.opacity(0);
                    ns.chgFinalPbO2.text('PbO2');
                    ns.chgFinalPbO2.fill('#FF3333');
                    var flash2 = Math.sin(t * Math.PI * 4) > 0;
                    ns.chgFinalPbO2.opacity(flash2 || t > 4.5 ? 1 : 0);
                }
                if (t > 5.0) {
                    this._animPhase = 18;
                    this._animPhaseTime = 0;
                }
                break;
            }
            case 18: // 完成
                break;
        }
        this._animPhaseTime += dt;
    }
    getValue() { return this._voltage - (this._vp || 0); } // 返回端子电压（扣极化）
    getSOC() { return this._soc; } // 返回当前 SOC
    setSOC(v) { this._soc = Math.max(0, Math.min(1, parseFloat(v) || 0)); this._voltage = this._socToCellVoltage(this._soc); this._sg = this._socToSG(this._soc); } // 设置 SOC 并更新电压与比重
    getSpecificGravity() { return this._sg; } // 返回比重
    getConfigFields() { // 返回可配置字段，用于 UI 表单
        return [
            { label: '容量 Ah', key: 'capacity', type: 'number' },
            { label: '初始 SOC (0~1)', key: 'initialSOC', type: 'number' },
            { label: '内阻 \u03A9', key: 'rOn', type: 'number' },
            { label: '极化电阻 \u03A9', key: 'rp', type: 'number' },
            { label: '极化电容 F', key: 'cp', type: 'number' },
            {
                label: '电解液颜色', key: 'cellColor', type: 'select',
                options: [{ label: '淡黄', value: '#FFFACD' }, { label: '淡蓝', value: '#4a90d9' }, { label: '淡绿', value: '#4ad9a0' }, { label: '淡粉', value: '#d94a90' }] // 颜色选项
            },
        ];
    }
    onConfigUpdate(cfg) { // 处理配置更改并应用到内部状态
        if (cfg.capacity !== undefined) this._capacity = parseFloat(cfg.capacity);
        if (cfg.initialSOC !== undefined) this.setSOC(parseFloat(cfg.initialSOC));
        if (cfg.rOn !== undefined) this._rOn = parseFloat(cfg.rOn);
        if (cfg.rp !== undefined) { this._rp = parseFloat(cfg.rp); this._tau = this._rp * this._cp; }
        if (cfg.cp !== undefined) { this._cp = parseFloat(cfg.cp); this._tau = this._rp * this._cp; }
        if (cfg.cellColor !== undefined) { this._cellColor = cfg.cellColor; if (this._electrolyteRect) this._electrolyteRect.fill(cfg.cellColor); } // 更新显示颜色
        this.config = { ...this.config, ...cfg }; // 合并配置
    }
    triggerFaultSulfation(v) { this._faultSulfation = !!v; } // 触发/清除硫化故障
    triggerFaultLowElectrolyte(v) { this._faultLowElectrolyte = !!v; } // 触发/清除电解液不足故障
    destroy() { super.destroy?.(); } // 清理时调用父类销毁
}
