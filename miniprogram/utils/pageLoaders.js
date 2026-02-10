// Reusable page data loaders - wrap cloud.callFunction calls so other pages can reuse

async function callFunction(name, data) {
  try {
    const res = await wx.cloud.callFunction({ name, data })
    return res && res.result
  } catch (e) {
    console.error(`[pageLoaders] ${name} fail`, e)
    throw e
  }
}

module.exports = {
  async loadTeamDetail(teamId) {
    if (!teamId) throw new Error('teamId required')
    return callFunction('teamDetail', { teamId })
  },

  async loadActivityList(opts) {
    // opts: { teamId, page, pageSize }
    const { teamId, page = 0, pageSize = 20 } = opts || {}
    if (!teamId) throw new Error('teamId required')
    return callFunction('activityList', { teamId, page, pageSize })
  },

  async removeActivity(teamId, activityId) {
    if (!teamId || !activityId) throw new Error('params required')
    return callFunction('activityRemove', { teamId, activityId })
  },

  async signupToggle(teamId, activityId, action) {
    if (!teamId || !activityId || !action) throw new Error('params required')
    return callFunction('signupToggle', { teamId, activityId, action })
  },

  async loadServerList() {
    return callFunction('serverList', { page: 1, pageSize: 50 })
  },

  async loadProfile() {
    return callFunction('profileGet', {})
  }
}
