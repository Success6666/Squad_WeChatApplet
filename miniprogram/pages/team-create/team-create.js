Page({
  data: {
    teamId: '',
    isEdit: false,
    name: '',
    desc: '',
    isPublic: true,
    logoTempPath: '',
    logoPreview: '',
    submitting: false,
  },
  async onLoad(q) {
    const teamId = (q && q.teamId) ? String(q.teamId).trim() : ''
    if (teamId) {
      this.setData({ teamId, isEdit: true })
      await this.loadTeam()
    }
  },
  async loadTeam() {
    try {
      const res = await wx.cloud.callFunction({ name: 'teamDetail', data: { teamId: this.data.teamId } })
      const r = res.result
      if (!r || !r.ok) throw new Error((r && r.message) || '加载失败')
      const t = r.data && r.data.team
      if (!t) return
      let logoPreview = t.logoFileId || ''
      // if logoPreview is a cloud file id or cloud:// path, fetch temp URL
      try {
        if (logoPreview && logoPreview.indexOf('cloud:') === 0) {
          const temp = await wx.cloud.getTempFileURL({ fileList: [logoPreview] })
          const it = temp && temp.fileList && temp.fileList[0]
          if (it && it.tempFileURL) logoPreview = it.tempFileURL
          else logoPreview = ''
        }
      } catch (e) {
        console.warn('[team-create] getTempFileURL failed', e && e.message)
        logoPreview = ''
      }

      this.setData({
        name: t.name || '',
        desc: t.desc || '',
        isPublic: typeof t.isPublic === 'boolean' ? t.isPublic : true,
        logoPreview: logoPreview || '',
        logoTempPath: '',
      })
      wx.setNavigationBarTitle({ title: '编辑战队' })
    } catch (e) {
      console.error('[team-create] loadTeam fail', e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onName(e) {
    this.setData({ name: e.detail.value })
  },
  onDesc(e) {
    this.setData({ desc: e.detail.value })
  },
  onPublicChange(e) {
    this.setData({ isPublic: !!e.detail.value })
  },
  async chooseLogo() {
    const res = await wx.chooseMedia({ count: 1, mediaType: ['image'] })
    const f = res.tempFiles && res.tempFiles[0]
    if (!f) return
    this.setData({ logoTempPath: f.tempFilePath, logoPreview: f.tempFilePath })
  },
  async submit() {
    if (this.data.submitting) return

    const name = (this.data.name || '').trim()
    if (!name) return wx.showToast({ title: '请填写战队名称', icon: 'none' })
    if (name.length > 20) return wx.showToast({ title: '战队名称过长', icon: 'none' })

    this.setData({ submitting: true })
    try {
      let logoFileId = ''
      if (this.data.logoTempPath) {
        const up = await wx.cloud.uploadFile({
          cloudPath: `team-logos/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`,
          filePath: this.data.logoTempPath,
        })
        logoFileId = up.fileID
      }

      // 编辑：走 teamUpdate；创建：走 teamCreate
      const fn = this.data.isEdit ? 'teamUpdate' : 'teamCreate'
      const payload = { name, desc: this.data.desc || '', isPublic: !!this.data.isPublic }
      if (logoFileId) payload.logoFileId = logoFileId
      if (this.data.isEdit) payload.teamId = this.data.teamId

      const r = await wx.cloud.callFunction({ name: fn, data: payload })
      if (!r.result || !r.result.ok) throw new Error((r.result && r.result.message) || (this.data.isEdit ? '更新失败' : '创建失败'))

      wx.showToast({ title: this.data.isEdit ? '已保存' : '创建成功' })
      const teamId = this.data.isEdit ? this.data.teamId : r.result.data.teamId

      setTimeout(() => {
        wx.redirectTo({ url: '/pages/home/home' })
      }, 500)
    } catch (e) {
      console.error(e)
      wx.showToast({ title: e.message || (this.data.isEdit ? '更新失败' : '创建失败'), icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
