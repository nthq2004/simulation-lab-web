import { PC } from './PC.js';
import { Step7UI } from '../lib/Step7UI.js';

/**
 * STEP7PC — 装有 STEP 7-Micro/WIN SMART 的上位机（编程计算机）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  外观与 `PC.js` 完全一致（直接继承 PC，复用其显示器/主机/网口绘制与以太网口）。
 *  区别：
 *    - 双击（或右键「打开 STEP7 编程软件」）打开 STEP 7 覆盖层界面
 *    - 作为网络主机参与组网（type='pc'），可从其网口出发发现 PLC
 */
export class STEP7PC extends PC {
    constructor(config, sys) {
        super(config, sys);
        this.special = 'step7_pc';
        this.label = config.label || '上位机 (STEP7)';
        this._step7UI = null;
        if (this._hostText) this._hostText.text(this.hostname);
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _initParameters(config) {
        super._initParameters(config);
        // 上位机默认主机名/IP（可通过右键「参数设置」修改）
        this.hostname = config.hostname || 'STEP7-PC';
        if (!this.ip) { this.ip = '192.168.0.2'; this.mask = this.mask || '255.255.255.0'; }
    }

    /** 覆盖 PC 的双击：打开 STEP7 编程界面（而非 TCP/IP 配置） */
    _bindInteraction() {
        this.group.on('dblclick dbltap', (e) => {
            e.cancelBubble = true;
            this.openStep7();
        });
    }

    openStep7() {
        if (!this._step7UI) this._step7UI = new Step7UI(this.sys, this);
        this._step7UI.open();
    }

    getContextMenuItems() {
        return [
            { label: '打开 STEP7 编程软件', onClick: () => this.openStep7() },
        ];
    }

    destroy() {
        if (this._step7UI) { this._step7UI.destroy(); this._step7UI = null; }
        super.destroy?.();
    }
}

export default STEP7PC;
