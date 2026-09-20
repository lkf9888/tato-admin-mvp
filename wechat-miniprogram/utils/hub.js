/**
 * The notification hub's client.
 *
 * Separate from `api.js`, which still talks to TATO's own staff
 * endpoints. This file knows about channels, templates and quota and
 * nothing about tasks -- the same mini program serves HostHub and the
 * wash bay, and neither has tasks.
 */

const app = getApp();

const TOKEN_KEY = "notifyHubToken";

/**
 * How many unspent authorisations to keep per template.
 *
 * WeChat grants one message per accepted authorisation and they
 * accumulate, so "subscribed" is a balance rather than a switch. Three
 * is roughly a busy day of assignments, and it is also the most a
 * single `requestSubscribeMessage` call can top up across templates.
 */
const QUOTA_TARGET = 3;

function getBaseUrl() {
  return (app.globalData.apiBaseUrl || "https://tatocar.co").replace(/\/$/, "");
}

function request(options) {
  const token = wx.getStorageSync(TOKEN_KEY);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(res.data || { error: `HTTP_${res.statusCode}` });
      },
      fail: reject
    });
  });
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code);
        else reject(new Error("NO_WX_CODE"));
      },
      fail: reject
    });
  });
}

/**
 * Open a session and pick up the current state in one call.
 *
 * There is no separate "who am I": a session *is* a `wx.login` code
 * exchanged for an openid, and the response carries the channels, the
 * template ids and the remaining quota -- which is everything any
 * screen here needs.
 */
async function refresh() {
  const wxCode = await wxLoginCode();
  const data = await request({
    url: "/api/v1/mp/session",
    method: "POST",
    data: { wxCode }
  });
  wx.setStorageSync(TOKEN_KEY, data.token);
  app.globalData.hubState = data;
  return data;
}

function bindChannel(bindCode, label) {
  return request({
    url: "/api/v1/mp/bind",
    method: "POST",
    data: { bindCode, label }
  });
}

function listMessages() {
  return request({ url: "/api/v1/mp/inbox" });
}

function getMessage(deliveryId) {
  return request({ url: `/api/v1/mp/inbox?d=${encodeURIComponent(deliveryId)}` });
}

/**
 * Ask WeChat for more authorisations, and tell the hub what it said.
 *
 * Must be called from inside a tap handler the first time: WeChat only
 * shows the dialog for a user gesture. Once someone ticks "always keep
 * this choice", the same call succeeds silently and can run on launch
 * -- which is why this is attempted in both places rather than hidden
 * behind a button nobody presses twice.
 *
 * `state` is a session response. Resolves to the new quota, or null
 * when there was nothing to ask for or WeChat refused to ask.
 */
function topUp(state) {
  const templates = (state && state.templates) || [];
  const quota = (state && state.quota) || {};

  // Lowest balances first, and at most three: that is WeChat's limit
  // per call, and asking for templates that are already stocked wastes
  // the one dialog a person will tolerate.
  const wanted = templates
    .filter((template) => (quota[template.key] || 0) < QUOTA_TARGET)
    .sort((a, b) => (quota[a.key] || 0) - (quota[b.key] || 0))
    .slice(0, 3);

  if (wanted.length === 0) return Promise.resolve(null);

  const byTemplateId = {};
  wanted.forEach((template) => {
    byTemplateId[template.templateId] = template.key;
  });

  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: wanted.map((template) => template.templateId),
      success(res) {
        const granted = {};
        Object.keys(byTemplateId).forEach((templateId) => {
          const outcome = res[templateId];
          if (outcome) granted[byTemplateId[templateId]] = outcome;
        });

        if (Object.keys(granted).length === 0) {
          resolve(null);
          return;
        }

        request({ url: "/api/v1/mp/subscribe", method: "POST", data: { granted } })
          .then((payload) => {
            if (app.globalData.hubState) app.globalData.hubState.quota = payload.quota;
            resolve(payload.quota);
          })
          // A grant we fail to report is a message WeChat will deliver
          // and we will never send. Not worth a dialog, but not worth
          // pretending either.
          .catch(() => resolve(null));
      },
      // Called when there is no gesture to attach to, or the person
      // dismissed the sheet. Both are ordinary.
      fail() {
        resolve(null);
      }
    });
  });
}

/** Total unspent authorisations, across templates. */
function totalQuota(state) {
  const quota = (state && state.quota) || {};
  return Object.keys(quota).reduce((sum, key) => sum + (quota[key] || 0), 0);
}

module.exports = {
  TOKEN_KEY,
  QUOTA_TARGET,
  refresh,
  bindChannel,
  listMessages,
  getMessage,
  topUp,
  totalQuota
};
