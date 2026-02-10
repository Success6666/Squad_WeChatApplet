const api = require('../../../utils/server-api')

Page({
  data: {
    serverId: null,
    promptVisible: false,
    promptCmd: null,
    promptLabel: '',
    promptPlaceholder: '',
    promptValue: ''
  },

  onLoad(options) {
    this.serverId = options && options.serverId
    this.setData({ serverId: this.serverId })
  },

  onCmd(e) {
    const cmd = e.currentTarget.dataset.cmd
    const needArg = e.currentTarget.dataset.needarg === 'true' || e.currentTarget.dataset.needarg === true
    if (!needArg) {
      this._sendCmd(cmd)
      return
    }
    // show prompt
    const label = cmd === 'AdminSlomo' ? '设置时间流逝倍速（例如 0.1 为 10%）' : `请输入 ${cmd} 参数`
    this.setData({ promptVisible: true, promptCmd: cmd, promptLabel: label, promptPlaceholder: '', promptValue: '' })
  },

  onPromptInput(e) { this.setData({ promptValue: e.detail.value }) },
  cancelPrompt() { this.setData({ promptVisible: false, promptCmd: null, promptValue: '' }) },

  confirmPrompt() {
    const v = (this.data.promptValue || '').trim()
    if (!v) { wx.showToast({ title: '请输入参数', icon: 'none' }); return }
    const cmd = `${this.data.promptCmd} ${v}`
    this.setData({ promptVisible: false, promptCmd: null, promptValue: '' })
    this._sendCmd(cmd)
  },

  async _sendCmd(cmd) {
    wx.showLoading({ title: '发送中...' })
    try {
      const r = await api.command(this.serverId, cmd)
      wx.hideLoading()
      if (r && r.ok) {
        wx.showToast({ title: '命令已发送', icon: 'success' })
      } else wx.showToast({ title: r && r.message || '发送失败', icon: 'none' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  }
})
