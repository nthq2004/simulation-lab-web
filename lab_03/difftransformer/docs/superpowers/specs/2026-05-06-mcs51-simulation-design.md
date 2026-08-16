# 8051 单片机仿真设计文档

## 1. 概述

在现有电路仿真（MNA）、气路仿真（BFS）和数字逻辑仿真基础上，增加 8051 单片机仿真能力。用户可使用 SDCC 编译 C 代码生成 HEX 文件，加载到仿真器中执行，实现真正的 8051 最小系统仿真，用于教学演示和实验。

## 2. 架构

### 2.1 整体集成

```
consys.js 仿真循环 (20fps)
├── CircuitSolver.update()       ← MNA 模拟求解
├── PneumaticSolver.solve()      ← 气路求解
├── DigitalSolver.update()       ← 数字逻辑求解
└── MCS51Solver.update()         ← 8051 指令执行 (新增)
```

MCS51Solver 是独立于现有 MicrocontrollerSolver 的新求解器，因为：
- 8051 有完整的 111 条指令集，无法用现有简化指令集模拟
- 8051 有时序概念（机器周期），需要按频率分配执行配额
- 8051 有复杂的中断优先级和嵌套机制

### 2.2 文件结构

| 文件 | 归属 | 内容 |
|---|---|---|
| `digital/MCS51.js` | 组件 | 8051 组件视图（DIP-40 封装 + 功能模块双模式）、引脚定义、HEX 加载 UI、右键菜单 |
| `tools/MCS51Solver.js` | 求解器 | 8051 解释执行引擎：指令译码、SFR 管理、定时器、中断、串口 |
| `export.js` | 导出 | 添加 MCS51、MCS51Solver 的导入和导出 |

### 2.3 与现有系统的关系

```
MCS51Solver
├── 通过 SignalBridge 读写 GPIO 信号线 ↔ 外部数字电路
├── 通过 MNA 节点电压读取模拟输入（ADC 功能）
├── 每帧由 ControlSystem._updatePhysics() 调用
└── 无需改动 CircuitSolver / DigitalSolver 现有代码
```

## 3. 8051 组件视觉设计

### 3.1 双模式视图

支持两种显示模式，通过右键菜单切换：

**模式 A：DIP-40 封装**
- 黑色矩形主体，尺寸约为 180×300（缩放后）
- 左侧 20 引脚、右侧 20 引脚，灰色引脚小矩形排列
- 顶部凹槽标记方向（类似 Timer555 的 notch）
- 型号文字 "8051"
- 缩放适应画布

**模式 B：功能模块**
- 深色矩形主体，尺寸约 120×160
- 不显示具体引脚，只标注功能端口组标签（P0、P1、P2、P3、INT、T0/T1、RXD/TXD、XTAL、RST、EA）
- 端口以标准 wire 圆圈形式排列在组件边缘
- 实时显示核心寄存器值（PC、ACC、PSW、SP）

初始默认显示功能模块模式。

### 3.2 引脚定义

标准 8051 DIP-40 引脚，每个引脚同时具有：
- `wire` 端口（通过 MNA 连接模拟电路，对应红色/黑色圆形端口）
- 数字信号线（通过 SignalBridge 与数字电路交互）
- 内部 SFR 映射（P0=0x80, P1=0x90, P2=0xA0, P3=0xB0）

关键引脚分组：

| 分组 | 引脚 | 类型 | 说明 |
|---|---|---|---|
| P0 | P0.0-P0.7 | 双向 GPIO | 8 位开漏双向口，也是 AD0-AD7 |
| P1 | P1.0-P1.7 | 双向 GPIO | 8 位准双向口 |
| P2 | P2.0-P2.7 | 双向 GPIO | 8 位准双向口，也是 A8-A15 |
| P3 | P3.0-P3.7 | 多功能 | RXD, TXD, INT0, INT1, T0, T1, WR, RD |
| 控制 | RST, EA, PSEN, ALE | 输入/输出 | 系统控制信号 |
| 时钟 | XTAL1, XTAL2 | 输入/输出 | 晶振（决定频率） |
| 电源 | VCC, GND | - | 电源和地 |

### 3.3 HEX 文件加载

- 右键菜单 → "加载 HEX 文件" → `<input type="file" accept=".hex,.ihx">`
- 解析 Intel HEX 格式（:llaaaattd...dcc）
- 将程序代码写入片内 64KB ROM 数组
- 显示加载结果对话框（地址范围、字节数、校验状态）
- 加载后自动复位

### 3.4 教学可视化面板

组件上实时显示：

```
┌──────────────────────┐
│  8051                │
│  PC: 0x0123          │
│  ACC: 0x7F  B: 0x00  │
│  PSW: 0x00  SP: 0x07 │
│  P0: 0xFF  P1: 0xFF  │
│  P2: 0xFF  P3: 0xFF  │
│  RUN ●               │
└──────────────────────┘
```

附加功能（右键菜单）：
- **寄存器查看器** — 弹窗显示所有 SFR 当前值（十六进制表格）
- **内存查看器** — 弹窗显示内部 128B RAM
- **反汇编查看器** — 显示当前程序 ROM 的反汇编列表，高亮 PC 位置
- **固件编辑器** — 允许直接粘贴 C 代码或汇编代码

## 4. 8051 指令执行引擎

### 4.1 核心数据结构

```javascript
class MCS51Solver {
    // 每帧调用
    update(deltaTime) {
        const cyclesAvail = Math.floor(this.freq * deltaTime);  // 本帧可用机器周期
        this.cyclesRemaining = cyclesAvail;
        
        while (this.cyclesRemaining > 0 && !this.stopped) {
            this.executeNextInstruction();
        }
        
        this.updateTimers(deltaTime);
        this.checkInterrupts();
        this.syncPorts();        // P0-P3 ↔ SignalBridge
        this.syncDisplayState(); // 更新组件显示
    }
}
```

### 4.2 内部状态

```javascript
this.state = {
    // 程序计数器与存储
    pc: 0,              // 16 位程序计数器
    rom: new Uint8Array(0x10000),  // 64KB 程序 ROM
    ram: new Uint8Array(0x80),     // 128B 内部 RAM（低 128B）
    
    // SFR 映射 (0x80-0xFF)
    sfr: new Uint8Array(0x80),     // 索引 0 对应地址 0x80
    
    // 核心寄存器别名（SFR 的快捷访问）
    acc: 0,     // SFR[0xE0-0x80]
    b: 0,       // SFR[0xF0-0x80]
    psw: 0,     // SFR[0xD0-0x80]
    sp: 0x07,   // SFR[0x81-0x80]
    dpl: 0,     // SFR[0x82-0x80]
    dph: 0,     // SFR[0x83-0x80]
    
    // 执行控制
    halted: false,
    sleepUntil: 0,
    
    // 中断
    interruptInProgress: false,
    currentInterrupt: -1,
};
```

### 4.3 指令译码与执行

**指令格式**：完整的 8051 指令集分为以下几类：

| 类别 | 数量 | 示例 |
|---|---|---|
| 算术运算 | 24 | ADD, ADDC, SUBB, INC, DEC, MUL, DIV, DA |
| 逻辑运算 | 20 | ANL, ORL, XRL, CLR, CPL, RL, RR, SWAP |
| 数据传输 | 28 | MOV, MOVX, MOVC, XCH, PUSH, POP |
| 位操作 | 12 | SETB, CLR, CPL, JB, JNB, JBC |
| 控制转移 | 27 | LJMP, AJMP, SJMP, JZ, JNZ, CJNE, DJNZ, LCALL, RET, RETI |

**寻址模式**：
- 立即数寻址: `MOV A, #data`
- 直接寻址: `MOV A, direct`
- 寄存器寻址: `MOV A, Rn`
- 寄存器间接寻址: `MOV A, @Ri`
- 变址寻址: `MOVC A, @A+DPTR`
- 位寻址: `SETB bit`
- 相对寻址: `SJMP rel`

**实现策略**：
- 操作码表驱动：`opcodeTable[256]` 数组，每个操作码映射到对应的执行函数
- 每条指令有一个 handler 函数，接收操作数并执行
- 指令长度和周期数在 opcode 表中预定义

```javascript
// 操作码表条目
const OPCODES = {
    0x00: { mnemonic: 'NOP',    len: 1, cycles: 1, handler: (c) => {} },
    0x74: { mnemonic: 'MOV A,#data', len: 2, cycles: 1, handler: (c) => { 
        c.acc = c.fetchByte(); 
    }},
    0x90: { mnemonic: 'MOV DPTR,#data16', len: 3, cycles: 2, handler: (c) => {
        c.dph = c.fetchByte();
        c.dpl = c.fetchByte();
    }},
    0x12: { mnemonic: 'LCALL addr16', len: 3, cycles: 2, handler: (c) => {
        const addr = c.fetchWord();
        c.pushStack(c.pc);
        c.pc = addr;
    }},
    // ... 共 111+ 条
};
```

### 4.4 时序模型

- 8051 的 1 个机器周期 = 12 个时钟周期（标准模式）
- 每条指令占用 1-4 个机器周期（在 opcode 表中预定义）
- 每帧可执行指令数 = `floor(frequency * deltaTime / 12 / cyclesPerInstr)`
- 默认晶振频率 12MHz → 1 个机器周期 = 1µs → 每帧(50ms) 约 50000 机器周期

## 5. SFR 寄存器与外设

### 5.1 GPIO (P0-P3)

每个端口是准双向口，输出时写入 SFR，输入时从引脚读取。

端口同步逻辑（每帧执行）：
```
1. 输出：将 SFR 中 P0-P3 的值写入对应 SignalBridge 信号线
2. 输入：从 SignalBridge 信号线读取外部驱动值，合并到 SFR（准双向口弱上拉）
3. P0 是开漏输出，外部必须接上拉
```

### 5.2 定时器/计数器 (T0, T1)

支持 4 种工作模式：

| 模式 | 说明 |
|---|---|
| 模式 0 | 13 位定时器（TLx 低 5 位 + THx 8 位） |
| 模式 1 | 16 位定时器 |
| 模式 2 | 8 位自动重装 |

定时器增量逻辑：
```
每帧：
  if (C/T = 0) → 按机器周期计数
  if (C/T = 1) → 检测 T0/T1 引脚外部脉冲
  
  每次计数溢出 → TCON 中 TFx 置位 → 触发中断（若使能）
```

### 5.3 串口 (UART)

支持模式 1（8 位 UART，可变波特率）：

**波特率**：由定时器 1 模式 2 的溢出率决定：
```
波特率 = (2^SMOD / 32) × (定时器1溢出率)
定时器1溢出率 = 晶振频率 / (12 × (256 - TH1))
```

**发送流程**：
```
1. 用户程序写 SBUF (0x99)
2. 硬件自动加载 8 位数据到发送移位寄存器
3. 逐位发送：起始位(0) + 8 位数据(LSB first) + 停止位(1)
4. 发送完成后 TI (SCON.1) 置位
5. 若 TI 中断使能 (IE.4=1, SCON.1=1)，触发中断
```

**接收流程**：
```
1. 在 RXD 引脚检测到起始位（下降沿）
2. 逐位移入接收移位寄存器
3. 接收到停止位后，数据转入 SBUF
4. RI (SCON.0) 置位
5. 若 RI 中断使能，触发中断
```

**仿真简化**：串口发送时通过 SignalBridge 信号线 "mcs51_txd" 输出逐位电平；接收从 "mcs51_rxd" 信号线读取。仿真不模拟精确的位时序，而是以字节为单位：写 SBUF 后立即将 8 位数据打包写入信号线，读 SBUF 时从信号线读取最新字节。

### 5.4 中断系统

5 个中断源，两级优先级：

| 中断 | 入口地址 | 标志位 | 使能位 |
|---|---|---|---|
| IE0 (INT0) | 0x0003 | TCON.1 | IE.0 |
| TF0 | 0x000B | TCON.5 | IE.1 |
| IE1 (INT1) | 0x0013 | TCON.3 | IE.2 |
| TF1 | 0x001B | TCON.7 | IE.3 |
| TI/RI | 0x0023 | SCON.1/SCON.0 | IE.4 |

中断响应流程：
```
1. 每帧结束时检查所有中断源
2. 按优先级选择最高优先级中断
3. 如果当前无中断响应 / 低优先级中断可被高优先级抢占
4. 保护现场：LCALL 到中断入口地址
5. 中断服务程序结束后 RETI 返回
```

## 6. 与外部电路交互

### 6.1 GPIO 信号流

```
8051 P1.0 写 1  →  SFR P1 bit0 = 1
                →  MCS51Solver.syncPorts()
                →  signalBridge.writeSignal("mcs51_p1_0", 1)
                →  外部数字门读取到高电平
                →  或通过 wire 端口连接 MNA 电路节点

外部电路输出    →  signalBridge 信号线值改变
                →  MCS51Solver.syncPorts()
                →  读取 signalBridge.readSignal("mcs51_p1_0")
                →  更新 SFR P1 bit0 的输入位
```

### 6.2 时钟与复位

- **XTAL1** — 读取 wire 端口电压，决定运行频率（默认 12MHz）
- **RST** — 检测数字信号线上升沿，触发复位（PC=0, SFR 初值）
- **EA** — 读取数字信号线，决定程序存储器映射

### 6.3 ADC 扩展

8051 片内无 ADC。如果教学需要，可通过 P1 口连接外部 ADC 芯片（如 ADC0804）的仿真组件，由 MCS51Solver 通过时序读取。

## 7. HEX 解析器

```javascript
parseIntelHex(text) {
    const rom = new Uint8Array(0x10000);
    rom.fill(0xFF);  // 空白 ROM 为 0xFF
    
    for (const line of text.split('\n')) {
        if (!line.startsWith(':')) continue;
        
        const byteCount = parseInt(line.substr(1, 2), 16);
        const address = parseInt(line.substr(3, 4), 16);
        const type = parseInt(line.substr(7, 2), 16);
        const data = line.substr(9, byteCount * 2);
        const checksum = parseInt(line.substr(-2), 16);
        
        if (type === 0x00) {  // 数据记录
            for (let i = 0; i < byteCount; i++) {
                rom[address + i] = parseInt(data.substr(i*2, 2), 16);
            }
        } else if (type === 0x01) {  // 文件结束
            break;
        } else if (type === 0x04) {  // 扩展线性地址
            // 处理 32 位地址的高 16 位（主要用于扩展 64KB 以上，标准 8051 可忽略）
        }
    }
    
    return rom;
}
```

## 8. 实现范围（本次实现）

**本次实现包含**：
- ✅ MCS51.js 组件（功能模块视图，不做 DIP-40 封装）
- ✅ MCS51Solver.js 核心解释器
- ✅ 基本 8051 指令集（约 60 条常用指令，见附录）
- ✅ GPIO P0-P3 与 SignalBridge 同步
- ✅ 定时器 T0/T1（模式 0、1、2，不包括模式 3）
- ✅ UART 串口（模式 1：8 位可变波特率）
- ✅ 中断系统（5 源、双优先级）
- ✅ Intel HEX 文件加载
- ✅ 寄存器/内存/反汇编查看器
- ✅ export.js 导出

**后续迭代**：
- 🔲 外部总线（PSEN/ALE/EA）

## 9. 成功标准

1. 8051 组件可拖入画布、可配置
2. 加载通过 SDCC 编译的 HEX 文件（如流水灯程序）后自动执行
3. GPIO 输出可通过 SignalBridge 驱动外部 LED 或数字组件
4. 外部信号可通过 GPIO 输入影响 8051 程序执行
5. 定时器中断示例程序正常运行
6. 寄存器/内存查看器可正确显示内部状态

## 附录 A：基本指令集（约 60 条）

### A.1 算术运算

| 助记符 | 操作 | 字节 | 周期 |
|---|---|---|---|
| ADD A, Rn | A += Rn | 1 | 1 |
| ADD A, direct | A += (direct) | 2 | 2 |
| ADD A, @Ri | A += (Ri) | 1 | 1 |
| ADD A, #data | A += #data | 2 | 2 |
| ADDC A, Rn | A += Rn + CY | 1 | 1 |
| SUBB A, Rn | A -= Rn - CY | 1 | 1 |
| SUBB A, #data | A -= #data - CY | 2 | 2 |
| INC A | A++ | 1 | 1 |
| INC Rn | Rn++ | 1 | 1 |
| INC direct | (direct)++ | 2 | 2 |
| INC @Ri | (Ri)++ | 1 | 1 |
| INC DPTR | DPTR++ | 1 | 2 |
| DEC A | A-- | 1 | 1 |
| DEC Rn | Rn-- | 1 | 1 |
| MUL AB | B:A = A × B | 1 | 4 |
| DIV AB | A = A/B, B = A%B | 1 | 4 |
| DA A | 十进制调整 | 1 | 1 |

### A.2 逻辑运算

| 助记符 | 操作 | 字节 | 周期 |
|---|---|---|---|
| ANL A, Rn | A &= Rn | 1 | 1 |
| ANL A, #data | A &= #data | 2 | 2 |
| ANL direct, A | (direct) &= A | 2 | 2 |
| ORL A, Rn | A \|= Rn | 1 | 1 |
| ORL A, #data | A \|= #data | 2 | 2 |
| XRL A, Rn | A ^= Rn | 1 | 1 |
| XRL A, #data | A ^= #data | 2 | 2 |
| CLR A | A = 0 | 1 | 1 |
| CPL A | A = ~A | 1 | 1 |
| RL A | A 左环移 | 1 | 1 |
| RLC A | A 带进位左环移 | 1 | 1 |
| RR A | A 右环移 | 1 | 1 |
| RRC A | A 带进位右环移 | 1 | 1 |
| SWAP A | A 高4位 ↔ 低4位 | 1 | 1 |

### A.3 数据传输

| 助记符 | 操作 | 字节 | 周期 |
|---|---|---|---|
| MOV A, Rn | A = Rn | 1 | 1 |
| MOV A, #data | A = #data | 2 | 1 |
| MOV Rn, A | Rn = A | 1 | 1 |
| MOV Rn, #data | Rn = #data | 2 | 1 |
| MOV direct, A | (direct) = A | 2 | 1 |
| MOV direct, Rn | (direct) = Rn | 2 | 2 |
| MOV @Ri, A | (Ri) = A | 1 | 1 |
| MOV @Ri, #data | (Ri) = #data | 2 | 1 |
| MOV DPTR, #data16 | DPTR = #data16 | 3 | 2 |
| MOVC A, @A+DPTR | A = ROM[A+DPTR] | 1 | 2 |
| MOVX A, @DPTR | A = XRAM[DPTR] | 1 | 2 |
| MOVX @DPTR, A | XRAM[DPTR] = A | 1 | 2 |
| PUSH direct | SP++; (SP) = (direct) | 2 | 2 |
| POP direct | (direct) = (SP); SP-- | 2 | 2 |
| XCH A, Rn | A ↔ Rn | 1 | 1 |
| XCH A, @Ri | A ↔ (Ri) | 1 | 1 |

### A.4 位操作

| 助记符 | 操作 | 字节 | 周期 |
|---|---|---|---|
| CLR C | CY = 0 | 1 | 1 |
| CLR bit | bit = 0 | 2 | 2 |
| SETB C | CY = 1 | 1 | 1 |
| SETB bit | bit = 1 | 2 | 2 |
| CPL C | CY = ~CY | 1 | 1 |
| CPL bit | bit = ~bit | 2 | 2 |
| ANL C, bit | CY &= bit | 2 | 2 |
| ORL C, bit | CY \|= bit | 2 | 2 |
| MOV C, bit | CY = bit | 2 | 1 |
| MOV bit, C | bit = CY | 2 | 2 |

### A.5 控制转移

| 助记符 | 操作 | 字节 | 周期 |
|---|---|---|---|
| LJMP addr16 | PC = addr16 | 3 | 2 |
| AJMP addr11 | PC[10:0] = addr11 | 2 | 2 |
| SJMP rel | PC += rel | 2 | 2 |
| JMP @A+DPTR | PC = A+DPTR | 1 | 2 |
| JZ rel | if A==0: PC += rel | 2 | 2 |
| JNZ rel | if A!=0: PC += rel | 2 | 2 |
| JC rel | if CY==1: PC += rel | 2 | 2 |
| JNC rel | if CY==0: PC += rel | 2 | 2 |
| JB bit, rel | if bit==1: PC += rel | 3 | 2 |
| JNB bit, rel | if bit==0: PC += rel | 3 | 2 |
| CJNE A, #data, rel | if A!=data: PC+=rel | 3 | 2 |
| DJNZ Rn, rel | Rn--; if Rn!=0: PC+=rel | 2 | 2 |
| LCALL addr16 | SP+=2; (SP)=PC; PC=addr16 | 3 | 2 |
| ACALL addr11 | SP+=2; (SP)=PC; PC[10:0]=addr11 | 2 | 2 |
| RET | PC = (SP); SP-=2 | 1 | 2 |
| RETI | PC = (SP); SP-=2; 恢复中断 | 1 | 2 |
| NOP | 空操作 | 1 | 1
