// 증빙파일/청소사진 등 이미지·문서를 Supabase Storage 에 저장하고 Public URL 을 돌려주는 헬퍼.
// - 기존 정책과 동일하게 service_role_key 미사용(anon key + RLS/공개 버킷).
// - 이미지: 업로드 전 canvas 로 자동 리사이즈+압축(JPEG) → 용량/속도 개선.
// - PDF 등 비이미지: 압축 없이 원본 업로드.
// - 버킷 미생성/업로드 실패 시 "원본 값(base64/기존 URL)" 을 그대로 반환 → 저장이 절대 깨지지 않음(base64 폴백).
// - 이미 http(s) URL 인 값은 재업로드하지 않고 그대로 유지(중복 업로드 방지).
import { supabase, isSupabaseAvailable } from "./supabaseService";

export const INVENTORY_PROOF_BUCKET = "inventory-proof";
export const CLEANING_PHOTO_BUCKET = "cleaning-photos";

const isHttpUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);
const isDataUrl = (v: unknown): v is string => typeof v === "string" && /^data:/i.test(v);

const sanitizeName = (name: string) => name.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 120) || "file";

const extFromMime = (mime: string): string => {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  const guess = m.split("/")[1] || "bin";
  return guess.replace(/[^a-z0-9]/g, "") || "bin";
};

// data URL → { blob, mime }
const dataUrlToBlob = (dataUrl: string): { blob: Blob; mime: string } | null => {
  try {
    const [header, body] = dataUrl.split(",");
    if (!body) return null;
    const mime = /data:([^;]+)/i.exec(header)?.[1] || "application/octet-stream";
    const isBase64 = /;base64/i.test(header);
    if (isBase64) {
      const bin = atob(body);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return { blob: new Blob([bytes], { type: mime }), mime };
    }
    return { blob: new Blob([decodeURIComponent(body)], { type: mime }), mime };
  } catch {
    return null;
  }
};

// 이미지 압축/리사이즈(canvas). 실패하면 원본 data URL 반환(안전).
const compressImageDataUrl = (dataUrl: string, maxDim = 1600, quality = 0.8): Promise<string> =>
  new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(dataUrl);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });

// 단일 값 업로드: 이미 URL이면 그대로, data URL이면 (이미지는 압축 후) 업로드 → Public URL. 실패 시 원본 반환(폴백).
const uploadOne = async (bucket: string, pathPrefix: string, value: string, index: number): Promise<string> => {
  if (!value) return value;
  if (isHttpUrl(value)) return value; // 이미 업로드됨 → 재업로드 금지
  if (!isDataUrl(value) || !isSupabaseAvailable() || !supabase) return value; // base64 아님/Storage 미가용 → 폴백

  try {
    const isImage = /^data:image\//i.test(value);
    const finalDataUrl = isImage ? await compressImageDataUrl(value) : value;
    const parsed = dataUrlToBlob(finalDataUrl);
    if (!parsed) return value;
    const ext = extFromMime(parsed.mime);
    const fileName = sanitizeName(`${Date.now()}-${index}.${ext}`);
    const path = `${pathPrefix}/${fileName}`;
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, parsed.blob, { contentType: parsed.mime, upsert: true });
    if (upErr) {
      console.warn(`[storage:${bucket}] 업로드 실패(base64 폴백):`, (upErr as { message?: string })?.message || upErr);
      return value;
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || value;
  } catch (e) {
    console.warn(`[storage:${bucket}] 예외(base64 폴백):`, (e as { message?: string })?.message || e);
    return value;
  }
};

/**
 * 여러 파일을 Storage 에 병렬 업로드하고 URL 배열을 반환. (이미 URL/업로드 실패 항목은 원본 유지 → base64 폴백)
 * @param pathPrefix 예: `${year}/${itemId}` → 최종 경로 `${bucket}/${year}/${itemId}/${filename}`
 */
export const uploadFilesToStorage = async (
  bucket: string,
  pathPrefix: string,
  values: (string | undefined | null)[]
): Promise<string[]> => {
  const list = (values || []).filter((v): v is string => typeof v === "string" && v.length > 0);
  if (list.length === 0) return [];
  return Promise.all(list.map((v, i) => uploadOne(bucket, pathPrefix, v, i)));
};

/** 단일 증빙파일 업로드(비품 proofFile 등). 실패/미가용 시 원본 반환(폴백). */
export const uploadFileToStorage = async (
  bucket: string,
  pathPrefix: string,
  value: string | undefined | null
): Promise<string> => {
  if (!value) return "";
  const [url] = await uploadFilesToStorage(bucket, pathPrefix, [value]);
  return url ?? value;
};
