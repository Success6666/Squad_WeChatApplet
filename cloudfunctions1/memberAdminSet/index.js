const { cloud, ok, fail, assert, requireAdmin } = require('./common')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()

  try {
    const teamId = (event.teamId || '').trim()
    const memberId = (event.memberId || '').trim()
    const makeAdmin = !!event.makeAdmin
    assert(teamId && memberId, 'PARAM_INVALID', '参数缺失')

    const op = await requireAdmin(db, teamId, OPENID)
    assert(op.role === 'owner', 'NO_PERMISSION', '只有队长可以设置管理员')

    const mRes = await db.collection('members').doc(memberId).get().catch(() => null)
    const m = mRes && mRes.data
    assert(m && m.teamId === teamId, 'NOT_FOUND', '成员不存在')
    assert(m.status === 'approved', 'STATE_INVALID', '该成员未通过审核')

    // owner 不可被降级
    assert(m.role !== 'owner', 'NO_PERMISSION', '不能修改队长角色')

    const now = Date.now()
    await db.collection('members').doc(memberId).update({
      data: {
        role: makeAdmin ? 'admin' : 'member',
        updatedAt: now,
      },
    })

    return ok({ memberId, role: makeAdmin ? 'admin' : 'member' })
  } catch (e) {
    console.error('[memberAdminSet] error', e)
    return fail(e.code || 'INTERNAL', e.message || '设置失败')
  }
}

