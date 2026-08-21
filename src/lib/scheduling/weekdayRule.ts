// weekday_rule (jsonb) の形式:
//   {"mode":"weekly","weekdays":[2]}                                  … 毎週火曜日
//   {"mode":"nth_weekday","rules":[{"nth":1,"weekday":4},{"nth":3,"weekday":4}]} … 第1・第3木曜日
// weekday は JS の Date#getDay() と同じ 0=日曜〜6=土曜。

export type WeekdayRule =
  | { mode: "weekly"; weekdays: number[] }
  | { mode: "nth_weekday"; rules: { nth: number; weekday: number }[] };

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function nthWeekdayOfMonth(
  year: number,
  month0: number,
  nth: number,
  weekday: number,
): Date | null {
  const total = daysInMonth(year, month0);
  let count = 0;
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(Date.UTC(year, month0, day));
    if (date.getUTCDay() === weekday) {
      count += 1;
      if (count === nth) return date;
    }
  }
  return null;
}

/** 指定した年月における候補日（ISO文字列, 昇順）を計算する。 */
export function computeCandidateDates(
  rule: WeekdayRule,
  year: number,
  month0: number,
): string[] {
  const dates: string[] = [];

  if (rule.mode === "weekly") {
    const total = daysInMonth(year, month0);
    for (let day = 1; day <= total; day += 1) {
      const date = new Date(Date.UTC(year, month0, day));
      if (rule.weekdays.includes(date.getUTCDay())) {
        dates.push(toIsoDate(date));
      }
    }
  } else {
    for (const { nth, weekday } of rule.rules) {
      const date = nthWeekdayOfMonth(year, month0, nth, weekday);
      if (date) dates.push(toIsoDate(date));
    }
  }

  return dates.sort();
}

/** UI表示・確認用に、ルールを日本語の短い説明文にする。 */
export function describeWeekdayRule(rule: WeekdayRule): string {
  if (rule.mode === "weekly") {
    if (rule.weekdays.length === 0) return "曜日未設定";
    const labels = [...rule.weekdays].sort().map((w) => WEEKDAY_LABELS[w]);
    return `毎週${labels.join("・")}曜日`;
  }

  if (rule.rules.length === 0) return "曜日未設定";
  return rule.rules
    .map((r) => `第${r.nth}${WEEKDAY_LABELS[r.weekday]}曜日`)
    .join("・");
}

export function isWeekdayRule(value: unknown): value is WeekdayRule {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.mode === "weekly") return Array.isArray(v.weekdays);
  if (v.mode === "nth_weekday") return Array.isArray(v.rules);
  return false;
}
