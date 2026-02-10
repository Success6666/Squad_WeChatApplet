Page({
  data: {
    teamId: '',
    loading: false,
    list: [],
    actingId: '',
  },
  onLoad(q) {
    this.setData({ teamId: q.teamId })
  },
  onShow() {
    this.load()
  },
  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId, includePending: true } })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      this.setData({ list: r.data.pendingMembers || [] })
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  async approve(e) {
    await this.review(e.currentTarget.dataset.id, 'approved')
  },
  async reject(e) {
    await this.review(e.currentTarget.dataset.id, 'rejected')
  },
  async review(memberId, action) {
    if (!memberId) return
    this.setData({ actingId: memberId })
    try {
      const res = await wx.cloud.callFunction({
        name: 'memberReview',
        data: { teamId: this.data.teamId, memberId, action },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '操作失败')
      wx.showToast({ title: '已处理' })
      this.load()
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ actingId: '' })
    }
  },
})

