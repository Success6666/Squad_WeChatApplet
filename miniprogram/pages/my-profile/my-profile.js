function isSteam64(id) {
  return /^\d{17}$/.test((id || '').trim())
}

Page({
  data: {
    teamId: '',
    loading: false,
    saving: false,
    profile: null,
  },
  onLoad(q) {
    this.setData({ teamId: q.teamId })
  },
  onShow() {
    this.load()
  },
  updateProfileField(key, value) {
    var p = this.data.profile || {}
    var next = Object.assign({}, p)
    // 避免 computed property 触发编译器 helper：用 if 分支显式赋值
    if (key === 'steamNick') next.steamNick = value
    else if (key === 'steam64Id') next.steam64Id = value
    else if (key === 'position') next.position = value
    else if (key === 'onlineTime') next.onlineTime = value
    this.setData({ profile: next })
  },
  onSteamNick(e) {
    this.updateProfileField('steamNick', e.detail.value)
  },
  onSteam64(e) {
    this.updateProfileField('steam64Id', e.detail.value)
  },
  onPosition(e) {
    this.updateProfileField('position', e.detail.value)
  },
  onOnlineTime(e) {
    this.updateProfileField('onlineTime', e.detail.value)
  },
  async load() {
    var that = this
    that.setData({ loading: true })

    try {
      // prefer to load global profile first (keeps global profile in sync)
      try {
        const pg = await wx.cloud.callFunction({ name: 'profileGet', data: {} })
        const pr = pg && pg.result
        const profile = (pr && pr.ok && pr.data && pr.data.profile) ? pr.data.profile : (pr && pr.profile) ? pr.profile : null
        if (profile) that.setData({ profile })
      } catch (e) {
        console.warn('[my-profile] profileGet failed', e)
      }

      // if teamId is present, also fetch teamDetail.myMember and merge (team-scoped member data should be authoritative for member record)
      if (that.data.teamId) {
        try {
          const td = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: that.data.teamId } })
          const r = td && td.result
          if (r && r.ok && r.data && r.data.myMember) {
            const m = r.data.myMember
            const merged = Object.assign({}, that.data.profile || {}, {
              steamNick: m.steamNick || (that.data.profile && that.data.profile.steamNick) || '',
              steam64Id: m.steam64Id || (that.data.profile && that.data.profile.steam64Id) || '',
              position: m.position || (that.data.profile && that.data.profile.position) || '',
              onlineTime: m.onlineTime || (that.data.profile && that.data.profile.onlineTime) || '',
              // include role and status so UI can render permissions/badges consistently
              role: m.role || (that.data.profile && that.data.profile.role) || '',
              status: m.status || (that.data.profile && that.data.profile.status) || '',
              // keep member id / openId for future checks
              memberOpenId: m.openId || (that.data.profile && that.data.profile.memberOpenId) || ''
            })
            that.setData({ profile: merged })
          }
        } catch (e) {
          console.warn('[my-profile] teamDetail fetch failed', e)
        }
      }

    } catch (e) {
      console.error(e)
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    } finally {
      that.setData({ loading: false })
    }
  },

  async save() {
    var that = this
    var p = that.data.profile
    if (!p) return

    var steamNick = (p.steamNick || '').trim()
    var steam64Id = (p.steam64Id || '').trim()
    if (!steamNick) return wx.showToast({ title: '请填写 Steam 昵称', icon: 'none' })
    if (!isSteam64(steam64Id)) return wx.showToast({ title: 'Steam64 ID 格式错误', icon: 'none' })

    that.setData({ saving: true })

    try {
      // First update global profile collection
      await wx.cloud.callFunction({
        name: 'profileUpsert',
        data: {
          steamNick: steamNick,
          steam64Id: steam64Id,
          position: (p.position || '').trim(),
          onlineTime: (p.onlineTime || '').trim(),
        }
      })

      // Then update team member record if teamId present (so team-detail and player lists reflect new info immediately)
      if (that.data.teamId) {
        try {
          await wx.cloud.callFunction({
            name: 'memberUpdateProfile',
            data: {
              teamId: that.data.teamId,
              steamNick: steamNick,
              steam64Id: steam64Id,
              position: (p.position || '').trim(),
              onlineTime: (p.onlineTime || '').trim(),
            }
          })
        } catch (e) {
          // member update may fail if user not a member of this team; ignore but warn
          console.warn('[my-profile] memberUpdateProfile failed', e)
        }
      }

      wx.showToast({ title: '已保存' })
      return that.load()
    } catch (e) {
      console.error(e)
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    } finally {
      that.setData({ saving: false })
    }
  },
})
