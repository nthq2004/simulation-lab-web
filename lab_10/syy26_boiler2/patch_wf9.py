import io

p = "project/sys_dgdq5-3.js"
s = io.open(p, encoding="utf-8").read()

# ── ① 新增：读 PLC 消声记忆位判断"是否已按过消声" ──
old = """/** 旋钮换到指定档位：先顺时针点，不到位再逆时针点（两种朝向都覆盖） */"""
new = """/** 是否已按过消声：读 PLC 的 M1.0~M1.6 消声记忆位（演练模式下也能判定） */
function _muted(s) {
    const mb = (s && s.mbits) || [];
    for (let i = 0; i < 7; i++) if (mb[8 + i]) return true;
    return false;
}

/** 旋钮换到指定档位：先顺时针点，不到位再逆时针点（两种朝向都覆盖） */"""
assert old in s
s = s.replace(old, new, 1)

# ── ② 步骤 2 的 check 里复位步骤 3 的锁存（演练重来时可重判）──
old = """                check() {
                    const s = _bsOf(this);
                    return !!(this._s2Alarm || (s && (s.m.out.flameOutAlarm || s.getFault('flameSensor'))));
                },"""
new = """                check() {
                    const s = _bsOf(this);
                    this._s3Muted = false;                       // 进入本步即复位下一步的"已消声"锁存
                    return !!(this._s2Alarm || (s && (s.m.out.flameOutAlarm || s.getFault('flameSensor'))));
                },"""
assert old in s
s = s.replace(old, new, 1)

# ── ③ 步骤 3 的 check：改用"消声记忆位"锁存，演练模式下也能通过 ──
old = """                check() {
                    const s = _bsOf(this);
                    return !!(this._s3Muted && s && !s.m.out.ready && !s.getFault('flameSensor'));
                },"""
new = """                check() {
                    const s = _bsOf(this);
                    if (!s) return false;
                    if (_muted(s)) this._s3Muted = true;         // 轮询到消声记忆置位即锁存
                    return !!(this._s3Muted && !s.m.out.ready && !s.getFault('flameSensor'));
                },"""
assert old in s
s = s.replace(old, new, 1)

# ── ④ 步骤 5：低水位报警也用轮询锁存（避免补水后报警消失导致判不过）──
old = """                check() {
                    const s = _bsOf(this);
                    return !!(this._s5Alarm || (s && s.m.out.levelLowAlarm));
                },"""
new = """                check() {
                    const s = _bsOf(this);
                    if (s && s.m.out.levelLowAlarm) this._s5Alarm = true;   // 轮询锁存
                    return !!(this._s5Alarm);
                },"""
assert old in s
s = s.replace(old, new, 1)

# ── ⑤ 步骤 4 的 check 复位步骤 5/6 的锁存 ──
old = """                check() { const s = _bsOf(this), bc = _compOf(this, 'boiler'); return _loadStage(s) && !!(bc && bc._svOpen); },
            },
            {
                msg: '5. 把 1# 给水泵打到「停止」"""
new = """                check() {
                    const s = _bsOf(this), bc = _compOf(this, 'boiler');
                    this._s5Alarm = false; this._s6Muted = false;            // 复位后续步骤的锁存
                    return _loadStage(s) && !!(bc && bc._svOpen);
                },
            },
            {
                msg: '5. 把 1# 给水泵打到「停止」"""
assert old in s
s = s.replace(old, new, 1)

# ── ⑥ 步骤 6 的 check：消声同样用记忆位锁存 ──
old = """                    return !!(this._s6Muted && s && s.m.burnerKnob === 'stop' && s.m.pump1Mode === 'auto'
                        && (this._lvlDone6 || s.m.level >= 55));"""
new = """                    if (!s) return false;
                    if (_muted(s)) this._s6Muted = true;
                    return !!(this._s6Muted && s.m.burnerKnob === 'stop' && s.m.pump1Mode === 'auto'
                        && (this._lvlDone6 || s.m.level >= 55));"""
assert old in s
s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("ok")
