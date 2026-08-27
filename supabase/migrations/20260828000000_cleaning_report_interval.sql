-- ============================================================================
-- [제안 · 자동 실행 금지] 청소관리 개인별 보고주기 + 우수자 (profiles)
--
-- [배경] 청소 미보고 감점(-5)이 담당자 전원 "1주 단위"로 고정. 담당자별로 보고 의무 주기를
--        다르게(1~12주) 설정하고, 주기 종료 시점에만 1회 감점하도록 개인 설정을 저장한다.
--        · 담당자 = profiles(dorm_id 로 담당 기숙사 연결)이므로 profiles 에 컬럼만 추가한다.
--        · 감점 금액(-5)은 기존 cleaningSettings(JSON app 설정) 재사용 → 신규 컬럼 없음.
--
-- [원칙]
--   · add column if not exists 로 2개만 추가(비파괴 · 재실행 안전). 기존 컬럼/RLS/데이터 불변.
--   · default 로 기존 동작 100% 보존: interval=1(1주), excellent=false → 배포 후 기존 담당자 점수 동일.
--   · ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
-- ============================================================================

alter table public.profiles
  add column if not exists cleaning_report_interval_weeks integer not null default 1, -- 보고 의무 주기(주). 1~12. 미설정=1(기존 동작)
  add column if not exists is_cleaning_excellent boolean not null default false;      -- 우수자 여부(관리 속성 · 감점 면제 아님)

-- 주기 1~12 범위 가드(재실행 안전 — 제약이 없을 때만 추가).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_cleaning_interval_range') then
    alter table public.profiles
      add constraint profiles_cleaning_interval_range check (cleaning_report_interval_weeks between 1 and 12);
  end if;
end $$;

comment on column public.profiles.cleaning_report_interval_weeks is '청소 보고 의무 주기(주 · 1~12). 미보고 감점은 이 주기 종료 시점에 1회. 기본 1(기존 주 단위 동작).';
comment on column public.profiles.is_cleaning_excellent is '청소 우수자 여부. 보고주기를 길게 설정 가능한 관리 속성이며 감점 면제가 아니다.';

notify pgrst, 'reload schema';

-- ============================================================================
-- 롤백(검토 후 수동 · 데이터 보존 위해 컬럼 유지 권장):
--   alter table public.profiles drop constraint if exists profiles_cleaning_interval_range;
--   -- alter table public.profiles drop column if exists cleaning_report_interval_weeks, drop column if exists is_cleaning_excellent;
-- ============================================================================
