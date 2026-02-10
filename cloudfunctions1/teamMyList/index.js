const { cloud, ok, fail } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function attachLogoUrl(list) {
  const fileIDs = (list || [])
    .map(t => (t && t.logoFileId) || '')
    .filter(s => typeof s === 'string' && /^cloud:\/\//.test(s))

  if (!fileIDs.length) return list

  const uniq = Array.from(new Set(fileIDs))
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

// 返回“我已加入(approved) 的战队列表” + “我拥有(owner) 的战队列表”
// 用于主页快速入口。
exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    // 先从 members 找到我加入的战队
    const mRes = await db
      .collection('members')
      .where({ openId: OPENID, status: 'approved' })
      .field({ teamId: true, role: true, approvedAt: true })
      .orderBy('approvedAt', 'desc')
      .limit(200)
      .get()

    const memberships = mRes.data || []
    const teamIds = Array.from(new Set(memberships.map(m => m.teamId).filter(Boolean)))

    if (!teamIds.length) {
      return ok({ list: [], memberships: [] })
    }

    // 云数据库 in 查询每次最多 100 个，分批拉取
    const batches = []
    const BATCH = 100
    for (let i = 0; i < teamIds.length; i += BATCH) {
      batches.push(teamIds.slice(i, i + BATCH))
    }

    let teams = []
    for (const ids of batches) {
      const tRes = await db.collection('teams').where({ _id: db.command.in(ids) }).get()
      teams = teams.concat(tRes.data || [])
    }

    // 按 membership 顺序排序（approvedAt desc）
    const order = new Map(teamIds.map((id, idx) => [id, idx]))
    teams.sort((a, b) => (order.get(a._id) ?? 9999) - (order.get(b._id) ?? 9999))

    teams = await attachLogoUrl(teams)

    return ok({ list: teams, memberships })
  } catch (e) {
    console.error('[teamMyList] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}
