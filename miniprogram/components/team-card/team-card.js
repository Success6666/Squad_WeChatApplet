Component({
  properties: {
    team: { type: Object, value: {} },
  },
  data: {
    defaultLogo: '/images/default-team.png',
  },
  methods: {
    onTap() {
      const teamId = this.data.team && this.data.team._id
      if (!teamId) return
      this.triggerEvent('tapteam', { teamId })
    },
  },
})
