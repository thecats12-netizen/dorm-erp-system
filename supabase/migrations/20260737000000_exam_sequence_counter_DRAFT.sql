-- ============================================================================
-- [초안 · 자동 적용 금지] 시험 응시 연번(seq_no) 자동 발급 — tenant·연도별 동시성 안전 카운터 + RPC
--   시험관리 > 시험 응시관리: 연번을 사용자가 직접 입력하지 않고 자동 생성.
--
--   ⚠ 검토용 초안입니다. Supabase SQL Editor 에서 직접 실행해야 적용됩니다.
--   ⚠ 기존 exam_applications 테이블/컬럼(seq_no int)은 변경하지 않습니다.
--   ⚠ 프론트는 이 RPC 미적용 시에도 안전하게 동작(연번 null 저장 → 기존과 동일).
--   ⚠ service_role_key 미사용. 증가는 RPC(security definer + advisory lock)로만.
-- ============================================================================

begin;

-- ── 1) 연번 카운터 테이블(tenant + 연도별 마지막 발급값) ────────────────────
create table if not exists public.exam_sequence_counters (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  sequence_year int not null,
  last_seq_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_exam_seq_counter on public.exam_sequence_counters (tenant_id, sequence_year);

alter table public.exam_sequence_counters enable row level security;

-- 조회는 현재 tenant 활성 사용자만. 직접 insert/update/delete 는 막고(정책 없음 → 거부) 증가는 RPC 로만.
--  (is_active_authenticated 은 기존 마이그레이션에서 생성된 헬퍼 재사용. 없으면 아래 주석 해제.)
-- create or replace function public.is_active_authenticated() returns boolean language sql stable security definer set search_path = public as $$
--   select exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.is_active, true)); $$;
drop policy if exists "esc_select" on public.exam_sequence_counters;
create policy "esc_select" on public.exam_sequence_counters
  for select to authenticated using (public.is_active_authenticated());

-- ── 2) 동시성 안전 발급 RPC ────────────────────────────────────────────────
--   advisory lock(tenant+year 해시)로 동시 호출 직렬화 → 중복/경쟁 방지. max(seq)+1 단순 실행 아님.
--   삭제된 번호는 재사용하지 않음(카운터는 감소하지 않음). 다른 tenant 번호 혼합 없음.
create or replace function public.next_exam_sequence(p_tenant_id text, p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  if p_tenant_id is null or p_tenant_id = '' or p_year is null then
    raise exception 'invalid tenant or year';
  end if;
  -- tenant+year 조합으로 트랜잭션 advisory lock(같은 카운터 동시 증가 직렬화).
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_year::text, 0));

  insert into public.exam_sequence_counters (tenant_id, sequence_year, last_seq_no)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, sequence_year)
  do update set last_seq_no = public.exam_sequence_counters.last_seq_no + 1,
                updated_at = now()
  returning last_seq_no into v_next;

  return v_next;
end;
$$;

-- 로그인(authenticated) 사용자만 실행 가능. anon 실행 차단.
revoke all on function public.next_exam_sequence(text, int) from public;
grant execute on function public.next_exam_sequence(text, int) to authenticated;

commit;

-- ── (선택) 기존 데이터로 카운터 초기화 — 과거 seq_no 최대값부터 이어서 발급하려면 실행 ──
--   과거 데이터에 일괄 번호를 새로 부여하지는 않음(기존 seq_no 그대로 유지). 카운터 시작점만 맞춘다.
--   created_at 연도 기준으로 tenant·연도별 max(seq_no)를 카운터에 반영:
-- insert into public.exam_sequence_counters (tenant_id, sequence_year, last_seq_no)
-- select tenant_id, extract(year from created_at)::int as sequence_year, max(seq_no) as last_seq_no
--   from public.exam_applications
--  where seq_no is not null and deleted_at is null
--  group by tenant_id, extract(year from created_at)::int
-- on conflict (tenant_id, sequence_year)
--   do update set last_seq_no = greatest(public.exam_sequence_counters.last_seq_no, excluded.last_seq_no);

-- ── 롤백(필요 시) ──────────────────────────────────────────────────────────
--   drop function if exists public.next_exam_sequence(text, int);
--   drop table if exists public.exam_sequence_counters;
