/**
 * MCU.js — 微型控制器组件
 *
 * 一个简化的单片机仿真组件，具有：
 *   - 4 个 GPIO 引脚（通过数字信号线）
 *   - 2 个 ADC 输入通道
 *   - 1 个 PWM 输出
 *   - 固件代码编辑器（通过右键菜单 → 编辑固件）
 *   - 运行/暂停/重置控制
 *
 * 固件由 MicrocontrollerSolver 解释执行。
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { signalBridge } from '../tools/SignalBridge.js';

export class MCU extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_mcu';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 80 * s;
        const H = 90 * s;

        // ── 状态 ──
        this.powerOn = config.powerOn !== undefined ? config.powerOn : true;
        this.firmware = config.firmware || this._defaultFirmware();
        this.pc = 0;
        this.regs = {};
        this.flags = { z: 0, c: 0 };
        this.state = 'running';
        this.digitalOut = 0;

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#2c3e50',
            stroke: '#95a5a6',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s,
        });
        this.group.add(body);

        // ── 内部区域 ──
        const inner = new Konva.Rect({
            x: -W / 2 + 4 * s, y: -H / 2 + 4 * s,
            width: W - 8 * s, height: H - 8 * s,
            fill: '#34495e',
            cornerRadius: 2 * s,
        });
        this.group.add(inner);

        // ── 标签 ──
        const label = new Konva.Text({
            text: 'MCU',
            x: -W / 2 + 10 * s, y: -H / 2 + 8 * s,
            fontSize: 16 * s, fontFamily: 'Courier New',
            fill: '#ecf0f1', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 状态指示 ──
        this._stateLED = new Konva.Circle({
            x: W / 2 - 12 * s, y: -H / 2 + 12 * s,
            radius: 5 * s, fill: '#2ecc71',
            stroke: '#fff', strokeWidth: 1 * s,
        });
        this.group.add(this._stateLED);

        // ── PC 显示 ──
        this._pcText = new Konva.Text({
            text: 'PC: 0',
            x: -W / 2 + 10 * s, y: -H / 2 + 30 * s,
            fontSize: 9 * s, fontFamily: 'Courier New',
            fill: '#bdc3c7',
        });
        this.group.add(this._pcText);

        // ── GPIO 引脚标签 ──
        const gpioLabels = ['GP0', 'GP1', 'GP2', 'GP3'];
        for (let i = 0; i < 4; i++) {
            const t = new Konva.Text({
                text: gpioLabels[i],
                x: -W / 2 - 22 * s, y: (-15 + i * 12) * s,
                fontSize: 8 * s, fontFamily: 'Arial',
                fill: '#ecf0f1',
            });
            this.group.add(t);
        }

        // ── 端口 ──
        // GPIO 端口（左侧，数字信号线）
        for (let i = 0; i < 4; i++) {
            const portY = (-15 + i * 12) * s;
            // 创建 wire 端口但使用数字信号线连接
            this.addPort(-W / 2 - 10 * s, portY, `gpio${i}`, 'wire', 'n');
            const lineId = `${this.id}_gpio_gp${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_gpio_gp${i}`);
        }

        // ── ADC 输入（右侧，wire 端口） ──
        for (let i = 0; i < 2; i++) {
            const portY = (-10 + i * 20) * s;
            this.addPort(W / 2 + 10 * s, portY, `adc${i}`, 'wire', 'p');
            signalBridge.registerADC(`${this.id}_adc_ch${i}`, 10, 5.0);
        }

        // ── ADC 标签 ──
        const adcLabel = new Konva.Text({
            text: 'ADC',
            x: W / 2 + 8 * s, y: -22 * s,
            fontSize: 8 * s, fontFamily: 'Arial',
            fill: '#ecf0f1',
        });
        this.group.add(adcLabel);

        // ── 状态文字 ──
        this._stateText = new Konva.Text({
            text: 'RUN',
            x: -W / 2 + 10 * s, y: H / 2 - 16 * s,
            fontSize: 10 * s, fontFamily: 'Courier New',
            fill: '#2ecc71', fontStyle: 'bold',
        });
        this.group.add(this._stateText);
    }

    _defaultFirmware() {
        return `// MCU 固件示例 - 循环读取 GPIO0 并输出到 GPIO1
// 若 GPIO0 为高，GPIO1 输出高；否则 GPIO1 输出低
// 同时读取 ADC0，存入变量 val
START:
    READ GP0, val
    CMP  val, 1
    JZ   SET_LOW
    SET  GP1, 1
    JMP  READ_ADC
SET_LOW:
    SET  GP1, 0
READ_ADC:
    ADC  0, adcVal
    MOV  result, adcVal
    DELAY 100
    JMP  START`;
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
        ];
    }

    /**
     * 右键菜单增强：添加编辑固件和重置功能
     */
    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
            position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
            background: white; border: 1px solid #ccc; border-radius: 4px;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
            padding: 5px 0; min-width: 150px; font-family: sans-serif; font-size: 14px;
        `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
        };

        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));
        menu.appendChild(createItem('编辑固件', () => this._editFirmware()));
        menu.appendChild(createItem('重置 MCU', () => this._resetMCU()));

        this.sys.container.appendChild(menu);

        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    /**
     * 弹出固件编辑器
     */
    _editFirmware() {
        const modal = document.createElement('div');
        modal.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); display: flex; align-items: center;
            justify-content: center; z-index: 9999;
        `;

        const editor = document.createElement('div');
        editor.style = `
            background: #1e1e1e; padding: 20px; border-radius: 8px;
            width: 600px; max-height: 80vh; display: flex; flex-direction: column;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;

        const header = document.createElement('div');
        header.style = 'color: #fff; font-family: sans-serif; margin-bottom: 10px;';
        header.innerHTML = `<strong>固件编辑器 — ${this.id}</strong>
            <span style="font-size:12px;color:#888;margin-left:10px;">支持: SET, READ, ADC, PWM, DELAY, CMP, MOV, ADD, SUB, JMP, JZ, JNZ, NOP, HALT</span>`;

        const textarea = document.createElement('textarea');
        textarea.value = this.firmware;
        textarea.style = `
            flex: 1; min-height: 300px; background: #252526; color: #d4d4d4;
            border: 1px solid #3c3c3c; border-radius: 4px; padding: 12px;
            font-family: 'Courier New', monospace; font-size: 13px;
            line-height: 1.5; resize: vertical; outline: none;
        `;
        textarea.spellcheck = false;

        // 按钮区域
        const btnRow = document.createElement('div');
        btnRow.style = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = '取消';
        cancelBtn.style = 'padding: 8px 20px; cursor: pointer; border: none; background: #555; color: #fff; border-radius: 4px;';

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '保存并重新加载';
        saveBtn.style = 'padding: 8px 20px; cursor: pointer; border: none; background: #007acc; color: #fff; border-radius: 4px;';

        cancelBtn.onclick = () => document.body.removeChild(modal);
        saveBtn.onclick = () => {
            this.firmware = textarea.value;
            // 通知 MicrocontrollerSolver 重新加载
            if (this.sys.mcuSolver) {
                this.sys.mcuSolver.reloadFirmware(this.id);
            }
            document.body.removeChild(modal);
            if (this.sys.showFloatingTip) {
                this.sys.showFloatingTip('固件已更新', 2000);
            }
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);

        // 指令速查
        const helpText = document.createElement('div');
        helpText.style = 'color: #888; font-size: 11px; font-family: monospace; margin-top: 8px; line-height: 1.6;';
        helpText.innerHTML = `
            SET  GP0, 1     ← GPIO0 输出高<br>
            READ GP1, val   ← 读取 GPIO1 到变量 val<br>
            ADC  0, ch0     ← 读取 ADC 通道 0<br>
            CMP  val, 10    ← 比较 val 和 10，设置标志 Z<br>
            JZ   LABEL      ← 若 Z=1 跳转到 LABEL<br>
            DELAY 100       ← 延迟 100ms<br>
            MOV  x, 0       ← x = 0<br>
            ADD  x, 1       ← x += 1
        `;

        editor.appendChild(header);
        editor.appendChild(textarea);
        editor.appendChild(btnRow);
        editor.appendChild(helpText);
        modal.appendChild(editor);
        document.body.appendChild(modal);
    }

    /**
     * 重置 MCU
     */
    _resetMCU() {
        if (this.sys.mcuSolver) {
            this.sys.mcuSolver.resetMCU(this.id);
        }
        this.state = 'running';
        this.pc = 0;
        this.regs = {};
        if (this.sys.showFloatingTip) {
            this.sys.showFloatingTip('MCU 已重置', 1500);
        }
    }

    /**
     * 更新 LED 状态显示
     */
    updateLED() {
        if (this._stateLED) {
            this._stateLED.fill(this.state === 'running' ? '#2ecc71' : '#e74c3c');
        }
        if (this._stateText) {
            this._stateText.text(this.state === 'running' ? 'RUN' : 'HLT');
            this._stateText.fill(this.state === 'running' ? '#2ecc71' : '#e74c3c');
        }
        if (this._pcText) {
            this._pcText.text(`PC: ${this.pc}`);
        }
    }
}
