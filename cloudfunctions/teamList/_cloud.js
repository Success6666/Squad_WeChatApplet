// Compatibility loader copied from root _cloud.js
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
if (typeof cloud.SYMBOL_CURRENT_ENV === 'undefined') cloud.SYMBOL_CURRENT_ENV = cloud.SYMBOL_CURRENT_ENV || cloud.CURRENT_ENV || undefined
if (typeof cloud.DYNAMIC_CURRENT_ENV === 'undefined') cloud.DYNAMIC_CURRENT_ENV = cloud.DYNAMIC_CURRENT_ENV || undefined
module.exports = cloud

