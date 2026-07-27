-- ============================================================================
-- 테스트 데이터 정리 — 테스트 tenant 전용 (idempotent · FK 안전 순서)
--   ⚠ 운영 tenant 실행 금지. guard 가 'default'/'prod' 등이면 즉시 중단.
--   ⚠ 운영 데이터 전체 삭제 쿼리 없음. 오직 :test_tenant 범위만.
--   psql: \set test_tenant 'test'  후 실행 / Dashboard: :test_tenant 를 'test' 로 치환.
-- ============================================================================
\set test_tenant 'test'

-- ── SAFETY GUARD: 운영/기본 tenant 면 즉시 중단 ─────────────────────────────
select case when :'test_tenant' in ('default','prod','production','운영','main')
            then 1/0 else 0 end as must_be_test_tenant_guard;

begin;
-- 자식 → 부모 순서(FK). 모두 tenant 범위 한정.
delete from public.exam_certification_history      where tenant_id = :'test_tenant';
delete from public.exam_equipment_certifications   where tenant_id = :'test_tenant';
delete from public.pm_certifications               where tenant_id = :'test_tenant';
delete from public.exam_equipment_stage_rules      where tenant_id = :'test_tenant';
delete from public.exam_rules                      where tenant_id = :'test_tenant' and replace(coalesce(rule_type,''),' ','')='달성기준';
delete from public.exam_equipment                  where tenant_id = :'test_tenant';
delete from public.exam_processes                  where tenant_id = :'test_tenant';
delete from public.exam_groups                     where tenant_id = :'test_tenant';
delete from public.exam_categories                 where tenant_id = :'test_tenant';
-- 인증 단계(SINGLE~M4)는 다른 테스트에서 재사용될 수 있어 기본 보존.
-- 필요 시 아래 주석 해제(테스트 tenant 한정):
-- delete from public.exam_levels where tenant_id = :'test_tenant' and upper(code) in ('SINGLE','M1','M2','M3','M4');
commit;

-- 확인: 아래가 모두 0 이어야 정리 완료(레벨 제외).
select
 (select count(*) from public.exam_certification_history    where tenant_id=:'test_tenant') as hist,
 (select count(*) from public.exam_equipment_certifications where tenant_id=:'test_tenant') as certs,
 (select count(*) from public.pm_certifications             where tenant_id=:'test_tenant') as pm,
 (select count(*) from public.exam_equipment_stage_rules    where tenant_id=:'test_tenant') as stage,
 (select count(*) from public.exam_equipment               where tenant_id=:'test_tenant') as equip,
 (select count(*) from public.exam_processes               where tenant_id=:'test_tenant') as proc;
