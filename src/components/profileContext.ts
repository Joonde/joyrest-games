import { createContext } from "react";
import type { UserProfile } from "../data";

/** Профиль вошедшего (ставит HostGate): шапке нужен, чтобы решить, показывать ли колокольчик. */
export const ProfileContext = createContext<UserProfile | null>(null);
