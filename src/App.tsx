import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loading } from "./components/Status";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { Home } from "./screens/Home";
import { JoinByCode } from "./screens/JoinByCode";
import { NotFound } from "./screens/NotFound";

// Экраны грузятся по отдельности: телефону гостя не нужен код пульта и студии.
const Studio = lazy(() => import("./screens/studio/Studio").then((m) => ({ default: m.Studio })));
const NewGame = lazy(() => import("./screens/studio/NewGame").then((m) => ({ default: m.NewGame })));
const GameEditor = lazy(() => import("./screens/studio/GameEditor").then((m) => ({ default: m.GameEditor })));
const Rehearsal = lazy(() => import("./screens/studio/Rehearsal").then((m) => ({ default: m.Rehearsal })));
const Launch = lazy(() => import("./screens/studio/Launch").then((m) => ({ default: m.Launch })));
const ChangePassword = lazy(() =>
  import("./screens/studio/ChangePassword").then((m) => ({ default: m.ChangePassword })),
);
const Team = lazy(() => import("./screens/studio/Team").then((m) => ({ default: m.Team })));
const Profile = lazy(() => import("./screens/studio/Profile").then((m) => ({ default: m.Profile })));
const Results = lazy(() => import("./screens/Results").then((m) => ({ default: m.Results })));
const Admin = lazy(() => import("./screens/Admin").then((m) => ({ default: m.Admin })));
const HostConsole = lazy(() => import("./screens/HostConsole").then((m) => ({ default: m.HostConsole })));
const HallScreen = lazy(() => import("./screens/HallScreen").then((m) => ({ default: m.HallScreen })));
const Brand = lazy(() => import("./screens/Brand").then((m) => ({ default: m.Brand })));
const Play = lazy(() => import("./screens/Play").then((m) => ({ default: m.Play })));

export function App() {
  return (
    <BrowserRouter>
      <ConnectionBanner />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/studio/new" element={<NewGame />} />
          <Route path="/studio/games/:gameId" element={<GameEditor />} />
          <Route path="/studio/launch/:gameId" element={<Launch />} />
          <Route path="/studio/rehearsal/:gameId" element={<Rehearsal />} />
          <Route path="/studio/password" element={<ChangePassword />} />
          <Route path="/studio/team" element={<Team />} />
          <Route path="/studio/profile" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/host/:code" element={<HostConsole />} />
          <Route path="/screen/:code" element={<HallScreen />} />
          <Route path="/play/:code" element={<Play />} />
          <Route path="/j" element={<JoinByCode />} />
          <Route path="/s" element={<JoinByCode target="screen" />} />
          <Route path="/results/:resultId" element={<Results />} />
          <Route path="/brand" element={<Brand />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
