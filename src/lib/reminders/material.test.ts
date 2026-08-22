import { describe, expect, it } from "vitest";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "./material";

const NOW = new Date("2026-08-22T00:00:00.000Z");

function daysAgoIso(days: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

describe("getMaterialWaitElapsedDays", () => {
  it("開始日時が無い場合はnull", () => {
    expect(getMaterialWaitElapsedDays(null, NOW)).toBeNull();
  });

  it("経過日数を計算する", () => {
    expect(getMaterialWaitElapsedDays(daysAgoIso(5), NOW)).toBe(5);
  });
});

describe("getMaterialWaitLevel", () => {
  it("未設定はnone", () => {
    expect(getMaterialWaitLevel(null, NOW)).toBe("none");
  });

  it("6日以内はnone", () => {
    expect(getMaterialWaitLevel(daysAgoIso(0), NOW)).toBe("none");
    expect(getMaterialWaitLevel(daysAgoIso(6), NOW)).toBe("none");
  });

  it("7日以上14日未満はwarning（黄）", () => {
    expect(getMaterialWaitLevel(daysAgoIso(7), NOW)).toBe("warning");
    expect(getMaterialWaitLevel(daysAgoIso(13), NOW)).toBe("warning");
  });

  it("14日以上はurgent（赤・催促対象）", () => {
    expect(getMaterialWaitLevel(daysAgoIso(14), NOW)).toBe("urgent");
    expect(getMaterialWaitLevel(daysAgoIso(30), NOW)).toBe("urgent");
  });
});
