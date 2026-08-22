import { describe, expect, it } from "vitest";
import {
  canAccessManagementFeatures,
  canManageStaff,
  canViewFinance,
} from "./roles";
import type { StaffRole } from "@/lib/supabase/database.types";

const ALL_ROLES: StaffRole[] = ["president", "executive", "employee", "part_time"];

describe("canViewFinance（料金・売上の閲覧・編集可否）", () => {
  it("社長・役員・社員は閲覧可", () => {
    expect(canViewFinance("president")).toBe(true);
    expect(canViewFinance("executive")).toBe(true);
    expect(canViewFinance("employee")).toBe(true);
  });

  it("パートは閲覧不可", () => {
    expect(canViewFinance("part_time")).toBe(false);
  });
});

describe("canAccessManagementFeatures（管理ダッシュボード等のアクセス可否）", () => {
  it("パート以外はアクセス可", () => {
    for (const role of ALL_ROLES.filter((r) => r !== "part_time")) {
      expect(canAccessManagementFeatures(role)).toBe(true);
    }
  });

  it("パートはアクセス不可", () => {
    expect(canAccessManagementFeatures("part_time")).toBe(false);
  });

  it("canViewFinanceと常に同じ結果を返す（現行仕様）", () => {
    for (const role of ALL_ROLES) {
      expect(canAccessManagementFeatures(role)).toBe(canViewFinance(role));
    }
  });
});

describe("canManageStaff（スタッフ管理可否）", () => {
  it("社長・役員のみ可", () => {
    expect(canManageStaff("president")).toBe(true);
    expect(canManageStaff("executive")).toBe(true);
    expect(canManageStaff("employee")).toBe(false);
    expect(canManageStaff("part_time")).toBe(false);
  });
});
