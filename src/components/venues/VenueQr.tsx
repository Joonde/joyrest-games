/**
 * QR-коды анкет ведущего: «Для заведения» (анкета площадки) и «Для клиента» (подбор площадки).
 * В ссылке — id ведущего: в базе видно, кто привёл площадку или клиента.
 */
import { useState } from "react";
import { useLoad, venuesRepo } from "../../data";
import { QrCode } from "../QrCode";
import { Tabs } from "../Tabs";
import { Toast, useToast } from "../Toast";

type Kind = "venue" | "client";

export function venueFormUrl(kind: Kind, uid: string): string {
  return `${window.location.origin}/${kind === "venue" ? "v" : "r"}?from=${encodeURIComponent(uid)}`;
}

const TEXT: Record<Kind, { title: string; hint: string; share: string }> = {
  venue: {
    title: "Анкета для заведения",
    hint: "Покажите администратору площадки после мероприятия: он заполнит анкету, и площадка попадёт в нашу базу.",
    share: "Анкета площадки для JoyRest — около 3 минут",
  },
  client: {
    title: "Подбор площадки для клиента",
    hint: "Дайте заказчику: он расскажет о празднике, а мы подберём подходящие площадки и пришлём варианты.",
    share: "JoyRest подберёт площадку под ваше мероприятие",
  },
};

export function VenueQr({ uid }: { uid: string }) {
  const [kind, setKind] = useState<Kind>("venue");
  const [toast, showToast] = useToast();
  const [open] = useLoad(() => (venuesRepo ? venuesRepo.formsOpen() : Promise.resolve(false)), []);
  const url = venueFormUrl(kind, uid);
  const text = TEXT[kind];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Ссылка скопирована");
    } catch {
      showToast("Не получилось скопировать — удерживайте ссылку пальцем");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "JoyRest", text: text.share, url });
    } catch {
      // Отменили или браузер не умеет «Поделиться» — ничего страшного.
    }
  }

  return (
    <section className="stack">
      {open.status === "ready" && !open.data && (
        <p className="notice small">Анкеты пока закрыты: по коду откроется «Анкета пока закрыта». Владелец включает их на сервере.</p>
      )}
      <Tabs
        idPrefix="venue-qr"
        label="Какой QR-код показать"
        value={kind}
        onChange={setKind}
        items={[
          { id: "venue", label: "Для заведения" },
          { id: "client", label: "Для клиента" },
        ]}
      />
      <div className="card card--center" id={`venue-qr-panel-${kind}`} role="tabpanel" aria-labelledby={`venue-qr-tab-${kind}`}>
        <h2>{text.title}</h2>
        <QrCode value={url} label={`QR-код: ${text.title}`} className="venue-qr" />
        <p className="muted small">{text.hint}</p>
        <p className="line-clamp small venue-qr__url">{url.replace(/^https?:\/\//, "")}</p>
        <div className="actions">
          {typeof navigator.share === "function" && (
            <button className="btn btn--block" type="button" onClick={() => void share()}>
              Поделиться ссылкой
            </button>
          )}
          <button className="btn btn--secondary btn--block" type="button" onClick={() => void copy()}>
            Скопировать ссылку
          </button>
        </div>
      </div>
      <Toast text={toast} />
    </section>
  );
}
