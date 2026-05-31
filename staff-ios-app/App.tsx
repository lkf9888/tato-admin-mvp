import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";

import { fetchCurrentStaff, loginWithStaffCode, updateTask, uploadTaskPhotos } from "./src/api";
import { copy, detectLocale } from "./src/i18n";
import { pickPhotoFromLibrary, takePhotoWithCamera } from "./src/photos";
import type { Locale, StaffMember, StaffTask, TaskAttachment } from "./src/types";

const TOKEN_KEY = "tato.staffApp.token";
const STAFF_CODE_KEY = "tato.staffApp.code";

function sortTasks(a: StaffTask, b: StaffTask) {
  const left = a.dueDatetime ? new Date(a.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  const right = b.dueDatetime ? new Date(b.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  if (left !== right) return left - right;
  return a.sortOrder - b.sortOrder;
}

function isClosed(task: StaffTask) {
  return task.status === "done" || task.status === "cancelled";
}

function dateKey(value: string | null) {
  if (!value) return "none";
  return new Date(value).toISOString().slice(0, 10);
}

function formatDue(value: string | null, locale: Locale, noDue: string) {
  if (!value) return noDue;
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const day = date.toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  if (day === todayKey) return copy[locale].today;
  if (day === tomorrowKey) return copy[locale].tomorrow;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatGroupLabel(key: string, locale: Locale) {
  if (key === "none") return copy[locale].noDue;
  return formatDue(`${key}T12:00:00.000Z`, locale, copy[locale].noDue);
}

function taskContext(task: StaffTask) {
  return [task.vehicle?.plateNumber, task.vehicle?.nickname, task.vehicleLabel, task.order?.renterName, task.orderLabel]
    .filter(Boolean)
    .join(" · ");
}

function upsertTask(tasks: StaffTask[], nextTask: StaffTask) {
  const index = tasks.findIndex((task) => task.id === nextTask.id);
  if (index === -1) return [...tasks, nextTask];
  const next = [...tasks];
  next[index] = nextTask;
  return next;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const labels = copy[locale];
  const [token, setToken] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [staffCode, setStaffCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<StaffTask | null>(null);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  const activeTasks = useMemo(
    () => tasks.filter((task) => !task.parentTaskId && !isClosed(task)).sort(sortTasks),
    [tasks],
  );
  const historyTasks = useMemo(
    () => tasks.filter((task) => !task.parentTaskId && isClosed(task)).sort(sortTasks),
    [tasks],
  );
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const task of tasks) {
      if (!task.parentTaskId || task.status === "cancelled") continue;
      const list = map.get(task.parentTaskId) ?? [];
      list.push(task);
      map.set(task.parentTaskId, list);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [tasks]);

  useEffect(() => {
    void restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const [storedToken, storedCode] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(STAFF_CODE_KEY),
      ]);
      if (storedCode) setStaffCode(storedCode);
      if (!storedToken) return;
      const payload = await fetchCurrentStaff(storedToken);
      setToken(storedToken);
      setStaff(payload.staff);
      setTasks(payload.tasks);
    } catch {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function signIn() {
    const code = staffCode.trim();
    if (!code) return;
    setSaving(true);
    try {
      const payload = await loginWithStaffCode(code);
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, payload.token),
        SecureStore.setItemAsync(STAFF_CODE_KEY, code),
      ]);
      setToken(payload.token);
      setStaff(payload.staff);
      setTasks(payload.tasks);
      setNotice(null);
    } catch {
      setNotice(labels.loginFailed);
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const payload = await fetchCurrentStaff(token);
      setStaff(payload.staff);
      setTasks(payload.tasks);
      setNotice(null);
    } catch {
      setNotice(labels.failed);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setStaff(null);
    setTasks([]);
  }

  async function patchTask(task: StaffTask, body: Parameters<typeof updateTask>[2]) {
    if (!token) return;
    setSaving(true);
    try {
      const payload = await updateTask(token, task.id, body);
      if (payload.unassigned) {
        setTasks((current) => current.filter((item) => item.id !== task.id && item.parentTaskId !== task.id));
      } else if (payload.task) {
        setTasks((current) => upsertTask(current, payload.task as StaffTask));
      }
      setNotice(labels.saved);
    } catch {
      setNotice(labels.failed);
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhotos(task: StaffTask, source: "camera" | "library") {
    if (!token) return;
    setSaving(true);
    setNotice(labels.compressing);
    try {
      const photos = source === "camera" ? await takePhotoWithCamera() : await pickPhotoFromLibrary();
      if (photos.length === 0) return;
      const attachments = await uploadTaskPhotos(token, task.id, photos);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, attachments: [...item.attachments, ...attachments] } : item,
        ),
      );
      setNotice(labels.saved);
    } catch {
      setNotice(labels.failed);
    } finally {
      setSaving(false);
    }
  }

  function choosePhotoSource(task: StaffTask) {
    Alert.alert(labels.chooseSource, task.title, [
      { text: labels.camera, onPress: () => void uploadPhotos(task, "camera") },
      { text: labels.library, onPress: () => void uploadPhotos(task, "library") },
      { text: labels.cancel, style: "cancel" },
    ]);
  }

  const groupedActiveTasks = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const task of activeTasks) {
      const key = dateKey(task.dueDatetime);
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [activeTasks]);

  if (loading && !token) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#111111" />
      </SafeAreaView>
    );
  }

  if (!token || !staff) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.loginCard}>
          <Text style={styles.brand}>{labels.appName}</Text>
          <Text style={styles.loginSubtitle}>{labels.subtitle}</Text>
          <View style={styles.languageRow}>
            <Pressable style={[styles.languageButton, locale === "en" && styles.languageActive]} onPress={() => setLocale("en")}>
              <Text style={[styles.languageText, locale === "en" && styles.languageTextActive]}>EN</Text>
            </Pressable>
            <Pressable style={[styles.languageButton, locale === "zh" && styles.languageActive]} onPress={() => setLocale("zh")}>
              <Text style={[styles.languageText, locale === "zh" && styles.languageTextActive]}>中文</Text>
            </Pressable>
          </View>
          <TextInput
            value={staffCode}
            onChangeText={setStaffCode}
            placeholder={labels.codePlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => void signIn()}
          />
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Pressable style={styles.primaryButton} onPress={() => void signIn()} disabled={saving}>
            <Text style={styles.primaryText}>{saving ? labels.signingIn : labels.signIn}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerKicker}>{labels.appName}</Text>
          <View style={styles.languageRowCompact}>
            <Pressable onPress={() => setLocale("en")} style={[styles.languagePill, locale === "en" && styles.languagePillActive]}>
              <Text style={[styles.languagePillText, locale === "en" && styles.languagePillTextActive]}>EN</Text>
            </Pressable>
            <Pressable onPress={() => setLocale("zh")} style={[styles.languagePill, locale === "zh" && styles.languagePillActive]}>
              <Text style={[styles.languagePillText, locale === "zh" && styles.languagePillTextActive]}>中文</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.staffRow}>
          <View style={[styles.staffDot, { backgroundColor: staff.color || "#111111" }]} />
          <View style={styles.staffText}>
            <Text style={styles.staffName}>{staff.name}</Text>
            <Text style={styles.staffRole}>{staff.role || staff.email || ""}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.headerButton} onPress={() => void refresh()}>
            <Text style={styles.headerButtonText}>{labels.refresh}</Text>
          </Pressable>
          <Pressable style={styles.headerButton} onPress={() => void signOut()}>
            <Text style={styles.headerButtonText}>{labels.signOut}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        {notice ? <Text style={styles.noticeCard}>{notice}</Text> : null}
        {staff.pinnedMessage ? <Text style={styles.pinned}>{staff.pinnedMessage}</Text> : null}

        <Text style={styles.sectionTitle}>{labels.open}</Text>
        {groupedActiveTasks.length === 0 ? <Text style={styles.empty}>{labels.noTasks}</Text> : null}
        {groupedActiveTasks.map(([key, group]) => (
          <View key={key} style={styles.group}>
            <Text style={styles.groupTitle}>{formatGroupLabel(key, locale)}</Text>
            {group.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                locale={locale}
                subtasks={subtasksByParent.get(task.id) ?? []}
                onEdit={setEditingTask}
                onComplete={(item) => void patchTask(item, { status: item.status === "done" ? "todo" : "done" })}
                onUnassign={(item) => void patchTask(item, { unassign: true })}
                onUpload={choosePhotoSource}
                onPreview={setPreview}
              />
            ))}
          </View>
        ))}

        <Text style={styles.sectionTitle}>{labels.history}</Text>
        {historyTasks.length === 0 ? <Text style={styles.empty}>{labels.noTasks}</Text> : null}
        {historyTasks.slice(0, 10).map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            locale={locale}
            subtasks={subtasksByParent.get(task.id) ?? []}
            compact
            onEdit={setEditingTask}
            onComplete={(item) => void patchTask(item, { status: item.status === "done" ? "todo" : "done" })}
            onUnassign={(item) => void patchTask(item, { unassign: true })}
            onUpload={choosePhotoSource}
            onPreview={setPreview}
          />
        ))}
      </ScrollView>

      {saving ? (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : null}
      <EditTaskModal
        task={editingTask}
        locale={locale}
        onClose={() => setEditingTask(null)}
        onSave={(task, values) => {
          setEditingTask(null);
          void patchTask(task, values);
        }}
      />
      <ImagePreview attachment={preview} onClose={() => setPreview(null)} />
    </SafeAreaView>
  );
}

function TaskCard({
  task,
  locale,
  subtasks,
  compact,
  onEdit,
  onComplete,
  onUnassign,
  onUpload,
  onPreview,
}: {
  task: StaffTask;
  locale: Locale;
  subtasks: StaffTask[];
  compact?: boolean;
  onEdit: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onUnassign: (task: StaffTask) => void;
  onUpload: (task: StaffTask) => void;
  onPreview: (attachment: TaskAttachment) => void;
}) {
  const labels = copy[locale];
  const closed = isClosed(task);
  const overdue = task.dueDatetime && new Date(task.dueDatetime).getTime() < Date.now() && !closed;
  return (
    <View style={[styles.taskCard, compact && styles.taskCardCompact]}>
      <View style={styles.taskHeader}>
        <View style={styles.taskTitleWrap}>
          <View style={styles.badgeRow}>
            {overdue ? <Text style={styles.dueBadge}>{labels.overdue}</Text> : null}
            <Text style={styles.taskTitle}>{task.title}</Text>
          </View>
          <Text style={styles.taskMeta}>
            {formatDue(task.dueDatetime, locale, labels.noDue)}
            {task.timeWindow ? ` · ${task.timeWindow}` : ""}
          </Text>
          {taskContext(task) ? <Text style={styles.taskMeta}>{taskContext(task)}</Text> : null}
          {task.details ? <Text style={styles.taskDetails}>{task.details}</Text> : null}
        </View>
      </View>
      <AttachmentStrip attachments={task.attachments} onPreview={onPreview} />
      {subtasks.length > 0 ? (
        <View style={styles.subtaskList}>
          {subtasks.map((subtask) => (
            <View key={subtask.id} style={styles.subtaskCard}>
              <Text style={styles.subtaskTitle}>{subtask.title}</Text>
              <Text style={styles.subtaskMeta}>
                {formatDue(subtask.dueDatetime, locale, labels.noDue)}
                {subtask.timeWindow ? ` · ${subtask.timeWindow}` : ""}
              </Text>
              <AttachmentStrip attachments={subtask.attachments} onPreview={onPreview} small />
              <View style={styles.subtaskActions}>
                {!isClosed(subtask) ? (
                  <SmallButton label={labels.unassign} onPress={() => onUnassign(subtask)} tone="neutral" />
                ) : null}
                <SmallButton label={labels.edit} onPress={() => onEdit(subtask)} tone="amber" />
                <SmallButton label={labels.uploadPhoto} onPress={() => onUpload(subtask)} tone="sky" />
                <SmallButton
                  label={subtask.status === "done" ? labels.reopen : labels.complete}
                  onPress={() => onComplete(subtask)}
                  tone="green"
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.taskActions}>
        {!closed ? <ActionButton label={labels.unassign} onPress={() => onUnassign(task)} tone="neutral" /> : null}
        <ActionButton label={labels.edit} onPress={() => onEdit(task)} tone="amber" />
        <ActionButton label={labels.uploadPhoto} onPress={() => onUpload(task)} tone="sky" />
        <ActionButton label={task.status === "done" ? labels.reopen : labels.complete} onPress={() => onComplete(task)} tone="green" />
      </View>
    </View>
  );
}

function AttachmentStrip({
  attachments,
  small,
  onPreview,
}: {
  attachments: TaskAttachment[];
  small?: boolean;
  onPreview: (attachment: TaskAttachment) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentRow}>
      {attachments.map((attachment) => (
        <Pressable key={attachment.id} onPress={() => onPreview(attachment)}>
          <Image source={{ uri: attachment.url }} style={small ? styles.attachmentSmall : styles.attachment} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ActionButton({ label, tone, onPress }: { label: string; tone: keyof typeof buttonTones; onPress: () => void }) {
  return (
    <Pressable style={[styles.actionButton, buttonTones[tone]]} onPress={onPress}>
      <Text style={[styles.actionButtonText, buttonTextTones[tone]]}>{label}</Text>
    </Pressable>
  );
}

function SmallButton({ label, tone, onPress }: { label: string; tone: keyof typeof buttonTones; onPress: () => void }) {
  return (
    <Pressable style={[styles.smallButton, buttonTones[tone]]} onPress={onPress}>
      <Text style={[styles.smallButtonText, buttonTextTones[tone]]}>{label}</Text>
    </Pressable>
  );
}

function EditTaskModal({
  task,
  locale,
  onClose,
  onSave,
}: {
  task: StaffTask | null;
  locale: Locale;
  onClose: () => void;
  onSave: (task: StaffTask, values: Partial<Pick<StaffTask, "title" | "details" | "dueDatetime" | "timeWindow">>) => void;
}) {
  const labels = copy[locale];
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("");
  const [details, setDetails] = useState("");

  useEffect(() => {
    setTitle(task?.title ?? "");
    setDate(task?.dueDatetime ? task.dueDatetime.slice(0, 10) : "");
    setTimeWindow(task?.timeWindow ?? "");
    setDetails(task?.details ?? "");
  }, [task]);

  if (!task) return null;
  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{labels.edit}</Text>
          <Text style={styles.inputLabel}>{labels.title}</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} />
          <Text style={styles.inputLabel}>{labels.date}</Text>
          <TextInput value={date} onChangeText={setDate} style={styles.input} placeholder="YYYY-MM-DD" />
          <Text style={styles.inputLabel}>{labels.timeWindow}</Text>
          <TextInput value={timeWindow} onChangeText={setTimeWindow} style={styles.input} />
          <Text style={styles.inputLabel}>{labels.details}</Text>
          <TextInput value={details} onChangeText={setDetails} style={[styles.input, styles.textArea]} multiline />
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryText}>{labels.cancel}</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButtonSmall}
              onPress={() => onSave(task, { title, dueDatetime: date, timeWindow, details })}
            >
              <Text style={styles.primaryText}>{labels.save}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ImagePreview({ attachment, onClose }: { attachment: TaskAttachment | null; onClose: () => void }) {
  if (!attachment) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.previewBackdrop}>
        <Image source={{ uri: attachment.url }} style={styles.previewImage} resizeMode="contain" />
        <Pressable style={styles.previewClose} onPress={onClose}>
          <Text style={styles.previewCloseText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const buttonTones = {
  neutral: { borderColor: "#d4d4d4", backgroundColor: "#fafafa" },
  amber: { borderColor: "#fbbf24", backgroundColor: "#fffbeb" },
  sky: { borderColor: "#38bdf8", backgroundColor: "#f0f9ff" },
  green: { borderColor: "#34d399", backgroundColor: "#ecfdf5" },
};

const buttonTextTones = {
  neutral: { color: "#404040" },
  amber: { color: "#92400e" },
  sky: { color: "#075985" },
  green: { color: "#065f46" },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f4f5" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f4f4f5" },
  loginCard: { flex: 1, justifyContent: "center", padding: 24 },
  brand: { fontSize: 34, fontWeight: "800", color: "#111111" },
  loginSubtitle: { marginTop: 8, marginBottom: 24, color: "#737373", fontSize: 16, lineHeight: 22 },
  languageRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  languageButton: { minHeight: 40, minWidth: 72, borderWidth: 1, borderColor: "#d4d4d4", alignItems: "center", justifyContent: "center" },
  languageActive: { backgroundColor: "#111111", borderColor: "#111111" },
  languageText: { fontWeight: "700", color: "#404040" },
  languageTextActive: { color: "#ffffff" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#d4d4d4", backgroundColor: "#ffffff", paddingHorizontal: 14, fontSize: 16, color: "#111111" },
  textArea: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { marginTop: 14, minHeight: 52, backgroundColor: "#111111", alignItems: "center", justifyContent: "center" },
  primaryButtonSmall: { minHeight: 46, minWidth: 110, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryText: { color: "#ffffff", fontWeight: "800", fontSize: 16 },
  secondaryButton: { minHeight: 46, minWidth: 110, borderWidth: 1, borderColor: "#d4d4d4", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  secondaryText: { color: "#111111", fontWeight: "700" },
  notice: { marginTop: 12, color: "#b91c1c" },
  header: { backgroundColor: "#111111", paddingHorizontal: 16, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 },
  headerKicker: { color: "#a3a3a3", fontSize: 12, fontWeight: "700" },
  languageRowCompact: { flexDirection: "row", borderWidth: 1, borderColor: "#3f3f46" },
  languagePill: { minHeight: 28, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  languagePillActive: { backgroundColor: "#ffffff" },
  languagePillText: { color: "#d4d4d4", fontWeight: "700", fontSize: 12 },
  languagePillTextActive: { color: "#111111" },
  staffRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  staffDot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  staffText: { minWidth: 0, flex: 1 },
  staffName: { color: "#ffffff", fontSize: 28, fontWeight: "800" },
  staffRole: { color: "#d4d4d4", fontSize: 14, marginTop: 2 },
  headerActions: { marginTop: 16, flexDirection: "row", gap: 8 },
  headerButton: { borderWidth: 1, borderColor: "#525252", minHeight: 38, justifyContent: "center", paddingHorizontal: 14 },
  headerButtonText: { color: "#ffffff", fontWeight: "700" },
  content: { padding: 12, paddingBottom: 40 },
  noticeCard: { borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2", color: "#991b1b", padding: 10, marginBottom: 10 },
  pinned: { borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", color: "#92400e", padding: 10, marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#262626", marginTop: 8, marginBottom: 8 },
  group: { marginBottom: 10 },
  groupTitle: { color: "#737373", fontSize: 12, fontWeight: "800", marginBottom: 6, paddingHorizontal: 2 },
  empty: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e5e5e5", padding: 16, color: "#737373" },
  taskCard: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e5e5e5", padding: 12, marginBottom: 10 },
  taskCardCompact: { opacity: 0.92 },
  taskHeader: { flexDirection: "row", gap: 10 },
  taskTitleWrap: { flex: 1, minWidth: 0 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dueBadge: { backgroundColor: "#dc2626", color: "#ffffff", fontSize: 11, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 2 },
  taskTitle: { flex: 1, minWidth: 0, color: "#111111", fontSize: 18, fontWeight: "800", lineHeight: 23 },
  taskMeta: { color: "#737373", fontSize: 14, marginTop: 4 },
  taskDetails: { color: "#525252", fontSize: 14, lineHeight: 20, marginTop: 6 },
  attachmentRow: { gap: 8, paddingTop: 10 },
  attachment: { width: 68, height: 68, backgroundColor: "#f5f5f5" },
  attachmentSmall: { width: 48, height: 48, backgroundColor: "#f5f5f5" },
  subtaskList: { marginTop: 10, gap: 8 },
  subtaskCard: { borderWidth: 1, borderColor: "#e5e5e5", backgroundColor: "#fafafa", padding: 8 },
  subtaskTitle: { color: "#262626", fontSize: 13, fontWeight: "800" },
  subtaskMeta: { color: "#737373", fontSize: 11, marginTop: 3 },
  subtaskActions: { flexDirection: "row", gap: 5, marginTop: 8 },
  taskActions: { flexDirection: "row", gap: 6, marginTop: 12 },
  actionButton: { flex: 1, minHeight: 42, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  actionButtonText: { fontSize: 12, fontWeight: "800", textAlign: "center" },
  smallButton: { flex: 1, minHeight: 30, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  smallButtonText: { fontSize: 9, fontWeight: "800", textAlign: "center" },
  savingOverlay: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.75)", padding: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#ffffff", padding: 16, gap: 8 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#111111", marginBottom: 8 },
  inputLabel: { color: "#525252", fontSize: 12, fontWeight: "800" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  previewImage: { width: "100%", height: "78%" },
  previewClose: { marginTop: 18, borderWidth: 1, borderColor: "#ffffff", paddingHorizontal: 18, minHeight: 42, justifyContent: "center" },
  previewCloseText: { color: "#ffffff", fontWeight: "800" },
});
