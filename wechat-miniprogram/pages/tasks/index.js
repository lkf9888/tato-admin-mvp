const api = require("../../utils/api");

const HISTORY_PAGE_SIZE = 10;

function parseTime(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function parseHistoryTime(task) {
  const value = task.completedAt || task.dueDatetime;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dateKey(value) {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "none";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(value) {
  if (!value) return "无到期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "无到期";
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const taskDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((taskDay.getTime() - dayStart.getTime()) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDate(value) {
  if (!value) return "无到期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "无到期";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function groupTasks(tasks, direction) {
  const map = {};
  tasks.forEach((task) => {
    const key = dateKey(task.dueDatetime);
    if (!map[key]) {
      map[key] = {
        key,
        label: dateLabel(task.dueDatetime),
        order: task.dueDatetime ? parseTime(task.dueDatetime) : Number.MAX_SAFE_INTEGER,
        tasks: []
      };
    }
    map[key].tasks.push({
      ...task,
      dueLabel: formatDate(task.dueDatetime),
      contextLabel: task.vehicle ? `${task.vehicle.plateNumber} · ${task.vehicle.nickname}` : task.vehicleLabel || task.orderLabel || ""
    });
  });
  return Object.values(map).sort((left, right) => direction === "desc" ? right.order - left.order : left.order - right.order);
}

function deriveView(tasks, historyPage, historyOpen) {
  const activeTasks = tasks
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .sort((left, right) => {
      const timeDiff = parseTime(left.dueDatetime) - parseTime(right.dueDatetime);
      if (timeDiff !== 0) return timeDiff;
      return (left.sortOrder || 0) - (right.sortOrder || 0);
    });
  const historyTasks = tasks
    .filter((task) => task.status === "done" || task.status === "cancelled")
    .sort((left, right) => parseHistoryTime(right) - parseHistoryTime(left));
  const historyPageCount = Math.max(1, Math.ceil(historyTasks.length / HISTORY_PAGE_SIZE));
  const normalizedHistoryPage = Math.min(Math.max(1, historyPage), historyPageCount);
  const historyStart = (normalizedHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pagedHistoryTasks = historyTasks.slice(historyStart, historyStart + HISTORY_PAGE_SIZE);
  return {
    activeGroups: groupTasks(activeTasks, "asc"),
    historyGroups: historyOpen ? groupTasks(pagedHistoryTasks, "desc") : [],
    activeCount: activeTasks.length,
    historyCount: historyTasks.length,
    historyPage: normalizedHistoryPage,
    historyPageCount
  };
}

function taskToEditForm(task) {
  let dueDate = "";
  if (task.dueDatetime) {
    const date = new Date(task.dueDatetime);
    if (!Number.isNaN(date.getTime())) {
      dueDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
  }
  return {
    title: task.title || "",
    dueDate,
    timeWindow: task.timeWindow || "",
    details: task.details || ""
  };
}

Page({
  data: {
    staff: null,
    tasks: [],
    activeGroups: [],
    historyGroups: [],
    activeCount: 0,
    historyCount: 0,
    historyOpen: false,
    historyPage: 1,
    historyPageCount: 1,
    templateId: "",
    notificationEnabled: false,
    loading: true,
    saving: false,
    editingTask: null,
    editForm: {}
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      const payload = await api.getMe();
      this.applyPayload(payload);
    } catch (error) {
      wx.removeStorageSync("tatoStaffToken");
      wx.redirectTo({ url: "/pages/login/login" });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyPayload(payload) {
    const view = deriveView(payload.tasks || [], this.data.historyPage, this.data.historyOpen);
    this.setData({
      staff: payload.staff,
      tasks: payload.tasks || [],
      templateId: payload.wechat && payload.wechat.taskTemplateId ? payload.wechat.taskTemplateId : "",
      notificationEnabled: Boolean(payload.wechat && payload.wechat.notificationEnabled),
      ...view
    });
  },

  refreshView(nextTasks) {
    const view = deriveView(nextTasks, this.data.historyPage, this.data.historyOpen);
    this.setData({
      tasks: nextTasks,
      ...view
    });
  },

  upsertTask(task) {
    const tasks = [...this.data.tasks];
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) tasks[index] = task;
    else tasks.push(task);
    this.refreshView(tasks);
  },

  removeTask(taskId) {
    this.refreshView(this.data.tasks.filter((task) => task.id !== taskId));
  },

  toggleHistory() {
    this.setData({ historyOpen: !this.data.historyOpen }, () => {
      this.refreshView(this.data.tasks);
    });
  },

  previousHistoryPage() {
    if (this.data.historyPage <= 1) return;
    this.setData({ historyPage: this.data.historyPage - 1 }, () => this.refreshView(this.data.tasks));
  },

  nextHistoryPage() {
    if (this.data.historyPage >= this.data.historyPageCount) return;
    this.setData({ historyPage: this.data.historyPage + 1 }, () => this.refreshView(this.data.tasks));
  },

  async enableNotifications() {
    if (!this.data.templateId) {
      wx.showToast({ title: "后台还没有配置微信模板", icon: "none" });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [this.data.templateId],
      success: async (res) => {
        const accepted = res[this.data.templateId] === "accept";
        await api.saveSubscription(accepted);
        this.setData({ notificationEnabled: accepted });
        wx.showToast({ title: accepted ? "提醒已开启" : "未开启提醒", icon: "none" });
      },
      fail() {
        wx.showToast({ title: "请在点击后立即授权提醒", icon: "none" });
      }
    });
  },

  async completeTask(event) {
    const taskId = event.currentTarget.dataset.id;
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    this.setData({ saving: true });
    try {
      const payload = await api.patchTask(taskId, { status: task.status === "done" ? "todo" : "done" });
      if (payload.task) this.upsertTask(payload.task);
    } catch (error) {
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  async unassignTask(event) {
    const taskId = event.currentTarget.dataset.id;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "放回未分配",
        content: "放回后你将看不到这个任务，Admin 可以重新分配。",
        success(res) {
          resolve(res.confirm);
        },
        fail() {
          resolve(false);
        }
      });
    });
    if (!confirmed) return;
    this.setData({ saving: true });
    try {
      await api.patchTask(taskId, { unassign: true });
      this.removeTask(taskId);
    } catch (error) {
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  editTask(event) {
    const taskId = event.currentTarget.dataset.id;
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    this.setData({
      editingTask: task,
      editForm: taskToEditForm(task)
    });
  },

  closeEdit() {
    this.setData({ editingTask: null, editForm: {} });
  },

  onEditInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      editForm: {
        ...this.data.editForm,
        [field]: event.detail.value
      }
    });
  },

  onEditDateChange(event) {
    this.setData({
      editForm: {
        ...this.data.editForm,
        dueDate: event.detail.value
      }
    });
  },

  async saveEdit() {
    const task = this.data.editingTask;
    if (!task || this.data.saving) return;
    this.setData({ saving: true });
    try {
      const payload = await api.patchTask(task.id, {
        title: this.data.editForm.title,
        dueDatetime: this.data.editForm.dueDate,
        timeWindow: this.data.editForm.timeWindow,
        details: this.data.editForm.details
      });
      if (payload.task) this.upsertTask(payload.task);
      this.closeEdit();
    } catch (error) {
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  async uploadPhoto(event) {
    const taskId = event.currentTarget.dataset.id;
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) return;

    try {
      const media = wx.chooseMedia
        ? await new Promise((resolve, reject) => {
            wx.chooseMedia({ count: 6, mediaType: ["image"], success: resolve, fail: reject });
          })
        : await new Promise((resolve, reject) => {
            wx.chooseImage({ count: 6, success: resolve, fail: reject });
          });
      const files = media.tempFiles ? media.tempFiles.map((file) => file.tempFilePath) : media.tempFilePaths || [];
      if (files.length === 0) return;
      this.setData({ saving: true });
      const uploads = [];
      for (const filePath of files) {
        const payload = await api.uploadTaskPhoto(taskId, filePath);
        uploads.push(...(payload.attachments || []));
      }
      this.upsertTask({
        ...task,
        attachments: [...(task.attachments || []), ...uploads]
      });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes("cancel")) return;
      wx.showToast({ title: "上传失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  previewImage(event) {
    const taskId = event.currentTarget.dataset.taskId;
    const url = event.currentTarget.dataset.url;
    const task = this.data.tasks.find((item) => item.id === taskId);
    const urls = task && task.attachments ? task.attachments.map((item) => item.url) : [url];
    wx.previewImage({ current: url, urls });
  },

  logout() {
    wx.removeStorageSync("tatoStaffToken");
    wx.redirectTo({ url: "/pages/login/login" });
  }
});
