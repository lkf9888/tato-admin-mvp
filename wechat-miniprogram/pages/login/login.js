const api = require("../../utils/api");

Page({
  data: {
    staffCode: "",
    loading: false
  },

  onLoad() {
    const token = wx.getStorageSync("tatoStaffToken");
    if (!token) return;

    api.getMe()
      .then(() => {
        wx.redirectTo({ url: "/pages/tasks/index" });
      })
      .catch(() => {
        wx.removeStorageSync("tatoStaffToken");
      });
  },

  onCodeInput(event) {
    this.setData({
      staffCode: String(event.detail.value || "").toUpperCase().replace(/\s+/g, "")
    });
  },

  async submit() {
    if (!this.data.staffCode || this.data.loading) return;
    this.setData({ loading: true });
    try {
      await api.bindStaff(this.data.staffCode);
      wx.redirectTo({ url: "/pages/tasks/index" });
    } catch (error) {
      wx.showToast({
        title: "Code 无效或已绑定",
        icon: "none"
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
