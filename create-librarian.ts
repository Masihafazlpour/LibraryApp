import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeUsername(input: unknown) {
  return String(input ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9._-]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usernameDomain = Deno.env.get("USERNAME_DOMAIN") || "library.local";
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json(401, { ok: false, error: "نشست کاربری ارسال نشده است." });

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json(401, { ok: false, error: "نشست کاربری معتبر نیست." });

    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,role,active")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !callerProfile?.active || callerProfile.role !== "admin") {
      return json(403, { ok: false, error: "فقط مدیر سامانه اجازه مدیریت کاربران را دارد." });
    }

    const body = await req.json();
    const operation = String(body.operation || "create");

    if (operation === "create") {
      const username = normalizeUsername(body.username);
      const fullName = String(body.full_name || "").trim();
      const password = String(body.password || "");
      const role = body.role === "admin" ? "admin" : "librarian";
      if (!/^[a-z0-9._-]{3,50}$/.test(username)) return json(400, { ok: false, error: "نام کاربری باید ۳ تا ۵۰ کاراکتر انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد." });
      if (fullName.length < 2 || fullName.length > 120) return json(400, { ok: false, error: "نام کامل معتبر نیست." });
      if (password.length < 8 || password.length > 128) return json(400, { ok: false, error: "رمز عبور باید بین ۸ تا ۱۲۸ کاراکتر باشد." });

      const email = `${username}@${usernameDomain}`;
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: fullName, role },
      });
      if (createError || !created.user) return json(400, { ok: false, error: createError?.message || "ایجاد حساب ناموفق بود." });

      const { error: insertError } = await adminClient.from("profiles").insert({
        id: created.user.id,
        username,
        full_name: fullName,
        role,
        active: true,
        created_by: callerProfile.id,
      });
      if (insertError) {
        await adminClient.auth.admin.deleteUser(created.user.id);
        return json(400, { ok: false, error: insertError.message });
      }

      await adminClient.from("audit_logs").insert({
        actor_id: callerProfile.id,
        action: "create_user",
        entity_type: "profile",
        entity_id: created.user.id,
        details: { username, role },
      });
      return json(200, { ok: true, user_id: created.user.id, username });
    }

    if (operation === "reset_password") {
      const userId = String(body.user_id || "");
      const password = String(body.password || "");
      if (!userId || password.length < 8 || password.length > 128) return json(400, { ok: false, error: "شناسه کاربر یا رمز عبور معتبر نیست." });
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password });
      if (error) return json(400, { ok: false, error: error.message });
      await adminClient.from("audit_logs").insert({ actor_id: callerProfile.id, action: "reset_password", entity_type: "profile", entity_id: userId });
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "عملیات پشتیبانی نمی‌شود." });
  } catch (error) {
    console.error(error);
    return json(500, { ok: false, error: error instanceof Error ? error.message : "خطای داخلی سرویس" });
  }
});
