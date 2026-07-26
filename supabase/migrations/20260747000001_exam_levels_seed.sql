-- ============================================================================
-- [초안 · 수동 실행] 인증 레벨 초기 행 seed — SINGLE/M1~M4/DM/SENIOR_DM/MAESTRO
--   · code 중복 방지(멱등). 기존 동일 code 행이 있으면 삽입하지 않음(이름/설정 덮어쓰지 않음).
--   · 전역 tenant UUID 하드코딩 금지 → exam_levels 에 존재하는 "각 tenant"에 대해 삽입(없으면 'default').
--   · rank_order 는 계층 순서. requires_approval/auto_promote 는 확정 정책(SINGLE 자동, 그 외 승인).
--   ⚠ 20260747000000(컬럼 추가) 선행 필요. 운영 자동 적용 금지.
-- ============================================================================
insert into public.exam_levels (tenant_id, code, name, tier, rank_order, auto_promote, requires_approval, is_active)
select tn.tenant_id, v.code, v.name, v.tier, v.rank_order, v.auto_promote, v.requires_approval, true
from (
  -- 기존 레벨이 있는 tenant 전체(없으면 'default' 1건)
  select distinct tenant_id from public.exam_levels where deleted_at is null
  union
  select 'default' where not exists (select 1 from public.exam_levels where deleted_at is null)
) tn
cross join (values
  ('SINGLE',    'Single',    'PM',        10, true,  false),
  ('M1',        'M1',        'PM',        20, false, true),
  ('M2',        'M2',        'PM',        30, false, true),
  ('M3',        'M3',        'PM',        40, false, true),
  ('M4',        'M4',        'PM',        50, false, true),
  ('DM',        'DM',        'DM',        60, false, true),
  ('SENIOR_DM', 'Senior DM', 'SENIOR_DM', 70, false, true),
  ('MAESTRO',   'Maestro',   'MAESTRO',   80, false, true)
) as v(code, name, tier, rank_order, auto_promote, requires_approval)
where not exists (
  select 1 from public.exam_levels e
   where e.tenant_id = tn.tenant_id and upper(e.code) = upper(v.code) and e.deleted_at is null
);

-- 선행 계층(parent_level_id) 연결 — M1→SINGLE, M2→M1 … MAESTRO→SENIOR_DM (동일 tenant, 이미 있는 값은 유지)
update public.exam_levels c
   set parent_level_id = p.id
  from public.exam_levels p
 where c.deleted_at is null and p.deleted_at is null and c.tenant_id = p.tenant_id
   and c.parent_level_id is null
   and (
     (upper(c.code)='M1' and upper(p.code)='SINGLE') or
     (upper(c.code)='M2' and upper(p.code)='M1') or
     (upper(c.code)='M3' and upper(p.code)='M2') or
     (upper(c.code)='M4' and upper(p.code)='M3') or
     (upper(c.code)='DM' and upper(p.code)='M4') or
     (upper(c.code)='SENIOR_DM' and upper(p.code)='DM') or
     (upper(c.code)='MAESTRO' and upper(p.code)='SENIOR_DM')
   );

-- 확인: select code,name,tier,rank_order,auto_promote,requires_approval,parent_level_id from public.exam_levels
--   where deleted_at is null order by tenant_id, rank_order;
-- 롤백(seed 되돌리기 · 신중): 신규 seed 행만 제거하려면 code 로 식별해 soft delete 권장(하드 delete 금지).
