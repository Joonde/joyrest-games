/**
 * Резервные копии (CLAUDE.md, «Переезд на свой сервер», этап 6): каждую ночь restic → Beget S3.
 * Сами команды проверяются на сервере и вручную (bash, Docker, restic); здесь — то, что легко
 * сломать правкой: расписание, сроки хранения, где лежат доступы, защита игры и основной базы.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const joyrest = read("deploy/bin/joyrest");

/** Тело функции bash `name() { … }` до закрывающей скобки в начале строки. */
function bashFunction(name: string): string {
  const start = joyrest.indexOf(`\n${name}() {`);
  expect(start, name).toBeGreaterThan(0);
  return joyrest.slice(start, joyrest.indexOf("\n}", start + 1));
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("резервные копии", () => {
  it("таймер: каждую ночь, пропущенный запуск догоняется; служба — backup-nightly", () => {
    const timer = read("deploy/systemd/joyrest-backup.timer");
    expect(timer).toMatch(/^OnCalendar=\*-\*-\* 04:40:00$/m);
    expect(timer).toMatch(/^Persistent=true$/m);
    expect(timer).toMatch(/^WantedBy=timers\.target$/m);
    const service = read("deploy/systemd/joyrest-backup.service");
    expect(service).toMatch(/^ExecStart=\/usr\/local\/bin\/joyrest backup-nightly$/m);
    expect(service).toMatch(/^Type=oneshot$/m);
  });

  it("выкладка включает таймер копий вместе с остальными", () => {
    expect(bashFunction("install_system")).toMatch(/systemctl enable --now [^\n]*joyrest-backup\.timer/);
  });

  it("сроки хранения 7/4/3 — в коде и в CLAUDE.md (указываются в политике ПД)", () => {
    expect(joyrest).toMatch(/^KEEP_DAILY=7$/m);
    expect(joyrest).toMatch(/^KEEP_WEEKLY=4$/m);
    expect(joyrest).toMatch(/^KEEP_MONTHLY=3$/m);
    const claude = read("CLAUDE.md");
    expect(claude).toContain("7 ежедневных, 4 еженедельных, 3 ежемесячных");
    expect(claude).toMatch(/срок хранения резервных копий/i);
  });

  it("доступы restic и S3 читаются только из backup.env; приложениям они не передаются", () => {
    const run = bashFunction("restic_run");
    for (const name of ["RESTIC_REPOSITORY", "RESTIC_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
      expect(run).toContain(`${name}=$(env_value "$BACKUP_ENV" ${name})`);
    }
    expect(joyrest).toMatch(/^BACKUP_ENV="\$ROOT_DIR\/backup\.env"$/m);
    const compose = read("deploy/compose.yml");
    for (const name of ["RESTIC_", "AWS_", "NOTIFY_TELEGRAM", "backup.env"]) {
      expect(compose, name).not.toContain(name);
    }
  });

  it("в репозитории нет файла backup.env", () => {
    const found = files(ROOT).filter((path) => path.endsWith("/backup.env"));
    expect(found).toEqual([]);
  });

  it("prune и проверки (целостность, восстановление) во время игры откладываются", () => {
    const nightly = bashFunction("cmd_backup_nightly");
    expect(nightly).toContain("active=$(active_games)");
    for (const step of ["last-prune", "last-check", "last-restore-check"]) {
      expect(nightly, step).toMatch(new RegExp(`\\[ "\\$game" = 0 \\] && due ${step} `));
    }
    // Итог недели — после проверки целостности, а не вместо неё.
    expect(nightly).toMatch(/due last-summary [^\n]*\[ "\$game" = 1 \] && due last-check/);
  });

  it("неудачная копия → сообщение в Telegram; оборванный pg_dump не становится копией", () => {
    expect(bashFunction("cmd_backup_nightly")).toContain('notify "⚠️ Резервная копия не сделана: $BACKUP_REASON"');
    const once = bashFunction("backup_once");
    // restic читает проверенный файл дампа, а не поток pg_dump.
    expect(once).toMatch(/dump_prod "\$file"/);
    expect(once).toMatch(/restic_run backup [^\n]*--stdin [^\n]*< "\$file"/);
    expect(bashFunction("dump_prod")).toContain("pg_restore --list");
  });

  it("основная база восстанавливается только из Termius, с подтверждением и проверкой игры", () => {
    const restore = bashFunction("cmd_restore");
    expect(restore).toContain('[ -t 0 ] || die "Восстановление основной базы — только из Termius."');
    expect(restore).toContain('ensure_no_game "$force" "restore $snap prod"');
    expect(restore).toContain('= восстановить ] || die "Ничего не изменено."');
    expect(restore).toContain("joyrest_prod_before_restore");
    // Копия может быть старше схемы: миграции текущей версии после восстановления.
    expect(restore).toContain('run_migrations "$target" "$image"');
  });

  it("пароль копий подтверждается последними 4 символами до создания хранилища", () => {
    const setup = bashFunction("cmd_backup_setup");
    const confirm = setup.indexOf('"${password: -4}"');
    const init = setup.indexOf("restic_run init");
    expect(confirm).toBeGreaterThan(0);
    expect(init).toBeGreaterThan(confirm);
  });

  it("коммит с [no-test] на test не выкладывается, main — всегда", () => {
    const build = read(".github/workflows/build.yml");
    const deploy = build.slice(build.indexOf("\n  deploy:"));
    const condition = deploy.slice(deploy.indexOf("    if:"), deploy.indexOf("    runs-on:"));
    expect(condition).toContain("needs.switch.outputs.enabled == 'true'");
    expect(condition).toContain("github.ref == 'refs/heads/main' || !contains(github.event.head_commit.message, '[no-test]')");
  });

  it("CI не запускает восстановление и настройку копий", () => {
    const workflows = readdirSync(join(ROOT, ".github/workflows")).map((name) => read(`.github/workflows/${name}`));
    for (const text of workflows) {
      expect(text).not.toMatch(/joyrest (restore|backup-setup|restore-settings)/);
    }
    // Привратник SSH пропускает только выкладку.
    expect(read("deploy/bin/joyrest-gate")).not.toMatch(/restore|backup/);
  });
});
