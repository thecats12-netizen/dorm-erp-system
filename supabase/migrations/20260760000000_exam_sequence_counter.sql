-- ============================================================================
-- 시험 응시 연번(seq_no) 정식화 — tenant·연도별 영구 연번 카운터 + 동시성 안전 RPC + 기존 null 백필.
--   목적: exam_applications.seq_no "미지정"(null) 문제 정상화. 20260737…_DRAFT 를 정식 승격(신규 파일).
--   ⚠ 기존 exam_applications 테이블/컬럼(seq_no int) 변경 없음. 기존 seq_no 값 절대 변경 안 함. 데이터 삭제 없음.
--   ⚠ 화면 index+1 / max(seq_no)+1(런타임) / localStorage 금지 — 증가는 RPC(security definer + advisory lock)로만.
--   ⚠ service_role_key 미사용. 멱등(create if not exists / create or replace / on conflict / null-only 백필).
--   ⚠ sequence_year 는 exam_applications 에 별도 컬럼을 추가하지 않고 created_at 연도(expression)로 산정(컬럼 무변경).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- (1) 카운터 테이블 + 발급 RPC + 권한 (멱등)
-- ────────────────────────────────────────────────────────────────────────
begin;

-- 활성 로그인 사용자 판정(있으면 재사용). 다른 곳에서도 쓰일 수 있어 rollback 에서 drop 하지 않음.
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

-- RLS: 활성화 + 직접 접근 정책 없음 → anon/authenticated 직접 select·insert·update·delete 거부. 접근은 정의자 RPC 로만.
alter table public.exam_sequence_counters enable row level security;
drop policy if exists "esc_select" on public.exam_sequence_counters;
revoke all on table public.exam_sequence_counters from anon, authenticated;

-- 동시성 안전 발급 RPC(반환 int — getNextExamSequence 기대 형식과 일치).
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
  if not public.is_active_authenticated() then
    raise exception 'not authorized';
  end if;
  if p_tenant_id is null or p_tenant_id = '' or p_year is null then
    raise exception 'invalid tenant or year';
  end if;
  -- JWT 에 tenant_id 클레임이 있으면 반드시 일치(현재 표준은 클레임 부재 → 통과).
  v_claim := auth.jwt() ->> 'tenant_id';
  if v_claim is not null and v_claim <> p_tenant_id then
    raise exception 'tenant mismatch';
  end if;
  -- tenant+year advisory lock 으로 동시 증가 직렬화(다른 tenant/연도는 서로 막지 않음).
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

revoke all on function public.next_exam_sequence(text, int) from public;
revoke all on function public.next_exam_sequence(text, int) from anon;
grant execute on function public.next_exam_sequence(text, int) to authenticated;

commit;

-- ────────────────────────────────────────────────────────────────────────
-- (진단 · 백필 전 · 읽기 전용 · 주석) 연도별 null seq_no 잔여 수.
--   select tenant_id, extract(year from created_at)::int as yr, count(*) as null_cnt
--     from public.exam_applications
--    where seq_no is null and deleted_at is null and created_at is not null
--    group by tenant_id, extract(year from created_at)::int order by yr;
-- ────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────
-- (2) 기존 null seq_no 백필 (결정론적 · 멱등 · 기존값 불변 · 현재 최대값 이후 부여)
--   · 대상: seq_no IS NULL 인 미삭제 행만. 기존 non-null seq_no 는 절대 변경하지 않음(WHERE seq_no is null).
--   · 채번: tenant_id + created_at 연도별로, created_at ASC, id ASC 결정론적 순서. 현재 최대값(maxseq) + 순번.
--   · 멱등: 재실행해도 이미 채번된 행은 null 이 아니라 제외 → 중복 부여 없음.
-- ────────────────────────────────────────────────────────────────────────
begin;

with base as (
  select tenant_id,
         extract(year from created_at)::int as yr,
         -- 안전 가드: 비정상 음수/0 seq_no 가 섞여도 백필 시작점이 0 미만이 되지 않게(기존 값은 건드리지 않음).
         greatest(coalesce(max(seq_no) filter (where seq_no is not null), 0), 0) as maxseq
    from public.exam_applications
   where deleted_at is null and created_at is not null
   group by tenant_id, extract(year from created_at)::int
),
ranked as (
  select a.id,
         a.tenant_id,
         extract(year from a.created_at)::int as yr,
         row_number() over (
           partition by a.tenant_id, extract(year from a.created_at)::int
           order by a.created_at asc, a.id asc
         ) as rn
    from public.exam_applications a
   where a.seq_no is null and a.deleted_at is null and a.created_at is not null
)
update public.exam_applications a
   set seq_no = b.maxseq + r.rn,
       updated_at = now()
  from ranked r
  join base b on b.tenant_id = r.tenant_id and b.yr = r.yr
 where a.id = r.id and a.seq_no is null;   -- 안전 가드: 기존 non-null 은 불변

-- (3) 카운터 재시드 — 백필 후 (tenant, 연도)별 최대 seq_no 로 last_seq_no 를 올림(greatest · 멱등).
--     이후 RPC 발급이 백필 번호와 충돌하지 않고 그 다음 번호부터 이어짐.
insert into public.exam_sequence_counters (tenant_id, sequence_year, last_seq_no)
select tenant_id,
       extract(year from created_at)::int as sequence_year,
       greatest(max(seq_no), 0)           as last_seq_no  -- 안전 가드: 카운터가 음수로 시드되지 않게
  from public.exam_applications
 where seq_no is not null and created_at is not null and deleted_at is null
 group by tenant_id, extract(year from created_at)::int
on conflict (tenant_id, sequence_year)
do update set last_seq_no = greatest(public.exam_sequence_counters.last_seq_no, excluded.last_seq_no),
              updated_at  = now();

commit;

-- ────────────────────────────────────────────────────────────────────────
-- (진단 · 백필 후 · 읽기 전용 · 주석) ① null 잔여 0 확인 ② (tenant,연도,seq_no) 중복 0 확인.
--   -- ① 남은 null(연도 산정 불가 등):
--   -- select count(*) from public.exam_applications where seq_no is null and deleted_at is null;
--   -- ② 중복 점검(0행이어야 (4) 유니크 인덱스 안전):
--   -- select tenant_id, extract(year from created_at)::int as yr, seq_no, count(*)
--   --   from public.exam_applications
--   --  where seq_no is not null and deleted_at is null
--   --  group by tenant_id, extract(year from created_at)::int, seq_no
--   -- having count(*) > 1 order by yr, seq_no;
-- ────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────
-- (4) [선택 · 위 진단 ②가 0행일 때만 수동 실행] DB 레벨 중복 최종 방어.
--   seq_no 전용 연도 컬럼이 없어 created_at 연도 식(expression) 부분 유니크 인덱스를 사용.
--   "발급 후 저장 실패 → 공백 번호"는 허용, "같은 번호 중복 저장"만 이 인덱스가 차단.
--   -- create unique index if not exists ux_exam_app_tenant_year_seq
--   --   on public.exam_applications (tenant_id, (extract(year from created_at)::int), seq_no)
--   --   where seq_no is not null and deleted_at is null;
-- ────────────────────────────────────────────────────────────────────────
