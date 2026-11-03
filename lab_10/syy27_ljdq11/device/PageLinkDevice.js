import { BaseDevice } from './BaseDevice.js';

/**
 * PageLinkDevice — 跨页连接器复合设备（共享"设备"）
 *
 * 分布在不同页面的多个 PageLink 子组件通过同一 deviceid 共享本设备实例，
 * 代表同一组"跨页信号端子排"。各子组件的电气同簇由 CircuitTopology
 * 全局处理（同 deviceid、同通道号、同 a/b 侧的端口合并为一簇），
 * 因此页 1 的端子与页 2 的端子等价连通，无需在页面之间拉线。
 *
 * 本设备类仅作逻辑标识；state 供设备管理器统一 preUpdate/commit。
 */
export class PageLinkDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = {};
        this._nextState = {};
    }
}

export default PageLinkDevice;
