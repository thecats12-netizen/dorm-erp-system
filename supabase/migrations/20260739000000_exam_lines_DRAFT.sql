-- ============================================================================
-- [초안 · 자동 적용 금지] 시험관리 기준정보 "라인" 추가 + 인증규칙 line_id 확장
--   인증 기준관리 최상위에 라인(P3F/P3D/TSV/공통 등)을 추가하고,
--   exam_rules 에 line_id(nullable)를 두어 라인별 규칙을 등록할 수 있게 한다.
--
--   ⚠ 검토용 초안입니다. Supabase SQL Editor 에서 직접 실행해야 적용됩니다.
--   ⚠ 기존 exam_categories/groups/parts/processes/equipment/levels/rules 구조는 변경하지 않습니다.
--   ⚠ line_id 는 nullable → 기존 인증규칙은 "공통(line_id null)"로 그대로 호환됩니다.
--   ⚠ 프론트는 이 초안 미적용 시에도 안전(라인 탭은 빈 목록/로드 스킵, 규칙 저장은 라인 미선택 시 기존과 동일).
--   ⚠ RLS 는 기존 시험 테이블 표준(auth.jwt() tenant_id 클레임 + tenant_id 컬럼)과 동일하게 적용.
-- ============================================================================

begin;

-- ── 1) 라인 마스터: exam_lines (제품군 등과 동일한 flat 구조) ────────────────
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
-- 같은 tenant 내 코드 중복 방지(미삭제·코드 존재 시).
create unique index if not exists ux_exam_lines_code
  on public.exam_lines (tenant_id, upper(code))
  where deleted_at is null and code is not null and code <> '';

alter table public.exam_lines enable row level security;

-- RLS: 기존 시험 마스터 표준과 동일(JWT tenant 클레임 = tenant_id + 역할). 클레임 부재(단일 tenant 'default') 환경도 고려해
--   기존 프로젝트가 쓰는 정책 형태를 그대로 따른다. (아래는 20260712000000 표준과 동일 구조)
drop policy if exists "exam_lines_all" on public.exam_lines;
create policy "exam_lines_all" on public.exam_lines
  for all
  using (coalesce(auth.jwt() ->> 'tenant_id', tenant_id) = tenant_id)
  with check (coalesce(auth.jwt() ->> 'tenant_id', tenant_id) = tenant_id);

-- ── 2) 인증규칙 line_id(nullable FK) ───────────────────────────────────────
--   기존 규칙은 line_id null(공통). on delete set null → 라인 삭제해도 규칙은 공통으로 보존.
alter table public.exam_rules add column if not exists line_id uuid references public.exam_lines(id) on delete set null;
create index if not exists ix_exam_rules_line on public.exam_rules (tenant_id, line_id) where deleted_at is null;

commit;

-- ── (선택) 초기 라인 데이터 예시 — 필요 시 tenant_id 를 실제 값으로 바꿔 실행 ──
-- insert into public.exam_lines (tenant_id, code, name, sort_order) values
--   ('default', 'P3F', 'P3F', 1), ('default', 'P3D', 'P3D', 2),
--   ('default', 'TSV', 'TSV', 3), ('default', 'COMMON', '공통', 9)
-- on conflict do nothing;

-- ── 롤백(필요 시) ──────────────────────────────────────────────────────────
--   alter table public.exam_rules drop column if exists line_id;
--   drop table if exists public.exam_lines;
