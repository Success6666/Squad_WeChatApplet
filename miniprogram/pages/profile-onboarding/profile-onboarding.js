const { markProfileDone, markProfileSkipped } = require('../../utils/guard')

function isSteam64(id) {
  return /^\d{17}$/.test((id || '').trim())
}

function isProfileComplete(p) {
  const nick = (p && p.steamNick || '').trim()
  const sid = (p && p.steam64Id || '').trim()
  return !!nick && isSteam64(sid)
}

Page({
  data: {
    steamNick: '',
    steam64Id: '',
    position: '',
    onlineTime: '',
    saving: false,
    loading: false,
    returnUrl: '',
    force: false,
  },
  onLoad(q) {
    const returnUrl = (q && q.returnUrl) ? decodeURIComponent(q.returnUrl) : ''
    const force = String((q && q.force) || '') === '1'
    this.setData({ returnUrl, force })
  },
  onShow() {
    this.loadProfile()
  },
  async loadProfile() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'profileGet', data: {} })
      const r = res.result
      if (!r || !r.ok) return
      const p = r.data && r.data.profile
      if (p) {
        // 已有完整资料：
        // - 正常流程（从 guard 跳转过来）直接回主页/回跳
        // - 但如果是用户主动点“资料”进来(force=1)，允许继续编辑
        if (!this.data.force && isProfileComplete(p)) {
          markProfileDone()
          const back = this.data.returnUrl || '/pages/home/home'
          wx.reLaunch({ url: back })
          return
        }

        this.setData({
          steamNick: p.steamNick || '',
          steam64Id: p.steam64Id || '',
          position: p.position || '',
          onlineTime: p.onlineTime || '',
        })
      }
    } catch (e) {
      if (String((e && e.errMsg) || e.message || '').includes('FUNCTION_NOT_FOUND')) return
      console.error('[profile-onboarding] loadProfile error', e)
    } finally {
      this.setData({ loading: false })
    }
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
  skip() {
    markProfileSkipped()
    const back = this.data.returnUrl || '/pages/home/home'
    wx.reLaunch({ url: back })
  },
  async save() {
    const steamNick = (this.data.steamNick || '').trim()
    const steam64Id = (this.data.steam64Id || '').trim()

    if (!steamNick) return wx.showToast({ title: '请填写 Steam 昵称', icon: 'none' })
    if (!isSteam64(steam64Id)) return wx.showToast({ title: 'Steam64 ID 格式错误', icon: 'none' })

    this.setData({ saving: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'profileUpsert',
        data: {
          steamNick,
          steam64Id,
          position: (this.data.position || '').trim(),
          onlineTime: (this.data.onlineTime || '').trim(),
        },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '保存失败')

      // 如果 returnUrl 中包含 teamId，则尝试同步写 member 记录，保证战队范围内的名片信息同步
      try {
        const ru = this.data.returnUrl || ''
        const m = ru.match(/[?&]teamId=([^&]+)/)
        const teamId = m ? decodeURIComponent(m[1]) : ''
        if (teamId) {
          try {
            await wx.cloud.callFunction({
              name: 'memberUpdateProfile',
              data: {
                teamId,
                steamNick,
                steam64Id,
                position: (this.data.position || '').trim(),
                onlineTime: (this.data.onlineTime || '').trim(),
              }
            })
          } catch (e) {
            console.warn('[profile-onboarding] memberUpdateProfile failed', e)
          }
        }
      } catch (e) { console.warn('[profile-onboarding] parse returnUrl failed', e) }

      markProfileDone()
      wx.showToast({ title: '已保存' })
      setTimeout(() => {
        const back = this.data.returnUrl || '/pages/home/home'
        wx.reLaunch({ url: back })
      }, 400)
    } catch (e) {
      if (String((e && e.errMsg) || e.message || '').includes('FUNCTION_NOT_FOUND')) {
        wx.showToast({ title: '请先部署 profileGet/profileUpsert 云函数', icon: 'none' })
        return
      }
      console.error(e)
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
