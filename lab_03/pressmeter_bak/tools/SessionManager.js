/**
 * SessionManager - 学员训练会话生命周期管理
 * 负责跟踪学员的完整操作过程，包括步骤完成、测验答题、故障触发及用户操作记录
 */
export class SessionManager {
    /**
     * @param {Object} pool - EquipmentPool 实例（预留）
     * @param {Object} eventBus - EventBus 实例
     */
    constructor(pool, eventBus) {
        this._pool = pool;
        this._eventBus = eventBus;
        this._session = null;
    }

    /**
     * 开始一个新的训练会话
     * @param {string} studentId - 学员 ID（如学号）
     * @param {string} workflowId - 流程 ID
     * @returns {Object} session 对象
     */
    start(studentId, workflowId) {
        this._session = {
            id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            studentId: studentId || 'unknown',
            workflowId: workflowId || 'unknown',
            startTime: Date.now(),
            endTime: null,
            steps: [],
            quizResults: [],
            faultsTriggered: [],
            actions: [],
        };
        if (this._eventBus) {
            this._eventBus.emit('session:action', {
                action: 'session:start',
                sessionId: this._session.id,
                studentId: this._session.studentId,
                workflowId: this._session.workflowId,
                timestamp: this._session.startTime,
            });
        }
        return this._session;
    }

    /**
     * 结束当前会话
     * @returns {Object|null} 最终会话数据快照
     */
    end() {
        if (!this._session) return null;
        this._session.endTime = Date.now();
        const result = { ...this._session };
        if (this._eventBus) {
            this._eventBus.emit('session:action', {
                action: 'session:end',
                sessionId: this._session.id,
                timestamp: this._session.endTime,
            });
        }
        this._session = null;
        return result;
    }

    /**
     * 记录步骤完成情况
     * @param {number} idx - 步骤索引
     * @param {string} type - 步骤类型 (find/quiz/check/act)
     * @param {boolean} passed - 是否通过
     */
    logStep(idx, type, passed) {
        if (!this._session) return;
        const record = {
            idx,
            type,
            passed,
            timestamp: Date.now(),
            duration: this._session.steps.length === 0 ? 0
                : Date.now() - (this._session.steps[this._session.steps.length - 1]?.timestamp || this._session.startTime),
        };
        this._session.steps.push(record);
    }

    /**
     * 记录测验答题
     * @param {string|number} questionId - 题目标识
     * @param {boolean} correct - 是否正确
     * @param {*} answer - 用户选择的答案
     */
    logQuiz(questionId, correct, answer) {
        if (!this._session) return;
        this._session.quizResults.push({
            questionId,
            correct,
            answer,
            timestamp: Date.now(),
        });
    }

    /**
     * 记录触发的故障
     * @param {string} faultCode - 故障代码
     */
    logFault(faultCode) {
        if (!this._session) return;
        this._session.faultsTriggered.push({
            faultCode,
            timestamp: Date.now(),
        });
    }

    /**
     * 记录用户操作
     * @param {string} type - 操作类型 (click/connect/disconnect/adjust/...)
     * @param {string} target - 操作目标
     */
    logAction(type, target) {
        if (!this._session) return;
        this._session.actions.push({
            type,
            target,
            timestamp: Date.now(),
        });
    }

    /** 获取当前会话对象 */
    getCurrentSession() {
        return this._session;
    }

    /** 当前是否有活跃会话 */
    isActive() {
        return this._session !== null && this._session.endTime === null;
    }

    /** 获取会话已持续毫秒数 */
    getDuration() {
        if (!this._session) return 0;
        const end = this._session.endTime || Date.now();
        return end - this._session.startTime;
    }
}
