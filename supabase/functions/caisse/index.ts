import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-caisse-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Méthode non autorisée." }, 405);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 10_000_000) return jsonResponse({ error: "La sauvegarde est trop volumineuse." }, 413);
    const body = JSON.parse(rawBody);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Configuration Supabase serveur manquante.");

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (body.action === "login") {
      const pin = typeof body.pin === "string" ? body.pin : "";
      if (!/^\d{4,8}$/.test(pin)) return jsonResponse({ error: "Code PIN invalide." }, 400);

      const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const ipHash = await sha256(`caisse-login:${forwardedFor}`);
      const { data: canAttempt, error: rateError } = await db.rpc("consume_caisse_login_attempt", { p_ip_hash: ipHash });
      if (rateError) throw rateError;
      if (!canAttempt) return jsonResponse({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);

      const { data: security, error: securityError } = await db
        .from("caisse_security")
        .select("pin_hash")
        .eq("id", 1)
        .single();
      if (securityError) throw securityError;
      if (!await bcrypt.compare(pin, security.pin_hash)) {
        return jsonResponse({ error: "Code PIN incorrect." }, 401);
      }

      const { error: clearAttemptsError } = await db.from("caisse_login_attempts").delete().eq("ip_hash", ipHash);
      if (clearAttemptsError) throw clearAttemptsError;
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const { error: sessionError } = await db.from("caisse_sessions").insert({
        token_hash: await sha256(token),
        expires_at: expiresAt,
      });
      if (sessionError) throw sessionError;
      const { error: cleanupError } = await db.from("caisse_sessions").delete().lt("expires_at", new Date().toISOString());
      if (cleanupError) throw cleanupError;
      return jsonResponse({ token, expiresAt });
    }

    const sessionToken = request.headers.get("x-caisse-session") || "";
    if (!sessionToken) return jsonResponse({ error: "Connexion requise." }, 401);
    const tokenHash = await sha256(sessionToken);
    const { data: session, error: sessionError } = await db
      .from("caisse_sessions")
      .select("token_hash")
      .eq("token_hash", tokenHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return jsonResponse({ error: "Session expirée. Reconnectez-vous." }, 401);

    if (body.action === "logout") {
      const { error } = await db.from("caisse_sessions").delete().eq("token_hash", tokenHash);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "state") {
      const { data, error } = await db.from("caisse_state").select("data,revision").eq("id", "main").single();
      if (error) throw error;
      return jsonResponse({ state: data.data, revision: data.revision });
    }

    if (body.action === "save") {
      const revision = Number(body.revision);
      const state = body.state;
      if (!Number.isSafeInteger(revision) || revision < 0 || !state ||
        !Array.isArray(state.products) || !Array.isArray(state.sales) ||
        !state.business || typeof state.business.name !== "string") {
        return jsonResponse({ error: "Données de caisse invalides." }, 400);
      }
      const { data, error } = await db
        .from("caisse_state")
        .update({ data: state, revision: revision + 1 })
        .eq("id", "main")
        .eq("revision", revision)
        .select("revision")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: latest, error: latestError } = await db.from("caisse_state")
          .select("data,revision").eq("id", "main").single();
        if (latestError) throw latestError;
        return jsonResponse({ error: "La caisse a changé sur un autre appareil.", state: latest.data, revision: latest.revision }, 409);
      }
      return jsonResponse({ revision: data.revision });
    }

    if (body.action === "change-pin") {
      const currentPin = typeof body.currentPin === "string" ? body.currentPin : "";
      const newPin = typeof body.newPin === "string" ? body.newPin : "";
      if (!/^\d{4,8}$/.test(newPin)) return jsonResponse({ error: "Le nouveau code doit contenir 4 à 8 chiffres." }, 400);
      const { data: security, error: readError } = await db.from("caisse_security")
        .select("pin_hash").eq("id", 1).single();
      if (readError) throw readError;
      if (!await bcrypt.compare(currentPin, security.pin_hash)) {
        return jsonResponse({ error: "Le code actuel est incorrect." }, 401);
      }
      const { error: updateError } = await db.from("caisse_security").update({
        pin_hash: await bcrypt.hash(newPin, 12),
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (updateError) throw updateError;
      const { error: otherSessionsError } = await db.from("caisse_sessions")
        .delete().neq("token_hash", tokenHash);
      if (otherSessionsError) throw otherSessionsError;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("Erreur de la fonction caisse :", error);
    return jsonResponse({ error: "Erreur serveur. Vérifiez la configuration Supabase." }, 500);
  }
});
