const api = require('../../../utils/server-api')
Page({
  data: { server: {} },
  onLoad(options) { this.serverId = options.serverId; this.load() },
  async load() {
    wx.showLoading({ title: '加载中' })
    const res = await api.detail(this.serverId)
    wx.hideLoading()
    if (res && res.ok) this.setData({ server: res.data.server })
    else wx.showToast({ title: res && res.message || '加载失败', icon: 'none' })
  },
  onEdit() { wx.navigateTo({ url: '/pages/admin-servers/edit/edit?serverId=' + this.serverId }) },
  async onTest() {
    wx.showLoading({ title: '测试中' })
    const res = await api.testConnect(this.serverId)
    wx.hideLoading()
    if (res && res.ok) wx.showToast({ title: '可达: ' + (res.data.latencyMs || '-') + 'ms' })
    else wx.showToast({ title: res && res.message || '测试失败', icon: 'none' })
  }
})

