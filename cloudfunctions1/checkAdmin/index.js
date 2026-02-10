const { cloud, ok, fail } = require('./common')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// checkAdmin cloud function: returns whether the current openid is admin of the provided teamId (or global admin)
exports.main = async (event, context) => {
  try {
    const openId = (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID)
    if (!openId) return fail('NO_SESSION', '未检测到登录')

    const teamId = event && event.teamId
    if (!teamId) {
      // global admin check: check admin_list collection for openid
      const r = await db.collection('admin_list').where({ openId }).limit(1).get()
      const isAdmin = r.data && r.data.length > 0
      return ok({ isAdmin })
    }

    // team-specific admin: check members collection role
    const m = await db.collection('members').where({ teamId, openId, status: 'approved' }).limit(1).get()
    const member = m.data && m.data[0]
    const isAdmin = !!(member && (member.role === 'owner' || member.role === 'admin'))
    return ok({ isAdmin })
  } catch (e) {
    console.error('[checkAdmin] fail', e)
    return fail('EXCEPTION', '检查失败', { message: e.message })
  }
}
