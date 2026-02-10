const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const memberId = (event.memberId || '').trim()
    assert(teamId && memberId, 'PARAM_INVALID', '参数缺失')

    const op = await requireAdmin(db, teamId, OPENID)

    const mRes = await db.collection('members').doc(memberId).get().catch(() => null)
    const m = mRes && mRes.data
    assert(m && m.teamId === teamId, 'NOT_FOUND', '成员不存在')

    // 不能踢队长
    assert(m.role !== 'owner', 'NO_PERMISSION', '不能踢出队长')

    // admin 不能踢 admin（只有 owner 可以）
    if (op.role !== 'owner') {
      assert(m.role !== 'admin', 'NO_PERMISSION', '管理员不能踢出管理员')
    }

    const now = Date.now()
    await db.collection('members').doc(memberId).update({
      data: {
        status: 'kicked',
        updatedAt: now,
      },
    })

    // 更新 team memberCount（重新统计 approved）
    const countRes = await db.collection('members').where({ teamId, status: 'approved' }).count()
    await db.collection('teams').doc(teamId).update({ data: { memberCount: countRes.total, updatedAt: now } })

    return ok({ memberId, status: 'kicked', memberCount: countRes.total })
  } catch (e) {
    console.error('[memberKick] error', e)
    return fail(e.code || 'INTERNAL', e.message || '踢出失败')
  }
}

