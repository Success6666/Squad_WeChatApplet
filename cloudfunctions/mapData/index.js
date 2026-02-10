// Local SDK loader (self-contained) — ensures function works when deployed individually
let cloud
try {
  cloud = require('wx-server-sdk')
} catch (e) {
  try {
    cloud = require('tcb-admin-node')
  } catch (e2) {
    const msg = `Neither wx-server-sdk nor tcb-admin-node could be required. Original: ${e.message}; fallback: ${e2 && e2.message}`
    throw new Error(msg)
  }
}
if (cloud && cloud.init && typeof cloud.init === 'function') {
  // ✅ 修复点1：删除无效的 cloud.SYMBOL_CURRENT，保留官方唯一合法的动态环境常量
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
}
// ✅ 修复点2：增加数据库实例容错，防止cloud.init失败导致db为undefined
const db = cloud && cloud.database ? cloud.database() : null;

// === Inlined map data (was Squad_Map.json) ===
const INLINED_DATA = {
  "update_version": "Squad V8.2 冲锋号同步版",
  "maps": [
    { "map_en": "Yehorivka", "map_cn": "叶霍里夫卡" },
    { "map_en": "Anvil", "map_cn": "铁砧行动" },
    { "map_en": "AlBasrah", "map_cn": "巴士拉" },
    { "map_en": "Tallil", "map_cn": "塔利尔郊区" },
    { "map_en": "Sumari", "map_cn": "苏玛瑞" },
    { "map_en": "Skorpo", "map_cn": "斯科普" },
    { "map_en": "Sanxian", "map_cn": "三贤岛" },
    { "map_en": "Narva", "map_cn": "纳尔瓦" },
    { "map_en": "Mutaha", "map_cn": "木塔哈" },
    { "map_en": "Mestia", "map_cn": "梅斯提亚" },
    { "map_en": "Manicouagan", "map_cn": "曼尼古根" },
    { "map_en": "Logar", "map_cn": "洛加尔山谷" },
    { "map_en": "Lashkar", "map_cn": "拉什喀" },
    { "map_en": "Kokan", "map_cn": "寇坎" },
    { "map_en": "Kohat", "map_cn": "科哈特" },
    { "map_en": "Kamdesh", "map_cn": "卡姆德什高地" },
    { "map_en": "Harju", "map_cn": "哈留" },
    { "map_en": "Gorodok", "map_cn": "格洛多克" },
    { "map_en": "GooseBay", "map_cn": "鹅湾" },
    { "map_en": "FoolsRoad", "map_cn": "愚者之路" },
    { "map_en": "Fallujah", "map_cn": "费卢杰" },
    { "map_en": "Chora", "map_cn": "乔拉" },
    { "map_en": "BlackCoast", "map_cn": "黑色海岸" },
    { "map_en": "Belaya", "map_cn": "贝拉亚关隘" }
  ],
  "all_layers": {
    "AlBasrah": ["AlBasrah_AAS_v1", "AlBasrah_Insurgency_v1", "AlBasrah_Invasion_v1", "AlBasrah_Invasion_v2", "AlBasrah_RAAS_v1", "AlBasrah_Seed_v1", "AlBasrah_Skirmish_v1", "AlBasrah_Skirmish_v2", "AlBasrah_TC_v1"],
    "Anvil": ["Anvil_AAS_v1", "Anvil_Invasion_v1", "Anvil_RAAS_v1", "Anvil_RAAS_v2", "Anvil_Skirmish_v1", "Anvil_TC_v1"],
    "Belaya": ["Belaya_AAS_v1", "Belaya_AAS_v2", "Belaya_AAS_v3", "Belaya_Invasion_v1", "Belaya_Invasion_v2", "Belaya_RAAS_v1", "Belaya_Skirmish_v1", "Belaya_TC_v1"],
    "BlackCoast": ["BlackCoast_AAS_v1", "BlackCoast_AAS_v2", "BlackCoast_Invasion_v1", "BlackCoast_RAAS_v1", "BlackCoast_RAAS_v2", "BlackCoast_Seed_v1", "BlackCoast_Seed_v2", "BlackCoast_Skirmish_v1"],
    "Chora": ["Chora_AAS_v1", "Chora_AAS_v2", "Chora_AAS_v3", "Chora_Insurgency_v1", "Chora_Invasion_v1", "Chora_Invasion_v2", "Chora_RAAS_v1", "Chora_Skirmish_v1", "Chora_TC_v1"],
    "Fallujah": ["Fallujah_AAS_v1", "Fallujah_Insurgency_v1", "Fallujah_Invasion_v1", "Fallujah_Invasion_v2", "Fallujah_RAAS_v1", "Fallujah_RAAS_v2", "Fallujah_Seed_v1", "Fallujah_Skirmish_v1", "Fallujah_Skirmish_v2", "Fallujah_TC_v1"],
    "FoolsRoad": ["FoolsRoad_AAS_v1", "FoolsRoad_AAS_v2", "FoolsRoad_Destruction_v1", "FoolsRoad_Invasion_v1", "FoolsRoad_RAAS_v1", "FoolsRoad_RAAS_v2", "FoolsRoad_RAAS_v3", "FoolsRoad_Skirmish_v1", "FoolsRoad_Skirmish_v2", "FoolsRoad_TC_v1"],
    "GooseBay": ["GooseBay_AAS_v1", "GooseBay_Invasion_v1", "GooseBay_RAAS_v1", "GooseBay_RAAS_v2", "GooseBay_Seed_v1", "GooseBay_Skirmish_v1"],
    "Gorodok": ["Gorodok_AAS_v1", "Gorodok_Destruction_v1", "Gorodok_Insurgency_v1", "Gorodok_Invasion_v1", "Gorodok_Invasion_v2", "Gorodok_RAAS_v1", "Gorodok_RAAS_v2", "Gorodok_Skirmish_v1", "Gorodok_TC_v1"],
    "Harju": ["Harju_AAS_v1", "Harju_AAS_v2", "Harju_AAS_v3", "Harju_Invasion_v1", "Harju_Invasion_v2", "Harju_Invasion_v3", "Harju_RAAS_v1", "Harju_RAAS_v2", "Harju_TC_v1", "Harju_Seed_v1", "Harju_Skirmish_v1", "Harju_Skirmish_v2"],
    "Kamdesh": ["Kamdesh_AAS_v1", "Kamdesh_Insurgency_v1", "Kamdesh_Invasion_v1", "Kamdesh_RAAS_v1", "Kamdesh_Skirmish_v1", "Kamdesh_TC_v1"],
    "Kohat": ["Kohat_AAS_v1", "Kohat_RAAS_v1", "Kohat_Skirmish_v1", "Kohat_Insurgency_v1", "Kohat_Invasion_v1", "Kohat_TC_v1"],
    "Kokan": ["Kokan_AAS_v1", "Kokan_AAS_v2", "Kokan_Insurgency_v1", "Kokan_Invasion_v1", "Kokan_RAAS_v1", "Kokan_RAAS_v2", "Kokan_Skirmish_v1", "Kokan_TC_v1"],
    "Lashkar": ["Lashkar_AAS_v1", "Lashkar_AAS_v2", "Lashkar_Insurgency_v1", "Lashkar_Invasion_v1", "Lashkar_RAAS_v1", "Lashkar_Skirmish_v1", "Lashkar_TC_v1", "Lashkar_TC_v2"],
    "Logar": ["Logar_AAS_v1", "Logar_Insurgency_v1", "Logar_RAAS_v1", "Logar_Seed_v1", "Logar_Skirmish_v1", "Logar_TC_v1"],
    "Manicouagan": ["Manicouagan_AAS_v1", "Manicouagan_AAS_v2", "Manicouagan_AAS_v3", "Manicouagan_RAAS_v1", "Manicouagan_RAAS_v2", "Manicouagan_Invasion_v1", "Manicouagan_Seed_v1", "Manicouagan_Skirmish_v1", "Manicouagan_Skirmish_v2", "Manicouagan_Skirmish_v3"],
    "Mestia": ["Mestia_AAS_v1", "Mestia_AAS_v2", "Mestia_Invasion_v1", "Mestia_RAAS_v1", "Mestia_Skirmish_v1", "Mestia_TC_v1"],
    "Mutaha": ["Mutaha_AAS_v1", "Mutaha_AAS_v2", "Mutaha_Invasion_v1", "Mutaha_RAAS_v1", "Mutaha_RAAS_v2", "Mutaha_Seed_v1", "Mutaha_Skirmish_v1", "Mutaha_TC_v1"],
    "Narva": ["Narva_AAS_v1", "Narva_AAS_v2", "Narva_AAS_v3", "Narva_Destruction_v1", "Narva_Invasion_v1", "Narva_Invasion_v2", "Narva_RAAS_v1", "Narva_Skirmish_v1", "Narva_TC_v1"],
    "Skorpo": ["Skorpo_Invasion_v1", "Skorpo_Invasion_v2", "Skorpo_RAAS_v1", "Skorpo_Skirmish_v1"],
    "Sanxian": ["Sanxian_AAS_v1", "Sanxian_AAS_v2", "Sanxian_AAS_v3", "Sanxian_Invasion_v1", "Sanxian_Invasion_v2", "Sanxian_RAAS_v1", "Sanxian_RAAS_v2", "Sanxian_Seed_v1", "Sanxian_Skirmish_v1"],
    "Sumari": ["Sumari_AAS_v1", "Sumari_AAS_v2", "Sumari_AAS_v3", "Sumari_Insurgency_v1", "Sumari_Invasion_v1", "Sumari_RAAS_v1", "Sumari_Seed_v1", "Sumari_Skirmish_v1", "Sumari_TC_v1"],
    "Tallil": ["Tallil_AAS_v1", "Tallil_Invasion_v1", "Tallil_RAAS_v1", "Tallil_RAAS_v2", "Tallil_Seed_v1", "Tallil_Skirmish_v1", "Tallil_Skirmish_v2", "Tallil_Skirmish_v3", "Tallil_TC_v1"],
    "Yehorivka": ["Yehorivka_AAS_v1", "Yehorivka_AAS_v2", "Yehorivka_Destruction_v1", "Yehorivka_Invasion_v1", "Yehorivka_Invasion_v2", "Yehorivka_Skirmish_v1", "Yehorivka_Skirmish_v2", "Yehorivka_RAAS_v1", "Yehorivka_RAAS_v2", "Yehorivka_TC_v1", "Yehorivka_TC_v2"]
  },
  "factions": [
    {"faction_en": "USA", "faction_cn": "蓝军派系 - 美国陆军"},
    {"faction_en": "USMC", "faction_cn": "蓝军派系 - 美国海军陆战队"},
    {"faction_en": "ADF", "faction_cn": "蓝军派系 - 澳大利亚军队"},
    {"faction_en": "BAF", "faction_cn": "蓝军派系 - 英国军队"},
    {"faction_en": "CAF", "faction_cn": "蓝军派系 - 加拿大军队"},
    {"faction_en": "PLA", "faction_cn": "泛亚联盟 - 中国人民解放军"},
    {"faction_en": "PLAAGF", "faction_cn": "泛亚联盟 - 中国人民解放军陆军"},
    {"faction_en": "PLANMC", "faction_cn": "泛亚联盟 - 中国人民解放军海军陆战队"},
    {"faction_en": "RGF", "faction_cn": "红军派系 - 俄罗斯陆军"},
    {"faction_en": "VDV", "faction_cn": "红军派系 - 俄罗斯空降部队"},
    {"faction_en": "WPMC", "faction_cn": "独立派系 - 西方私营军事承包商"},
    {"faction_en": "IMF", "faction_cn": "独立派系 - 民兵武装"},
    {"faction_en": "INS", "faction_cn": "独立派系 - 叛军武装"},
    {"faction_en": "MEA", "faction_cn": "独立派系 - 中东联军"},
    {"faction_en": "TLF", "faction_cn": "独立派系 - 土耳其陆军"}
  ],
  "unit_types": [
    {"unit_en": "CombinedArms", "unit_cn": "合成部队", "desc": "综合性最强的单位，平衡步兵与载具体验的阵营。"},
    {"unit_en": "Armored", "unit_cn": "装甲部队", "desc": "开局至少两台坦克，无直升机，多为履式补给车，火力强劲，后勤困难，应对大图的战斗较为疲惫。"},
    {"unit_en": "Mechanized", "unit_cn": "机械化部队", "desc": "履式战车、履式补给车为主，提供一架直升机，火力较强，后勤较困难，应对大图的战斗较为疲惫。"},
    {"unit_en": "Motorized", "unit_cn": "摩托化部队", "desc": "轮式载具及步战车较多，队伍机动性强，火力适中。"},
    {"unit_en": "AmphibiousAssault", "unit_cn": "两栖部队", "desc": "能在水陆两栖作战的部队，没什么特点，且较多编制不存在此单位。"},
    {"unit_en": "AirAssault", "unit_cn": "空降部队", "desc": "开局提供三架直升机，轻型车辆为主，机动能力强，提供更多的固定式武器。"},
    {"unit_en": "LightInfantry", "unit_cn": "轻型步兵", "desc": "载具力量弱，轻型车辆为主，提供更多的固定式武器和步兵重火力，部分存在特殊武器。"},
    {"unit_en": "Support", "unit_cn": "支援部队", "desc": "以轻型车辆为主，提供更多兵站和步兵重火力，部分提供重型迫击炮。"}
  ]
}
// process-level handlers to capture unexpected crashes in cloud environment
try {
  if (typeof process !== 'undefined' && process && process.on) {
    process.on('uncaughtException', (err) => {
      console.error('[mapData] uncaughtException', err && (err.stack || err.message || err))
    })
    process.on('unhandledRejection', (reason) => {
      console.error('[mapData] unhandledRejection', reason && (reason.stack || reason.message || reason))
    })
  }
} catch (e) {
  // ignore in restricted runtime
}

// Simple ping endpoint to quickly verify function runs without executing DB logic
async function handlePing() {
  return { ok: true, data: { ping: true, timestamp: Date.now() } }
}

// Simple helper to safe-get openId
function getOpenIdFromCtx(context) {
  try {
    return (cloud.getWXContext && cloud.getWXContext().OPENID) || (context && context.OPENID) || null
  } catch (e) {
    return (context && context.OPENID) || null
  }
}

// Simple cloud function that returns the map/faction/unit metadata, admin-only
exports.main = async (event, context) => {
  try {
    // Fast path for ping
    if (event && event.__ping === true) return handlePing()

    // Diagnostic logs to help trace why client may get NO_SESSION/NO_PERMISSION
    try { console.log('[mapData] incoming event:', event) } catch (e) {}
    const openId = getOpenIdFromCtx(context)
    try { console.log('[mapData] detected openId:', openId, 'context.OPENID:', context && context.OPENID) } catch (e) {}

    if (!openId) return { ok: false, code: 'NO_SESSION', message: '未登录' }

    // Check admin_list
    try {
      // ✅ 优化点：增加db有效性判断，极致容错
      if(!db) return { ok: false, code: 'DB_ERROR', message: '数据库初始化失败' }
      const a = await db.collection('admin_list').where({ openId }).limit(1).get().catch(() => ({ data: [] }))
      try { console.log('[mapData] admin_list lookup result length:', (a && a.data && a.data.length) || 0) } catch (e) {}
      if (a && a.data && a.data.length > 0) {
        const d = INLINED_DATA
        if (!d) return { ok: false, code: 'NO_DATA', message: '地图数据加载失败' }
        return { ok: true, data: d }
      }
    } catch (e) { console.error('[mapData] admin_list lookup exception', e) }

    // Check members with owner/admin role
    try {
      // ✅ 优化点：增加db有效性判断，极致容错
      if(!db) return { ok: false, code: 'DB_ERROR', message: '数据库初始化失败' }
      const m = await db.collection('members').where({ openId, status: 'approved' }).limit(1).get().catch(() => ({ data: [] }))
      const member = m && m.data && m.data[0]
      try { console.log('[mapData] members lookup result:', member && { role: member.role, id: member._id } || null) } catch (e) {}
      if (member && (member.role === 'owner' || member.role === 'admin')) {
        const d = INLINED_DATA
        if (!d) return { ok: false, code: 'NO_DATA', message: '地图数据加载失败' }
        return { ok: true, data: d }
      }
    } catch (e) { console.error('[mapData] members lookup exception', e) }

    return { ok: false, code: 'NO_PERMISSION', message: '需要管理员权限' }
  } catch (e) {
    console.error('[mapData] unexpected exception', e && (e.stack || e.message || e))
    return { ok: false, code: 'EXCEPTION', message: e && (e.stack || e.message || String(e)) }
  }
}