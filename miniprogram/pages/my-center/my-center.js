const { ensureAdminForTeam } = require('../../utils/guard')

const MY_CACHE_TTL_MS = 0

Page({
  data: {
    teamId: '',
    loading: false,
    profile: null,
    team: null,
    myMember: null,
    isAdmin: false,
    isOwner: false,
    currentTab: 'profile',
  },
  onLoad(q) {
    const teamId = (q && q.teamId) ? String(q.teamId) : (wx.getStorageSync('teamId') || '')
    this.setData({ teamId })
  },
  onShow() {
    const app = getApp()
    const key = 'myCenter:' + (this.data.teamId || 'global')
    const cache = app && app.globalData && app.globalData.pageCache && app.globalData.pageCache[key]
    if (cache && cache.ts) {
      this.setData({ ...cache.data, loading: false })
      this.load({ silent: true })
      return
    }
    this.load({ silent: false })
  },
  async load(opts) {
    const silent = !!(opts && opts.silent)
    if (!silent) this.setData({ loading: true })
    try {
      const pg = await wx.cloud.callFunction({ name: 'profileGet', data: {} })
      const pr = pg && pg.result
      const profile = (pr && pr.ok && pr.data && pr.data.profile) ? pr.data.profile : null
      this.setData({ profile })
    } catch (e) {
      console.warn('[my-center] profileGet fail', e)
    }

    if (this.data.teamId) {
      try {
        const td = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId } })
        const tr = td && td.result
        if (tr && tr.ok && tr.data) {
          const myMember = tr.data.myMember || null
          const team = tr.data.team || null
          let isOwner = myMember && myMember.status === 'approved' && myMember.role === 'owner'
          let isAdmin = myMember && myMember.status === 'approved' && (myMember.role === 'owner' || myMember.role === 'admin')
          if (!isAdmin) {
            try {
              isAdmin = await ensureAdminForTeam(this.data.teamId)
            } catch (e) {
              console.warn('[my-center] ensureAdminForTeam fail', e)
            }
          }
          this.setData({ myMember, team, isAdmin: !!isAdmin, isOwner: !!isOwner })
        }
      } catch (e) {
        console.warn('[my-center] teamDetail fail', e)
      }
    }

    const app = getApp()
    if (app && app.globalData && app.globalData.pageCache) {
      const key = 'myCenter:' + (this.data.teamId || 'global')
      app.globalData.pageCache[key] = {
        ts: Date.now(),
        data: {
          teamId: this.data.teamId,
          profile: this.data.profile,
          team: this.data.team,
          myMember: this.data.myMember,
          isAdmin: this.data.isAdmin,
          isOwner: this.data.isOwner,
          currentTab: 'profile',
        },
      }
    }

    if (!silent) this.setData({ loading: false })
  },
  goEditProfile() {
    const tid = this.data.teamId
    const qs = tid ? `?teamId=${tid}` : ''
    wx.navigateTo({ url: `/pages/my-profile/my-profile${qs}` })
  },
  goReview() {
    if (!this.data.teamId) return wx.showToast({ title: '未加入战队', icon: 'none' })
    wx.navigateTo({ url: `/pages/admin-review/admin-review?teamId=${this.data.teamId}` })
  },
  manageTeam() {
    if (!this.data.teamId) return wx.showToast({ title: '未加入战队', icon: 'none' })
    if (!this.data.isAdmin) return wx.showToast({ title: '需要管理员权限', icon: 'none' })

    const items = ['编辑战队资料', '发布公告']
    if (this.data.isOwner) items.push('解散战队')

    wx.showActionSheet({
      itemList: items,
      success: async r => {
        const choice = items[r.tapIndex]
        if (choice === '编辑战队资料') {
          wx.navigateTo({ url: `/pages/team-create/team-create?teamId=${this.data.teamId}` })
          return
        }
        if (choice === '发布公告') {
          const text = await new Promise(resolve => {
            wx.showModal({
              title: '发布公告',
              editable: true,
              placeholderText: '请输入公告内容',
              confirmText: '发布',
              cancelText: '取消',
              success: m => resolve((m && m.confirm) ? (m.content || '') : ''),
              fail: () => resolve(''),
            })
          })
          if (text === '') return

          const team = this.data.team || {}
          const name = (team.name || '').trim()
          const desc = (team.desc || '').trim()
          if (!name) return wx.showToast({ title: '战队信息未加载', icon: 'none' })

          wx.showLoading({ title: '发布中...' })
          try {
            const res = await wx.cloud.callFunction({
              name: 'teamUpdate',
              data: { teamId: this.data.teamId, name, desc, announcement: text }
            })
            const rr = res && res.result
            if (!rr || !rr.ok) throw new Error((rr && rr.message) || '发布失败')
            wx.showToast({ title: '已发布' })
            setTimeout(() => {
              wx.redirectTo({ url: '/pages/home/home' })
            }, 400)
          } catch (e) {
            console.error(e)
            wx.showToast({ title: e.message || '发布失败', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
          return
        }
        if (choice === '解散战队') {
          const ok = await new Promise(resolve => {
            wx.showModal({
              title: '确认解散战队',
              content: '解散后无法恢复，成员与活动将被移除/标记为历史。',
              confirmText: '解散',
              cancelText: '取消',
              success: m => resolve(!!m.confirm),
              fail: () => resolve(false),
            })
          })
          if (!ok) return

          wx.showLoading({ title: '处理中...' })
          try {
            const res = await wx.cloud.callFunction({ name: 'teamRemove', data: { teamId: this.data.teamId } })
            const rr = res && res.result
            if (!rr || !rr.ok) throw new Error((rr && rr.message) || '解散失败')
            wx.showToast({ title: '已解散' })
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/home/home' })
            }, 500)
          } catch (e) {
            console.error(e)
            wx.showToast({ title: e.message || '解散失败', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      },
    })
  },
  goHome() {
    wx.redirectTo({ url: '/pages/home/home' })
  },
  goMembers() {
    wx.redirectTo({ url: `/pages/member-list/member-list?teamId=${this.data.teamId}` })
  },
  goActivityList() {
    wx.redirectTo({ url: `/pages/activity-list/activity-list?teamId=${this.data.teamId}` })
  },
  async goServerPanel() {
    if (!this.data.teamId) return wx.showToast({ title: '未加入战队', icon: 'none' })
    if (!this.data.isAdmin) return wx.showToast({ title: '需要管理员权限', icon: 'none' })
    try {
      const api = require('../../utils/server-api')
      const res = await api.list({ teamId: this.data.teamId })
      if (res && res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
        const s = res.data.items[0]
        wx.redirectTo({ url: `/pages/admin-servers/console/console?serverId=${s._id}` })
      } else {
        wx.redirectTo({ url: `/pages/admin-servers/edit/edit?teamId=${this.data.teamId}` })
      }
    } catch (e) {
      console.error('[my-center] goServerPanel fail', e)
      wx.redirectTo({ url: `/pages/admin-servers/list/list?teamId=${this.data.teamId}` })
    }
  },
  goMy() {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },
})
