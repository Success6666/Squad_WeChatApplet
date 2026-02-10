const { cloud, ok, fail } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function attachLogoUrl(list) {
  const fileIDs = (list || [])
    .map(t => (t && t.logoFileId) || '')
    .filter(s => typeof s === 'string' && /^cloud:\/\//.test(s))

  if (!fileIDs.length) return list

  // 去重
  const uniq = Array.from(new Set(fileIDs))

  // getTempFileURL 每次最多 50 个
  const batches = []
  const BATCH = 50
  for (let i = 0; i < uniq.length; i += BATCH) {
    batches.push(uniq.slice(i, i + BATCH))
  }

  const map = new Map()
  for (const b of batches) {
    const res = await cloud.getTempFileURL({ fileList: b })
    ;(res.fileList || []).forEach(it => {
      if (it && it.fileID && it.tempFileURL) map.set(it.fileID, it.tempFileURL)
    })
  }

  return (list || []).map(t => {
    const fileId = t && t.logoFileId
    const logoUrl = map.get(fileId) || ''
    return { ...t, logoUrl }
  })
}

exports.main = async (event, context) => {
  const db = cloud.database()
  try {
    const keyword = (event.keyword || '').trim()
    const page = Number(event.page || 0)
    const pageSize = Math.min(50, Math.max(1, Number(event.pageSize || 20)))

    const baseWhere = { isPublic: true }

    let list = []

    if (!keyword) {
      const res = await db.collection('teams').where(baseWhere).orderBy('createdAt', 'desc').skip(page * pageSize).limit(pageSize).get()
      list = res.data || []
      list = await attachLogoUrl(list)
      return ok({ list })
    }

    const looksLikeId = /^[0-9a-zA-Z_-]{12,32}$/.test(keyword)

    let idHit = []
    if (looksLikeId) {
      const idRes = await db.collection('teams').where({ ...baseWhere, _id: keyword }).limit(1).get().catch(() => ({ data: [] }))
      idHit = idRes.data || []
    }

    const nameRes = await db
      .collection('teams')
      .where({ ...baseWhere, name: db.RegExp({ regexp: keyword, options: 'i' }) })
      .orderBy('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    const map = new Map()
    for (const t of idHit.concat(nameRes.data || [])) {
      if (t && t._id) map.set(t._id, t)
    }

    list = Array.from(map.values())
    list = await attachLogoUrl(list)

    return ok({ list })
  } catch (e) {
    console.error('[teamList] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}
