---
id: l04
title: צמצום טיפוסים עם typeof
resources: [../resources/narrowing-cheatsheet.md]
sources: [2, 3]
---
בסוף השיעור תדעו להשתמש בבדיקות `typeof` כדי שהמהדר יתייחס לערך מטיפוס איחוד כאל טיפוס אחד ספציפי בתוך ענף.

## למה צמצום טיפוסים קיים

טיפוס איחוד כמו `string | number` אומר שערך הוא אחד מכמה טיפוסים, אבל בכל שורה נתונה אתם בדרך כלל יודעים יותר מזה. TypeScript מנתחת את זרימת הבקרה של הקוד ומדייקת ("מצמצמת") את טיפוס המשתנה אחרי בדיקות שאתם כבר כותבים, כמו משפטי `if`. [3]

```ts
function padLeft(padding: number | string, input: string): string {
  if (typeof padding === "number") {
    return " ".repeat(padding) + input; // padding: number
  }
  return padding + input; // padding: string
}
```

בלי הבדיקה, `" ".repeat(padding)` הוא שגיאה, כי `string` אינו ניתן להשמה לפרמטר מטיפוס `number`. בתוך גוף ה-`if` המהדר יודע ש-`padding` הוא `number`; אחרי שה-`if` מחזיר ערך, החבר היחיד שנשאר באיחוד הוא `string`. [3]

## מה typeof מחזיר

ב-JavaScript, `typeof` מחזיר אחת ממחרוזות קבועות: `"string"`, `"number"`, `"bigint"`, `"boolean"`, `"symbol"`, `"undefined"`, `"object"` ו-`"function"`. TypeScript מבינה השוואות מול המחרוזות האלה כשומרי טיפוס (type guards). [3]

```ts
function describe(value: string | number | boolean | undefined): string {
  if (typeof value === "string") return `text of length ${value.length}`;
  if (typeof value === "number") return `number ${value.toFixed(1)}`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return "nothing"; // value: undefined
}
```

כל בדיקה מסירה חבר אחד מהאיחוד לשאר הפונקציה, ולכן השורה האחרונה רואה רק `undefined`. אפשר להשוות לרשימת הטיפוסים הפרימיטיביים בדף הטיפוסים היומיומיים במדריך. [2] סיכום של עמוד אחד על צורות הצמצום בפרק הזה נמצא ב[דף העזר לצמצום טיפוסים](../resources/narrowing-cheatsheet.md).

## המלכודת של null

`typeof null` הוא `"object"` ב-JavaScript, תוצאה של פליטה היסטורית. TypeScript מדגמת את זה: בדיקה של `typeof x === "object"` מצמצמת ערך מטיפוס `string[] | null` ל-`string[] | null` ולא ל-`string[]`. המהדר יזהיר אתכם כשאתם עוברים בלולאה על ערך שאולי הוא null. [3]

```ts
function printAll(strs: string | string[] | null) {
  if (typeof strs === "object") {
    for (const s of strs) {
      //                ~~~~ error: 'strs' is possibly 'null'
      console.log(s);
    }
  } else if (typeof strs === "string") {
    console.log(strs);
  }
}
```

## אמת-שקר (truthiness) כשומר טיפוס

גם תנאים, `&&`, `||` ו-`!` מצמצמים, כי `null`, `undefined`, `0`, `""` ו-`NaN` הם ערכי שקר (falsy). בדיקת אמת-שקר היא הדרך הרגילה לשלול את `null` ואת `undefined`. [3]

```ts
function printAll(strs: string | string[] | null) {
  if (strs && typeof strs === "object") {
    for (const s of strs) console.log(s); // strs: string[]
  } else if (typeof strs === "string") {
    console.log(strs);
  }
}
```

היזהרו כשהטיפוס כולל `string` או `number`: מחרוזת ריקה או `0` הם גם ערכי שקר, ולכן בדיקת אמת-שקר מדלגת גם על ערכים תקינים אלה. [3]

## typeof לא מבדיל בין טיפוסי אובייקט

כל מה שאינו פרימיטיבי מחזיר `"object"` (או `"function"`), ולכן `typeof` לא יכול להבדיל בין `Dog` ל-`Cat`. בשביל זה צריך איחודים מובחנים (discriminated unions), את `in`, או שומרי טיפוס מוגדרים על ידי המשתמש, שהשיעורים הבאים עוסקים בהם.

:::key-takeaways
- צמצום טיפוסים מדייק איחוד לטיפוס ספציפי יותר בתוך ענף, בעקבות זרימת הבקרה הרגילה.
- `typeof x === "string"` ובדיקות דומות מצמצמות טיפוסים פרימיטיביים.
- `typeof null` הוא `"object"`, ולכן בדיקת אובייקט לבדה לא שוללת את `null`.
- גם בדיקות אמת-שקר מצמצמות, אבל הן דוחות גם `0` ו-`""`.
:::
