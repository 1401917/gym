import { quickFoods } from './data.js';

import { getCurrentLocale, t, tp } from './i18n.js';
import { calculateTarget } from './engine.js';

export function createUI(getState, addItem, deleteItem, showToast) {
  const today = new Date();
  let calendarCursor = { year: today.getFullYear(), month: today.getMonth() };
  let toastTimer = null;
  let activeDayDetailEntry = null;
  let dayDetailMealsVisible = false;

  function el(id) {
    return document.getElementById(id);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseDayStamp(dayStamp) {
    const date = new Date(`${dayStamp}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDayStamp(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDayLabel(dayStamp) {
    const date = parseDayStamp(dayStamp);
    if (!date) {
      return dayStamp;
    }

    return date.toLocaleDateString(getCurrentLocale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
    });
  }

  function formatFullDayLabel(dayStamp) {
    const date = parseDayStamp(dayStamp);
    if (!date) {
      return dayStamp;
    }

    return date.toLocaleDateString(getCurrentLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function formatMonthLabel(year, month) {
    return new Date(year, month, 1).toLocaleDateString(getCurrentLocale(), {
      month: 'long',
      year: 'numeric',
    });
  }

  function formatChartLabel(dayStamp) {
    const date = parseDayStamp(dayStamp);
    if (!date) {
      return dayStamp;
    }

    return date.toLocaleDateString(getCurrentLocale(), {
      day: 'numeric',
      month: 'numeric',
    });
  }

  function getCalculatedTargets(settings) {
    const result = calculateTarget({
      weight: parseFloat(settings?.goalWeight || 0),
      targetKg: parseFloat(settings?.goalTargetWeight || 0) || undefined,
      age: parseInt(settings?.goalAge || 25, 10),
      gender: settings?.goalGender || 'male',
      height: parseInt(settings?.goalHeight || 170, 10),
      activityLevel: settings?.activityLevel || 'moderate',
      goal: settings?.goalType || 'maintain',
      meals: 4,
      extraProtein: 0,
    });

    if (!result) {
      return {
        target: 0,
        calorieTarget: 0,
      };
    }

    return {
      target: Number(result.dailyTarget || 0),
      calorieTarget: Number(result.calorieTarget || 0),
    };
  }

  function setRingProgress(circle, percentage) {
    if (!circle) return;

    const radius = Number(circle.getAttribute('r') || 0) || 42;
    const circumference = 2 * Math.PI * radius;
    const safePercentage = Math.max(0, Math.min(100, Number(percentage || 0)));
    const dashOffset = circumference * (1 - safePercentage / 100);
    circle.setAttribute('stroke-dasharray', String(circumference));
    circle.setAttribute('stroke-dashoffset', String(dashOffset));
    circle.style.strokeDasharray = String(circumference);
    circle.style.strokeDashoffset = String(dashOffset);
  }

  function setMeterProgress(bar, percentage) {
    if (!bar) return;

    const safePercentage = Math.max(0, Math.min(100, Number(percentage || 0)));
    bar.style.width = `${safePercentage}%`;
  }

  function buildQuickCard(food) {
    const label = food.nameKey ? t(food.nameKey) : food.name;
    const btn = document.createElement('button');
    btn.className = 'quick-card';
    btn.innerHTML = `
      <span class="qc-name">${escHtml(label)}</span>
      <span class="qc-prot">${t('food.value.protein', { value: food.protein })}</span>
      <span class="qc-cal">${t('food.value.calories', { value: food.calories })}</span>
    `;

    btn.addEventListener('click', () => {
      addItem({ name: label, nameKey: food.nameKey, protein: food.protein, calories: food.calories });
      showToast(t('food.toast.added', { name: label }));
    });

    return btn;
  }

  function renderQuickContainer(containerId, query = '') {
    const container = el(containerId);
    if (!container) return;

    const normalizedQuery = query.trim().toLowerCase();
    const recentFoods = (getState().recentFoods || []).map((food) => ({
      ...food,
      recent: true,
    }));
    const allFoods = [...recentFoods, ...quickFoods].filter((food, index, list) => {
      const label = food.nameKey ? t(food.nameKey) : food.name;
      return list.findIndex((candidate) => {
        const candidateLabel = candidate.nameKey ? t(candidate.nameKey) : candidate.name;
        return candidateLabel === label;
      }) === index;
    });
    const filteredFoods = normalizedQuery
      ? allFoods.filter((food) => {
          const label = food.nameKey ? t(food.nameKey) : food.name;
          return String(label || '').toLowerCase().includes(normalizedQuery);
        })
      : allFoods;

    container.innerHTML = '';

    if (!filteredFoods.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-no-results';
      empty.textContent = t('food.noResults');
      container.appendChild(empty);
      return;
    }

    filteredFoods.forEach((food) => container.appendChild(buildQuickCard(food)));
  }

  function wireSearchInput(inputId, containerId) {
    const input = el(inputId);
    if (!input || input.dataset.wired) return;

    input.dataset.wired = '1';
    input.addEventListener('input', () => {
      renderQuickContainer(containerId, input.value);
    });
  }

  function renderQuickGrid() {
    renderQuickContainer('modalQuickGrid', el('modalSearchInput')?.value || '');
    wireSearchInput('modalSearchInput', 'modalQuickGrid');
  }

  function buildLogItem(item, index) {
    const displayName = item.nameKey ? t(item.nameKey) : item.name;
    const li = document.createElement('li');
    li.className = 'log-item';
    li.innerHTML = `
      <span class="log-item-name">${escHtml(displayName)}</span>
      <span class="log-item-meta">
        <span class="log-prot-badge">${t('food.value.protein', { value: item.protein })}</span>
        <span class="log-cal-txt">${t('food.value.calories', { value: item.calories })}</span>
        <button class="log-del" data-idx="${index}" title="${t('log.delete')}">×</button>
      </span>
    `;

    li.querySelector('.log-del')?.addEventListener('click', () => deleteItem(index));
    return li;
  }

  function createEmptyLog(message) {
    const li = document.createElement('li');
    li.className = 'empty-log';
    li.textContent = message;
    return li;
  }

  function renderLog(listId, emptyMessage) {
    const listEl = el(listId);
    if (!listEl) return;

    const items = getState().logItems || [];
    listEl.innerHTML = '';

    if (!items.length) {
      listEl.appendChild(createEmptyLog(emptyMessage));
      return;
    }

    items.forEach((item, index) => listEl.appendChild(buildLogItem(item, index)));
  }

  function renderAllLogs() {
    renderLog('homeLogList', t('home.emptyLog'));
  }

  function buildDayDetailMealItem(item) {
    const displayName = item.nameKey ? t(item.nameKey) : item.name;
    const row = document.createElement('article');
    row.className = 'day-detail-meal-item';
    row.innerHTML = `
      <div class="day-detail-meal-copy">
        <strong class="day-detail-meal-name">${escHtml(displayName || t('food.addTitle'))}</strong>
        <div class="day-detail-meal-meta">
          <span class="day-detail-badge">${t('food.value.protein', { value: Number(item.protein || 0) })}</span>
          <span class="day-detail-badge day-detail-badge-calories">${t('food.value.calories', { value: Number(item.calories || 0) })}</span>
        </div>
      </div>
    `;

    return row;
  }

  function renderDayDetailMeals() {
    const toggleBtn = el('dayDetailMealsToggleBtn');
    const section = el('dayDetailMealsSection');
    const list = el('dayDetailMealsList');
    if (!toggleBtn || !section || !list) return;

    const items = Array.isArray(activeDayDetailEntry?.items) ? activeDayDetailEntry.items : [];
    const hasMeals = items.length > 0;

    toggleBtn.hidden = !hasMeals;
    toggleBtn.textContent = dayDetailMealsVisible ? t('dayDetail.hideMeals') : t('dayDetail.showMeals');
    section.hidden = !hasMeals || !dayDetailMealsVisible;
    list.innerHTML = '';

    if (!hasMeals || !dayDetailMealsVisible) {
      return;
    }

    items.forEach((item) => list.appendChild(buildDayDetailMealItem(item)));
  }

  function wireDayDetailControls() {
    const toggleBtn = el('dayDetailMealsToggleBtn');
    if (!toggleBtn || toggleBtn.dataset.wired) return;

    toggleBtn.dataset.wired = '1';
    toggleBtn.addEventListener('click', () => {
      dayDetailMealsVisible = !dayDetailMealsVisible;
      renderDayDetailMeals();
    });
  }

  function getComputedStats() {
    const state = getState();
    const items = state.logItems || [];
    const totalProtein = items.reduce((sum, item) => sum + Number(item.protein || 0), 0);
    const totalCalories = items.reduce((sum, item) => sum + Number(item.calories || 0), 0);
    const settings = state.settings || {};
    const calculatedTargets = getCalculatedTargets(settings);
    const target = Number(settings.proteinGoal || 0) || calculatedTargets.target || Number(state.target || 0);
    const calorieTarget = Number(settings.calorieGoal || 0) || calculatedTargets.calorieTarget || Number(state.calorieTarget || 0);
    const proteinPercentage = target ? Math.min(100, Math.round((totalProtein / target) * 100)) : 0;
    const caloriePercentage = calorieTarget ? Math.min(100, Math.round((totalCalories / calorieTarget) * 100)) : 0;
    const proteinRemaining = target ? Math.max(0, target - totalProtein) : null;
    const calorieRemaining = calorieTarget ? Math.max(0, calorieTarget - totalCalories) : null;

    const entryMap = new Map();
    const currentEntry = {
      dayStamp: state.dayStamp,
      totalProtein,
      totalCalories,
      itemCount: items.length,
      target,
      calorieTarget,
      items: items.map((item) => ({ ...item })),
    };

    [currentEntry, ...(state.history || [])].forEach((entry) => {
      if (!entry || !entry.dayStamp || entryMap.has(entry.dayStamp)) {
        return;
      }

      entryMap.set(entry.dayStamp, {
        dayStamp: entry.dayStamp,
        totalProtein: Number(entry.totalProtein || 0),
        totalCalories: Number(entry.totalCalories || 0),
        itemCount: Number(entry.itemCount || 0),
        target: Number(entry.target || 0),
        calorieTarget: Number(entry.calorieTarget || 0),
        items: Array.isArray(entry.items) ? entry.items.map((item) => ({ ...item })) : [],
      });
    });

    const timelineEntries = Array.from(entryMap.values()).sort((a, b) => b.dayStamp.localeCompare(a.dayStamp));

    return {
      state,
      items,
      totalProtein,
      totalCalories,
      target,
      calorieTarget,
      proteinPercentage,
      caloriePercentage,
      proteinRemaining,
      calorieRemaining,
      itemCount: items.length,
      timelineEntries,
    };
  }

  function buildMotivation(stats) {
    if (!stats.target && !stats.calorieTarget) {
      return t('home.motivation.noTargets');
    }

    if (stats.itemCount === 0) {
      return t('home.motivation.noItems');
    }

    if ((stats.target && stats.proteinPercentage >= 100) && (!stats.calorieTarget || stats.caloriePercentage >= 100)) {
      return t('home.motivation.complete');
    }

    if (stats.target && stats.proteinPercentage >= 75) {
      return t('home.motivation.almost');
    }

    return t('home.motivation.progress');
  }

  function buildHistoryEntries(stats) {
    return stats.timelineEntries
      .filter((entry) => Number(entry.totalProtein || 0) || Number(entry.totalCalories || 0) || Number(entry.itemCount || 0))
      .slice(0, 7);
  }

  function openDayDetail(dayStamp, entry) {
    const modal = el('dayDetailModal');
    if (!modal) return;

    const stats = getComputedStats();
    const selectedEntry = entry || stats.timelineEntries.find((item) => item.dayStamp === dayStamp);
    const totalProtein = Number(selectedEntry?.totalProtein || 0);
    const totalCalories = Number(selectedEntry?.totalCalories || 0);
    activeDayDetailEntry = {
      ...(selectedEntry || {}),
      items: Array.isArray(selectedEntry?.items) ? selectedEntry.items : [],
    };
    dayDetailMealsVisible = false;

    const title = el('dayDetailTitle');
    const protein = el('dayDetailProtein');
    const calories = el('dayDetailCalories');
    const note = el('dayDetailNote');

    if (title) title.textContent = formatFullDayLabel(dayStamp);
    if (protein) protein.textContent = `${totalProtein}g`;
    if (calories) calories.textContent = `${totalCalories}`;

    if (note) {
      note.textContent = totalProtein || totalCalories
        ? t('dayDetail.noteData', { protein: totalProtein, calories: totalCalories })
        : dayStamp === stats.state.dayStamp
          ? t('dayDetail.noteToday')
          : t('dayDetail.noteEmpty');
    }

    renderDayDetailMeals();
    modal.classList.add('open');
  }

  function renderMetricChart(containerId, entries, valueKey, unit, toneClass) {
    const container = el(containerId);
    if (!container) return;

    container.innerHTML = '';

    const minimumChartDays = 3;
    if (entries.length < minimumChartDays) {
      container.innerHTML = `<div class="quick-no-results">${t('stats.chartEmpty')}</div>`;
      return;
    }

    const orderedEntries = entries.slice().reverse();
    const maxValue = Math.max(...orderedEntries.map((entry) => Number(entry[valueKey] || 0)), 1);

    orderedEntries.forEach((entry) => {
      const value = Number(entry[valueKey] || 0);
      const fillHeight = Math.max(8, Math.round((value / maxValue) * 100));
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = `chart-bar ${toneClass}`;
      bar.innerHTML = `
        <span class="chart-bar-value">${value}${unit}</span>
        <span class="chart-bar-track">
          <span class="chart-bar-fill" style="height:${fillHeight}%"></span>
        </span>
        <span class="chart-bar-label">${formatChartLabel(entry.dayStamp)}</span>
      `;

      bar.addEventListener('click', () => openDayDetail(entry.dayStamp, entry));
      container.appendChild(bar);
    });
  }

  function renderStatsScreen(stats) {
    const listEl = el('statsHistoryList');
    if (!listEl) return;

    const historyEntries = buildHistoryEntries(stats);
    const averageProtein = historyEntries.length
      ? Math.round(historyEntries.reduce((sum, entry) => sum + Number(entry.totalProtein || 0), 0) / historyEntries.length)
      : 0;
    const averageCalories = historyEntries.length
      ? Math.round(historyEntries.reduce((sum, entry) => sum + Number(entry.totalCalories || 0), 0) / historyEntries.length)
      : 0;
    const bestDay = historyEntries.reduce((best, entry) => {
      if (!best || Number(entry.totalProtein || 0) > Number(best.totalProtein || 0)) {
        return entry;
      }
      return best;
    }, null);
    const completionEntries = historyEntries.filter((entry) => Number(entry.target || 0) > 0);
    const completion = completionEntries.length
      ? Math.round(
          completionEntries.reduce((sum, entry) => (
            sum + Math.min(100, Math.round((Number(entry.totalProtein || 0) / Number(entry.target || 1)) * 100))
          ), 0) / completionEntries.length
        )
      : 0;

    const avgProteinEl = el('statsAverageProtein');
    const avgCaloriesEl = el('statsAverageCalories');
    const bestDayEl = el('statsBestDay');
    const completionEl = el('statsCompletion');
    const summaryEl = el('statsTargetSummary');

    if (avgProteinEl) avgProteinEl.textContent = `${averageProtein}g`;
    if (avgCaloriesEl) avgCaloriesEl.textContent = `${averageCalories}`;
    if (bestDayEl) bestDayEl.textContent = bestDay ? formatDayLabel(bestDay.dayStamp) : '—';
    if (completionEl) completionEl.textContent = `${completion}%`;
    if (summaryEl) {
      summaryEl.textContent = stats.target || stats.calorieTarget
        ? t('stats.summary.targets', { protein: stats.target || '—', calories: stats.calorieTarget || '—' })
        : t('stats.summary.default');
    }

    renderMetricChart('statsProteinChart', historyEntries, 'totalProtein', 'g', 'chart-bar-protein');
    renderMetricChart('statsCaloriesChart', historyEntries, 'totalCalories', '', 'chart-bar-calories');

    listEl.innerHTML = '';

    if (!historyEntries.length) {
      listEl.innerHTML = `<div class="quick-no-results">${t('stats.historyEmpty')}</div>`;
      return;
    }

    const maxProtein = Math.max(...historyEntries.map((entry) => Number(entry.totalProtein || 0)), 1, stats.target || 0);

    historyEntries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const completionPct = entry.target ? Math.min(100, Math.round((Number(entry.totalProtein || 0) / Number(entry.target || 1)) * 100)) : 0;
      const barWidth = Math.max(8, Math.round((Number(entry.totalProtein || 0) / maxProtein) * 100));

      row.innerHTML = `
        <div class="history-row-top">
          <span class="history-day">${formatDayLabel(entry.dayStamp)}</span>
          <span class="topbar-badge">${completionPct}%</span>
        </div>
        <div class="history-metrics">
          <span>${t('stats.historyProtein', { value: Number(entry.totalProtein || 0) })}</span>
          <span>${t('stats.historyCalories', { value: Number(entry.totalCalories || 0) })}</span>
        </div>
        <div class="history-bar"><span style="width:${barWidth}%"></span></div>
      `;

      row.addEventListener('click', () => openDayDetail(entry.dayStamp, entry));
      listEl.appendChild(row);
    });
  }

  function buildInsights(stats) {
    const row = el('goalsInsights');
    if (!row) return;

    const insights = [];

    if (stats.target) {
      insights.push(
        stats.proteinRemaining && stats.proteinRemaining > 0
          ? t('goals.insight.proteinRemaining', { value: stats.proteinRemaining })
          : t('goals.insight.proteinDone')
      );
    }

    if (stats.calorieTarget) {
      insights.push(
        stats.calorieRemaining && stats.calorieRemaining > 0
          ? t('goals.insight.caloriesRemaining', { value: stats.calorieRemaining })
          : t('goals.insight.caloriesDone')
      );
    }

    if (stats.itemCount > 0) {
      insights.push(tp('goals.insight.items', stats.itemCount, { count: stats.itemCount }));
    }

    if (!insights.length) {
      insights.push(t('goals.insight.empty'));
    }

    row.innerHTML = insights.map((text) => `<div class="insight-item">${text}</div>`).join('');
  }

  function wireCalendarControls() {
    const prevBtn = el('calendarPrevBtn');
    const nextBtn = el('calendarNextBtn');
    const todayBtn = el('calendarTodayBtn');

    if (prevBtn && !prevBtn.dataset.wired) {
      prevBtn.dataset.wired = '1';
      prevBtn.addEventListener('click', () => {
        const nextDate = new Date(calendarCursor.year, calendarCursor.month - 1, 1);
        calendarCursor = { year: nextDate.getFullYear(), month: nextDate.getMonth() };
        renderCalendar();
      });
    }

    if (nextBtn && !nextBtn.dataset.wired) {
      nextBtn.dataset.wired = '1';
      nextBtn.addEventListener('click', () => {
        const nextDate = new Date(calendarCursor.year, calendarCursor.month + 1, 1);
        calendarCursor = { year: nextDate.getFullYear(), month: nextDate.getMonth() };
        renderCalendar();
      });
    }

    if (todayBtn && !todayBtn.dataset.wired) {
      todayBtn.dataset.wired = '1';
      todayBtn.addEventListener('click', () => {
        const currentDate = new Date();
        calendarCursor = { year: currentDate.getFullYear(), month: currentDate.getMonth() };
        renderCalendar();
      });
    }
  }

  function renderCalendarWeekdays() {
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    document.querySelectorAll('[data-weekday]').forEach((node) => {
      const index = Number(node.dataset.weekday || 0);
      node.textContent = t(`weekday.${keys[index]}`);
    });
  }

  function renderCalendar(stats = getComputedStats()) {
    const grid = el('calendarGrid');
    const monthLabel = el('calendarMonthLabel');
    if (!grid || !monthLabel) return;

    renderCalendarWeekdays();
    monthLabel.textContent = formatMonthLabel(calendarCursor.year, calendarCursor.month);

    const firstDay = new Date(calendarCursor.year, calendarCursor.month, 1);
    const firstWeekday = firstDay.getDay();
    const daysInMonth = new Date(calendarCursor.year, calendarCursor.month + 1, 0).getDate();
    const cellsToRender = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const entryMap = new Map(stats.timelineEntries.map((entry) => [entry.dayStamp, entry]));

    grid.innerHTML = '';

    for (let index = 0; index < cellsToRender; index += 1) {
      const date = new Date(calendarCursor.year, calendarCursor.month, index - firstWeekday + 1);
      const dayStamp = formatDayStamp(date);
      const entry = entryMap.get(dayStamp);
      const hasData = Boolean(entry && (entry.totalProtein || entry.totalCalories || entry.itemCount));
      const isToday = dayStamp === stats.state.dayStamp;
      const isCurrentMonth = date.getMonth() === calendarCursor.month;

      const dayButton = document.createElement('button');
      dayButton.type = 'button';
      dayButton.className = `calendar-day${isCurrentMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}${hasData ? ' has-data' : ''}`;
      dayButton.innerHTML = `
        <span class="calendar-day-number">${date.getDate()}</span>
        <span class="calendar-day-body">
          <span class="calendar-day-protein">${hasData ? t('stats.historyProtein', { value: Number(entry.totalProtein || 0) }) : ''}</span>
          <span class="calendar-day-calories">${hasData ? t('stats.historyCalories', { value: Number(entry.totalCalories || 0) }) : (isCurrentMonth ? t('calendar.noData') : '')}</span>
        </span>
      `;

      dayButton.addEventListener('click', () => openDayDetail(dayStamp, entry));
      grid.appendChild(dayButton);
    }
  }

  function renderStats() {
    const stats = getComputedStats();
    const homeMotivation = el('homeMotivation');
    const homeMealsBadge = el('homeMealsBadge');

    const proteinRing = el('homeProteinRingCircle');
    const proteinPct = el('homeProteinRingPct');
    const proteinValue = el('homeProteinRingValue');
    const proteinMeta = el('homeProteinRingMeta');
    const proteinMeter = el('homeProteinMeter');

    const calorieRing = el('homeCalorieRingCircle');
    const caloriePct = el('homeCalorieRingPct');
    const calorieValue = el('homeCalorieRingValue');
    const calorieMeta = el('homeCalorieRingMeta');
    const calorieMeter = el('homeCalorieMeter');

    if (homeMotivation) homeMotivation.textContent = buildMotivation(stats);
    if (homeMealsBadge) homeMealsBadge.textContent = tp('home.meals', stats.itemCount, { count: stats.itemCount });

    setRingProgress(proteinRing, stats.proteinPercentage);
    setMeterProgress(proteinMeter, stats.proteinPercentage);
    if (proteinPct) proteinPct.textContent = `${stats.proteinPercentage}%`;
    if (proteinValue) proteinValue.textContent = stats.target ? `${stats.totalProtein} / ${stats.target}g` : `${stats.totalProtein}g`;
    if (proteinMeta) {
      proteinMeta.textContent = stats.target
        ? (stats.proteinRemaining && stats.proteinRemaining > 0
            ? t('home.remainingProtein', { value: stats.proteinRemaining })
            : t('home.goalDone'))
        : t('home.proteinGoalMissing');
    }

    setRingProgress(calorieRing, stats.caloriePercentage);
    setMeterProgress(calorieMeter, stats.caloriePercentage);
    if (caloriePct) caloriePct.textContent = `${stats.caloriePercentage}%`;
    if (calorieValue) {
      calorieValue.textContent = stats.calorieTarget
        ? t('home.calorieValue.withTarget', { total: stats.totalCalories, target: stats.calorieTarget })
        : t('home.calorieValue.noTarget', { total: stats.totalCalories });
    }
    if (calorieMeta) {
      calorieMeta.textContent = stats.calorieTarget
        ? (stats.calorieRemaining && stats.calorieRemaining > 0
            ? t('home.remainingCalories', { value: stats.calorieRemaining })
            : t('home.goalDone'))
        : t('home.calorieGoalMissing');
    }

    const goalsSumText = el('goalsSumText');
    const goalsPctText = el('goalsPctText');
    const goalsBar = el('goalsBar');
    if (goalsSumText) {
      goalsSumText.textContent = stats.target
        ? t('goals.progress.withTarget', { total: stats.totalProtein, target: stats.target })
        : t('goals.progress.noTarget', { total: stats.totalProtein });
    }
    if (goalsPctText) goalsPctText.textContent = `${stats.proteinPercentage}%`;
    if (goalsBar) goalsBar.style.width = `${stats.proteinPercentage}%`;

    buildInsights(stats);
    renderStatsScreen(stats);
    renderCalendar(stats);
  }

  function renderTodayLabel() {
    const label = el('todayLabel');
    if (!label) return;

    const activeDate = parseDayStamp(getState().dayStamp) || new Date();

    label.textContent = activeDate.toLocaleDateString(getCurrentLocale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
    });
  }

  function renderStreak() {
    const streakLabel = el('streakLabel');
    if (!streakLabel) return;

    streakLabel.textContent = tp('home.streak', getState().streak || 0, { count: getState().streak || 0 });
  }

  function renderAll() {
    wireCalendarControls();
    wireDayDetailControls();
    renderTodayLabel();
    renderStreak();
    renderQuickGrid();
    renderAllLogs();
    renderStats();
  }

  function showToastUI(message) {
    const toast = el('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2200);
  }

  return {
    renderAll,
    renderStats,
    renderAllLogs,
    renderQuickGrid,
    showToastUI,
  };
}

