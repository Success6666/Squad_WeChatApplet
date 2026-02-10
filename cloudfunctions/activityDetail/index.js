const { cloud, ok, fail, assert } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function getBanState(member, now) {
  if (!member) return { banned: false, reason: '' }
  if (member.banForever) return { banned: true, reason: member.banReason || '已被禁赛' }
  const until = Number(member.banUntil || 0)
  if (until && now < until) return { banned: true, reason: member.banReason || '禁赛中' }
  return { banned: false, reason: '' }
}

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const activityId = (event.activityId || '').trim()
    assert(teamId && activityId, 'PARAM_INVALID', '参数缺失')

    const aRes = await db.collection('activities').doc(activityId).get().catch(() => null)
    const activity = aRes && aRes.data
    assert(activity && activity.teamId === teamId, 'NOT_FOUND', '活动不存在')

    // 必须是已通过审核的战队成员才能查看
    const mRes = await db.collection('members').where({ teamId, openId: OPENID, status: 'approved' }).limit(1).get()
    const member = mRes.data && mRes.data[0]
    const isMemberApproved = !!member
    assert(isMemberApproved, 'NO_PERMISSION', '需要战队成员权限')

    const now = Date.now()
    const ban = getBanState(member, now)

    const sRes = await db
      .collection('signups')
      .where({ teamId, activityId, openId: OPENID, status: 'signed' })
      .limit(1)
      .get()
    const signed = !!(sRes.data && sRes.data[0])

    return ok({ activity, signed, isMemberApproved, ban })
  } catch (e) {
    console.error('[activityDetail] error', e)
    return fail(e.code || 'INTERNAL', e.message || '加载失败')
  }
}
