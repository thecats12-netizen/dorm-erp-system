-- ============================================================================
-- [초안 · 자동 적용 금지] 시험 목표 "그룹↔파트 스코프 공존" 서버측 최종 방어 (Trigger + advisory lock)
--   대상: public.exam_annual_targets / public.exam_monthly_results
--
--   [1] 목적
--     프런트(수동 저장·Excel Import)는 이미 DB 스코프 조회로 반대 유형 공존을 fail-closed 차단하지만,
--     두 트랜잭션이 동시에 서로 다른 유형을 insert 하면 각자 검사 시점에 상대를 못 보고 둘 다 commit 되는
--     race condition 이 남는다. 이 트리거는 동일 (tenant_id, year, group_id, level_id) 스코프에서
--     "파트 목표"와 "그룹 목표"가 동시에 활성(deleted_at is null)으로 존재하지 못하도록 DB 레벨에서 강제한다.
--       · 파트 목표 = part_id is not null  OR  nullif(btrim(part_name),'') is not null
--       · 그룹 목표 = part_id is null      AND nullif(btrim(part_name),'') is null
--     같은 유형끼리의 중복은 이 트리거의 대상이 아니다(기존 IDENTITY/dedup/unique 정책에 위임).
--
--   ⚠ 자동 적용 금지 · supabase db push 금지 · 운영 DB 실행 금지. 기존 데이터/RLS/인덱스/컬럼 무변경(추가만).
--   ⚠ 이 트리거는 기존 데이터를 수정하지 않는다. "이미 공존 중인" 레거시 데이터는 그대로 남으며,
--      (3) 사전 진단에서 공존 조합이 1건이라도 있으면 적용을 "중단"하고 먼저 업무적으로 정리해야 한다.
-- ============================================================================


-- ============================================================================
-- [2] 적용 전 전제
--   · exam_annual_targets / exam_monthly_results 에 group_id(nullable FK) 존재(20260741 DRAFT 적용 완료).
--   · 두 테이블은 tenant_id(text) · year(int) · group_id(uuid) · level_id(uuid) · part_id(uuid) ·
--     part_name(text) · deleted_at(timestamptz) 컬럼을 가진다.
--   · Supabase PostgreSQL 11+ 필요(hashtextextended 사용). Supabase 는 통상 PG 15+ 라 호환.
--     └ 버전 확인 불가 시: (5)의 lock key 를 hashtext(text)::int + pg_advisory_xact_lock(int,int) 로 대체
--       (하단 대안 주석 참고). advisory lock 은 키 hash 충돌 시 "불필요한 직렬화"만 유발(정확성 영향 없음).
-- ============================================================================


-- ============================================================================
-- [3] 사전 진단 SQL (실행 전 · SELECT 전용 · 데이터 변경 없음)
--   ⚠ (3-1)/(3-2)가 1건이라도 반환되면 "이미 공존 데이터가 존재"하는 것이므로 적용을 중단하고
--      업무적으로 하나의 유형만 남기도록 정리한 뒤 다시 진단할 것. (마이그레이션은 자동 수정하지 않는다.)
-- ============================================================================
-- (3-1) annual 그룹/파트 공존 조합
-- select tenant_id, year, group_id, level_id,
--        count(*) filter (where part_id is not null or nullif(btrim(part_name),'') is not null) as part_targets,
--        count(*) filter (where part_id is null and nullif(btrim(part_name),'') is null)        as group_targets
--   from public.exam_annual_targets
--  where deleted_at is null and tenant_id is not null and year is not null
--    and group_id is not null and level_id is not null
--  group by tenant_id, year, group_id, level_id
-- having count(*) filter (where part_id is not null or nullif(btrim(part_name),'') is not null) > 0
--    and count(*) filter (where part_id is null and nullif(btrim(part_name),'') is null)        > 0;
--
-- (3-2) monthly 그룹/파트 공존 조합 (위와 동일 · 테이블만 exam_monthly_results)
-- select tenant_id, year, group_id, level_id,
--        count(*) filter (where part_id is not null or nullif(btrim(part_name),'') is not null) as part_targets,
--        count(*) filter (where part_id is null and nullif(btrim(part_name),'') is null)        as group_targets
--   from public.exam_monthly_results
--  where deleted_at is null and tenant_id is not null and year is not null
--    and group_id is not null and level_id is not null
--  group by tenant_id, year, group_id, level_id
-- having count(*) filter (where part_id is not null or nullif(btrim(part_name),'') is not null) > 0
--    and count(*) filter (where part_id is null and nullif(btrim(part_name),'') is null)        > 0;
--
-- (3-3) group_id orphan(존재하지 않는 그룹 참조 · FK 로 발생 불가하나 확인)
-- select t.id, t.group_id from public.exam_annual_targets t
--   left join public.exam_groups g on g.id = t.group_id
--  where t.group_id is not null and g.id is null;  -- monthly 도 동일 실행
--
-- (3-4) level_id orphan
-- select t.id, t.level_id from public.exam_annual_targets t
--   left join public.exam_levels l on l.id = t.level_id
--  where t.level_id is not null and l.id is null;  -- monthly 도 동일 실행
--
-- (3-5)~(3-8) 스코프 키 null 행 수(검사 생략 대상 규모 파악)
-- select count(*) filter (where tenant_id is null) tenant_null,
--        count(*) filter (where year is null)      year_null,
--        count(*) filter (where group_id is null)  group_null,
--        count(*) filter (where level_id is null)  level_null
--   from public.exam_annual_targets where deleted_at is null;  -- monthly 도 동일
--
-- (3-9) part_id 는 null 이지만 part_name 이 있는 행(→ 파트 목표로 판정됨)
-- select count(*) from public.exam_annual_targets
--  where deleted_at is null and part_id is null and nullif(btrim(part_name),'') is not null;  -- monthly 도 동일
--
-- (3-10) part_id 는 있지만 part_name 이 비어 있는 행(→ 파트 목표로 판정됨)
-- select count(*) from public.exam_annual_targets
--  where deleted_at is null and part_id is not null and nullif(btrim(part_name),'') is null;  -- monthly 도 동일


-- ============================================================================
-- [4] 기존 index 진단 (SELECT 전용) — 중복 인덱스 방지. 기존 index 삭제 금지.
-- ============================================================================
-- select tablename, indexname, indexdef from pg_indexes
--  where schemaname='public' and tablename in ('exam_annual_targets','exam_monthly_results')
--  order by tablename, indexname;
--   -- 참고: 기존 ux_*_key 는 (tenant_id, year, group_name, product_group, part_name, level_id) 로
--   --       group_id 를 선행 컬럼으로 쓰지 않는다 → 트리거 EXISTS(그룹_id 기준)용 부분 인덱스는 신규(비중복).


-- ============================================================================
-- [13] index 추가 (선택 · 트리거 EXISTS 성능용 · 멱등 · 기존 index 무변경)
--   데이터 규모가 작다면 생략 가능. INSERT/UPDATE 마다 EXISTS 조회가 돌므로 부분 인덱스 권장.
--   파트/그룹 판정은 표현식이라 별도 표현식 인덱스는 과도 → 추가하지 않음(스코프 4키로 후보만 좁힌 뒤 필터).
-- ============================================================================
begin;
create index if not exists ix_annual_targets_scope
  on public.exam_annual_targets (tenant_id, year, group_id, level_id)
  where deleted_at is null;
create index if not exists ix_monthly_results_scope
  on public.exam_monthly_results (tenant_id, year, group_id, level_id)
  where deleted_at is null;
commit;


-- ============================================================================
-- [5] helper 함수 — 스코프 유형 판정 + advisory lock 키
--   · 프런트 isPartScopedTarget 규칙과 "완전히 동일"하게 유지(part_id 또는 trim(part_name)).
--   · IMMUTABLE · SECURITY INVOKER(민감정보 없음). public 직접 호출 최소화를 위해 execute 회수.
-- ============================================================================
begin;

create or replace function public.exam_target_is_part_scope(p_part_id uuid, p_part_name text)
returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select p_part_id is not null or nullif(btrim(coalesce(p_part_name, '')), '') is not null;
$$;

-- 충돌 키(tenant|year|group|level)를 안정적으로 bigint 로 hash → 동일 키는 같은 advisory lock, 다른 키는 병렬 유지.
--  hash 충돌 시 서로 다른 키가 같은 lock 을 공유해 "불필요한 직렬화"만 발생(정확성에는 영향 없음).
create or replace function public.exam_target_scope_lock_key(p_tenant text, p_year int, p_group uuid, p_level uuid)
returns bigint
language sql immutable
set search_path = pg_catalog
as $$
  select hashtextextended(
    coalesce(p_tenant,'') || '|' || coalesce(p_year::text,'') || '|' ||
    coalesce(p_group::text,'') || '|' || coalesce(p_level::text,''),
    0
  );
$$;

revoke execute on function public.exam_target_is_part_scope(uuid, text) from public;
revoke execute on function public.exam_target_scope_lock_key(text, int, uuid, uuid) from public;

commit;

-- [대안 · PG11 미만 또는 hashtextextended 부재 시] 위 lock_key 대신 아래를 쓰고,
--   트리거에서 perform pg_advisory_xact_lock(hashtext(key_text), 0) 형태(int,int)로 호출한다.
-- create or replace function public.exam_target_scope_lock_key_i(p_tenant text, p_year int, p_group uuid, p_level uuid)
-- returns int language sql immutable set search_path = pg_catalog as $$
--   select hashtext(coalesce(p_tenant,'')||'|'||coalesce(p_year::text,'')||'|'||coalesce(p_group::text,'')||'|'||coalesce(p_level::text,''));
-- $$;


-- ============================================================================
-- [6][7] 트리거 함수 — annual / monthly 를 "명시적으로 분리"(동적 SQL 미사용 → injection·유지보수 위험 제거).
--   [SECURITY DEFINER 판정]
--     · 현재 write RLS 는 시험 관리자만 허용이고 관리자는 tenant 전체 SELECT 가능 → INVOKER 로도 충돌 행이 보인다.
--     · 그러나 "최종 방어"의 신뢰성을 위해, 향후 RLS 변경으로 호출자의 행 가시성이 제한되어도(=RLS 로 인한
--       fail-open) 반드시 authoritative 한 행 집합을 보도록 SECURITY DEFINER 를 사용한다.
--     · 안전장치: search_path 고정, 쿼리에서 tenant_id = NEW.tenant_id 강제(교차 tenant 조회 원천 차단),
--       사용자에게 데이터를 반환하지 않음(존재 여부로 raise/allow 만), execute 권한 회수.
--     · RLS 우회 범위는 "동일 tenant + 동일 스코프 키"로 한정되며 cross-tenant 로 확장되지 않는다.
--   [RLS 영향] tenant_id 를 명시적으로 강제하므로 멀티테넌트 격리는 유지된다. service_role_key 와 무관한 DB 내부 방어.
-- ============================================================================
begin;

create or replace function public.exam_annual_target_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_is_part boolean;
begin
  -- soft-delete 로 전환되는 행은 검사 대상 아님(삭제 허용).
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  -- [UPDATE 최적화/보존] 이미 활성이던 행에서 스코프 키·유형이 그대로면 재검사 불필요(수치/notes 수정 등 정상 허용).
  --   단, 삭제→복구(OLD.deleted_at is not null → NEW.deleted_at is null)는 아래로 진행해 재검사한다.
  if TG_OP = 'UPDATE'
     and OLD.deleted_at is null
     and NEW.tenant_id is not distinct from OLD.tenant_id
     and NEW.year      is not distinct from OLD.year
     and NEW.group_id  is not distinct from OLD.group_id
     and NEW.level_id  is not distinct from OLD.level_id
     and NEW.part_id   is not distinct from OLD.part_id
     and NEW.part_name is not distinct from OLD.part_name then
    return NEW;
  end if;

  -- 스코프 키 중 하나라도 null 이면 이번 검사 생략(프런트 판정과 일치 · null 을 오류/필수화하지 않음).
  if NEW.tenant_id is null or NEW.year is null or NEW.group_id is null or NEW.level_id is null then
    return NEW;
  end if;

  -- [동시성] 충돌 키 단위 transaction-level advisory lock. 동일 키의 두 트랜잭션을 직렬화(다른 키는 병렬 유지).
  perform pg_advisory_xact_lock(public.exam_target_scope_lock_key(NEW.tenant_id, NEW.year, NEW.group_id, NEW.level_id));

  new_is_part := public.exam_target_is_part_scope(NEW.part_id, NEW.part_name);

  if exists (
    select 1
      from public.exam_annual_targets t
     where t.deleted_at is null
       and t.id       <> NEW.id                 -- 자기 자신 제외(UPDATE)
       and t.tenant_id =  NEW.tenant_id          -- tenant 강제(멀티테넌트 격리)
       and t.year      =  NEW.year
       and t.group_id  =  NEW.group_id
       and t.level_id  =  NEW.level_id
       and public.exam_target_is_part_scope(t.part_id, t.part_name) <> new_is_part
  ) then
    raise exception '같은 그룹·연도·인증레벨에 % 단위 목표가 있어 % 목표를 저장할 수 없습니다.',
      case when new_is_part then '그룹' else '파트' end,
      case when new_is_part then '파트' else '그룹' end
      using errcode = 'P0001', hint = 'ERR_EXAM_TARGET_SCOPE_CONFLICT';
  end if;

  return NEW;
end;
$$;

create or replace function public.exam_monthly_target_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_is_part boolean;
begin
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and OLD.deleted_at is null
     and NEW.tenant_id is not distinct from OLD.tenant_id
     and NEW.year      is not distinct from OLD.year
     and NEW.group_id  is not distinct from OLD.group_id
     and NEW.level_id  is not distinct from OLD.level_id
     and NEW.part_id   is not distinct from OLD.part_id
     and NEW.part_name is not distinct from OLD.part_name then
    return NEW;
  end if;

  if NEW.tenant_id is null or NEW.year is null or NEW.group_id is null or NEW.level_id is null then
    return NEW;
  end if;

  perform pg_advisory_xact_lock(public.exam_target_scope_lock_key(NEW.tenant_id, NEW.year, NEW.group_id, NEW.level_id));

  new_is_part := public.exam_target_is_part_scope(NEW.part_id, NEW.part_name);

  if exists (
    select 1
      from public.exam_monthly_results t
     where t.deleted_at is null
       and t.id       <> NEW.id
       and t.tenant_id =  NEW.tenant_id
       and t.year      =  NEW.year
       and t.group_id  =  NEW.group_id
       and t.level_id  =  NEW.level_id
       and public.exam_target_is_part_scope(t.part_id, t.part_name) <> new_is_part
  ) then
    raise exception '같은 그룹·연도·인증레벨에 % 단위 목표가 있어 % 목표를 저장할 수 없습니다.',
      case when new_is_part then '그룹' else '파트' end,
      case when new_is_part then '파트' else '그룹' end
      using errcode = 'P0001', hint = 'ERR_EXAM_TARGET_SCOPE_CONFLICT';
  end if;

  return NEW;
end;
$$;

revoke execute on function public.exam_annual_target_scope_guard() from public;
revoke execute on function public.exam_monthly_target_scope_guard() from public;

-- 트리거 부착(멱등 · BEFORE INSERT OR UPDATE · FOR EACH ROW)
drop trigger if exists trg_exam_annual_target_scope_guard  on public.exam_annual_targets;
create trigger trg_exam_annual_target_scope_guard
  before insert or update on public.exam_annual_targets
  for each row execute function public.exam_annual_target_scope_guard();

drop trigger if exists trg_exam_monthly_target_scope_guard on public.exam_monthly_results;
create trigger trg_exam_monthly_target_scope_guard
  before insert or update on public.exam_monthly_results
  for each row execute function public.exam_monthly_target_scope_guard();

commit;


-- ============================================================================
-- [8] 검증 SQL (적용 후 · SELECT 전용)
-- ============================================================================
-- 트리거 존재:
-- select tgname, tgrelid::regclass as tbl, tgenabled from pg_trigger
--  where tgname in ('trg_exam_annual_target_scope_guard','trg_exam_monthly_target_scope_guard');
-- 함수 존재 + security definer:
-- select proname, prosecdef, proconfig from pg_proc
--  where proname in ('exam_target_is_part_scope','exam_target_scope_lock_key',
--                    'exam_annual_target_scope_guard','exam_monthly_target_scope_guard');


-- ============================================================================
-- [10][11][12] 기능 테스트 (수동 · 반드시 rollback) — 실제 운영 UUID 하드코딩 금지.
--   아래 <...> 자리표시자를 테스트 tenant/year 및 실제 존재하는 group_id/level_id 로 치환.
--   반드시 begin ... rollback 으로 감싸 테스트 데이터가 남지 않게 한다.
-- ============================================================================
-- begin;
--   -- <GID> = 실제 exam_groups.id, <LID> = 실제 exam_levels.id, <Y> = 테스트 연도(예: 2999)
--   -- (10) 정상 INSERT: 그룹 목표(파트 없음)
--   insert into public.exam_annual_targets (tenant_id, year, group_id, level_id, target_count)
--   values ('default', <Y>, '<GID>', '<LID>', 10);            -- 성공 기대
--   -- (11) 충돌 INSERT: 같은 스코프에 파트 목표 → 실패 기대(ERR_EXAM_TARGET_SCOPE_CONFLICT)
--   insert into public.exam_annual_targets (tenant_id, year, group_id, level_id, part_name, target_count)
--   values ('default', <Y>, '<GID>', '<LID>', '테스트파트', 5); -- 실패(그룹 목표가 있어 파트 목표 불가)
--   -- (다른 year/level/group 은 허용됨을 확인: 위 값 중 하나만 바꿔 insert → 성공)
-- rollback;
--
-- (12) UPDATE 테스트
-- begin;
--   -- 같은 유형 수치만 수정 → 허용
--   update public.exam_annual_targets set target_count = target_count + 1
--    where id = '<기존_그룹목표_ID>';                          -- 성공 기대
--   -- 반대 유형으로 변경(그룹→파트) 시 반대 유형 공존이면 → 실패 기대
--   update public.exam_annual_targets set part_name = '변경파트'
--    where id = '<기존_그룹목표_ID>';                          -- 같은 스코프에 파트 목표 있으면 실패
-- rollback;
--
-- (13) soft-delete / 복구 테스트
-- begin;
--   update public.exam_annual_targets set deleted_at = now() where id = '<ID>';  -- soft-delete: 허용
--   -- 복구 시(같은 스코프에 반대 유형이 활성이면) 재검사되어 실패 가능:
--   update public.exam_annual_targets set deleted_at = null where id = '<ID>';   -- 재검사
-- rollback;


-- ============================================================================
-- [9][동시성 테스트] 서로 다른 두 세션(A/B) · 동일 충돌 키 · 반대 유형 동시 INSERT
--   기대: 하나는 성공, 다른 하나는 advisory lock 대기 후 충돌 오류. 최종 한 유형만 존재.
--   <GID>/<LID>/<Y> 는 테스트 값으로 치환. 테스트 후 rollback.
-- ============================================================================
-- -- Session A:
-- begin;
-- insert into public.exam_annual_targets (tenant_id, year, group_id, level_id, target_count)
-- values ('default', <Y>, '<GID>', '<LID>', 1);   -- 그룹 목표 · advisory lock 획득 · commit 대기
-- -- (아직 commit 하지 않음)
-- --
-- -- Session B (A 가 열린 상태에서):
-- begin;
-- insert into public.exam_annual_targets (tenant_id, year, group_id, level_id, part_name, target_count)
-- values ('default', <Y>, '<GID>', '<LID>', '동시성파트', 1);  -- 같은 키 → A 의 lock 에서 "대기"
-- --
-- -- Session A: commit;   -- A 성공. 이 순간 B 의 lock 이 풀리며 B 가 EXISTS 검사 → A 의 그룹 목표 발견 → 충돌 오류.
-- -- Session B: (자동으로) ERROR: ...ERR_EXAM_TARGET_SCOPE_CONFLICT → rollback;
-- -- 결과: 그룹 목표 1건만 존재. (정리) delete/rollback 로 테스트 데이터 제거.


-- ============================================================================
-- [14] ROLLBACK (이 마이그레이션 되돌리기) — 신규 트리거/함수/인덱스만 제거. 기존 데이터/객체 무변경.
-- ============================================================================
--   drop trigger if exists trg_exam_annual_target_scope_guard  on public.exam_annual_targets;
--   drop trigger if exists trg_exam_monthly_target_scope_guard on public.exam_monthly_results;
--   drop function if exists public.exam_annual_target_scope_guard();
--   drop function if exists public.exam_monthly_target_scope_guard();
--   drop function if exists public.exam_target_scope_lock_key(text, int, uuid, uuid);
--   drop function if exists public.exam_target_is_part_scope(uuid, text);
--   drop index if exists public.ix_annual_targets_scope;
--   drop index if exists public.ix_monthly_results_scope;


-- ============================================================================
-- [15] 적용 후 확인 절차
--   1) (3-1)/(3-2) 공존 진단 = 0행 확인(아니면 적용 중단·데이터 정리 후 재시도).
--   2) [13] 인덱스 → [5] 함수 → [6][7] 트리거 순으로 실행.
--   3) [8] 검증 SELECT 로 트리거/함수/security definer 확인.
--   4) [10][11][12][13] 기능 테스트(begin…rollback)로 정상/충돌/UPDATE/soft-delete 동작 확인.
--   5) [9] 동시성 테스트로 race 차단 확인.
--   6) 프런트: DB 에러 hint = 'ERR_EXAM_TARGET_SCOPE_CONFLICT' 를 감지해 사용자 친화 메시지로 표시(선택 · 별도 작업).
--
-- [16] 운영 주의사항
--   · 이 트리거는 "신규 공존"만 막는다. 적용 전 이미 공존하던 데이터는 자동 정리하지 않는다((3) 진단 필수).
--   · advisory lock 은 동일 스코프 키에 한해 직렬화 → 대량 동시 저장이 같은 키에 몰리면 짧은 대기 발생(정상).
--     전체/tenant 단위 lock 은 사용하지 않는다.
--   · SECURITY DEFINER 함수 소유자는 두 목표 테이블에 SELECT 가능한 역할(예: 테이블 소유자)이어야 한다.
--     함수는 사용자에게 데이터를 노출하지 않고 tenant_id 를 강제하므로 cross-tenant 유출 위험은 없다.
--   · hashtextextended 미지원 환경이면 (5) 대안(hashtext + int,int)으로 교체.
-- ============================================================================
