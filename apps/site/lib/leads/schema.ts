import { z } from "zod";

export const leadSchema = z.object({
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(1).max(120).refine((v) => !/[\r\n]/.test(v), "no line breaks"),
  source: z.string().trim().min(1).max(60),
  sender: z.string().trim().min(1).max(60),
  useCase: z.string().trim().min(1).max(280),
  /** Honeypot: hidden from people, filled by bots. */
  nx_hp: z.string().max(500).optional().default(""),
});
export type LeadInput = z.infer<typeof leadSchema>;
