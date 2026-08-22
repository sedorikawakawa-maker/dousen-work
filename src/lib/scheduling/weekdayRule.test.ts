import { describe, expect, it } from "vitest";
import { computeCandidateDates, describeWeekdayRule, isWeekdayRule } from "./weekdayRule";

describe("computeCandidateDates", () => {
  it("リール: 月4本・毎週火曜（2026年9月は火曜が5回あるため4本に切り詰められる想定は呼び出し側の責務）", () => {
    // 2026-09: 火曜は 1,8,15,22,29日（5回）
    const dates = computeCandidateDates({ mode: "weekly", weekdays: [2] }, 2026, 8);
    expect(dates).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("フィード: 第1・第3木曜", () => {
    // 2026-09: 木曜は 3,10,17,24日。第1=3日, 第3=17日
    const dates = computeCandidateDates(
      { mode: "nth_weekday", rules: [{ nth: 1, weekday: 4 }, { nth: 3, weekday: 4 }] },
      2026,
      8,
    );
    expect(dates).toEqual(["2026-09-03", "2026-09-17"]);
  });

  it("ストーリーズ: 複数曜日（月・水・金）", () => {
    // 2026-09: 月=7,14,21,28 / 水=2,9,16,23,30 / 金=4,11,18,25
    const dates = computeCandidateDates({ mode: "weekly", weekdays: [1, 3, 5] }, 2026, 8);
    expect(dates).toEqual([
      "2026-09-02",
      "2026-09-04",
      "2026-09-07",
      "2026-09-09",
      "2026-09-11",
      "2026-09-14",
      "2026-09-16",
      "2026-09-18",
      "2026-09-21",
      "2026-09-23",
      "2026-09-25",
      "2026-09-28",
      "2026-09-30",
    ]);
  });

  it("存在しない第5◯曜日は候補から除外される", () => {
    // 2026-09の月曜は 7,14,21,28日の4回のみ（第5月曜は無い）
    const dates = computeCandidateDates(
      { mode: "nth_weekday", rules: [{ nth: 5, weekday: 1 }] },
      2026,
      8,
    );
    expect(dates).toEqual([]);
  });
});

describe("describeWeekdayRule", () => {
  it("毎週ルールを日本語表記にする", () => {
    expect(describeWeekdayRule({ mode: "weekly", weekdays: [2] })).toBe("毎週火曜日");
    expect(describeWeekdayRule({ mode: "weekly", weekdays: [1, 3, 5] })).toBe(
      "毎週月・水・金曜日",
    );
  });

  it("第N曜日ルールを日本語表記にする", () => {
    expect(
      describeWeekdayRule({
        mode: "nth_weekday",
        rules: [
          { nth: 1, weekday: 4 },
          { nth: 3, weekday: 4 },
        ],
      }),
    ).toBe("第1木曜日・第3木曜日");
  });

  it("曜日未設定の場合はその旨を返す", () => {
    expect(describeWeekdayRule({ mode: "weekly", weekdays: [] })).toBe("曜日未設定");
  });
});

describe("isWeekdayRule", () => {
  it("正しい形式を判定できる", () => {
    expect(isWeekdayRule({ mode: "weekly", weekdays: [1] })).toBe(true);
    expect(isWeekdayRule({ mode: "nth_weekday", rules: [] })).toBe(true);
  });

  it("不正な形式はfalseになる", () => {
    expect(isWeekdayRule(null)).toBe(false);
    expect(isWeekdayRule({})).toBe(false);
    expect(isWeekdayRule({ mode: "weekly" })).toBe(false);
  });
});
