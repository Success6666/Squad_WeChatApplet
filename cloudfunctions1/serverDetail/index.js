const { cloud, ok, fail, assert } = require('./common')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getServerById(serverId) {
  try {
    const r = await db.collection('servers').doc(serverId).get().catch(() => null)
    if (r && r.data) return r.data
  } catch (e) {}
  try {
    const r2 = await db.collection('server_info').doc(serverId).get().catch(() => null)
    if (r2 && r2.data) return r2.data
  } catch (e) {}
  return null
}

exports.main = async (event, context) => {
  try {
    const serverId = event.serverId
    assert(serverId, 'INVALID', 'serverId required')
    const server = await getServerById(serverId)
    assert(server, 'NOT_FOUND', 'server not found')
    // redact auth
    if (server.auth) server.auth = { method: server.auth.method }
    return ok({ server })
  } catch (e) {
    console.error('[serverDetail] fail', e)
    return fail(e.code || 'EXCEPTION', e.message || '查询失败')
  }
}
