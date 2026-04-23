import { calculateTarget } from './engine.js';
import { t } from './i18n.js';

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?()[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function extractWeight(text) {
  if (!includesAny(text, ['kg', 'קג', 'קילו', 'שוקל', 'משקל', 'weight'])) {
    return null;
  }

  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) {
    return null;
  }

  return Number(match[1].replace(',', '.'));
}

function buildProteinTargetReply(weight) {
  if (!weight || weight < 30 || weight > 300) {
    return t('chat.proteinTarget.invalid');
  }

  const low = Math.round(weight * 1.6);
  const high = Math.round(weight * 2.2);
  return t('chat.proteinTarget.valid', { weight, low, high });
}

export function buildChatReplyFromIntent(intent, userText = '') {
  switch (intent) {
    case 'protein-target':
      return buildProteinTargetReply(extractWeight(normalizeText(userText)));
    case 'high-protein':
      return t('chat.foods');
    case 'chicken-calories':
      return t('chat.chickenCalories');
    case 'protein-timing':
      return t('chat.mealTiming');
    case 'bcaa':
      return t('chat.bcaa');
    case 'creatine':
      return t('chat.creatine');
    case 'egg-protein':
      return t('chat.egg');
    default:
      return t('chat.generic');
  }
}

export function buildChatReply(userText) {
  const normalized = normalizeText(userText);
  const weight = extractWeight(normalized);

  if (!normalized) {
    return t('chat.generic');
  }

  if (includesAny(normalized, ['שלום', 'היי', 'hey', 'hi', 'hello'])) {
    return t('chat.hello');
  }

  if (
    includesAny(normalized, [
      'כמה חלבון אני צריך',
      'כמה חלבון צריך',
      'יעד חלבון',
      'protein per day',
      'protein do i need',
    ])
  ) {
    return buildProteinTargetReply(weight);
  }

  if (includesAny(normalized, ['עשיר בחלבון', 'מזונות חלבון', 'מה הכי עשיר', 'high protein foods'])) {
    return t('chat.foods');
  }

  if (includesAny(normalized, ['מתי כדאי לאכול חלבון', 'מתי לאכול חלבון', 'לפני אימון', 'אחרי אימון'])) {
    return t('chat.mealTiming');
  }

  if (includesAny(normalized, ['כמה קלוריות בחזה עוף', 'קלוריות בחזה עוף', 'chicken breast'])) {
    return t('chat.chickenCalories');
  }

  if (includesAny(normalized, ['ביצה', 'ביצים', 'egg'])) {
    return t('chat.egg');
  }

  if (includesAny(normalized, ['bcaa'])) {
    return t('chat.bcaa');
  }

  if (includesAny(normalized, ['קריאטין', 'creatine'])) {
    return t('chat.creatine');
  }

  if (includesAny(normalized, ['כאב', 'מחלה', 'תרופה', 'medical', 'doctor'])) {
    return t('chat.medical');
  }

  if (includesAny(normalized, ['מזג אוויר', 'פוליטיקה', 'חדשות', 'תכנות', 'קוד', 'weather', 'politics', 'news', 'code'])) {
    return t('chat.nonFitness');
  }

  if (weight && includesAny(normalized, ['חלבון', 'protein'])) {
    return buildProteinTargetReply(weight);
  }

  return t('chat.generic');
}

function buildGoalTips(inputs) {
  const tips = [t('goals.tip.spreadProtein')];

  if (inputs.goal === 'lose') {
    tips.push(t('goals.tip.loseLeanSources'));
    tips.push(t('goals.tip.loseModerateDeficit'));
  } else if (inputs.goal === 'gain') {
    tips.push(t('goals.tip.gainSurplus'));
    tips.push(t('goals.tip.gainPrepSources'));
  } else {
    tips.push(t('goals.tip.maintainConsistency'));
    tips.push(t('goals.tip.maintainBusyDays'));
  }

  if (inputs.activityLevel === 'active' || inputs.activityLevel === 'athlete') {
    tips.push(t('goals.tip.trainingDay'));
  } else {
    tips.push(t('goals.tip.restDay'));
  }

  return tips.slice(0, 3);
}

export function buildGoalRecommendation(inputs) {
  const result = calculateTarget(inputs);

  if (!result) {
    return t('goals.recommendation.invalid');
  }

  const goalLabel = t(`goal.${inputs.goal || 'maintain'}`);
  const activityLabel = t(`activity.${inputs.activityLevel || 'moderate'}`);
  const targetWeightText = inputs.targetKg
    ? t('goals.recommendation.targetWeight', { value: inputs.targetKg })
    : '';
  const tips = buildGoalTips(inputs);

  return [
    t('goals.recommendation.summary', { goal: goalLabel }),
    t('goals.recommendation.activity', { activity: activityLabel, targetWeight: targetWeightText }),
    '',
    t('goals.recommendation.protein', { value: result.dailyTarget }),
    t('goals.recommendation.calories', { value: result.calorieTarget }),
    '',
    t('goals.recommendation.tipsTitle'),
    `• ${tips[0]}`,
    `• ${tips[1]}`,
    `• ${tips[2]}`,
    '',
    t('goals.recommendation.disclaimer'),
  ].join('\n');
}
