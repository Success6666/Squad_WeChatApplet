const { cloud, ok, fail, assert, requireOwner } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 解散战队：仅队长(owner)可操作。
// 处理策略：
// - teams：直接删除
// - members：标记为 removed（保留历史），避免大量 delete
// - activities：标记为 removed
// - signups：标记为 canceled
exports.main = async (event, context) => {
  const db = cloud.database()
  const _ = db.command
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    assert(teamId, 'PARAM_INVALID', 'teamId 必填')

    await requireOwner(db, teamId, OPENID)

    const now = Date.now()

    // 1) 删除 teams 文档
    await db.collection('teams').doc(teamId).remove()

    // 2) members 标记 removed
    await db.collection('members').where({ teamId }).update({ data: { status: 'removed', updatedAt: now } }).catch(() => null)

    // 3) activities 标记 removed
    await db.collection('activities').where({ teamId }).update({ data: { removed: true, updatedAt: now } }).catch(() => null)

    // 4) signups 标记 canceled
    await db.collection('signups').where({ teamId, status: _.neq('canceled') }).update({ data: { status: 'canceled', updatedAt: now } }).catch(() => null)

    return ok({ teamId })
  } catch (e) {
    console.error('[teamRemove] error', e)
    return fail(e.code || 'INTERNAL', e.message || '解散失败')
  }
}

