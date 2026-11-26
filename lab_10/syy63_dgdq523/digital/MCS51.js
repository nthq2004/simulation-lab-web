/**
 * MCS51.js — 8051 单片机组件（功能模块视图）
 *
 * 引脚：
 *   P0[0..7], P1[0..7], P2[0..7], P3[0..7] — GPIO (双向)
 *   RST — 复位输入（数字）
 *   XTAL1 — 晶振输入（决定频率）
 *   VCC, GND — 电源
 *   TxD, RxD — UART
 *   INT0, INT1 — 外部中断
 *   T0, T1 — 定时器外部输入
 *
 * 右键菜单：
 *   - 加载 HEX 文件
 *   - 寄存器查看器
 *   - 内存查看器
 *   - 反汇编查看器
 *   - 复位
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { signalBridge } from '../tools/SignalBridge.js';

export class MCS51 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_mcs51';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 160 * s;
        const H = 200 * s;

        // ── 状态 ──
        this.powerOn = config.powerOn !== undefined ? config.powerOn : true;
        this.xtalFreq = config.xtalFreq || 12000000;

        // 显示缓存（由 MCS51Solver 更新）
        this._displayPC = 0;
        this._displayACC = 0;
        this._displayB = 0;
        this._displayPSW = 0;
        this._displaySP = 0x07;
        this._displayDPH = 0;
        this._displayDPL = 0;
        this._displayP0 = 0xFF;
        this._displayP1 = 0xFF;
        this._displayP2 = 0xFF;
        this._displayP3 = 0xFF;
        this._displayState = 'running';
        this._displayROM = null;
        this._displayRAM = null;
        this._displaySFR = null;
        this._romData = null; // 预加载的 ROM 数据

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#1a1a2e',
            stroke: '#4a90d9',
            strokeWidth: 2 * s,
            cornerRadius: 6 * s,
        });
        this.group.add(body);

        // ── 内部区域 ──
        const inner = new Konva.Rect({
            x: -W / 2 + 6 * s, y: -H / 2 + 30 * s,
            width: W - 12 * s, height: H - 36 * s,
            fill: '#16213e',
            cornerRadius: 4 * s,
        });
        this.group.add(inner);

        // ── 型号标识 ──
        const label = new Konva.Text({
            text: '8051',
            x: -W / 2 + 10 * s, y: -H / 2 + 6 * s,
            fontSize: 18 * s, fontFamily: 'Courier New',
            fill: '#4a90d9', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 状态指示 ──
        this._stateLED = new Konva.Circle({
            x: W / 2 - 14 * s, y: -H / 2 + 10 * s,
            radius: 5 * s, fill: '#2ecc71',
            stroke: '#fff', strokeWidth: 1 * s,
        });
        this.group.add(this._stateLED);

        const stateLabel = new Konva.Text({
            text: 'RUN',
            x: W / 2 - 28 * s, y: -H / 2 + 4 * s,
            fontSize: 9 * s, fontFamily: 'Arial',
            fill: '#2ecc71',
        });
        this.group.add(stateLabel);
        this._stateLabel = stateLabel;

        // ── 核心寄存器显示 ──
        this._regTexts = {};
        const regLines = [
            { key: 'pc', label: 'PC', x: -W/2+12, y: -H/2+38, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(4,'0')}` },
            { key: 'acc', label: 'ACC', x: -W/2+12, y: -H/2+54, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'b', label: 'B', x: W/2-65, y: -H/2+54, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'psw', label: 'PSW', x: -W/2+12, y: -H/2+70, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'sp', label: 'SP', x: W/2-65, y: -H/2+70, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'dptr', label: 'DPTR', x: -W/2+12, y: -H/2+86, fmt: (v) => v },
        ];

        regLines.forEach(rl => {
            const t = new Konva.Text({
                text: `${rl.label}: ${rl.fmt(0)}`,
                x: rl.x * s, y: rl.y * s,
                fontSize: 10 * s, fontFamily: 'Courier New',
                fill: '#bdc3c7',
            });
            this.group.add(t);
            this._regTexts[rl.key] = t;
        });

        // ── 端口显示 ──
        this._portTexts = {};
        const portNames = ['P0', 'P1', 'P2', 'P3'];
        portNames.forEach((pn, i) => {
            const t = new Konva.Text({
                text: `${pn}: 0xFF`,
                x: (-W/2 + 12 + (i % 2) * 75) * s,
                y: (-H/2 + 104 + Math.floor(i/2) * 16) * s,
                fontSize: 10 * s, fontFamily: 'Courier New',
                fill: '#e67e22',
            });
            this.group.add(t);
            this._portTexts[pn] = t;
        });

        // ── 引脚定义和注册 ──
        this._registerPins(s, W, H);
    }

    _registerPins(s, W, H) {
        const leftX = -W/2 - 4 * s;
        const rightX = W/2 + 4 * s;
        const topY = -H/2;
        const pinSpacing = 12 * s;

        // 左侧引脚：P0[0..3] + INT0 + INT1 + T0 + T1 + XTAL1
        const leftPins = ['P0.0', 'P0.1', 'P0.2', 'P0.3', 'INT0', 'INT1', 'T0', 'T1', 'XTAL1'];
        leftPins.forEach((name, i) => {
            const y = topY + (i + 1) * pinSpacing;
            this.addPort(leftX - 10 * s, y, name, 'wire', name.startsWith('P') ? 'n' : 'p');
        });

        // 右侧引脚：P0[4..7] + P1[0..3] + RST + TxD + RxD
        const rightPins = ['P0.4', 'P0.5', 'P0.6', 'P0.7', 'P1.0', 'P1.1', 'P1.2', 'P1.3', 'RST', 'TxD', 'RxD'];
        rightPins.forEach((name, i) => {
            const y = topY + (i + 1) * pinSpacing;
            this.addPort(rightX + 10 * s, y, name, 'wire', name === 'RST' ? 'p' : 'n');
        });

        // 底部引脚：P1[4..7] + P2[0..3]
        const bottomPins = ['P1.4', 'P1.5', 'P1.6', 'P1.7', 'P2.0', 'P2.1', 'P2.2', 'P2.3'];
        bottomPins.forEach((name, i) => {
            const x = (-W/2 + 10 + i * 16) * s;
            this.addPort(x, H/2 + 4 * s, name, 'wire', 'n');
        });

        // 注册数字信号线（SignalBridge 连接）
        this._registerSignalLines();
    }

    _registerSignalLines() {
        // P0 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p0_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P0.${i}`);
        }
        // P1 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p1_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P1.${i}`);
        }
        // P2 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p2_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P2.${i}`);
        }
        // P3 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p3_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P3.${i}`);
        }

        // RST 信号线
        signalBridge.createSignalLine(`${this.id}_rst`);
        signalBridge.connectToLine(`${this.id}_rst`, `${this.id}_RST`);

        // TxD, RxD 信号线
        signalBridge.createSignalLine(`${this.id}_txd`);
        signalBridge.createSignalLine(`${this.id}_rxd`);
        signalBridge.connectToLine(`${this.id}_txd`, `${this.id}_TxD`);
        signalBridge.connectToLine(`${this.id}_rxd`, `${this.id}_RxD`);
    }

    /**
     * 每帧更新显示（由 MCS51Solver 设置 _display* 属性后调用 updateLED）
     */
    updateLED() {
        if (!this._regTexts) return;

        this._regTexts.pc.text(`PC: 0x${this._displayPC.toString(16).toUpperCase().padStart(4, '0')}`);
        this._regTexts.acc.text(`ACC: 0x${this._displayACC.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.b.text(`B: 0x${this._displayB.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.psw.text(`PSW: 0x${this._displayPSW.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.sp.text(`SP: 0x${this._displaySP.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.dptr.text(`DPTR: 0x${this._displayDPH.toString(16).toUpperCase().padStart(2, '0')}${this._displayDPL.toString(16).toUpperCase().padStart(2, '0')}`);

        this._portTexts.P0.text(`P0: 0x${this._displayP0.toString(16).toUpperCase().padStart(2, '0')}`);
        this._portTexts.P1.text(`P1: 0x${this._displayP1.toString(16).toUpperCase().padStart(2, '0')}`);
        this._portTexts.P2.text(`P2: 0x${this._displayP2.toString(16).toUpperCase().padStart(2, '0')}`);
        this._portTexts.P3.text(`P3: 0x${this._displayP3.toString(16).toUpperCase().padStart(2, '0')}`);

        const isRunning = this._displayState === 'running';
        this._stateLED.fill(isRunning ? '#2ecc71' : '#e74c3c');
        this._stateLabel.text(isRunning ? 'RUN' : 'HLT');
        this._stateLabel.fill(isRunning ? '#2ecc71' : '#e74c3c');
    }

    /**
     * 右键菜单
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
            padding: 5px 0; min-width: 160px; font-family: sans-serif; font-size: 14px;
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
        menu.appendChild(createItem('加载 HEX 文件', () => this._loadHEX()));
        menu.appendChild(createItem('寄存器查看器', () => this._showRegViewer()));
        menu.appendChild(createItem('内存查看器', () => this._showMemViewer()));
        menu.appendChild(createItem('反汇编查看器', () => this._showDisasmViewer()));
        menu.appendChild(createItem('重置 8051', () => this._resetMCS51()));

        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    /**
     * 加载 HEX 文件
     */
    _loadHEX() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.hex,.ihx';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const hexText = ev.target.result;
                if (this.sys.mcs51Solver) {
                    const result = this.sys.mcs51Solver.loadHex(this.id, hexText);
                    if (result.success) {
                        this.sys.showFloatingTip(`HEX 加载成功: ${result.totalBytes} 字节, PC=0x${result.pc.toString(16)}`, 3000);
                    } else {
                        this.sys.showFloatingTip(`HEX 加载失败: ${result.error}`, 3000);
                    }
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    /**
     * 寄存器查看器
     */
    _showRegViewer() {
        const modal = document.createElement('div');
        modal.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const content = document.createElement('div');
        content.style = `background:#1e1e2e;padding:20px;border-radius:8px;width:500px;max-height:80vh;overflow-y:auto;color:#cdd6f4;font-family:'Courier New',monospace;font-size:13px;`;

        let html = '<h3 style="color:#89b4fa;margin-top:0;">SFR 寄存器</h3><table style="width:100%;border-collapse:collapse;">';
        const sfrNames = [
            [0x80,'P0'],[0x81,'SP'],[0x82,'DPL'],[0x83,'DPH'],[0x87,'PCON'],
            [0x88,'TCON'],[0x89,'TMOD'],[0x8A,'TL0'],[0x8B,'TL1'],[0x8C,'TH0'],[0x8D,'TH1'],
            [0x90,'P1'],[0x98,'SCON'],[0x99,'SBUF'],
            [0xA0,'P2'],[0xA8,'IE'],[0xB0,'P3'],[0xB8,'IP'],
            [0xD0,'PSW'],[0xE0,'ACC'],[0xF0,'B'],
        ];

        html += '<tr style="color:#a6adc8;"><th>地址</th><th>名称</th><th>值</th><th>二进制</th></tr>';
        sfrNames.forEach(([addr, name]) => {
            const val = this._displaySFR ? this._displaySFR[addr - 0x80] : 0;
            const bin = val.toString(2).padStart(8,'0');
            html += `<tr><td>0x${addr.toString(16).toUpperCase()}</td><td>${name}</td><td>0x${val.toString(16).toUpperCase().padStart(2,'0')}</td><td>${bin}</td></tr>`;
        });
        html += '</table>';

        content.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:15px;padding:8px 20px;cursor:pointer;border:none;background:#45475a;color:#cdd6f4;border-radius:4px;';
        closeBtn.onclick = () => document.body.removeChild(modal);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    /**
     * 内存查看器
     */
    _showMemViewer() {
        const modal = document.createElement('div');
        modal.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const content = document.createElement('div');
        content.style = `background:#1e1e2e;padding:20px;border-radius:8px;width:600px;max-height:80vh;overflow-y:auto;color:#cdd6f4;font-family:'Courier New',monospace;font-size:12px;`;

        let html = '<h3 style="color:#89b4fa;margin-top:0;">内部 RAM (0x00-0x7F)</h3><pre style="line-height:1.4;">';
        const ram = this._displayRAM;
        if (ram) {
            for (let row = 0; row < 8; row++) {
                const addr = row * 16;
                const bytes = Array.from(ram.slice(addr, addr + 16));
                const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
                const ascii = bytes.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
                html += `${addr.toString(16).toUpperCase().padStart(2,'0')}: ${hex}  ${ascii}\n`;
            }
        } else {
            html += '（未加载程序）\n';
        }
        html += '</pre>';

        content.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:15px;padding:8px 20px;cursor:pointer;border:none;background:#45475a;color:#cdd6f4;border-radius:4px;';
        closeBtn.onclick = () => document.body.removeChild(modal);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    /**
     * 反汇编查看器
     */
    _showDisasmViewer() {
        const modal = document.createElement('div');
        modal.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const content = document.createElement('div');
        content.style = `background:#1e1e2e;padding:20px;border-radius:8px;width:700px;max-height:80vh;overflow-y:auto;color:#cdd6f4;font-family:'Courier New',monospace;font-size:12px;`;

        let html = '<h3 style="color:#89b4fa;margin-top:0;">反汇编</h3><pre style="line-height:1.4;">';
        const rom = this._displayROM;
        const pc = this._displayPC;

        if (rom) {
            const DISASM = {
                0x00:'NOP',
                0x80:'SJMP',
                0x02:'LJMP',
                0x12:'LCALL',
                0x22:'RET',
                0x32:'RETI',
                0x74:'MOV A,#',
                0x90:'MOV DPTR,#',
                0xE4:'CLR A',
                0xF4:'CPL A',
                0xD3:'SETB C',
                0xC3:'CLR C',
                0x04:'INC A',
                0x14:'DEC A',
                0x24:'ADD A,#',
                0x44:'ORL A,#',
                0x54:'ANL A,#',
                0x64:'XRL A,#',
                0x94:'SUBB A,#',
                0xB4:'CJNE A,#',
                0x60:'JZ',
                0x70:'JNZ',
                0x40:'JC',
                0x50:'JNC',
                0xD8:'DJNZ R0,',
                0xD9:'DJNZ R1,',
                0xA3:'INC DPTR',
                0x84:'DIV AB',
                0xA4:'MUL AB',
                0xC4:'SWAP A',
                0x23:'RL A',
                0x33:'RLC A',
                0x03:'RR A',
                0x13:'RRC A',
                0x93:'MOVC A,@A+DPTR',
                0x83:'MOVC A,@A+PC',
                0xE0:'MOVX A,@DPTR',
                0xF0:'MOVX @DPTR,A',
                0x73:'JMP @A+DPTR',
            };

            const startAddr = Math.max(0, pc - 32);
            const endAddr = Math.min(0xFFFF, pc + 96);

            let addr = startAddr;
            while (addr < endAddr) {
                const opcode = rom[addr];
                const isCurrent = addr === pc;
                const prefix = isCurrent ? '\u2192 ' : '  ';
                let disasm = `${prefix}${addr.toString(16).toUpperCase().padStart(4,'0')}: `;

                if (opcode in DISASM) {
                    const mnemonic = DISASM[opcode];
                    // Use OPCODES lookup for instruction length - reference global OPCODES
                    const instr = typeof OPCODES !== 'undefined' ? OPCODES[opcode] : null;
                    const len = instr ? instr.len : 2;

                    if (len === 1) {
                        disasm += mnemonic;
                    } else if (len <= 2) {
                        const data = rom[(addr + 1) & 0xFFFF];
                        if ([0x80, 0x60, 0x70, 0x40, 0x50].includes(opcode)) {
                            const rel = data > 127 ? data - 256 : data;
                            const target = (addr + 2 + rel) & 0xFFFF;
                            disasm += `${mnemonic} 0x${target.toString(16).toUpperCase().padStart(4,'0')}`;
                        } else if ([0x74, 0x24, 0x44, 0x54, 0x64, 0x94, 0xB4].includes(opcode)) {
                            disasm += `${mnemonic}0x${data.toString(16).toUpperCase().padStart(2,'0')}`;
                        } else {
                            disasm += `${mnemonic}0x${data.toString(16).toUpperCase().padStart(2,'0')}`;
                        }
                    } else {
                        const h = rom[(addr + 1) & 0xFFFF];
                        const l = rom[(addr + 2) & 0xFFFF];
                        if ([0x02, 0x12].includes(opcode)) {
                            disasm += `${mnemonic} 0x${h.toString(16).toUpperCase().padStart(2,'0')}${l.toString(16).toUpperCase().padStart(2,'0')}`;
                        } else if (opcode === 0x90) {
                            disasm += `${mnemonic}0x${h.toString(16).toUpperCase().padStart(2,'0')}${l.toString(16).toUpperCase().padStart(2,'0')}`;
                        }
                        addr += 2;
                    }
                    addr += (len === 0 ? 1 : len);
                } else {
                    disasm += `DB 0x${opcode.toString(16).toUpperCase().padStart(2,'0')}`;
                    addr += 1;
                }

                html += disasm + '\n';
            }
        } else {
            html += '（未加载程序）\n';
        }
        html += '</pre>';

        content.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:15px;padding:8px 20px;cursor:pointer;border:none;background:#45475a;color:#cdd6f4;border-radius:4px;';
        closeBtn.onclick = () => document.body.removeChild(modal);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    /**
     * 重置 8051
     */
    _resetMCS51() {
        if (this.sys.mcs51Solver) {
            this.sys.mcs51Solver.resetMCU(this.id);
        }
        this._displayState = 'running';
        this._displayPC = 0;
        if (this.sys.showFloatingTip) {
            this.sys.showFloatingTip('8051 已重置', 1500);
        }
    }

    /**
     * 参数配置
     */
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '晶振频率 (Hz)', key: 'xtalFreq', type: 'number' },
            { label: '上电启动', key: 'powerOn', type: 'select', options: [
                { label: '是', value: true }, { label: '否', value: false }
            ]},
        ];
    }

    /**
     * 桌面端端口绝对位置
     */
    getAbsPortPos(portId) {
        const port = this.ports.find(p => p.id === portId);
        if (!port) return { x: 0, y: 0 };
        if (port.node && typeof port.node.getAbsolutePosition === 'function') {
            const pos = port.node.getAbsolutePosition();
            return { x: pos.x, y: pos.y };
        }
        try {
            const p = this.group.getAbsoluteTransform().point({ x: port.x || 0, y: port.y || 0 });
            return { x: p.x, y: p.y };
        } catch (e) {
            return { x: this.group.x() + (port.x || 0), y: this.group.y() + (port.y || 0) };
        }
    }
}
