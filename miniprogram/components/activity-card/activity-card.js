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

Component({
  properties: {
    activity: { type: Object, value: {} },
    mode: {
      type: String,
      value: 'list' // 'list' | 'grid'
    }
  },
  data: {
    statusText: '',
    statusClass: 'badge',
    startTimeText: '-',
    typeText: '活动',
  },
  observers: {
    activity(a) {
      const now = Date.now()
      const ended = a && a.startTime ? now > a.startTime : false
      this.setData({
        statusText: ended ? '已结束' : '报名中',
        statusClass: ended ? 'badge badge--danger' : 'badge badge--ok',
        startTimeText: formatTs(a && a.startTime),
        typeText: typeText(a && a.type),
      })
    },
  },
  methods: {
    onTap() {
      const id = this.data.activity && this.data.activity._id
      if (!id) return
      this.triggerEvent('tapactivity', { activityId: id })
    },
    onSignup() {
      const id = this.data.activity && this.data.activity._id
      if (!id) return
      // 由父页面决定：是否已报名/是否过期/是否有权限
      this.triggerEvent('signup', { activityId: id })
    },
  }
})
