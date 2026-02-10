const loaders = require('../../utils/pageLoaders')

const ACTIVITY_CACHE_TTL_MS = 0

Page({
  data: {
    teamId: '',
    loading: false,
    activities: [],
    page: 0,
    pageSize: 20,
    noMore: false,
    isAdmin: false,
    togglingId: '',
    removingId: '',
    currentTab: 'activities',
  },
  onLoad(q) {
    const tid = (q.teamId || '').trim()
    this.setData({ teamId: tid })
    if (!tid) {
      // defensive: if no teamId provided, show a friendly message and navigate back to home
      wx.showToast({ title: '未提供 teamId，正在返回首页', icon: 'none' })
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/home/home' })
      }, 700)
    }
  },
  onShow() {
    const app = getApp()
    const key = 'activityList:' + this.data.teamId
    const cache = app && app.globalData && app.globalData.pageCache && app.globalData.pageCache[key]
    if (cache && cache.ts) {
      this.setData({ ...cache.data, loading: false })
      this.bootstrap({ silent: true })
      return
    }
    if (!this.data.teamId) return
    this.bootstrap({ silent: false })
  },
  async bootstrap(opts) {
    const silent = !!(opts && opts.silent)
    if (!this.data.teamId) return
    // 复用 teamDetail 判断是否管理员
    try {
      const td = await loaders.loadTeamDetail(this.data.teamId)
      const r = td
      if (r && r.ok) {
        const m = r.data.myMember
        const isAdmin = m && m.status === 'approved' && (m.role === 'owner' || m.role === 'admin')
        this.setData({ isAdmin })
      }
    } catch (e) {
      console.error(e)
    }

    if (!silent) this.setData({ page: 0, activities: [], noMore: false })
    this.loadMore({ silent })
  },
  async loadMore(opts) {
    const silent = !!(opts && opts.silent)
    if (this.data.loading || this.data.noMore) return
    if (!silent) this.setData({ loading: true })
    try {
      const res = await loaders.loadActivityList({ teamId: this.data.teamId, page: this.data.page, pageSize: this.data.pageSize })
      const r = res
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      const list = r.data.list || []
      if (silent) {
        this.setData({
          activities: list,
          page: 1,
          noMore: list.length < this.data.pageSize,
        })
      } else {
        this.setData({
          activities: this.data.activities.concat(list),
          page: this.data.page + 1,
          noMore: list.length < this.data.pageSize,
        })
      }

      const app = getApp()
      if (app && app.globalData && app.globalData.pageCache) {
        const key = 'activityList:' + this.data.teamId
        app.globalData.pageCache[key] = {
          ts: Date.now(),
          data: {
            teamId: this.data.teamId,
            activities: this.data.activities,
            page: this.data.page,
            pageSize: this.data.pageSize,
            noMore: this.data.noMore,
            isAdmin: this.data.isAdmin,
            currentTab: 'activities',
          },
        }
      }
    } catch (e) {
      console.error(e)
      if (!silent) wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },
  onReachBottom() {
    this.loadMore()
  },
  goDetail(e) {
    const activityId = e.detail.activityId
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?teamId=${this.data.teamId}&activityId=${activityId}` })
  },
  goCreate() {
    wx.navigateTo({ url: `/pages/activity-create/activity-create?teamId=${this.data.teamId}` })
  },
  goTeam() {
    wx.redirectTo({ url: '/pages/home/home' })
  },
  goHome() {
    wx.redirectTo({ url: '/pages/home/home' })
  },
  goMembers() {
    wx.redirectTo({ url: `/pages/member-list/member-list?teamId=${this.data.teamId}` })
  },
  goMy() {
    const qs = this.data.teamId ? `?teamId=${this.data.teamId}` : ''
    wx.redirectTo({ url: `/pages/my-center/my-center${qs}` })
  },
  async goServerPanel() {
    if (!this.data.teamId) return wx.showToast({ title: '请先加入战队', icon: 'none' })
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
      console.error('[activity-list] goServerPanel fail', e)
      wx.redirectTo({ url: `/pages/admin-servers/list/list?teamId=${this.data.teamId}` })
    }
  },
  async onSignup(e) {
    const activityId = e.detail.activityId
    if (!activityId) return
    if (this.data.togglingId) return

    const a = (this.data.activities || []).find(x => x._id === activityId)
    // 列表数据里不一定有 signed 状态；这里默认“报名”，实际状态由详情页展示
    const action = 'signup'

    this.setData({ togglingId: activityId })
    try {
      const res = await loaders.signupToggle(this.data.teamId, activityId, action)
      const r = res
      if (!r || !r.ok) throw new Error((r && r.message) || '操作失败')
      wx.showToast({ title: '已报名' })
      // 轻量刷新：更新本地 signupCount
      if (a && typeof r.data.signupCount === 'number') {
        const next = this.data.activities.map(x => (x._id === activityId ? { ...x, signupCount: r.data.signupCount } : x))
        this.setData({ activities: next })
      }
    } catch (err) {
      console.error(err)
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ togglingId: '' })
    }
  },
  openManage(e) {
    const activityId = e.currentTarget.dataset.id
    if (!activityId) return

    wx.showActionSheet({
      itemList: ['修改活动', '删除活动'],
      success: async r => {
        const tapIndex = r.tapIndex
        if (tapIndex === 0) {
          wx.navigateTo({ url: `/pages/activity-create/activity-create?teamId=${this.data.teamId}&activityId=${activityId}` })
          return
        }
        if (tapIndex === 1) {
          const ok = await new Promise(resolve => {
            wx.showModal({
              title: '确认删除',
              content: '删除后不可恢复，报名记录会被标记取消。',
              confirmText: '删除',
              cancelText: '取消',
              success: m => resolve(!!m.confirm),
              fail: () => resolve(false),
            })
          })
          if (!ok) return

          if(this.data.removingId) return
          this.setData({ removingId: activityId })
          try {
            const res = await loaders.removeActivity(this.data.teamId, activityId)
            const rr = res
            if (!rr || !rr.ok) throw new Error((rr && rr.message) || '删除失败')
            wx.showToast({ title: '已删除' })
            // 重新拉取
            this.bootstrap()
          } catch (err) {
            console.error(err)
            wx.showToast({ title: err.message || '删除失败', icon: 'none' })
          } finally {
            this.setData({ removingId: '' })
          }
        }
      },
    })
  },
})
