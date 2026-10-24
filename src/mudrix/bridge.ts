/*
Copyright 2026 Mudrix

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useEffect } from "react";
import { logger } from "matrix-js-sdk/lib/logger";
import { combineLatest, of, switchMap } from "rxjs";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type ReactionOption, ReactionSet } from "../reactions";
import {
  backgroundBlur,
  showHandRaisedTimer,
  showReactions,
  type Setting,
} from "../settings/settings";

/**
 * EC settings the Mudrix settings page controls. EC's own settings modal is not shown when
 * embedded in Mudrix; devices and sounds are handled by Mudrix itself.
 */
const MUDRIX_SETTINGS: Record<string, Setting<boolean>> = {
  "background-blur": backgroundBlur,
  "hand-raised-show-timer": showHandRaisedTimer,
  "reactions-show": showReactions,
};

/**
 * The Mudrix client embeds Element Call same-origin and draws its own call controls. Instead of
 * clicking EC's (hidden) footer buttons through CSS selectors, it drives the call through this
 * object on the iframe's window: `iframe.contentWindow.mudrixCall`.
 */
export interface MudrixCallState {
  sharingScreen: boolean;
  layout: "grid" | "spotlight" | null;
}

export interface MudrixCallBridge {
  toggleScreenShare(): void;
  /** A reaction by its name in ReactionSet ("thumbsup", "party", …). */
  sendReaction(name: string): Promise<void>;
  toggleRaisedHand(): Promise<void>;
  /** Applies one of MUDRIX_SETTINGS to the running call (it is also stored in localStorage). */
  setSetting(key: string, value: boolean): void;
  setLayout(layout: "grid" | "spotlight"): void;
  /** Calls `listener` now and on every change; returns an unsubscribe. */
  subscribe(listener: (state: MudrixCallState) => void): () => void;
  reactions: readonly ReactionOption[];
}

declare global {
  interface Window {
    mudrixCall?: MudrixCallBridge;
  }
}

/**
 * `?hideFooter=true`: the embedding app draws its own controls and settings, so EC's footer and
 * settings modal are not shown.
 */
export function mudrixHidesFooter(): boolean {
  return (
    new URLSearchParams(window.location.search).get("hideFooter") === "true"
  );
}

export function useMudrixCallBridge(
  vm: CallViewModel,
  sendReaction: (reaction: ReactionOption) => Promise<void>,
  toggleRaisedHand: () => Promise<void>,
): void {
  useEffect(() => {
    let reactionInFlight = false;
    const bridge: MudrixCallBridge = {
      toggleScreenShare: () => vm.toggleScreenSharing?.(),
      sendReaction: async (name) => {
        const reaction = ReactionSet.find((r) => r.name === name);
        // One at a time: a burst of clicks would otherwise send a burst of room events (which
        // the server rate-limits) while EC is still waiting to see its own reaction come back.
        if (!reaction || reactionInFlight) return;
        reactionInFlight = true;
        try {
          await sendReaction(reaction);
        } catch (e) {
          logger.warn("Mudrix reaction failed", e);
        } finally {
          reactionInFlight = false;
        }
      },
      toggleRaisedHand: () => toggleRaisedHand(),
      setSetting: (key, value) => MUDRIX_SETTINGS[key]?.setValue(value),
      setLayout: (layout) => vm.layoutSwitchVm$.value?.setLayout(layout),
      subscribe: (listener) => {
        const sub = combineLatest([
          vm.sharingScreen$,
          vm.layoutSwitchVm$.pipe(
            switchMap((layoutSwitch) => layoutSwitch?.layout$ ?? of(null)),
          ),
        ]).subscribe(([sharingScreen, layout]) =>
          listener({ sharingScreen, layout }),
        );
        return (): void => sub.unsubscribe();
      },
      reactions: ReactionSet,
    };
    window.mudrixCall = bridge;
    window.dispatchEvent(new Event("mudrixcallready"));
    return (): void => {
      if (window.mudrixCall === bridge) delete window.mudrixCall;
    };
  }, [vm, sendReaction, toggleRaisedHand]);
}

/**
 * Each tile's view model, by media id. Tiles carry `data-mx-media-id`, so the embedding app can
 * read a tile's state (`userId`, `type`, `speaking$`, …) without walking React internals.
 */
const mediaRefs = new Map<string, number>();

declare global {
  interface Window {
    mudrixMedia?: Map<string, { id: string }>;
  }
}

export function useMudrixMedia(vm: { id: string } | undefined): void {
  useEffect(() => {
    if (!vm) return;
    const media = (window.mudrixMedia ??= new Map());
    media.set(vm.id, vm);
    mediaRefs.set(vm.id, (mediaRefs.get(vm.id) ?? 0) + 1);
    return (): void => {
      const left = (mediaRefs.get(vm.id) ?? 1) - 1;
      if (left > 0) {
        mediaRefs.set(vm.id, left);
      } else {
        mediaRefs.delete(vm.id);
        if (media.get(vm.id) === vm) media.delete(vm.id);
      }
    };
  }, [vm]);
}
