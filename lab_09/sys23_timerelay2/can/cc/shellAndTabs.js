/**
 * shellAndTabs.js — 外壳、标签栏、页面容器的构建与切换逻辑
 */

import { W, H, TAB_H, BODY_Y, BODY_H, TABS, C } from './constants.js';

/**
 * 绘制主机外壳：外框、顶部色条、品牌标题、时钟、屏幕底框、底部状态栏
 * @param {CentralComputer} cc  主类实例
 */
export function drawShell(cc) {
    const sg = cc.sg;

    // 主体外框
    sg.add(new Konva.Rect({
        width: W, height: H + 30,
        fill: '#ccdceb', stroke: '#30363d', strokeWidth: 3, cornerRadius: 6,
    }));

    // 顶部色条
    sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#269d2a', cornerRadius: [6, 6, 0, 0] }));

    // 品牌 & 时钟
    sg.add(new Konva.Text({
        x: 10, y: 10, text: '总线式船舶机舱监测报警系统',
        fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue, align: 'center',
    }));

    cc._clockText = new Konva.Text({
        x: W - 115, y: 10, width: 105, text: '--:--:--',
        fontSize: 16, fontFamily: 'Courier New', fill: C.blue, align: 'right',
    });
    sg.add(cc._clockText);

    // 屏幕底框
    sg.add(new Konva.Rect({
        x: 4, y: TAB_H - 2, width: W - 8, height: BODY_H + 8,
        fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 3,
    }));

    // 底部状态栏
    const barY = H + 4;
    sg.add(new Konva.Rect({ x: 0, y: barY, width: W, height: 26, fill: '#0d1117', stroke: C.border, strokeWidth: 1 }));
    cc._statusText      = new Konva.Text({ x: 10,  y: barY + 8, text: '● CAN BUS ONLINE', fontSize: 11, fontFamily: 'Courier New', fill: C.green });
    cc._alarmCountText  = new Konva.Text({ x: 200, y: barY + 8, text: '报警: 无',          fontSize: 11, fontFamily: 'Courier New', fill: C.green });
    cc._nodeText        = new Konva.Text({ x: 360, y: barY + 8, text: 'NODE: ------',      fontSize: 11, fontFamily: 'Courier New', fill: C.green });
    sg.add(cc._statusText, cc._alarmCountText, cc._nodeText);
}

/**
 * 绘制标签栏并绑定切换事件
 * @param {CentralComputer} cc
 */
export function drawTabs(cc) {
    cc._tabs = [];
    const tabW = (W - 8) / TABS.length;

    TABS.forEach((label, i) => {
        const x = 4 + i * tabW;
        const bg  = new Konva.Rect({ x, y: 30, width: tabW - 1, height: 22, fill: C.tab, stroke: C.border, strokeWidth: 1, cornerRadius: [3, 3, 0, 0] });
        const txt = new Konva.Text({ x, y: 30, width: tabW - 1, height: 22, text: label, align: 'center', verticalAlign: 'middle', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const ind = new Konva.Rect({ x: x + 3, y: 50, width: tabW - 7, height: 2, fill: 'transparent', cornerRadius: 1 });

        bg.on('click tap',  () => switchPage(cc, i));
        txt.on('click tap', () => switchPage(cc, i));

        cc.sg.add(bg, txt, ind);
        cc._tabs.push({ bg, txt, ind });
    });

    refreshTabs(cc);
}

/**
 * 刷新标签栏高亮状态
 * @param {CentralComputer} cc
 */
export function refreshTabs(cc) {
    cc._tabs.forEach((t, i) => {
        const a = i === cc.activePage;
        t.bg.fill(a ? C.bg   : C.tab);
        t.txt.fill(a ? C.blue : C.textDim);
        t.txt.fontStyle(a ? 'bold'  : 'normal');
        t.txt.fontSize(a  ? 13     : 12);
        t.ind.fill(a ? C.blue : 'transparent');
    });
}

/**
 * 切换到指定页面索引
 * @param {CentralComputer} cc
 * @param {number}          idx
 */
export function switchPage(cc, idx) {
    cc.activePage = idx;
    cc._pages.forEach((p, i) => p.visible(i === idx));
    refreshTabs(cc);
    cc._refreshCache();
}

/**
 * 创建所有页面的 Konva.Group 容器（空容器，由各页面构建函数填充）
 * @param {CentralComputer} cc
 */
export function buildPageContainers(cc) {
    cc._pages = [];
    for (let i = 0; i < TABS.length; i++) {
        const g = new Konva.Group({ x: 4, y: BODY_Y, visible: i === cc.activePage });
        cc.sg.add(g);
        cc._pages.push(g);
    }
}