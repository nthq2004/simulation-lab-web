import * as THREE from 'three';
import { createPumpModel } from './primitives/Pump3D.js';
import { createHeatExchangerModel } from './primitives/HeatExchanger3D.js';
import { createPipeSegment } from './primitives/Pipe3D.js';
import { createDieselEngineModel } from './primitives/DieselEngine3D.js';
import { createGeneratorModel } from './primitives/Generator3D.js';
import { createValveModel } from './primitives/Valve3D.js';
import { createAirBottleModel } from './primitives/AirBottle3D.js';

/**
 * ModelLoader - 3D 设备模型加载和创建工厂
 * 无 glTF 时使用基础几何体组合
 */
export class ModelLoader {
    constructor() {
        // 设备类型 → 工厂函数映射
        this._factories = {
            'pump':             (opts) => createPumpModel(opts),
            'heat_exchanger':   (opts) => createHeatExchangerModel(opts),
            'diesel_engine':     (opts) => createDieselEngineModel(opts),
            'generator':         (opts) => createGeneratorModel(opts),
            'valve':             (opts) => createValveModel(opts),
            'air_bottle':        (opts) => createAirBottleModel(opts),
        };
    }

    /**
     * 创建设备 3D 模型
     * @param {string} type  设备类型
     * @param {Object} opts  可包含 color, 位置等
     * @returns {THREE.Group}
     */
    createDevice(type, opts = {}) {
        const factory = this._factories[type];
        if (factory) return factory(opts);

        // 未知类型回退：灰色方块
        const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: opts.color || 0x9e9e9e })
        );
        return fallback;
    }

    /**
     * 创建管路线段
     */
    createPipe(from, to, opts = {}) {
        return createPipeSegment({ from, to, ...opts });
    }

    /**
     * 注册自定义设备工厂
     */
    register(type, factoryFn) {
        this._factories[type] = factoryFn;
    }
}
