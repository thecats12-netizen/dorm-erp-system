# 운영 알림 정책

목적: 위험 이벤트 발생 시 담당자가 신속히 인지·대응하도록 알림 기준을 정한다.
구현 원칙: **앱 코드를 새로 만들지 않는다.** 아래는 Supabase/Vercel 기본 기능 + 정기 조회로 구성한다.

---

## 알림 대상 이벤트 · 기준 · 채널

| 이벤트 | 감지 방법 | 임계/기준 | 심각도 | 채널 |
|---|---|---|---|---|
| 관리자 권한 생성 | 감사로그(profiles.role='admin' 변경) / health_check §1 증가 | admin 수 증가 | High | 관리자·보안 |
| 관리자 권한 삭제/강등 | 감사로그, health_check §1 감소 | admin 수 감소(특히 1명 근접) | High | 관리자·보안 |
| 대량 권한 변경 | custom_role_audit_logs 급증 | 단시간 N건↑ | Medium | 관리자 |
| 로그인 실패 반복 | Supabase Auth Logs | 동일 계정/IP 반복 | Medium | 보안 |
| 비정상 다운로드 | 네트워크/서버 로그 | 단시간 대량 | High | 보안·개인정보 |
| 권한 없는 접근 반복 | 서버 42501/PGRST 거부 급증 | 동일 사용자 반복 | Medium | 보안 |
| Storage 용량 초과 | Supabase Storage 사용량 | 임계% 초과 | Medium | 운영 |
| Backup 실패 | 백업 스크립트/Supabase 알림 | 실패 이벤트 | High | 운영·개발 |
| Migration 실패 | 적용 로그 | 오류 | High | 개발·관리자 |

## 구현 방법(신규 기능 없이)
1. **Supabase**: Project > Reports/Logs, Database Webhooks(선택), Log Drains(선택). Auth Rate Limit로 로그인 실패 완화.
2. **Vercel**: Deployments 알림(Slack/이메일 연동), Analytics로 5xx·트래픽 급증 확인.
3. **정기 조회 알림**: health_check SQL을 예약 실행(예: Supabase Scheduled Function/외부 크론)하고, **0행 위반·임계 초과 시 담당자에게 메일/메신저 통지**.
   - ⚠️ 예약 함수를 도입할 경우 **읽기 전용**으로만 구성하고 service_role 키는 서버 환경에서만 사용.

## 알림 후 대응
- High/Critical: [사고 대응 매뉴얼](../permissions/permission-incident-response.md) 즉시 착수.
- Backup/Migration 실패: 원인 확인 전 재시도 폭주 금지, [복구 가이드](recovery-guide.md).

## 에스컬레이션
```
1차: 시스템 관리자(admin)
2차: 보안·감사 담당
3차: 개인정보 책임자 / 경영진 (개인정보·대량유출 관련)
```

## 확정 필요(운영자)
- [ ] 알림 채널(Slack/이메일/메신저) 지정
- [ ] 임계값(로그인 실패 횟수, Storage %, 대량 변경 건수) 확정
- [ ] health_check 예약 실행 여부·주기 결정
- [ ] 에스컬레이션 담당자 지정
