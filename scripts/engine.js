export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1).replace(/\.0$/, '');
}

// activityLevel: 'sedentary'|'moderate'|'active'|'athlete'
// goal: 'lose'|'maintain'|'gain'
export function calculateTarget({ weight, targetKg, meals, extraProtein, activityLevel = 'moderate', goal = 'maintain', age = 25, gender = 'male', height = 170 }) {
  if (!weight || weight < 20) return null;

  // Protein multiplier based on activity
  const multipliers = { sedentary: 1.4, moderate: 1.8, active: 2.0, athlete: 2.2 };
  let mult = multipliers[activityLevel] || 1.8;

  // Adjust for goal
  if (goal === 'lose')     mult = Math.max(mult, 2.0); // high protein preserves muscle during cut
  if (goal === 'gain')     mult = Math.max(mult, 2.0); // high protein for hypertrophy
  if (goal === 'maintain') mult = Math.min(mult, 1.8);

  // Use the higher of current/target weight for protein base
  const baseWeight = goal === 'lose' ? Math.min(weight, targetKg || weight) : weight;
  const dailyTarget = Number((baseWeight * mult + (extraProtein || 0)).toFixed(0));
  const mealTarget  = meals > 0 ? Number((dailyTarget / meals).toFixed(0)) : 0;

  // BMR (Mifflin-St Jeor)
  const bmr = gender === 'female'
    ? 10 * weight + 6.25 * height - 5 * (age || 25) - 161
    : 10 * weight + 6.25 * height - 5 * (age || 25) + 5;

  const tdeeFactors = { sedentary: 1.2, moderate: 1.55, active: 1.725, athlete: 1.9 };
  const tdee = Math.round(bmr * (tdeeFactors[activityLevel] || 1.55));

  // Calorie target based on goal
  let calorieTarget = tdee;
  if (goal === 'lose')  calorieTarget = Math.round(tdee * 0.8);   // 20% deficit
  if (goal === 'gain')  calorieTarget = Math.round(tdee * 1.1);   // 10% surplus

  return { dailyTarget, mealTarget, tdee, calorieTarget };
}

export function calculateProgress(totalProtein, target) {
  if (target <= 0) {
    return {
      percentage: 0,
      remaining: null,
      isOver: false
    };
  }

  const percentage = Number(((totalProtein / target) * 100).toFixed(1));
  const remaining = Number((target - totalProtein).toFixed(1));

  return {
    percentage,
    remaining,
    isOver: percentage > 100
  };
}

export function buildStatus(totalProtein, target) {
  if (target <= 0) {
    return {
      badge: 'Ready',
      description: 'המערכת מחכה להגדרת יעד'
    };
  }

  const { percentage, remaining, isOver } = calculateProgress(totalProtein, target);

  if (isOver) {
    return {
      badge: 'Over',
      description: `עברת את היעד ב-${formatNumber(Math.abs(remaining))} גרם`
    };
  }

  if (percentage >= 85) {
    return {
      badge: 'Close',
      description: `אתה קרוב מאוד ליעד, נשארו ${formatNumber(remaining)} גרם`
    };
  }

  return {
    badge: 'Track',
    description: `נשארו ${formatNumber(remaining)} גרם כדי להגיע ליעד`
  };
}