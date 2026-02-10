// 公共工具（内置版）：云函数上传部署通常只打包当前目录

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

function isSteam64(id) {
  return /^\d{17}$/.test((id || '').trim())
}

module.exports = { cloud, ok, fail, assert, isSteam64 }

