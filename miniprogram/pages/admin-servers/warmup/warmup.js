const api = require('../../../utils/server-api')

Page({
  data: {
    serverId: null,
    options: [
      { key: 'AdminForceAllDeployableAvailability', label: '无条件放置所有放置物', on: false, arg: '1' },
      { key: 'AdminNoRespawnTimer', label: '无复活时间', on: false, arg: '1' },
      { key: 'AdminNoTeamChangeTimer', label: '无换边时间', on: false, arg: '1' },
      { key: 'AdminDisableVehicleClaiming', label: '载具无需认证', on: false, arg: '1' },
      { key: 'AdminForceAllRoleAvailability', label: '所有装备无条件可用', on: false, arg: '1' },
      { key: 'AdminForceAllVehicleAvailability', label: '始终填满所有载具位置', on: false, arg: '1' },
      { key: 'AdminDisableVehicleKitRequirement', label: '取消坦克飞机载具装要求', on: false, arg: '1' }
    ],
    confirmVisible: false,
    confirmCommands: []
  },

  onLoad(options) {
    this.serverId = options && options.serverId
    this.setData({ serverId: this.serverId })
    // load persisted per-server settings if any
    try {
      const key = `warmup_state_${this.serverId}`
      const saved = wx.getStorageSync(key)
      if (saved && Array.isArray(saved)) {
        const opts = this.data.options.slice()
        for (let i=0;i<opts.length;i++) opts[i].on = !!saved[i]
        this.setData({ options: opts })
      }
    } catch (e) {}
  },

  onToggle(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const opts = this.data.options.slice()
    opts[idx].on = !!e.detail.value
    this.setData({ options: opts })
    // persist to local storage per-server
    try {
      const key = `warmup_state_${this.serverId}`
      wx.setStorageSync(key, opts.map(o=>o.on))
    } catch (e) {}
  },

  confirmApplyWarmup() {
    // build list of commands to confirm
    const opts = this.data.options || []
    const cmds = opts.map(o => `${o.key} ${o.on ? (o.arg||'1') : '0'}`)
    this.setData({ confirmCommands: cmds, confirmVisible: true })
  },

  cancelConfirm() { this.setData({ confirmVisible: false, confirmCommands: [] }) },

  async applyWarmup() {
    this.setData({ confirmVisible: false })
    const opts = this.data.options || []
    wx.showLoading({ title: '发送中...' })
    try {
      for (const o of opts) {
        const val = o.on ? (o.arg || '1') : '0'
        const cmd = `${o.key} ${val}`
        await api.command(this.serverId, cmd)
      }
      wx.hideLoading()
      wx.showToast({ title: '已发送暖服设置', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  }
})
