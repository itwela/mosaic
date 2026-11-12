// The interface icon set from the design file: 14-unit grid, 1.4 stroke, round caps.
import { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  plus: <path d="M7 2.5v9M2.5 7h9" />,
  close: <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />,
  chev: <path d="M4 5.5l3 3 3-3" />,
  chevr: <path d="M5.5 4l3 3-3 3" />,
  back: <path d="M8.5 3.5L5 7l3.5 3.5" />,
  search: <><circle cx="6.2" cy="6.2" r="3.7" /><path d="M9 9l3 3" /></>,
  box: <path d="M2 5.5h10v6H2zM2 5.5l1.200-2.500h7.600L12 5.500M5.500 8h3" />,
  erase: <path d="M5 11.5L1.800 8.300 8 2.200l4.200 4.200-5.200 5.100zM4.600 5.600l4.200 4.200M5 11.500h7" />,
  home: <path d="M2.5 6.5L7 2.800l4.500 3.700v5h-9z" />,
  play: <path d="M4.5 3l6 4-6 4z" fill="currentColor" stroke="none" />,
  refresh: <path d="M11.5 7a4.500 4.500 0 1 1-1.400-3.200M11.600 2.400v2.400H9.200" />,
  cmds: <><ellipse cx="7" cy="3.8" rx="4.5" ry="1.8" /><path d="M2.5 3.800v6.400c0 1 2 1.800 4.500 1.800s4.500-.8 4.500-1.800V3.800M2.500 7c0 1 2 1.800 4.500 1.800S11.500 8 11.500 7" /></>,
  notes: <path d="M3 2h8v10H3zM5.200 5.800l1.300 1.300 2.400-2.600M5.300 9.600h3.500" />,
  grid: <path d="M2 2h4.200v4.200H2zM7.800 2H12v4.200H7.800zM2 7.800h4.200V12H2zM7.800 7.800H12V12H7.800z" />,
  gear: <><circle cx="7" cy="7" r="2" /><path d="M7 1.500v1.800M7 10.700v1.800M1.500 7h1.800M10.700 7h1.800M3.100 3.100l1.300 1.300M9.600 9.600l1.300 1.300M3.100 10.900l1.300-1.300M9.600 4.400l1.300-1.300" /></>,
  help: <><circle cx="7" cy="7" r="5.3" /><path d="M5.400 5.600a1.700 1.700 0 1 1 2.400 1.600c-.5.300-.8.600-.8 1.200M7 10.200v.1" /></>,
  info: <><circle cx="7" cy="7" r="5.3" /><path d="M7 6.400v3.600M7 4.200v.1" /></>,
  imp: <path d="M7 2v7M4.200 6.400L7 9.200l2.800-2.800M2.500 11.800h9" />,
  grip: <g fill="currentColor" stroke="none"><circle cx="5" cy="3.5" r="1" /><circle cx="9" cy="3.5" r="1" /><circle cx="5" cy="7" r="1" /><circle cx="9" cy="7" r="1" /><circle cx="5" cy="10.5" r="1" /><circle cx="9" cy="10.5" r="1" /></g>,
  tuck: <path d="M2.5 9.500L7 5l4.500 4.500M2.500 3h9" />,
  out: <path d="M5 3h6v6M11 3L4 10" />,
  copy: <path d="M5 5h6.500v6.500H5zM2.500 9V2.500H9" />,
  check: <path d="M3 7.300l2.800 2.700L11 4.500" />,
  more: <g fill="currentColor" stroke="none"><circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" /><circle cx="11" cy="7" r="1.2" /></g>,
  edit: <path d="M2.500 11.500l.6-2.700 6.400-6.300 2 2-6.300 6.400z" />,
  file: <path d="M3.500 2h4.500l2.500 2.500V12h-7zM8 2v2.500h2.500" />,
  folder: <path d="M2 4h3.600l1.200 1.400H12v6H2z" />,
  restore: <path d="M2.500 4.500L7 9l4.500-4.500M2.500 11h9" />,
  zen: <><circle cx="7" cy="7" r="5" /><path d="M7 2a2.500 2.500 0 0 1 0 5 2.500 2.500 0 0 0 0 5" /></>,
};

export default function Icon({ name, size = 14, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={`ic ic-${name}${className ? " " + className : ""}`} width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
