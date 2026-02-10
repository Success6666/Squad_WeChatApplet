const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function getLogoUrl(fileId) {
  if (!fileId || typeof fileId !== 'string') return ''
  if (/^https?:\/\//.test(fileId)) return fileId
  if (!/^cloud:\/\//.test(fileId)) return ''
  try {
    const res = await cloud.getTempFileURL({ fileList: [fileId] })
    const it = res.fileList && res.fileList[0]
    return (it && it.tempFileURL) || ''
  } catch (e) {
    console.error('[teamDetail] getTempFileURL fail', e)
    return ''
  }
}

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()
  try {
    const teamId = (event.teamId || '').trim()
    const includePending = !!event.includePending
    assert(teamId, 'PARAM_INVALID', 'teamId 必填')

    const teamRes = await db.collection('teams').doc(teamId).get().catch(() => null)
    const team = teamRes && teamRes.data
    assert(team, 'NOT_FOUND', '战队不存在')

    // ✅ 增加 logoUrl
    team.logoUrl = await getLogoUrl(team.logoFileId)

    const myRes = await db.collection('members').where({ teamId, openId: OPENID }).limit(1).get()
    const myMember = myRes.data && myRes.data[0]

    const isApproved = !!(myMember && myMember.status === 'approved')

    // 未加入或未通过审核：只返回战队基本信息和我的状态
    if (!isApproved) {
      return ok({
        team,
        members: [],
        activities: [],
        myMember: myMember || null,
        pendingMembers: [],
      })
    }

    // 通过审核：才返回成员/活动
    // 返回成员信息包含禁赛字段
    const membersRes = await db
      .collection('members')
      .where({ teamId, status: 'approved' })
      .field({
        teamId: true,
        openId: true,
        role: true,
        status: true,
        steamNick: true,
        steam64Id: true,
        position: true,
        onlineTime: true,
        appliedAt: true,
        approvedAt: true,
        updatedAt: true,
        banUntil: true,
        banForever: true,
        banReason: true,
      })
      .orderBy('approvedAt', 'asc')
      .limit(200)
      .get()

    const activitiesRes = await db
      .collection('activities')
      .where({ teamId })
      .orderBy('startTime', 'desc')
      .limit(5)
      .get()

    let pendingMembers = []
    if (includePending) {
      await requireAdmin(db, teamId, OPENID)
      const pendingRes = await db
        .collection('members')
        .where({ teamId, status: 'pending' })
        .orderBy('appliedAt', 'desc')
        .limit(200)
        .get()
      pendingMembers = pendingRes.data || []
    }

    return ok({
      team,
      members: membersRes.data || [],
      activities: activitiesRes.data || [],
      myMember: myMember || null,
      pendingMembers,
    })
  } catch (e) {
    console.error('[teamDetail] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}
