/**
 * CoolingSys 制冷系统组件。
 *
 * 作用：该组件用于在仿真平台中展示一个简化版的冷却/制冷系统，包括控制面板、压缩机、冷凝器、蒸发器和节流元件。
 * 它不单纯是静态图形，而是一个具备运行状态、温度显示、远程/本地控制切换以及循环流动动画的动态设备。
 *
 * 设计意图：
 * 1. 通过视觉方式表现压缩机工作与停机状态；
 * 2. 在本地或远程模式下控制制冷系统启停；
 * 3. 反馈当前温度并在系统中同步更新其他模块（如温度传感器 WT）；
 * 4. 通过动态箭头和机械运动模拟制冷循环过程，增强教学展示效果。
 */
import { BaseComponent } from './BaseComponent.js';

export class CoolingSys extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化 Konva group、配置、交互动作和系统上下文。
        super(config, sys);

        // 设置组件的整体尺寸和类型，确保其在画布中有稳定的占位和识别信息。
        this.W = 320;
        this.H = 400;
        this.type = 'CoolingSys';
        // 固定缓存提高静态部件的渲染效率，减少重复绘制开销。
        this.cache = 'fixed';

        // 初始化组件的三层分组，为后续图形绘制和动态更新做准备。
        this._initGroups();

        // 设备工作状态变量：模式、是否运行、功率和当前温度。
        this.mode = 'local';
        this.running = false;
        this.power = 0;
        this.targetPower = 0;
        this.temperature = config.initTemp !== undefined ? config.initTemp : 0;
        this._crankAngle = 0;

        // 按顺序绘制外壳、控制面板、制冷循环和端口。
        this._drawShell();
        this._drawControlPanel();
        this._drawRefrigerationCycle();
        this._drawPorts();

        // 保存当前组件配置快照，便于后续参数管理和重置。
        this.config = { id: this.id };
    }

    tick(dt) {
        // 每个仿真步先记录累计时间，使用 0.05s 的节拍来降低更新频率，避免过快刷新。
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.05) return;
        this._tickAcc = 0;

        // 远程模式下，只有当左右端口已连接时才认为系统可以供电并启动制冷。
        if (this.mode === 'remote') {
            const connected = this.sys.isPortConnected(`${this.id}_wire_l`, `${this.id}_wire_r`);
            this.targetPower = connected ? 1.0 : 0;
            this.running = this.targetPower > 0;
        }

        // 根据目标功率与当前功率之间的差值进行平滑变化，形成平滑的启停过程。
        const lerpSpeed = this.targetPower > this.power ? 0.25 : 0.12;
        this.power += (this.targetPower - this.power) * lerpSpeed * 0.2;
        if (this.power < 0.01) this.power = 0;

        // 在运行状态下温度下降；停机状态下温度缓慢回升，模拟冷却系统的热平衡过程。
        if (this.running) {
            this.temperature -= 0.2 * dt;
            this.temperature = Math.max(-18, this.temperature);
            this._crankAngle += this.power * 180 * dt;
        } else {
            this.temperature += 0.1 * dt;
            this.temperature = Math.min(20, this.temperature);
        }

        // 更新温度 LCD 显示，保证用户界面与内部状态一致。
        this._lcdTemp.text(this.temperature.toFixed(1) + '°C');

        // 温控测试滑块激活时不更新 WT1226，这样可以避免多个控制源同时设置同一温度值。
        const sc = document.getElementById('tempSliderContainer');
        if (!sc || sc.style.display === 'none') {
            const wt = this.sys.comps['wt'];
            if (wt && wt.update) wt.update(this.temperature);
        }

        // 最后更新所有动态视觉元素，包括压缩机动作、流动箭头和按钮颜色。
        this._updateVisuals();
    }

    _updateVisuals() {
        // 利用曲柄角度生成活塞上下运动位移，模拟压缩机机械往复动作。
        const rad = this._crankAngle * Math.PI / 180;
        const travel = Math.sin(rad) * 12;
        this._compPiston.y(this._compPistonOrigin + travel);
        this._compRod.points([0, 0, -Math.cos(rad) * 6, -30 + travel]);
        const running = this.running;
        // 起停按钮颜色随状态切换：运行时绿灯亮，停止时红灯亮。
        this._onBtn.fill(running ? '#00ff00' : '#006400');
        this._offBtn.fill(running ? '#8b0000' : '#ff0000');

        // 压缩机运行动画：内圈旋转 + 颜色变化，突出压缩机是否在工作。
        const angle = this._crankAngle % 360;
        this._compInner.rotation(running ? angle : 0);
        this._compOuter.fill(running ? '#dc3545' : '#6c757d');
        this._compInner.fill(running ? '#ff6b35' : '#495057');

        // 更新制冷循环中的箭头动画和流动颜色。
        this._updateFlowArrows(rad, running);

        // 要求系统重绘，保证画面及时更新到最新状态。
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _updateFlowArrows(rad, running) {
        // 运行时增加流动速度，停机时暂停显示动画，形成明显的启停视觉差异。
        const speed = running ? 3 : 0;
        this._flowArrows.forEach(arrow => {
            if (arrow.visible()) {
                const offset = (arrow.dashOffset() || 0) - speed;
                arrow.dashOffset(offset);
                arrow.stroke(running ? '#ff6b35' : '#4a7db5');
                arrow.strokeWidth(running ? 3.5 : 3);
            }
        });
    }

    _syncKnobRotation() {
        // 根据当前模式调整旋钮角度：local 在左偏，remote 在右偏。
        if (this._modeKnob) {
            new Konva.Tween({ node: this._modeKnob, duration: 0.2, rotation: this.mode === 'local' ? -45 : 45 }).play();
        }
    }

    set mode(val) {
        // 设置模式并同步旋钮视觉状态，确保面板和内部状态一致。
        this._mode = val;
        this._syncKnobRotation();
    }

    get mode() {
        // 读取当前控制模式，供系统判断是否允许本地或远程控制。
        return this._mode;
    }

    _drawShell() {
        // 外壳是灰色矩形底板，模拟工业设备的主体结构。
        this._staticGroup.add(new Konva.Rect({
            width: this.W, height: this.H,
            fill: '#e8e8e8', stroke: '#333', strokeWidth: 2, cornerRadius: 6
        }));
    }

    _drawControlPanel() {
        // 组件中心用于布局控制按钮和显示屏，便于整体视觉平衡。
        const cx = this.W / 2; // center of component = 160

        // 第一行控制区：模式旋钮、起动按钮、停止按钮呈三列对称分布。
        const row1Y = 45;
        const spacing = 85;
        const knobX = cx - spacing;
        const startX = cx;
        const stopX = cx + spacing;

        const panel = new Konva.Group({ x: 0, y: 0 });

        // 1. 模式转换旋钮：用于切换本地/远程控制。
        this._modeKnob = new Konva.Group({ x: knobX, y: row1Y, cursor: 'pointer' });
        this._modeKnob.add(new Konva.Circle({ radius: 20, fill: '#555', stroke: '#222', strokeWidth: 1.5 }));
        const knobInd = new Konva.Rect({ x: -2.5, y: -20, width: 5, height: 17, fill: '#fff', cornerRadius: 1 });
        this._modeKnob.add(knobInd);
        this._modeKnob.rotation(this.mode === 'local' ? -45 : 45);

        this._modeKnob.on('click', () => {
            // 点击旋钮切换模式；切换时清空目标功率和运行状态，避免模式混乱。
            this.mode = this.mode === 'local' ? 'remote' : 'local';
            this._syncKnobRotation();
            this.targetPower = 0;
            this.running = false;
        });

        panel.add(new Konva.Text({ x: knobX - 40, y: row1Y - 24, text: 'LOC', fontSize: 12, fontStyle: 'bold' }));
        panel.add(new Konva.Text({ x: knobX + 14, y: row1Y - 24, text: 'REM', fontSize: 12, fontStyle: 'bold' }));
        panel.add(this._modeKnob);

        // 2. 起动按钮：在本地模式下允许启动制冷系统。
        const onGroup = new Konva.Group({ x: startX, y: row1Y });
        this._onBtn = new Konva.Circle({ radius: 18, fill: '#006400', stroke: '#000', strokeWidth: 1.5, cursor: 'pointer' });
        onGroup.add(this._onBtn);
        onGroup.add(new Konva.Text({ x: -10, y: 21, text: '起动', fontSize: 12, fontStyle: 'bold' }));
        onGroup.on('click', () => {
            if (this.mode === 'local') {
                this.running = true;
                this.targetPower = 1.0;
            }
        });
        panel.add(onGroup);

        // 3. 停止按钮：在本地模式下允许停止制冷系统。
        const offGroup = new Konva.Group({ x: stopX, y: row1Y });
        this._offBtn = new Konva.Circle({ radius: 18, fill: '#dc3545', stroke: '#000', strokeWidth: 1.5, cursor: 'pointer' });
        offGroup.add(this._offBtn);
        offGroup.add(new Konva.Text({ x: -10, y: 21, text: '停止', fontSize: 12, fontStyle: 'bold' }));
        offGroup.on('click', () => {
            if (this.mode === 'local') {
                this.running = false;
                this.targetPower = 0;
            }
        });
        panel.add(offGroup);

        // 将整个控制面板加入交互层，确保按钮可点击。
        this._interactGroup.add(panel);

        // 4. LCD 显示屏，位于控制按钮下方，用于显示当前温度。
        const lw = 130, lh = 40;
        const lcdY = row1Y + 50;
        const lx = cx - lw / 2;

        this._staticGroup.add(new Konva.Rect({
            x: lx - 3, y: lcdY, width: lw + 6, height: lh + 6,
            fill: '#222', stroke: '#111', strokeWidth: 2, cornerRadius: 4
        }));
        this._staticGroup.add(new Konva.Rect({
            x: lx, y: lcdY + 3, width: lw, height: lh - 3,
            fill: '#1a3a1a', stroke: '#0d2e0d', strokeWidth: 1, cornerRadius: 2
        }));
        this._staticGroup.add(new Konva.Text({
            x: lx, y: lcdY + 1, width: lw,
            text: '温度', fontSize: 13, fill: '#4db84d',
            align: 'center', fontFamily: 'monospace'
        }));

        this._lcdTemp = new Konva.Text({
            x: lx, y: lcdY + 18, width: lw,
            text: '20.0\u00b0C', fontSize: 20, fontStyle: 'bold', fill: '#39ff39',
            align: 'center', fontFamily: 'monospace'
        });
        this._dynamicGroup.add(this._lcdTemp);
    }

    _drawRefrigerationCycle() {
        // 制冷循环区域位于设备中下部，用于图解压缩机、冷凝器、节流和蒸发器的工作流程。
        const box = new Konva.Group({ x: 15, y: 175 });

        const bw = this.W - 30, bh = this.H - 190;

        box.add(new Konva.Rect({
            width: bw, height: bh, fill: '#f5f5f0',
            stroke: '#666', strokeWidth: 1.5, cornerRadius: 4
        }));

        const cx = bw / 2, cy = bh / 2;

        const compX = cx, compY = 25;
        const condX = bw - 55, condY = cy;
        const thrX = cx, thrY = bh - 30;
        const evapX = 55, evapY = cy;

        this._flowArrows = [];

        const addArrowLine = (pts, color) => {
            // 动态流动箭头用于模拟循环流体在制冷回路中的流向。
            const line = new Konva.Line({
                points: pts, stroke: color || '#4a7db5',
                strokeWidth: 3, lineCap: 'round', dash: [6, 4],
                dashOffset: 0
            });
            box.add(line);
            this._flowArrows.push(line);
        };

        // 按制冷循环顺序连接各个部件：压缩机 -> 冷凝器 -> 节流 -> 蒸发器 -> 回压缩机。
        addArrowLine([compX + 22, compY, condX - 35, compY, condX - 35, condY]);
        addArrowLine([condX, condY + 22, condX, thrY - 22, thrX, thrY - 22]);
        addArrowLine([thrX, thrY + 22, evapX + 35, thrY + 22, evapX + 35, evapY]);
        addArrowLine([evapX, evapY - 22, evapX, compY, compX - 22, compY]);

        // 在关键接口处加入小圆点，说明实际管路连接位置。
        const portR = 5;
        box.add(new Konva.Circle({ x: condX - 35, y: condY, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));
        box.add(new Konva.Circle({ x: condX, y: condY + 22, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));
        box.add(new Konva.Circle({ x: evapX + 35, y: evapY, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));
        box.add(new Konva.Circle({ x: evapX, y: evapY - 22, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));

        // 压缩机主体：中心有外圈、内圈和活塞杆，显示机械压缩动作。
        const compGroup = new Konva.Group({ x: compX, y: compY });
        this._compOuter = new Konva.Circle({ radius: 22, fill: '#6c757d', stroke: '#333', strokeWidth: 2 });
        this._compInner = new Konva.Circle({ radius: 14, fill: '#495057', stroke: '#222', strokeWidth: 1 });
        compGroup.add(this._compOuter, this._compInner);
        this._compPiston = new Konva.Rect({ x: -8, y: -30, width: 16, height: 18, fill: '#adb5bd', stroke: '#333', cornerRadius: 2 });
        this._compPistonOrigin = -30;
        this._compRod = new Konva.Line({ points: [0, 0, 0, -30], stroke: '#888', strokeWidth: 4, lineCap: 'round' });
        compGroup.add(this._compPiston, this._compRod);
        compGroup.add(new Konva.Text({ x: -16, y: 26, text: '压缩机', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(compGroup);

        // 冷凝器以红色横线簇表示高温高压制冷剂释放热量的过程。
        const condGroup = new Konva.Group({ x: condX, y: condY });
        for (let i = 0; i < 4; i++) {
            condGroup.add(new Konva.Line({
                points: [-35, -20 + i * 13, 35, -20 + i * 13],
                stroke: '#dc3545', strokeWidth: 4, lineCap: 'round'
            }));
        }
        condGroup.add(new Konva.Line({ points: [-35, -20, -35, 22], stroke: '#dc3545', strokeWidth: 3 }));
        condGroup.add(new Konva.Line({ points: [35, -20, 35, 22], stroke: '#dc3545', strokeWidth: 3 }));
        condGroup.add(new Konva.Text({ x: -42, y: 30, text: '冷凝器', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(condGroup);

        // 节流元件使用三角形表示压力降低和流量控制的功能。
        const thrGroup = new Konva.Group({ x: thrX, y: thrY });
        thrGroup.add(new Konva.Line({
            points: [-18, -12, 18, -12, 0, 12],
            fill: '#ffc107', stroke: '#856404', strokeWidth: 2, closed: true
        }));
        thrGroup.add(new Konva.Line({ points: [0, -12, 0, -22], stroke: '#666', strokeWidth: 2 }));
        thrGroup.add(new Konva.Line({ points: [0, 12, 0, 22], stroke: '#666', strokeWidth: 2 }));
        thrGroup.add(new Konva.Text({ x: 12, y: 0, text: '节流元件', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(thrGroup);

        // 蒸发器以青色横线簇表示吸热蒸发过程，形成制冷循环闭环。
        const evapGroup = new Konva.Group({ x: evapX, y: evapY });
        for (let i = 0; i < 4; i++) {
            evapGroup.add(new Konva.Line({
                points: [-35, -20 + i * 13, 35, -20 + i * 13],
                stroke: '#17a2b8', strokeWidth: 4, lineCap: 'round'
            }));
        }
        evapGroup.add(new Konva.Line({ points: [-35, -20, -35, 22], stroke: '#17a2b8', strokeWidth: 3 }));
        evapGroup.add(new Konva.Line({ points: [35, -20, 35, 22], stroke: '#17a2b8', strokeWidth: 3 }));
        evapGroup.add(new Konva.Text({ x: -16, y: 30, text: '蒸发器', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(evapGroup);

        // 最后将整个制冷循环区域添加到组件根 group 中，作为静态图示的一部分。
        this.group.add(box);
    }

    _drawPorts() {
        // 端口放置在组件左侧边缘，便于连接到系统回路。
        this.addPort(0, 70, 'l', 'wire','p');
        this.addPort(0, 120, 'r', 'wire');
    }

    destroy() {
        // 调用父类销毁逻辑，保持生命周期一致。
        super.destroy?.();
    }
}
