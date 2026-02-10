// 公共工具（内置版）：云函数部署仅打包当前目录，避免依赖 ../common。

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
  const res = await db
    .collection('members')
    .where({ teamId, openId, status: 'approved' })
    .limit(1)
    .get()
  const m = res.data && res.data[0]
  assert(m, 'NO_PERMISSION', '需要战队成员权限')
  assert(m.role === 'owner' || m.role === 'admin', 'NO_PERMISSION', '需要管理员权限')
  return m
}

module.exports = {
  cloud,
  ok,
  fail,
  assert,
  requireAdmin,
}

