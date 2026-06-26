# scripts 폴더 안내 (중요)

이 폴더의 **`.sql` 파일만** Supabase SQL Editor 에서 실행하세요.

## ✅ SQL Editor 에서 실행 (Supabase 콘솔 > SQL Editor)
- `supabase-*.sql` 파일 (예: `supabase-audit-logs.sql`, `supabase-permanent-delete-columns.sql`,
  `supabase-photo-columns.sql`, `supabase-realtime-all.sql`, `supabase-app-settings.sql`,
  `supabase-profiles-phone.sql` 등)
- 멱등(idempotent)하게 작성되어 여러 번 실행해도 안전합니다.

## ❌ SQL Editor 에서 실행하면 안 되는 것 (TypeScript/React 코드)
- `src/**/*.ts`, `src/**/*.tsx` (예: `src/App.tsx`, `src/services/*.ts`)
- 이 파일들은 **앱(프론트엔드) 코드**입니다. SQL 이 아니므로 SQL Editor 에 붙여넣으면
  `syntax error at or near "import"` 같은 오류가 납니다.
- TypeScript 코드는 `npm install` 후 `npm run dev`(개발) / `npm run build`(배포 빌드)로 실행/빌드합니다.

## 적용 순서(권장)
1. Supabase SQL Editor 에서 `scripts/*.sql` 을 실행해 테이블/컬럼/RLS/Realtime publication 을 준비.
2. 앱은 `npm run build` 후 배포하거나 `npm run dev` 로 실행.

> 요약: **SQL 은 SQL Editor, 코드(.ts/.tsx)는 npm 빌드/실행** — 절대 섞지 마세요.
