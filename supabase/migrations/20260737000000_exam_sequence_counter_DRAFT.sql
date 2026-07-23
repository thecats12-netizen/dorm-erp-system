-- ============================================================================
-- [초안 · 자동 적용 금지] 시험 응시 연번(seq_no) 자동 발급 — tenant·연도별 동시성 안전 카운터 + RPC
--   시험관리 > 시험 응시관리: 연번을 사용자가 직접 입력하지 않고 자동 생성.
--
--   ⚠ 검토용 초안입니다. Supabase SQL Editor 에서 (1)→(2)→(3) 순서로 직접 실행하세요.
--   ⚠ 기존 exam_applications 테이블/컬럼(seq_no int)은 변경하지 않습니다.
--   ⚠ 프론트는 이 RPC 미적용 시에도 안전(연번 null 저장 → 기존과 동일).
--   ⚠ service_role_key 미사용. 증가는 RPC(security definer + advisory lock)로만.
--
--   [tenant 모델] 본 프로젝트는 tenant_id text('default' 표준)이며, 현재 배포의 JWT 에는
--     커스텀 tenant_id 클레임이 없습니다(20260716000000_fix_exam_all_tables_rls.sql 주석 참조).
--     따라서 RPC 는 "활성 로그인 사용자"를 필수 검증하고, tenant 클레임이 존재할 때만(향후 멀티테넌트)
--     p_tenant_id 일치를 강제합니다. 클레임이 없으면(현재) 통과 — 기존 RLS 재작성 정책과 동일 기준.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- (1) 카운터 테이블 + RPC + 권한 생성
-- ────────────────────────────────────────────────────────────────────────
begin;

-- 활성 로그인 사용자 판정 헬퍼(기존에 있으면 재사용 · create or replace 로 안전).
create or replace function public.is_active_authenticated()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.is_active, true));
$$;

-- 연번 카운터(tenant + 연도별 마지막 발급값).
create table if not exists public.exam_sequence_counters (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  sequence_year int not null,
  last_seq_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_exam_seq_counter on public.exam_sequence_counters (tenant_id, sequence_year);

-- RLS: 활성화하되 "직접 접근 정책 없음" → 프론트/anon/authenticated 의 직접 select·insert·update·delete 모두 거부.
--   증가·조회는 오직 security definer RPC 를 통해서만(정의자 권한으로 RLS 우회). 프론트는 카운터를 직접 조회하지 않음.
alter table public.exam_sequence_counters enable row level security;
-- 혹시 남아있을 수 있는 이전 초안의 select 정책 제거(직접 조회 불필요 → 최소 권한).
drop policy if exists "esc_select" on public.exam_sequence_counters;
-- 테이블 직접 권한도 회수(정의자 RPC 만 접근).
revoke all on table public.exam_sequence_counters from anon, authenticated;

-- 동시성 안전 발급 RPC.
create or replace function public.next_exam_sequence(p_tenant_id text, p_year int)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next  int;
  v_claim text;
begin
  -- 1) 활성 로그인 사용자만(비로그인/비활성 차단).
  if not public.is_active_authenticated() then
    raise exception 'not authorized';
  end if;
  -- 2) 입력 검증(null/빈 tenant, null 연도 차단).
  if p_tenant_id is null or p_tenant_id = '' or p_year is null then
    raise exception 'invalid tenant or year';
  end if;
  -- 3) tenant 검증: JWT 에 tenant_id 클레임이 있으면 반드시 일치(다른 tenant 요청 차단).
  --    현재 표준은 클레임 부재 → 클레임이 없을 때만 통과(단일 tenant 'default').
  v_claim := auth.jwt() ->> 'tenant_id';
  if v_claim is not null and v_claim <> p_tenant_id then
    raise exception 'tenant mismatch';
  end if;
  -- 4) tenant+year 조합 advisory lock 으로 동시 증가 직렬화(다른 tenant/연도는 서로 막지 않음).
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_year::text, 0));
  -- 5) 증가(max+1 단순 실행 아님 · on conflict 원자적 증가). 반환값은 실제 갱신된 last_seq_no.
  insert into public.exam_sequence_counters (tenant_id, sequence_year, last_seq_no)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, sequence_year)
  do update set last_seq_no = public.exam_sequence_counters.last_seq_no + 1,
                updated_at = now()
  returning last_seq_no into v_next;
  return v_next;
end;
$$;

-- 실행 권한: public/anon 회수, authenticated 만 실행 가능.
revoke all on function public.next_exam_sequence(text, int) from public;
revoke all on function public.next_exam_sequence(text, int) from anon;
grant execute on function public.next_exam_sequence(text, int) to authenticated;

commit;

-- ────────────────────────────────────────────────────────────────────────
-- (2) [권장] 기존 데이터 max 기반 카운터 초기화 — 기존 seq_no 와 중복 방지(1부터 재시작 방지).
--     기존 exam_applications 는 수정하지 않음. 연도는 created_at 기준. 여러 번 실행해도 안전(greatest).
-- ────────────────────────────────────────────────────────────────────────
insert into public.exam_sequence_counters (tenant_id, sequence_year, last_seq_no)
select tenant_id,
       extract(year from created_at)::int as sequence_year,
       max(seq_no)                        as last_seq_no
  from public.exam_applications
 where seq_no is not null
   and created_at is not null
   and deleted_at is null
 group by tenant_id, extract(year from created_at)::int
on conflict (tenant_id, sequence_year)
do update set last_seq_no = greatest(public.exam_sequence_counters.last_seq_no, excluded.last_seq_no),
              updated_at  = now();

-- ────────────────────────────────────────────────────────────────────────
-- (3) [진단 · SELECT 전용] 기존 데이터의 (tenant, 연도, seq_no) 중복 여부 점검.
--     결과가 0행이어야 유니크 제약(선택) 추가가 안전합니다. 행이 있으면 먼저 정리해야 합니다.
-- ────────────────────────────────────────────────────────────────────────
-- select tenant_id, extract(year from created_at)::int as yr, seq_no, count(*)
--   from public.exam_applications
--  where seq_no is not null and deleted_at is null
--  group by tenant_id, extract(year from created_at)::int, seq_no
-- having count(*) > 1
--  order by yr, seq_no;

-- ────────────────────────────────────────────────────────────────────────
-- (4) [선택 · DRAFT] DB 레벨 중복 최종 방어(같은 tenant·연도·seq_no 중복 저장 차단).
--     ⚠ (3) 진단이 0행일 때만 실행. 기존 중복이 있으면 생성 실패합니다.
--     seq_no 전용 연도 컬럼이 없어 created_at 연도 식(expression) 부분 유니크 인덱스를 사용합니다.
--     RPC 발급과 저장이 별도 요청이라 "발급 후 저장 실패 → 공백 번호"는 허용 정책이나,
--     "같은 번호 중복 저장"은 이 인덱스가 최종 차단합니다.
-- ────────────────────────────────────────────────────────────────────────
-- create unique index if not exists ux_exam_app_tenant_year_seq
--   on public.exam_applications (tenant_id, (extract(year from created_at)::int), seq_no)
--   where seq_no is not null and deleted_at is null;

-- ── 롤백(필요 시) ──────────────────────────────────────────────────────────
--   drop index  if exists public.ux_exam_app_tenant_year_seq;
--   drop function if exists public.next_exam_sequence(text, int);
--   drop table  if exists public.exam_sequence_counters;
