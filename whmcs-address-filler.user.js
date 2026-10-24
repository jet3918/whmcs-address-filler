// ==UserScript==
// @name         WHMCS 注册表单快速填充
// @namespace    whmcs-addr-filler
// @version      0.5.0
// @description  生成真实美国地址并一键填入 WHMCS 注册页（姓名 / 电话 / 街道 / 城市 / 州 / 邮编 / 国家）。快捷键 Alt+F
// @author       -
// @match        *://*/*register*
// @match        *://*/*/register*
// @match        *://*/*cart.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      nominatim.openstreetmap.org
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 用法：
 *   1. 打开 WHMCS 注册页（register.php）
 *   2. 点右下角圆形按钮，或按 Alt+F
 *   3. 粘贴生成结果，例如：
 *        [US] Leatha Jast | +1 (971) 927-1618 | 427 Center Street Northeast, Salem, Oregon 97301, United States
 *   4. 核对预览里的字段（邮箱会沿用你上次填的真实邮箱）
 *   5. 点「填入页面」
 *
 * 面板操作：
 *   · 拖标题栏可移动面板，位置会记住
 *   · 右上角 − 折叠成一条，× 关闭（悬浮球还在）
 *   · 地址池自动累积粘贴过的地址，「随机」挑一条用得最少的
 *
 * 数据存在脚本管理器的 GM 存储里，跨商家域名共享（localStorage 是按域名隔离的，不行）。
 * 解析错了？直接改预览框里的值再填入，不用改原文。
 * 字段没找到？点「诊断页面」，把输出发我，我加适配。
 */

(function () {
  'use strict';

  /* ============================================================
   * 1. 常量
   * ============================================================ */

  var US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
  };

  var COUNTRIES = [
    { code: 'US', en: 'United States', names: ['us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america', '美国', '美國'] },
    { code: 'CA', en: 'Canada', names: ['ca', 'can', 'canada', '加拿大'] },
    { code: 'GB', en: 'United Kingdom', names: ['gb', 'uk', 'united kingdom', 'great britain', '英国', '英國'] },
    { code: 'AU', en: 'Australia', names: ['au', 'aus', 'australia', '澳大利亚', '澳洲'] },
    { code: 'DE', en: 'Germany', names: ['de', 'germany', '德国', '德國'] },
    { code: 'JP', en: 'Japan', names: ['jp', 'japan', '日本'] },
    { code: 'SG', en: 'Singapore', names: ['sg', 'singapore', '新加坡'] },
    { code: 'HK', en: 'Hong Kong', names: ['hk', 'hong kong', '香港'] },
    { code: 'TW', en: 'Taiwan', names: ['tw', 'taiwan', '台湾', '台灣'] }
  ];

  var KEY_POOL = 'addrPool';
  var KEY_LAST_TEXT = 'lastText';
  var KEY_EMAIL = 'email';
  var KEY_PREFS = 'prefs';
  var POOL_MAX = 60;

  /* -------- 地址生成数据表（移植自 kxnotes/Real-US-Address-Generator，MIT） -------- */

  // 每个州一个参考坐标，撒点半径 ±0.02°（约 2 公里，落城区才有门牌号）
  var STATE_COORDS = {
    AL: [33.52, -86.80], AK: [61.22, -149.90], AZ: [33.45, -112.07], AR: [34.75, -92.29],
    CA: [34.05, -118.24], CO: [39.74, -104.99], CT: [41.76, -72.68], DE: [39.75, -75.55],
    DC: [38.91, -77.04], FL: [25.76, -80.19], GA: [33.75, -84.39], HI: [21.31, -157.86],
    ID: [43.62, -116.20], IL: [41.88, -87.63], IN: [39.77, -86.16], IA: [41.59, -93.62],
    KS: [37.69, -97.34], KY: [38.25, -85.76], LA: [29.95, -90.07], ME: [43.66, -70.26],
    MD: [39.29, -76.61], MA: [42.36, -71.06], MI: [42.33, -83.05], MN: [44.98, -93.27],
    MS: [32.30, -90.18], MO: [39.10, -94.58], MT: [45.78, -108.50], NE: [41.26, -95.93],
    NV: [36.17, -115.14], NH: [42.99, -71.46], NJ: [40.74, -74.17], NM: [35.08, -106.65],
    NY: [40.71, -74.01], NC: [35.23, -80.84], ND: [46.88, -96.79], OH: [39.96, -83.00],
    OK: [35.47, -97.52], OR: [45.52, -122.68], PA: [39.95, -75.17], RI: [41.82, -71.41],
    SC: [34.00, -81.03], SD: [43.55, -96.73], TN: [36.16, -86.78], TX: [29.76, -95.37],
    UT: [40.76, -111.89], VT: [44.48, -73.21], VA: [37.54, -77.44], WA: [47.61, -122.33],
    WV: [38.35, -81.63], WI: [43.04, -87.91], WY: [41.14, -104.82]
  };

  // 各州主要区号，电话区号必须和地址州一致
  var AREA_CODES = {
    AL: ['205', '251', '256', '334'], AK: ['907'], AZ: ['480', '602', '623', '928'],
    AR: ['479', '501', '870'], CA: ['213', '310', '415', '619', '714', '805', '916', '949'],
    CO: ['303', '719', '720', '970'], CT: ['203', '860'], DE: ['302'], DC: ['202'],
    FL: ['305', '407', '561', '813', '904'], GA: ['404', '470', '678', '770'],
    HI: ['808'], ID: ['208'], IL: ['312', '618', '630', '708', '773', '815'],
    IN: ['219', '317', '574', '765', '812'], IA: ['319', '515', '563', '712'],
    KS: ['316', '620', '785', '913'], KY: ['270', '502', '606', '859'],
    LA: ['225', '318', '337', '504', '985'], ME: ['207'],
    MD: ['240', '301', '410', '443'], MA: ['413', '508', '617', '781', '978'],
    MI: ['231', '313', '517', '616', '734', '906'], MN: ['218', '320', '507', '612', '651', '763'],
    MS: ['228', '601', '662', '769'], MO: ['314', '417', '573', '636', '816'],
    MT: ['406'], NE: ['308', '402', '531'], NV: ['702', '725', '775'], NH: ['603'],
    NJ: ['201', '609', '732', '856', '908', '973'], NM: ['505', '575'],
    NY: ['212', '315', '516', '518', '585', '607', '631', '716', '718', '914'],
    NC: ['252', '336', '704', '828', '910', '919'], ND: ['701'],
    OH: ['216', '330', '419', '513', '614', '937'], OK: ['405', '539', '580', '918'],
    OR: ['503', '541', '971'], PA: ['215', '412', '484', '570', '610', '717', '724', '814'],
    RI: ['401'], SC: ['803', '843', '864'], SD: ['605'],
    TN: ['423', '615', '731', '865', '901', '931'],
    TX: ['214', '281', '325', '361', '409', '469', '512', '682', '713', '806', '817', '832', '903', '915', '936', '940', '956', '972'],
    UT: ['385', '435', '801'], VT: ['802'], VA: ['276', '434', '540', '571', '703', '757', '804'],
    WA: ['206', '253', '360', '425', '509'], WV: ['304', '681'],
    WI: ['262', '414', '608', '715', '920'], WY: ['307']
  };

  // 免销售税的五个州
  var TAX_FREE_STATES = ['OR', 'DE', 'MT', 'NH', 'AK'];

  var FIRST_NAMES = [
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
    'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
    'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle'
  ];

  var LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
    'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
    'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
    'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'
  ];

  /* ============================================================
   * 1.5 跨域名存储
   * localStorage 按域名隔离，A 商家粘的地址到 B 商家就没了。
   * GM_* 是脚本管理器的全局存储，所有商家共享。
   * ============================================================ */

  var Store = {
    get: function (key, def) {
      try {
        if (typeof GM_getValue === 'function') {
          var v = GM_getValue(key);
          if (v !== undefined && v !== null) return v;
          return def;
        }
      } catch (e) { /* ignore */ }
      try {
        var raw = localStorage.getItem('waf_' + key);
        return raw == null ? def : JSON.parse(raw);
      } catch (e) {
        return def;
      }
    },
    set: function (key, val) {
      try {
        if (typeof GM_setValue === 'function') { GM_setValue(key, val); return; }
      } catch (e) { /* ignore */ }
      try { localStorage.setItem('waf_' + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    },
    del: function (key) {
      try {
        if (typeof GM_deleteValue === 'function') { GM_deleteValue(key); return; }
      } catch (e) { /* ignore */ }
      try { localStorage.removeItem('waf_' + key); } catch (e) { /* ignore */ }
    }
  };

  // 把 v0.2 存在 localStorage 里的数据搬到新存储
  function migrateLegacy() {
    try {
      if (!Store.get(KEY_LAST_TEXT, '')) {
        var oldText = localStorage.getItem('whmcs_addr_filler_last_text');
        if (oldText) Store.set(KEY_LAST_TEXT, oldText);
      }
      if (!Store.get(KEY_EMAIL, '')) {
        var oldEmail = localStorage.getItem('whmcs_addr_filler_email');
        if (oldEmail) Store.set(KEY_EMAIL, oldEmail);
      }
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
   * 1.6 地址池
   * ============================================================ */

  function poolKeyOf(d) {
    if (!d) return '';
    return [d.lastName || '', d.postcode || '', d.address1 || '']
      .join('|').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function loadPool() {
    var arr = Store.get(KEY_POOL, []);
    return Array.isArray(arr) ? arr : [];
  }

  function savePool(arr) {
    Store.set(KEY_POOL, arr);
  }

  // 同一条地址（姓 + 邮编 + 街道相同）只保留一份
  function poolUpsert(d, raw) {
    if (!d || !d.firstName || !d.address1 || !d.postcode) return null;

    var key = poolKeyOf(d);
    var arr = loadPool();
    var i;

    for (i = 0; i < arr.length; i++) {
      if (poolKeyOf(arr[i].data) === key) {
        arr[i].data = d;
        if (raw) arr[i].raw = raw;
        savePool(arr);
        return arr[i];
      }
    }

    var item = {
      id: 'p' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      createdAt: Date.now(),
      lastUsedAt: 0,
      usedCount: 0,
      data: d,
      raw: raw || ''
    };
    arr.unshift(item);
    if (arr.length > POOL_MAX) arr = arr.slice(0, POOL_MAX);
    savePool(arr);
    return item;
  }

  function poolMarkUsed(id) {
    if (!id) return;
    var arr = loadPool();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr[i].usedCount = (arr[i].usedCount || 0) + 1;
        arr[i].lastUsedAt = Date.now();
        savePool(arr);
        return;
      }
    }
  }

  function poolRemove(id) {
    savePool(loadPool().filter(function (x) { return x.id !== id; }));
  }

  function poolFindByData(d) {
    var key = poolKeyOf(d);
    var arr = loadPool();
    for (var i = 0; i < arr.length; i++) {
      if (poolKeyOf(arr[i].data) === key) return arr[i];
    }
    return null;
  }

  // 优先挑从没用过的，其次挑最久没用的
  function poolPickFresh() {
    var arr = loadPool();
    if (!arr.length) return null;
    var best = arr[0];
    for (var i = 1; i < arr.length; i++) {
      var a = arr[i];
      if ((a.usedCount || 0) < (best.usedCount || 0)) best = a;
      else if ((a.usedCount || 0) === (best.usedCount || 0) && (a.lastUsedAt || 0) < (best.lastUsedAt || 0)) best = a;
    }
    return best;
  }

  /* ============================================================
   * 1.7 偏好设置
   * ============================================================ */

  var prefs = null;

  function loadPrefs() {
    var p = Store.get(KEY_PREFS, {});
    if (!p || typeof p !== 'object') p = {};
    if (typeof p.skipFilled !== 'boolean') p.skipFilled = false;
    if (typeof p.collapsed !== 'boolean') p.collapsed = false;
    if (!p.pos || typeof p.pos.x !== 'number' || typeof p.pos.y !== 'number') p.pos = null;
    return p;
  }

  function savePrefs() {
    if (!prefs) prefs = loadPrefs();
    Store.set(KEY_PREFS, prefs);
  }

  function timeAgo(ts) {
    if (!ts) return '未用过';
    var d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  /* ============================================================
   * 2. 基础工具
   * ============================================================ */

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function fireEvents(el) {
    ['input', 'change', 'keyup', 'blur'].forEach(function (type) {
      try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) { /* ignore */ }
    });
  }

  // 绕过 React / Vue 的 value 拦截，直接走原型 setter
  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function isFillable(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
    if (tag === 'input') {
      var t = (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'search'].indexOf(t) !== -1) return false;
    }
    if (el.disabled || el.readOnly) return false;
    if (!el.getClientRects().length) return false;
    return true;
  }

  /* ============================================================
   * 3. 文本解析
   * ============================================================ */

  var PHONE_RE = /(\+?\d[\d\s\-().]{6,}\d)/;

  function extractPhone(seg) {
    var m = seg.match(PHONE_RE);
    if (!m) return null;
    var raw = norm(m[1]);
    var digits = raw.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;

    var cc = '';
    var national = digits;
    if (/^\s*\+/.test(raw)) {
      if (digits.charAt(0) === '1' && digits.length === 11) {
        cc = '1';
        national = digits.slice(1);
      } else {
        cc = digits.slice(0, 2);
        national = digits.slice(2);
      }
    } else if (digits.length === 11 && digits.charAt(0) === '1') {
      cc = '1';
      national = digits.slice(1);
    }
    return { raw: raw, cc: cc, national: national };
  }

  function countryToCode(name) {
    var s = norm(name).toLowerCase();
    if (!s) return '';
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].names.indexOf(s) !== -1) return COUNTRIES[i].code;
    }
    for (var j = 0; j < COUNTRIES.length; j++) {
      var names = COUNTRIES[j].names;
      for (var k = 0; k < names.length; k++) {
        if (names[k].length > 3 && s.indexOf(names[k]) !== -1) return COUNTRIES[j].code;
      }
    }
    return '';
  }

  function stateToCode(name) {
    var s = norm(name);
    if (!s) return '';
    var up = s.toUpperCase();
    if (US_STATES[up]) return up;
    var low = s.toLowerCase();
    for (var code in US_STATES) {
      if (US_STATES[code].toLowerCase() === low) return code;
    }
    for (var c2 in US_STATES) {
      if (low.indexOf(US_STATES[c2].toLowerCase()) !== -1) return c2;
    }
    return '';
  }

  function setName(data, rawName) {
    var words = norm(rawName).replace(/[|,]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return;
    if (words.length === 1) {
      data.firstName = words[0];
      return;
    }
    data.firstName = words[0];
    data.lastName = words[words.length - 1];
  }

  function parseAddress(str, data) {
    var parts = String(str).split(',').map(norm).filter(Boolean);
    if (!parts.length) return;

    // 尾部国家（不含数字才可能是国家）
    if (parts.length > 1) {
      var last = parts[parts.length - 1];
      if (!/\d/.test(last)) {
        var cc = countryToCode(last);
        if (cc) {
          var info = COUNTRIES.filter(function (c) { return c.code === cc; })[0];
          data.countryCode = cc;
          data.country = info ? info.en : last;
          parts.pop();
        }
      }
    }

    // 尾部「州 + 邮编」
    if (parts.length) {
      var tail = parts[parts.length - 1];
      var mZip = tail.match(/\b(\d{5}(?:-\d{4})?)\b/);
      if (mZip) {
        data.postcode = mZip[1];
        var rest = norm(tail.replace(mZip[0], '')).replace(/^[,\s]+|[,\s]+$/g, '');
        if (rest && !/^\d+$/.test(rest)) {
          var code = stateToCode(rest);
          data.stateCode = code;
          data.state = code ? US_STATES[code] : rest;
        }
        parts.pop();
      }
    }

    // 只有州没有邮编的情况
    if (parts.length > 1 && !data.state) {
      var maybe = parts[parts.length - 1];
      if (!/\d/.test(maybe)) {
        var code2 = stateToCode(maybe);
        if (code2) {
          data.stateCode = code2;
          data.state = US_STATES[code2];
          parts.pop();
        }
      }
    }

    if (parts.length > 1) data.city = parts.pop();
    data.address1 = parts.shift() || '';
    data.address2 = parts.join(', ');
  }

  function parseResult(raw) {
    var data = {
      firstName: '', lastName: '', phone: '', phoneCC: '', phoneNational: '',
      email: '', company: '', address1: '', address2: '', city: '',
      state: '', stateCode: '', postcode: '', country: '', countryCode: ''
    };
    if (!raw || !String(raw).trim()) return data;

    var text = String(raw)
      .replace(/\r/g, '')
      .replace(/｜/g, '|')
      .replace(/（/g, '(')
      .replace(/）/g, ')');

    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var pipeLine = null;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('|') !== -1) { pipeLine = lines[i]; break; }
    }
    var segs = pipeLine
      ? pipeLine.split('|').map(function (s) { return s.trim(); }).filter(Boolean)
      : lines.slice();

    var addrSegs = [];

    for (var n = 0; n < segs.length; n++) {
      var seg = segs[n];

      // 标题行
      if (/^(address\s*result|result|地址结果|生成结果|分享)$/i.test(seg)) continue;

      // [US] 姓名
      var mTag = seg.match(/^\[([A-Za-z]{2})\]\s*(.+)$/);
      if (mTag) {
        var cc = mTag[1].toUpperCase();
        var cinfo = COUNTRIES.filter(function (c) { return c.code === cc; })[0];
        if (cinfo) {
          data.countryCode = cc;
          data.country = cinfo.en;
        }
        if (!data.firstName) setName(data, mTag[2]);
        continue;
      }

      // 邮箱
      var mEmail = seg.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
      if (mEmail && !data.email) {
        data.email = mEmail[0];
        continue;
      }

      // 电话
      if (!data.phone) {
        var ph = extractPhone(seg);
        if (ph) {
          data.phone = ph.raw;
          data.phoneCC = ph.cc;
          data.phoneNational = ph.national;
          continue;
        }
      }

      addrSegs.push(seg);
    }

    if (addrSegs.length) parseAddress(addrSegs.join(', '), data);
    return data;
  }

  /* ============================================================
   * 4. 表单字段定位（三级降级）
   * ============================================================ */

  var FIELD_SPECS = {
    firstName: {
      label: '名字',
      ids: ['inputFirstName'],
      names: ['firstname', 'first_name', 'fname', 'givenname'],
      ph: ['名字', 'first name', 'firstname'],
      tx: ['名字', 'first name']
    },
    lastName: {
      label: '姓氏',
      ids: ['inputLastName'],
      names: ['lastname', 'last_name', 'lname', 'surname'],
      ph: ['姓氏', 'last name', 'lastname'],
      tx: ['姓氏', 'last name']
    },
    email: {
      label: '邮箱',
      ids: ['inputEmail'],
      names: ['email', 'emailaddress'],
      ph: ['email', '邮箱', '電子郵件', '电子邮件', '邮件地址'],
      tx: ['email', '邮箱', '電子郵件']
    },
    phone: {
      label: '电话',
      ids: ['inputPhoneNumber'],
      names: ['phonenumber', 'phone', 'telephone', 'tel'],
      ph: ['电话', '電話', 'phone', 'telephone'],
      tx: ['电话', '電話', 'phone']
    },
    company: {
      label: '公司',
      ids: ['inputCompanyName'],
      names: ['companyname', 'company'],
      ph: ['公司', 'company'],
      tx: ['公司', 'company']
    },
    address1: {
      label: '街道地址',
      ids: ['inputAddress1'],
      names: ['address1'],
      ph: ['街道地址', '街道', 'street address', 'address 1'],
      tx: ['街道地址', 'street address'],
      exclude: ['2', '二']
    },
    address2: {
      label: '街道地址2',
      ids: ['inputAddress2'],
      names: ['address2'],
      ph: ['街道地址 2', '街道地址2', '街道2', 'address 2', 'address2'],
      tx: ['街道地址 2', 'address 2']
    },
    city: {
      label: '城市',
      ids: ['inputCity'],
      names: ['city'],
      ph: ['城市', 'city'],
      tx: ['城市', 'city']
    },
    state: {
      label: '州',
      ids: ['inputState'],
      names: ['state', 'province', 'region'],
      ph: ['州别', '州別', '州', '省份', 'state', 'province'],
      tx: ['州别', '州別', '省份', 'state']
    },
    postcode: {
      label: '邮编',
      ids: ['inputPostcode'],
      names: ['postcode', 'zip', 'zipcode', 'postalcode'],
      ph: ['邮递区号', '郵遞區號', '邮编', '郵編', 'zip', 'postal'],
      tx: ['邮递区号', '郵遞區號', '邮编', 'zip']
    },
    country: {
      label: '国家',
      ids: ['inputCountry'],
      names: ['country'],
      ph: ['国家', '國家', 'country'],
      tx: ['国家', '國家', 'country']
    }
  };

  // 定位顺序：先定位特征明确的，再定位容易混淆的
  // 州（state）不在这里 —— 它由 findStateEl 独立处理，因为会被页面重建
  var LOCATE_ORDER = [
    'firstName', 'lastName', 'email', 'phone', 'company',
    'country', 'postcode', 'city', 'address2', 'address1'
  ];

  function labelTextOf(el) {
    var parts = [];
    if (el.id) {
      try {
        var l = document.querySelector('label[for="' + el.id + '"]');
        if (l) parts.push(l.textContent);
      } catch (e) { /* ignore */ }
    }
    var wrap = el.closest ? el.closest('label') : null;
    if (wrap) parts.push(wrap.textContent);

    var prev = el.previousElementSibling;
    var guard = 0;
    while (prev && guard < 3) {
      var t = norm(prev.textContent);
      if (t && t.length < 40 && prev.children.length === 0) parts.push(t);
      prev = prev.previousElementSibling;
      guard++;
    }
    return norm(parts.join(' ')).slice(0, 80);
  }

  function scoreField(el, spec) {
    var ph = (el.getAttribute('placeholder') || '').toLowerCase();
    var nm = (el.getAttribute('name') || '').toLowerCase();
    var id = (el.id || '').toLowerCase();
    var tx = labelTextOf(el).toLowerCase();
    var score = 0;

    var excl = spec.exclude || [];
    for (var e = 0; e < excl.length; e++) {
      if (ph.indexOf(excl[e].toLowerCase()) !== -1) return -999;
    }

    var i;
    for (i = 0; i < (spec.names || []).length; i++) {
      if (nm === spec.names[i] || id === spec.names[i]) score += 20;
    }
    for (i = 0; i < (spec.ph || []).length; i++) {
      if (ph && ph.indexOf(spec.ph[i].toLowerCase()) !== -1) score += 10;
    }
    for (i = 0; i < (spec.tx || []).length; i++) {
      if (tx && tx.indexOf(spec.tx[i].toLowerCase()) !== -1) score += 8;
    }
    return score;
  }

  function locateField(spec, used) {
    var i, el;

    for (i = 0; i < (spec.ids || []).length; i++) {
      el = document.getElementById(spec.ids[i]);
      if (el && isFillable(el) && !used.has(el)) return el;
    }

    var all = Array.prototype.slice.call(document.querySelectorAll('input, textarea, select'))
      .filter(isFillable)
      .filter(function (x) { return !used.has(x); });

    var best = null;
    var bestScore = 0;
    for (i = 0; i < all.length; i++) {
      var s = scoreField(all[i], spec);
      if (s > bestScore) {
        bestScore = s;
        best = all[i];
      }
    }
    return bestScore >= 8 ? best : null;
  }

  function locateAll() {
    var used = new Set();
    var found = {};
    for (var i = 0; i < LOCATE_ORDER.length; i++) {
      var key = LOCATE_ORDER[i];
      var spec = FIELD_SPECS[key];
      if (!spec) continue;
      var el = locateField(spec, used);
      if (el) {
        found[key] = el;
        used.add(el);
      }
    }
    return found;
  }

  /* ============================================================
   * 5. select 赋值 + 联动等待
   * ============================================================ */

  function findOptionIndex(sel, cands) {
    if (!sel || sel.tagName !== 'SELECT') return -1;
    var opts = Array.prototype.slice.call(sel.options || []);
    var i, c;
    for (i = 0; i < cands.length; i++) {
      c = norm(cands[i]).toLowerCase();
      if (!c) continue;
      for (var j = 0; j < opts.length; j++) {
        if (norm(opts[j].value).toLowerCase() === c) return j;
      }
      for (var k = 0; k < opts.length; k++) {
        if (norm(opts[k].textContent).toLowerCase() === c) return k;
      }
    }
    return -1;
  }

  function setSelectByCandidates(sel, cands) {
    if (!sel || sel.tagName !== 'SELECT') return false;
    var idx = findOptionIndex(sel, cands);
    if (idx < 0) return false;
    sel.selectedIndex = idx;
    fireEvents(sel);
    return true;
  }

  // 州字段在国内切换后会被 WHMCS 整个重建（替换节点），
  // 所以绝不能缓存引用，每次都重新查 DOM。
  function findStateEl() {
    var el = document.getElementById('inputState');
    if (el && el.tagName === 'SELECT') return el;

    var sels = Array.prototype.slice.call(document.querySelectorAll('select'));

    // 最强特征：选项里同时有 Alabama 和 Wyoming 的下拉一定是美国州
    // 只排除超长列表（250 个国家那种）以免白拼字符串，短列表照样要认
    for (var i = 0; i < sels.length; i++) {
      if (sels[i].options.length > 100) continue;

      var txt = '';
      var opts = sels[i].options;
      for (var k = 0; k < opts.length; k++) txt += opts[k].textContent + '|';
      if (/Alabama/i.test(txt) && /Wyoming/i.test(txt)) return sels[i];
    }

    var byName = document.querySelector('select[name="state" i], select[name="province" i]');
    if (byName) return byName;

    var inputByName = document.querySelector('input[name="state" i], input[name="province" i]');
    if (inputByName) return inputByName;

    for (var j = 0; j < sels.length; j++) {
      var meta = (sels[j].getAttribute('placeholder') || '') + ' ' + (sels[j].getAttribute('name') || '');
      if (/(州|省份|state|province|region)/i.test(meta)) return sels[j];
    }

    // 兜底：选项数在 50~70 之间的下拉，多半是美国州列表
    for (var m = 0; m < sels.length; m++) {
      var n = sels[m].options.length;
      if (n >= 50 && n <= 70) return sels[m];
    }

    var all = Array.prototype.slice.call(document.querySelectorAll('input, select'));
    var best = null;
    var bestScore = 0;
    for (var p = 0; p < all.length; p++) {
      var sc = scoreField(all[p], FIELD_SPECS.state);
      if (sc > bestScore) { bestScore = sc; best = all[p]; }
    }
    return bestScore >= 8 ? best : null;
  }

  function isStateSelected(el, cands) {
    if (!el) return false;
    var i, c;

    if (el.tagName !== 'SELECT') {
      var v = norm(el.value).toLowerCase();
      for (i = 0; i < cands.length; i++) {
        c = norm(cands[i]).toLowerCase();
        if (v && c && v === c) return true;
      }
      return false;
    }

    var opt = el.options[el.selectedIndex];
    if (!opt) return false;
    var ov = norm(opt.value).toLowerCase();
    var ot = norm(opt.textContent).toLowerCase();
    for (i = 0; i < cands.length; i++) {
      c = norm(cands[i]).toLowerCase();
      if (c && (c === ov || c === ot)) return true;
    }
    return false;
  }

  // 返回 true / 'no-el' / 'no-option' / 'rejected'
  function trySelectState(cands) {
    var el = findStateEl();
    if (!el) return 'no-el';

    if (el.tagName !== 'SELECT') {
      if (isStateSelected(el, cands)) return true;
      setNativeValue(el, cands[1] || cands[0] || '');
      fireEvents(el);
      return isStateSelected(el, cands) ? true : 'rejected';
    }

    if (isStateSelected(el, cands)) return true;

    var idx = findOptionIndex(el, cands);
    if (idx < 0) return 'no-option';

    // 两种赋值方式都做一遍，兼容不同主题
    var targetValue = el.options[idx].value;
    el.value = targetValue;
    if (el.selectedIndex !== idx) el.selectedIndex = idx;
    fireEvents(el);

    return isStateSelected(el, cands) ? true : 'rejected';
  }

  // 反复尝试直到选中，并守护 0.8 秒确认没被页面异步重置
  function ensureStateSelected(cands, totalMs) {
    var limit = totalMs || 6000;

    return new Promise(function (resolve) {
      var start = Date.now();
      var lastReason = 'no-el';

      (function loop() {
        var r = trySelectState(cands);

        if (r === true) {
          var guardStart = Date.now();
          (function guard() {
            var el = findStateEl();
            if (!el || !isStateSelected(el, cands)) {
              if (Date.now() - start >= limit) { resolve({ ok: false, reason: 'reset' }); return; }
              setTimeout(loop, 150);
              return;
            }
            if (Date.now() - guardStart >= 800) { resolve({ ok: true, reason: 'ok' }); return; }
            setTimeout(guard, 130);
          })();
          return;
        }

        lastReason = r;
        if (Date.now() - start >= limit) {
          resolve({ ok: false, reason: lastReason });
          return;
        }
        setTimeout(loop, 150);
      })();
    });
  }

  // 尝试把电话前缀切到美国，找不到就放弃
  function trySetPhoneCountryCode() {
    var selects = Array.prototype.slice.call(document.querySelectorAll('select'));
    for (var i = 0; i < selects.length; i++) {
      var s = selects[i];
      var opts = Array.prototype.slice.call(s.options || []);
      if (opts.length < 5) continue;

      var usIdx = -1;
      var hasDialCode = false;
      for (var j = 0; j < opts.length; j++) {
        var t = opts[j].textContent || '';
        if (/united states|美国|美國/i.test(t)) usIdx = j;
        if (/^\s*\+?\d{1,4}\s/.test(t) && /[a-z]/i.test(t)) hasDialCode = true;
      }
      if (usIdx >= 0 && hasDialCode) {
        s.selectedIndex = usIdx;
        fireEvents(s);
        return true;
      }
    }
    return false;
  }

  // 填过的字段描边高亮，方便一眼确认填到哪儿了
  var FLASH_MS = 15000;

  function flash(el, ms) {
    if (!el || el.nodeType !== 1) return;

    // 同一字段被重复填充时，别把我们自己加的高亮当成原样式存下来
    if (!el.__wafFlashTimer) {
      el.__wafFlashPrev = {
        outline: el.style.outline,
        offset: el.style.outlineOffset
      };
    } else {
      clearTimeout(el.__wafFlashTimer);
    }

    el.style.outline = '2px solid rgba(37,99,235,.55)';
    el.style.outlineOffset = '1px';

    el.__wafFlashTimer = setTimeout(function () {
      var prev = el.__wafFlashPrev;
      el.style.outline = prev ? prev.outline : '';
      el.style.outlineOffset = prev ? prev.offset : '';
      el.__wafFlashTimer = null;
      el.__wafFlashPrev = null;
    }, ms || FLASH_MS);
  }

  /* ============================================================
   * 6. 填充主流程
   * ============================================================ */

  function applyToPage(data, opts) {
    opts = opts || {};
    var located = locateAll();
    var result = { filled: [], missing: [], notes: [] };

    var countryCands = [];
    if (data.countryCode) countryCands.push(data.countryCode);
    if (data.country) countryCands.push(data.country);
    for (var ci = 0; ci < COUNTRIES.length; ci++) {
      if (COUNTRIES[ci].code === data.countryCode) {
        countryCands = countryCands.concat(COUNTRIES[ci].names);
      }
    }
    countryCands = countryCands.filter(Boolean);

    // 6.1 先填国家（会触发州列表重载）
    if (countryCands.length) {
      if (located.country && located.country.tagName === 'SELECT') {
        if (setSelectByCandidates(located.country, countryCands)) {
          result.filled.push('国家');
          flash(located.country);
        } else {
          result.missing.push('国家（下拉里没有该选项）');
        }
      } else if (located.country) {
        setNativeValue(located.country, data.country || data.countryCode);
        fireEvents(located.country);
        flash(located.country);
        result.filled.push('国家');
      } else {
        result.missing.push('国家');
      }
    }

    // 6.2 再填州（下拉会被页面重建，每次重新查找元素）
    var stateCands = [data.stateCode, data.state].filter(Boolean);
    var stateDone = stateCands.length
      ? ensureStateSelected(stateCands, 6000)
      : Promise.resolve({ ok: false, reason: 'none' });

    // 6.3 文本字段（不依赖州，先填完让用户立刻看到效果）
    var textFields = [
      ['firstName', data.firstName, '名字'],
      ['lastName', data.lastName, '姓氏'],
      ['email', data.email, '邮箱'],
      ['company', data.company, '公司'],
      ['address1', data.address1, '街道地址'],
      ['address2', data.address2, '街道地址2'],
      ['city', data.city, '城市'],
      ['postcode', data.postcode, '邮编']
    ];

    textFields.forEach(function (row) {
      var key = row[0];
      var val = row[1];
      var label = row[2];
      if (!val) return;

      var el = located[key];
      if (!el) {
        result.missing.push(label);
        return;
      }
      if (opts.skipFilled && norm(el.value)) {
        result.notes.push(label + '（已有内容，跳过）');
        return;
      }
      setNativeValue(el, val);
      fireEvents(el);
      flash(el);
      result.filled.push(label);
    });

    // 6.4 电话单独处理
    if (data.phone) {
      if (!located.phone) {
        result.missing.push('电话');
      } else if (opts.skipFilled && norm(located.phone.value)) {
        result.notes.push('电话（已有内容，跳过）');
      } else {
        var switched = data.phoneCC === '1' ? trySetPhoneCountryCode() : false;
        var phoneVal = (switched && data.phoneNational) ? data.phoneNational : data.phone;
        setNativeValue(located.phone, phoneVal);
        fireEvents(located.phone);
        flash(located.phone);
        result.filled.push('电话');
        if (!switched && data.phoneCC === '1') {
          result.notes.push('电话前缀未自动切换，已填完整号码，请手动把 +886 改成 +1');
        }
      }
    }

    // 6.5 最后汇总州的结果（它在后台一直守护着重试）
    return stateDone.then(function (st) {
      if (stateCands.length) {
        if (st.ok) {
          result.filled.push('州');
          flash(findStateEl());
        } else if (st.reason === 'no-el') {
          result.missing.push('州（没找到州的下拉框）');
        } else if (st.reason === 'no-option') {
          result.missing.push('州（下拉里没有 ' + stateCands.join(' / ') + '）');
        } else {
          result.missing.push('州（选中后被页面重置，可再点一次填入）');
        }
      }
      return result;
    });
  }

  /* ============================================================
   * 6.5 地址生成
   *     核心思路移植自 kxnotes/Real-US-Address-Generator (MIT)
   *     方案 A：油猴直连 OpenStreetMap Nominatim
   * ============================================================ */

  var GEN_MIN_INTERVAL = 1500;  // 政策绝对上限 1 req/s，这里留足余量
  var GEN_MAX_TRY = 6;
  var lastGenReqAt = 0;
  var generating = false;

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function httpGetJson(url) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: { 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
          timeout: 12000,
          onload: function (res) {
            if (res.status >= 200 && res.status < 300) {
              try { resolve(JSON.parse(res.responseText)); }
              catch (e) { reject(new Error('返回内容不是 JSON')); }
            } else {
              reject(new Error('HTTP ' + res.status));
            }
          },
          onerror: function () { reject(new Error('网络请求失败')); },
          ontimeout: function () { reject(new Error('请求超时')); }
        });
        return;
      }
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(resolve).catch(reject);
    });
  }

  function throttleGen() {
    var wait = GEN_MIN_INTERVAL - (Date.now() - lastGenReqAt);
    return wait <= 0 ? Promise.resolve() : sleep(wait);
  }

  function buildApiUrl(lat, lon) {
    var base = (prefs && prefs.apiBase) ? String(prefs.apiBase) : '';
    if (base) {
      // 方案 B：自建 Worker，约定返回 { address: {...} } 同结构 JSON
      return base + (base.indexOf('?') >= 0 ? '&' : '?') +
        'format=json&zoom=18&addressdetails=1&lat=' + lat + '&lon=' + lon;
    }
    return 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1' +
      '&lat=' + lat + '&lon=' + lon;
  }

  // 原项目只认 data.address.city，农村地区返回 town/village/hamlet 就判失败，
  // 这是它需要重试 20 次的主因，这里补齐回退
  function cityOf(addr) {
    return addr.city || addr.town || addr.village || addr.hamlet ||
      addr.suburb || addr.city_district || addr.municipality || '';
  }

  async function generateOne(stateCode, onProgress) {
    var c = STATE_COORDS[stateCode] || STATE_COORDS.OR;
    var lastErr = '';
    var netFail = 0;

    for (var i = 1; i <= GEN_MAX_TRY; i++) {
      if (onProgress) onProgress(i, GEN_MAX_TRY);

      var lat = (c[0] + (Math.random() - 0.5) * 0.04).toFixed(6);
      var lon = (c[1] + (Math.random() - 0.5) * 0.04).toFixed(6);

      await throttleGen();
      lastGenReqAt = Date.now();

      var json;
      try {
        json = await httpGetJson(buildApiUrl(lat, lon));
      } catch (e) {
        netFail++;
        lastErr = e && e.message ? e.message : '请求失败';
        // 连续连不上就别死等了，直接告诉用户是网络问题
        if (netFail >= 3) {
          throw new Error('连不上 OpenStreetMap（' + lastErr +
            '），很可能是你的网络访问不了 nominatim.openstreetmap.org。\n' +
            '可以：1) 换个网络再试；2) 去上面那个网站手动复制地址粘贴进来。');
        }
        continue;
      }
      netFail = 0;

      var a = json && json.address;
      if (!a) { lastErr = '没返回地址详情'; continue; }
      if ((a.country_code || '').toLowerCase() !== 'us') { lastErr = '拿到的不是美国地址'; continue; }
      if (!a.house_number) { lastErr = '缺门牌号'; continue; }
      if (!a.road) { lastErr = '缺街道名'; continue; }

      var city = cityOf(a);
      if (!city) { lastErr = '缺城市名'; continue; }
      // 邮编是 WHMCS 注册必填项，缺了这条地址就没用
      if (!a.postcode) { lastErr = '缺邮编'; continue; }

      return buildProfile(a, city, stateCode);
    }

    throw new Error('试了 ' + GEN_MAX_TRY + ' 次都没拿到合格地址' +
      (lastErr ? '（最后一次：' + lastErr + '）' : '') +
      '\n可以再点一次，或去上面那个网站手动复制地址粘贴进来。');
  }

  // 北美编号计划里交换码中间位不能是 1（那是 N11 服务号）
  function randomExchange() {
    var n;
    do { n = 200 + Math.floor(Math.random() * 800); } while (String(n).charAt(1) === '1');
    return String(n);
  }

  function buildProfile(a, city, stateCode) {
    var codes = AREA_CODES[stateCode] || [];
    var area = codes.length ? pick(codes) : '555';
    var exchange = randomExchange();
    var line = String(1000 + Math.floor(Math.random() * 9000));

    return {
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_NAMES),
      phone: '+1 (' + area + ') ' + exchange + '-' + line,
      phoneCC: '1',
      phoneNational: area + exchange + line,
      email: '',
      company: '',
      address1: (a.house_number + ' ' + a.road).trim(),
      address2: '',
      city: city,
      state: US_STATES[stateCode] || '',
      stateCode: stateCode,
      postcode: a.postcode || '',
      country: 'United States',
      countryCode: 'US'
    };
  }

  /* ============================================================
   * 7. 界面
   * ============================================================ */

  var PREVIEW_FIELDS = [
    ['firstName', '名'], ['lastName', '姓'],
    ['phone', '电话'], ['email', '邮箱'],
    ['address1', '街道'], ['address2', '街道2'],
    ['city', '城市'], ['state', '州'],
    ['postcode', '邮编'], ['country', '国家']
  ];

  var CSS = [
    ':host{all:initial}',
    '.fab{position:fixed;right:24px;bottom:24px;width:46px;height:46px;border-radius:50%;',
    'background:#2563eb;color:#fff;font:600 13px/46px system-ui,-apple-system,"Segoe UI",sans-serif;',
    'text-align:center;cursor:grab;box-shadow:0 4px 14px rgba(37,99,235,.4);z-index:2147483000;',
    'user-select:none;letter-spacing:.5px}',
    '.fab:hover{background:#1d4ed8}',
    '.fab.dragging{cursor:grabbing;opacity:.85}',

    '.panel{position:fixed;right:24px;bottom:82px;width:376px;max-height:84vh;display:flex;',
    'flex-direction:column;background:#fff;border:1px solid #e2e8f0;border-radius:14px;',
    'z-index:2147483001;box-shadow:0 12px 40px rgba(15,23,42,.18);overflow:hidden;',
    'font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#0f172a}',
    '.panel[hidden]{display:none}',

    '.head{display:flex;align-items:center;justify-content:space-between;gap:8px;',
    'padding:9px 12px;border-bottom:1px solid #eef2f7;background:#fbfdff;cursor:move;',
    'user-select:none;flex:0 0 auto}',
    '.head.dragging{cursor:grabbing}',
    '.title{font-weight:500;font-size:13px;color:#0f172a}',
    '.hacts{display:flex;gap:2px}',
    '.hbtn{background:none;border:none;font-size:15px;line-height:1;color:#94a3b8;',
    'cursor:pointer;padding:2px 6px;border-radius:5px}',
    '.hbtn:hover{color:#475569;background:#eef2f7}',

    '.body{padding:12px;overflow:auto;flex:1 1 auto}',
    '.body[hidden]{display:none}',

    '.tip{display:block;text-decoration:none;background:#eff6ff;border:1px solid #dbeafe;',
    'border-radius:9px;padding:7px 10px;margin-bottom:10px;transition:background .15s}',
    '.tip:hover{background:#dbeafe}',
    '.tip-top{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.tip-name{font-size:12px;font-weight:500;color:#1e40af}',
    '.tip-go{font-size:11px;color:#2563eb;white-space:nowrap}',
    '.tip-url{font-size:11px;color:#60a5fa;margin-top:2px;word-break:break-all}',

    '.gen{display:flex;gap:6px;align-items:center;margin-bottom:10px}',
    '.gen select{flex:1;min-width:0;border:1px solid #dbe3ee;border-radius:7px;padding:5px 7px;',
    'font:12px system-ui,sans-serif;color:#0f172a;background:#fff;outline:none}',
    '.gen select:focus{border-color:#93c5fd}',
    '.gen button{border:1px solid #dbe3ee;background:#fff;border-radius:7px;padding:5px 10px;',
    'font:12px system-ui,sans-serif;color:#334155;cursor:pointer;white-space:nowrap}',
    '.gen button:hover:not(:disabled){background:#f4f8fd;border-color:#bfd7f5}',
    '.gen button:disabled{color:#cbd5e1;cursor:default}',
    '.gen button.go{background:#0f766e;border-color:#0f766e;color:#fff}',
    '.gen button.go:hover:not(:disabled){background:#0d9488;border-color:#0d9488}',

    '.pool{border:1px solid #e8eef6;border-radius:9px;margin-bottom:10px;background:#fcfdff;overflow:hidden}',
    '.phead{display:flex;align-items:center;gap:6px;padding:6px 9px;cursor:pointer;user-select:none}',
    '.phead:hover{background:#f4f8fd}',
    '.ptitle{font-size:12px;color:#475569;font-weight:500}',
    '.pcount{font-size:10.5px;color:#fff;background:#94a3b8;border-radius:9px;padding:0 6px;line-height:16px}',
    '.pacts{margin-left:auto;display:flex;gap:3px;align-items:center}',
    '.pbtn{border:none;background:none;font-size:11px;color:#2563eb;cursor:pointer;',
    'padding:1px 6px;border-radius:4px}',
    '.pbtn:hover{background:#e0edff}',
    '.pbtn:disabled{color:#cbd5e1;cursor:default;background:none}',
    '.pbtn.arm{color:#fff;background:#ef4444}',
    '.pbtn.arm:hover{background:#dc2626}',
    '.pcaret{font-size:9px;color:#94a3b8;width:10px;text-align:center}',
    '.plist{border-top:1px solid #eef2f7;max-height:170px;overflow:auto}',
    '.plist[hidden]{display:none}',
    '.pitem{display:flex;align-items:center;gap:7px;padding:6px 9px;border-bottom:1px solid #f4f7fb;cursor:pointer}',
    '.pitem:last-child{border-bottom:none}',
    '.pitem:hover{background:#f4f8fd}',
    '.pinfo{min-width:0;flex:1}',
    '.pname{font-size:12px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.psub{font-size:10.5px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pdel{border:none;background:none;color:#cbd5e1;font-size:14px;cursor:pointer;',
    'padding:0 4px;line-height:1;border-radius:4px}',
    '.pdel:hover{color:#ef4444;background:#fef2f2}',
    '.pdel.arm{padding:1px 7px;font-size:11px;line-height:16px;color:#fff;background:#ef4444}',
    '.pdel.arm:hover{color:#fff;background:#dc2626}',
    '.pempty{padding:12px 10px;font-size:11.5px;color:#94a3b8;text-align:center;line-height:1.6}',

    'textarea{width:100%;box-sizing:border-box;border:1px solid #dbe3ee;border-radius:8px;padding:8px 10px;',
    'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;resize:vertical;color:#0f172a;',
    'background:#f8fafc;outline:none}',
    'textarea:focus{border-color:#93c5fd;background:#fff}',

    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;margin:10px 0}',
    '.cell{display:flex;align-items:center;gap:6px;min-width:0}',
    '.cell label{flex:0 0 40px;font-size:11px;color:#64748b;text-align:right}',
    '.cell input{flex:1;min-width:0;border:1px solid #e5ebf3;border-radius:6px;padding:4px 7px;',
    'font:12px system-ui,sans-serif;color:#0f172a;background:#fbfdff;outline:none}',
    '.cell input:focus{border-color:#93c5fd;background:#fff}',
    '.cell input.bad{border-color:#fca5a5;background:#fef2f2}',

    '.row{display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap}',
    'button.b{border:1px solid #dbe3ee;background:#fff;border-radius:8px;padding:7px 12px;',
    'font:13px system-ui,sans-serif;color:#334155;cursor:pointer}',
    'button.b:hover{background:#f8fafc}',
    'button.primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:500;flex:1}',
    'button.primary:hover{background:#1d4ed8}',
    'button.ghost{border-color:transparent;color:#94a3b8;padding:7px 6px;font-size:12px}',
    'button.ghost:hover{color:#475569;background:#f1f5f9}',

    '.chk{display:flex;align-items:center;gap:5px;font-size:12px;color:#64748b;cursor:pointer;margin-top:8px}',
    '.chk input{accent-color:#2563eb}',

    '.status{margin-top:9px;padding:8px 10px;border-radius:8px;background:#f1f5f9;',
    'font-size:12px;color:#475569;line-height:1.6;word-break:break-word;white-space:pre-wrap}',
    '.status.ok{background:#ecfdf5;color:#047857}',
    '.status.warn{background:#fffbeb;color:#b45309}',
    '.status.err{background:#fef2f2;color:#b91c1c}'
  ].join('');

  var shadow = null;
  var ui = {};

  function buildPanel() {
    var host = document.createElement('div');
    host.id = 'whmcs-addr-filler-host';
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML = [
      '<div class="fab" id="fab" title="地址快速填充 (Alt+F)">填充</div>',
      '<div class="panel" id="panel" hidden>',
      '  <div class="head" id="head">',
      '    <span class="title">注册表单快速填充</span>',
      '    <div class="hacts">',
      '      <button class="hbtn" id="collapse" title="折叠 / 展开">&#8722;</button>',
      '      <button class="hbtn" id="close" title="关闭">&times;</button>',
      '    </div>',
      '  </div>',
      '  <div class="body" id="body">',
      '    <a class="tip" href="https://usaddressgen.com/tax-free-address/" target="_blank" rel="noopener noreferrer">',
      '      <div class="tip-top">',
      '        <span class="tip-name">美国免税州地址生成器</span>',
      '        <span class="tip-go">打开 ↗</span>',
      '      </div>',
      '      <div class="tip-url">https://usaddressgen.com/tax-free-address/</div>',
      '    </a>',
      '    <div class="gen">',
      '      <select id="genState" title="选择生成地址所在的州"></select>',
      '      <button id="genOne" class="go">生成</button>',
      '      <button id="genBatch" title="一次生成 5 条，全部存入地址池">+5</button>',
      '    </div>',
      '    <div class="pool">',
      '      <div class="phead" id="phead">',
      '        <span class="ptitle">地址池</span>',
      '        <span class="pcount" id="pcount">0</span>',
      '        <div class="pacts">',
      '          <button class="pbtn" id="ppick" title="挑一条用得最少的">随机</button>',
      '          <button class="pbtn" id="pclear" title="清空地址池">清空</button>',
      '          <span class="pcaret" id="pcaret">&#9662;</span>',
      '        </div>',
      '      </div>',
      '      <div class="plist" id="plist" hidden></div>',
      '    </div>',
      '    <textarea id="src" rows="3" spellcheck="false"',
      '      placeholder="粘贴生成结果，例如：&#10;[US] Leatha Jast | +1 (971) 927-1618 | 427 Center Street Northeast, Salem, Oregon 97301, United States"></textarea>',
      '    <div class="grid" id="grid"></div>',
      '    <label class="chk"><input type="checkbox" id="skip"> 跳过已有内容的字段</label>',
      '    <div class="row">',
      '      <button class="b primary" id="fill">填入页面</button>',
      '      <button class="b" id="clear">清空</button>',
      '      <button class="b ghost" id="diag">诊断页面</button>',
      '    </div>',
      '    <div class="status" id="status">粘贴后自动解析，确认字段无误再点填入</div>',
      '  </div>',
      '</div>'
    ].join('');
    shadow.appendChild(wrap);

    ui.fab = shadow.getElementById('fab');
    ui.panel = shadow.getElementById('panel');
    ui.head = shadow.getElementById('head');
    ui.body = shadow.getElementById('body');
    ui.collapseBtn = shadow.getElementById('collapse');
    ui.src = shadow.getElementById('src');
    ui.grid = shadow.getElementById('grid');
    ui.fillBtn = shadow.getElementById('fill');
    ui.clearBtn = shadow.getElementById('clear');
    ui.diagBtn = shadow.getElementById('diag');
    ui.skip = shadow.getElementById('skip');
    ui.status = shadow.getElementById('status');
    ui.close = shadow.getElementById('close');
    ui.phead = shadow.getElementById('phead');
    ui.pcount = shadow.getElementById('pcount');
    ui.pcaret = shadow.getElementById('pcaret');
    ui.plist = shadow.getElementById('plist');
    ui.ppick = shadow.getElementById('ppick');
    ui.pclear = shadow.getElementById('pclear');
    ui.genState = shadow.getElementById('genState');
    ui.genOne = shadow.getElementById('genOne');
    ui.genBatch = shadow.getElementById('genBatch');

    // 预览输入框
    ui.inputs = {};
    PREVIEW_FIELDS.forEach(function (f) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      var lb = document.createElement('label');
      lb.textContent = f[1];
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.dataset.key = f[0];
      inp.spellcheck = false;
      cell.appendChild(lb);
      cell.appendChild(inp);
      ui.grid.appendChild(cell);
      ui.inputs[f[0]] = inp;
    });

    bindEvents();
    initStateSelect();
    applyPrefs();
    restoreDraft();
    renderPool();
  }

  function setStatus(text, kind) {
    ui.status.className = 'status' + (kind ? ' ' + kind : '');
    ui.status.textContent = text;
  }

  var currentData = null;

  function renderPreview(data) {
    currentData = data;

    // 生成器给的邮箱是虚构域名收不到信，所以默认沿用你上次填的真实邮箱
    if (!String(data.email || '').trim()) {
      var savedEmail = readSavedEmail();
      if (savedEmail) data.email = savedEmail;
    }

    Object.keys(ui.inputs).forEach(function (k) {
      ui.inputs[k].value = data[k] == null ? '' : data[k];
    });

    // 标红没解析出来的关键字段
    ['firstName', 'lastName', 'address1', 'city'].forEach(function (k) {
      ui.inputs[k].classList.toggle('bad', !String(data[k] || '').trim());
    });

    var miss = [];
    if (!data.email) miss.push('邮箱');
    if (!data.stateCode && !data.state) miss.push('州');
    if (!data.postcode) miss.push('邮编');
    if (!data.phone) miss.push('电话');

    if (!data.firstName && !data.address1) {
      if (!norm(ui.src.value)) {
        // 空面板是常态，给引导而不是报错
        setStatus(loadPool().length
          ? '从地址池选一条，或点「生成」，或粘贴文本'
          : '点「生成」拿一条新地址，或粘贴文本', '');
      } else {
        setStatus('没从这段文本里解析出地址，检查一下格式', 'warn');
      }
    } else if (miss.length) {
      setStatus('已解析，但缺少：' + miss.join('、') + '（可手动补在下面）', 'warn');
    } else {
      setStatus('解析完成，确认无误后点「填入页面」', 'ok');
    }
  }

  function readPreview() {
    var data = {
      firstName: '', lastName: '', phone: '', phoneCC: '', phoneNational: '',
      email: '', company: '', address1: '', address2: '', city: '',
      state: '', stateCode: '', postcode: '', country: '', countryCode: ''
    };
    if (currentData) {
      data.phoneCC = currentData.phoneCC;
      data.phoneNational = currentData.phoneNational;
      data.countryCode = currentData.countryCode;
      data.stateCode = currentData.stateCode;
      data.phone = currentData.phone;
    }
    Object.keys(ui.inputs).forEach(function (k) {
      data[k] = norm(ui.inputs[k].value);
    });

    // 用户手动改过州/国家时，重新推算代码
    if (data.state) {
      var sc = stateToCode(data.state);
      if (sc) {
        data.stateCode = sc;
        data.state = US_STATES[sc];
      }
    }
    if (data.country) {
      var cc = countryToCode(data.country);
      if (cc) {
        data.countryCode = cc;
        var info = COUNTRIES.filter(function (c) { return c.code === cc; })[0];
        data.country = info ? info.en : data.country;
      }
    }
    // 电话没改就用原始完整号码
    if (!data.phone && currentData && currentData.phone) {
      data.phone = currentData.phone;
    }
    return data;
  }

  function doFill() {
    var data = readPreview();
    if (!data.firstName && !data.address1) {
      setStatus('没有可填的内容', 'warn');
      return;
    }

    if (data.email) saveEmail(data.email);

    // 点「填入页面」才算认可这条地址，这时才写地址池
    var poolItem = null;
    if (data.firstName && data.address1 && data.postcode) {
      poolItem = poolUpsert(data, ui.src.value);
    }
    if (!poolItem && currentData && currentData._poolId) poolItem = { id: currentData._poolId };
    if (!poolItem) poolItem = poolFindByData(data);

    setStatus('正在填入…');
    applyToPage(data, { skipFilled: ui.skip.checked }).then(function (result) {
      if (poolItem) {
        poolMarkUsed(poolItem.id);
        renderPool();
      }

      var lines = [];
      lines.push('已填 ' + result.filled.length + ' 项：' + (result.filled.join('、') || '无'));
      if (result.missing.length) lines.push('未找到：' + result.missing.join('、'));
      if (result.notes.length) lines.push(result.notes.join('\n'));
      setStatus(lines.join('\n'), result.missing.length ? 'warn' : 'ok');
    }).catch(function (err) {
      setStatus('填出错：' + (err && err.message ? err.message : err), 'err');
      console.error('[WHMCS Filler]', err);
    });
  }

  function describeStateField() {
    var el = findStateEl();
    if (!el) return '[州字段] 没找到任何候选元素（可能不是 select，而是纯 div 自定义下拉）';

    var out = [];
    out.push('[州字段] <' + el.tagName.toLowerCase() +
      ' id=' + (el.id || '-') +
      ' name=' + (el.getAttribute('name') || '-') +
      ' class=' + (el.className || '-') + '>');
    out.push('  可见：' + (el.getClientRects().length ? '是' : '否（可能被自定义组件隐藏，真实值在别处）'));

    if (el.tagName === 'SELECT') {
      var cur = el.options[el.selectedIndex];
      out.push('  选项数：' + el.options.length);
      out.push('  当前选中：index=' + el.selectedIndex +
        ' value="' + (cur ? cur.value : '') + '"' +
        ' text="' + (cur ? norm(cur.textContent) : '') + '"');
      var sample = [];
      for (var i = 0; i < Math.min(el.options.length, 6); i++) {
        sample.push('"' + el.options[i].value + '"|"' + norm(el.options[i].textContent) + '"');
      }
      out.push('  前几项：' + sample.join(' ; '));
      out.push('  匹配 Oregon/OR：' + (findOptionIndex(el, ['OR', 'Oregon']) >= 0 ? '可以匹配' : '匹配不到'));
    } else {
      out.push('  当前值："' + el.value + '"（不是 select，是 ' + (el.type || 'text') + ' 输入框）');
    }
    return out.join('\n');
  }

  function doDiagnose() {
    var rows = [];
    var els = document.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        var ty = (el.type || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image'].indexOf(ty) !== -1) continue;
      }
      rows.push([
        tag,
        'id=' + (el.id || '-'),
        'name=' + (el.getAttribute('name') || '-'),
        'type=' + (el.type || '-'),
        'vis=' + (el.getClientRects().length ? 1 : 0),
        'ph=' + (el.getAttribute('placeholder') || '-')
      ].join(' | '));
    }

    var txt = describeStateField() + '\n\n' + rows.join('\n');
    console.log('[WHMCS Filler] 页面表单结构\n' + txt);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        setStatus('已复制 ' + rows.length + ' 个字段信息到剪贴板\n' + txt.slice(0, 500), 'ok');
      }).catch(function () {
        setStatus('诊断信息已打印到控制台（F12）', 'warn');
      });
    } else {
      setStatus('诊断信息已打印到控制台（F12）', 'warn');
    }
  }

  function saveEmail(v) {
    if (v) Store.set(KEY_EMAIL, v);
    else Store.del(KEY_EMAIL);
  }

  function readSavedEmail() {
    var v = Store.get(KEY_EMAIL, '');
    return typeof v === 'string' ? v : '';
  }

  // 把结构化数据还原成一行可解析的文本，
  // 保证 textarea 和预览区内容一致（否则用户一敲键盘就会被旧文本覆盖）
  function dataToText(d) {
    if (!d) return '';

    var parts = [];
    var name = ((d.firstName || '') + ' ' + (d.lastName || '')).trim();
    if (name) parts.push('[' + (d.countryCode || 'US') + '] ' + name);
    if (d.phone) parts.push(d.phone);

    var tail = [];
    if (d.address1) tail.push(d.address1);
    if (d.city) tail.push(d.city);
    var stateZip = [(d.stateCode || d.state || ''), (d.postcode || '')].filter(Boolean).join(' ');
    if (stateZip) tail.push(stateZip);
    if (tail.length) parts.push(tail.join(', '));

    return parts.join(' | ');
  }

  function applyText(raw) {
    // 只解析和预览，不写地址池。
    // 否则用户在文本框里每改一个字段就会插一条新记录（key 变了），池子很快变脏。
    renderPreview(parseResult(raw));
    Store.set(KEY_LAST_TEXT, raw);
  }

  function restoreDraft() {
    var saved = Store.get(KEY_LAST_TEXT, '');
    if (typeof saved === 'string' && saved.trim()) {
      ui.src.value = saved;
      applyText(saved);
    } else {
      renderPreview(parseResult(''));
    }
  }

  function togglePanel(open) {
    var show = open == null ? ui.panel.hasAttribute('hidden') : open;
    if (show) {
      ui.panel.removeAttribute('hidden');
      if (!prefs.pos) positionPanelNearFab();
    } else {
      ui.panel.setAttribute('hidden', '');
    }
  }

  // 面板没被手动拖过时，出现在悬浮球旁边
  function positionPanelNearFab() {
    var fr = ui.fab.getBoundingClientRect();
    var pw = ui.panel.offsetWidth || 376;
    var ph = ui.panel.offsetHeight || 320;

    var x = fr.left + fr.width / 2 - pw / 2;
    var y = fr.top - ph - 10;
    if (y < 8) y = fr.bottom + 10;

    x = Math.max(8, Math.min(window.innerWidth - pw - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - ph - 8, y));

    ui.panel.style.left = Math.round(x) + 'px';
    ui.panel.style.top = Math.round(y) + 'px';
    ui.panel.style.right = 'auto';
    ui.panel.style.bottom = 'auto';
  }

  function setCollapsed(v) {
    prefs.collapsed = !!v;
    if (prefs.collapsed) ui.body.setAttribute('hidden', '');
    else ui.body.removeAttribute('hidden');
    ui.collapseBtn.innerHTML = prefs.collapsed ? '&#43;' : '&#8722;';
    ui.collapseBtn.title = prefs.collapsed ? '展开' : '折叠';
    savePrefs();
  }

  function applyPrefs() {
    ui.skip.checked = !!prefs.skipFilled;
    if (prefs.collapsed) {
      ui.body.setAttribute('hidden', '');
      ui.collapseBtn.innerHTML = '&#43;';
      ui.collapseBtn.title = '展开';
    }

    // 悬浮球位置
    if (prefs.fabPos) {
      var fx = Math.max(2, Math.min(window.innerWidth - 50, prefs.fabPos.x));
      var fy = Math.max(2, Math.min(window.innerHeight - 50, prefs.fabPos.y));
      ui.fab.style.left = fx + 'px';
      ui.fab.style.top = fy + 'px';
      ui.fab.style.right = 'auto';
      ui.fab.style.bottom = 'auto';
    }

    // 面板位置
    if (prefs.pos) {
      var x = Math.max(2, Math.min(window.innerWidth - 140, prefs.pos.x));
      var y = Math.max(2, Math.min(window.innerHeight - 60, prefs.pos.y));
      ui.panel.style.left = x + 'px';
      ui.panel.style.top = y + 'px';
      ui.panel.style.right = 'auto';
      ui.panel.style.bottom = 'auto';
    }
  }

  /* ---------- 拖动 ---------- */

  var dragState = null;

  function onDragStart(e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('button, a')) return;

    var rect = ui.panel.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    ui.head.classList.add('dragging');
    document.addEventListener('mousemove', onDragMove, true);
    document.addEventListener('mouseup', onDragEnd, true);
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragState) return;
    var w = ui.panel.offsetWidth;
    var x = e.clientX - dragState.dx;
    var y = e.clientY - dragState.dy;
    x = Math.max(2, Math.min(window.innerWidth - w - 2, x));
    y = Math.max(2, Math.min(window.innerHeight - 44, y));

    ui.panel.style.left = Math.round(x) + 'px';
    ui.panel.style.top = Math.round(y) + 'px';
    ui.panel.style.right = 'auto';
    ui.panel.style.bottom = 'auto';
    dragState.moved = true;
  }

  function onDragEnd() {
    if (!dragState) return;
    ui.head.classList.remove('dragging');
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragEnd, true);

    if (dragState.moved) {
      prefs.pos = {
        x: parseInt(ui.panel.style.left, 10) || 0,
        y: parseInt(ui.panel.style.top, 10) || 0
      };
      savePrefs();
    }
    dragState = null;
  }

  /* ---------- 悬浮球拖动 ---------- */

  var fabDrag = null;
  var fabMoved = false;

  function onFabDown(e) {
    if (e.button !== 0) return;
    var rect = ui.fab.getBoundingClientRect();
    fabDrag = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false
    };
    document.addEventListener('mousemove', onFabMove, true);
    document.addEventListener('mouseup', onFabUp, true);
    e.preventDefault();
  }

  function onFabMove(e) {
    if (!fabDrag) return;

    // 移动超过 5px 才算拖动，否则当点击
    if (!fabDrag.moved) {
      var dist = Math.abs(e.clientX - fabDrag.startX) + Math.abs(e.clientY - fabDrag.startY);
      if (dist < 5) return;
      fabDrag.moved = true;
      ui.fab.classList.add('dragging');
    }

    var size = ui.fab.offsetWidth || 46;
    var x = e.clientX - fabDrag.dx;
    var y = e.clientY - fabDrag.dy;
    x = Math.max(2, Math.min(window.innerWidth - size - 2, x));
    y = Math.max(2, Math.min(window.innerHeight - size - 2, y));

    ui.fab.style.left = Math.round(x) + 'px';
    ui.fab.style.top = Math.round(y) + 'px';
    ui.fab.style.right = 'auto';
    ui.fab.style.bottom = 'auto';
  }

  function onFabUp() {
    if (!fabDrag) return;
    document.removeEventListener('mousemove', onFabMove, true);
    document.removeEventListener('mouseup', onFabUp, true);
    ui.fab.classList.remove('dragging');

    if (fabDrag.moved) {
      // 阻止紧随其后的 click 把面板打开
      fabMoved = true;
      setTimeout(function () { fabMoved = false; }, 350);

      prefs.fabPos = {
        x: parseInt(ui.fab.style.left, 10) || 0,
        y: parseInt(ui.fab.style.top, 10) || 0
      };
      savePrefs();
    }
    fabDrag = null;
  }

  /* ---------- 地址生成界面 ---------- */

  function initStateSelect() {
    var sel = ui.genState;
    while (sel.firstChild) sel.removeChild(sel.firstChild);

    var gTax = document.createElement('optgroup');
    gTax.label = '免税州';
    var gOther = document.createElement('optgroup');
    gOther.label = '其他州';

    Object.keys(US_STATES).sort().forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      var taxFree = TAX_FREE_STATES.indexOf(code) !== -1;
      opt.textContent = US_STATES[code] + ' (' + code + ')' + (taxFree ? ' · 免税' : '');
      (taxFree ? gTax : gOther).appendChild(opt);
    });

    sel.appendChild(gTax);
    sel.appendChild(gOther);

    var prefer = (prefs && prefs.genState) || 'OR';
    sel.value = US_STATES[prefer] ? prefer : 'OR';
    if (!sel.value) sel.value = 'OR';

    sel.addEventListener('change', function () {
      if (prefs) {
        prefs.genState = sel.value;
        savePrefs();
      }
    });
  }

  async function doGenerate(count) {
    if (generating) return;

    generating = true;
    ui.genOne.disabled = true;
    ui.genBatch.disabled = true;

    var stateCode = ui.genState.value || 'OR';
    var made = [];

    try {
      for (var i = 0; i < count; i++) {
        var head = count > 1 ? '(' + (i + 1) + '/' + count + ') ' : '';
        var data = await generateOne(stateCode, function (n, total) {
          setStatus(head + '正在生成…第 ' + n + '/' + total + ' 次尝试', '');
        });

        var item = poolUpsert(data, '');
        if (item) data._poolId = item.id;
        made.push(data);
      }

      renderPool();

      var first = made[0];
      var savedEmail = readSavedEmail();
      if (savedEmail) first.email = savedEmail;
      renderPreview(first);
      ui.src.value = dataToText(first);

      var where = first.address1 + '，' + first.city + ' ' + first.stateCode + ' ' + first.postcode;
      if (made.length > 1) {
        setStatus('已生成 ' + made.length + ' 条并存入地址池，已载入第 1 条\n' + where, 'ok');
      } else {
        setStatus('已生成并存入地址池\n' + where + '\n电话 ' + first.phone, 'ok');
      }
    } catch (e) {
      // 批量时可能已经成功了一部分，别让它们白生成
      if (made.length) {
        var okFirst = made[0];
        var se2 = readSavedEmail();
        if (se2) okFirst.email = se2;
        renderPreview(okFirst);
        ui.src.value = dataToText(okFirst);
      }
      renderPool();

      setStatus('生成失败：' + (e && e.message ? e.message : e) +
        (made.length ? '\n已成功生成 ' + made.length + ' 条，存在地址池里了' : '') +
        '\n可以再点一次，或去上面那个网站复制地址粘贴进来', 'err');
    } finally {
      generating = false;
      ui.genOne.disabled = false;
      ui.genBatch.disabled = false;
    }
  }

  /* ---------- 地址池 ---------- */

  var clearArmTimer = null;
  var pendingDelId = null;
  var pendingDelTimer = null;

  function clearPendingDel() {
    if (pendingDelTimer) {
      clearTimeout(pendingDelTimer);
      pendingDelTimer = null;
    }
    pendingDelId = null;
  }

  function resetClearArm() {
    if (clearArmTimer) {
      clearTimeout(clearArmTimer);
      clearArmTimer = null;
    }
    if (!ui.pclear) return;
    ui.pclear.dataset.armed = '0';
    ui.pclear.classList.remove('arm');
    ui.pclear.textContent = '清空';
  }

  // 清空不可撤销，所以第一次点变「确认?」，3 秒内再点一次才真清
  function onClearPool(e) {
    e.stopPropagation();
    if (loadPool().length === 0) return;

    if (ui.pclear.dataset.armed === '1') {
      savePool([]);
      resetClearArm();
      clearPendingDel();
      renderPool();
      setStatus('地址池已清空', 'ok');
      return;
    }

    ui.pclear.dataset.armed = '1';
    ui.pclear.classList.add('arm');
    ui.pclear.textContent = '确认?';
    clearArmTimer = setTimeout(resetClearArm, 3000);
  }

  function renderPool() {
    var arr = loadPool();
    ui.pcount.textContent = String(arr.length);
    ui.ppick.disabled = arr.length === 0;
    ui.pclear.disabled = arr.length === 0;

    if (arr.length === 0) resetClearArm();

    var list = ui.plist;
    var keepScroll = list.scrollTop;
    while (list.firstChild) list.removeChild(list.firstChild);

    if (!arr.length) {
      var empty = document.createElement('div');
      empty.className = 'pempty';
      empty.textContent = '还没有地址。粘贴一条生成结果，会自动存进来。';
      list.appendChild(empty);
      list.scrollTop = 0;
      return;
    }

    arr.forEach(function (item) {
      var d = item.data || {};

      var row = document.createElement('div');
      row.className = 'pitem';
      row.dataset.id = item.id;

      var info = document.createElement('div');
      info.className = 'pinfo';

      var nameEl = document.createElement('div');
      nameEl.className = 'pname';
      nameEl.textContent = ((d.firstName || '') + ' ' + (d.lastName || '')).trim() || '(未命名)';

      var subEl = document.createElement('div');
      subEl.className = 'psub';
      var loc = [d.city, (d.stateCode || d.state), d.postcode].filter(Boolean).join(' ');
      var used = item.usedCount
        ? ('用过 ' + item.usedCount + ' 次 · ' + timeAgo(item.lastUsedAt))
        : '未用过';
      subEl.textContent = (loc ? loc + ' · ' : '') + used;

      info.appendChild(nameEl);
      info.appendChild(subEl);

      var armed = (pendingDelId === item.id);
      var del = document.createElement('button');
      del.className = 'pdel' + (armed ? ' arm' : '');
      del.textContent = armed ? '确认' : '\u00d7';
      del.title = armed ? '再点一次删除' : '从地址池删除';

      row.appendChild(info);
      row.appendChild(del);

      row.addEventListener('click', function (e) {
        if (e.target === del) return;
        loadPoolItem(item.id);
      });

      // 删除要二次确认，防止误点把地址弄丢
      del.addEventListener('click', function (e) {
        e.stopPropagation();

        if (pendingDelId === item.id) {
          clearPendingDel();
          poolRemove(item.id);
          renderPool();
          setStatus('已删除一条地址', 'ok');
          return;
        }

        clearPendingDel();
        pendingDelId = item.id;
        pendingDelTimer = setTimeout(function () {
          pendingDelId = null;
          pendingDelTimer = null;
          renderPool();
        }, 3000);
        renderPool();
      });

      list.appendChild(row);
    });

    list.scrollTop = keepScroll;
  }

  function loadPoolItem(id) {
    if (pendingDelId) {
      clearPendingDel();
      renderPool();
    }

    var arr = loadPool();
    var item = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { item = arr[i]; break; }
    }
    if (!item) return;

    var d = {};
    for (var k in item.data) {
      if (Object.prototype.hasOwnProperty.call(item.data, k)) d[k] = item.data[k];
    }
    d._poolId = item.id;

    // 邮箱始终用你记住的真实邮箱，池子里的假邮箱不要用
    var savedEmail = readSavedEmail();
    if (savedEmail) d.email = savedEmail;

    renderPreview(d);
    ui.src.value = item.raw || dataToText(d);

    var who = ((d.firstName || '') + ' ' + (d.lastName || '')).trim() || '该条地址';
    setStatus('已载入 ' + who + '，点「填入页面」使用', 'ok');
  }

  function bindEvents() {
    ui.fab.addEventListener('mousedown', onFabDown);
    ui.fab.addEventListener('click', function () {
      if (fabMoved) return;   // 刚拖完，别顺手把面板打开
      togglePanel();
    });

    ui.close.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel(false);
    });

    ui.collapseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setCollapsed(!prefs.collapsed);
    });

    ui.head.addEventListener('mousedown', onDragStart);

    ui.phead.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.pbtn')) return;
      var hidden = ui.plist.hasAttribute('hidden');
      if (hidden) ui.plist.removeAttribute('hidden');
      else ui.plist.setAttribute('hidden', '');
      ui.pcaret.innerHTML = hidden ? '&#9652;' : '&#9662;';
    });

    ui.ppick.addEventListener('click', function (e) {
      e.stopPropagation();
      var item = poolPickFresh();
      if (!item) { setStatus('地址池是空的', 'warn'); return; }
      loadPoolItem(item.id);
      ui.plist.removeAttribute('hidden');
      ui.pcaret.innerHTML = '&#9652;';
    });

    ui.genOne.addEventListener('click', function () { doGenerate(1); });
    ui.genBatch.addEventListener('click', function () { doGenerate(5); });

    ui.pclear.addEventListener('click', onClearPool);

    var timer = null;
    ui.src.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { applyText(ui.src.value); }, 260);
    });

    ui.fillBtn.addEventListener('click', doFill);
    ui.diagBtn.addEventListener('click', doDiagnose);

    ui.skip.addEventListener('change', function () {
      prefs.skipFilled = ui.skip.checked;
      savePrefs();
    });

    ui.clearBtn.addEventListener('click', function () {
      ui.src.value = '';
      Store.del(KEY_LAST_TEXT);
      renderPreview(parseResult(''));
      ui.src.focus();
    });

    document.addEventListener('keydown', function (e) {
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        togglePanel();
        if (prefs.collapsed) setCollapsed(false);
        ui.src.focus();
        ui.src.select();
      }
    });

    window.addEventListener('resize', function () {
      // 悬浮球
      if (ui.fab.style.left) {
        var fs = ui.fab.offsetWidth || 46;
        var fx = parseInt(ui.fab.style.left, 10) || 0;
        var fy = parseInt(ui.fab.style.top, 10) || 0;
        fx = Math.max(2, Math.min(window.innerWidth - fs - 2, fx));
        fy = Math.max(2, Math.min(window.innerHeight - fs - 2, fy));
        ui.fab.style.left = fx + 'px';
        ui.fab.style.top = fy + 'px';
      }

      // 面板
      if (!ui.panel.style.left) return;
      var x = parseInt(ui.panel.style.left, 10) || 0;
      var y = parseInt(ui.panel.style.top, 10) || 0;
      x = Math.max(2, Math.min(window.innerWidth - ui.panel.offsetWidth - 2, x));
      y = Math.max(2, Math.min(window.innerHeight - 44, y));
      ui.panel.style.left = x + 'px';
      ui.panel.style.top = y + 'px';
    });
  }

  /* ============================================================
   * 8. 启动
   * ============================================================ */

  function boot() {
    if (document.getElementById('whmcs-addr-filler-host')) return;
    migrateLegacy();
    prefs = loadPrefs();
    buildPanel();
    console.log('[WHMCS Filler] v0.3.0 已加载，Alt+F 打开面板');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
