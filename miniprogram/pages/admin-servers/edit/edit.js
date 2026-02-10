const api = require('../../../utils/server-api')
Page({
  data: {
    name: '', host: '', port: '', types: ['rcon','http'], typeIndex: 0,
    adminOnly: false, authMethods: ['none','password'], authIndex: 0, showSecret: false, saving: false,
    saveLocal: false // whether to save secret locally on this device
  },
  onLoad(options) {
    try {
      this.teamId = options.teamId || ''
      if (options.serverId) {
        this.serverId = options.serverId
        this.load()
      }
    } catch (e) {
      console.error('[edit] onLoad exception', e)
      wx.showToast({ title: '界面初始化失败，请重试', icon: 'none' })
    }
  },
  async load() {
    try {
      const res = await api.detail(this.serverId)
      if (res && res.ok) {
        const s = res.data.server
        this.setData({ name: s.name, host: s.host, port: s.port + '', typeIndex: this.data.types.indexOf(s.type || 'rcon'), adminOnly: !!s.adminOnly })
      } else {
        wx.showToast({ title: res && res.message || '加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('[edit] load exception', e)
      wx.showToast({ title: '无法加载服务器信息', icon: 'none' })
    }
  },
  onChangeName(e){ this.setData({ name: e.detail.value }) },
  onChangeHost(e){ this.setData({ host: e.detail.value }) },
  onChangePort(e){ this.setData({ port: e.detail.value }) },
  onChangeType(e){ this.setData({ typeIndex: parseInt(e.detail.value) }) },
  onToggleAdminOnly(e){ this.setData({ adminOnly: e.detail.value }) },
  onChangeAuth(e){ const idx = parseInt(e.detail.value); this.setData({ authIndex: idx, showSecret: this.data.authMethods[idx] !== 'none' }) },
  onChangeSecret(e){ this.secret = e.detail.value },
  onToggleSaveLocal(e) { this.setData({ saveLocal: !!e.detail.value }) },
  onCancel() { wx.navigateBack() },
  async onSave() {
    if (this.data.saving) return
    const name = (this.data.name || '').trim()
    const host = (this.data.host || '').trim()
    const port = parseInt(this.data.port || 0)
    if (!name) return wx.showToast({ title: '请输入服务器名称', icon: 'none' })
    if (!host) return wx.showToast({ title: '请输入地址', icon: 'none' })
    if (!port) return wx.showToast({ title: '请输入端口', icon: 'none' })

    const payload = { name, host, port, type: this.data.types[this.data.typeIndex], adminOnly: this.data.adminOnly }
    if (this.data.showSecret && this.secret) payload.auth = { method: this.data.authMethods[this.data.authIndex], secretPlaintext: this.secret }
    if (this.teamId) payload.teamId = this.teamId

    this.setData({ saving: true })
    let res
    try {
      if (this.serverId) {
        payload.serverId = this.serverId
        res = await api.update(payload)
      } else {
        res = await api.create(payload)
      }
    } catch (e) {
      console.error('[edit] save api exception', e)
      wx.showToast({ title: '保存失败（网络或服务异常）', icon: 'none' })
      this.setData({ saving: false })
      return
    }

    this.setData({ saving: false })
    if (res && res.ok) {
      try {
        const savedServerId = this.serverId || (res.data && (res.data.serverId || res.data.id || res.data._id))
        if (this.data.saveLocal && (this.data.showSecret && this.secret) && savedServerId) {
          const key = 'squad_rcon_' + savedServerId
          const storeObj = { host, port: Number(port) }
          storeObj.auth = { plain: String(this.secret) }
          try { wx.setStorageSync(key, storeObj) } catch (e) { console.warn('[edit] write local storage failed', e) }
        }
      } catch (e) { console.warn('[edit] saving local cred failed', e) }

      wx.showToast({ title: '保存成功' })
      wx.navigateBack()
    } else {
      wx.showToast({ title: res && res.message || '保存失败', icon: 'none' })
    }
  }
})
