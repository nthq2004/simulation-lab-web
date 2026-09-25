
import { PictureImage } from '../components/PictureImage.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { InductionMotorExploded } from '../components/InductionMotorExploded.js';
import nameplateSrc from '../images/03-motor-nameplate.jpg';

export const FAULT_CONFIGS = {};

const _TOOL_NAME = {
    puller: '拉具', screwdriver: '螺丝刀', copperTube: '铜管',
    copperRod: '铜棒', woodRod: '木棒', hammer: '手锤', woodBoard: '木板',
};

export const PROJECT_WORKFLOWS = {

    'motor-nameplate': {
        id: 'motor-nameplate',
        name: '1. 三相异步电动机铭牌参数的认识',
        steps: [
            {
                msg: '1. 勾选工具栏「电动机铭牌」，显示电动机铭牌图片。',
                mode: 'check',
                check() {
                    const np = this.sys.comps['nameplate'];
                    return np && np.group && np.group.visible();
                },
                op: [
                    {
                        type: 'observe',
                        msg: '点击工具栏「电动机铭牌」复选框，显示铭牌图片',
                        async act() {
                            // 先用红框 + 箭头指向工具栏复选框，再执行勾选
                            const cb = document.getElementById('btnNameplate');
                            if (cb) {
                                const label = cb.closest('label') || cb;
                                await this._flashDomElement(label, '勾选「电动机铭牌」复选框', 2400);
                            }
                            const np = this.sys.comps['nameplate'];
                            if (np) { np.show(); np.group.moveToTop(); this.sys.redrawAll(); }
                            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
                        },
                    },
                ],
            },
            {
                msg: '2. 填空题：该电机的磁极数是（  ），磁极对数 p=（  ）。',
                mode: 'fill',
                fields: [
                    { label: '磁极数', unit: '极', answer: 4, tolerance: 0.02, placeholder: '填写磁极数' },
                    { label: '磁极对数 p', unit: '', answer: 2, tolerance: 0.02, placeholder: '填写磁极对数' },
                ],
            },
            {
                msg: '3. 填空题：该电机正常工作时采用（  ）接法，（  ）采用星/三角降压起动方法（填可以/不可以）。',
                mode: 'fill',
                fields: [
                    { label: '正常工作接法', unit: '', answer: ['三角形', '△', 'Δ', 'D', 'delta'], placeholder: '填写绕组接法' },
                    { label: '是否可用星/三角降压起动', unit: '', answer: ['可以'], placeholder: '填写 可以/不可以' },
                ],
            },
            {
                msg: '4. 填空题：该电机的绝缘等级是（  ），最高允许温度不超过（  ）℃。',
                mode: 'fill',
                fields: [
                    { label: '绝缘等级', unit: '', answer: ['F', 'F级'], placeholder: '填写绝缘等级字母' },
                    { label: '最高允许温度', unit: '℃', answer: 155, tolerance: 0.02, placeholder: '填写最高允许温度' },
                ],
            },
            {
                msg: '5. 填空题：该电机的防护等级是（  ）。',
                mode: 'fill',
                fields: [
                    { label: '防护等级', unit: '', answer: ['IP44', 'IP 44', 'ip44'], placeholder: '填写防护等级' },
                ],
            },
            {
                msg: '6. 填空题：该电机的额定转差率等于（  ）。',
                mode: 'fill',
                fields: [
                    { label: '额定转差率', unit: '', answer: ['0.0067', '0.00667', '0.67%', '0.67'], placeholder: '填写额定转差率' },
                ],
            },
            {
                msg: '7. 填空题：该电机的定额是（  ），代表它是（  ）工作制。',
                mode: 'fill',
                fields: [
                    { label: '定额', unit: '', answer: ['S1'], placeholder: '填写定额代号' },
                    { label: '工作制', unit: '', answer: ['连续', '连续工作制', '连续运行', '连续运行工作制'], placeholder: '填写工作制' },
                ],
            },
        ],
    },

    'motor-disassembly': {
        id: 'motor-disassembly',
        name: '2. 三相异步电动机的拆解',
        steps: [
            {
                msg: '1. 拆卸前先在前、后端盖与机座接合处做好对位标记。',
                mode: 'check',
                check() {
                    const c = this.sys.comps['motor-disasm'];
                    return !!(c && c.isMarked());
                },
                op: [
                    {
                        type: 'observe', target: 'motor-disasm', part: 'mark',
                        msg: '点击「打标记」，在端盖与机座接合处做对位标记',
                        async act() {
                            const c = this.sys.comps['motor-disasm'];
                            if (c) c.mark();
                            await new Promise(r => setTimeout(r, 1400));
                        },
                    },
                ],
            },
            _disasmStep(2, 'coupling', '联轴器', ['puller'], '用拉具拉出'),
            _disasmStep(3, 'fanCover', '风扇罩', ['screwdriver'], '用螺丝刀拆'),
            _disasmStep(4, 'fan', '风扇', ['copperRod', 'hammer'], '用铜棒抵住风扇、手锤敲击'),
            _disasmStep(5, 'frontBearingCover', '前轴承盖', ['screwdriver'], '拆掉前轴承盖'),
            _disasmStep(6, 'rotor', '转子总成', ['woodBoard', 'hammer'], '将转子、前后轴承、后端盖、后轴承盖整体拆下'),
            _disasmStep(7, 'frontCover', '前端盖', ['screwdriver', 'woodRod', 'hammer'], '用螺丝刀拆螺栓，木棒+手锤敲下前端盖'),
            _disasmStep(8, 'rearBearingCover', '后轴承盖', ['screwdriver'], '从转子上拆下'),
            _disasmStep(9, 'rearCover', '后端盖', [], '从转子上拆下'),
            _disasmStep(10, 'frontBearing', '前轴承', ['puller'], '用拉具（或铜棒+手锤）从转子上拆下'),
            _disasmStep(11, 'rearBearing', '后轴承', ['puller'], '用拉具拆下'),
        ],
    },

};

/** 生成"拆下某零件"的检测步骤（自动演示时逐个箭头指示工具 → 勾选 → 拆卸） */
function _disasmStep(no, partId, name, toolKeys, note) {
    const ops = (toolKeys || []).map(k => ({
        type: 'observe', target: 'motor-disasm', part: 'tool-' + k,
        msg: `先勾选工具「${_TOOL_NAME[k]}」`,
        async act() {
            const c = this.sys.comps['motor-disasm'];
            if (c) c.setTool(k, true);
            await new Promise(r => setTimeout(r, 600));
        },
    }));
    ops.push({
        type: 'observe', target: 'motor-disasm', part: partId,
        msg: `拆下${name}`,
        async act() {
            const c = this.sys.comps['motor-disasm'];
            if (c) c.removePart(partId);
            await new Promise(r => setTimeout(r, 1600));
        },
    });
    return {
        msg: `${no}. 拆下${name}${note ? '（' + note + '）' : ''}。`,
        mode: 'check',
        check() {
            const c = this.sys.comps['motor-disasm'];
            return !!(c && c.isRemoved(partId));
        },
        op: ops,
    };
}

export const componentConfigs = [
    { Class: PictureImage, id: 'nameplate', x: 300, y: -30, src: nameplateSrc, width: 660, visible: false },
    { Class: InductionMotorExploded, id: 'motor-disasm', x: -30, y: 120, label: '三相异步电动机拆装', visible: true },

    { Class: Multimeter, id: 'multimeter', x: 720, y: -20, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1150, y: 250, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

export function applyAllPresets() {
    // 清空电路：不做任何预设接线
}

export async function applyStartSystem() {
    // 清空电路：不做任何预设接线
}

export function fiveStep() { }
