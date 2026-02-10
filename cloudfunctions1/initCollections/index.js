// One-time initializer for required database collections
// Usage: deploy this cloud function and invoke it once from the Mini Program or Cloud Console.
// It will create the following collections if they do not exist:
// teams, members, activities, signups, server_info, admin_list, player_data

// Compatibility loader: try common SDKs in order for different cloud runtimes
let cloud
let loadedSdk = null
try {
  cloud = require('wx-server-sdk')
  loadedSdk = 'wx-server-sdk'
} catch (e) {
  try {
    cloud = require('tcb-admin-node')
    loadedSdk = 'tcb-admin-node'
  } catch (e2) {
    try {
      cloud = require('@cloudbase/node-sdk')
      loadedSdk = '@cloudbase/node-sdk'
    } catch (e3) {
      console.error('No cloud sdk available', e, e2, e3)
      // don't throw here; we'll handle absence of SDK later and return a clear message
      cloud = null
      loadedSdk = null
    }
  }
}

// init (use dynamic env so it runs in current cloud env)
try {
  if (cloud && cloud.init && typeof cloud.init === 'function') {
    // prefer dynamic env constants where available
    const env = cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV || cloud.CURRENT_ENV
    cloud.init({ env })
    console.log('[initCollections] loaded cloud SDK:', loadedSdk, 'env:', env)
  }
} catch (e) {
  console.warn('[initCollections] cloud.init failed or not required', e && e.message)
}

// obtain db instance
let db = null
try {
  if (cloud && cloud.database) db = cloud.database()
} catch (e) {
  console.error('[initCollections] failed to get cloud.database()', e)
}

exports.main = async (event, context) => {
  const names = ['teams', 'members', 'activities', 'signups', 'server_info', 'admin_list', 'player_data']
  const created = []
  const skipped = []

  if (!db) {
    console.error('database not available')
    return { ok: false, message: 'database not available' }
  }

  for (const name of names) {
    try {
      // try reading - if collection does not exist, this will still work on CloudBase.
      // To ensure existence, attempt to add a sentinel doc then remove it.
      const sentinel = { _init: true, createdAt: Date.now() }
      const addRes = await db.collection(name).add({ data: sentinel })
      // support both wx-server-sdk (returns _id) and admin SDK (returns id)
      const docId = (addRes && (addRes.id || addRes._id))
      if (docId) {
        // remove sentinel doc
        await db.collection(name).doc(docId).remove().catch(() => null)
        created.push(name)
      } else {
        skipped.push(name)
      }
    } catch (e) {
      // log and continue
      console.error('initCollections error for', name, e)
      // If operation failed because collection exists, skip
      skipped.push(name)
    }
  }

  return {
    ok: true,
    created,
    skipped,
    message: 'initCollections finished. Collections created (if any). '
  }
}
