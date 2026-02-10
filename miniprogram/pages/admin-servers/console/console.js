const api = require('../../../utils/server-api')

const CONSOLE_CACHE_TTL_MS = 0
// Minimalist blue-white console page (debug/console logs removed)
Page({
  data: {
    server: {},
    status: {},
    loading: false,
    autoRefresh: true,
    broadcastText: '',
    commandText: '',
    showServerSettings: false,
  },

  onLoad(options) {
    this.serverId = options && options.serverId
    if (!this.serverId) {
      wx.showToast({ title: '未提供 serverId', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.load()
  },

  onShow() {
    const app = getApp()
    const key = 'console:' + this.serverId
    const cache = app && app.globalData && app.globalData.pageCache && app.globalData.pageCache[key]
    if (cache && cache.ts) {
      this.setData({ ...cache.data, loading: false })
      this.load({ silent: true })
      this.startAutoRefresh()
      return
    }
    this.startAutoRefresh()
  },
  onHide() { this.stopAutoRefresh() },
  onUnload() { this.stopAutoRefresh() },

  startAutoRefresh() {
    this.stopAutoRefresh()
    if (this.data.autoRefresh) {
      // increase interval to 30s to reduce load
      this._refreshTimer = setInterval(() => this.refresh(), 30000)
    }
  },
  stopAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer)
      this._refreshTimer = null
    }
  },

  async load(opts) {
    const silent = !!(opts && opts.silent)
    if (!silent) this.setData({ loading: true })
    try {
      const res = await api.detail(this.serverId)
      if (res && res.ok && res.data && res.data.server) {
        this.setData({ server: res.data.server })
        // determine owner-only visibility for server settings
        this._computeShowServerSettings(res.data.server)
      } else wx.showToast({ title: res && res.message || '加载服务器信息失败', icon: 'none' })
    } catch (e) {
      // silent for now; still inform user
      if (!silent) wx.showToast({ title: '加载服务器信息异常', icon: 'none' })
    }

    await this._callStatusOnce()
    if (!silent) this.setData({ loading: false })

    const app = getApp()
    if (app && app.globalData && app.globalData.pageCache) {
      const key = 'console:' + this.serverId
      app.globalData.pageCache[key] = {
        ts: Date.now(),
        data: {
          server: this.data.server,
          status: this.data.status,
          showServerSettings: this.data.showServerSettings,
        },
      }
    }
  },

  async _computeShowServerSettings(server) {
    // Only the team owner (role === 'owner') who is a member of the server.teamId can see settings.
    // Do NOT show to team admins or global admins per requirement.
    try {
      const teamId = server && server.teamId
      if (!teamId) {
        this.setData({ showServerSettings: false })
        return
      }
      // call teamDetail cloud function to get myMember
      const r = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId, includePending: false } })
      const rr = r && r.result
      if (rr && rr.ok && rr.data && rr.data.myMember) {
        const my = rr.data.myMember
        const isOwner = my && my.role === 'owner' && my.status === 'approved'
        this.setData({ showServerSettings: !!isOwner })
      } else {
        this.setData({ showServerSettings: false })
      }
    } catch (e) {
      console.error('[console] computeShowServerSettings fail', e)
      this.setData({ showServerSettings: false })
    }
  },

  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true })
    await this._callStatusOnce()
    this.setData({ loading: false })
  },

  _getLocalRconPayload() {
    try {
      const key = 'squad_rcon_' + this.serverId
      const saved = wx.getStorageSync(key)
      if (saved && saved.host && saved.port) return saved
    } catch (e) {
      // ignore local storage read errors
    }
    return null
  },

  async _callStatusOnce() {
    const serverPayload = this._getLocalRconPayload()
    let s = null
    try {
      s = serverPayload ? await api.status(serverPayload) : await api.status(this.serverId)
    } catch (e) {
      // keep user informed, but no dev logs
      wx.showToast({ title: '获取状态异常', icon: 'none' })
      return
    }

    if (s && s.ok && s.data && s.data.status) {
      const st = s.data.status

      const pick = (cands) => {
        for (const k of cands) if (st[k] !== undefined && st[k] !== null && st[k] !== '') return st[k]
        return undefined
      }

      const playersRaw = pick(['playersDisplay', 'onlinePlayers', 'PlayerCount', 'playerCount'])
      const maxRaw = pick(['maxPlayers', 'MaxPlayers'])
      let playersDisplay = '-'
      if (playersRaw != null && playersRaw !== '-') {
        const p = String(playersRaw).trim()
        // If server already returned a combined form like '39/100', use it directly to avoid '39/100/100'
        if (p.indexOf('/') !== -1) {
          playersDisplay = p
        } else {
          playersDisplay = maxRaw != null ? `${p}/${String(maxRaw)}` : p
        }
      }

      let mapName = pick(['mapName', 'MapName', 'map']) || '-'
      if (typeof mapName === 'string') mapName = mapName.replace(/_/g, ' ')

      const team1 = pick(['faction1', 'team1', 'TeamOne']) || '-'
      const team2 = pick(['faction2', 'team2', 'TeamTwo']) || '-'

      let duration = pick(['durationDisplay', 'duration', 'PlayTime']) || '-'
      if (typeof duration === 'number') {
        const seconds = duration
        if (seconds > 60) {
          const m = Math.floor(seconds / 60)
          const ssec = seconds % 60
          duration = `${m}分${ssec}秒`
        } else duration = `${seconds}秒`
      }

      const latencyMs = (st.latencyMs != null ? st.latencyMs : (st.latency != null ? st.latency : null))

      const display = {
        serverName: st.serverName || (this.data.server && this.data.server.name) || '服务器控制台',
        playersDisplay: playersDisplay || '-',
        map: mapName || '-',
        team1: team1 || '-',
        team2: team2 || '-',
        duration: duration || '-',
        latency: latencyMs != null ? (latencyMs + 'ms') : '-',
        updatedAtStr: st.updatedAt ? new Date(st.updatedAt).toLocaleString() : '-'
      }
      this.setData({ status: display })
    } else {
      // keep user informed
      wx.showToast({ title: '状态不可用', icon: 'none' })
    }
  },

  onBroadcastInput(e) {
    this.setData({ broadcastText: e && e.detail && e.detail.value })
  },

  onCommandInput(e) {
    this.setData({ commandText: e && e.detail && e.detail.value })
  },

  async sendBroadcast() {
    const txt = (this.data.broadcastText || '').trim()
    if (!txt) {
      wx.showToast({ title: '请输入广播内容', icon: 'none' })
      return
    }
    const cmd = `AdminBroadcast ${txt}`
    try {
      const res = await api.command(this.serverId, cmd)
      if (res && res.ok) {
        wx.showToast({ title: '广播已发送', icon: 'success' })
        this.setData({ broadcastText: '' })
      } else {
        wx.showToast({ title: res && res.message || '发送失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '发送异常', icon: 'none' })
    }
  },

  async sendCommand() {
    const txt = (this.data.commandText || '').trim()
    if (!txt) {
      wx.showToast({ title: '请输入完整服务器指令', icon: 'none' })
      return
    }
    try {
      // send command, do not require returning output
      const res = await api.command(this.serverId, txt)
      if (res && res.ok) {
        wx.showToast({ title: '指令已发送', icon: 'success' })
        this.setData({ commandText: '' })
      } else {
        wx.showToast({ title: res && res.message || '发送失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '发送异常', icon: 'none' })
    }
  },

  openPlayers() {
    wx.navigateTo({ url: `/pages/admin-servers/players/players?serverId=${this.serverId}` })
  },

  openActions() {
    console.log('[console] openActions clicked, serverId=', this.serverId)
    wx.navigateTo({
      url: `/pages/admin-servers/actions/actions?serverId=${this.serverId}`,
      success() { console.log('[console] navigateTo actions success') },
      fail(err) { console.error('[console] navigateTo actions failed', err); wx.showToast({ title: '无法打开审计日志: ' + (err && err.errMsg || '未知错误'), icon: 'none' }) }
    })
  },

  openMapSettings() {
    console.log('[console] openMapSettings clicked, serverId=', this.serverId)
    wx.navigateTo({ url: `/pages/admin-servers/map-settings/map-settings?serverId=${this.serverId}` })
  },

  openWarmup() {
    wx.navigateTo({ url: `/pages/admin-servers/warmup/warmup?serverId=${this.serverId}` })
  },

  openOtherCommands() { wx.navigateTo({ url: `/pages/admin-servers/other-commands/other-commands?serverId=${this.serverId}` }) },
  goHome() {
    wx.redirectTo({ url: '/pages/home/home' })
  },
  goMembers() {
    const teamId = (this.data.server && this.data.server.teamId) || ''
    if (!teamId) return wx.showToast({ title: '未绑定战队', icon: 'none' })
    wx.redirectTo({ url: `/pages/member-list/member-list?teamId=${teamId}` })
  },
  goActivityList() {
    const teamId = (this.data.server && this.data.server.teamId) || ''
    if (!teamId) return wx.showToast({ title: '未绑定战队', icon: 'none' })
    wx.redirectTo({ url: `/pages/activity-list/activity-list?teamId=${teamId}` })
  },
  goMy() {
    const teamId = (this.data.server && this.data.server.teamId) || ''
    const qs = teamId ? `?teamId=${teamId}` : ''
    wx.redirectTo({ url: `/pages/my-center/my-center${qs}` })
  },

  // Server settings: only owner (not admin) should see this; open action sheet to Modify or Unbind.
  openServerSettings() {
    const server = this.data.server || {}
    const teamId = server.teamId || ''
    if (!teamId) {
      wx.showToast({ title: '该服务器未绑定战队', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: ['修改服务器信息', '解绑服务器（解除与战队绑定）'],
      itemColor: '#1677FF',
      success: async (res) => {
        if (res.tapIndex === 0) {
          // navigate to edit page
          wx.navigateTo({ url: `/pages/admin-servers/edit/edit?serverId=${this.serverId}` })
        } else if (res.tapIndex === 1) {
          // confirm unbind
          const ok = await new Promise(resolve => {
            wx.showModal({ title: '确认解绑', content: '解绑后战队将不再关联该服务器，只有战队队长可以重新绑定。确认要解绑吗？', confirmText: '解绑', cancelText: '取消', success: r => resolve(!!r.confirm), fail: () => resolve(false) })
          })
          if (!ok) return
          wx.showLoading({ title: '解绑中...' })
          try {
            const r2 = await wx.cloud.callFunction({ name: 'serverRemove', data: { serverId: this.serverId, teamId } })
            wx.hideLoading()
            const rr = r2 && r2.result
            if (rr && rr.ok) {
              wx.showToast({ title: '已解绑', icon: 'success' })
              // refresh detail
              this.load()
            } else {
              wx.showToast({ title: rr && rr.message || '解绑失败', icon: 'none' })
            }
          } catch (e) {
            wx.hideLoading()
            console.error('[console] unbind fail', e)
            wx.showToast({ title: '解绑失败', icon: 'none' })
          }
        }
      }
    })
  },
})
