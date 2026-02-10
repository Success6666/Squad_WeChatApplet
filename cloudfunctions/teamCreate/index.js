const { cloud, ok, fail, assert } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const name = (event.name || '').trim()
    const desc = (event.desc || '').trim()
    const isPublic = !!event.isPublic
    const logoFileId = (event.logoFileId || '').trim()

    assert(name, 'PARAM_INVALID', '战队名称必填')
    assert(name.length <= 20, 'PARAM_INVALID', '战队名称过长')

    // 名称归一化：用于唯一性判断（避免大小写/多空格造成误判）
    const nameKey = name.replace(/\s+/g, ' ').toLowerCase()

    // 简单唯一性校验（按 nameKey 不允许重复）
    const existed = await db.collection('teams').where({ nameKey }).limit(1).get()
    assert(!(existed.data && existed.data.length), 'DUPLICATE', '战队名称已存在')

    const now = Date.now()
    const addRes = await db.collection('teams').add({
      data: {
        name,
        nameKey,
        desc,
        logoFileId,
        isPublic,
        ownerOpenId: OPENID,
        createdAt: now,
        updatedAt: now,
        memberCount: 1,
      },
    })

    const teamId = addRes._id

    await db.collection('members').add({
      data: {
        teamId,
        openId: OPENID,
        role: 'owner',
        status: 'approved',
        steamNick: '队长',
        steam64Id: '00000000000000000',
        position: '',
        onlineTime: '',
        appliedAt: now,
        approvedAt: now,
        updatedAt: now,
      },
    })

    console.log('[teamCreate] ok', { teamId, openId: OPENID })
    return ok({ teamId })
  } catch (e) {
    console.error('[teamCreate] error', e)
    return fail(e.code || 'INTERNAL', e.message || '创建失败')
  }
}
