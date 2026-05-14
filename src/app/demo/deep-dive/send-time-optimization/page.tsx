export default function SendTimeOptimizationPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold">Send-Time Optimization</h1>
      <p className="text-muted-foreground">
        Deriving each user&apos;s optimal send window from behavioral signals and scheduling
        precisely within Braze&apos;s delivery model.
      </p>

      {/* ── preferredSendHour ───────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">The preferredSendHour Signal</h2>
      <p>
        When Hightouch syncs a user record, <span className="font-mono">last_seen_at</span> captures
        the UTC timestamp of their most recent app session endpoint. The assumption: users are most
        receptive just before their next session begins — which is likely near the same time as
        their last session ended. The ingest route extracts two fields:
      </p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`preferredSendHour   = last_seen_at.getUTCHours()    // 0–23
preferredSendMinute = last_seen_at.getUTCMinutes()  // 0–59`}</code>
      </pre>
      <p>
        Over time, as multiple <span className="font-mono">last_seen_at</span> values are ingested,
        the stored hour reflects the most recent session endpoint. There is currently no smoothing
        or averaging across sessions — the latest value wins. Future work could maintain a rolling
        mode of session-end hours to produce a more stable signal.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <strong>Why session end, not start?</strong> Braze surfaces{" "}
        <span className="font-mono">last_seen_at</span> via its REST API as a user attribute, and it
        corresponds to the last SDK session close event. Session start timestamps are not exposed as
        a first-class attribute. The 10-minute pre-session offset below compensates for this
        indirection.
      </div>

      {/* ── 10-Minute Pre-Session Offset ────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">The 10-Minute Pre-Session Offset</h2>
      <p>
        Sessions typically last 3–10 minutes.{" "}
        <span className="font-mono">last_seen_at</span> marks session end, not start. Scheduling
        exactly at <span className="font-mono">preferredSendHour:preferredSendMinute</span> would
        place the notification during or after the user&apos;s typical session window — too late to
        drive an open. Instead, <span className="font-mono">computeScheduledAt</span> subtracts 10
        minutes to arrive just before the next likely session:
      </p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`totalMinutes = preferredHour × 60 + preferredMinute - 10
offsetHour   = floor(totalMinutes / 60)       // handles cross-hour wrap
offsetMinute = ((totalMinutes % 60) + 60) % 60  // handles negative modulo

candidate = today at offsetHour:offsetMinute UTC

if candidate > now:
  return { scheduledAt: candidate, inLocalTime: false }`}</code>
      </pre>
      <p>
        The double-modulo pattern on <span className="font-mono">offsetMinute</span> handles the
        edge case where <span className="font-mono">preferredMinute &lt; 10</span> — subtracting 10
        would produce a negative minute value, and the JavaScript <span className="font-mono">%</span>{" "}
        operator does not auto-wrap negatives. The <span className="font-mono">+60) % 60</span>{" "}
        idiom ensures the result stays in <span className="font-mono">[0, 59]</span> while the
        offsetHour subtraction handles the borrow.
      </p>

      {/* ── Fallback Path ───────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">The Fallback Path and Tomorrow&apos;s Advance</h2>
      <p>
        Two conditions trigger the fallback path: the user has no{" "}
        <span className="font-mono">preferredSendHour</span> set (new user), or the computed
        preferred time has already passed today. In both cases:
      </p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`fallback = today at agentFallbackHour:00 UTC

if fallback ≤ now:
  fallback += 1 day    // advance to tomorrow

return { scheduledAt: fallback, inLocalTime: true }`}</code>
      </pre>
      <p>
        The critical constraint: Braze validates{" "}
        <span className="font-mono">schedule.time</span> as an absolute UTC timestamp that must be
        in the future, even when{" "}
        <span className="font-mono">in_local_time: true</span> is set. Sending a past timestamp
        returns HTTP 400 with the error:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        &apos;time&apos; must be an ISO 8601 time in UTC that has not passed
      </div>
      <p>
        Advancing by one day guarantees the timestamp is accepted. Braze then re-interprets the
        hour component in each recipient&apos;s local timezone and auto-advances for any user whose
        local equivalent has also passed. This means a fallback send scheduled for tomorrow at 8:00
        UTC will reach US/Eastern users at 8:00 AM ET and US/Pacific users at 8:00 AM PT, with
        delivery spread across the day.
      </p>

      {/* ── Quiet Hours ─────────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Per-User Quiet Hours</h2>
      <p>
        When quiet hours are configured with{" "}
        <span className="font-mono">timezone = &quot;user&quot;</span>, each user&apos;s stored
        IANA timezone is used to evaluate whether the current UTC time falls within the quiet
        window:
      </p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`isInQuietHours(timezone, start, end, now):
  tzTime = format(now, { timeZone: timezone, hour12: false })  // "HH:MM"

  if start > end:  // overnight range e.g. "21:00"–"06:00"
    return tzTime >= start || tzTime < end
  else:            // intraday range e.g. "00:00"–"08:00"
    return tzTime >= start && tzTime < end`}</code>
      </pre>
      <p>
        The branch on <span className="font-mono">start &gt; end</span> handles overnight ranges
        (e.g., 9pm–6am) where the window wraps midnight. Without this branch, an overnight range
        would be evaluated as an empty set because no time satisfies{" "}
        <span className="font-mono">tzTime &gt;= &quot;21:00&quot; AND tzTime &lt; &quot;06:00&quot;</span>{" "}
        simultaneously.
      </p>
      <p>
        The timezone is synced from Braze&apos;s{" "}
        <span className="font-mono">Latest Device Timezone</span> attribute via Hightouch. Users
        without a stored timezone are passed through without suppression — they are not silenced
        simply because their timezone is unknown.
      </p>

      {/* ── inLocalTime Semantics ────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">inLocalTime Semantics</h2>
      <p>
        The <span className="font-mono">inLocalTime</span> flag on a scheduled Braze message changes
        how Braze interprets <span className="font-mono">schedule.time</span>:
      </p>
      <ul className="list-disc list-inside space-y-2 text-sm">
        <li>
          <span className="font-mono">inLocalTime = false</span>: deliver exactly at the specified
          UTC timestamp to all recipients simultaneously
        </li>
        <li>
          <span className="font-mono">inLocalTime = true</span>: interpret the hour component of{" "}
          <span className="font-mono">schedule.time</span> as a local time; deliver to each user
          when that hour arrives in their timezone
        </li>
      </ul>
      <p>
        For example:{" "}
        <span className="font-mono">schedule.time = &quot;2026-05-08T08:00:00Z&quot;</span> with{" "}
        <span className="font-mono">inLocalTime = true</span> delivers to US/Eastern users at 8:00
        AM ET (13:00 UTC), to US/Pacific users at 8:00 AM PT (15:00 UTC), and so on. Braze
        automatically advances to the following day for any user whose local 8 AM has already
        passed.
      </p>
      <p>
        Preferred-time sends use <span className="font-mono">inLocalTime = false</span> because the
        computed UTC timestamp already encodes the user&apos;s behavioral signal — treating it as
        local time would double-apply timezone logic. Fallback sends use{" "}
        <span className="font-mono">inLocalTime = true</span> because the fallback hour is a
        policy-level default that should respect local time across the audience.
      </p>

      {/* ── Frequency and Global Caps ───────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Frequency and Global Caps</h2>
      <p>Before scheduling a send, the cron evaluates three gates in order:</p>
      <ol className="list-decimal list-inside space-y-2 text-sm">
        <li>
          <strong>Frequency cap</strong>: the number of decisions recorded for this user within the
          configured window (day / week / biweek / month) must be below{" "}
          <span className="font-mono">maxSends</span>. Users who have already received the maximum
          sends in the window are skipped entirely.
        </li>
        <li>
          <strong>Global daily cap</strong>: total sends across all users for this agent today must
          be below <span className="font-mono">audienceCap</span>. This prevents a single agent from
          saturating the notification channel when the eligible audience is very large.
        </li>
        <li>
          <strong>Timing lottery</strong>: users with{" "}
          <span className="font-mono">preferredSendHour</span> set compete in a timing lottery where
          only users whose computed <span className="font-mono">scheduledAt</span> falls within a
          2-hour window of the next batch are eligible for that batch run. Users outside the window
          are deferred to a later batch when their preferred time is closer.
        </li>
      </ol>
      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        The timing lottery is what makes send-time optimization effective at scale. Without it,
        every eligible user would be scheduled immediately on the next cron tick regardless of their
        preferred time. The lottery ensures sends are distributed across the day proportionally to
        user session patterns rather than concentrated in a single burst at cron execution time.
      </div>
    </article>
  );
}
