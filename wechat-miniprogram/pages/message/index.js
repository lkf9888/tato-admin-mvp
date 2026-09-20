const hub = require("../../utils/hub");

/**
 * Where a tapped notification lands, and the short list behind it.
 *
 * The hub addresses every subscribe message at `pages/message/index?d=<id>`,
 * so this page exists for all three systems and knows what none of them
 * mean. It renders whatever fields the payload carries.
 */

function formatTimestamp(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Field labels come from the hub, per app, in the same response as the
 * messages.
 *
 * They used to be a dictionary in this file, which meant a system
 * sending a field nobody had named yet rendered as "room 302" until a
 * new version of this client cleared WeChat review. Now naming it is a
 * `app:labels` command against the hub and the next pull-to-refresh
 * shows it.
 *
 * An unknown key still falls through to the key itself: never blank, and
 * a visible sign that something new arrived and wants naming.
 */
function toRows(fields, labels) {
  if (!fields) return [];
  var names = labels || {};
  return Object.keys(fields)
    .filter((key) => key !== "title")
    .map((key) => ({ key, label: names[key] || key, value: fields[key] }));
}

/**
 * What tapping a message can actually do.
 *
 * This mini program is registered to an individual, which means
 * `web-view` is unavailable -- a notification cannot open the sending
 * system's own page. TATO is the one system with a native page here, so
 * its messages go to the task list; anything else hands the link over to
 * be opened somewhere that can render it.
 *
 * If the subject ever becomes a company, `pages/webview` is still in the
 * repo: put it back in app.json and route `kind: "web"` at it.
 */
function resolveAction(appKey, link) {
  if (appKey === "tato") return { kind: "tasks", label: "查看任务" };
  if (link) return { kind: "copy", label: "复制链接" };
  return null;
}

function decorate(item, allLabels) {
  const payload = item.payload || {};
  const fields = payload.fields || {};
  const link = (payload.link && payload.link.url) || (item.link && item.link.url) || "";
  return {
    id: item.id,
    source: payload.source || item.appName,
    channel: item.channelName,
    title: fields.title || "(无标题)",
    rows: toRows(fields, (allLabels || {})[item.appKey]),
    link,
    action: resolveAction(item.appKey, link),
    time: formatTimestamp(item.createdAt),
    priority: item.priority
  };
}

Page({
  data: {
    loading: true,
    items: [],
    channels: [],
    quota: 0,
    quotaTarget: hub.QUOTA_TARGET,
    focusId: "",
    error: ""
  },

  onLoad(options) {
    // Arriving from a tapped notification: that one message is what the
    // person came for, so it opens expanded and the rest is context.
    this.setData({ focusId: (options && options.d) || "" });
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const state = await hub.refresh();
      this.setData({
        channels: state.channels || [],
        quota: hub.totalQuota(state),
        error: ""
      });

      // Silent when the person has ticked "always keep this choice",
      // a no-op otherwise. Cheap enough to try on every open, and the
      // only way a balance ever recovers without a deliberate tap.
      const quota = await hub.topUp(state);
      if (quota) {
        this.setData({ quota: Object.keys(quota).reduce((sum, key) => sum + quota[key], 0) });
      }

      const payload = await hub.listMessages();
      const labels = payload.labels || {};
      this.setData({
        items: (payload.items || []).map(function (item) {
          return decorate(item, labels);
        }),
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: (error && error.error) || "加载失败，下拉重试"
      });
    }
  },

  /** The explicit ask, for when the silent one cannot run. */
  async enableReminders() {
    const state = getApp().globalData.hubState;
    const quota = await hub.topUp(state || (await hub.refresh()));
    if (!quota) {
      wx.showToast({ title: "未开启提醒", icon: "none" });
      return;
    }
    const total = Object.keys(quota).reduce((sum, key) => sum + quota[key], 0);
    this.setData({ quota: total });
    wx.showToast({ title: `还能收 ${total} 条`, icon: "none" });
  },

  toggle(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ focusId: this.data.focusId === id ? "" : id });
  },

  openLink(event) {
    const { kind, url } = event.currentTarget.dataset;

    if (kind === "tasks") {
      wx.navigateTo({ url: "/pages/tasks/index" });
      return;
    }

    if (!url) return;
    // Copying is the whole action, so it has to be said plainly: the
    // person tapped "详情" and is getting a clipboard instead.
    wx.setClipboardData({
      data: url,
      success() {
        wx.showModal({
          title: "链接已复制",
          content: "这个小程序打不开网页，粘贴到浏览器里看。",
          showCancel: false
        });
      },
      fail() {
        wx.showToast({ title: "复制失败", icon: "none" });
      }
    });
  },

  goBind() {
    wx.navigateTo({ url: "/pages/bind/bind" });
  },

  /**
   * TATO's own task list, which predates the hub and still handles
   * completing a task and uploading photos -- neither of which is a
   * notification, and neither of which the hub should learn about. The
   * page sends the person to its own login if they have never bound a
   * staff code.
   */
  goTasks() {
    wx.navigateTo({ url: "/pages/tasks/index" });
  }
});
