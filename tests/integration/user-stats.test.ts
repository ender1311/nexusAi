import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { accumulateUserStats, recordUserSend } from "@/lib/services/user-stats-service";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("accumulateUserStats", () => {
  it("creates a new user when none exists", async () => {
    await accumulateUserStats({
      externalId: "usr_new",
      channel: "push",
      reward: 0.8,
      occurredAt: new Date("2026-05-08T14:00:00Z"), // UTC hour=14, day=4 (Thu)
    });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_new" } });
    expect(user).toBeTruthy();
    expect(user!.totalDecisions).toBe(1);
    expect(user!.totalConversions).toBe(1);
    expect(user!.totalReward).toBeCloseTo(0.8);
  });

  it("populates hourlyStats[14]=1 and dailyStats[4]=1 on first create", async () => {
    await accumulateUserStats({
      externalId: "usr_h",
      channel: "push",
      reward: 1.0,
      occurredAt: new Date("2026-05-07T14:00:00Z"), // hour=14, Thu=4
    });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_h" } });
    const hourly = user!.hourlyStats as number[];
    const daily = user!.dailyStats as number[];

    expect(hourly).toHaveLength(24);
    expect(hourly[14]).toBe(1);
    expect(hourly[0]).toBe(0); // all others zero
    expect(daily).toHaveLength(7);
    expect(daily[4]).toBe(1); // Thursday
  });

  it("sets channelStats on first create", async () => {
    await accumulateUserStats({ externalId: "usr_cs", channel: "push", reward: 0.5, occurredAt: new Date() });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_cs" } });
    const cs = user!.channelStats as Record<string, { sent: number; converted: number }>;
    expect(cs.push.sent).toBe(1);
    expect(cs.push.converted).toBe(1);
  });

  it("increments existing user's counts on update", async () => {
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_upd",
        totalDecisions: 3,
        totalConversions: 1,
        totalReward: 0.5,
        channelStats: { push: { sent: 3, converted: 1 } },
        hourlyStats: Array(24).fill(0),
        dailyStats: Array(7).fill(0),
      },
    });

    await accumulateUserStats({
      externalId: "usr_upd",
      channel: "push",
      reward: 0.9,
      occurredAt: new Date("2026-05-08T10:00:00Z"), // hour=10, Thu=4
    });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_upd" } });
    expect(user!.totalDecisions).toBe(4);
    expect(user!.totalConversions).toBe(2);
    expect(user!.totalReward).toBeCloseTo(1.4);

    const cs = user!.channelStats as Record<string, { sent: number; converted: number }>;
    expect(cs.push.sent).toBe(4);
    expect(cs.push.converted).toBe(2);

    const hourly = user!.hourlyStats as number[];
    expect(hourly[10]).toBe(1);
  });

  it("pads short hourlyStats array to 24 elements", async () => {
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_pad",
        hourlyStats: [0, 0], // too short
        dailyStats: [0, 0, 0, 0, 0, 0, 0],
        channelStats: {},
      },
    });

    await accumulateUserStats({
      externalId: "usr_pad",
      channel: "push",
      reward: 1.0,
      occurredAt: new Date("2026-05-08T14:00:00Z"),
    });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_pad" } });
    expect((user!.hourlyStats as number[]).length).toBe(24);
    expect((user!.hourlyStats as number[])[14]).toBe(1);
  });

  it("pads short dailyStats array to 7 elements", async () => {
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_pad_d",
        hourlyStats: Array(24).fill(0),
        dailyStats: [0], // too short
        channelStats: {},
      },
    });

    await accumulateUserStats({
      externalId: "usr_pad_d",
      channel: "push",
      reward: 1.0,
      occurredAt: new Date("2026-05-07T10:00:00Z"), // Thu=4
    });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_pad_d" } });
    expect((user!.dailyStats as number[]).length).toBe(7);
    expect((user!.dailyStats as number[])[4]).toBe(1);
  });

  it("creates a new channel entry when channel not seen before", async () => {
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_ch",
        channelStats: { push: { sent: 2, converted: 1 } },
        hourlyStats: Array(24).fill(0),
        dailyStats: Array(7).fill(0),
      },
    });

    await accumulateUserStats({ externalId: "usr_ch", channel: "email", reward: 0.7, occurredAt: new Date() });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_ch" } });
    const cs = user!.channelStats as Record<string, { sent: number; converted: number }>;
    expect(cs.email.sent).toBe(1);
    expect(cs.email.converted).toBe(1);
    expect(cs.push.sent).toBe(2); // push unchanged
  });
});

describe("recordUserSend", () => {
  it("creates a new user with totalDecisions=1 and sent=1, converted=0", async () => {
    await recordUserSend({ externalId: "usr_send", channel: "push" });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_send" } });
    expect(user).toBeTruthy();
    expect(user!.totalDecisions).toBe(1);
    expect(user!.totalConversions).toBe(0);

    const cs = user!.channelStats as Record<string, { sent: number; converted: number }>;
    expect(cs.push.sent).toBe(1);
    expect(cs.push.converted).toBe(0);
  });

  it("initializes hourlyStats[24] and dailyStats[7] with zeros on create", async () => {
    await recordUserSend({ externalId: "usr_send_arr", channel: "push" });
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_send_arr" } });
    expect((user!.hourlyStats as number[]).length).toBe(24);
    expect((user!.dailyStats as number[]).length).toBe(7);
  });

  it("increments totalDecisions and channel sent on update", async () => {
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_send_upd",
        totalDecisions: 2,
        channelStats: { push: { sent: 2, converted: 0 } },
        hourlyStats: Array(24).fill(0),
        dailyStats: Array(7).fill(0),
      },
    });

    await recordUserSend({ externalId: "usr_send_upd", channel: "push" });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_send_upd" } });
    expect(user!.totalDecisions).toBe(3);
    expect(user!.totalConversions).toBe(0); // NOT incremented
    const cs = user!.channelStats as Record<string, { sent: number; converted: number }>;
    expect(cs.push.sent).toBe(3);
    expect(cs.push.converted).toBe(0);
  });

  it("does not touch totalConversions on existing user", async () => {
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_no_conv",
        totalConversions: 5,
        channelStats: { push: { sent: 5, converted: 5 } },
        hourlyStats: Array(24).fill(0),
        dailyStats: Array(7).fill(0),
      },
    });

    await recordUserSend({ externalId: "usr_no_conv", channel: "push" });

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_no_conv" } });
    expect(user!.totalConversions).toBe(5); // unchanged
  });
});
