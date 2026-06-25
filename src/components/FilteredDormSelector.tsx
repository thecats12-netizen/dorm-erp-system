import { useEffect, useState } from "react";
import { SelectInput, SearchableSelect } from "./FormControls";
import { formatDong, formatRoomHo } from "../utils/formatUtils";
import type { OperationalDorm, LoginUser } from "../types";

// 지역/성별/상태 + 활성 계약 필터를 포함한 기숙사 선택기.
// App.tsx 내부 정의 시 매 렌더 재생성되어 react-compiler 경고 및 필터 상태 리셋이
// 발생하던 것을 모듈 컴포넌트로 분리하여 안정화. (props/동작 동일)

// 권한 범위: 담당자(maintenance_reporter/dorm_manager)는 본인 기숙사만
function getAccessibleOperationalDorms(user: LoginUser | null, dormList: OperationalDorm[]): OperationalDorm[] {
  if (!user) return [];
  if (user.role === "admin") return dormList;
  if (user.role === "viewer") return dormList;
  if (user.role === "maintenance_reporter" || user.role === "dorm_manager") {
    return dormList.filter((d) => d.managerUserId === user.id || d.id === user.dormId);
  }
  return [];
}

function filterDormsBySiteGender(
  dormList: OperationalDorm[],
  siteFilter: string,
  genderFilter: string,
  statusFilter: string
): OperationalDorm[] {
  return dormList.filter((dorm) =>
    (siteFilter === "전체" || dorm.site === siteFilter) &&
    (genderFilter === "전체" || dorm.gender === genderFilter) &&
    (statusFilter === "전체" || dorm.leaseStatus === statusFilter)
  );
}

type Props = {
  value: string;
  onChange: (dormId: string, dorm?: OperationalDorm) => void;
  currentUser: LoginUser | null;
  operationalDorms: OperationalDorm[];
  defaultSite?: string;
  defaultGender?: string;
  label?: string;
  // ── 배정 모드(신입사원 기숙사 배정 전용, 기본 off) ──
  // 실제 표시 상태(공실/사용중/만실/만료예정/종료/해지)로 필터·라벨링하고, 종료/해지(과거) 기숙사는
  // "종료/해지 포함" 선택 시에만 노출한다. 미지정 시 기존 동작 그대로(하위 호환).
  assignMode?: boolean;
  statusByDormId?: Record<string, string>; // 기숙사 id → 표시 상태
  pastDorms?: OperationalDorm[];            // 종료/해지(과거) 기숙사 목록
};

export default function FilteredDormSelector({
  value,
  onChange,
  currentUser: currentUserParam,
  operationalDorms: domsParam,
  defaultSite = "전체",
  defaultGender = "전체",
  label = "기숙사",
  assignMode = false,
  statusByDormId,
  pastDorms = [],
}: Props) {
  const [siteFilter, setSiteFilter] = useState(defaultSite);
  const [genderFilter, setGenderFilter] = useState(defaultGender);
  // 배정 모드 기본값: "전체"(활성=종료/해지 제외) → 선택 가능한 기숙사가 바로 보임.
  const [statusFilter, setStatusFilter] = useState<string>("전체");

  useEffect(() => {
    setSiteFilter(defaultSite);
  }, [defaultSite]);

  useEffect(() => {
    setGenderFilter(defaultGender);
  }, [defaultGender]);

  // 표시 상태 해석: 배정 모드에서는 statusByDormId 우선, 없으면 leaseStatus.
  const resolveStatus = (d: OperationalDorm): string => statusByDormId?.[d.id] || d.leaseStatus || "사용중";

  let filteredDorms: OperationalDorm[];
  if (assignMode) {
    // 과거(종료/해지) 기숙사는 "종료/해지 포함" 선택 시에만 풀에 추가.
    const includePast = statusFilter === "종료/해지 포함";
    const pool = [
      ...getAccessibleOperationalDorms(currentUserParam, domsParam),
      ...(includePast ? getAccessibleOperationalDorms(currentUserParam, pastDorms) : []),
    ];
    filteredDorms = pool.filter((dorm) => {
      if (siteFilter !== "전체" && dorm.site !== siteFilter) return false;
      if (genderFilter !== "전체" && dorm.gender !== genderFilter) return false;
      const s = resolveStatus(dorm);
      if (statusFilter === "전체") return s !== "종료" && s !== "해지"; // 기본: 활성만(과거 숨김)
      if (statusFilter === "종료/해지 포함") return true;               // 과거 포함 전체
      return s === statusFilter;                                          // 개별 상태
    });
  } else {
    // 기존 동작: 종료/해지 제외 + (전체/사용중) leaseStatus 필터.
    const accessibleDorms = getAccessibleOperationalDorms(currentUserParam, domsParam).filter(
      (d) => d.leaseStatus !== "해지"
    );
    filteredDorms = filterDormsBySiteGender(accessibleDorms, siteFilter, genderFilter, statusFilter);
  }

  // 선택된 dorm 을 찾을 때 과거 포함 전체 풀에서 조회(라벨/onChange 정확도).
  const allDorms = assignMode ? [...domsParam, ...pastDorms] : domsParam;

  // 배정 모드: 현재 선택된 기숙사가 필터에서 가려졌더라도 옵션에는 항상 보이게(빈칸 방지).
  if (assignMode && value && !filteredDorms.find((d) => d.id === value)) {
    const sel = allDorms.find((d) => d.id === value);
    if (sel) filteredDorms = [sel, ...filteredDorms];
  }

  useEffect(() => {
    // 배정 모드: 기존 선택(과거/종료 기숙사 포함)이 현재 필터에서 가려져도 자동 해제하지 않음
    // (수정 화면 진입 시 기존 배정이 지워지는 문제 방지). 전체 풀에 아예 없을 때만 해제.
    if (assignMode) {
      if (value && !allDorms.find((d) => d.id === value)) onChange("", undefined);
      return;
    }
    if (value && !filteredDorms.find((d) => d.id === value)) {
      onChange("", undefined);
    }
  }, [assignMode, allDorms, siteFilter, genderFilter, statusFilter, filteredDorms, value, onChange]);

  const statusOptions = assignMode
    ? ["전체", "공실", "사용중", "만실", "만료예정", "종료/해지 포함"]
    : ["전체", "사용중"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SelectInput
          label="지역"
          value={siteFilter}
          onChange={(v) => setSiteFilter(v)}
          options={["전체", "평택", "천안"]}
        />
        <SelectInput
          label="성별"
          value={genderFilter}
          onChange={(v) => setGenderFilter(v)}
          options={["전체", "남", "여"]}
        />
        <SelectInput
          label="상태"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={statusOptions}
        />
        <SearchableSelect
          label={label}
          value={value}
          onChange={(v) => {
            const selected = allDorms.find((d) => d.id === v);
            onChange(v, selected);
          }}
          options={["", ...filteredDorms.map((d) => d.id)]}
          displayOptions={[
            "미배정",
            ...filteredDorms.map((d) =>
              assignMode
                ? `${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)} [${resolveStatus(d)}]`
                : `${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)}`
            ),
          ]}
        />
      </div>
    </div>
  );
}
