// 公共工具（内置版）：云函数上传部署通常只打包当前目录；
// 因此不能依赖 ../common 或自定义 npm 包，否则云端可能找不到模块。

const cloud = require('wx-server-sdk')

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

module.exports = {
  cloud,
  ok,
  fail,
  assert,
  requireAdmin,
}

