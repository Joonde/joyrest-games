import { useRef, useState } from "react";
import { teamRepo, useLoad, type TeamMember, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { cropImage, ImageError } from "../../components/media/compressImage";
import { StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TeamCard } from "../../components/team/TeamCard";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { studioActions } from "./Studio";

const BIO_MAX = 300;
/** Аватарка 1:1 до 512 px (~120 КБ), обложка 3:1 до 1500 px (~250 КБ) — экран телефона и ноутбука. */
const IMAGE = {
  avatar: { aspect: 1, width: 512, targetBytes: 120 * 1024, maxBytes: 290 * 1024 },
  cover: { aspect: 3, width: 1500, targetBytes: 250 * 1024, maxBytes: 590 * 1024 },
} as const;

export function Profile() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Мой профиль" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          <ProfileEditor profile={profile} />
        </main>
      )}
    </HostGate>
  );
}

function ProfileEditor({ profile }: { profile: UserProfile }) {
  const [state, retry, update] = useLoad(async () => {
    const team = teamRepo ? await teamRepo.list() : [];
    return team.find((m) => m.uid === profile.uid) ?? null;
  }, [profile.uid]);
  const [toast, showToast] = useToast();

  if (!teamRepo) return <p className="muted">Профиль доступен на своём сервере JoyRest.</p>;
  if (state.status === "loading") return null;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const me: TeamMember = state.data ?? { uid: profile.uid, name: profile.name, bio: "", avatar: null, cover: null, owner: false, since: null };
  const set = (patch: Partial<TeamMember>) => update((m) => ({ ...(m ?? me), ...patch }));

  return (
    <>
      <p className="muted">Так вашу карточку видят другие ведущие и владелец JoyRest в разделе «Команда».</p>
      <TeamCard member={me} />
      <ImagePicker uid={profile.uid} kind="avatar" title="Аватарка" hint="Квадратное фото лица, обрежется по центру." has={me.avatar !== null} onDone={(sha) => set({ avatar: sha })} onToast={showToast} />
      <ImagePicker uid={profile.uid} kind="cover" title="Обложка" hint="Широкое фото 3 : 1 — со сцены, с мероприятия, ваш стиль." has={me.cover !== null} onDone={(sha) => set({ cover: sha })} onToast={showToast} />
      <BioEditor initial={me.bio} onSaved={(bio) => set({ bio })} onToast={showToast} />
      <Toast text={toast} />
    </>
  );
}

/** Отпечаток загруженной картинки не возвращается в контракте — берём свежий список. */
async function freshSha(uid: string, kind: "avatar" | "cover"): Promise<string | null> {
  const team = teamRepo ? await teamRepo.list() : [];
  return team.find((m) => m.uid === uid)?.[kind] ?? null;
}

function ImagePicker({
  uid,
  kind,
  title,
  hint,
  has,
  onDone,
  onToast,
}: {
  uid: string;
  kind: "avatar" | "cover";
  title: string;
  hint: string;
  has: boolean;
  onDone: (sha: string | null) => void;
  onToast: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | null) {
    if (!file || !teamRepo) return;
    setBusy(true);
    setError(null);
    try {
      const image = await cropImage(file, IMAGE[kind]);
      await teamRepo.upload(kind, image.blob, image.width, image.height);
      onDone(await freshSha(uid, kind));
      onToast(kind === "avatar" ? "Аватарка обновлена" : "Обложка обновлена");
    } catch (e) {
      setError(e instanceof ImageError ? e.message : "Не удалось загрузить. Проверьте интернет.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    if (!teamRepo) return;
    setBusy(true);
    setError(null);
    try {
      await teamRepo.remove(kind);
      onDone(null);
    } catch {
      setError("Не удалось убрать. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby={`profile-${kind}`}>
      <h2 id={`profile-${kind}`}>{title}</h2>
      <p className="muted">{hint}</p>
      <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      <div className="actions">
        <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Сжимаем и загружаем…" : has ? `Сменить ${kind === "avatar" ? "аватарку" : "обложку"}` : `Выбрать ${kind === "avatar" ? "аватарку" : "обложку"}`}
        </button>
        {has && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void remove()}>
            Убрать
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function BioEditor({ initial, onSaved, onToast }: { initial: string; onSaved: (bio: string) => void; onToast: (text: string) => void }) {
  const [bio, setBio] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!teamRepo) return;
    setBusy(true);
    setError(null);
    try {
      await teamRepo.setBio(bio.trim());
      onSaved(bio.trim());
      onToast("Сохранено");
    } catch {
      setError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="profile-bio">
      <h2 id="profile-bio">О себе</h2>
      <label className="field">
        Пара строк для команды: что ведёте, чем гордитесь
        <textarea rows={4} maxLength={BIO_MAX} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      <p className="muted small">
        {bio.length} из {BIO_MAX}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy || bio.trim() === initial} onClick={() => void save()}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}
