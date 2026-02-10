const { cloud, ok, fail } = require('./common')
const net = require('net')
const crypto = require('crypto')
const { DateTime } = require('luxon')
const fs = require('fs')
const path = require('path')

cloud.init({ env: cloud.SYMBOL_CURRENT || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const RETAIN_DAYS = 7
const RCON_TIMEOUT_MS = 5000
const COMMAND = 'ShowServerInfo'

let secretKeyBuffer = null

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
    console.warn('[serverLogCron] decryptSecret failed', e.message)
    return null
  }
}

function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body || '', 'utf8')
  const totalLen = 14 + bodyBuf.length
  const buf = Buffer.alloc(totalLen)
  buf.writeInt32LE(totalLen - 4, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  if (bodyBuf.length) bodyBuf.copy(buf, 12)
  buf.writeInt16LE(0, totalLen - 2)
  return buf
}

function rconCommand(host, port, password, command, timeoutMs) {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const client = new net.Socket()
    let authSuccess = false
    let output = ''
    let errorMsg = ''
    let isDone = false

    client.setTimeout(timeoutMs)
    client.setNoDelay(true)
    client.setKeepAlive(true, 1000)

    client.on('connect', () => {
      client.write(buildPacket(1, 3, password))
    })

    client.on('data', (buf) => {
      if (isDone) return
      let offset = 0
      while (offset < buf.length) {
        const packLen = buf.readInt32LE(offset)
        if (packLen < 4 || offset + packLen + 4 > buf.length) break

        const reqId = buf.readInt32LE(offset + 4)
        const packType = buf.readInt32LE(offset + 8)
        const data = buf.toString('utf8', offset + 12, offset + 4 + packLen).replace(/\0+$/g, '')
        offset += packLen + 4

        if (packType === 2 && reqId === 1) {
          if (reqId === -1) {
            errorMsg = 'RCON auth failed'
            client.destroy()
            return
          }
          authSuccess = true
          client.write(buildPacket(2, 2, command))
        }

        if (authSuccess && packType === 0 && data) {
          output += data
        }
      }
    })

    client.on('error', (err) => {
      errorMsg = err.message
    })

    client.on('timeout', () => {
      errorMsg = errorMsg || 'RCON timeout'
      client.destroy()
    })

    client.on('close', () => {
      if (isDone) return
      isDone = true
      resolve({
        ok: authSuccess && output.length > 0,
        output,
        latency: Date.now() - startTime,
        error: errorMsg,
      })
    })

    client.connect(port, host)
  })
}

async function loadServers() {
  const res = await db.collection('servers').limit(200).get().catch(() => null)
  return (res && res.data) ? res.data : []
}

async function writeLogFile(payload) {
  try {
    const now = DateTime.now().setZone('Asia/Shanghai')
    const dateStr = now.toFormat('yyyyMMdd')
    const ts = now.toMillis()
    const fileName = `server_logs/${dateStr}/${payload.serverId || 'unknown'}-${ts}.json`
    const tmpPath = path.join('/tmp', `${payload.serverId || 'unknown'}-${ts}.json`)
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
    const res = await cloud.uploadFile({ cloudPath: fileName, filePath: tmpPath })
    return res && res.fileID ? res.fileID : ''
  } catch (e) {
    console.warn('[serverLogCron] writeLogFile failed', e.message)
    return ''
  }
}

async function writeLogToDB(payload) {
  const beijing = DateTime.now().setZone('Asia/Shanghai')
  const fileId = await writeLogFile(payload)
  const log = {
    time: beijing.toFormat('yyyy-MM-dd HH:mm:ss'),
    timestamp: beijing.toMillis(),
    createTime: db.serverDate(),
    fileId,
    ...payload,
  }
  await db.collection('squad_server_logs').add({ data: log })
  return log
}

async function cleanOldLogs() {
  const cutoff = DateTime.now().setZone('Asia/Shanghai').minus({ days: RETAIN_DAYS }).toMillis()
  const res = await db.collection('squad_server_logs').where({ timestamp: db.command.lt(cutoff) }).remove()
  return res && res.deleted ? res.deleted : 0
}

exports.main = async () => {
  try {
    if (!secretKeyBuffer) secretKeyBuffer = await getSecretKeyBuffer()

    const servers = await loadServers()
    const results = []

    for (const server of servers) {
      const host = server.host
      const port = server.port || 27165
      if (!host) continue

      let password = ''
      if (server.auth && server.auth.cipher) {
        password = (await decryptSecret(server.auth.cipher)) || ''
      }
      password = password || server.auth?.password || server.rconPassword || ''

      const rcon = await rconCommand(host, port, password, COMMAND, RCON_TIMEOUT_MS)
      const payload = {
        serverId: server._id,
        serverName: server.name || '',
        host,
        port,
        command: COMMAND,
        ok: rcon.ok,
        latency: rcon.latency,
        error: rcon.error || '',
        output: rcon.output || '',
      }
      await writeLogToDB(payload)
      results.push({ serverId: server._id, ok: rcon.ok, latency: rcon.latency })
    }

    const deleted = await cleanOldLogs()
    return ok({ count: results.length, deleted, results })
  } catch (e) {
    console.error('[serverLogCron] error', e)
    return fail(e.code || 'INTERNAL', e.message || '日志记录失败')
  }
}
