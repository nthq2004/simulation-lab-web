
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

        // 未选择任务时 _workflow 可能为 null，直接显示提示，避免 forEach 崩溃
        if (!this._workflow || !Array.isArray(this._workflow)) {
            wfList.innerHTML = '<div style="padding:10px;color:#888">请先在顶部下拉框选择操作项目，再开始演示/演练。</div>';
            this._updateFooter();
            return;
        }

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
        // 未选择任务时直接退出（面板已显示提示）
        if (!this._workflow || !Array.isArray(this._workflow) || this._workflow.length === 0) {
            this._isAutoPlaying = false;
            return;
        }
        for (let i = this._workflowIdx; i < this._workflow.length; i++) {
            if (!this._workflowPanelEl || !this._isAutoPlaying) break;

            // 执行当前这一步
            const step = this._workflow[i];
            await this._executeSingleStep(i);
            this._workflowIdx++;
            this._renderWorkflowList();

            // 事件发射：通知外部自动演示步骤完成
            if (this.sys && this.sys.eventBus) {
                this.sys.eventBus.emit('workflow:step', {
                    idx: i,
                    mode: step ? step.mode : null,
                    passed: true,
                    timestamp: Date.now(),
                });
            }

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
            const idx = this._workflowIdx;

            // 渲染列表（高亮当前即将执行的步骤）
            this._renderWorkflowList();

            // 执行动作并等待（内部已包含 addConnectionAnimated 的 Promise）
            if (step && step.act) {
                await step.act.call(this);
            }

            // 动作完成后，索引递增
            this._workflowIdx++;

            // 再次渲染（此时原步骤会变成”已完成”样式，并自动滚动）
            this._renderWorkflowList();
            this.redrawAll();

            // 事件发射：通知外部步骤完成
            if (this.sys && this.sys.eventBus) {
                this.sys.eventBus.emit('workflow:step', {
                    idx,
                    mode: step ? step.mode : null,
                    passed: true,
                    timestamp: Date.now(),
                });
            }

        } catch (err) {
            console.error('单步演示出错:', err);
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
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 2. 执行动作
        const step = this._workflow[idx];
        if (step.mode === 'find') {
            // 自动指出部件位置
            await this._simulateAutoClick(step.target, step.subTarget);
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
        // 强制同步重绘，确保演示动作后的外观立即更新（不依赖物理循环消费延迟标记）
        try {
            if (this.sys.layer) this.sys.layer.draw();
            if (this.sys.lineLayer) this.sys.lineLayer.draw();
        } catch (e) { /* ignore */ }
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
                if (step.subTarget) {
                    // 子部件识别：点击电池内部的隔板/极板等
                    var expectId = step.target + '/' + step.subTarget;
                    if (this.sys.lastClickedPartId === expectId) {
                        this.sys.lastClickedPartId = null;
                        this._onStepPass();
                    }
                } else {
                    // 整组件识别
                    if (this.sys.lastClickedId === step.target) {
                        this.sys.lastClickedId = null;
                        this._onStepPass();
                    }
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
        this.sys.lastClickedPartId = null;
        const idx = this._workflowIdx;
        const mode = this._workflow && this._workflow[idx] ? this._workflow[idx].mode : null;
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
        // 事件发射：通知外部步骤通过
        if (this.sys && this.sys.eventBus) {
            this.sys.eventBus.emit('workflow:step', {
                idx,
                mode,
                passed: true,
                timestamp: Date.now(),
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
     * 模拟自动点击效果（展示 → 延时 → 动作 节奏）
     * 采用“闪烁箭头 + 延时动作”模式：
     *  1. 在目标部件上叠加红色系闪烁箭头（外层半透明光晕箭头 + 内层实心箭头 + 虚线圆圈标记）
     *  2. 约 500ms 间隔切换显隐，产生闪烁效果
     *  3. 持续约 3000ms 后移除箭头，再延时 1~2s 给学员观察时间
     */
    async _simulateAutoClick(targetId, subTarget) {
        const comp = this.sys.comps[targetId];
        if (!comp) return;

        // 1. 视觉高亮 (给学员看点的是哪儿)
        comp.highlight && comp.highlight(true);

        // 浮动提示：说明“请点击 xxx”
        const partNames = { 'pos-plate': '正极板（PbO₂）', 'neg-plate': '负极板（Pb）', 'separator': '隔板' };
        const tipText = subTarget
            ? (partNames[subTarget] || subTarget)
            : (comp.config?.label || comp.label || targetId);
        this.sys.showFloatingTip('【演示】请点击：' + tipText, 3500);

        // 2. 闪烁箭头 + 虚线圆圈标记（红色系 #e74c3c）
        const sys = this.sys;
        const layer = sys.layer;
        const box = comp.group ? comp.group.getClientRect({ relativeTo: sys.stage }) : null;
        let arrow, arrowHalo, dashCircle, timer = null;
        if (box) {
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            const dist = box.height / 2 + 55;
            const headIn = box.height / 2 + 10;

            // 外层半透明光晕箭头
            arrowHalo = new Konva.Arrow({
                points: [cx, cy - dist - 10, cx, cy - headIn],
                pointerLength: 24, pointerWidth: 22,
                fill: 'rgba(231,76,60,0.35)', stroke: 'rgba(231,76,60,0.35)', strokeWidth: 10,
                listening: false
            });
            // 内层实心箭头
            arrow = new Konva.Arrow({
                points: [cx, cy - dist, cx, cy - headIn],
                pointerLength: 16, pointerWidth: 13,
                fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 4,
                listening: false
            });
            // 顶部虚线圆圈标记
            dashCircle = new Konva.Circle({
                x: cx, y: cy,
                radius: Math.max(box.width, box.height) / 2 + 16,
                stroke: '#e74c3c', strokeWidth: 3, dash: [8, 6],
                listening: false
            });
            layer.add(arrowHalo);
            layer.add(arrow);
            layer.add(dashCircle);
            sys.requestRedraw ? sys.requestRedraw() : layer.draw();

            // 约 500ms 间隔切换箭头显隐
            let visible = true;
            timer = setInterval(() => {
                visible = !visible;
                arrow && arrow.visible(visible);
                arrowHalo && arrowHalo.visible(visible);
                dashCircle && dashCircle.visible(visible);
                sys.requestRedraw ? sys.requestRedraw() : layer.draw();
            }, 500);
        }

        // 3. 持续约 3000ms 后移除箭头
        await new Promise(r => setTimeout(r, 3000));
        if (timer) { clearInterval(timer); timer = null; }
        if (arrowHalo) arrowHalo.destroy();
        if (arrow) arrow.destroy();
        if (dashCircle) dashCircle.destroy();
        comp.highlight && comp.highlight(false);
        sys.requestRedraw ? sys.requestRedraw() : layer.draw();

        // 4. 再延时 1~2s，给学员观察时间
        await new Promise(r => setTimeout(r, 1500));
    }

    /**
     * 模拟自动点击【DOM 按钮】（如工具栏的“自动接线”）
     * 用红色系闪烁箭头 + 虚线圆圈 + 浮动提示，指出应点击的界面按钮
     * @param {string} btnId - DOM 元素 id（如 'btnAutoWire'）
     * @param {string} tipText - 浮动提示文字（可选，默认用按钮文本）
     */
    async _simulateAutoClickDom(btnId, tipText) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        const label = tipText || (btn.innerText || btnId);
        this.sys.showFloatingTip(`【演示】请点击：${label}`, 3500);

        // 闪烁箭头（指向按钮上方）
        const arrowEl = document.createElement('div');
        arrowEl.innerHTML = '▼';
        Object.assign(arrowEl.style, {
            position: 'fixed', zIndex: '10002', pointerEvents: 'none',
            color: '#e74c3c', fontWeight: 'bold', fontSize: '34px',
            lineHeight: '1', textShadow: '0 0 12px rgba(231,76,60,0.8)',
            transition: 'opacity 0.3s'
        });
        const dashedEl = document.createElement('div');
        Object.assign(dashedEl.style, {
            position: 'fixed', zIndex: '10001', pointerEvents: 'none',
            border: '3px dashed #e74c3c', borderRadius: '6px'
        });
        const position = () => {
            const r = btn.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            arrowEl.style.left = (cx - 17) + 'px';
            arrowEl.style.top = (r.top - 46) + 'px';
            dashedEl.style.left = (r.left - 4) + 'px';
            dashedEl.style.top = (r.top - 4) + 'px';
            dashedEl.style.width = (r.width + 8) + 'px';
            dashedEl.style.height = (r.height + 8) + 'px';
        };
        position();
        document.body.appendChild(arrowEl);
        document.body.appendChild(dashedEl);

        // 约 500ms 间隔闪烁
        let visible = true;
        const timer = setInterval(() => {
            visible = !visible;
            arrowEl.style.opacity = visible ? '1' : '0.15';
            dashedEl.style.opacity = visible ? '1' : '0.2';
        }, 500);

        // 持续约 3000ms 后移除
        await new Promise(r => setTimeout(r, 3000));
        clearInterval(timer);
        arrowEl.remove();
        dashedEl.remove();

        // 再延时 1s
        await new Promise(r => setTimeout(r, 1000));
    }

    /**
     * 模拟自动答题效果（题目展示 → 延时指出正确答案 → 停留后自动关闭）
     *  1. 弹出遮罩 + 题目卡片，展示题目、选项
     *  2. 停顿约 2s 让学员阅读题目
     *  3. 高亮标出全部正确选项（绿色背景/边框），并用箭头（👉）指向首个正确选项
     *  4. 展示 ✅ 正确答案 与 💡 解析文字（analysis 字段）
     *  5. 停留约 6s 后自动关闭弹窗
     */
    async _simulateAutoQuiz(quizConfig) {
        if (!quizConfig || !quizConfig.options) return;
        const sys = this.sys;
        const parent = sys.container;
        const isMultiple = quizConfig.isMultiple || Array.isArray(quizConfig.answer);
        const answers = Array.isArray(quizConfig.answer)
            ? quizConfig.answer
            : [quizConfig.answer];
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        // 1. 遮罩 + 题目卡片
        const mask = document.createElement('div');
        Object.assign(mask.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.6)', zIndex: '100',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        });

        const box = document.createElement('div');
        Object.assign(box.style, {
            background: '#fff', width: '85%', maxWidth: '540px',
            borderRadius: '12px', padding: '20px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
        });
        const typeTag = isMultiple ? '[多选题]' : '[单选题]';
        box.innerHTML = `
            <div style="color:#1395eb; font-size:16px; margin-bottom:5px; font-weight:bold;">${typeTag} · 自动演示</div>
            <div style="font-weight:bold; margin-bottom:15px; line-height:1.4;">${quizConfig.question}</div>
            <div id="qabox-options"></div>
            <div id="qabox-result" style="margin-top:12px; min-height:0;"></div>
        `;

        const wrapper = box.querySelector('#qabox-options');
        const optionNodes = [];
        quizConfig.options.forEach((text, index) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; padding:10px 12px; margin:6px 0; border:1px solid #ddd; border-radius:8px; background:#fcfcfc; transition:all .3s;';
            row.dataset.correct = answers.includes(index) ? '1' : '0';
            row.innerHTML = `
                <span style="width:24px;height:24px;line-height:24px;text-align:center;border:1px solid #1395eb;color:#1395eb;border-radius:4px;margin-right:10px;font-weight:bold;flex-shrink:0;">${letters[index]}</span>
                <span style="flex:1;font-size:16px;">${text}</span>
                <span class="qabox-mark" style="font-size:20px; margin-left:8px;"></span>
            `;
            wrapper.appendChild(row);
            optionNodes.push(row);
        });
        mask.appendChild(box);
        parent.appendChild(mask);
        sys.requestRedraw && sys.requestRedraw();

        // 2. 停顿约 2s 让学员阅读题目
        await new Promise(r => setTimeout(r, 2000));

        // 3. 高亮全部正确选项（绿色），并用箭头指向首个正确选项
        optionNodes.forEach((row, i) => {
            if (row.dataset.correct === '1') {
                row.style.borderColor = '#2ecc71';
                row.style.background = '#e9f9ee';
                row.querySelector('.qabox-mark').textContent = '✅';
            }
        });
        const firstCorrect = answers[0];
        const arrowMark = optionNodes[firstCorrect] && optionNodes[firstCorrect].querySelector('.qabox-mark');
        if (arrowMark) arrowMark.textContent = '👉 ✅';

        // 4. 展示正确答案与解析
        const resultEl = box.querySelector('#qabox-result');
        const answerText = answers.map(i => `${letters[i]}. ${quizConfig.options[i]}`).join('、');
        resultEl.innerHTML = `
            <div style="padding:10px 12px; border-radius:8px; background:#e9f9ee; border:1px solid #2ecc71;">
                <div style="font-weight:bold; color:#27ae60; font-size:15px;">✅ 正确答案：${answerText}</div>
                ${quizConfig.analysis
                    ? `<div style="margin-top:8px; color:#555; font-size:14px; line-height:1.5;">💡 ${quizConfig.analysis}</div>`
                    : ''}
            </div>
        `;
        sys.requestRedraw && sys.requestRedraw();

        // 5. 停留约 6s 后自动关闭
        await new Promise(r => setTimeout(r, 6000));
        try { parent.removeChild(mask); } catch (e) { }
        sys.requestRedraw && sys.requestRedraw();
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

                // 事件发射：通知外部答题结果
                if (this.sys && this.sys.eventBus) {
                    this.sys.eventBus.emit('workflow:quiz', {
                        action: 'quiz',
                        correct: isCorrect,
                        answer: selectedIndices,
                        questionId: config.question ? config.question.slice(0, 40) : '',
                        timestamp: Date.now(),
                    });
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