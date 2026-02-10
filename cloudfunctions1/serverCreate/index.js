const { cloud, ok, fail, assert } = require('./common')
const crypto = require('crypto')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getServersColl() {
  try { await db.collection('servers').limit(1).get(); return db.collection('servers') } catch (e) {}
  try { await db.collection('server_info').limit(1).get(); return db.collection('server_info') } catch (e) {}
  return null
}

async function getSecretKeyBuffer() {
  const raw = process.env.SECRET_KEY || process.env.SECRET || null
  if (raw) return crypto.createHash('sha256').update(String(raw)).digest()
  try { const doc = await db.collection('config').doc('SECRET_KEY').get().catch(() => null); const val = doc && doc.data && doc.data.value; if (val) return crypto.createHash('sha256').update(String(val)).digest() } catch (e) {}
  try { const doc2 = await db.collection('secrets').doc('SECRET_KEY').get().catch(() => null); const val2 = doc2 && doc2.data && doc2.data.value; if (val2) return crypto.createHash('sha256').update(String(val2)).digest() } catch (e) {}
  return null
}

async function encryptSecretAsync(plaintext) {
  const key = await getSecretKeyBuffer()
  if (!key) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

function isCollectionNotExistError(e) {
  try {
    const code = e && e.code
    const msg = (e && e.message) || ''
    return code === -502005 || /collection not exist/i.test(msg) || /collection not exdsts/i.test(msg)
  } catch (x) { return false }
}

exports.main = async (event, context) => {
  try {
    const openId = (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID)
    assert(openId, 'NO_SESSION')

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

    const name = (event.name || '').trim()
    const host = (event.host || '').trim()
    const port = parseInt(event.port || 0)
    const type = (event.type || 'rcon')

    assert(name, 'INVALID', 'name required')
    assert(host, 'INVALID', 'host required')
    assert(port > 0, 'INVALID', 'port required')

    const doc = { name, host, port, type, createdBy: openId, createdAt: Date.now(), updatedAt: Date.now() }
    if (teamId) doc.teamId = teamId
    if (typeof event.adminOnly !== 'undefined') doc.adminOnly = !!event.adminOnly

    if (event.auth && event.auth.method && event.auth.secretPlaintext) {
      // store plaintext for now (no encryption) per user request
      doc.auth = { method: event.auth.method, password: String(event.auth.secretPlaintext) }
    }

    let coll = await getServersColl()
    if (!coll) {
      // try to create collections by invoking initCollections once
      try {
        if (cloud && typeof cloud.callFunction === 'function') {
          await cloud.callFunction({ name: 'initCollections', data: {} }).catch(() => null)
        }
      } catch (e) {
        // ignore
      }
      // re-evaluate coll
      coll = await getServersColl()
    }

    if (!coll) {
      // if still no collection, attempt direct adds with careful error handling
      try {
        const res = await db.collection('servers').add({ data: doc })
        return ok({ serverId: res._id || res.id })
      } catch (e) {
        if (isCollectionNotExistError(e)) {
          // try fallback
          try {
            const res2 = await db.collection('server_info').add({ data: doc })
            return ok({ serverId: res2._id || res2.id })
          } catch (e2) {
            if (isCollectionNotExistError(e2)) {
              return fail('NO_COLLECTION', '目标数据库集合不存在，请在云控制台执行 initCollections 或手动创建集合（servers 或 server_info）')
            }
            throw e2
          }
        }
        throw e
      }
    }

    try {
      const res = await coll.add({ data: doc })
      return ok({ serverId: res._id || res.id })
    } catch (e) {
      if (isCollectionNotExistError(e)) {
        // unlikely, but try fallback create
        try {
          const res2 = await db.collection('server_info').add({ data: doc })
          return ok({ serverId: res2._id || res2.id })
        } catch (e2) {
          if (isCollectionNotExistError(e2)) return fail('NO_COLLECTION', '目标数据库集合不存在，请在云控制台执行 initCollections 或手动创建集合（servers 或 server_info）')
          throw e2
        }
      }
      throw e
    }
  } catch (e) {
    console.error('[serverCreate] fail', e)
    return fail(e.code || 'EXCEPTION', e.message || '创建失败')
  }
}
