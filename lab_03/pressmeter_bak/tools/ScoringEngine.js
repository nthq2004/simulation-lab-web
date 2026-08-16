/**
 * ScoringEngine - 学员训练评分引擎
 * 从完成会话数据中计算综合得分，包含测验正确率、步骤完成度、故障修复效率、操作效率
 */
export class ScoringEngine {
    constructor() {
        this._weights = {
            quizAccuracy: 0.4,      // 测验正确率权重
            stepCompletion: 0.3,    // 步骤完成度权重
            faultResolution: 0.2,   // 故障修复时间权重
            efficiency: 0.1,        // 效率权重
        };
    }

    /**
     * 设置评分权重
     * @param {Object} weights - { quizAccuracy, stepCompletion, faultResolution, efficiency }
     */
    setWeights(weights) {
        Object.assign(this._weights, weights);
    }

    /**
     * 计算会话综合得分
     * @param {Object} sessionData - 完整的会话数据（SessionManager.end() 的返回值）
     * @returns {Object} { totalScore, details, weights }
     */
    calculate(sessionData) {
        if (!sessionData) {
            return { totalScore: 0, details: {}, weights: this._weights };
        }

        const quizScore = this._calcQuizAccuracy(sessionData.quizResults);
        const stepScore = this._calcStepCompletion(sessionData.steps);
        const faultScore = this._calcFaultResolution(sessionData);
        const efficiencyScore = this._calcEfficiency(sessionData);

        const total =
            quizScore * this._weights.quizAccuracy +
            stepScore * this._weights.stepCompletion +
            faultScore * this._weights.faultResolution +
            efficiencyScore * this._weights.efficiency;

        return {
            totalScore: Math.round(total * 100) / 100,
            details: {
                quizScore: Math.round(quizScore * 10000) / 10000,
                stepScore: Math.round(stepScore * 10000) / 10000,
                faultScore: Math.round(faultScore * 10000) / 10000,
                efficiencyScore: Math.round(efficiencyScore * 10000) / 10000,
            },
            weights: { ...this._weights },
        };
    }

    /**
     * 计算测验正确率得分 (0~1)
     * @param {Array} quizResults
     */
    _calcQuizAccuracy(quizResults) {
        if (!quizResults || quizResults.length === 0) return 0;
        const correct = quizResults.filter(q => q.correct).length;
        return correct / quizResults.length;
    }

    /**
     * 计算步骤完成度得分 (0~1)
     * @param {Array} steps
     */
    _calcStepCompletion(steps) {
        if (!steps || steps.length === 0) return 0;
        const passed = steps.filter(s => s.passed).length;
        return passed / steps.length;
    }

    /**
     * 计算故障修复得分 (0~1)
     * 基于发生故障后是否在合理时间内完成修复（步骤中是否全部通过）
     * 无故障时此项满分
     */
    _calcFaultResolution(sessionData) {
        if (!sessionData) return 0;
        const { faultsTriggered, steps } = sessionData;
        if (!faultsTriggered || faultsTriggered.length === 0) {
            return 1; // 无故障则满分
        }
        // 有故障时，全部步骤通过视为已解决
        if (!steps || steps.length === 0) return 0;
        const passed = steps.filter(s => s.passed).length;
        return passed / steps.length;
    }

    /**
     * 计算效率得分 (0~1)
     * 预设期望时间 30 分钟（1800000ms），超出则降分
     */
    _calcEfficiency(sessionData) {
        if (!sessionData) return 0;
        const { startTime, endTime } = sessionData;
        if (!startTime || !endTime) return 0;

        const expectedTime = 30 * 60 * 1000; // 30 分钟
        const actualTime = endTime - startTime;

        if (actualTime <= 0) return 0;
        if (actualTime >= expectedTime * 3) return 0.1; // 超时 3 倍最低分

        // 线性衰减：在规定时间内完成得满分，超出按比例递减
        const ratio = actualTime / expectedTime;
        if (ratio <= 1) return 1;
        return Math.max(0.1, 1 - (ratio - 1) * 0.45);
    }
}
