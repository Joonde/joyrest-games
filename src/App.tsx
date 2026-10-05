import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loading } from "./components/Status";
import { Home } from "./screens/Home";
import { JoinByCode } from "./screens/JoinByCode";
import { NotFound } from "./screens/NotFound";

// Экраны грузятся по отдельности: телефону гостя не нужен код пульта и студии.
const Studio = lazy(() => import("./screens/Studio").then((m) => ({ default: m.Studio })));
const Admin = lazy(() => import("./screens/Admin").then((m) => ({ default: m.Admin })));
const HostConsole = lazy(() => import("./screens/HostConsole").then((m) => ({ default: m.HostConsole })));
const HallScreen = lazy(() => import("./screens/HallScreen").then((m) => ({ default: m.HallScreen })));
const Play = lazy(() => import("./screens/Play").then((m) => ({ default: m.Play })));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/host/:code" element={<HostConsole />} />
          <Route path="/screen/:code" element={<HallScreen />} />
          <Route path="/play/:code" element={<Play />} />
          <Route path="/j" element={<JoinByCode />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
