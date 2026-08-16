/**
 * UIManager - UI 交互模块
 * 负责右键菜单、浮动提示、仿真步长设置等 DOM 交互
 */
export class UIManager {
    /**
     * @param {object} sys - ControlSystem 实例
     */
    constructor(sys) {
        this.sys = sys;
    }

    /**
     * 显示系统级右键菜单（用于设置仿真步长等）
     */
    showSystemContextMenu(evt) {
        const sys = this.sys;
        const oldMenu = document.getElementById('sys-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'sys-context-menu';
        const baseStyle = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 160px; font-family: sans-serif; font-size: 14px;
    `;
        menu.style = baseStyle;

        const createItem = (label, onClick, hasSubmenu = false) => {
            const item = document.createElement('div');
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s; display: flex; justify-content: space-between; align-items: center;';
            item.innerHTML = `<span>${label}</span>${hasSubmenu ? '<span style="font-size:10px;">▶</span>' : ''}`;
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            if (onClick) {
                item.onclick = (e) => { e.stopPropagation(); onClick(); };
            }
            return item;
        };

        const stepLabel = `仿真步长 (${(sys.voltageSolver.deltaTime * 1000).toFixed(2)}ms)`;
        const stepItem = createItem(stepLabel, null, true);

        const submenu = document.createElement('div');
        submenu.style = `
        position: absolute; left: 100%; top: 0; background: white;
        border: 1px solid #ccc; border-radius: 4px; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);
        display: none; padding: 5px 0; min-width: 120px;
    `;

        const steps = [
            { label: '0.1 ms', value: 0.0001 },
            { label: '0.01 ms', value: 0.00001 },
            { label: '0.001 ms', value: 0.000001 }
        ];

        steps.forEach(s => {
            const isCurrent = Math.abs(sys.voltageSolver.deltaTime - s.value) < s.value * 0.1;
            const subItem = document.createElement('div');
            subItem.style = 'padding: 8px 15px; cursor: pointer; display: flex; align-items: center;';
            subItem.innerHTML = `<span style="width: 20px;">${isCurrent ? '✓' : ''}</span>${s.label}`;
            subItem.onmouseenter = () => subItem.style.background = '#f0f0f0';
            subItem.onmouseleave = () => subItem.style.background = 'transparent';
            subItem.onclick = (e) => {
                e.stopPropagation();
                this.setSimulationStep(s.value);
                menu.remove();
            };
            submenu.appendChild(subItem);
        });

        stepItem.onmouseenter = () => {
            stepItem.style.background = '#f0f0f0';
            submenu.style.display = 'block';
        };
        stepItem.onmouseleave = (e) => {
            if (!submenu.contains(e.relatedTarget)) submenu.style.display = 'none';
        };
        submenu.onmouseleave = (e) => {
            if (!stepItem.contains(e.relatedTarget)) submenu.style.display = 'none';
        };

        stepItem.appendChild(submenu);
        menu.appendChild(stepItem);

        sys.container.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                window.removeEventListener('mousedown', closeMenu);
            }
        };
        window.addEventListener('mousedown', closeMenu);
    }

    /** 修改仿真步长 */
    setSimulationStep(val) {
        const sys = this.sys;
        if (sys.voltageSolver) {
            sys.voltageSolver.deltaTime = val;
            console.log(`[System] 步长已切换至: ${val * 1000} ms`);
            sys._needsRedraw = true;
        }
    }

    /**
     * 显示一个临时的浮动提示（用于演示模式自动答题）
     */
    showFloatingTip(text, duration = 2500) {
        const sys = this.sys;
        const tip = document.createElement('div');
        Object.assign(tip.style, {
            position: 'fixed',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            background: 'rgba(45, 134, 45, 0.9)',
            color: '#fff',
            borderRadius: '20px',
            fontSize: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: '10001',
            pointerEvents: 'none',
            transition: 'opacity 0.5s ease'
        });
        tip.innerHTML = `💡 ${text}`;
        sys.container.appendChild(tip);

        setTimeout(() => {
            tip.style.opacity = '0';
            setTimeout(() => {
                if (sys.container.contains(tip)) sys.container.removeChild(tip);
            }, 500);
        }, duration);
    }
}
