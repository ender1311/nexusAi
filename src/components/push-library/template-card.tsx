"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { TemplateFormSheet } from "@/components/push-library/template-form-sheet";
import { DeleteConfirmDialog } from "@/components/push-library/delete-confirm-dialog";
import { LanguageCoverageBadge } from "@/components/push-library/language-coverage-badge";
import { isPushVariantComplete } from "@/lib/messages/push-completeness";

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  languages: string[];
};

interface TemplateCardProps {
  variant: TemplateVariant;
  isAdmin: boolean;
}

export function TemplateCard({ variant, isAdmin }: TemplateCardProps) {
  const truncatedDeeplink =
    variant.deeplink && variant.deeplink.length > 50
      ? `${variant.deeplink.slice(0, 47)}…`
      : variant.deeplink;

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardContent className="flex-1 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{variant.name}</p>
          <div className="flex shrink-0 items-center gap-1">
            {!isPushVariantComplete(variant) && (
              <Badge variant="destructive" className="shrink-0 text-xs">
                Incomplete
              </Badge>
            )}
            <LanguageCoverageBadge languages={variant.languages} />
            {variant.subcategory && (
              <Badge variant="outline" className="shrink-0 text-xs">
                {variant.subcategory}
              </Badge>
            )}
          </div>
        </div>
        <PushNotificationPreview
          title={variant.title}
          body={variant.body}
          deeplink={variant.deeplink}
        />
        {truncatedDeeplink && (
          <p className="text-xs font-mono text-muted-foreground break-all">
            {truncatedDeeplink}
          </p>
        )}
      </CardContent>
      {isAdmin && (
        <CardFooter className="px-4 pb-4 pt-0 flex gap-2">
          <TemplateFormSheet mode="edit" variant={variant}>
            <Button variant="outline" size="sm" className="flex-1">
              Edit
            </Button>
          </TemplateFormSheet>
          <DeleteConfirmDialog variantId={variant.id} variantName={variant.name}>
            <Button variant="outline" size="sm" className="flex-1 text-destructive hover:text-destructive">
              Delete
            </Button>
          </DeleteConfirmDialog>
        </CardFooter>
      )}
    </Card>
  );
}
