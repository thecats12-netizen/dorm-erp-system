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
  error?: string;
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

    // 2. Auth 사용자 생성
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: authEmail,
      password: payload.password,
      email_confirm: true,
    });

    if (authError) {
      console.error("Auth creation error:", {
        providedEmail: payload.email,
        authEmail,
        payload,
        authError,
        authData,
      });
      return new Response(
        JSON.stringify({
          error: `Auth creation failed: ${authError.message}`,
        } as CreateUserResponse),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let userId = authData.user?.id;

    if (!userId) {
      // createUser didn't return id — try to find existing user by email
      const { data: existingUserData, error: getUserErr } = await supabase.auth.admin.getUserByEmail(authEmail).catch(() => ({ data: null, error: null }));
      if (getUserErr || !existingUserData?.user?.id) {
        console.error("User creation returned no ID and existing user not found", { authEmail, payload, authData, getUserErr });
        return new Response(
          JSON.stringify({ error: "User created but no ID returned" } as CreateUserResponse),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = existingUserData.user.id;
    }

    // 3. profiles 테이블에 프로필 저장 — 동적 객체 구성 (존재하지 않는 컬럼을 참조하지 않도록)
    const profileObj: Record<string, any> = {
      id: userId,
      email: authEmail,
      display_name: payload.display_name,
      role: payload.role,
      is_active: payload.is_active,
      site_access: payload.site_access,
      gender_access: payload.gender_access,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (payload.dorm_id) profileObj.dorm_id = payload.dorm_id;
    if (payload.tenant_id) profileObj.tenant_id = payload.tenant_id;

    const { error: profileError } = await supabase.from("profiles").upsert(profileObj);

    if (profileError) {
      // 프로필 생성 실패: 만약 이미 Auth에 동일 이메일이 존재하면 user id로 profiles만 재시도
      console.error("Profile creation error:", { authEmail, payload, profileError });

      // 기존 사용자 아이디가 있으면 profiles에 id로 insert/update 재시도
      if (userId) {
        const { error: retryErr } = await supabase.from("profiles").upsert({ ...profileObj }).catch(() => ({ error: null }));
        if (!retryErr) {
          return new Response(JSON.stringify({ user_id: userId } as CreateUserResponse), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      return new Response(
        JSON.stringify({ error: `Profile creation failed: ${profileError.message}` } as CreateUserResponse),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 성공 응답
    return new Response(
      JSON.stringify({
        user_id: userId,
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
