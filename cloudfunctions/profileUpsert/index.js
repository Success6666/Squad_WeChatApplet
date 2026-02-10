const { cloud, ok, fail, assert, isSteam64 } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const steamNick = (event.steamNick || '').trim()
    const steam64Id = (event.steam64Id || '').trim()
    const position = (event.position || '').trim()
    const onlineTime = (event.onlineTime || '').trim()

    assert(steamNick, 'PARAM_INVALID', '请填写 Steam 昵称')
    assert(isSteam64(steam64Id), 'PARAM_INVALID', 'Steam64 ID 格式错误')

    const now = Date.now()
    const res = await db.collection('profiles').where({ openId: OPENID }).limit(1).get()
    const old = res.data && res.data[0]

    if (old) {
      await db.collection('profiles').doc(old._id).update({
        data: { steamNick, steam64Id, position, onlineTime, updatedAt: now },
      })
      return ok({ profileId: old._id })
    }

    const add = await db.collection('profiles').add({
      data: { openId: OPENID, steamNick, steam64Id, position, onlineTime, createdAt: now, updatedAt: now },
    })

    return ok({ profileId: add._id })
  } catch (e) {
    console.error('[profileUpsert] error', e)
    return fail(e.code || 'INTERNAL', e.message || '保存失败')
  }
}
