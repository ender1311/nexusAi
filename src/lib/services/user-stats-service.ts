import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

/**
 * Accumulate behavioral stats on the User record after a conversion event.
 * Creates the User record if it doesn't exist yet.
 *
 * Atomic: a single INSERT ... ON CONFLICT DO UPDATE so concurrent conversions for
 * the same user (e.g. a giving + flag conversion in one sync, or ingest racing the
 * send cron) can't read-modify-write over each other and lose increments. Scalar
 * counters use SQL addition; channelStats merges with `||`; the hour/day arrays use
 * jsonb_set guarded by a length check (the column default is "[]", and jsonb_set on
 * a too-short array would append rather than set the index).
 */
export async function accumulateUserStats(params: {
  externalId: string;
  channel: string;
  reward: number;
  occurredAt: Date;
}): Promise<void> {
  const { externalId, channel, reward, occurredAt } = params;
  const hour = occurredAt.getUTCHours();
  const day = occurredAt.getUTCDay(); // 0=Sun, 6=Sat

  const id = randomUUID();
  const initHourly = Array(24).fill(0); initHourly[hour] = 1;
  const initDaily = Array(7).fill(0); initDaily[day] = 1;
  const zero24 = JSON.stringify(Array(24).fill(0));
  const zero7 = JSON.stringify(Array(7).fill(0));

  await prisma.$executeRaw`
    INSERT INTO "User" (id, "externalId", "updatedAt", "totalDecisions", "totalConversions", "totalReward", "channelStats", "hourlyStats", "dailyStats")
    VALUES (
      ${id}, ${externalId}, NOW(), 1, 1, ${reward}::float8,
      jsonb_build_object(${channel}::text, jsonb_build_object('sent', 1, 'converted', 1)),
      ${JSON.stringify(initHourly)}::jsonb,
      ${JSON.stringify(initDaily)}::jsonb
    )
    ON CONFLICT ("externalId") DO UPDATE SET
      "updatedAt"        = NOW(),
      "totalDecisions"   = "User"."totalDecisions" + 1,
      "totalConversions" = "User"."totalConversions" + 1,
      "totalReward"      = "User"."totalReward" + ${reward}::float8,
      "channelStats" = COALESCE("User"."channelStats", '{}'::jsonb) || jsonb_build_object(
        ${channel}::text,
        jsonb_build_object(
          'sent',      COALESCE(("User"."channelStats" -> ${channel}::text ->> 'sent')::int, 0) + 1,
          'converted', COALESCE(("User"."channelStats" -> ${channel}::text ->> 'converted')::int, 0) + 1
        )
      ),
      "hourlyStats" = jsonb_set(
        CASE WHEN jsonb_typeof("User"."hourlyStats") = 'array' AND jsonb_array_length("User"."hourlyStats") = 24
             THEN "User"."hourlyStats" ELSE ${zero24}::jsonb END,
        ARRAY[${hour}::text],
        to_jsonb(COALESCE((CASE WHEN jsonb_typeof("User"."hourlyStats") = 'array' AND jsonb_array_length("User"."hourlyStats") = 24
             THEN ("User"."hourlyStats" ->> ${hour}::int)::int ELSE 0 END), 0) + 1)
      ),
      "dailyStats" = jsonb_set(
        CASE WHEN jsonb_typeof("User"."dailyStats") = 'array' AND jsonb_array_length("User"."dailyStats") = 7
             THEN "User"."dailyStats" ELSE ${zero7}::jsonb END,
        ARRAY[${day}::text],
        to_jsonb(COALESCE((CASE WHEN jsonb_typeof("User"."dailyStats") = 'array' AND jsonb_array_length("User"."dailyStats") = 7
             THEN ("User"."dailyStats" ->> ${day}::int)::int ELSE 0 END), 0) + 1)
      )
  `;
}

/**
 * Record a send (decision without conversion) for user channel stats. Atomic, same
 * rationale as accumulateUserStats — only sent (not converted) is incremented.
 */
export async function recordUserSend(params: {
  externalId: string;
  channel: string;
}): Promise<void> {
  const { externalId, channel } = params;
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "User" (id, "externalId", "updatedAt", "totalDecisions", "channelStats", "hourlyStats", "dailyStats")
    VALUES (
      ${id}, ${externalId}, NOW(), 1,
      jsonb_build_object(${channel}::text, jsonb_build_object('sent', 1, 'converted', 0)),
      ${JSON.stringify(Array(24).fill(0))}::jsonb,
      ${JSON.stringify(Array(7).fill(0))}::jsonb
    )
    ON CONFLICT ("externalId") DO UPDATE SET
      "updatedAt" = NOW(),
      "totalDecisions" = "User"."totalDecisions" + 1,
      "channelStats" = COALESCE("User"."channelStats", '{}'::jsonb) || jsonb_build_object(
        ${channel}::text,
        jsonb_build_object(
          'sent',      COALESCE(("User"."channelStats" -> ${channel}::text ->> 'sent')::int, 0) + 1,
          'converted', COALESCE(("User"."channelStats" -> ${channel}::text ->> 'converted')::int, 0)
        )
      )
  `;
}
