# سامانه رسمی مدیریت کتابخانه «سمک» — نسخه یک‌پوشه‌ای

این نسخه طوری آماده شده که تمام فایل‌های پروژه در **یک پوشه واحد** قرار دارند و هیچ زیرپوشه‌ای برای `assets`، `supabase` یا `tests` وجود ندارد.

## ساختار نهایی

```text
index.html
app.js
styles.css
config.js
schema.sql
bootstrap-first-admin.sql
create-librarian.ts
original-reference.html
smoke_test.py
.nojekyll
README.md
```

## ۱) تنظیم Supabase

1. یک پروژه جدید در Supabase بسازید.
2. وارد **SQL Editor** شوید.
3. کل فایل `schema.sql` را اجرا کنید.
4. از **Authentication > Users** نخستین مدیر را بسازید:
   - Email: `admin@library.local`
   - Password: یک رمز قوی حداقل ۱۲ کاراکتری
   - Auto Confirm User: فعال
5. UUID کاربر را بردارید.
6. در `bootstrap-first-admin.sql` مقدار `YOUR_AUTH_USER_UUID` را با UUID واقعی جایگزین کنید و فایل را در SQL Editor اجرا کنید.

## ۲) تنظیم config.js

فایل `config.js` را باز کنید:

```js
window.SAMAK_CONFIG = Object.freeze({
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  USERNAME_DOMAIN: "library.local"
});
```

از **Project Settings > API** فقط Project URL و Publishable/Anon Key را بردارید.

هرگز `service_role` یا Secret Key را داخل `config.js` یا GitHub قرار ندهید.

## ۳) Edge Function ساخت کتابدار

فایل `create-librarian.ts` را می‌توانید از داخل **Supabase Dashboard > Edge Functions** به عنوان تابعی با نام `create-librarian` ایجاد و Deploy کنید.

در Secrets تابع این مقدار را بسازید:

```text
USERNAME_DOMAIN=library.local
```

کلید Service Role فقط باید در محیط امن Edge Function بماند و هرگز در Frontend قرار نگیرد.

اگر با Supabase CLI کار می‌کنید، فایل `create-librarian.ts` را هنگام Deploy به مسیر استاندارد زیر در یک پروژه موقت CLI منتقل کنید:

```text
supabase/functions/create-librarian/index.ts
```

این مسیر فقط برای فرایند Deploy است؛ ساختار اصلی پروژه و GitHub Pages همچنان یک‌پوشه‌ای باقی می‌ماند.

## ۴) انتشار در GitHub Pages

تمام فایل‌های همین پوشه را در ریشه Repository قرار دهید.

در GitHub:

1. وارد **Settings > Pages** شوید.
2. بخش Source را روی **Deploy from a branch** بگذارید.
3. Branch را `main` انتخاب کنید.
4. Folder را `/root` انتخاب کنید.
5. ذخیره کنید.

چون `index.html`، `app.js`، `styles.css` و `config.js` همگی در ریشه هستند، هیچ مسیر زیرشاخه‌ای برای Frontend وجود ندارد.

## ۵) اجرای محلی

فایل `index.html` را با `file://` باز نکنید. از یک وب‌سرور محلی استفاده کنید:

```bash
python -m http.server 8080
```

سپس:

```text
http://localhost:8080
```

را باز کنید.

## ۶) ورود اولیه

نام کاربری:

```text
admin
```

رمز عبور همان رمز Auth User است که در Supabase ساخته‌اید.

## ۷) ساخت کتابدار

مدیر سامانه پس از ورود می‌تواند از بخش تنظیمات حساب‌های کتابداران را ایجاد، فعال/غیرفعال و مدیریت کند.

## ۸) نکات امنیتی

- Repository ترجیحاً خصوصی باشد.
- Publishable/Anon Key را محرمانه تلقی نکنید؛ امنیت داده‌ها با RLS انجام می‌شود.
- Service Role فقط داخل Edge Function نگه‌داری شود.
- برای هر کتابدار حساب مجزا بسازید.
- حساب افراد غیرمسئول را غیرفعال کنید.
- از اطلاعات به‌طور منظم Backup بگیرید.
