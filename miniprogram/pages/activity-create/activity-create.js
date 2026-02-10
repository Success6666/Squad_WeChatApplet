function parseDateTime(d, t) {
  if (!d || !t) return 0
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(d)
  const hm = /^([0-9]{2}):([0-9]{2})$/.exec(t)
  if (!m || !hm) return 0
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(hm[1])
  const minute = Number(hm[2])
  return new Date(year, month - 1, day, hour, minute, 0).getTime()
}

function fmtDate(ts) {
  const d = new Date(ts)
  const p = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fmtTime(ts) {
  const d = new Date(ts)
  const p = n => (n < 10 ? '0' + n : '' + n)
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

Page({
  data: {
    teamId: '',
    activityId: '',
    editing: false,
    typeOptions: [
      { value: 'internal', text: '内部训练' },
      { value: 'skrimmage', text: '训练赛' },
      { value: 'official', text: '正式比赛' },
    ],
    typeIndex: null, // no preset; user must choose (show placeholder)
    title: '',
    startDate: '',
    startTime: '',
    deadlineDate: '',
    deadlineTime: '',
    opponent: '',
    server: '',
    limit: '', // no default; user must fill
    desc: '',
    submitting: false,
    loading: false,
  },
  async onLoad(q) {
    const teamId = (q.teamId || '').trim()
    const activityId = (q.activityId || '').trim()
    this.setData({ teamId, activityId, editing: !!activityId })

    if (activityId) {
      await this.loadActivity()
    }
  },
  async loadActivity() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'activityDetail',
        data: { teamId: this.data.teamId, activityId: this.data.activityId },
      })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      const a = r.data.activity
      const foundIdx = this.data.typeOptions.findIndex(x => x.value === a.type)
      this.setData({
        typeIndex: foundIdx >= 0 ? foundIdx : null,
        title: a.title || '',
        startDate: a.startTime ? fmtDate(a.startTime) : '',
        startTime: a.startTime ? fmtTime(a.startTime) : '',
        deadlineDate: a.signupDeadline ? fmtDate(a.signupDeadline) : '',
        deadlineTime: a.signupDeadline ? fmtTime(a.signupDeadline) : '',
        opponent: a.opponent || '',
        server: a.server || '',
        limit: (typeof a.limit !== 'undefined' && a.limit !== null) ? String(a.limit) : '',
        desc: a.desc || '',
      })
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  onTitle(e) {
    this.setData({ title: e.detail.value })
  },
  onStartDate(e) {
    this.setData({ startDate: e.detail.value })
  },
  onStartTime(e) {
    this.setData({ startTime: e.detail.value })
  },
  onDeadlineDate(e) {
    this.setData({ deadlineDate: e.detail.value })
  },
  onDeadlineTime(e) {
    this.setData({ deadlineTime: e.detail.value })
  },
  onOpponent(e) {
    this.setData({ opponent: e.detail.value })
  },
  onServer(e) {
    this.setData({ server: e.detail.value })
  },
  onLimit(e) {
    this.setData({ limit: e.detail.value })
  },
  onDesc(e) {
    this.setData({ desc: e.detail.value })
  },
  onType(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },
  async submit() {
    if (this.data.submitting) return

    const title = (this.data.title || '').trim()
    if (!title) return wx.showToast({ title: '请填写标题', icon: 'none' })

    // ensure activity type selected
    if (this.data.typeIndex == null) return wx.showToast({ title: '请选择活动类型', icon: 'none' })

    const startTs = parseDateTime(this.data.startDate, this.data.startTime)
    const deadlineTs = parseDateTime(this.data.deadlineDate, this.data.deadlineTime)
    if (!startTs || !deadlineTs) return wx.showToast({ title: '请选择时间', icon: 'none' })

    if (deadlineTs >= startTs) {
      return wx.showToast({ title: '截止报名时间需早于活动开始时间', icon: 'none' })
    }

    if (startTs <= Date.now()) return wx.showToast({ title: '活动时间需晚于当前时间', icon: 'none' })

    const limit = Number(this.data.limit)
    if (!Number.isFinite(limit) || limit <= 0) return wx.showToast({ title: '人数限制不合法', icon: 'none' })

    this.setData({ submitting: true })
    try {
      const type = this.data.typeOptions[this.data.typeIndex].value
      const fnName = this.data.editing ? 'activityUpdate' : 'activityCreate'
      const payload = {
        teamId: this.data.teamId,
        title,
        type,
        startTime: startTs,
        signupDeadline: deadlineTs,
        opponent: (this.data.opponent || '').trim(),
        server: (this.data.server || '').trim(),
        limit,
        desc: (this.data.desc || '').trim(),
      }
      if (this.data.editing) payload.activityId = this.data.activityId

      const res = await wx.cloud.callFunction({ name: fnName, data: payload })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || (this.data.editing ? '更新失败' : '发布失败'))

      wx.showToast({ title: this.data.editing ? '已更新' : '已发布' })
      setTimeout(() => {
        const activityId = this.data.editing ? this.data.activityId : r.data.activityId
        wx.redirectTo({ url: `/pages/activity-detail/activity-detail?teamId=${this.data.teamId}&activityId=${activityId}` })
      }, 500)
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || (this.data.editing ? '更新失败' : '发布失败'), icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
