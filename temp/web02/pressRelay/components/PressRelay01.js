import { BaseComponent } from './BaseComponent.js';

export class PressureRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 按照 2/3 比例缩小后的尺寸
        this.w = 230; 
        this.h = 280;
        this.type = 'DUAL_PRESSURE_SWITCH';

        // 核心物理状态
        this.pressure = 0;        // 输入压力 (0-100)
        this.setPoint = 50;       // 给定螺钉设定的目标压力
        this.differential = 10;   // 幅差调节 (死区大小)
        this.isSwitched = false;  // 触点当前状态

        this.initVisuals();

        // 端口设置
        this.addPort(160, 280, 'p_in', 'pipe', 'in'); // 右下角波纹管压力输入
        this.addPort(230, 30, 'com', 'wire');         // 公共触点
        this.addPort(230, 50, 'nc', 'wire');          // 常闭触点
        this.addPort(230, 70, 'no', 'wire');          // 常开触点
        
        this._startLoop();
    }

    initVisuals() {
        // 使用 0.66 缩放以匹配 2/3 大小要求
        this.viewGroup = new Konva.Group({ scaleX: 0.66, scaleY: 0.66, x: 5, y: 5 });
        this.group.add(this.viewGroup);

        const bx = 340, by = 400; // 原始设计画布参考系

        // --- 1. 外壳 ---
        this.viewGroup.add(new Konva.Rect({
            width: bx, height: by, fill: '#fff', stroke: '#333', strokeWidth: 3, cornerRadius: 4
        }));

        // --- 2. 左侧：给定弹簧机构 ---
        // 给定螺钉
        this.setScrew = new Konva.Rect({ x: 30, y: 20, width: 30, height: 60, fill: '#888', stroke: '#333' });
        this.setPointer = new Konva.Path({ data: 'M 60 40 L 80 40 L 70 30 Z', fill: '#f00' }); // 刻度指针
        // 给定弹簧
        this.mainSpring = new Konva.Line({ x: 45, y: 80, points: this._getSpringPoints(180), stroke: '#444', strokeWidth: 5 });

        // --- 3. 左下：幅差调节机构 ---
        this.diffGroup = new Konva.Group({ x: 80, y: 280 });
        this.diffScrew = new Konva.Rect({ x: 0, y: 50, width: 25, height: 40, fill: '#666' }); // 幅差旋钮
        this.diffSpring = new Konva.Line({ x: 12, y: 15, points: this._getSpringPoints(35), stroke: '#666', strokeWidth: 3 });
        this.diffGroup.add(this.diffScrew,this.diffSpring);

        // --- 4. 底部：核心主杠杆 (The Lever) ---
        this.mainLever = new Konva.Line({
            points: [38, 260, 280, 260], stroke: '#a0522d', strokeWidth: 8, lineCap: 'round'
        });
        this.pivot = new Konva.Path({ x: 200, y: 265, data: 'M 0 0 L 10 15 L -10 15 Z', fill: '#333' }); // 支点

        // --- 5. 右下：输入波纹管 ---
        this.bellows = new Konva.Group({ x: 250, y: 310 });
        this.bellowsBody = new Konva.Path({
            data: 'M -20 0 L 20 0 L 15 5 L 20 10 L 15 15 L 20 20 L 15 25 L 20 30 L -20 30 L -15 25 L -20 20 L -15 15 L -20 10 L -15 5 Z',
            fill: '#add8e6', stroke: '#333', strokeWidth: 1.5, scaleY: 2
        });
        this.bellows.add(this.bellowsBody);

        // --- 6. 右上：触点输出 (3个触点) ---
        this.contacts = new Konva.Group({ x: 180, y: 30 });
        const staticRod = new Konva.Rect({ x: 60, y: 0, width: 8, height: 100, fill: '#ddd', stroke: '#333' });
        this.pNC = new Konva.Circle({ x: 64, y: 20, radius: 5, fill: '#ff0000' }); // NC 红色常闭
        this.pNO = new Konva.Circle({ x: 64, y: 80, radius: 5, fill: '#777' });    // NO 灰色常开
        
        // 动触点连杆与红点
        this.movingArm = new Konva.Line({ points: [0, 80, 40, 20], stroke: '#ff0000', strokeWidth: 4 });
        this.movingPoint = new Konva.Circle({ x: 40, y: 20, radius: 8, fill: '#ff0000', stroke: '#000' });
        this.contacts.add(staticRod,this.pNC,this.pNO,this.movingArm,this.movingPoint);

        this.viewGroup.add(this.setScrew, this.setPointer, this.mainSpring, this.diffGroup, this.mainLever, this.pivot, this.bellows, this.contacts);
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 8;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -12 : 12, (i / coils) * h);
        }
        return pts;
    }

    /**
     * @param {number} p 输入压力
     * @param {number} sp 设定压力 (设定螺钉)
     * @param {number} diff 幅差 (123...10 旋钮)
     */
    update(p, sp = 50, diff = 10) {
        this.pressure = p;
        this.setPoint = sp;
        this.differential = diff;

        // 逻辑判断：包含幅差的双位动作
        // 上升动作点：p > sp
        // 下降复位点：p < (sp - diff)
        if (this.pressure < this.setPoint) {
            this.isSwitched = true;
        } else if (this.pressure > (this.setPoint - this.differential)) {
            this.isSwitched = false;
        }

        // 视觉响应
        const angle = (this.pressure - this.setPoint) * 0.1;
        const leverRotation = Math.max(-3, Math.min(3, angle));
        
        // 杠杆绕支点(200, 260)微转
        this.mainLever.rotation(-leverRotation);
        
        // 波纹管动画
        const bComp = Math.min(15, this.pressure * 0.2);
        this.bellowsBody.y(-bComp);
        this.bellowsBody.scaleY(2 - bComp/60);

        // 触点切换视觉
        if (this.isSwitched) {
            this.movingPoint.y(80);
            this.movingArm.points([0, 80, 60, 80]);
            this.pNO.fill('#00ff00'); // NO接通变绿
            this.pNC.fill('#777');
        } else {
            this.movingPoint.y(20);
            this.movingArm.points([0, 80, 60, 20]);
            this.pNO.fill('#777');
            this.pNC.fill('#ff0000'); // NC保持红色接通
        }

        // 调节机构随动
        this.setScrew.y(20 + (this.setPoint - 50) * 0.5);
        this.diffSpring.scaleY(1 + (this.differential / 20));
    }

    _startLoop() {}
}