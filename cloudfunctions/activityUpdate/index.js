const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const activityId = (event.activityId || '').trim()
    assert(teamId && activityId, 'PARAM_INVALID', 'teamId/activityId 必填')

    await requireAdmin(db, teamId, OPENID)

    const aRes = await db.collection('activities').doc(activityId).get().catch(() => null)
    const a = aRes && aRes.data
    assert(a && a.teamId === teamId, 'NOT_FOUND', '活动不存在')

    const patch = {}
    if (typeof event.title === 'string') patch.title = event.title.trim()
    if (typeof event.type === 'string') patch.type = event.type.trim()
    if (event.startTime !== undefined) patch.startTime = Number(event.startTime)
    if (event.signupDeadline !== undefined) patch.signupDeadline = Number(event.signupDeadline)
    if (typeof event.opponent === 'string') patch.opponent = event.opponent.trim()
    if (typeof event.server === 'string') patch.server = event.server.trim()
    if (event.limit !== undefined) patch.limit = Number(event.limit)
    if (typeof event.desc === 'string') patch.desc = event.desc.trim()

    // 校验：如果传了时间字段
    if (patch.startTime !== undefined) {
      assert(Number.isFinite(patch.startTime) && patch.startTime > Date.now(), 'PARAM_INVALID', '活动时间不合法')
    }
    if (patch.signupDeadline !== undefined) {
      assert(Number.isFinite(patch.signupDeadline), 'PARAM_INVALID', '截止时间不合法')
    }
    if (patch.startTime !== undefined && patch.signupDeadline !== undefined) {
      assert(patch.signupDeadline < patch.startTime, 'PARAM_INVALID', '截止时间需早于活动开始')
    }

    if (patch.type !== undefined) {
      assert(['internal', 'skrimmage', 'official'].includes(patch.type), 'PARAM_INVALID', 'type 不合法')
    }

    if (patch.limit !== undefined) {
      assert(Number.isFinite(patch.limit) && patch.limit > 0 && patch.limit <= 100, 'PARAM_INVALID', '人数限制不合法')
    }

    if (patch.title !== undefined) {
      assert(patch.title, 'PARAM_INVALID', '标题必填')
    }

    const now = Date.now()
    patch.updatedAt = now

    await db.collection('activities').doc(activityId).update({ data: patch })

    return ok({ activityId, updated: true })
  } catch (e) {
    console.error('[activityUpdate] error', e)
    return fail(e.code || 'INTERNAL', e.message || '更新失败')
  }
}

