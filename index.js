const { cloud, ok, fail, assert } = require('./common')
const net = require('net')
const crypto = require('crypto')
// lazy require for rcon-client (some deployments don't include node_modules at upload time)
let RconClient = null
try {
  // don't throw if missing; will try fallback methods later
  RconClient = require('rcon-client')
} catch (e) {
  RconClient = null
}
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function tcpPing(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const onDone = (err, latency) => {
      if (done) return
      done = true
      try { socket.destroy() } catch (e) {}
      if (err) return resolve({ reachable: false, error: (err && err.message) || 'error' })
      resolve({ reachable: true, latencyMs: latency })
    }
    const start = Date.now()
    socket.setTimeout(timeout)
    socket.once('connect', () => onDone(null, Date.now() - start))
    socket.once('error', (e) => onDone(e))
    socket.once('timeout', () => onDone(new Error('timeout')))
    try { socket.connect(port, host) } catch (e) { onDone(e) }
  })
}

function tcpDiagnostic(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const events = []
    let done = false
    const finish = () => { if (!done) { done = true; try { socket.destroy() } catch (e) {} ; resolve(events) } }

    socket.setTimeout(timeout)
    events.push({ t: Date.now(), ev: 'create' })
    socket.once('connect', () => {
      events.push({ t: Date.now(), ev: 'connect' })
      // don't write RCON protocol, just wait for server behavior
    })
    socket.on('data', (d) => { events.push({ t: Date.now(), ev: 'data', len: d.length, sample: d.toString('utf8').slice(0,200) }) })
    socket.once('end', () => { events.push({ t: Date.now(), ev: 'end' }); finish() })
    socket.once('close', (hadError) => { events.push({ t: Date.now(), ev: 'close', hadError }); finish() })
    socket.once('error', (err) => { events.push({ t: Date.now(), ev: 'error', msg: String(err && (err.message || err)) }); finish() })
    socket.once('timeout', () => { events.push({ t: Date.now(), ev: 'timeout' }); finish() })
    try {
      socket.connect(port, host)
    } catch (e) {
      events.push({ t: Date.now(), ev: 'connect_throw', msg: String(e && e.message) })
      finish()
    }
    // safety: ensure finish after timeout+500ms
    setTimeout(() => finish(), timeout + 500)
  })
}

// Fallback: send a raw TCP command (plain text) and collect response.
// Some Squad servers accept plain-text commands over the TCP port used in the game,
// which is what the Windows `rcon.exe` client does in many setups. If both
// `rcon-client` and `rcon` npm packages fail (not installed or protocol mismatch),
// this raw TCP attempt often succeeds and returns the server JSON.
function rawTcpCommand(host, port, command, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let collected = ''
    let finished = false
    const finish = (err, data) => {
      if (finished) return
      finished = true
      try { socket.destroy() } catch (e) {}
      if (err) return resolve({ ok: false, err })
      return resolve({ ok: true, text: data })
    }

    socket.setTimeout(timeout)
    socket.on('connect', () => {
      try {
        // many servers accept CRLF or LF terminated commands; try both
        socket.write(command + '\r\n')
      } catch (e) {}
    })
    socket.on('data', (buf) => {
      try { collected += buf.toString('utf8') } catch (e) { collected += buf.toString() }
      // if data looks like JSON object and ends with '}' we can finish early
      if (collected.trim().startsWith('{') && collected.trim().endsWith('}')) {
        finish(null, collected)
      }
    })
    socket.on('end', () => finish(null, collected))
    socket.on('close', () => finish(null, collected))
    socket.on('error', (err) => finish(err && (err.message || String(err))))
    socket.on('timeout', () => finish(new Error('timeout')))

    try { socket.connect(Number(port), String(host)) } catch (e) { finish(e) }

    // safety: ensure we finish after timeout+500ms
    setTimeout(() => {
      if (!finished) finish(null, collected)
    }, timeout + 500)
  })
}

async function getServerById(id) {
  try { const r = await db.collection('servers').doc(id).get().catch(() => null); if (r && r.data) return r.data } catch (e) {}
  try { const r2 = await db.collection('server_info').doc(id).get().catch(() => null); if (r2 && r2.data) return r2.data } catch (e) {}
  return null
}

async function getSecretKeyBuffer() {
  const raw = process.env.SECRET_KEY || process.env.SECRET || null
  if (raw) return crypto.createHash('sha256').update(String(raw)).digest()
  try { const doc = await db.collection('config').doc('SECRET_KEY').get().catch(() => null); const val = doc && doc.data && doc.data.value; if (val) return crypto.createHash('sha256').update(String(val)).digest() } catch (e) {}
  try { const doc2 = await db.collection('secrets').doc('SECRET_KEY').get().catch(() => null); const val2 = doc2 && doc2.data && doc2.data.value; if (val2) return crypto.createHash('sha256').update(String(val2)).digest() } catch (e) {}
  return null
}

function decryptCipherToPlain(b64, keyBuf) {
  try {
    const buf = Buffer.from(b64, 'base64')
    const iv = buf.slice(0, 12)
    const tag = buf.slice(12, 28)
    const ciphertext = buf.slice(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plain.toString('utf8')
  } catch (e) {
    return null
  }
}

function parseSquadStatus(response) {
  const status = {
    serverName: null,
    playersCount: null,
    playersExtra: null,
    maxPlayers: null,
    maxPlayersExtra: null,
    playersDisplay: null,
    map: '未知',
    faction1: '未知',
    faction2: '未知',
    durationSeconds: null,
    durationDisplay: null,
    reachable: true,
    raw: response || ''
  }

  if (!response || typeof response !== 'string') return status

  // First: try to detect JSON responses (many RCON tools return JSON objects)
  const trimmed = response.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed)
      // If it's an array, pick first object
      const obj = Array.isArray(j) ? (j[0] || {}) : j || {}
      // helper to read possible fields
      const g = (keys) => {
        for (const k of keys) if (obj[k] != null) return obj[k]
        return null
      }

      // map server name
      const sname = g(['ServerName_s','ServerName','SERVERNAME_s','ServerName_s','ServerName_s'])
      if (sname) status.serverName = String(sname)

      // players
      const pc = g(['PlayerCount_I','PlayerCount','PlayerCount_i','PlayerCount_I'])
      const maxp = g(['MaxPlayers','MaxPlayers_i','MaxPlayers_I','MaxPlayers'])
      const reserve = g(['PlayerReserveCount_I','PlayerReserveCount','PlayerReserveCount_i'])
      if (pc != null) status.playersCount = parseInt(pc)
      if (maxp != null) status.maxPlayers = parseInt(maxp)
      if (reserve != null) status.playersExtra = parseInt(reserve)
      if (status.playersCount != null) {
        if (status.playersExtra != null) status.playersDisplay = `${status.playersCount}(${status.playersExtra})/${status.maxPlayers != null ? status.maxPlayers : '-'}`
        else status.playersDisplay = `${status.playersCount}/${status.maxPlayers != null ? status.maxPlayers : '-'}`
      }

      // map
      const mapName = g(['MapName_s','MapName','MapName_s','MapName'])
      if (mapName) status.map = String(mapName).replace(/_/g, ' ')

      // factions / teams
      const t1 = g(['TeamOne_s','TeamOne','TeamOne_s','TeamOne','TeamOne'])
      const t2 = g(['TeamTwo_s','TeamTwo','TeamTwo_s','TeamTwo','TeamTwo'])
      if (t1) status.faction1 = String(t1).replace(/_/g, ' ')
      if (t2) status.faction2 = String(t2).replace(/_/g, ' ')

      // duration: PLAYTIME_I often in seconds
      const playtime = g(['PLAYTIME_I','PlayTime_I','PLAYTIME','PlayTime','PLAYTIME_I'])
      if (playtime != null && !isNaN(Number(playtime))) {
        const sec = parseInt(playtime)
        status.durationSeconds = sec
        const m = Math.floor(sec / 60)
        const s = sec % 60
        status.durationDisplay = `${m}分${s}秒`
      }

      status.raw = trimmed
      return status
    } catch (e) {
      // not JSON, continue to regex parsing
      // console.log('[serverStatus] parseSquadStatus json parse failed', e && e.message)
    }
  }

  // normalize to single line and collapse whitespace to make regex robust
  const single = response.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim()
  const txt = single

  // Server name (Hostname: RedAlert) or Name: RedAlert or Chinese 名称：
  const nameReg = /(?:Server Name|Hostname|Name|名称|服务器名|主机名)\s*[:\-：]\s*([^\|,\n]+)/i
  const nameMatch = txt.match(nameReg)
  if (nameMatch) status.serverName = nameMatch[1].trim()

  // Players: capture optional parentheses counts, e.g. 99(3)/100(1)
  const playerReg = /(?:Players|Current Players|Online|Online Players|Players online|列表用户数|列表人数|玩家|在线人数)\D*?(\d+)\s*(?:\(\s*(\d+)\s*\))?\s*(?:\/|of)\s*(\d+)\s*(?:\(\s*(\d+)\s*\))?/i
  const playerMatch = txt.match(playerReg)
  if (playerMatch) {
    status.playersCount = parseInt(playerMatch[1])
    status.playersExtra = playerMatch[2] ? parseInt(playerMatch[2]) : null
    status.maxPlayers = playerMatch[3] ? parseInt(playerMatch[3]) : null
    status.maxPlayersExtra = playerMatch[4] ? parseInt(playerMatch[4]) : null
  } else {
    // fallback any '12/64' pattern
    const anyReg = /(\d+)\s*(?:\/|of)\s*(\d+)/
    const anyMatch = txt.match(anyReg)
    if (anyMatch) {
      status.playersCount = parseInt(anyMatch[1])
      status.maxPlayers = parseInt(anyMatch[2])
    }
  }
  if (status.playersCount != null) {
    if (status.playersExtra != null || status.maxPlayersExtra != null) {
      const leftExtra = status.playersExtra != null ? `(${status.playersExtra})` : ''
      const rightExtra = status.maxPlayersExtra != null ? `(${status.maxPlayersExtra})` : ''
      status.playersDisplay = `${status.playersCount}${leftExtra}/${status.maxPlayers || '-'}${rightExtra}`
    } else {
      status.playersDisplay = `${status.playersCount}/${status.maxPlayers != null ? status.maxPlayers : '-'}`
    }
  }

  // Map: try several patterns, include Chinese '地图'
  const mapReg = /(?:Map|Map Name|Current Map|地图)\s*[:\-：]\s*([^\|;,]+)/i
  const mapMatch = txt.match(mapReg)
  if (mapMatch) {
    status.map = mapMatch[1].trim().replace(/[_]+/g, ' ')
  } else {
    const mapAny = /Map\s*[:\-：]?\s*([A-Za-z0-9_\-\u4e00-\u9fff]+)/i
    const mapAnyMatch = txt.match(mapAny)
    if (mapAnyMatch) status.map = mapAnyMatch[1].replace(/_/g, ' ')
  }

  // Factions: Teams/Factions pattern or any 'X vs Y' or Team1/Team2 labels
  const factionReg = /(?:Factions|Teams|Sides)\s*[:\-：]\s*([^\r\n|]+?)\s*(?:vs|v|VS)\s*([^\r\n|]+)/i
  const factionMatch = txt.match(factionReg)
  if (factionMatch) {
    status.faction1 = factionMatch[1].trim().replace(/[_]+/g, ' ')
    status.faction2 = factionMatch[2].trim().replace(/[_]+/g, ' ')
  } else {
    // Team1/Team2 style
    const t1 = txt.match(/Team1\s*[:\-：]\s*([^\|,]+)/i)
    const t2 = txt.match(/Team2\s*[:\-：]\s*([^\|,]+)/i)
    if (t1 && t2) {
      status.faction1 = t1[1].trim()
      status.faction2 = t2[1].trim()
    } else {
      const anyFaction = /([A-Za-z0-9_\-\u4e00-\u9fff ]{2,60})\s+(?:vs|v|VS)\s+([A-Za-z0-9_\-\u4e00-\u9fff ]{2,60})/i
      const anyFactionMatch = txt.match(anyFaction)
      if (anyFactionMatch) {
        status.faction1 = anyFactionMatch[1].trim().replace(/\s+/g, ' ')
        status.faction2 = anyFactionMatch[2].trim().replace(/\s+/g, ' ')
      }
    }
  }

  // Latency: e.g. 'Latency: 13', '区域延迟：13', 'Ping: 13ms'
  const latMatch = txt.match(/(?:Latency|Ping|延迟|区域延迟)\s*[:：\-]?\s*(\d+)\s*(?:ms|毫秒)?/i)
  if (latMatch) {
    status.latencyMs = parseInt(latMatch[1])
  }

  // Duration: formats like 32:17 or 0:32:17 or '32m17s' or '32 minutes 17 seconds' or Chinese '32分17秒'
  const dur1 = txt.match(/(\d+):(\d+):(\d+)/) // H:MM:SS
  const dur2 = txt.match(/(\d+):(\d+)/) // MM:SS
  const dur3 = txt.match(/(\d+)\s*m(?:in(?:utes)?)?\s*(\d+)\s*s(?:ec(?:onds)?)?/i)
  const durChinese = txt.match(/(\d+)\s*分\s*(\d+)\s*秒/)
  if (dur1) {
    const h = parseInt(dur1[1]), m = parseInt(dur1[2]), s = parseInt(dur1[3])
    status.durationSeconds = h * 3600 + m * 60 + s
    status.durationDisplay = `${h}时${m}分${s}秒`
  } else if (dur2) {
    const m = parseInt(dur2[1]), s = parseInt(dur2[2])
    status.durationSeconds = m * 60 + s
    status.durationDisplay = `${m}分${s}秒`
  } else if (dur3) {
    const m = parseInt(dur3[1]), s = parseInt(dur3[2])
    status.durationSeconds = m * 60 + s
    status.durationDisplay = `${m}分${s}秒`
  } else if (durChinese) {
    const m = parseInt(durChinese[1]), s = parseInt(durChinese[2])
    status.durationSeconds = m * 60 + s
    status.durationDisplay = `${m}分${s}秒`
  }

  return status
}

function normalizeStatus(parsed, debug) {
  const pCount = parsed.playersCount != null ? parsed.playersCount : (parsed.onlinePlayers != null ? parsed.onlinePlayers : null)
  const maxP = parsed.maxPlayers != null ? parsed.maxPlayers : (parsed.maxPlayersRaw != null ? parsed.maxPlayersRaw : null)
  const mapName = parsed.map || parsed.mapName || '未知'
  const f1 = parsed.faction1 || parsed.factionA || parsed.factionLeft || '未知'
  const f2 = parsed.faction2 || parsed.factionB || parsed.factionRight || '未知'
  const updatedAt = parsed.updatedAt || Date.now()
  // prefer explicit latencyMs, fallback to latency/ping/regionLatency
  const latency = (parsed.latencyMs != null) ? parsed.latencyMs : ((parsed.latency != null) ? parsed.latency : ((parsed.ping != null) ? parsed.ping : ((parsed.regionLatency != null) ? parsed.regionLatency : 0)))

  // playersDisplay from parser or fallbacks
  let playersDisplay = parsed.playersDisplay || null
  if (!playersDisplay && pCount != null) {
    playersDisplay = (maxP != null) ? `${pCount}/${maxP}` : String(pCount)
  }

  const durationDisplay = parsed.durationDisplay || '-'

  return {
    reachable: parsed.reachable !== false,
    latencyMs: latency,
    latency: latency, // backward compatibility alias
    updatedAt,
    raw: parsed.raw || '',
    debug: parsed.debug || debug || {},
    onlinePlayers: playersDisplay || '-',
    playersDisplay: playersDisplay || '-',
    maxPlayers: maxP || null,
    mapName,
    faction1: f1,
    faction2: f2,
    durationDisplay
  }
}

exports.main = async (event, context) => {
  try {
    // diagnostic mode: run raw TCP lifecycle test and return events
    if (event && event.diagnostic && event.server && event.server.host && event.server.port) {
      const diag = await tcpDiagnostic(event.server.host, Number(event.server.port || 0), event.timeout || 5000)
      return ok({ diagnostic: diag })
    }

    // Allow the client to supply the full server object (from local storage) or host/port directly.
    // This makes it possible for a client that stores RCON locally (and intentionally does not upload
    // secret data to the database) to call this cloud function without requiring the 'servers' collection.
    let server = null

    if (event && event.server && event.server.host && event.server.port) {
      // event.server is expected to be an object like { host, port, auth? }
      server = event.server
    } else if (event && event.host && event.port) {
      server = {
        host: String(event.host),
        port: Number(event.port),
        auth: event.auth || {}
      }
    }

    const serverId = (event.serverId || '').trim()

    // If no inline server info was provided, require serverId and load from DB.
    if (!server) {
      assert(serverId, 'INVALID', 'serverId or server must be provided')
      server = await getServerById(serverId)
      assert(server, 'NOT_FOUND', 'server not found')
    }

    // return recent cache if fresh (only when server object has status)
    if (server.status && server.status.updatedAt && (Date.now() - server.status.updatedAt < 10 * 1000)) {
      // normalize cached status to guarantee latencyMs/latency fields for frontend compatibility
      const normalizedCached = normalizeStatus(server.status, server.status.debug || {})
      return ok({ status: normalizedCached })
    }

    // diagnostics
    const debug = { hasCipher: false, usedTestPassword: false, usedRcon: false, rconError: null }

    // decrypt secret if present
    let keyBuf = await getSecretKeyBuffer()
    let secret = null
    if (server.auth && server.auth.cipher) {
      // cipher exists in record. try to decrypt if we have keyBuf, otherwise record missing key
      debug.hasCipher = true
      if (keyBuf) {
        const dec = decryptCipherToPlain(server.auth.cipher, keyBuf)
        if (dec) secret = dec
        else debug.decryptFailed = true
      } else {
        debug.missingKey = true
      }
    }

    // accept plain password passed directly in server.auth or top-level server fields or event (local client)
    if (!secret) {
      const tryExtract = (val) => {
        if (val == null) return null
        if (typeof val === 'string' && val.trim().length > 0) return val.trim()
        if (typeof val === 'number') return String(val)
        if (typeof val === 'object') {
          // common object shapes: { value: 'xxx' } or { password: 'xxx' }
          if (val.value && typeof val.value === 'string') return val.value.trim()
          if (val.password && typeof val.password === 'string') return val.password.trim()
        }
        return null
      }

      const candidates = [
        server && server.auth && server.auth.password,
        server && server.auth && server.auth.plain,
        server && server.auth && server.auth.secretPlaintext,
        server && server.auth && server.auth.secret,
        server && server.auth && server.auth.rcon,
        server && server.auth && server.auth.rconPassword,
        server && server.auth && server.auth.rcon_pass,
        server && server.auth && server.auth.pass,
        server && server.auth && server.auth.passwordPlain,
        server && server.auth && server.auth.passwordBase64,
        server && server.rcon,
        server && server.rconPassword,
        server && server.password,
        server && server.pw,
        server && server.secret
      ]

      for (const candidate of candidates) {
        const found = tryExtract(candidate)
        if (found) {
          console.log('[serverStatus] found plain password candidate', found && (found.length > 8 ? (found.slice(0,8) + '...') : found))
          // if it looks like base64 and contains only base64 chars, try decode
          const base64Re = /^[A-Za-z0-9+/=]+$/
          if (found.length > 8 && base64Re.test(found)) {
            try {
              const dec = Buffer.from(found, 'base64').toString('utf8')
              if (dec && dec.trim().length > 0 && dec.indexOf('\u0000') === -1) {
                secret = dec.trim();
              } else {
                secret = found
              }
            } catch (e) {
              secret = found
            }
          } else {
            secret = found
          }
          debug.usedPlainPassword = true
          break
        }
      }

      // also check event-level fields commonly passed by client
      if (!secret && event) {
        const evCandidates = [event.password, event.pw, event.rcon, event.rconPassword, event.rcon_pw]
        for (const c of evCandidates) {
          const found = tryExtract(c)
          if (found) { secret = found; debug.usedPlainPassword = true; break }
        }
      }
    }

    // allow temporary testPassword via event for debugging (do not persist)
    if (!secret && event && event.testPassword) {
      secret = String(event.testPassword)
      debug.usedTestPassword = true
    }

    if (secret) {
      // try RCON ShowServerInfo (Squad-specific)
      let rconSuccess = false // 标记RCON是否成功拿到数据
      let rconStart = Date.now() // 在外部定义rconStart变量
      try {
        debug.usedRcon = true
        rconStart = Date.now()

        // Try quick raw TCP plaintext first — some servers accept ShowServerInfo directly and return JSON.
        try {
          console.log('[serverStatus] attempting quick raw TCP ShowServerInfo before rcon-client')
          const quick = await rawTcpCommand(server.host, server.port, 'ShowServerInfo', 1500)
          if (quick && quick.ok && quick.text && quick.text.trim().length > 10) {
            console.log('[serverStatus] quick raw TCP returned data, using it')
            debug.rconRaw = (debug.rconRaw || '') + '\n' + quick.text
            const parsed = parseSquadStatus(quick.text)
            parsed.latencyMs = Date.now() - rconStart
            parsed.updatedAt = Date.now()
            parsed.debug = debug
            const normalized = normalizeStatus(parsed, debug)
            try { if (serverId) await db.collection('servers').doc(serverId).update({ data: { status: normalized } }).catch(() => null) } catch (e) {}
            return ok({ status: normalized })
          }
        } catch (e) {
          console.log('[serverStatus] quick raw TCP attempt error', e && e.message)
        }

        // 修复点1：使用已安装的 rcon-client 模块的正确API创建连接
        let rcon = null
        if (RconClient && RconClient.Rcon) {
          // 使用正确的构造函数创建RCON实例
          const rconInstance = new RconClient.Rcon({
            host: server.host,
            port: server.port,
            password: secret,
            timeout: 10000,
            tcp: true,
            encoding: 'utf8'
          })
          rcon = await rconInstance.connect()
        } else {
          throw new Error('rcon-client module not available')
        }

        // lifecycle logging
        try { rcon.on && rcon.on('connect', () => console.log('[serverStatus] rcon event: connect')) } catch (e) {}
        try { rcon.on && rcon.on('auth', () => console.log('[serverStatus] rcon event: auth')) } catch (e) {}
        try { rcon.on && rcon.on('end', () => console.log('[serverStatus] rcon event: end')) } catch (e) {}
        try { rcon.on && rcon.on('close', () => console.log('[serverStatus] rcon event: close')) } catch (e) {}
        try { rcon.on && rcon.on('error', (er) => console.log('[serverStatus] rcon event: error', er && (er.message || er.stack || String(er)))) } catch (e) {}

        let text = ''
        // 修复点2：监听所有response事件，拼接分段返回的内容
        rcon.on('response', (res) => {
          if (res && res.trim()) {
            text += res + ' '; // 拼接所有分段返回的内容
          }
        })

        // 修复点3：等待RCON认证完成 + 延迟200ms，避免指令发送过快被丢弃
        await new Promise(resolve => setTimeout(resolve, 200));

        // 发送指令，这里不用await接收，靠上面的response事件拼接完整内容
        await rcon.send('ShowServerInfo');
        // 修复点4：延长等待时间到1000ms，确保慢服务器也能返回完整数据
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 兜底：如果ShowServerInfo没拿到内容，自动尝试其他备选指令
        if (!text || text.trim().length < 10) {
          const candidates = ['info', 'serverinfo', 'GetServerInfo', 'status', 'getstatus']
          for (const cmd of candidates) {
            await new Promise(resolve => setTimeout(resolve, 200));
            await rcon.send(cmd);
            await new Promise(resolve => setTimeout(resolve, 300));
            if (text && text.trim().length > 10) break;
          }
        }

        // 关闭连接
        try { await rcon.end() } catch (e) {}
        // 打印完整的拼接后的数据，方便你调试
        console.log('[serverStatus] RCON完整拼接返回:', text)
        debug.rconRaw = text || ''

        // 修复点5：只有拿到有效数据，才标记RCON成功
        if (text && text.trim().length > 10) {
          rconSuccess = true
          const parsed = parseSquadStatus(text)
          // 计算RCON真实耗时（连接+等待数据的总时间）
          parsed.latencyMs = Date.now() - rconStart
          parsed.updatedAt = Date.now()
          parsed.debug = debug
          const normalized = normalizeStatus(parsed, debug)

          try {
            if (serverId) {
              await db.collection('servers').doc(serverId).update({ data: { status: normalized } }).catch(() => null)
            }
          } catch (e) {}
          return ok({ status: normalized })
        }
      } catch (e) {
        console.warn('[serverStatus] rcon query failed', e && e.message)
        debug.rconError = (e && e.message) || String(e)
      }

      // Retry with alternate connect options (challenge:false) for servers that close connection on initial handshake
      if (!rconSuccess && secret) {
        try {
          console.log('[serverStatus] retrying rcon with challenge:false')
          rconStart = Date.now()
          // 修复点：使用正确的API创建实例和连接
          const rconInstance2 = new RconClient.Rcon({
            host: server.host,
            port: server.port,
            password: secret,
            timeout: 10000,
            tcp: true,
            encoding: 'utf8',
            challenge: false  // 将 challenge:false 作为选项传递给构造函数
          })
          const rcon2 = await rconInstance2.connect()

          let text2 = ''
          try { rcon2.on && rcon2.on('response', (res) => { if (res && res.trim()) text2 += res + ' ' }) } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 200))
          try { await rcon2.send('ShowServerInfo') } catch (e) { /* ignore */ }
          await new Promise(resolve => setTimeout(resolve, 1000))
          try { await rcon2.end() } catch (e) {}
          console.log('[serverStatus] rcon retry raw response:', text2)
          if (text2 && text2.trim().length > 10) {
            rconSuccess = true
            debug.rconRaw = (debug.rconRaw || '') + '\n' + text2
            const parsed = parseSquadStatus(text2)
            parsed.latencyMs = Date.now() - rconStart
            parsed.updatedAt = Date.now()
            parsed.debug = debug
            const normalized = normalizeStatus(parsed, debug)
            try { if (serverId) await db.collection('servers').doc(serverId).update({ data: { status: normalized } }).catch(() => null) } catch (e) {}
            return ok({ status: normalized })
          }
        } catch (re) {
          console.log('[serverStatus] rcon retry failed', re && re.message)
          debug.rconError = (debug.rconError || '') + ' | retry:' + (re && re.message)
        }
      }

      // Attempt fallback using the 'rcon' package if rcon-client failed
      if (!rconSuccess && secret) {
        try {
          // require lazily to avoid module not found when not installed
          const RconOld = require('rcon')
          console.log('[serverStatus] attempting fallback rcon (rcon npm)')
          const fallbackRes = await new Promise((resolve) => {
            let resolved = false
            let text = ''
            const client = new RconOld(server.host, server.port, secret)
            const finish = (err, resText) => {
              if (resolved) return
              resolved = true
              try { client.disconnect() } catch (ex) {}
              if (err) return resolve({ ok: false, err: err })
              return resolve({ ok: true, text: resText })
            }
            client.on('auth', () => {
              try { client.send('ShowServerInfo') } catch (ex) {}
            })
            client.on('response', (res) => {
              if (res && res.trim()) text += res + ' '
            })
            client.on('error', (err) => { finish(err) })
            client.on('end', () => { finish(null, text) })
            // connect and set a safety timeout
            try { client.connect() } catch (ex) { finish(ex) }
            setTimeout(() => {
              if (!resolved) finish(new Error('fallback rcon timeout'))
            }, 8000)
          })
          if (fallbackRes && fallbackRes.ok && fallbackRes.text && fallbackRes.text.trim().length > 0) {
            console.log('[serverStatus] fallback RCON raw response:', fallbackRes.text)
            debug.rconRaw = (debug.rconRaw || '') + '\n' + fallbackRes.text
            const parsed = parseSquadStatus(fallbackRes.text)
            parsed.latencyMs = Date.now() - rconStart
            parsed.updatedAt = Date.now()
            parsed.debug = debug
            const normalized = normalizeStatus(parsed, debug)
            try {
              if (serverId) await db.collection('servers').doc(serverId).update({ data: { status: normalized } }).catch(() => null)
            } catch (e) {}
            return ok({ status: normalized })
          } else {
            console.log('[serverStatus] fallback rcon did not return data', fallbackRes && fallbackRes.err && String(fallbackRes.err))
            if (fallbackRes && fallbackRes.err) debug.rconError = debug.rconError + ' | fallback:' + String(fallbackRes.err)
          }
        } catch (ex) {
          console.log('[serverStatus] fallback require(rcon) failed or error', ex && ex.message)
          // ignore and continue to tcp ping fallback
        }
      }

      // Extra fallback: attempt raw TCP plain-text command (some servers echo JSON over TCP when sent ShowServerInfo)
      if (!rconSuccess && secret) {
        try {
          console.log('[serverStatus] attempting raw TCP command ShowServerInfo')
          const rawRes = await rawTcpCommand(server.host, server.port, 'ShowServerInfo', 2500)
          if (rawRes && rawRes.ok && rawRes.text && rawRes.text.trim().length > 10) {
            console.log('[serverStatus] raw TCP returned data length', rawRes.text.length)
            debug.rconRaw = (debug.rconRaw || '') + '\n' + rawRes.text
            const parsed = parseSquadStatus(rawRes.text)
            parsed.latencyMs = Date.now() - rconStart
            parsed.updatedAt = Date.now()
            parsed.debug = debug
            const normalized = normalizeStatus(parsed, debug)
            try { if (serverId) await db.collection('servers').doc(serverId).update({ data: { status: normalized } }).catch(() => null) } catch (e) {}
            rconSuccess = true
            return ok({ status: normalized })
          } else {
            console.log('[serverStatus] raw TCP did not return usable data', rawRes && rawRes.err)
            if (rawRes && rawRes.err) debug.rconError = (debug.rconError || '') + ' | raw:' + String(rawRes.err)
          }
        } catch (rex) {
          console.log('[serverStatus] raw TCP attempt failed', rex && rex.message)
          debug.rconError = (debug.rconError || '') + ' | raw:' + (rex && rex.message)
        }
      }

      // 修复点6：RCON未拿到有效数据，强制走TCP Ping兜底，确保延迟有值
      if (!rconSuccess) {
        console.log('[serverStatus] RCON无有效数据，切换到TCP Ping兜底')
      }
    }

    // fallback to tcp ping
    const ping = await tcpPing(server.host, server.port, 3000)
    const parsedPing = {
      reachable: !!ping.reachable,
      latencyMs: ping.latencyMs || 0,
      updatedAt: Date.now(),
      raw: '',
      debug
    }
    const status = normalizeStatus(parsedPing, debug)

    try {
      if (serverId) {
        await db.collection('servers').doc(serverId).update({ data: { status } }).catch(() => null)
      }
    } catch (e) {}

    return ok({ status })
  } catch (e) {
    console.error('[serverStatus] fail', e)
    return fail(e.code || 'EXCEPTION', e.message || '获取状态失败')
  }
}