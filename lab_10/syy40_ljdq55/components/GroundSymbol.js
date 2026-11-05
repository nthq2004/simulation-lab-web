import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * GroundSymbol — 接地符号（保护接地 PE）
 *
 * 画法：一根引下线 + 三级递减横线（44 / 30 / 16），右侧标注 PE。
 * 顶部有一个 wire 端子口，可从 PLC / 设备引线接过来（例如 CPU 的 0V、机柜 PE 排）。
 * 纯静态图形，`cache='fixed'`。
 */
export class GroundSymbol extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(44, config.width || 64);
        this.H = Math.max(44, config.height || 64);
        this.type = 'ground';
        this.special = 'ground';
        this.cache = 'fixed';

        this._initGroups();
        this._draw();
        this._registerPorts();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _draw() {
        const g = this._staticGroup;
        const cx = this.W / 2;
        const top = 4;
        const bar1 = 34;

        // 引下线
        g.add(new Konva.Line({ points: [cx, top, cx, bar1], stroke: '#2f7d32', strokeWidth: 3, lineCap: 'round' }));
        // 三级接地横线
        const bars = [[44, 0], [30, 9], [16, 18]];
        bars.forEach(([w, dy]) => {
            g.add(new Konva.Line({
                points: [cx - w / 2, bar1 + dy, cx + w / 2, bar1 + dy],
                stroke: '#2f7d32', strokeWidth: 4, lineCap: 'round',
            }));
        });
        // 标注
        g.add(new Konva.Text({
            x: cx + 26, y: bar1 - 8, text: 'PE', fontSize: 12, fill: '#2f7d32',
            fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        }));
    }

    _registerPorts() {
        this.addPort(this.W / 2, 4, 'pe', 'wire');
    }
}

export default GroundSymbol;
