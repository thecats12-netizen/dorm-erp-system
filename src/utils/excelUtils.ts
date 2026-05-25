import * as XLSX from "xlsx";
import { HEADER_ALIASES } from "../constants/excelHeaders";
import type { TableType } from "../types";

export const normalizeHeaderName = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-zㄱ-ㅎㅏ-ㅣ가-힣]/g, "");

export const getHeaderAlias = (type: TableType, header: string) => {
  const normalized = normalizeHeaderName(header);
  return HEADER_ALIASES[type][normalized] || header;
};

export const normalizeExcelRow = (row: Record<string, unknown>, type: TableType) => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[getHeaderAlias(type, key)] = value;
  }
  return normalized;
};

export const getWorksheetHeaders = (worksheet: XLSX.WorkSheet) => {
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  const headerRow: string[] = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    headerRow.push(cell ? String(cell.v) : "");
  }
  return headerRow.filter((header) => header.trim() !== "");
};

export const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
};

export const base64ToArrayBuffer = (base64: string) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};