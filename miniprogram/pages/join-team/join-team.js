const { ensureProfileForAction } = require('../../utils/guard')

function isSteam64(id) {
  return /^\d{17}$/.test((id || '').trim())
}

Page({
  data: {
    teamId: '',
    steamNick: '',
    steam64Id: '',
    position: '',
    onlineTime: '',
    submitting: false,
    loadingProfile: false,
  },
  onLoad(q) {
    const teamId = (q.teamId || '').trim()
    if (!teamId) {
      wx.redirectTo({ url: '/pages/join-team/join-team-search' })
      return
    }
    this.setData({ teamId })
  },
  async onShow() {
    if (!this.data.teamId) return

    // 如果已经是该战队成员，直接进入详情，不要再让用户申请
    try {
      const td = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId } })
      const r = td.result
      const my = r && r.ok && r.data && r.data.myMember
      if (my && my.status === 'approved') {
        wx.redirectTo({ url: '/pages/home/home' })
        return
      }
    } catch (e) {
      // ignore
      console.error('[join-team] teamDetail fail', e)
    }

    this.loadProfile()
  },
  onNick(e) {
    this.setData({ steamNick: e.detail.value })
  },
  onSteam64(e) {
    this.setData({ steam64Id: e.detail.value })
  },
  onPosition(e) {
    this.setData({ position: e.detail.value })
  },
  onOnlineTime(e) {
    this.setData({ onlineTime: e.detail.value })
  },
  async loadProfile() {
    this.setData({ loadingProfile: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'profileGet', data: {} })
      const r = res.result
      const p = r && r.ok && r.data && r.data.profile
      if (!p) return
      this.setData({
        steamNick: this.data.steamNick || p.steamNick || '',
        steam64Id: this.data.steam64Id || p.steam64Id || '',
        position: this.data.position || p.position || '',
        onlineTime: this.data.onlineTime || p.onlineTime || '',
      })
    } catch (e) {
      console.error('[join-team] loadProfile error', e)
    } finally {
      this.setData({ loadingProfile: false })
    }
  },
  async submit() {
    if (this.data.submitting) return

    // 只在提交时做资料校验；未完善则跳转完善资料，完成后回到当前页面
    const returnUrl = `/pages/join-team/join-team?teamId=${this.data.teamId}`
    const okProfile = await ensureProfileForAction({ returnUrl })
    if (!okProfile) return

    const steamNick = (this.data.steamNick || '').trim()
    const steam64Id = (this.data.steam64Id || '').trim()
    if (!steamNick) return wx.showToast({ title: '请填写 Steam 昵称', icon: 'none' })
    if (!isSteam64(steam64Id)) return wx.showToast({ title: 'Steam64 ID 格式错误', icon: 'none' })

    this.setData({ submitting: true })
    try {
      // 先把资料写入 profile（保证后台一致）
      await wx.cloud.callFunction({
        name: 'profileUpsert',
        data: {
          steamNick,
          steam64Id,
          position: (this.data.position || '').trim(),
          onlineTime: (this.data.onlineTime || '').trim(),
        },
      })

      const res = await wx.cloud.callFunction({
        name: 'memberApply',
        data: {
          teamId: this.data.teamId,
          steamNick,
          steam64Id,
          position: (this.data.position || '').trim(),
          onlineTime: (this.data.onlineTime || '').trim(),
        },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '提交失败')

      if (r.data && r.data.status === 'approved') {
        wx.showToast({ title: '已加入' })
        setTimeout(() => wx.redirectTo({ url: '/pages/home/home' }), 400)
        return
      }

      wx.showToast({ title: '已提交，等待审核' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
