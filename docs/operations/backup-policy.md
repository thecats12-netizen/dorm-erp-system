# 백업 정책

목적: 데이터 손실·운영 실수·장애에 대비해 정기 백업과 검증 체계를 유지한다.
전제: 운영 DB는 Supabase(PostgreSQL), 파일은 Supabase Storage, 코드/문서는 Git.

---

## 1. 백업 주기·보관

| 주기 | 대상 | 방법 | 보관 기간 |
|---|---|---|---|
| **일일** | Database (전체) | Supabase 자동 백업 / PITR(Point-in-Time Recovery) | 7일 이상 |
| **일일** | 권한 핵심 테이블 스냅샷 | `pg_dump`(아래) 또는 SQL Editor CSV 내보내기 | 14일 |
| **주간** | Database 전체 + Storage 목록 | 수동/스크립트 export | 4주 |
| **월간** | Database 전체 + Storage 파일 + Migration + 환경설정 | 오프사이트(별도 저장소) 보관 | 6~12개월 |
| **상시** | Migration/Rollback/문서 | Git(원격 저장소) | 영구 |

> Supabase 플랜에 따라 자동 백업/PITR 제공 범위가 다르므로 **프로젝트 설정 > Database > Backups** 에서 실제 보존일·PITR 가능 여부를 확인해 위 값을 확정한다.

## 2. 백업 대상 상세
- **Database**: 전체 스키마 + 데이터. 권한 핵심 테이블 = `profiles`, `custom_roles`, `user_custom_roles`, `custom_role_permissions`, `custom_role_scopes`, `custom_role_audit_logs`, `security_audit_logs`, 기숙사/시험 업무 테이블.
- **Storage**: `inventory-proof`, `cleaning-photos` 버킷 파일 목록/파일.
- **Migration**: `supabase/migrations/`, `supabase/rollback/` (Git 보관).
- **환경설정**: Vercel/Supabase 환경변수 목록(값 제외, 이름·용도만 문서화), Auth 설정(Site URL/redirect).
- **운영 문서**: `docs/` (Git 보관).

## 3. 권한 핵심 테이블 수동 스냅샷 예시
> service_role/DB 접속은 **서버·관리자 환경에서만**. 클라이언트/공개 위치에 키를 두지 않는다.
```bash
# 권한 관련 테이블만 별도 덤프(운영자 로컬/서버)
pg_dump "$SUPABASE_DB_URL" \
  -t public.custom_roles -t public.user_custom_roles \
  -t public.custom_role_permissions -t public.custom_role_scopes \
  -t public.custom_role_audit_logs -t public.security_audit_logs \
  --data-only --column-inserts > backup_permissions_$(date +%F).sql
```
- SQL Editor에서 각 테이블을 CSV로 내보내도 된다(소규모 조직).

## 4. 백업 검증 · 복구 테스트
- **백업 검증(주1회)**: 최신 백업이 존재하고 크기가 정상 범위인지 확인. 손상/0바이트면 알림.
- **복구 테스트(분기 1회)**: 스테이징(별도 Supabase 프로젝트)에 최근 백업을 복원 → 로그인·권한 조회 동작 확인 → 결과 기록.
- 복구 절차는 [recovery-guide.md](recovery-guide.md) 참고.

## 5. 금지·주의
- 백업 파일을 자동 삭제/덮어쓰기 금지(보관 기간 준수).
- 백업 파일에 **service_role_key·비밀번호 원문** 포함 금지.
- 개인정보 포함 백업은 접근 통제·암호화 보관.

## 체크박스
- [ ] Supabase 자동 백업/PITR 실제 보존일 확인·기록
- [ ] 권한 핵심 테이블 일일 스냅샷 자동화(스크립트/예약)
- [ ] 월간 오프사이트 보관 위치 확정
- [ ] 분기 복구 테스트 일정 지정
