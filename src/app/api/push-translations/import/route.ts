import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  groupImportFiles, buildImportPlan, commitImportPlan,
  type ImportFile, type VariantSnapshot, type ImportPlan, type CommitResult, type SkippedFile,
} from "@/lib/push-import";

type Ok = { data: { plan: ImportPlan; skipped: SkippedFile[]; committed?: CommitResult } };
type Err = { error: string };

export async function POST(req: NextRequest): Promise<NextResponse<Ok | Err>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden as NextResponse<Err>;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const fileParts = formData.getAll("files").filter((p): p is File => p instanceof File);
  if (fileParts.length === 0) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }
  const doCommit = formData.get("commit") === "true";
  const refreshEnglish = formData.get("refreshEnglish") === "true";

  const files: ImportFile[] = [];
  for (const part of fileParts) {
    // webkitdirectory submits relative paths in the filename; honor them for stem parsing.
    const relativePath = (part as File & { webkitRelativePath?: string }).webkitRelativePath || part.name;
    files.push({ relativePath, contents: await part.text() });
  }

  const { groups, skipped } = groupImportFiles(files);

  // Candidate variants: push variants whose message belongs to any agent. Snapshot
  // sourceFile + existing translation languages for pure plan matching.
  const variants = await prisma.messageVariant.findMany({
    where: { message: { channel: "push" } },
    select: { id: true, name: true, body: true, actionFeatures: true, translations: { select: { language: true } } },
  });
  const snapshots: VariantSnapshot[] = variants.map((v) => {
    const af = (v.actionFeatures as Record<string, unknown> | null) ?? null;
    const sourceFile = af && typeof af.sourceFile === "string" ? af.sourceFile : null;
    return { id: v.id, name: v.name, body: v.body, sourceFile, existingLanguages: new Set(v.translations.map((t) => t.language)) };
  });

  const plan = buildImportPlan(groups, snapshots);

  if (!doCommit) {
    return NextResponse.json({ data: { plan, skipped } }, { status: 200 });
  }

  try {
    const committed = await commitImportPlan(plan, prisma, { source: "upload", refreshEnglish });
    return NextResponse.json({ data: { plan, skipped, committed } }, { status: 200 });
  } catch (err) {
    console.error("[push-translations/import] commit failed:", err);
    return NextResponse.json({ error: "Failed to commit translations" }, { status: 500 });
  }
}
