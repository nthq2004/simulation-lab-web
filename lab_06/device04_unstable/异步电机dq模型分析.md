# 三相异步电动机 dq 模型分析

## 1. 概述

本仿真工程采用 **同步旋转坐标系（dq 坐标系）下的电动机模型**，将三相静止坐标系（abc）中的时变交流量变换为 dq 坐标系下的直流量，从而用一组常系数微分方程描述电动机的电磁动态。

### 1.1 为什么用 dq 模型

三相异步电动机在 abc 坐标系下的电压方程为：

```
v_a = Rs·i_a + dλ_a/dt
v_b = Rs·i_b + dλ_b/dt  
v_c = Rs·i_c + dλ_c/dt
```

其中每相磁链 λ_a, λ_b, λ_c 由自感和互感耦合决定，且互感随转子位置 θ_r 时变：

```
λ_a = Ls·i_a + Lm·cos(θ_r)·i_b + Lm·cos(θ_r+120°)·i_c + ...（转子项含 θ_r）
```

这是一组 **时变系数微分方程**，直接数值积分计算量极大。dq 变换通过将坐标系固定在同步旋转磁场上，使这些时变系数变为常数，大幅降低求解难度。

---

## 2. Clarke 变换（3→2 静止）

Clarke 变换将三相 abc 系统变换为两相 αβ 静止坐标系（幅值不变形式）：

```
┌     ┐     ┌                     ┐ ┌   ┐
│ f_α │     │ 1    -1/2    -1/2   │ │ f_a │
│ f_β │ = 2/3 · │ 0    √3/2   -√3/2  │ │ f_b │
│ f_0 │     │ 1/2   1/2     1/2   │ │ f_c │
└     ┘     └                     ┘ └   ┘
```

对应代码中 KCL 电流注入（DeviceStamps.js:2150-2167）的逆 Clark 部分：

```js
// 逆变换（abc 电流合成）
kclStamp(cU1, col_qs, ct);    // i_a += cos(θ)·iqs
kclStamp(cU1, col_ds, st);    // i_a += sin(θ)·ids
```

本工程中 Clarke 变换以嵌入 Park 变换的方式实现（不单独调用）。

---

## 3. Park 变换（静止→旋转）

Park 变换将 αβ 静止坐标系旋转 θ_e 电角度，得到与转子磁场同步旋转的 dq 坐标系。

### 3.1 正变换（电压 → dq）

```
v_qs = (2/3)·[cos(θ_e)·v_a + cos(θ_e-120°)·v_b + cos(θ_e+120°)·v_c]
v_ds = (2/3)·[sin(θ_e)·v_a + sin(θ_e-120°)·v_b + sin(θ_e+120°)·v_c]
```

其中 θ_e = ∫ω_e·dt = ω_e·t（开环 Park，与电网同步）。

代码中通过 eqVStamp 实现（DeviceStamps.js:2093-2100）：

```js
eqVStamp(col_qs, cU1,  twoThirds * ct);    // v_qs += (2/3)·cos(θ)·v_U1
eqVStamp(col_qs, cU2, -twoThirds * ct);    // v_qs -= (2/3)·cos(θ)·v_U2
eqVStamp(col_qs, cV1,  twoThirds * ct120);
eqVStamp(col_qs, cV2, -twoThirds * ct120);
eqVStamp(col_qs, cW1,  twoThirds * ctM120);
eqVStamp(col_qs, cW2, -twoThirds * ctM120);
```

### 3.2 逆变换（dq → 三相电流）

```
i_a = cos(θ_e)·iqs + sin(θ_e)·ids
i_b = cos(θ_e-120°)·iqs + sin(θ_e-120°)·ids
i_c = cos(θ_e+120°)·iqs + sin(θ_e+120°)·ids
```

代码中通过 kclStamp 实现（DeviceStamps.js:2150-2167）：

```js
kclStamp(cU1, col_qs, ct);     // i_U1 += cos(θ)·iqs
kclStamp(cU1, col_ds, st);     // i_U1 += sin(θ)·ids
kclStamp(cU2, col_qs, -ct);    // i_U2 -= cos(θ)·iqs  (返回支路)
kclStamp(cU2, col_ds, -st);    // i_U2 -= sin(θ)·ids
```

三相电流之和自动为零（cos(θ)+cos(θ-120°)+cos(θ+120°)=0），满足三线制 KCL。

### 3.3 交流电源的配合

三相电源输出（ACPower3P.js:182-196）采用余弦波形以匹配 Park 变换：

```js
return peak * Math.cos(omega * time + offset);
```

正序相位：
- V_u = Vm·cos(ωt)
- V_v = Vm·cos(ωt - 120°)
- V_w = Vm·cos(ωt + 120°)

在 θ_e = ωt 时：
- v_qs = Vm（直流）
- v_ds = 0

这两个恒定的 dq 电压作为 MNA 定子方程右侧激励项。

---

## 4. dq 坐标系下的电动机方程

### 4.1 磁链方程

在 dq 坐标系下，磁链与电流呈线性关系且**电感矩阵为常数**（无 θ_r 依赖）：

```
定子侧：
  λ_qs = Ls·iqs + Lm·iqr
  λ_ds = Ls·ids + Lm·idr

转子侧：
  λ_qr = Lr·iqr + Lm·iqs
  λ_dr = Lr·idr + Lm·ids
```

其中：
- Ls = Lσ1 + Lm（定子总自感）
- Lr = Lσ2 + Lm（转子总自感）
- Lm：激磁互感
- Lσ1, Lσ2：定转子漏感

代码对应（DeviceStamps.js:2068-2072）：

```js
const lam_qs_p = Ls * iqs_p + Lm * iqr_p;
const lam_ds_p = Ls * ids_p + Lm * idr_p;
const lam_qr_p = Lr * iqr_p + Lm * iqs_p;
const lam_dr_p = Lr * idr_p + Lm * ids_p;
```

### 4.2 电压方程

dq 坐标系下的 4 个电压方程（Krause 约定，q 轴领先 d 轴 90°）：

#### 定子 qs 方程
```
v_qs = Rs·iqs + ω_e·λ_ds + dλ_qs/dt
```

展开磁链、后向欧拉离散（dt = 0.5ms）：

```
v_qs - (Rs+Ls/dt)·iqs - ω_e·Ls·ids - (Lm/dt)·iqr - ω_e·Lm·idr 
  = -(Ls·iqs_prev + Lm·iqr_prev)/dt
```

代码（DeviceStamps.js:2101-2105）：

```js
G[col_qs][col_qs] -= (R1 + Gs);          // iqs 系数
G[col_qs][col_ds] -= omega_e * Ls;       // ids 系数
G[col_qs][col_qr] -= Gm;                 // iqr 系数
G[col_qs][col_dr] -= omega_e * Lm;       // idr 系数
B[col_qs] -= H_qs;                       // 历史项
```

#### 定子 ds 方程
```
v_ds = Rs·ids - ω_e·λ_qs + dλ_ds/dt
```

展开离散：

```
v_ds + ω_e·Ls·iqs - (Rs+Ls/dt)·ids + ω_e·Lm·iqr - (Lm/dt)·idr 
  = -(Ls·ids_prev + Lm·idr_prev)/dt
```

代码（DeviceStamps.js:2118-2122）：

```js
G[col_ds][col_qs] += omega_e * Ls;
G[col_ds][col_ds] -= (R1 + Gs);
G[col_ds][col_qr] += omega_e * Lm;
G[col_ds][col_dr] -= Gm;
B[col_ds] -= H_ds;
```

#### 转子 qr 方程（短路，v_qr = 0）

```
0 = Rr·iqr + ω_slip·λ_dr + dλ_qr/dt
```

其中 ω_slip = ω_e - ω_r 为转差电角速度。

展开离散：

```
-Gm·iqs - ω_slip·Lm·ids - (Rr+Lr/dt)·iqr - ω_slip·Lr·idr 
  = -(Lr·iqr_prev + Lm·iqs_prev)/dt
```

代码（DeviceStamps.js:2128-2132）：

```js
G[col_qr][col_qs] -= Gm;
G[col_qr][col_ds] -= omega_slip * Lm;
G[col_qr][col_qr] -= (R2 + Gr);
G[col_qr][col_dr] -= omega_slip * Lr;
B[col_qr] -= H_qr;
```

#### 转子 dr 方程（短路，v_dr = 0）

```
0 = Rr·idr - ω_slip·λ_qr + dλ_dr/dt
```

展开离散：

```
+ ω_slip·Lm·iqs - Gm·ids + ω_slip·Lr·iqr - (Rr+Lr/dt)·idr 
  = -(Lr·idr_prev + Lm·ids_prev)/dt
```

代码（DeviceStamps.js:2138-2142）：

```js
G[col_dr][col_qs] += omega_slip * Lm;
G[col_dr][col_ds] -= Gm;
G[col_dr][col_qr] += omega_slip * Lr;
G[col_dr][col_dr] -= (R2 + Gr);
B[col_dr] -= H_dr;
```

### 4.3 方程汇总（矩阵形式）

```
┌                                                       ┐ ┌     ┐   ┌        ┐
│ -(R1+Gs)  -ω_e·Ls    -Gm      -ω_e·Lm    Park_coeff │ │ iqs │   │ -H_qs  │
│  +ω_e·Ls  -(R1+Gs)   +ω_e·Lm   -Gm       Park_coeff │ │ ids │   │ -H_ds  │
│   -Gm     -ω_slip·Lm -(R2+Gr)  -ω_slip·Lr     0      │·│ iqr │ = │ -H_qr  │
│ +ω_slip·Lm  -Gm     +ω_slip·Lr -(R2+Gr)      0      │ │ idr │   │ -H_dr  │
│KCL_inv_Park                                        │ │ V_n │   │ I_src  │
└                                                       ┘ └     ┘   └        ┘
```

- Park_coeff：eqVStamp 注入的 (2/3)·cos/sin 系数（连接 abc 节点电压到 dq 方程）
- KCL_inv_Park：kclStamp 注入的逆 Park 系数（连接 dq 电流到 abc 节点 KCL）
- V_n：所有 abc 网络节点电压
- I_src：外部电源电流源向量

---

## 5. MNA 电路求解

### 5.1 求解流程

```
_preSolve(dt)          ← 更新 theta_e, omega_m, slip（InductionMotor.js:763-821）
    ↓
stamp 各器件到 G·x = B
    ↓
  stampPower3Sources    ← 三相电源诺顿等效注入（ac_wire_u/n/v/w 节点）
  stamp...其他设备
  stampInductionMotors  ← 4 个 dq 方程 + Park/KCL 接口注入（_stampIMFull）
    ↓
G·x = B 列主元高斯消去    ← MNAMatrix.gauss()
    ↓
阻尼更新节点电压         ← damping = min(0.6, 0.30+iter·0.04)
    ↓
收敛检查 (maxError < 1e-6) 或 200 次迭代
    ↓
_updateDeviceCurrents   ← 回读 dq 电流、计算转矩
_postSolve(iqs,ids,iqr,idr)  ← 存储本帧电流为下一帧的 prev 值
```

### 5.2 诺顿等效（三相电源）

三相电源（ACPower3P）采用诺顿等效注入 MNA（DeviceStamps.js:152-177）：

- 每相在内阻 rOn = 0.1Ω 上串联理想电压源 V(t) = Vm·cos(ωt + offset)
- 等效为：电导 G = 1/rOn = 10S 并联电流源 I(t) = V(t)/rOn

```
  ┌─────┐
  │V(t) │           G=10S          I=V(t)/rOn
  │     │───rOn───  ====   ⇔    ──/\/\/──   ═══
  └─────┘                         U1         N
```

关闭电源时 rOn → 10MΩ，呈高阻态。

### 5.3 后向欧拉离散

每个 dq 方程中的导数项用后向欧拉离散：

```
dλ/dt ≈ (λ(t) - λ(t-dt)) / dt
```

历史电流项 H = λ_prev / dt 作为已知量移到方程右侧（B 向量），G 矩阵中仅含本帧电流的系数：

| 系数 | 含义 | 典型值 |
|------|------|--------|
| Gs = Ls/dt | 定子伴随电导 | 165.9 S |
| Gm = Lm/dt | 互感和伴随电导 | 159.2 S |
| Gr = Lr/dt | 转子伴随电导 | 165.9 S |
| (R1+Gs) | 定子自导纳 | 166.4 S |
| (R2+Gr) | 转子自导纳 | 166.3 S |

### 5.4 阻尼迭代

MNA 采用阻尼 Newton 迭代处理非线性元件（二极管、BJT 等）。每轮迭代的更新规则：

```js
const damping = Math.min(0.6, 0.30 + iter * 0.04);
let nextV = oldV + damping * (rawNewV - oldV);
```

迭代终止条件：`maxError < 1e-6` 或达 200 次上限。

---

## 6. 磁链计算

### 6.1 上帧磁链（历史项）

Stamp 阶段从 prev 电流计算上帧磁链（DeviceStamps.js:2068-2072）：

```js
const lam_qs_p = Ls·iqs_prev + Lm·iqr_prev
const lam_ds_p = Ls·ids_prev + Lm·idr_prev
const lam_qr_p = Lr·iqr_prev + Lm·iqs_prev
const lam_dr_p = Lr·idr_prev + Lm·ids_prev
```

### 6.2 历史电流源

四方程的右侧 B 项为 `-lam_prev/dt`：

```js
B[col_qs] -= H_qs;   // H_qs = lam_qs_p / dt
B[col_ds] -= H_ds;
B[col_qr] -= H_qr;
B[col_dr] -= H_dr;
```

这些 H 项提供系统的"记忆"——若本帧电压缺失，电流将按 L/R 时间常数指数衰减，而非跳变到零。

### 6.3 磁链预填（初始化加速）

起动时若 prev 电流全为零，磁链从零开始指数建磁，时间常数 τ_r = Lr/Rr ≈ 0.18s，需约 180 帧（90ms）才能接近稳态。

为此在 `_initParameters` 中解析计算锁转子稳态 dq 电流（InductionMotor.js:151-187）：

```
稳态约束（d/dt = 0, v_qs=Vm, v_ds=0）：
  Vm = Rs·iqs + ω_e·Ls·ids + ω_e·Lm·idr
  0  = Rs·ids - ω_e·Ls·iqs - ω_e·Lm·iqr
  0  = Rr·iqr + ω_e·Lr·idr + ω_e·Lm·ids
  0  = Rr·idr - ω_e·Lr·iqr - ω_e·Lm·iqs
```

解得 4×4 系统，预填至 `_iqsPrev` 等变量，使首次 MNA 求解即处于稳态附近。

---

## 7. 转矩计算

### 7.1 dq 坐标系转矩公式

dq 坐标系下的瞬时电磁转矩公式（Krause 约定）：

```
T_e = (3/2)·(P/2)·Lm·(iqs·idr − ids·iqr)
```

其中 P 为极对数，(P/2) 将电角速度转为机械角速度。

代码（CircuitSolver.js:1362-1364）：

```js
const p  = dev.polePairs || 2;
const Lm = dev.Lm || 0.078;
let te_raw = 1.5 * p * Lm * (i_qs * i_dr - i_ds * i_qr);
```

### 7.2 转矩方向分析

转矩公式中交叉项 `iqs·idr − ids·iqr` 的符号决定转矩方向：

- 正序电源 + 正转磁场 → dr 轴磁链为负、qr 轴电流为负 → iqs·idr 为正（负×负=正）、ids·iqr 为负（正×负=负）→ 差值为正 → 正转矩
- 负序电源 → Park 变换相位反转 → dq 电流反号 → 转矩表达式不变号但转子磁场反转 → 平均转矩为负

转矩公式的 **符号不变性**：四个 dq 电流同时取反时，交叉项 `iqs·idr − ids·iqr` 不变（两负乘负得正），因此转矩符号仅取决于电流间的相对相位关系，而非电流绝对值方向。

### 7.3 转矩限幅

为防止数值发散导致转矩异常，基于等效电路最大转矩公式限幅：

```
T_max = 3·V² / (2·ω_sync·(R₁ + √(R₁²+X²)))
```

其中 X = 2πf·(Lσ1 + Lσ2)。dq 模型允许 50% 瞬态过冲（系数 1.5）。

### 7.4 机械积分

转矩注入机械系统的欧拉积分（InductionMotor.js:797-798）：

```
α = (T_e - T_load - B·ω_m) / J
ω_m += α·dt
```

转动惯量 J = 0.12 kg·m²，阻尼系数 B = 0.001 N·m·s。

---

## 8. 完整工作周期

```
每一帧（0.5ms）：

[1] _preSolve(dt)                    ← InductionMotor
      ├─ omega_e = 2π·f (电网同步)
      ├─ theta_e += omega_e·dt       ← Park 电角度积分
      ├─ 负载转矩计算（恒转矩/风机）
      ├─ 机械欧拉积分（Te → ω_m）
      └─ slip = (ω_sync − ω_m) / ω_sync

[2] MNA 矩阵构建
      ├─ stampPower3Sources           ← 三相电源诺顿注入
      ├─ stamp其他器件
      └─ stampInductionMotors
           ├─ eqVStamp                ← Park 正变换（abc 电压 → v_qs/v_ds）
           ├─ 4 dq 电压方程填充         ← 后向欧拉离散
           ├─ kclStamp                ← Park 逆变换（iqs/ids → abc 电流）
           ├─ 铁损 Rc 并联电导
           └─ 剩磁注入（起动时）

[3] MNA 高斯消去                      ← MNAMatrix.gauss()
      └─ 阻尼迭代至收敛

[4] _updateDeviceCurrents
      └─ 回读 results[col] → iqs, ids, iqr, idr

[5] Torque = 1.5·p·Lm·(iqs·idr − ids·iqr)

[6] _postSolve(iqs, ids, iqr, idr)   ← 存储 prev 值供下帧使用
      └─ 逆 Park 变换 → i_u, i_v, i_w（显示用）
```

---

## 9. 电机参数（本工程默认值）

| 参数 | 符号 | 值 | 单位 |
|------|------|-----|------|
| 定子电阻 | R₁ | 0.50 | Ω |
| 定子漏感 | Lσ1 | 3.34 | mH |
| 激磁电感 | Lm | 79.6 | mH |
| 铁损电阻 | Rc | 300 | Ω |
| 转子电阻 | R₂ | 0.46 | Ω |
| 转子漏感 | Lσ2 | 3.34 | mH |
| 极对数 | P | 2 | — |
| 转动惯量 | J | 0.12 | kg·m² |
| 阻尼系数 | B | 0.001 | N·m·s |

由这些参数导出的关键特征值：

| 指标 | 公式 | 值 |
|------|------|-----|
| 定子总自感 | Ls = Lσ1 + Lm | 82.94 mH |
| 转子总自感 | Lr = Lσ2 + Lm | 82.94 mH |
| 转子时间常数 | τ_r = Lr / R₂ | 0.180 s |
| 同步转速（50Hz / 2极） | n₁ = 60f / P | 1500 rpm |
| 堵转转矩（220V） | 由 MNA 解算 | ~78 N·m |
| 起动电流（220V） | 由 MNA 解算 | ~460 A (peak) |
| 额定转矩估计 | T_N ≈ P_N / ω_N | ~66 N·m |

---

## 10. 简化模型对比（simpleModel=true）

当 `simpleModel: true` 时，电机使用三相 RL 串联等效电路（_stampIMSimple），每相为：

```
R_load = R₁ + R₂/s  （诺顿等效）
L_total = Lσ1 + Lσ2  （无串联 Lm，Lm 作为并联励磁支路）
```

转矩由稳态公式计算：

```
T_e = 3·V²·(R₂/s) / (ω_sync·Z²)
```

该模型无 dq 变换、无磁链动态、无转子电流变量，计算量小但无法模拟：
- 转矩脉动（100Hz 分量）
- 磁链建磁暂态
- 转子磁场定向
- 变频调速时的瞬态响应

---

## 参考文献

1. Krause, P.C., Wasynczuk, O., Sudhoff, S.D., "Analysis of Electric Machinery and Drive Systems", IEEE Press, 2002.
2. 陈坚, "交流电机数学模型及调速系统", 国防工业出版社, 1989.
3. Ong, C.M., "Dynamic Simulation of Electric Machinery using MATLAB/Simulink", Prentice Hall, 1998.
