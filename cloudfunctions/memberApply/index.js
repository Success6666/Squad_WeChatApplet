const { cloud, ok, fail, assert, isSteam64 } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const steamNick = (event.steamNick || '').trim()
    const steam64Id = (event.steam64Id || '').trim()
    const position = (event.position || '').trim()
    const onlineTime = (event.onlineTime || '').trim()

    assert(teamId, 'PARAM_INVALID', 'teamId 必填')
    assert(steamNick, 'PARAM_INVALID', 'Steam 昵称必填')
    assert(isSteam64(steam64Id), 'PARAM_INVALID', 'Steam64 ID 格式错误')

    // 确保战队存在
    const teamRes = await db.collection('teams').doc(teamId).get().catch(() => null)
    assert(teamRes && teamRes.data, 'NOT_FOUND', '战队不存在')

    const now = Date.now()
    const exist = await db.collection('members').where({ teamId, openId: OPENID }).limit(1).get()
    const old = exist.data && exist.data[0]

    if (old) {
      // 已存在：若已通过则只更新资料；否则重置为 pending
      const nextStatus = old.status === 'approved' ? 'approved' : 'pending'
      await db.collection('members').doc(old._id).update({
        data: {
          steamNick,
          steam64Id,
          position,
          onlineTime,
          status: nextStatus,
          appliedAt: now,
          updatedAt: now,
        },
      })
      return ok({ memberId: old._id, status: nextStatus })
    }

    const add = await db.collection('members').add({
      data: {
        teamId,
        openId: OPENID,
        role: 'member',
        status: 'pending',
        steamNick,
        steam64Id,
        position,
        onlineTime,
        appliedAt: now,
        approvedAt: 0,
        updatedAt: now,
      },
    })

    return ok({ memberId: add._id, status: 'pending' })
  } catch (e) {
    console.error('[memberApply] error', e)
    return fail(e.code || 'INTERNAL', e.message || '提交失败')
  }
}
