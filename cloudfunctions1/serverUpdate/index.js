const { cloud, ok, fail, assert } = require('./common')
const crypto = require('crypto')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function requireSecretKey() {
  const raw = process.env.SECRET_KEY || process.env.SECRET || null
  if (!raw) return null
  return crypto.createHash('sha256').update(String(raw)).digest()
}

function encryptSecret(plaintext) {
  const key = requireSecretKey()
  if (!key) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

exports.main = async (event, context) => {
  try {
    const openId = (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID)
    assert(openId, 'NO_SESSION')

    const serverId = (event.serverId || '').trim()
    assert(serverId, 'INVALID', 'serverId required')

    // permission: allow team admins/owners for team-scoped servers, or global admins
    let isAdmin = false
    const teamId = (event.teamId || '').trim()
    if (teamId) {
      const mRes = await db.collection('members').where({ teamId, openId, status: 'approved' }).limit(1).get()
      const member = mRes.data && mRes.data[0]
      isAdmin = !!(member && (member.role === 'owner' || member.role === 'admin'))
    }
    if (!isAdmin) {
      const adminCheck = await db.collection('admin_list').where({ openId }).limit(1).get()
      isAdmin = adminCheck.data && adminCheck.data.length > 0
    }
    assert(isAdmin, 'NO_PERMISSION', '需要管理员权限')

    // validate fields
    const updates = {}
    if (typeof event.name !== 'undefined') updates.name = (event.name || '').trim()
    if (typeof event.host !== 'undefined') updates.host = (event.host || '').trim()
    if (typeof event.port !== 'undefined') updates.port = parseInt(event.port || 0)
    if (typeof event.type !== 'undefined') updates.type = (event.type || 'rcon')
    if (typeof event.adminOnly !== 'undefined') updates.adminOnly = !!event.adminOnly

    if (!updates.name) return fail('INVALID', 'name required')
    if (!updates.host) return fail('INVALID', 'host required')
    if (!Number.isFinite(updates.port) || updates.port <= 0) return fail('INVALID', 'port required')

    // handle auth marker or encrypt if SECRET_KEY available
    if (event.auth && event.auth.method && event.auth.secretPlaintext) {
      // store plaintext for now
      updates.auth = { method: event.auth.method, password: String(event.auth.secretPlaintext) }
    }

    updates.updatedAt = Date.now()

    await db.collection('servers').doc(serverId).update({ data: updates })
    return ok({ serverId })
  } catch (e) {
    console.error('[serverUpdate] fail', e)
    return fail(e.code || 'EXCEPTION', e.message || '更新失败')
  }
}
