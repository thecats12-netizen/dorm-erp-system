import type { Dispatch, SetStateAction } from "react";
import { saveJson } from "./storageService";
import { createAuditLogEntry } from "./auditService";

type BaseEntity = {
  id: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
};

type AuditFn = (entry: ReturnType<typeof createAuditLogEntry>) => void;

export const saveEntity = <T extends BaseEntity>(params: {
  entityType: string;
  targetType: string;
  key: string;
  tenantId?: string;
  state: T[];
  setState: Dispatch<SetStateAction<T[]>>;
  entity: Partial<T>;
  currentUser: string;
  auditFn: AuditFn;
  memo?: string;
}) => {
  const now = new Date().toISOString();
  const newEntity: T = {
    ...((params.entity as T) || {}),
    id: params.entity.id || crypto.randomUUID(),
    createdAt: (params.entity as T).createdAt || now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: undefined,
    deletedBy: undefined,
  } as T;

  const nextState = [...params.state, newEntity];
  params.setState(nextState);
  saveJson(params.key, nextState, params.tenantId);
  params.auditFn(
    createAuditLogEntry({
      targetType: params.targetType as any,
      targetId: newEntity.id,
      actionType: "create",
      changedBy: params.currentUser,
      beforeValue: "",
      afterValue: JSON.stringify(newEntity),
      memo: params.memo,
      after: newEntity,
    })
  );
};

export const updateEntity = <T extends BaseEntity>(params: {
  key: string;
  tenantId?: string;
  state: T[];
  setState: Dispatch<SetStateAction<T[]>>;
  id: string;
  update: Partial<T>;
  currentUser: string;
  auditFn: AuditFn;
  targetType: string;
  memo?: string;
}) => {
  const previous = params.state.find((item) => item.id === params.id);
  if (!previous) return;
  const now = new Date().toISOString();
  const updated = { ...previous, ...params.update, updatedAt: now } as T;
  const nextState = params.state.map((item) => (item.id === params.id ? updated : item));

  params.setState(nextState);
  saveJson(params.key, nextState, params.tenantId);
  params.auditFn(
    createAuditLogEntry({
      targetType: params.targetType as any,
      targetId: updated.id,
      actionType: "update",
      changedBy: params.currentUser,
      beforeValue: JSON.stringify(previous),
      afterValue: JSON.stringify(updated),
      memo: params.memo,
      before: previous,
      after: updated,
    })
  );
};

export const deleteEntity = <T extends BaseEntity>(params: {
  key: string;
  tenantId?: string;
  state: T[];
  setState: Dispatch<SetStateAction<T[]>>;
  id: string;
  currentUser: string;
  auditFn: AuditFn;
  targetType: string;
  memo?: string;
}) => {
  const prev = params.state.find((item) => item.id === params.id);
  if (!prev) return;
  const now = new Date().toISOString();
  const deleted = {
    ...prev,
    isDeleted: true,
    deletedAt: now,
    deletedBy: params.currentUser,
    updatedAt: now,
  } as T;

  const nextState = params.state.map((item) => (item.id === params.id ? deleted : item));
  params.setState(nextState);
  saveJson(params.key, nextState, params.tenantId);
  params.auditFn(
    createAuditLogEntry({
      targetType: params.targetType as any,
      targetId: deleted.id,
      actionType: "delete",
      changedBy: params.currentUser,
      beforeValue: JSON.stringify(prev),
      afterValue: JSON.stringify(deleted),
      memo: params.memo,
      before: prev,
      after: deleted,
    })
  );
};

export const restoreEntity = <T extends BaseEntity>(params: {
  key: string;
  tenantId?: string;
  state: T[];
  setState: Dispatch<SetStateAction<T[]>>;
  id: string;
  currentUser: string;
  auditFn: AuditFn;
  targetType: string;
  memo?: string;
}) => {
  const prev = params.state.find((item) => item.id === params.id);
  if (!prev) return;
  const now = new Date().toISOString();
  const restored = {
    ...prev,
    isDeleted: false,
    deletedAt: undefined,
    deletedBy: undefined,
    updatedAt: now,
  } as T;

  const nextState = params.state.map((item) => (item.id === params.id ? restored : item));
  params.setState(nextState);
  saveJson(params.key, nextState, params.tenantId);
  params.auditFn(
    createAuditLogEntry({
      targetType: params.targetType as any,
      targetId: restored.id,
      actionType: "restore",
      changedBy: params.currentUser,
      beforeValue: JSON.stringify(prev),
      afterValue: JSON.stringify(restored),
      memo: params.memo,
      before: prev,
      after: restored,
    })
  );
};

export const statusChangeEntity = <T extends BaseEntity>(params: {
  key: string;
  tenantId?: string;
  state: T[];
  setState: Dispatch<SetStateAction<T[]>>;
  id: string;
  update: Partial<T>;
  currentUser: string;
  auditFn: AuditFn;
  targetType: string;
  memo?: string;
}) => {
  const prev = params.state.find((item) => item.id === params.id);
  if (!prev) return;
  const now = new Date().toISOString();
  const updated = { ...prev, ...params.update, updatedAt: now } as T;
  const nextState = params.state.map((item) => (item.id === params.id ? updated : item));

  params.setState(nextState);
  saveJson(params.key, nextState, params.tenantId);
  params.auditFn(
    createAuditLogEntry({
      targetType: params.targetType as any,
      targetId: updated.id,
      actionType: "statusChange",
      changedBy: params.currentUser,
      beforeValue: JSON.stringify(prev),
      afterValue: JSON.stringify(updated),
      memo: params.memo,
      before: prev,
      after: updated,
    })
  );
};
