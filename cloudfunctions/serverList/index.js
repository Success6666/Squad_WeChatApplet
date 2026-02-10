const { cloud, ok, fail } = require('./common')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getServersColl() {
  // prefer 'servers' if it exists, otherwise fall back to 'server_info'
  try {
    // try a cheap read
    await db.collection('servers').limit(1).get()
    return db.collection('servers')
  } catch (e) {
    try {
      await db.collection('server_info').limit(1).get()
      return db.collection('server_info')
    } catch (e2) {
      // neither exists
      return null
    }
  }
}

function isCollectionNotExistError(e) {
  try {
    const msg = (e && e.message) || ''
    const code = e && e.code
    return code === -502005 || /collection not exist/i.test(msg) || /collection not exdsts/i.test(msg)
  } catch (x) { return false }
}

exports.main = async (event, context) => {
  try {
    const teamId = (event.teamId || '').trim()
    const coll = await getServersColl()
    if (!coll) {
      return ok({ items: [], total: 0 })
    }

    if (teamId) {
      // return servers for this team (no pagination)
      try {
        const res = await coll.where({ teamId }).get()
        const items = (res.data || []).map(s => { const { auth, ...rest } = s; return rest })
        return ok({ items, total: items.length })
      } catch (e) {
        console.warn('[serverList] teamId query failed', e && e.message)
        if (isCollectionNotExistError(e)) {
          return ok({ items: [], total: 0 })
        }
        throw e
      }
    }

    const page = Math.max(1, parseInt(event.page || 1))
    const pageSize = Math.min(50, parseInt(event.pageSize || 20))
    const skip = (page - 1) * pageSize

    // simple filtering by name
    const filter = {}
    if (event.filter && event.filter.name) {
      filter.name = new RegExp(event.filter.name, 'i')
    }

    try {
      const q = coll.where(filter)
      const totalRes = await q.count()
      const dataRes = await q.skip(skip).limit(pageSize).get()

      // redact sensitive fields
      const items = (dataRes.data || []).map(s => {
        const { auth, ...rest } = s
        return rest
      })

      return ok({ items, total: totalRes.total })
    } catch (e) {
      console.warn('[serverList] paged query failed', e && e.message)
      if (isCollectionNotExistError(e)) return ok({ items: [], total: 0 })
      throw e
    }
  } catch (e) {
    console.error('[serverList] fail', e)
    return fail('EXCEPTION', '取列表失败', { message: e.message })
  }
}
