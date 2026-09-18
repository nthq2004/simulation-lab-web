/**
 * RealControlTransformer 实际控制变压器组件。
 *
 * 该组件用于仿真控制变压器的原边、副边和铁芯结构，提供原边额定电压、副边额定电压、
 * 额定功率、频率、励磁电感、铁损电阻、铜损电阻以及漏感等参数。它通过端口电压读取
 * 原副边工作状态，并为求解器保存匝数比、磁化参数和历史电流状态；图形部分则绘制带
 * 叠片纹理的铁芯、原副边绕组、接线端子和 P1/P2、S1/S2 标识。
 *
 * 主要功能：
 * 1. 提供原边 P1/P2 与副边 S1/S2 四个电气端口；
 * 2. 根据额定电压计算原副边匝数比；
 * 3. 根据额定功率、频率和原边电压估算励磁电感；
 * 4. 保存铁损、铜损、漏感和历史电流状态等变压器模型参数；
 * 5. 在仿真循环中读取原副边端电压并更新交流相位；
 * 6. 支持通过配置面板修改变压器的额定参数。
 */
import { BaseComponent } from './BaseComponent.js';

export class RealControlTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 调用父类构造函数，初始化组件公共属性和系统引用。
        this.width  = 220;
        this.height = 170;

        // 使用固定尺寸绘制控制变压器图形，保证端子布局稳定。
        this.type    = 'control_transformer';

        // 设置组件类型，供电路系统识别为控制变压器。
        this.cache   = 'fixed';
        this._initGroups();

        // 读取原边额定电压，默认值为 380V。
        this._primaryVoltage   = config.primaryVoltage   || 380;
        // 读取副边额定电压，默认值为 220V。
        this._secondaryVoltage = config.secondaryVoltage || 220;
        // 读取额定容量，默认值为 1000VA。
        this._ratedPower       = config.ratedPower       || 1000;
        // 读取工作频率，默认值为 50Hz。
        this._frequency        = config.frequency        || 50;
        // 读取原边和副边铜损电阻。
        this._primaryResistance   = config.primaryResistance   || 20;
        this._secondaryResistance = config.secondaryResistance || 0.3;

        // 根据原副边额定电压计算变压器匝数比。
        this._turnsRatio = this._primaryVoltage / Math.max(1, this._secondaryVoltage);

        // 使用额定电压、容量和频率估算励磁电感。
        const Vp = this._primaryVoltage;
        const S  = this._ratedPower;
        const f  = this._frequency;
        const Ip = S / Math.max(1, Vp);
        const Xm = Vp / (0.05 * Ip);
        this._magnetizingInductance = Math.min(10, Xm / (2 * Math.PI * f));
        // 如果配置显式给出励磁电感，则优先使用配置值。
        if (config.magnetizingInductance !== undefined) {
            this._magnetizingInductance = parseFloat(config.magnetizingInductance) || 10;
        }
        // 设置铁损等效电阻。
        this._coreResistance = config.coreResistance || 50000;

        // 设置原副边漏感，注释中的单位分别对应典型示例值。
        this._primaryLeakage   = config.primaryLeakage   || 0.01;  // 10mH
        this._secondaryLeakage = config.secondaryLeakage || 0.001; // 1mH
        this._iLmPrev   = 0;
        this._iL1Prev   = 0;
        this._iL2Prev   = 0;
        this._i1Prev    = 0;
        this._i2Prev    = 0;
        this.V_primary   = 0;
        // 保存当前原副边电压和电流，供求解器与界面读取。
        this.V_secondary = 0;
        this.I_primary   = 0;
        this.I_secondary = 0;
        this._acPhase    = 0;

        // 保存变压器全部主要参数，便于配置管理和状态序列化。
        this.config = {
            id: this.id,
            primaryVoltage:   this._primaryVoltage,
            secondaryVoltage: this._secondaryVoltage,
            ratedPower:       this._ratedPower,
            frequency:        this._frequency,
            magnetizingInductance: this._magnetizingInductance,
            coreResistance:    this._coreResistance,
            primaryResistance:   this._primaryResistance,
            secondaryResistance: this._secondaryResistance,
            primaryLeakage:      this._primaryLeakage,
            secondaryLeakage:    this._secondaryLeakage,
        };

        // 创建铁芯、叠片纹理、原副边绕组、标签和端子图形。
        this._initVisuals();

        // 创建原边 P1/P2 与副边 S1/S2 四个电气端口。
        this.addPort(0, this._primaryTopY, 'p1', 'wire', 'p');
        this.addPort(0, this._primaryBotY, 'p2', 'wire', 'n');
        this.addPort(this.width, this._secondaryTopY, 's1', 'wire', 'p');
        this.addPort(this.width, this._secondaryBotY, 's2', 'wire', 'n');
    }

    _initVisuals() {
        // 根据固定画布尺寸计算铁芯、磁轭和两侧绕组的几何参数。
        const W = this.width, H = this.height;
        const cx = W / 2, cy = H / 2;
        const colW = 28;
        const gap = 76;
        const coreW = colW * 2 + gap;
        const coreH = 132;
        const yokeH = 22;
        const legH = coreH - yokeH * 2;

        const coreLeftX  = cx - coreW / 2;
        const coreRightX = coreLeftX + colW + gap;
        const coreTopY   = cy - coreH / 2;

        // 绘制变压器整体面板背景。
        const panel = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: 4,
        });
        this._staticGroup.add(panel);

        const coreColor = '#8898a8';
        const coreStroke = '#485060';

        // 创建绘制单块铁芯矩形的辅助函数。
        const drawCoreRect = (x, y, w, h) => {
            this._staticGroup.add(new Konva.Rect({
                x, y, width: w, height: h,
                fill: coreColor, stroke: coreStroke, strokeWidth: 1.5,
                cornerRadius: 1,
            }));
        };

        drawCoreRect(coreLeftX, coreTopY, colW, coreH);
        drawCoreRect(coreRightX, coreTopY, colW, coreH);
        drawCoreRect(coreLeftX, coreTopY, coreW, yokeH);
        drawCoreRect(coreLeftX, coreTopY + coreH - yokeH, coreW, yokeH);

        // 为左右铁芯柱添加竖向叠片纹理，表现铁芯由硅钢片叠成。
        const lamStripes = (legX) => {
            for (let i = 0; i < 8; i++) {
                const lx = legX + 3 + i * 3;
                this._staticGroup.add(new Konva.Line({
                    points: [lx, coreTopY + yokeH + 2, lx, coreTopY + coreH - yokeH - 2],
                    stroke: '#7a8a9a', strokeWidth: 0.3, listening: false,
                }));
            }
        };
        lamStripes(coreLeftX);
        lamStripes(coreRightX);

        // 计算两侧绕组端子高度，并设置绕组线段的轻微倾斜量。
        const tilt = 2;
        const spacingPri = legH / 6;
        const spacingSec = legH / 5;
        this._primaryTopY = coreTopY + yokeH + spacingPri;
        this._primaryBotY = coreTopY + yokeH + 5 * spacingPri;
        this._secondaryTopY = coreTopY + yokeH + spacingSec + tilt;
        this._secondaryBotY = coreTopY + yokeH + 4 * spacingSec + tilt;

        // 左侧绘制原边绕组，使用橙色并连接到 P1/P2。
        this._drawWinding(coreLeftX, coreTopY + yokeH, colW, legH, '#c07030', 5, 'left', tilt,
            this._primaryTopY, this._primaryBotY);
        // 右侧绘制副边绕组，使用蓝色并连接到 S1/S2。
        this._drawWinding(coreRightX, coreTopY + yokeH, colW, legH, '#3080b0', 4, 'right', tilt,
            this._secondaryTopY, this._secondaryBotY);

        // 设置端子标签的统一样式，并标注原副边四个端子。
        const label = { fontSize: 9, fontFamily: 'Arial', fontStyle: 'bold', fill: '#444', align: 'center', width: 20 };

        this._staticGroup.add(new Konva.Text({ x: -8, y: this._primaryTopY - 5, text: 'P1', ...label }));
        this._staticGroup.add(new Konva.Text({ x: -8, y: this._primaryBotY - 5, text: 'P2', ...label }));
        this._staticGroup.add(new Konva.Text({ x: W - 14, y: this._secondaryTopY - 5, text: 'S1', ...label }));
        this._staticGroup.add(new Konva.Text({ x: W - 14, y: this._secondaryBotY - 5, text: 'S2', ...label }));

        // 在四个绕组端点绘制金属接线端子。
        this._drawTerminal(0, this._primaryTopY, '#c83020');
        this._drawTerminal(0, this._primaryBotY, '#3068c0');
        this._drawTerminal(W, this._secondaryTopY, '#20a060');
        this._drawTerminal(W, this._secondaryBotY, '#806020');

    }

    _drawWinding(legX, y, legW, h, color, turns, side, tilt, termTopY, termBotY) {
        // 按指定匝数绘制一侧绕组，并将绕组首末端连接到对应外部端子。
        const spacing = h / (turns + 1);

        const termX = side === 'left' ? 0 : this.width;

        const isLeft = side === 'left';
        const entryX = isLeft ? legX : legX + legW;
        const firstTurnY = y + spacing;
        const lastTurnY = y + turns * spacing;
        const entryY = firstTurnY + (isLeft ? 0 : tilt);
        const exitY = lastTurnY + (isLeft ? 0 : tilt);

        // 绘制绕组上端引线。
        this._staticGroup.add(new Konva.Line({
            points: [termX, termTopY, entryX, entryY],
            stroke: color, strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));

        // 绘制绕组下端引线。
        this._staticGroup.add(new Konva.Line({
            points: [entryX, exitY, termX, termBotY],
            stroke: color, strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));

        // 按匝数循环绘制绕组内部的斜向线段。
        for (let t = 0; t < turns; t++) {
            const cy = y + (t + 1) * spacing;
            const endY = cy + tilt;

            this._staticGroup.add(new Konva.Line({
                points: [legX, cy, legX + legW, endY],
                stroke: color, strokeWidth: 1.8, lineCap: 'round',
                listening: false,
            }));
        }
    }

    _drawTerminal(x, y, color) {
        // 绘制带金属渐变和中心孔的单个接线端子。
        const tR = 5;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: tR,
            fillLinearGradientStartPoint: { x: -tR, y: -tR },
            fillLinearGradientEndPoint:   { x: tR, y: tR },
            fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
            stroke: '#908030', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: tR * 0.4, fill: '#383028',
        }));
    }

    getConfigFields() {
        // 配置面板开放额定参数、励磁参数、损耗参数和漏感参数。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '原边电压 (V)', key: 'primaryVoltage', type: 'number' },
            { label: '副边电压 (V)', key: 'secondaryVoltage', type: 'number' },
            { label: '额定功率 (VA)', key: 'ratedPower', type: 'number' },
            { label: '频率 (Hz)', key: 'frequency', type: 'number' },
            { label: '励磁电感 (H)', key: 'magnetizingInductance', type: 'number' },
            { label: '铁损电阻 (Ω)', key: 'coreResistance', type: 'number' },
            { label: '原边铜损电阻 (Ω)', key: 'primaryResistance', type: 'number' },
            { label: '副边铜损电阻 (Ω)', key: 'secondaryResistance', type: 'number' },
            { label: '原边漏感 (H)', key: 'primaryLeakage', type: 'number' },
            { label: '副边漏感 (H)', key: 'secondaryLeakage', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 按配置内容更新变压器的额定电气参数和等效模型参数。
        if (cfg.id                !== undefined) this.id = cfg.id;
        if (cfg.primaryVoltage    !== undefined) this._primaryVoltage   = parseFloat(cfg.primaryVoltage) || 380;
        if (cfg.secondaryVoltage  !== undefined) this._secondaryVoltage = parseFloat(cfg.secondaryVoltage) || 220;
        if (cfg.ratedPower        !== undefined) this._ratedPower       = parseFloat(cfg.ratedPower) || 1000;
        if (cfg.frequency         !== undefined) this._frequency        = parseFloat(cfg.frequency) || 50;
        if (cfg.magnetizingInductance !== undefined) this._magnetizingInductance = parseFloat(cfg.magnetizingInductance) || 10;
        if (cfg.coreResistance !== undefined) this._coreResistance = parseFloat(cfg.coreResistance) || 50000;
        if (cfg.primaryResistance !== undefined) this._primaryResistance   = parseFloat(cfg.primaryResistance) || 20;
        if (cfg.secondaryResistance !== undefined) this._secondaryResistance = parseFloat(cfg.secondaryResistance) || 0.3;
        if (cfg.primaryLeakage !== undefined) this._primaryLeakage   = parseFloat(cfg.primaryLeakage) || 0.01;
        if (cfg.secondaryLeakage !== undefined) this._secondaryLeakage = parseFloat(cfg.secondaryLeakage) || 0.001;

        // 原副边额定电压变化后重新计算匝数比。
        this._turnsRatio = this._primaryVoltage / Math.max(1, this._secondaryVoltage);

        // 根据更新后的额定电压、功率和频率重新估算励磁电感。
        const Vp = this._primaryVoltage;
        const S  = this._ratedPower;
        const f  = this._frequency;
        const Ip = S / Math.max(1, Vp);
        const Xm = Vp / (0.05 * Ip);
        this._magnetizingInductance = Math.min(10, Xm / (2 * Math.PI * f));
        if (cfg.magnetizingInductance !== undefined) {
            this._magnetizingInductance = parseFloat(cfg.magnetizingInductance) || 10;
        }

        // 合并并保存最新配置，保留没有出现在本次更新中的旧字段。
        this.config = { ...this.config, ...cfg };

        // 重建静态和动态图层，使更新后的参数和端子布局立即生效。
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._initVisuals();
        this._refreshCache?.();
    }

    tick(dt) {
        // 每个仿真步从电压求解器读取原边和副边端子所在节点的电压。
        const sv = this.sys?.voltageSolver;
        if (sv) {
            // 将端口名称转换为节点电压；端口没有有效簇时返回零电压。
            const getV = (port) => {
                const c = sv.portToCluster.get(`${this.id}_wire_${port}`);
                if (c === undefined) return 0;
                return sv.nodeVoltages.get(c) || 0;
            };
            const vP1 = getV('p1');
            const vP2 = getV('p2');
            const vS1 = getV('s1');
            const vS2 = getV('s2');
            // 通过两端电位差计算原边和副边实际端电压。
            this.V_primary   = vP1 - vP2;
            this.V_secondary = vS1 - vS2;

            // 原/副边电流由求解器的互感耦合电感模型直接写入相关状态。
        }

        // 根据仿真步长和工作频率推进交流相位，并限制在 0~2π 范围内。
        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._frequency) % (2 * Math.PI);

        // 判断原边是否存在有效工作电压，保留该状态供后续扩展逻辑使用。
        const active = Math.abs(this.V_primary) > 0.5;

        // 标记组件状态变化并按需刷新显示。
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        // 调用父类销毁逻辑，释放变压器图形和相关资源。
        super.destroy?.();
    }
}
