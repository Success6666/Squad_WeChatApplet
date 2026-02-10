Page({
  data: {
    keyword: '',
    loading: false,
    teams: [],
    page: 0,
    pageSize: 20,
    noMore: false,
  },
  onLoad() {
    this.search()
  },
  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },
  async search() {
    this.setData({ teams: [], page: 0, noMore: false })
    await this.loadMore()
  },
  async loadMore() {
    if (this.data.loading || this.data.noMore) return
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamList',
        data: { keyword: this.data.keyword, page: this.data.page, pageSize: this.data.pageSize },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      const list = r.data.list || []
      this.setData({
        teams: this.data.teams.concat(list),
        page: this.data.page + 1,
        noMore: list.length < this.data.pageSize,
      })
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  onReachBottom() {
    this.loadMore()
  },
  choose(e) {
    const teamId = e.detail.teamId
    if (!teamId) return
    wx.navigateTo({ url: `/pages/join-team/join-team?teamId=${teamId}` })
  },
})
