/**
 * constants.js — 全局常量、配色、标签配置
 * 船舶机舱监测报警系统 · CAN 总线架构
 */

// ─────────────────────────────────────────────
//  尺寸常量
// ─────────────────────────────────────────────
export const W = 680;
export const H = 500;
export const TAB_H = 60;       // 标签栏占用高度（含品牌条）
export const BODY_Y = TAB_H + 2;
export const BODY_H = H - BODY_Y - 8;

export const TABS = ['监测报警', '参数一览', '网络诊断', 'AI设置', 'AO设置', 'DI设置', 'DO设置', '液位控制', '温度控制'];

// ── 配色系统 ──────────────────────────────────
export const C = {
    bg: '#f5f5f5',
    panel: '#ffffff',
    border: '#d0d0d0',
    tab: '#e8e8e8',
    tabActive: '#ffffff',
    blue: '#0366d6',
    green: '#28a745',
    red: '#dc3545',
    yellow: '#ffc107',
    orange: '#fd7e14',
    purple: '#6f42c1',
    cyan: '#17a2b8',
    textDim: '#666666',
    text: '#333333',
    gridLine: '#e0e0e0',
};