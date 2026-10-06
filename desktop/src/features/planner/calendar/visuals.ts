/**
 * Event icons, the inline colour variable chips are tinted from, and the
 * accessible name an event carries in every view.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import {
  Bell,
  Bot,
  Briefcase,
  Cake,
  Calendar,
  Code,
  Coffee,
  Dumbbell,
  FileText,
  Flag,
  GraduationCap,
  HeartPulse,
  Home,
  Music,
  Plane,
  Rocket,
  Shield,
  Star,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { memberById } from "../shared/members";
import { occurrenceColor, type Occurrence } from "./model";

/** A curated subset of Yuvomi's icon picker that fits an agent workspace. */
export const EVENT_ICONS: ReadonlyArray<{ name: string; label: string; Icon: LucideIcon }> = [
  { name: "calendar", label: "Calendar", Icon: Calendar },
  { name: "bot", label: "Agent run", Icon: Bot },
  { name: "users", label: "Meeting", Icon: Users },
  { name: "flag", label: "Deadline", Icon: Flag },
  { name: "shield", label: "Security", Icon: Shield },
  { name: "file-text", label: "Document", Icon: FileText },
  { name: "code", label: "Code", Icon: Code },
  { name: "rocket", label: "Launch", Icon: Rocket },
  { name: "briefcase", label: "Work", Icon: Briefcase },
  { name: "bell", label: "Reminder", Icon: Bell },
  { name: "star", label: "Favorite", Icon: Star },
  { name: "graduation-cap", label: "Learning", Icon: GraduationCap },
  { name: "plane", label: "Travel", Icon: Plane },
  { name: "coffee", label: "Coffee", Icon: Coffee },
  { name: "utensils", label: "Meal", Icon: Utensils },
  { name: "dumbbell", label: "Sports", Icon: Dumbbell },
  { name: "heart-pulse", label: "Health", Icon: HeartPulse },
  { name: "music", label: "Music", Icon: Music },
  { name: "home", label: "Home", Icon: Home },
  { name: "cake", label: "Birthday", Icon: Cake },
];

export function colorStyle(occurrence: Occurrence, extra?: CSSProperties): CSSProperties {
  return { ["--ev" as string]: occurrenceColor(occurrence), ...extra };
}

export function assigneeNames(ids: readonly string[]): string {
  return ids
    .map((id) => memberById(id)?.name)
    .filter(Boolean)
    .join(", ");
}

/** The accessible name of an event wherever it is a button. */
export function occurrenceLabel(occurrence: Occurrence, timeText: string, dayText = ""): string {
  const names = assigneeNames(occurrence.event.attendeeIds);
  return [
    occurrence.recurring ? "Recurring event" : "",
    occurrence.event.title,
    timeText,
    dayText,
    occurrence.event.location,
    names ? `Assigned to: ${names}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Where an opener sat on screen, captured when it was pressed. */
export interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export function rectOf(element: Element | null): AnchorRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
}
