# App.tsx 대시보드 구조 분석 보고서

## 1. 대시보드 렌더링 시작 위치
**시작 라인: 1879**
```jsx
{activeTab === "dashboard" && (
  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
```

---

## 2. 대시보드 콘텐츠 구조

### 2.1 레이아웃 구성
- **레이아웃**: 2열 레이아웃 (반응형)
  - 작은 화면: 1열 (전체 너비)
  - 큰 화면(xl): 좌측 1.25fr(62.5%) + 우측 0.75fr(37.5%)
  - 간격: 6단위

### 2.2 왼쪽 영역 콘텐츠 (라인 1879-1933)
**섹션명**: "만료일 근접 기숙사 TOP 10"

#### 구성 요소:
1. **헤더 영역** (라인 1879-1900)
   - 제목: "만료일 근접 기숙사 TOP 10"
   - 부제: "주소 기준으로 빠르게 확인"
   - 필터링 컴포넌트:
     - FilterSelect (지역 필터)
     - Search input (텍스트 검색)
     - 선택 삭제 버튼 (admin 권한)

2. **테이블** (라인 1901-1933)
   - **열(Column)**: 7개
     - 체크박스
     - 순번 (1-based index)
     - 지역 (Site)
     - 건물명 (buildingName)
     - 주소 (address + dong + roomHo)
     - 만료일 (contractEnd)
     - D-Day (daysDiff 계산)
   
   - **데이터 소스**: `visibleDashboard`
   - **기능**:
     - 행 클릭 시 건물 편집 모드로 이동
     - 체크박스로 일괄 선택
     - 선택된 항목 일괄 삭제 가능

### 2.3 오른쪽 영역 구조 (라인 1935-1961)
**섹션명**: "신입사원 입주배정"

#### 구성:
1. **카드 형식 레이아웃**
   - 타입: 세로 스택 레이아웃 (space-y-3)

2. **카드 콘텐츠** (각 카드마다):
   ```
   ┌─────────────────────────────────┐
   │ 이름  [상태 배지]               │
   │ 부서명                          │
   │                                 │
   │ 위치: 평택 · 건물명 · 동 호    │
   └─────────────────────────────────┘
   ```
   - 필드들:
     - employeeName (직원 이름)
     - department (부서)
     - status (상태 배지 - 색상 코딩됨)
     - dorm 정보 (위치, 건물명, 동호)

3. **빈 상태**:
   - 데이터가 없을 때: "현재 신입사원 배정 데이터가 없습니다." 메시지

---

## 3. 데이터 타입 정의

### 3.1 주요 타입들
```typescript
// 기본 타입
type Gender = "남" | "여" | "기타";
type UserRole = "admin" | "viewer" | "dorm_manager" | "maintenance_reporter";
type Site = "평택" | "천안";
type TabKey = "dashboard" | "dorms" | "occupants" | "simulation" | "inventory" | "leases" | "sales" | "defects" | "users";
```

### 3.2 주요 데이터 모델

#### LoginUser
```typescript
{
  id: string;
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
  isActive: boolean;
  siteAccess: Site | "전체";
  dormId?: string;
  createdAt: string;
}
```

#### Dorm (기숙사)
```typescript
{
  id: string;
  site: Site;
  gender: "남" | "여";
  buildingName: string;
  address: string;
  dong: string;
  roomHo: string;
  pyeong: string;
  capacity: number;
  managerUserId?: string;
  contractStart: string;
  contractEnd: string;
  contractAmount: string;
  leaseStatus: "사용중" | "만료예정" | "해지" | "공실";
  prepaymentDeposit: number;
  realEstateName: string;
  balanceDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
```

#### Occupant (입주자)
```typescript
{
  id: string;
  dormId: string;
  site: Site;
  employeeName: string;
  gender: Gender;
  department: string;
  phone: string;
  moveInDate: string;
  moveOutDueDate: string;
  status: "거주중" | "만료예정" | "퇴실" | "천안이동" | "신규입주";
  isNewHireAssignment: boolean;
  notes: string;
  expectedMoveInDate?: string;
  expectedMoveOutDate?: string;
  actualMoveOutDate?: string;
  createdAt: string;
  updatedAt: string;
}
```

#### InventoryItem (비품)
```typescript
{
  id: string;
  dormId: string;
  managerName: string;
  contractStart: string;
  contractEnd: string;
  dormAddress: string;
  itemName: string;
  quantity: number;
  modelName: string;
  maker: string;
  purchaseAmount: number;
  issuedDate: string;
  soldDate: string;
  notes: string;
  createdAt: string;
}
```

#### LeaseContract (임차계약)
```typescript
{
  id: string;
  dateKey: string;
  addressName: string;
  dong: string;
  ho: string;
  pyeong: string;
  contractAmount: string;
  contractPeriod: string;
  contractDate: string;
  prepaymentDeposit: number;
  realEstateName: string;
  notes: string;
  balanceDate: string;
  site: Site;
  gender: "남" | "여";
}
```

#### SaleRecord (비품매각)
```typescript
{
  id: string;
  saleDate: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  buyerCompany: string;
  notes: string;
}
```

#### DefectRequest (하자접수)
```typescript
{
  id: string;
  receiptDate: string;
  inspectorName: string;
  dormManagerName: string;
  buildingName: string;
  dong: string;
  ho: string;
  공동현관: string;
  세대현관: string;
  roadAddress: string;
  detailAddress: string;
  defectStatus: "접수" | "진행중" | "완료";
  requestText: string;
  completeText: string;
  reporterUserId: string;
  reporterName: string;
  requestPhotoDataUrls: string[];
  completionPhotoDataUrls: string[];
  createdAt: string;
  completedAt?: string;
}
```

#### ThemeSettings
```typescript
{
  accentColor: string;
  brandColor: string;
  darkMode: boolean;
  statuses: string[];
  colorMap: Record<string, string>;
}
```

---

## 4. 대시보드에 사용되는 주요 계산 로직

### 4.1 visibleDashboard 데이터 생성 (useMemo)
```
expiringDormsTop10 
  → dorms 필터링 (contractEnd 있고 D-day >= 0)
  → 계약 만료일 기준 정렬 (빠를수록 먼저)
  → 상위 10개만 추출
  → dashboardSearch, dashboardSiteFilter로 재필터링
```

### 4.2 신입사원 목록 추출
```
occupants 필터링
  → isNewHireAssignment === true인 항목만 추출
  → 각 입주자에 해당하는 dorm 정보 조인
```

### 4.3 주요 유틸 함수
- `daysDiff(dateText)`: 특정 날짜까지 남은 일수 계산
- `badgeColor(theme, value)`: 상태별 배경색 반환
- `openDormEdit(d)`: 기숙사 편집 모드 열기

---

## 5. 권한 제어

대시보드 표시 규칙:
- **admin**: 전체 표시
- **viewer**: 필터링된 기숙사만 표시
- **dorm_manager**: 특정 지역만 표시
- **maintenance_reporter**: 하자접수 탭으로 리다이렉트 (대시보드 미표시)

---

## 6. 상태 관리 (State)

대시보드 관련 주요 State:
```typescript
const [dashboardSearch, setDashboardSearch] = useState<string>("");
const [dashboardSiteFilter, setDashboardSiteFilter] = useState<Site | "전체">("전체");
const [selectedDashboardIds, setSelectedDashboardIds] = useState<string[]>([]);
```

---

## 7. localStorage 저장소 키

```typescript
const DORMS_KEY = "dorm-master-v4";
const THEME_KEY = "dorm-theme-v4";
const OCCUPANTS_KEY = "dorm-occupants-v4";
```

---

## 요약

| 항목 | 내용 |
|------|------|
| **렌더링 시작** | 1879줄 |
| **레이아웃** | 2열 (좌1.25fr, 우0.75fr) |
| **왼쪽 콘텐츠** | 만료일 근접 기숙사 TOP10 테이블 |
| **오른쪽 콘텐츠** | 신입사원 입주배정 카드 목록 |
| **데이터 타입** | 8가지 (User, Dorm, Occupant, Inventory, Lease, Sale, Defect, Theme) |
| **주요 계산** | daysDiff, occupancyCountByDorm, expiringDormsTop10 |
| **권한 제어** | admin/viewer/dorm_manager/maintenance_reporter |
