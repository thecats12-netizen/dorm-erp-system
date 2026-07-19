-- 롤백: 실기 평가 최종 확정 RPC 제거(데이터 영향 없음 · 함수만 삭제).
drop function if exists public.finalize_practical_evaluation(text, uuid, boolean, date, text);
