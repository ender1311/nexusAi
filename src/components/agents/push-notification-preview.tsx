interface PushNotificationPreviewProps {
  title?: string | null;
  body: string;
  appName?: string;
  iconUrl?: string | null;
}

export function PushNotificationPreview({
  title,
  body,
  appName = "YouVersion",
  iconUrl,
}: PushNotificationPreviewProps) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="rounded-2xl bg-white/90 backdrop-blur shadow-lg border border-gray-200 p-3 max-w-sm">
      {/* iOS-style notification header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 rounded-md bg-blue-600 flex items-center justify-center shrink-0 overflow-hidden">
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconUrl} alt="App icon" className="h-full w-full object-cover" />
          ) : (
            <span className="text-white text-xs font-bold">YV</span>
          )}
        </div>
        <span className="text-xs font-semibold text-gray-600 flex-1">{appName.toUpperCase()}</span>
        <span className="text-xs text-gray-400">{timeStr}</span>
      </div>
      {/* Notification content */}
      <div className="space-y-0.5">
        {title && (
          <p className="text-sm font-semibold text-gray-900 leading-snug">{title}</p>
        )}
        <p className="text-sm text-gray-600 leading-snug">{body || "Your message body will appear here."}</p>
      </div>
    </div>
  );
}
