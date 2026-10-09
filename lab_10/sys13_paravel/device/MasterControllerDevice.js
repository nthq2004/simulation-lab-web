import { BaseDevice } from './BaseDevice.js';

/**
 * MasterControllerDevice — 主令控制器复合设备（共享"设备"）
 *
 * 主设备：仿三维直推手柄，共 7 个档位（索引 0 → 6）：
 *   0 下降3 │ 1 下降2 │ 2 下降1 │ 3 OFF（零位）│ 4 上升1 │ 5 上升2 │ 6 上升3
 *
 * 附属开关 LK1 ~ LK7 由本设备统一驱动：各开关按自己的"动作档位表"在
 * 手柄处于对应档位时接通。手柄本体（MasterController）与 7 个附属开关
 * （LKAuxContact）通过同一个 deviceid 共享本设备实例。
 */

/** 档位名称（索引 0..6） */
export const MASTER_POSITIONS = ['下降3', '下降2', '下降1', 'OFF', '上升1', '上升2', '上升3'];

/** LK1~LK7 动作档位表：1 = 该档位接通 */
export const LK_PATTERNS = {
    1: [0, 0, 0, 1, 0, 0, 0],   // 零位控制：仅 OFF
    2: [0, 0, 0, 0, 1, 1, 1],   // 正转控制：上升1/2/3
    3: [1, 1, 1, 0, 0, 0, 0],   // 反转控制：下降1/2/3
    4: [0, 0, 1, 0, 1, 0, 0],   // 低速控制：下降1、上升1
    5: [1, 1, 0, 0, 0, 1, 1],   // 中速控制：下降3/2、上升2/3
    6: [1, 0, 0, 0, 0, 0, 1],   // 高速控制：下降3、上升3
    7: [1, 1, 1, 0, 1, 1, 1],   // 电磁制动器控制：非零位均接通
};

export class MasterControllerDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = { position: 3 };   // 3 = OFF（中间零位）
    }

    getPosition() { return this.state.position; }

    setPosition(p) {
        this.state.position = Math.max(0, Math.min(6, Math.round(p)));
    }

    /** 手柄是否处于零位（OFF） */
    isOff() { return this.state.position === 3; }

    getPositionName() { return MASTER_POSITIONS[this.state.position] || ''; }

    /** LK 编号（1~7）在当前档位是否接通 */
    isLKClosed(lk) {
        const pat = LK_PATTERNS[lk];
        return !!pat && pat[this.state.position] === 1;
    }
}
