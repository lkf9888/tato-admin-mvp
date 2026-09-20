/**
 * Opens a system's own page inside the mini program.
 *
 * The hub carries a link but not the content behind it, so TATO's task
 * page, HostHub's booking page and anything else are reached this way.
 *
 * Two registration facts govern whether this works at all: `web-view`
 * is unavailable to a mini program registered to an individual, and
 * every host it loads must be listed as a 业务域名 in the WeChat
 * console. Neither is something this file can do anything about, so a
 * missing url fails loudly rather than rendering an empty frame.
 */
Page({
  data: {
    url: ""
  },

  onLoad(options) {
    const url = decodeURIComponent((options && options.url) || "");
    if (!url) {
      wx.showModal({
        title: "没有可打开的链接",
        content: "这条消息没有附带详情页。",
        showCancel: false,
        complete() {
          wx.navigateBack();
        }
      });
      return;
    }
    this.setData({ url });
  }
});
