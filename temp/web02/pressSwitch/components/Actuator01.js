import { BaseComponent } from './BaseComponent.js';

export class PneumaticValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.w = 340;
        this.h = 700;
        this.type = 'PRECISION_VALVE';

        // 核心物理状态
        this.travel = 0; // 0.0 (全开) 到 1.0 (全关)
        this.targetTravel = 0;
        this.strokePx = 65; // 阀芯移动的总像素行程

        this.initVisuals();
        
        // 信号端口
        this.addPort(-10, 310, 'sig_in', 'wire', 'p');
        this.addPort(-10, 345, 'sig_gnd', 'wire');
        
        this._startLoop();
    }

    initVisuals() {
        const cx = this.w / 2;

        // --- 1. 顶置气室与膜片 (根据你的描述：膜片顶着弹簧) ---
        // 气室外壳
        const housing = new Konva.Path({
            x: cx, y: 100,
            data: `M -140 -60 L 140 -60 L 140 0 L 150 0 L 150 10 L 140 10 L 140 50 L 100 50 L 100 90 L 33 90 L 33 250 L -33 250 L -33 90 L -100 90 L -100 50 L -140 50 L -140 10 L -150 10 L -150 0 L -140 0 Z`,
            fill: '#f0f0f0', stroke: '#444', strokeWidth: 8
        });

        // 气压入口
        const inlet = new Konva.Line({ points: [cx, 20, cx, 40], stroke: '#666', strokeWidth: 4 });

        // 黑色膜片 (Diaphragm) - 初始位置在顶部
        this.membrane = new Konva.Path({
            x: cx, y: 100,
            data: this._getMembranePath(0),
            fill: '#1a1a1a'
        });

        // 托盘 (直接顶在膜片下)
        this.tray = new Konva.Rect({ x: cx - 100, y: 100, width: 200, height: 12, fill: '#333', cornerRadius: 2 });

        // 内部弹簧 (Spring) - 被托盘顶着
        this.spring = new Konva.Line({
            x: cx, y: 100,
            points: this._getSpringPoints(238),
            stroke: '#999', strokeWidth: 6, lineJoin: 'round'
        });

        // --- 2. 支架与定位器 ---
        const yoke = new Konva.Path({
            x: cx, y: 350,
            data: 'M -70 0 L -70 190 Q -70 210, -50 210 L 50 210 Q 70 210, 70 190 L 70 0 L 85 0 L 85 195 Q 85 225, 55 225 L -55 225 Q -85 225, -85 195 L -85 0 Z',
            fill: '#1a237e'
        });

        this.posBox = new Konva.Group({ x: cx - 120, y: 285 });
        this.posBox.add(new Konva.Rect({ width: 85, height: 110, fill: '#2c2c2c', stroke: '#000', cornerRadius: 4 }));
        this.lcd = new Konva.Text({ x: 10, y: 25, text: '0.0%', fontSize: 15, fill: '#33ff33', fontFamily: 'Courier New' });
        this.posBox.add(this.lcd);

        // --- 3. 核心：重构后的阀体 (Valve Body) ---
        const valveBaseY = 560;
        this.valveGroup = new Konva.Group({ x: cx, y: valveBaseY });

        // 阀体外廓与法兰 (Flanges)
        const bodyShell = new Konva.Path({
            data: 'M -130 30 L -110 30 L -110 0 L 110 0 L 110 30 L 130 30 L 130 110 L 110 110 L 110 150 L -110 150 L -110 110 L -130 110 Z',
            fill: '#666', stroke: '#333', strokeWidth: 2
        });

        // 内部流道剖面 (内腔)
        const valveCavity = new Konva.Path({
            data: 'M -110 45 L -35 45 L -35 65 L 35 65 L 35 105 L 110 105 L 110 135 L -110 135 Z',
            fill: '#dcdcdc' // 浅灰色代表流体通道
        });

        // 阀座 (Seat) - 图片中的关键台阶
        const seat = new Konva.Line({
            points: [-38, 65, 38, 65],
            stroke: '#333', strokeWidth: 6, lineCap: 'round'
        });

        this.valveGroup.add(bodyShell, valveCavity, seat);

        // --- 4. 阀杆与阀芯 (联动的运动部件) ---
        this.stem = new Konva.Rect({ x: cx - 4, y: 100, width: 8, height: 455, fill: '#eee', stroke: '#999' });
        
        // 阀芯 (Plug) - 图片中的黑色半圆盖状
        this.plug = new Konva.Path({
            x: cx, y: 567, // 初始位于阀座上方
            data: 'M -22 0 L 22 0 Q 22 15, 0 15 Q -22 15, -22 0 Z',
            fill: '#1a1a1a'
        });

        // 层级
        this.group.add(yoke, housing, inlet, this.spring, this.valveGroup, this.stem, this.plug, this.tray, this.membrane, this.posBox);
    }

    _getMembranePath(t) {
        const dip = t * 50; // 膜片中心下陷深度
        return `M -140 0 Q -140 10, -110 10 L -90 ${10 + dip} L 90 ${10 + dip} L 110 10 Q 140 10, 140 0 L 140 -15 L -140 -15 Z`;
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -28 : 28, (i / coils) * h);
        }
        return pts;
    }

    update(inputmA) {
        const mA = (typeof inputmA === 'number') ? Math.max(4, Math.min(20, inputmA)) : 4;
        this.targetTravel = (mA - 4) / 16;
        
        // 平滑过渡
        this.travel += (this.targetTravel - this.travel) * 0.15;

        const currentMove = this.travel * this.strokePx;

        // 1. 膜片与托盘联动
        this.membrane.data(this._getMembranePath(this.travel));
        this.tray.y(100 + currentMove);

        // 2. 弹簧压缩 (起点随托盘动，高度变短)
        this.spring.y(100 + currentMove + 12);
        this.spring.points(this._getSpringPoints(238 - currentMove));

        // 3. 阀杆与阀芯同步下移
        this.stem.y(100 + currentMove + 12);
        this.plug.y(567 + currentMove); // 阀芯向下靠近阀座

        // 4. 更新定位器显示
        this.lcd.text(`${mA.toFixed(1)}mA\n${(this.travel * 100).toFixed(1)}%`);

        // 5. 颜色联动 (关闭时流道变暗)
        const brightness = 220 - (this.travel * 100);
        this.valveGroup.findOne('Path').fill(`rgb(${brightness},${brightness},${brightness})`);
    }

    _startLoop() {}
}