// «Миллионер»: контурные значки подсказок (цвет — currentColor), одинаковые на экране, пульте и телефоне.
import type { LifelineId } from "./content";

export function LifelineIcon({ id, size = "1em" }: { id: LifelineId; size?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (id) {
    case "fifty":
      return (
        <svg {...common}>
          <text x="24" y="31" textAnchor="middle" fontSize="19" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Jost, sans-serif">
            50:50
          </text>
        </svg>
      );
    case "audience":
      return (
        <svg {...common}>
          <circle cx="16" cy="17" r="5" />
          <circle cx="32" cy="17" r="5" />
          <circle cx="24" cy="14" r="5.5" />
          <path d="M6 37c0-6 4.5-10 10-10M42 37c0-6-4.5-10-10-10M14 39c0-7 4.5-11 10-11s10 4 10 11" />
          <path d="M24 3v4M38 6l-2 3M10 6l2 3" strokeWidth="2.4" />
        </svg>
      );
    case "call":
      return (
        <svg {...common}>
          <path d="M14 7l6 9-4 4c2 5 6 9 11 11l4-4 9 6-4 7C22 40 8 26 7 11z" />
          <path d="M30 8a10 10 0 0 1 10 10M30 14a4 4 0 0 1 4 4" strokeWidth="2.4" />
        </svg>
      );
    case "mistake":
      return (
        <svg {...common}>
          <path d="M24 5l15 6v11c0 10-7 17-15 21C16 39 9 32 9 22V11z" />
          <path d="M17 24l5 5 9-10" />
        </svg>
      );
    case "swap":
      return (
        <svg {...common}>
          <path d="M9 19a15 15 0 0 1 27-6M39 29a15 15 0 0 1-27 6" />
          <path d="M37 5v8h-8M11 43v-8h8" />
        </svg>
      );
    case "host":
      return (
        <svg {...common}>
          <path d="M17 31c-3-3-5-6-5-11a12 12 0 0 1 24 0c0 5-2 8-5 11v4H17z" />
          <path d="M18 40h12M20 44h8" />
          <path d="M24 13v5M21 21l3 3 3-3" strokeWidth="2.4" />
        </svg>
      );
  }
}
