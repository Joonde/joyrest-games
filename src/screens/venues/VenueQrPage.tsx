/** «QR-анкеты» в студии (`/studio/qr`): любой ведущий показывает площадке или клиенту свой QR-код. */
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { TopBar } from "../../components/TopBar";
import { VenueQr } from "../../components/venues/VenueQr";
import { venuesRepo } from "../../data";
import { studioActions } from "../studio/Studio";

export function VenueQrPage() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(user, profile) => (
        <main className="page">
          <TopBar title="QR-анкеты" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          {venuesRepo ? <VenueQr uid={user.uid} /> : <p className="muted">QR-анкеты работают на своём сервере JoyRest.</p>}
        </main>
      )}
    </HostGate>
  );
}
