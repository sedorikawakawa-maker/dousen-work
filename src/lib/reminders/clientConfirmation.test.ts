import { describe, expect, it } from "vitest";
import {
  CLIENT_CONFIRMATION_URGENT_THRESHOLD_DAYS,
  getClientConfirmationElapsedDays,
  getClientConfirmationLevel,
} from "./clientConfirmation";

const NOW = new Date("2026-08-22T00:00:00.000Z");

function daysAgoIso(days: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

describe("getClientConfirmationElapsedDays", () => {
  it("依頼日時が無い場合はnull", () => {
    expect(getClientConfirmationElapsedDays(null, NOW)).toBeNull();
  });

  it("経過日数を計算する", () => {
    expect(getClientConfirmationElapsedDays(daysAgoIso(3), NOW)).toBe(3);
  });
});

describe("getClientConfirmationLevel", () => {
  it("14日未満は経過日数に応じてnone/warningを返す", () => {
    expect(getClientConfirmationLevel(daysAgoIso(0), NOW)).toBe("none");
    expect(getClientConfirmationLevel(daysAgoIso(6), NOW)).toBe("none");
    expect(getClientConfirmationLevel(daysAgoIso(7), NOW)).toBe("warning");
    expect(getClientConfirmationLevel(daysAgoIso(13), NOW)).toBe("warning");
  });

  it("14日以上はurgent（赤・最優先催促）", () => {
    expect(getClientConfirmationLevel(daysAgoIso(14), NOW)).toBe("urgent");
    expect(getClientConfirmationLevel(daysAgoIso(30), NOW)).toBe("urgent");
  });

  it("最優先催促のしきい値は14日", () => {
    expect(CLIENT_CONFIRMATION_URGENT_THRESHOLD_DAYS).toBe(14);
  });
});
