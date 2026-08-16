import * as THREE from 'three';

/**
 * LayoutData - 机舱布局配置
 * 定义设备位置、管路路径和甲板参数
 */

// 冷却水系统设备 3D 坐标
export const COOLING_LAYOUT = {
    decks: [
        { y: 0, width: 12, depth: 10, color: 0x37474f },     // 底层
        { y: 2.8, width: 12, depth: 10, color: 0x37474f },   // 顶层
    ],

    devices: [
        // 海水泵
        { id: 'pump-sw-01', type: 'pump',   position: new THREE.Vector3(-2.5, 0.4, 1.5),  scale: 1.0 },
        // 淡水泵
        { id: 'pump-fw-01', type: 'pump',   position: new THREE.Vector3(2.5, 0.4, 1.5),   scale: 1.0 },
        // 板式换热器 (跨层)
        { id: 'hx-01',      type: 'heat_exchanger', position: new THREE.Vector3(0, 0.6, -1.5), scale: 1.0 },
        // 阀门
        { id: 'valve-sw-01', type: 'valve', position: new THREE.Vector3(-3.0, 0.2, 2.0),  scale: 0.6 },
        { id: 'valve-sw-02', type: 'valve', position: new THREE.Vector3(-2.0, 0.2, 0.5),  scale: 0.6 },
        { id: 'valve-fw-01', type: 'valve', position: new THREE.Vector3(2.0, 0.2, 0.5),   scale: 0.6 },
        { id: 'valve-fw-02', type: 'valve', position: new THREE.Vector3(3.0, 0.2, 2.0),   scale: 0.6 },
        // 传感器
        { id: 'temp-fw-in',  type: 'temperature_sensor', position: new THREE.Vector3(1.5, 0.3, -0.5), scale: 0.4 },
        { id: 'temp-fw-out', type: 'temperature_sensor', position: new THREE.Vector3(1.0, 0.3, 2.5),  scale: 0.4 },
    ],

    // 管路路径 [{from, to, opts}]
    pipes: [
        { id: 'pipe-sw-01', pumpId: 'pump-sw-01', from: [-3.0, 0.3, 2.0],  to: [-2.5, 0.3, 1.5],  color: 0x42a5f5 }, // 海水→海水泵入口
        { id: 'pipe-sw-02', pumpId: 'pump-sw-01', from: [-2.5, 0.3, 1.0],  to: [-0.5, 0.3, -0.5], color: 0x42a5f5 }, // 海水泵出口→换热器
        { id: 'pipe-sw-03', pumpId: 'pump-sw-01', from: [-0.5, 0.3, -0.5], to: [0, 0.5, -1.5],    color: 0x42a5f5 }, // →换热器海水侧
        { id: 'pipe-sw-04', pumpId: 'pump-sw-01', from: [0, 0.5, -1.5],    to: [0, 4.0, -1.5],     color: 0x42a5f5 }, // 换热器海水出口(垂直)
        { id: 'pipe-fw-01', pumpId: 'pump-fw-01', from: [2.0, 0.3, 0.5],   to: [0, 0.5, -1.5],     color: 0xef5350 }, // 淡水→换热器
        { id: 'pipe-fw-02', pumpId: 'pump-fw-01', from: [2.5, 0.3, 1.5],   to: [2.0, 0.3, 0.5],    color: 0xef5350 }, // 淡水泵出口→
        { id: 'pipe-fw-03', pumpId: 'pump-fw-01', from: [0, 0.5, -1.5],    to: [1.0, 0.3, 2.5],     color: 0xef5350 }, // 换热器淡水出口→
    ],
};

/**
 * PHASE2_LAYOUT - Phase 2 设备 3D 空间布局
 * 在冷却水系统基础上扩展四大核心系统
 */
export const PHASE2_LAYOUT = {
    decks: [
        { y: 0, width: 16, depth: 12, color: 0x37474f },
        { y: 2.8, width: 16, depth: 12, color: 0x37474f },
    ],

    devices: [
        // ── 主动力系统 (左侧区域) ──
        { id: 'me-01',              type: 'diesel_engine',  position: new THREE.Vector3(-5.0, 0.6, 0),    scale: 1.0 },
        { id: 'governor-01',        type: 'governor',       position: new THREE.Vector3(-5.0, 2.0, 2.5), scale: 0.5 },

        // ── 电站系统 (右侧区域) ──
        { id: 'gen-01',             type: 'generator',      position: new THREE.Vector3(5.0, 0.5, 0),    scale: 1.0 },
        { id: 'switchboard-01',     type: 'switchboard',    position: new THREE.Vector3(5.0, 0.5, 3.0),  scale: 0.8 },

        // ── 燃油系统 (后方区域) ──
        { id: 'tank-hfo-01',        type: 'fuel_tank',      position: new THREE.Vector3(-3.0, 0.3, 4.5), scale: 0.8 },
        { id: 'tank-doa-01',        type: 'fuel_tank',      position: new THREE.Vector3(-1.5, 0.3, 4.5), scale: 0.8 },
        { id: 'purifier-01',        type: 'oil_separator',  position: new THREE.Vector3(0, 0.3, 3.5),    scale: 0.6 },
        { id: 'pump-hfo-01',        type: 'pump',           position: new THREE.Vector3(-2.0, 0.4, 2.5), scale: 0.8 },

        // ── 压缩空气系统 (右后方区域) ──
        { id: 'compressor-01',      type: 'compressor',     position: new THREE.Vector3(3.0, 0.4, 4.0),  scale: 0.8 },
        { id: 'air-bottle-main',    type: 'air_bottle',     position: new THREE.Vector3(4.5, 0.6, 4.0),  scale: 0.8 },
        { id: 'air-distributor-01', type: 'air_distributor',position: new THREE.Vector3(3.0, 0.3, 2.0),  scale: 0.6 },
    ],

    pipes: [
        // 燃油：油柜 → 日用柜 → 分油机 → 主机
        { id: 'pipe-hfo-01', pumpId: 'pump-hfo-01', from: [-3.0, 0.3, 4.5],  to: [-1.5, 0.3, 4.5],  color: 0x795548 },
        { id: 'pipe-hfo-02', pumpId: 'pump-hfo-01', from: [-1.5, 0.3, 4.5],  to: [0, 0.3, 3.5],     color: 0x795548 },
        { id: 'pipe-hfo-03', pumpId: 'pump-hfo-01', from: [0, 0.3, 3.5],     to: [-0.5, 0.3, 2.5],  color: 0x795548 },
        { id: 'pipe-hfo-04', pumpId: 'pump-hfo-01', from: [-0.5, 0.3, 2.5],  to: [-3.0, 0.3, 1.5],  color: 0x795548 },
        { id: 'pipe-hfo-05', pumpId: 'pump-hfo-01', from: [-3.0, 0.3, 1.5],  to: [-4.0, 0.6, 0.5],  color: 0x795548 },

        // 压缩空气：空压机 → 气瓶 → 分配器
        { id: 'pipe-ca-01', pumpId: 'compressor-01', from: [3.0, 0.3, 4.0],   to: [4.5, 0.3, 4.0],   color: 0x4fc3f7 },
        { id: 'pipe-ca-02', pumpId: 'compressor-01', from: [4.5, 0.3, 4.0],   to: [3.5, 0.3, 3.0],   color: 0x4fc3f7 },
        { id: 'pipe-ca-03', pumpId: 'compressor-01', from: [3.5, 0.3, 3.0],   to: [3.0, 0.3, 2.0],   color: 0x4fc3f7 },
        { id: 'pipe-ca-04', pumpId: 'compressor-01', from: [3.0, 0.3, 2.0],   to: [3.0, 0.3, 1.5],   color: 0x4fc3f7 },
    ],
};
