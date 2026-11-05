import { PC } from './PC.js';
import { KeilUI } from '../lib/KeilUI.js';

/**
 * MCS51PC — 装有 Keil µVision（C51）的编程上位机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  外观与 `PC.js` 完全一致（继承 PC，复用其显示器/主机绘制与以太网口）。
 *  区别：
 *    - 双击（或右键「打开 Keil C51 编程器」）打开 8051 集成开发环境浮窗
 *    - 通过内置 C 子集编译器把 C 源程序编译并下载到画布上的 8051 组件
 */
export class MCS51PC extends PC {
    constructor(config, sys) {
        super(config, sys);
        this.special = 'mcs51_pc';
        this.label = config.label || '上位机 (Keil C51)';
        this._keilUI = null;
        if (this._hostText) this._hostText.text(this.hostname);
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _initParameters(config) {
        super._initParameters(config);
        this.hostname = config.hostname || 'MCU-PC';
        if (!this.ip) { this.ip = '192.168.0.3'; this.mask = this.mask || '255.255.255.0'; }
    }

    /** 覆盖 PC 的双击：打开 Keil C51 编程界面 */
    _bindInteraction() {
        this.group.on('dblclick dbltap', (e) => {
            e.cancelBubble = true;
            this.openKeil();
        });
    }

    openKeil() {
        if (!this._keilUI) this._keilUI = new KeilUI(this.sys, this);
        this._keilUI.open();
    }

    getContextMenuItems() {
        return [
            { label: '打开 Keil C51 编程器', onClick: () => this.openKeil() },
        ];
    }

    destroy() {
        if (this._keilUI) { this._keilUI.destroy(); this._keilUI = null; }
        super.destroy?.();
    }
}

export default MCS51PC;
