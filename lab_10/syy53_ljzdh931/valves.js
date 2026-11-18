const fs = require('fs');
const p = 'components/CoolingWaterMimic.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b, all = false) => {
    if (!s.includes(a)) throw new Error('NOT FOUND >>> ' + a.slice(0, 80));
    s = all ? s.split(a).join(b) : s.replace(a, b);
};

// ① 统一尺寸常量 + triPts（放在颜色常量之后）
rep("const ON_COLOR = '#2ecc40';",
`const ON_COLOR = '#2ecc40';

/** 阀门三角形统一尺寸（截止阀 / 单向阀 / 三通阀共用） */
const TRI_A = 13.5, TRI_B = 9.5;

/** 顶点在阀芯中心 (cx,cy)、基边距中心 a、指向角度 ang 的三角形（Konva 屏幕坐标，y 向下） */
function triPts(cx, cy, ang, a = TRI_A, b = TRI_B) {
    const r = ang * Math.PI / 180;
    const ux = Math.cos(r), uy = Math.sin(r);
    const px = -uy, py = ux;
    const bx = cx + ux * a, by = cy + uy * a;
    return [bx + px * b, by + py * b, bx - px * b, by - py * b, cx, cy];
}`);

// ② 截止阀阀体：两三角顶点相交于阀芯，按轴向角度摆放
rep(`    /** 截止阀（两个对顶三角形）：水平管 vert=false，竖管 vert=true */
    _valve(g, cx, cy, vert = false, W = 8, A = 11) {
        const mk = (pts) => {
            const n = new Konva.Line({
                points: pts, closed: true, fill: '#ffffff', stroke: '#555555', strokeWidth: 1.6, lineJoin: 'round',
            });
            g.add(n);
            return n;
        };
        if (!vert) {
            return {
                a: mk([cx - A, cy - W, cx - A, cy + W, cx, cy]),
                b: mk([cx + A, cy - W, cx + A, cy + W, cx, cy]),
            };
        }
        return {
            a: mk([cx - W, cy - A, cx + W, cy - A, cx, cy]),
            b: mk([cx - W, cy + A, cx + W, cy + A, cx, cy]),
        };
    }`,
`    /**
     * 截止阀阀体：两个三角形顶点相交于阀芯
     * @param {number} angAxis 阀体轴向角度：180 = 横管、270 = 竖管
     */
    _valve(g, cx, cy, angAxis = 180) {
        const mk = (ang) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, ang), closed: true,
                fill: '#ffffff', stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
            });
            g.add(n);
            return n;
        };
        return { a: mk(angAxis), b: mk(angAxis + 180) };
    }`);

// ③ 手动截止阀（带手轮）
rep(`    /** 手动截止阀（竖管，手柄朝左） */
    _handValveLeft(g, cx, cy) {
        const v = this._valve(g, cx, cy, true);
        g.add(new Konva.Line({ points: [cx - 8, cy, cx - 22, cy], stroke: '#555555', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx - 27, y: cy, radius: 6, fill: '#f0f0f0', stroke: '#555555', strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [cx - 27, cy - 6, cx - 27, cy + 6], stroke: '#555555', strokeWidth: 1.4 }));
        return v;
    }`,
`    /**
     * 手动截止阀（阀体 + 阀杆 + 手轮）
     * @param {number} angAxis   阀体轴向：180 横管 / 270 竖管
     * @param {number} angHandle 手轮方向，默认 angAxis + 90（竖管时朝右；朝左用 180）
     */
    _handValve(g, cx, cy, angAxis = 270, angHandle = angAxis + 90) {
        const v = this._valve(g, cx, cy, angAxis);
        const r = angHandle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
        const ex = cx + ux * (TRI_B + 9), ey = cy + uy * (TRI_B + 9);
        g.add(new Konva.Line({ points: [cx, cy, ex, ey], stroke: '#333333', strokeWidth: 1.8 }));
        const px = -uy, py = ux;
        g.add(new Konva.Line({
            points: [ex + px * 6, ey + py * 6, ex - px * 6, ey - py * 6],
            stroke: '#333333', strokeWidth: 2.2,
        }));
        return v;
    }

    /** 造水机进口手动截止阀：竖管、手轮朝左 */
    _handValveLeft(g, cx, cy) {
        return this._handValve(g, cx, cy, 270, 180);
    }`);

// ④ 单向阀：两顶点相对的三角形（进侧可着色、出侧恒灰）
rep(`    /** 单向阀（箭头指向流动方向 + 阀座）：vert=true 表示向下流通 */
    _checkValve(g, cx, cy, vert = false) {
        if (!vert) {
            // 水平，向右流通
            g.add(new Konva.Line({ points: [cx - 8, cy - 9, cx - 8, cy + 9, cx + 9, cy], closed: true, fill: '#d9d9d9', stroke: '#555555', strokeWidth: 1.5 }));
            g.add(new Konva.Line({ points: [cx + 9, cy - 9, cx + 9, cy + 9], stroke: '#555555', strokeWidth: 2.2 }));
        } else {
            // 竖直，由上向下流通
            g.add(new Konva.Line({ points: [cx - 9, cy - 8, cx + 9, cy - 8, cx, cy + 9], closed: true, fill: '#d9d9d9', stroke: '#555555', strokeWidth: 1.5 }));
            g.add(new Konva.Line({ points: [cx - 9, cy + 9, cx + 9, cy + 9], stroke: '#555555', strokeWidth: 2.2 }));
        }
    }`,
`    /**
     * 单向阀（两个顶点相对的三角形）：进侧三角流通时变绿，出侧恒灰
     * @param {number} angFlow 流向角度：0 向右、90 向下、180 向左、270 向上
     */
    _checkValve(g, cx, cy, angFlow = 0) {
        const mk = (ang, fill) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, ang), closed: true, fill,
                stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
            });
            g.add(n);
            return n;
        };
        return { in: mk(angFlow + 180, '#ffffff'), out: mk(angFlow, '#b0b6bb'), ang: angFlow };
    }`);

// ⑤ 调用点：竖管用 270 / 横管用 180
rep("        V.v4 = this._valve(g, G.v4.cx, G.v4.cy, true);", "        V.v4 = this._valve(g, G.v4.cx, G.v4.cy, 270);");
rep("        V.v6s = this._handValveLeft(g, G.v6s.cx, G.v6s.cy);", "        V.v6s = this._handValveLeft(g, G.v6s.cx, G.v6s.cy);");
rep("        V.v15s = this._valve(g, G.v15s.cx, G.v15s.cy, true);", "        V.v15s = this._valve(g, G.v15s.cx, G.v15s.cy, 270);");
rep("        V.v26s = this._valve(g, G.v26s.cx, G.v26s.cy, true);", "        V.v26s = this._valve(g, G.v26s.cx, G.v26s.cy, 270);");
rep("        V.v13s = this._valve(g, G.v13s.cx, G.v13s.cy);", "        V.v13s = this._valve(g, G.v13s.cx, G.v13s.cy, 180);");
rep("        V.v5 = this._valve(g, G.v5.cx, G.v5.cy);", "        V.v5 = this._valve(g, G.v5.cx, G.v5.cy, 180);");
rep("        V.v8 = this._valve(g, G.v8.cx, G.v8.cy);", "        V.v8 = this._valve(g, G.v8.cx, G.v8.cy, 180);");
rep("        V.v9 = this._valve(g, G.v9.cx, G.v9.cy);", "        V.v9 = this._valve(g, G.v9.cx, G.v9.cy, 180);");
rep("        V.v27s = this._valve(g, G.v27s.cx, G.v27s.cy);", "        V.v27s = this._valve(g, G.v27s.cx, G.v27s.cy, 180);");
rep("        V.v25s = this._valve(g, G.v25s.cx, G.v25s.cy);", "        V.v25s = this._valve(g, G.v25s.cx, G.v25s.cy, 180);");

// ⑥ 单向阀绘制：主管（向右）、两台泵出口（向右）、造水机出口（向下）
rep(`        this._checkValve(g, G.v28s.cx, G.v28s.cy);
        this._checkValve(g, G.ck1.cx, G.ck1.cy);
        this._checkValve(g, G.ck2.cx, G.ck2.cy);
        this._checkValve(g, G.v7s.cx, G.v7s.cy, true);`,
`        this._checks = {
            v28s: this._checkValve(g, G.v28s.cx, G.v28s.cy, 0),
            ck1: this._checkValve(g, G.ck1.cx, G.ck1.cy, 0),
            ck2: this._checkValve(g, G.ck2.cx, G.ck2.cy, 0),
            v7s: this._checkValve(g, G.v7s.cx, G.v7s.cy, 90),
        };`);

// ⑦ 单向阀进侧着色（放在 distOn 之后）
rep("        const distOn = running && m.sw.wbV6S && m.sw.wbV7S;",
`        const distOn = running && m.sw.wbV6S && m.sw.wbV7S;

        // —— 单向阀：进侧三角流通变绿，出侧恒灰 ——
        const CK = this._checks || {};
        if (CK.v28s) CK.v28s.in.fill((m.psUp || running) ? ON_COLOR : '#ffffff');
        if (CK.ck1) CK.ck1.in.fill(m.pumps.cw1.run ? ON_COLOR : '#ffffff');
        if (CK.ck2) CK.ck2.in.fill(m.pumps.cw2.run ? ON_COLOR : '#ffffff');
        if (CK.v7s) CK.v7s.in.fill(distOn ? ON_COLOR : '#ffffff');`);

fs.writeFileSync(p, s);
console.log('valve symbols updated');
