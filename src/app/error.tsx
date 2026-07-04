"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="shell">
      <section className="empty-state" role="alert">
        <h1>Не удалось загрузить калькулятор</h1>
        <p>Обновите страницу или повторите попытку. Если ошибка повторится, передайте администратору время сбоя.</p>
        <button className="primary-button" type="button" onClick={reset}>
          Повторить
        </button>
      </section>
    </main>
  );
}
