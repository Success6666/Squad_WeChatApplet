const { ensureAdminForTeam } = require('../../utils/guard')
const api = require('../../utils/server-api')

const MEMBER_CACHE_TTL_MS = 0

Page({
  data: {
    teamId: '',
    loading: false,
    team: null,
    members: [],
    myMember: null,
    isAdmin: false,
    isOwner: false,
    actingId: '',
    nowTs: 0,
    currentTab: 'members',
  },
  onLoad(q) {
    const teamId = (q && q.teamId) ? String(q.teamId) : ''
    this.setData({ teamId })
  },
  onShow() {
    const app = getApp()
    const key = 'memberList:' + this.data.teamId
    const cache = app && app.globalData && app.globalData.pageCache && app.globalData.pageCache[key]
    if (cache && cache.ts) {
      this.setData({ ...cache.data, loading: false })
      this.load({ silent: true })
      return
    }
    if (this.data.teamId) this.load({ silent: false })
  },
  async load(opts) {
    const silent = !!(opts && opts.silent)
    if (!silent) this.setData({ loading: true, nowTs: Date.now() })
    try {
      const res = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId } })
      const r = res && res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      const { team, members, myMember } = r.data
      let isApproved = myMember && myMember.status === 'approved'
      let isOwner = isApproved && myMember.role === 'owner'
      let isAdmin = isApproved && (myMember.role === 'owner' || myMember.role === 'admin')

      if (!isAdmin) {
        try {
          const ok = await ensureAdminForTeam(this.data.teamId)
          if (ok) isAdmin = true
        } catch (e) {
          console.warn('[member-list] ensureAdminForTeam fail', e)
        }
      }

      this.setData({ team: team || null, members: members || [], myMember: myMember || null, isAdmin, isOwner })

      const app = getApp()
      if (app && app.globalData && app.globalData.pageCache) {
        const key = 'memberList:' + this.data.teamId
        app.globalData.pageCache[key] = {
          ts: Date.now(),
          data: {
            team: team || null,
            members: members || [],
            myMember: myMember || null,
            isAdmin,
            isOwner,
            currentTab: 'members',
            teamId: this.data.teamId,
          },
        }
      }
    } catch (e) {
      console.error(e)
      if (!silent) wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      if (!silent) this.setData({ team: null })
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },
  async toggleAdmin(e) {
    const memberId = e.currentTarget.dataset.id
    const makeAdmin = !!e.currentTarget.dataset.makeadmin
    if (!memberId) return
    this.setData({ actingId: memberId })
    try {
      const res = await wx.cloud.callFunction({
        name: 'memberAdminSet',
        data: { teamId: this.data.teamId, memberId, makeAdmin },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '设置失败')
      wx.showToast({ title: '已更新' })
      this.load()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: err.message || '设置失败', icon: 'none' })
    } finally {
      this.setData({ actingId: '' })
    }
  },
  async banMenu(e) {
    const memberId = e.currentTarget.dataset.id
    if (!memberId) return

    wx.showActionSheet({
      itemList: ['临时禁赛 24 小时', '永久禁赛', '解除禁赛'],
      success: async r => {
        const idx = r.tapIndex
        let mode = 'clear'
        let until = 0
        if (idx === 0) {
          mode = 'temp'
          until = Date.now() + 24 * 60 * 60 * 1000
        } else if (idx === 1) {
          mode = 'forever'
        } else {
          mode = 'clear'
        }

        const reason = await new Promise(resolve => {
          if (mode === 'clear') return resolve('')
          wx.showModal({
            title: '禁赛原因（可选）',
            editable: true,
            placeholderText: '例如：多次爽约/违规行为',
            confirmText: '确定',
            cancelText: '跳过',
            success: m => resolve((m && m.content) || ''),
            fail: () => resolve(''),
          })
        })

        this.setData({ actingId: memberId })
        try {
          const res = await wx.cloud.callFunction({
            name: 'memberBanSet',
            data: { teamId: this.data.teamId, memberId, mode, until, reason },
          })
          const rr = res.result
          if (!rr || !rr.ok) throw new Error((rr && rr.message) || '操作失败')
          wx.showToast({ title: mode === 'clear' ? '已解除' : '已设置' })
          this.load()
        } catch (err) {
          console.error(err)
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        } finally {
          this.setData({ actingId: '' })
        }
      },
    })
  },
  async kick(e) {
    const memberId = e.currentTarget.dataset.id
    if (!memberId) return
    const ok = await new Promise(resolve => {
      wx.showModal({
        title: '确认踢出',
        content: '被踢出后需要重新申请加入',
        confirmText: '踢出',
        cancelText: '取消',
        success: r => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!ok) return

    this.setData({ actingId: memberId })
    try {
      const res = await wx.cloud.callFunction({
        name: 'memberKick',
        data: { teamId: this.data.teamId, memberId },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '踢出失败')
      wx.showToast({ title: '已踢出' })
      this.load()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: err.message || '踢出失败', icon: 'none' })
    } finally {
      this.setData({ actingId: '' })
    }
  },
  showMemberMenu(e) {
    const { id, role } = e.currentTarget.dataset
    if (!id) return

    const isTargetOwner = role === 'owner'
    const isTargetAdmin = role === 'admin'

    if (!this.data.isOwner && (isTargetOwner || isTargetAdmin)) return

    const itemList = []
    const actions = []

    if (this.data.isOwner) {
      if (isTargetAdmin) {
        itemList.push('降职为成员')
        actions.push('demote')
      } else {
        itemList.push('升为管理员')
        actions.push('promote')
      }
    }

    itemList.push('禁赛管理')
    actions.push('ban')

    itemList.push('踢出战队')
    actions.push('kick')

    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const action = actions[res.tapIndex]

        if (action === 'promote' || action === 'demote') {
          this.toggleAdmin({ currentTarget: { dataset: { id, makeadmin: action === 'promote' } } })
        } else if (action === 'ban') {
          this.banMenu({ currentTarget: { dataset: { id } } })
        } else if (action === 'kick') {
          this.kick({ currentTarget: { dataset: { id } } })
        }
      }
    })
  },
  goHome() {
    wx.redirectTo({ url: '/pages/home/home' })
  },
  goMembers() {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },
  goActivityList() {
    wx.redirectTo({ url: `/pages/activity-list/activity-list?teamId=${this.data.teamId}` })
  },
  goMy() {
    const qs = this.data.teamId ? `?teamId=${this.data.teamId}` : ''
    wx.redirectTo({ url: `/pages/my-center/my-center${qs}` })
  },
  async goServerPanel() {
    if (!this.data.teamId) return wx.showToast({ title: '请先加入战队', icon: 'none' })
    if (!this.data.isAdmin) return wx.showToast({ title: '需要管理员权限', icon: 'none' })
    try {
      const res = await api.list({ teamId: this.data.teamId })
      if (res && res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
        const s = res.data.items[0]
        wx.redirectTo({ url: `/pages/admin-servers/console/console?serverId=${s._id}` })
      } else {
        wx.redirectTo({ url: `/pages/admin-servers/edit/edit?teamId=${this.data.teamId}` })
      }
    } catch (e) {
      console.error('[member-list] goServerPanel fail', e)
      wx.redirectTo({ url: `/pages/admin-servers/list/list?teamId=${this.data.teamId}` })
    }
  },
})
