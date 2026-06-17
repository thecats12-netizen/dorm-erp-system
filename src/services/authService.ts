import { supabase, isSupabaseAvailable, translateSupabaseError } from "./supabaseService";
import type { Session, User } from "@supabase/supabase-js";
import type { UserRole, Site } from "../types/domain";

/**
 * Supabase profiles 테이블의 프로필 타입
 */
export interface Profile {
  id: string;
  email?: string;
  display_name?: string;
  role?: UserRole;
  is_active?: boolean;
  dorm_id?: string | null;
  site_access?: Site | "전체";
  gender_access?: "남" | "여" | "전체";
  created_at?: string;
  updated_at?: string;
}

/**
 * Supabase 이메일/패스워드로 로그인
 * @param email - 사용자 이메일
 * @param password - 사용자 패스워드
 * @returns { session: Session | null; error: any }
 */
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<{ session: Session | null; error: any }> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Sign in not available.");
    return { session: null, error: "Supabase not configured" };
  }

  try {
    const { data, error } = await supabase!.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[AuthService] Sign in error:", error, { email });
      return {
        session: null,
        error: new Error(translateSupabaseError(error.message || String(error))),
      };
    }

    console.debug("[AuthService] Sign in success", { userId: data.session?.user?.id, email });
    return { session: data.session, error: null };
  } catch (err) {
    console.error("[AuthService] Sign in exception:", err, { email });
    return {
      session: null,
      error: new Error(translateSupabaseError(String(err))),
    };
  }
};

/**
 * 로그아웃 및 Supabase 세션 제거
 * @returns { error: any }
 */
export const signOut = async (): Promise<{ error: any }> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Sign out skipped.");
    return { error: null };
  }

  try {
    const { error } = await supabase!.auth.signOut();
    if (error) {
      console.error("[AuthService] Sign out error:", error);
      return { error: new Error(translateSupabaseError(error.message || String(error))) };
    }
    return { error: null };
  } catch (err) {
    console.error("[AuthService] Sign out exception:", err);
    return { error: new Error(translateSupabaseError(String(err))) };
  }
};

/**
 * 현재 세션 조회 (저장된 토큰 사용)
 * @returns Session | null
 */
export const getCurrentSession = async (): Promise<Session | null> => {
  if (!isSupabaseAvailable()) {
    return null;
  }

  try {
    const { data } = await supabase!.auth.getSession();
    return data.session;
  } catch (err) {
    console.error("[AuthService] Get session error:", err);
    return null;
  }
};

/**
 * 현재 인증된 사용자 정보 조회
 * @returns User | null
 */
export const getCurrentAuthUser = async (): Promise<User | null> => {
  if (!isSupabaseAvailable()) {
    return null;
  }

  try {
    const { data } = await supabase!.auth.getUser();
    return data.user;
  } catch (err) {
    console.error("[AuthService] Get user error:", err);
    return null;
  }
};

/**
 * 인증 상태 변경 리스너 등록
 * @param callback - 상태 변경 시 호출할 콜백 함수 (user, session 전달)
 * @returns 리스너 제거 함수 또는 null
 */
export const onAuthStateChange = (
  callback: (user: User | null, session: Session | null) => void
): (() => void) | null => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Auth state listener not available.");
    return null;
  }

  try {
    const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null, session);
    });

    // 리스너 제거 함수 반환
    return () => {
      data.subscription?.unsubscribe();
    };
  } catch (err) {
    console.error("[AuthService] Auth state change listener error:", err);
    return null;
  }
};

/**
 * 프로필 조회 (profiles 테이블에서)
 * @param userId - 조회할 사용자 UUID
 * @returns Profile | null
 */
export const getProfile = async (userId: string): Promise<Profile | null> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Profile fetch not available.");
    return null;
  }

  try {
    const { data, error } = await supabase!
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("[AuthService] Get profile error:", error);
      return null;
    }

    if (!data) {
      console.warn("[AuthService] Profile not found for userId:", userId);
      return null;
    }

    return data as Profile;
  } catch (err) {
    console.error("[AuthService] Get profile exception:", err);
    return null;
  }
};

/**
 * 전체 프로필 목록 조회 (사용자관리용). RLS에 따라 admin은 전체, 일반 사용자는 본인 행만 반환될 수 있음.
 */
export const listProfiles = async (): Promise<Profile[]> => {
  if (!isSupabaseAvailable()) return [];
  const { data, error } = await supabase!
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    const e = error as { code?: unknown; message?: string; details?: unknown; hint?: unknown };
    console.error("[AuthService] listProfiles error:", { code: e.code, message: e.message, details: e.details, hint: e.hint });
    throw error;
  }
  return (data || []) as Profile[];
};

/**
 * 프로필 생성 또는 수정 (profiles 테이블)
 * @param profile - 생성/수정할 프로필 객체
 * @returns { data: Profile | null; error: any }
 */
export const upsertProfile = async (
  profile: Profile
): Promise<{ data: Profile | null; error: any }> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Profile upsert not available.");
    return { data: null, error: "Supabase not configured" };
  }

  try {
    const { data, error } = await supabase!
      .from("profiles")
      .upsert({
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        role: profile.role,
        is_active: profile.is_active ?? true,
        dorm_id: profile.dorm_id,
        site_access: profile.site_access ?? "전체",
        gender_access: profile.gender_access ?? "전체",
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[AuthService] Upsert profile error:", error);
      return {
        data: null,
        error: new Error(translateSupabaseError(error.message || String(error))),
      };
    }

    return { data: data as Profile, error: null };
  } catch (err) {
    console.error("[AuthService] Upsert profile exception:", err);
    return {
      data: null,
      error: new Error(translateSupabaseError(String(err))),
    };
  }
};

/**
 * Supabase Auth에 새 사용자 등록 (admin만 사용)
 * @param email - 사용자 이메일
 * @param password - 초기 비밀번호
 * @returns { user: User | null; error: any }
 */
export const signUpWithEmail = async (
  email: string,
  password: string
): Promise<{ user: User | null; error: any }> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Sign up not available.");
    return { user: null, error: "Supabase not configured" };
  }

  try {
    const { data, error } = await supabase!.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      console.error("[AuthService] Sign up error:", error, { email });
      return {
        user: null,
        error: new Error(translateSupabaseError(error.message || String(error))),
      };
    }

    console.debug("[AuthService] Sign up success", { userId: data.user?.id, email });
    return { user: data.user, error: null };
  } catch (err) {
    console.error("[AuthService] Sign up exception:", err, { email });
    return {
      user: null,
      error: new Error(translateSupabaseError(String(err))),
    };
  }
};

/**
 * 프로필만 업데이트 (비밀번호는 건드리지 않음)
 * @param userId - 프로필 소유자 ID
 * @param profile - 업데이트할 프로필 정보
 * @returns { data: Profile | null; error: any }
 */
export const updateProfileOnly = async (
  userId: string,
  profile: Partial<Profile>
): Promise<{ data: Profile | null; error: any }> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Profile update not available.");
    return { data: null, error: "Supabase not configured" };
  }

  try {
    // undefined 필드는 보내지 않도록 정리(부분 업데이트). null 은 명시적 비움으로 전송.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (profile.display_name !== undefined) patch.display_name = profile.display_name;
    if (profile.role !== undefined) patch.role = profile.role;
    if (profile.is_active !== undefined) patch.is_active = profile.is_active;
    if (profile.dorm_id !== undefined) patch.dorm_id = profile.dorm_id;
    if (profile.site_access !== undefined) patch.site_access = profile.site_access;
    if (profile.gender_access !== undefined) patch.gender_access = profile.gender_access;

    const { data, error } = await supabase!
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select(); // .single() 제거: RLS로 representation이 0행이어도(업데이트는 성공) 오류로 처리되지 않도록 함

    if (error) {
      console.error("[AuthService] Update profile error:", {
        code: (error as any)?.code,
        message: (error as any)?.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint,
        userId,
      });
      // 원본 오류를 그대로 반환하여 호출부에서 code/message/details/hint 를 확인할 수 있게 함.
      return { data: null, error };
    }

    return { data: (Array.isArray(data) ? (data[0] as Profile) : (data as Profile)) ?? null, error: null };
  } catch (err) {
    console.error("[AuthService] Update profile exception:", err);
    return {
      data: null,
      error: new Error(translateSupabaseError(String(err))),
    };
  }
};

/**
 * Edge Function을 통해 사용자 생성 (권장 방식 - service_role은 서버에서만 사용)
 * @param payload - 사용자 생성 정보
 * @returns { user_id?: string; error?: string }
 */
export const createUserViaEdgeFunction = async (payload: {
  email: string;
  password: string;
  display_name: string;
  role: string;
  is_active: boolean;
  dorm_id?: string;
  site_access: string;
  gender_access: string;
  tenant_id: string;
}): Promise<{ user_id?: string; error?: any }> => {
  if (!isSupabaseAvailable()) {
    console.warn("[AuthService] Supabase is not configured. Edge Function not available.");
    return { error: "Supabase not configured" };
  }

  try {
    // 이메일 보정: username만 전달된 경우 도메인 자동 추가
    const body = {
      ...payload,
      email: payload.email.includes("@") ? payload.email : `${payload.email}@dormerpsystem.com`,
    };

    // supabase client의 invokeFunction을 사용하여 Edge Function 호출
    const { data, error } = await supabase!.functions.invoke("create-user", {
      body,
    });

    if (error) {
      console.error("[AuthService] Edge Function error:", error);
      return { error: new Error(translateSupabaseError(error.message || String(error))) };
    }

    if (data?.error) {
      console.error("[AuthService] Edge Function returned error:", data.error);
      return { error: new Error(translateSupabaseError(String(data.error))) };
    }

    console.debug("[AuthService] Edge Function success", { userId: data?.user_id });
    return { user_id: data?.user_id };
  } catch (err) {
    console.error("[AuthService] Edge Function exception:", err);
    return { error: new Error(translateSupabaseError(String(err))) };
  }
};
