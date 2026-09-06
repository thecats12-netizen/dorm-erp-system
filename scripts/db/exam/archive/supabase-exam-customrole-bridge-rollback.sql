-- ============================================================================
-- 시험 브리지 ROLLBACK (⚠ 실행 금지 · 준비 완료 · Production 원문 기준)
--  source of truth = Production pg_get_functiondef snapshot (2026-09-02 확보). repo/migration 아님.
--  브리지는 데이터 write 가 없으므로 rollback = 3함수를 아래 Production 원문으로 복원 + 신규 helper 2개 DROP.
--  정책(policy)·exam_user_process_scopes 데이터는 애초에 미변경 → 정리 대상 없음.
-- ============================================================================
begin;

-- ── (1) exam_role_of — Production 원문 복원 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.exam_role_of(uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin'  and coalesce(p.is_active,true)) then 'super'
    when (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true)) is not null
      then (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true))
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'viewer' and coalesce(p.is_active,true)) then 'viewer'
    else null end;
$function$;

-- ── (2) exam_scope_readable — Production 원문 복원 ───────────────────────────
CREATE OR REPLACE FUNCTION public.exam_scope_readable(uid uuid, p_process uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.exam_user_process_scopes s
    where s.user_id = uid and s.process_id = p_process and s.is_active
      and (s.can_view or s.can_create or s.can_update or s.can_approve)); $function$;

-- ── (3) exam_scope_allows — Production 원문 복원 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.exam_scope_allows(uid uuid, p_process uuid, perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.exam_user_process_scopes s
    where s.user_id = uid and s.process_id = p_process and s.is_active
      and case perm when 'view' then s.can_view when 'create' then s.can_create
                    when 'update' then s.can_update when 'approve' then s.can_approve
                    when 'export' then s.can_export else false end); $function$;

-- ── (4) 브리지 전용 helper 제거(정책 미참조 · 안전) ─────────────────────────
drop function if exists public.exam_custom_role_scope(uuid,uuid,text);
drop function if exists public.exam_custom_role_has_perm(uuid,text);

commit;

-- 검증(rollback 후):
--   select proname, pg_get_userbyid(proowner) owner, prosecdef, proconfig
--     from pg_proc where proname in ('exam_role_of','exam_scope_readable','exam_scope_allows');
--   → 위 원문과 동일 · owner=postgres · search_path=public.
--   select count(*) from public.exam_user_process_scopes;   -- 0 (precheck 기준선과 동일 · 무변경)
