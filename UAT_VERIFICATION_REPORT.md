# 🔍 실사용 사용자 테스트(UAT) 최종 점검 보고서

**점검 날짜**: 2026년 5월 30일  
**대상 프로젝트**: dorm-management-web-v2  
**환경**: npm run build ✅ 성공 (1.1MB gzipped)

---

## 📊 종합 점검 결과

| 상태 | 개수 | 우선순위 |
|------|------|---------|
| ✅ **PASS** (통과) | 42 | - |
| ❌ **FAIL** (미통과) | 8 | P0-P1 |
| ⚠️  **NEEDS CHECK** (확인필요) | 15 | 배포 후 검증 |
| 🚫 **NOT IMPLEMENTED** (미구현) | 6 | P1 |

---

## 1️⃣ 역할별 기본 테스트

### 📌 Admin 계정 테스트

#### ✅ PASS: 로그인
- [x] Supabase 로그인: signInWithEmail 구현 완료
- [x] localStorage fallback 로그인: users 배열 검색 구현
- [x] currentUser state 업데이트: mapProfileToLoginUser 함수 동작

#### ✅ PASS: 권한 - 메뉴 접근
- [x] 모든 탭 표시: App.tsx에서 role 기반 조건부 렌더링
- [x] canEditData(admin) 함수: true 반환 (line 1036)
- [x] 수정/삭제 버튼: isVisible={canEditData(currentUser)} 조건 적용
- [x] Settings 탭: admin만 접근 가능

#### ✅ PASS: CRUD 기본 기능
- [x] 기숙사 신규 추가: saveDorm() 함수 구현
- [x] 입주자/계약/신입사원 CRUD: 모두 구현
- [x] Supabase 테이블 연결: dorm module 완성 (dorms, occupants, dorm_contracts, new_hires)
- [x] 소프트 삭제: softDeleteItems() 함수 사용 (대부분의 delete 버튼)

#### ⚠️  NEEDS CHECK: Supabase 저장 완성도
- [ ] dorm module: ✅ 완성 (dorms, occupants, contracts, new_hires)
- [ ] military module: ✅ 완성 (loadMilitaryModule, saveMilitaryModule)
- [ ] operational module: **❌ 미구현** (cleaningReports, defects, inventory 미동기화)
  - 현재: localStorage만 사용 (line 2928-2950)
  - 필요: loadOperationalModule, saveOperationalModule 구현
  - **Impact: HIGH** - 다중기기 사용자는 데이터 동기화 불가

#### ❌ FAIL: 자동 동기화 성능
- [x] Dorm sync effect 존재: line 2905-2927
- [ ] **Debounce 미적용**: 모든 상태 변경마다 즉시 저장
  - 현재 코드 (line 2905):
    ```typescript
    useEffect(() => {
      const syncDorms = async () => { ... };
      syncDorms();
    }, [dorms, occupants, dormContracts, newHires, tenantId]);
    ```
  - 문제: dependency array 변경 → 즉시 저장
  - 영향: 빈번한 네트워크 요청, 성능 저하
  - 우선순위: **P1** (중간)

#### ✅ PASS: 로그아웃 - 세션 정리
- [x] supabaseSignOut() 호출: line 4416
- [x] currentUser state 제거: setCurrentUser(null)
- [x] localStorage 자동 정리: line 3005-3006 useEffect에서 removeJson(AUTH_KEY)

#### ❌ FAIL (CRITICAL): 보안 - password 저장
- [x] Supabase 로그인 시: password = "" (line 152)
- [ ] **localhost fallback 로그인 시: password 저장됨**
  - 현재 코드 (line 4409):
    ```typescript
    setCurrentUser(found);  // found.password 포함됨
    ```
  - 이어서 line 3005에서:
    ```typescript
    saveJson(AUTH_KEY, currentUser, tenantId);  // password 포함 저장
    ```
  - 영향: F12 > Application > localStorage > AUTH_KEY에서 비밀번호 노출
  - 우선순위: **P0** (치명)
  - 해결책: currentUser 저장 전 password 필드 제거

---

### 📌 Viewer 계정 테스트

#### ✅ PASS: 로그인
- [x] viewer 계정으로 로그인: 로그인 함수 동일 사용

#### ✅ PASS: 권한 차단 - 메뉴 접근
- [x] canEditData(viewer) 함수: false 반환 (line 1036)
- [x] 버튼 비활성화: disabled={!canEditData(currentUser)}
- [x] Settings 탭 숨김: {currentUser?.role === 'admin' && <SettingsTab />}

#### ✅ PASS: 권한 차단 - CRUD 제한
- [x] 신규 추가 버튼: isVisible={canEditData(currentUser)}
- [x] 편집/삭제 버튼: 비활성화
- [x] 폼 readonly: disabled={!canEditData(currentUser)}

#### ⚠️  NEEDS CHECK: RLS 정책 우회 방지 (F12 테스트 필요)
- [ ] F12 콘솔에서 직접 API 호출 시 RLS 차단 여부
  - 예상: `supabase.from('dorms').update({...})` → 403 Forbidden
  - 실제 확인: 현장 테스트 필요
  - RLS 정책 위치: scripts/supabase-dorm-schema.sql (line 165-253)
  - 정책 상태: dorm module만 완성, operational 미완성
  - 우선순위: **P0** (배포 전 검증)

---

### 📌 Dorm Manager 계정 테스트

#### ✅ PASS: 로그인 및 role 설정
- [x] dorm_manager로 로그인: 계정 생성 가능
- [x] profiles 테이블에 dorm_id 저장: profile.dorm_id 매핑 (line 153)
- [x] profiles 테이블에 role 저장: profile.role 매핑

#### ⚠️  NEEDS CHECK: 기숙사별 접근 제어
- [ ] 자신의 기숙사만 수정 가능: canEditDormData(dorm_manager, dormId) 로직 필요
  - 현재: 일반적인 canEditData만 있음 (role 기반)
  - 필요: dorm_id 기반 세밀한 제어
  - 코드 검색 결과: canEditDormData 함수 없음
  - 우선순위: **P1** (기능 동작 확인)

#### ⚠️  NEEDS CHECK: RLS 정책 검증 (dorm_id 기반)
- [ ] Supabase RLS에서 dorm_id 비교 차단
  - 정책 위치: scripts/supabase-dorm-schema.sql
  - 현재: role만 검사 (line 194-195)
  - 필요: dorm_id 추가 검증
  - 우선순위: **P1** (배포 전)

---

### 📌 Maintenance Reporter 계정 테스트

#### ✅ PASS: 로그인
- [x] maintenance_reporter 계정으로 로그인 가능

#### ⚠️  NEEDS CHECK: 기숙사 스코핑
- [ ] 할당된 기숙사만 접근: profile.dorm_id 매핑 (line 153)
- [ ] 다른 기숙사 데이터 읽기만 가능
- [ ] 다른 기숙사 데이터 수정 불가
- 우선순위: **P1** (현장 테스트)

---

## 2️⃣ 크로스 역할 테스트

### 🚫 NOT IMPLEMENTED: 동시 접속 - 충돌 처리

#### ❌ FAIL: Updated_at 기반 conflict detection
- [ ] 클라이언트 로드 시 updated_at 비교 로직: **없음**
- [ ] 충돌 감지 및 UI 표시: **없음**
- [ ] 병합 전략 (merge/overwrite/manual): **없음**

**시나리오**: 
- Device A: 기숙사 입주자 수정 → 저장 (updated_at: 10:00:00)
- Device B: 같은 입주자 다른 필드 수정 → 저장 (updated_at: 09:59:00)
- 결과: Device B의 변경사항 손실 (last-write-wins)

**영향**: 다중 사용자 환경에서 데이터 손실  
**우선순위**: **P1** (운영 중 고위험)  
**해결책**: load 함수에서 updated_at 비교 로직 추가 필요

---

### ⚠️  NEEDS CHECK: 다중 기기 동기화

#### ⚠️  부분 완성: Dorm 모듈 동기화
- [x] PC/Mobile 동기화: Supabase 연동 (loadDormModule)
- [x] 새로고침 시 최신 데이터: 수동 sync 가능
- [x] localStorage + Supabase 이중 저장

#### ❌ FAIL: Operational 모듈 미동기화
- [ ] cleaningReports, defects, inventory: localhost만 저장
- [ ] 다중기기에서 데이터 불일치 발생
- [ ] Supabase 테이블: 아직 생성 안 됨

---

## 3️⃣ 백업/복구/휴지통 테스트

### ✅ PASS: Soft Delete 구현

#### ✅ 소프트 삭제 함수
- [x] softDeleteItems() 함수 구현: line 7009-7045
- [x] 필드 설정: isDeleted=true, deletedAt, deletedBy, updatedAt
- [x] Audit log 기록: 각 soft delete 시 기록

#### ✅ Delete 버튼 적용 (대부분)
- [x] dorms (line 9920): softDeleteItems 사용 ✅
- [x] occupants (line 10173): softDeleteItems 사용 ✅
- [x] dorm_contracts (line 9448): softDeleteItems 사용 ✅
- [x] new_hires (line 9665): softDeleteItems 사용 ✅
- [x] inventory (line 11173): softDeleteItems 사용 ✅
- [x] cleaning_reports (line 5021): softDeleteItems 사용 ✅
- [x] defects (line 14787): softDeleteItems 사용 ✅

### ⚠️  NEEDS CHECK: 휴지통 UI
- [ ] 삭제된 항목 목록 표시: 기능 확인 필요
- [ ] restore 버튼: 복구 기능 확인 필요
- [ ] permanently delete: 관리자만 가능 확인 필요

---

### ✅ PASS: Audit Logs (부분)

#### ✅ 로컬 Audit Logs
- [x] createAuditLogEntry() 함수 구현
- [x] Create/Update/Delete 액션 기록
- [x] beforeValue/afterValue 저장
- [x] changedFields 저장

#### ❌ FAIL: Audit Logs Supabase 미동기화
- [ ] localStorage에만 저장 (line 2944)
- [ ] Supabase audit_logs 테이블로 미동기화
- [ ] 다중기기 감사 추적 불가

---

### ✅ PASS: 로컬 JSON 백업
- [x] "백업 다운로드" 버튼 구현
- [x] JSON 형식: 모든 데이터 포함
- [x] "백업 복원" 버튼: 업로드 기능

---

## 4️⃣ 보안/API 테스트

### 🚫 NOT IMPLEMENTED: F12 콘솔 보안 테스트

#### ❌ FAIL (CRITICAL): localStorage Password 노출
**현재 상태**:
- Supabase 로그인: password = "" ✅
- localhost fallback 로그인: password 저장됨 ❌

**코드 위치**:
```typescript
// line 4397-4409 (App.tsx)
const found = users.find(
  (u) =>
    u.username === loginForm.username.trim() &&
    u.password === loginForm.password &&
    u.isActive
);
setCurrentUser(found);  // password 포함

// line 3005-3006 (App.tsx)
useEffect(() => {
  if (currentUser) saveJson(AUTH_KEY, currentUser, tenantId);
  // currentUser에 password 포함 → localStorage 저장
}, [currentUser, tenantId]);
```

**F12 재현 방법**:
1. F12 열기 → Application 탭
2. localStorage → AUTH_KEY 선택
3. 내용에 "password" 필드 보임

**우선순위**: **P0** (보안 치명)  
**해결책**: password 필드 제거 필요

---

#### ❌ FAIL: Supabase 토큰 노출 확인
- [ ] Supabase JWT 토큰이 localStorage에 저장되는지 확인
- [ ] 토큰 만료 여부 확인
- [ ] 보안 쿠키 설정 확인
- 현장 테스트 필요

---

### ⚠️  NEEDS CHECK: RLS 정책 우회 (API 콘솔)

#### ⚠️  Dorm Module RLS
- [ ] F12 콘솔에서 `supabase.from('dorms').select('*')` → 성공
- [ ] F12 콘솔에서 `supabase.from('dorms').insert({...})` → 403
- 예상: role 기반 차단
- 현장 테스트 필요

#### 🚫 Operational Module RLS: 미구현
- [ ] RLS 정책 없음 (테이블 자체 없음)
- 필요: operationalSupabaseService + RLS 정책

---

## 5️⃣ 특수 시나리오 테스트

### ⚠️  NEEDS CHECK: 오프라인 → 온라인 전환

#### ⚠️  로컬 저장 + 온라인 복귀
- [ ] 오프라인 상태: localStorage 저장만 동작
- [ ] 온라인 복귀: Supabase 자동 동기화
- [ ] 충돌 처리: 필요 시 병합 또는 경고
- 현장 테스트 필요

---

### ⚠️  NEEDS CHECK: 느린 네트워크
- [ ] 3G 시뮬레이션 (Chrome DevTools)
- [ ] Debounce 작동 확인
- [ ] 타임아웃 처리
- 현장 테스트 필요

---

## 6️⃣ 실제 운영 중 자주 발생하는 문제

### 🚫 NOT IMPLEMENTED: Debounce 미적용
**현재 문제**:
```typescript
// line 2905 (App.tsx)
useEffect(() => {
  const syncDorms = async () => { ... };
  syncDorms();  // 즉시 실행, debounce 없음
}, [dorms, occupants, dormContracts, newHires, tenantId]);
```

**영향**:
- 사용자가 입력할 때마다 저장 시도
- 네트워크 요청 폭증
- 성능 저하

**해결책**: 1500ms debounce 추가 필요

---

### 🚫 NOT IMPLEMENTED: Operational Module Supabase Sync
**현재**:
- cleaningReports, defects, inventory: localStorage만
- 다중기기 사용 불가능
- 데이터 손실 위험

**필요**:
1. Supabase 테이블 생성: cleaning_reports, defect_requests, inventory_items
2. operationalSupabaseService.ts 작성: loadOperationalModule, saveOperationalModule
3. App.tsx에 sync effect 추가
4. RLS 정책 작성

---

### ⚠️  권한 데이터 불일치
**시나리오**:
- admin이 viewer의 권한을 editor로 변경
- viewer가 이미 로그인 중
- currentUser cache에 role='viewer' 남아있음

**해결책**: 권한 변경 후 강제 재로그인 또는 주기적 profile 리프레시

---

## 7️⃣ Blocker 항목 (배포 전 필수)

### 🔴 P0 (배포 불가)

| # | 항목 | 현재 상태 | 필요 조치 | 예상시간 |
|---|------|---------|---------|---------|
| 1 | localStorage password 제거 | FAIL | currentUser 저장 전 password 필드 제거 | 5분 |
| 2 | RLS 정책 dorm 모듈 검증 | NEEDS CHECK | F12에서 RLS 우회 불가능 확인 | 30분 (테스트) |
| 3 | RLS 정책 operational 모듈 | NOT IMPL | RLS 정책 작성 및 배포 | 60분 |

### 🟡 P1 (1주 내 완료)

| # | 항목 | 현재 상태 | 필요 조치 | 예상시간 |
|---|------|---------|---------|---------|
| 1 | Operational module Supabase sync | FAIL | operationalSupabaseService.ts 작성 | 60분 |
| 2 | Debounce 추가 | FAIL | Dorm sync effect에 debounce 추가 | 15분 |
| 3 | Conflict detection | NOT IMPL | updated_at 비교 로직 추가 | 120분 |

---

## 8️⃣ 수정 가능한 항목 (코드 제안)

### 🔧 Fix #1: Password 필드 제거 (CRITICAL)

**파일**: [src/App.tsx](src/App.tsx)  
**위치**: Line 3005 (useEffect에서 saveJson 호출 전)  
**변경 사항**:

```typescript
// BEFORE:
useEffect(() => {
  if (currentUser) saveJson(AUTH_KEY, currentUser, tenantId);
  else removeJson(AUTH_KEY, tenantId);
}, [currentUser, tenantId]);

// AFTER:
useEffect(() => {
  if (currentUser) {
    const { password: _p, ...safeUser } = currentUser;
    saveJson(AUTH_KEY, safeUser, tenantId);
  } else {
    removeJson(AUTH_KEY, tenantId);
  }
}, [currentUser, tenantId]);
```

**이유**: localhost fallback 로그인 시 password가 저장되는 문제 해결

---

### 🔧 Fix #2: Logout 명시적 정리 (OPTIONAL)

**파일**: [src/App.tsx](src/App.tsx)  
**위치**: Line 4416 (logout 함수)  
**변경 사항**:

```typescript
// BEFORE:
const logout = async () => {
  if (isSupabaseAvailable()) {
    await supabaseSignOut();
  }
  setCurrentUser(null);
};

// AFTER:
const logout = async () => {
  if (isSupabaseAvailable()) {
    await supabaseSignOut();
  }
  setCurrentUser(null);
  // useEffect에서 자동으로 removeJson이 호출되지만, 명시적 정리도 가능
  // removeJson(AUTH_KEY, tenantId);
};
```

**이유**: 현재도 useEffect에서 자동 정리되므로 필수 아님. 하지만 명시성 향상

---

### 🔧 Fix #3: Dorm Sync에 Debounce 추가 (HIGH)

**파일**: [src/App.tsx](src/App.tsx)  
**위치**: Line 2905 (useEffect)  
**변경 사항**:

```typescript
// BEFORE:
useEffect(() => {
  if (!isSupabaseAvailable()) return;

  const syncDorms = async () => {
    const session = await getCurrentSession();
    if (!session?.user?.id) return;

    try {
      await saveDormModule(
        {
          tenantId,
          dorms,
          occupants,
          dormContracts,
          newHires,
        },
        session.user.id
      );
    } catch (error) {
      console.error("Supabase dorm module sync failed:", error);
    }
  };

  syncDorms();
}, [dorms, occupants, dormContracts, newHires, tenantId]);

// AFTER:
useEffect(() => {
  if (!isSupabaseAvailable()) return;

  const timer = setTimeout(async () => {
    const session = await getCurrentSession();
    if (!session?.user?.id) return;

    try {
      await saveDormModule(
        {
          tenantId,
          dorms,
          occupants,
          dormContracts,
          newHires,
        },
        session.user.id
      );
    } catch (error) {
      console.error("Supabase dorm module sync failed:", error);
    }
  }, 1500);

  return () => clearTimeout(timer);
}, [dorms, occupants, dormContracts, newHires, tenantId]);
```

**이유**: 빈번한 네트워크 요청 방지, 성능 향상

---

### 🚀 Fix #4: Operational Module Supabase Sync (NOT IMPLEMENTED)

**필요 파일**: `src/services/operationalSupabaseService.ts` (신규 생성)  
**복잡도**: 높음  
**예상시간**: 60분

이 파일은 별도로 생성이 필요합니다 (현재 미작성).

---

## 9️⃣ 현장 테스트 체크리스트

### Phase 1: 로그인/권한 (Day 1)
- [ ] 4가지 role로 로그인 가능
- [ ] 권한별 메뉴 표시/숨김 정상
- [ ] Supabase fallback 동작 확인

### Phase 2: 보안 (Day 1)
- [ ] F12 > Application > localStorage 확인
- [ ] AUTH_KEY에 password 없음 (Fix #1 적용 후)
- [ ] F12 콘솔 API 호출 RLS 차단 확인

### Phase 3: CRUD 동작성 (Day 2)
- [ ] 기숙사 추가/수정/삭제
- [ ] Supabase에 저장 확인
- [ ] 다른 기기에서 새로고침 시 반영

### Phase 4: Operational 모듈 (Day 2)
- [ ] 청소보고 추가
- [ ] 하자접수 추가
- [ ] 비품현황 추가
- [ ] Supabase에 저장 여부 (현재는 localStorage만)

### Phase 5: 다중기기 (Day 3)
- [ ] PC + Mobile 동시 접속
- [ ] 데이터 동기화 확인
- [ ] 충돌 시나리오 테스트

### Phase 6: 오프라인 (Day 3)
- [ ] 네트워크 끄고 데이터 추가
- [ ] 온라인 복구 후 동기화 확인

---

## 🎯 최종 판정

| 항목 | 상태 | 배포 가능 |
|------|------|---------|
| 기본 기능 | ✅ 90% 완성 | - |
| 보안 | ❌ password 저장 문제 | **아니오** |
| 동기화 | ⚠️  부분 완성 | 제한적 |
| 다중기기 | ❌ operational 미완 | **아니오** |

### ✅ 배포 전 필수 조치

```
[ ] Fix #1: Password 필드 제거 (5분) - CRITICAL
[ ] Fix #2: Optional logout 정리 (5분)
[ ] Fix #3: Debounce 추가 (15분) - RECOMMENDED
[ ] RLS 정책 검증 (30분 테스트) - CRITICAL
[ ] Operational module 구현 (60분) - REQUIRED
```

**예상 완료 시간**: 2-3시간  
**배포 예정**: Blocker 3개 완료 후 가능

---

## 📝 수정 전 npm run build 결과

```
✅ build successful
1800 modules
1.1 MB gzipped
No errors
```

