import { stripDongHoSuffix } from "./formatUtils";

// 엑셀/수동 입력을 동일 기준으로 정규화하기 위한 공용 함수 모음.
// 매칭(키 생성)과 저장 표시값 정규화에 함께 사용한다.

// 공통 문자열 정규화: null/undefined → "", 전각공백→일반공백, trim, 연속공백 1개로 축소
export const normText = (v: unknown): string =>
  String(v ?? "").replace(/　/g, " ").trim().replace(/\s+/g, " ");

// 지역 정규화: 평택시/경기 평택/Pyeongtaek → 평택, 천안시/충남 천안/Cheonan → 천안. 그 외 원본 유지.
export const normSite = (v: unknown): string => {
  const s = normText(v);
  if (/평택|pyeongtaek/i.test(s)) return "평택";
  if (/천안|cheonan/i.test(s)) return "천안";
  return s;
};

// 성별 정규화: 남/남자/남성/M/male → 남, 여/여자/여성/F/female → 여. 불명 시 원본 유지.
export const normGender = (v: unknown): string => {
  const s = normText(v).toLowerCase();
  if (/^(남|남자|남성|m|male)$/.test(s)) return "남";
  if (/^(여|여자|여성|f|female)$/.test(s)) return "여";
  return normText(v);
};

// 동 정규화: 101/101 동/101동 → 101동, A동 → A동, 빈 값 → "". (내부 공백 제거 후 접미사 통일)
export const normDong = (v: unknown): string => {
  const s = normText(v).replace(/\s+/g, "");
  if (!s) return "";
  const stripped = stripDongHoSuffix(s);
  return stripped ? `${stripped}동` : "";
};

// 호수 정규화: 101/101 호/101호 → 101호, B101 → B101호, 빈 값 → "". (선행 0은 유지 — 오병합 방지)
export const normRoomHo = (v: unknown): string => {
  const s = normText(v).replace(/\s+/g, "");
  if (!s) return "";
  const stripped = stripDongHoSuffix(s);
  return stripped ? `${stripped}호` : "";
};

// 건물명 정규화: 앞뒤/중복 공백 정리(괄호/특수문자 유지)
export const normBuilding = (v: unknown): string => normText(v);

// 기숙사 매칭키: site/buildingName/dong/roomHo 를 정규화 후 소문자·공백제거 기준으로 비교.
// (성별은 키에 포함하지 않음 — 같은 물리적 호실의 성별은 고정이며, 한쪽 소스에 성별이 비거나
//  표기가 달라도 매칭이 깨지지 않도록 의도적으로 제외. 정규화는 normSite/normBuilding 등과 동일.)
export const makeDormMatchKey = (site: unknown, buildingName: unknown, dong: unknown, roomHo: unknown): string => {
  const s = normSite(site).toLowerCase();
  const b = normBuilding(buildingName).replace(/\s+/g, "").toLowerCase();
  const d = stripDongHoSuffix(String(dong ?? "")).replace(/\s+/g, "").toLowerCase();
  const r = stripDongHoSuffix(String(roomHo ?? "")).replace(/\s+/g, "").toLowerCase();
  return `${s}|${b}|${d}|${r}`;
};
