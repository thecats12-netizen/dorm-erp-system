-- 비품(inventory_items) 구매/처리 업체 컬럼 추가
-- 원인: 프론트 저장 payload에는 purchase_vendor / disposal_vendor 가 포함되지만
--       운영 DB inventory_items 테이블에 해당 컬럼이 없어 upsert 시 PGRST204
--       ("Could not find the 'disposal_vendor' column ... in the schema cache") 로 저장 실패.
-- 정책: 기존 컬럼/데이터는 그대로 두고 없을 때만 추가(idempotent). 데이터 삭제/초기화 없음.
-- 적용: Supabase SQL Editor 에서 아래 전체를 1회 실행. (자동 실행하지 않음 — 관리자 검토 후 수동 적용)

alter table public.inventory_items
  add column if not exists purchase_vendor text,
  add column if not exists disposal_vendor text;

-- PostgREST 스키마 캐시 갱신(컬럼 추가 직후 PGRST204 재발 방지).
notify pgrst, 'reload schema';
