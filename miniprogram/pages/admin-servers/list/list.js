const api = require('../../../utils/server-api')
Page({
  data: { servers: [], isAdmin: false },
  onLoad(options) { this.teamId = options.teamId; this.load() },
  async load() {
    wx.showLoading({ title: '加载中' })
    // check admin for this team context
    let isAdmin = false
    try {
      const guard = require('../../../utils/guard')
      isAdmin = await guard.ensureAdminForTeam(this.teamId)
    } catch (e) { console.error('[list] guard fail', e) }

    const res = await api.list({ page: 1, pageSize: 50 })
    wx.hideLoading()
    if (res && res.ok) {
      this.setData({ servers: res.data.items || [], isAdmin })
    } else {
      this.setData({ isAdmin })
      wx.showToast({ title: res && res.message || '加载失败', icon: 'none' })
    }
  },
  onCreate() { wx.navigateTo({ url: '/pages/admin-servers/edit/edit?teamId=' + encodeURIComponent(this.teamId) }) },
  onOpen(e) { const id = e.currentTarget.dataset.id; wx.navigateTo({ url: '/pages/admin-servers/detail/detail?serverId=' + id }) },
  async onTest(e) {
    e.stopPropagation()
    const id = e.currentTarget.dataset.id
    wx.showLoading({ title: '测试中' })
    const res = await api.testConnect(id)
    wx.hideLoading()
    if (res && res.ok) wx.showToast({ title: '可达: ' + (res.data.latencyMs || '-') + 'ms' })
    else wx.showToast({ title: res && res.message || '测试失败', icon: 'none' })
  },
  onConsole(e) { e.stopPropagation(); const id = e.currentTarget.dataset.id; wx.navigateTo({ url: '/pages/admin-servers/console/console?serverId=' + id }) },
})
