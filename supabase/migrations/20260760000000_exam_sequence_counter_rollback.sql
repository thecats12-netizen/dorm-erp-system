-- ============================================================================
-- ROLLBACK — 시험 응시 연번 카운터/RPC (20260760000000)
--   ⚠ (선택) 유니크 인덱스 → RPC → 카운터 테이블 순 제거.
--   ⚠ is_active_authenticated() 는 다른 기능이 공유할 수 있어 제거하지 않는다.
--   ⚠ 백필로 채워진 exam_applications.seq_no 값은 되돌리지 않는다(영구 등록순서 값 · 되돌리면 다시 "미지정" 발생).
--      필요 시에만 별도 판단으로 특정 행을 수동 정리(자동 일괄 null 화 금지).
-- ============================================================================
begin;
drop index if exists public.ux_exam_app_tenant_year_seq;   -- (4)를 실행했을 때만 존재
drop function if exists public.next_exam_sequence(text, int);
drop table if exists public.exam_sequence_counters;
commit;
