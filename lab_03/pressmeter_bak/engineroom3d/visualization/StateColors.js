/**
 * StateColors - 设备状态到 Three.js 颜色的映射
 */
export const STATE_COLORS = {
    normal:   0x4caf50,  // 绿
    warning:  0xff9800,  // 橙
    alarm:    0xf44336,  // 红
    stopped:  0x9e9e9e,  // 灰
    running:  0x2196f3,  // 蓝
    selected: 0xffeb3b,  // 黄 (高亮)
};

export function getStateColor(device) {
    if (!device) return STATE_COLORS.stopped;
    if (device.state && device.state.alarms && device.state.alarms.length > 0) return STATE_COLORS.alarm;
    if (device.state && device.state.running) return STATE_COLORS.running;
    return STATE_COLORS.stopped;
}
