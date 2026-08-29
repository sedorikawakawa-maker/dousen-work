"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/presence/relativeTime";
import type { StaffPresenceRosterItem } from "@/lib/presence/queries";

const PRESENCE_TOPIC = "staff-presence";
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
/** 一覧が短い間は全員表示し、これを超えたら「＋N人」に折りたたむ。 */
const COMPACT_LIMIT = 8;

interface PresenceTrackPayload {
  staff_id: string;
  display_name: string;
}

export interface StaffPresenceState {
  onlineIds: Set<string>;
  leaveOverrides: Record<string, string>;
  connectionError: boolean;
}

/**
 * 他staffの稼働状況(オンライン/オフライン)をSupabase Realtime Presenceで管理するhook。
 * WebSocket接続・channel購読の副作用はここに1つだけ持たせる。
 * 呼び出し元(Sidebar)が1回だけ呼ぶこと — SidebarはPC用/モバイルドロワー用に同じnavBody
 * JSXを2箇所へ描画する構造のため、この副作用そのものを描画のたびに複製される場所
 * （navBodyの中）に置くと、channelの二重購読やheartbeatの二重起動につながる。
 */
export function useStaffPresence({
  currentStaffId,
  currentStaffName,
}: {
  currentStaffId: string;
  currentStaffName: string;
}): StaffPresenceState {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [leaveOverrides, setLeaveOverrides] = useState<Record<string, string>>({});
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let joined = false;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(PRESENCE_TOPIC, {
      config: { private: true, presence: { key: currentStaffId } },
    });
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    async function sendHeartbeat() {
      if (cancelled) return;
      await supabase
        .from("staff_presence")
        .upsert({ staff_id: currentStaffId, last_seen_at: new Date().toISOString() });
    }

    function syncOnline() {
      if (cancelled) return;
      setOnlineIds(new Set(Object.keys(channel.presenceState())));
      setConnectionError(false);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (!cancelled && document.visibilityState === "visible") void sendHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    }

    channel
      .on("presence", { event: "sync" }, syncOnline)
      .on("presence", { event: "leave" }, ({ key }: { key: string }) => {
        if (cancelled) return;
        setLeaveOverrides((prev) => ({ ...prev, [key]: new Date().toISOString() }));
      });

    // createSupabaseBrowserClient()のシングルトンは、Cookieから復元したセッションを
    // onAuthStateChangeで非同期にrealtime.setAuth()へ配線するため、channel.subscribe()を
    // 即座に呼ぶとその配線が終わる前にphx_joinが送られ、private channelが未認証扱いで
    // 拒否される競合が実機で確認された。ここで現在のセッションのaccess_tokenを明示的に
    // realtime.setAuth()してから購読することで、その競合を避ける。
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;
      channel.subscribe(async (status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          joined = true;
          const payload: PresenceTrackPayload = { staff_id: currentStaffId, display_name: currentStaffName };
          await channel.track(payload);
          if (cancelled) return;
          await sendHeartbeat();
          startHeartbeat();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionError(true);
          stopHeartbeat();
        }
        if (status === "CLOSED") {
          stopHeartbeat();
        }
      });
    })();

    function onVisibilityChange() {
      if (!cancelled && document.visibilityState === "visible") void sendHeartbeat();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopHeartbeat();
      // 未joinのままcleanupされるケース(Strict Modeの2重実行など)でuntrack()を呼ぶと
      // "tried to push 'presence' ... before joining" エラーになるため、実際にjoinできて
      // いた場合のみuntrackする。removeChannelはjoin有無に関わらず安全に呼べる。
      if (joined) {
        void channel.untrack();
      }
      void supabase.removeChannel(channel);
    };
  }, [currentStaffId, currentStaffName]);

  return { onlineIds, leaveOverrides, connectionError };
}

/**
 * 稼働状況の表示専用（副作用なし・純粋な描画）。SidebarのnavBodyはPC/モバイルドロワーの
 * 2箇所に描画されるため、この見た目部分は複製されても問題ないよう状態を持たない設計にする
 * （実際の接続はuseStaffPresenceが親のSidebarで1回だけ持つ）。
 */
export function StaffPresenceRosterView({
  roster,
  currentStaffId,
  presence,
}: {
  roster: StaffPresenceRosterItem[];
  currentStaffId: string;
  presence: StaffPresenceState;
}) {
  const [expanded, setExpanded] = useState(false);
  const { onlineIds, leaveOverrides, connectionError } = presence;

  const sorted = [...roster].sort((a, b) => {
    const aOnline = onlineIds.has(a.id) ? 0 : 1;
    const bOnline = onlineIds.has(b.id) ? 0 : 1;
    return aOnline - bOnline;
  });

  const onlineCount = roster.filter((s) => onlineIds.has(s.id)).length;
  const visible = expanded || sorted.length <= COMPACT_LIMIT ? sorted : sorted.slice(0, COMPACT_LIMIT);
  const hiddenCount = sorted.length - visible.length;

  return (
    <div className="mt-6 border-t border-neutral-800 pt-4">
      <div className="flex items-center justify-between px-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          稼働状況 {onlineCount}/{roster.length}
        </p>
        {connectionError ? <span className="text-[10px] text-neutral-600">取得不可</span> : null}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1 px-2">
        {visible.map((s) => {
          const online = onlineIds.has(s.id);
          const lastSeen = leaveOverrides[s.id] ?? s.lastSeenAt;
          return (
            <li key={s.id} className="flex items-center gap-1.5 text-xs text-neutral-300">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? "bg-green-500" : "bg-neutral-600"}`}
                aria-hidden="true"
              />
              <span className="truncate">{s.name}</span>
              {s.id === currentStaffId ? <span className="shrink-0 text-[10px] text-neutral-500">(あなた)</span> : null}
              {!online && lastSeen ? (
                <span className="ml-auto shrink-0 text-[10px] text-neutral-500">{formatRelativeTime(lastSeen)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 px-2 text-[10px] text-neutral-500 underline"
        >
          ＋{hiddenCount}人
        </button>
      ) : null}
    </div>
  );
}
