"use client";

import { useEffect, useState } from "react";

type DeleteShareLinkButtonProps = {
  id: string;
  deleteLabel: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmYesLabel: string;
  confirmNoLabel: string;
};

export function DeleteShareLinkButton({
  id,
  deleteLabel,
  confirmTitle,
  confirmDescription,
  confirmYesLabel,
  confirmNoLabel,
}: DeleteShareLinkButtonProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-rose-300 px-4 py-3 text-sm font-medium text-rose-700"
      >
        {deleteLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
          <div className="w-full max-w-md rounded-lg border border-white/70 bg-white p-6 shadow-2xl">
            <h4 className="text-xl font-semibold text-slate-950">{confirmTitle}</h4>
            <p className="mt-3 text-sm leading-6 text-slate-600">{confirmDescription}</p>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-md border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                {confirmNoLabel}
              </button>

              <form action="/api/share-links/delete" method="post" className="flex-1">
                <input type="hidden" name="id" value={id} />
                <button className="w-full rounded-md bg-rose-600 px-4 py-3 text-sm font-medium text-white">
                  {confirmYesLabel}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
