const { cloud, ok, fail, assert, requireApprovedMember } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const page = Number(event.page || 0)
    const pageSize = Math.min(50, Math.max(1, Number(event.pageSize || 20)))
    assert(teamId, 'PARAM_INVALID', 'teamId 必填')

    // 只有已通过审核的队员才能查看战队活动列表
    await requireApprovedMember(db, teamId, OPENID)

    const res = await db
      .collection('activities')
      .where({ teamId })
      .orderBy('startTime', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    return ok({ list: res.data || [] })
  } catch (e) {
    console.error('[activityList] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}
