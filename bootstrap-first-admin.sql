-- 1) ابتدا در Supabase Dashboard > Authentication > Users یک کاربر بسازید:
--    Email: admin@library.local
--    Password: یک رمز قوی حداقل ۱۲ کاراکتری
--    Auto Confirm User: فعال
--
-- 2) UUID ساخته‌شده را به جای YOUR_AUTH_USER_UUID قرار دهید و این دستور را اجرا کنید.

insert into public.profiles (id, username, full_name, role, active)
values ('8d728f3d-ebce-485e-ad7f-fa2d7e9f4de4'::uuid, 'admin', 'مدیر سامانه', 'admin', true)
on conflict (id) do update set
  username = excluded.username,
  full_name = excluded.full_name,
  role = 'admin',
  active = true;
