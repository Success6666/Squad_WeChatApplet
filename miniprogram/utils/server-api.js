// Wrapper for server management cloud functions
// All functions return a Promise that resolves to { ok, data, message }

async function call(fnName, data) {
  try {
    console.log('[server-api] calling', fnName, data)
    const res = await wx.cloud.callFunction({ name: fnName, data })
    return res.result
  } catch (e) {
    // Normalize error message
    const rawMsg = (e && (e.errMsg || e.message)) || String(e)
    console.error('[server-api] call fail', fnName, e)

    // Detect cloud function not found / missing function name
    if (rawMsg.indexOf('FunctionName') !== -1 || rawMsg.indexOf('FUNCTION_NOT_FOUND') !== -1 || rawMsg.indexOf('-501000') !== -1) {
      return { ok: false, code: 'FUNCTION_NOT_FOUND', message: `云函数 "${fnName}" 未部署或名称不正确，请在云开发控制台部署该函数。` }
    }

    return { ok: false, code: 'CLOUD_CALL_FAIL', message: rawMsg }
  }
}

function list(params) {
  return call('serverList', params)
}

function detail(serverId) {
  return call('serverDetail', { serverId })
}

function create(payload) {
  return call('serverCreate', payload)
}

function update(payload) {
  return call('serverUpdate', payload)
}

function remove(serverId) {
  return call('serverRemove', { serverId })
}

function testConnect(serverId) {
  return call('serverTestConnect', { serverId })
}

function command(serverId, command) {
  return call('serverCommand', { serverId, command })
}

function status(serverOrId) {
  // If caller passes a server object (with host/port), forward directly so client can pass local RCON info
  if (serverOrId && typeof serverOrId === 'object' && serverOrId.host && serverOrId.port) {
    return call('serverStatus', { server: serverOrId })
  }
  // otherwise assume it's an id string
  return call('serverStatus', { serverId: serverOrId })
}

module.exports = { list, detail, create, update, remove, testConnect, command, status }
