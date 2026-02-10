// Early console.error filter (run at module load) to suppress noisy devtools/runtime messages
;(function(){
  try {
    const _origConsoleError = console.error.bind(console)
    console.error = function (...args) {
      try {
        const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
        if (text.includes('not node js file system') || text.includes('saaa_config.json') || text.includes('wxfile://usr/miniprogramLog')) {
          _origConsoleError('[suppressed noisy error]', text)
          return
        }
      } catch (e) {
        // fallback
      }
      _origConsoleError.apply(console, args)
    }
  } catch (e) {
    // ignore
  }
})()

App({
  globalData: {
    cloudReady: null,
    cloudInitError: '',
    pageCache: {},
  },
  onLaunch() {
    if (!wx.cloud) {
      wx.showToast({ title: '请使用 2.2.3+ 基础库', icon: 'none' })
      return
    }

    this.initCloud()

    // 注意：不要在 App.onLaunch 做强制 redirect。
    // 资料是否完善应在具体动作（加入战队/创建战队/报名）时在后台校验，避免影响已完善用户的体验。

    // Lightweight console.error filter to reduce noisy devtools/runtime messages
    try {
      const _origConsoleError = console.error.bind(console)
      console.error = function (...args) {
        try {
          const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
          // suppress known noisy runtime messages coming from devtools or optional native hooks
          if (text.includes('not node js file system') || text.includes('saaa_config.json') || text.includes('wxfile://usr/miniprogramLog')) {
            _origConsoleError('[suppressed noisy error]', text)
            return
          }
        } catch (e) {
          // If anything goes wrong while filtering, fall back to original
        }
        _origConsoleError.apply(console, args)
      }
    } catch (e) {
      // ignore in case console is not configurable in some environments
    }
  },

  // Global error handler: capture unhandled errors and avoid crashing the app on known noisy messages.
  onError(err) {
    const msg = (err && (err.message || err.toString && err.toString())) || String(err)
    if (msg && (msg.indexOf('not node js file system') !== -1 || msg.indexOf('saaa_config.json') !== -1 || msg.indexOf('wxfile://usr/miniprogramLog') !== -1)) {
      // Log a concise warning and swallow the noise
      console.warn('[App.onError] suppressed noisy runtime error:', msg)
      return
    }
    // For other errors, keep the default behavior (logged so you can inspect)
    console.error('[App.onError]', err)
  },

  // Capture unhandled promise rejections
  onUnhandledRejection(reason, p) {
    const msg = (reason && (reason.message || reason.toString && reason.toString())) || String(reason)
    if (msg && (msg.indexOf('not node js file system') !== -1 || msg.indexOf('saaa_config.json') !== -1 || msg.indexOf('wxfile://usr/miniprogramLog') !== -1)) {
      console.warn('[App.onUnhandledRejection] suppressed noisy promise rejection:', msg)
      return
    }
    console.error('[App.onUnhandledRejection]', reason, p)
  },

  // Capture page-not-found (useful for lazy component issues)
  onPageNotFound(res) {
    // res: { path, query }
    console.warn('[App.onPageNotFound] missing page/component path:', res)
    // If a missing component is due to lazy loading, you may want to fall back or show a friendly message
  },

  async initCloud() {
    if (!wx.cloud) return
    if (this._cloudInitInProgress) return
    this._cloudInitInProgress = true
    const attempt = (this._cloudInitAttempt || 0) + 1
    this._cloudInitAttempt = attempt

    // mark as initializing (pending) until we confirm success or final failure
    this.globalData.cloudReady = null
    this.globalData.cloudInitError = ''

    try {
      wx.cloud.init({
        env: 'YOUR_CLOUDBASE_ENV_ID',
        traceUser: true,
      })

      // ping cloud to verify connectivity
      await wx.cloud.callFunction({ name: 'login', data: {} })
      this.globalData.cloudReady = true
      this.globalData.cloudInitError = ''
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || String(e)
      this.globalData.cloudInitError = msg
      console.error('[app] cloud init/ping fail', msg)

      if (attempt < 3) {
        setTimeout(() => {
          this._cloudInitInProgress = false
          this.initCloud()
        }, 1500 * attempt)
        return
      }
      // final failure after retries
      this.globalData.cloudReady = false
    } finally {
      this._cloudInitInProgress = false
    }
  },
})
