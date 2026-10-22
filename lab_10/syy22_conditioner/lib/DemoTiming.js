// DemoTiming.js — 自动演示统一时间参数（集中管理，便于一处调参）
//
// 用法：组件/演示引擎从本模块导入 DEMO 常量，避免各文件散落魔法数字。
export const DEMO = {
    // ── 终端命令演示 ──
    TYPE_PER_CHAR: 165,      // 逐字键入速度（ms/字，越大越慢）
    CMD_HOLD: 7500,          // 单条命令输出后停留（demoCommand）
    SCRIPT_CMD_HOLD: 6200,   // 多命令序列：每条命令后停留（命令之间的间隔）
    SCRIPT_END_HOLD: 6000,   // 多命令序列：全部结束后停留
    LINE_DELAY: 900,         // ping/tracert 逐行打印间隔（仅演示时生效）
    LINE_DELAY_MANUAL: 200,  // ping/tracert 逐行打印间隔（手动操作时）

    // ── 流程引擎步骤节奏 ──
    STEP_SWITCH_HOLD: 1800,  // 每个 op 操作完成后的间隔
    STEP_END_HOLD: 2800,     // 每步整体结束后的观察停留
    AUTO_STEP_GAP: 2000,     // 自动演示中相邻两步之间的间隔
};
