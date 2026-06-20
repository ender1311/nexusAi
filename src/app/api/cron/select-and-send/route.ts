import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { randomUUID } from "crypto";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { parseSegmentTargeting } from "@/lib/agent-targeting";
import {
  getCachedDashboardCounts,
  getCachedDashboardTimeSeries,
  getCachedAgentList,
  getCachedPerformanceMetrics,
  getCachedSegments,
} from "@/lib/cache";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
import { buildAgentLottery } from "@/lib/engine/agent-lottery";
import { getTodayStartUTC, computeScheduledAt, peakActivityHour, isInQuietHours, isBlackoutDate, localHourOf }  from "@/lib/engine/scheduling";
import { isTimingMatch } from "@/lib/engine/send-timing";
import { LinUCB } from "@/lib/engine/linucb";
import { selectVariant, blendArm } from "@/lib/engine/select-variant";
import { parseFrequencyCap, parseQuietHours } from "@/lib/schemas/scheduling";
import { computeFeatureVector, FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { BanditArm } from "@/lib/engine/types";
import { recencyMultiplier } from "@/lib/engine/beta-pdf";
import { buildEligibleAgentsByUser, classifyExplorationWindows } from "@/lib/cron/exploration-window";
import {
  isPushPreferred,
  isPushTargetingMode,
  isNewsletterOptedOut,
  DEFAULT_PUSH_TARGETING_MODE,
} from "@/lib/engine/channel-preference";
import { partitionByPreferredHour, trimToCap, resolveFetchLimit, resolvePerRunQuota, MAX_FETCH_LIMIT } from "@/lib/cron/caps";
import { runChunked } from "@/lib/cron/chunk";
import { selectCohort } from "@/lib/cron/cohort-assignment";
import { createSegmentMemberLoader } from "@/lib/cron/segment-member-cache";
import { classifyReleases, buildReleaseAgentInfo, type ReleaseAgentInfo, type ActiveAssignment } from "@/lib/cron/release-sweep";
import {
  groupDecisionsByVariant,
  dispatchSendGroups,
  type VariantSendGroup,
} from "@/lib/cron/send-grouping";
import { VERSE_PUSH_SENTINEL, isVerseStrategy, type VersePool, type VerseStrategy } from "@/lib/verse-content";
import { loadVersePool } from "@/lib/cron/verse-pool";
import { hasVotdTags, hasGpTags } from "@/lib/votd/votd-tags";
import { prepareVotdContent } from "@/lib/votd/votd-content";
import { prepareGpContent } from "@/lib/votd/guided-prayer-content";
import { type GivingHandleStrategy, type GivingFrequency } from "@/lib/engine/giving-link";
import { deriveGivingStrategy, deriveGivingFrequency, deriveGivingDefaultUsd } from "@/lib/engine/giving-handle";
import { parseMultiplier } from "@/lib/engine/giving-copy";
import { isPushVariantComplete } from "@/lib/messages/push-completeness";
import { snapshotEnrollmentFlags } from "@/lib/constants/interaction-flags";
import { resolveTranslationsByVariant } from "@/lib/cron/translation-resolver";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

// Max parallel DB writes per fan-out batch. A single agent can have thousands of
// persona×variant arms or claimed users; an unbounded Promise.all over them would
// open that many concurrent connections at once and exhaust the Neon pool.
const DB_WRITE_CONCURRENCY = 20;

// Max sends in a single in_local_time exploration window. Once an assignment's
// sendCount reaches this, the window is full (no more sends) and is marked
// complete; the send that takes sendCount from WINDOW_SEND_CAP-1 to
// WINDOW_SEND_CAP is the one that closes it.
const WINDOW_SEND_CAP = 4;

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback for cron
  return token != null && constantTimeEqual(token, secret);
}

// deriveGivingStrategy / deriveGivingFrequency / deriveGivingDefaultUsd live in
// @/lib/engine/giving-handle so the cron and the demo send path share one
// definition (see import above).

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Concurrency lock — prevent duplicate runs if cron invokes before previous run completes.
  // Single atomic INSERT ON CONFLICT eliminates the read-then-write race window.
  // rowsAffected === 0 means the existing lock is fresh → another run is active.
  //
  // The stale threshold MUST exceed maxDuration (300s). A run is killed at the
  // 300s wall-clock limit without its finally block firing, so the lock can only
  // be reclaimed by the TTL. If the TTL were ≤ maxDuration a still-alive slow run
  // (e.g. mid-dispatch at 290–300s) could have its lock stolen by a concurrent
  // invocation → double-send. Cron fires hourly, so a crashed run blocking the
  // lock for LOCK_STALE_SECONDS costs at most one skipped tick.
  const LOCK_STALE_SECONDS = 600;
  const lockKey = "cron_lock_select_and_send";
  const lockId  = randomUUID();
  const lockTs  = new Date().toISOString();
  const lockAcquired = await prisma.$executeRaw`
    INSERT INTO "AppSetting" (id, key, value)
    VALUES (${lockId}, ${lockKey}, ${lockTs})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value
      WHERE (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM "AppSetting".value::timestamptz)) > ${LOCK_STALE_SECONDS}
  `;
  if (lockAcquired === 0) {
    return NextResponse.json({ error: "Already running" }, { status: 409 });
  }

  const cronRun = await prisma.cronRun.create({
    data: { cronName: "select-and-send", agentCount: 0 },
  });
  const cronRunId = cronRun.id;

  try {

  const brazeClient = createBrazeClient();
  if (!brazeClient) {
    await prisma.cronRun.update({
      where: { id: cronRunId },
      data: { status: "failed", finishedAt: new Date(), errorMsg: "Braze not configured" },
    }).catch(() => {});
    return NextResponse.json({ error: "Braze not configured (missing BRAZE_API_KEY or BRAZE_REST_URL)" }, { status: 500 });
  }

  const killSwitch = await prisma.appSetting.findUnique({ where: { key: "global_sending_paused" } });
  if (killSwitch?.value === "true") {
    await prisma.cronRun.update({
      where: { id: cronRunId },
      data: { status: "completed", finishedAt: new Date(), errorMsg: "skipped — global kill switch on" },
    });
    return NextResponse.json({ paused: true, sent: 0 });
  }

  const factory = new PayloadFactory();
  let totalSent = 0;
  let totalSuppressed = 0;
  let totalErrors = 0;

  const agents = await prisma.agent.findMany({
    where: { status: "active", sendingPaused: false },
    include: {
      personaTargets: true,
      schedulingRule: true,
      messages: {
        include: {
          variants: { where: { status: "active" } },
        },
      },
    },
  });

  // Drop incomplete push variants from the candidate pool before any selection.
  // A push must have both a title and a body; an incomplete variant is skipped
  // (logged) so its complete siblings still send and the agent is never blocked.
  // Filtering at the source propagates to variantMeta, allVariantIds, arms, etc.
  let skippedIncompletePush = 0;
  for (const agent of agents) {
    for (const msg of agent.messages) {
      if (msg.channel !== "push") continue;
      const complete = msg.variants.filter((v) =>
        isPushVariantComplete({ title: v.title, body: v.body })
      );
      if (complete.length !== msg.variants.length) {
        for (const v of msg.variants) {
          if (!isPushVariantComplete({ title: v.title, body: v.body })) {
            skippedIncompletePush++;
            console.warn(
              `[cron/select-and-send] skipping incomplete push variant ${v.id} (agent ${agent.id}): missing title and/or body`
            );
          }
        }
        msg.variants = complete;
      }
    }
  }
  if (skippedIncompletePush > 0) {
    console.warn(`[cron/select-and-send] skipped ${skippedIncompletePush} incomplete push variant(s)`);
  }

  // Drop content-card / modal variants with a missing title — the Braze template
  // requires a title; a null title renders a broken card/modal. Body is
  // non-nullable in the schema so only title is checked.
  let skippedIncompleteContentCard = 0;
  for (const agent of agents) {
    for (const msg of agent.messages) {
      if (msg.channel !== "content-card" && msg.channel !== "modal-iam") continue;
      const complete = msg.variants.filter((v) => typeof v.title === "string" && v.title.trim().length > 0);
      if (complete.length !== msg.variants.length) {
        skippedIncompleteContentCard += msg.variants.length - complete.length;
        for (const v of msg.variants) {
          if (!(typeof v.title === "string" && v.title.trim().length > 0)) {
            console.warn(
              `[cron/select-and-send] skipping ${msg.channel} variant ${v.id} (agent ${agent.id}): missing title`
            );
          }
        }
        msg.variants = complete;
      }
    }
  }
  if (skippedIncompleteContentCard > 0) {
    console.warn(`[cron/select-and-send] skipped ${skippedIncompleteContentCard} incomplete content-card/modal variant(s)`);
  }

  void prisma.cronRun.update({
    where: { id: cronRunId },
    data: { agentCount: agents.length },
  }).catch(() => {});

  const now = new Date();   // single timestamp for the entire cron run
  const todayStart = getTodayStartUTC("America/New_York", now);

  // ─── Phase −1: Release sweep ──────────────────────────────────────────────
  // Runs first so freed users are claimable in the same run. Per-assignment
  // failures are caught/logged; one bad row never aborts the sweep.
  //
  // releasedThisRun: externalUserId → the agent that released them in THIS run.
  // Freed users stay claimable by *other* agents same-run (by design), but the
  // releasing agent itself must not re-recruit them: hold-cap releases would
  // otherwise be undone immediately by the lottery, with the re-claim upsert
  // resetting sendCount — hold caps would never stop an uncapped agent
  // (2026-06-09 audit, R1).
  const releasedThisRun = new Map<string, string>();
  {
    const activeAssignments = await prisma.userAgentAssignment.findMany({
      where: { releasedAt: null },
      select: { id: true, externalUserId: true, agentId: true, startedAt: true, sendCount: true },
    });
    if (activeAssignments.length > 0) {
      // Build per-agent target-stage sets from the already-loaded `agents`.
      const agentsById = new Map<string, ReleaseAgentInfo>();
      for (const a of agents) {
        const seg = parseSegmentTargeting(a.segmentTargeting);
        const hasSegmentTargeting = (seg?.includes?.length ?? 0) > 0 || !!a.targetSegmentName;
        agentsById.set(a.id, buildReleaseAgentInfo(
          { id: a.id, holdMaxDays: a.holdMaxDays, holdMaxSends: a.holdMaxSends, funnelStage: a.funnelStage, enrollmentMode: a.enrollmentMode as "fixed" | "continuous" },
          hasSegmentTargeting,
        ));
      }
      // Load current funnelStage for the owned users (one query).
      const ownedIds = activeAssignments.map((a) => a.externalUserId);
      const stageRows = await prisma.trackedUser.findMany({
        where: { externalId: { in: ownedIds } },
        select: { externalId: true, funnelStage: true },
      });
      const stageByUser = new Map(stageRows.map((r) => [r.externalId, r.funnelStage]));
      const enriched: ActiveAssignment[] = activeAssignments.map((a) => ({
        ...a,
        currentStage: stageByUser.get(a.externalUserId) ?? null,
      }));

      const releases = classifyReleases(enriched, agentsById, now);
      // Group by reason → one updateMany per reason (avoids N round-trips).
      const byReason = new Map<string, string[]>();
      for (const r of releases) {
        const list = byReason.get(r.reason) ?? [];
        list.push(r.id);
        byReason.set(r.reason, list);
      }
      for (const [reason, ids] of byReason) {
        await prisma.userAgentAssignment.updateMany({
          where: { id: { in: ids } },
          data: { releasedAt: now, releaseReason: reason },
        }).catch((err) => console.error(`[cron] release sweep (${reason}) failed:`, err));
      }
      // Clear the owning agent's user lock so released users are actually
      // claimable again — eligibility queries require lockedByAgentId null/own,
      // so a retained lock would exclude the user from every other agent forever.
      const agentByAssignment = new Map(enriched.map((a) => [a.id, a.agentId]));
      const releasedUsersByAgent = new Map<string, string[]>();
      for (const r of releases) {
        const agentId = agentByAssignment.get(r.id);
        if (!agentId) continue;
        const list = releasedUsersByAgent.get(agentId) ?? [];
        list.push(r.externalUserId);
        releasedUsersByAgent.set(agentId, list);
        releasedThisRun.set(r.externalUserId, agentId);
      }
      for (const [agentId, userIds] of releasedUsersByAgent) {
        await prisma.trackedUser.updateMany({
          where: { externalId: { in: userIds }, lockedByAgentId: agentId },
          data:  { lockedByAgentId: null },
        }).catch((err) => console.error(`[cron] release sweep lock clear (agent ${agentId}) failed:`, err));
      }
    }
  }
  // ─── End Phase −1 ─────────────────────────────────────────────────────────

  // Fleet-wide exclusivity (spec A4): a user actively owned by another agent is
  // ineligible for everyone except its current owner. One query, held in memory.
  const activeOwnerByUser = new Map<string, string>(); // externalUserId → owning agentId
  {
    const owned = await prisma.userAgentAssignment.findMany({
      where: { releasedAt: null },
      select: { externalUserId: true, agentId: true },
    });
    for (const a of owned) activeOwnerByUser.set(a.externalUserId, a.agentId);
  }

  // ── Pre-assignment phase: build lottery map once for the entire cron run ──
  // Fetch eligible user IDs for all agents in parallel (one query per agent),
  // and also fetch the cooldown setting for Phase 0 in the same round trip.
  const eligibleUsersByAgent = new Map<string, string[]>();
  // preferredHourByAgent: agentId → Map<externalId, preferredSendHour | null>
  // Used by time-bucketed audience selection when prioritizeLastSeen is on.
  const preferredHourByAgent = new Map<string, Map<string, number | null>>();

  // Per-run segment-membership cache. Each unique segment's members are pulled
  // from UserSegment exactly once per cron run and shared across all agents,
  // instead of every agent re-querying its include/exclude segments. A segment
  // referenced by multiple agents — e.g. "giving-has-given" is Solomon's include
  // AND Lydia's exclude — was previously loaded once per agent, every run (a
  // ~105K-row pull each time), which contended with concurrent Hightouch ingest
  // and pushed 9-agent runs past the 300s timeout. Memoizing on the Promise (not
  // the resolved Set) also collapses the concurrent loads inside the Promise.all
  // below into a single in-flight query per segment.
  const loadSegmentMembers = createSegmentMemberLoader((segmentName) =>
    prisma.userSegment
      .findMany({ where: { segmentName }, select: { externalId: true } })
      .then((rows) => rows.map((r) => r.externalId)),
  );

  const [, cooldownSetting, multiplierSetting, pushTargetingModeSetting] = await Promise.all([
    Promise.all(
      agents.map(async (agent) => {
        const personaIds = agent.personaTargets.map((pt) => pt.personaId);
        if (personaIds.length === 0) {
          eligibleUsersByAgent.set(agent.id, []);
          return;
        }
        // Language filter: only apply DB-level filter when agent has an explicit setting.
        // Push agent language filtering (defaulting to "en") is done in-memory to avoid
        // JSONB path filter reliability issues with the Neon HTTP adapter.
        const langFilter = agent.languageFilter && agent.languageFilter !== "all"
          ? { attributes: { path: ["language_tag"], string_starts_with: agent.languageFilter } }
          : {};

        // Staleness gate: only target users whose funnelStage was confirmed by Hightouch
        // within the agent's configured window. Lapsed agents use a long window (e.g. 14 days)
        // so users who graduate out of lapsed are still reachable for a while; tight-window
        // agents (wau, connected) auto-exclude stale rows after ~2 days.
        // null = no gate (backward compat for agents created before this field existed).
        const staleAt = agent.staleFunnelStageDays
          ? new Date(now.getTime() - agent.staleFunnelStageDays * 86_400_000)
          : null;
        const funnelFilter = agent.funnelStage
          ? {
              funnelStage: agent.funnelStage,
              ...(staleAt && { funnelStageUpdatedAt: { gte: staleAt } }),
            }
          : {};
        const segTargeting = parseSegmentTargeting(agent.segmentTargeting);
        const effectiveIncludes: string[] = segTargeting?.includes?.length
          ? segTargeting.includes
          : agent.targetSegmentName
            ? [agent.targetSegmentName]
            : [];
        const effectiveExcludes: string[] = segTargeting?.excludes ?? [];

        // Only called when effectiveExcludes.length > 0. Union of each exclude
        // segment's members, pulled from the shared per-run cache.
        const fetchExcludedIds = async (): Promise<Set<string>> => {
          const sets = await Promise.all(effectiveExcludes.map(loadSegmentMembers));
          const merged = new Set<string>();
          for (const s of sets) for (const id of s) merged.add(id);
          return merged;
        };

        if (effectiveIncludes.length > 0) {
          // Fetch all include segments (shared per-run cache), then intersect (AND logic)
          const memberSets = await Promise.all(effectiveIncludes.map(loadSegmentMembers));
          // AND intersection: user must be in all include segments
          let memberIds = [...memberSets[0]];
          for (let i = 1; i < memberSets.length; i++) {
            memberIds = memberIds.filter((id) => memberSets[i].has(id));
          }
          if (memberIds.length === 0) {
            eligibleUsersByAgent.set(agent.id, []);
            return;
          }
          // Apply excludes
          if (effectiveExcludes.length > 0) {
            const excludedIds = await fetchExcludedIds();
            memberIds = memberIds.filter((id) => !excludedIds.has(id));
            if (memberIds.length === 0) {
              eligibleUsersByAgent.set(agent.id, []);
              return;
            }
          }
          const segLockClause = agent.cohortAssignedAt
            ? { lockedByAgentId: agent.id }
            : { OR: [{ lockedByAgentId: null }, { lockedByAgentId: agent.id }] };
          const rows = await prisma.trackedUser.findMany({
            where: {
              externalId: { in: memberIds },
              personaId:  { in: personaIds },
              ...segLockClause,
            },
            select: { externalId: true, preferredSendHour: true },
          });
          const ownEligible = rows.filter((r) => {
            const owner = activeOwnerByUser.get(r.externalId);
            if (owner !== undefined && owner !== agent.id) return false; // actively owned elsewhere
            return releasedThisRun.get(r.externalId) !== agent.id; // no same-run re-recruit by the releaser (R1)
          });
          eligibleUsersByAgent.set(agent.id, ownEligible.map((r) => r.externalId));
          preferredHourByAgent.set(
            agent.id,
            new Map(ownEligible.map((r) => [r.externalId, r.preferredSendHour])),
          );
        } else {
          // Funnel-stage path (existing logic + exclude support)
          // Bound the query so agents with millions of eligible users don't load the
          // entire set into memory. See resolveFetchLimit: the all-null "unlimited"
          // case falls back to MAX_FETCH_LIMIT so the query is never unbounded.
          const fetchLimit = resolveFetchLimit(agent.dailySendCap, agent.uniqueUsersCap);
          // Materialized cohort agents process ONLY their own locked cohort — they
          // stop recruiting. Un-materialized agents pull the recruitable pool.
          const lockClause = agent.cohortAssignedAt
            ? { lockedByAgentId: agent.id }
            : { OR: [{ lockedByAgentId: null }, { lockedByAgentId: agent.id }] };
          let rows = await prisma.trackedUser.findMany({
            where:  {
              personaId: { in: personaIds },
              ...langFilter,
              ...funnelFilter,
              ...lockClause,
            },
            select: { externalId: true, preferredSendHour: true },
            take: fetchLimit,
          });
          // Apply excludes to funnel-stage path
          if (effectiveExcludes.length > 0) {
            const excludedIds = await fetchExcludedIds();
            rows = rows.filter((r) => !excludedIds.has(r.externalId));
          }
          const ownEligible = rows.filter((r) => {
            const owner = activeOwnerByUser.get(r.externalId);
            if (owner !== undefined && owner !== agent.id) return false; // actively owned elsewhere
            return releasedThisRun.get(r.externalId) !== agent.id; // no same-run re-recruit by the releaser (R1)
          });
          eligibleUsersByAgent.set(agent.id, ownEligible.map((r) => r.externalId));
          preferredHourByAgent.set(
            agent.id,
            new Map(ownEligible.map((r) => [r.externalId, r.preferredSendHour])),
          );
        }
      })
    ),
    // ─── Phase 0 setup: fetch cooldown config in parallel with lottery queries ───
    prisma.appSetting.findUnique({ where: { key: "exploration_window_cooldown_days" } }),
    prisma.appSetting.findUnique({ where: { key: "giving_dollars_to_bibles_multiplier" } }),
    prisma.appSetting.findUnique({ where: { key: "push_targeting_mode" } }),
  ]);

  // Push send-eligibility targeting strictness (strict | permissive | broad).
  const pushTargetingMode = isPushTargetingMode(pushTargetingModeSetting?.value)
    ? pushTargetingModeSetting.value
    : DEFAULT_PUSH_TARGETING_MODE;

  // ─── Cohort materialization ───────────────────────────────────────────────
  // First tick after an agent goes active: pick a fixed cohort of up to
  // uniqueUsersCap eligible users, lock them, and record assignments. Sequential
  // (not parallel) so each agent's locks are visible to the next; the null-guarded
  // updateMany is the arbiter when two new agents contend for the same users.
  for (const agent of agents) {
    if (agent.enrollmentMode === "continuous") continue; // continuous agents never freeze a cohort
    if (agent.cohortAssignedAt) continue;          // already materialized
    if (agent.uniqueUsersCap == null) continue;     // unlimited agents never materialize
    const pool = eligibleUsersByAgent.get(agent.id) ?? [];
    if (pool.length === 0) continue;                // nothing eligible yet; retry next tick

    // Recount how many this agent already owns and only claim up to the cap's
    // remaining headroom. A prior materialization that locked some users then hit
    // the 300s timeout before stamping cohortAssignedAt leaves partial locks; a
    // retry that sampled the full cap on top of those overshot the cap (Solomon
    // ended at 10,891 vs 10,000). Capping new claims to (cap − alreadyOwned)
    // keeps the total at or under the cap.
    const alreadyOwned = await prisma.trackedUser.count({ where: { lockedByAgentId: agent.id } });
    const headroom = Math.max(0, agent.uniqueUsersCap - alreadyOwned);
    const sample = selectCohort(pool, headroom);
    // Lock only users not already locked by anyone — race-safe.
    await prisma.trackedUser.updateMany({
      where: { externalId: { in: sample }, lockedByAgentId: null },
      data:  { lockedByAgentId: agent.id },
    });
    // Re-read which ones we actually own now (covers concurrent contention),
    // fetching attributes in the same round trip for enrollment flag snapshotting.
    const lockedRows = await prisma.trackedUser.findMany({
      where: { externalId: { in: sample }, lockedByAgentId: agent.id },
      select: { externalId: true, attributes: true },
    });
    const lockedIds = lockedRows.map((r) => r.externalId);
    if (lockedIds.length > 0) {
      // Partition: users with an existing (released) assignment row vs. truly new.
      // externalUserId is globally @unique, so createMany skipDuplicates would
      // silently skip returning users and never re-activate their row — the user
      // would be locked into the cohort but invisible to ownership/conversion
      // logic (2026-06-09 audit, M1). Mirror the continuous pass: upsert them.
      const existingCohortRows = await prisma.userAgentAssignment.findMany({
        where: { externalUserId: { in: lockedIds } },
        select: { externalUserId: true },
      });
      const existingCohortSet = new Set(existingCohortRows.map((r) => r.externalUserId));
      const cohortToCreate = lockedRows.filter((r) => !existingCohortSet.has(r.externalId));
      const cohortToUpsert = lockedRows.filter((r) => existingCohortSet.has(r.externalId));
      if (cohortToCreate.length > 0) {
        await prisma.userAgentAssignment.createMany({
          data: cohortToCreate.map(({ externalId: externalUserId, attributes }) => (
            { externalUserId, agentId: agent.id, startedAt: now, enrollmentFlags: snapshotEnrollmentFlags(attributes) }
          )),
        });
      }
      if (cohortToUpsert.length > 0) {
        await runChunked(cohortToUpsert, DB_WRITE_CONCURRENCY, ({ externalId: externalUserId, attributes }) =>
          prisma.userAgentAssignment.update({
            where: { externalUserId },
            data: {
              agentId: agent.id, startedAt: now, sendCount: 0, lastSentAt: null,
              windowCompletedAt: null, releasedAt: null, releaseReason: null,
              enrollmentFlags: snapshotEnrollmentFlags(attributes),
            },
          })
        );
      }
      for (const id of lockedIds) activeOwnerByUser.set(id, agent.id);
    }
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: now } });
    agent.cohortAssignedAt = now; // keep in-memory agent consistent for the rest of this run
    // This agent now processes only its locked cohort this run.
    eligibleUsersByAgent.set(agent.id, lockedIds);
  }
  // ─── End cohort materialization ───────────────────────────────────────────

  // ─── Continuous open-enrollment pass ──────────────────────────────────────
  // For each continuous agent: release users that left the segment, enroll new
  // members up to the soft cap, and narrow the lottery pool to enrolled users only
  // (so un-enrolled overflow can't be claimed at send time, bypassing the cap).
  // Runs after cohort materialization so any locks from fixed agents are visible.
  for (const agent of agents.filter((a) => a.enrollmentMode === "continuous")) {
    try {
      const audience = new Set(eligibleUsersByAgent.get(agent.id) ?? []);

      // Determine whether this agent has real segment targeting so we can decide
      // whether to run segment_exit releases. Funnel-stage-only continuous agents
      // skip segment_exit: the eligibility query is take()-limited so treating it
      // as a complete audience would wrongly release users beyond the fetch window.
      // Accepted trade-off: owned users of a funnel-only continuous agent who drift
      // out of stage fall out of the lottery pool but keep counting against the soft
      // cap until hold caps release them (hold_max_days/hold_max_sends).
      const segTargetingForAgent = parseSegmentTargeting(agent.segmentTargeting);
      const hasSegmentTargeting = !!(
        (segTargetingForAgent?.includes?.length ?? 0) > 0 || agent.targetSegmentName
      );

      // ── Step 1: release segment exits (frees cap headroom this tick) ────────
      const activeAssigns = await prisma.userAgentAssignment.findMany({
        where: { agentId: agent.id, releasedAt: null },
        select: { id: true, externalUserId: true, agentId: true, startedAt: true, sendCount: true },
      });
      let exitCount = 0;
      if (activeAssigns.length > 0 && hasSegmentTargeting) {
        const releaseAgentsById = new Map([
          [agent.id, buildReleaseAgentInfo(
            { id: agent.id, holdMaxDays: agent.holdMaxDays, holdMaxSends: agent.holdMaxSends, funnelStage: agent.funnelStage, enrollmentMode: "continuous" },
            hasSegmentTargeting,
            audience,
          )],
        ]);
        const enrichedAssigns = activeAssigns.map((a) => ({
          ...a,
          currentStage: null as string | null, // stage irrelevant; cohort_exit won't fire (empty targetStages)
        }));
        // Only act on segment_exit here — hold-cap releases are Phase −1's job
        // (already consumed this run); writing them as segment_exit would mislabel.
        const exits = classifyReleases(enrichedAssigns, releaseAgentsById, now)
          .filter((r) => r.reason === "segment_exit");
        exitCount = exits.length;
        if (exits.length > 0) {
          await prisma.userAgentAssignment.updateMany({
            where: { id: { in: exits.map((r) => r.id) } },
            data: { releasedAt: now, releaseReason: "segment_exit" },
          }).catch((err) => console.error(`[cron] continuous segment_exit release failed (agent ${agent.id}):`, err));
          await prisma.trackedUser.updateMany({
            where: { externalId: { in: exits.map((r) => r.externalUserId) }, lockedByAgentId: agent.id },
            data:  { lockedByAgentId: null },
          }).catch((err) => console.error(`[cron] continuous segment_exit lock clear failed (agent ${agent.id}):`, err));
          for (const r of exits) activeOwnerByUser.delete(r.externalUserId);
        }
      }

      // ── Step 2: count active enrollments after the release step ─────────────
      const activeCount = activeAssigns.length - exitCount;

      // ── Step 3: enroll new members up to soft cap ────────────────────────────
      // toEnroll = audience members not already actively owned by any agent
      let toEnroll = [...audience].filter((id) => activeOwnerByUser.get(id) === undefined);
      if (agent.uniqueUsersCap != null) {
        const headroom = Math.max(0, agent.uniqueUsersCap - activeCount);
        toEnroll = toEnroll.slice(0, headroom);
      }

      if (toEnroll.length > 0) {
        // Lock race-safely: only claim users not already locked by anyone else
        await prisma.trackedUser.updateMany({
          where: { externalId: { in: toEnroll }, lockedByAgentId: null },
          data: { lockedByAgentId: agent.id },
        });
        // Re-read winners (race contention) + fetch attributes for flag snapshot in same query.
        // Released users have their lock cleared at release time, so returning
        // segment members are re-claimed by the updateMany above like new users.
        const winnerRows = await prisma.trackedUser.findMany({
          where: { externalId: { in: toEnroll }, lockedByAgentId: agent.id },
          select: { externalId: true, attributes: true },
        });
        const winnerIds = winnerRows.map((r) => r.externalId);

        if (winnerIds.length > 0) {
          // Partition: users with an existing (released) assignment row vs. truly new.
          // createMany skipDuplicates would silently skip returning users because
          // externalUserId is @unique — upsert them instead to re-activate.
          const existingRows = await prisma.userAgentAssignment.findMany({
            where: { externalUserId: { in: winnerIds } },
            select: { externalUserId: true },
          });
          const existingSet = new Set(existingRows.map((r) => r.externalUserId));
          const toUpsert = winnerRows.filter((r) => existingSet.has(r.externalId));
          const toCreate = winnerRows.filter((r) => !existingSet.has(r.externalId));

          if (toCreate.length > 0) {
            await prisma.userAgentAssignment.createMany({
              data: toCreate.map(({ externalId: externalUserId, attributes }) => (
                { externalUserId, agentId: agent.id, startedAt: now, enrollmentFlags: snapshotEnrollmentFlags(attributes) }
              )),
            });
          }
          if (toUpsert.length > 0) {
            await runChunked(toUpsert, DB_WRITE_CONCURRENCY, ({ externalId: externalUserId, attributes }) => {
              const enrollmentFlags = snapshotEnrollmentFlags(attributes);
              return prisma.userAgentAssignment.update({
                where: { externalUserId },
                data: {
                  agentId: agent.id, startedAt: now, sendCount: 0, lastSentAt: null,
                  windowCompletedAt: null, releasedAt: null, releaseReason: null,
                  enrollmentFlags,
                },
              });
            });
          }
          for (const id of winnerIds) activeOwnerByUser.set(id, agent.id);
        }
      }

      // ── Step 4: narrow lottery pool to enrolled users only ───────────────────
      // Prevents un-enrolled audience overflow from being claimed at send time,
      // which would bypass the soft cap.
      const enrolledIds = [...activeOwnerByUser.entries()]
        .filter(([, aid]) => aid === agent.id)
        .map(([uid]) => uid)
        .filter((uid) => audience.has(uid));
      eligibleUsersByAgent.set(agent.id, enrolledIds);

    } catch (err) {
      console.error(`[cron] continuous enrollment pass failed for agent ${agent.id}:`, err);
    }
  }
  // ─── End continuous open-enrollment pass ──────────────────────────────────

  const lotteryMap = buildAgentLottery(eligibleUsersByAgent);
  // lotteryMap: Map<externalUserId, agentId>  — held in memory for this run
  // Inverted once: agentId → [externalUserId]. Avoids re-scanning the whole
  // lotteryMap per agent (was O(users × agents)).
  const lotteryUsersByAgent = new Map<string, string[]>();
  for (const [uid, aid] of lotteryMap) {
    const list = lotteryUsersByAgent.get(aid);
    if (list) list.push(uid);
    else lotteryUsersByAgent.set(aid, [uid]);
  }
  // ── End pre-assignment phase ──────────────────────────────────────────────

  // ─── Phase 0: Exploration window assignment ───────────────────────────────
  // Identify lapsed/connected users, create/classify their assignments,
  // and build inWindowMap (externalUserId → agentId) for this cron run.
  const cooldownDays = cooldownSetting ? parseInt(cooldownSetting.value, 10) : 90;
  const cooldownMs   = cooldownDays * 86_400_000;
  const windowMs     = 8 * 86_400_000;

  // Global dollars→Bibles multiplier for dynamic-handle impact copy (default 24).
  const givingMultiplier = parseMultiplier(multiplierSetting?.value);

  const explorationAgents = agents.filter(
    (a) => a.funnelStage === "lapsed" || a.funnelStage === "connected"
  );

  const inWindowMap = new Map<string, string>(); // externalUserId → agentId

  if (explorationAgents.length > 0) {
    const explorationPersonaIds = [
      ...new Set(explorationAgents.flatMap((a) => a.personaTargets.map((pt) => pt.personaId))),
    ];

    // Run user fetch and assignment fetch in parallel.
    // We use a broad assignment query (all exploration agents) since we can't
    // know user externalIds until explorationUsers resolves; instead we filter
    // by agentId to limit scope, then reconcile after both resolve.
    const [explorationUsers, existingAssignments] = await Promise.all([
      // Bound + project: this previously loaded EVERY user in the lapsed/connected
      // personas as full rows (attributes/featureVector/channelStats JSON) with no
      // limit — a 10k+ blow-up that ignored the per-run cap. Select only the fields
      // buildEligibleAgentsByUser / classifyExplorationWindows read, capped at the
      // same safety ceiling as recruitment.
      prisma.trackedUser.findMany({
        where: { personaId: { in: explorationPersonaIds } },
        select: { externalId: true, personaId: true, funnelStage: true, attributes: true, channelStats: true },
        take: MAX_FETCH_LIMIT,
      }),
      prisma.userAgentAssignment.findMany({
        where: { agentId: { in: explorationAgents.map((a) => a.id) } },
        take: MAX_FETCH_LIMIT,
      }),
    ]);
    const assignmentByUser = new Map(existingAssignments.map((a) => [a.externalUserId, a]));

    // Users actively owned by a NON-exploration agent must not enter a window:
    // they'd classify as Class A (their assignment row belongs to another agent,
    // so it isn't in assignmentByUser), the createMany would silently skip on
    // the unique externalUserId, but inWindowMap would still route them sends
    // from the exploration agent (2026-06-09 audit, C3).
    const explorationAgentIds = new Set(explorationAgents.map((a) => a.id));
    const explorationCandidates = explorationUsers.filter((u) => {
      const owner = activeOwnerByUser.get(u.externalId);
      return owner === undefined || explorationAgentIds.has(owner);
    });

    const eligibleAgentsByUser = buildEligibleAgentsByUser(explorationAgents, explorationCandidates, pushTargetingMode);
    const classification = classifyExplorationWindows(
      explorationCandidates,
      assignmentByUser,
      eligibleAgentsByUser,
      { now, windowMs, cooldownMs },
    );
    const { toCreate, toReset, toClose } = classification;
    for (const [uid, aid] of classification.inWindowMap) inWindowMap.set(uid, aid);

    // Build externalId → attributes map for enrollment flag snapshotting (Gaps 2 & 3).
    const explorationAttrsByUser = new Map(explorationUsers.map((u) => [u.externalId, u.attributes]));

    // Apply DB writes:
    // Class A — single createMany (1 round trip for any number of new users)
    if (toCreate.length > 0) {
      await prisma.userAgentAssignment.createMany({
        data: toCreate.map(({ externalUserId, agentId }) => ({
          externalUserId, agentId, sendCount: 0, windowCompletedAt: null,
          enrollmentFlags: snapshotEnrollmentFlags(explorationAttrsByUser.get(externalUserId)),
        })),
        skipDuplicates: true,
      });
    }
    // Class D — chunked parallel upserts (reset per-user with possibly different agentId)
    if (toReset.length > 0) {
      await runChunked(toReset, DB_WRITE_CONCURRENCY, ({ externalUserId, agentId }) =>
        prisma.userAgentAssignment.update({
          where: { externalUserId },
          data: {
            agentId, startedAt: now, sendCount: 0, windowCompletedAt: null,
            // A reset starts a fresh window, so any prior release is over (C3).
            releasedAt: null, releaseReason: null,
            enrollmentFlags: snapshotEnrollmentFlags(explorationAttrsByUser.get(externalUserId)),
          },
        })
      );
    }
    if (toClose.length > 0) {
      await prisma.userAgentAssignment.updateMany({
        where: { id: { in: toClose } },
        data: { windowCompletedAt: now },
      });
    }
  }
  // ─── End Phase 0 ─────────────────────────────────────────────────────────────

  // Derived once from inWindowMap — used in every agent's user query
  const inWindowUserIdSet = new Set(inWindowMap.keys());
  // Inverted once: agentId → [externalUserId]. Avoids re-scanning inWindowMap
  // per agent (was O(users × agents)).
  const inWindowUsersByAgent = new Map<string, string[]>();
  for (const [uid, aid] of inWindowMap) {
    const list = inWindowUsersByAgent.get(aid);
    if (list) list.push(uid);
    else inWindowUsersByAgent.set(aid, [uid]);
  }

  // Per-agent metric accumulators for ModelMetric writes
  const agentMetrics = new Map<string, { sent: number; suppressed: number; errors: number }>();

  for (const agent of agents) {
    const metricsBefore = { sent: totalSent, suppressed: totalSuppressed, errors: totalErrors };
    const personaIds = agent.personaTargets.map((pt) => pt.personaId);
    if (personaIds.length === 0) continue;
    const suppress = { freqCap: 0, smartSuppress: 0, dailyCap: 0, quietHours: 0, targetFilter: 0, uniqueUsersCap: 0, blackout: 0 };

    // Derive the users assigned to this agent by the lottery
    const assignedUserIds = lotteryUsersByAgent.get(agent.id) ?? [];

    // Exclude in-window users from lottery pipeline (they're handled separately below)
    let lotteryUserIds = assignedUserIds.filter((id) => !inWindowUserIdSet.has(id));

    // Send-timing fairness: when prioritizeLastSeen is on, hold back users whose
    // preferred hour is far from now (they send in their matching hourly run).
    // No per-run ceiling — dailySendCap is the ramp knob.
    {
      const partition = partitionByPreferredHour(lotteryUserIds, {
        prioritizeLastSeen: agent.schedulingRule?.prioritizeLastSeen !== false,
        currentHour: now.getUTCHours(),
        preferredHourByUser: preferredHourByAgent.get(agent.id) ?? new Map<string, number | null>(),
      });
      lotteryUserIds = partition.kept;
    }

    // Per-run send quota — the lesser of the remaining daily budget and the
    // per-run ceiling (MAX_SENDS_PER_AGENT_PER_RUN). The per-run ceiling is what
    // keeps a large cohort with a high dailySendCap from trying to dispatch the
    // whole budget in one run and blowing the 300s timeout; the remainder of the
    // daily budget rolls into later hourly runs. Counts only confirmed sends
    // (brazeSendId set) so Braze-failed attempts don't burn the budget.
    {
      const sentToday = await prisma.userDecision.count({
        where: {
          agentId:     agent.id,
          sentAt:      { gte: todayStart },
          brazeSendId: { not: null },
        },
      });
      const quota = resolvePerRunQuota(agent.dailySendCap, sentToday);
      const trimmed = trimToCap(lotteryUserIds, quota);
      lotteryUserIds = trimmed.kept;
      suppress.dailyCap += trimmed.suppressed;
    }

    // uniqueUsersCap is enforced at ENROLLMENT, not here: fixed agents cap their
    // cohort at materialization, continuous agents cap concurrent enrollment via
    // headroom (cap − active). The lottery pool is already restricted to enrolled
    // users, so it can never exceed the cap. The old lifetime distinct-sent trim
    // here contradicted those concurrent semantics: it permanently blocked repeat
    // sends once `cap` distinct users had ever been reached, and choked fresh
    // cohorts after re-materialization (2026-06-09 audit, I4).

    // Lock lottery users to this agent — prevents other agents from grabbing them
    // in subsequent cron runs. Locks are released when the agent is paused or deleted.
    // Condition: only lock users not already locked by another agent (idempotency).
    if (lotteryUserIds.length > 0) {
      await prisma.trackedUser.updateMany({
        where: { externalId: { in: lotteryUserIds }, lockedByAgentId: null },
        data:  { lockedByAgentId: agent.id },
      });
    }

    // Check if this agent has any in-window users to process
    const hasInWindowUsers = (inWindowUsersByAgent.get(agent.id)?.length ?? 0) > 0;

    // If no lottery users and no in-window users, skip agent entirely
    if (lotteryUserIds.length === 0 && !hasInWindowUsers) continue;

    // Build variant detail lookup: variantId → { channel, body, title, cta, deeplink, brazeCampaignId, brazeVariantId }
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      cta: string | null;
      deeplink: string | null;
      brazeCampaignId: string | null;
      brazeVariantId: string | null;
      givingHandleStrategy: GivingHandleStrategy | null;
      givingFrequency: GivingFrequency;
      givingHandleDefaultUsd: number;
      iconImageUrl: string | null;
    }>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        // Agent-level bulk override wins over the per-variant deeplink. Applied
        // here (not in send-grouping) so identical resolved links collapse into
        // one Braze send group. Edge: when an override is set it also supersedes
        // GIVING_LINK_SENTINEL — documented precedence, override URL takes the link.
        variantMeta.set(v.id, {
          channel:         msg.channel,
          body:            v.body,
          title:           v.title ?? null,
          cta:             v.cta ?? null,
          deeplink:        agent.deeplinkOverride ?? v.deeplink ?? null,
          brazeCampaignId: msg.brazeCampaignId ?? null,
          brazeVariantId:  v.brazeVariantId ?? null,
          givingHandleStrategy: deriveGivingStrategy(v.subcategory ?? null, v.actionFeatures),
          givingFrequency: deriveGivingFrequency(v.actionFeatures),
          givingHandleDefaultUsd: deriveGivingDefaultUsd(v.actionFeatures),
          iconImageUrl:    v.iconImageUrl ?? null,
        });
      }
    }

    // Evaluate agent-level scheduling checks once (not per user)
    const rule = agent.schedulingRule;

    // Resolve quiet hours mode (backward compat: timezone==="user" → schedule, any tz → suppress, absent → none)
    const quietHoursRaw = parseQuietHours(rule?.quietHours);
    const qhMode = quietHoursRaw?.mode ?? (quietHoursRaw?.timezone === "user" ? "schedule" : quietHoursRaw ? "suppress" : "none");
    const quietHoursConfig = qhMode === "suppress" ? quietHoursRaw : null;
    const scheduleDeliverHour = qhMode === "schedule" ? (quietHoursRaw?.deliverAtHour ?? 8) : null;

    // Global blackout calendar dates ("YYYY-MM-DD") on which no send may be scheduled.
    const blackoutDatesRaw = rule?.blackoutDates;
    const blackoutDates: string[] = Array.isArray(blackoutDatesRaw)
      ? blackoutDatesRaw.filter((d): d is string => typeof d === "string")
      : [];

    // Pre-seed PersonaArmStats for all persona × variant combinations so
    // concurrent decideForUser calls don't race on the upsert — run in parallel.
    const allVariantIds = agent.messages.flatMap((m) => m.variants.map((v) => v.id));
    // Push localization: load active translations for this agent's variants once
    // per run (batch — avoids N+1). Cloned variants (sourceTemplateId != null) have
    // no translation rows of their own — translations live on the template variant.
    // Resolve by loading translations for the union of (variantIds ∪ templateIds),
    // then inheriting the template map for any clone with no own rows.
    const localizeEnabled = agent.localizePush;
    let translationsByVariant = new Map<string, Map<string, import("@/lib/push-locale").LocalizedCopy>>();
    if (localizeEnabled && allVariantIds.length > 0) {
      const allVariants = agent.messages.flatMap((m) => m.variants);
      const templateIds = allVariants
        .map((v) => v.sourceTemplateId)
        .filter((id): id is string => id != null);
      const lookupIds = Array.from(new Set([...allVariantIds, ...templateIds]));
      const rows = await prisma.messageVariantTranslation.findMany({
        where: { messageVariantId: { in: lookupIds }, status: "active" },
        select: { messageVariantId: true, language: true, title: true, body: true },
      });
      translationsByVariant = resolveTranslationsByVariant(rows, allVariants);
    }
    // Verse-push experiment: variants flagged with VERSE_PUSH_SENTINEL resolve
    // their copy from the CampaignContent verse pool at send time.
    const strategyByVariant = new Map<string, VerseStrategy>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        if (v.body === VERSE_PUSH_SENTINEL && isVerseStrategy(v.subcategory)) {
          strategyByVariant.set(v.id, v.subcategory);
        }
      }
    }
    let versePool: VersePool | undefined;
    if (strategyByVariant.size > 0) versePool = await loadVersePool(prisma);
    // VOTD dynamic variants: liquid-tag copy resolved per user-local date + language.
    const votdVariantIds = new Set<string>();
    // Guided Prayer dynamic variants: resolved from prayer.youversionapi.com per UTC date.
    const gpVariantIds = new Set<string>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        if (hasVotdTags(v.title ?? null, v.body)) votdVariantIds.add(v.id);
        if (hasGpTags(v.title ?? null, v.body)) gpVariantIds.add(v.id);
      }
    }
    const localization = { enabled: localizeEnabled, translationsByVariant, versePool, strategyByVariant, votdVariantIds, gpVariantIds };
    const initialAlpha = agent.algorithm !== "linucb" ? 1 : 0;
    const initialBeta  = agent.algorithm !== "linucb" ? 30 : 0;
    // Seed only the MISSING persona×variant arms. The old code upserted every
    // combination every run (update:{} no-op for existing) — hundreds of no-op
    // round-trips per agent per run. Load existing keys once, then a single
    // createMany(skipDuplicates) for the gaps (steady state: 1 read, 0 writes).
    {
      const existingArms = await prisma.personaArmStats.findMany({
        where: { agentId: agent.id },
        select: { personaId: true, variantId: true },
      });
      const have = new Set(existingArms.map((a) => `${a.personaId}:${a.variantId}`));
      const missingArms = personaIds.flatMap((personaId) =>
        allVariantIds
          .filter((variantId) => !have.has(`${personaId}:${variantId}`))
          .map((variantId) => ({
            personaId, agentId: agent.id, variantId,
            alpha: initialAlpha, beta: initialBeta, tries: 0, wins: 0,
          })),
      );
      if (missingArms.length > 0) {
        await prisma.personaArmStats.createMany({ data: missingArms, skipDuplicates: true });
      }
    }

    // Seed LinUCBArm identity rows for each variant so cold-start LinUCB agents can select.
    if (agent.algorithm === "linucb") {
      const fresh = new LinUCB().initialArm(FEATURE_DIM);
      await runChunked(allVariantIds, DB_WRITE_CONCURRENCY, (variantId) =>
        prisma.linUCBArm.upsert({
          where: { agentId_variantId: { agentId: agent.id, variantId } },
          create: {
            agentId: agent.id,
            variantId,
            aInv: fresh.aInv as unknown as Prisma.InputJsonValue,
            b: fresh.b as unknown as Prisma.InputJsonValue,
            tries: 0,
          },
          update: {}, // never overwrite existing learned state
        })
      );
    }

    // For LinUCB: load per-agent LinUCB arms once before the page loop (arms are keyed by agentId,
    // constant for the whole run, and stale-reset has already fired). Re-loading every page is wasteful.
    const linucbArmsByVariant: Map<string, { id: string; aInv: number[]; b: number[] }> = new Map();
    if (agent.algorithm === "linucb" && lotteryUserIds.length > 0) {
      const freshArm = new LinUCB().initialArm(FEATURE_DIM);
      const allArms = await prisma.linUCBArm.findMany({ where: { agentId: agent.id, variantId: { in: allVariantIds } } });
      const staleArms = allArms.filter(
        (r) =>
          !(Array.isArray(r.aInv) && (r.aInv as number[]).length === FEATURE_DIM * FEATURE_DIM) ||
          !(Array.isArray(r.b) && (r.b as number[]).length === FEATURE_DIM)
      );
      if (staleArms.length > 0) {
        await runChunked(staleArms, DB_WRITE_CONCURRENCY, (r) =>
          prisma.linUCBArm.update({
            where: { agentId_variantId: { agentId: r.agentId, variantId: r.variantId } },
            data: {
              aInv: freshArm.aInv as unknown as Prisma.InputJsonValue,
              b: freshArm.b as unknown as Prisma.InputJsonValue,
              tries: 0,
            },
          })
        );
      }
      const staleIds = new Set(staleArms.map((s) => s.variantId));
      for (const r of allArms) {
        const isStale = staleIds.has(r.variantId);
        const aInv = isStale ? freshArm.aInv : (r.aInv as number[]);
        const b = isStale ? freshArm.b : (r.b as number[]);
        linucbArmsByVariant.set(r.variantId, { id: r.variantId, aInv, b });
      }
    }

    // Page through users in this agent's target personas (500 at a time).
    // Skip the loop entirely when there are no lottery users to avoid a wasted DB round trip.
    let cursor: string | undefined;
    while (lotteryUserIds.length > 0) {
      const users = await prisma.trackedUser.findMany({
        where: {
          personaId:  { in: personaIds },
          externalId: { in: lotteryUserIds },
        },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      const userExternalIds = users.map((u) => u.externalId);

      // 4b. Bulk frequency cap check and 4d. Global daily cap — run in parallel (independent reads)
      const freqCap = parseFrequencyCap(rule?.frequencyCap);
      const hasLotteryFreqCap = rule && typeof freqCap?.maxSends === "number";
      const lotteryPeriodMs: Record<string, number> = {
        day:    86_400_000,
        week:   7  * 86_400_000,
        biweek: 14 * 86_400_000,
        month:  30 * 86_400_000,
      };
      const lotteryFreqWindowStart = hasLotteryFreqCap
        ? new Date(now.getTime() - (lotteryPeriodMs[freqCap!.period ?? "week"] ?? lotteryPeriodMs.week))
        : null;

      const [lotteryRecentDecisions, sentTodayRows, recentSendsByUser] = await Promise.all([
        hasLotteryFreqCap
          ? prisma.userDecision.groupBy({
              by: ["userId"],
              where: {
                agentId: agent.id,
                userId:  { in: userExternalIds },
                sentAt:  { gte: lotteryFreqWindowStart! },
              },
              _count: { userId: true },
            })
          : Promise.resolve([] as Array<{ userId: string; _count: { userId: number } }>),
        // 4d. Global daily cap — cross-agent guard (no agentId filter intentional).
        // Only count confirmed sends (brazeSendId set) — phantom decisions where
        // the Braze API call failed should not block the user from being retried.
        prisma.userDecision.findMany({
          where: {
            userId: { in: userExternalIds },
            sentAt: { gte: todayStart },
            brazeSendId: { not: null },
            // intentionally no agentId filter — cross-agent
          },
          select:   { userId: true },
          distinct: ["userId"],
        }),
        // Recency penalty: most recent send per (userId, variantId) in last 7 days
        prisma.userDecision.findMany({
          where: {
            agentId:  agent.id,
            userId:   { in: userExternalIds },
            sentAt:   { gte: new Date(now.getTime() - 7 * 86_400_000) },
            messageVariantId: { not: null },
          },
          select: { userId: true, messageVariantId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
        }),
      ]);

      // Pre-group recent sends by userId once (rows stay sentAt-desc ordered).
      // Avoids re-scanning the whole list per user (was O(users × sends)).
      const recentSendsByUserId = new Map<string, typeof recentSendsByUser>();
      for (const r of recentSendsByUser) {
        const list = recentSendsByUserId.get(r.userId);
        if (list) list.push(r);
        else recentSendsByUserId.set(r.userId, [r]);
      }

      const freqCappedUserIds = new Set<string>();
      if (hasLotteryFreqCap) {
        const countByUser = new Map(lotteryRecentDecisions.map((r) => [r.userId, r._count.userId]));
        for (const u of users) {
          const count = countByUser.get(u.externalId) ?? 0;
          if (count >= freqCap!.maxSends!) {
            freqCappedUserIds.add(u.externalId);
          }
        }
      }
      const sentTodayIds = new Set(sentTodayRows.map((r) => r.userId));

      // 4c. Smart suppression — filter out chronically low-reward users using already-loaded user data
      const smartSuppressedUserIds = new Set<string>();
      if (rule?.smartSuppress) {
        for (const u of users) {
          if (u.totalDecisions >= 5) {
            const avgReward = u.totalReward / u.totalDecisions;
            if (avgReward < -rule.suppressThresh) {
              smartSuppressedUserIds.add(u.externalId);
            }
          }
        }
      }

      // 4d. Quiet hours — per user, using the user's own timezone from attributes.
      // Falls back to the agent's configured timezone when the user has none stored.
      const quietHoursUserIds = new Set<string>();
      if (quietHoursConfig?.start && quietHoursConfig?.end) {
        const agentTz = quietHoursConfig.timezone ?? "UTC";
        for (const u of users) {
          const attrs = u.attributes as Record<string, unknown>;
          const userTz = typeof attrs?.timezone === "string" ? attrs.timezone : agentTz;
          if (isInQuietHours(quietHoursConfig.start, quietHoursConfig.end, userTz, now)) {
            quietHoursUserIds.add(u.externalId);
          }
        }
      }

      // Count suppressed users (freq cap + smart suppress + global daily cap + quiet hours)
      for (const u of users) {
        const isFreqCapped  = freqCappedUserIds.has(u.externalId);
        const isSmartSup    = smartSuppressedUserIds.has(u.externalId);
        const isDailyCapped = sentTodayIds.has(u.externalId);
        const isQuietHours  = quietHoursUserIds.has(u.externalId);
        if (isFreqCapped || isSmartSup || isDailyCapped || isQuietHours) {
          totalSuppressed++;
          if (isFreqCapped)  suppress.freqCap++;
          if (isSmartSup)    suppress.smartSuppress++;
          if (isDailyCapped) suppress.dailyCap++;
          if (isQuietHours)  suppress.quietHours++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) =>
          !freqCappedUserIds.has(u.externalId) &&
          !smartSuppressedUserIds.has(u.externalId) &&
          !sentTodayIds.has(u.externalId) &&
          !quietHoursUserIds.has(u.externalId)
      );

      // Channel eligibility: newsletter_push_enabled / newsletter_email_enabled must not be
      // explicitly false. Absent or true = eligible (opt-out model; HT default: true).
      // Checked in-memory (JSONB boolean comparison via Prisma path filter is fragile).
      const hasPushMessages = agent.messages.some((m) => m.channel === "push");
      const hasEmailMessages = agent.messages.some((m) => m.channel === "email");
      const channelFiltered = eligibleUsers.filter((u) => {
        const attrs = (u.attributes as Record<string, unknown>) ?? {};
        if (hasPushMessages && isNewsletterOptedOut(attrs, "push")) return false;
        if (hasEmailMessages && isNewsletterOptedOut(attrs, "email")) return false;
        return true;
      });
      suppress.targetFilter += eligibleUsers.length - channelFiltered.length;

      // Preferred-channel gate: push agents only target users whose behavioral
      // preferred external channel is push (mode-dependent; see channel-preference.ts).
      const prefFiltered = hasPushMessages
        ? channelFiltered.filter((u) =>
            isPushPreferred(
              (u.attributes as Record<string, unknown>) ?? {},
              u.channelStats,
              u.funnelStage,
              pushTargetingMode,
            ),
          )
        : channelFiltered;
      suppress.targetFilter += channelFiltered.length - prefFiltered.length;

      // Language filter: English-only sends by default. When the agent opts into
      // localization, do NOT force EN — every recipient gets copy (English fallback
      // or strict skip if no translation). Applies to all channels, not just push.
      const hasSendableMessages = agent.messages.length > 0;
      const effectiveAgentLang =
        agent.languageFilter && agent.languageFilter !== "all"
          ? agent.languageFilter
          : (hasSendableMessages && !localizeEnabled) ? "en" : null;
      const langFiltered = effectiveAgentLang
        ? prefFiltered.filter((u) => {
            const attrs = u.attributes as Record<string, unknown>;
            const lang = attrs?.language_tag as string | undefined;
            return lang?.startsWith(effectiveAgentLang) === true;
          })
        : prefFiltered;
      suppress.targetFilter += prefFiltered.length - langFiltered.length;

      // Apply targetFilter in-memory on the already-loaded page (V1: no SQL-side JSON filtering)
      const targetFiltered = langFiltered.filter((u) => {
        if (!agent.targetFilter) return true;
        return evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
          attributes: u.attributes as Record<string, unknown>,
          computed: buildComputedKeys(u),
        });
      });
      suppress.targetFilter += langFiltered.length - targetFiltered.length;

      const quietFiltered = targetFiltered;

      // Batch-decide for lottery users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createManyAndReturn call.
      let byVariant: Record<string, VariantSendGroup> = {};

      if (quietFiltered.length > 0) {
        // Collect unique personaIds among eligible users
        const pagePersonaIds = [...new Set(
          quietFiltered.map((u) => u.personaId).filter(Boolean) as string[]
        )];

        // Load all arm stats for this agent × page personas in one query
        const pageArmStatsRows = await prisma.personaArmStats.findMany({
          where: {
            agentId:   agent.id,
            personaId: { in: pagePersonaIds },
            variantId: { in: allVariantIds },
          },
        });

        // Index: personaId → variantId → BanditArm
        const pageArmsByPersona = new Map<string, Map<string, BanditArm>>();
        for (const row of pageArmStatsRows) {
          if (!pageArmsByPersona.has(row.personaId)) {
            pageArmsByPersona.set(row.personaId, new Map());
          }
          pageArmsByPersona.get(row.personaId)!.set(row.variantId, { id: row.variantId, stats: row });
        }

        // Load per-user arm stats for personalised blending (Thompson/EpsilonGreedy only)
        const pageUserIds = quietFiltered.map((u) => u.externalId);
        const pageUserArmRows = agent.algorithm !== "linucb"
          ? await prisma.userArmStats.findMany({
              where: { userId: { in: pageUserIds }, agentId: agent.id, variantId: { in: allVariantIds } },
            })
          : [];
        // Index: userId → variantId → {alpha,beta,tries,wins}
        const userArmsByUser = new Map<string, Map<string, typeof pageUserArmRows[number]>>();
        for (const row of pageUserArmRows) {
          if (!userArmsByUser.has(row.userId)) userArmsByUser.set(row.userId, new Map());
          userArmsByUser.get(row.userId)!.set(row.variantId, row);
        }

        // Variants with channel for in-memory selection
        const pageVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const lotteryDecisionInputs: Array<{ user: typeof quietFiltered[number]; variantId: string; scheduledAt: Date; inLocalTime: boolean; contextVector?: number[] }> = [];
        for (const user of quietFiltered) {
          const pid = user.personaId as string | null;
          if (!pid) continue;

          // Build recency penalty map for this user
          const userRecent = recentSendsByUserId.get(user.externalId) ?? [];
          const recencyPenalties: Record<string, number> = {};
          for (const r of userRecent) {
            const vid = r.messageVariantId;
            if (!vid || recencyPenalties[vid] !== undefined) continue; // keep most recent only
            const daysSince = (now.getTime() - r.sentAt.getTime()) / 86_400_000;
            recencyPenalties[vid] = recencyMultiplier(daysSince);
          }

          let selectedVariantId: string;
          // Hoisted so decisionContext can include it for LinUCB reward path
          let lotteryContextVector: number[] | undefined;

          if (agent.algorithm === "linucb") {
            // LinUCB: select variant from the user's feature context
            const linucbArms = pageVariants
              .map((v) => linucbArmsByVariant.get(v.id))
              .filter(Boolean) as Array<{ id: string; aInv: number[]; b: number[] }>;
            if (linucbArms.length === 0) continue;

            // Use stored feature vector only if it matches the current FEATURE_DIM;
            // stale vectors from the old 44-dim layout are recomputed on the fly.
            const storedVec = user.featureVector as number[];
            const context: number[] =
              Array.isArray(storedVec) && storedVec.length === FEATURE_DIM
                ? storedVec
                : computeFeatureVector({
                    totalDecisions:   user.totalDecisions,
                    totalConversions: user.totalConversions,
                    totalReward:      user.totalReward,
                    channelStats:     user.channelStats,
                    hourlyStats:      user.hourlyStats,
                    dailyStats:       user.dailyStats,
                    attributes:       (user.attributes as Record<string, unknown>) ?? {},
                  });
            lotteryContextVector = context;
            // linucbArms is non-empty (guarded above)
            selectedVariantId = selectVariant({ algorithm: "linucb", linucbArms, context })!;
          } else {
            // Thompson / EpsilonGreedy: blend persona prior with user-specific posterior
            // Fall back to uniform priors (alpha=1, beta=30) for cold-start personas with no arm stats yet
            const personaArms = pageArmsByPersona.get(pid) ?? new Map(
              pageVariants.map((v) => [v.id, { id: v.id, stats: { alpha: 1, beta: 30, tries: 0, wins: 0 } } as BanditArm])
            );
            const userArms = userArmsByUser.get(user.externalId) ?? new Map();

            const arms: BanditArm[] = pageVariants
              .map((v) => {
                const pa = personaArms.get(v.id);
                return pa ? blendArm(pa, userArms.get(v.id)) : undefined;
              })
              .filter(Boolean) as BanditArm[];
            if (arms.length === 0) continue;

            // arms is non-empty (guarded above)
            selectedVariantId = selectVariant(
              agent.algorithm === "epsilon_greedy"
                ? { algorithm: "epsilon_greedy", arms, epsilon: agent.epsilon }
                : { algorithm: "thompson", arms, recencyPenalties },
            )!;
          }

          // Content cards and slideup-only in-app messages are not time-sensitive:
          // content cards persist in the inbox; slideup-only has no push notification.
          // Skip user-timing resolution and scheduling for these channels so they
          // send immediately and never get held by quiet hours or the 2-hour window.
          const selectedMeta = variantMeta.get(selectedVariantId);
          const sendImmediately =
            selectedMeta?.channel === "content-card" ||
            selectedMeta?.channel === "modal-iam" ||
            (selectedMeta?.channel === "in-app" && selectedMeta.title === null);

          let scheduledAt: Date;
          let isFallback: boolean;
          if (sendImmediately) {
            scheduledAt = now;
            isFallback = false;
          } else {
            // Schedule mode: force in_local_time via Braze at the configured hour.
            // Otherwise prefer the user's last-seen hour; fall back to their historical peak hour.
            const effectiveSendHour = scheduleDeliverHour !== null ? null : (user.preferredSendHour ?? peakActivityHour(user.hourlyStats));
            const effectiveSendMinute = scheduleDeliverHour !== null ? null : (user.preferredSendHour !== null ? (user.preferredSendMinute ?? null) : null);
            ({ scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
              effectiveSendHour,
              effectiveSendMinute,
              scheduleDeliverHour ?? agent.fallbackSendHour ?? 8,
              now,
            ));

            // Guard: verify the *delivery time* itself doesn't land in quiet hours.
            // The pre-filter checks quiet hours at cron-run time; a user at 9pm ET
            // passes that check, but if their preferred UTC hour maps to 11pm ET
            // the send would arrive in quiet hours. Fall back to in_local_time
            // (8am local via Braze) instead.
            if (!isFallback && quietHoursConfig?.start && quietHoursConfig?.end) {
              const attrs = user.attributes as Record<string, unknown>;
              const agentTz = quietHoursConfig.timezone ?? "UTC";
              const userTz = typeof attrs?.timezone === "string" ? attrs.timezone : agentTz;
              if (isInQuietHours(quietHoursConfig.start, quietHoursConfig.end, userTz, scheduledAt)) {
                ({ scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
                  null,
                  null,
                  scheduleDeliverHour ?? agent.fallbackSendHour ?? 8,
                  now,
                ));
              }
            }

            // Global blackout: suppress sends landing on a blackout calendar date.
            if (isBlackoutDate(scheduledAt, blackoutDates)) {
              totalSuppressed++;
              suppress.blackout++;
              continue;
            }

            // Timing window: only select users whose preferred send time is within the next 2 hours.
            // Users on the fallback path (isFallback=true) are always eligible.
            if (!isFallback && scheduledAt.getTime() - now.getTime() > 2 * 60 * 60 * 1000) continue;
          }

          lotteryDecisionInputs.push({
            user,
            variantId: selectedVariantId,
            scheduledAt,
            inLocalTime: isFallback,
            ...(agent.algorithm === "linucb" && lotteryContextVector ? { contextVector: lotteryContextVector } : {}),
          });
        }

        // Bulk-create all UserDecision records in one createManyAndReturn call
        if (lotteryDecisionInputs.length > 0) {
          const decisionData2 = lotteryDecisionInputs.map(({ user, variantId, scheduledAt, inLocalTime, contextVector }) => {
            const pid = user.personaId as string | null;
            const arms = pid ? pageArmsByPersona.get(pid) : null;
            const variantScores: Record<string, number> = {};
            if (arms) {
              for (const [vid, arm] of arms) {
                const a = arm.stats.alpha;
                const b = arm.stats.beta;
                variantScores[vid] = a + b > 0 ? a / (a + b) : 0;
              }
            }
            const attrs = user.attributes as Record<string, unknown>;
            const userTz = typeof attrs.timezone === "string" ? attrs.timezone : "America/New_York";
            const scheduledLocalHour = inLocalTime
              ? (scheduleDeliverHour ?? agent.fallbackSendHour ?? 8)
              : localHourOf(scheduledAt, userTz);
            return {
              agentId:             agent.id,
              userId:              user.externalId,
              messageVariantId:    variantId,
              channel:             pageVariants.find((v) => v.id === variantId)?.channel ?? "push",
              scheduledFor:        scheduledAt,
              scheduledLocalHour,
              decisionContext:  {
                ...(pid ? { personaId: pid, selectedVariantId: variantId, variantScores } : {}),
                inLocalTime,
                ...(agent.algorithm === "linucb" && contextVector ? { contextVector } : {}),
              } as unknown as Prisma.InputJsonValue,
            };
          });

          const createdLotteryDecisions = await prisma.userDecision.createManyAndReturn({
            data: decisionData2,
          });

          const lotteryDecisionIdByUser = new Map<string, string>();
          for (let i = 0; i < lotteryDecisionInputs.length; i++) {
            const created = createdLotteryDecisions[i];
            if (created) lotteryDecisionIdByUser.set(lotteryDecisionInputs[i].user.externalId, created.id);
          }

          // Group by variant + scheduled time for batch sending
          const votdContent = await prepareVotdContent(prisma, lotteryDecisionInputs, votdVariantIds);
          const gpContent = await prepareGpContent(prisma, lotteryDecisionInputs, gpVariantIds);
          byVariant = groupDecisionsByVariant(lotteryDecisionInputs, variantMeta, lotteryDecisionIdByUser, { ...localization, votdContent, gpContent }, givingMultiplier);
        }
      }

      // Send all variant groups in parallel batches
      {
        const { sent, errors, sentUserIds } = await dispatchSendGroups(
          Object.values(byVariant),
          { brazeClient, factory, agentId: agent.id, prisma },
        );
        totalSent += sent;
        totalErrors += errors;

        // Persist the lottery winner as the durable owner (spec A4) + bump send accounting.
        // These users passed the ownership filter, so any existing row is absent, released,
        // or already owned by this agent. Partition into claims vs. continuations.
        if (sentUserIds.length > 0) {
          const existing = await prisma.userAgentAssignment.findMany({
            where: { externalUserId: { in: sentUserIds } },
            select: { externalUserId: true, agentId: true, releasedAt: true },
          });
          const existingByUser = new Map(existing.map((e) => [e.externalUserId, e]));
          const continueIds: string[] = []; // active row already owned by this agent → increment
          const claimIds: string[] = [];    // no row / released / other-agent-released → (re)claim
          for (const uid of sentUserIds) {
            const row = existingByUser.get(uid);
            if (row && row.releasedAt === null && row.agentId === agent.id) continueIds.push(uid);
            else claimIds.push(uid);
          }
          // Build attributes lookup for enrollment flag snapshot on claim rows.
          const attributesByUser = new Map(users.map((u) => [u.externalId, u.attributes]));
          await Promise.all([
            continueIds.length > 0
              ? prisma.userAgentAssignment.updateMany({
                  where: { externalUserId: { in: continueIds } },
                  data: { sendCount: { increment: 1 }, lastSentAt: now },
                })
              : Promise.resolve(),
            // Claims overwrite the unique externalUserId row (spec A1: fresh ownership).
            runChunked(claimIds, DB_WRITE_CONCURRENCY, (uid) => {
              const enrollmentFlags = snapshotEnrollmentFlags(attributesByUser.get(uid));
              return prisma.userAgentAssignment
                .upsert({
                  where: { externalUserId: uid },
                  create: { externalUserId: uid, agentId: agent.id, startedAt: now, sendCount: 1, lastSentAt: now, enrollmentFlags },
                  update: {
                    agentId: agent.id, startedAt: now, sendCount: 1, lastSentAt: now,
                    windowCompletedAt: null, releasedAt: null, releaseReason: null,
                    enrollmentFlags,
                  },
                })
                .catch((err) => console.error(`[cron] lottery assignment upsert failed for ${uid}:`, err));
            }),
          ]);
        }
      }

      if (users.length < 500) break;
    }

    // ── In-window sub-pool for this agent ──────────────────────────────────
    const inWindowUserIdsForAgent = inWindowUsersByAgent.get(agent.id) ?? [];

    if (inWindowUserIdsForAgent.length > 0) {
      // Fetch users and assignments in parallel — independent reads
      const [windowUsers, windowAssignments] = await Promise.all([
        prisma.trackedUser.findMany({
          where: { externalId: { in: inWindowUserIdsForAgent } },
        }),
        prisma.userAgentAssignment.findMany({
          where: { externalUserId: { in: inWindowUserIdsForAgent } },
        }),
      ]);
      const windowAssignmentMap = new Map(
        windowAssignments.map((a) => [a.externalUserId, a])
      );

      // Determine current ET hour and day-of-week for timing check
      const etParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday:  "short",
        hour:     "2-digit",
        hour12:   false,
      }).formatToParts(now);
      const currentHourET = parseInt(
        etParts.find((p) => p.type === "hour")!.value, 10
      );
      const weekdayStr = etParts.find((p) => p.type === "weekday")!.value;
      const dayIndexMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const currentDayET = dayIndexMap[weekdayStr] ?? 0;

      // Frequency cap and global daily cap — run in parallel since they're independent reads
      const windowFreqCap = parseFrequencyCap(rule?.frequencyCap);
      const hasFreqCap = rule && typeof windowFreqCap?.maxSends === "number";
      const periodMs: Record<string, number> = {
        day:    86_400_000,
        week:   7  * 86_400_000,
        biweek: 14 * 86_400_000,
        month:  30 * 86_400_000,
      };
      const freqWindowStart = hasFreqCap
        ? new Date(now.getTime() - (periodMs[windowFreqCap!.period ?? "week"] ?? periodMs.week))
        : null;

      const [recentDecisionsForFreq, sentTodayWindowRows, windowRecentSends] = await Promise.all([
        hasFreqCap
          ? prisma.userDecision.groupBy({
              by: ["userId"],
              where: {
                agentId: agent.id,
                userId:  { in: inWindowUserIdsForAgent },
                sentAt:  { gte: freqWindowStart! },
              },
              _count: { userId: true },
            })
          : Promise.resolve([] as Array<{ userId: string; _count: { userId: number } }>),
        prisma.userDecision.findMany({
          where: {
            userId: { in: inWindowUserIdsForAgent },
            sentAt: { gte: todayStart },
            brazeSendId: { not: null },
          },
          select:   { userId: true },
          distinct: ["userId"],
        }),
        prisma.userDecision.findMany({
          where: {
            agentId:  agent.id,
            userId:   { in: inWindowUserIdsForAgent },
            sentAt:   { gte: new Date(now.getTime() - 7 * 86_400_000) },
            messageVariantId: { not: null },
          },
          select: { userId: true, messageVariantId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
        }),
      ]);

      // Pre-group recent sends by userId once (rows stay sentAt-desc ordered).
      const windowRecentSendsByUserId = new Map<string, typeof windowRecentSends>();
      for (const r of windowRecentSends) {
        const list = windowRecentSendsByUserId.get(r.userId);
        if (list) list.push(r);
        else windowRecentSendsByUserId.set(r.userId, [r]);
      }

      const windowFreqCappedUserIds = new Set<string>();
      if (hasFreqCap) {
        const countByUser = new Map(recentDecisionsForFreq.map((r) => [r.userId, r._count.userId]));
        for (const u of windowUsers) {
          const count = countByUser.get(u.externalId) ?? 0;
          if (count >= windowFreqCap!.maxSends!) {
            windowFreqCappedUserIds.add(u.externalId);
          }
        }
      }
      const sentTodayWindowIds = new Set(sentTodayWindowRows.map((r) => r.userId));

      // Filter eligible window users by frequency cap + timing check + daily cap
      const eligibleWindowUsers = windowUsers.filter((user) => {
        const assignment = windowAssignmentMap.get(user.externalId);
        if (!assignment || assignment.sendCount >= WINDOW_SEND_CAP) return false;
        if (windowFreqCappedUserIds.has(user.externalId)) {
          totalSuppressed++;
          return false;
        }
        if (sentTodayWindowIds.has(user.externalId)) {
          totalSuppressed++;
          return false;
        }

        const hourlyStats = (Array.isArray(user.hourlyStats)
          ? user.hourlyStats
          : Array(24).fill(0)) as number[];
        const dailyStats = (Array.isArray(user.dailyStats)
          ? user.dailyStats
          : Array(7).fill(0)) as number[];

        return isTimingMatch(hourlyStats, dailyStats, assignment.sendCount, currentHourET, currentDayET);
      });

      // Same eligibility gate chain as the lottery path. In-window sends used to
      // skip opt-out / preferred-channel / language / targetFilter / quiet-hours
      // entirely, so e.g. a user who opted out of push mid-window kept receiving
      // pushes for the rest of the window (2026-06-09 audit, I5).
      const windowHasPush = agent.messages.some((m) => m.channel === "push");
      const windowHasEmail = agent.messages.some((m) => m.channel === "email");
      const hasSendableMessagesWindow = agent.messages.length > 0;
      const windowEffectiveLang =
        agent.languageFilter && agent.languageFilter !== "all"
          ? agent.languageFilter
          : (hasSendableMessagesWindow && !localizeEnabled) ? "en" : null;
      const quietWindowUsers = eligibleWindowUsers.filter((u) => {
        const attrs = (u.attributes as Record<string, unknown>) ?? {};
        if (
          (windowHasPush && isNewsletterOptedOut(attrs, "push")) ||
          (windowHasEmail && isNewsletterOptedOut(attrs, "email")) ||
          (windowHasPush && !isPushPreferred(attrs, u.channelStats, u.funnelStage, pushTargetingMode))
        ) {
          totalSuppressed++;
          suppress.targetFilter++;
          return false;
        }
        if (windowEffectiveLang) {
          const lang = attrs.language_tag as string | undefined;
          if (lang?.startsWith(windowEffectiveLang) !== true) {
            totalSuppressed++;
            suppress.targetFilter++;
            return false;
          }
        }
        if (
          agent.targetFilter &&
          !evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
            attributes: attrs,
            computed: buildComputedKeys(u),
          })
        ) {
          totalSuppressed++;
          suppress.targetFilter++;
          return false;
        }
        if (quietHoursConfig?.start && quietHoursConfig?.end) {
          const userTz = typeof attrs.timezone === "string" ? attrs.timezone : (quietHoursConfig.timezone ?? "UTC");
          if (isInQuietHours(quietHoursConfig.start, quietHoursConfig.end, userTz, now)) {
            totalSuppressed++;
            suppress.quietHours++;
            return false;
          }
        }
        return true;
      });

      // Batch-decide for in-window users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createMany call.
      let windowByVariant: Record<string, VariantSendGroup> = {};
      let sentWindowUserIds: string[] = [];

      if (quietWindowUsers.length > 0) {
        // Collect all unique personaIds among eligible window users
        const windowPersonaIds = [...new Set(
          quietWindowUsers.map((u) => u.personaId).filter(Boolean) as string[]
        )];

        // Load all arm stats for this agent × these personas in one query
        const armStatsRows = await prisma.personaArmStats.findMany({
          where: {
            agentId:   agent.id,
            personaId: { in: windowPersonaIds },
            variantId: { in: allVariantIds },
          },
        });

        // Index arm stats by personaId → variantId → stats
        const armStatsByPersona = new Map<string, Map<string, BanditArm>>();
        for (const row of armStatsRows) {
          if (!armStatsByPersona.has(row.personaId)) {
            armStatsByPersona.set(row.personaId, new Map());
          }
          armStatsByPersona.get(row.personaId)!.set(row.variantId, { id: row.variantId, stats: row });
        }

        // Load per-user arm stats for personalised blending (Thompson/EpsilonGreedy only)
        const windowUserIds = quietWindowUsers.map((u) => u.externalId);
        const windowUserArmRows = agent.algorithm !== "linucb"
          ? await prisma.userArmStats.findMany({
              where: { userId: { in: windowUserIds }, agentId: agent.id, variantId: { in: allVariantIds } },
            })
          : [];
        const windowUserArmsByUser = new Map<string, Map<string, typeof windowUserArmRows[number]>>();
        for (const row of windowUserArmRows) {
          if (!windowUserArmsByUser.has(row.userId)) windowUserArmsByUser.set(row.userId, new Map());
          windowUserArmsByUser.get(row.userId)!.set(row.variantId, row);
        }

        // For LinUCB: load per-agent LinUCB arms once. Reset stale-dimension arms to identity in DB and in-memory.
        const windowLinucbArmsByVariant: Map<string, { id: string; aInv: number[]; b: number[] }> = new Map();
        if (agent.algorithm === "linucb") {
          const freshArm = new LinUCB().initialArm(FEATURE_DIM);
          const allArms = await prisma.linUCBArm.findMany({ where: { agentId: agent.id, variantId: { in: allVariantIds } } });
          const staleArms = allArms.filter(
            (r) =>
              !(Array.isArray(r.aInv) && (r.aInv as number[]).length === FEATURE_DIM * FEATURE_DIM) ||
              !(Array.isArray(r.b) && (r.b as number[]).length === FEATURE_DIM)
          );
          if (staleArms.length > 0) {
            await Promise.all(
              staleArms.map((r) =>
                prisma.linUCBArm.update({
                  where: { agentId_variantId: { agentId: r.agentId, variantId: r.variantId } },
                  data: {
                    aInv: freshArm.aInv as unknown as Prisma.InputJsonValue,
                    b: freshArm.b as unknown as Prisma.InputJsonValue,
                    tries: 0,
                  },
                })
              )
            );
          }
          const staleIds = new Set(staleArms.map((s) => s.variantId));
          for (const r of allArms) {
            const isStale = staleIds.has(r.variantId);
            const aInv = isStale ? freshArm.aInv : (r.aInv as number[]);
            const b = isStale ? freshArm.b : (r.b as number[]);
            windowLinucbArmsByVariant.set(r.variantId, { id: r.variantId, aInv, b });
          }
        }

        // Select variant for each eligible window user (pure in-memory computation)
        const windowVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const decisionInputs: Array<{ user: typeof quietWindowUsers[number]; variantId: string; scheduledAt: Date; inLocalTime: boolean; contextVector?: number[] }> = [];

        for (const user of quietWindowUsers) {
          const pid = user.personaId as string | null;
          if (!pid) continue;

          // Build recency penalty map for this user
          const windowUserRecent = windowRecentSendsByUserId.get(user.externalId) ?? [];
          const windowRecencyPenalties: Record<string, number> = {};
          for (const r of windowUserRecent) {
            const vid = r.messageVariantId;
            if (!vid || windowRecencyPenalties[vid] !== undefined) continue;
            const daysSince = (now.getTime() - r.sentAt.getTime()) / 86_400_000;
            windowRecencyPenalties[vid] = recencyMultiplier(daysSince);
          }

          let selectedVariantId: string;
          // Hoisted so decisionContext can include it for LinUCB reward path
          let windowContextVector: number[] | undefined;

          if (agent.algorithm === "linucb") {
            const linucbArms = windowVariants
              .map((v) => windowLinucbArmsByVariant.get(v.id))
              .filter(Boolean) as Array<{ id: string; aInv: number[]; b: number[] }>;
            if (linucbArms.length === 0) continue;
            const storedVec2 = user.featureVector as number[];
            const context: number[] =
              Array.isArray(storedVec2) && storedVec2.length === FEATURE_DIM
                ? storedVec2
                : computeFeatureVector({
                    totalDecisions:   user.totalDecisions,
                    totalConversions: user.totalConversions,
                    totalReward:      user.totalReward,
                    channelStats:     user.channelStats,
                    hourlyStats:      user.hourlyStats,
                    dailyStats:       user.dailyStats,
                    attributes:       (user.attributes as Record<string, unknown>) ?? {},
                  });
            windowContextVector = context;
            // linucbArms is non-empty (guarded above)
            selectedVariantId = selectVariant({ algorithm: "linucb", linucbArms, context })!;
          } else {
            const personaArms = armStatsByPersona.get(pid) ?? new Map(
              windowVariants.map((v) => [v.id, { id: v.id, stats: { alpha: 1, beta: 30, tries: 0, wins: 0 } } as BanditArm])
            );
            const windowUserArms = windowUserArmsByUser.get(user.externalId) ?? new Map();

            const arms: BanditArm[] = windowVariants
              .map((v) => {
                const pa = personaArms.get(v.id);
                return pa ? blendArm(pa, windowUserArms.get(v.id)) : undefined;
              })
              .filter(Boolean) as BanditArm[];
            if (arms.length === 0) continue;

            // arms is non-empty (guarded above)
            selectedVariantId = selectVariant(
              agent.algorithm === "epsilon_greedy"
                ? { algorithm: "epsilon_greedy", arms, epsilon: agent.epsilon }
                : { algorithm: "thompson", arms, recencyPenalties: windowRecencyPenalties },
            )!;
          }

          // Content cards, modals, and slideup-only in-app messages send immediately.
          const selectedWindowMeta = variantMeta.get(selectedVariantId);
          const sendWindowImmediately =
            selectedWindowMeta?.channel === "content-card" ||
            selectedWindowMeta?.channel === "modal-iam" ||
            (selectedWindowMeta?.channel === "in-app" && selectedWindowMeta.title === null);

          let scheduledAt: Date;
          let isFallback: boolean;
          if (sendWindowImmediately) {
            scheduledAt = now;
            isFallback = false;
          } else {
            // Schedule mode: force in_local_time via Braze at the configured hour.
            // Otherwise prefer the user's last-seen hour; fall back to their historical peak hour.
            const effectiveSendHour = scheduleDeliverHour !== null ? null : (user.preferredSendHour ?? peakActivityHour(user.hourlyStats));
            const effectiveSendMinute = scheduleDeliverHour !== null ? null : (user.preferredSendHour !== null ? (user.preferredSendMinute ?? null) : null);
            ({ scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
              effectiveSendHour,
              effectiveSendMinute,
              scheduleDeliverHour ?? agent.fallbackSendHour ?? 8,
              now,
            ));

            // Guard: verify the *delivery time* itself doesn't land in quiet hours.
            if (!isFallback && quietHoursConfig?.start && quietHoursConfig?.end) {
              const attrs = user.attributes as Record<string, unknown>;
              const agentTz = quietHoursConfig.timezone ?? "UTC";
              const userTz = typeof attrs?.timezone === "string" ? attrs.timezone : agentTz;
              if (isInQuietHours(quietHoursConfig.start, quietHoursConfig.end, userTz, scheduledAt)) {
                ({ scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
                  null,
                  null,
                  scheduleDeliverHour ?? agent.fallbackSendHour ?? 8,
                  now,
                ));
              }
            }

            // Global blackout: suppress sends landing on a blackout calendar date.
            if (isBlackoutDate(scheduledAt, blackoutDates)) {
              totalSuppressed++;
              suppress.blackout++;
              continue;
            }
          }

          decisionInputs.push({
            user,
            variantId: selectedVariantId,
            scheduledAt,
            inLocalTime: isFallback,
            ...(agent.algorithm === "linucb" && windowContextVector ? { contextVector: windowContextVector } : {}),
          });
        }

        // Bulk-create all UserDecision records in one createMany call
        const decisionData = decisionInputs.map(({ user, variantId, scheduledAt, inLocalTime, contextVector }) => {
          const pid = user.personaId as string | null;
          const arms = pid ? armStatsByPersona.get(pid) : null;
          const variantScores: Record<string, number> = {};
          if (arms) {
            for (const [vid, arm] of arms) {
              const a = arm.stats.alpha;
              const b = arm.stats.beta;
              variantScores[vid] = a + b > 0 ? a / (a + b) : 0;
            }
          }
          const attrs = user.attributes as Record<string, unknown>;
          const userTz = typeof attrs.timezone === "string" ? attrs.timezone : "America/New_York";
          const scheduledLocalHour = inLocalTime
            ? (scheduleDeliverHour ?? agent.fallbackSendHour ?? 8)
            : localHourOf(scheduledAt, userTz);
          return {
            agentId:             agent.id,
            userId:              user.externalId,
            messageVariantId:    variantId,
            channel:             windowVariants.find((v) => v.id === variantId)?.channel ?? "push",
            sentAt:              now,
            scheduledFor:        scheduledAt,
            scheduledLocalHour,
            decisionContext:  {
              ...(pid ? { personaId: pid, selectedVariantId: variantId, variantScores } : {}),
              inLocalTime,
              ...(agent.algorithm === "linucb" && contextVector ? { contextVector } : {}),
            } as unknown as Prisma.InputJsonValue,
          };
        });

        // createMany returns count, not individual IDs — use createManyAndReturn when available,
        // otherwise fall back to individual creates for ID tracking.
        // Prisma 7 supports createManyAndReturn (returns created records with IDs).
        const createdDecisions = await prisma.userDecision.createManyAndReturn({
          data: decisionData,
        });

        // Build a map from externalUserId → decisionId
        const decisionIdByUser = new Map<string, string>();
        for (let i = 0; i < decisionInputs.length; i++) {
          const created = createdDecisions[i];
          if (created) decisionIdByUser.set(decisionInputs[i].user.externalId, created.id);
        }

        // Group by variant + scheduled time for batch sending
        const windowVotdContent = await prepareVotdContent(prisma, decisionInputs, votdVariantIds);
        const windowGpContent = await prepareGpContent(prisma, decisionInputs, gpVariantIds);
        windowByVariant = groupDecisionsByVariant(decisionInputs, variantMeta, decisionIdByUser, { ...localization, votdContent: windowVotdContent, gpContent: windowGpContent }, givingMultiplier);
      }

      // Send all window variant groups in parallel batches
      {
        const { sent, errors, sentUserIds } = await dispatchSendGroups(
          Object.values(windowByVariant),
          { brazeClient, factory, agentId: agent.id, prisma },
        );
        totalSent += sent;
        totalErrors += errors;
        sentWindowUserIds = sentUserIds;
      }

      // Increment sendCount for each user who was actually sent to.
      // Use two updateMany calls (increment + conditional complete) instead of N individual updates.
      if (sentWindowUserIds.length > 0) {
        // Collect assignment IDs
        const sentAssignmentIds = sentWindowUserIds
          .map((uid) => windowAssignmentMap.get(uid)?.id)
          .filter(Boolean) as string[];
        // IDs of users whose window completes with this send (sendCount was
        // WINDOW_SEND_CAP-1, now becomes WINDOW_SEND_CAP)
        const completingIds = sentWindowUserIds
          .map((uid) => windowAssignmentMap.get(uid))
          .filter((a) => a && a.sendCount >= WINDOW_SEND_CAP - 1)
          .map((a) => a!.id);

        await Promise.all([
          // Increment sendCount for all sent users
          prisma.userAgentAssignment.updateMany({
            where: { id: { in: sentAssignmentIds } },
            data: { sendCount: { increment: 1 } },
          }),
          // Mark window complete for users reaching WINDOW_SEND_CAP sends
          completingIds.length > 0
            ? prisma.userAgentAssignment.updateMany({
                where: { id: { in: completingIds } },
                data: { windowCompletedAt: now },
              })
            : Promise.resolve(),
        ]);
      }
    }
    // ── End in-window sub-pool ───────────────────────────────────────────────
    agentMetrics.set(agent.id, {
      sent:       totalSent       - metricsBefore.sent,
      suppressed: totalSuppressed - metricsBefore.suppressed,
      errors:     totalErrors     - metricsBefore.errors,
    });
  }

  // Write ModelMetric rows for agents that had any activity
  const metricsToWrite = [...agentMetrics.entries()]
    .filter(([, m]) => m.sent > 0 || m.suppressed > 0 || m.errors > 0)
    .map(([agentId, m]) => ({ agentId, metrics: m }));

  if (metricsToWrite.length > 0) {
    await prisma.modelMetric.createMany({ data: metricsToWrite });
  }

  await prisma.cronRun.update({
    where: { id: cronRunId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      agentCount: agents.length,
      sent: totalSent,
      suppressed: totalSuppressed,
      errors: totalErrors,
    },
  });

  // Invalidate dashboard/performance caches once per cron run when decisions were recorded.
  if (totalSent > 0) {
    revalidateTag("dashboard-stats", "max");
    revalidateTag("performance", "max");
  }

  // Warm the most-visited caches so the first page load after this cron gets a hit.
  // Fire-and-forget: warming failures don't affect the cron response.
  void Promise.all([
    getCachedDashboardCounts(),
    getCachedDashboardTimeSeries(),
    getCachedAgentList(),
    getCachedPerformanceMetrics(),
    getCachedSegments(),
  ]).catch(() => {});

  return NextResponse.json({
    ok: true,
    sent: totalSent,
    suppressed: totalSuppressed,
    errors: totalErrors,
  });
  } finally {
    await prisma.appSetting.delete({ where: { key: "cron_lock_select_and_send" } }).catch(() => {});
    if (cronRunId) {
      await prisma.cronRun.updateMany({
        where: { id: cronRunId, status: "running" },
        data: { status: "failed", finishedAt: new Date() },
      }).catch(() => {});
    }
  }
}

// vercel crons run sends GET; alias to POST so manual triggers work
export async function GET(req: NextRequest) {
  return POST(req);
}
