import io

# ══════════════════════════════════════════════════════════
# 1) AC600：自动减速原因集合（可撤销）
# ══════════════════════════════════════════════════════════
p = "tools/AC600Solver.js"
s = io.open(p, encoding="utf-8").read()

old = """        this.jcwLowShd = false;          // 冷却水 PS 断开 → 缸套水进口低压安保停车"""
new = """        this.jcwLowShd = false;          // 冷却水 PS 断开 → 缸套水进口低压安保停车
        this.sldCauses = {};             // 监视系统"自动减速"的原因集合（温度回落后按 tagId 撤销）"""
assert old in s
s = s.replace(old, new)

old = """        this.loLowLowShd = false;
        this.jcwLowShd = false;"""
new = """        this.loLowLowShd = false;
        this.jcwLowShd = false;
        this.sldCauses = {};"""
assert old in s
s = s.replace(old, new)

old = """            'CW-PS': 'JACKET C.F.W. INLET PRESS LOW',"""
new = """            'CW-PS': 'JACKET C.F.W. INLET PRESS LOW',
            'CW-T': 'JACKET C.F.W. OUTLET TEMP HIGH',
            'ME-LO-T': 'MAIN L.O. INLET TEMP HIGH',"""
assert old in s
s = s.replace(old, new)

old = """        if (kind === 'SLD') {
            this.slowDown = true;
            this.cancelSLD = false;
            this.alarm = true;
            this.acked = false;
            this.silenced = false;
            this.alarmText = `${txt}, SLDN`;
            this.pushMessage(`${txt}, SLDN`);
            return;
        }"""
new = """        if (kind === 'SLD') {
            this.sldCauses = this.sldCauses || {};
            this.sldCauses[tagId] = txt;
            this.slowDown = true;
            this.cancelSLD = false;
            this.alarm = true;
            this.acked = false;
            this.silenced = false;
            this.alarmText = `${txt}, SLDN`;
            this.pushMessage(`${txt}, SLDN`);
            return;
        }"""
assert old in s
s = s.replace(old, new)

old = """    /** 超速保护动作：燃油切断 → 主机停车（由转速检测页试验触发，锁存） */"""
new = """    /**
     * 自动减速的原因消失（温度回落到回差值以下）→ 解除 SLD；
     * 没有其它减速原因时结束慢降显示，并按"已应答自动清除 / 未应答转 NORMAL"处理报警信息。
     */
    safetyClear(kind, tagId) {
        if (kind !== 'SLD') return;
        this.sldCauses = this.sldCauses || {};
        const txt = this.sldCauses[tagId];
        if (!txt) return;
        delete this.sldCauses[tagId];
        if (Object.keys(this.sldCauses).length) return;      // 还有其它调速原因
        this.slowDown = false;
        if (!this.alarm) return;
        if (this.acked) { this.alarm = false; this.clearMessages(); return; }
        this.messages = (this.messages || []).map((m) => (m.startsWith(txt) ? `${txt}, NORMAL` : m));
        this.alarmText = this.messages[0] || '';
    }

    /** 超速保护动作：燃油切断 → 主机停车（由转速检测页试验触发，锁存） */"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ac600 ok")

# ══════════════════════════════════════════════════════════
# 2) 滑油系统 MIMIC：油温 > 60 ℃ 延时 6 s → 自动减速；< 58 ℃ 还原
# ══════════════════════════════════════════════════════════
p = "components/MainEngineLubeOilMimic.js"
s = io.open(p, encoding="utf-8").read()
old = """        m.temp += (tTarget - m.temp) * Math.min(1, dt / 4);
        m.pid.pv = m.temp;"""
new = """        m.temp += (tTarget - m.temp) * Math.min(1, dt / 4);
        m.pid.pv = m.temp;

        // 滑油温度高 → 延时 6 s 触发主机自动减速；低于 58 ℃ 还原（回差 2 ℃）
        const acSld = this.sys && this.sys.ac600;
        if (acSld && typeof acSld.safetyAction === 'function') {
            if (m.temp > LO_SLD_ON) {
                this._loSldT = (this._loSldT || 0) + dt;
                if (this._loSldT >= LO_SLD_DELAY && !this._loSld) {
                    this._loSld = true;
                    acSld.safetyAction('SLD', 'ME-LO-T');
                }
            } else if (m.temp < LO_SLD_OFF) {
                this._loSldT = 0;
                if (this._loSld) {
                    this._loSld = false;
                    if (typeof acSld.safetyClear === 'function') acSld.safetyClear('SLD', 'ME-LO-T');
                }
            }
        }"""
assert old in s
s = s.replace(old, new)

old = (
    """const C_PIPE = '#a8cdb8';      // 管路底色（淡绿）：让滑油流动虚线（橙）更醒目"""
)
new = """const C_PIPE = '#a8cdb8';      // 管路底色（淡绿）：让滑油流动虚线（橙）更醒目

// 滑油温度高 → 自动减速：> 60 ℃ 延时 6 s 触发，< 58 ℃ 还原（回差 2 ℃）
const LO_SLD_ON = 60, LO_SLD_OFF = 58, LO_SLD_DELAY = 6;"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("lo mimic ok")

# ══════════════════════════════════════════════════════════
# 3) 冷却水模型：缸套水出口温度 > 90 ℃ 延时 6 s → 自动减速；< 88 ℃ 还原
# ══════════════════════════════════════════════════════════
p = "tools/CoolingWaterSolver.js"
s = io.open(p, encoding="utf-8").read()
old = """const PS_TRIP_DELAY = 10;      // 压力开关 PS 断开 → 主机自动停车的延时（s）"""
new = """const PS_TRIP_DELAY = 10;      // 压力开关 PS 断开 → 主机自动停车的延时（s）
// 缸套水出口温度高 → 自动减速：> 90 ℃ 延时 6 s 触发，< 88 ℃ 还原（回差 2 ℃）
const CW_SLD_ON = 90, CW_SLD_OFF = 88, CW_SLD_DELAY = 6;"""
assert old in s
s = s.replace(old, new)

old = """        // ── 6. 膨胀水柜液位 ──"""
new = """        // ── 5b. 缸套水出口温度高 → 延时 6 s 主机自动减速（< 88 ℃ 还原）──
        const acSld = this.sys && this.sys.ac600;
        if (acSld && typeof acSld.safetyAction === 'function') {
            if (m.temp > CW_SLD_ON) {
                m.t.sld = (m.t.sld || 0) + dts;
                if (m.t.sld >= CW_SLD_DELAY && !m.sldOn) {
                    m.sldOn = true;
                    acSld.safetyAction('SLD', 'CW-T');
                }
            } else if (m.temp < CW_SLD_OFF) {
                m.t.sld = 0;
                if (m.sldOn) {
                    m.sldOn = false;
                    if (typeof acSld.safetyClear === 'function') acSld.safetyClear('SLD', 'CW-T');
                }
            }
        }

        // ── 6. 膨胀水柜液位 ──"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("cooling ok")

# ══════════════════════════════════════════════════════════
# 4) AC600 面板：Slow Down 页对应两行随减速原因点亮
# ══════════════════════════════════════════════════════════
p = "components/Ac600ConsolePanel.js"
s = io.open(p, encoding="utf-8").read()
old = """            mk('lo-t', 'MAIN L.O. INLET TEMP HIGH', { active: false, hasC: true }),"""
new = """            mk('lo-t', 'MAIN L.O. INLET TEMP HIGH', {
                active: !!(M.sldCauses && M.sldCauses['ME-LO-T']), hasC: true,
            }),"""
assert old in s
s = s.replace(old, new)
old = """            mk('jcw-t', 'JACKET C.F.W. OUTLET TEMP HIGH', { active: false, hasC: true }),"""
new = """            mk('jcw-t', 'JACKET C.F.W. OUTLET TEMP HIGH', {
                active: !!(M.sldCauses && M.sldCauses['CW-T']), hasC: true,
            }),"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("panel ok")
