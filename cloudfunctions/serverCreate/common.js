// Self-contained cloud SDK loader
let cloud
try {
  cloud = require('wx-server-sdk')
} catch (e) {
  try {
    cloud = require('tcb-admin-node')
  } catch (e2) {
    const err = new Error(`Cannot load cloud SDK: ${e.message}; fallback: ${e2.message}`)
    err.primary = e
    err.fallback = e2
    throw err
  }
}

function ok(data) {
  return { ok: true, data }
}

function fail(code, message, extra) {
  const err = { ok: false, code, message }
  if (extra) err.extra = extra
  return err
}

function assert(condition, code, message) {
  if (!condition) {
    const e = new Error(message || code)
    e.code = code
    throw e
  }
}

function isSteam64(id) {
  return /^\d{17}$/.test((id || '').trim())
}

async function requireAdmin(db, teamId, openId) {
  const m = await db
    .collection('members')
    .where({ teamId, openId, status: 'approved' })
    .limit(1)
    .get()

  const member = m.data && m.data[0]
  assert(member, 'NO_PERMISSION', '你不是该战队成员或未通过审核')
  assert(member.role === 'owner' || member.role === 'admin', 'NO_PERMISSION', '需要管理员权限')
  return member
}

async function requireApprovedMember(db, teamId, openId) {
  const m = await db
    .collection('members')
    .where({ teamId, openId, status: 'approved' })
    .limit(1)
    .get()
  const member = m.data && m.data[0]
  assert(member, 'NO_PERMISSION', '你不是该战队成员或未通过审核')
  return member
}

module.exports = {
  cloud,
  ok,
  fail,
  assert,
  isSteam64,
  requireAdmin,
  requireApprovedMember,
}
