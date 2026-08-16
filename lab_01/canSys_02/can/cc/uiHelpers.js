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