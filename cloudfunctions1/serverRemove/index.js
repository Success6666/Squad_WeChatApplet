const { cloud, ok, fail, assert } = require('./common')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  try {
    const openId = (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID)
    assert(openId, 'NO_SESSION', '未登录')

    const serverId = (event.serverId || '').trim()
    const teamId = (event.teamId || '').trim()
    assert(serverId, 'INVALID', 'serverId required')
    assert(teamId, 'INVALID', 'teamId required')

    // verify that caller is owner of teamId
    const mRes = await db.collection('members').where({ teamId, openId, status: 'approved' }).limit(1).get()
    const member = mRes.data && mRes.data[0]
    assert(member && member.role === 'owner', 'NO_PERMISSION', '仅战队队长可解绑')

    // fetch server doc
    const sRes = await db.collection('servers').doc(serverId).get().catch(() => null)
    const server = sRes && sRes.data
    assert(server, 'NOT_FOUND', '服务器不存在')
    // ensure teamId matches
    if ((server.teamId || '') !== teamId) {
      return fail('MISMATCH', '服务器未绑定到该战队')
    }

    // perform unbind: clear teamId and adminOnly flag
    await db.collection('servers').doc(serverId).update({ data: { teamId: '', adminOnly: false, updatedAt: Date.now() } })

    return ok({ serverId })
  } catch (e) {
    console.error('[serverRemove] fail', e)
    return fail(e.code || 'EXCEPTION', e.message || '解绑失败')
  }
}
