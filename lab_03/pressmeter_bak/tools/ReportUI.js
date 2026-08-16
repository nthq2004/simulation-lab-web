/**
 * ReportUI - 学员报告查看面板
 * 显示已保存的报告列表，支持查看详情、导出 HTML、导出 JSON
 */
export class ReportUI {
    /**
     * @param {Object} reportGenerator - ReportGenerator 实例
     * @param {Object} sessionManager - SessionManager 实例
     * @param {Object} scoringEngine - ScoringEngine 实例
     */
    constructor(reportGenerator, sessionManager, scoringEngine) {
        this._reportGen = reportGenerator;
        this._sessionMgr = sessionManager;
        this._scoringEngine = scoringEngine;
        this._panel = null;
        this._panelBody = null;
    }

    /**
     * 获取当前面板的 HTML 结构（用于放入 side-panel）
     * @returns {string}
     */
    getPanelHTML() {
        return `
            <div style="display:flex;flex-direction:column;height:100%;">
                <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                    <button id="reportRefreshBtn" class="btn-small">刷新列表</button>
                    <button id="reportEndSessionBtn" class="btn-small" style="border-color:#e67e22;color:#e67e22;">
                        ${this._sessionMgr && this._sessionMgr.isActive() ? '结束本次会话并评分' : '开始新会话'}
                    </button>
                </div>
                <div id="reportSessionStatus" style="font-size:11px;color:#95a5a6;margin-bottom:6px;padding:4px 6px;background:#2c3e50;border-radius:4px;">
                    ${this._getSessionStatusText()}
                </div>
                <div style="font-size:12px;font-weight:bold;margin-bottom:6px;color:#bdc3c7;">已保存的报告</div>
                <div id="reportList" style="flex:1;overflow-y:auto;min-height:100px;background:#2c3e50;border-radius:4px;padding:4px;">
                    <div style="text-align:center;padding:20px;color:#7f8c8d;">点击刷新加载报告</div>
                </div>
                <div id="reportDetailArea" style="display:none;margin-top:8px;padding:8px;background:#2c3e50;border-radius:4px;max-height:300px;overflow-y:auto;"></div>
            </div>
        `;
    }

    /**
     * 绑定面板事件（需在 DOM 插入后调用）
     */
    bindEvents() {
        const refreshBtn = document.getElementById('reportRefreshBtn');
        if (refreshBtn) refreshBtn.onclick = () => this.refreshList();

        const endBtn = document.getElementById('reportEndSessionBtn');
        if (endBtn) endBtn.onclick = () => this._handleEndSession();

        this.refreshList();
    }

    /**
     * 获取当前会话状态文本
     */
    _getSessionStatusText() {
        if (this._sessionMgr && this._sessionMgr.isActive()) {
            const session = this._sessionMgr.getCurrentSession();
            const steps = session.steps ? session.steps.length : 0;
            const quiz = session.quizResults ? session.quizResults.length : 0;
            const duration = this._sessionMgr.getDuration();
            const sec = Math.floor(duration / 1000);
            return `会话进行中 - 步骤: ${steps} | 答题: ${quiz} | 用时: ${sec}秒`;
        }
        return '当前无活跃会话';
    }

    /**
     * 处理结束会话按钮点击
     */
    async _handleEndSession() {
        if (this._sessionMgr && this._sessionMgr.isActive()) {
            const sessionData = this._sessionMgr.end();
            if (sessionData) {
                const scoreData = this._scoringEngine.calculate(sessionData);
                const reportId = await this._reportGen.saveToDB(sessionData, scoreData);
                if (reportId > 0) {
                    this._showDetail(reportId);
                }
                this.refreshList();
            }
        } else {
            // 如果当前没有活跃会话，提示先开始训练
            alert('请先选择训练项目并开始操作后，再进行评分。');
        }
        // 更新状态显示
        this._updateStatus();
    }

    /**
     * 开始新会话（由外部调用）
     * @param {string} studentId
     * @param {string} workflowId
     */
    startSession(studentId, workflowId) {
        if (this._sessionMgr) {
            this._sessionMgr.start(studentId, workflowId);
            this._updateStatus();
        }
    }

    /**
     * 刷新报告列表
     */
    async refreshList() {
        const listEl = document.getElementById('reportList');
        if (!listEl) return;

        try {
            const reports = await this._reportGen.getAllReports();
            if (reports.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#7f8c8d;">暂无保存的报告</div>';
                return;
            }

            listEl.innerHTML = '';
            reports.forEach(r => {
                const item = document.createElement('div');
                Object.assign(item.style, {
                    padding: '8px 10px',
                    margin: '4px 0',
                    background: '#34495e',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                });
                item.onmouseenter = () => { item.style.background = '#4a6785'; };
                item.onmouseleave = () => { item.style.background = '#34495e'; };

                const student = r.studentId || (r.session && r.session.studentId) || '未知';
                const workflow = r.workflowId || (r.session && r.session.workflowId) || '未知';
                const score = r.totalScore != null ? r.totalScore : (r.score ? r.score.totalScore : 0);
                const savedAt = r.savedAt ? new Date(r.savedAt).toLocaleString('zh-CN') : '';

                item.innerHTML = `
                    <div style="font-size:12px;font-weight:bold;color:#ecf0f1;">${student} - ${workflow}</div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:#95a5a6;margin-top:4px;">
                        <span>${savedAt}</span>
                        <span style="color:${score >= 80 ? '#27ae60' : (score >= 60 ? '#f39c12' : '#e74c3c')};font-weight:bold;">${score} 分</span>
                    </div>
                `;

                item.onclick = () => this._showDetail(r.id);
                listEl.appendChild(item);
            });
        } catch (err) {
            console.error('[ReportUI] refreshList error:', err);
            listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#e74c3c;">加载失败</div>';
        }
    }

    /**
     * 显示指定报告的详情
     */
    async _showDetail(reportId) {
        const detailArea = document.getElementById('reportDetailArea');
        if (!detailArea) return;

        try {
            const report = await this._reportGen.getReport(reportId);
            if (!report) {
                detailArea.innerHTML = '<div style="color:#e74c3c;">未找到报告数据</div>';
                detailArea.style.display = 'block';
                return;
            }

            const sessionData = report.session;
            const scoreData = report.score;

            // 展示摘要
            const totalScore = scoreData ? (scoreData.totalScore || 0) : 0;
            const scoreClass = totalScore >= 80 ? '#27ae60' : (totalScore >= 60 ? '#f39c12' : '#e74c3c');
            const student = (sessionData && sessionData.studentId) || report.studentId || '未知';
            const workflow = (sessionData && sessionData.workflowId) || report.workflowId || '未知';

            let html = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:bold;">${student} - ${workflow}</span>
                    <span style="font-size:20px;font-weight:bold;color:${scoreClass};">${totalScore} 分</span>
                </div>
                <div style="font-size:11px;color:#95a5a6;margin-bottom:8px;">
                    保存时间: ${report.savedAt ? new Date(report.savedAt).toLocaleString('zh-CN') : ''}
                </div>
                <div style="display:flex;gap:6px;margin-bottom:8px;">
                    <button id="reportExportHtmlBtn" class="btn-small" style="border-color:#3498db;color:#3498db;">导出 HTML</button>
                    <button id="reportExportJsonBtn" class="btn-small" style="border-color:#9b59b6;color:#9b59b6;">导出 JSON</button>
                    <button id="reportDeleteBtn" class="btn-small btn-danger" style="margin-left:auto;">删除</button>
                </div>
            `;

            // 分数明细
            if (scoreData && scoreData.details) {
                html += '<div style="font-size:11px;border-top:1px solid #444;padding-top:6px;">';
                const labels = { quizScore: '测验', stepScore: '步骤', faultScore: '故障', efficiencyScore: '效率' };
                Object.entries(scoreData.details).forEach(([key, val]) => {
                    const label = labels[key] || key;
                    if (typeof val === 'number') {
                        html += `<div style="display:flex;justify-content:space-between;padding:2px 0;">
                            <span>${label}</span>
                            <span>${(val * 100).toFixed(1)}%</span>
                        </div>`;
                    }
                });
                html += '</div>';
            }

            // 步骤摘要
            const steps = (sessionData && sessionData.steps) || [];
            if (steps.length > 0) {
                const passed = steps.filter(s => s.passed).length;
                html += `<div style="font-size:11px;border-top:1px solid #444;padding-top:6px;margin-top:6px;">
                    <div style="display:flex;justify-content:space-between;">
                        <span>步骤完成</span>
                        <span>${passed}/${steps.length}</span>
                    </div>`;
                // 最近 5 条步骤
                const recentSteps = steps.slice(-5);
                recentSteps.forEach((s, i) => {
                    const statusText = s.passed ? '通过' : '未通过';
                    const color = s.passed ? '#27ae60' : '#e74c3c';
                    html += `<div style="display:flex;justify-content:space-between;padding:1px 0;color:#bdc3c7;">
                        <span>步骤 ${s.idx + 1}</span>
                        <span style="color:${color};">${statusText}</span>
                    </div>`;
                });
                html += '</div>';
            }

            detailArea.innerHTML = html;
            detailArea.style.display = 'block';

            // 绑定详情按钮
            const exportHtmlBtn = document.getElementById('reportExportHtmlBtn');
            if (exportHtmlBtn) exportHtmlBtn.onclick = () => this._exportHTML(report);

            const exportJsonBtn = document.getElementById('reportExportJsonBtn');
            if (exportJsonBtn) exportJsonBtn.onclick = () => this._exportJSON(report);

            const deleteBtn = document.getElementById('reportDeleteBtn');
            if (deleteBtn) deleteBtn.onclick = async () => {
                if (confirm('确定删除此报告？')) {
                    await this._reportGen.deleteReport(reportId);
                    detailArea.style.display = 'none';
                    this.refreshList();
                }
            };

        } catch (err) {
            console.error('[ReportUI] _showDetail error:', err);
            detailArea.innerHTML = '<div style="color:#e74c3c;">加载详情失败</div>';
            detailArea.style.display = 'block';
        }
    }

    /**
     * 导出 HTML 报告
     */
    _exportHTML(report) {
        const sessionData = report.session;
        const scoreData = report.score;
        const html = this._reportGen.toHTML(sessionData, scoreData);
        this._downloadFile(html, `report_${Date.now()}.html`, 'text/html;charset=utf-8');
    }

    /**
     * 导出 JSON 报告
     */
    _exportJSON(report) {
        const sessionData = report.session;
        const scoreData = report.score;
        const json = this._reportGen.toJSON(sessionData, scoreData);
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
        this._downloadFile(JSON.stringify(json, null, 2), `report_${Date.now()}.json`, 'application/json;charset=utf-8');
    }

    /**
     * 下载文件
     */
    _downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 更新会话状态显示
     */
    _updateStatus() {
        const statusEl = document.getElementById('reportSessionStatus');
        if (statusEl) {
            statusEl.textContent = this._getSessionStatusText();
        }
        // 更新按钮文字
        const endBtn = document.getElementById('reportEndSessionBtn');
        if (endBtn) {
            if (this._sessionMgr && this._sessionMgr.isActive()) {
                endBtn.textContent = '结束本次会话并评分';
                endBtn.style.borderColor = '#e67e22';
                endBtn.style.color = '#e67e22';
            } else {
                endBtn.textContent = '开始新会话';
                endBtn.style.borderColor = '#27ae60';
                endBtn.style.color = '#27ae60';
            }
        }
    }
}
