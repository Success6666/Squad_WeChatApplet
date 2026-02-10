const { cloud, ok, fail, assert } = require('./common')
const net = require('net')
const crypto = require('crypto')
cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 提前初始化密钥缓存，减少耗时
let secretKeyBuffer = null;
(async () => {
  secretKeyBuffer = await getSecretKeyBuffer();
})();

async function getSecretKeyBuffer() {
  const raw = process.env.SECRET_KEY || process.env.SECRET || null
  if (raw) return crypto.createHash('sha256').update(String(raw)).digest()
  try {
    const doc = await db.collection('config').doc('SECRET_KEY').get().catch(() => null)
    const val = doc && doc.data && doc.data.value
    if (val) return crypto.createHash('sha256').update(String(val)).digest()
  } catch (e) {}
  try {
    const doc2 = await db.collection('secrets').doc('SECRET_KEY').get().catch(() => null)
    const val2 = doc2 && doc2.data && doc2.data.value
    if (val2) return crypto.createHash('sha256').update(String(val2)).digest()
  } catch (e) {}
  return null
}

async function decryptSecret(b64) {
  if (!secretKeyBuffer) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    const iv = buf.slice(0, 12)
    const tag = buf.slice(12, 28)
    const ciphertext = buf.slice(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKeyBuffer, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plain.toString('utf8')
  } catch (e) {
    console.warn('[decryptSecret] failed', e.message)
    return null
  }
}

// 标准RCON数据包构建，无格式错误
function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body || '', 'utf8');
  // total packet length = 4 (len field) + 4(id) + 4(type) + body.length + 2 (terminator)
  const totalLen = 14 + bodyBuf.length; // same as previous serverStatus implementation
  const buf = Buffer.alloc(totalLen);
  // first field: length of remaining bytes (totalLen - 4)
  buf.writeInt32LE(totalLen - 4, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  if (bodyBuf.length) bodyBuf.copy(buf, 12);
  buf.writeInt16LE(0, totalLen - 2);
  return buf;
}

// ✅ 核心升级：格式化函数兼容所有指令，智能解析
function formatServerStatus(output, command) {
  const baseStatus = {
    serverName: '控制台',
    playersDisplay: '-/-',
    mapName: '未知',
    faction1: '未知',
    faction2: '未知',
    durationDisplay: '-',
    latency: 0,
    reachable: true,
    updatedAt: Date.now(),
    updatedAtStr: new Date().toLocaleString()
  };
  // 情况1：指令是 ShowServerInfo → 解析服务器状态（你原来的核心需求）
  if (command === 'ShowServerInfo' && output) {
    const lines = output.split('\n');
    lines.forEach(line => {
      if (line.includes('ServerName')) baseStatus.serverName = line.split(':')[1]?.trim() || baseStatus.serverName;
      if (line.includes('Players')) baseStatus.playersDisplay = line.split(':')[1]?.trim() || baseStatus.playersDisplay;
      if (line.includes('Map')) baseStatus.mapName = line.split(':')[1]?.trim() || baseStatus.mapName;
      if (line.includes('Team1')) baseStatus.faction1 = line.split(':')[1]?.trim() || baseStatus.faction1;
      if (line.includes('Team2')) baseStatus.faction2 = line.split(':')[1]?.trim() || baseStatus.faction2;
      if (line.includes('MatchTime')) baseStatus.durationDisplay = line.split(':')[1]?.trim() || baseStatus.durationDisplay;
    });
    return baseStatus;
  }
  // 情况2：指令是 ListPlayers/ListSquads → 不解析，返回基础状态即可，原始数据在rawOutput里
  return baseStatus;
}

// ======================== 原有逻辑不变 + 新增【原始数据透传】 ========================
exports.main = async (event, context) => {
  try {
    const openId = (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID)
    assert(openId, 'NO_SESSION', '未登录')

    const serverId = event.serverId
    let server = null
    let skipPermission = false

    if (event.server && event.server.host && event.server.port) {
      server = event.server
      skipPermission = true
    } else if (event.host && event.port) {
      server = { host: event.host, port: event.port }
      skipPermission = true
    } else if (serverId) {
      const sRes = await db.collection('servers').doc(serverId).get().catch(() => null)
      server = sRes && sRes.data
    }
    assert(server, 'NOT_FOUND', '服务器不存在')

    if (!skipPermission) {
      let isAdmin = false
      const teamId = server.teamId || ''
      if (teamId) {
        const mRes = await db.collection('members').where({ teamId, openId, status: 'approved' }).limit(1).get()
        isAdmin = !!(mRes.data && mRes.data[0] && ['owner', 'admin'].includes(mRes.data[0].role))
      }
      if (!isAdmin) {
        const adminCheck = await db.collection('admin_list').where({ openId }).limit(1).get()
        isAdmin = adminCheck.data.length > 0
      }
      assert(isAdmin, 'NO_PERMISSION', '需要管理员权限')
    }

    let password = ''
    if (!skipPermission && server.auth && server.auth.cipher) {
      password = await decryptSecret(server.auth.cipher) || ''
    }
    password = password || server.auth?.password || server.rconPassword || event.password || ''

    const host = server.host
    const port = server.port || 27165
    const command = event.command || 'ShowServerInfo' // 默认用ShowServerInfo查状态，最实用
    console.log('[serverStatus] RCON start', { host, port, command })

    const start = Date.now()
    let res = await realSquadRcon(host, port, password, command, 5000)
    const duration = Date.now() - start
    console.log('[serverStatus] RCON end', { duration, ok: res.ok, len: res.output ? res.output.length : 0, error: res.error, meta: res.meta })

    // If output empty for ListPlayers/ListSquads, retry once (server may send delayed data)
    if ((command === 'ListPlayers' || command === 'ListSquads') && res.ok && (!res.output || res.output.trim() === '')) {
      console.log('[serverStatus] empty output on first try, retrying once', { meta: res.meta })
      const retryStart = Date.now()
      const res2 = await realSquadRcon(host, port, password, command, 5000)
      const retryDur = Date.now() - retryStart
      console.log('[serverStatus] RCON retry end', { retryDur, ok: res2.ok, len: res2.output ? res2.output.length : 0, error: res2.error, meta: res2.meta })
      // prefer res2 if has content
      if (res2 && res2.ok && res2.output && res2.output.trim()) res = res2
    }

    // Additional fallback: if ListSquads yields no output, try ListPlayers (some servers only respond to one)
    let finalCommandUsed = command
    if ((command === 'ListSquads') && res.ok && (!res.output || res.output.trim() === '')) {
      console.log('[serverStatus] ListSquads empty, trying ListPlayers as fallback', { meta: res.meta })
      const fbStart = Date.now()
      const fb = await realSquadRcon(host, port, password, 'ListPlayers', 5000)
      console.log('[serverStatus] fallback ListPlayers end', { duration: Date.now() - fbStart, ok: fb.ok, len: fb.output ? fb.output.length : 0, error: fb.error, meta: fb.meta })
      if (fb && fb.ok && fb.output && fb.output.trim()) {
        res = fb
        finalCommandUsed = 'ListPlayers'
      }
    }

    // Extra fallback for ListPlayers when empty: try sending with trailing newline (some servers expect it)
    if ((command === 'ListPlayers' || finalCommandUsed === 'ListPlayers') && res.ok && (!res.output || res.output.trim() === '')) {
      console.log('[serverStatus] ListPlayers empty after retry, trying with trailing newline')
      const nlStart = Date.now()
      const fb2 = await realSquadRcon(host, port, password, (finalCommandUsed === 'ListPlayers' ? 'ListPlayers' : command) + '\n', 5000)
      console.log('[serverStatus] ListPlayers+newline end', { duration: Date.now() - nlStart, ok: fb2.ok, len: fb2.output ? fb2.output.length : 0, error: fb2.error, meta: fb2.meta })
      if (fb2 && fb2.ok && fb2.output && fb2.output.trim()) {
        res = fb2
        finalCommandUsed = (finalCommandUsed === 'ListPlayers') ? 'ListPlayers+newline' : command + '+newline'
      }
    }

    // ✅ 格式化状态 + 透传原始数据
    const status = formatServerStatus(res.output, command)
    status.reachable = res.ok
    status.latency = duration

    console.log('[serverStatus] final res meta', { finalCommandUsed, resError: res.error, resMeta: res.meta })

    // If this was an administrative command, record it to the database for auditing.
    try {
      const adminCmdMatch = String(command || '').match(/^(Admin(?:Ban|Kick|Warn|ForceTeamChange|DemoteCommander)(?:ById)?)\s*(.*)$/i)
      if (adminCmdMatch) {
        const fullVerb = adminCmdMatch[1] // e.g. AdminKick, AdminBanById
        const payload = (adminCmdMatch[2] || '').trim()
        // normalize action name
        const act = fullVerb.replace(/^Admin/i, '').replace(/ById$/i, '')
        const byId = /ById$/i.test(fullVerb)
        // parse payload into target/duration/reason depending on action
        let target = ''
        let duration = ''
        let reason = ''
        if (act.toLowerCase() === 'ban') {
          const parts = payload.split(/\s+/)
          target = parts.shift() || ''
          duration = parts.shift() || '0'
          reason = parts.join(' ') || ''
        } else if (act.toLowerCase() === 'kick' || act.toLowerCase() === 'warn') {
          const parts = payload.split(/\s+/)
          target = parts.shift() || ''
          reason = parts.join(' ') || ''
        } else if (act.toLowerCase() === 'forceteamchange' || act.toLowerCase() === 'demotecommander') {
          const parts = payload.split(/\s+/)
          target = parts.shift() || ''
        } else {
          // fallback: treat entire payload as target
          target = payload
        }

        // try to enrich operator name and extract steam64 from target/command
        let operatorName = null
        let operatorSteam64 = null
        let operatorTeamName = null
        try {
          if (openId) {
            const m = await db.collection('members').where({ openId }).limit(1).get().catch(() => null)
            const mem = m && m.data && m.data[0]
            if (mem) {
              operatorName = mem.nick || mem.name || mem.displayName || mem.steamNick || null
              operatorTeamName = mem.teamName || mem.teamNick || mem.team || null
            }
            // also try to get global profile (profiles collection) to fetch steam64 and preferred steamNick
            try {
              const pRes = await db.collection('profiles').where({ openId }).limit(1).get().catch(() => null)
              const prof = pRes && pRes.data && pRes.data[0]
              if (prof) {
                operatorSteam64 = prof.steam64Id || null
                operatorName = operatorName || prof.steamNick || null
              }
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }

        // attempt to extract steam64 from target or payload if not found above
        const steamRegex = /(\d{17,20})/g
        let target64 = null
        if (target && String(target).match(steamRegex)) target64 = String(target).match(steamRegex)[0]
        if (!target64 && payload && String(payload).match(steamRegex)) target64 = String(payload).match(steamRegex)[0]
        // ensure operatorSteam64 fallback to extracted target if missing
        if (!operatorSteam64 && target64) operatorSteam64 = target64

        const log = {
          serverId: serverId || null,
          host: host || null,
          port: port || null,
          action: act,
          byId: !!byId,
          target: target || null,
          target64: target64 || null,
          duration: duration || null,
          reason: reason || null,
          command: command || null,
          rawCommand: command || null,
          operatorOpenId: openId || null,
          operatorName: operatorName || null,
          operatorSteam64: operatorSteam64 || null,
          operatorTeamName: operatorTeamName || null,
          timestamp: Date.now(),
          resultOk: !!res.ok,
          rconMeta: res.meta || null
        }
        // write to admin_actions collection (auditing)
        try {
          await db.collection('admin_actions').add({ data: log })
          console.log('[serverStatus] admin action logged', { action: act, target: target, target64 })
        } catch (e) {
          console.warn('[serverStatus] failed to log admin action', e && e.message)
        }
      }
    } catch (e) {
      console.warn('[serverStatus] admin logging failure', e && e.message)
    }

    // ✅ 核心新增：返回结果中加入【rawOutput 原始RCON输出】以及 actualCommand 字段说明最终用哪个指令拿到数据
    return ok({
      status: status,
      rawOutput: res.output, // 重点！ListPlayers/ListSquads的原始数据在这里
      actualCommand: finalCommandUsed,
      rconMeta: res.meta || null,
      rconError: res.error || null,
      timestamp: Date.now()
    })
  } catch (e) {
    console.error('[serverStatus] error', e)
    return fail(e.code || 'EXCEPTION', e.message || '获取服务器状态失败')
  }
}

// Replace realRconCommand with a robust implementation based on serverStatus.realSquadRcon
async function realSquadRcon(host, port, password, command, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const client = new net.Socket();
    let authSuccess = false;
    let collected = '';
    let errorMsg = null;
    let done = false;

    // meta
    let packetCount = 0;
    const rawPackets = [];
    const meta = () => ({ authSuccess: !!authSuccess, cmdSent: !!authSuccess, packetCount, rawHex: rawPackets.join('|') });

    // socket tuning
    client.setTimeout(timeoutMs);
    client.setNoDelay(true);
    client.setKeepAlive(true, 2000);

    // build packet helper (same format as serverStatus)
    const build = (id, type, body) => {
      const bodyBuf = Buffer.from(body || '', 'utf8');
      const len = 14 + bodyBuf.length;
      const buf = Buffer.alloc(len);
      buf.writeInt32LE(len - 4, 0);
      buf.writeInt32LE(id, 4);
      buf.writeInt32LE(type, 8);
      if (bodyBuf.length) bodyBuf.copy(buf, 12);
      buf.writeInt16LE(0, len - 2);
      return buf;
    };

    // accumulate buffer to handle fragmentation
    let recvBuf = Buffer.alloc(0);
    let idleTimer = null;
    let authReqId = 2; // default command id if auth doesn't provide one
    const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null } };
    const scheduleIdleFinish = (ms = 400) => {
      clearIdle();
      idleTimer = setTimeout(() => {
        if (done) return;
        done = true;
        try { client.destroy() } catch (e) {}
        const recvHex = recvBuf ? recvBuf.toString('hex') : '';
        console.log('[serverCommand:rcon] idle finish, recvBuf hex length=', recvHex.length, 'hex=', recvHex.slice(0,400))
        resolve({ ok: collected.trim().length>0, output: collected.trim(), error: null, meta: meta(), recvBufHex: recvHex, duration: Date.now()-startTime });
      }, ms);
    };

    client.on('connect', () => {
      console.log('[serverCommand:rcon] connected -> sending auth');
      client.write(build(1, 3, password));
    });

    client.on('data', (chunk) => {
      if (done) return;
      // append
      recvBuf = Buffer.concat([recvBuf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')]);
      // try parse
      let offset = 0;
      while (offset + 4 <= recvBuf.length) {
        const packLen = recvBuf.readInt32LE(offset);
        const totalLen = 4 + packLen;
        if (packLen <= 0 || offset + totalLen > recvBuf.length) break;
        const reqId = recvBuf.readInt32LE(offset+4);
        const packType = recvBuf.readInt32LE(offset+8);
        // packLen = 4(id) + 4(type) + bodyLen + 2(terminator) = 10 + bodyLen
        const bodyLen = Math.max(0, packLen - 10);
        const dataBuf = recvBuf.slice(offset + 12, offset + 12 + bodyLen);
        // store raw hex for debugging (only the actual body, terminator excluded)
        rawPackets.push(dataBuf.toString('hex'));
        packetCount++;
        const txt = dataBuf.toString('utf8');
        console.log('[serverCommand:rcon] packet', { reqId, packType, dataLen: txt.length });

        // auth response check: packType === 2 usually indicates auth/result
        if (packType === 2 && !authSuccess) {
          // auth failure indicated by reqId === -1 sometimes
          if (reqId === -1) {
            errorMsg = 'AUTH_FAIL';
            client.destroy();
            return resolve({ ok: false, output: '', error: errorMsg, meta: meta() });
          }
          // treat as success
          authSuccess = true;
          // remember auth reqId and use it for subsequent command packets (some servers expect same id)
          authReqId = reqId || 2;
          // after auth send the requested command using authReqId
          try { client.write(build(authReqId, 2, command)); } catch (e) {}
        } else {
          // collect any textual payload
          if (txt && txt.length) {
            collected += txt + '\n';
          }
        }

        offset += totalLen;
      }
      // remove processed bytes
      if (offset > 0) recvBuf = recvBuf.slice(offset);

      // schedule finish after idle
      scheduleIdleFinish(400);
    });

    client.on('close', () => {
      if (done) return;
      clearIdle();
      done = true;
      const recvHexClose = recvBuf ? recvBuf.toString('hex') : '';
      console.log('[serverCommand:rcon] close, recvBuf hex len=', recvHexClose.length, 'hex=', recvHexClose.slice(0,400));
      resolve({ ok: collected.trim().length>0, output: collected.trim(), error: null, meta: meta(), recvBufHex: recvHexClose, duration: Date.now()-startTime });
    });

    client.on('error', (err) => {
      if (done) return;
      done = true;
      clearIdle();
      const recvHexErr = recvBuf ? recvBuf.toString('hex') : '';
      console.log('[serverCommand:rcon] error, recvBuf hex len=', recvHexErr.length, 'hex=', recvHexErr.slice(0,400));
      resolve({ ok: false, output: '', error: err.message, meta: meta(), recvBufHex: recvHexErr, duration: Date.now()-startTime });
    });

    client.on('timeout', () => {
      if (done) return;
      done = true;
      clearIdle();
      try { client.destroy() } catch (e) {}
      const recvHexTimeout = recvBuf ? recvBuf.toString('hex') : '';
      console.log('[serverCommand:rcon] timeout, recvBuf hex len=', recvHexTimeout.length, 'hex=', recvHexTimeout.slice(0,400));
      resolve({ ok: collected.trim().length>0, output: collected.trim(), error: 'timeout', meta: meta(), recvBufHex: recvHexTimeout, duration: Date.now()-startTime });
    });

    try {
      if (!host) return resolve({ ok: false, output: '', error: 'no_host', meta: meta() });
      client.connect(port, host);
    } catch (e) {
      return resolve({ ok: false, output: '', error: e.message, meta: meta() });
    }
  });
}
