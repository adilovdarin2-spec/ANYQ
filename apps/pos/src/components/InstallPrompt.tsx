interface Props {
  platform: 'ios' | 'other';
  visible: boolean;
  canInstallDirectly: boolean;
  install: () => void;
  dismiss: () => void;
}

export function InstallPrompt({ platform, visible, canInstallDirectly, install, dismiss }: Props) {
  if (!visible) return null;

  return (
    <div className="install-banner" role="dialog" aria-label="Установка приложения">
      <div className="install-banner-head">
        <span className="install-banner-title">Поставьте ANYQ Касса на экран</span>
        <button className="icon-btn" onClick={dismiss} aria-label="Закрыть">✕</button>
      </div>

      {platform === 'ios' ? (
        <>
          <p>Откроется как обычное приложение, без Safari сверху, и будет работать офлайн.</p>
          <ol className="install-steps">
            <li>Нажмите <span className="share-glyph">⬆︎</span> «Поделиться» внизу экрана Safari</li>
            <li>Пролистайте вниз и выберите «На экран «Домой»»</li>
            <li>Подтвердите «Добавить»</li>
          </ol>
        </>
      ) : canInstallDirectly ? (
        <>
          <p>Работает офлайн и открывается как обычное приложение — без магазина приложений.</p>
          <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={install}>Установить приложение</button>
        </>
      ) : (
        <p>Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».</p>
      )}
    </div>
  );
}
