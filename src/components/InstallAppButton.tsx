import React, { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { Button } from './ui.tsx';

// Chrome/Edge fire this when the PWA is installable; we stash it and show
// our own "Install App" button (top header corner, incl. mobile).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari flag
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export const InstallAppButton: React.FC = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  // Android/desktop Chrome: browser says installable -> show real installer.
  if (deferred) {
    return (
      <Button
        variant="secondary"
        onClick={async () => {
          await deferred.prompt();
          const choice = await deferred.userChoice;
          if (choice.outcome === 'accepted') setDeferred(null);
        }}
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </Button>
    );
  }

  // iPhone/iPad: Safari never fires beforeinstallprompt — guide the user to
  // Share -> Add to Home Screen instead.
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (isIos) {
    return (
      <div className="relative">
        <Button variant="secondary" onClick={() => setShowIosHint((v) => !v)}>
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Install</span>
        </Button>
        {showIosHint && (
          <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl bg-surface shadow-pop border border-line p-4 z-40 space-y-2 animate-fade-in">
            <p className="text-[13px] font-semibold text-ink">Install on iPhone</p>
            <ol className="text-[13px] text-muted space-y-1.5 list-none">
              <li className="flex items-center gap-1.5">
                1. Tap <Share className="w-3.5 h-3.5 shrink-0" /> Share in Safari
              </li>
              <li>2. Scroll down → <strong className="text-ink">Add to Home Screen</strong></li>
              <li>3. Tap <strong className="text-ink">Add</strong></li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIosHint(false)}
              className="text-[12px] font-medium text-brand hover:text-brand-hover cursor-pointer"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
};
