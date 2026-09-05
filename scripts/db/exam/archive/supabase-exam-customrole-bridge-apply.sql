-- ============================================================================
-- 시험관리 사용자 정의 권한 강제 브리지 — 설계안 B (apply 초안 · ⚠ 실행 금지 · 검수용)
--  목적: exam RLS helper 가 direct(exam_user_process_scopes) ∪ custom role(custom_role_scopes process)
--        를 runtime union 으로 평가하게 한다. 정책(policy) 은 건드리지 않고 helper 만 CREATE OR REPLACE.
--  검증완료(2026-09-02): Production pg_get_functiondef snapshot 과 대조 →
--   exam_role_of 앞 3분기(super/exam_role/viewer) · exam_scope_readable/allows 의 direct 절이 Production 원문과 1:1 동일.
--   이 파일은 그 direct 로직을 "의미 변경 없이" 두고 custom role union 절만 추가한다.
--  전제(실행 전 재확인 권장): 위 대조 이후 Production 정의가 다시 바뀌지 않았는지 precheck 재실행.
--   · 정책들이 이 helper 들을 호출하고 있어야 helper 재정의만으로 반영된다(정책 변경 없음).
--  안전: SECURITY DEFINER · set search_path=public · auth 기준 · dynamic SQL 없음 · anon 실행 불가.
--  ⚠ 이 파일 자체는 실행/commit 하지 않는다.
-- ============================================================================
begin;

-- ── 0) custom role 이 "시험 사용자"로 인정될 최소 조건(메뉴·기능 권한 AND) ──────────
--  process scope 만으로 기능이 자동 부여되지 않게, exam 탭 기능 권한 존재를 별도 검사.
--  perm→요구 기능키(exam 탭=permission_key like 'exam%'):
--    view→*.menu_view · create→*.create · update→*.update · approve→*.approve · export→다운로드류
create or replace function public.exam_custom_role_has_perm(p_uid uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.user_custom_roles ucr
      join public.custom_roles cr        on cr.id = ucr.custom_role_id and cr.is_active and not cr.is_deleted
      join public.custom_role_permissions crp on crp.custom_role_id = cr.id and crp.is_active
     where ucr.user_id = p_uid and ucr.is_active
       and split_part(crp.permission_key, '.', 1) like 'exam%'
       and case p_perm
             when 'view'    then crp.permission_key like '%.menu_view'
             when 'create'  then crp.permission_key like '%.create'
             when 'update'  then crp.permission_key like '%.update'
             when 'approve' then crp.permission_key like '%.approve'
             when 'export'  then (crp.permission_key like '%.excel_download' or crp.permission_key like '%.pdf_download'
                               or crp.permission_key like '%.csv_download'   or crp.permission_key like '%.print'
                               or crp.permission_key like '%.file_download')
             else false end
  );
$$;

-- ── 1) custom role process scope 가 (uid, process, perm) 를 허용하는가 ────────────────
--  · action_scope 매핑: read→view / write→view,create,update / all→+approve,export
--  · process='all' 은 READ-ALL 만(미래 공정 자동 포함). write/approve/export 는 특정 process_id scope 필요.
--  · 최종: 기능 권한(exam_custom_role_has_perm) AND process scope 매칭 (둘 다 만족해야 허용)
create or replace function public.exam_custom_role_scope(p_uid uuid, p_process uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.exam_custom_role_has_perm(p_uid, p_perm)
     and (
       -- process='all' → view 만 허용(READ-ALL)
       ( p_perm = 'view' and exists (
           select 1 from public.user_custom_roles ucr
             join public.custom_roles cr on cr.id = ucr.custom_role_id and cr.is_active and not cr.is_deleted
             join public.custom_role_scopes s on s.custom_role_id = cr.id
           where ucr.user_id = p_uid and ucr.is_active and s.is_active
             and coalesce(s.deleted_at is null, true)
             and (s.valid_from is null or s.valid_from <= now())
             and (s.valid_until is null or s.valid_until >= now())
             and s.scope_type = 'process' and s.scope_value = 'all'
       ))
       -- 특정 process_id scope + action_scope 가 perm 을 포함
       or exists (
           select 1 from public.user_custom_roles ucr
             join public.custom_roles cr on cr.id = ucr.custom_role_id and cr.is_active and not cr.is_deleted
             join public.custom_role_scopes s on s.custom_role_id = cr.id
           where ucr.user_id = p_uid and ucr.is_active and s.is_active
             and coalesce(s.deleted_at is null, true)
             and (s.valid_from is null or s.valid_from <= now())
             and (s.valid_until is null or s.valid_until >= now())
             and s.scope_type = 'process' and s.scope_value = p_process::text
             and case p_perm
                   when 'view'    then s.action_scope in ('read','write','all')
                   when 'create'  then s.action_scope in ('write','all')
                   when 'update'  then s.action_scope in ('write','all')
                   when 'approve' then s.action_scope = 'all'
                   when 'export'  then s.action_scope = 'all'
                   else false end
       )
     );
$$;

-- ── 2) exam_role_of 확장: admin/super·명시 exam_role·viewer 우선순위 유지, custom role 사용자 인정 추가 ──
--  ⚠ 아래 앞 3분기(super/exam_role/viewer)는 "현재 Production 정의"와 반드시 일치시킨 뒤 적용.
--    추가된 마지막 분기만이 이번 변경점: 활성 custom role + exam menu_view + (process scope 또는 process='all') → 'process_owner'.
create or replace function public.exam_role_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin'  and coalesce(p.is_active,true)) then 'super'
    when (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true)) is not null
      then (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true))
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'viewer' and coalesce(p.is_active,true)) then 'viewer'
    -- [브리지 추가] custom role 로 시험 접근을 얻은 사용자 → process_owner 상당(scope 로 세부 제한).
    when (
      public.exam_custom_role_has_perm(uid, 'view')
      and exists (
        select 1 from public.user_custom_roles ucr
          join public.custom_roles cr on cr.id = ucr.custom_role_id and cr.is_active and not cr.is_deleted
          join public.custom_role_scopes s on s.custom_role_id = cr.id
        where ucr.user_id = uid and ucr.is_active and s.is_active
          and coalesce(s.deleted_at is null, true)
          and (s.valid_from is null or s.valid_from <= now())
          and (s.valid_until is null or s.valid_until >= now())
          and s.scope_type = 'process'      -- 특정 process_id 또는 'all'
      )
    ) then 'process_owner'
    else null end;
$$;

-- ── 3) exam_scope_readable / exam_scope_allows: direct ∪ custom role ────────────────────
--  ⚠ direct 절(exam_user_process_scopes …)은 현재 Production 정의와 정확히 동일해야 한다(초안=마이그레이션 기준).
create or replace function public.exam_scope_readable(uid uuid, p_process uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.exam_user_process_scopes s
       where s.user_id = uid and s.process_id = p_process and s.is_active
         and (s.can_view or s.can_create or s.can_update or s.can_approve)
    )
    or public.exam_custom_role_scope(uid, p_process, 'view');
$$;

create or replace function public.exam_scope_allows(uid uuid, p_process uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.exam_user_process_scopes s
       where s.user_id = uid and s.process_id = p_process and s.is_active
         and case perm when 'view' then s.can_view when 'create' then s.can_create
                       when 'update' then s.can_update when 'approve' then s.can_approve
                       when 'export' then s.can_export else false end
    )
    or public.exam_custom_role_scope(uid, p_process, perm);
$$;

-- ── 4) ACL: anon 실행 불가 · authenticated 최소 실행 ──────────────────────────────────
revoke all on function public.exam_custom_role_has_perm(uuid,text),
                     public.exam_custom_role_scope(uuid,uuid,text),
                     public.exam_role_of(uuid),
                     public.exam_scope_readable(uuid,uuid),
                     public.exam_scope_allows(uuid,uuid,text)
  from public, anon;
grant execute on function public.exam_custom_role_has_perm(uuid,text),
                          public.exam_custom_role_scope(uuid,uuid,text),
                          public.exam_role_of(uuid),
                          public.exam_scope_readable(uuid,uuid),
                          public.exam_scope_allows(uuid,uuid,text)
  to authenticated;

commit;
-- 적용 후 postcheck 로 owner=postgres · search_path=public · anon ACL 없음 · 정책/ RLS 불변 확인.
