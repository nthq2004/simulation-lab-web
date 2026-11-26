import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import imgAc600 from '../images/ac600.png';   // 由 Vite 处理（构建时复制/内联）

/**
 * Ac600Mimic — 主机遥控系统 AC 600 网络结构图（图片版 + 模块识别）
 * ═══════════════════════════════════════════════════════════════
 *  直接加载 images/ac600.png（原图 1024×973），按组件尺寸等比缩放居中显示；
 *  组件宽 842 × 高 800（与原图等比一致），左右不留空白；整块可拖动。
 *
 *  **模块识别**：图上各装置（BMU / CMU / MEI / ESU / DGU / RPMU / LCP …）都注册成
 *  可点击部件（`addClickablePart`），点击即在图上框出该模块并弹出中英文名称与功能说明，
 *  同时记录 `sys.lastClickedId`；工作流 `find` 步骤可直接用 `subTarget:'<部件 id>'`
 *  让箭头指向该模块（由 `getClickablePartCenter()` 换算绝对坐标）。
 *  部件 id 一览见下方 PARTS 表。
 *
 *  若希望图片铺满整个组件（拉伸），把 `_FIT = 'contain'` 改为 `'fill'` 即可。
 * ═══════════════════════════════════════════════════════════════
 */

const W = 842, H = 800;        // 宽度按图片等比缩放后的实际宽度（1024×973 → 高 800 时宽 842），不留左右空白
const IMG_SRC = imgAc600;
const _FIT = 'contain';        // 'contain' 等比缩放居中 / 'fill' 拉伸铺满

// 原图像素尺寸与"图片坐标 → 组件坐标"的换算（contain 居中，左右或上下可能留极窄边）
const IMG_W = 1024, IMG_H = 973;
const K = Math.min(W / IMG_W, H / IMG_H);
const OX = (W - IMG_W * K) / 2;
const OY = (H - IMG_H * K) / 2;
const mx = (x) => OX + x * K;      // 图片 x（像素） → 组件 x
const my = (y) => OY + y * K;      // 图片 y（像素） → 组件 y

/**
 * 螺旋桨动画几何（原图像素）：原图叶片已被抹掉，改画可按主机转速旋转的螺旋桨。
 *   hubX/hubY : 桨毂中心（旋转中心）
 *   L / W     : 叶片长度（半径）/ 最大半宽
 */
const PROP = { hubX: 918, hubY: 913, L: 52, W: 14 };   // 桨毂中心与尾轴中心线对齐，三片桨叶 120° 均布
/** 抹掉原图螺旋桨（含阴影）的白色遮罩矩形，避开左侧「Propeller」文字（文字右缘约 x=916） */
/** 双击跳页：双击图上某个模块 → 跳到对应装置页（0 索引页不提；页码与 PROJECT_PAGES 一致） */
const DBL_PAGE = {
    bmu: 1,      // 桥楼操纵单元 → 第 1 页 主机遥控系统 AC 600 驾控台
    cmu: 2,      // 集控室操纵单元 → 第 2 页 AC 600 集控台
    lcp: 3,      // 机旁控制面板 → 第 3 页 机旁面板
    engine: 4,   // MAN B&W MC 主机 → 第 4 页 主机气动操纵系统
};
const PROP_MASK = [
    [898, 816, 1006, 901],
    [900, 901, 1006, 933],
    [917, 933, 1006, 974],
    [824, 922, 920, 966],      // 「Propeller」文字区：抹掉后由组件重画（文字要在桨叶之上）
];

/**
 * 可识别模块表：坐标按**原图像素**填写（x1,y1,x2,y2），由 mx/my 换算成组件坐标。
 *   id  : 部件 id（工作流 subTarget / op.part 使用）
 *   en  : 图上英文名称
 *   cn  : 中文名称
 *   fn  : 一句话功能说明
 */
const PARTS = [
    {
        id: 'bmu', x1: 403, y1: 58, x2: 648, y2: 162,
        en: 'Bridge Manoeuvring Unit (BMU)', cn: '桥楼操纵单元',
        fn: '驾驶台主操车台：车钟、起动/停车、限制与安全指示',
    },
    {
        id: 'cmu', x1: 413, y1: 323, x2: 662, y2: 432,
        en: 'Control Room Manoeuvring Unit (CMU)', cn: '集控室操纵单元',
        fn: '集控室主操车台，控制权转到 ECR 时由此操车',
    },
    {
        id: 'bwu-port', x1: 18, y1: 33, x2: 214, y2: 157,
        en: 'Bridge Wing Manoeuvring Unit (PORT)', cn: '左舷桥翼操纵单元',
        fn: '桥翼操车面板，靠离泊时在船侧直接操车',
    },
    {
        id: 'bwu-stb', x1: 818, y1: 33, x2: 1022, y2: 157,
        en: 'Bridge Wing Manoeuvring Unit (STB.)', cn: '右舷桥翼操纵单元',
        fn: '桥翼操车面板，靠离泊时在船侧直接操车',
    },
    {
        id: 'op', x1: 298, y1: 58, x2: 374, y2: 112,
        en: 'Order Printer', cn: '车令打印机',
        fn: '打印车钟车令与应答记录（时间、车令、执行机构）',
    },
    {
        id: 'ssl', x1: 678, y1: 283, x2: 762, y2: 442,
        en: 'Start/Stop Speedset Lever', cn: '起动/停车与转速设定手柄',
        fn: '集控室的起动/停车手柄与转速设定（Speedset）',
    },
    {
        id: 'ipu', x1: 773, y1: 318, x2: 902, y2: 432,
        en: 'Indicating Panel Unit (IPU)', cn: '指示面板单元',
        fn: '集控室指示面板：车令、实际转速、转向等状态显示',
    },
    {
        id: 'lcp', x1: 14, y1: 698, x2: 186, y2: 822,
        en: 'Local Control Panel with Engine Telegraph (LCP)', cn: '机旁控制面板（带主机车钟）',
        fn: '机舱机旁操车台，控制权转到 LOCAL 时由它操纵主机',
    },
    {
        id: 'dpu', x1: 212, y1: 683, x2: 288, y2: 724,
        en: 'DPU nn. (Distributed Processing Unit)', cn: '分布式处理单元（编号 nn.）',
        fn: '通用 DPU 模块：采集/处理本站 I/O 并经 CAN 总线与系统通信，nn. 为站号',
    },
    {
        id: 'rai16', x1: 332, y1: 683, x2: 402, y2: 724,
        en: 'RAI16 (Slow Down)', cn: '遥控模拟量输入模块',
        fn: '16 路模拟量输入，采集主机参数供 Slow Down 判断',
    },
    {
        id: 'mei', x1: 436, y1: 683, x2: 514, y2: 724,
        en: 'Main Engine Interface (MEI)', cn: '主机接口单元',
        fn: '遥控系统与主机 ECS 的接口：传车令、转速给定与主机状态',
    },
    {
        id: 'esu', x1: 553, y1: 683, x2: 617, y2: 724,
        en: 'Engine Safety Unit (ESU)', cn: '主机安全单元',
        fn: '安全保护：超速、油压低等自动停车/减速（SHD/SLD）',
    },
    {
        id: 'dgu', x1: 893, y1: 718, x2: 987, y2: 754,
        en: 'Digital Governor Unit (DGU)', cn: '数字调速器单元',
        fn: '电子调速器：按转速给定计算并输出燃油指数',
    },
    {
        id: 'servo', x1: 848, y1: 753, x2: 932, y2: 797,
        en: 'Servo Unit', cn: '伺服单元',
        fn: '伺服油执行机构，驱动燃油升压泵齿条',
    },
    {
        id: 'actuator', x1: 536, y1: 760, x2: 640, y2: 805,
        en: 'Electric Actuator', cn: '电动执行器',
        fn: '主机执行机构，按调速器输出动作（燃油量控制）',
    },
    {
        id: 'rpmu', x1: 728, y1: 813, x2: 827, y2: 887,
        en: 'Dual RPM Units (incl. Overspeed)', cn: '双转速单元（含超速保护）',
        fn: '两路转速测量与超速保护回路，超速时切断燃油',
    },
    {
        id: 'rpmdet', x1: 686, y1: 862, x2: 758, y2: 900,
        en: 'RPM Detectors', cn: '转速探头',
        fn: '装在主机/轴上的转速传感器，供转速与超速回路使用',
    },
    {
        id: 'engine', x1: 195, y1: 745, x2: 690, y2: 955,
        en: 'MAN B&W MC Engine', cn: 'MAN B&W MC 主机',
        fn: '低速二冲程柴油机，转向决定正/倒车',
    },
    {
        id: 'prop', x1: 900, y1: 828, x2: 1015, y2: 955,
        en: 'Propeller', cn: '螺旋桨',
        fn: '定距螺旋桨，推力方向由主机转向决定',
    },
];

export class Ac600Mimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;
        this.type = 'ac600_mimic';

        this._idGroup = null;        // 当前识别框（点击模块时临时绘制）
        this._idTimer = null;

        this._initGroups();
        this._init();

        this.config = { id: this.id };
    }

    _tip() { /* 图片组件不弹提示（识别信息由画布上的标注框给出） */ }

    _redraw() {
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _init() {
        this._drawStatic();
        this._addDragPlate();
        this._drawPropeller();
        this._addParts();
    }

    /**
     * 螺旋桨动画：先用白块遮掉原图叶片，再画可旋转的螺旋桨（桨毂固定、叶片组旋转）。
     * 转速与转向跟随 `sys.ac600.rpm`（正车顺时针、倒车逆时针，角速度 = rpm × π/30，与真机一致）。
     */
    _drawPropeller() {
        const g = this._dynamicGroup;
        // ① 白色遮罩（只有遮罩区域被替换，左侧「Propeller」文字保留）
        PROP_MASK.forEach(([x1, y1, x2, y2]) => {
            g.add(new Konva.Rect({
                x: mx(x1), y: my(y1), width: (x2 - x1) * K, height: (y2 - y1) * K,
                fill: '#ffffff', listening: false,
            }));
        });

        // ② 叶片组（绕桨毂中心旋转）：两片对称叶片
        const spin = new Konva.Group({ x: mx(PROP.hubX), y: my(PROP.hubY), listening: false });
        const L = PROP.L * K, Wd = PROP.W * K;
        [0, 120, 240].forEach((deg) => {
            const blade = new Konva.Shape({
                rotation: deg,
                listening: false,
                sceneFunc: (ctx, shape) => {
                    ctx.beginPath();
                    ctx.moveTo(-7 * K, -8 * K);
                    ctx.bezierCurveTo(-Wd * 0.95, -L * 0.30, -Wd * 0.95, -L * 0.72, -Wd * 0.45, -L * 0.93);
                    ctx.quadraticCurveTo(0, -L * 1.04, Wd * 0.45, -L * 0.93);
                    ctx.bezierCurveTo(Wd * 0.95, -L * 0.72, Wd * 0.95, -L * 0.30, 7 * K, -8 * K);
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                },
                fillLinearGradientStartPoint: { x: -Wd, y: -L },
                fillLinearGradientEndPoint: { x: Wd, y: -L * 0.15 },
                fillLinearGradientColorStops: [0, '#f7e08b', 0.5, '#dcb553', 1, '#a9741a'],
                stroke: '#3a1d00', strokeWidth: 1.5,
            });
            spin.add(blade);
        });
        g.add(spin);
        this._propSpin = spin;
        this._propAngle = 0;

        // ③ 桨毂（固定不转，遮住叶片根部）+ 尾锥
        g.add(new Konva.Rect({
            x: mx(894), y: my(902), width: (940 - 894) * K, height: (925 - 902) * K,
            cornerRadius: 5 * K, listening: false,
            fillLinearGradientStartPoint: { x: 0, y: my(902) },
            fillLinearGradientEndPoint: { x: 0, y: my(925) },
            fillLinearGradientColorStops: [0, '#f2da92', 0.45, '#dcb553', 1, '#9c6a12'],
            stroke: '#3a1d00', strokeWidth: 1.4,
        }));
        // 尾锥：自桨毂右端收进，指向船尾
        g.add(new Konva.Rect({
            x: mx(936), y: my(905), width: (960 - 936) * K, height: (921 - 905) * K,
            cornerRadius: 8 * K, listening: false,
            fillLinearGradientStartPoint: { x: 0, y: my(905) },
            fillLinearGradientEndPoint: { x: 0, y: my(921) },
            fillLinearGradientColorStops: [0, '#e8c977', 0.5, '#c89838', 1, '#8d5f0e'],
            stroke: '#3a1d00', strokeWidth: 1.2,
        }));

        // ④ 重画「Propeller」标注（画在桨叶之上，桨叶扫过时文字仍清晰）
        g.add(new Konva.Text({
            x: mx(831), y: my(929.5), text: 'Propeller', listening: false,
            fontSize: 21 * K, fontFamily: 'Arial', fontStyle: 'normal', fill: '#000000',
        }));
    }

    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
    }

    _drawStatic() {
        const s = this._staticGroup;
        s.add(new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: '#f4f5f6', listening: false }));

        // 图片节点（先放占位框，加载完再贴上图片）
        this._imgNode = new Konva.Image({ x: 0, y: 0, width: W, height: H, listening: false });
        s.add(this._imgNode);
        this._fitImage(W, H);

        this._img = new Image();
        this._img.onload = () => {
            this._imgNode.image(this._img);
            this._fitImage(this._img.naturalWidth || this._img.width, this._img.naturalHeight || this._img.height);
            if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
            this._redraw();
        };
        this._img.onerror = () => {
            s.add(new Konva.Text({
                x: 0, y: H / 2 - 12, width: W, align: 'center', fontSize: 18,
                fill: '#c40000', text: `结构图加载失败：${IMG_SRC}`, listening: false,
            }));
        };
        this._img.src = IMG_SRC;
    }

    /** 按原图比例摆放（contain 居中 / fill 拉伸） */
    _fitImage(iw, ih) {
        if (!iw || !ih) return;
        if (_FIT === 'fill') {
            this._imgNode.x(0); this._imgNode.y(0);
            this._imgNode.width(W); this._imgNode.height(H);
            return;
        }
        const k = Math.min(W / iw, H / ih);
        const w = iw * k, h = ih * k;
        this._imgNode.x((W - w) / 2);
        this._imgNode.y((H - h) / 2);
        this._imgNode.width(w);
        this._imgNode.height(h);
    }

    /** 注册各装置的识别热区（点击框选 + 弹出名称与功能） */
    _addParts() {
        this._partMap = {};
        PARTS.forEach((p) => {
            const x = mx(p.x1), y = my(p.y1);
            const w = (p.x2 - p.x1) * K, h = (p.y2 - p.y1) * K;
            this._partMap[p.id] = { ...p, x, y, w, h };
            const hit = this.addClickablePart(p.id, x, y, w, h);
            if (hit) {
                // 基类给每个热区加了一层 3% 绿底；本图大片白底上会显成淡绿方块，
                // 改为「仅悬停时显示」，常态完全透明
                const bg = hit.getParent().getChildren()[0];
                bg.visible(false);
                hit.on('mouseenter', () => { bg.visible(true); this._redraw(); });
                hit.on('mouseleave', () => { bg.visible(false); this._redraw(); });
                // 追加识别动作（基类已做绿色闪光与 lastClickedId 记录）
                hit.on('click tap', () => { this._identify(p.id); });
                // 双击跳页（BMU / CMU / LCP / 主机）
                const pg = DBL_PAGE[p.id];
                if (pg) {
                    hit.on('dblclick', (e) => {
                        if (e) e.cancelBubble = true;
                        this._hideIdentify();
                        this.goPage(pg);
                    });
                }
            }
        });
    }

    /** 点击识别：框出模块 + 标注中英文名称与一句话功能，4 s 后自动淡出 */
    _identify(id) {
        const p = this._partMap && this._partMap[id];
        if (!p) return;
        this._hideIdentify();

        const g = new Konva.Group({ listening: false });
        // ① 框选
        g.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            stroke: '#00b400', strokeWidth: 3, cornerRadius: 3,
            fill: 'rgba(0,220,0,0.12)',
        }));
        // ② 标注框（默认放在模块下方，下方空间不足时移到上方）
        const cw = 272, ch = 76;
        let cy = p.y + p.h + 6;
        if (cy + ch > H - 4) cy = Math.max(4, p.y - ch - 6);
        let cx = p.x + p.w / 2 - cw / 2;
        cx = Math.max(4, Math.min(W - cw - 4, cx));
        g.add(new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: 'rgba(20,32,44,0.92)', stroke: '#00b400', strokeWidth: 2, cornerRadius: 4,
        }));
        g.add(new Konva.Text({
            x: cx + 8, y: cy + 6, width: cw - 16,
            fontSize: 11.5, fontStyle: 'bold', fill: '#7ef08a', text: p.en, wrap: 'word',
        }));
        g.add(new Konva.Text({
            x: cx + 8, y: cy + 22, width: cw - 16,
            fontSize: 14, fontStyle: 'bold', fill: '#ffffff', text: p.cn,
        }));
        g.add(new Konva.Text({
            x: cx + 8, y: cy + 42, width: cw - 16, height: ch - 46,
            fontSize: 11.5, fill: '#d7e2ea', text: p.fn, wrap: 'word', lineHeight: 1.15,
        }));
        this._dynamicGroup.add(g);
        this._idGroup = g;
        this._redraw();

        this._idTimer = setTimeout(() => this._hideIdentify(), 4000);
    }

    /** 清除识别框 */
    _hideIdentify() {
        if (this._idTimer) { clearTimeout(this._idTimer); this._idTimer = null; }
        if (this._idGroup) {
            this._idGroup.destroy();
            this._idGroup = null;
            this._redraw();
        }
    }

    /** 跳到指定页（双击模块时调用） */
    goPage(n) {
        const s = this.sys;
        if (!s || !s.pageMgr) return false;
        if (typeof s.navigateTo === 'function') s.navigateTo(n);
        else s.pageMgr.navigateTo(n);
        return true;
    }

    /** 便于外部（自动演示）直接触发识别 */
    identifyPart(id) {
        this._identify(id);
        return !!(this._partMap && this._partMap[id]);
    }

    tick(dt) {
        // 螺旋桨随主机转速旋转：角速度 = rpm × π/30（rad/s），倒车为负 → 反转
        const d = (typeof dt === 'number' && dt > 0) ? dt : 1 / 20;
        const M = this.sys && this.sys.ac600;
        const rpm = M ? (M.rpm || 0) : 0;
        this._propAngle = (this._propAngle || 0) + rpm * Math.PI / 30 * d;
        if (this._propSpin) this._propSpin.rotation(this._propAngle * 180 / Math.PI);
    }
}
