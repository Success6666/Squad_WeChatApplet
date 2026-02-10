Page({
  data: {
    teamId: '',
    activityId: '',
    loading: false,
    list: [],
    count: 0,
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
      const res = await wx.cloud.callFunction({ name: 'signupStats', data: { teamId: this.data.teamId, activityId: this.data.activityId } })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      this.setData({ list: r.data.list || [], count: r.data.count || 0 })
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
})

