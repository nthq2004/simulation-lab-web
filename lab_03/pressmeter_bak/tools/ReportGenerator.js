/**
 * ReportGenerator - 学员训练报告生成器
 * 将会话数据和评分数据生成 HTML 报告、JSON 数据，并支持保存到 IndexedDB
 */
export class ReportGenerator {
    constructor() {
        this._db = null;
        this._initDB();
    }

    /**
     * 初始化 IndexedDB（复用 PressmeterDB 的 reports 存储）
     */
    async _initDB() {
        this._db = new Promise((resolve, reject) => {
            const req = indexedDB.open('PressmeterDB', 3);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('alarms')) {
                    db.createObjectStore('alarms', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('snapshots')) {
                    db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('actions')) {
                    db.createObjectStore('actions', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('reports')) {
                    db.createObjectStore('reports', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => {
                console.error('[ReportGenerator] DB open error:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    async _getDB() {
        const db = await this._db;
        if (!db) throw new Error('[ReportGenerator] Database not initialized');
        return db;
    }

    /* ==================== 工具方法 ==================== */

    _fmtTime(ts) {
        if (!ts) return '-';
        return new Date(ts).toLocaleString('zh-CN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }

    _fmtDuration(ms) {
        if (!ms || ms <= 0) return '0秒';
        const sec = Math.floor(ms / 1000);
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        return min > 0 ? `${min}分${s}秒` : `${s}秒`;
    }

    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ==================== HTML 报告生成 ==================== */

    /**
     * 生成完整的 HTML 报告字符串
     * @param {Object} sessionData - 会话数据
     * @param {Object} scoreData - 评分结果
     * @returns {string} HTML 字符串
     */
    toHTML(sessionData, scoreData) {
        if (!sessionData) return '<p>无会话数据</p>';

        const duration = sessionData.endTime
            ? sessionData.endTime - sessionData.startTime
            : 0;
        const totalScore = scoreData && scoreData.totalScore != null ? scoreData.totalScore : 0;

        let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>训练报告</title>
<style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
    h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
    h2 { color: #2980b9; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { padding: 8px 12px; text-align: left; border: 1px solid #ddd; }
    th { background: #f5f7fa; font-weight: bold; }
    .pass { color: #27ae60; font-weight: bold; }
    .fail { color: #e74c3c; font-weight: bold; }
    .score-box { display: inline-block; padding: 10px 20px; border-radius: 8px; font-size: 24px; font-weight: bold; margin: 10px 0; }
    .score-high { background: #d4edda; color: #155724; }
    .score-mid { background: #fff3cd; color: #856404; }
    .score-low { background: #f8d7da; color: #721c24; }
    .section { margin: 16px 0; padding: 12px; background: #fafafa; border-radius: 6px; border-left: 4px solid #3498db; }
    .step-item { padding: 6px 0; border-bottom: 1px solid #eee; }
    .step-item:last-child { border-bottom: none; }
    .fault-item { color: #e74c3c; }
</style>
</head><body>
<h1>学员训练报告</h1>
<div class="section">
    <p><strong>学员编号：</strong>${this._escapeHtml(sessionData.studentId || '未知')}</p>
    <p><strong>训练项目：</strong>${this._escapeHtml(sessionData.workflowId || '未知')}</p>
    <p><strong>开始时间：</strong>${this._fmtTime(sessionData.startTime)}</p>
    <p><strong>结束时间：</strong>${this._fmtTime(sessionData.endTime)}</p>
    <p><strong>总用时：</strong>${this._fmtDuration(duration)}</p>
</div>`;

        // 分数摘要
        const scoreClass = totalScore >= 80 ? 'score-high' : (totalScore >= 60 ? 'score-mid' : 'score-low');
        html += `<h2>成绩摘要</h2>
<div class="section">
    <div class="score-box ${scoreClass}">${totalScore} 分</div>
    <table>
        <tr><th>项目</th><th>分数</th><th>权重</th></tr>`;

        if (scoreData && scoreData.details) {
            const labels = {
                quizScore: '测验正确率',
                stepScore: '步骤完成度',
                faultScore: '故障修复',
                efficiencyScore: '操作效率',
            };
            const weightLabels = {
                quizAccuracy: '测验正确率',
                stepCompletion: '步骤完成度',
                faultResolution: '故障修复',
                efficiency: '操作效率',
            };
            Object.entries(scoreData.details).forEach(([key, val]) => {
                const label = labels[key] || key;
                if (typeof val === 'number') {
                    html += `<tr><td>${label}</td><td>${(val * 100).toFixed(1)}%</td>`;
                    const wKey = Object.keys(scoreData.weights || {}).find(
                        wk => weightLabels[wk] === label || wk === key.replace('Score', '').replace('efficiency', 'efficiency')
                    );
                    const wKey2 = {
                        quizScore: 'quizAccuracy',
                        stepScore: 'stepCompletion',
                        faultScore: 'faultResolution',
                        efficiencyScore: 'efficiency',
                    }[key];
                    const w = scoreData.weights && scoreData.weights[wKey2 || wKey];
                    html += `<td>${w != null ? (w * 100) + '%' : '-'}</td></tr>`;
                }
            });
        }
        html += `</table>
</div>`;

        // 步骤列表
        const steps = sessionData.steps || [];
        html += `<h2>步骤完成情况</h2>
<div class="section">`;
        if (steps.length === 0) {
            html += '<p>无步骤记录</p>';
        } else {
            steps.forEach((s, i) => {
                const statusClass = s.passed ? 'pass' : 'fail';
                const statusText = s.passed ? '通过' : '未通过';
                const typeLabel = { find: '查找', quiz: '测验', check: '检测', act: '操作' }[s.type] || s.type;
                html += `<div class="step-item">
                    <strong>步骤 ${i + 1}</strong> [${typeLabel}]
                    <span class="${statusClass}">${statusText}</span>
                    ${s.duration ? `(用时: ${this._fmtDuration(s.duration)})` : ''}
                </div>`;
            });
        }
        html += `</div>`;

        // 测验结果
        const quizResults = sessionData.quizResults || [];
        html += `<h2>测验结果</h2>
<div class="section">`;
        if (quizResults.length === 0) {
            html += '<p>无测验记录</p>';
        } else {
            html += '<table><tr><th>题目</th><th>结果</th></tr>';
            quizResults.forEach((q, i) => {
                const statusClass = q.correct ? 'pass' : 'fail';
                const statusText = q.correct ? '正确' : '错误';
                html += `<tr>
                    <td>${this._escapeHtml(q.questionId != null ? '第 ' + (i + 1) + ' 题' : '')}</td>
                    <td class="${statusClass}">${statusText}</td>
                </tr>`;
            });
            html += '</table>';
        }
        html += `</div>`;

        // 时间线（操作记录）
        const actions = sessionData.actions || [];
        html += `<h2>操作时间线</h2>
<div class="section">`;
        if (actions.length === 0) {
            html += '<p>无操作记录</p>';
        } else {
            html += '<table><tr><th>时间</th><th>操作</th><th>目标</th></tr>';
            actions.forEach(a => {
                html += `<tr>
                    <td>${this._fmtTime(a.timestamp)}</td>
                    <td>${this._escapeHtml(a.type)}</td>
                    <td>${this._escapeHtml(a.target)}</td>
                </tr>`;
            });
            html += '</table>';
        }
        html += `</div>`;

        // 故障记录
        const faults = sessionData.faultsTriggered || [];
        html += `<h2>故障记录</h2>
<div class="section">`;
        if (faults.length === 0) {
            html += '<p>无故障触发</p>';
        } else {
            faults.forEach(f => {
                html += `<div class="fault-item">
                    <strong>故障代码：</strong>${this._escapeHtml(f.faultCode)}
                    <span>(${this._fmtTime(f.timestamp)})</span>
                </div>`;
            });
        }
        html += `</div>`;

        html += `</body></html>`;
        return html;
    }

    /* ==================== JSON 报告生成 ==================== */

    /**
     * 生成 JSON 格式报告
     * @param {Object} sessionData - 会话数据
     * @param {Object} scoreData - 评分结果
     * @returns {Object}
     */
    toJSON(sessionData, scoreData) {
        return {
            session: sessionData,
            score: scoreData,
            generatedAt: Date.now(),
        };
    }

    /* ==================== 保存到 IndexedDB ==================== */

    /**
     * 保存报告到 IndexedDB
     * @param {Object} sessionData - 会话数据
     * @param {Object} scoreData - 评分结果
     * @returns {Promise<number>} 报告 ID
     */
    async saveToDB(sessionData, scoreData) {
        try {
            const record = {
                session: sessionData,
                score: scoreData,
                savedAt: Date.now(),
                studentId: (sessionData && sessionData.studentId) || 'unknown',
                workflowId: (sessionData && sessionData.workflowId) || 'unknown',
                totalScore: (scoreData && scoreData.totalScore) || 0,
            };
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('reports', 'readwrite');
                const store = tx.objectStore('reports');
                const req = store.add(record);
                req.onsuccess = () => resolve(req.result);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[ReportGenerator] saveToDB error:', err);
            return -1;
        }
    }

    /**
     * 获取所有保存的报告（按保存时间倒序）
     * @returns {Promise<Array>}
     */
    async getAllReports() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('reports', 'readonly');
                const store = tx.objectStore('reports');
                const req = store.getAll();
                req.onsuccess = () => {
                    const records = req.result || [];
                    records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                    resolve(records);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[ReportGenerator] getAllReports error:', err);
            return [];
        }
    }

    /**
     * 按 ID 获取报告
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    async getReport(id) {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('reports', 'readonly');
                const store = tx.objectStore('reports');
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[ReportGenerator] getReport error:', err);
            return null;
        }
    }

    /**
     * 删除报告
     * @param {number} id
     */
    async deleteReport(id) {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('reports', 'readwrite');
                const store = tx.objectStore('reports');
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[ReportGenerator] deleteReport error:', err);
        }
    }
}
