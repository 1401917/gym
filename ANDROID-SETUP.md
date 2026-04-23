# Android Setup

הפרויקט כבר מוכן כאתר סטטי מודולרי עם PWA בסיסי. כדי להפוך אותו ל-APK אמיתי באנדרואיד, המסלול המומלץ הוא Capacitor.

## מה כבר מוכן

- קוד מפוצל ל-HTML, CSS ו-JavaScript מודולרי
- `manifest.webmanifest`
- `sw.js`
- אייקון אפליקציה
- עיצוב mobile-first

## השלב הבא

1. התקן Node.js אם עדיין לא מותקן.
2. בתוך התיקייה של הפרויקט הרץ:

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init ProteinFlow com.proteinflow.app --web-dir=.
npx cap add android
```

3. אחרי כל שינוי באתר אפשר לסנכרן ל-Android:

```bash
npx cap sync android
```

4. לפתוח את Android Studio:

```bash
npx cap open android
```

5. מתוך Android Studio אפשר לבנות APK או AAB.

## הערות חשובות

- כרגע זה אתר סטטי, וזה טוב. לא צריך framework כדי להוציא APK.
- אם תרצה, אפשר בשלב הבא להוסיף:
  - Splash screen מסודר
  - Icons לגדלים שונים
  - Bottom navigation
  - Offline pages
  - Native status bar handling
  - Capacitor config

## המלצה

בשלב הבא כדאי שאוסיף לפרויקט גם `package.json`, `capacitor.config.*` וסקריפטים מוכנים לבנייה, ואז תוכל ממש לייצר APK בקלות.