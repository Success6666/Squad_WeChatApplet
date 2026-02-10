const { ensureProfileCompleteAsync, ensureAdminForTeam } = require('../../utils/guard')
const api = require('../../utils/server-api')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatTs(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function typeText(type) {
  const map = {
    internal: '内部训练',
    skrimmage: '训练赛',
    official: '正式比赛',
  }
  return map[type] || '活动'
}

Page({
  data: {
    loading: false,
    hasProfile: true,
    hasTeam: false,
    teamId: '',
    team: null,
    teamLogo: '',
    recentActivities: [],
    isAdmin: false,
    cloudError: '',
    currentTab: 'home',
    announcementText: '',
  },
  async onShow() {
    const app = getApp()
    const cache = app && app.globalData && app.globalData.pageCache && app.globalData.pageCache.home
    if (cache && cache.ts) {
      this.setData({ ...cache.data, loading: false, cloudError: '' })
      // 后台静默刷新
      this.bootstrap({ silent: true })
      return
    }
    this.bootstrap({ silent: false })
  },
  async bootstrap(opts) {
    const silent = !!(opts && opts.silent)
    const app = getApp()
    if (app && app.globalData && app.globalData.cloudReady === null) {
      if (!this._cloudWaitOnce) {
        this._cloudWaitOnce = true
        if (app.initCloud) app.initCloud()
        setTimeout(() => {
          this._cloudWaitOnce = false
          this.bootstrap({ silent })
        }, 1200)
      }
      return
    }
    if (app && app.globalData && app.globalData.cloudReady === false) {
      if (app.initCloud) app.initCloud()
      if (!silent) wx.showToast({ title: '云服务初始化失败，请检查网络', icon: 'none' })
      this.setData({
        loading: false,
        hasTeam: false,
        teamId: '',
        team: null,
        teamLogo: '',
        recentActivities: [],
        isAdmin: false,
        cloudError: app.globalData.cloudInitError || '云服务初始化失败，请检查网络',
      })
      return
    }
    if (!silent) this.setData({ loading: true })

    try {
      await wx.cloud.callFunction({ name: 'login', data: {} })
    } catch (e) {
      console.error('[home] login fail', e)
    }

    let hasProfile = true
    try {
      hasProfile = await ensureProfileCompleteAsync()
    } catch (e) {
      console.error(e)
    }

    let teamId = ''
    let team = null
    let recentActivities = []
    let isAdmin = false
    let teamLogo = ''
    let announcementText = ''

    try {
      const res = await wx.cloud.callFunction({ name: 'teamMyList', data: {} })
      const r = res && res.result
      const list = (r && r.ok && r.data && r.data.list) ? r.data.list : []
      if (list && list.length) teamId = list[0]._id
    } catch (e) {
      console.error('[home] teamMyList fail', e)
    }

    if (teamId) {
      wx.setStorageSync('teamId', teamId)
      try {
        const td = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId } })
        const tr = td && td.result
        if (tr && tr.ok && tr.data) {
          team = tr.data.team || null
          teamLogo = (team && team.logoUrl) || ''
          announcementText = (team && team.announcement) ? String(team.announcement) : ''
          const activities = tr.data.activities || []
          recentActivities = activities.slice(0, 3).map(a => ({
             ...a,
             typeText: typeText(a && a.type),
             startText: formatTs(a && a.startTime),
             deadlineText: formatTs(a && a.signupDeadline),
            ended: !!(a && a.startTime && Date.now() > a.startTime),
            statusText: (a && a.startTime && Date.now() > a.startTime) ? '已结束' : '报名中',
            joinCount: `${a && a.signupCount || 0}/${a && a.limit || 0}`,
           }))
          const my = tr.data.myMember
          isAdmin = !!(my && my.status === 'approved' && (my.role === 'owner' || my.role === 'admin'))
          if (!isAdmin) {
            try {
              isAdmin = await ensureAdminForTeam(teamId)
            } catch (e) {
              console.warn('[home] ensureAdminForTeam fail', e)
            }
          }
        }
      } catch (e) {
        console.error('[home] teamDetail fail', e)
      }
    }

    if (team && team.logoFileId && !teamLogo) {
      teamLogo = team.logoFileId
      try {
        const isCloudFileId = teamLogo.indexOf('cloud://') === 0 || teamLogo.indexOf('cloud:') === 0 || teamLogo.indexOf('cloudbase-') === 0
        if (isCloudFileId) {
          const temp = await wx.cloud.getTempFileURL({ fileList: [teamLogo] })
          const it = temp && temp.fileList && temp.fileList[0]
          teamLogo = (it && it.tempFileURL) ? it.tempFileURL : ''
        }
      } catch (e) {
        console.warn('[home] getTempFileURL fail', e)
        teamLogo = ''
      }
    }

    this.setData({
      loading: false,
      hasProfile,
      hasTeam: !!teamId,
      teamId,
      team,
      teamLogo,
      recentActivities,
      isAdmin,
      cloudError: '',
      announcementText,
    })

    if (app && app.globalData && app.globalData.pageCache) {
      app.globalData.pageCache.home = {
        ts: Date.now(),
        data: {
          hasProfile,
          hasTeam: !!teamId,
          teamId,
          team,
          teamLogo,
          recentActivities,
          isAdmin,
          announcementText,
          currentTab: 'home',
        },
      }
    }
  },
  goJoin() {
    wx.navigateTo({ url: '/pages/join-team/join-team-search' })
  },
  goCreate() {
    wx.navigateTo({ url: '/pages/team-create/team-create' })
  },
  goTeamDetail() {
    if (!this.data.teamId) return wx.showToast({ title: '请先加入战队', icon: 'none' })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },
  goMembers() {
    if (!this.data.teamId) return wx.showToast({ title: '请先加入战队', icon: 'none' })
    wx.navigateTo({ url: `/pages/member-list/member-list?teamId=${this.data.teamId}` })
  },
  goActivityList() {
    if (!this.data.teamId) return wx.showToast({ title: '请先加入战队', icon: 'none' })
    wx.navigateTo({ url: `/pages/activity-list/activity-list?teamId=${this.data.teamId}` })
  },
  async goServerPanel() {
    if (!this.data.teamId) return wx.showToast({ title: '请先加入战队', icon: 'none' })
    if (!this.data.isAdmin) return wx.showToast({ title: '需要管理员权限', icon: 'none' })
    try {
      const res = await api.list({ teamId: this.data.teamId })
      if (res && res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
        const s = res.data.items[0]
        wx.navigateTo({ url: `/pages/admin-servers/console/console?serverId=${s._id}` })
      } else {
        wx.navigateTo({ url: `/pages/admin-servers/edit/edit?teamId=${this.data.teamId}` })
      }
    } catch (e) {
      console.error('[home] goServerPanel fail', e)
      wx.navigateTo({ url: `/pages/admin-servers/list/list?teamId=${this.data.teamId}` })
    }
  },
  goMyProfile() {
    const tid = this.data.teamId
    const qs = tid ? `?teamId=${tid}` : ''
    wx.navigateTo({ url: `/pages/my-center/my-center${qs}` })
  },
})
