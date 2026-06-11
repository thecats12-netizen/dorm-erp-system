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
};

export default function FilteredDormSelector({
  value,
  onChange,
  currentUser: currentUserParam,
  operationalDorms: domsParam,
  defaultSite = "전체",
  defaultGender = "전체",
  label = "기숙사",
}: Props) {
  const [siteFilter, setSiteFilter] = useState(defaultSite);
  const [genderFilter, setGenderFilter] = useState(defaultGender);
  const [statusFilter, setStatusFilter] = useState<"전체" | "사용중">("전체");

  useEffect(() => {
    setSiteFilter(defaultSite);
  }, [defaultSite]);

  useEffect(() => {
    setGenderFilter(defaultGender);
  }, [defaultGender]);

  // 계약상태 종료/해지(=비활성)는 드롭다운에서 제외 (활성 계약만 표시)
  const accessibleDorms = getAccessibleOperationalDorms(currentUserParam, domsParam).filter(
    (d) => d.leaseStatus !== "해지"
  );
  const filteredDorms = filterDormsBySiteGender(accessibleDorms, siteFilter, genderFilter, statusFilter);

  useEffect(() => {
    if (value && !filteredDorms.find((d) => d.id === value)) {
      onChange("", undefined);
    }
  }, [siteFilter, genderFilter, filteredDorms, value, onChange]);

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
          onChange={(v) => setStatusFilter(v as "전체" | "사용중")}
          options={["전체", "사용중"]}
        />
        <SearchableSelect
          label={label}
          value={value}
          onChange={(v) => {
            const selected = domsParam.find((d) => d.id === v);
            onChange(v, selected);
          }}
          options={["", ...filteredDorms.map((d) => d.id)]}
          displayOptions={["미배정", ...filteredDorms.map((d) => `${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)}`)]}
        />
      </div>
    </div>
  );
}
