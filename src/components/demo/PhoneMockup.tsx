export default function PhoneMockup() {
  return (
    <div className="flex justify-center">
      <div className="relative w-52 bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl border-4 border-gray-700">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-gray-900 rounded-b-xl z-10" />
        {/* Status bar */}
        <div className="flex justify-between px-3 pt-4 pb-1 text-gray-400 text-[8px]">
          <span>9:41</span>
          <span>●●●</span>
        </div>
        {/* Screen */}
        <div className="bg-gray-800 rounded-2xl min-h-[260px] p-2 space-y-2">
          {/* Wallpaper hint */}
          <div className="h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl" />
          {/* Push notification card — YouVersion/Holy Bible style */}
          <div className="bg-white rounded-2xl p-3 text-gray-900 shadow-lg border border-gray-100">
            <div className="flex items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://air-prod.imgix.net/836ed311-f54b-4463-a1f4-b1628a91ca30.jpg?w=97&h=97&fm=png&fit=crop"
                alt="Bible App"
                className="w-10 h-10 rounded-[10px] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <p className="text-[11px] font-bold text-gray-900 leading-tight">
                    Great job! 👏
                  </p>
                  <span className="text-[9px] text-gray-500 shrink-0">now</span>
                </div>
                <p className="text-[10px] text-gray-800 leading-snug">
                  You&apos;re doing amazing! Continue your whole Bible Plan ➡️
                </p>
              </div>
            </div>
          </div>
        </div>
        {/* Home indicator */}
        <div className="flex justify-center mt-2">
          <div className="w-20 h-1 bg-gray-600 rounded-full" />
        </div>
      </div>
    </div>
  );
}
