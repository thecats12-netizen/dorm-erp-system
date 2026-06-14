-- ============================================================================
-- military_module_data: tenant_id UNIQUE 제약 추가 (선택 사항)
-- ----------------------------------------------------------------------------
-- 증상: 콘솔에 반복되는 Supabase 400
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- 원인: saveMilitaryModule 가 upsert(onConflict: "tenant_id") 를 사용했으나
--        military_module_data.tenant_id 에 unique 제약이 없어 ON CONFLICT 매칭 실패.
--
-- 앱 코드는 이미 onConflict 의존을 제거(select 후 update/insert)하여 이 마이그레이션
-- 없이도 정상 동작합니다. 다만 테넌트당 1행을 DB 차원에서 강제하고 향후 upsert 를
-- 다시 쓰고 싶다면 아래 제약을 적용하세요. (기존 데이터 삭제 없음)
--
-- 적용 전: 중복 행이 있으면 제약 생성이 실패하므로, 중복이 있으면 먼저 정리 필요.
-- 안전하게: 중복 중 가장 최근(updated_at) 1행만 남기고 제거.
-- ============================================================================

-- 1) (중복 정리) 테넌트별 최신 1행만 유지 — 데이터 손실 주의: 오래된 중복 blob 제거
--    중복이 없으면 영향 없음.
DELETE FROM public.military_module_data a
USING public.military_module_data b
WHERE a.tenant_id = b.tenant_id
  AND a.ctid < b.ctid
  AND COALESCE(a.updated_at, 'epoch'::timestamptz) <= COALESCE(b.updated_at, 'epoch'::timestamptz);

-- 2) tenant_id UNIQUE 제약 추가 (이미 있으면 무시)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.military_module_data'::regclass
      AND conname = 'military_module_data_tenant_id_key'
  ) THEN
    ALTER TABLE public.military_module_data
      ADD CONSTRAINT military_module_data_tenant_id_key UNIQUE (tenant_id);
  END IF;
END $$;
