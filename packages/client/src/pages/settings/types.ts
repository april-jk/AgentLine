import type { ReactNode } from "react";

export interface SettingsCategory {
  id: string;
  label: string;
  icon: ReactNode;
  description: string;
}
