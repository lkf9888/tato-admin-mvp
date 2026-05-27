const app = getApp();

function getBaseUrl() {
  return (app.globalData.apiBaseUrl || "https://tatocar.co").replace(/\/$/, "");
}

function request(options) {
  const token = wx.getStorageSync("tatoStaffToken");
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

async function bindStaff(staffCode) {
  const wxCode = await wxLoginCode();
  const data = await request({
    url: "/api/wechat/staff/login",
    method: "POST",
    data: { wxCode, staffCode }
  });
  wx.setStorageSync("tatoStaffToken", data.token);
  return data;
}

async function refreshLogin() {
  const wxCode = await wxLoginCode();
  const data = await request({
    url: "/api/wechat/staff/login",
    method: "POST",
    data: { wxCode }
  });
  wx.setStorageSync("tatoStaffToken", data.token);
  return data;
}

function getMe() {
  return request({ url: "/api/wechat/staff/me" });
}

function patchTask(taskId, data) {
  return request({
    url: `/api/wechat/staff/tasks/${taskId}`,
    method: "PATCH",
    data
  });
}

function saveSubscription(accepted) {
  return request({
    url: "/api/wechat/staff/subscribe",
    method: "POST",
    data: { accepted }
  });
}

function uploadTaskPhoto(taskId, filePath) {
  const token = wx.getStorageSync("tatoStaffToken");
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${getBaseUrl()}/api/wechat/staff/tasks/${taskId}/attachments`,
      filePath,
      name: "file",
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(res.data || { error: `HTTP_${res.statusCode}` });
          return;
        }
        try {
          resolve(JSON.parse(res.data || "{}"));
        } catch (error) {
          reject(error);
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  bindStaff,
  refreshLogin,
  getMe,
  patchTask,
  saveSubscription,
  uploadTaskPhoto
};
