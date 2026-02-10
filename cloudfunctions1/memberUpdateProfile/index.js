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

    const mRes = await db.collection('members').where({ teamId, openId: OPENID }).limit(1).get()
    const m = mRes.data && mRes.data[0]
    assert(m, 'NOT_FOUND', '你还未申请加入该战队')

    const now = Date.now()
    await db.collection('members').doc(m._id).update({
      data: {
        steamNick,
        steam64Id,
        position,
        onlineTime,
        updatedAt: now,
      },
    })

    return ok({ memberId: m._id })
  } catch (e) {
    console.error('[memberUpdateProfile] error', e)
    return fail(e.code || 'INTERNAL', e.message || '保存失败')
  }
}
