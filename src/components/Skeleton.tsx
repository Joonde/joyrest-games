/** Каркасы экранов на время загрузки: те же отступы и размеры, что у готового экрана. */

function Bar({ width = "100%", height = 20 }: { width?: string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} />;
}

function TopBarSkeleton() {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="skeleton skeleton--mark" />
        <div className="stack stack--tight">
          <Bar width="120px" height={14} />
          <Bar width="96px" height={28} />
        </div>
      </div>
      <span className="skeleton skeleton--button-square" />
    </header>
  );
}

/** Пульт: шапка, код игры, QR и кнопки. */
export function ConsoleSkeleton() {
  return (
    <main className="page">
      <TopBarSkeleton />
      <section className="card card--center">
        <Bar width="96px" height={14} />
        <Bar width="220px" height={64} />
        <span className="skeleton skeleton--qr" />
        <span className="skeleton skeleton--button" />
        <span className="skeleton skeleton--button" />
      </section>
      <section className="card">
        <Bar width="50%" height={28} />
        <span className="skeleton skeleton--button" />
      </section>
    </main>
  );
}

/** Студия и администратор: шапка и карточки с полями. */
export function StudioSkeleton() {
  return (
    <main className="page">
      <TopBarSkeleton />
      <section className="card">
        <Bar width="60%" height={28} />
        <span className="skeleton skeleton--choice" />
        <span className="skeleton skeleton--choice" />
        <span className="skeleton skeleton--choice" />
        <span className="skeleton skeleton--button" />
      </section>
    </main>
  );
}

/** Телефон гостя: логотип и форма входа. */
export function PlaySkeleton() {
  return (
    <main className="page page--center">
      <span className="skeleton skeleton--logo" />
      <section className="card">
        <Bar width="40%" height={14} />
        <Bar width="70%" height={34} />
        <span className="skeleton skeleton--input" />
        <span className="skeleton skeleton--button" />
      </section>
    </main>
  );
}

/** Экран зала: эмблема и блок с кодом. */
export function ScreenSkeleton() {
  return (
    <main className="screen">
      <div className="screen__brand">
        <span className="skeleton skeleton--splash" />
      </div>
      <div className="screen__join">
        <Bar width="70%" height={48} />
        <Bar width="90%" height={24} />
        <div className="screen__code">
          <Bar width="240px" height={96} />
          <span className="skeleton skeleton--qr skeleton--qr-screen" />
        </div>
      </div>
    </main>
  );
}
