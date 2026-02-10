// 公共工具（内置版）：云函数部署时通常只打包当前目录，避免依赖 ../common 或自定义 npm 包。

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

module.exports = {
  cloud,
  ok,
  fail,
  assert,
}

