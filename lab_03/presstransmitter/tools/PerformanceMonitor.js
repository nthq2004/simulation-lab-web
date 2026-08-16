/**
 * PerformanceMonitor - 性能监测工具
 * 用于识别和追踪渲染、物理计算中的性能瓶颈
 */
export class PerformanceMonitor {
    constructor() {
        this.metrics = {
            renderLoop: { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 },
            batchDraw: { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 },
            physicUpdate: { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 },
            circuitSolve: { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 },
            topologyBuild: { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 },
        };
        this.enabled = false;
        this.logInterval = 5000; // 每 5 秒输出一次日志
        this.lastLogTime = 0;
    }

    /**
     * 启用性能监测
     */
    enable() {
        this.enabled = true;
        console.log('✓ 性能监测已启用');
    }

    /**
     * 禁用性能监测
     */
    disable() {
        this.enabled = false;
        console.log('✗ 性能监测已禁用');
    }

    /**
     * 记录指标
     * @param {string} metric - 指标名称
     * @param {number} duration - 耗时（毫秒）
     */
    recordMetric(metric, duration) {
        if (!this.enabled || !this.metrics[metric]) return;

        const m = this.metrics[metric];
        m.count++;
        m.totalTime += duration;
        m.minTime = Math.min(m.minTime, duration);
        m.maxTime = Math.max(m.maxTime, duration);

        // 如果超过 50ms，输出警告
        if (duration > 50) {
            console.warn(`⚠️ ${metric} 耗时过长: ${duration.toFixed(2)}ms`);
        }

        this._periodicLog();
    }

    /**
     * 包装函数进行性能测量
     */
    measure(metricName, fn) {
        if (!this.enabled) return fn();

        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        this.recordMetric(metricName, duration);
        return result;
    }

    /**
     * 异步函数的性能测量
     */
    async measureAsync(metricName, fn) {
        if (!this.enabled) return fn();

        const start = performance.now();
        const result = await fn();
        const duration = performance.now() - start;
        this.recordMetric(metricName, duration);
        return result;
    }

    /**
     * 定期输出性能报告
     */
    _periodicLog() {
        const now = performance.now();
        if (now - this.lastLogTime < this.logInterval) return;

        this.lastLogTime = now;
        console.log('═══ 性能监测报告 ═══');
        Object.entries(this.metrics).forEach(([name, m]) => {
            if (m.count === 0) return;
            const avg = (m.totalTime / m.count).toFixed(2);
            console.log(`${name}:
  - 调用次数: ${m.count}
  - 平均耗时: ${avg}ms
  - 最小耗时: ${m.minTime.toFixed(2)}ms
  - 最大耗时: ${m.maxTime.toFixed(2)}ms`);
        });
        console.log('═══════════════════');
    }

    /**
     * 获取简要摘要
     */
    getSummary() {
        const summary = {};
        Object.entries(this.metrics).forEach(([name, m]) => {
            if (m.count > 0) {
                summary[name] = {
                    avgTime: (m.totalTime / m.count).toFixed(2),
                    maxTime: m.maxTime.toFixed(2),
                    calls: m.count
                };
            }
        });
        return summary;
    }

    /**
     * 重置所有指标
     */
    reset() {
        Object.values(this.metrics).forEach(m => {
            m.count = 0;
            m.totalTime = 0;
            m.minTime = Infinity;
            m.maxTime = 0;
        });
    }
}

// 全局单例
export const perfMonitor = new PerformanceMonitor();
