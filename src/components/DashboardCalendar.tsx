"use client";

import { useState } from "react";
import Link from "next/link";
import type { CalendarDayEvents } from "@/lib/calendar/queries";
import { POST_TYPE_LABELS, PRODUCTION_TASK_STATUS_LABELS } from "@/lib/clients/labels";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientAvatar } from "@/components/ClientAvatar";
import { InternalTaskCard } from "@/components/InternalTaskCard";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const MAX_VISIBLE_PER_CELL = 2;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoForDay(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

function formatSelectedDateLabel(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${month}月${day}日の予定`;
}

export function DashboardCalendar({
  year,
  month0,
  todayIso,
  eventsByDate,
  prevMonthHref,
  nextMonthHref,
  todayMonthHref,
}: {
  year: number;
  month0: number;
  todayIso: string;
  eventsByDate: Record<string, CalendarDayEvents>;
  prevMonthHref: string;
  nextMonthHref: string;
  todayMonthHref: string;
}) {
  const isCurrentMonthView = todayIso.startsWith(`${year}-${pad2(month0 + 1)}`);
  const [selectedDate, setSelectedDate] = useState<string | null>(isCurrentMonthView ? todayIso : null);

  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedEvents = selectedDate ? eventsByDate[selectedDate] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={prevMonthHref}
          className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          aria-label="前月"
        >
          ＜
        </Link>
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold tabular-nums text-neutral-900">
            {year}年{month0 + 1}月
          </p>
          {!isCurrentMonthView ? (
            <Link
              href={todayMonthHref}
              className="whitespace-nowrap rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
            >
              今月
            </Link>
          ) : null}
        </div>
        <Link
          href={nextMonthHref}
          className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          aria-label="翌月"
        >
          ＞
        </Link>
      </div>

      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-neutral-500">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label}>{label}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={idx} />;

            const dateIso = isoForDay(year, month0, day);
            const dayEvents = eventsByDate[dateIso];
            const isToday = dateIso === todayIso;
            const isSelected = dateIso === selectedDate;
            const combined = [
              ...(dayEvents?.posts.map((p) => ({
                key: `p-${p.id}`,
                label: `${p.clientName}・${POST_TYPE_LABELS[p.postType]}`,
                tone: "post" as const,
              })) ?? []),
              ...(dayEvents?.internalTasks.map((t) => ({
                key: `i-${t.task.id}`,
                label: t.task.title,
                tone: "internal" as const,
              })) ?? []),
            ];
            const visible = combined.slice(0, MAX_VISIBLE_PER_CELL);
            const overflowCount = combined.length - visible.length;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedDate(dateIso)}
                className={`flex min-h-[3.25rem] flex-col items-center gap-0.5 rounded-lg border p-1 text-left sm:min-h-[5rem] sm:items-stretch sm:p-1.5 ${
                  isSelected
                    ? "border-[var(--accent)] bg-[var(--accent-soft-bg)]"
                    : isToday
                      ? "border-neutral-300 bg-neutral-50"
                      : "border-transparent hover:bg-neutral-50"
                }`}
              >
                <span
                  className={`text-xs font-medium tabular-nums sm:text-left ${
                    isToday ? "text-[var(--accent-strong)]" : "text-neutral-700"
                  }`}
                >
                  {day}
                </span>

                {/* スマホ: ドット＋件数のみ（横スクロール・文字量増加を避ける） */}
                {combined.length > 0 ? (
                  <span className="flex items-center gap-0.5 sm:hidden">
                    {dayEvents!.posts.length > 0 ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                    ) : null}
                    {dayEvents!.internalTasks.length > 0 ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden="true" />
                    ) : null}
                    {combined.length > 1 ? (
                      <span className="text-[10px] text-neutral-500">{combined.length}件</span>
                    ) : null}
                  </span>
                ) : null}

                {/* PC: 短いラベルを最大2件＋残りは+N件 */}
                <span className="hidden flex-col gap-0.5 sm:flex">
                  {visible.map((item) => (
                    <span
                      key={item.key}
                      className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                        item.tone === "post" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {item.label}
                    </span>
                  ))}
                  {overflowCount > 0 ? (
                    <span className="text-[10px] text-neutral-400">+{overflowCount}件</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-neutral-100 pt-4">
        {selectedDate ? (
          <>
            <h3 className="mb-2 text-sm font-semibold text-neutral-700">{formatSelectedDateLabel(selectedDate)}</h3>
            {!selectedEvents || (selectedEvents.posts.length === 0 && selectedEvents.internalTasks.length === 0) ? (
              <p className="rounded-2xl bg-neutral-50 p-4 text-center text-sm text-neutral-400">
                この日の予定はありません。
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {selectedEvents.posts.map((post) => (
                  <Link
                    key={post.id}
                    href={`/tasks/${post.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-white p-3.5 hover:bg-neutral-50"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ClientAvatar thumbnailUrl={post.clientThumbnailUrl} name={post.clientName} size="xs" />
                      <div className="min-w-0">
                        <p className="font-semibold text-neutral-900">{post.clientName}</p>
                        <p className="text-xs text-neutral-500">{POST_TYPE_LABELS[post.postType]}</p>
                      </div>
                    </div>
                    <StatusBadge status={post.status} label={PRODUCTION_TASK_STATUS_LABELS[post.status]} />
                  </Link>
                ))}
                {selectedEvents.internalTasks.map((event) => (
                  <InternalTaskCard
                    key={event.task.id}
                    task={event.task}
                    clientName={event.clientName}
                    clientThumbnailUrl={event.clientThumbnailUrl}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-400">日付を選択すると、その日の予定が表示されます。</p>
        )}
      </div>
    </div>
  );
}
