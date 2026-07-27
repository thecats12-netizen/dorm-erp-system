-- ============================================================================
-- migration 사후 스키마 확인 (SELECT 전용 · 변경문 없음)
--   판정 기준은 각 쿼리 주석 참조. information_schema 접근이 제한되면 Dashboard 위치를 참고.
--   파라미터: :test_tenant  (예: 'test')   ※ Dashboard 에서는 :test_tenant 를 실제 값으로 치환
-- ============================================================================

-- [A] 선행 의존 확인 --------------------------------------------------------
-- RLS helper 함수 존재(없으면 20260715/20260716 미적용) · 정상=2행(또는 각 1)
select proname from pg_proc
 where proname in ('can_read_exam_master','is_exam_admin','crp_user_has_permission')
 order by proname;
-- 기본 테이블 존재(정상=아래 모두 1행)
select table_name from information_schema.tables
 where table_schema='public'
   and table_name in ('exam_levels','exam_processes','exam_equipment','exam_rules','pm_certifications')
 order by table_name;
-- processes 확장(group_id/category_id) 존재 — 정상=2행
select column_name from information_schema.columns
 where table_schema='public' and table_name='exam_processes' and column_name in ('group_id','category_id');

-- [B] 20260747 exam_levels 확장 + seed -------------------------------------
-- 정상: tier/parent_level_id/requires_approval/auto_promote/rank_order 모두 존재(5행)
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='exam_levels'
   and column_name in ('tier','parent_level_id','requires_approval','auto_promote','rank_order')
 order by column_name;
-- 정상: SINGLE/M1~M4 5단계가 rank_order 오름차순, tier='PM', requires_approval 존재
select upper(code) code, name, rank_order, tier, requires_approval, auto_promote
 from public.exam_levels
 where tenant_id = :test_tenant and upper(code) in ('SINGLE','M1','M2','M3','M4')
 order by rank_order;   -- 5행 아니면 seed 미적용/부분 적용

-- [C] 신규 테이블 존재 — 정상=3행 -----------------------------------------
select table_name from information_schema.tables
 where table_schema='public'
   and table_name in ('exam_equipment_stage_rules','exam_equipment_certifications','exam_certification_history')
 order by table_name;

-- [D] tenant_id 타입 = text (모든 신규 테이블) — 정상: udt_name='text' -----
select table_name, column_name, data_type
 from information_schema.columns
 where table_schema='public' and column_name='tenant_id'
   and table_name in ('exam_equipment_stage_rules','exam_equipment_certifications','exam_certification_history')
 order by table_name;

-- [E] exam_certification_history 핵심 컬럼 존재 --------------------------------
-- 정상: certification_type/level_id/previous_level_id/approved_at/approved_by/source_type/source_id/status/metadata/created_at 모두 존재
select column_name, data_type
 from information_schema.columns
 where table_schema='public' and table_name='exam_certification_history'
 order by ordinal_position;

-- [F] 인덱스 존재 — 정상: 각 테이블 인덱스 다수(ix_eqstage_*, ux_eqcert_*, ix_certhist_*) --
select tablename, indexname from pg_indexes
 where schemaname='public'
   and tablename in ('exam_equipment_stage_rules','exam_equipment_certifications','exam_certification_history')
 order by tablename, indexname;

-- [G] RLS 활성화 — 정상: 3개 테이블 relrowsecurity = true --------------------
select relname, relrowsecurity
 from pg_class
 where relname in ('exam_equipment_stage_rules','exam_equipment_certifications','exam_certification_history')
 order by relname;

-- [H] 정책 존재 + UPDATE/DELETE 정책 유무 -----------------------------------
-- 정상:
--   · 세 테이블 모두 SELECT/INSERT 정책 존재
--   · exam_certification_history 에는 UPDATE/DELETE 정책이 '없어야' 함(append-only 불변)
--   · stage_rules/certifications 도 DELETE 정책 없음(soft delete)
select tablename, policyname, cmd
 from pg_policies
 where schemaname='public'
   and tablename in ('exam_equipment_stage_rules','exam_equipment_certifications','exam_certification_history')
 order by tablename, cmd, policyname;
-- history 에 update/delete 정책이 잡히면(1행 이상) → 비정상(불변성 위반)
select tablename, cmd, count(*) as bad
 from pg_policies
 where schemaname='public' and tablename='exam_certification_history' and cmd in ('UPDATE','DELETE')
 group by tablename, cmd;

-- [I] btree_gist 설치 + exclusion constraint(설비단계 겹침) ---------------------
select extname from pg_extension where extname='btree_gist';          -- 정상=1행
select conname, contype, pg_get_constraintdef(oid) as def
 from pg_constraint
 where conrelid = 'public.exam_equipment_stage_rules'::regclass and contype='x';  -- 정상: ex_eqstage_no_overlap

-- [J] certifications 부분 unique(승인 1건/열린 후보 1건) -----------------------
select conname, contype, pg_get_constraintdef(oid) as def
 from pg_constraint where conrelid='public.exam_equipment_certifications'::regclass and contype='u'
 union all
 select indexname, 'u', indexdef from pg_indexes
 where schemaname='public' and tablename='exam_equipment_certifications' and indexname like 'ux_%';

-- [K] FK 확인 — 정상: history.personnel_id→exam_personnel, level_id→exam_levels 등 -------
select tc.table_name, kcu.column_name, ccu.table_name as ref_table
 from information_schema.table_constraints tc
 join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
 join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
 where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
   and tc.table_name in ('exam_certification_history','exam_equipment_stage_rules','exam_equipment_certifications')
 order by tc.table_name, kcu.column_name;

-- Dashboard 대체 확인 위치(정보 스키마 제한 시):
--   Table Editor → 각 테이블 컬럼/타입 확인
--   Authentication → Policies → 각 테이블 RLS 정책 목록(UPDATE/DELETE 없음 확인)
--   Database → Extensions → btree_gist 활성 확인
--   Database → Indexes → 인덱스 목록 확인
