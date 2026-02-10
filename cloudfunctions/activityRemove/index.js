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

    const aRes = await db.collection('activities').doc(activityId).get().catch(() => null)
    const a = aRes && aRes.data
    assert(a && a.teamId === teamId, 'NOT_FOUND', '活动不存在')

    const now = Date.now()

    // 删除活动
    await db.collection('activities').doc(activityId).remove()

    // 同时取消/清理报名记录（保留数据也可，这里直接标记 canceled）
    await db
      .collection('signups')
      .where({ teamId, activityId })
      .update({ data: { status: 'canceled', updatedAt: now } })

    return ok({ activityId, removed: true })
  } catch (e) {
    console.error('[activityRemove] error', e)
    return fail(e.code || 'INTERNAL', e.message || '删除失败')
  }
}

