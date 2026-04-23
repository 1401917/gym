export const DEFAULT_REMINDER_TIME = '19:00';
const REMINDER_CHANNEL_ID = 'daily-goal-reminders';
const REMINDER_NOTIFICATION_ID = 41001;
let webReminderTimer = null;

export function normalizeReminderTime(value = DEFAULT_REMINDER_TIME) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) {
    return DEFAULT_REMINDER_TIME;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_REMINDER_TIME;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function createReminderSettingsDefaults() {
  return {
    reminderEnabled: false,
    reminderTime: DEFAULT_REMINDER_TIME,
  };
}

export function buildReminderNotification(settings = {}, state = {}) {
  const reminderTime = normalizeReminderTime(settings.reminderTime);
  const [hour, minute] = reminderTime.split(':').map(Number);
  const proteinTarget = Number(settings.proteinGoal || state.target || 0);
  const calorieTarget = Number(settings.calorieGoal || state.calorieTarget || 0);

  let body = 'Log a meal and keep your streak moving today.';
  if (proteinTarget && calorieTarget) {
    body = `Targets today: ${proteinTarget}g protein and ${calorieTarget} calories.`;
  } else if (proteinTarget) {
    body = `Protein target today: ${proteinTarget}g. Add a meal and stay consistent.`;
  } else if (calorieTarget) {
    body = `Calorie target today: ${calorieTarget}. Log your meals and stay on track.`;
  }

  return {
    id: REMINDER_NOTIFICATION_ID,
    title: 'Daily nutrition reminder',
    body,
    schedule: {
      on: {
        hour,
        minute,
      },
      allowWhileIdle: true,
    },
    channelId: REMINDER_CHANNEL_ID,
    autoCancel: true,
  };
}

function parsePermissionState(permissions = {}) {
  if (permissions.display === 'granted' || permissions.receive === 'granted' || permissions.granted === true) {
    return 'granted';
  }

  if (permissions.display === 'denied' || permissions.receive === 'denied') {
    return 'denied';
  }

  return 'prompt';
}

function getLocalNotificationsPlugin() {
  return globalThis.window?.Capacitor?.Plugins?.LocalNotifications || null;
}

function clearWebReminder() {
  if (webReminderTimer) {
    globalThis.window?.clearTimeout(webReminderTimer);
    webReminderTimer = null;
  }
}

function scheduleWebReminder(notification) {
  clearWebReminder();

  if (typeof Notification === 'undefined') {
    return;
  }

  const now = new Date();
  const next = new Date();
  const { hour, minute } = notification.schedule.on;
  next.setHours(hour, minute, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  const delay = Math.max(1000, next.getTime() - now.getTime());
  webReminderTimer = globalThis.window?.setTimeout(() => {
    try {
      new Notification(notification.title, {
        body: notification.body,
        tag: String(notification.id),
      });
    } catch {
      // Ignore browser notification failures
    }

    scheduleWebReminder(notification);
  }, delay) || null;
}

async function cancelNativeReminder(plugin) {
  await plugin.cancel({
    notifications: [{ id: REMINDER_NOTIFICATION_ID }],
  }).catch(() => {});
}

export async function syncReminderSchedule(settings = {}, state = {}, options = {}) {
  const plugin = getLocalNotificationsPlugin();
  const requestPermission = options.requestPermission === true;

  if (!settings.reminderEnabled) {
    clearWebReminder();
    if (plugin) {
      await cancelNativeReminder(plugin);
    }

    return {
      ok: true,
      status: 'disabled',
      platform: plugin ? 'native' : 'web',
    };
  }

  const notification = buildReminderNotification(settings, state);

  if (plugin) {
    const checkedPermissions = typeof plugin.checkPermissions === 'function'
      ? await plugin.checkPermissions()
      : { display: 'prompt' };
    let permissionState = parsePermissionState(checkedPermissions);

    if (permissionState !== 'granted' && requestPermission && typeof plugin.requestPermissions === 'function') {
      const requestedPermissions = await plugin.requestPermissions();
      permissionState = parsePermissionState(requestedPermissions);
    }

    if (permissionState !== 'granted') {
      return {
        ok: false,
        status: permissionState === 'denied' ? 'permission-denied' : 'permission-required',
        platform: 'native',
      };
    }

    if (typeof plugin.createChannel === 'function') {
      await plugin.createChannel({
        id: REMINDER_CHANNEL_ID,
        name: 'Daily reminders',
        description: 'Protein and calorie reminders',
        importance: 3,
        visibility: 1,
      }).catch(() => {});
    }

    const exactAlarm = typeof plugin.checkExactNotificationSetting === 'function'
      ? await plugin.checkExactNotificationSetting().catch(() => ({ exact_alarm: 'prompt' }))
      : { exact_alarm: 'prompt' };

    await cancelNativeReminder(plugin);
    await plugin.schedule({
      notifications: [notification],
    });

    return {
      ok: true,
      status: 'scheduled',
      platform: 'native',
      exactAlarm: exactAlarm?.exact_alarm || 'prompt',
    };
  }

  if (typeof Notification === 'undefined') {
    return {
      ok: false,
      status: 'unsupported',
      platform: 'web',
    };
  }

  let permissionState = Notification.permission;
  if (permissionState !== 'granted' && requestPermission) {
    permissionState = await Notification.requestPermission();
  }

  if (permissionState !== 'granted') {
    return {
      ok: false,
      status: permissionState === 'denied' ? 'permission-denied' : 'permission-required',
      platform: 'web',
    };
  }

  scheduleWebReminder(notification);
  return {
    ok: true,
    status: 'scheduled',
    platform: 'web',
  };
}
