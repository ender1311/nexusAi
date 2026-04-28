import { prisma } from "../src/lib/db";

const MESSAGE_ID = "cmohcv14x0008v8h5ugvazyrc";
const CAMPAIGN_ID = "0099a647-ef12-4fca-a1cd-c954458f37c3";
const IOS_VARIANT_ID = "iosPush-21001";
const AGENT_ID = "cmohcv0rm0003v8h5i225g5i3";

await prisma.message.update({
  where: { id: MESSAGE_ID },
  data: { brazeCampaignId: CAMPAIGN_ID },
});
console.log("✓ Set brazeCampaignId:", CAMPAIGN_ID);

const variants = await prisma.messageVariant.findMany({
  where: { messageId: MESSAGE_ID },
  select: { id: true, name: true },
});
for (const v of variants) {
  await prisma.messageVariant.update({
    where: { id: v.id },
    data: { brazeVariantId: IOS_VARIANT_ID },
  });
  console.log(`  ✓ ${v.name} → ${IOS_VARIANT_ID}`);
}

await prisma.agent.update({
  where: { id: AGENT_ID },
  data: { status: "active" },
});
console.log("✓ Agent activated");

await prisma.$disconnect();
