# ProteinFlow — מחשבון חלבון וקלוריות

אפליקציית PWA + Android למעקב יומי אחר צריכת חלבון וקלוריות, עם זיהוי אוכל מתמונה בעזרת AI.

## תכונות עיקריות

- **מעקב יומי** — רישום מזון, חלבון וקלוריות עם עיגולי התקדמות
- **סריקת אוכל מתמונה** — AI מזהה מנה, מרכיבים, קלוריות וחלבון מצילום
- **יומן חודשי** — תצוגת לוח שנה עם היסטוריה של 180 יום
- **סטטיסטיקות** — גרפים שבועיים ועקביות מעקב (streak)
- **המלצות AI** — חישוב יעד חלבון וקלוריות לפי גוף ומטרה
- **הצפנה מלאה** — נתונים מוצפנים AES-256-GCM במכשיר
- **תמיכה ב-10 שפות** — עברית, אנגלית, ערבית, ספרדית, צרפתית, גרמנית, רוסית, הינדי, יפנית, סינית
- **PWA + Android** — מותקן כאפליקציה על Android ועובד גם בדפדפן

## גרסה נוכחית

**v0.001** — Initial release

## טכנולוגיות

| שכבה | טכנולוגיה |
|---|---|
| Frontend | Vanilla JavaScript (ES6 Modules) |
| Mobile | Capacitor 8.2 (Android) |
| הצפנה | Web Crypto API (AES-256-GCM, PBKDF2) |
| AI זיהוי אוכל | NVIDIA kimi-k2.5 / Gemini 2.0 Flash |
| תשלומים | RevenueCat |
| PWA | Service Worker + Web App Manifest |

## הפעלה מקומית

```bash
# שרת web מקומי (כל שרת סטטי)
npx serve .

# או עם Python
python -m http.server 3000
```

## בניית APK לאנדרואיד

```bash
npm install
npx cap sync android
npx cap build android
```

ראה [ANDROID-SETUP.md](ANDROID-SETUP.md) להוראות מפורטות.

## הגרסה החיה (PWA)

🌐 [1401917.github.io/gym](https://1401917.github.io/gym)

## שינויים בגרסאות

ראה [CHANGELOG.md](CHANGELOG.md)

## מפתח Gemini (סריקת אוכל AI)

לסריקת תמונות אוכל: קבל מפתח חינמי מ-[ai.google.dev](https://ai.google.dev) והכנס בהגדרות האפליקציה.
