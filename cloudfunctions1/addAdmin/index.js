// Local SDK loader
let cloud
try {
  cloud = require('wx-server-sdk')
} catch (e) {
  try { cloud = require('tcb-admin-node') } catch (e2) { throw new Error(`Neither wx-server-sdk nor tcb-admin-node could be required. ${e.message} / ${e2 && e2.message}`) }
}
// ✅ 修复致命错误1：删除无效的 cloud.SYMBOL_CURRENT，保留官方唯一合法常量
if (cloud && cloud.init && typeof cloud.init === 'function') cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
// ✅ 修复致命错误2：增加数据库实例容错，防止cloud.init失败导致db为undefined
const db = cloud && cloud.database ? cloud.database() : null;

// process-level handlers
try {
  if (typeof process !== 'undefined' && process && process.on) {
    process.on('uncaughtException', (err) => { console.error('[addAdmin] uncaughtException', err && (err.stack || err.message || err)) })
    process.on('unhandledRejection', (r) => { console.error('[addAdmin] unhandledRejection', r && (r.stack || r.message || r)) })
  }
} catch (e) {}

async function handlePing() { return { ok: true, data: { ping: true, time: Date.now() } } }

exports.main = async (event, context) => {
  try {
    if (event && event.__ping === true) return handlePing()

    // ✅ 修复风险问题1：给openId获取增加try/catch容错，杜绝获取失败抛异常
    let openId = null
    try {
      openId = (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID) || null
    } catch (e) {
      openId = (context && context.OPENID) || null
    }

    // ✅ 修复风险问题3：严谨的openId判空逻辑，覆盖所有无效值
    if (!openId || openId === '') return { ok: false, code: 'NO_SESSION', message: '未登录' }

    // ✅ 新增极致容错：数据库实例无效时直接返回错误
    if (!db) return { ok: false, code: 'DB_ERROR', message: '数据库初始化失败' }

    // Insert if not exists
    const existing = await db.collection('admin_list').where({ openId }).limit(1).get().catch(() => ({ data: [] }))
    if (existing && existing.data && existing.data.length > 0) {
      return { ok: true, data: { openId, existed: true } }
    }

    // ✅ 修复风险问题2：给新增操作增加局部catch兜底，返回明确错误
    const r = await db.collection('admin_list').add({
      data: {
        openId,
        note: 'added-by-dev',
        createdAt: db ? db.serverDate() : Date.now() // ✅ 优化建议1：使用服务端时间，兜底客户端时间
      }
    }).catch(err => {
      console.error('[addAdmin] add fail', err)
      return null
    })

    // ✅ 优化建议2：新增insertId容错判断，防止r为null报错
    if (r && r._id) {
      return { ok: true, data: { openId, insertId: r._id } }
    } else {
      return { ok: false, code: 'ADD_FAIL', message: '添加管理员失败' }
    }
  } catch (e) {
    console.error('[addAdmin] exception', e && (e.stack || e.message || e))
    return { ok: false, code: 'EXCEPTION', message: e && (e.stack || e.message || String(e)) }
  }
}