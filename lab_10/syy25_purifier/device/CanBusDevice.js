import { BaseDevice } from './BaseDevice.js';

/**
 * CanBusDevice — CAN 总线复合设备（共享"设备"）
 *
 * 由分布在各 CAN 设备下方的多个 BusConnector 子组件通过同一 deviceid
 * 共享本设备实例，代表"一条 CAN 总线"。总线本身是被动连接，无动态状态；
 * 各子组件的电气同簇由 CircuitTopology 全局处理（H 端口一簇、L 端口一簇），
 * 本设备类仅作逻辑标识与后续扩展（如统计挂接节点数）之用。
 */
export class CanBusDevice extends BaseDevice {
    constructor(config) {
        super(config);
        // 总线无自身动态状态；state 供设备管理器统一 preUpdate/commit
        this.state = {};
        this._nextState = {};
    }
}
