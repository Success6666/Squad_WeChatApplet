const { cloud, ok, fail } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const res = await db.collection('profiles').where({ openId: OPENID }).limit(1).get()
    const profile = res.data && res.data[0]
    return ok({ profile: profile || null })
  } catch (e) {
    console.error('[profileGet] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}

