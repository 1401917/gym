# Changelog

כל שינויי הגרסאות מתועדים כאן לפי [Semantic Versioning](https://semver.org/).

---

## [v0.001] — 2026-04-23

### נוסף
- מעקב יומי אחר חלבון וקלוריות עם עיגולי התקדמות
- סריקת אוכל מתמונה — AI מזהה מנה, מרכיבים, קלוריות וחלבון
- תמיכה ב-Gemini 2.0 Flash (מפתח חינמי) + NVIDIA kimi-k2.5 כ-fallback
- כרטיס תוצאה עם תגיות מרכיבים (ingredient tags) — במקום `confirm()` נייטיב
- יומן חודשי עם היסטוריה של 180 יום
- גרפים שבועיים (חלבון / קלוריות)
- המלצות AI לפי גוף ומטרה (Mifflin-St Jeor + TDEE)
- הצפנה מלאה AES-256-GCM עם PBKDF2 ובדיקת עמידות HMAC
- תמיכה ב-10 שפות כולל עברית ועם RTL
- PWA (Service Worker, Web App Manifest)
- אפליקציית Android דרך Capacitor 8.2
- תזכורות יומיות (Capacitor LocalNotifications)
- ניהול מנויים דרך RevenueCat

### תוקן
- מודלי fallback של NVIDIA היו טקסט-בלבד — הוחלפו במודלים עם תמיכת vision
- פרמטר `thinking` בבקשות ל-NVIDIA תוקן לפורמט הנכון (`chat_template_kwargs`)

---

<!-- הגרסה הבאה תתווסף כאן -->
