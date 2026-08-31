"""
弹窗检测配置 - 根据实际学习页面的弹窗元素进行调整
当你首次运行脚本遇到弹窗时，需要在这里补充弹窗的选择器
"""


# ============================================
# 弹窗元素选择器配置
# 请根据实际页面的弹窗结构修改以下选择器
# ============================================

# 弹窗容器选择器（弹窗的外层容器）
POPUP_CONTAINER_SELECTORS = [
    ".modal",
    ".dialog",
    ".popup",
    ".overlay",
    ".mask",
    "[role='dialog']",
    ".layui-layer",
    ".art-dialog",
    "#layerDialog",
    ".bootbox",
    ".sweet-alert",
]

# 确认/继续按钮选择器（弹窗中的确认按钮）
CONFIRM_BUTTON_SELECTORS = [
    # 中文按钮
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("继续学习")',
    'button:has-text("继续观看")',
    'button:has-text("继续")',
    'button:has-text("是")',
    'button:has-text("我知道了")',
    'button:has-text("明白了")',
    'button:has-text("关闭")',
    'button:has-text("下一步")',

    # 英文按钮
    'button:has-text("OK")',
    'button:has-text("Confirm")',
    'button:has-text("Continue")',
    'button:has-text("Yes")',

    # class/id 选择器
    '.btn-confirm',
    '.btn-ok',
    '.btn-continue',
    '#confirmBtn',
    '#continueBtn',
    '#okBtn',
    '.confirm-btn',
    '.ok-button',

    # input 类型按钮
    'input[type="button"][value="确定"]',
    'input[type="button"][value="确认"]',
    'input[type="submit"][value="确定"]',
    'input[type="submit"][value="确认"]',

    # a 标签按钮
    'a:has-text("确定")',
    'a:has-text("确认")',
    'a:has-text("继续学习")',
    'a:has-text("继续")',

    # span/div 点击
    'span:has-text("确定")',
    'span:has-text("确认")',
    'div:has-text("确定")',
]

# 取消/关闭按钮选择器（避免误点击取消）
CANCEL_BUTTON_SELECTORS = [
    'button:has-text("取消")',
    'button:has-text("稍后")',
    'button:has-text("关闭")',
    'button:has-text("Cancel")',
    '.btn-cancel',
    '.btn-close',
    '#cancelBtn',
]

# ============================================
# 20分钟弹窗特征
# 根据实际弹窗内容补充关键词
# ============================================

# 弹窗中可能出现的提示文字（用于识别是否是学习间隔弹窗）
POPUP_KEYWORDS = [
    "继续学习",
    "继续观看",
    "确认学习",
    "请确认",
    "学习确认",
    "休息一下",
    "防挂机",
    "学习验证",
    "身份验证",
    "本人学习",
    "请在",
    "分钟内",
    "超时",
    "离开",
    "回到学习",
]

# ============================================
# iframe 中的弹窗配置
# 如果学习视频在 iframe 中，弹窗可能在 iframe 内
# ============================================
IFRAME_SELECTORS = [
    "iframe",
    "#playerFrame",
    "#studyFrame",
    ".video-frame",
]
