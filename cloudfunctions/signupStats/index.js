const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const _ = db.command
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const activityId = (event.activityId || '').trim()
    assert(teamId && activityId, 'PARAM_INVALID', 'teamId/activityId 必填')

    await requireAdmin(db, teamId, OPENID)

    const sRes = await db
      .collection('signups')
      .where({ teamId, activityId, status: 'signed' })
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get()

    const openIds = (sRes.data || []).map(s => s.openId)
    if (!openIds.length) return ok({ list: [], count: 0 })

    const mRes = await db
      .collection('members')
      .where({ teamId, openId: _.in(openIds), status: 'approved' })
      .limit(200)
      .get()

    const map = new Map((mRes.data || []).map(m => [m.openId, m]))
    const list = openIds.map(oid => map.get(oid)).filter(Boolean)

    return ok({ list, count: list.length })
  } catch (e) {
    console.error('[signupStats] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}
