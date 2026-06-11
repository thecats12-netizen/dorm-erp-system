-- =====================================================================
-- audit_logs RLS: 비admin 도 "작성(INSERT)"만 가능, 수정/삭제는 admin 전용
-- ---------------------------------------------------------------------
-- 정책 요약 (모두 tenant_id 격리):
--   admin                : SELECT/INSERT/UPDATE/DELETE (FOR ALL)
--   viewer/dorm_manager/maintenance_reporter : SELECT + INSERT 만
--   → UPDATE/DELETE 는 admin 만 (감사로그 위변조/삭제 차단)
--
-- 안전장치:
--   - 트랜잭션으로 원자 적용 (중간 실패 시 롤백 → 정책 없는 RLS 상태 방지)
--   - DROP IF EXISTS 후 CREATE → 재실행 무중복(idempotent)
--   - 테이블/컬럼/데이터 변경 없음, RLS 완화 아님(INSERT 전용 추가)
-- =====================================================================

begin;

-- RLS 활성화 (이미 켜져 있어도 오류 없음)
alter table public.audit_logs enable row level security;

drop policy if exists "audit_admin_all"        on public.audit_logs;
drop policy if exists "audit_auth_select"       on public.audit_logs;
drop policy if exists "audit_auth_insert"       on public.audit_logs;

-- admin: 전체 권한
create policy "audit_admin_all" on public.audit_logs for all
  using (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id)
  with check (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id);

-- 로그인 사용자(모든 역할): 본인 테넌트 감사로그 SELECT
create policy "audit_auth_select" on public.audit_logs for select
  using (auth.jwt() ->> 'tenant_id' = tenant_id);

-- 로그인 사용자(모든 역할): 본인 테넌트 감사로그 INSERT 전용
-- (UPDATE/DELETE 정책은 만들지 않으므로 비admin 은 수정/삭제 불가)
create policy "audit_auth_insert" on public.audit_logs for insert
  with check (auth.jwt() ->> 'tenant_id' = tenant_id);

commit;

-- =====================================================================
-- 확인 쿼리
-- =====================================================================

-- (A) RLS 활성화 여부
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'audit_logs';

-- (B) audit_logs 정책 목록 — cmd 가 ALL / SELECT / INSERT 만 존재해야 함
--     (UPDATE/DELETE 전용 정책이 없어야 비admin 위변조 불가)
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'audit_logs'
order by cmd, policyname;

-- (C) 비admin UPDATE/DELETE 차단 확인용 메모:
--     audit_auth_* 정책에 UPDATE/DELETE 가 없으므로, admin 외 역할의
--     UPDATE/DELETE 요청은 통과 정책이 없어 자동 거부(403)됩니다.
