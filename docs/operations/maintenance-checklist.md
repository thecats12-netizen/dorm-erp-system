# 유지보수 체크리스트 (월간 / 분기 / 반기 / 연간)

각 주기 실행 후 날짜·담당자·결과를 기록한다. 자동 점검 SQL: [operations_health_check.sql](../../supabase/diagnostics/operations_health_check.sql) (읽기 전용).

---

## 월간
- [ ] 자동 점검 SQL 실행 후 이상 항목 검토(관리자 수·비활성·삭제 Role 연결·중복·restrictive 오류·보호계정 위반·다운로드 과다)
- [ ] 퇴사자 계정 비활성화 확인
- [ ] 장기 미접속(60일+) 계정 확인
- [ ] 임시 권한 만료분 회수
- [ ] 비활성/삭제 Custom Role 정리
- [ ] 백업 존재·크기 정상 확인
- [ ] 감사로그 증가량·이상 접근 확인
- [ ] 하자접수 담당자 정책 유지 확인
> 상세: [권한 월간 점검표](../permissions/monthly-access-review-checklist.md)

## 분기
- [ ] 관리자(admin) 인원 최소화 재확인
- [ ] 역할별 권한 기준 재검토
- [ ] 사용하지 않는 Custom Role 정리
- [ ] RLS/RPC/Storage 권한 검토(개발팀 협조)
- [ ] service_role_key 클라이언트 미노출 재확인
- [ ] **복구 테스트**(스테이징 복원 → 로그인·권한 확인)
- [ ] 백업 보관 상태·rollback 최신성 확인
> 상세: [분기 보안 점검표](../permissions/quarterly-security-review-checklist.md), [security-review.md](security-review.md)

## 반기
- [ ] 전체 사용자 권한 재검토(최소 권한 원칙 대조)
- [ ] 데이터 범위 정책 재검토(과다 전체범위 정리)
- [ ] 다운로드 권한 보유자 전수 점검
- [ ] Migration/rollback/문서 일치 여부 점검
- [ ] 의존 라이브러리 보안 업데이트 검토(파괴적 변경 주의)
- [ ] 오프사이트 백업 복원 리허설

## 연간
- [ ] 권한 운영 정책서 개정 검토
- [ ] 관리자 교육 재실시([교육자료](../permissions/admin-training-guide.md))
- [ ] 전체 보안 점검(외부 점검 검토)
- [ ] 재해 복구(DR) 시나리오 훈련
- [ ] 개인정보 보존 기간 도래 데이터 정리(정책 준수)
- [ ] Supabase/Vercel 플랜·용량·비용 검토

---

## 기록 양식
| 항목 | 주기 | 실행일 | 담당 | 결과 | 후속 |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
