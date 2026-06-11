// Excel 업로드 사전 검증 서비스
// 업로드 전 행 단위로 필수값/형식/중복/논리 오류를 검사하여 미리보기/리포트에 사용

export type ExcelIssueLevel = "error" | "warning";
export type ExcelIssue = {
  row: number; // 엑셀 행 번호 (헤더=1, 데이터 첫 행=2)
  column: string;
  value: string;
  message: string;
  level: ExcelIssueLevel;
};
export type ExcelValidationResult = {
  summary: { total: number; valid: number; error: number; warning: number };
  issues: ExcelIssue[];
};
export type ExcelTableType =
  | "dorm" | "dormContract" | "newHire" | "inventory"
  | "militaryPersonnel" | "militaryTraining";

export type ExcelValidationContext = {
  dorms?: Array<{ buildingName?: string; dong?: string; roomHo?: string; isDeleted?: boolean }>;
  dormContracts?: Array<{ address?: string; dong?: string; roomHo?: string; isDeleted?: boolean }>;
  newHires?: Array<{ name?: string; phone?: string; isDeleted?: boolean }>;
  inventory?: Array<{ itemName?: string; buildingName?: string; installationLocation?: string; isDeleted?: boolean }>;
  militaryPersonnel?: Array<{ name?: string; phone?: string }>;
  codeValues?: Record<string, string[]>; // 카테고리별 허용 코드값
};

type Row = Record<string, unknown>;

const get = (row: Row, ...keys: string[]): string => {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  return "";
};

// YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD / Excel 일련번호(숫자) 허용
const isValidDate = (s: string): boolean => {
  if (!s) return false;
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(s)) {
    const d = new Date(s.replace(/[./]/g, "-"));
    return !Number.isNaN(d.getTime());
  }
  if (/^\d{8}$/.test(s)) {
    const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    return !Number.isNaN(d.getTime());
  }
  if (/^\d{4,6}$/.test(s)) return true; // 엑셀 일련번호로 간주
  return false;
};
const toComparableDate = (s: string): number | null => {
  if (!s) return null;
  let iso = "";
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(s)) iso = s.replace(/[./]/g, "-");
  else if (/^\d{8}$/.test(s)) iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  else return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};
const isNumberLike = (s: string): boolean => s === "" || /^-?\d+(,\d{3})*(\.\d+)?$/.test(s) || /^-?\d+(\.\d+)?$/.test(s);
const isPhoneLike = (s: string): boolean => {
  const digits = s.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 11 && /^[0-9\-+()\s]+$/.test(s);
};

const DORM_GENDERS = ["남", "여"];
const NEWHIRE_RESIDENCE = ["대기중", "거주중", "만료예정", "연장", "퇴실", "신규입주"];
const NEWHIRE_MOVEIN = ["대기자", "신규", "재입주", "연장"];
const CONTRACT_STATUS = ["공실", "진행중", "만료예정", "연장", "종료", "해지", "신규", "재계약", "해지후신규"];
const MILITARY_CATEGORY = ["예비군", "민방위", "대상아님"];

export function validateExcel(
  tableType: ExcelTableType,
  rows: Row[],
  ctx: ExcelValidationContext = {}
): ExcelValidationResult {
  const issues: ExcelIssue[] = [];
  const rowsWithError = new Set<number>();
  const rowsWithWarning = new Set<number>();
  const seen = new Map<string, number>(); // 파일 내 중복 키 → 최초 행

  const add = (rowIdx: number, column: string, value: string, message: string, level: ExcelIssueLevel) => {
    issues.push({ row: rowIdx, column, value, message, level });
    if (level === "error") rowsWithError.add(rowIdx);
    else rowsWithWarning.add(rowIdx);
  };

  rows.forEach((row, i) => {
    const rowIdx = i + 2; // 헤더 제외 + 1-base

    const checkDate = (col: string, v: string, opt: ExcelIssueLevel = "error") => {
      if (v && !isValidDate(v)) add(rowIdx, col, v, "날짜 형식 오류 (예: 2026-01-31)", opt);
    };
    const checkNumber = (col: string, v: string) => {
      if (v && !isNumberLike(v)) add(rowIdx, col, v, "숫자 형식 오류", "error");
    };
    const checkPhone = (col: string, v: string) => {
      if (v && !isPhoneLike(v)) add(rowIdx, col, v, "연락처 형식 오류 (숫자 9~11자리)", "warning");
    };
    const checkCode = (col: string, v: string, allowed: string[]) => {
      if (v && !allowed.includes(v)) add(rowIdx, col, v, `알 수 없는 코드값 (허용: ${allowed.join("/")})`, "warning");
    };
    const dupKey = (col: string, key: string, label: string, existing: boolean) => {
      const k = `${col}::${key}`;
      if (seen.has(k)) {
        add(rowIdx, col, key, `파일 내 중복 (행 ${seen.get(k)}와 동일: ${label})`, "warning");
      } else {
        seen.set(k, rowIdx);
        if (existing) add(rowIdx, col, key, `기존 데이터와 중복 (${label})`, "warning");
      }
    };

    if (tableType === "dorm") {
      const building = get(row, "건물명", "buildingName");
      const address = get(row, "주소", "도로명주소", "address");
      const dong = get(row, "동", "dong");
      const ho = get(row, "호수", "호", "roomHo");
      if (!building) add(rowIdx, "건물명", "", "필수값 누락", "error");
      if (!address) add(rowIdx, "주소", "", "필수값 누락", "error");
      checkDate("계약시작", get(row, "계약시작", "계약일", "contractStart"), "warning");
      checkDate("계약종료", get(row, "계약종료", "만료일", "contractEnd"), "warning");
      checkNumber("선납계약금", get(row, "선납계약금", "prepaymentDeposit"));
      checkCode("성별", get(row, "성별", "gender"), DORM_GENDERS);
      const s = toComparableDate(get(row, "계약시작", "contractStart"));
      const e = toComparableDate(get(row, "계약종료", "contractEnd"));
      if (s !== null && e !== null && s > e) add(rowIdx, "계약종료", get(row, "계약종료", "contractEnd"), "계약 시작일이 종료일보다 늦습니다", "error");
      if (building || dong || ho) {
        const exists = (ctx.dorms || []).some((d) => !d.isDeleted && d.buildingName === building && d.dong === dong && d.roomHo === ho);
        dupKey("건물명+동+호수", `${building}|${dong}|${ho}`, "건물명+동+호수", exists);
      }
    } else if (tableType === "dormContract") {
      const building = get(row, "건물명", "buildingName");
      const address = get(row, "도로명주소", "주소", "address");
      const dong = get(row, "동", "dong");
      const ho = get(row, "호수", "호", "roomHo");
      const start = get(row, "계약시작일", "계약시작", "contractStart");
      const end = get(row, "계약종료일", "계약종료", "contractEnd");
      if (!building) add(rowIdx, "건물명", "", "필수값 누락", "error");
      if (!address) add(rowIdx, "도로명주소", "", "필수값 누락", "error");
      if (!start) add(rowIdx, "계약시작일", "", "필수값 누락", "error");
      if (!end) add(rowIdx, "계약종료일", "", "필수값 누락", "error");
      checkDate("계약시작일", start);
      checkDate("계약종료일", end);
      const s = toComparableDate(start);
      const e = toComparableDate(end);
      if (s !== null && e !== null && s > e) add(rowIdx, "계약종료일", end, "계약 시작일이 종료일보다 늦습니다", "error");
      checkPhone("임대인연락처", get(row, "임대인연락처", "landlordPhone"));
      checkPhone("부동산연락처", get(row, "부동산연락처", "realEstatePhone"));
      checkCode("계약상태", get(row, "계약상태", "status", "contractStatus"), CONTRACT_STATUS);
      checkCode("성별", get(row, "성별", "gender"), DORM_GENDERS);
      const exists = (ctx.dormContracts || []).some((c) => !c.isDeleted && c.address === address && c.dong === dong && c.roomHo === ho);
      dupKey("주소+동+호수", `${address}|${dong}|${ho}`, "계약 주소+동+호수", exists);
    } else if (tableType === "newHire") {
      const name = get(row, "이름", "name");
      const phone = get(row, "연락처", "phone");
      if (!name) add(rowIdx, "이름", "", "필수값 누락", "error");
      if (!phone) add(rowIdx, "연락처", "", "필수값 누락", "error");
      checkPhone("연락처", phone);
      const moveIn = get(row, "입실일", "moveInDate");
      const moveOut = get(row, "퇴실일", "moveOutDate");
      ["예상입실일", "입실일", "예상퇴실일", "퇴실일", "실제퇴실일", "천안이동일"].forEach((c) => checkDate(c, get(row, c)));
      const mi = toComparableDate(moveIn);
      const mo = toComparableDate(moveOut);
      if (mi !== null && mo !== null && mo < mi) add(rowIdx, "퇴실일", moveOut, "퇴실일이 입실일보다 빠릅니다", "error");
      checkCode("성별", get(row, "성별", "gender"), DORM_GENDERS);
      checkCode("거주상태", get(row, "거주상태", "status"), NEWHIRE_RESIDENCE);
      checkCode("입주유형", get(row, "입주유형", "moveInType"), NEWHIRE_MOVEIN);
      if (name || phone) {
        const exists = (ctx.newHires || []).some((h) => !h.isDeleted && h.name === name && h.phone === phone);
        dupKey("이름+연락처", `${name}|${phone}`, "이름+연락처", exists);
      }
    } else if (tableType === "inventory") {
      const item = get(row, "비품명", "itemName");
      const building = get(row, "건물명", "기숙사", "buildingName");
      const loc = get(row, "설치위치", "installationLocation");
      if (!item) add(rowIdx, "비품명", "", "필수값 누락", "error");
      checkNumber("수량", get(row, "수량", "quantity"));
      checkNumber("구매액", get(row, "구매액", "구매금액", "purchaseAmount"));
      checkDate("구매일", get(row, "구매일", "purchaseDate"), "warning");
      checkDate("지급일", get(row, "지급일", "issuedDate"), "warning");
      if (item) {
        const exists = (ctx.inventory || []).some((iv) => !iv.isDeleted && iv.itemName === item && iv.buildingName === building && iv.installationLocation === loc);
        dupKey("비품명+기숙사+설치위치", `${item}|${building}|${loc}`, "비품명+기숙사+설치위치", exists);
      }
    } else if (tableType === "militaryPersonnel") {
      const name = get(row, "이름", "name");
      const phone = get(row, "연락처", "phone");
      if (!name) add(rowIdx, "이름", "", "필수값 누락", "error");
      checkPhone("연락처", phone);
      ["생년월일", "입대일", "전역일"].forEach((c) => checkDate(c, get(row, c, c === "생년월일" ? "birthDate" : c === "입대일" ? "enlistmentDate" : "dischargeDate"), "warning"));
      checkCode("수동현재구분", get(row, "수동현재구분", "현재구분", "manualCategory"), MILITARY_CATEGORY);
      const yr = get(row, "수동연차", "연차", "manualYear");
      if (yr) {
        if (!isNumberLike(yr)) add(rowIdx, "연차", yr, "숫자 형식 오류", "error");
        else {
          const n = Number(yr);
          if (n < 1 || n > 40) add(rowIdx, "연차", yr, "연차 이상값 (1~40 범위 권장)", "warning");
        }
      }
      const depts = ctx.codeValues?.departments;
      const unit = get(row, "부대", "부서", "unit");
      if (depts && unit && !depts.includes(unit)) add(rowIdx, "부서", unit, "알 수 없는 부서 코드값", "warning");
      if (name || phone) {
        const exists = (ctx.militaryPersonnel || []).some((p) => p.name === name && p.phone === phone);
        dupKey("이름+연락처", `${name}|${phone}`, "이름+연락처", exists);
      }
    } else if (tableType === "militaryTraining") {
      const target = get(row, "대상자", "personnelName");
      const subject = get(row, "훈련명", "subject");
      const type = get(row, "훈련유형", "trainingType");
      if (!target) add(rowIdx, "대상자", "", "필수값 누락", "error");
      if (!subject && !type) add(rowIdx, "훈련명", "", "훈련명 또는 훈련유형 필수", "error");
      checkDate("훈련예정일", get(row, "훈련예정일", "훈련일", "trainingDate"), "warning");
      checkDate("이수일", get(row, "이수일", "completionDate"), "warning");
      checkNumber("이수시간", get(row, "이수시간", "trainingHours"));
      const tType = ctx.codeValues?.trainingType;
      if (tType && type && !tType.includes(type)) add(rowIdx, "훈련유형", type, "알 수 없는 훈련유형 코드값", "warning");
    }
  });

  const total = rows.length;
  const error = rowsWithError.size;
  const warning = Array.from(rowsWithWarning).filter((r) => !rowsWithError.has(r)).length;
  return {
    summary: { total, valid: total - error - warning, error, warning },
    issues,
  };
}
