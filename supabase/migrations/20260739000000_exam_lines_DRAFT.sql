-- ============================================================================
-- [초안 · 자동 적용 금지] 시험관리 기준정보 "라인" 추가 + 인증규칙 line_id 확장
--   인증 기준관리 최상위에 라인(P3F/P3D/TSV/공통 등)을 추가하고,
--   exam_rules 에 line_id(nullable)를 두어 라인별 규칙을 등록할 수 있게 한다.
--
--   ⚠ 현재 프론트에 라인 탭/조회가 배포되어 있고, 이 테이블 미적용 시 GET exam_lines → 404(PGRST205).
--      프론트는 미생성 테이블을 1회만 감지 후 [] 반환(반복 404 억제)하지만, 정상 동작하려면 아래를 실행해야 한다.
--   ⚠ Supabase SQL Editor 에서 (1)→(2)→(3) 순서로 실행. 검증(4)로 확인.
--   ⚠ 기존 마스터 구조/데이터 변경 없음. line_id nullable → 기존 규칙은 "공통(null)"로 호환.
--   ⚠ RLS 는 기존 시험 마스터 표준 헬퍼(can_read_exam_master / is_exam_admin)를 재사용.
--      (JWT tenant_id 클레임 부재 · 단일 tenant 'default' 환경에서도 정상 · anon 차단 · 관리자만 쓰기)
--      → 이 헬퍼는 20260716000000_fix_exam_all_tables_rls.sql 에서 생성됨(선적용 필요).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- (1) exam_lines 테이블 + 인덱스 + RLS
-- ────────────────────────────────────────────────────────────────────────
begin;

create table if not exists public.exam_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  code text,
  name text not null,
  sort_order int,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_exam_lines_tenant on public.exam_lines (tenant_id);
create unique index if not exists ux_exam_lines_code
  on public.exam_lines (tenant_id, upper(code))
  where deleted_at is null and code is not null and code <> '';

alter table public.exam_lines enable row level security;

-- 기존 시험 마스터 표준 정책과 동일(헬퍼 재사용). 없던 정책만 생성(이름 중복 방지).
drop policy if exists "exam_master_select" on public.exam_lines;
drop policy if exists "exam_master_insert" on public.exam_lines;
drop policy if exists "exam_master_update" on public.exam_lines;

-- SELECT: 로그인한 활성 사용자(조회 범위 표준)
create policy "exam_master_select" on public.exam_lines
  for select to authenticated using (public.can_read_exam_master());
-- INSERT: 시험 관리자만 + tenant_id 필수
create policy "exam_master_insert" on public.exam_lines
  for insert to authenticated with check (public.is_exam_admin() and tenant_id is not null);
-- UPDATE: 시험 관리자만(soft delete 포함) · tenant 변조 차단
create policy "exam_master_update" on public.exam_lines
  for update to authenticated
  using (public.is_exam_admin() and tenant_id is not null)
  with check (public.is_exam_admin() and tenant_id is not null);
-- DELETE 정책 없음 = 물리 삭제 차단(soft delete 만).

commit;

-- ────────────────────────────────────────────────────────────────────────
-- (2) 인증규칙 line_id(nullable FK) — 기존 규칙은 null(공통)
-- ────────────────────────────────────────────────────────────────────────
begin;
alter table public.exam_rules add column if not exists line_id uuid references public.exam_lines(id) on delete set null;
create index if not exists ix_exam_rules_line on public.exam_rules (tenant_id, line_id) where deleted_at is null;
commit;

-- ────────────────────────────────────────────────────────────────────────
-- (3) 초기 라인 데이터(멱등 · tenant_id 를 실제 값으로 · 기본 'default')
-- ────────────────────────────────────────────────────────────────────────
insert into public.exam_lines (tenant_id, code, name, sort_order)
select v.tenant_id, v.code, v.name, v.sort_order
from (values
  ('default', 'COMMON', '공통', 1),
  ('default', 'P3F',    'P3F',  2),
  ('default', 'P3D',    'P3D',  3),
  ('default', 'TSV',    'TSV',  4)
) as v(tenant_id, code, name, sort_order)
where not exists (
  select 1 from public.exam_lines e
   where e.tenant_id = v.tenant_id and upper(e.code) = upper(v.code) and e.deleted_at is null
);

-- (schema cache 갱신) PostgREST 스키마 캐시는 보통 수초 내 자동 갱신. 즉시 반영이 필요하면:
--   notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- (4) 검증 SQL (SELECT 전용)
-- ────────────────────────────────────────────────────────────────────────
-- 테이블 존재:
-- select to_regclass('public.exam_lines') as exam_lines_exists;
-- line_id 컬럼 존재:
-- select column_name, is_nullable, data_type from information_schema.columns
--  where table_schema='public' and table_name='exam_rules' and column_name='line_id';
-- RLS 활성화:
-- select relrowsecurity from pg_class where oid = 'public.exam_lines'::regclass;
-- 정책 목록:
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='exam_lines';
-- 라인 목록:
-- select tenant_id, code, name, sort_order, is_active from public.exam_lines where deleted_at is null order by sort_order;
-- 코드 중복(0행이어야 정상):
-- select tenant_id, upper(code) code, count(*) from public.exam_lines where deleted_at is null and code is not null
--   group by 1,2 having count(*)>1;
-- 기존 규칙 line_id null(공통) 건수:
-- select count(*) filter (where line_id is null) as common_rules, count(*) as total_rules
--   from public.exam_rules where deleted_at is null;
-- orphan line_id(존재하지 않는 라인 참조 · FK 로 발생 불가하나 확인):
-- select r.id, r.line_id from public.exam_rules r
--   left join public.exam_lines l on l.id = r.line_id
--  where r.line_id is not null and l.id is null;

-- ── 롤백(필요 시) ──────────────────────────────────────────────────────────
--   alter table public.exam_rules drop column if exists line_id;
--   drop table if exists public.exam_lines;
