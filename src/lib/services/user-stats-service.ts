import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

interface ChannelStat {
  sent: number;
  converted: number;
}

type ChannelStats = Record<string, ChannelStat>;

/**
 * Accumulate behavioral stats on the User record after a conversion event.
 * Creates the User record if it doesn't exist yet.
 */
export async function accumulateUserStats(params: {
  externalId: string;
  channel: string;
  reward: number;
  occurredAt: Date;
}): Promise<void> {
  const { externalId, channel, reward, occurredAt } = params;

  const existing = await prisma.trackedUser.findUnique({ where: { externalId } });

  const hour = occurredAt.getUTCHours();
  const dayOfWeek = occurredAt.getUTCDay(); // 0=Sun, 6=Sat

  if (!existing) {
    const hourlyStats = Array(24).fill(0);
    hourlyStats[hour] = 1;
    const dailyStats = Array(7).fill(0);
    dailyStats[dayOfWeek] = 1;

    const channelStats: ChannelStats = {
      [channel]: { sent: 1, converted: 1 },
    };

    await prisma.trackedUser.create({
      data: {
        externalId,
        totalDecisions: 1,
        totalConversions: 1,
        totalReward: reward,
        channelStats: channelStats as unknown as Prisma.InputJsonValue,
        hourlyStats,
        dailyStats,
      },
    });
    return;
  }

  const channelStats: ChannelStats = (existing.channelStats as unknown as ChannelStats) ?? {};
  if (!channelStats[channel]) channelStats[channel] = { sent: 0, converted: 0 };
  channelStats[channel].converted += 1;
  channelStats[channel].sent += 1;

  const hourlyStats: number[] = (existing.hourlyStats as number[]) ?? [];
  const dailyStats: number[] = (existing.dailyStats as number[]) ?? [];

  // Ensure arrays are 24 and 7 elements
  while (hourlyStats.length < 24) hourlyStats.push(0);
  while (dailyStats.length < 7) dailyStats.push(0);

  hourlyStats[hour] += 1;
  dailyStats[dayOfWeek] += 1;

  await prisma.trackedUser.update({
    where: { externalId },
    data: {
      totalDecisions: { increment: 1 },
      totalConversions: { increment: 1 },
      totalReward: { increment: reward },
      channelStats: channelStats as unknown as Prisma.InputJsonValue,
      hourlyStats,
      dailyStats,
    },
  });
}

/**
 * Record a send (decision without conversion) for user channel stats.
 */
export async function recordUserSend(params: {
  externalId: string;
  channel: string;
}): Promise<void> {
  const { externalId, channel } = params;

  const existing = await prisma.trackedUser.findUnique({ where: { externalId } });

  if (!existing) {
    const channelStats: ChannelStats = { [channel]: { sent: 1, converted: 0 } };
    await prisma.trackedUser.create({
      data: {
        externalId,
        totalDecisions: 1,
        channelStats: channelStats as unknown as Prisma.InputJsonValue,
        hourlyStats: Array(24).fill(0),
        dailyStats: Array(7).fill(0),
      },
    });
    return;
  }

  const channelStats: ChannelStats = (existing.channelStats as unknown as ChannelStats) ?? {};
  if (!channelStats[channel]) channelStats[channel] = { sent: 0, converted: 0 };
  channelStats[channel].sent += 1;

  await prisma.trackedUser.update({
    where: { externalId },
    data: {
      totalDecisions: { increment: 1 },
      channelStats: channelStats as unknown as Prisma.InputJsonValue,
    },
  });
}
