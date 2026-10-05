/**
 * utils.js — pageBuilders 共享辅助函数
 */

import { C } from './constants.js';

/**
 * 判断模块是否真正可用（既不离线也没有超时）
 * @param {Object} cc - 中央计算机实例
 * @param {string} moduleId - 模块ID ('ai', 'ao', 'di', 'do')
 * @returns {boolean} true 表示模块在线且无超时
 */
export function isModuleAvailable(cc, moduleId) {
    const bus = cc.sys?.canBus;
    const isOnline = bus ? bus.isNodeOnline(moduleId) : false;

    // 检查该模块的所有通道是否有 hold 标志（超时标记）
    const dataKey = moduleId === 'ai' ? 'ai' : moduleId === 'ao' ? 'ao' : moduleId === 'di' ? 'di' : 'do';
    const moduleData = cc.data?.[dataKey];

    if (!moduleData) return isOnline;

    // 如果任何通道被标记为 hold（超时），则认为模块不可用
    const hasTimeout = Object.values(moduleData).some(ch => ch?.hold === true);

    return isOnline && !hasTimeout;
}

/**
 * 内部辅助：根据模式更新 DO 行按钮外观
 */
export function applyDoModeUI(modeBtn, forceBtn, pulseBtn, mode, doMod, chId) {
    const MODE_LABELS = { hand: '手  动', auto: '自  动', pulse: '脉冲模式', disable: '禁  用' };
    const MODE_COLORS = { hand: C.yellow, auto: C.green, pulse: C.cyan, disable: C.textDim };
    const mc = MODE_COLORS[mode] || C.textDim;

    // 直接访问 Group 的子元素
    let children = modeBtn.getChildren();
    if (children && children.length >= 2) {
        children[0].fill(mc + '33');
        children[0].stroke(mc);
        children[1].text(MODE_LABELS[mode] || mode);
        children[1].fill(mc);
    }

    const isHand  = mode === 'hand';
    const isPulse = mode === 'pulse';
    forceBtn.opacity(isHand  ? 1 : 0.35);
    pulseBtn.opacity(isPulse ? 1 : 0.35);

    if (isPulse && doMod?.pulseConfig?.[chId]) {
        const pc = doMod.pulseConfig[chId];
        const phMs = pc.phaseStart;
        children = pulseBtn.getChildren();
        if (children && children.length >= 2) {
            children[1].text(`${pc.onMs}  ${pc.offMs}  ${phMs}`);
        }
    }
}

/**
 * uiHelpers.js — UI 辅助工厂函数
 * 提供创建标准按钮、开关等 Konva 控件的工厂方法
 */

/**
 * 创建标准按钮
 * @param {Konva.Group} parent  父容器
 * @param {string}      txt     按钮文字
 * @param {number}      x       左上角 X 坐标
 * @param {number}      y       左上角 Y 坐标
 * @param {string}      color   主题颜色（用于边框和文字）
 * @returns {Konva.Group}
 */
export function mkBtn(parent, txt, x, y, color) {
    const g = new Konva.Group({ x, y, cursor: 'pointer' });
    const w = txt.length * 7 + 16;
    g.add(new Konva.Rect({
        width: w, height: 22,
        fill: color + '22', stroke: color, strokeWidth: 1, cornerRadius: 3,
    }));
    g.add(new Konva.Text({
        width: w, height: 22, text: txt,
        align: 'center', verticalAlign: 'middle',
        fontSize: 9, fontFamily: 'Courier New', fill: color, fontStyle: 'bold',
    }));
    parent.add(g);
    return g;
}

/**
 * 创建带激活态的切换按钮
 * @param {Konva.Group} parent
 * @param {string}      txt
 * @param {number}      x
 * @param {number}      y
 * @param {number}      w       宽度
 * @param {number}      h       高度
 * @param {boolean}     active  初始是否激活
 * @param {string}      color
 * @returns {Konva.Group}
 */
export function mkToggle(parent, txt, x, y, w, h, active, color) {
    const g = new Konva.Group({ x, y, cursor: 'pointer' });
    g.add(new Konva.Rect({
        width: w, height: h,
        fill: active ? color + '33' : color + '22',
        stroke: color, strokeWidth: 1, cornerRadius: 3,
    }));
    g.add(new Konva.Text({
        width: w, height: h, text: txt,
        align: 'center', verticalAlign: 'middle',
        fontSize: 9, fontFamily: 'Courier New', fill: color, fontStyle: 'bold',
    }));
    parent.add(g);
    return g;
}