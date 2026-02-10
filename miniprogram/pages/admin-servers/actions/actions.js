const db = wx.cloud.database()
const api = require('../../../utils/server-api')

Page({
  data: {
    serverId: null,
    actions: [],
    q: '',
    detailModalVisible: false,
    detailData: null,
    manageModalVisible: false,
    manageModalAction: '',
    manageModalData: null,
    manageDuration: '1d',
    manageReason: ''
  },

  onLoad(options) {
    this.serverId = options && options.serverId
    this.setData({ serverId: this.serverId })
    this.load()
  },

  async load() {
    if (!this.serverId) return
    wx.showLoading({ title: '加载中' })
    try {
      const res = await db.collection('admin_actions').where({ serverId: this.serverId }).orderBy('timestamp', 'desc').limit(100).get()
      const actions = res.data || []
      const openIds = Array.from(new Set(actions.map(a => a.operatorOpenId).filter(Boolean)))
      const nameMap = {}
      if (openIds.length) {
        try {
          const membersRes = await db.collection('members').where({ openId: db.command.in(openIds) }).get()
          const members = membersRes.data || []
          for (const m of members) {
            nameMap[m.openId] = m.nick || m.name || m.displayName || m.steamNick || m.openId
          }
        } catch (e) {}
      }
      for (const a of actions) {
        // 优先使用 admin_actions 中存储的 operatorName/operatorSteam64/operatorTeamName
        let op = a.operatorName || a.operatorNick || a.operator || ''
        if (!op && a.operatorOpenId && nameMap[a.operatorOpenId]) op = nameMap[a.operatorOpenId]
        if (!op) op = a.operatorOpenId || '未知'
        a.displayOperator = op

        // 如果有 operatorTeamName，附加显示（用于审计快速查阅）
        a.displayOperatorTeam = a.operatorTeamName || ''

        // 时间格式化
        let tsCandidate = null
        const candidates = [a.timestamp, a.ts, a.time, a.createdAt, a._createTime, a._createdAt, a.createTime, a._ts]
        for (const c of candidates) {
          const m = this.extractTimestampMs(c)
          if (m) { tsCandidate = m; break }
        }
        if (!tsCandidate) {
          const scanned = this.extractTimestampMs(a)
          if (scanned) tsCandidate = scanned
        }
        if (tsCandidate) {
          try {
            const dt = new Date(Number(tsCandidate))
            const utc = dt.getTime() + (dt.getTimezoneOffset() * 60000)
            const bj = new Date(utc + 8 * 3600000)
            a.timeStr = bj.toLocaleString()
          } catch (e) {
            a.timeStr = new Date(tsCandidate).toLocaleString()
          }
        } else {
          a.timeStr = '-'
        }

        // target steam extraction: prefer stored operatorSteam64 or explicit targetSteam in doc
        a.targetSteam = a.operatorSteam64 || a.targetSteam || a.target || ''

        // 管理权限判断
        const act = (a.action || '').toLowerCase()
        a.isBan = /ban|封禁|banned|封/.test(act)
        a.canManage = /ban|封禁|banned|封|kick|踢出/.test(act)

        // ★ 核心修复：Steam64提取逻辑全面升级（增加更多潜在来源）
        const possibleFields = [
          a.target, a.targetSteam, a.steamId, a.steam64, a.steam, a.steam_id,
          a.command, a._raw, a.rawOutput, a.raw, a.message, a.output, a.log, a.description,
          a.result, a.resultMsg, a.data, a.playerId, a.userId
        ]
        let steamMatch = null
        const steamRegexStrict = /(\d{17,20})/g
        const steamRegexLoose = /(\d{8,20})/g
        for (const field of possibleFields) {
          if (field !== undefined && field !== null) {
            const s = (typeof field === 'string') ? field : JSON.stringify(field)
            let match = s.match(steamRegexStrict)
            if (!match) match = s.match(steamRegexLoose)
            if (match && match.length > 0) { steamMatch = match[0]; break }
          }
        }
        // additional targeted patterns: look for 'steam: 765611...' or 'SteamID: 7656...'
        if (!steamMatch) {
          for (const field of possibleFields) {
            if (field !== undefined && field !== null) {
              const s = (typeof field === 'string') ? field : JSON.stringify(field)
              const steamColon = s.match(/steam\s*[:=]\s*(\d{6,20})/i)
              if (steamColon && steamColon[1]) { steamMatch = steamColon[1]; break }
              const steamLabel = s.match(/steam(?:id)?\s*(\d{6,20})/i)
              if (steamLabel && steamLabel[1]) { steamMatch = steamLabel[1]; break }
            }
          }
        }
        a.targetSteam = steamMatch || ''

        // 提取 reason 和 duration：优先使用已有字段，其次从命令解析
        // 常见字段集合
        const reasonFields = [a.reason, a.banReason, a.reasonText, a.msg, a.message, a.resultMsg, a.note, a.description]
        let reasonVal = null
        for (const rf of reasonFields) { if (rf) { reasonVal = String(rf); break } }
        // duration 常见字段
        const durationFields = [a.duration, a.banDuration, a.length, a.timeLength, a.banTime, a.expire]
        let durationVal = null
        for (const df of durationFields) { if (df) { durationVal = String(df); break } }
        // 从命令中解析： AdminBan <player> <duration> <reason...>
        if (!reasonVal && a.command) {
          try {
            const cmd = String(a.command)
            const banMatch = cmd.match(/AdminBan\s+\S+\s+(\S+)\s+([\s\S]+)/i)
            if (banMatch) {
              durationVal = durationVal || banMatch[1]
              reasonVal = reasonVal || banMatch[2]
            } else {
              // AdminKick <player> <reason...>
              const kickMatch = cmd.match(/AdminKick(?:ById)?\s+\S+\s+([\s\S]+)/i)
              if (kickMatch) reasonVal = reasonVal || kickMatch[1]
            }
          } catch (e) {}
        }
        // 兜底：从原始字段 _raw 中尝试提取 AdminBan/AdminKick 信息
        if ((!reasonVal || !durationVal) && a._raw) {
          try {
            const raw = String(a._raw)
            const banMatch2 = raw.match(/AdminBan\s+\S+\s+(\S+)\s+([\s\S]+)/i)
            if (banMatch2) {
              durationVal = durationVal || banMatch2[1]
              reasonVal = reasonVal || banMatch2[2]
            } else {
              const kickMatch2 = raw.match(/AdminKick(?:ById)?\s+\S+\s+([\s\S]+)/i)
              if (kickMatch2) reasonVal = reasonVal || kickMatch2[1]
            }
          } catch (e) {}
        }

        a.reason = reasonVal || ''
        a.duration = durationVal || ''

        // 只有当操作是 ban 或 kick 并且存在 reason 才显示理由；封禁额外显示时长（如果有）
        // show reason line for bans or kicks (display '-' if missing)
        a.showReason = /ban|封禁|banned|封|kick|踢出/.test(act)
        // 封禁标志已通过 a.isBan；确保封禁时如果没有持续时长也尝试显示 '-'
        if (a.isBan) {
          a.duration = a.duration || ''
        }

        a.showTime = true
      }
      this.setData({ actions })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
      console.error('加载审计日志失败:', e)
    }
    wx.hideLoading()
  },

  refresh() { this.load() },

  onSearchInput(e) {
    const q = (e && e.detail && e.detail.value || '').trim()
    this.setData({ q })
    if (!q) return this.load()
    const all = this.data.actions || []
    const filtered = all.filter(a =>
        (a.action||'').toLowerCase().includes(q.toLowerCase()) ||
        (a.targetSteam||'').toLowerCase().includes(q.toLowerCase()) ||
        (a.displayOperator||'').toLowerCase().includes(q.toLowerCase())
    )
    this.setData({ actions: filtered })
  },

  onSearch(e) {
    const q = (this.data.q || '').trim()
    if (!q) return this.load()
    const all = this.data.actions || []
    const filtered = all.filter(a =>
        (a.action||'').toLowerCase().includes(q.toLowerCase()) ||
        (a.targetSteam||'').toLowerCase().includes(q.toLowerCase()) ||
        (a.displayOperator||'').toLowerCase().includes(q.toLowerCase())
    )
    this.setData({ actions: filtered })
  },

  // ★ 终极修复：查看详情按钮点击事件（使用单一微信弹窗，所有项换行显示）
  openDetail(e) {
    console.log('openDetail事件触发:', e)
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || (e && e.target && e.target.dataset) || {}
    let idx = ds.index ?? ds.idx ?? ds.i
    const id = ds.id ?? ds._id
    const actions = this.data.actions || []

    // normalize idx
    if (idx === undefined || idx === null) {
      if (id) {
        const a = actions.find(item => (item._id == id || item.id == id))
        if (a) {
          this._showDetailModal(a)
          return
        }
      }
      wx.showToast({ title: '获取详情失败', icon: 'none' })
      console.error('openDetail: no index or id in dataset', ds)
      return
    }

    idx = Number(idx)
    let a = null
    if (!isNaN(idx) && idx >= 0 && idx < actions.length) a = actions[idx]
    if (!a && id) a = actions.find(item => (item._id == id || item.id == id))
    if (!a) { wx.showToast({ title: '获取详情失败', icon: 'none' }); console.error('无法获取详情数据:', { ds, actionsLength: actions.length }); return }

    // show single native modal with nicely formatted lines
    this._showDetailModal(a)
  },

  // helper: build and show single wx.showModal content, each item on its own line
  _showDetailModal(a) {
    try {
      const timeLine = `时间: ${a.timeStr || '-'}`
      const targetLine = `目标(64位): ${a.targetSteam || a.target64 || a.target || '-'}`
      const opLine = `操作: ${a.action || '-'}    操作者: ${a.displayOperator || a.operatorOpenId || '-'}`
      let extra = ''
      if (a.isBan) {
        extra += `\n封禁时长: ${a.duration || '-'}\n原因: ${a.reason || '-'} `
      } else if (/kick|踢出/.test((a.action||'').toLowerCase())) {
        extra += `\n原因: ${a.reason || '-'} `
      }
      const cmdLine = `\n命令: ${a.command || a.rawCommand || '-'} `
      const content = [timeLine, targetLine, opLine].join('\n') + extra + cmdLine
      wx.showModal({ title: '审计记录详情', content, showCancel: false })
    } catch (e) {
      console.error('showDetailModal failed', e)
      wx.showToast({ title: '显示详情失败', icon: 'none' })
    }
  },

  closeDetail() {
    this.setData({ detailModalVisible: false, detailData: null })
  },

  openAuditManage(e) {
    const { index, id } = e.currentTarget.dataset
    let idx = Number(index)
    const actions = this.data.actions || []
    let item = null

    // 同样使用双保险获取数据
    if (!isNaN(idx) && idx >= 0 && idx < actions.length) {
      item = actions[idx]
    } else if (id) {
      item = actions.find(i => i._id === id)
    }

    if (!item) {
      wx.showToast({ title: '获取记录失败', icon: 'none' })
      return
    }

    const ops = []
    const isBan = /ban|封禁|banned|封/.test((item.action||'').toLowerCase())
    const isKick = /kick|踢出/.test((item.action||'').toLowerCase())
    if (isBan) ops.push('解封')
    if (isKick) ops.push('追封')
    if (ops.length === 0) { wx.showToast({ title: '不可管理的记录', icon: 'none' }); return }

    wx.showActionSheet({ itemList: ops, success: (res) => {
        const sel = ops[res.tapIndex]
        const player = item.targetSteam || item.target || (item.command && item.command.split(/\s+/)[1]) || ''
        if (!player) { wx.showToast({ title: '未找到目标玩家', icon: 'none' }); return }

        if (sel === '解封') {
          wx.showModal({ title: '确认', content: `确认为 ${player} 解封？`, success: async (mres) => {
              if (!mres.confirm) return
              const cmd = `AdminUnban ${player}`
              wx.showLoading({ title: '发送中...' })
              try {
                const r = await api.command(this.data.serverId, cmd)
                wx.hideLoading()
                if (r && r.ok) {
                  wx.showToast({ title: '已解封', icon: 'success' })
                  this.load()
                } else wx.showToast({ title: '操作失败', icon: 'none' })
              } catch (e) {
                wx.hideLoading()
                wx.showToast({ title: '发送失败', icon: 'none' })
              }
            } })
        } else if (sel === '追封') {
          this.setData({ manageModalVisible: true, manageModalAction: '追封', manageModalData: { player }, manageDuration: '1d', manageReason: '' })
        }
      } })
  },

  onManageDurationInput(e) { this.setData({ manageDuration: e && e.detail && e.detail.value }) },
  onManageReasonInput(e) { this.setData({ manageReason: e && e.detail && e.detail.value }) },
  cancelManageModal() { this.setData({ manageModalVisible: false, manageModalAction: '', manageModalData: null, manageDuration: '1d', manageReason: '' }) },

  async confirmManageModal() {
    const data = this.data.manageModalData || {}
    const player = data.player
    if (!player) { wx.showToast({ title: '目标缺失', icon: 'none' }); return }
    const duration = (this.data.manageDuration || '1d').trim()
    const reason = (this.data.manageReason || '').trim()
    if (!reason) { wx.showToast({ title: '请输入理由', icon: 'none' }); return }
    const cmd = `AdminBan ${player} ${duration} ${reason}`
    wx.showLoading({ title: '发送中...' })
    try {
      const r = await api.command(this.data.serverId, cmd)
      wx.hideLoading()
      if (r && r.ok) {
        wx.showToast({ title: '已封禁', icon: 'success' })
        try { await db.collection('admin_actions').add({ data: { serverId: this.data.serverId, action: 'AdminBan', target: player, command: cmd, reason, duration, resultOk: true, timestamp: Date.now(), operatorOpenId: wx.getStorageSync('openId') || null } }) } catch (e) { console.error('[audit] write failed', e) }
        this.cancelManageModal()
        this.load()
      } else {
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  },

  extractTimestampMs(val) {
    if (!val && val !== 0) return null
    if (typeof val === 'number') {
      if (val < 1e12) return val * 1000
      return val
    }
    if (typeof val === 'string') {
      const n = Number(val)
      if (!isNaN(n)) {
        if (n < 1e12) return n * 1000
        return n
      }
    }
    if (typeof val === 'object') {
      if (val._seconds) return Number(val._seconds) * 1000
      if (val.seconds) return Number(val.seconds) * 1000
      if (typeof val.toDate === 'function') {
        try { return val.toDate().getTime() } catch (e) {}
      }
      for (const k of Object.keys(val)) {
        try {
          const maybe = this.extractTimestampMs(val[k])
          if (maybe) return maybe
        } catch (e) {}
      }
    }
    return null
  },
})