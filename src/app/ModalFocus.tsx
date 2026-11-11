"use client";

import { useEffect } from "react";

// Keyboard and screen reader support for the bottom sheets and the recap, which are marked
// role="dialog" aria-modal="true". Mounted once per page: when a dialog appears it takes focus, Tab stays
// inside it while it is open, and when it closes focus goes back to the control that opened it.
const DIALOG = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function ModalFocus() {
  useEffect(() => {
    let dialog: HTMLElement | null = null;
    let opener: HTMLElement | null = null;

    const sync = () => {
      const found = document.querySelector<HTMLElement>(DIALOG);
      if (found !== dialog) {
        if (found && !dialog) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (!found && opener?.isConnected) opener.focus();
        dialog = found;
      }
      // Also runs when a sheet swaps its content and the focused control goes away.
      if (dialog && !dialog.contains(document.activeElement)) {
        if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
        dialog.focus();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (!first) e.preventDefault();
      else if (e.shiftKey && (at === first || at === dialog)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };

    const watch = new MutationObserver(sync);
    watch.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey);
    sync();
    return () => {
      watch.disconnect();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
