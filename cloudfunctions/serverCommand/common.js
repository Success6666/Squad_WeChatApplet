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

function ok(data) { return { ok: true, data } }
function fail(code, message, extra) { const err = { ok: false, code, message }; if (extra) err.extra = extra; return err }
function assert(condition, code, message) { if (!condition) { const e = new Error(message || code); e.code = code; throw e } }
module.exports = { cloud, ok, fail, assert }
