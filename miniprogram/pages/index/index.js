Page({
  onLoad() {
    // 兼容旧入口：index 页不再作为首页使用，直接跳转到新首页
    wx.reLaunch({ url: '/pages/home/home' })
  },
})
