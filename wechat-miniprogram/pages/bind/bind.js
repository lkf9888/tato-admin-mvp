const hub = require("../../utils/hub");

/**
 * Join a channel by typing its code.
 *
 * Replaces the old staff-code screen, which bound a person to TATO and
 * only TATO. A code here belongs to a channel, so one person can hold
 * several -- a driver who also covers the wash bay ends up on two, and
 * neither system learns about the other.
 */
Page({
  data: {
    bindCode: "",
    label: "",
    loading: false,
    channels: []
  },

  onShow() {
    hub
      .refresh()
      .then((state) => this.setData({ channels: state.channels || [] }))
      .catch(() => this.setData({ channels: [] }));
  },

  onCodeInput(event) {
    this.setData({
      bindCode: String(event.detail.value || "").toUpperCase().replace(/\s+/g, "")
    });
  },

  onLabelInput(event) {
    this.setData({ label: String(event.detail.value || "") });
  },

  async submit() {
    if (!this.data.bindCode || this.data.loading) return;
    this.setData({ loading: true });

    try {
      const result = await hub.bindChannel(this.data.bindCode, this.data.label);
      this.setData({ bindCode: "", channels: result.channels || [] });

      // Joining is the one moment a person has clearly said yes to
      // hearing from this channel, and it is a tap -- so it is the best
      // chance all day to collect authorisations without a dialog
      // feeling like an interruption.
      const state = await hub.refresh();
      await hub.topUp(state);

      wx.showToast({ title: `已加入 ${result.channel.name}`, icon: "none" });
    } catch (error) {
      const code = (error && error.error) || "";
      wx.showToast({
        title: code === "RATE_LIMITED" ? "试得太频繁，稍后再试" : "绑定码无效",
        icon: "none"
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
