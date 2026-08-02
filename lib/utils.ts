// Minimal `cn` classname combiner used across the cinematic-video engine and
// the video player. clsx-lite: flattens nested arrays, drops falsy values, and
// joins with spaces. (No tailwind-merge conflict resolution — the call sites in
// this project never emit competing utilities that would need de-duping.)
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue) => {
    if (!value && value !== 0) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else {
      out.push(String(value));
    }
  };
  inputs.forEach(walk);
  return out.join(" ");
}
