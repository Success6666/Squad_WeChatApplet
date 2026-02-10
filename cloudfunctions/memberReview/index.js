const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const memberId = (event.memberId || '').trim()
    const action = (event.action || '').trim() // approved / rejected

    assert(teamId && memberId, 'PARAM_INVALID', '参数缺失')
    assert(action === 'approved' || action === 'rejected', 'PARAM_INVALID', 'action 不合法')

    await requireAdmin(db, teamId, OPENID)

    const mRes = await db.collection('members').doc(memberId).get().catch(() => null)
    const m = mRes && mRes.data
    assert(m && m.teamId === teamId, 'NOT_FOUND', '申请不存在')
    assert(m.status === 'pending', 'STATE_INVALID', '该申请已处理')

    const now = Date.now()
    await db.collection('members').doc(memberId).update({
      data: {
        status: action,
        approvedAt: action === 'approved' ? now : 0,
        updatedAt: now,
      },
    })

    // 通过审核后，更新战队成员数（仅统计 approved）
    if (action === 'approved') {
      const countRes = await db.collection('members').where({ teamId, status: 'approved' }).count()
      await db.collection('teams').doc(teamId).update({ data: { memberCount: countRes.total, updatedAt: now } })
    }

    return ok({ memberId, status: action })
  } catch (e) {
    console.error('[memberReview] error', e)
    return fail(e.code || 'INTERNAL', e.message || '操作失败')
  }
}
