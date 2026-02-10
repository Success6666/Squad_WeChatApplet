const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// set ban for member:
// - mode: 'clear' | 'temp' | 'forever'
// - until: ms timestamp (required for temp)
// - reason: string
exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const memberId = (event.memberId || '').trim()
    const mode = (event.mode || '').trim()
    const until = event.until === undefined ? 0 : Number(event.until)
    const reason = (event.reason || '').trim()

    assert(teamId && memberId, 'PARAM_INVALID', '参数缺失')
    assert(['clear', 'temp', 'forever'].includes(mode), 'PARAM_INVALID', 'mode 不合法')

    const op = await requireAdmin(db, teamId, OPENID)

    const mRes = await db.collection('members').doc(memberId).get().catch(() => null)
    const m = mRes && mRes.data
    assert(m && m.teamId === teamId, 'NOT_FOUND', '成员不存在')

    // 不允许对队长禁赛
    assert(m.role !== 'owner', 'NO_PERMISSION', '不能对队长禁赛')
    // admin 不能禁赛 admin（只有 owner 可以）
    if (op.role !== 'owner') {
      assert(m.role !== 'admin', 'NO_PERMISSION', '管理员不能禁赛管理员')
    }

    const now = Date.now()
    const patch = {
      updatedAt: now,
      banReason: reason,
      banForever: false,
      banUntil: 0,
    }

    if (mode === 'temp') {
      assert(Number.isFinite(until) && until > now, 'PARAM_INVALID', 'until 必须是未来时间戳')
      patch.banUntil = until
    }

    if (mode === 'forever') {
      patch.banForever = true
    }

    if (mode === 'clear') {
      patch.banReason = ''
      patch.banForever = false
      patch.banUntil = 0
    }

    await db.collection('members').doc(memberId).update({ data: patch })

    return ok({ memberId, mode, banUntil: patch.banUntil, banForever: patch.banForever })
  } catch (e) {
    console.error('[memberBanSet] error', e)
    return fail(e.code || 'INTERNAL', e.message || '操作失败')
  }
}

