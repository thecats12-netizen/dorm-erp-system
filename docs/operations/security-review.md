# 정기 보안 점검표

주기: 분기 1회(핵심) + 반기/연간 심화. 담당: 보안 담당 + 개발팀 협조.
각 항목 [확인 방법 / 정상 기준]. 이상 시 [사고 대응](../permissions/permission-incident-response.md).

---

## RLS (Row Level Security)
- 확인: Supabase > Database > Policies / `pg_policies`
- 정상: 권한 테이블(custom_roles 등) RLS 활성, admin+tenant 정책, 물리 DELETE 정책 없음. 시험 공정 범위(exam_user_process_scopes) 서버 강제. 기숙사 범위 RLS 적용 여부 확인(초안 여부).

## RPC / 함수
- 확인: 권한 함수(`is_custom_role_admin`, `can_user_access_*`, `crs_*` 등) 실행 권한
- 정상: **anon EXECUTE 없음**, authenticated만. SECURITY DEFINER 함수는 `search_path` 고정.

## JWT / 인증
- 확인: 로그인 흐름, 세션
- 정상: Supabase Auth 사용, 클라이언트가 전달한 user_id 미신뢰(서버는 `auth.uid()` 기준). 관리자 판별을 프론트 role 문자열만으로 하지 않음.

## Storage
- 확인: 버킷 정책(inventory-proof, cleaning-photos)
- 정상: 쓰기 authenticated, 필요 시 활성 사용자만. 서명 URL/파일 단위 권한은 확장 검토 항목.

## API
- 확인: REST/RPC 직접 호출 시 RLS 거부
- 정상: 권한 없는 SELECT/INSERT/UPDATE/DELETE 차단(정상 403/42501). service_role은 서버 전용.

## Environment / Secret
- 확인: Vercel 환경변수, JS 번들, `.env`
- 정상: 클라이언트엔 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`만. **service_role_key 미노출**. `.env` Git 추적 제외(.gitignore). 번들/HTML에 비밀키 없음.

## HTTPS
- 확인: Production 도메인
- 정상: 전 구간 HTTPS, 리다이렉트 URL도 HTTPS.

## CSP / XSS
- 확인: 응답 헤더, 사용자 입력 렌더링
- 정상: React 기본 이스케이프 사용, dangerouslySetInnerHTML 최소·검증. CSP 헤더 도입 검토(Vercel 설정).

## SQL Injection
- 확인: 쿼리 방식
- 정상: Supabase 클라이언트/파라미터 바인딩 사용(문자열 직접 조합 금지). SECURITY DEFINER 함수 search_path 고정으로 함수 하이재킹 방지.

## Rate Limit
- 확인: Supabase Auth Rate Limit, 반복 요청
- 정상: 로그인 실패 반복 제한, 무한/반복 API 요청 없음(권한 조회 1회 캐시).

---

## 점검 결과
| 영역 | 확인일 | 정상? | 비고 |
|---|---|---|---|
| RLS |  |  |  |
| RPC/함수 |  |  |  |
| JWT/인증 |  |  |  |
| Storage |  |  |  |
| API |  |  |  |
| Secret/Env |  |  |  |
| HTTPS |  |  |  |
| CSP/XSS |  |  |  |
| SQL Injection |  |  |  |
| Rate Limit |  |  |  |
