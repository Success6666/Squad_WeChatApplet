const { cloud, ok, fail, assert } = require('./common')
const net = require('net')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// simple TCP ping for host:port
function tcpPing(host, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let done = false
    const onDone = (err, latency) => {
      if (done) return
      done = true
      try { socket.destroy() } catch (e) {}
      if (err) return reject(err)
      resolve({ latency })
    }
    const start = Date.now()
    socket.setTimeout(timeout)
    socket.once('connect', () => onDone(null, Date.now() - start))
    socket.once('error', (e) => onDone(e))
    socket.once('timeout', () => onDone(new Error('timeout')))
    socket.connect(port, host)
  })
}

async function getServerById(serverId) {
  try { const r = await db.collection('servers').doc(serverId).get().catch(() => null); if (r && r.data) return r.data } catch (e) {}
  try { const r2 = await db.collection('server_info').doc(serverId).get().catch(() => null); if (r2 && r2.data) return r2.data } catch (e) {}
  return null
}

exports.main = async (event, context) => {
  try {
    const serverId = event.serverId
    assert(serverId, 'INVALID', 'serverId required')
    const server = await getServerById(serverId)
    assert(server, 'NOT_FOUND', 'server not found')

    const host = server.host
    const port = server.port
    const start = Date.now()
    const res = await tcpPing(host, port, 5000)
    return ok({ reachable: true, latencyMs: res.latency, testedAt: Date.now() })
  } catch (e) {
    console.error('[serverTestConnect] fail', e)
    return fail(e.code || 'EXCEPTION', e.message || '连接测试失败')
  }
}
