// Self-contained cloud SDK loader
let cloud
let loadedFrom = null
try {
  cloud = require('wx-server-sdk')
  loadedFrom = 'wx-server-sdk'
} catch (e) {
  try {
    cloud = require('tcb-admin-node')
    loadedFrom = 'tcb-admin-node'
  } catch (e2) {
    const msg = `Neither wx-server-sdk nor tcb-admin-node could be required. Original: ${e.message}; fallback: ${e2.message}`
    const err = new Error(msg)
    err.primary = e
    err.fallback = e2
    throw err
  }
}

try { if (cloud && cloud.init && typeof cloud.init === 'function') console.log('[_cloud] loaded SDK:', loadedFrom) } catch (e) {}

if (typeof cloud.SYMBOL_CURRENT_ENV === 'undefined') {
  cloud.SYMBOL_CURRENT_ENV = cloud.SYMBOL_CURRENT_ENV || cloud.CURRENT_ENV || undefined
}
if (typeof cloud.DYNAMIC_CURRENT_ENV === 'undefined') {
  cloud.DYNAMIC_CURRENT_ENV = cloud.DYNAMIC_CURRENT_ENV || undefined
}

function ok(data) { return { ok: true, data } }
function fail(code, message, extra) { const err = { ok: false, code, message }; if (extra) err.extra = extra; return err }
function assert(condition, code, message) { if (!condition) { const e = new Error(message || code); e.code = code; throw e } }
async function requireAdmin(db, teamId, openId) { const m = await db.collection('members').where({ teamId, openId, status: 'approved' }).limit(1).get(); const member = m.data && m.data[0]; assert(member, 'NO_PERMISSION', '你不是该战队成员或未通过审核'); assert(member.role === 'owner' || member.role === 'admin', 'NO_PERMISSION', '需要管理员权限'); return member }
async function requireApprovedMember(db, teamId, openId) { const m = await db.collection('members').where({ teamId, openId, status: 'approved' }).limit(1).get(); const member = m.data && m.data[0]; assert(member, 'NO_PERMISSION', '你不是该战队成员或未通过审核'); return member }
module.exports = { cloud, ok, fail, assert, requireAdmin, requireApprovedMember }
