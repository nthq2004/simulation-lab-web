
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
        this._projFlag = {};   // 项目工作流自定义标记（每次打开流程重置）

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

    /**
     * 计算下一步的索引：支持 step.next 为数字（目标索引）或函数（返回目标索引）。
     * 未定义则顺序推进（idx + 1）。
     */
    async _advance(step, idx) {
        if (step && typeof step.next === 'function') {
            const n = await step.next.call(this, step);
            if (typeof n === 'number' && isFinite(n)) {
                return Math.max(0, Math.min(Math.floor(n), this._workflow.length - 1));
            }
            return idx + 1;
        }
        if (step && typeof step.next === 'number') {
            return Math.max(0, Math.min(Math.floor(step.next), this._workflow.length - 1));
        }
        return idx + 1;
    }

    // 全自动演示：循环调用单步演示
    /** 演示专用提示：自动演示期间绕过组件提示抑制，只显示演示相关信息 */
    _tipWorkflow(msg, ms) {
        const s = this.sys;
        if (!s || typeof s.showFloatingTip !== 'function') return;
        const prev = s._tipBypass;
        s._tipBypass = true;
        s.showFloatingTip(msg, ms || 4000);
        s._tipBypass = prev;
    }

    async _runAutoDemo() {
        this._isAutoPlaying = true; // 标记正在全自动运行
        if (this.sys) this.sys._suppressComponentTips = true;   // 演示期间抑制组件自身流程信息
        while (this._workflowIdx < this._workflow.length) {
            if (!this._workflowPanelEl || !this._isAutoPlaying) break;

            const i = this._workflowIdx;
            // 执行当前这一步
            const step = this._workflow[i];
            await this._executeSingleStep(i);
            this._workflowIdx = await this._advance(step, i);
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
            if (this._workflowIdx < this._workflow.length) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        this._isAutoPlaying = false;
        if (this.sys) this.sys._suppressComponentTips = false;   // 演示结束：恢复组件自身提示
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
            // 统一走 _executeSingleStep：支持数组 op 步骤逐个子操作"指示(含延时)→操作→间隔"演示，
            // 也兼容单 op + 整体 act 的老格式（先指示目标再执行动作）。
            await this._executeSingleStep(idx);

            // 动作完成后，索引前进（支持 step.next 跳转）
            this._workflowIdx = await this._advance(step, idx);

            // 再次渲染（此时原步骤会变成”已完成”样式，并自动滚动）
            this._renderWorkflowList();
            if (this.sys && typeof this.sys.redrawAll === 'function') this.sys.redrawAll();

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
        await new Promise(resolve => setTimeout(resolve, 800));

        // 2. 执行动作
        const step = this._workflow[idx];
        if (step.mode === 'find') {
            // 自动指出部件位置（传递步骤说明文字）
            await this._simulateAutoClick(step.target, step.subTarget, step.msg, step);
        }
        else if (step.mode === 'quiz') {
            // 自动展示正确答案
            await this._simulateAutoQuiz(step.quizConfig);
        }
        else if (step.mode === 'fill') {
            // 自动展示填空答案
            await this._simulateAutoFill(step);
        }
        else if (step.act || step.op) {
            // ── check 等有 act() 或 op 元数据的步骤：逐个 op 按"指示(含延时) → 操作 → 短间隔"交替演示。 ──
            // 数组 op 不再"先统一指示全部组件、再统一执行操作"，而是每个子操作前都有对应指示。
            // 拆分后步骤仅有 op（无整体 act），此分支仍须进入，逐个子 op 执行其 act。
            const ops = Array.isArray(step.op) ? step.op : (step.op ? [step.op] : []);
            let ranSubAct = false;
            if (ops.length) {
                for (const op of ops) {
                    const opObj = (typeof op === 'object' && op !== null) ? op : { type: op };
                    // 指示该组件/部件（内部含箭头闪烁 + 浮动提示 + 观察延时）
                    await this._animateOpIntro(step, opObj);
                    // 执行该子操作（若子 op 自带 act；字符串 op/未拆分步骤由 step.act 兜底）
                    if (typeof opObj.act === 'function') {
                        ranSubAct = true;
                        await opObj.act.call(this);
                    }
                    // 操作完成后短暂间隔，让学员看清本步结果，再指示下一个目标
                    await new Promise(r => setTimeout(r, 1200));
                }
                // 兜底：若没有任何子 op 带 act（未拆分工程），仍执行整体 act()
                if (!ranSubAct && step.act) await step.act.call(this);
            } else {
                // 无 op 元数据：回退为文字说明 + 箭头指示目标组件（指向组件中心）
                if (step.msg) {
                    this._tipWorkflow(step.msg, 5000);
                    await new Promise(r => setTimeout(r, 2000));
                }
                if (step.target) {
                    const tids = Array.isArray(step.target) ? step.target : [step.target];
                    for (const tid of tids) {
                        const comp = this.sys.comps[tid];
                        if (!comp) continue;
                        const center = comp.getClickablePartCenter && step.subTarget
                            ? comp.getClickablePartCenter(step.subTarget)
                            : this._compCenter(comp);
                        if (center && this.sys.layer) {
                            await this._flashArrow(center, { on: 500, off: 350, times: 3 });
                        } else {
                            comp.highlight && comp.highlight(true);
                            await new Promise(r => setTimeout(r, 1500));
                            comp.highlight && comp.highlight(false);
                        }
                    }
                }
                if (step.act) await step.act.call(this);
            }
            // 整步动作后再延时 2s，让学员观察结果
            await new Promise(r => setTimeout(r, 2000));
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
        this._hasCurrentFillOpened = false;
        this._fillHintShown = false;

        const watch = async () => {
            // 检查是否结束或面板已关闭
            if (!this._isWatcherRunning || !this._workflowPanelEl || this._workflowIdx >= this._workflow.length) {
                return;
            }

            const step = this._workflow[this._workflowIdx];

            // --- 评估模式下的逻辑判断 ---
            if (step.mode === 'find') {
                // 多目标识别：任一匹配即通过（如多个熔断器）
                const targets = Array.isArray(step.target) ? step.target : [step.target];
                if (step.subTarget) {
                    // 子部件识别：点击电池内部的隔板/极板等
                    var expectId = targets[0] + '/' + step.subTarget;
                    if (this.sys.lastClickedPartId === expectId) {
                        this.sys.lastClickedPartId = null;
                        await this._onStepPass();
                    }
                } else {
                    // 整组件识别
                    if (targets.indexOf(this.sys.lastClickedId) !== -1) {
                        this.sys.lastClickedId = null;
                        await this._onStepPass();
                    }
                }
            }
            else if (step.mode === 'quiz') {
                if (!this._hasCurrentQuizOpened) {
                    this._hasCurrentQuizOpened = true;
                    const isCorrect = await this.showQuiz(step.quizConfig); // 阻塞式弹出
                    if (isCorrect) {
                        this._hasCurrentQuizOpened = false;
                        await this._onStepPass();
                    } else {
                        this._hasCurrentQuizOpened = false; // 答错则下次轮询再次弹出
                    }
                }
            }
            else if (step.mode === 'fill') {
                // 填空步骤：目标组件旁展示输入框，回车判对后跳下一步
                if (!this._hasCurrentFillOpened) {
                    const ready = step.ready ? await step.ready.call(this) : true;
                    if (!ready) {
                        // 前置条件（如已测量）未满足，继续等待
                        setTimeout(watch, 1000);
                        return;
                    }
                    this._hasCurrentFillOpened = true;
                    const isCorrect = await this.showFillInput(step); // 阻塞式输入框
                    this._hasCurrentFillOpened = false;
                    if (isCorrect) {
                        await this._onStepPass();
                    }
                }
            }
            else if (step.check) {
                // --- 关键点：等待异步 check 的结果 ---
                // 这里会等待 check() 内部的 6s 延时结束
                const isPassed = await step.check.call(this);

                if (isPassed) {
                    await this._onStepPass();
                }
            }

            // 无论是否通过，等待 1 秒后进行下一次轮询
            setTimeout(watch, 1000);
        };

        watch();
    }

    async _onStepPass() {
        this.sys.lastClickedId = null;
        this.sys.lastClickedPartId = null;
        const idx = this._workflowIdx;
        const step = this._workflow && this._workflow[idx] ? this._workflow[idx] : null;
        const mode = step ? step.mode : null;
        this._workflowIdx = await this._advance(step, idx);
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
        if (this.sys) this.sys._suppressComponentTips = false;   // 退出演示：恢复组件自身提示
        if (!this._workflowPanelEl) return;
        this._stopWorkflowWatcher();
        try { this.container.removeChild(this._workflowPanelEl); } catch (e) { }
        this._workflowPanelEl = null;
    }

    /**
     * 模拟自动点击效果（识别类步骤，统一节奏）
     * 节奏：① 展示完整步骤说明（浮动提示） → ② 箭头闪烁指向组件/部件中心（约2.5s）
     *       → ③ 延时 2s → ④ 模拟点击（记录全局标记 + 绿色高亮一闪） → ⑤ 再延时 2s
     * 若目标组件提供 getClickablePartCenter(partId)，则用"箭头闪烁指示"指出部件位置；
     * 否则回退为组件整体中心指示。
     */
    async _simulateAutoClick(targetId, subTarget, msg, step) {
        // 多目标时全部依次提示；step.demoTarget 可限定只演示其中部分目标
        // （如多个二极管/电容只演示一个，eval/train 判定仍以 step.target 全集为准）
        const targets = Array.isArray(targetId) ? targetId : [targetId];
        const demoList = step && step.demoTarget
            ? (Array.isArray(step.demoTarget) ? step.demoTarget : [step.demoTarget])
            : targets;
        const sys = this.sys;

        // ── 阶段 1：展示完整步骤说明文字 ──
        if (msg) {
            this._tipWorkflow(msg, 5000);
            await new Promise(r => setTimeout(r, 2000));   // 留 2s 让学员阅读
        }

        for (const tid of demoList) {
            const comp = sys.comps[tid];
            if (!comp) continue;

            // ── 阶段 2：箭头闪烁指示 + 组件高亮闪烁 2 次（约 2.5s） ──
            const center = comp.getClickablePartCenter && subTarget
                ? comp.getClickablePartCenter(subTarget)
                : this._compCenter(comp);
            if (center && sys.layer) {
                // 箭头闪烁与组件高亮闪烁同步进行
                await Promise.all([
                    this._flashArrow(center, { on: 500, off: 350, times: 3 }),
                    this._blinkHighlight(comp, 2, 700, 450),
                ]);
            } else {
                // 回退：组件整体高亮闪烁 2 次
                await this._blinkHighlight(comp, 2, 900, 500);
            }

            // ── 阶段 3：延时 2s（观察）后模拟点击 ──
            await new Promise(r => setTimeout(r, 2000));
            this._simulateClickOn(comp, tid, subTarget, step);
            // 若步骤带有 act（如“转到自动模式 / 改为 231 顺序”），点击后自动执行该操作
            if (step && typeof step.act === 'function') {
                try { await step.act.call(this); } catch (e) { /* 演示动作失败不阻断流程 */ }
                await new Promise(r => setTimeout(r, 800));
            }

            // ── 阶段 4：动作后再延时 2s ──
            await new Promise(r => setTimeout(r, 2000));
        }

        // ── 阶段 5：部件名称小贴士（箭头消失后补充提示） ──
        if (subTarget) {
            var partNames = {
                'pos-plate': '正极板（PbO₂）', 'neg-plate': '负极板（Pb）', 'separator': '隔板',
                'rectifier': '整流模块', 'inverter': '逆变模块', 'battery': '储能模块（蓄电池组）', 'staticSwitch': '静态开关',
                'phase-lamps': '相序指示灯', 'breaker': '空气开关（断路器）',
                'cell-gloves': '绝缘手套', 'cell-shoes': '绝缘靴', 'cell-glasses': '护目镜',
                'cell-clothes': '防护服', 'cell-hat': '安全帽', 'cell-mat': '绝缘垫',
                'coil': '电磁铁线圈', 'spring-top': '上方螺旋弹簧', 'spring-bottom': '下方螺旋弹簧',
                'armature': '动衔铁', 'disc': '制动盘', 'knob': '气隙调节旋钮',
                // 交流接触器结构部件
                'core': '静铁芯（E 形铁心）', 'spring': '反作用弹簧',
                'main-contact': '主触头', 'aux-no': '辅助常开触头', 'aux-nc': '辅助常闭触头',
                // 船舶电站工程通用部件
                'btn-start': '起动按钮', 'btn-stop': '停止按钮', 'btn-close': '合闸按钮', 'btn-open': '分闸按钮',
                'sel-knob': '待并机选择开关手柄', 'main-contact': '主开关主触头',
                'btn-load': '加载按钮', 'btn-unload': '卸载按钮', 'power': '有功功率输入框',
                'run-led': '运行指示灯', 'ready-led': '备妥指示灯',
                'start': '机旁起动按钮', 'stop': '机旁停止按钮',
            };
            var tip = partNames[subTarget] || subTarget;
            this._tipWorkflow('👉 请点击：' + tip, 2500);
        }

        // ── 阶段 6：停留观察时间 ──
        await new Promise(r => setTimeout(r, 2000));
    }

    /**
     * 组件整体高亮闪烁（用于识别/指示，默认闪烁 2 次）
     * @param {object} comp 组件实例
     * @param {number} times 闪烁次数（亮→灭为 1 次）
     * @param {number} onMs  高亮持续时间 ms
     * @param {number} offMs 灭灯持续时间 ms
     */
    async _blinkHighlight(comp, times = 2, onMs = 700, offMs = 450) {
        if (!comp || typeof comp.highlight !== 'function') return;
        const sys = this.sys;
        // 项目可设置 sys._noBlinkHighlight = true，自动演示时只保留箭头指示，不闪亮整个组件
        if (sys && sys._noBlinkHighlight) return;
        const draw = () => {
            if (sys.redrawAll) sys.redrawAll();
            else if (sys.requestRedraw) sys.requestRedraw();
        };
        for (let i = 0; i < times; i++) {
            comp.highlight(true);
            draw();
            await new Promise(r => setTimeout(r, onMs));
            comp.highlight(false);
            draw();
            await new Promise(r => setTimeout(r, offMs));
        }
    }

    /**
     * 模拟点击反馈：记录全局点击标记（供 find 步骤判定）+ 组件绿色高亮一闪
     * @param {object} comp 组件实例
     * @param {string} compId 组件 id
     * @param {string} [subTarget] 部件 id（可选）
     */
    _simulateClickOn(comp, compId, subTarget, step) {
        const sys = this.sys;
        if (compId) sys.lastClickedId = compId;
        if (subTarget) sys.lastClickedPartId = compId + '/' + subTarget;
        // 步骤声明 simClick 时，真实触发部件命中节点的点击事件，让组件自身逻辑执行
        // （如「报警测试」按钮按下、应急切断按钮按下/弹出、开关换档等）
        if (step && step.simClick && comp && subTarget && typeof comp.getClickablePartNode === 'function') {
            const node = comp.getClickablePartNode(subTarget);
            if (node) { try { node.fire('click', { evt: { cancelBubble: false } }); } catch (e) { /* 忽略 */ } }
            if (sys.redrawAll) sys.redrawAll(); else if (sys.requestRedraw) sys.requestRedraw();
        }
        if (comp && typeof comp.highlight === 'function') {
            comp.highlight(true);
            setTimeout(() => {
                comp.highlight(false);
                if (sys.redrawAll) sys.redrawAll();
                else if (sys.requestRedraw) sys.requestRedraw();
            }, 600);
        }
        if (sys.redrawAll) sys.redrawAll();
        else if (sys.requestRedraw) sys.requestRedraw();
    }

    /**
     * 组件整体中心（stage 全局坐标），供箭头指示在无部件定位时回退使用
     * @param {object} comp 组件实例
     * @returns {{x:number,y:number}|null}
     */
    _compCenter(comp) {
        if (!comp || !comp.group) return null;
        try {
            // 以 layer 为参照取世界包围盒，自动计入组自身的旋转/位移，
            // 避免旋转组件（如 rotation:90 的联络开关）中心计算发生偏移。
            const ref = (this.sys && this.sys.layer) ? this.sys.layer : comp.group.getParent();
            const box = ref
                ? comp.group.getClientRect({ relativeTo: ref })
                : comp.group.getClientRect();
            if (box && box.width > 0 && box.height > 0) {
                return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 演示步骤正文前的"操作演示"（按统一节奏：指示 → 延时2s → 由调用方执行 act() 完成模拟点击/档位切换 → 延时2s）
     * 支持 op 类型：
     *   'wire'     自动接线（指向工具栏"自动接线"按钮）
     *   'btn'      按钮操作（指向组件按钮/部件中心）
     *   'switch'   开关/选择开关操作（指向组件开关手柄）
     *   'knob'     旋钮调节（指向旋钮中心）
     *   'load'     投切负载（指向负载组件）
     *   'fault'    设置故障（指向工具栏故障按钮 → 弹窗勾选 → 应用保存）
     *   'instrument' 选择仪表（指向工具栏仪表按钮 → 弹窗勾选）
     *   'observe'  观察（指向目标组件中心）
     * op 可为字符串（'wire'）或对象 {type, target, part, fault, instrument} 或二者混合的数组。
     */
    async _animateStepIntro(step) {
        const ops = Array.isArray(step.op) ? step.op : [step.op];
        for (const op of ops) {
            const opObj = (typeof op === 'object' && op !== null) ? op : { type: op };
            await this._animateOpIntro(step, opObj);
        }
    }

    /** 单个操作元数据的指示（箭头/高亮 + 提示 + 观察延时）。内部不改状态，操作由调用方执行。 */
    async _animateOpIntro(step, opObj) {
        const type = opObj.type;
        if (type === 'wire') await this._introAutoWire(step, opObj);
        else if (type === 'btn') await this._introButton(step, opObj);
        else if (type === 'switch') await this._introSwitch(step, opObj);
        else if (type === 'knob') await this._introKnob(step, opObj);
        else if (type === 'load') await this._introLoad(step, opObj);
        else if (type === 'fault') await this._introFault(step, opObj);
        else if (type === 'instrument') await this._introInstrument(step, opObj);
        else await this._introObserve(step, opObj);
    }

    /** 自动接线：闪烁箭头指向工具栏"自动接线"按钮，延时 2s */
    async _introAutoWire(step, op) {
        const btn = document.getElementById('btnAutoWire');
        const tip = (op && op.msg) || step.msg || '点击工具栏"自动接线"按钮';
        if (btn) {
            await this._flashDomElement(btn, tip, 2600);
        } else if (tip) {
            this._tipWorkflow(tip, 3000);
            await new Promise(r => setTimeout(r, 2000));
        }
        await new Promise(r => setTimeout(r, 2000));  // 延时 2s 后由 act() 模拟点击
    }

    /** 按钮操作：闪烁箭头指向组件按钮中心，延时 2s */
    async _introButton(step, op) {
        await this._introPointPart(step, op, '请点击按钮');
    }

    /** 开关操作：闪烁箭头指向组件开关/手柄中心，延时 2s */
    async _introSwitch(step, op) {
        await this._introPointPart(step, op, '请切换开关档位');
    }

    /** 旋钮调节：闪烁箭头指向旋钮中心，延时 2s */
    async _introKnob(step, op) {
        await this._introPointPart(step, op, '请调节旋钮');
    }

    /** 负载投切：闪烁箭头指向负载组件中心，延时 2s */
    async _introLoad(step, op) {
        await this._introPointPart(step, op, '请投切负载');
    }

    /** 观察：闪烁箭头指向目标组件中心（不伴随动作），延时 2s */
    async _introObserve(step, op) {
        await this._introPointPart(step, op, '请观察');
    }

    /**
     * 通用：闪烁箭头指向组件部件（或整体中心）+ 组件本身高亮闪烁 2 次，延时 2s。
     * 指示结束后由 act() 真正执行按钮/开关/旋钮/负载等操作。
     * @param {object} step 步骤对象
     * @param {object} op 操作元数据 { target, part }
     * @param {string} actionText 动作用途文字
     */
    async _introPointPart(step, op, actionText) {
        const sys = this.sys;
        const tid = op.target || step.target;
        // part 可为字符串，或返回部件 id 的函数（如按当前故障实时确定部件）
        let part = op.part || step.part || step.subTarget;
        if (typeof part === 'function') part = part.call(this, step, op);
        if (tid) {
            const comp = sys.comps[tid];
            if (comp) {
                const center = comp.getClickablePartCenter && part
                    ? comp.getClickablePartCenter(part)
                    : this._compCenter(comp);
                // 提示文字：op 级消息 > 步骤消息 > 默认动作文字（组件名用中文 label 优先）
                const tip = op.msg || step.msg || `👉 ${actionText}：${(comp.label || comp.type || tid)}`;
                if (center && sys.layer) {
                    // 箭头闪烁指示部件 + 组件本身高亮闪烁 2 次（同步进行）
                    this._tipWorkflow(tip, 4000);
                    const r = (op && typeof op.circleR === 'number') ? op.circleR : undefined;
                    await Promise.all([
                        this._flashArrow(center, { on: 500, off: 350, times: 3, radius: r }),
                        this._blinkHighlight(comp, 2, 700, 450),
                    ]);
                } else {
                    // 回退：组件整体高亮闪烁 2 次
                    this._tipWorkflow(tip, 4000);
                    await this._blinkHighlight(comp, 2, 900, 500);
                }
            } else if (step.msg) {
                this._tipWorkflow(step.msg, 3000);
                await new Promise(r => setTimeout(r, 1800));
            }
        } else if (step.msg) {
            this._tipWorkflow(step.msg, 3000);
            await new Promise(r => setTimeout(r, 1800));
        }
        await new Promise(r => setTimeout(r, 2000));  // 延时 2s 后由 act() 真正执行按钮/开关操作
    }

    /**
     * 设置/修复故障（规则5）：指向工具栏"故障设置"按钮 → 打开故障界面 →
     * 指向并勾选（设置）或取消勾选（修复）故障项 → 点击"应用设置"保存
     * @param {object} step 步骤对象
     * @param {object} op 操作元数据 { fault: 故障id, repair?: true }（repair=true 表示取消勾选修复故障）
     */
    async _introFault(step, op) {
        const sys = this.sys;
        const faultBtn = document.getElementById('faultBtn');
        const faultModal = document.getElementById('faultModal');
        const fid = String(op.fault || step.fault || '').replace(/[^\w-]/g, '');
        const isRepair = !!(op && op.repair);
        this._tipWorkflow(op.msg || step.msg || (isRepair ? '取消故障设置' : '设置故障'), 5000);

        // ① 指向工具栏"故障设置"按钮（闪烁约 2.2s）
        if (faultBtn) await this._flashDomElement(faultBtn, '点击"故障设置"按钮', 2200);
        else await new Promise(r => setTimeout(r, 2000));
        await new Promise(r => setTimeout(r, 2000));   // 延时 2s

        // ② 打开故障设置界面
        if (faultBtn && typeof faultBtn.onclick === 'function') faultBtn.onclick();
        else if (faultModal) faultModal.style.display = 'flex';
        await new Promise(r => setTimeout(r, 800));

        // ③ 指向并勾选（设置故障）或取消勾选（修复故障）目标项
        if (fid) {
            const cb = document.getElementById('fault_check_' + fid);
            if (cb) {
                const label = cb.closest('label') || cb;
                const actionText = isRepair ? '取消勾选故障' : '勾选故障';
                await this._flashDomElement(label, `${actionText}：${(cb.parentNode && cb.parentNode.textContent || fid).trim()}`, 2000);
                await new Promise(r => setTimeout(r, 1500));
                cb.checked = !isRepair;
            } else {
                await new Promise(r => setTimeout(r, 1500));
            }
        } else {
            await new Promise(r => setTimeout(r, 1500));
        }

        // ④ 指向"应用设置"按钮并点击保存
        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) {
            await this._flashDomElement(applyBtn,
                isRepair ? '点击"应用设置"，取消勾选后应用即修复故障' : '点击"应用设置"保存故障', 1800);
            await new Promise(r => setTimeout(r, 1500));
            if (typeof applyBtn.onclick === 'function') applyBtn.onclick();
        }
        await new Promise(r => setTimeout(r, 2000));   // 保存后延时 2s
    }

    /**
     * 选择仪表（规则5）：指向工具栏"选择仪表"按钮 → 打开仪表界面 → 指向并勾选仪表
     * @param {object} step 步骤对象
     * @param {object} op 操作元数据 { instrument: 仪表 id（如 'multimeter'） }
     */
    async _introInstrument(step, op) {
        const sys = this.sys;
        const instId = String(op.instrument || step.instrument || op.part || '').replace(/[^\w-]/g, '');

        // ── 通用：工具栏独立复选框（op.checkbox 指定复选框 id，如 chkShowTZN）──
        //    op.checkState 为期望状态（默认 true=勾选）。演示时先指向复选框，再切换到位，
        //    并派发 change 事件，让复选框自身的监听逻辑（显隐/接线处理）真实执行。
        const cbId = String(op.checkbox || '').replace(/[^\w-]/g, '');
        if (cbId) {
            const target = document.getElementById(cbId);
            this._tipWorkflow(op.msg || step.msg || '勾选工具栏复选框', 5000);
            if (!target) {
                await new Promise(r => setTimeout(r, 1800));
                return;
            }
            const want = op.checkState !== undefined ? !!op.checkState : true;
            const label = target.closest('label') || target;
            await this._flashDomElement(label,
                op.msg || (want ? '勾选该复选框' : '取消勾选该复选框'), 2400);
            await new Promise(r => setTimeout(r, 1600));
            const fire = () => {
                if (typeof target.dispatchEvent === 'function') {
                    target.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };
            if (target.checked !== want) {
                target.checked = want;
                fire();
            } else {
                // 已处于期望状态：先反向切换一次再切回，完整展示切换过程
                target.checked = !want;
                fire();
                await new Promise(r => setTimeout(r, 900));
                target.checked = want;
                fire();
            }
            await new Promise(r => setTimeout(r, 1500));
            return;
        }

        // ── 特殊：工具栏独立复选框（如"重载询问面板" #heavyLoadShow）──
        if (instId === 'heavyload') {
            const cb = document.getElementById('heavyLoadShow');
            this._tipWorkflow(op.msg || step.msg || '勾选"重载询问面板"，调出重载询问面板并自动接线', 5000);
            if (!cb) {
                await new Promise(r => setTimeout(r, 2000));
                return;
            }
            // ① 指向工具栏复选框（label 与复选框一起闪烁）
            const label = cb.closest('label') || cb;
            await this._flashDomElement(label, '勾选"重载询问面板"复选框', 2400);
            await new Promise(r => setTimeout(r, 1800));   // 给学员看清位置

            // ② 演示勾选动作：置勾选并触发 change（面板显示 + 自动接线由监听器完成）
            if (!cb.checked) {
                cb.checked = true;
                if (typeof cb.dispatchEvent === 'function') {
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                // 若已是勾选状态（重跑流程），先取消再勾选，完整展示勾选过程
                cb.checked = false;
                if (typeof cb.dispatchEvent === 'function') {
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
                await new Promise(r => setTimeout(r, 900));
                cb.checked = true;
                if (typeof cb.dispatchEvent === 'function') {
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            await new Promise(r => setTimeout(r, 1500));   // 勾选后面板显示稳定
            return;
        }

        const btn = document.getElementById('btnInstrument');
        const modal = document.getElementById('instrumentModal');
        this._tipWorkflow(op.msg || step.msg || '选择仪表', 5000);

        // ① 指向工具栏"选择仪表"按钮
        if (btn) await this._flashDomElement(btn, '点击"选择仪表"按钮', 2200);
        else await new Promise(r => setTimeout(r, 2000));
        await new Promise(r => setTimeout(r, 2000));   // 延时 2s

        // ② 打开仪表选择界面
        if (btn && typeof btn.onclick === 'function') btn.onclick();
        else if (modal) modal.style.display = 'flex';
        await new Promise(r => setTimeout(r, 800));

        // ③ 指向并勾选仪表（change 事件即时生效显示）
        if (instId) {
            const cb = document.getElementById('instr_' + instId);
            if (cb) {
                const label = cb.closest('label') || cb;
                await this._flashDomElement(label, '勾选并显示该仪表', 2000);
                await new Promise(r => setTimeout(r, 1500));
                cb.checked = true;
                if (typeof cb.dispatchEvent === 'function') {
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }
        await new Promise(r => setTimeout(r, 2000));   // 勾选后延时 2s

        // ③b 取消勾选另一仪表（op.uncheck 指定，用于"调出 A 同时收起 B"）
        const unId = String(op.uncheck || '').replace(/[^\w-]/g, '');
        if (unId) {
            const ucb = document.getElementById('instr_' + unId);
            if (ucb && ucb.checked) {
                const ulabel = ucb.closest('label') || ucb;
                await this._flashDomElement(ulabel, '取消勾选该仪表（收起）', 1800);
                await new Promise(r => setTimeout(r, 1000));
                ucb.checked = false;
                if (typeof ucb.dispatchEvent === 'function') {
                    ucb.dispatchEvent(new Event('change', { bubbles: true }));
                }
                await new Promise(r => setTimeout(r, 1200));
            }
        }

        // ④ 指向并点击"关闭"按钮，关闭仪表选择界面（op.keepOpen=true 可跳过）
        if (!(op && op.keepOpen)) {
            const closeBtn = document.getElementById('instrumentCancelBtn');
            if (closeBtn) {
                await this._flashDomElement(closeBtn, '点击"关闭"按钮，关闭仪表选择界面', 1800);
                await new Promise(r => setTimeout(r, 1200));
                if (typeof closeBtn.onclick === 'function') closeBtn.onclick();
                else if (modal) modal.style.display = 'none';
            } else if (modal) {
                modal.style.display = 'none';
            }
        }
        await new Promise(r => setTimeout(r, 800));    // 关闭后停留观察
    }

    /**
     * 在目标部件位置绘制闪烁箭头（默认 3 次闪烁后移除）
     * @param {{x:number,y:number}} center 部件中心（stage 全局坐标）
     * @param {{on?:number, off?:number, times?:number}} [opts] 闪烁节奏：亮/灭时长(ms)与次数
     */
    async _flashArrow(center, opts = {}) {
        const sys = this.sys;
        const absX = center.x;
        const absY = center.y;
        const pad = 54, len = 46, w = 22;
        const ON_MS = (opts && typeof opts.on === 'number') ? opts.on : 600;
        const OFF_MS = (opts && typeof opts.off === 'number') ? opts.off : 400;
        const TIMES = (opts && typeof opts.times === 'number') ? opts.times : 3;
        const R = (opts && typeof opts.radius === 'number') ? opts.radius : 32;
        // 从左上方向部件中心指去
        const points = [absX - pad - len, absY - pad - len, absX - pad + 2, absY - pad + 2];

        // ── 外层光晕箭头（呼吸脉冲）──
        const glow = new Konva.Arrow({
            points, pointerLength: len + 6, pointerWidth: w + 8,
            fill: 'rgba(243,156,18,.25)', stroke: 'rgba(243,156,18,.25)',
            strokeWidth: 7, opacity: 1, listening: false,
        });
        sys.layer.add(glow);

        // ── 内层主箭头（实心红色）──
        const arrow = new Konva.Arrow({
            points, pointerLength: len, pointerWidth: w,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 3,
            opacity: 1, listening: false,
        });
        sys.layer.add(arrow);

        // ── 虚线圆圈居中圈住部件 ──
        const circle = new Konva.Circle({
            x: absX, y: absY, radius: R,
            stroke: '#e74c1c', strokeWidth: 3.2,
            dash: [9, 5], opacity: 1, listening: false,
        });
        sys.layer.add(circle);

        // ── 精确闪烁 TIMES 次：ON_MS → OFF_MS ──
        for (let i = 0; i < TIMES; i++) {
            // ON
            arrow.opacity(1); glow.opacity(0.6); circle.opacity(1);
            if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
            else sys.layer.batchDraw();
            await new Promise(r => setTimeout(r, ON_MS));
            // OFF
            arrow.opacity(0.15); glow.opacity(0.05); circle.opacity(0.15);
            if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
            else sys.layer.batchDraw();
            await new Promise(r => setTimeout(r, OFF_MS));
        }

        arrow.remove(); glow.remove(); circle.remove();
        if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
        else sys.layer.batchDraw();
    }

    /**
     * DOM 元素闪烁高亮 + 箭头（用于工具栏按钮、弹窗元素等 HTML 控件）
     * 在元素外圈画红色虚线框并加 👉 箭头闪烁，持续 dur 毫秒后移除
     * @param {HTMLElement} el 目标 DOM 元素
     * @param {string} msg 提示文字（走浮动提示）
     * @param {number} dur 持续时间 ms
     */
    _flashDomElement(el, msg = '', dur = 3000) {
        return new Promise((resolve) => {
            if (!el || typeof el.getBoundingClientRect !== 'function') { resolve(); return; }
            this._ensureFlashDomStyle();
            const r = el.getBoundingClientRect();
            const box = document.createElement('div');
            box.className = 'wf-dom-flash';
            box.style.cssText = `left:${r.left - 7}px;top:${r.top - 7}px;width:${r.width + 14}px;height:${r.height + 14}px;`;
            const arrow = document.createElement('div');
            arrow.className = 'wf-dom-flash wf-dom-arrow';
            arrow.style.cssText = `left:${r.left - 54}px;top:${r.top + r.height / 2 - 17}px;`;
            document.body.appendChild(box);
            document.body.appendChild(arrow);
            if (msg) this._tipWorkflow(msg, Math.min(dur, 4500));
            setTimeout(() => { box.remove(); arrow.remove(); resolve(); }, dur);
        });
    }

    /** 注入 DOM 闪烁动画所需 CSS（首次调用时执行一次） */
    _ensureFlashDomStyle() {
        if (this._flashDomStyleInjected) return;
        const st = document.createElement('style');
        st.textContent = `
            .wf-dom-flash{
                position:fixed; border:4px dashed #e74c3c; border-radius:6px;
                pointer-events:none; z-index:99999; box-sizing:border-box;
                animation:wfPulse .6s ease-in-out infinite;
            }
            /* CSS 绘制的实心红色箭头（三角朝右指向上按钮左缘，杆水平向左延伸），
               不依赖 emoji，任何平台字体下都显示为真正的箭头 */
            .wf-dom-arrow{
                border:none; width:50px; height:35px; pointer-events:none;
                position:fixed; z-index:99999;
                animation:wfPulse .6s ease-in-out infinite;
            }
            .wf-dom-arrow::before{
                content:''; position:absolute; left:0; top:10.5px;
                width:26px; height:5px; border-radius:2px; background:#e74c3c;
            }
            .wf-dom-arrow::after{
                content:''; position:absolute; left:24px; top:0;
                border:13px solid transparent; border-left:22px solid #e74c3c;
            }
            @keyframes wfPulse{ 0%,100%{opacity:1} 50%{opacity:.2} }
        `;
        document.head.appendChild(st);
        this._flashDomStyleInjected = true;
    }

    /**
     * 计算制动器「工作气隙」标注文字的绝对中心坐标（供箭头指引起伏）
     * @param {object} brk DiscElectromagneticBrake 组件
     * @returns {{x:number,y:number}|null}
     */
    _airGapCenter(brk) {
        if (!brk) return null;
        const t = brk._airGapText;
        if (t && t.width) {
            return {
                x: brk.group.x() + t.x() + t.width() / 2,
                y: brk.group.y() + t.y() + t.height() / 2,
            };
        }
        if (typeof brk.getClickablePartCenter === 'function') {
            return brk.getClickablePartCenter('disc');
        }
        return null;
    }

    /**
     * 塞尺测量结果"指出"：箭头指向塞尺手柄左侧结果文字 + 浮动提示结论
     * @param {object} feeler FeelerGauge 组件
     * @param {string} tip 结论文字
     */
    async _pointToFeelerResult(feeler, tip) {
        if (feeler) {
            const c = {
                x: feeler.group.x() + feeler._resX + 12,
                y: feeler.group.y() + feeler._resY + 8,
            };
            await this._flashArrow(c);
        }
        this._tipWorkflow(tip, 4000);
        await new Promise(r => setTimeout(r, 800));
    }

    /**
     * 模拟自动答题效果
     */
    async _simulateAutoQuiz(quizConfig) {
        const parent = this.sys.container;
        const isMultiple = quizConfig.isMultiple || Array.isArray(quizConfig.answer);
        const letters = ['A', 'B', 'C', 'D'];

        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        // ── 遮罩层 ──
        const mask = document.createElement('div');
        Object.assign(mask.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.5)', zIndex: '100',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        parent.appendChild(mask);

        // ── 题目卡片 ──
        const box = document.createElement('div');
        Object.assign(box.style, {
            background: '#fff', width: '85%', maxWidth: '500px',
            borderRadius: '12px', padding: '20px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.3)', fontFamily: 'sans-serif',
            position: 'relative',
        });
        const typeTag = isMultiple ? '[多选题]' : '[单选题]';
        box.innerHTML = `
            <div style="color:#1395eb; font-size:16px; margin-bottom:5px; font-weight:bold;">${typeTag}</div>
            <div style="font-weight:bold; margin-bottom:15px; line-height:1.4;">${quizConfig.question}</div>
            <div id="quiz-options-wrapper"></div>
        `;
        mask.appendChild(box);

        const wrapper = box.querySelector('#quiz-options-wrapper');
        const optionNodes = [];

        // ── 生成选项按钮 ──
        quizConfig.options.forEach((text, index) => {
            const btn = document.createElement('button');
            Object.assign(btn.style, {
                width: '100%', padding: '12px', margin: '6px 0',
                border: '1px solid #ddd', borderRadius: '8px',
                background: '#fcfcfc', textAlign: 'left', cursor: 'default',
                display: 'flex', alignItems: 'center', transition: 'all 0.2s',
                position: 'relative',
            });
            btn.innerHTML = `
                <span style="width:24px; height:24px; line-height:24px; text-align:center;
                    border:1px solid #1395eb; color:#1395eb; border-radius:4px; margin-right:10px; font-weight:bold;">
                    ${letters[index]}
                </span>
                <span style="flex:1;font-size:16px;">${text}</span>
            `;
            wrapper.appendChild(btn);
            optionNodes.push(btn);
        });

        // ── 提示文字 ──
        const tip = document.createElement('div');
        tip.textContent = '👆 演示模式：请观察正确答案';
        Object.assign(tip.style, {
            marginTop: '12px', textAlign: 'center', fontSize: '14px',
            color: '#888', fontWeight: 'bold',
        });
        box.appendChild(tip);

        // ── 等待约 2 秒（题目阅读时间）后，箭头指向正确答案 ──
        await new Promise(r => setTimeout(r, 2500));

        // 定位正确答案选项
        const answerIndices = Array.isArray(quizConfig.answer) ? quizConfig.answer : [quizConfig.answer];
        const correctNodes = answerIndices.map(i => optionNodes[i]).filter(Boolean);

        if (correctNodes.length) {
            // 高亮所有正确选项
            correctNodes.forEach(node => {
                node.style.borderColor = '#4caf50';
                node.style.background = '#e8f5e9';
                node.style.boxShadow = '0 0 12px rgba(76,175,80,.5)';
            });

            // 创建指向第一个正确选项的箭头指示器
            const targetBtn = correctNodes[0];
            const btnRect = targetBtn.getBoundingClientRect();
            const boxRect = box.getBoundingClientRect();
            const arrowY = btnRect.top - boxRect.top + btnRect.height / 2;

            const arrow = document.createElement('div');
            arrow.textContent = '👉';
            Object.assign(arrow.style, {
                position: 'absolute',
                left: '-42px',
                top: (arrowY - 18) + 'px',
                fontSize: '38px',
                zIndex: '10',
                animation: 'olArrowBob 0.8s ease-in-out infinite',
                filter: 'drop-shadow(0 0 8px rgba(76,175,80,.8))',
            });
            box.appendChild(arrow);

            // 添加跳动动画
            if (!document.getElementById('quiz-arrow-style')) {
                const st = document.createElement('style');
                st.id = 'quiz-arrow-style';
                st.textContent = `@keyframes olArrowBob { 0%,100%{ transform:translateX(0); } 50%{ transform:translateX(8px); } }`;
                document.head.appendChild(st);
            }

            // 若配置了解析，展示正确答案提示与解析
            if (quizConfig.analysis) {
                const correctLetters = answerIndices.map(i => letters[i]).join('、');
                const ana = document.createElement('div');
                ana.innerHTML = `
                    <div style="margin-top:12px;padding:10px;background:#f1f8e9;border-left:4px solid #4caf50;
                        border-radius:4px;font-size:13px;color:#2e7d32;font-weight:bold;">
                        ✅ 正确答案：${isMultiple ? correctLetters : letters[quizConfig.answer]}
                    </div>
                    <div style="margin-top:6px;padding:10px;background:#fff8e1;border-left:4px solid #ff9800;
                        border-radius:4px;font-size:13px;color:#555;line-height:1.5;">
                        💡 ${quizConfig.analysis}
                    </div>
                `;
                box.appendChild(ana);
            }
        }

        // ── 展示约 7 秒后关闭（正确答案与解析阅读时间） ──
        await new Promise(r => setTimeout(r, 7000));
        mask.remove();
    }

    /**
     * 模拟自动填空效果（演示模式）：
     * 弹出遮罩 + 题目卡片，展示各空位（下划线占位），停顿片刻后
     * 逐个空位自动填入正确答案（箭头指向当前空），全部填完后
     * 停留数秒供学员复习，随后自动关闭。
     */
    async _simulateAutoFill(step) {
        const parent = this.sys.container;
        const fa = f => (Array.isArray(f.answer) ? f.answer.join('或') : f.answer);
        const fields = step.fields
            || [{ label: step.label, unit: step.unit, answer: step.answer, tolerance: step.tolerance }];

        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        // ── 遮罩层 ──
        const mask = document.createElement('div');
        Object.assign(mask.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.5)', zIndex: '100',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        parent.appendChild(mask);

        // ── 题目卡片 ──
        const box = document.createElement('div');
        Object.assign(box.style, {
            background: '#fff', width: '85%', maxWidth: '500px',
            borderRadius: '12px', padding: '20px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.3)', fontFamily: 'sans-serif',
            position: 'relative',
        });
        const question = (step.msg || '请填写以下内容')
            .replace(/^第\s*\d+\s*步[：:]\s*/, '')
            .replace(/^填空题[——:：]?\s*/, '');
        box.innerHTML = `
            <div style="color:#1395eb; font-size:16px; margin-bottom:5px; font-weight:bold;">[填空题]</div>
            <div style="font-weight:bold; margin-bottom:15px; line-height:1.4;">${question}</div>
            <div id="fill-blanks-wrapper"></div>
        `;
        mask.appendChild(box);

        const wrapper = box.querySelector('#fill-blanks-wrapper');

        // ── 生成填空行（空位下划线占位） ──
        const blanks = [];
        fields.forEach(f => {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', margin: '10px 0',
                fontSize: '15px', position: 'relative',
            });
            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = f.label || '填空';
            const blank = document.createElement('span');
            Object.assign(blank.style, {
                minWidth: '90px', textAlign: 'center', margin: '0 6px', padding: '2px 8px',
                borderBottom: '2px solid #bbb', color: '#ccc', fontWeight: 'bold',
                transition: 'all 0.3s',
            });
            blank.innerHTML = '&nbsp;?&nbsp;';
            const unit = document.createElement('span');
            unit.style.cssText = 'color:#666; minWidth:44px;';
            unit.textContent = f.unit || '';
            row.appendChild(label);
            row.appendChild(blank);
            row.appendChild(unit);
            wrapper.appendChild(row);
            blanks.push({ row, blank });
        });

        // ── 提示文字 ──
        const tip = document.createElement('div');
        tip.textContent = '👆 演示模式：请观察逐个填入的正确答案';
        Object.assign(tip.style, {
            marginTop: '12px', textAlign: 'center', fontSize: '14px',
            color: '#888', fontWeight: 'bold',
        });
        box.appendChild(tip);

        // ── 箭头指示器（指向当前正在填入的空） ──
        if (!document.getElementById('fill-arrow-style')) {
            const st = document.createElement('style');
            st.id = 'fill-arrow-style';
            st.textContent = `@keyframes fillArrowBob { 0%,100%{ transform:translateX(0); } 50%{ transform:translateX(8px); } }`;
            document.head.appendChild(st);
        }
        const arrow = document.createElement('div');
        arrow.textContent = '👉';
        Object.assign(arrow.style, {
            position: 'absolute', left: '-42px', top: '0px',
            fontSize: '38px', display: 'none', zIndex: '10',
            animation: 'fillArrowBob 0.8s ease-in-out infinite',
            filter: 'drop-shadow(0 0 8px rgba(76,175,80,.8))',
        });
        box.appendChild(arrow);

        // ── 停约 2.5 秒（题目阅读时间）后逐个空位填入 ──
        await new Promise(r => setTimeout(r, 2500));

        for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const { row, blank } = blanks[i];
            // 箭头指向当前填入的空
            arrow.style.top = (row.offsetTop + row.offsetHeight / 2 - 19) + 'px';
            arrow.style.display = 'block';
            // 填入正确答案（绿色加粗，绿色下划线高亮）
            blank.textContent = fa(f);
            blank.style.color = '#2e7d32';
            blank.style.borderBottomColor = '#4caf50';
            blank.style.background = '#e8f5e9';
            blank.style.borderRadius = '4px';
            await new Promise(r => setTimeout(r, 1200));
            blank.style.background = 'transparent';
        }
        arrow.style.display = 'none';

        // ── 全部填完后停 6 秒（答案复习时间）后自动关闭 ──
        await new Promise(r => setTimeout(r, 6000));
        mask.remove();
    }

    /**
     * 弹出填空输入框（目标组件旁空白处展示，回车判对）
     * @param {Object} step - { target: 组件id, fields: [{ label, unit, answer, tolerance?, placeholder? }] }
     * @returns {Promise<boolean>} 用户填入正确与否
     */
    showFillInput(step) {
        return new Promise((resolve) => {
            const parent = this.sys.container;
            const comp = this.sys.comps[step.target];
            const fields = step.fields || [{ label: step.label, unit: step.unit, answer: step.answer, tolerance: step.tolerance }];

            if (getComputedStyle(parent).position === 'static') {
                parent.style.position = 'relative';
            }

            // 1. 定位输入框：优先放在指定部件（如“配电板式兆欧表”）右侧，否则放在组件右侧空白处
            let boxLeft = 0, boxTop = 0;
            const partCenter = (step.part && comp && comp.getClickablePartCenter) ? comp.getClickablePartCenter(step.part) : null;
            if (partCenter) {
                boxLeft = partCenter.x + 80;      // 部件右侧
                boxTop = partCenter.y - 60;
            } else if (comp && comp.group) {
                const pos = comp.group.getAbsolutePosition ? comp.group.getAbsolutePosition() : null;
                const w = comp.width || 160;
                const h = comp.height || 100;
                boxLeft = pos ? pos.x + w + 30 : (comp.config ? comp.config.x + w + 30 : 100);
                boxTop = pos ? pos.y + 10 : (comp.config ? comp.config.y + 10 : 100);
                // 超出右边界时改放组件左侧
                if (boxLeft + 240 > parent.clientWidth) {
                    boxLeft = (pos ? pos.x : (comp.config ? comp.config.x : 100)) - 260;
                }
                // 组件很宽（如整块主配电板）时会落到视口外 → 钳制到可见范围内，确保填空框一定弹出可见
                const vw = parent.clientWidth || 1200, vh = parent.clientHeight || 800;
                boxLeft = Math.max(10, Math.min(boxLeft, Math.max(10, vw - 250)));
                boxTop = Math.max(10, Math.min(boxTop, Math.max(10, vh - 210)));
            } else {
                boxLeft = 120;
                boxTop = 120;
            }

            const box = document.createElement('div');
            Object.assign(box.style, {
                position: 'absolute', left: boxLeft + 'px', top: boxTop + 'px',
                width: '230px', background: '#fff', border: '2px solid #1395eb',
                borderRadius: '10px', padding: '0', zIndex: '10002',
                boxShadow: '0 6px 18px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
            });

            const title = document.createElement('div');
            Object.assign(title.style, {
                color: '#fff', background: '#1395eb', fontSize: '14px', fontWeight: 'bold',
                padding: '8px 14px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
                cursor: 'move', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            });
            title.innerHTML = `<span>${(step.msg || '请填写测量结果').replace(/^\d+\.\s*/, '')}</span>`;
            box.appendChild(title);

            // 内容容器
            const body = document.createElement('div');
            Object.assign(body.style, { padding: '14px' });
            box.appendChild(body);

            // 拖拽逻辑（按住标题栏拖动）
            let dragging = false, dragStartX = 0, dragStartY = 0, origLeft = 0, origTop = 0;
            title.addEventListener('mousedown', (e) => {
                dragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                origLeft = box.offsetLeft;
                origTop = box.offsetTop;
                box.style.cursor = 'move';
                box.style.zIndex = '10003';
                e.preventDefault();
            });
            const onMove = (e) => {
                if (!dragging) return;
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;
                const maxX = parent.clientWidth - box.offsetWidth;
                const maxY = parent.clientHeight - box.offsetHeight;
                const nx = Math.min(maxX, Math.max(0, origLeft + dx));
                const ny = Math.min(maxY, Math.max(0, origTop + dy));
                box.style.left = nx + 'px';
                box.style.top = ny + 'px';
            };
            const onUp = () => {
                if (!dragging) return;
                dragging = false;
                box.style.cursor = '';
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            box._dragCleanup = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            // 2. 生成字段行（标签 + 输入框 + 单位）
            const inputNodes = [];
            fields.forEach(f => {
                const row = document.createElement('div');
                Object.assign(row.style, { display: 'flex', alignItems: 'center', marginBottom: '8px' });

                const label = document.createElement('span');
                Object.assign(label.style, { width: '52px', fontSize: '13px', color: '#333' });
                label.innerText = (f.label || '') + '：';
                row.appendChild(label);

                const input = document.createElement('input');
                Object.assign(input.style, {
                    flex: '1', minWidth: '0', padding: '6px 8px', border: '1px solid #ccc',
                    borderRadius: '4px', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
                });
                input.placeholder = f.placeholder || '';
                input.type = 'text';
                row.appendChild(input);
                inputNodes.push(input);

                if (f.unit) {
                    const unit = document.createElement('span');
                    Object.assign(unit.style, { width: '34px', fontSize: '13px', color: '#555', marginLeft: '6px' });
                    unit.innerText = f.unit;
                    row.appendChild(unit);
                }

                body.appendChild(row);
            });

            // 3. 反馈提示
            const tip = document.createElement('div');
            Object.assign(tip.style, { fontSize: '13px', minHeight: '18px', marginBottom: '6px' });
            body.appendChild(tip);

            // 4. 校验单个字段
            const checkField = (f, val) => {
                const inputVal = String(val == null ? '' : val).trim().replace(/[，,、]+/g, '');
                if (Array.isArray(f.answer)) {
                    // 多答案（如 ['电流互感器','ct']）：任一匹配即正确
                    if (!inputVal) return false;
                    const list = f.answer.map(a => String(a).toLowerCase().replace(/[，,、]+/g, ''));
                    return list.includes(inputVal.toLowerCase());
                }
                if (typeof f.answer === 'number') {
                    const parsed = parseFloat(inputVal);
                    if (isNaN(parsed)) return false;
                    const tol = f.tolerance || 0.02;
                    return Math.abs(parsed - f.answer) <= Math.abs(f.answer * tol);
                }
                return inputVal.toLowerCase() === String(f.answer).toLowerCase();
            };

            // 5. 提交校验
            const submit = () => {
                let allOk = true;
                fields.forEach((f, i) => {
                    const ok = checkField(f, inputNodes[i].value);
                    inputNodes[i].style.borderColor = ok ? '#4caf50' : '#f44336';
                    if (!ok) allOk = false;
                });
                if (allOk) {
                    tip.innerHTML = '<span style="color:#2e7d32;font-weight:bold;">✓ 回答正确</span>';
                    inputNodes.forEach(n => n.disabled = true);
                    setTimeout(() => {
                        if (parent.contains(box)) parent.removeChild(box);
                        if (box._dragCleanup) box._dragCleanup();
                        resolve(true);
                    }, 900);
                } else {
                    tip.innerHTML = '<span style="color:#d84315;">✕ 回答错误，请重新填写</span>';
                }
            };

            fields.forEach((f, i) => {
                inputNodes[i].addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submit(); }
                });
            });

            const btn = document.createElement('button');
            btn.innerText = '提交';
            Object.assign(btn.style, {
                width: '100%', padding: '8px', background: '#1395eb', color: '#fff',
                border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
            });
            btn.onclick = submit;
            body.appendChild(btn);

            parent.appendChild(box);
            inputNodes[0] && inputNodes[0].focus();
        });
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