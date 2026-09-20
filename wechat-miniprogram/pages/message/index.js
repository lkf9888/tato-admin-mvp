const hub = require("../../utils/hub");

/**
 * Where a tapped notification lands, and the short list behind it.
 *
 * The hub addresses every subscribe message at `pages/message/index?d=<id>`,
 * so this page exists for all three systems and knows what none of them
 * mean. It renders whatever fields the payload carries.
 */

/**
 * Chinese labels for the field names the three systems send.
 *
 * The hub deliberately does not carry display labels -- it moves
 * values, not copy. Unknown keys fall through to the key itself, which
 * is ugly but never blank, and is the signal that a system has started
 * sending something new.
 */
const FIELD_LABELS = {
  title: "内容",
  due: "时间",
  vehicle: "车辆",
  action: "类型",
  details: "备注",
  source: "来源",
  amount: "金额",
  location: "地点"
};

function formatTimestamp(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toRows(fields) {
  if (!fields) return [];
  return Object.keys(fields)
    .filter((key) => key !== "title")
    .map((key) => ({ key, label: FIELD_LABELS[key] || key, value: fields[key] }));
}

function decorate(item) {
  const payload = item.payload || {};
  const fields = payload.fields || {};
  return {
    id: item.id,
    source: payload.source || item.appName,
    channel: item.channelName,
    title: fields.title || "(无标题)",
    rows: toRows(fields),
    link: (payload.link && payload.link.url) || (item.link && item.link.url) || "",
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
      this.setData({
        items: (payload.items || []).map(decorate),
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
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.navigateTo({
      url: `/pages/webview/webview?url=${encodeURIComponent(url)}`,
      // A mini program registered to an individual cannot use web-view
      // at all. Saying so beats a blank screen.
      fail() {
        wx.showModal({
          title: "打不开详情页",
          content: "这个小程序还不能打开网页。请复制链接到浏览器，或联系管理员。",
          showCancel: false
        });
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
