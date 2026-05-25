import * as XLSX from "xlsx";
import type { TableType } from "../types";
import { HEADER_ALIASES } from "../constants/excelHeaders";
import { normalizeHeaderName } from "../utils/excelUtils";

export const buildDefaultExportRow = (row: Record<string, unknown>, type: TableType): Record<string, unknown> => {
  switch (type) {
    case "dorm":
      return {
        지역: row["지역"],
        성별: row["성별"],
        기숙사: row["건물명"],
        주소: row["주소"],
        동: row["동"],
        호수: row["호수"],
        평수: row["평수"],
        계약시작: row["계약시작"],
        계약종료: row["계약종료"],
        계약금액: row["계약금액"],
        상태: row["상태"],
        선납계약금: row["선납계약금"],
        부동산명: row["부동산명"],
        잔금일: row["잔금일"],
        비고: row["비고"],
      };
    case "occupant":
      return {
        지역: row["지역"],
        기숙사: row["기숙사"],
        이름: row["이름"],
        성별: row["성별"],
        부서: row["부서"],
        연락처: row["연락처"],
        입실일: row["입실일"],
        퇴실일: row["퇴실일"],
        예상입실일: row["예상입실일"],
        예상퇴실일: row["예상퇴실일"],
        실제퇴실일: row["실제퇴실일"],
        상태: row["상태"],
        비고: row["비고"],
      };
    case "dormContract":
      return {
        지역: row["지역"],
        도로명주소: row["도로명주소"],
        건물명: row["건물명"],
        동: row["동"],
        호수: row["호수"],
        평수: row["평수"],
        임대인명: row["임대인명"],
        임대인연락처: row["임대인연락처"],
        부동산명: row["부동산명"],
        부동산연락처: row["부동산연락처"],
        계약시작일: row["계약시작일"],
        계약종료일: row["계약종료일"],
        계약상태: row["계약상태"],
        계약금액: row["계약금액"],
        공동현관: row["공동현관"],
        세대현관: row["세대현관"],
        선납금: row["선납금"],
        보증금: row["보증금"],
        "월세/관리비": row["월세/관리비"],
        계약유형: row["계약유형"],
        성별: row["성별"],
        비고: row["비고"],
        등록자: row["등록자"],
        수정자: row["수정자"],
      };
    case "newHire":
      return {
        지역: row["지역"],
        성별: row["성별"],
        이름: row["이름"],
        연락처: row["연락처"],
        부서: row["부서"],
        도로명주소: row["도로명주소"],
        건물명: row["건물명"],
        동: row["동"],
        호수: row["호수"],
        예상입실일: row["예상입실일"],
        입실일: row["입실일"],
        예상퇴실일: row["예상퇴실일"],
        퇴실일: row["퇴실일"],
        실제퇴실일: row["실제퇴실일"],
        천안이동일: row["천안이동일"],
        거주상태: row["거주상태"],
        입주유형: row["입주유형"],
        연장사유: row["연장사유"],
        "특이사항 메모": row["특이사항 메모"],
      };
    case "inventory":
      return {
        관리자명: row["관리자명"],
        계약일: row["계약일"],
        만료일: row["만료일"],
        기숙사주소: row["기숙사주소"],
        비품명: row["비품명"],
        수량: row["수량"],
        모델명: row["모델명"],
        메이커: row["메이커"],
        구매액: row["구매액"],
        지급일: row["지급일"],
        매각일: row["매각일"],
        비고: row["비고"],
      };
    case "sale":
      return {
        판매날짜: row["판매날짜"],
        아이템: row["아이템"],
        단가: row["단가"],
        수량: row["수량"],
        총금액: row["총금액"],
        구매사: row["구매사"],
        비고: row["비고"],
      };
    case "cleaningReport":
      return {
        reportDate: row["reportDate"],
        site: row["site"],
        buildingName: row["buildingName"],
        address: row["address"],
        dong: row["dong"],
        roomHo: row["roomHo"],
        공동현관: row["공동현관"],
        세대현관: row["세대현관"],
        managerName: row["managerName"],
        cleanerName: row["cleanerName"],
        weekLabel: row["weekLabel"],
        monthLabel: row["monthLabel"],
        cleanStatus: row["cleanStatus"],
        checkResult: row["checkResult"],
        score: row["score"],
        memo: row["memo"],
        reporterName: row["reporterName"],
        confirmedBy: row["confirmedBy"],
      };
    default:
      return row;
  }
};

export const mapRowToTemplateHeaders = (row: Record<string, unknown>, type: TableType, headers: string[]) => {
  const defaultRow = buildDefaultExportRow(row, type);
  const aliasMap = HEADER_ALIASES[type];
  return headers.reduce((acc: Record<string, unknown>, header) => {
    const key = aliasMap[normalizeHeaderName(header)] || header;
    acc[header] = defaultRow[key] ?? "";
    return acc;
  }, {});
};

export const parseExcelDate = (value: unknown): string => {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || !parsed.y) return "";
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${month}-${day}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const date = new Date(trimmed);
    if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10);
    return trimmed;
  }
  return "";
};
