const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const title = (event.title || '').trim()
    const type = (event.type || '').trim()
    const startTime = Number(event.startTime)
    const signupDeadline = Number(event.signupDeadline)
    const opponent = (event.opponent || '').trim()
    const server = (event.server || '').trim()
    const limit = Number(event.limit)
    const desc = (event.desc || '').trim()

    assert(teamId, 'PARAM_INVALID', 'teamId 必填')
    assert(title, 'PARAM_INVALID', '标题必填')
    assert(['internal', 'skrimmage', 'official'].includes(type), 'PARAM_INVALID', 'type 不合法')
    assert(Number.isFinite(startTime) && startTime > Date.now(), 'PARAM_INVALID', '活动时间不合法')
    assert(Number.isFinite(signupDeadline) && signupDeadline < startTime, 'PARAM_INVALID', '截止时间不合法')
    assert(Number.isFinite(limit) && limit > 0 && limit <= 100, 'PARAM_INVALID', '人数限制不合法')

    await requireAdmin(db, teamId, OPENID)

    const now = Date.now()
    const add = await db.collection('activities').add({
      data: {
        teamId,
        title,
        type,
        startTime,
        signupDeadline,
        opponent,
        server,
        limit,
        desc,
        createdByOpenId: OPENID,
        createdAt: now,
        updatedAt: now,
        signupCount: 0,
      },
    })

    return ok({ activityId: add._id })
  } catch (e) {
    console.error('[activityCreate] error', e)
    return fail(e.code || 'INTERNAL', e.message || '发布失败')
  }
}
