// 轻量路由守卫：用于“新用户必须先完善个人资料或跳过”
// 这里只用本地 storage 标记，不依赖云函数，确保最稳。

const PROFILE_DONE_KEY = 'profileDone'
const PROFILE_SKIPPED_KEY = 'profileSkipped'

function markProfileDone() {
  wx.setStorageSync(PROFILE_DONE_KEY, true)
  wx.removeStorageSync(PROFILE_SKIPPED_KEY)
}

function markProfileSkipped() {
  wx.setStorageSync(PROFILE_SKIPPED_KEY, true)
}

function isSteam64(id) {
  return /^\d{17}$/.test((id || '').trim())
}

function isProfileComplete(p) {
  const nick = ((p && p.steamNick) || '').trim()
  const sid = ((p && p.steam64Id) || '').trim()
  return !!nick && isSteam64(sid)
}

function isProfileSatisfiedLocal() {
  const done = !!wx.getStorageSync(PROFILE_DONE_KEY)
  const skipped = !!wx.getStorageSync(PROFILE_SKIPPED_KEY)
  return done || skipped
}

// 异步：优先云端校验（真正完成态以云端为准），本地仅作缓存
async function ensureProfileCompleteAsync() {
  // 本地 done 可以直接放行（加速）
  if (wx.getStorageSync(PROFILE_DONE_KEY)) return true

  try {
    const res = await wx.cloud.callFunction({ name: 'profileGet', data: {} })
    const r = res.result
    const p = r && r.ok && r.data && r.data.profile
    if (p && isProfileComplete(p)) {
      markProfileDone()
      return true
    }
    return false
  } catch (e) {
    console.error('[guard] profileGet fail', e)
    return false
  }
}

// 用在“关键动作”之前：未完善则跳转到完善页，并带上回跳路径
async function ensureProfileForAction(options) {
  const redirect = (options && options.redirect) || '/pages/profile-onboarding/profile-onboarding'
  const returnUrl = (options && options.returnUrl) || ''

  const ok = await ensureProfileCompleteAsync()
  if (ok) return true

  const url = returnUrl ? `${redirect}?returnUrl=${encodeURIComponent(returnUrl)}` : redirect
  wx.navigateTo({ url })
  return false
}

// 兼容旧 API（不建议新代码使用）
async function ensureProfileOrRedirectAsync(currentRoute) {
  if (currentRoute === 'pages/profile-onboarding/profile-onboarding') return true
  const ok = await ensureProfileCompleteAsync()
  if (ok) return true
  wx.redirectTo({ url: '/pages/profile-onboarding/profile-onboarding' })
  return false
}

function ensureProfileOrRedirect(currentRoute) {
  if (isProfileSatisfiedLocal()) return true
  if (currentRoute === 'pages/profile-onboarding/profile-onboarding') return true
  wx.redirectTo({ url: '/pages/profile-onboarding/profile-onboarding' })
  return false
}

// 新增：管理员检查缓存键
const ADMIN_OK_KEY = 'isAdmin'
const ADMIN_TTL_MS = 5 * 60 * 1000 // 5分钟缓存

async function ensureAdminForTeam(teamId) {
  // 本地缓存优先
  const cache = wx.getStorageSync(ADMIN_OK_KEY + (teamId || 'global'))
  if (cache && cache.expires > Date.now()) return cache.value

  try {
    const res = await wx.cloud.callFunction({ name: 'checkAdmin', data: { teamId } })
    let ok = res && res.result && res.result.ok && res.result.data && res.result.data.isAdmin

    // 如果 teamId 指定并返回 false，尝试回退到全局 admin 检查（某些帐号是全局管理员）
    if (!ok && teamId) {
      try {
        const r2 = await wx.cloud.callFunction({ name: 'checkAdmin', data: {} })
        ok = r2 && r2.result && r2.result.ok && r2.result.data && r2.result.data.isAdmin
      } catch (e2) {
        // ignore fallback error, keep ok false
        console.warn('[guard] fallback global checkAdmin fail', e2)
      }
    }

    wx.setStorageSync(ADMIN_OK_KEY + (teamId || 'global'), { value: ok, expires: Date.now() + ADMIN_TTL_MS })
    return !!ok
  } catch (e) {
    console.error('[guard] checkAdmin fail', e)
    const raw = (e && (e.errMsg || e.message)) || String(e)
    if (raw.indexOf('FunctionName') !== -1 || raw.indexOf('FUNCTION_NOT_FOUND') !== -1 || raw.indexOf('-501000') !== -1) {
      wx.showToast({ title: '后台云函数未部署：checkAdmin，请部署后重试', icon: 'none', duration: 4000 })
      return false
    }
    return false
  }
}

module.exports = {
  markProfileDone,
  markProfileSkipped,
  isProfileSatisfied: isProfileSatisfiedLocal,
  isProfileComplete,
  ensureProfileCompleteAsync,
  ensureProfileForAction,
  ensureProfileOrRedirect,
  ensureProfileOrRedirectAsync,
  ensureAdminForTeam,
}
