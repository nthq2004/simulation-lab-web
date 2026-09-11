/**
 * paramPage.js — 参数显示页面构建（4块：AI/AO/DI/DO）
 */

import { W, BODY_H, C } from './constants.js';

export function buildParamPage(cc) {
    const pg = cc._pages[1];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));

    const bw = Math.floor((pw - 12) / 2);
    const bh = Math.floor((ph - 12) / 2);
    const blocks = [
        { key: 'ai', title: 'AI  模拟量输入', x: 4, y: 4, color: C.blue },
        { key: 'ao', title: 'AO  模拟量输出', x: 4 + bw + 4, y: 4, color: C.orange },
        { key: 'di', title: 'DI  数字量输入', x: 4, y: 4 + bh + 4, color: C.green },
        { key: 'do_', title: 'DO  数字量输出', x: 4 + bw + 4, y: 4 + bh + 4, color: C.purple },
    ];

    cc._paramDisplays = {};
    blocks.forEach(b => {
        const g = new Konva.Group({ x: b.x, y: b.y });
        pg.add(g);
        //整个外框
        g.add(new Konva.Rect({ width: bw, height: bh, fill: C.bg, stroke: b.color + '55', strokeWidth: 1, cornerRadius: 3 }));
        //标题栏矩形
        g.add(new Konva.Rect({ width: bw, height: 18, fill: b.color + '18', cornerRadius: [3, 3, 0, 0] }));
        g.add(new Konva.Text({ x: 6, y: 5, text: b.title, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: b.color }));

        const rows = [];
        const chLabels = {
            ai: ['CH1 4-20mA', 'CH2 4-20mA', 'CH3 RTD  ', 'CH4 TC   '],
            ao: ['CH1 4-20mA', 'CH2 4-20mA', 'CH3 PWM  ', 'CH4 PWM  '],
            di: ['CH1 干接点 ', 'CH2 干接点 ', 'CH3 湿接点', 'CH4 湿接点'],
            do_: ['CH1 继电器 ', 'CH2 继电器 ', 'CH3 24VPNP', 'CH4 24VPNP'],
        };
        // b.key就是 'ai','ao','di','do_'这4个。
        const lbls = chLabels[b.key];
        const rowH = Math.floor((bh - 22) / 4);

        for (let i = 0; i < 4; i++) {
            // 每一行，x坐标相同，改变y坐标
            const ry = 26 + i * rowH;
            // 索引就是最前面的标题文字
            g.add(new Konva.Text({ x: 6, y: ry + 4, text: lbls[i], fontSize: 14, fontFamily: 'Courier New', fill: C.textDim }));
            // 这是显示工程值、或故障的文本。
            const val = new Konva.Text({ x: bw - 90, y: ry + 4, width: 82, text: '---', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text, align: 'right' });
            // 这是进度条，需要修改的地方。
            const bar = new Konva.Rect({ x: 6, y: ry + 20, width: 0, height: 3, fill: b.color + 'aa' });
            g.add(val, bar);
            rows.push({ val, bar, maxBarW: bw - 14 });
        }
        cc._paramDisplays[b.key] = rows;
    });
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderParamPage(cc) {
    const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
    const bus = cc.sys?.canBus;
    const aiOnline = bus ? bus.isNodeOnline('ai') : false;

    // AI
    chKeys.forEach((id, i) => {
        const d = cc.data.ai[id]; if (!d) return;
        const r = cc._paramDisplays.ai[i];

        const isTimeout = d.hold === true;
        const isAvailable = aiOnline && !isTimeout;

        if (!isAvailable) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }

        const c = d.fault ? C.red : (d.alarm !== 'normal' ? C.yellow : C.green);
        r.val.text(d.fault ? `${d.faultText}` : `${d.value.toFixed(2)} ${d.unit}`);
        r.val.fill(c);
        if (d.fault) {
            r.bar.width(0);
        } else {
            const rng = d.ranges || {};
            const urv = (typeof rng.urv === 'number') ? rng.urv : 100;
            const lrv = (typeof rng.lrv === 'number') ? rng.lrv : 0;
            const span = urv - lrv;
            let frac;
            if (span === 0) {
                frac = Math.min(1, Math.max(0, (d.value || 0) / 100));
            } else {
                frac = Math.min(1, Math.max(0, ((d.value || 0) - lrv) / span));
            }
            r.bar.width(Math.round(frac * r.maxBarW));
        }
    });

    // AO
    const aoOnline = bus ? bus.isNodeOnline('ao') : false;
    chKeys.forEach((id, i) => {
        const d = cc.data.ao[id]; if (!d) return;
        const r = cc._paramDisplays.ao[i];

        if (!aoOnline) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }

        r.val.text(d.fault ? 'FAULT' : `${(d.percent ?? 0).toFixed(1)}%`);
        r.val.fill(d.fault ? C.red : (d.percent > 0 ? C.orange : C.textDim));
        r.bar.width(Math.round((d.percent ?? 0) / 100 * r.maxBarW));
    });

    // DI
    const diOnline = bus ? bus.isNodeOnline('di') : false;
    chKeys.forEach((id, i) => {
        const d = cc.data.di[id]; if (!d) return;
        const r = cc._paramDisplays.di[i];

        if (!diOnline) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }

        r.val.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
        r.val.fill(d.fault ? C.red : (d.state ? C.green : C.textDim));
        r.bar.width(d.state ? r.maxBarW : 0);
    });

    // DO
    const doOnline = bus ? bus.isNodeOnline('do') : false;
    chKeys.forEach((id, i) => {
        const d = cc.data.do[id]; if (!d) return;
        const r = cc._paramDisplays['do_'][i];

        if (!doOnline) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }

        r.val.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
        r.val.fill(d.fault ? C.red : (d.state ? C.purple : C.textDim));
        r.bar.width(d.state ? r.maxBarW : 0);
    });
}
