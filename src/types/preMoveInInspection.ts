// 입주전 점검(운영관리) 도메인 타입 — 기숙사 계약 후 신입사원 입주 전 방 상태 점검/증빙.
// 기존 CleaningReport/DefectRequest 패턴을 따르며, 사진은 base64 dataUrl 로 저장(기존 사진 저장 방식과 동일).

export type InspectionPhoto = {
  category: string; // 현관 / 방 전체 / 침대 ... (INSPECTION_PHOTO_CATEGORIES)
  description: string; // 사진 설명(선택)
  dataUrl: string; // 압축된 base64 이미지
};

export type PreMoveInInspection = {
  id: string;
  inspectionDate: string; // 점검일 (YYYY-MM-DD)
  site: string; // 지역
  gender: string; // 성별
  dormId: string; // 기숙사 id (nullable — 배정 전에도 등록 가능)
  contractId: string; // 계약 id
  occupantId: string; // 입주예정자 id (newHire 또는 occupant)
  buildingName: string; // 건물명
  dong: string; // 동
  roomHo: string; // 호수
  address: string; // 주소
  contractStartDate: string; // 계약시작일
  contractEndDate: string; // 계약종료일
  landlordName: string; // 임대인(참고 표시용)
  expectedMoveInName: string; // 입주예정자 이름
  expectedMoveInPhone: string; // 입주예정자 연락처
  expectedMoveInDept: string; // 입주예정자 부서
  expectedMoveInDate: string; // 입주예정일
  inspectorName: string; // 담당자
  inspectionStatus: string; // 점검상태 (INSPECTION_STATUS_OPTIONS)
  cleaningStatus: string; // 청소상태 (CLEANING_STATUS_OPTIONS)
  facilityStatus: string; // 시설상태 (FACILITY_STATUS_OPTIONS)
  supplyStatus: string; // 비품상태 (SUPPLY_STATUS_OPTIONS)
  hasDefect: string; // 하자여부 (DEFECT_YN_OPTIONS)
  defectDescription: string; // 하자내용
  actionRequired: string; // 조치필요사항
  memo: string; // 비고
  photos: InspectionPhoto[]; // 사진(분류/설명 포함)
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export const INSPECTION_STATUS_OPTIONS = ["점검대기", "점검중", "조치필요", "조치완료", "입주가능", "입주보류"] as const;
export const CLEANING_STATUS_OPTIONS = ["양호", "미흡", "재청소필요"] as const;
export const FACILITY_STATUS_OPTIONS = ["양호", "하자있음", "수리필요"] as const;
export const SUPPLY_STATUS_OPTIONS = ["양호", "부족", "파손"] as const;
export const DEFECT_YN_OPTIONS = ["없음", "있음"] as const;
export const INSPECTION_PHOTO_CATEGORIES = [
  "현관",
  "방 전체",
  "침대",
  "책상",
  "의자",
  "옷장",
  "화장실",
  "주방/공용공간",
  "벽/바닥",
  "에어컨/난방",
  "기타",
] as const;

// 신규 점검 폼 기본값 생성(등록 모달 초기화용).
export function emptyPreMoveInInspection(): Omit<PreMoveInInspection, "id" | "createdAt" | "updatedAt"> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    inspectionDate: today,
    site: "",
    gender: "",
    dormId: "",
    contractId: "",
    occupantId: "",
    buildingName: "",
    dong: "",
    roomHo: "",
    address: "",
    contractStartDate: "",
    contractEndDate: "",
    landlordName: "",
    expectedMoveInName: "",
    expectedMoveInPhone: "",
    expectedMoveInDept: "",
    expectedMoveInDate: "",
    inspectorName: "",
    inspectionStatus: "점검대기",
    cleaningStatus: "양호",
    facilityStatus: "양호",
    supplyStatus: "양호",
    hasDefect: "없음",
    defectDescription: "",
    actionRequired: "",
    memo: "",
    photos: [],
    isDeleted: false,
  };
}
