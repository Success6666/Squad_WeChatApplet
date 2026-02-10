const { ensureProfileForAction, ensureAdminForTeam } = require('../../utils/guard')

Page({
  data: {
    teamId: '',
    loading: false,
    team: null,
    members: [],
    activities: [],
    myMember: null,
    isAdmin: false,
    isOwner: false,
    actingId: '',
    nowTs: 0,
    focusSection: '',
  },
  onLoad(q) {
    const teamId = q.teamId
    const focusSection = q && q.focus ? String(q.focus) : ''
    this.setData({ teamId, focusSection })
  },
  onShow() {
    if (this.data.teamId) this.load()
  },
  async load() {
    this.setData({ loading: true, nowTs: Date.now() })
    try {
      const res = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId } })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      const { team, members, activities, myMember } = r.data
      let isApproved = myMember && myMember.status === 'approved'
      let isOwner = isApproved && myMember.role === 'owner'
      let isAdmin = isApproved && (myMember.role === 'owner' || myMember.role === 'admin')

      // 如果不是队内管理员，但可能是全局管理员（例如服务器管理权限），则做一次 guard 检查回退
      if (!isAdmin) {
        try {
          const ok = await ensureAdminForTeam(this.data.teamId)
          console.log('[team-detail] ensureAdminForTeam fallback result', ok)
          if (ok) isAdmin = true
        } catch (e) {
          console.warn('[team-detail] ensureAdminForTeam fail', e)
        }
      }

      this.setData({ team, members: members || [], activities: activities || [], myMember: myMember || null, isAdmin, isOwner })
      if (this.data.focusSection === 'members') {
        this.data.focusSection = ''
        setTimeout(() => {
          wx.pageScrollTo({ selector: '#member-list', duration: 0 })
        }, 80)
      }
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      this.setData({ team: null })
    } finally {
      this.setData({ loading: false })
    }
  },
  async goJoin() {
    // 只在申请加入时做资料校验；未完善则跳转完善资料并回跳到本详情页
    const returnUrl = `/pages/team-detail/team-detail?teamId=${this.data.teamId}`
    const okProfile = await ensureProfileForAction({ returnUrl })
    if (!okProfile) return

    wx.navigateTo({ url: `/pages/join-team/join-team?teamId=${this.data.teamId}` })
  },
  goReview() {
    wx.navigateTo({ url: `/pages/admin-review/admin-review?teamId=${this.data.teamId}` })
  },
  goActivities() {
    wx.navigateTo({ url: `/pages/activity-list/activity-list?teamId=${this.data.teamId}` })
  },
  goCreateActivity() {
    wx.navigateTo({ url: `/pages/activity-create/activity-create?teamId=${this.data.teamId}` })
  },
  goActivityDetail(e) {
    const activityId = e.detail.activityId
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?teamId=${this.data.teamId}&activityId=${activityId}` })
  },
  goMyProfile() {
    wx.navigateTo({ url: `/pages/my-profile/my-profile?teamId=${this.data.teamId}` })
  },
  // 服务器控制面板入口（仅管理员可见）
  async goServerPanel() {
    // If there is a server bound to this team, jump straight to its console; otherwise force bind/create
    try {
      const api = require('../../utils/server-api')
      const res = await api.list({ teamId: this.data.teamId })
      if (res && res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
        const s = res.data.items[0]
        wx.navigateTo({ url: `/pages/admin-servers/console/console?serverId=${s._id}` })
      } else {
        // No server bound, force go to bind/create
        wx.navigateTo({ url: `/pages/admin-servers/edit/edit?teamId=${this.data.teamId}` })
      }
    } catch (e) {
      console.error('[goServerPanel] fail', e)
      // fallback: go to admin servers list
      wx.navigateTo({ url: `/pages/admin-servers/list/list?teamId=${this.data.teamId}` })
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
    const { id, role, nick } = e.currentTarget.dataset
    if (!id) return

    const isTargetOwner = role === 'owner'
    const isTargetAdmin = role === 'admin'

    // 权限检查：如果是管理员，不能操作队长和管理员
    if (!this.data.isOwner && (isTargetOwner || isTargetAdmin)) return

    const itemList = []
    const actions = []

    // 1. 升降职 (仅队长可操作)
    if (this.data.isOwner) {
      if (isTargetAdmin) {
        itemList.push('降职为成员')
        actions.push('demote')
      } else {
        itemList.push('升为管理员')
        actions.push('promote')
      }
    }

    // 2. 禁赛
    itemList.push('禁赛管理')
    actions.push('ban')

    // 3. 踢出
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
  manageTeam() {
    if (!this.data.teamId || !this.data.team) return

    const items = ['编辑战队资料']
    // 确保 isOwner 是布尔值且为真 (再次确认 load 中已正确设置 isOwner)
    if (this.data.isOwner === true) {
        items.push('解散战队')
    }

    wx.showActionSheet({
      itemList: items,
      success: async r => {
        const tap = r.tapIndex
        const choice = items[tap]

        if (choice === '编辑战队资料') {
          // 复用创建页做编辑（假设 team-create 支持 teamId 编辑；如果暂不支持，我下一步会补齐）
          wx.navigateTo({ url: `/pages/team-create/team-create?teamId=${this.data.teamId}` })
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
            const rr = res.result
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
})
