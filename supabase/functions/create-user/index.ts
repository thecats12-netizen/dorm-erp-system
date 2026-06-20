import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CreateUserRequest {
  email: string;
  password: string;
  display_name: string;
  role: string;
  is_active: boolean;
  dorm_id?: string;
  site_access: string;
  gender_access: string;
  tenant_id: string;
}

interface CreateUserResponse {
  user_id?: string;
  reused?: boolean;
  error?: string;
}

// admin.listUsers 로 email 에 해당하는 Auth user id 조회(페이지네이션).
async function findAuthUserIdByEmail(supabase: any, email: string): Promise<string | undefined> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error("listUsers error:", error);
      return undefined;
    }
    const found = (data?.users || []).find((u: any) => String(u.email || "").toLowerCase() === target);
    if (found?.id) return found.id;
    if (!data?.users || data.users.length < 1000) break;
  }
  return undefined;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // CORS 처리
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 요청 본문 파싱
    const payload: CreateUserRequest = await req.json();

    // 필수 필드 검증
    if (!payload.email || !payload.password || !payload.display_name || !payload.tenant_id) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: email, password, display_name, tenant_id",
        } as CreateUserResponse),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service Role 키로 Supabase Admin 클라이언트 생성
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    // 1. 이메일 검증 및 변환 (username이 전달되는 경우 도메인 추가)
    const authEmail = payload.email.includes("@") ? payload.email : `${payload.email}@dormerpsystem.com`;

    let userId: string | undefined;
    let reusedExistingUser = false;
    let isNewUser = false;

    // 1) profiles 에서 email 조회 — 있으면 기존 계정 재사용(Auth 생성 안 함)
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();

    if (existingProfile?.id) {
      userId = existingProfile.id;
      reusedExistingUser = true;
    } else {
      // 2) Auth 사용자 생성 시도
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: authEmail,
        password: payload.password,
        email_confirm: true,
      });

      if (authError) {
        const code = (authError as any).code || "";
        const msg = authError.message || "";
        const isEmailExists = code === "email_exists" || /already.*registered|already.*been registered|email_exists|duplicate/i.test(msg);
        if (isEmailExists) {
          // 3) email_exists → 오류가 아니라 기존 Auth 계정 재사용. listUsers 로 user id 조회 후 profiles upsert.
          const foundId = await findAuthUserIdByEmail(supabase, authEmail);
          if (!foundId) {
            console.error("email_exists but auth user not found via listUsers", { authEmail });
            return new Response(
              JSON.stringify({ error: "기존 계정을 찾을 수 없습니다." } as CreateUserResponse),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          userId = foundId;
          reusedExistingUser = true;
        } else {
          console.error("Auth creation error:", { providedEmail: payload.email, authEmail, code, authError });
          return new Response(
            JSON.stringify({ error: `Auth creation failed: ${msg}` } as CreateUserResponse),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        userId = authData.user?.id;
        isNewUser = true;
        if (!userId) {
          const foundId = await findAuthUserIdByEmail(supabase, authEmail);
          if (!foundId) {
            return new Response(
              JSON.stringify({ error: "User created but no ID returned" } as CreateUserResponse),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          userId = foundId;
          reusedExistingUser = true;
          isNewUser = false;
        }
      }
    }

    // 4) profiles upsert — 기존/신규 모두 role/display_name/dorm_id/site_access/gender_access/is_active 덮어쓰기.
    //    재사용(email_exists) 흐름에서도 is_active 를 반드시 반영(기본 true).
    const profileObj: Record<string, any> = {
      id: userId,
      email: authEmail,
      display_name: payload.display_name,
      role: payload.role,
      is_active: payload.is_active ?? true,
      site_access: payload.site_access,
      gender_access: payload.gender_access,
      updated_at: new Date().toISOString(),
    };
    // 재사용 계정은 created_at 을 덮어쓰지 않음(신규일 때만 설정)
    if (isNewUser) profileObj.created_at = new Date().toISOString();
    // dorm_id 는 항상 덮어쓰기(미선택 시 null 로 비움)
    profileObj.dorm_id = payload.dorm_id ?? null;
    if (payload.tenant_id) profileObj.tenant_id = payload.tenant_id;

    const { error: profileError } = await supabase.from("profiles").upsert(profileObj);

    if (profileError) {
      console.error("Profile upsert error:", { authEmail, userId, reusedExistingUser, profileError });
      return new Response(
        JSON.stringify({ error: `Profile creation failed: ${profileError.message}` } as CreateUserResponse),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("create-user success", { userId, email: authEmail, reusedExistingUser, dorm_id: payload.dorm_id });

    // 성공 응답(기존 계정 재사용도 200 성공)
    return new Response(
      JSON.stringify({
        user_id: userId,
        reused: reusedExistingUser,
      } as CreateUserResponse),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({
        error: `Server error: ${error.message}`,
      } as CreateUserResponse),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
