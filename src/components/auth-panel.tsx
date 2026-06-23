import Link from "next/link";
import { saveDefaultCommercialSettingsAction } from "../app/admin/actions";
import { approveUserAction, blockUserAction, registerAction, signInAction, signOutAction } from "../app/auth/actions";
import type { CommercialSettingsProfile } from "../lib/commercial-settings";
import type { UserProfile } from "../lib/auth/types";

export type AdminSellerRow = {
  id: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  updatedAt: string;
};

export type AdminCalculationRow = {
  id: string;
  ownerId: string;
  ownerEmail: string;
  sellerId: string;
  sellerName: string;
  name: string;
  updatedAt: string;
};

type AuthPanelProps = {
  message?: string;
};

const authMessages: Record<string, string> = {
  registered: "Заявка на регистрацию отправлена. После подтверждения администратором калькулятор станет доступен.",
  missing_credentials: "Введите email и пароль.",
  signin_error: "Не удалось войти. Проверьте email и пароль.",
  registration_invalid: "Введите email и пароль не короче 8 символов.",
  registration_error: "Не удалось зарегистрироваться. Возможно, такой email уже используется.",
  supabase_not_configured: "Supabase ещё не настроен. Добавьте переменные окружения и повторите действие."
};

export function AuthPanel({ message }: AuthPanelProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <img className="auth-logo" src="/pim-seller-logo.png" alt="PIM.Seller" />
        <div>
          <p className="eyebrow">Доступ к калькулятору</p>
          <h1>Войдите или отправьте заявку</h1>
        </div>
        {message ? <p className="auth-notice">{authMessages[message] ?? "Проверьте данные и попробуйте ещё раз."}</p> : null}
        <div className="auth-grid">
          <form className="auth-form" action={signInAction}>
            <h2>Вход</h2>
            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>Пароль</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit">Войти</button>
          </form>

          <form className="auth-form muted-form" action={registerAction}>
            <h2>Регистрация</h2>
            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>Пароль</span>
              <input name="password" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <button type="submit">Отправить заявку</button>
            <p>После регистрации администратор подтвердит доступ.</p>
          </form>
        </div>
      </section>
    </main>
  );
}

export function AccessStatusPanel({ profile }: { profile: UserProfile | null }) {
  const isBlocked = profile?.status === "blocked";

  return (
    <main className="auth-shell">
      <section className="auth-card compact-auth-card">
        <img className="auth-logo" src="/pim-seller-logo.png" alt="PIM.Seller" />
        <p className="eyebrow">Доступ к калькулятору</p>
        <h1>{isBlocked ? "Доступ заблокирован" : "Заявка ожидает подтверждения"}</h1>
        <p className="auth-copy">
          {isBlocked
            ? "Администратор ограничил доступ для этой учетной записи."
            : "Регистрация прошла успешно. Калькулятор откроется после подтверждения администратором."}
        </p>
        <form action={signOutAction}>
          <button type="submit">Выйти</button>
        </form>
      </section>
    </main>
  );
}

export function SupabaseSetupPanel() {
  return (
    <main className="auth-shell">
      <section className="auth-card compact-auth-card">
        <img className="auth-logo" src="/pim-seller-logo.png" alt="PIM.Seller" />
        <p className="eyebrow">Настройка доступа</p>
        <h1>Supabase ещё не подключён</h1>
        <p className="auth-copy">
          Создайте `.env.local` по примеру `.env.example`, добавьте `NEXT_PUBLIC_SUPABASE_URL` и
          `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, затем примените SQL-миграцию из папки `supabase/migrations`.
        </p>
      </section>
    </main>
  );
}

export function UserBar({ profile }: { profile: UserProfile }) {
  return (
    <div className="user-bar">
      <span>{profile.email}</span>
      {profile.role === "admin" ? <Link href="/admin">Админка</Link> : null}
      <form action={signOutAction}>
        <button className="secondary-button" type="submit">Выйти</button>
      </form>
    </div>
  );
}

export function AdminUsersTable({ profiles }: { profiles: UserProfile[] }) {
  return (
    <table className="admin-users-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Роль</th>
          <th>Статус</th>
          <th>Дата регистрации</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((profile) => (
          <tr key={profile.id}>
            <td>{profile.email}</td>
            <td>{profile.role}</td>
            <td>
              <span className={`status-pill status-${profile.status}`}>{statusLabel(profile.status)}</span>
            </td>
            <td>{new Date(profile.created_at).toLocaleString("ru-RU")}</td>
            <td>
              <div className="admin-user-actions">
                {profile.status !== "approved" ? (
                  <form action={approveUserAction}>
                    <input type="hidden" name="userId" value={profile.id} />
                    <button type="submit">Подтвердить</button>
                  </form>
                ) : null}
                {profile.status !== "blocked" ? (
                  <form action={blockUserAction}>
                    <input type="hidden" name="userId" value={profile.id} />
                    <button className="secondary-button" type="submit">Заблокировать</button>
                  </form>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminSellersTable({ sellers }: { sellers: AdminSellerRow[] }) {
  if (!sellers.length) return <p className="admin-empty">Селлеры пока не созданы.</p>;

  return (
    <table className="admin-users-table">
      <thead>
        <tr>
          <th>Селлер</th>
          <th>Пользователь</th>
          <th>Обновлён</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {sellers.map((seller) => (
          <tr key={seller.id}>
            <td>{seller.name}</td>
            <td>{seller.ownerEmail}</td>
            <td>{formatDateTime(seller.updatedAt)}</td>
            <td>
              <Link className="secondary-link" href={`/?owner=${seller.ownerId}&seller=${seller.id}`}>
                Открыть
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminCalculationsTable({ calculations }: { calculations: AdminCalculationRow[] }) {
  if (!calculations.length) return <p className="admin-empty">Сохранённых расчётов пока нет.</p>;

  return (
    <table className="admin-users-table">
      <thead>
        <tr>
          <th>Расчёт</th>
          <th>Селлер</th>
          <th>Пользователь</th>
          <th>Обновлён</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {calculations.map((calculation) => (
          <tr key={calculation.id}>
            <td>{calculation.name}</td>
            <td>{calculation.sellerName}</td>
            <td>{calculation.ownerEmail}</td>
            <td>{formatDateTime(calculation.updatedAt)}</td>
            <td>
              <Link
                className="secondary-link"
                href={`/?owner=${calculation.ownerId}&seller=${calculation.sellerId}&calculation=${calculation.id}`}
              >
                Открыть
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminCommercialSettingsForm({
  message,
  profile
}: {
  message?: string;
  profile: CommercialSettingsProfile;
}) {
  const settings = profile.settings;
  const messageText =
    message === "saved"
      ? "Коммерческие настройки по умолчанию сохранены."
      : message === "save_error"
        ? "Не удалось сохранить коммерческие настройки."
        : "";

  return (
    <form className="commercial-settings-form" action={saveDefaultCommercialSettingsAction}>
      {messageText ? <p className={`auth-notice ${message === "save_error" ? "error-notice" : ""}`}>{messageText}</p> : null}
      <div className="commercial-settings-header">
        <label>
          <span>Название профиля</span>
          <input name="profileName" defaultValue={profile.name} required />
        </label>
        <label>
          <span>Тип складской поставки PIM.Seller</span>
          <select name="warehouseSupplyType" defaultValue={settings.warehouseSupplyType}>
            <option value="mono_pallet">Монопаллета</option>
            <option value="mix_pallet">Микспаллета</option>
            <option value="boxes">Короба</option>
          </select>
        </label>
      </div>

      <div className="commercial-settings-grid">
        <section className="commercial-card first-mile-card">
          <h3>Первая миля</h3>
          <PercentInput label="Наценка" name="firstMileMarkupPercent" value={settings.firstMileMarkupPercent} />
        </section>

        <section className="commercial-card warehouse-card">
          <h3>Складские операции</h3>
          <OperationMarkupRow
            enabled={settings.warehouseOperationGroups.receiving}
            label="Приёмка"
            name="receiving"
            value={settings.warehouseOperationMarkupPercents.receiving}
          />
          <OperationMarkupRow
            enabled={settings.warehouseOperationGroups.storage}
            label="Хранение"
            name="storage"
            value={settings.warehouseOperationMarkupPercents.storage}
          />
          <OperationMarkupRow
            enabled={settings.warehouseOperationGroups.fulfillment}
            label="Комплектация"
            name="fulfillment"
            value={settings.warehouseOperationMarkupPercents.fulfillment}
          />
          <OperationMarkupRow
            enabled={settings.warehouseOperationGroups.shipping}
            label="Отгрузка"
            name="shipping"
            value={settings.warehouseOperationMarkupPercents.shipping}
          />
          <PercentInput label="Наценка по умолчанию" name="warehouseMarkupPercent" value={settings.warehouseMarkupPercent} />
        </section>

        <section className="commercial-card middle-mile-card">
          <h3>Средняя миля</h3>
          <PercentInput label="1-й литр" name="middleMileFirstLiterMarkupPercent" value={settings.middleMileFirstLiterMarkupPercent} />
          <PercentInput label="2-190 л" name="middleMileAdditionalLiterMarkupPercent" value={settings.middleMileAdditionalLiterMarkupPercent} />
          <PercentInput label="191-350 л" name="middleMileOver190LiterMarkupPercent" value={settings.middleMileOver190LiterMarkupPercent} />
          <PercentInput label="351-1000 л" name="middleMileFrom351To1000MarkupPercent" value={settings.middleMileFrom351To1000MarkupPercent} />
          <PercentInput label="1001+ л" name="middleMileFrom1001MarkupPercent" value={settings.middleMileFrom1001MarkupPercent} />
        </section>

        <section className="commercial-card last-mile-card">
          <h3>Последняя миля</h3>
          <PercentInput label="До 3 кг" name="lastMileBaseMarkupPercent" value={settings.lastMileBaseMarkupPercent} />
          <PercentInput label="Сверх 3 кг" name="lastMileAdditionalKgMarkupPercent" value={settings.lastMileAdditionalKgMarkupPercent} />
        </section>
      </div>

      <div className="commercial-settings-footer">
        {profile.updatedAt ? <span>Обновлено: {formatDateTime(profile.updatedAt)}</span> : <span>Будет создан дефолтный профиль</span>}
        <button type="submit">Сохранить дефолты</button>
      </div>
    </form>
  );
}

function PercentInput({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <label className="percent-input">
      <span>{label}</span>
      <input name={name} type="number" step="1" min="0" defaultValue={formatInputNumber(value)} />
      <small>%</small>
    </label>
  );
}

function OperationMarkupRow({
  enabled,
  label,
  name,
  value
}: {
  enabled: boolean;
  label: string;
  name: "receiving" | "storage" | "fulfillment" | "shipping";
  value: number;
}) {
  return (
    <div className="operation-markup-row">
      <label className="operation-toggle">
        <input name={`warehouseOperationGroup_${name}`} type="checkbox" defaultChecked={enabled} />
        <span>{label}</span>
      </label>
      <input
        aria-label={`Наценка: ${label}`}
        name={`warehouseOperationMarkupPercent_${name}`}
        type="number"
        step="1"
        min="0"
        defaultValue={formatInputNumber(value)}
      />
      <small>%</small>
    </div>
  );
}

function statusLabel(status: UserProfile["status"]) {
  if (status === "approved") return "Подтвержден";
  if (status === "blocked") return "Заблокирован";
  return "Ожидает";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

function formatInputNumber(value: number) {
  return String(value);
}
