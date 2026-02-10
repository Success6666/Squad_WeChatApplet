function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}
function fmt(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function typeText(type) {
  const map = { internal: '内部训练', skrimmage: '训练赛', official: '正式比赛' }
  return map[type] || '活动'
}

Page({
  data: {
    teamId: '',
    activityId: '',
    loading: false,
    toggling: false,
    activity: null,
    signed: false,
    canSignup: false,
    banReason: '',
    isAdmin: false,
    typeText: '',
    startText: '',
    deadlineText: '',
  },
  onLoad(q) {
    this.setData({ teamId: q.teamId, activityId: q.activityId })
  },
  onShow() {
    this.load()
  },
  async load() {
    this.setData({ loading: true })
    try {
      // 管理权限
      try {
        const td = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId } })
        const tr = td.result
        if (tr && tr.ok) {
          const m = tr.data.myMember
          const isAdmin = m && m.status === 'approved' && (m.role === 'owner' || m.role === 'admin')
          this.setData({ isAdmin })
        }
      } catch (e) {
        console.error(e)
      }

      const res = await wx.cloud.callFunction({ name: 'activityDetail', data: { teamId: this.data.teamId, activityId: this.data.activityId } })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')

      const a = r.data.activity
      const signed = !!r.data.signed

      const now = Date.now()
      let canSignup = true
      let banReason = ''

      if (!r.data.isMemberApproved) {
        canSignup = false
        banReason = '未通过队伍审核'
      } else if (r.data.ban && r.data.ban.banned) {
        canSignup = false
        banReason = r.data.ban.reason || '已被禁赛'
      } else if (a.signupDeadline && now > a.signupDeadline) {
        canSignup = false
        banReason = '已过截止时间'
      } else if (a.startTime && now > a.startTime) {
        canSignup = false
        banReason = '活动已结束'
      }

      this.setData({
        activity: a,
        signed,
        canSignup,
        banReason,
        typeText: typeText(a.type),
        startText: fmt(a.startTime),
        deadlineText: fmt(a.signupDeadline),
      })
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      this.setData({ activity: null })
    } finally {
      this.setData({ loading: false })
    }
  },
  async toggle() {
    if (this.data.toggling) return
    if (!this.data.canSignup) return

    this.setData({ toggling: true })
    try {
      const action = this.data.signed ? 'cancel' : 'signup'
      const res = await wx.cloud.callFunction({
        name: 'signupToggle',
        data: { teamId: this.data.teamId, activityId: this.data.activityId, action },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '操作失败')

      const nextSigned = action === 'signup'
      wx.showToast({ title: nextSigned ? '已报名' : '已取消' })

      // 直接更新本地状态，避免重复触发 load 带来的按钮“没反应”错觉
      const nextActivity = this.data.activity ? { ...this.data.activity, signupCount: r.data.signupCount } : this.data.activity
      this.setData({ signed: nextSigned, activity: nextActivity })

      // 轻量刷新一下 ban/截止时间（不阻塞体验）
      setTimeout(() => this.load(), 200)
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ toggling: false })
    }
  },
  goStats() {
    wx.navigateTo({ url: `/pages/signup-admin/signup-admin?teamId=${this.data.teamId}&activityId=${this.data.activityId}` })
  },
})
