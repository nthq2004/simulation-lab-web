import { BaseComponent } from './BaseComponent.js';

/**
 * 单冷水龙头仿真组件
 * （Cold-Water Faucet）
 *
 * ── 外观说明 ──────────────────────────────────────────────────
 *
 *  正视图，模拟典型卫生间/厨房台盆壁挂式单冷水龙头，整体造型：
 *
 *      ┌──────────────────────────────────────────┐
 *      │        ╔══════╗  ← 旋转开关（顶面）       │
 *      │        ║ 十字 ║  ← 四叶十字把手           │
 *      │        ╚══╦══╝                           │
 *      │           ║     ← 阀杆（连接柱）          │
 *      │     ╔═════╩═════╗  ← 阀体（六棱柱）       │
 *      │     ╚══════╦════╝                         │
 *      │    ═══════╦╩╦═══════  ← 法兰压板           │
 *      │           ║  ║   ← 出水管（向下弯）        │
 *      │           ╚══╝                            │
 *      │          ↓ 出水口                         │
 *      └──────────────────────────────────────────┘
 *
 * ── 部件详解 ──────────────────────────────────────────────────
 *
 *  1. 壁挂底板（Wall Plate）
 *     矩形不锈钢底板，固定于墙面（顶部），有 4 颗固定螺钉
 *
 *  2. 进水管接头（Inlet Connection）
 *     从底板中央向前伸出的短管，连接阀体
 *
 *  3. 阀体（Valve Body）
 *     六棱柱形主体，铜质镀铬，正面略带透视感
 *     颜色：亮铬银
 *
 *  4. 法兰压板（Packing Nut / Flange）
 *     阀体上方的六角压紧螺母，比阀体稍大
 *
 *  5. 阀杆（Stem）
 *     从法兰中心向上伸出的细圆柱
 *
 *  6. 十字把手（Cross Handle）
 *     四叶十字形旋转把手，蓝色标识（单冷水标准色）
 *     ─ 旋转范围：0°（完全关闭）→ 360°（完全打开，对应满流量）
 *     ─ 每旋转 360° 对应 100% 流量（螺旋阀结构）
 *     ─ 可无限顺时针（增流）或逆时针（减流）拖拽
 *     ─ 实际有效旋转量 clamp 在 0~360°，流量 = 旋转量/360
 *     ─ 十字把手有防滑竖纹
 *     ─ 中心圆帽（蓝色冷水标识点）
 *     ─ 双击把手：快速全开 ↔ 全关（300ms 缓动）
 *
 *  7. 出水管（Spout）
 *     从阀体下方弯出，向下方弯 90° 后垂直向下出水
 *     金属圆管感，末端有出水口圆孔
 *
 *  8. 出水水柱（Water Stream）
 *     从出水口垂直向下的水柱：
 *     ─ 关闭时无水
 *     ─ 小流量：细水流，半透明蓝色，带轻微摆动
 *     ─ 中流量：饱满水柱，有高光线
 *     ─ 大流量：宽水柱，透明度降低，伴随水花粒子飞溅
 *     ─ 水流颜色：恒为冷水蓝（不随温度变化）
 *
 *  9. 流量旋转指示环（Flow Ring）
 *     把手外周一圈刻度弧，0~360° 标注开度，彩色填充随旋转变化
 *
 *  10. 流量文字标注
 *      把手上方显示当前开度（°）和流量（L/min）
 *
 * ── 旋钮交互 ──────────────────────────────────────────────────
 *
 *  鼠标/触控拖拽十字把手：
 *    计算鼠标相对把手中心的角度差，累加到 _totalRotation（无限制）
 *    流量 = clamp(_totalRotation, 0, 360) / 360
 *
 *  双击把手：
 *    若流量 < 50% → 缓动至全开（_totalRotation → 360）
 *    否则 → 缓动至全关（_totalRotation → 0）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_in  — 冷水进口（底板中央，向左或向上）
 *  terminal_out — 出水口（出水管末端，向下）
 */
export class ColdFaucet extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(300, config.height || 360);

        this.type    = 'cold_faucet';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──
        this.label   = config.label   || 'CF';
        this.maxFlow = config.maxFlow || 6;    // L/min
        this.waterTemp = config.waterTemp || 15; // °C 固定冷水温度

        // ── 旋转状态 ──
        // _totalRotation: 0~360°，对应 0%~100% 流量
        this._totalRotation  = Math.max(0, Math.min(360, config.initRotation || 0));
        this._targetRotation = this._totalRotation;
        this._handleAngle    = this._totalRotation;   // 把手显示角度（可超过360°用于视觉）

        // 拖拽
        this._dragging        = false;
        this._dragStartMouseA = 0;   // 拖拽开始时鼠标角度（°）
        this._dragStartRot    = 0;   // 拖拽开始时的旋转量

        // 双击
        this._lastClickTs = 0;

        // 派生
        this._flow = this._totalRotation / 360;

        // 粒子
        this._drops = [];


        this._calcGeometry();
        this._init();

        // ── 端口 ──
        const g = this._geo;
        this.addPort(g.plateCX,     g.plateY,               'terminal_in',  'wire', 'IN');
        this.addPort(g.spoutTipX,   g.spoutTipY + 6,        'terminal_out', 'wire', 'OUT');
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // ── 壁挂底板 ──
        g.plateW  = W * 0.60;
        g.plateH  = H * 0.07;
        g.plateX  = W * 0.20;
        g.plateY  = H * 0.04;
        g.plateCX = W * 0.50;
        g.plateCY = g.plateY + g.plateH / 2;

        // ── 进水短管（底板向下）──
        g.inletW  = W * 0.090;
        g.inletH  = H * 0.045;
        g.inletX  = g.plateCX - g.inletW / 2;
        g.inletY  = g.plateY + g.plateH;

        // ── 阀体（六棱柱外框简化为圆角矩形）──
        g.bodyW   = W * 0.36;
        g.bodyH   = H * 0.115;
        g.bodyX   = g.plateCX - g.bodyW / 2;
        g.bodyY   = g.inletY + g.inletH;

        // ── 法兰压板 ──
        g.flangeW = g.bodyW * 1.18;
        g.flangeH = H * 0.040;
        g.flangeX = g.plateCX - g.flangeW / 2;
        g.flangeY = g.bodyY - g.flangeH * 0.50;

        // ── 阀杆 ──
        g.stemW   = W * 0.060;
        g.stemH   = H * 0.060;
        g.stemX   = g.plateCX - g.stemW / 2;
        g.stemY   = g.flangeY - g.stemH;

        // ── 十字把手 ──
        g.handleCX = g.plateCX;
        g.handleCY = g.stemY - H * 0.015;
        g.handleR  = W * 0.175;   // 把手臂长（中心到端部）
        g.handleArmW = W * 0.068; // 臂宽

        // ── 流量指示环 ──
        g.ringR    = g.handleR + W * 0.062;
        g.ringCX   = g.handleCX;
        g.ringCY   = g.handleCY;

        // ── 出水管 ──
        // 从阀体底部弯出，先水平向右，再垂直向下
        g.spoutPipeW = W * 0.075;
        // 弯管起点（阀体底部中心偏右）
        g.elbowX  = g.plateCX + g.bodyW * 0.20;
        g.elbowY  = g.bodyY + g.bodyH;
        // 弯管末端（向右平移后向下）
        g.spoutEndX  = g.plateCX + g.bodyW * 0.52;
        g.spoutEndY  = g.elbowY;
        // 出水垂直段终点
        g.spoutTipX  = g.spoutEndX;
        g.spoutTipY  = H * 0.78;

        // ── 水柱起点 ──
        g.streamX = g.spoutTipX;
        g.streamY = g.spoutTipY + g.spoutPipeW * 0.4;

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawWallPlate();
        this._drawValveBody();
        this._drawSpout();
        this._drawRing();
        this._drawFlowLabel();
        this._buildHandleGroup();
        this._drawParticleLayer();
        this._drawPortLabels();
        this._drawComponentLabel();
        this._bindDrag();
        
        this._recalcFlow();
    }

    // ── 壁挂底板 ─────────────────────────────
    _drawWallPlate() {
        const g = this._geo;

        // 底板阴影
        this.group.add(new Konva.Rect({
            x: g.plateX + 3, y: g.plateY + 4,
            width: g.plateW, height: g.plateH,
            fill: 'rgba(0,0,0,0.15)', cornerRadius: 3,
        }));

        // 底板主体
        this.group.add(new Konva.Rect({
            x: g.plateX, y: g.plateY,
            width: g.plateW, height: g.plateH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: g.plateH },
            fillLinearGradientColorStops: [
                0, '#d0d8e2', 0.35, '#e8eef4', 0.65, '#dde4ec', 1, '#b8c0ca',
            ],
            stroke: '#a0a8b2', strokeWidth: 1, cornerRadius: 3,
        }));
        // 顶面高光
        this.group.add(new Konva.Rect({
            x: g.plateX + 4, y: g.plateY + 2,
            width: g.plateW - 8, height: g.plateH * 0.30,
            fill: 'rgba(255,255,255,0.28)', cornerRadius: [2, 2, 0, 0],
        }));

        // 四颗固定螺钉
        const screwY = g.plateCY;
        [
            g.plateX + g.plateW * 0.10,
            g.plateX + g.plateW * 0.30,
            g.plateX + g.plateW * 0.70,
            g.plateX + g.plateW * 0.90,
        ].forEach(sx => {
            this.group.add(new Konva.Circle({
                x: sx, y: screwY, radius: g.plateH * 0.28,
                fill: '#909aa4', stroke: '#687078', strokeWidth: 0.7,
            }));
            // 十字槽
            [0, 1].forEach(i => {
                const r = g.plateH * 0.20;
                const a = i * Math.PI / 2;
                this.group.add(new Konva.Line({
                    points: [sx - Math.cos(a)*r, screwY - Math.sin(a)*r,
                             sx + Math.cos(a)*r, screwY + Math.sin(a)*r],
                    stroke: '#505860', strokeWidth: 0.8,
                }));
            });
        });
    }

    // ── 阀体（进水管 + 六棱阀体 + 法兰压板 + 阀杆）──
    _drawValveBody() {
        const g  = this._geo;
        const pw = g.inletW;

        // ── 进水短管 ──
        this.group.add(new Konva.Rect({
            x: g.inletX, y: g.inletY,
            width: pw, height: g.inletH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: pw, y: 0 },
            fillLinearGradientColorStops: [
                0,'#808890', 0.25,'#b8c0ca', 0.55,'#d8e0e8',
                0.80,'#b0b8c2', 1,'#787e88',
            ],
            stroke: '#606870', strokeWidth: 0.8,
        }));

        // ── 法兰压板（六角螺母感，圆角矩形模拟）──
        this.group.add(new Konva.Rect({
            x: g.flangeX, y: g.flangeY,
            width: g.flangeW, height: g.flangeH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: g.flangeH },
            fillLinearGradientColorStops: [
                0,'#c8d0da', 0.30,'#dde4ec', 0.60,'#c8d0d8', 1,'#a8b0b8',
            ],
            stroke: '#8a9298', strokeWidth: 1, cornerRadius: 3,
            shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.18,
        }));
        // 法兰侧面网纹（六角感）
        const faceW = g.flangeW * 0.12;
        [-1, 1].forEach(s => {
            this.group.add(new Konva.Rect({
                x: g.flangeX + (s > 0 ? g.flangeW - faceW : 0),
                y: g.flangeY,
                width: faceW, height: g.flangeH,
                fill: s > 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
                cornerRadius: s > 0 ? [0,3,3,0] : [3,0,0,3],
            }));
        });

        // ── 阀体主体（圆角矩形，铬银色）──
        this.group.add(new Konva.Rect({
            x: g.bodyX, y: g.bodyY,
            width: g.bodyW, height: g.bodyH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: g.bodyW, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#6e7880',
                0.15,'#a8b4bc',
                0.38,'#d0dae4',
                0.55,'#dde6ee',
                0.72,'#c4ccd6',
                0.88,'#96a0aa',
                1,   '#6a7480',
            ],
            stroke: '#607080', strokeWidth: 1.2,
            cornerRadius: 4,
            shadowColor: '#000', shadowBlur: 6,
            shadowOffsetY: 2, shadowOpacity: 0.22,
        }));
        // 阀体顶面高光带
        this.group.add(new Konva.Rect({
            x: g.bodyX + 4, y: g.bodyY + 2,
            width: g.bodyW - 8, height: g.bodyH * 0.22,
            fill: 'rgba(255,255,255,0.22)', cornerRadius: [3,3,0,0],
        }));
        // 阀体侧面暗影
        this.group.add(new Konva.Rect({
            x: g.bodyX, y: g.bodyY + g.bodyH * 0.65,
            width: g.bodyW, height: g.bodyH * 0.35,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: g.bodyH * 0.35 },
            fillLinearGradientColorStops: [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.14)'],
            cornerRadius: [0,0,4,4],
        }));

        // ── 阀杆 ──
        this.group.add(new Konva.Rect({
            x: g.stemX, y: g.stemY,
            width: g.stemW, height: g.stemH + 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: g.stemW, y: 0 },
            fillLinearGradientColorStops: [
                0,'#7a8290', 0.30,'#b8c0ca', 0.60,'#c8d0da', 0.85,'#9aa2aa', 1,'#6e7680',
            ],
            stroke: '#606870', strokeWidth: 0.8,
            cornerRadius: [2, 2, 0, 0],
        }));
    }

    // ── 出水管（L形弯管）────────────────────
    _drawSpout() {
        const g  = this._geo;
        const pw = g.spoutPipeW;

        // 水平段（阀体底部 → 向右弯）
        const horizLen = g.spoutEndX - g.elbowX + pw / 2;
        // 阴影
        this.group.add(new Konva.Rect({
            x: g.elbowX - pw/2 + 2, y: g.elbowY - pw/2 + 2,
            width: horizLen, height: pw,
            fill: 'rgba(0,0,0,0.13)', cornerRadius: [0, pw/2, pw/2, 0],
        }));
        // 主体（深→浅→深竖向渐变，圆管感）
        this.group.add(new Konva.Rect({
            x: g.elbowX - pw/2, y: g.elbowY - pw/2,
            width: horizLen, height: pw,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: pw },
            fillLinearGradientColorStops: [
                0,'#7a8290', 0.25,'#c0c8d2', 0.50,'#dde4ec',
                0.75,'#b8c0ca', 1,'#6e7680',
            ],
            stroke: '#607080', strokeWidth: 0.8,
            cornerRadius: [0, pw/2, pw/2, 0],
        }));
        // 高光线
        this.group.add(new Konva.Line({
            points: [g.elbowX, g.elbowY - pw*0.22,
                     g.spoutEndX + pw*0.30, g.elbowY - pw*0.22],
            stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1.2, lineCap: 'round',
        }));

        // 弯头圆角（用圆形覆盖折角）
        this.group.add(new Konva.Circle({
            x: g.spoutEndX, y: g.spoutEndY,
            radius: pw / 2,
            fillLinearGradientStartPoint: { x: -pw/2, y: -pw/2 },
            fillLinearGradientEndPoint:   { x: pw/2, y: pw/2 },
            fillLinearGradientColorStops: [0,'#c0c8d2', 0.5,'#dde4ec', 1,'#8a9298'],
            stroke: '#607080', strokeWidth: 0.8,
        }));

        // 垂直段（向下出水）
        const vertLen = g.spoutTipY - g.spoutEndY;
        this.group.add(new Konva.Rect({
            x: g.spoutEndX - pw/2 + 2, y: g.spoutEndY + 2,
            width: pw, height: vertLen,
            fill: 'rgba(0,0,0,0.12)', cornerRadius: [0,0,pw/2,pw/2],
        }));
        this.group.add(new Konva.Rect({
            x: g.spoutEndX - pw/2, y: g.spoutEndY,
            width: pw, height: vertLen,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: pw, y: 0 },
            fillLinearGradientColorStops: [
                0,'#7a8290', 0.22,'#b8c0ca', 0.50,'#dde4ec',
                0.78,'#b0b8c2', 1,'#6e7680',
            ],
            stroke: '#607080', strokeWidth: 0.8,
            cornerRadius: [0,0,pw/2,pw/2],
        }));
        // 垂直管高光
        this.group.add(new Konva.Line({
            points: [g.spoutEndX - pw*0.22, g.spoutEndY + pw*0.3,
                     g.spoutEndX - pw*0.22, g.spoutTipY - pw*0.4],
            stroke: 'rgba(255,255,255,0.32)', strokeWidth: 1.1, lineCap: 'round',
        }));

        // 出水口端面
        this.group.add(new Konva.Line({
            points: [g.spoutTipX - pw/2, g.spoutTipY,
                     g.spoutTipX + pw/2, g.spoutTipY],
            stroke: '#505860', strokeWidth: 2, lineCap: 'round',
        }));
        // 出水口内孔
        this._spoutHole = new Konva.Circle({
            x: g.spoutTipX, y: g.spoutTipY,
            radius: pw * 0.28,
            fill: '#1a2030', stroke: '#3a4050', strokeWidth: 0.7,
        });
        this.group.add(this._spoutHole);
    }

    // ── 流量指示环（刻度弧）─────────────────
    _drawRing() {
        const g = this._geo;

        // 轨道背景弧
        this.group.add(new Konva.Circle({
            x: g.ringCX, y: g.ringCY,
            radius: g.ringR,
            fill: 'transparent',
            stroke: '#2a3040', strokeWidth: 5,
        }));

        // 流量填充弧（动态，存引用）
        this._ringArc = new Konva.Arc({
            x: g.ringCX, y: g.ringCY,
            innerRadius: g.ringR - 3,
            outerRadius: g.ringR + 2,
            angle: 0,
            rotation: -90,           // 从顶部 12 点钟开始
            fill: '#29b6f6',
        });
        this.group.add(this._ringArc);

        // 刻度线（12 根，每 30°）
        for (let i = 0; i < 12; i++) {
            const a   = (-90 + i * 30) * Math.PI / 180;
            const long = i % 3 === 0;
            const r1  = g.ringR - (long ? 7 : 4);
            const r2  = g.ringR + (long ? 4 : 2);
            this.group.add(new Konva.Line({
                points: [
                    g.ringCX + Math.cos(a)*r1, g.ringCY + Math.sin(a)*r1,
                    g.ringCX + Math.cos(a)*r2, g.ringCY + Math.sin(a)*r2,
                ],
                stroke: long ? '#90a4ae' : '#546e7a',
                strokeWidth: long ? 1.3 : 0.7,
            }));
        }

        // 关/开标注
        [
            { ang: -90, label: '关', color: '#78909c' },
            { ang:  268, label: '开', color: '#29b6f6' },
        ].forEach(({ ang, label, color }) => {
            const rad = ang * Math.PI / 180;
            this.group.add(new Konva.Text({
                x: g.ringCX + Math.cos(rad) * (g.ringR + 12) - 7,
                y: g.ringCY + Math.sin(rad) * (g.ringR + 12) - 6,
                width: 14, text: label,
                fontSize: 8, fontStyle: 'bold',
                fill: color, align: 'center',
            }));
        });
    }

    _updateRing() {
        if (!this._ringArc) return;
        const deg = this._flow * 355;   // 最多 355° 不闭合成圆
        this._ringArc.angle(deg);
        // 颜色：关→灰，小流→浅蓝，大流→深蓝
        const h = Math.round(200 + this._flow * 10);
        const s = Math.round(60 + this._flow * 30);
        const l = Math.round(40 + this._flow * 20);
        this._ringArc.fill(`hsl(${h},${s}%,${l}%)`);
    }

    // ── 流量文字标注 ────────────────────────
    _drawFlowLabel() {
        const g = this._geo;
        const labelY = g.handleCY - g.ringR - 22;

        this._flowText = new Konva.Text({
            x: g.handleCX - g.ringR, y: labelY,
            width: g.ringR * 2,
            text: '关  闭',
            fontSize: 9.5, fontStyle: 'bold',
            fill: '#78909c', align: 'center',
        });
        this.group.add(this._flowText);

        this._flowSub = new Konva.Text({
            x: g.handleCX - g.ringR, y: labelY + 12,
            width: g.ringR * 2,
            text: '',
            fontSize: 7.5, fill: '#546e7a', align: 'center',
        });
        this.group.add(this._flowSub);
    }

    _updateFlowLabel() {
        if (!this._flowText) return;
        const f = this._flow;
        if (f < 0.01) {
            this._flowText.text('关  闭'); this._flowText.fill('#78909c');
            this._flowSub.text('');
        } else if (f < 0.35) {
            this._flowText.text('小  流'); this._flowText.fill('#64b5f6');
            this._flowSub.text(`${(f * this.maxFlow).toFixed(1)} L/min`);
        } else if (f < 0.70) {
            this._flowText.text('中  流'); this._flowText.fill('#29b6f6');
            this._flowSub.text(`${(f * this.maxFlow).toFixed(1)} L/min`);
        } else {
            this._flowText.text('大  流'); this._flowText.fill('#0288d1');
            this._flowSub.text(`${(f * this.maxFlow).toFixed(1)} L/min`);
        }
    }

    // ── 十字把手（旋转组）────────────────────
    _buildHandleGroup() {
        const g   = this._geo;
        const cx  = g.handleCX, cy = g.handleCY;
        const R   = g.handleR;
        const aw  = g.handleArmW;

        this._handleGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: this._handleAngle,
        });

        // ── 四条臂（0°/90°/180°/270°方向）──
        for (let i = 0; i < 4; i++) {
            const armGroup = new Konva.Group({ rotation: i * 90 });

            // 臂主体（向上延伸）
            armGroup.add(new Konva.Rect({
                x: -aw/2, y: -R,
                width: aw, height: R * 0.85,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: aw, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#4a88c8', 0.18,'#5a9ad8', 0.45,'#7ab4e8',
                    0.68,'#5a9ad8', 0.88,'#3a78b8', 1,'#3060a0',
                ],
                stroke: '#2a5890', strokeWidth: 0.8,
                cornerRadius: [aw/2, aw/2, 0, 0],
            }));
            // 臂防滑纹（横线）
            for (let n = 0; n < 7; n++) {
                const ny = -R + aw*0.6 + n * (R * 0.72 / 7);
                armGroup.add(new Konva.Line({
                    points: [-aw*0.40, ny, aw*0.40, ny],
                    stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.8,
                }));
            }
            // 臂高光
            armGroup.add(new Konva.Line({
                points: [-aw*0.22, -R + aw*0.4, -aw*0.22, -R*0.18],
                stroke: 'rgba(255,255,255,0.38)', strokeWidth: 1, lineCap: 'round',
            }));
            // 臂端头圆
            armGroup.add(new Konva.Circle({
                x: 0, y: -R,
                radius: aw * 0.55,
                fillRadialGradientStartPoint: { x: -aw*0.15, y: -aw*0.15 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 0, y: 0 },
                fillRadialGradientEndRadius: aw*0.55,
                fillRadialGradientColorStops: [0,'#90c4e8', 0.5,'#5a9ad8', 1,'#2a6090'],
                stroke: '#2a5890', strokeWidth: 0.7,
            }));

            this._handleGroup.add(armGroup);
        }

        // ── 中心圆盘 ──
        // 圆盘阴影
        this._handleGroup.add(new Konva.Circle({
            radius: aw * 1.05,
            fill: 'rgba(0,0,0,0.25)', offsetY: -2,
        }));
        // 圆盘主体
        this._handleGroup.add(new Konva.Circle({
            radius: aw,
            fillRadialGradientStartPoint: { x: -aw*0.20, y: -aw*0.20 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: 0, y: 0 },
            fillRadialGradientEndRadius: aw,
            fillRadialGradientColorStops: [
                0,'#a0c8e8', 0.40,'#6090c0', 0.75,'#3a6090', 1,'#1e4060',
            ],
            stroke: '#1a3a58', strokeWidth: 1,
            shadowColor: '#000', shadowBlur: 5, shadowOpacity: 0.30,
        }));
        // 蓝色冷水标识点（中心小圆 + 雪花线）
        this._handleGroup.add(new Konva.Circle({
            radius: aw * 0.38,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.8,
        }));
        // 雪花/水滴图标（简化为 6 条短线）
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            this._handleGroup.add(new Konva.Line({
                points: [
                    Math.cos(a)*aw*0.12, Math.sin(a)*aw*0.12,
                    Math.cos(a)*aw*0.32, Math.sin(a)*aw*0.32,
                ],
                stroke: '#90caf9', strokeWidth: 1.2, lineCap: 'round',
            }));
        }
        // 中心白点
        this._handleGroup.add(new Konva.Circle({
            radius: aw * 0.10,
            fill: '#e3f2fd',
        }));
        // 圆盘外环高光
        this._handleGroup.add(new Konva.Arc({
            innerRadius: aw * 0.88, outerRadius: aw,
            angle: 120, rotation: -150,
            fill: 'rgba(255,255,255,0.14)',
        }));

        this.group.add(this._handleGroup);
    }

    // ── 粒子层 ────────────────────────────────
    _drawParticleLayer() {
        this._streamGroup = new Konva.Group();
        this.group.add(this._streamGroup);
    }

    // ── 铭牌与端子标注 ──────────────────────
    _drawPortLabels() {
        const g = this._geo;
        [
            { x: g.plateCX - 12, y: 2,                  t: 'IN',  c: '#90caf9' },
            { x: g.spoutTipX - 10, y: g.spoutTipY + 8,  t: 'OUT', c: '#80deea' },
        ].forEach(({ x, y, t, c }) => {
            this.group.add(new Konva.Text({
                x, y, text: t, fontSize: 7.5, fontStyle: 'bold', fill: c,
            }));
        });
    }

    _drawComponentLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  单冷水龙头  ${this.waterTemp}°C  最大 ${this.maxFlow} L/min`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // 拖拽交互
    _bindDrag() {
        const g  = this._geo;
        const cx = g.handleCX, cy = g.handleCY;

        this._handleGroup.on('mousedown touchstart', (e) => {
            const stage = this._handleGroup.getStage();
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;
            this._dragging        = true;
            this._dragStartMouseA = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI;
            this._dragStartRot    = this._totalRotation;
            e.cancelBubble = true;
        });

        const onMove = () => {
            if (!this._dragging) return;
            const stage = this._handleGroup.getStage?.();
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const curA  = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI;
            let delta   = curA - this._dragStartMouseA;
            if (delta >  180) delta -= 360;
            if (delta < -180) delta += 360;

            // 顺时针为增流（正方向）
            const newRot = Math.max(0, Math.min(360, this._dragStartRot + delta));
            this._targetRotation = newRot;
            // 拖拽时直接同步（不缓动）
            this._totalRotation  = newRot;
            this._handleAngle    = newRot;
            this._handleGroup.rotation(this._handleAngle);
            this._recalcFlow();
            this._updateRing();
            this._updateFlowLabel();
            this._refreshCache();
        };

        const onUp = () => { this._dragging = false; };

        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchend',  onUp);
        }

        // 双击快速全开/全关
        this._handleGroup.on('click tap', () => {
            const now = Date.now();
            if (now - this._lastClickTs < 300) {
                this._targetRotation = this._totalRotation < 180 ? 360 : 0;
                this._lastClickTs    = 0;
            } else {
                this._lastClickTs = now;
            }
        });

        this._handleGroup.listening(true);
    }

    // ── 流量计算 ─────────────────────────────
    _recalcFlow() {
        this._flow = this._totalRotation / 360;
    }

    // ═══════════════════════════════════════════
    // 水流渲染
    _renderStream(dt) {
        const g    = this._geo;
        const flow = this._flow;
        const W    = this.width, H = this.height;
        this._streamGroup.destroyChildren();
        if (flow < 0.005) {
            if (this._spoutHole) this._spoutHole.fill('#1a2030');
            return;
        }

        const sx = g.streamX, sy = g.streamY;
        const pw = g.spoutPipeW;
        const streamW = flow * pw * 0.62;
        const streamH = H * 0.96 - sy;

        // ── 主水柱（三层半透明）──
        [
            { wf: 0.35, alpha: 0.85 },
            { wf: 0.70, alpha: 0.55 },
            { wf: 1.00, alpha: 0.28 },
        ].forEach(({ wf, alpha }) => {
            const w  = streamW * wf;
            const ts = this._lastTs || 0;
            // 小流量时有轻微左右摆动
            const wobble = flow < 0.4
                ? Math.sin(ts * 0.004) * w * 0.18
                : Math.sin(ts * 0.003) * w * 0.06;

            this._streamGroup.add(new Konva.Path({
                data: [
                    `M ${sx - w/2 + wobble} ${sy}`,
                    `C ${sx - w/2 + wobble*1.3} ${sy + streamH*0.30}`,
                    `  ${sx - w/2 + wobble*0.8} ${sy + streamH*0.65}`,
                    `  ${sx - w/2 + wobble*0.4} ${sy + streamH}`,
                    `L ${sx + w/2 + wobble*0.4} ${sy + streamH}`,
                    `C ${sx + w/2 + wobble*0.8} ${sy + streamH*0.65}`,
                    `  ${sx + w/2 + wobble*1.3} ${sy + streamH*0.30}`,
                    `  ${sx + w/2 + wobble} ${sy}`,
                    'Z',
                ].join(' '),
                fill: `rgba(80,160,220,${alpha})`,
            }));
        });

        // 水柱高光线
        this._streamGroup.add(new Konva.Line({
            points: [sx - streamW*0.18, sy, sx - streamW*0.14, sy + streamH*0.82],
            stroke: 'rgba(200,240,255,0.60)',
            strokeWidth: streamW * 0.14,
            lineCap: 'round',
            opacity: Math.min(1, flow * 1.6),
        }));

        // 出水口光晕
        const glowA = 0.12 + flow * 0.18;
        this._streamGroup.add(new Konva.Ellipse({
            x: sx, y: sy - 1,
            radiusX: streamW * 1.9 + flow * pw * 0.30,
            radiusY: streamW * 0.52,
            fillRadialGradientStartPoint: { x:0, y:0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x:0, y:0 },
            fillRadialGradientEndRadius: streamW * 2.2,
            fillRadialGradientColorStops: [
                0, `rgba(80,160,220,${glowA})`,
                1, 'rgba(80,160,220,0)',
            ],
        }));

        // 出水口内孔随流量变色
        if (this._spoutHole) {
            const holeAlpha = 0.35 + flow * 0.45;
            this._spoutHole.fill(`rgba(30,80,160,${holeAlpha.toFixed(2)})`);
        }

        // ── 水滴粒子 ──
        const spawnN = Math.floor(flow * 12 * dt + Math.random() * flow * 7 * dt);
        for (let i = 0; i < spawnN; i++) {
            this._drops.push({
                x: sx + (Math.random()-0.5) * streamW * 0.75,
                y: sy + streamH + Math.random() * 3,
                vx: (Math.random()-0.5) * flow * 2.0,
                vy: flow * 1.0 + Math.random() * 1.5,
                r: 0.6 + Math.random() * (0.8 + flow * 1.6),
                life: 0.45 + Math.random() * 0.55,
                maxLife: 0.45 + Math.random() * 0.55,
            });
        }
        // 大流量侧向飞溅
        if (flow > 0.55 && Math.random() < flow * 0.30) {
            for (let i = 0; i < 2; i++) {
                const side = Math.random() < 0.5 ? -1 : 1;
                this._drops.push({
                    x: sx + side * streamW * 0.40, y: sy + streamH - 2,
                    vx: side * (1.0 + Math.random() * flow * 2.8),
                    vy: -(Math.random() * 1.2),
                    r: 0.5 + Math.random() * 0.9,
                    life: 0.30 + Math.random() * 0.25,
                    maxLife: 0.30 + Math.random() * 0.25,
                });
            }
        }

        this._drops = this._drops.filter(d => d.life > 0);
        this._drops.forEach(d => {
            d.x  += d.vx * dt * 60;
            d.y  += d.vy * dt * 60;
            d.vy += 0.08 * dt * 60;
            d.life -= dt;
            if (d.x < 0 || d.x > W || d.y > H) { d.life = 0; return; }
            const alpha = Math.min(0.80, (d.life / d.maxLife) * 0.85);
            this._streamGroup.add(new Konva.Circle({
                x: d.x, y: d.y, radius: d.r,
                fill: `rgba(80,160,220,${alpha.toFixed(2)})`,
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 主循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnim(ts, dt);
    }
    _tickAnim(ts, dt) {
        // 缓动（双击触发）
        if (!this._dragging && Math.abs(this._targetRotation - this._totalRotation) > 0.5) {
            this._totalRotation += (this._targetRotation - this._totalRotation) * Math.min(1, dt * 9);
            this._handleAngle    = this._totalRotation;
            this._handleGroup.rotation(this._handleAngle);
            this._recalcFlow();
        }

        this._updateRing();
        this._updateFlowLabel();
        this._renderStream(dt);
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    // 公开 API

    /** 设置旋转开度 0~360° */
    setRotation(deg) {
        this._targetRotation = Math.max(0, Math.min(360, deg));
    }

    /** 设置流量比例 0~1 */
    setFlow(ratio) { this.setRotation(ratio * 360); }

    /** 全开 */
    fullOpen()  { this._targetRotation = 360; }

    /** 全关 */
    fullClose() { this._targetRotation = 0; }

    getFlow()       { return this._flow; }
    getRotation()   { return this._totalRotation; }
    getFlowLMin()   { return this._flow * this.maxFlow; }
    getWaterTemp()  { return this.waterTemp; }

    update(state) {
        if (typeof state === 'number')  this.setFlow(state);
        if (typeof state === 'boolean') state ? this.fullOpen() : this.fullClose();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',        type: 'text'   },
            { label: '最大流量 (L/min)',     key: 'maxFlow',      type: 'number' },
            { label: '冷水温度 (°C)',        key: 'waterTemp',    type: 'number' },
            { label: '初始旋转开度 (0~360)', key: 'initRotation', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)      this.label     = cfg.label;
        if (cfg.maxFlow)    this.maxFlow   = parseFloat(cfg.maxFlow);
        if (cfg.waterTemp)  this.waterTemp = parseFloat(cfg.waterTemp);
        if (cfg.initRotation !== undefined) this.setRotation(parseFloat(cfg.initRotation));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}