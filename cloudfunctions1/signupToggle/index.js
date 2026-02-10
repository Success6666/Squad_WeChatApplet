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
    const action = (event.action || '').trim() // signup / cancel

    assert(teamId && activityId, 'PARAM_INVALID', '参数缺失')
    assert(action === 'signup' || action === 'cancel', 'PARAM_INVALID', 'action 不合法')

    const now = Date.now()

    // 必须是已通过审核的队员（并取出禁赛信息）
    const mRes = await db.collection('members').where({ teamId, openId: OPENID, status: 'approved' }).limit(1).get()
    const member = mRes.data && mRes.data[0]
    assert(member, 'NO_PERMISSION', '你不是该战队成员或未通过审核')

    if (action === 'signup') {
      const ban = getBanState(member, now)
      assert(!ban.banned, 'NO_PERMISSION', ban.reason)
    }

    const aRes = await db.collection('activities').doc(activityId).get().catch(() => null)
    const a = aRes && aRes.data
    assert(a && a.teamId === teamId, 'NOT_FOUND', '活动不存在')

    assert(!a.signupDeadline || now <= a.signupDeadline, 'STATE_INVALID', '已过截止时间')
    assert(!a.startTime || now <= a.startTime, 'STATE_INVALID', '活动已结束')

    const existRes = await db.collection('signups').where({ teamId, activityId, openId: OPENID }).limit(1).get()
    const exist = existRes.data && existRes.data[0]

    if (action === 'signup') {
      if (Number.isFinite(a.limit) && a.limit > 0) {
        const cnt = await db.collection('signups').where({ teamId, activityId, status: 'signed' }).count()
        assert(cnt.total < a.limit, 'FULL', '报名人数已满')
      }

      if (exist) {
        if (exist.status === 'signed') return ok({ status: 'signed' })
        await db.collection('signups').doc(exist._id).update({ data: { status: 'signed', updatedAt: now } })
      } else {
        await db.collection('signups').add({
          data: { teamId, activityId, openId: OPENID, status: 'signed', createdAt: now, updatedAt: now },
        })
      }
    } else {
      if (!exist || exist.status !== 'signed') return ok({ status: 'canceled' })
      await db.collection('signups').doc(exist._id).update({ data: { status: 'canceled', updatedAt: now } })
    }

    const countRes = await db.collection('signups').where({ teamId, activityId, status: 'signed' }).count()
    await db.collection('activities').doc(activityId).update({ data: { signupCount: countRes.total, updatedAt: now } })

    return ok({ status: action === 'signup' ? 'signed' : 'canceled', signupCount: countRes.total })
  } catch (e) {
    console.error('[signupToggle] error', e)
    return fail(e.code || 'INTERNAL', e.message || '操作失败')
  }
}
