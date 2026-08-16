
export class Workflow {
    /**
     * @param {Array} container - 设备参数定义 (需包含 id, voltage, currentResistance 等)
     * @param {Array} connections - 连线数组 (from, to, type)
     */
    constructor(sys) {
        this.sys = sys;
        this.container = sys.container;
        this._wfMode = null;
        this._workflowPanelEl = null;

        this._workflowIdx = 0;    // 指出当前流程进行到第几步
        this._workflow = null;
        this._isStepRunning = false;  //单步运行时，防止多次点击，只有当前步骤完成，单击才有效        
    }

    /**
     * 第一部分，通用流程面板
     * @param {Array} steps - 传入的步骤数组 (包含 msg, act, check)
     * @param {string} mode - 模式选择: 'show'(演示), 'train'(操练), 'eval'(评估)
     */
    openWorkflowPanel(mode) {
        if (this._workflowPanelEl) return;
        this._wfMode = mode;
        this._workflowIdx = 0;

        const panel = document.createElement('div');
        // ... 样式保持你提供的风格，仅调整内部逻辑 ...
        panel.id = 'workflow-panel';
        Object.assign(panel.style, {
            position: 'absolute', top: '0', right: '0', width: '340px', height: '100vh',
            background: '#cdcbcb', boxShadow: '-6px 0 18px rgba(0,0,0,0.2)', zIndex: 9998,
            padding: '12px', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif'
        });

        panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong id="wfTitle">操作流程 - ${mode === 'show' ? '自动演示' : (mode === 'step' ? '单步演示' : (mode === 'eval' ? '评估' : '操练'))}</strong>
            <button id="wfClose" style="padding:4px 8px">关闭</button>
        </div>
        <div id="wfList" style="overflow:auto;height:calc(100% - 128px);padding-right:6px; background:#f0f0f0; border-radius:4px"></div>
        <div id="wfFooter" style="margin-top:12px; padding:10px; text-align:center; border-top:1px solid #999; display:none"></div>
    `;

        this.container.appendChild(panel);
        this._workflowPanelEl = panel;

        // 初始渲染列表
        this._renderWorkflowList();

        // 关闭逻辑
        panel.querySelector('#wfClose').onclick = () => this.closeWorkflowPanel();

        // 根据模式启动不同的处理器
        if (mode === 'show') {
            this._runAutoDemo(); // 演示模式：自动执行
        }
        else if (mode === 'eval' || mode === 'train') {
            this._startWorkflowWatcher(); // 操练/评估模式：循环检测
        }
    }

    _renderWorkflowList() {
        if (!this._workflowPanelEl) return;
        const wfList = this._workflowPanelEl.querySelector('#wfList');
        wfList.innerHTML = '';

        this._workflow.forEach((step, idx) => {
            // 评估模式下，不显示当前Idx之后的步骤
            if (this._wfMode === 'eval' && idx >= this._workflowIdx) return;

            const item = document.createElement('div');
            item.style.padding = '10px';
            item.style.borderBottom = '1px solid #ccc';
            item.style.transition = 'all 0.3s';

            if (idx < this._workflowIdx) {
                // 已完成步骤
                item.style.background = '#e2f0e2';
                item.style.color = '#777';
                if (this._wfMode === 'eval') {
                    item.innerHTML = `✅ ${step.msg}`;
                } else {
                    item.style.textDecoration = 'line-through';
                    item.innerHTML = `✔ ${step.msg}`;
                }
            } else if (idx === this._workflowIdx) {
                // 当前进行步骤
                item.style.background = '#dbdae0';
                item.style.color = '#2d862d';
                item.style.fontWeight = 'bold';
                item.style.borderLeft = '4px solid #2d862d';
                item.innerHTML = `▶ ${step.msg}`;
            } else {
                // 等待步骤 (仅演示和操练可见)
                item.style.background = '#fff';
                item.style.color = '#333';
                item.innerHTML = `&nbsp;&nbsp;${step.msg}`;
            }
            wfList.appendChild(item);
            // --- 核心改动：自动滚动 ---
            if (idx === this._workflowIdx) {
                // 使用 requestAnimationFrame 确保在元素渲染完成后计算位置
                requestAnimationFrame(() => {
                    item.scrollIntoView({
                        behavior: 'smooth', // 平滑滚动
                        block: 'nearest'    // 滚动到最近的边缘，避免剧烈跳动
                    });
                });
            }
        });

        this._updateFooter();
    }

    // 全自动演示：循环调用单步演示
    async _runAutoDemo() {
        this._isAutoPlaying = true; // 标记正在全自动运行
        for (let i = this._workflowIdx; i < this._workflow.length; i++) {
            if (!this._workflowPanelEl || !this._isAutoPlaying) break;

            // 执行当前这一步
            await this._executeSingleStep(i);
            this._workflowIdx++;
            this._renderWorkflowList();

            // 自动模式下的每步间隔（给用户阅读时间）
            if (i < this._workflow.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        this._isAutoPlaying = false;
    }
    // 假设这是“下一步”按钮的操作
    stepByStep() {
        // 1. 如果动画正在运行，直接拦截
        if (this._isStepRunning) return;

        // 2. 检查面板是否存在，如果不存在，先调用开启面板的方法
        if (!this._workflowPanelEl) {
            console.log("面板未建立，正在初始化...");
            this.openWorkflowPanel('step'); // 假设这是你打开面板的方法，模式设为演示
            // 初始化后通常需要一小段渲染时间，直接返回，让用户第二次点击开始第一步
            // 或者在 openWorkflowPanel 内部完成后自动触发下一步
            return;
        }

        // 3. 检查是否已经全部演示完，如果完了，点击可以重置
        if (this._workflowIdx >= this._workflow.length) {
            console.log("演示已结束，重置进度");
            this.resetWorkflow(); // 重置索引和连线
            return;
        }

        // 4. 执行单步演示
        this._nextStepDemo();
    }
    // 单步演示：点击按钮调用此函数
    async _nextStepDemo() {
        // 状态锁，防止暴力点击
        this._isStepRunning = true;

        try {
            const step = this._workflow[this._workflowIdx];

            // 渲染列表（高亮当前即将执行的步骤）
            this._renderWorkflowList();

            // 执行动作并等待（内部已包含 addConnectionAnimated 的 Promise）
            if (step && step.act) {
                await step.act.call(this);
            }

            // 动作完成后，索引递增
            this._workflowIdx++;

            // 再次渲染（此时原步骤会变成“已完成”样式，并自动滚动）
            this._renderWorkflowList();
            this.redrawAll();

        } catch (err) {
            console.error("单步演示出错:", err);
        } finally {
            // 无论成功失败，最后都要解锁
            this._isStepRunning = false;
        }
    }

    // 核心执行私有函数：负责具体的渲染和动画
    async _executeSingleStep(idx) {
        this._workflowIdx = idx;
        this._renderWorkflowList();

        // 1. 预留一小段观察时间
        await new Promise(resolve => setTimeout(resolve, 500));

        // 2. 执行动作
        const step = this._workflow[idx];
        if (step.mode === 'find') {
            // 自动指出部件位置
            await this._simulateAutoClick(step.target);
        }
        else if (step.mode === 'quiz') {
            // 自动展示正确答案
            await this._simulateAutoQuiz(step.quizConfig);
        }
        if (step.act) {
            // 等待动画彻底完成
            await step.act.call(this);
        }

        this.sys.redrawAll();
    }
    resetWorkflow() {
        this._workflowIdx = 0;
        if (this.sys.clear) this.sys.clear();
        if (this._workflowPanelEl) this._renderWorkflowList();
    }
    _startWorkflowWatcher() {
        // 停止之前的监听
        this._isWatcherRunning = true;
        this._hasCurrentQuizOpened = false;

        const watch = async () => {
            // 检查是否结束或面板已关闭
            if (!this._isWatcherRunning || !this._workflowPanelEl || this._workflowIdx >= this._workflow.length) {
                return;
            }

            const step = this._workflow[this._workflowIdx];

            // --- 评估模式下的逻辑判断 ---
            if (step.mode === 'find') {
                // 只有当点击记录匹配目标时才放行
                if (this.sys.lastClickedId === step.target) {
                    this.sys.lastClickedId = null; // 消耗掉点击
                    this._onStepPass();
                }
            }
            else if (step.mode === 'quiz') {
                if (!this._hasCurrentQuizOpened) {
                    this._hasCurrentQuizOpened = true;
                    const isCorrect = await this.showQuiz(step.quizConfig); // 阻塞式弹出
                    if (isCorrect) {
                        this._hasCurrentQuizOpened = false;
                        this._onStepPass();
                    } else {
                        this._hasCurrentQuizOpened = false; // 答错则下次轮询再次弹出
                    }
                }
            }
            else if (step.check) {
                // --- 关键点：等待异步 check 的结果 ---
                // 这里会等待 check() 内部的 6s 延时结束
                const isPassed = await step.check.call(this);

                if (isPassed) {
                    this._onStepPass();
                }
            }

            // 无论是否通过，等待 1 秒后进行下一次轮询
            setTimeout(watch, 1000);
        };

        watch();
    }

    _onStepPass() {
        this.sys.lastClickedId = null;
        this._workflowIdx++;
        this._renderWorkflowList();
        // 触发自动滚动
        const wfList = this._workflowPanelEl.querySelector('#wfList');
        if (wfList) {
            wfList.scrollTo({
                top: wfList.scrollHeight,
                behavior: 'smooth'
            });
        }
    }
    // 别忘了在关闭面板或切换任务时停止监听
    _stopWorkflowWatcher() {
        this._isWatcherRunning = false;
    }
    _updateFooter() {
        const footer = this._workflowPanelEl.querySelector('#wfFooter');
        footer.style.display = 'block';

        if (this._workflowIdx >= this._workflow.length) {
            footer.style.background = '#d4edda';
            footer.style.color = '#155724';
            footer.innerHTML = this._wfMode === 'train'
                ? '🏁 演练完成！'
                : (this._wfMode === 'eval' ? '🏆 评估合格！' : '📺 演示完成');
        } else {
            footer.style.background = '#fff3cd';
            footer.style.color = '#856404';
            footer.innerHTML = `进度: ${this._workflowIdx + 1} / ${this._workflow.length}`;
        }
    }
    closeWorkflowPanel() {
        if (!this._workflowPanelEl) return;
        this._stopWorkflowWatcher();
        try { this.container.removeChild(this._workflowPanelEl); } catch (e) { }
        this._workflowPanelEl = null;
    }

    /**
     * 模拟自动点击效果
     */
    async _simulateAutoClick(targetId) {
        const comp = this.sys.comps[targetId];
        if (!comp) return;

        // 1. 视觉高亮 (给学员看点的是哪儿)
        comp.highlight && comp.highlight(true);

        // 2. 停留 1.5 秒让学员看清楚
        await new Promise(r => setTimeout(r, 1500));

        comp.highlight && comp.highlight(false);
    }

    /**
     * 模拟自动答题效果
     */
    async _simulateAutoQuiz(quizConfig) {
        const rightAnswer = quizConfig.options[quizConfig.answer];

        // 在消息框或悬浮气泡中显示正确答案，而不是弹出阻塞式窗口
        this.sys.showFloatingTip(`【演示】正确答案是：${rightAnswer}`, 10000);

        await new Promise(r => setTimeout(r, 10000));
    }
    /**
     * 弹出选择题考核对话框 (兼容单选与多选，限制在容器内)
     * @param {Object} config - { question, options, answer, analysis, isMultiple }
     * @param {Array|number} config.answer - 多选为索引数组 [0, 2]，单选为数字 1
     */
    showQuiz(config) {
        return new Promise((resolve) => {
            const parent = this.sys.container;
            const isMultiple = config.isMultiple || Array.isArray(config.answer);

            // 存储用户选中的索引
            let selectedIndices = [];

            if (getComputedStyle(parent).position === 'static') {
                parent.style.position = 'relative';
            }

            const mask = document.createElement('div');
            Object.assign(mask.style, {
                position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                background: 'rgba(0,0,0,0.6)', zIndex: '100',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            });

            const box = document.createElement('div');
            Object.assign(box.style, {
                background: '#fff', width: '85%', maxWidth: '500px',
                borderRadius: '12px', padding: '20px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
            });

            // 1. 标题增加类型提示
            const typeTag = isMultiple ? '[多选题]' : '[单选题]';
            box.innerHTML = `
            <div style="color:#1395eb; font-size:16px; margin-bottom:5px; font-weight:bold;">${typeTag}</div>
            <div style="font-weight:bold; margin-bottom:15px; line-height:1.4;">${config.question}</div>
            <div id="options-wrapper"></div>
        `;

            const wrapper = box.querySelector('#options-wrapper');
            const letters = ['A', 'B', 'C', 'D'];
            const optionNodes = [];

            // 2. 生成选项
            config.options.forEach((text, index) => {
                const btn = document.createElement('button');
                Object.assign(btn.style, {
                    width: '100%', padding: '12px', margin: '6px 0',
                    border: '1px solid #ddd', borderRadius: '8px',
                    background: '#fcfcfc', textAlign: 'left', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', transition: 'all 0.2s'
                });

                btn.innerHTML = `
                <span class="idx-tag" style="width:24px; height:24px; line-height:24px; text-align:center; 
                    border:1px solid #1395eb; color:#1395eb; border-radius:4px; margin-right:10px; font-weight:bold;">
                    ${letters[index]}
                </span>
                <span style="flex:1;font-size:16px;">${text}</span>
            `;

                btn.onclick = () => {
                    if (box.querySelector('.analysis-done')) return; // 已提交则锁定

                    if (isMultiple) {
                        // 多选逻辑：切换选中
                        if (selectedIndices.includes(index)) {
                            selectedIndices = selectedIndices.filter(i => i !== index);
                            btn.style.background = '#fcfcfc';
                            btn.style.borderColor = '#ddd';
                        } else {
                            selectedIndices.push(index);
                            btn.style.background = '#e3f2fd';
                            btn.style.borderColor = '#1395eb';
                        }
                    } else {
                        // 单选逻辑：互斥选中
                        selectedIndices = [index];
                        optionNodes.forEach(n => {
                            n.style.background = '#fcfcfc';
                            n.style.borderColor = '#ddd';
                        });
                        btn.style.background = '#e3f2fd';
                        btn.style.borderColor = '#1395eb';
                    }
                };

                wrapper.appendChild(btn);
                optionNodes.push(btn);
            });

            // 3. 提交按钮
            const submitBtn = document.createElement('button');
            submitBtn.innerText = '确认提交';
            Object.assign(submitBtn.style, {
                marginTop: '15px', width: '100%', padding: '12px',
                background: '#1395eb', color: '#fff', border: 'none',
                borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'
            });

            submitBtn.onclick = () => {
                if (selectedIndices.length === 0) return alert('请先选择答案');
                if (box.querySelector('.analysis-done')) return;

                // 校验答案
                let isCorrect = false;
                if (isMultiple) {
                    // 多选：数组内容一致（忽略顺序）
                    isCorrect = config.answer.length === selectedIndices.length &&
                        config.answer.every(val => selectedIndices.includes(val));
                } else {
                    // 单选
                    isCorrect = selectedIndices[0] === config.answer;
                }

                // 视觉反馈：标出正确和错误
                optionNodes.forEach((node, idx) => {
                    const isItemCorrect = isMultiple ? config.answer.includes(idx) : idx === config.answer;
                    const isItemSelected = selectedIndices.includes(idx);

                    if (isItemCorrect) {
                        node.style.borderColor = '#4caf50';
                        node.style.background = '#e8f5e9';
                    } else if (isItemSelected) {
                        node.style.borderColor = '#f44336';
                        node.style.background = '#ffebee';
                    }
                    node.disabled = true;
                });

                // 显示解析
                const ana = document.createElement('div');
                ana.className = 'analysis-done';
                Object.assign(ana.style, {
                    marginTop: '15px', padding: '12px', fontSize: '13px',
                    background: isCorrect ? '#f1f8e9' : '#fff3e0',
                    borderLeft: `4px solid ${isCorrect ? '#4caf50' : '#ff9800'}`,
                    borderRadius: '4px'
                });

                const resultText = isCorrect ?
                    '<span style="color:#2e7d32; font-weight:bold;">✓ 回答正确</span>' :
                    '<span style="color:#d84315; font-weight:bold;">✕ 回答错误</span>';

                ana.innerHTML = `
                <div style="margin-bottom:5px;">${resultText}</div>
                <div style="color:#555; line-height:1.5;">${config.analysis || '请参考设备操作规程。'}</div>
            `;

                const nextBtn = document.createElement('button');
                nextBtn.innerText = '完成，返回操作';
                Object.assign(nextBtn.style, {
                    marginTop: '10px', width: '100%', padding: '10px',
                    background: '#455a64', color: '#fff', border: 'none', borderRadius: '4px'
                });

                nextBtn.onclick = () => {
                    parent.removeChild(mask);
                    resolve(isCorrect);
                };

                box.appendChild(ana);
                box.appendChild(nextBtn);
                submitBtn.style.display = 'none'; // 隐藏提交按钮
            };

            box.appendChild(submitBtn);
            mask.appendChild(box);
            parent.appendChild(mask);
        });
    }
}