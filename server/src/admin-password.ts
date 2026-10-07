/**
 * Пароль владельца агентства на своём сервере: `sudo joyrest admin-password [test]` передаёт
 * почту и пароль строками через stdin (не аргументами — их видно в списке процессов) и
 * запускает в контейнере `node server/admin-password.js`.
 *
 * Владелец — аккаунт с id ADMIN_UID (тот же, что в Firebase: при переносе его игры и история
 * остаются его). Новый пароль закрывает все прежние входы владельца.
 */
import postgres, { type Sql } from "postgres";
import { ADMIN_UID } from "../../src/data/config";
import { EMAIL_PATTERN } from "./auth";
import { hashPassword } from "./password";

export const ADMIN_PASSWORD_MIN = 12;

export type AdminInput = { ok: true; email: string; password: string } | { ok: false; message: string };

/** Первая строка — почта, вторая — пароль (без перевода строки и \r с телефона). */
export function parseAdminInput(text: string): AdminInput {
  const [rawEmail = "", rawPassword = ""] = text.split("\n");
  const email = rawEmail.replace(/\r$/, "").trim().toLowerCase();
  const password = rawPassword.replace(/\r$/, "");
  if (!EMAIL_PATTERN.test(email) || email.length > 200) return { ok: false, message: "Не похоже на почту." };
  if ([...password].length < ADMIN_PASSWORD_MIN) return { ok: false, message: `Пароль короче ${ADMIN_PASSWORD_MIN} символов.` };
  if (password.length > 200) return { ok: false, message: "Пароль длиннее 200 символов." };
  return { ok: true, email, password };
}

/** Создаёт или обновляет аккаунт владельца. Почта занята другим ведущим — ошибка. */
export async function setAdminPassword(sql: Sql, email: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await sql.begin(async (tx) => {
    const taken = await tx<{ name: string }[]>`select name from users where lower(email) = ${email} and id <> ${ADMIN_UID}`;
    if (taken[0]) throw new Error(`Почта ${email} уже у ведущего «${taken[0].name}». Укажите другую.`);
    await tx`
      insert into users (id, email, name, role, active, password_hash, must_change_password)
      values (${ADMIN_UID}, ${email}, 'Администратор', 'admin', true, ${hash}, false)
      on conflict (id) do update set email = excluded.email, role = 'admin', active = true,
        password_hash = excluded.password_hash, must_change_password = false, updated_at = now()`;
    await tx`delete from auth_sessions where user_id = ${ADMIN_UID}`;
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Нет DATABASE_URL.");
  const input = parseAdminInput(await readStdin());
  if (!input.ok) throw new Error(input.message);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await setAdminPassword(sql, input.email, input.password);
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log("Пароль сохранён.");
}

// Запуск файлом (в образе), а не импорт из тестов.
if (process.argv[1]?.endsWith("admin-password.js")) {
  main().catch((error: unknown) => {
    // Последняя строка вывода — её показывает joyrest. Без пароля и хэша.
    console.error(error instanceof Error ? error.message : "Ошибка");
    process.exit(1);
  });
}
