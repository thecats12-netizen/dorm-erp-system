-- ============================================================================
-- 빈/오염(자동생성 의심) 행 정리 (Supabase SQL Editor 에서 실행)
-- ----------------------------------------------------------------------------
-- 목적: 과거 자동생성/빈 입력으로 생긴 필수값 없는 행을 삭제해 화면·통계 오염을 제거한다.
-- 주의: 되돌릴 수 없으므로, 먼저 아래 "확인용 SELECT" 로 건수를 점검한 뒤 DELETE 를 실행하세요.
--       (앱은 이미 이런 행을 화면 표시/저장에서 제외하지만, DB 원본도 정리하려면 아래를 실행)
-- ============================================================================

-- 0) 확인용: 삭제 대상 건수 미리보기 ----------------------------------------
select 'occupants' as tbl, count(*) from public.occupants
  where coalesce(nullif(btrim(employee_name), ''), '') = '' or btrim(employee_name) = '-'
union all
select 'cleaning_reports', count(*) from public.cleaning_reports
  where coalesce(nullif(btrim(building_name), ''), '') = ''
    and coalesce(nullif(btrim(memo), ''), '') = ''
union all
select 'defect_requests', count(*) from public.defect_requests
  where coalesce(nullif(btrim(request_text), ''), '') = ''
union all
select 'inventory_items', count(*) from public.inventory_items
  where coalesce(nullif(btrim(item_name), ''), '') = ''
union all
select 'dorm_contracts', count(*) from public.dorm_contracts
  where coalesce(nullif(btrim(building_name), ''), '') = ''
    and coalesce(nullif(btrim(address), ''), '') = ''
    and coalesce(nullif(btrim(landlord_name), ''), '') = '';

-- 1) 입주자: 이름(employee_name)이 NULL/빈값/"-" 인 행 삭제 -------------------
delete from public.occupants
  where coalesce(nullif(btrim(employee_name), ''), '') = '' or btrim(employee_name) = '-';

-- 2) 청소보고서: 건물명과 메모가 모두 비어 있는 빈 행 삭제 ----------------------
--    (cleaning_reports 에는 title/content 컬럼이 없으므로 building_name + memo 기준으로 빈 행 판정)
delete from public.cleaning_reports
  where coalesce(nullif(btrim(building_name), ''), '') = ''
    and coalesce(nullif(btrim(memo), ''), '') = '';

-- 3) 하자접수: 하자신청내용(request_text)이 없는 행 삭제 ------------------------
delete from public.defect_requests
  where coalesce(nullif(btrim(request_text), ''), '') = '';

-- 4) 비품: 비품명(item_name)이 없는 행 삭제 ----------------------------------
delete from public.inventory_items
  where coalesce(nullif(btrim(item_name), ''), '') = '';

-- 5) 신규계약: 건물명/주소/임대인명이 모두 없는 행 삭제 ------------------------
delete from public.dorm_contracts
  where coalesce(nullif(btrim(building_name), ''), '') = ''
    and coalesce(nullif(btrim(address), ''), '') = ''
    and coalesce(nullif(btrim(landlord_name), ''), '') = '';

-- (선택) 6) tenant_id 정규화: 섞여 있는 값을 'default' 로 통일 ----------------
--    앱은 tenant 필터 없이 조회하므로 필수는 아니지만, 정리하려면 주석 해제 후 실행.
-- update public.dorms            set tenant_id = 'default' where tenant_id is distinct from 'default';
-- update public.occupants        set tenant_id = 'default' where tenant_id is distinct from 'default';
-- update public.dorm_contracts   set tenant_id = 'default' where tenant_id is distinct from 'default';
-- update public.new_hires        set tenant_id = 'default' where tenant_id is distinct from 'default';
-- update public.inventory_items  set tenant_id = 'default' where tenant_id is distinct from 'default';
-- update public.cleaning_reports set tenant_id = 'default' where tenant_id is distinct from 'default';
-- update public.defect_requests  set tenant_id = 'default' where tenant_id is distinct from 'default';
