-- ============================================================================
-- 시험관리 재시험 후보 — 신규 테이블만 추가(기존 테이블/컬럼/RLS 미변경). 재실행 안전(idempotent).
--  자동 후보 → 관리자 검토 → 승인 → 실제 재시험 신청 구조. 자동으로 실제 시험회차에 등록하지 않는다.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.exam_retest_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  employee_no text,
  name text,
  level_id text,            -- 인증단계(exam_levels id 또는 D.M 단계 문자열)
  level_label text,         -- 표시용 인증단계 라벨
  reason text,              -- 필기 불합격 / 실기 불합격 / 시험 취소 / 기준기간 초과 미취득 / 인증 갱신 실패 / 인증 만료
  occurred_date date,       -- 발생일
  status text not null default '후보',  -- 후보 / 승인 / 반려 / 신청
  approved_by uuid,
  approved_at timestamptz,
  source_type text,         -- exam_application / dm_certification
  source_id text,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_exam_retest_tenant on public.exam_retest_candidates (tenant_id);
create index if not exists ix_exam_retest_status on public.exam_retest_candidates (tenant_id, status);

-- 중복 방지: 동일 직원 + 동일 인증단계 + 동일 사유의 "활성 후보(후보/승인)"는 1건만.
create unique index if not exists ux_exam_retest_active
  on public.exam_retest_candidates (tenant_id, employee_no, level_id, reason)
  where deleted_at is null and status in ('후보', '승인');

-- RLS (기존 표준과 동일: admin=ALL, viewer=SELECT, 그 외 거부, tenant 격리)
do $do$
declare t text;
begin
  foreach t in array array['exam_retest_candidates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'exam_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id) with check (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_admin_all', t, 'role', 'admin', 'tenant_id', 'role', 'admin', 'tenant_id'
    );
    execute format('drop policy if exists %I on public.%I', 'exam_viewer_select', t);
    execute format(
      'create policy %I on public.%I for select using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_viewer_select', t, 'role', 'viewer', 'tenant_id'
    );
  end loop;
end
$do$;

commit;
