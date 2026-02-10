const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 编辑战队资料：管理员可操作（owner/admin）
exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    assert(teamId, 'PARAM_INVALID', 'teamId 必填')

    await requireAdmin(db, teamId, OPENID)

    const teamRes = await db.collection('teams').doc(teamId).get().catch(() => null)
    const team = teamRes && teamRes.data
    assert(team, 'NOT_FOUND', '战队不存在')

    const name = ((event.name || '') || (team && team.name) || '').trim()
    const desc = ((event.desc || '') || (team && team.desc) || '').trim()
    const isPublic = typeof event.isPublic === 'boolean' ? event.isPublic : undefined
    const logoFileId = (event.logoFileId || '').trim()
    const hasAnnouncement = Object.prototype.hasOwnProperty.call(event || {}, 'announcement')
    const announcement = hasAnnouncement ? String(event.announcement || '').trim() : undefined

    assert(name, 'PARAM_INVALID', '战队名称必填')
    assert(name.length <= 20, 'PARAM_INVALID', '战队名称过长')

    const now = Date.now()
    const update = {
      name,
      desc,
      updatedAt: now,
    }
    if (typeof isPublic === 'boolean') update.isPublic = isPublic
    if (logoFileId) update.logoFileId = logoFileId
    if (hasAnnouncement) {
      update.announcement = announcement
      update.announcementAt = now
    }

    // nameKey 同步
    update.nameKey = name.replace(/\s+/g, ' ').toLowerCase()

    // 唯一性：如果 nameKey 被其他队占用，拒绝
    const existed = await db.collection('teams').where({ nameKey: update.nameKey }).limit(5).get()
    const hit = (existed.data || []).find(t => t._id !== teamId)
    assert(!hit, 'DUPLICATE', '战队名称已存在')

    await db.collection('teams').doc(teamId).update({ data: update })

    return ok({ teamId })
  } catch (e) {
    console.error('[teamUpdate] error', e)
    return fail(e.code || 'INTERNAL', e.message || '更新失败')
  }
}
