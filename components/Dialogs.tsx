"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { trapTab } from "./focusTrap";

type PromptOpts = {
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmText?: string;
  maxLength?: number;
};
type ConfirmOpts = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};
type AlertOpts = { title: string; message?: string; confirmText?: string };

type DialogState =
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void };

type DialogApi = {
  prompt: (o: PromptOpts) => Promise<string | null>;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  alert: (o: AlertOpts) => Promise<void>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used within a DialogProvider");
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => setState({ kind: "prompt", opts, resolve })),
    []
  );
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })),
    []
  );
  const alert = useCallback(
    (opts: AlertOpts) =>
      new Promise<void>((resolve) => setState({ kind: "alert", opts, resolve })),
    []
  );

  return (
    <DialogContext.Provider value={{ prompt, confirm, alert }}>
      {children}
      {state && <DialogHost key={dialogKey(state)} state={state} close={() => setState(null)} />}
    </DialogContext.Provider>
  );
}

let counter = 0;
function dialogKey(_s: DialogState) {
  // A fresh key per opened dialog so input state resets between opens.
  return ++counter;
}

function DialogHost({ state, close }: { state: DialogState; close: () => void }) {
  const initial = state.kind === "prompt" ? state.opts.initial ?? "" : "";
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function cancel() {
    if (state.kind === "prompt") state.resolve(null);
    else if (state.kind === "confirm") state.resolve(false);
    else state.resolve();
    close();
  }

  function accept() {
    if (state.kind === "prompt") {
      const v = value.trim();
      if (!v) return;
      state.resolve(v);
    } else if (state.kind === "confirm") {
      state.resolve(true);
    } else {
      state.resolve();
    }
    close();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && state.kind !== "prompt") accept();
    }
    window.addEventListener("keydown", onKey);
    (state.kind === "prompt" ? inputRef.current : confirmRef.current)?.focus();
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const danger = state.kind === "confirm" && state.opts.danger;

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div
        ref={dialogRef}
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, dialogRef.current)}
      >
        <div className="dialog-title">{state.opts.title}</div>

        {state.kind === "prompt" && (
          <>
            {state.opts.label && <label className="modal-label">{state.opts.label}</label>}
            <input
              ref={inputRef}
              className="modal-input"
              value={value}
              maxLength={state.opts.maxLength}
              placeholder={state.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  accept();
                }
              }}
            />
          </>
        )}

        {state.kind !== "prompt" && state.opts.message && (
          <p className="dialog-message">{state.opts.message}</p>
        )}

        <div className="modal-actions">
          {state.kind !== "alert" && (
            <button className="btn" onClick={cancel}>
              {state.kind === "confirm" ? state.opts.cancelText ?? "Cancel" : "Cancel"}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={accept}
            disabled={state.kind === "prompt" && !value.trim()}
          >
            {state.kind === "prompt"
              ? state.opts.confirmText ?? "OK"
              : state.kind === "confirm"
                ? state.opts.confirmText ?? "Confirm"
                : state.opts.confirmText ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
