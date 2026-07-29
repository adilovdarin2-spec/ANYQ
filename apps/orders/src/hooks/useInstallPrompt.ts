import { useEffect, useState } from 'react';

type Platform = 'ios' | 'other';

function detectPlatform(): Platform {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'other';
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

const DISMISS_KEY = 'anyq_orders_install_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt() {
  const [platform] = useState<Platform>(detectPlatform);
  const [standalone, setStandalone] = useState(isStandalone);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(() => !isStandalone() && localStorage.getItem(DISMISS_KEY) !== '1');

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setStandalone(true);
      setVisible(false);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return {
    platform,
    standalone,
    visible: visible && !standalone,
    canInstallDirectly: !!deferredPrompt,
    install,
    dismiss,
  };
}
