/*
Copyright 2026 Mudrix

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useEffect } from "react";
import { combineLatest, of, switchMap } from "rxjs";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type ReactionOption, ReactionSet } from "../reactions";

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
  openSettings(): void;
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

/** `?hideFooter=true`: the embedding app draws its own controls, so EC's footer is not shown. */
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
    const bridge: MudrixCallBridge = {
      toggleScreenShare: () => vm.toggleScreenSharing?.(),
      sendReaction: async (name) => {
        const reaction = ReactionSet.find((r) => r.name === name);
        if (reaction) await sendReaction(reaction);
      },
      toggleRaisedHand: () => toggleRaisedHand(),
      openSettings: () => vm.setSettingsOpen$.value(true),
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
