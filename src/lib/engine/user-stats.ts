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

  const existing = await prisma.user.findUnique({ where: { externalId } });

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

    await prisma.user.create({
      data: {
        externalId,
        totalDecisions: 1,
        totalConversions: 1,
        totalReward: reward,
        channelStats: JSON.stringify(channelStats),
        hourlyStats: JSON.stringify(hourlyStats),
        dailyStats: JSON.stringify(dailyStats),
      },
    });
    return;
  }

  const channelStats: ChannelStats = JSON.parse(existing.channelStats || "{}");
  if (!channelStats[channel]) channelStats[channel] = { sent: 0, converted: 0 };
  channelStats[channel].converted += 1;
  channelStats[channel].sent += 1;

  const hourlyStats: number[] = JSON.parse(existing.hourlyStats || "[]");
  const dailyStats: number[] = JSON.parse(existing.dailyStats || "[]");

  // Ensure arrays are 24 and 7 elements
  while (hourlyStats.length < 24) hourlyStats.push(0);
  while (dailyStats.length < 7) dailyStats.push(0);

  hourlyStats[hour] += 1;
  dailyStats[dayOfWeek] += 1;

  await prisma.user.update({
    where: { externalId },
    data: {
      totalDecisions: { increment: 1 },
      totalConversions: { increment: 1 },
      totalReward: { increment: reward },
      channelStats: JSON.stringify(channelStats),
      hourlyStats: JSON.stringify(hourlyStats),
      dailyStats: JSON.stringify(dailyStats),
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

  const existing = await prisma.user.findUnique({ where: { externalId } });

  if (!existing) {
    const channelStats: ChannelStats = { [channel]: { sent: 1, converted: 0 } };
    await prisma.user.create({
      data: {
        externalId,
        totalDecisions: 1,
        channelStats: JSON.stringify(channelStats),
        hourlyStats: JSON.stringify(Array(24).fill(0)),
        dailyStats: JSON.stringify(Array(7).fill(0)),
      },
    });
    return;
  }

  const channelStats: ChannelStats = JSON.parse(existing.channelStats || "{}");
  if (!channelStats[channel]) channelStats[channel] = { sent: 0, converted: 0 };
  channelStats[channel].sent += 1;

  await prisma.user.update({
    where: { externalId },
    data: {
      totalDecisions: { increment: 1 },
      channelStats: JSON.stringify(channelStats),
    },
  });
}
