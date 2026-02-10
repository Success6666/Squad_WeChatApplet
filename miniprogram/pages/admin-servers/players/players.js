const api = require('../../../utils/server-api')

Page({
  data: {
    serverId: null,
    teamNames: ['', ''],
    activeTeam: 1,
    rawPlayers: [], // flat player list
    rawSquads: [], // raw squads list
    groupedSquads: [], // squads for current team
    // ----------------- 管理模态相关 状态与方法 -----------------
    // manageModalVisible: whether the modal is visible
    // manageModalAction: action selected ('kick','ban','warn','force','demote')
    // manageTarget: { gIndex, pIndex }
    // manageReason, manageDuration
    // Note: commands are sent via api.command(serverId, cmd)
    manageModalVisible: false,
    manageModalAction: '',
    manageTarget: null,
    manageReason: '',
    manageDuration: '0'
  },

  onLoad(options) {
    this.serverId = options && options.serverId
    if (!this.serverId) {
      wx.showToast({ title: '缺少 serverId', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.loadData()
  },

  async loadData() {
    // call ListPlayers and ListSquads via serverCommand cloud function
    try {
      const pRes = await api.command(this.serverId, 'ListPlayers')
      const sRes = await api.command(this.serverId, 'ListSquads')

      // support both old and new response shapes:
      // old: { ok, output: '...' }
      // new: { ok, data: { rawOutput: '...' } }
      const playersRaw = (pRes && pRes.output) ? String(pRes.output) : ((pRes && pRes.data && pRes.data.rawOutput) ? String(pRes.data.rawOutput) : '')
      const squadsRaw = (sRes && sRes.output) ? String(sRes.output) : ((sRes && sRes.data && sRes.data.rawOutput) ? String(sRes.data.rawOutput) : '')

      // parse simple outputs - assume server returns lines like: "PlayerId Name Team SquadId"
      const players = this.parsePlayersOutput(playersRaw)
      const squads = this.parseSquadsOutput(squadsRaw)

      // determine team names from server status if possible
      const st = (await api.status(this.serverId))
      if (st && st.ok && st.data && st.data.status) {
        const status = st.data.status
        this.setData({ teamNames: [status.faction1 || '阵营1', status.faction2 || '阵营2'] })
      }

      this.setData({ rawPlayers: players, rawSquads: squads })
      this.applyGrouping()
    } catch (e) {
      wx.showToast({ title: '获取玩家列表失败', icon: 'none' })
    }
  },

  parsePlayersOutput(text) {
    if (!text) return []
    // attempt to parse verbose lines like: "ID: 55 | ... | Name: NAME | Team ID: 2 | Squad ID: 1 | Is Leader: False | Role: RGF_Rifleman_01 | Online IDs: ... steam: 7656..."
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const out = []
    for (const ln of lines) {
      // try structured parse first
      if (/ID[:]/i.test(ln) && /Name[:]/i.test(ln)) {
        const nameMatch = ln.match(/Name:\s*([^|]+)/i)
        const teamMatch = ln.match(/Team\s*ID[:]?[\s|]*?(\d+)/i)
        const squadMatch = ln.match(/Squad\s*ID[:]?[\s|]*?(\d+)/i)
        const leaderMatch = ln.match(/Is\s*Leader[:]?[\s|]*?(True|False)/i)
        const roleMatch = ln.match(/Role[:]?[\s|]*?([^|]+)/i)
        const steamMatch = ln.match(/steam[:]?[\s|]*(\d{6,})/i)
        const name = nameMatch ? nameMatch[1].trim() : ln
        const team = teamMatch ? Number(teamMatch[1]) : 0
        const squad = squadMatch ? Number(squadMatch[1]) : 0
        const isLeader = leaderMatch ? (/true/i).test(leaderMatch[1]) : false
        const role = roleMatch ? roleMatch[1].trim() : ''
        const steam = steamMatch ? steamMatch[1].trim() : ''
        // detect commander: role or line contains commander
        const isCommander = /commander/i.test(role || '') || /commander/i.test(ln)
        out.push({ name, team, squad, isLeader, isCommander, role, steam })
        continue
      }

      // fallback: existing simple regex
      const m = ln.match(/^(?:\S+\s+)?(.+?)\s+Team[:=]?\s*(\d+)\s+Squad[:=]?\s*(\d+)/i)
      if (m) {
        out.push({ name: m[1].trim(), team: Number(m[2]), squad: Number(m[3]), isLeader: false, isCommander: false, role: '', steam: '' })
        continue
      }

      // fallback: try parts
      const parts = ln.split(/\s+/)
      if (parts.length >= 3) {
        const squad = parseInt(parts[parts.length-1]) || 0
        const team = parseInt(parts[parts.length-2]) || 0
        const name = parts.slice(0, parts[parts.length-2]).join(' ')
        out.push({ name, team, squad, isLeader: false, isCommander: false, role: '', steam: '' })
      } else {
        out.push({ name: ln, team: 0, squad: 0, isLeader: false, isCommander: false, role: '', steam: '' })
      }
    }
    return out
  },

  parseSquadsOutput(text) {
    if (!text) return []
    // parse Team sections and subsequent squad lines
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const out = []
    let currentTeam = null
    for (const ln of lines) {
      const teamHeader = ln.match(/^Team\s+ID[:]?\s*(\d+)/i)
      if (teamHeader) {
        currentTeam = Number(teamHeader[1])
        continue
      }
      const m = ln.match(/^ID[:]\s*(\d+)\s*\|\s*Name[:]\s*([^|]+)/i)
      if (m) {
        const id = Number(m[1])
        let name = m[2] ? m[2].trim() : ''
        // normalize known special names
        try {
          const nl = name.toLowerCase()
          if (/command\s*squad/i.test(name) || nl === 'command squad') {
            name = '指挥小队'
          }
        } catch (e) {}
        // try to find creator name and creator steam in the same line
        const creatorMatch = ln.match(/Creator\s+Name[:]?[\s|]*([^|]+)/i)
        const creatorOnlineMatch = ln.match(/Creator\s+Online\s+IDs[:]?[\s|]*[^|]*steam[:]?[\s|]*(\d{6,})/i)
        const creator = creatorMatch ? creatorMatch[1].trim() : ''
        const creatorSteam = creatorOnlineMatch ? creatorOnlineMatch[1].trim() : ''
        out.push({ id, name, creator, creatorSteam, players: [], team: currentTeam })
        continue
      }
      // catch lines like 'Team ID: 1 (11th Army Corps)' already handled, but also lines describing team names
      // also handle alternate format
      const m2 = ln.match(/Squad\s*(\d+)[:\-]?\s*(.*)/i)
      if (m2) {
        const id = Number(m2[1])
        const players = m2[2] ? m2[2].split(/[,，]/).map(p => p.trim()).filter(Boolean) : []
        out.push({ id, name: '', creator: '', creatorSteam: '', players, team: currentTeam })
      }
    }
    return out
  },

  applyGrouping() {
    const team = this.data.activeTeam
    // build groups as objects: { id, name, members, isUnassigned, creator }
    const groups = []
    const players = this.data.rawPlayers || []
    const squads = this.data.rawSquads || []

    if (squads && squads.length > 0) {
      // map squads by id but only those that match the team (if team present)
      const squadMap = new Map()
      for (const s of squads) {
        const id = s.id || 0
        // if squad has team defined and doesn't match current team, skip storing it
        if (s.team != null && s.team !== undefined && s.team !== team) continue
        squadMap.set(Number(id), s)
      }

      // gather members for listed squads (players already filtered by team below)
      const listed = new Set()
      const playersBySquad = {}
      for (const p of players) {
        if (p.team !== team) continue
        const id = Number(p.squad || 0)
        if (id > 0) {
          if (!playersBySquad[id]) playersBySquad[id] = []
          playersBySquad[id].push(p)
        }
      }

      const sortedSquadIds = Array.from(squadMap.keys()).map(Number).sort((a,b)=>a-b)
      for (const id of sortedSquadIds) {
        listed.add(id)
        const s = squadMap.get(id) || { id, name: '' }
        let members = playersBySquad[id] || []
        // ensure leader (isLeader or matches creator) is first
        if (members.length) {
          let leaderIndex = members.findIndex(m => m.isLeader)
          if (leaderIndex === -1) {
            if (s.creatorSteam) {
              const idx = members.findIndex(m => m.steam === s.creatorSteam)
              if (idx !== -1) leaderIndex = idx
            }
            if (leaderIndex === -1 && s.creator) {
              const idx2 = members.findIndex(m => m.name && s.creator && m.name.includes(s.creator))
              if (idx2 !== -1) leaderIndex = idx2
            }
          }
          if (leaderIndex > 0) {
            const leader = members.splice(leaderIndex,1)[0]
            members.unshift(leader)
          }
        }
        if (members.length) groups.push({ id, name: s.name || '', creator: s.creator || '', creatorSteam: s.creatorSteam || '', members, isUnassigned: false })
      }

      // squads present in players but not listed in squads (playersBySquad filtered by team)
      const extraIds = Object.keys(playersBySquad).map(Number).filter(id => !listed.has(id) && id > 0).sort((a,b)=>a-b)
      for (const id of extraIds) {
        let members = playersBySquad[id] || []
        if (members.length) {
          let leaderIndex = members.findIndex(m => m.isLeader)
          if (leaderIndex > 0) {
            const leader = members.splice(leaderIndex,1)[0]
            members.unshift(leader)
          }
        }
        groups.push({ id, name: '', creator: '', creatorSteam: '', members, isUnassigned: false })
      }

      // collect unassigned players (squad 0 or missing)
      const unassigned = players.filter(p => p.team === team && (!p.squad || Number(p.squad) === 0))
      if (unassigned.length) groups.push({ id: 0, name: '未加入小队', members: unassigned, isUnassigned: true })
    } else {
      // derive squads from players but exclude unassigned from squads
      const bySquad = {}
      for (const p of players) {
        if (p.team !== team) continue
        const id = Number(p.squad || 0)
        if (id === 0) continue
        if (!bySquad[id]) bySquad[id] = []
        bySquad[id].push(p)
      }
      const keys = Object.keys(bySquad).map(Number).sort((a,b)=>a-b)
      for (const k of keys) {
        let members = bySquad[k]
        if (members.length) {
          let leaderIndex = members.findIndex(m => m.isLeader)
          if (leaderIndex > 0) {
            const leader = members.splice(leaderIndex,1)[0]
            members.unshift(leader)
          }
        }
        groups.push({ id: k, name: '', creator: '', creatorSteam: '', members, isUnassigned: false })
      }
      // unassigned
      const unassigned = players.filter(p => p.team === team && (!p.squad || Number(p.squad) === 0))
      if (unassigned.length) groups.push({ id: 0, name: '未加入小队', members: unassigned, isUnassigned: true })
    }

    this.setData({ groupedSquads: groups })
  },

  // show steam64 in modal when user taps '查看64位'
  viewSteam(e) {
    const gIndex = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.gindex) || 0
    const pIndex = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pindex) || 0
    const groups = this.data.groupedSquads || []
    const group = groups[gIndex] || null
    if (!group) return
    const player = group.members && group.members[pIndex]
    if (!player) return
    if (player.steam) {
      wx.showModal({ title: 'Steam64 ID', content: String(player.steam), showCancel: false })
    } else {
      wx.showToast({ title: '未找到 Steam64', icon: 'none' })
    }
  },

  selectTeam(e) {
    const t = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.team) || 1
    this.setData({ activeTeam: t }, () => this.applyGrouping())
  },

  openManage(e) {
    const gIndex = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.gindex) || 0
    const pIndex = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pindex) || 0
    const groups = this.data.groupedSquads || []
    const group = groups[gIndex] || null
    const player = group && group.members && group.members[pIndex]
    if (!player) return
    // show action sheet
    const items = ['踢出', '封禁', '警告', '跳边']
    if (player.isCommander) items.push('卸任指挥官')
    // add remove-from-squad only when player is actually in a squad
    const squadIdNum = Number(player && (player.squad || player.squadId || player.SquadID || 0)) || 0
    if (squadIdNum > 0) items.push('移出小队')
    // if player has numeric in-game id or playerId, offer ById option
    if (player.id || player.PlayerId) items.push('按ID移除')
    wx.showActionSheet({ itemList: items, success: (res) => {
      const idx = res.tapIndex
      const selection = items[idx]
      // map to internal actions
      let action = null
      if (selection === '踢出') action = 'kick'
      else if (selection === '封禁') action = 'ban'
      else if (selection === '警告') action = 'warn'
      else if (selection === '跳边') action = 'force'
      else if (selection === '移出小队') action = 'remove'
      else if (selection === '按ID移除') action = 'removeById'
      else if (selection === '卸任指挥官') action = 'demote'
      if (!action) return
      // actions that require additional input: kick (reason), ban (duration+reason), warn (message)
      if (action === 'kick' || action === 'ban' || action === 'warn') {
        // open modal
        this.setData({ manageModalVisible: true, manageModalAction: action, manageTarget: { gIndex, pIndex }, manageReason: '', manageDuration: '0' })
      } else if (action === 'force') {
        // confirm then send AdminForceTeamChange <player>
        wx.showModal({ title: '确认', content: `确认将 ${player.name} 强制换队？`, success: (mres) => { if (mres.confirm) this._sendAdminCommand(this._playerIdOrName(player), `AdminForceTeamChange ${this._playerIdOrName(player)}`) } })
      } else if (action === 'remove') {
        wx.showModal({ title: '确认', content: `确认将 ${player.name} 从其所在小队移出？`, success: (mres) => { if (mres.confirm) this._sendAdminCommand(this._playerIdOrName(player), `AdminRemovePlayerFromSquad ${this._playerIdOrName(player)}`) } })
      } else if (action === 'removeById') {
        const pid = player.PlayerId || player.id
        wx.showModal({ title: '确认', content: `确认按ID(${pid})将该玩家移出小队？`, success: (mres) => { if (mres.confirm) this._sendAdminCommand(pid, `AdminRemovePlayerFromSquadById ${pid}`) } })
      } else if (action === 'demote') {
        wx.showModal({ title: '确认', content: `确认卸任指挥官 ${player.name}？`, success: (mres) => { if (mres.confirm) this._sendAdminCommand(this._playerIdOrName(player), `AdminDemoteCommander ${this._playerIdOrName(player)}`) } })
      }
    } })
  },

  cancelManage() { this.setData({ manageModalVisible: false, manageModalAction: '', manageTarget: null, manageReason: '', manageDuration: '0' }) },

  async confirmManage() {
    const action = this.data.manageModalAction
    const target = this.data.manageTarget || {}
    const gIndex = target.gIndex || 0
    const pIndex = target.pIndex || 0
    const groups = this.data.groupedSquads || []
    const group = groups[gIndex] || null
    const player = group && group.members && group.members[pIndex]
    if (!player) { wx.showToast({ title: '未找到目标玩家', icon: 'none' }); return }
    const who = this._playerIdOrName(player)
    let cmd = ''
    if (action === 'kick') {
      const reason = (this.data.manageReason || '').trim(); if (!reason) { wx.showToast({ title: '请输入踢出原因', icon: 'none' }); return }
      cmd = `AdminKick ${who} ${reason}`
    } else if (action === 'ban') {
      const duration = (this.data.manageDuration || '0').trim(); const reason = (this.data.manageReason || '').trim(); if (!reason) { wx.showToast({ title: '请输入封禁原因', icon: 'none' }); return }
      cmd = `AdminBan ${who} ${duration} ${reason}`
    } else if (action === 'warn') {
      const message = (this.data.manageReason || '').trim(); if (!message) { wx.showToast({ title: '请输入警告内容', icon: 'none' }); return }
      cmd = `AdminWarn ${who} ${message}`
    } else {
      wx.showToast({ title: '未知操作', icon: 'none' }); return
    }
    // send command
    this._sendAdminCommand(who, cmd)
    // hide modal
    this.cancelManage()
  },

  // helper to use steam if available else name
  _playerIdOrName(player) {
    if (!player) return ''
    if (player.steam) return player.steam
    return player.name.replace(/\s+/g, '_') // fallback: replace spaces to avoid breaking command
  },

    async _sendAdminCommand(whoLabel, cmd) {
    try {
      const res = await api.command(this.serverId, cmd)
      if (res && res.ok) {
        wx.showToast({ title: '操作成功', icon: 'success' })
        // audit logging is now handled server-side by the serverCommand cloud function; no client write needed
        // refresh player list
        this.loadData()
      } else {
        wx.showToast({ title: '操作失败: ' + (res && res.error || '未知错误'), icon: 'none' })
        // audit logging is now handled server-side by the serverCommand cloud function; no client write needed
      }
    } catch (e) {
      wx.showToast({ title: '命令发送失败', icon: 'none' })
      // audit logging is now handled server-side by the serverCommand cloud function; no client write needed
    }
    },

  onCommandInput(e) {
    this.setData({ commandText: e && e.detail && e.detail.value })
  },

  manageReasonInput(e) {
    this.setData({ manageReason: e && e.detail && e.detail.value })
  },

  manageDurationInput(e) {
    this.setData({ manageDuration: e && e.detail && e.detail.value })
  },

  // 在小队标题行点击解散小队
  async disbandSquad(e) {
    const gIndex = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.gindex) || 0
    const squadId = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.squadid) || 0
    const team = this.data.activeTeam || 1
    if (!squadId || squadId === 0) {
      wx.showToast({ title: '无效的小队编号', icon: 'none' })
      return
    }
    const teamName = (this.data.teamNames && this.data.teamNames[team-1]) || (`阵营${team}`)
    wx.showModal({ title: '确认', content: `确认解散 ${teamName} 小队 ${squadId}？\n操作会将该小队解散，成员保持在线状态。`, success: async (res) => {
      if (!res.confirm) return
      const cmd = `AdminDisbandSquad ${team} ${squadId}`
      wx.showLoading({ title: '发送中...' })
      try {
        const r = await api.command(this.serverId, cmd)
        wx.hideLoading()
        if (r && r.ok) {
          wx.showToast({ title: '已解散小队', icon: 'success' })
          // audit log - if you have an audit cloud function, call it. Fallback: just refresh list
          try { if (typeof api.audit === 'function') api.audit({ serverId: this.serverId, action: 'disband_squad', target: { team, squadId }, rawCmd: cmd }) } catch (e) {}
          this.loadData()
        } else {
          wx.showToast({ title: '操作失败: ' + (r && r.error || r && r.message || '未知'), icon: 'none' })
        }
      } catch (err) {
        wx.hideLoading()
        wx.showToast({ title: '发送失败', icon: 'none' })
      }
    }})
  }
})
